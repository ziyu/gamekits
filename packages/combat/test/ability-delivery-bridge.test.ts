import {
  createCombatAbilityDeliveryBridge,
  createCombatDataTypes,
  type CombatDeliveryRequest,
  type CombatDeliveryRequestResult,
  type CombatGasFacade
} from "@gamekits/combat";
import { createDataRegistry, type DataPack } from "@gamekits/data";
import { createEventBus } from "@gamekits/event-bus";
import {
  createGasDataTypes,
  type GasAbilityExecutionState,
  type GasActorRuntimeState
} from "@gamekits/gas";
import { describe, expect, it, vi } from "vitest";

describe("Combat GAS ability delivery bridge", () => {
  it("maps the committed phase to one correlated Combat delivery request", () => {
    const dataRegistry = createRegistry();
    const eventBus = createEventBus({ clock: () => 40 });
    const requests: CombatDeliveryRequest[] = [];
    const result: CombatDeliveryRequestResult = {
      status: "resolved",
      duplicate: false,
      requestId: "execution.1:binding.attack",
      deliveryType: "direct",
      hits: [],
      ignoredCandidates: 0,
      queriedCandidates: 0,
      correlationId: "correlation.attack"
    };
    const onResult = vi.fn();
    const bridge = createCombatAbilityDeliveryBridge({
      dataRegistry,
      eventBus,
      gas: createGasFacade(),
      combat: {
        deliver(request) {
          requests.push(request);
          return result;
        }
      },
      resolveRequest() {
        return { direction: { x: 0, y: 1 } };
      },
      onResult
    });

    eventBus.emit("gas.ability_execution_phase", execution("preparing"), "gas", {
      correlationId: "correlation.attack",
      parentId: "gas.phase.1"
    });
    expect(requests).toEqual([]);

    eventBus.emit("gas.ability_execution_phase", execution("committed"), "gas", {
      correlationId: "correlation.attack",
      parentId: "gas.phase.2"
    });

    expect(requests).toEqual([
      {
        id: "execution.1:binding.attack",
        sourceActorId: "actor.source",
        sourceEntityId: "entity.source",
        executionId: "execution.1",
        definition: { type: "combat.delivery", id: "delivery.attack" },
        targetActorId: "actor.target",
        issuedAt: 20,
        correlationId: "correlation.attack",
        parentId: "gas.phase.2",
        direction: { x: 0, y: 1 }
      }
    ]);
    expect(onResult).toHaveBeenCalledWith(
      expect.objectContaining({
        binding: expect.objectContaining({ id: "binding.attack" }),
        execution: expect.objectContaining({ id: "execution.1" }),
        result
      })
    );

    bridge.dispose();
    eventBus.emit("gas.ability_execution_phase", execution("committed"), "gas");
    expect(requests).toHaveLength(1);
  });

  it("isolates resolver and observer errors from GAS phase dispatch", () => {
    const dataRegistry = createRegistry();
    const eventBus = createEventBus();
    const failures: unknown[] = [];
    const facts: unknown[] = [];
    eventBus.on("combat.ability_delivery_failed", (event) => facts.push(event.payload));
    const bridge = createCombatAbilityDeliveryBridge({
      dataRegistry,
      eventBus,
      gas: createGasFacade(),
      combat: {
        deliver() {
          throw new Error("delivery should not run after resolver failure");
        }
      },
      resolveRequest() {
        throw new Error("aim context unavailable");
      },
      onError(failure) {
        failures.push(failure);
        throw new Error("observer failure");
      }
    });

    expect(() =>
      eventBus.emit("gas.ability_execution_phase", execution("committed"), "gas")
    ).not.toThrow();
    expect(facts).toEqual([
      expect.objectContaining({
        bindingId: "binding.attack",
        executionId: "execution.1",
        message: "aim context unavailable"
      })
    ]);
    expect(failures).toHaveLength(1);
    bridge.dispose();
  });
});

function createRegistry() {
  const registry = createDataRegistry();
  for (const type of [...createGasDataTypes(), ...createCombatDataTypes()]) {
    registry.registerType(type);
  }
  const pack: DataPack = {
    id: "combat.bridge.test",
    version: "1.0.0",
    entries: [
      {
        type: "gas.ability",
        id: "ability.attack",
        data: { id: "ability.attack", execution: {} }
      },
      {
        type: "gas.effect",
        id: "effect.attack",
        data: { id: "effect.attack" }
      },
      {
        type: "combat.relationship-policy",
        id: "policy.hostile",
        data: { id: "policy.hostile" }
      },
      {
        type: "combat.delivery",
        id: "delivery.attack",
        data: {
          id: "delivery.attack",
          delivery: { type: "direct", targetActorId: "actor.target" },
          payloads: [{ effectId: "effect.attack", target: "hit-actor" }],
          relationshipPolicy: "policy.hostile"
        }
      },
      {
        type: "combat.ability-delivery",
        id: "binding.attack",
        data: {
          id: "binding.attack",
          ability: { type: "gas.ability", id: "ability.attack" },
          delivery: { type: "combat.delivery", id: "delivery.attack" }
        }
      }
    ]
  };
  const validation = registry.registerPack(pack);
  expect(validation.diagnostics.filter((entry) => entry.severity === "error")).toEqual([]);
  return registry;
}

function execution(phase: GasAbilityExecutionState["phase"]): GasAbilityExecutionState {
  return {
    id: "execution.1",
    actorId: "actor.source",
    abilityId: "ability.attack",
    targetActorId: "actor.target",
    phase,
    requestedAt: 10,
    phaseStartedAt: phase === "committed" ? 20 : 10,
    ...(phase === "committed" ? { committedAt: 20 } : {}),
    costCommitted: phase === "committed",
    cooldownCommitted: phase === "committed",
    paidCosts: [],
    appliedEffects: []
  };
}

function createGasFacade(): CombatGasFacade {
  const actor = {
    actor: {
      actorId: "actor.source",
      definitionId: "actor.definition",
      entityId: "entity.source"
    },
    attributes: { base: {}, current: {} },
    tags: { values: [] },
    abilities: { ids: ["ability.attack"], cooldowns: {}, disabled: [] },
    effects: { active: [] }
  } satisfies GasActorRuntimeState;
  return {
    hasActor: (actorId) => actorId === actor.actor.actorId,
    getActor: () => actor,
    actorForEntity: () => undefined,
    getAbilityExecution: () => undefined,
    applyEffect: vi.fn()
  };
}
