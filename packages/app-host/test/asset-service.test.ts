import { expect, it } from "vitest";
import { createAssetManager } from "@gamekits/asset";
import type { GameDriver } from "@gamekits/driver-core";
import { createConfiguredAppHost, createStandardAppProfile, defineGameApp } from "../src";

it("retains required preload assets under a resident budget until the host disposes", async () => {
  const native = new Set<string>();
  const manager = createAssetManager({
    maxResidentAssets: 1,
    adapter: {
      id: "test",
      supports: () => true,
      load: async (asset) => {
        native.add(asset.id);
      },
      unload: (asset) => {
        native.delete(asset.id);
      }
    }
  });
  manager.registerMany(
    ["a", "b"].map((id) => ({ id, type: "image", group: id, source: { type: "url", url: id } }))
  );
  const { host } = createConfiguredAppHost({
    app: defineGameApp({ id: "app", services: [{ id: "assets" }] }),
    profile: createStandardAppProfile({
      id: "test",
      services: { assets: { manager, preloadGroups: () => ["a"], dispose: false } }
    }),
    context: {}
  });
  await host.boot();
  expect(await manager.load("b")).toMatchObject({ status: "failed" });
  expect([...native]).toEqual(["a"]);
  await host.dispose();
  expect(native.size).toBe(0);
  expect((await manager.load("b")).status).toBe("loaded");
  await manager.dispose();
});

it("releases native assets before destroying their auto-resolved driver", async () => {
  const calls: string[] = [];
  const driver: GameDriver = {
    id: "native",
    kind: "test",
    boot: () => {},
    dispose() {
      calls.push("driver.dispose");
    },
    capabilities: () => ({ assets: true }),
    adapters: () => ({
      assetLoader: {
        id: "native.assets",
        supports: () => true,
        load: async () => {},
        unload: async () => {
          calls.push("asset.unload");
        }
      }
    }),
    snapshot: () => ({
      id: "native",
      kind: "test",
      phase: "booted",
      capabilities: { assets: true },
      adapters: ["assetLoader"]
    })
  };
  const { host } = createConfiguredAppHost({
    app: defineGameApp({ id: "app", services: [{ id: "drivers" }, { id: "assets" }] }),
    profile: createStandardAppProfile({
      id: "test",
      services: {
        drivers: { drivers: [driver], boot: () => ({ width: 1, height: 1 }) },
        assets: {}
      }
    }),
    context: {}
  });
  host.services.assets!.register({ id: "a", type: "image", source: { type: "url", url: "a" } });
  await host.boot();
  await host.services.assets!.load("a");
  await host.dispose();
  expect(calls).toEqual(["asset.unload", "driver.dispose"]);
});
