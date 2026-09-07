import type { DataRegistry } from "@gamekits/data";
import type { EventBus, GameEvent } from "@gamekits/event-bus";
import type { GasAbilityExecutionState } from "@gamekits/gas";
import { COMBAT_ABILITY_DELIVERY_TYPE } from "../data/combat-data-types";
import type {
  CombatAbilityDeliveryBridgeConfig,
  CombatAbilityDeliveryDefinition,
  CombatAbilityDeliveryFailure,
  CombatDeliveryRequest,
  CombatGasFacade,
  CombatRuntime
} from "./types";

export type CreateCombatAbilityDeliveryBridgeOptions = CombatAbilityDeliveryBridgeConfig & {
  id?: string | undefined;
  eventBus: EventBus;
  dataRegistry: DataRegistry;
  gas: CombatGasFacade;
  combat: Pick<CombatRuntime, "deliver">;
};

export type CombatAbilityDeliveryBridge = {
  dispose(): void;
};

export function createCombatAbilityDeliveryBridge(
  options: CreateCombatAbilityDeliveryBridgeOptions
): CombatAbilityDeliveryBridge {
  const source = options.id ?? "gamekits.combat.ability-delivery";
  const bindingsByAbility = indexBindings(options.dataRegistry, options.bindings);
  let disposed = false;
  const unsubscribe = options.eventBus.on<GasAbilityExecutionState>(
    "gas.ability_execution_phase",
    (event) => {
      if (disposed || event.payload.phase !== "committed") {
        return;
      }
      const bindings = bindingsByAbility.get(event.payload.abilityId);
      if (bindings === undefined) {
        return;
      }
      for (const binding of bindings) {
        dispatchBinding(binding, event);
      }
    }
  );

  function dispatchBinding(
    binding: CombatAbilityDeliveryDefinition,
    event: GameEvent<GasAbilityExecutionState>
  ): void {
    const execution = event.payload;
    const actor = options.gas.hasActor(execution.actorId)
      ? options.gas.getActor(execution.actorId)
      : undefined;
    const request: CombatDeliveryRequest = {
      id: `${execution.id}:${binding.id}`,
      sourceActorId: execution.actorId,
      ...(actor?.actor.entityId === undefined ? {} : { sourceEntityId: actor.actor.entityId }),
      executionId: execution.id,
      definition: { type: "combat.delivery", id: binding.delivery.id },
      ...(execution.targetActorId === undefined ? {} : { targetActorId: execution.targetActorId }),
      issuedAt: execution.committedAt ?? execution.phaseStartedAt,
      correlationId: event.correlationId ?? execution.correlationId ?? execution.id,
      ...((event.parentId ?? execution.parentTraceId) === undefined
        ? {}
        : { parentId: event.parentId ?? execution.parentTraceId })
    };
    const context = { binding, execution, request };
    try {
      const overrides = options.resolveRequest?.(context);
      if (overrides === false) {
        return;
      }
      const resolvedRequest = overrides === undefined ? request : { ...request, ...overrides };
      const result = options.combat.deliver(resolvedRequest);
      safelyNotify(() =>
        options.onResult?.({ binding, execution, request: resolvedRequest, result })
      );
    } catch (error) {
      const failure: CombatAbilityDeliveryFailure = { ...context, error };
      options.eventBus.emit(
        "combat.ability_delivery_failed",
        {
          bindingId: binding.id,
          executionId: execution.id,
          message: error instanceof Error ? error.message : String(error)
        },
        source,
        { correlationId: request.correlationId, parentId: request.parentId }
      );
      safelyNotify(() => options.onError?.(failure));
    }
  }

  return {
    dispose() {
      if (disposed) {
        return;
      }
      disposed = true;
      unsubscribe();
      bindingsByAbility.clear();
    }
  };
}

function indexBindings(
  dataRegistry: DataRegistry,
  selected: CombatAbilityDeliveryBridgeConfig["bindings"]
): Map<string, CombatAbilityDeliveryDefinition[]> {
  const definitions =
    selected === undefined
      ? dataRegistry
          .list<CombatAbilityDeliveryDefinition>(COMBAT_ABILITY_DELIVERY_TYPE)
          .map((document) => document.data)
      : selected.map((reference) =>
          dataRegistry.getValue<CombatAbilityDeliveryDefinition>(
            COMBAT_ABILITY_DELIVERY_TYPE,
            reference.id
          )
        );
  const result = new Map<string, CombatAbilityDeliveryDefinition[]>();
  for (const definition of definitions) {
    const entries = result.get(definition.ability.id) ?? [];
    entries.push(definition);
    result.set(definition.ability.id, entries);
  }
  return result;
}

function safelyNotify(notify: () => void): void {
  try {
    notify();
  } catch {
    // Observer failures cannot break authoritative GAS/Combat execution.
  }
}
