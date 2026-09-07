import { GameError } from "@gamekits/core";
import type { DriverCapabilities, DriverLifecyclePhase } from "@gamekits/driver-core";
import type { RendererBootContext } from "@gamekits/renderer-core";
import { createThreeDriverAssetLoader } from "./assets";
import { createThreeDriverCameraAdapter } from "./camera";
import { createThreeRenderer } from "./create-three-renderer";
import { createThreeDriverRuntime, type ThreeDriverRuntime } from "./runtime";
import type { ThreeDriverAdapters, ThreeDriverOptions, ThreeGameDriver } from "./types";

const DEFAULT_BACKGROUND_COLOR = "#111513";
const DEFAULT_CLEAR_ALPHA = 1;
const DEFAULT_CAMERA_Z = 1000;
const DEFAULT_ASSET_LOAD_TIMEOUT_MS = 30000;
const DEFAULT_DRACO_DECODER_PATH =
  "https://cdn.jsdelivr.net/npm/three@0.181.2/examples/jsm/libs/draco/";

export function createThreeDriver(options: ThreeDriverOptions = {}): ThreeGameDriver {
  const driverId = options.id ?? "three";
  let phase: DriverLifecyclePhase = "registered";
  let runtime: ThreeDriverRuntime | undefined = resolveInjectedRuntime(options.runtime);

  const getRuntime = (): ThreeDriverRuntime | undefined => {
    return resolveInjectedRuntime(options.runtime) ?? runtime;
  };
  const requireRuntime = (): ThreeDriverRuntime => {
    const resolved = getRuntime();
    if (!resolved) {
      throw new GameError(
        "driver.three.runtime_unavailable",
        "Three driver runtime is unavailable",
        { driverId }
      );
    }

    return resolved;
  };

  const renderer = createThreeRenderer({
    ...options.renderer,
    id: `${driverId}.renderer`,
    runtime: getRuntime
  });

  const adapters: ThreeDriverAdapters = {
    renderer,
    assetLoader: createThreeDriverAssetLoader({
      id: `${driverId}.asset-loader`,
      runtime: requireRuntime
    }),
    camera: createThreeDriverCameraAdapter({ runtime: requireRuntime })
  };

  return {
    id: driverId,
    kind: "three",
    async boot(ctx: RendererBootContext) {
      if (phase === "booted" || phase === "started") {
        return;
      }

      runtime =
        getRuntime() ??
        (await createThreeDriverRuntime(ctx, {
          backgroundColor:
            options.runtimeOptions?.backgroundColor ??
            options.backgroundColor ??
            DEFAULT_BACKGROUND_COLOR,
          clearAlpha:
            options.runtimeOptions?.clearAlpha ?? options.clearAlpha ?? DEFAULT_CLEAR_ALPHA,
          cameraZ: options.runtimeOptions?.cameraZ ?? DEFAULT_CAMERA_Z,
          assetLoadTimeoutMs:
            options.runtimeOptions?.assetLoadTimeoutMs ?? DEFAULT_ASSET_LOAD_TIMEOUT_MS,
          dracoDecoderPath: options.runtimeOptions?.dracoDecoderPath ?? DEFAULT_DRACO_DECODER_PATH
        }));
      await renderer.boot(ctx);
      phase = "booted";
    },
    start() {
      phase = "started";
      getRuntime()?.render();
    },
    stop() {
      phase = "stopped";
    },
    resize(size) {
      renderer.resize(size.width, size.height);
    },
    dispose() {
      renderer.destroy();
      if (!options.runtime) {
        runtime?.destroy();
      }
      runtime = undefined;
      phase = "disposed";
    },
    capabilities(): DriverCapabilities {
      return {
        renderer: true,
        assets: true,
        camera: true,
        scenes: true,
        custom: {
          nativeHandles: true
        }
      };
    },
    adapters() {
      return adapters;
    },
    snapshot() {
      return {
        id: driverId,
        kind: "three",
        phase,
        capabilities: this.capabilities(),
        adapters: ["renderer", "assetLoader", "camera"],
        details: {
          rendererId: renderer.id,
          runtimeReady: getRuntime() !== undefined,
          resources: getRuntime()?.resources.summaries() ?? []
        }
      };
    }
  };
}

function resolveInjectedRuntime(
  runtime: ThreeDriverOptions["runtime"]
): ThreeDriverRuntime | undefined {
  return typeof runtime === "function" ? runtime() : runtime;
}
