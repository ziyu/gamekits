import { describe, expect, it } from "vitest";
import {
  createMemoryFileSystem,
  createMemoryStorage,
  createWebPlatform
} from "@gamekits/platform-web";
import { createPlatformFileSaveStore, createPlatformStorageSaveStore } from "@gamekits/save";

const bytes = new Uint8Array([1, 2, 3]);

describe("platform file save store", () => {
  it.each(["write", "replace"])(
    "preserves committed data and metadata after %s failure",
    async (failure) => {
      const fs = createMemoryFileSystem();
      const path = createWebPlatform({ storage: createMemoryStorage() }).services.path;
      const store = createPlatformFileSaveStore({ fs, path });
      await store.write("a", bytes, { id: "a", label: "old" });
      const broken = createPlatformFileSaveStore({
        path,
        fs: {
          ...fs,
          async writeText(target, data, options) {
            if (failure === "write") {
              await fs.writeText(target, data.slice(0, 1), options);
              throw new Error("disk failure");
            }
            await fs.writeText(target, data, options);
          },
          async replaceFile(source, target, options) {
            if (failure === "replace") throw new Error("disk failure");
            await fs.replaceFile!(source, target, options);
          }
        }
      });
      await expect(
        broken.write("a", new Uint8Array([9]), { id: "a", label: "new" })
      ).rejects.toThrow("disk failure");
      const reopened = createPlatformFileSaveStore({ fs, path });
      expect(await reopened.read("a")).toEqual(bytes);
      expect(await reopened.list()).toEqual([{ id: "a", label: "old" }]);
    }
  );

  it("upgrades legacy slots and deletes all copies across store recreation", async () => {
    const fs = createMemoryFileSystem();
    const path = createWebPlatform({ storage: createMemoryStorage() }).services.path;
    await fs.writeBinary("saves/a.save", bytes);
    await fs.writeText("saves/a.json", JSON.stringify({ id: "a", label: "legacy" }));
    const store = createPlatformFileSaveStore({ fs, path });
    expect(await store.read("a")).toEqual(bytes);
    expect(await store.list()).toEqual([{ id: "a", label: "legacy" }]);
    await store.write("a", new Uint8Array([4]), { id: "a", label: "updated" });
    expect(await store.list()).toEqual([{ id: "a", label: "updated" }]);
    await store.delete("a");
    const reopened = createPlatformFileSaveStore({ fs, path });
    expect(await reopened.exists("a")).toBe(false);
    expect(await reopened.list()).toEqual([]);
    await expect(reopened.read("a")).rejects.toMatchObject({ code: "save.slot_missing" });
  });

  it("rejects unsupported commits and unsafe slot paths before writing", async () => {
    const fs = createMemoryFileSystem();
    const { replaceFile: _replace, ...unsupported } = fs;
    const store = createPlatformFileSaveStore({
      fs: unsupported,
      path: createWebPlatform({ storage: createMemoryStorage() }).services.path
    });
    await expect(store.write("a", bytes, { id: "a" })).rejects.toMatchObject({
      code: "save.unsupported_file_commit"
    });
    await expect(store.write("../a", bytes, { id: "../a" })).rejects.toMatchObject({
      code: "save.invalid_slot_id"
    });
    expect(await fs.exists("saves")).toBe(false);
  });

  it("commits concurrent writes with matching payload and summary", async () => {
    const fs = createMemoryFileSystem();
    const store = createPlatformFileSaveStore({
      fs,
      path: createWebPlatform({ storage: createMemoryStorage() }).services.path
    });
    await Promise.all([
      store.write("a", bytes, { id: "a", label: "first" }),
      store.write("a", new Uint8Array([4]), { id: "a", label: "last" })
    ]);
    expect(await store.read("a")).toEqual(new Uint8Array([4]));
    expect(await store.list()).toEqual([{ id: "a", label: "last" }]);
  });
});

describe("platform storage save store", () => {
  it("serializes mutations across wrappers without losing index entries", async () => {
    const storage = createMemoryStorage();
    const a = createPlatformStorageSaveStore({ storage });
    const b = createPlatformStorageSaveStore({ storage });
    await Promise.all([a.write("a", bytes, { id: "a" }), b.write("b", bytes, { id: "b" })]);
    expect((await a.list()).map((slot) => slot.id).sort()).toEqual(["a", "b"]);
    await Promise.all([a.delete("a"), b.write("a", new Uint8Array([4]), { id: "a" })]);
    expect(await a.read("a")).toEqual(new Uint8Array([4]));
    expect((await a.list()).map((slot) => slot.id).sort()).toEqual(["a", "b"]);
  });

  it("does not poison the mutation queue after a failure", async () => {
    const storage = createMemoryStorage();
    const store = createPlatformStorageSaveStore({ storage });
    await expect(store.delete("missing")).rejects.toThrow();
    await store.write("a", bytes, { id: "a" });
    expect(await store.list()).toEqual([{ id: "a" }]);
  });
});
