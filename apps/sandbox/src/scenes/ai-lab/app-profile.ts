import {
  createStandardAppProfile,
  type AppProfile,
  type StandardAppServiceState
} from "@gamekits/app-host";
import type { AiHandle } from "@gamekits/ai-core";
import type { DevToolsRuntime } from "@gamekits/devtools";
import { createEventBus } from "@gamekits/event-bus";
import { createGame } from "@gamekits/game-runtime";
import { createNavigationHandle } from "@gamekits/navigation-core";
import { createMemoryPhysicsBackend, createPhysicsHandle } from "@gamekits/physics-core";
import type { UiRuntime } from "@gamekits/ui-core";
import { createKootaWorld } from "@gamekits/world-koota";
import {
  AI_LAB_SCHEDULER_CLASSES,
  createAiLabInputs,
  createAiLabSensors,
  createAiLabTasks
} from "./behaviors";
import {
  AI_LAB_NAVIGATION_PROFILE,
  createAiLabNavigationBackend,
  createAiLabSharedFacts
} from "./capabilities";
import { createAiLabDataRegistry } from "./content";
import { createAiLabController, createAiLabState, type AiLabController } from "./runtime";
import { AI_LAB_AI_RUNTIME_LIMITS, AI_LAB_NAVIGATION_RUNTIME_LIMITS } from "./runtime-limits";
import { AI_LAB_TRACE_PRODUCTION, AI_LAB_TRACE_RETENTION } from "./trace-config";

export type AiLabAppContext = {
  uiRuntime: UiRuntime;
  scene?: AiLabController | undefined;
  ai?: AiHandle | undefined;
  devtools?: DevToolsRuntime | undefined;
};

export function createAiLabWebProfile(options: {
  uiRuntime: UiRuntime;
}): AppProfile<AiLabAppContext> {
  const dataRegistry = createAiLabDataRegistry();
  const world = createKootaWorld();
  const labState = createAiLabState(world);
  const physics = createPhysicsHandle({ id: "sandbox.ai-lab.physics" });
  const navigation = createNavigationHandle({ id: "sandbox.ai-lab.navigation" });
  const sharedFacts = createAiLabSharedFacts();
  const refs: { scene?: AiLabController } = {};

  return createStandardAppProfile({
    id: "sandbox.ai-lab.web",
    expose({ context, state }) {
      context.scene = refs.scene;
      context.ai = state.ai;
      context.devtools = state.devtools;
      if (state.ui) {
        context.uiRuntime = state.ui;
      }
    },
    services: {
      data: { registry: dataRegistry },
      ui: {
        runtime: () => options.uiRuntime,
        panels() {
          return [
            { id: "sandbox.ai-lab.stage", title: "林间生存地图", kind: "hud" },
            { id: "sandbox.ai-lab.controls", title: "自然干预", kind: "panel" },
            { id: "sandbox.ai-lab.telemetry", title: "个体观察", kind: "panel" }
          ];
        }
      },
      game: {
        standardModules: {
          physics: {
            id: "sandbox.ai-lab.physics",
            backend: createMemoryPhysicsBackend({ id: "sandbox.ai-lab.memory-physics" }),
            handle: physics,
            fixedDeltaMs: 50,
            maxSubSteps: 2,
            scene: {
              id: "sandbox.ai-lab.physics-scene",
              dimension: "2d",
              gravity: { x: 0, y: 0 }
            },
            eventPolicy: { emitContacts: false }
          },
          navigation: {
            id: "sandbox.ai-lab.navigation",
            backend: createAiLabNavigationBackend(),
            profiles: [{ ...AI_LAB_NAVIGATION_PROFILE, tags: [...AI_LAB_NAVIGATION_PROFILE.tags] }],
            ...AI_LAB_NAVIGATION_RUNTIME_LIMITS,
            traceLimit: 180,
            handle: navigation
          },
          ai: {
            id: "sandbox.ai-lab.ai",
            dataRegistry,
            sensors: createAiLabSensors(),
            inputs: createAiLabInputs(),
            tasks: createAiLabTasks(),
            schedulerClasses: AI_LAB_SCHEDULER_CLASSES,
            ...AI_LAB_AI_RUNTIME_LIMITS,
            failureBackoffMs: 220,
            defaultBlackboardLimit: 4,
            navigation,
            physics,
            sharedFacts,
            traceProduction: AI_LAB_TRACE_PRODUCTION,
            traceRetention: AI_LAB_TRACE_RETENTION,
            intentSink: {
              emit(intent) {
                labState.retainIntent(intent);
              }
            }
          }
        },
        createRuntime({ context, state }, modules) {
          const runtime = createGame({
            world,
            eventBus: createEventBus(),
            modules,
            seed: "sandbox-ai-lab"
          });
          const scene = createAiLabController({
            ai: requireStandardState(state, "ai"),
            state: labState,
            navigation,
            physics,
            sharedFacts
          });
          refs.scene = scene;
          context.scene = scene;
          return runtime;
        }
      },
      devtools: {
        options: {
          traceLimit: 520,
          diagnosticLimit: 180,
          profilerBudgetMs: 4
        },
        standardSources: true,
        standardPanels: true,
        includeSources: ["data", "game", "navigation", "ai", "ui"],
        ui: false,
        dataSources({ context }) {
          return [
            {
              id: "ai-lab",
              label: "AI Lab",
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
    throw new Error(`AI Lab requires the standard ${key} service`);
  }
  return value;
}
