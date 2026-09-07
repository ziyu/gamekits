import { createConfiguredAppHost } from "@gamekits/app-host";
import type { AssetDefinition, AssetLoaderAdapter } from "@gamekits/asset";
import { createMemoryPhysicsBackend } from "@gamekits/physics-core";
import { createMemoryPlatform } from "@gamekits/platform-web";
import { createUiRuntime } from "@gamekits/ui-core";
import { describe, expect, it } from "vitest";
import { outpostAppDefinition } from "../app-definition";
import {
  createOutpostDeterministicTestProfile,
  createOutpostHeadlessServerProfile,
  createOutpostTauriSmokeProfile,
  type OutpostDeterministicTestContext,
  type OutpostHeadlessServerContext,
  type OutpostTauriSmokeContext
} from "../profiles";

describe("Outpost non-visual AppProfiles", () => {
  it("boots the shared service graph without loading visual payloads on headless server", async () => {
    const loaded: string[] = [];
    const context: OutpostHeadlessServerContext = { assetDiagnostics: [] };
    const configured = createConfiguredAppHost({
      app: outpostAppDefinition,
      profile: createOutpostHeadlessServerProfile(context, {
        assetAdapter: recordingAssetAdapter(loaded)
      }),
      context,
      clock: () => 10
    });

    await configured.host.boot();
    await configured.host.start();
    configured.host.tick(1000 / 60, 10);

    expect(configured.profile.id).toBe("headless-server");
    expect(context.platform?.id).toBe("headless");
    expect(loaded).toEqual([]);
    expect(context.preview?.snapshot()).toMatchObject({
      running: true,
      entityCount: 34,
      physics: { bound: true }
    });

    const world = context.preview?.runtime.world;
    await configured.host.dispose();
    expect(world?.count()).toBe(0);
  });

  it("replays the same fixed input schedule with stable deterministic snapshots", async () => {
    const first = await runDeterministicProfile();
    const second = await runDeterministicProfile();

    expect(first.loadedAssets).toBeGreaterThan(0);
    expect(first.snapshot).toEqual(second.snapshot);
    expect(first.retainedEntities).toBe(0);
    expect(second.retainedEntities).toBe(0);
  });
});

describe("Outpost Tauri smoke AppProfile", () => {
  it("selects the Tauri platform while reusing the visual composition path", async () => {
    const context: OutpostTauriSmokeContext = {
      ui: { rendererRoot: {} as HTMLElement },
      uiRuntime: createUiRuntime(),
      physicsBackend: createMemoryPhysicsBackend(),
      inputBlocked: false,
      assetDiagnostics: []
    };
    const platform = createMemoryPlatform({ id: "tauri", appName: "Outpost Tauri Smoke" });

    const profile = await createOutpostTauriSmokeProfile(context, { platform });

    expect(profile.id).toBe("tauri-smoke");
    expect(profile.adapters?.platform).toBe(platform);
    expect(profile.standard?.renderer).toMatchObject({ driver: "outpost.phaser" });
    expect(profile.standard?.assets?.preloadGroups?.({} as never)).toEqual([
      "boot",
      "match",
      "combat"
    ]);
  });
});

async function runDeterministicProfile(): Promise<{
  loadedAssets: number;
  retainedEntities: number;
  snapshot: unknown;
}> {
  const loaded: string[] = [];
  const context: OutpostDeterministicTestContext = { assetDiagnostics: [] };
  const configured = createConfiguredAppHost({
    app: outpostAppDefinition,
    profile: createOutpostDeterministicTestProfile(context, {
      assetAdapter: recordingAssetAdapter(loaded)
    }),
    context,
    clock: () => 0
  });

  await configured.host.boot();
  await configured.host.start();
  for (let tick = 0; tick < 30; tick += 1) {
    if (context.preview) {
      context.preview.input.moveX = tick < 15 ? 1 : -1;
      context.preview.input.moveY = tick % 4 < 2 ? 1 : 0;
    }
    configured.host.tick(1000 / 60, tick * (1000 / 60));
  }

  const snapshot = context.preview?.snapshot();
  const world = context.preview?.runtime.world;
  await configured.host.dispose();
  return {
    loadedAssets: loaded.length,
    retainedEntities: world?.count() ?? -1,
    snapshot
  };
}

function recordingAssetAdapter(loaded: string[]): AssetLoaderAdapter {
  return {
    id: "outpost.recording-assets",
    supports() {
      return true;
    },
    async load(asset: AssetDefinition) {
      loaded.push(asset.id);
      return undefined;
    }
  };
}
