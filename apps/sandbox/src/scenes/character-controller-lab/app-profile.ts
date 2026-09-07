import { createStandardAppProfile, type AppProfile } from "@gamekits/app-host";
import type { DriverRegistry, GameDriver } from "@gamekits/driver-core";
import { createThreeDriver } from "@gamekits/driver-three";
import type { PlatformRuntime } from "@gamekits/platform-core";
import { createWebPlatform } from "@gamekits/platform-web";
import type { RendererAdapter, RendererBootContext } from "@gamekits/renderer-core";
import {
  CHARACTER_CONTROLLER_LAB_DRIVER_ID,
  CHARACTER_CONTROLLER_LAB_RENDER_SIZE
} from "./app-definition";

export type CharacterControllerLabAppContext = {
  viewport: HTMLElement;
  platform?: PlatformRuntime | undefined;
  drivers?: DriverRegistry | undefined;
  renderer?: RendererAdapter | undefined;
};

export function createCharacterControllerLabWebProfile(): AppProfile<CharacterControllerLabAppContext> {
  const platform = createWebPlatform({ appName: "GameKits Character Controller Lab" });
  const driver = createThreeDriver({
    id: CHARACTER_CONTROLLER_LAB_DRIVER_ID,
    backgroundColor: "#080b0a",
    clearAlpha: 1,
    runtimeOptions: { cameraZ: 1200 }
  });

  return createStandardAppProfile({
    id: "sandbox.character-controller-lab.web",
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
        boot({ context }, gameDriver) {
          return createDriverBootContext(context, gameDriver);
        }
      },
      renderer: { driver: CHARACTER_CONTROLLER_LAB_DRIVER_ID }
    }
  });
}

export function measureCharacterControllerLabViewport(viewport: HTMLElement): {
  width: number;
  height: number;
} {
  const bounds = viewport.getBoundingClientRect();
  return {
    width: Math.max(360, Math.round(bounds.width || CHARACTER_CONTROLLER_LAB_RENDER_SIZE.width)),
    height: Math.max(320, Math.round(bounds.height || CHARACTER_CONTROLLER_LAB_RENDER_SIZE.height))
  };
}

function createDriverBootContext(
  context: CharacterControllerLabAppContext,
  _driver: GameDriver
): RendererBootContext {
  const size = measureCharacterControllerLabViewport(context.viewport);
  return {
    container: context.viewport,
    ...size,
    debug: true
  };
}
