import { createStandardAppProfile, defineGameApp, type AppProfile } from "@gamekits/app-host";
import type { DriverRegistry, GameDriver } from "@gamekits/driver-core";
import { createThreeDriver } from "@gamekits/driver-three";
import type { PlatformRuntime } from "@gamekits/platform-core";
import { createWebPlatform } from "@gamekits/platform-web";
import type { RendererAdapter, RendererBootContext } from "@gamekits/renderer-core";

import type { ArenaUi } from "./ui";

export const ARENA_THREE_DRIVER_ID = "knockout-arena.three";

export type ArenaAppContext = {
  ui: ArenaUi;
  platform?: PlatformRuntime | undefined;
  drivers?: DriverRegistry | undefined;
  renderer?: RendererAdapter | undefined;
};

export const arenaAppDefinition = defineGameApp({
  id: "multiplayer-physics-arena-demo",
  configSources: [
    {
      id: "knockout-arena.defaults",
      priority: 0,
      values: {
        renderer: { width: 1280, height: 760, debug: true },
        platform: { profile: "web" }
      }
    }
  ],
  services: [
    { id: "platform" },
    { id: "drivers", config: { width: 1280, height: 760, debug: true } },
    { id: "renderer", dependencies: ["drivers"] }
  ]
});

export function createArenaAppProfile(): AppProfile<ArenaAppContext> {
  const platform = createWebPlatform({ appName: "GameKits Knockout Circuit" });
  const driver = createThreeDriver({
    id: ARENA_THREE_DRIVER_ID,
    backgroundColor: "#08131b",
    clearAlpha: 1,
    runtimeOptions: { cameraZ: 860 }
  });
  return createStandardAppProfile({
    id: "web",
    adapters: { platform },
    expose({ context, state }) {
      context.platform = state.platform;
      context.drivers = state.drivers;
      context.renderer = state.renderer;
    },
    services: {
      platform: { adapter: "platform" },
      drivers: {
        drivers: [driver],
        boot({ context, requireConfig }, activeDriver) {
          return createDriverBootContext(context, requireConfig(), activeDriver);
        }
      },
      renderer: { driver: ARENA_THREE_DRIVER_ID }
    }
  });
}

export function measureArenaViewport(element: HTMLElement): { width: number; height: number } {
  const rect = element.getBoundingClientRect();
  return {
    width: Math.max(360, Math.round(rect.width || 1280)),
    height: Math.max(320, Math.round(rect.height || 760))
  };
}

function createDriverBootContext(
  context: ArenaAppContext,
  config: { width?: number; height?: number; debug?: boolean },
  _driver: GameDriver
): RendererBootContext {
  const measured = measureArenaViewport(context.ui.viewport);
  return {
    container: context.ui.viewport,
    width: measured.width || config.width || 1280,
    height: measured.height || config.height || 760,
    ...(config.debug === undefined ? {} : { debug: config.debug })
  };
}
