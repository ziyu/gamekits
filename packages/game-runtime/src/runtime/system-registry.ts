import { GameError, Registry } from "@gamekits/core";
import type { WorldSystem } from "@gamekits/world";
import type { SystemRegistry } from "./types";

export function createSystemRegistry(): SystemRegistry {
  const systems = new Registry<WorldSystem>();

  return {
    register(system) {
      if (!system.id) {
        throw new GameError("system.invalid_id", "World system id cannot be empty");
      }

      systems.register(system.id, system);
    },
    values() {
      return systems.values();
    }
  };
}
