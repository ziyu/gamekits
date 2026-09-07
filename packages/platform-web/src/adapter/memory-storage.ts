import type { PlatformStorage } from "@gamekits/platform-core";
import type { StorageLike } from "./types";

export function createMemoryStorage(initialValues: Record<string, string> = {}): PlatformStorage {
  const values = new Map(Object.entries(initialValues));

  return {
    async getItem(key) {
      return values.get(key);
    },
    async setItem(key, value) {
      values.set(key, value);
    },
    async removeItem(key) {
      values.delete(key);
    },
    async clear() {
      values.clear();
    }
  };
}

export function adaptStorageLike(storage: StorageLike): PlatformStorage {
  return {
    async getItem(key) {
      return storage.getItem(key) ?? undefined;
    },
    async setItem(key, value) {
      storage.setItem(key, value);
    },
    async removeItem(key) {
      storage.removeItem(key);
    },
    async clear() {
      storage.clear();
    }
  };
}
