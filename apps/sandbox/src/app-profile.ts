import type { AssetManager } from "@gamekits/asset";
import {
  createStandardAppProfile,
  resolveDriverCamera,
  type AppProfile,
  type StandardCameraActionBinding
} from "@gamekits/app-host";
import type { CameraController } from "@gamekits/camera-core";
import type { DataRegistry } from "@gamekits/data";
import type { DevToolsRuntime } from "@gamekits/devtools";
import type { DriverRegistry, GameDriver } from "@gamekits/driver-core";
import { createPhaserDriver } from "@gamekits/driver-phaser";
import { createThreeDriver } from "@gamekits/driver-three";
import { createEventBus } from "@gamekits/event-bus";
import { createGasTcaDefinitions, createGasTraceStore, type GasRuntime } from "@gamekits/gas";
import { createInputRouter, type InputRouter } from "@gamekits/input-core";
import { createDomInputAdapter } from "@gamekits/input-dom";
import type { PlatformRuntime } from "@gamekits/platform-core";
import { createWebPlatform } from "@gamekits/platform-web";
import type { RendererAdapter, RendererBootContext } from "@gamekits/renderer-core";
import { createPlatformStorageSaveStore, type SaveManager } from "@gamekits/save";
import { createTcaTraceStore, mergeTcaDefinitionSets } from "@gamekits/tca";
import type { UiRuntime } from "@gamekits/ui-core";
import { createKootaWorld } from "@gamekits/world-koota";
import { createSandboxCameraController } from "./camera";
import {
  createSandboxDataRegistry,
  createSandboxRuntime,
  createSandboxSaveContributor,
  SANDBOX_RENDER_SIZE,
  type SandboxRuntime
} from "./game";
import { createSandboxTcaDefinitions } from "./game/modules/sandbox-tca-definitions";
import {
  configureSandboxInputRouter,
  resolveSandboxInputScope,
  type SandboxInputScope
} from "./app-input";
import type { SandboxUiHandles } from "./ui/render-sandbox";
import { updateCameraStatus } from "./ui/render-sandbox";

const SANDBOX_CAMERA_HELD_PAN_STEP = 8;

export type SandboxAppContext = {
  ui: SandboxUiHandles;
  uiRuntime: UiRuntime;
  activeInputScope: SandboxInputScope;
  platform?: PlatformRuntime | undefined;
  drivers?: DriverRegistry | undefined;
  dataRegistry?: DataRegistry | undefined;
  renderer?: RendererAdapter | undefined;
  assetManager?: AssetManager | undefined;
  inputRouter?: InputRouter | undefined;
  cameraController?: CameraController | undefined;
  gasRuntime?: GasRuntime | undefined;
  saveManager?: SaveManager | undefined;
  devtools?: DevToolsRuntime | undefined;
  sandbox?: SandboxRuntime | undefined;
};

export function createSandboxWebProfile(): AppProfile<SandboxAppContext> {
  const refs: {
    sandbox?: SandboxRuntime;
    gasRuntime?: GasRuntime;
  } = {};
  const platform = createWebPlatform({ appName: "GameKits Sandbox" });
  const dataRegistry = createSandboxDataRegistry();
  const phaserDriver = createPhaserDriver({ id: "sandbox.phaser" });
  const threeDriver = createThreeDriver({
    id: "sandbox.three",
    backgroundColor: "#111513",
    clearAlpha: 0
  });
  const camera = createSandboxCameraController(SANDBOX_RENDER_SIZE);
  const inputRouter = createInputRouter();
  const tcaTraceStore = createTcaTraceStore({ limit: 20 });
  const gasTraceStore = createGasTraceStore({ limit: 30 });

  return createStandardAppProfile({
    id: "web",
    adapters: {
      platform
    },
    expose({ context, state }) {
      context.platform = state.platform;
      context.drivers = state.drivers;
      context.dataRegistry = state.data;
      context.renderer = state.renderer;
      context.assetManager = state.assets;
      context.inputRouter = state.input;
      context.saveManager = state.save;
      if (state.ui) {
        context.uiRuntime = state.ui;
      }
      context.cameraController = camera;
      context.gasRuntime = refs.gasRuntime;
      context.sandbox = refs.sandbox;
      context.devtools = state.devtools;
    },
    services: {
      platform: {
        adapter: "platform"
      },
      drivers: {
        drivers: [phaserDriver, threeDriver],
        boot({ context, requireConfig }, driver) {
          return createDriverBootContext(context, requireConfig<SandboxRendererConfig>(), driver);
        }
      },
      data: {
        registry: dataRegistry
      },
      renderer: {
        driver: "sandbox.phaser"
      },
      assets: {
        driver: "sandbox.phaser",
        onDiagnostic(event) {
          refs.sandbox?.runtime.eventBus.emit(event.type, event.payload, event.source);
        }
      },
      input: {
        router: inputRouter,
        configure({ context }, inputRouter) {
          configureSandboxInputRouter(context, inputRouter);
        },
        adapters({ context }, inputRouter) {
          return [
            createDomInputAdapter({
              target: window,
              capture: true,
              eventFilter: (event) =>
                !isStagePointerInput(context, event) &&
                !isFocusedRendererKeyboardInput(context, event),
              scope: (event) => resolveSandboxInputScope(context, event),
              onInput: (event) => {
                inputRouter.handle(event);
              }
            }),
            createDomInputAdapter({
              target: context.ui.rendererRoot,
              capture: true,
              source: "sandbox.viewport.keyboard",
              eventFilter: isKeyboardInput,
              scope: "game",
              onInput: (event) => {
                inputRouter.handle(event);
              }
            })
          ];
        },
        driverSources: [
          {
            driver: "sandbox.phaser",
            source: "sandbox.phaser.input",
            devices: ["mouse", "touch", "pen"],
            scope: "game"
          }
        ]
      },
      ui: {
        runtime({ context }) {
          return context.uiRuntime;
        },
        panels() {
          return [
            { id: "sandbox.stage", title: "Stage", kind: "hud", tags: ["sandbox"] },
            { id: "sandbox.hud", title: "Runtime HUD", kind: "hud", tags: ["sandbox"] },
            { id: "sandbox.inspector", title: "Inspector", kind: "panel", tags: ["sandbox"] },
            { id: "sandbox.timeline", title: "Timeline", kind: "panel", tags: ["sandbox"] },
            {
              id: "sandbox.objective.briefing",
              title: "Objective Briefing",
              kind: "modal",
              tags: ["sandbox", "objective", "scene-ui"]
            }
          ];
        }
      },
      game: {
        standardModules: {
          gas: {
            id: "sandbox.gas",
            traceStore: gasTraceStore,
            onRuntime({ context }, runtime) {
              refs.gasRuntime = runtime;
              context.gasRuntime = runtime;
            }
          },
          tca: {
            id: "sandbox.tca",
            definitions: mergeTcaDefinitionSets(
              createSandboxTcaDefinitions(),
              createGasTcaDefinitions({ runtime: () => refs.gasRuntime })
            ),
            traceStore: tcaTraceStore
          },
          camera: {
            id: "sandbox.camera",
            controller: camera,
            actions: sandboxCameraActions(),
            follow: {
              resolveTarget({ context }, targetEntity) {
                const entity = context.sandbox?.resolveEntityPosition(targetEntity);
                return entity
                  ? {
                      x: (entity.x / 100) * SANDBOX_RENDER_SIZE.width,
                      y: (entity.y / 100) * SANDBOX_RENDER_SIZE.height
                    }
                  : undefined;
              }
            },
            smoothing: {
              enabled: true,
              stiffness: 12,
              positionEpsilon: 0.1,
              zoomEpsilon: 0.002
            },
            sync(ctx, _camera, _action, state) {
              resolveDriverCamera(ctx, "sandbox.phaser").applyCameraState(state);
              updateCameraStatus(ctx.context.ui, state);
            }
          }
        },
        createRuntime({ context, state }, modules) {
          updateCameraStatus(context.ui, camera.getState());
          const sandbox = createSandboxRuntime({
            renderer: requireStandardState(state.renderer, "renderer"),
            renderSize: SANDBOX_RENDER_SIZE,
            world: createKootaWorld(),
            eventBus: createEventBus({ clock: () => Math.round(performance.now()) }),
            dataRegistry: requireStandardState(state.data, "data"),
            assetSummary: () => summarizeAssets(requireStandardState(state.assets, "assets")),
            modules,
            tcaTraceStore,
            gasTraceStore,
            gasRuntime: () => refs.gasRuntime
          });
          refs.sandbox = sandbox;
          context.sandbox = sandbox;
          return sandbox.runtime;
        }
      },
      save: {
        store: createPlatformStorageSaveStore({
          storage: platform.services.storage,
          prefix: "sandbox.tiny-camp.save"
        }),
        formatVersion: "1.0.0",
        gameVersion: "0.1.0",
        serviceContext: {
          include: ["data", "assets", "game"]
        },
        contributorPolicy: {
          excludeScopes: ["presentation", "debug", "cache", "ui"]
        },
        contributors({ context }) {
          return context.sandbox ? [createSandboxSaveContributor(context.sandbox)] : [];
        }
      },
      devtools: {
        options: {
          traceLimit: 500,
          diagnosticLimit: 200,
          profilerBudgetMs: 6
        },
        dataSources({ context }) {
          return [
            {
              id: "sandbox",
              label: "Sandbox Snapshot",
              kind: "custom",
              snapshot() {
                return (
                  context.sandbox?.snapshot({
                    defaultSelection: false
                  }) ?? { status: "pending" }
                );
              }
            },
            {
              id: "camera",
              label: "Camera",
              kind: "camera",
              snapshot() {
                return camera.getState();
              }
            },
            {
              id: "tca",
              label: "TCA Trace",
              kind: "tca",
              snapshot() {
                return tcaTraceStore.snapshot();
              }
            },
            {
              id: "gas",
              label: "GAS Runtime",
              kind: "gas",
              snapshot() {
                return refs.gasRuntime?.snapshot() ?? gasTraceStore.snapshot();
              }
            }
          ];
        }
      }
    }
  });
}

function sandboxCameraActions(): StandardCameraActionBinding[] {
  return [
    {
      actionId: "camera.pan_up",
      phases: ["pressed", "held"],
      pan: { y: -SANDBOX_CAMERA_HELD_PAN_STEP }
    },
    {
      actionId: "camera.pan_down",
      phases: ["pressed", "held"],
      pan: { y: SANDBOX_CAMERA_HELD_PAN_STEP }
    },
    {
      actionId: "camera.pan_left",
      phases: ["pressed", "held"],
      pan: { x: -SANDBOX_CAMERA_HELD_PAN_STEP }
    },
    {
      actionId: "camera.pan_right",
      phases: ["pressed", "held"],
      pan: { x: SANDBOX_CAMERA_HELD_PAN_STEP }
    },
    {
      actionId: "camera.zoom_in",
      phases: ["pressed", "scrolled"],
      zoom: { delta: 1, wheel: true, anchorFromInput: true }
    },
    {
      actionId: "camera.zoom_out",
      phases: ["pressed"],
      zoom: { delta: -1 }
    }
  ];
}

function requireStandardState<TValue>(value: TValue | undefined, name: string): TValue {
  if (value === undefined) {
    throw new Error(`Missing standard app service state: ${name}`);
  }

  return value;
}

function summarizeAssets(manager: AssetManager) {
  const states = manager.states();
  return {
    assetsLoaded: states.filter((state) => state.status === "loaded").length,
    assetsFailed: states.filter((state) => state.status === "failed").length
  };
}

function isStagePointerInput(context: SandboxAppContext, event: Event): boolean {
  return (
    (event.type.startsWith("pointer") || event.type === "wheel") &&
    event.target instanceof Node &&
    context.ui.stage.contains(event.target)
  );
}

function isFocusedRendererKeyboardInput(context: SandboxAppContext, event: Event): boolean {
  if (!isKeyboardInput(event) || typeof document === "undefined") {
    return false;
  }

  return (
    document.activeElement instanceof Node &&
    context.ui.rendererRoot.contains(document.activeElement)
  );
}

function isKeyboardInput(event: Event): boolean {
  return event.type === "keydown" || event.type === "keyup";
}

type SandboxRendererConfig = {
  width: number;
  height: number;
  debug?: boolean;
};

function createDriverBootContext(
  context: SandboxAppContext,
  rendererConfig: SandboxRendererConfig,
  driver: GameDriver
): RendererBootContext {
  if (driver.id === "sandbox.three") {
    const boot: RendererBootContext = {
      container: context.ui.threePreviewRoot,
      width: 260,
      height: 160,
      onDiagnostic: (event) => {
        context.sandbox?.runtime.eventBus.emit(event.type, event.payload, event.source);
      }
    };

    return rendererConfig.debug === undefined
      ? boot
      : {
          ...boot,
          debug: rendererConfig.debug
        };
  }

  const boot: RendererBootContext = {
    container: context.ui.rendererRoot,
    width: rendererConfig.width,
    height: rendererConfig.height,
    onDiagnostic: (event) => {
      context.sandbox?.runtime.eventBus.emit(event.type, event.payload, event.source);
    }
  };

  return rendererConfig.debug === undefined
    ? boot
    : {
        ...boot,
        debug: rendererConfig.debug
      };
}
