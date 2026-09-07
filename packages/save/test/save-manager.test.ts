import { describe, expect, it } from "vitest";
import {
  createJsonSaveCodec,
  createMemorySaveStore,
  createPlatformStorageSaveStore,
  createSaveManager,
  createSaveMigrationRegistry,
  type SaveContributor,
  type SaveEnvelope
} from "@gamekits/save";

function runtime(ticks = 1) {
  return {
    seed: "test-seed",
    clock: {
      ticks,
      elapsed: ticks * 16
    }
  };
}

describe("save manager", () => {
  it("captures contributors, stores a slot, and restores in contributor order", async () => {
    const calls: string[] = [];
    const store = createMemorySaveStore();
    const manager = createSaveManager({
      appId: "app",
      gameId: "game",
      gameVersion: "0.1.0",
      formatVersion: "1.0.0",
      store,
      clock: () => 100
    });

    manager.registerContributor(createContributor("b", calls, 20));
    manager.registerContributor(createContributor("a", calls, 10));

    const saved = await manager.save("slot-1", {
      runtime: runtime(),
      metadata: { label: "First Slot" }
    });
    const loaded = await manager.load("slot-1");

    expect(saved.slotId).toBe("slot-1");
    expect(await store.exists("slot-1")).toBe(true);
    expect((await manager.list())[0]).toMatchObject({ id: "slot-1", label: "First Slot" });
    expect(loaded.restored).toBe(true);
    expect(calls).toEqual(["a.capture", "b.capture", "a.restore", "b.restore"]);
  });

  it("inspects save metadata without returning payload data", async () => {
    const manager = createSaveManager({
      appId: "app",
      gameId: "game",
      gameVersion: "0.1.0",
      formatVersion: "1.0.0",
      store: createMemorySaveStore()
    });
    manager.registerContributor({
      id: "game.inventory",
      version: "1.0.0",
      capture() {
        return { id: "game.inventory", version: "1.0.0", data: { coins: 10 } };
      }
    });

    await manager.save("slot-1", { runtime: runtime() });
    const inspection = await manager.inspect("slot-1");

    expect(inspection.envelope).not.toHaveProperty("payload");
    expect(inspection.sections).toEqual([{ id: "game.inventory", version: "1.0.0" }]);
  });

  it("selects contributors by id, tag, and scope", async () => {
    const calls: string[] = [];
    const manager = createSaveManager({
      appId: "app",
      gameId: "game",
      gameVersion: "0.1.0",
      formatVersion: "1.0.0",
      store: createMemorySaveStore(),
      contributorPolicy: {
        excludeScopes: ["presentation"]
      }
    });

    manager.registerContributor({
      ...createContributor("world.position", calls, 10),
      scope: "world",
      tags: ["gameplay"]
    });
    manager.registerContributor({
      ...createContributor("ui.overlay", calls, 20),
      scope: "presentation",
      tags: ["ui"]
    });
    manager.registerContributor({
      ...createContributor("gas.actors", calls, 30),
      scope: "gameplay",
      tags: ["gas"]
    });

    const saved = await manager.save("slot-filtered", {
      runtime: runtime(),
      contributors: {
        includeTags: ["gameplay", "gas"],
        excludeIds: ["gas.actors"]
      }
    });

    expect(Object.keys(saved.envelope.payload.sections)).toEqual(["world.position"]);
    expect(calls).toEqual(["world.position.capture"]);
  });

  it("migrates old envelopes before restore", async () => {
    const calls: string[] = [];
    const store = createMemorySaveStore();
    const codec = createJsonSaveCodec();
    const migrationRegistry = createSaveMigrationRegistry([
      {
        id: "save-0-to-1",
        from: "0.9.0",
        to: "1.0.0",
        migrate(envelope) {
          return {
            ...envelope,
            formatVersion: "1.0.0",
            payload: {
              ...envelope.payload,
              sections: {
                ...envelope.payload.sections,
                migrated: { id: "migrated", version: "1.0.0", data: true }
              }
            }
          };
        }
      }
    ]);
    const oldEnvelope: SaveEnvelope = {
      format: "gamekits.save",
      formatVersion: "0.9.0",
      appId: "app",
      gameId: "game",
      gameVersion: "0.1.0",
      createdAt: 1,
      updatedAt: 1,
      slot: { id: "old-slot" },
      compatibility: {},
      payload: {
        runtime: runtime(),
        sections: {
          migrated: { id: "migrated", version: "1.0.0", data: false }
        }
      }
    };
    await store.write("old-slot", await codec.encode(oldEnvelope), {
      id: "old-slot",
      formatVersion: "0.9.0"
    });

    const manager = createSaveManager({
      appId: "app",
      gameId: "game",
      gameVersion: "0.1.0",
      formatVersion: "1.0.0",
      store,
      codec,
      migrations: migrationRegistry
    });
    manager.registerContributor({
      id: "migrated",
      version: "1.0.0",
      restore(_ctx, section) {
        calls.push(String(section.data));
      },
      capture() {
        return undefined;
      }
    });

    const result = await manager.load("old-slot");

    expect(result.migrated).toBe(true);
    expect(result.envelope.formatVersion).toBe("1.0.0");
    expect(calls).toEqual(["true"]);
  });

  it("throws clear errors for corrupted saves and missing migration paths", async () => {
    const store = createMemorySaveStore();
    await store.write("broken", new TextEncoder().encode("{"), { id: "broken" });
    const manager = createSaveManager({
      appId: "app",
      gameId: "game",
      gameVersion: "0.1.0",
      formatVersion: "1.0.0",
      store
    });

    await expect(manager.load("broken")).rejects.toMatchObject({ code: "save.decode_failed" });

    const codec = createJsonSaveCodec();
    await store.write(
      "old",
      await codec.encode({
        format: "gamekits.save",
        formatVersion: "0.1.0",
        appId: "app",
        gameId: "game",
        gameVersion: "0.1.0",
        createdAt: 1,
        updatedAt: 1,
        slot: { id: "old" },
        compatibility: {},
        payload: { runtime: runtime(), sections: {} }
      }),
      { id: "old", formatVersion: "0.1.0" }
    );
    await expect(manager.load("old")).rejects.toMatchObject({ code: "save.migration_missing" });
  });

  it("rejects saves from another app and section versions", async () => {
    const store = createMemorySaveStore();
    const source = createSaveManager({
      appId: "source",
      gameId: "game",
      gameVersion: "1",
      formatVersion: "1",
      store
    });
    source.registerContributor({
      id: "state",
      version: "9",
      capture: () => ({ id: "state", version: "9", data: true })
    });
    await source.save("slot", { runtime: runtime() });
    const target = createSaveManager({
      appId: "target",
      gameId: "game",
      gameVersion: "1",
      formatVersion: "1",
      store
    });
    target.registerContributor({ id: "state", version: "1", capture: () => undefined });
    await expect(target.load("slot")).rejects.toMatchObject({ code: "save.incompatible_app" });
  });

  it("stores slots through platform storage without exposing platform details", async () => {
    const values = new Map<string, string>();
    const store = createPlatformStorageSaveStore({
      storage: {
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
      }
    });
    const manager = createSaveManager({
      appId: "app",
      gameId: "game",
      gameVersion: "0.1.0",
      formatVersion: "1.0.0",
      store
    });

    await manager.save("slot-1", { runtime: runtime(5) });
    expect(await store.exists("slot-1")).toBe(true);
    expect(await manager.list()).toHaveLength(1);

    await manager.delete("slot-1");
    expect(await store.exists("slot-1")).toBe(false);
  });
});

function createContributor(id: string, calls: string[], order: number): SaveContributor {
  return {
    id,
    version: "1.0.0",
    order,
    capture() {
      calls.push(`${id}.capture`);
      return { id, version: "1.0.0", data: { id } };
    },
    restore() {
      calls.push(`${id}.restore`);
    }
  };
}

describe("save load preflight", () => {
  it.each(["invalid", "missing", "version"])(
    "checks every selected section before restore: %s",
    async (failure) => {
      const calls: string[] = [];
      const store = createMemorySaveStore();
      const manager = createSaveManager({
        appId: "app",
        gameId: "game",
        gameVersion: "1",
        formatVersion: "1",
        store
      });
      manager.registerContributor(createContributor("a", calls, 0));
      manager.registerContributor(createContributor("b", calls, 1));
      await manager.save("slot", { runtime: runtime() });
      const id = failure === "missing" ? "c" : "b";
      manager.unregisterContributor(id);
      manager.registerContributor({
        ...createContributor(id, calls, 1),
        required: true,
        version: failure === "version" ? "2" : "1.0.0",
        validate: () => ({
          issues:
            failure === "invalid"
              ? [{ code: "test.invalid", message: "Invalid state", severity: "error" }]
              : []
        })
      });
      calls.length = 0;
      await expect(manager.load("slot")).rejects.toThrow();
      expect(calls).toEqual([]);
      await manager.load("slot", { contributors: { excludeIds: [id] } });
      expect(calls).toContain("a.restore");
    }
  );

  it("rejects malformed payloads and migrations that do not reach their declared version", async () => {
    const store = createMemorySaveStore();
    const manager = createSaveManager({
      appId: "app",
      gameId: "game",
      gameVersion: "1",
      formatVersion: "1",
      store
    });
    const { envelope } = await manager.save("slot", { runtime: runtime() });
    const malformed = { ...envelope, checksum: undefined, payload: { runtime: runtime() } };
    const codec = createJsonSaveCodec();
    expect(() => codec.decode(new TextEncoder().encode(JSON.stringify(malformed)))).toThrow(
      /sections/
    );
    const migrations = createSaveMigrationRegistry([
      { id: "broken", from: "1", to: "2", migrate: (value) => value }
    ]);
    await expect(migrations.migrate(envelope, "2")).rejects.toMatchObject({
      code: "save.migration_failed"
    });
  });

  it("migrates section versions before preflight", async () => {
    const store = createMemorySaveStore();
    const calls: string[] = [];
    const source = createSaveManager({
      appId: "app",
      gameId: "game",
      gameVersion: "1",
      formatVersion: "1",
      store
    });
    source.registerContributor(createContributor("a", calls, 0));
    await source.save("slot", { runtime: runtime() });
    const target = createSaveManager({
      appId: "app",
      gameId: "game",
      gameVersion: "2",
      formatVersion: "2",
      store,
      migrations: createSaveMigrationRegistry([
        {
          id: "upgrade",
          from: "1",
          to: "2",
          migrate: (value) => ({
            ...value,
            formatVersion: "2",
            payload: { ...value.payload, sections: { a: { id: "a", version: "2", data: {} } } }
          })
        }
      ])
    });
    target.registerContributor({ ...createContributor("a", calls, 0), version: "2" });
    await target.load("slot");
    expect(calls).toEqual(["a.capture", "a.restore"]);
  });
});
