import { createNavigationError } from "@gamekits/navigation-core";
import { init } from "recast-navigation";

let initialization: Promise<void> | undefined;
let initialized = false;

export function initializeRecastNavigation(): Promise<void> {
  if (initialization === undefined) {
    initialization = init()
      .then(() => {
        initialized = true;
      })
      .catch((error: unknown) => {
        initialization = undefined;
        throw createNavigationError(
          "navigation.recast_initialization_failed",
          "Recast navigation WebAssembly initialization failed",
          { cause: error instanceof Error ? error.message : String(error) }
        );
      });
  }
  return initialization;
}

export function isRecastNavigationInitialized(): boolean {
  return initialized;
}

export function requireRecastNavigationInitialized(): void {
  if (!initialized) {
    throw createNavigationError(
      "navigation.recast_not_initialized",
      "Recast navigation is not initialized; await initializeRecastNavigation() before creating or baking a backend"
    );
  }
}
