import type { FsBaseDir, PlatformFileSystem, PlatformPath } from "@gamekits/platform-core";
import { encodeBase64, decodeBase64 } from "./base64";
import { createMissingSlotError, createSaveError } from "./errors";
import { serializeStoreMutation } from "./store-queue";
import type { SaveSlotSummary, SaveStore } from "./types";

export type PlatformFileSaveStoreOptions = {
  fs: PlatformFileSystem;
  path: PlatformPath;
  directory?: string;
  baseDir?: FsBaseDir;
};

type SlotRecord = { format: "gamekits.slot.v1"; data: string; metadata: SaveSlotSummary };

export function createPlatformFileSaveStore(options: PlatformFileSaveStoreOptions): SaveStore {
  const { fs, path } = options;
  const directory = options.directory ?? "saves";
  const fsOptions = { baseDir: options.baseDir ?? ("appData" as FsBaseDir) };
  const slotPath = (id: string, extension: string): string => {
    if (!id || id === "." || id === ".." || /[\\/\0]/u.test(id)) {
      throw createSaveError("save.invalid_slot_id", "Slot id must be a file name", { slotId: id });
    }
    return path.join(directory, `${id}.${extension}`);
  };
  const readRecord = async (id: string): Promise<SlotRecord> => {
    const record = JSON.parse(await fs.readText(slotPath(id, "slot"), fsOptions)) as SlotRecord;
    if (
      record?.format !== "gamekits.slot.v1" ||
      typeof record.data !== "string" ||
      record.metadata?.id !== id
    ) {
      throw createSaveError("save.corrupted", "Invalid slot record", { slotId: id });
    }
    return record;
  };
  const removeIfExists = async (target: string): Promise<void> => {
    if (await fs.exists(target, fsOptions)) await fs.remove!(target, fsOptions);
  };

  return {
    async list() {
      if (!(await fs.exists(directory, fsOptions))) return [];
      const entries = await fs.listDir(directory, fsOptions);
      const summaries = new Map<string, SaveSlotSummary>();
      for (const entry of entries) {
        if (!entry.isFile || !entry.name.endsWith(".json")) continue;
        const id = entry.name.slice(0, -5);
        if (await fs.exists(slotPath(id, "slot"), fsOptions)) continue;
        if (!(await fs.exists(slotPath(id, "save"), fsOptions))) continue;
        const metadata = JSON.parse(
          await fs.readText(slotPath(id, "json"), fsOptions)
        ) as SaveSlotSummary;
        if (metadata?.id === id) summaries.set(id, metadata);
      }
      for (const entry of entries) {
        if (!entry.isFile || !entry.name.endsWith(".slot")) continue;
        const id = entry.name.slice(0, -5);
        summaries.set(id, (await readRecord(id)).metadata);
      }
      return [...summaries.values()];
    },
    async read(id) {
      if (await fs.exists(slotPath(id, "slot"), fsOptions))
        return decodeBase64((await readRecord(id)).data);
      if (!(await fs.exists(slotPath(id, "save"), fsOptions))) throw createMissingSlotError(id);
      return fs.readBinary(slotPath(id, "save"), fsOptions);
    },
    async write(id, data, metadata) {
      const target = slotPath(id, "slot");
      if (!fs.replaceFile || !fs.remove)
        throw createSaveError(
          "save.unsupported_file_commit",
          "File saves require atomic replacement and removal"
        );
      const record: SlotRecord = {
        format: "gamekits.slot.v1",
        data: encodeBase64(data),
        metadata: { ...metadata, id }
      };
      await serializeStoreMutation(fs, async () => {
        await fs.createDir(directory, { ...fsOptions, recursive: true });
        const temporary = `${target}.${crypto.randomUUID()}.tmp`;
        try {
          await fs.writeText(temporary, JSON.stringify(record), fsOptions);
          await fs.replaceFile!(temporary, target, fsOptions);
        } catch (error) {
          // Temporary cleanup is best effort; never obscure the commit failure.
          try {
            await removeIfExists(temporary);
          } catch {
            /* ignored orphan temp file */
          }
          throw error;
        }
      });
    },
    async delete(id) {
      slotPath(id, "slot");
      if (!fs.remove)
        throw createSaveError("save.unsupported_file_commit", "File deletion is unsupported");
      await serializeStoreMutation(fs, async () => {
        if (!(await this.exists(id))) throw createMissingSlotError(id);
        // Remove legacy copies first so deleting the committed record cannot resurrect them.
        await removeIfExists(slotPath(id, "save"));
        await removeIfExists(slotPath(id, "json"));
        await removeIfExists(slotPath(id, "slot"));
      });
    },
    async exists(id) {
      return (
        (await fs.exists(slotPath(id, "slot"), fsOptions)) ||
        fs.exists(slotPath(id, "save"), fsOptions)
      );
    }
  };
}
