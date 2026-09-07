import { defineGameModule, type GameModule } from "@gamekits/core";
import type { GameInstallContext } from "@gamekits/game-runtime";
import type { AnimatorRuntime } from "../controller/animator-controller";
import { bindAnimatorHandle, unbindAnimatorHandle } from "../controller/create-animator-handle";
import { createAnimatorRuntime } from "./create-animator-runtime";
import type { CreateAnimatorModuleOptions } from "./options";

export function createAnimatorModule(
  options: CreateAnimatorModuleOptions
): GameModule<GameInstallContext> {
  const moduleId = options.id ?? "animator";
  return defineGameModule<GameInstallContext>({
    id: moduleId,
    install(context) {
      let runtime: AnimatorRuntime | undefined;
      let handleBound = false;
      try {
        runtime = createAnimatorRuntime({
          ...options,
          id: moduleId,
          eventBus: options.eventBus ?? context.eventBus
        });
        if (options.handle !== undefined) {
          bindAnimatorHandle(options.handle, runtime, moduleId);
          handleBound = true;
        }
        options.onRuntime?.(runtime, context);
        context.systems.register({
          id: `${moduleId}.update`,
          update(systemContext) {
            runtime?.update(systemContext.delta, systemContext.elapsed);
          }
        });
      } catch (error) {
        if (handleBound && options.handle !== undefined) {
          unbindAnimatorHandle(options.handle, moduleId);
        }
        runtime?.dispose();
        throw error;
      }
      return {
        dispose() {
          if (options.handle !== undefined) {
            unbindAnimatorHandle(options.handle, moduleId);
          }
          runtime?.dispose();
          runtime = undefined;
        }
      };
    }
  });
}
