import { encodeBase64, decodeBase64 } from "./base64";
import { serializeStoreMutation } from "./store-queue";
import type { PlatformStorage } from "@gamekits/platform-core";
import { createMissingSlotError } from "./errors";
import type { SaveSlotId, SaveSlotSummary, SaveStore } from "./types";

export type PlatformStorageSaveStoreOptions = {
  storage: PlatformStorage;
  prefix?: string;
};

export { createPlatformFileSaveStore, type PlatformFileSaveStoreOptions } from "./file-store";

export function createMemorySaveStore(
  initialEntries: Array<{
    slotId: SaveSlotId;
    data: Uint8Array;
    metadata: SaveSlotSummary;
  }> = []
): SaveStore {
  const slots = new Map<SaveSlotId, { data: Uint8Array; metadata: SaveSlotSummary }>();
  for (const entry of initialEntries) {
    slots.set(entry.slotId, {
      data: copyBytes(entry.data),
      metadata: { ...entry.metadata }
    });
  }

  return {
    async list() {
      return [...slots.values()].map((entry) => ({ ...entry.metadata }));
    },
    async read(slotId) {
      const entry = slots.get(slotId);
      if (!entry) {
        throw createMissingSlotError(slotId);
      }
      return copyBytes(entry.data);
    },
    async write(slotId, data, metadata) {
      slots.set(slotId, {
        data: copyBytes(data),
        metadata: { ...metadata, id: slotId }
      });
    },
    async delete(slotId) {
      if (!slots.delete(slotId)) {
        throw createMissingSlotError(slotId);
      }
    },
    async exists(slotId) {
      return slots.has(slotId);
    }
  };
}

export function createPlatformStorageSaveStore(
  options: PlatformStorageSaveStoreOptions
): SaveStore {
  const prefix = options.prefix ?? "gamekits.save";
  const indexKey = `${prefix}.index`;

  return {
    async list() {
      return readStorageIndex(options.storage, indexKey);
    },
    async read(slotId) {
      const value = await options.storage.getItem(slotKey(prefix, slotId));
      if (value === undefined) {
        throw createMissingSlotError(slotId);
      }
      return decodeBase64(value);
    },
    async write(slotId, data, metadata) {
      await serializeStoreMutation(options.storage, async () => {
        await options.storage.setItem(slotKey(prefix, slotId), encodeBase64(data));
        const index = await readStorageIndex(options.storage, indexKey);
        const nextIndex = [
          ...index.filter((entry) => entry.id !== slotId),
          { ...metadata, id: slotId }
        ];
        await options.storage.setItem(indexKey, JSON.stringify(nextIndex));
      });
    },
    async delete(slotId) {
      await serializeStoreMutation(options.storage, async () => {
        if (!(await this.exists(slotId))) throw createMissingSlotError(slotId);
        await options.storage.removeItem(slotKey(prefix, slotId));
        const index = await readStorageIndex(options.storage, indexKey);
        await options.storage.setItem(
          indexKey,
          JSON.stringify(index.filter((entry) => entry.id !== slotId))
        );
      });
    },
    async exists(slotId) {
      return (await options.storage.getItem(slotKey(prefix, slotId))) !== undefined;
    }
  };
}

function slotKey(prefix: string, slotId: SaveSlotId): string {
  return `${prefix}.slot.${slotId}`;
}

async function readStorageIndex(
  storage: PlatformStorage,
  indexKey: string
): Promise<SaveSlotSummary[]> {
  const value = await storage.getItem(indexKey);
  if (!value) {
    return [];
  }
  return JSON.parse(value) as SaveSlotSummary[];
}

function copyBytes(data: Uint8Array): Uint8Array {
  return new Uint8Array(data);
}
