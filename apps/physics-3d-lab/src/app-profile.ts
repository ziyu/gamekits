import { createStandardAppProfile, type AppProfile } from "@gamekits/app-host";
import type { DriverRegistry, GameDriver } from "@gamekits/driver-core";
import { createThreeDriver, type ThreeGameDriver } from "@gamekits/driver-three";
import type { PlatformRuntime } from "@gamekits/platform-core";
import { createWebPlatform } from "@gamekits/platform-web";
import type { RendererAdapter, RendererBootContext } from "@gamekits/renderer-core";
import {
  PHYSICS_3D_LAB_DRIVER_ID,
  PHYSICS_3D_LAB_RENDER_SIZE,
  type Physics3dLabDriverConfig
} from "./app-definition";
import type { Physics3dLabUi } from "./ui";

export type Physics3dLabAppContext = {
  ui: Physics3dLabUi;
  platform?: PlatformRuntime | undefined;
  drivers?: DriverRegistry | undefined;
  renderer?: RendererAdapter | undefined;
};

export function createPhysics3dLabProfile(): AppProfile<Physics3dLabAppContext> {
  const platform = createWebPlatform({ appName: "GameKits Physics 3D Lab" });
  const threeDriver = createThreeDriver({
    id: PHYSICS_3D_LAB_DRIVER_ID,
    backgroundColor: "#111512",
    clearAlpha: 1,
    runtimeOptions: {
      cameraZ: 1100
    }
  });

  return createStandardAppProfile({
    id: "web",
    adapters: {
      platform
    },
    expose({ context, state }) {
      context.platform = state.platform;
      context.drivers = state.drivers;
      context.renderer = state.renderer;
    },
    services: {
      platform: {
        adapter: "platform"
      },
      drivers: {
        drivers: [threeDriver],
        boot({ context, requireConfig }, driver) {
          return createDriverBootContext(
            context,
            requireConfig<Physics3dLabDriverConfig>(),
            driver
          );
        }
      },
      renderer: {
        driver: PHYSICS_3D_LAB_DRIVER_ID
      }
    }
  });
}

export function requireThreeDriver(context: Physics3dLabAppContext): ThreeGameDriver {
  const driver = context.drivers?.require<ThreeGameDriver>(PHYSICS_3D_LAB_DRIVER_ID);
  if (!driver) {
    throw new Error("Missing Physics 3D Lab Three driver");
  }
  return driver;
}

function createDriverBootContext(
  context: Physics3dLabAppContext,
  config: Physics3dLabDriverConfig,
  _driver: GameDriver
): RendererBootContext {
  const measured = measureViewport(context.ui.viewport);
  return {
    container: context.ui.viewport,
    width: measured.width || config.width || PHYSICS_3D_LAB_RENDER_SIZE.width,
    height: measured.height || config.height || PHYSICS_3D_LAB_RENDER_SIZE.height,
    ...(config.debug === undefined ? {} : { debug: config.debug }),
    onDiagnostic(event) {
      context.ui.pushDiagnostic(`${event.source ?? "renderer"}: ${event.type}`);
    }
  };
}

export function measureViewport(element: HTMLElement): { width: number; height: number } {
  const rect = element.getBoundingClientRect();
  return {
    width: Math.max(320, Math.round(rect.width || PHYSICS_3D_LAB_RENDER_SIZE.width)),
    height: Math.max(260, Math.round(rect.height || PHYSICS_3D_LAB_RENDER_SIZE.height))
  };
}
