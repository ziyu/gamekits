import {
  Clock,
  Registry,
  createSeededRng,
  type GameModule,
  type GameModuleInstallResult
} from "@gamekits/core";
import { createSystemRegistry } from "./system-registry";
import type {
  CreateGameConfig,
  GameInstallContext,
  GameRuntime,
  GameRuntimeProfiler
} from "./types";

export function createGame(config: CreateGameConfig): GameRuntime {
  const clock = new Clock();
  const rng = createSeededRng(config.seed);
  const systemRegistry = createSystemRegistry();
  const installedModules = new Registry<GameModule<GameInstallContext>>();
  const cleanups: Array<() => void> = [];
  let profiler: GameRuntimeProfiler | undefined = config.profiler;
  let disposed = false;

  const installContext: GameInstallContext = {
    world: config.world,
    eventBus: config.eventBus,
    rng,
    systems: systemRegistry
  };

  try {
    for (const module of config.modules) {
      installedModules.register(module.id, module);
      const cleanup = toModuleCleanup(module.install(installContext));
      if (cleanup) cleanups.push(cleanup);
      config.eventBus.emit("runtime.module_installed", { moduleId: module.id }, "game-runtime");
    }
  } catch (error) {
    const errors: unknown[] = [error];
    for (const cleanup of [...cleanups].reverse()) {
      try {
        cleanup();
      } catch (cleanupError) {
        errors.push(cleanupError);
      }
    }
    if (errors.length > 1)
      throw new AggregateError(errors, "Module installation and cleanup failed");
    throw error;
  }

  return {
    world: config.world,
    eventBus: config.eventBus,
    rng,
    clock,
    systems: systemRegistry,
    modules: installedModules.values(),
    start() {
      if (disposed) {
        return;
      }

      if (clock.snapshot().running) {
        return;
      }

      clock.start();
      config.eventBus.emit("runtime.started", { seed: config.seed }, "game-runtime");
    },
    stop() {
      if (disposed) {
        return;
      }

      if (!clock.snapshot().running) {
        return;
      }

      clock.stop();
      config.eventBus.emit("runtime.stopped", {}, "game-runtime");
    },
    tick(delta) {
      if (disposed) {
        return;
      }

      const snapshot = clock.tick(delta);
      if (!snapshot.running) {
        return;
      }

      const frameHandle = profiler?.startFrame?.({
        tick: snapshot.ticks,
        deltaMs: snapshot.delta,
        timestamp: snapshot.elapsed
      });
      try {
        for (const system of systemRegistry.values()) {
          const startedAt = Date.now();
          const spanHandle = profiler?.beginSystem?.({
            systemId: system.id,
            tick: snapshot.ticks,
            ...(frameHandle === undefined ? {} : { frameId: frameHandle.id }),
            startedAt
          });
          try {
            system.update({
              world: config.world,
              delta: snapshot.delta,
              elapsed: snapshot.elapsed,
              tick: snapshot.ticks
            });
            if (spanHandle) {
              profiler?.endSystem?.(spanHandle, {
                durationMs: Math.max(0, Date.now() - startedAt)
              });
            }
          } catch (error) {
            if (spanHandle) {
              profiler?.endSystem?.(spanHandle, {
                durationMs: Math.max(0, Date.now() - startedAt),
                error
              });
            }
            throw error;
          }
        }
      } finally {
        if (frameHandle) {
          profiler?.endFrame?.(frameHandle);
        }
      }
    },
    setProfiler(nextProfiler) {
      profiler = nextProfiler;
    },
    dispose() {
      if (disposed) {
        return;
      }

      disposed = true;
      const errors: unknown[] = [];
      const attempt = (operation: () => void): void => {
        try {
          operation();
        } catch (error) {
          errors.push(error);
        }
      };
      if (clock.snapshot().running) {
        clock.stop();
        attempt(() => config.eventBus.emit("runtime.stopped", {}, "game-runtime"));
      }
      for (const cleanup of [...cleanups].reverse()) attempt(cleanup);
      cleanups.length = 0;
      attempt(() => config.eventBus.emit("runtime.disposed", {}, "game-runtime"));
      if (errors.length === 1) throw errors[0];
      if (errors.length > 1) throw new AggregateError(errors, "Game runtime cleanup failed");
    },
    isRunning() {
      return !disposed && clock.snapshot().running;
    }
  };
}

function toModuleCleanup(result: GameModuleInstallResult): (() => void) | undefined {
  if (typeof result === "function") {
    return result;
  }

  if (result && typeof result.dispose === "function") {
    return () => result.dispose();
  }

  return undefined;
}
