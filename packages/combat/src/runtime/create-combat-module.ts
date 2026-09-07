import { defineGameModule, type GameModule } from "@gamekits/core";
import type { GameInstallContext } from "@gamekits/game-runtime";
import { createCombatAbilityDeliveryBridge } from "./create-combat-ability-delivery-bridge";
import { bindCombatHandle, unbindCombatHandle } from "./create-combat-handle";
import { createCombatRuntime } from "./create-combat-runtime";
import type { CombatRuntime, CreateCombatModuleConfig } from "./types";

export function createCombatModule(
  options: CreateCombatModuleConfig
): GameModule<GameInstallContext> {
  const moduleId = options.id ?? "combat";
  return defineGameModule<GameInstallContext>({
    id: moduleId,
    install(ctx) {
      let runtime: CombatRuntime | undefined;
      let disposeAbilityDelivery: (() => void) | undefined;
      let handleBound = false;
      try {
        runtime = createCombatRuntime({
          ...options,
          id: moduleId,
          world: ctx.world,
          eventBus: options.eventBus ?? ctx.eventBus
        });
        if (options.handle !== undefined) {
          bindCombatHandle(options.handle, runtime, moduleId);
          handleBound = true;
        }
        options.onRuntime?.(runtime);
        if (options.abilityDelivery !== undefined) {
          const bridge = createCombatAbilityDeliveryBridge({
            ...options.abilityDelivery,
            id: `${moduleId}.ability-delivery`,
            eventBus: options.eventBus ?? ctx.eventBus,
            dataRegistry: options.dataRegistry,
            gas: options.gas,
            combat: runtime
          });
          disposeAbilityDelivery = () => bridge.dispose();
        }
        ctx.systems.register({
          id: `${moduleId}.resolve`,
          update(systemCtx) {
            runtime?.update(systemCtx.delta, systemCtx.elapsed);
          }
        });
      } catch (error) {
        if (handleBound && options.handle !== undefined) {
          unbindCombatHandle(options.handle, moduleId);
        }
        disposeAbilityDelivery?.();
        runtime?.dispose();
        throw error;
      }
      return {
        dispose() {
          disposeAbilityDelivery?.();
          disposeAbilityDelivery = undefined;
          if (options.handle !== undefined) {
            unbindCombatHandle(options.handle, moduleId);
          }
          runtime?.dispose();
          runtime = undefined;
        }
      };
    }
  });
}
