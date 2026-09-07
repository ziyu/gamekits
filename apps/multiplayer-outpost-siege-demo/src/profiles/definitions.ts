import {
  loadAssetGroupWithRetry,
  type AssetGroupLoadResult,
  type AssetManager
} from "@gamekits/asset";
import type { OutpostAssetGroup } from "../domain";

export type OutpostProfileId =
  | "browser-web"
  | "headless-server"
  | "deterministic-test"
  | "tauri-smoke";

export type OutpostProfileDefinition = {
  id: OutpostProfileId;
  runtime: "browser" | "server" | "test" | "desktop";
  platform: "web" | "headless" | "memory" | "tauri";
  driver: "phaser" | "memory" | "none";
  loadsVisualAssets: boolean;
  preloadGroups: OutpostAssetGroup[];
  lazyGroups: OutpostAssetGroup[];
  deterministic: boolean;
};

export const OUTPOST_PROFILE_DEFINITIONS: Readonly<
  Record<OutpostProfileId, OutpostProfileDefinition>
> = {
  "browser-web": {
    id: "browser-web",
    runtime: "browser",
    platform: "web",
    driver: "phaser",
    loadsVisualAssets: true,
    preloadGroups: ["boot", "match", "combat"],
    lazyGroups: ["boss"],
    deterministic: false
  },
  "headless-server": {
    id: "headless-server",
    runtime: "server",
    platform: "headless",
    driver: "none",
    loadsVisualAssets: false,
    preloadGroups: [],
    lazyGroups: [],
    deterministic: false
  },
  "deterministic-test": {
    id: "deterministic-test",
    runtime: "test",
    platform: "memory",
    driver: "memory",
    loadsVisualAssets: true,
    preloadGroups: ["boot", "match", "combat", "boss"],
    lazyGroups: [],
    deterministic: true
  },
  "tauri-smoke": {
    id: "tauri-smoke",
    runtime: "desktop",
    platform: "tauri",
    driver: "phaser",
    loadsVisualAssets: true,
    preloadGroups: ["boot", "match", "combat"],
    lazyGroups: ["boss"],
    deterministic: false
  }
};

export function outpostProfileDefinition(id: OutpostProfileId): OutpostProfileDefinition {
  const definition = OUTPOST_PROFILE_DEFINITIONS[id];
  return {
    ...definition,
    preloadGroups: [...definition.preloadGroups],
    lazyGroups: [...definition.lazyGroups]
  };
}

export async function loadOutpostInitialAssetGroups(
  manager: AssetManager,
  profile: OutpostProfileDefinition,
  maxAttempts = 2
): Promise<AssetGroupLoadResult[]> {
  if (!profile.loadsVisualAssets) {
    return [];
  }
  const results: AssetGroupLoadResult[] = [];
  for (const group of profile.preloadGroups) {
    results.push(await loadAssetGroupWithRetry(manager, group, { maxAttempts }));
  }
  return results;
}

export function loadOutpostLazyAssetGroup(
  manager: AssetManager,
  profile: OutpostProfileDefinition,
  group: OutpostAssetGroup,
  maxAttempts = 2
): Promise<AssetGroupLoadResult> {
  if (!profile.lazyGroups.includes(group)) {
    throw new Error(`Asset group ${group} is not lazy for Outpost profile ${profile.id}`);
  }
  return loadAssetGroupWithRetry(manager, group, { maxAttempts });
}
