import type { AppProfile } from "@gamekits/app-host";
import type {
  MultiplayerClientReplicationSnapshotSource,
  MultiplayerRuntime
} from "@gamekits/multiplayer-core";
import { createWebPlatform } from "@gamekits/platform-web";
import {
  createOutpostVisualProfile,
  type OutpostVisualContext,
  type OutpostVisualUiHandles
} from "./visual";

export type OutpostBrowserUiHandles = OutpostVisualUiHandles;
export type OutpostBrowserContext = OutpostVisualContext;

export type CreateOutpostBrowserProfileOptions = {
  multiplayer: MultiplayerRuntime;
  snapshotSource: MultiplayerClientReplicationSnapshotSource;
  localPlayerId: string;
};

export function createOutpostBrowserProfile(
  context: OutpostBrowserContext,
  options: CreateOutpostBrowserProfileOptions
): AppProfile<OutpostBrowserContext> {
  return createOutpostVisualProfile(context, {
    profileId: "browser-web",
    platform: createWebPlatform({ appName: "Outpost Siege" }),
    multiplayer: options.multiplayer,
    client: {
      localPlayerId: options.localPlayerId,
      snapshotSource: options.snapshotSource
    },
    savePrefix: "outpost-siege.browser.save"
  });
}

export { resolveOutpostKeyboardScope } from "./visual";
