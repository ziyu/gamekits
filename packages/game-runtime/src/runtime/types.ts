import type { Clock, GameModule, Rng } from "@gamekits/core";
import type { EventBus } from "@gamekits/event-bus";
import type { GameWorld, WorldSystem } from "@gamekits/world";

export type SystemRegistry = {
  register(system: WorldSystem): void;
  values(): WorldSystem[];
};

export type GameInstallContext = {
  world: GameWorld;
  eventBus: EventBus;
  rng: Rng;
  systems: SystemRegistry;
};

export type GameRuntime = {
  readonly world: GameWorld;
  readonly eventBus: EventBus;
  readonly rng: Rng;
  readonly clock: Clock;
  readonly systems: SystemRegistry;
  readonly modules: Array<GameModule<GameInstallContext>>;
  start(): void;
  stop(): void;
  tick(delta: number): void;
  setProfiler(profiler: GameRuntimeProfiler | undefined): void;
  dispose(): void;
  isRunning(): boolean;
};

export type GameRuntimeProfilerFrameHandle = {
  id: string;
};

export type GameRuntimeProfilerSpanHandle = {
  id: string;
};

export type GameRuntimeProfiler = {
  startFrame?(input: {
    tick: number;
    deltaMs: number;
    timestamp: number;
  }): GameRuntimeProfilerFrameHandle;
  endFrame?(handle: GameRuntimeProfilerFrameHandle): void;
  beginSystem?(input: {
    systemId: string;
    moduleId?: string | undefined;
    tick: number;
    frameId?: string | undefined;
    startedAt: number;
  }): GameRuntimeProfilerSpanHandle;
  endSystem?(
    handle: GameRuntimeProfilerSpanHandle,
    input: {
      durationMs: number;
      error?: unknown;
    }
  ): void;
};

export type CreateGameConfig = {
  modules: Array<GameModule<GameInstallContext>>;
  world: GameWorld;
  eventBus: EventBus;
  seed: string;
  profiler?: GameRuntimeProfiler | undefined;
};
