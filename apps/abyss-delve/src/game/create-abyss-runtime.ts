import { createDataRegistry, type DataRegistry } from "@gamekits/data";
import { createEventBus, type EventBus } from "@gamekits/event-bus";
import { createGame } from "@gamekits/game-runtime";
import {
  createGasDataTypes,
  createGasModule,
  createGasTcaDefinitions,
  createGasTraceStore,
  type GasRuntime
} from "@gamekits/gas";
import type { RendererAdapter } from "@gamekits/renderer-core";
import type { CameraController } from "@gamekits/camera-core";
import {
  createTcaModule,
  createTcaRuleDataType,
  createTcaTraceStore,
  mergeTcaDefinitionSets,
  type TcaTraceStore
} from "@gamekits/tca";
import type { GameWorld } from "@gamekits/world";
import {
  abyssDataPack,
  createAbyssDataTypes,
  ABYSS_REWARD_POOL_TYPE,
  ABYSS_REWARD_TYPE,
  type AbyssRewardPool,
  type AbyssRewardDefinition
} from "./content";
import { ABYSS_SEED } from "./constants";
import { createAbyssInputState } from "./input-state";
import { createAbyssRunState, type AbyssRuntimeState } from "./runtime-state";
import {
  applyAbyssCheckpoint,
  captureAbyssCheckpoint,
  resetAbyssTransientState
} from "./save/checkpoint";
import { appendEvent, attachRuntimeSnapshot, createAbyssSnapshot } from "./snapshot";
import type { AbyssCameraAdapter, AbyssRewardChoice, AbyssRuntime } from "./types";
import { createAbyssTcaDefinitions } from "./modules/abyss-tca-definitions";
import { createAbyssCameraModule } from "./modules/camera-module";
import { createAbyssCombatModule } from "./modules/combat-module";
import { createAbyssEnemyAiModule } from "./modules/enemy-ai-module";
import { createAbyssInputResetModule } from "./modules/input-reset-module";
import { createAbyssLootModule } from "./modules/loot-module";
import { createAbyssPlayerControlModule } from "./modules/player-control-module";
import {
  createAbyssPresentationModule,
  type AbyssRenderTargetWriter
} from "./modules/presentation-module";
import { createAbyssRoomModule } from "./modules/room-module";

export type CreateAbyssRuntimeOptions = {
  renderer?: RendererAdapter | undefined;
  applyRenderTargetState?: AbyssRenderTargetWriter | undefined;
  camera?: CameraController | undefined;
  cameraAdapter?: AbyssCameraAdapter | undefined;
  dataRegistry?: DataRegistry | undefined;
  world?: GameWorld | undefined;
  eventBus?: EventBus | undefined;
  seed?: string | undefined;
  gasTraceStore?: ReturnType<typeof createGasTraceStore> | undefined;
  tcaTraceStore?: TcaTraceStore | undefined;
};

export function createAbyssDataRegistry(): DataRegistry {
  const registry = createDataRegistry();
  for (const type of createAbyssDataTypes()) {
    registry.registerType(type);
  }
  for (const type of createGasDataTypes()) {
    registry.registerType(type);
  }
  registry.registerType(createTcaRuleDataType());
  registry.registerPack(abyssDataPack);
  return registry;
}

export function createAbyssRuntime(options: CreateAbyssRuntimeOptions = {}): AbyssRuntime {
  const dataRegistry = options.dataRegistry ?? createAbyssDataRegistry();
  const world = requireOption(options.world, "world");
  const eventBus = options.eventBus ?? createEventBus({ clock: () => Date.now() });
  const gasTraceStore = options.gasTraceStore ?? createGasTraceStore({ limit: 80 });
  const tcaTraceStore = options.tcaTraceStore ?? createTcaTraceStore({ limit: 80 });
  const seed = options.seed ?? ABYSS_SEED;
  let gasRuntime: GasRuntime | undefined;
  let traceSequence = 0;
  const state: AbyssRuntimeState = {
    seed,
    world,
    dataRegistry,
    eventBus,
    renderer: options.renderer,
    camera: options.camera,
    cameraAdapter: options.cameraAdapter,
    input: createAbyssInputState(),
    run: createAbyssRunState(createRewardChoices(dataRegistry)),
    events: [],
    timeline: [],
    gasRuntime: () => gasRuntime,
    tcaTraceStore,
    gasTraceStore,
    lastElapsed: 0,
    setGasRuntime(runtime) {
      gasRuntime = runtime;
    },
    trace(entry) {
      traceSequence += 1;
      state.timeline.unshift({
        id: `abyss.trace.${traceSequence}`,
        time: entry.time ?? Date.now(),
        ...entry
      });
      if (state.timeline.length > 80) {
        state.timeline.pop();
      }
    }
  };

  eventBus.onAny((event) => {
    appendEvent(state.events, event);
    state.trace({
      kind: event.type.startsWith("gas.")
        ? "gas"
        : event.type.startsWith("abyss.loot")
          ? "loot"
          : event.type.startsWith("abyss.reward")
            ? "reward"
            : "runtime",
      label: event.type,
      payload: event.payload
    });
  });

  const modules = [
    createGasModule({
      id: "abyss.gas",
      dataRegistry,
      eventBus,
      traceStore: gasTraceStore,
      onRuntime(runtime) {
        gasRuntime = runtime;
        state.setGasRuntime(runtime);
      }
    }),
    createTcaModule({
      id: "abyss.tca",
      dataRegistry,
      eventBus,
      traceStore: tcaTraceStore,
      definitions: mergeTcaDefinitionSets(
        createAbyssTcaDefinitions({ state, dataRegistry }),
        createGasTcaDefinitions({ runtime: () => gasRuntime })
      )
    }),
    createAbyssCameraModule(state),
    createAbyssRoomModule(state),
    createAbyssPlayerControlModule(state),
    createAbyssEnemyAiModule(state),
    createAbyssCombatModule({ state }),
    createAbyssLootModule({ state }),
    ...(options.renderer
      ? [
          createAbyssPresentationModule({
            renderer: options.renderer,
            dataRegistry,
            state,
            applyRenderTargetState: options.applyRenderTargetState
          })
        ]
      : []),
    createAbyssInputResetModule(state)
  ];

  const runtime = createGame({
    modules,
    world,
    eventBus,
    seed
  });

  return {
    runtime,
    gasRuntime: () => gasRuntime,
    tcaTraceStore,
    gasTraceStore,
    input: state.input,
    run: state.run,
    screenToWorld(point) {
      return state.camera?.screenToWorld(point) ?? point;
    },
    trace: state.trace,
    captureCheckpoint() {
      return captureAbyssCheckpoint(state);
    },
    restoreCheckpoint(checkpoint) {
      applyAbyssCheckpoint(state, checkpoint);
      resetAbyssTransientState(state);
    },
    snapshot() {
      return attachRuntimeSnapshot(
        createAbyssSnapshot(state),
        runtime.clock.snapshot(),
        runtime.isRunning()
      );
    }
  };
}

function createRewardChoices(
  dataRegistry: DataRegistry,
  poolId = "rewardPool.bootstrap"
): AbyssRewardChoice[] {
  const pool = dataRegistry.getValue<AbyssRewardPool>(ABYSS_REWARD_POOL_TYPE, poolId);
  return pool.rewardIds.map((rewardId) => ({
    ...dataRegistry.getValue<AbyssRewardDefinition>(ABYSS_REWARD_TYPE, rewardId),
    selected: false
  }));
}

function requireOption<T>(value: T | undefined, name: string): T {
  if (value === undefined) {
    throw new Error(`Missing Abyss runtime option: ${name}`);
  }
  return value;
}
