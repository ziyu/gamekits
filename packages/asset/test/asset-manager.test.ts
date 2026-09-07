import { describe, expect, it } from "vitest";
import { createDataRegistry } from "@gamekits/data";
import {
  createAssetDataType,
  createAssetManager,
  loadAssetGroupWithRetry,
  resolveAssetVariant,
  type AssetDefinition
} from "../src";

describe("createAssetManager", () => {
  it("registers assets and loads a single asset", async () => {
    const loaded: string[] = [];
    const manager = createAssetManager({
      adapter: {
        id: "test",
        supports: () => true,
        async load(asset) {
          loaded.push(asset.id);
        }
      },
      clock: () => 10
    });

    manager.register(asset("asset.hero"));
    const state = await manager.load("asset.hero");

    expect(loaded).toEqual(["asset.hero"]);
    expect(state).toEqual({ id: "asset.hero", status: "loaded", loadedAt: 10 });
    expect(manager.state("asset.hero").status).toBe("loaded");
  });

  it("registers asset definitions from DataRegistry", () => {
    const registry = createDataRegistry();
    registry.registerType(createAssetDataType({ supportedTypes: ["image"] }));
    registry.registerPack({
      id: "sandbox",
      version: "1.0.0",
      entries: [{ type: "asset.definition", id: "asset.hero", data: asset("asset.hero") }]
    });
    const manager = createAssetManager({
      adapter: {
        id: "test",
        supports: () => true,
        async load() {}
      }
    });

    expect(manager.registerFromDataRegistry(registry).map((definition) => definition.id)).toEqual([
      "asset.hero"
    ]);
    expect(manager.has("asset.hero")).toBe(true);
  });

  it("loads a group of assets", async () => {
    const loaded: string[] = [];
    const manager = createAssetManager({
      adapter: {
        id: "test",
        supports: () => true,
        async load(nextAsset) {
          loaded.push(nextAsset.id);
        }
      }
    });
    manager.registerMany([
      asset("asset.hero", { group: "preload" }),
      asset("asset.enemy", { group: "preload" }),
      asset("asset.lazy", { group: "lazy" })
    ]);

    await manager.loadGroup("preload");

    expect(loaded).toEqual(["asset.hero", "asset.enemy"]);
  });

  it("coalesces concurrent loads and protects registered definitions from mutation", async () => {
    let resolveLoad: (() => void) | undefined;
    let loads = 0;
    const manager = createAssetManager({
      adapter: {
        id: "test",
        supports: () => true,
        async load(nextAsset) {
          loads += 1;
          nextAsset.metadata = { mutatedByAdapter: true };
          await new Promise<void>((resolve) => {
            resolveLoad = resolve;
          });
        }
      }
    });
    const definition = asset("asset.concurrent", {
      tags: ["registered"],
      metadata: { nested: { quality: "base" } }
    });
    manager.register(definition);
    definition.tags?.push("external-mutation");
    const first = manager.load(definition.id);
    const second = manager.load(definition.id);
    await expect.poll(() => loads).toBe(1);
    resolveLoad?.();
    await expect(Promise.all([first, second])).resolves.toEqual([
      expect.objectContaining({ status: "loaded" }),
      expect.objectContaining({ status: "loaded" })
    ]);

    const read = manager.get(definition.id);
    read.tags?.push("read-mutation");
    expect(manager.get(definition.id)).toMatchObject({
      tags: ["registered"],
      metadata: { nested: { quality: "base" } }
    });
  });

  it("isolates diagnostic observer failures from registration and loading", async () => {
    let diagnosticErrors = 0;
    const manager = createAssetManager({
      adapter: { id: "test", supports: () => true, async load() {} },
      onDiagnostic(event) {
        event.payload.assetId = "mutated";
        throw new Error("observer failed");
      },
      onDiagnosticError() {
        diagnosticErrors += 1;
        throw new Error("error observer failed");
      }
    });
    manager.register(asset("asset.diagnostic"));
    await expect(manager.load("asset.diagnostic")).resolves.toMatchObject({ status: "loaded" });
    expect(diagnosticErrors).toBe(3);
  });

  it("throws for duplicate, missing, and unsupported assets", async () => {
    const manager = createAssetManager({
      adapter: {
        id: "test",
        supports: () => false,
        async load() {}
      }
    });

    manager.register(asset("asset.hero"));

    expect(() => manager.register(asset("asset.hero"))).toThrow(/Duplicate asset/);
    expect(() => manager.get("asset.missing")).toThrow(/Missing asset/);
    await expect(manager.load("asset.hero")).rejects.toThrow(/does not support asset/);
  });

  it("records failed load state", async () => {
    const manager = createAssetManager({
      adapter: {
        id: "test",
        supports: () => true,
        async load() {
          throw new Error("boom");
        }
      }
    });

    manager.register(asset("asset.hero"));
    const state = await manager.load("asset.hero");

    expect(state).toMatchObject({
      id: "asset.hero",
      status: "failed",
      error: "boom"
    });
  });

  it("coalesces concurrent loads for one asset", async () => {
    let calls = 0;
    const manager = createAssetManager({
      adapter: {
        id: "test",
        supports: () => true,
        async load() {
          calls += 1;
          await Promise.resolve();
        }
      }
    });
    manager.register(asset("asset.hero"));
    await Promise.all([manager.load("asset.hero"), manager.load("asset.hero")]);
    expect(calls).toBe(1);
  });

  it("retries failed group members without reloading successful assets", async () => {
    const attempts = new Map<string, number>();
    const observedAttempts: number[] = [];
    const manager = createAssetManager({
      adapter: {
        id: "test",
        supports: () => true,
        async load(nextAsset) {
          const attempt = (attempts.get(nextAsset.id) ?? 0) + 1;
          attempts.set(nextAsset.id, attempt);
          if (nextAsset.id === "asset.flaky" && attempt < 2) {
            throw new Error("transient");
          }
        }
      }
    });
    manager.registerMany([
      asset("asset.stable", { group: "match" }),
      asset("asset.flaky", { group: "match" })
    ]);

    const result = await loadAssetGroupWithRetry(manager, "match", {
      maxAttempts: 3,
      onAttempt(attempt) {
        observedAttempts.push(attempt.attempt);
      }
    });

    expect(result).toMatchObject({ group: "match", attempt: 2, succeeded: true });
    expect(result.states.every((state) => state.status === "loaded")).toBe(true);
    expect(attempts).toEqual(
      new Map([
        ["asset.stable", 1],
        ["asset.flaky", 2]
      ])
    );
    expect(observedAttempts).toEqual([1, 2]);
  });

  it("reports a missing group without retrying an empty plan", async () => {
    const diagnostics: string[] = [];
    const manager = createAssetManager({
      adapter: {
        id: "test",
        supports: () => true,
        async load() {}
      },
      onDiagnostic(event) {
        diagnostics.push(event.type);
      }
    });

    const result = await loadAssetGroupWithRetry(manager, "missing", { maxAttempts: 3 });

    expect(result).toEqual({
      group: "missing",
      attempt: 1,
      states: [],
      succeeded: false
    });
    expect(diagnostics).toEqual(["asset.group_missing"]);
  });

  it("isolates retry progress observer failures from loading", async () => {
    const manager = createAssetManager({
      adapter: {
        id: "test",
        supports: () => true,
        async load() {}
      }
    });
    manager.register(asset("asset.safe", { group: "safe" }));

    const result = await loadAssetGroupWithRetry(manager, "safe", {
      onAttempt() {
        throw new Error("observer failed");
      },
      onAttemptError() {
        throw new Error("error observer failed");
      }
    });

    expect(result.succeeded).toBe(true);
    expect(manager.state("asset.safe").status).toBe("loaded");
  });
});

describe("asset metadata", () => {
  it("validates atlas, audio variants, and animation manifests", () => {
    const registry = createDataRegistry();
    registry.registerType(createAssetDataType());
    const validation = registry.validatePack({
      id: "asset.metadata.invalid",
      version: "1.0.0",
      entries: [
        {
          type: "asset.definition",
          id: "atlas.invalid",
          data: {
            id: "atlas.invalid",
            type: "atlas",
            source: { type: "url", url: "" }
          }
        },
        {
          type: "asset.definition",
          id: "missing-source",
          data: {
            id: "missing-source",
            type: "image"
          } as never
        },
        {
          type: "asset.definition",
          id: "audio.invalid",
          data: {
            id: "audio.invalid",
            type: "audio",
            source: { type: "url", url: "/audio.ogg" },
            audio: {
              sources: [
                { type: "url", url: "/audio.ogg" },
                { type: "url", url: "/audio.ogg" }
              ],
              instances: 0
            },
            animations: [{ id: "broken", frames: [] }]
          }
        }
      ]
    });

    expect(validation.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "asset.invalid_source" }),
        expect.objectContaining({ code: "asset.unsupported_source" }),
        expect.objectContaining({ code: "asset.missing_atlas_metadata" }),
        expect.objectContaining({ code: "asset.duplicate_audio_source" }),
        expect.objectContaining({ code: "asset.invalid_audio_instances" }),
        expect.objectContaining({ code: "asset.invalid_animation_manifest" })
      ])
    );
  });

  it("resolves an explicit variant without mutating the base definition", () => {
    const base = asset("asset.variant", {
      metadata: { quality: "base" },
      variants: {
        retina: {
          source: { type: "url", url: "/assets/retina.png" },
          metadata: { quality: "retina" }
        }
      }
    });

    expect(resolveAssetVariant(base, "retina")).toMatchObject({
      source: { type: "url", url: "/assets/retina.png" },
      metadata: { quality: "retina" }
    });
    expect(base.source).toEqual({ type: "url", url: "/assets/asset.variant.png" });
    expect(resolveAssetVariant(base, "missing")).toBe(base);
  });
});

function asset(id: string, patch: Partial<AssetDefinition> = {}): AssetDefinition {
  return {
    id,
    type: "image",
    source: {
      type: "url",
      url: `/assets/${id}.png`
    },
    ...patch
  };
}

it("retries a synchronous loader failure and coalesces a diagnostic reentry", async () => {
  let calls = 0;
  let reentered: Promise<unknown> | undefined;
  const manager = createAssetManager({
    adapter: {
      id: "test",
      supports: () => true,
      load() {
        calls += 1;
        if (calls === 1) throw new Error("sync failure");
        return Promise.resolve();
      }
    },
    onDiagnostic(event) {
      if (event.type === "asset.loading") reentered = manager.load("asset.hero");
    }
  });
  manager.register(asset("asset.hero"));
  expect((await manager.load("asset.hero")).status).toBe("failed");
  await reentered;
  expect(calls).toBe(1);
  expect((await manager.load("asset.hero")).status).toBe("loaded");
  await reentered;
  expect(calls).toBe(2);
});
