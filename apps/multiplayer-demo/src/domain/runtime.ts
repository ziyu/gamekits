import { createEventBus, type GameEvent } from "@gamekits/event-bus";
import { createGame, type GameRuntime } from "@gamekits/game-runtime";
import {
  createMultiplayerModule,
  type MultiplayerRuntime,
  type MultiplayerSnapshot
} from "@gamekits/multiplayer-core";
import { createKootaWorld } from "@gamekits/world-koota";
import { createMultiplayerDemoAuthority } from "./authority";
import { createMultiplayerDemoCommandHandler } from "./handler";
import {
  captureMultiplayerDemoSnapshot,
  createInitialMultiplayerDemoState,
  type MultiplayerDemoSnapshot,
  type MultiplayerDemoState
} from "./state";

export type MultiplayerDemoRuntimeOptions = {
  multiplayer: MultiplayerRuntime;
  seed?: string;
  clock?: () => number;
};

export type MultiplayerDemoRuntime = {
  runtime: GameRuntime;
  multiplayer: MultiplayerRuntime;
  state: MultiplayerDemoState;
  events: GameEvent[];
  snapshot(): MultiplayerDemoAppSnapshot;
  dispose(): Promise<void>;
};

export type MultiplayerDemoAppSnapshot = {
  running: boolean;
  tick: number;
  state: MultiplayerDemoSnapshot;
  multiplayer: MultiplayerSnapshot;
  events: GameEvent[];
};

export function createMultiplayerDemoRuntime(
  options: MultiplayerDemoRuntimeOptions
): MultiplayerDemoRuntime {
  const eventBus = createEventBus(
    options.clock === undefined ? undefined : { clock: options.clock }
  );
  const state = createInitialMultiplayerDemoState();
  const events: GameEvent[] = [];
  eventBus.onAny((event) => {
    events.push(event);
    if (events.length > 32) {
      events.shift();
    }
  });

  const runtime = createGame({
    seed: options.seed ?? "multiplayer-demo-seed",
    world: createKootaWorld(),
    eventBus,
    modules: [
      createMultiplayerModule({
        id: "multiplayer-demo.bridge",
        runtime: options.multiplayer,
        authority: createMultiplayerDemoAuthority(state),
        handleCommand: createMultiplayerDemoCommandHandler(state)
      })
    ]
  });

  return {
    runtime,
    multiplayer: options.multiplayer,
    state,
    events,
    snapshot() {
      return {
        running: runtime.isRunning(),
        tick: runtime.clock.snapshot().ticks,
        state: captureMultiplayerDemoSnapshot(state),
        multiplayer: options.multiplayer.snapshot(),
        events: events.map((event) => ({ ...event, payload: clonePayload(event.payload) }))
      };
    },
    async dispose() {
      runtime.dispose();
      await options.multiplayer.dispose();
    }
  };
}

function clonePayload(payload: unknown): unknown {
  if (payload === undefined || payload === null || typeof payload !== "object") {
    return payload;
  }

  return JSON.parse(JSON.stringify(payload)) as unknown;
}
