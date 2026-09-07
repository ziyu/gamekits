import { createStandardAppProfile, type AppProfile } from "@gamekits/app-host";
import type { DevToolsRuntime } from "@gamekits/devtools";
import { createEventBus } from "@gamekits/event-bus";
import { createGame } from "@gamekits/game-runtime";
import { createNavigationHandle } from "@gamekits/navigation-core";
import type { PlatformRuntime } from "@gamekits/platform-core";
import { createWebPlatform } from "@gamekits/platform-web";
import type { UiRuntime } from "@gamekits/ui-core";
import { createKootaWorld } from "@gamekits/world-koota";
import type { NavigationLabBackendProvider } from "./backends";
import {
  createNavigationLabController,
  createNavigationLabSimulationModule,
  createNavigationLabState
} from "./runtime";
import {
  NAVIGATION_LAB_PROFILES,
  NAVIGATION_LAB_SCENARIO,
  type NavigationLabScenarioDefinition
} from "./scenario";
import type { NavigationLabController } from "./types";

export type NavigationLabAppContext = {
  uiRuntime: UiRuntime;
  platform?: PlatformRuntime | undefined;
  scene?: NavigationLabController | undefined;
  devtools?: DevToolsRuntime | undefined;
  scenarioId?: string | undefined;
  backendId?: string | undefined;
};

export function createNavigationLabWebProfile(options: {
  uiRuntime: UiRuntime;
  scenario?: NavigationLabScenarioDefinition | undefined;
  backend: NavigationLabBackendProvider;
}): AppProfile<NavigationLabAppContext> {
  const { backend } = options;
  const scenario = options.scenario ?? NAVIGATION_LAB_SCENARIO;
  const platform = createWebPlatform({ appName: "GameKits Navigation Lab" });
  const dataRegistry = backend.createDataRegistry();
  const world = createKootaWorld();
  const eventBus = createEventBus({ clock: () => Math.round(performance.now()) });
  const navigation = createNavigationHandle({
    id: `sandbox.navigation-lab.${scenario.id}.${backend.id}`
  });
  const labState = createNavigationLabState(navigation, backend, scenario);
  const refs: { scene?: NavigationLabController } = {};

  return createStandardAppProfile({
    id: `sandbox.navigation-lab.${scenario.id}.${backend.id}.web`,
    adapters: { platform },
    expose({ context, state }) {
      context.platform = state.platform;
      context.scene = refs.scene;
      context.devtools = state.devtools;
      context.scenarioId = scenario.id;
      context.backendId = backend.id;
      if (state.ui) {
        context.uiRuntime = state.ui;
      }
    },
    services: {
      platform: { adapter: "platform" },
      data: { registry: dataRegistry },
      ui: {
        runtime() {
          return options.uiRuntime;
        },
        panels() {
          return [
            { id: "sandbox.navigation-lab.map", title: scenario.title, kind: "hud" },
            { id: "sandbox.navigation-lab.controls", title: "Field Orders", kind: "panel" },
            { id: "sandbox.navigation-lab.trace", title: "Navigation Trace", kind: "panel" }
          ];
        }
      },
      game: {
        standardModules: {
          navigation: {
            id: `sandbox.navigation-lab.${scenario.id}.${backend.id}`,
            layout: backend.layoutRef,
            backendFactories: backend.createBackendFactories(),
            dataRegistry,
            profiles: NAVIGATION_LAB_PROFILES.map((profile) => ({
              ...profile,
              allowedAreas: [...profile.allowedAreas],
              costOverrides: { ...profile.costOverrides },
              tags: [...profile.tags]
            })),
            handle: navigation,
            maxRequestsPerTick: 2,
            maxBackendPollsPerTick: 4,
            maxPendingRequests: 48,
            maxPendingPerRequester: 8,
            maxRetainedResults: 96,
            maxRetainedRoutes: 32,
            maxCacheEntries: 48,
            cacheTtlMs: 60_000,
            negativeCacheTtlMs: 5_000,
            traceLimit: 180
          }
        },
        modules: [createNavigationLabSimulationModule(labState, navigation)],
        createRuntime({ context }, modules) {
          const runtime = createGame({
            world,
            eventBus,
            modules,
            seed: `sandbox-navigation-lab-${scenario.id}-${backend.id}`
          });
          const scene = createNavigationLabController({ navigation, state: labState });
          refs.scene = scene;
          context.scene = scene;
          return runtime;
        }
      },
      devtools: {
        options: {
          traceLimit: 500,
          diagnosticLimit: 200,
          profilerBudgetMs: 6
        },
        ui: {
          pins: {
            defaultPinned: ["devtools.performance"],
            defaultCollapsed: ["devtools.performance"]
          }
        },
        dataSources({ context }) {
          return [
            {
              id: "navigation-lab",
              label: "Navigation Lab",
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
