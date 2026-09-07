import { createCombatHandle, createCombatModule, createCombatTraceStore } from "@gamekits/combat";
import { createStandardAppProfile, type AppProfile } from "@gamekits/app-host";
import type { DevToolsRuntime } from "@gamekits/devtools";
import { createEventBus } from "@gamekits/event-bus";
import { createGame } from "@gamekits/game-runtime";
import { createGasHandle, createGasTraceStore } from "@gamekits/gas";
import {
  createPhysicsHandle,
  createPhysicsTraceStore,
  type PhysicsBackendAdapter
} from "@gamekits/physics-core";
import type { PlatformRuntime } from "@gamekits/platform-core";
import { createWebPlatform } from "@gamekits/platform-web";
import type { UiRuntime } from "@gamekits/ui-core";
import { createKootaWorld } from "@gamekits/world-koota";
import { createCombatRangeDataRegistry } from "./data";
import {
  combatRangeRelationshipResolver,
  createCombatRangeBootstrapModule,
  createCombatRangeController,
  createCombatRangePresentationModule,
  createCombatRangeState,
  type CombatRangeController
} from "./runtime";

export type CombatRangeAppContext = {
  uiRuntime: UiRuntime;
  platform?: PlatformRuntime | undefined;
  scene?: CombatRangeController | undefined;
  devtools?: DevToolsRuntime | undefined;
};

export function createCombatRangeWebProfile(options: {
  backend: PhysicsBackendAdapter;
  uiRuntime: UiRuntime;
}): AppProfile<CombatRangeAppContext> {
  const platform = createWebPlatform({ appName: "GameKits Combat Range" });
  const dataRegistry = createCombatRangeDataRegistry();
  const world = createKootaWorld();
  const eventBus = createEventBus({ clock: () => Math.round(performance.now()) });
  const gas = createGasHandle({ id: "sandbox.combat-range.gas" });
  const physics = createPhysicsHandle({ id: "sandbox.combat-range.physics" });
  const combat = createCombatHandle({ id: "sandbox.combat-range.combat" });
  const gasTrace = createGasTraceStore({ limit: 120 });
  const physicsTrace = createPhysicsTraceStore({ limit: 160 });
  const combatTrace = createCombatTraceStore({ limit: 160 });
  const rangeState = createCombatRangeState();
  const refs: { scene?: CombatRangeController } = {};

  return createStandardAppProfile({
    id: "sandbox.combat-range.web",
    adapters: { platform },
    expose({ context, state }) {
      context.platform = state.platform;
      context.scene = refs.scene;
      context.devtools = state.devtools;
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
            { id: "sandbox.combat-range.stage", title: "Combat Range", kind: "hud" },
            { id: "sandbox.combat-range.actions", title: "Delivery Deck", kind: "panel" },
            { id: "sandbox.combat-range.feedback", title: "Combat Feedback", kind: "panel" }
          ];
        }
      },
      game: {
        standardModules: {
          gas: {
            id: "sandbox.combat-range.gas",
            handle: gas,
            traceStore: gasTrace
          },
          physics: {
            id: "sandbox.combat-range.physics",
            backend: options.backend,
            handle: physics,
            traceStore: physicsTrace,
            fixedDeltaMs: 1000 / 60,
            maxSubSteps: 4,
            scene: {
              id: "sandbox.combat-range.physics-scene",
              dimension: "2d",
              gravity: { x: 0, y: 0 }
            },
            eventPolicy: {
              emitContacts: true
            }
          }
        },
        modules: [
          createCombatRangeBootstrapModule(rangeState, gas),
          createCombatModule({
            id: "sandbox.combat-range.combat",
            dataRegistry,
            gas,
            physics,
            handle: combat,
            traceStore: combatTrace,
            relationshipResolver: combatRangeRelationshipResolver,
            projectileBounds: {
              min: { x: -7, y: -3.5 },
              max: { x: 7, y: 3.5 }
            },
            limits: {
              maxActiveProjectiles: 64,
              maxCandidatesPerRequest: 32,
              maxTargetsPerRequest: 8,
              recentDeliveryLimit: 64,
              resolvedTicketLimit: 512
            },
            abilityDelivery: {
              onResult({ result }) {
                rangeState.lastResult = result;
              }
            }
          }),
          createCombatRangePresentationModule(rangeState)
        ],
        createRuntime({ context }, modules) {
          const runtime = createGame({
            world,
            eventBus,
            modules,
            seed: "sandbox-combat-range"
          });
          const scene = createCombatRangeController({
            runtime,
            world,
            gas,
            physics,
            combat,
            state: rangeState
          });
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
        dataSources({ context }) {
          return [
            {
              id: "combat-range",
              label: "Combat Range",
              kind: "custom",
              snapshot() {
                return context.scene?.snapshot() ?? { status: "pending" };
              }
            },
            {
              id: "combat",
              label: "Combat Runtime",
              kind: "custom",
              snapshot() {
                return combat.isBound() ? combat.snapshot() : { status: "unbound" };
              }
            },
            {
              id: "physics",
              label: "Physics Runtime",
              kind: "physics",
              snapshot() {
                return physics.isBound() ? physics.snapshot() : { status: "unbound" };
              }
            },
            {
              id: "gas",
              label: "GAS Runtime",
              kind: "gas",
              snapshot() {
                return gas.isBound() ? gas.snapshot() : { status: "unbound" };
              }
            }
          ];
        }
      }
    }
  });
}
