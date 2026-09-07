import { defineGameModule, type GameModule } from "@gamekits/core";
import type { GameInstallContext } from "@gamekits/game-runtime";
import { bindNavigationHandle, unbindNavigationHandle } from "./create-navigation-handle";
import { createNavigationRuntime } from "./create-navigation-runtime";
import type { NavigationRuntime } from "../contracts/facade";
import type { CreateNavigationModuleOptions } from "./types";

export function createNavigationModule(
  options: CreateNavigationModuleOptions
): GameModule<GameInstallContext> {
  const moduleId = options.id ?? "navigation";
  return defineGameModule<GameInstallContext>({
    id: moduleId,
    install(context) {
      let runtime: NavigationRuntime | undefined;
      let handleBound = false;
      try {
        runtime = createNavigationRuntime({ ...options, id: moduleId });
        if (options.handle !== undefined) {
          bindNavigationHandle(options.handle, runtime, moduleId);
          handleBound = true;
        }
        options.onRuntime?.(runtime, context);
        context.systems.register({
          id: `${moduleId}.requests`,
          update(systemContext) {
            runtime?.update(systemContext.delta, systemContext.elapsed);
          }
        });
      } catch (error) {
        if (handleBound && options.handle !== undefined) {
          unbindNavigationHandle(options.handle, moduleId);
        }
        runtime?.dispose();
        throw error;
      }
      return {
        dispose() {
          if (options.handle !== undefined) {
            unbindNavigationHandle(options.handle, moduleId);
          }
          runtime?.dispose();
          runtime = undefined;
        }
      };
    }
  });
}
