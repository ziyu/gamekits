import { createDataRegistry, type DataPack } from "@gamekits/data";
import { createEventBus, type GameEvent } from "@gamekits/event-bus";
import type { TcaHandlerContext } from "@gamekits/tca";
import type { ComponentDef, EntityId, GameWorld } from "@gamekits/world";
import { describe, expect, it } from "vitest";
import {
  createGasDataTypes,
  createGasRuntime,
  createGasSaveContributor,
  createGasHandle,
  createGasModule,
  createGasTcaDefinitions,
  GasAbilityExecutions,
  type GasAbilityDefinition,
  type GasEffectDefinition,
  type GasAbilityExecutionState,
  type GasRuntime
} from "../src";
import { createGame } from "@gamekits/game-runtime";

describe("GAS ability execution data", () => {
  it("validates execution durations, concurrency, commit and phase policies", () => {
    const registry = createRegistry(false);
    const validation = registry.validatePack({
      id: "gas.execution.invalid",
      version: "1.0.0",
      entries: [
        {
          type: "gas.ability",
          id: "ability.invalid",
          data: {
            id: "ability.invalid",
            execution: {
              preparingMs: -1,
              activeMs: Number.POSITIVE_INFINITY,
              maxConcurrent: 0,
              costCommit: "later",
              overflow: "queue",
              cancellation: { afterCommit: "sometimes" },
              phaseCues: { unknown: ["cue.cast"] }
            }
          }
        }
      ]
    });

    expect(validation.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(
      expect.arrayContaining([
        "gas.ability_invalid_execution_duration",
        "gas.ability_invalid_execution_commit",
        "gas.ability_invalid_execution_cancellation",
        "gas.ability_invalid_execution_concurrency",
        "gas.ability_invalid_execution_overflow",
        "gas.ability_invalid_execution_phase"
      ])
    );
  });
});

describe("GAS ability execution runtime", () => {
  it.each(["missing-reference", "invalid-period"])(
    "preflights every effect before accepting a request: %s",
    (failure) => {
      const dataRegistry = createRegistry(false);
      dataRegistry.registerPack(structuredClone(EXECUTION_PACK));
      const ability = dataRegistry.getValue<GasAbilityDefinition>("gas.ability", "ability.timed");
      ability.execution = {
        preparingMs: 100,
        costCommit: "requested",
        cooldownCommit: "requested"
      };
      ability.effects = [
        { effectId: "effect.progress", target: "self" },
        {
          effectId: failure === "missing-reference" ? "effect.missing" : "effect.damage",
          target: "target"
        }
      ];
      if (failure === "invalid-period") {
        dataRegistry.getValue<GasEffectDefinition>("gas.effect", "effect.damage").periodMs = 0;
      }
      const eventBus = createEventBus();
      const activated: unknown[] = [];
      eventBus.on("gas.ability_activated", (event) => activated.push(event));
      const runtime = createGasRuntime({ world: createMemoryWorld(), dataRegistry, eventBus });
      runtime.createActor({ actorId: "source", definitionId: "actor.executor" });
      runtime.createActor({ actorId: "target", definitionId: "actor.executor" });
      const before = runtime.captureCheckpoint();

      expect(() =>
        runtime.requestAbilityExecution({
          actorId: "source",
          targetActorId: "target",
          abilityId: "ability.timed"
        })
      ).toThrow();

      expect(runtime.captureCheckpoint()).toEqual(before);
      expect(activated).toEqual([]);
    }
  );

  it("cancels a prepared execution if an effect becomes invalid before commit", () => {
    const dataRegistry = createRegistry(false);
    dataRegistry.registerPack(structuredClone(EXECUTION_PACK));
    const runtime = createGasRuntime({
      world: createMemoryWorld(),
      dataRegistry,
      eventBus: createEventBus()
    });
    runtime.createActor({ actorId: "source", definitionId: "actor.executor" });
    runtime.createActor({ actorId: "target", definitionId: "actor.executor" });
    const requested = runtime.requestAbilityExecution({
      actorId: "source",
      targetActorId: "target",
      abilityId: "ability.timed"
    });
    expect(requested.status).toBe("accepted");
    dataRegistry.getValue<GasEffectDefinition>("gas.effect", "effect.damage").periodMs = 0;

    runtime.update(100, 100);

    expect(runtime.getActor("source").attributes.current.energy).toBe(100);
    expect(runtime.getActor("source").abilities.cooldowns).toEqual({});
    expect(runtime.getActor("target").attributes.current.health).toBe(100);
    expect(runtime.listAbilityExecutions({ includeRecent: true })).toMatchObject([
      { phase: "cancelled", cancellationReason: "effects-invalid-at-commit", costCommitted: false }
    ]);
  });

  it("advances ordered phases and commits cost, cooldown and effects at the boundary", () => {
    const world = createMemoryWorld();
    const eventBus = createEventBus();
    const events: Array<GameEvent<GasAbilityExecutionState>> = [];
    eventBus.on<GasAbilityExecutionState>("gas.ability_execution_phase", (event) => {
      events.push(event);
    });
    const runtime = createRuntime(world, eventBus);
    const sourceEntity = world.spawn();
    runtime.createActor({
      actorId: "actor.source",
      definitionId: "actor.executor",
      entityId: sourceEntity
    });
    runtime.createActor({ actorId: "actor.target", definitionId: "actor.executor" });
    expect(world.get(sourceEntity, GasAbilityExecutions)).toBeUndefined();

    const requested = runtime.requestAbilityExecution({
      actorId: "actor.source",
      abilityId: "ability.timed",
      targetActorId: "actor.target",
      requestId: "command-1",
      correlationId: "network-1"
    });

    expect(requested).toMatchObject({
      status: "accepted",
      duplicate: false,
      execution: { phase: "preparing", phaseEndsAt: 100 }
    });
    expect(runtime.getActor("actor.source").attributes.current.energy).toBe(100);
    expect(runtime.getActor("actor.target").attributes.current.health).toBe(100);
    expect(world.get(sourceEntity, GasAbilityExecutions)?.active).toMatchObject([
      { id: requested.status === "accepted" ? requested.execution.id : "", phase: "preparing" }
    ]);

    runtime.update(100, 100);
    const active =
      requested.status === "accepted"
        ? runtime.getAbilityExecution(requested.execution.id)
        : undefined;
    expect(active).toMatchObject({
      phase: "active",
      committedAt: 100,
      phaseEndsAt: 150,
      costCommitted: true,
      cooldownCommitted: true,
      cooldownUntil: 600,
      paidCosts: [{ attribute: "energy", amount: 10 }]
    });
    expect(runtime.getActor("actor.source").attributes.current.energy).toBe(90);
    expect(runtime.getActor("actor.target").attributes.current.health).toBe(90);

    runtime.update(50, 150);
    expect(
      requested.status === "accepted"
        ? runtime.getAbilityExecution(requested.execution.id)?.phase
        : undefined
    ).toBe("recovering");
    runtime.update(25, 175);
    expect(
      requested.status === "accepted"
        ? runtime.getAbilityExecution(requested.execution.id)
        : undefined
    ).toMatchObject({ phase: "completed", completedAt: 175 });
    expect(world.get(sourceEntity, GasAbilityExecutions)).toBeUndefined();
    expect(events.map((event) => event.payload.phase)).toEqual([
      "requested",
      "preparing",
      "committed",
      "active",
      "recovering",
      "completed"
    ]);
    expect(events.every((event) => event.correlationId === "network-1")).toBe(true);
  });

  it("keeps instant activation synchronous through the execution contract", () => {
    const eventBus = createEventBus();
    const executionFacts: string[] = [];
    eventBus.onAny((event) => {
      if (event.type.startsWith("gas.ability_execution_")) {
        executionFacts.push(event.type);
      }
    });
    const runtime = createRuntime(createMemoryWorld(), eventBus);
    runtime.createActor({ actorId: "actor.source", definitionId: "actor.executor" });

    const result = runtime.activateAbility({
      actorId: "actor.source",
      abilityId: "ability.scan"
    });

    expect(result).toMatchObject({
      status: "activated",
      phase: "completed",
      paidCosts: [],
      appliedEffects: [{ effectId: "effect.progress", status: "applied" }]
    });
    expect(runtime.getActor("actor.source").attributes.current.progress).toBe(1);
    expect(
      result.status === "activated" ? runtime.getAbilityExecution(result.executionId) : null
    ).toMatchObject({ phase: "completed" });
    expect(runtime.listAbilityExecutions()).toEqual([]);
    expect(
      runtime.traceStore
        .list()
        .filter((entry) => entry.abilityId === "ability.scan")
        .map((entry) => entry.type)
    ).toEqual(["ability.activated"]);
    expect(executionFacts).toEqual([]);
  });

  it("deduplicates requests without paying twice and rejects conflicting reuse", () => {
    const runtime = createRuntime(createMemoryWorld());
    runtime.createActor({ actorId: "actor.source", definitionId: "actor.executor" });

    const first = runtime.requestAbilityExecution({
      actorId: "actor.source",
      abilityId: "ability.request-commit",
      requestId: "command-7"
    });
    const duplicate = runtime.requestAbilityExecution({
      actorId: "actor.source",
      abilityId: "ability.request-commit",
      requestId: "command-7"
    });
    const conflict = runtime.requestAbilityExecution({
      actorId: "actor.source",
      abilityId: "ability.scan",
      requestId: "command-7"
    });

    expect(first).toMatchObject({
      status: "accepted",
      duplicate: false,
      execution: { phase: "preparing", costCommitted: true, cooldownCommitted: true }
    });
    expect(duplicate).toMatchObject({
      status: "accepted",
      duplicate: true,
      execution: { id: first.status === "accepted" ? first.execution.id : "" }
    });
    expect(conflict).toMatchObject({
      status: "rejected",
      reason: "duplicate-request-conflict"
    });
    expect(runtime.getActor("actor.source").attributes.current.energy).toBe(95);
  });

  it("cancels before commit, enforces post-commit policy, and interrupts by tag", () => {
    const runtime = createRuntime(createMemoryWorld());
    runtime.createActor({ actorId: "actor.source", definitionId: "actor.executor" });
    runtime.createActor({ actorId: "actor.target", definitionId: "actor.executor" });

    const beforeCommit = runtime.requestAbilityExecution({
      actorId: "actor.source",
      abilityId: "ability.timed",
      targetActorId: "actor.target"
    });
    expect(beforeCommit.status).toBe("accepted");
    const cancelled =
      beforeCommit.status === "accepted"
        ? runtime.cancelAbilityExecution({ executionId: beforeCommit.execution.id })
        : undefined;
    expect(cancelled).toMatchObject({
      status: "cancelled",
      execution: { phase: "cancelled", cancellationReason: "requested" }
    });
    expect(runtime.getActor("actor.source").attributes.current.energy).toBe(100);

    const committed = runtime.requestAbilityExecution({
      actorId: "actor.source",
      abilityId: "ability.timed",
      targetActorId: "actor.target"
    });
    runtime.update(100, 100);
    expect(
      committed.status === "accepted"
        ? runtime.cancelAbilityExecution({ executionId: committed.execution.id })
        : undefined
    ).toMatchObject({ status: "rejected", reason: "cancellation-blocked" });

    runtime.update(75, 175);
    const interruptible = runtime.requestAbilityExecution({
      actorId: "actor.source",
      abilityId: "ability.interruptible"
    });
    runtime.addTag("actor.source", "state.stunned", "test");
    runtime.update(1, 176);
    expect(
      interruptible.status === "accepted"
        ? runtime.getAbilityExecution(interruptible.execution.id)
        : undefined
    ).toMatchObject({ phase: "cancelled", cancellationReason: "interrupt-tag:state.stunned" });
  });

  it("cancels at commit when reserved resources are no longer available", () => {
    const runtime = createRuntime(createMemoryWorld());
    runtime.createActor({ actorId: "actor.source", definitionId: "actor.executor" });
    runtime.createActor({ actorId: "actor.target", definitionId: "actor.executor" });
    const requested = runtime.requestAbilityExecution({
      actorId: "actor.source",
      abilityId: "ability.timed",
      targetActorId: "actor.target"
    });
    runtime.modifyAttribute("actor.source", {
      attribute: "energy",
      operation: "set",
      value: 0
    });

    runtime.update(100, 100);

    expect(
      requested.status === "accepted"
        ? runtime.getAbilityExecution(requested.execution.id)
        : undefined
    ).toMatchObject({ phase: "cancelled", cancellationReason: "costs-unavailable-at-commit" });
    expect(runtime.getActor("actor.source").abilities.cooldowns["ability.timed"]).toBeUndefined();
    expect(runtime.getActor("actor.target").attributes.current.health).toBe(100);
  });

  it("removes active execution state with its actor", () => {
    const world = createMemoryWorld();
    const runtime = createRuntime(world);
    const entity = world.spawn();
    runtime.createActor({
      actorId: "actor.source",
      definitionId: "actor.executor",
      entityId: entity
    });
    const requested = runtime.requestAbilityExecution({
      actorId: "actor.source",
      abilityId: "ability.interruptible"
    });

    expect(runtime.removeActor("actor.source")).toBe(true);
    expect(runtime.listAbilityExecutions()).toEqual([]);
    expect(
      requested.status === "accepted"
        ? runtime.getAbilityExecution(requested.execution.id)
        : undefined
    ).toMatchObject({ phase: "cancelled", cancellationReason: "actor-explicit" });
    expect(world.get(entity, GasAbilityExecutions)).toBeUndefined();
  });

  it("restores active executions and continues stable execution ids", () => {
    const runtime = createRuntime(createMemoryWorld());
    runtime.createActor({ actorId: "actor.source", definitionId: "actor.executor" });
    runtime.createActor({ actorId: "actor.target", definitionId: "actor.executor" });
    const requested = runtime.requestAbilityExecution({
      actorId: "actor.source",
      abilityId: "ability.timed",
      targetActorId: "actor.target",
      requestId: "checkpoint-command"
    });
    runtime.update(50, 50);
    const checkpoint = runtime.captureCheckpoint();
    runtime.update(125, 175);

    runtime.restoreCheckpoint(checkpoint);

    expect(runtime.snapshot().activeExecutions).toMatchObject([
      {
        id: requested.status === "accepted" ? requested.execution.id : "",
        phase: "preparing",
        phaseEndsAt: 100
      }
    ]);
    expect(
      runtime.requestAbilityExecution({
        actorId: "actor.source",
        abilityId: "ability.timed",
        targetActorId: "actor.target",
        requestId: "checkpoint-command"
      })
    ).toMatchObject({ status: "accepted", duplicate: true });

    runtime.update(125, 175);
    const next = runtime.requestAbilityExecution({
      actorId: "actor.source",
      abilityId: "ability.interruptible",
      requestId: "next-command"
    });
    expect(next.status === "accepted" ? next.execution.id : "").not.toBe(
      requested.status === "accepted" ? requested.execution.id : ""
    );
  });

  it("preflights invalid execution checkpoints without mutating current runtime state", () => {
    const runtime = createRuntime(createMemoryWorld());
    runtime.createActor({ actorId: "actor.source", definitionId: "actor.executor" });
    const requested = runtime.requestAbilityExecution({
      actorId: "actor.source",
      abilityId: "ability.interruptible",
      requestId: "atomic-restore"
    });
    runtime.update(50, 50);
    const before = runtime.snapshot();
    const invalid = runtime.captureCheckpoint();
    invalid.executions = invalid.executions?.map((execution) => ({
      ...execution,
      abilityId: "ability.missing"
    }));

    expect(() => runtime.restoreCheckpoint(invalid)).toThrowError(
      expect.objectContaining({ code: "gas.checkpoint_missing_ability" })
    );
    expect(runtime.snapshot()).toEqual(before);
    expect(
      requested.status === "accepted"
        ? runtime.getAbilityExecution(requested.execution.id)
        : undefined
    ).toMatchObject({ phase: "active", requestId: "atomic-restore" });
  });

  it("binds execution query and cancellation through the standard GAS handle", () => {
    const world = createMemoryWorld();
    const handle = createGasHandle();
    const game = createGame({
      world,
      eventBus: createEventBus(),
      seed: "gas-execution-handle",
      modules: [createGasModule({ dataRegistry: createRegistry(), handle })]
    });
    handle.createActor({ actorId: "actor.source", definitionId: "actor.executor" });
    const requested = handle.requestAbilityExecution({
      actorId: "actor.source",
      abilityId: "ability.interruptible"
    });

    expect(handle.listAbilityExecutions()).toHaveLength(1);
    expect(
      requested.status === "accepted"
        ? handle.cancelAbilityExecution({ executionId: requested.execution.id })
        : undefined
    ).toMatchObject({ status: "cancelled" });
    game.dispose();
    expect(handle.isBound()).toBe(false);
  });

  it("exposes execution request, phase query and cancellation through TCA definitions", () => {
    const eventBus = createEventBus();
    const runtime = createRuntime(createMemoryWorld(), eventBus);
    const definitions = createGasTcaDefinitions({ runtime: () => runtime });
    const activate = definitions.actions?.find((action) => action.type === "gas.activate_ability");
    const phase = definitions.conditions?.find(
      (condition) => condition.type === "gas.execution.phase"
    );
    const cancel = definitions.actions?.find(
      (action) => action.type === "gas.cancel_ability_execution"
    );
    const context: TcaHandlerContext = {
      event: { type: "test", payload: {}, timestamp: 0 },
      eventBus,
      rule: {
        id: "rule.execution",
        trigger: { type: "event.type", args: { eventType: "test" } },
        actions: []
      },
      traceId: "tca-execution-run",
      correlationId: "tca-execution-command"
    };
    runtime.createActor({ actorId: "actor.source", definitionId: "actor.executor" });

    activate?.execute(context, {
      type: "gas.activate_ability",
      args: {
        actorId: "actor.source",
        abilityId: "ability.interruptible",
        requestId: "tca-request"
      }
    });
    const execution = runtime.listAbilityExecutions()[0];

    expect(execution).toMatchObject({ phase: "active", requestId: "tca-request" });
    expect(
      phase?.evaluate(context, {
        type: "gas.execution.phase",
        args: { executionId: execution?.id, phase: "active" }
      })
    ).toBe(true);
    cancel?.execute(context, {
      type: "gas.cancel_ability_execution",
      args: { executionId: execution?.id, reason: "tca-test" }
    });
    expect(execution && runtime.getAbilityExecution(execution.id)).toMatchObject({
      phase: "cancelled",
      cancellationReason: "tca-test",
      correlationId: "tca-execution-command"
    });
  });

  it("enforces actor limits, cancels the oldest overflow and bounds recent history", () => {
    const runtime = createGasRuntime({
      world: createMemoryWorld(),
      eventBus: createEventBus(),
      dataRegistry: createRegistry(),
      abilityExecutions: { maxActivePerActor: 2, recentHistoryLimit: 2 }
    });
    runtime.createActor({ actorId: "actor.source", definitionId: "actor.executor" });
    const first = runtime.requestAbilityExecution({
      actorId: "actor.source",
      abilityId: "ability.concurrent",
      requestId: "concurrent-1"
    });
    const second = runtime.requestAbilityExecution({
      actorId: "actor.source",
      abilityId: "ability.concurrent",
      requestId: "concurrent-2"
    });
    const third = runtime.requestAbilityExecution({
      actorId: "actor.source",
      abilityId: "ability.concurrent",
      requestId: "concurrent-3"
    });

    expect(
      first.status === "accepted" ? runtime.getAbilityExecution(first.execution.id) : null
    ).toMatchObject({ phase: "cancelled", cancellationReason: "ability-overflow" });
    expect(second.status).toBe("accepted");
    expect(third.status).toBe("accepted");
    expect(runtime.listAbilityExecutions()).toHaveLength(2);
    expect(
      runtime.requestAbilityExecution({
        actorId: "actor.source",
        abilityId: "ability.interruptible"
      })
    ).toMatchObject({ status: "rejected", reason: "actor-execution-limit" });

    for (const execution of runtime.listAbilityExecutions()) {
      runtime.cancelAbilityExecution({ executionId: execution.id });
    }
    expect(runtime.snapshot().recentExecutions).toHaveLength(2);
    expect(
      first.status === "accepted" ? runtime.getAbilityExecution(first.execution.id) : null
    ).toBeUndefined();
  });

  it("validates active execution save payloads", async () => {
    const runtime = createRuntime(createMemoryWorld());
    runtime.createActor({ actorId: "actor.source", definitionId: "actor.executor" });
    runtime.requestAbilityExecution({
      actorId: "actor.source",
      abilityId: "ability.interruptible"
    });
    const handle = createGasHandle();
    const invalidContributor = createGasSaveContributor({ handle });
    const section = {
      id: "gas",
      version: "1",
      data: {
        ...runtime.captureCheckpoint(),
        executions: [{ id: "broken", phase: "completed" }]
      }
    } as never;

    expect((await invalidContributor.validate?.(section))?.issues).toContainEqual(
      expect.objectContaining({ code: "gas.save_invalid_execution" })
    );
    runtime.dispose();
  });
});

function createRuntime(world: GameWorld, eventBus = createEventBus()): GasRuntime {
  return createGasRuntime({ world, eventBus, dataRegistry: createRegistry() });
}

function createRegistry(registerPack = true) {
  const registry = createDataRegistry();
  for (const type of createGasDataTypes()) {
    registry.registerType(type);
  }
  if (registerPack) {
    registry.registerPack(EXECUTION_PACK);
  }
  return registry;
}

const EXECUTION_PACK: DataPack = {
  id: "gas.execution.test",
  version: "1.0.0",
  entries: [
    {
      type: "gas.attribute",
      id: "health",
      data: { id: "health", min: 0, max: 100, defaultValue: 100 }
    },
    {
      type: "gas.attribute",
      id: "energy",
      data: { id: "energy", min: 0, max: 100, defaultValue: 100 }
    },
    {
      type: "gas.attribute",
      id: "progress",
      data: { id: "progress", min: 0, max: 100, defaultValue: 0 }
    },
    { type: "gas.tag", id: "state.stunned", data: { id: "state.stunned" } },
    { type: "gas.cue", id: "cue.cast", data: { id: "cue.cast", type: "cast" } },
    {
      type: "gas.effect",
      id: "effect.damage",
      data: {
        id: "effect.damage",
        attributeModifiers: [{ attribute: "health", operation: "add", value: -10 }]
      }
    },
    {
      type: "gas.effect",
      id: "effect.progress",
      data: {
        id: "effect.progress",
        attributeModifiers: [{ attribute: "progress", operation: "add", value: 1 }]
      }
    },
    {
      type: "gas.ability",
      id: "ability.timed",
      data: {
        id: "ability.timed",
        costs: [{ attribute: "energy", amount: 10 }],
        cooldownMs: 500,
        effects: [{ effectId: "effect.damage", target: "target" }],
        execution: {
          preparingMs: 100,
          activeMs: 50,
          recoveringMs: 25,
          cancellation: { beforeCommit: "allow", afterCommit: "deny" },
          phaseCues: { preparing: ["cue.cast"] }
        }
      }
    },
    {
      type: "gas.ability",
      id: "ability.request-commit",
      data: {
        id: "ability.request-commit",
        costs: [{ attribute: "energy", amount: 5 }],
        cooldownMs: 200,
        execution: {
          preparingMs: 100,
          costCommit: "requested",
          cooldownCommit: "requested"
        }
      }
    },
    {
      type: "gas.ability",
      id: "ability.interruptible",
      data: {
        id: "ability.interruptible",
        execution: {
          activeMs: 1_000,
          cancellation: { afterCommit: "allow" },
          interruptTags: ["state.stunned"]
        }
      }
    },
    {
      type: "gas.ability",
      id: "ability.scan",
      data: {
        id: "ability.scan",
        effects: [{ effectId: "effect.progress", target: "self" }]
      }
    },
    {
      type: "gas.ability",
      id: "ability.concurrent",
      data: {
        id: "ability.concurrent",
        execution: {
          activeMs: 1_000,
          maxConcurrent: 2,
          overflow: "cancel-oldest",
          cancellation: { afterCommit: "allow" }
        }
      }
    },
    {
      type: "gas.actor",
      id: "actor.executor",
      data: {
        id: "actor.executor",
        attributes: { health: 100, energy: 100, progress: 0 },
        abilities: [
          "ability.timed",
          "ability.request-commit",
          "ability.interruptible",
          "ability.scan",
          "ability.concurrent"
        ]
      }
    }
  ]
};

function createMemoryWorld(): GameWorld {
  const componentData = new Map<EntityId, Map<string, unknown>>();
  let nextId = 0;
  return {
    spawn() {
      const id = `entity-${nextId}`;
      nextId += 1;
      componentData.set(id, new Map());
      return id;
    },
    despawn(entity) {
      componentData.delete(entity);
    },
    has(entity) {
      return componentData.has(entity);
    },
    add(entity, component, data) {
      requireEntity(componentData, entity).set(component.id, component.create(data));
    },
    get(entity, component) {
      return requireEntity(componentData, entity).get(component.id) as
        | ReturnType<typeof component.create>
        | undefined;
    },
    set(entity, component, data) {
      const components = requireEntity(componentData, entity);
      const current =
        (components.get(component.id) as ReturnType<typeof component.create>) ?? component.create();
      components.set(component.id, { ...current, ...data });
    },
    remove(entity, component) {
      requireEntity(componentData, entity).delete(component.id);
    },
    query(components: Array<ComponentDef<any>> = []) {
      return [...componentData.entries()]
        .filter(([, values]) => components.every((component) => values.has(component.id)))
        .map(([entity]) => entity);
    },
    count() {
      return componentData.size;
    }
  };
}

function requireEntity(
  componentData: Map<EntityId, Map<string, unknown>>,
  entity: EntityId
): Map<string, unknown> {
  const components = componentData.get(entity);
  if (components === undefined) {
    throw new Error(`Missing entity: ${String(entity)}`);
  }
  return components;
}
