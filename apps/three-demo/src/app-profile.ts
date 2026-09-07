import { createStandardAppProfile, type AppProfile } from "@gamekits/app-host";
import type { AssetManager } from "@gamekits/asset";
import type { DataRegistry } from "@gamekits/data";
import type { DriverRegistry, GameDriver } from "@gamekits/driver-core";
import { createThreeDriver } from "@gamekits/driver-three";
import type { PlatformRuntime } from "@gamekits/platform-core";
import { createWebPlatform } from "@gamekits/platform-web";
import type { RendererAdapter, RendererBootContext } from "@gamekits/renderer-core";
import {
  THREE_DEMO_DRIVER_ID,
  THREE_DEMO_RENDER_SIZE,
  type ThreeDemoDriverConfig
} from "./app-definition";
import { createThreeDemoDataRegistry } from "./demo-assets";
import type { ThreeDemoUiHandles } from "./ui";

export type ThreeDemoAppContext = {
  ui: ThreeDemoUiHandles;
  platform?: PlatformRuntime | undefined;
  data?: DataRegistry | undefined;
  assets?: AssetManager | undefined;
  drivers?: DriverRegistry | undefined;
  renderer?: RendererAdapter | undefined;
};

export function createThreeDemoProfile(): AppProfile<ThreeDemoAppContext> {
  const platform = createWebPlatform({ appName: "GameKits Three Demo" });
  const threeDriver = createThreeDriver({
    id: THREE_DEMO_DRIVER_ID,
    backgroundColor: "#171a16",
    clearAlpha: 1,
    runtimeOptions: {
      cameraZ: 1200,
      assetLoadTimeoutMs: 120000
    }
  });

  return createStandardAppProfile({
    id: "web",
    adapters: {
      platform
    },
    expose({ context, state }) {
      context.platform = state.platform;
      context.data = state.data;
      context.assets = state.assets;
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
          return createDriverBootContext(context, requireConfig<ThreeDemoDriverConfig>(), driver);
        }
      },
      data: {
        registry: createThreeDemoDataRegistry()
      },
      assets: {
        driver: THREE_DEMO_DRIVER_ID
      },
      renderer: {
        driver: THREE_DEMO_DRIVER_ID
      }
    }
  });
}

function createDriverBootContext(
  context: ThreeDemoAppContext,
  config: ThreeDemoDriverConfig,
  _driver: GameDriver
): RendererBootContext {
  const measured = measureViewport(context.ui.viewport);
  const boot: RendererBootContext = {
    container: context.ui.viewport,
    width: measured.width || config.width || THREE_DEMO_RENDER_SIZE.width,
    height: measured.height || config.height || THREE_DEMO_RENDER_SIZE.height,
    onDiagnostic(event) {
      context.ui.pushDiagnostic(event.type, event.source);
    }
  };

  return config.debug === undefined
    ? boot
    : {
        ...boot,
        debug: config.debug
      };
}

export function measureViewport(element: HTMLElement): { width: number; height: number } {
  const rect = element.getBoundingClientRect();
  return {
    width: Math.max(320, Math.round(rect.width || THREE_DEMO_RENDER_SIZE.width)),
    height: Math.max(260, Math.round(rect.height || THREE_DEMO_RENDER_SIZE.height))
  };
}
