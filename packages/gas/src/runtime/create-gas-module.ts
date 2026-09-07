import { defineGameModule } from "@gamekits/core";
import type { GameInstallContext } from "@gamekits/game-runtime";
import { bindGasHandle, unbindGasHandle } from "./create-gas-handle";
import { createGasRuntime } from "./create-gas-runtime";
import type { CreateGasModuleConfig } from "./types";

export function createGasModule(config: CreateGasModuleConfig) {
  return defineGameModule<GameInstallContext>({
    id: config.id ?? "gamekits.gas",
    install(ctx) {
      const moduleId = config.id ?? "gamekits.gas";
      const runtime = createGasRuntime({
        world: ctx.world,
        dataRegistry: config.dataRegistry,
        eventBus: config.eventBus ?? ctx.eventBus,
        traceStore: config.traceStore,
        abilityExecutions: config.abilityExecutions
      });

      let handleBound = false;
      try {
        if (config.handle) {
          bindGasHandle(config.handle, runtime, moduleId);
          handleBound = true;
        }
        config.onRuntime?.(runtime);
      } catch (error) {
        if (config.handle && handleBound) {
          unbindGasHandle(config.handle, moduleId);
        }
        runtime.dispose();
        throw error;
      }

      ctx.systems.register({
        id: `${moduleId}.effects`,
        update(systemCtx) {
          runtime.update(systemCtx.delta, systemCtx.elapsed);
        }
      });

      return () => {
        if (config.handle) {
          unbindGasHandle(config.handle, moduleId);
        }
        runtime.dispose();
      };
    }
  });
}
