import {
  createStandardAppProfile,
  type AppProfile,
  type StandardAppServiceState
} from "@gamekits/app-host";
import type { AnimatorHandle } from "@gamekits/animator-core";
import type { DevToolsRuntime } from "@gamekits/devtools";
import { createEventBus } from "@gamekits/event-bus";
import { createGame } from "@gamekits/game-runtime";
import { createPhaserDriver } from "@gamekits/driver-phaser";
import type { UiRuntime } from "@gamekits/ui-core";
import { createKootaWorld } from "@gamekits/world-koota";
import { ANIMATOR_LAB_RENDER_SIZE } from "./app-definition";
import { ANIMATOR_LAB_ASSET_GROUP, createAnimatorLabDataRegistry } from "./content";
import {
  createAnimatorLabController,
  createAnimatorLabPlaybackProbe,
  createAnimatorLabState,
  type AnimatorLabController
} from "./runtime";

const ANIMATOR_LAB_DRIVER_ID = "sandbox.animator-lab.phaser";

export type AnimatorLabAppContext = {
  stageRoot: HTMLElement;
  uiRuntime: UiRuntime;
  scene?: AnimatorLabController | undefined;
  animator?: AnimatorHandle | undefined;
  devtools?: DevToolsRuntime | undefined;
};

export function createAnimatorLabWebProfile(options: {
  uiRuntime: UiRuntime;
}): AppProfile<AnimatorLabAppContext> {
  const driver = createPhaserDriver({
    id: ANIMATOR_LAB_DRIVER_ID,
    backgroundColor: "#071115",
    render: { pixelRatio: 1, antialias: false, roundPixels: true }
  });
  const dataRegistry = createAnimatorLabDataRegistry();
  const playback = createAnimatorLabPlaybackProbe(driver.adapters().animation);
  const labState = createAnimatorLabState();
  const refs: { scene?: AnimatorLabController } = {};

  return createStandardAppProfile({
    id: "sandbox.animator-lab.web",
    expose({ context, state }) {
      context.scene = refs.scene;
      context.animator = state.animator;
      context.devtools = state.devtools;
      if (state.ui) {
        context.uiRuntime = state.ui;
      }
    },
    services: {
      drivers: {
        drivers: [driver],
        boot({ context }) {
          return {
            container: context.stageRoot,
            ...ANIMATOR_LAB_RENDER_SIZE,
            debug: true
          };
        }
      },
      data: { registry: dataRegistry },
      renderer: { driver: ANIMATOR_LAB_DRIVER_ID },
      assets: {
        driver: ANIMATOR_LAB_DRIVER_ID,
        preloadGroups: () => [ANIMATOR_LAB_ASSET_GROUP]
      },
      ui: {
        runtime: () => options.uiRuntime,
        panels() {
          return [
            { id: "sandbox.animator-lab.stage", title: "Motion Bay", kind: "hud" },
            { id: "sandbox.animator-lab.controls", title: "Test Controls", kind: "panel" },
            { id: "sandbox.animator-lab.telemetry", title: "Signal Ledger", kind: "panel" }
          ];
        }
      },
      game: {
        standardModules: {
          animator: {
            id: "sandbox.animator-lab.animator",
            dataRegistry,
            adapter: playback,
            markerHistoryLimit: 64,
            traceLimit: 160,
            onMarker(marker) {
              labState.retainMarker(marker);
            }
          }
        },
        createRuntime({ context, state }, modules) {
          const runtime = createGame({
            world: createKootaWorld(),
            eventBus: createEventBus({ clock: clockNow }),
            modules,
            seed: "sandbox-animator-lab"
          });
          const scene = createAnimatorLabController({
            animator: requireStandardState(state, "animator"),
            renderer: requireStandardState(state, "renderer"),
            playback,
            state: labState
          });
          refs.scene = scene;
          context.scene = scene;
          return runtime;
        }
      },
      devtools: {
        options: {
          traceLimit: 360,
          diagnosticLimit: 160,
          profilerBudgetMs: 6
        },
        standardSources: true,
        standardPanels: true,
        includeSources: ["drivers", "data", "assets", "renderer", "game", "animator"],
        ui: false,
        dataSources({ context }) {
          return [
            {
              id: "animator-lab",
              label: "Animator Lab",
              kind: "custom",
              snapshot() {
                return context.scene?.snapshot() ?? { status: "pending" };
              }
            }
          ];
        }
      }
    }
  });
}

function requireStandardState<TKey extends keyof StandardAppServiceState>(
  state: StandardAppServiceState,
  key: TKey
): NonNullable<StandardAppServiceState[TKey]> {
  const value = state[key];
  if (value === undefined) {
    throw new Error(`Animator Lab requires the standard ${key} service`);
  }
  return value;
}

function clockNow(): number {
  return Math.round(typeof performance === "undefined" ? Date.now() : performance.now());
}
