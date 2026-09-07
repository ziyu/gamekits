import { PlatformStorageServiceKey, type PlatformRuntime } from "@gamekits/platform-core";
import { describe, expect, it } from "vitest";

export function definePlatformConformanceTests(
  name: string,
  createPlatform: () => PlatformRuntime | Promise<PlatformRuntime>
): void {
  describe(`${name} PlatformRuntime conformance`, () => {
    it("reads and writes text and binary files through semantic base directories", async () => {
      const platform = await createPlatform();

      await platform.services.fs.createDir("saves", { baseDir: "appData", recursive: true });
      await platform.services.fs.writeText("saves/slot-1.json", '{"ok":true}', {
        baseDir: "appData"
      });
      await platform.services.fs.writeBinary("cache.bin", new Uint8Array([1, 2, 3]), {
        baseDir: "appCache"
      });

      await expect(
        platform.services.fs.exists("saves/slot-1.json", { baseDir: "appData" })
      ).resolves.toBe(true);
      await expect(
        platform.services.fs.readText("saves/slot-1.json", { baseDir: "appData" })
      ).resolves.toBe('{"ok":true}');
      await expect(
        platform.services.fs.readBinary("cache.bin", { baseDir: "appCache" })
      ).resolves.toEqual(new Uint8Array([1, 2, 3]));
    });

    it("atomically replaces files and durably removes them when supported", async () => {
      const {
        services: { fs }
      } = await createPlatform();
      if (!fs.replaceFile || !fs.remove) return;
      const options = { baseDir: "appData" as const };
      await fs.createDir("saves", { ...options, recursive: true });
      await fs.writeText("saves/slot", "old", options);
      await fs.writeText("saves/temp", "new", options);
      await fs.replaceFile("saves/temp", "saves/slot", options);
      expect(await fs.readText("saves/slot", options)).toBe("new");
      expect(await fs.exists("saves/temp", options)).toBe(false);
      await expect(fs.replaceFile("saves/missing", "saves/slot", options)).rejects.toThrow();
      expect(await fs.readText("saves/slot", options)).toBe("new");
      await fs.remove("saves/slot", options);
      expect(await fs.exists("saves/slot", options)).toBe(false);
    });

    it("lists directory entries", async () => {
      const platform = await createPlatform();

      await platform.services.fs.createDir("mods", { baseDir: "appData", recursive: true });
      await platform.services.fs.writeText("mods/demo.json", "{}", { baseDir: "appData" });

      const entries = await platform.services.fs.listDir("mods", { baseDir: "appData" });

      expect(entries.map((entry) => entry.name)).toContain("demo.json");
    });

    it("supports platform storage", async () => {
      const platform = await createPlatform();

      await platform.services.storage.setItem("settings/theme", "dark");
      await expect(platform.services.storage.getItem("settings/theme")).resolves.toBe("dark");
      await platform.services.storage.removeItem("settings/theme");
      await expect(platform.services.storage.getItem("settings/theme")).resolves.toBeUndefined();
    });

    it("exposes app metadata and permission query", async () => {
      const platform = await createPlatform();

      await expect(platform.services.app.name()).resolves.toEqual(expect.any(String));
      await expect(platform.services.permissions.query("storage")).resolves.toMatch(
        /granted|denied|prompt|unsupported/
      );
    });

    it("supports capability descriptors and extension services", async () => {
      const platform = await createPlatform();
      const serviceKey = { id: "test.platform_service" };
      const service = { ok: true };

      expect("storage" in platform).toBe(false);
      expect("fs" in platform).toBe(false);
      platform.capabilities.register({
        id: "test.capability",
        service: serviceKey.id,
        description: "Test extension capability"
      });
      platform.services.register(serviceKey, service);

      expect(platform.capabilities.describe("test.capability")).toMatchObject({
        id: "test.capability",
        service: serviceKey.id
      });
      await expect(platform.capabilities.query("storage")).resolves.toMatchObject({
        id: "storage"
      });
      expect(platform.services.require(PlatformStorageServiceKey)).toBe(platform.services.storage);
      expect(platform.services.has(serviceKey)).toBe(true);
      expect(platform.services.require(serviceKey)).toBe(service);
      expect(platform.services.list()).toContain(serviceKey.id);
    });
  });
}
