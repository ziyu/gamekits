import { createDataRegistry, type DataPack } from "@gamekits/data";
import { createEventBus, type GameEvent } from "@gamekits/event-bus";
import { createGame } from "@gamekits/game-runtime";
import { describe, expect, it } from "vitest";
import {
  createGasDataTypes,
  createGasHandle,
  createGasModule,
  createGasRuntime,
  createGasSaveContributor,
  createGasTcaDefinitions,
  createGasTraceStore,
  GasActor,
  GasAttributes,
  type GasRuntime
} from "../src";
import type { ComponentDef, EntityId, GameWorld } from "@gamekits/world";

describe("GAS data types", () => {
  it("rejects non-positive periodic effect intervals", () => {
    const registry = createDataRegistry();
    for (const type of createGasDataTypes()) {
      registry.registerType(type);
    }

    const validation = registry.validatePack({
      id: "invalid-period",
      version: "1.0.0",
      entries: [
        {
          type: "gas.effect",
          id: "effect.invalid-period",
          data: { id: "effect.invalid-period", periodMs: 0 }
        }
      ]
    });

    expect(validation.diagnostics).toContainEqual(
      expect.objectContaining({ code: "gas.effect_invalid_period" })
    );
  });

  it("rejects non-positive or fractional effect stack limits", () => {
    const registry = createDataRegistry();
    for (const type of createGasDataTypes()) {
      registry.registerType(type);
    }

    const validation = registry.validatePack({
      id: "invalid-stacking",
      version: "1.0.0",
      entries: [
        {
          type: "gas.effect",
          id: "effect.invalid",
          data: { id: "effect.invalid", durationMs: 100, stacking: { limit: 1.5 } }
        }
      ]
    });

    expect(validation.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "gas.effect_invalid_stack_limit",
        path: "stacking.limit"
      })
    );
  });
});

describe("GAS trace store", () => {
  it("supports disabled trace retention without losing correlation ids", () => {
    const traceStore = createGasTraceStore({ enabled: false });

    expect(
      traceStore.add({ type: "actor.created", timestamp: 1, actorId: "actor.untraced" }).id
    ).toBe("gas-trace-1");
    expect(traceStore.list()).toEqual([]);
  });

  it("isolates observer failures from gameplay writes", () => {
    const observerError = new Error("observer failed");
    const errors: unknown[] = [];
    const traceStore = createGasTraceStore({
      onEntry() {
        throw observerError;
      },
      onEntryError(error) {
        errors.push(error);
        throw new Error("error observer failed");
      }
    });

    expect(() =>
      traceStore.add({
        type: "actor.created",
        timestamp: 1,
        actorId: "actor.safe"
      })
    ).not.toThrow();
    expect(traceStore.list()).toHaveLength(1);
    expect(errors).toEqual([observerError]);
  });
});

describe("GAS runtime", () => {
  it("stores entity-backed actor state in world components", () => {
    const world = createMemoryWorld();
    const runtime = createTestGasRuntime(world);
    const entity = world.spawn();

    runtime.createActor({
      actorId: "actor.hero",
      definitionId: "actor.scout",
      entityId: entity
    });

    expect(world.get(entity, GasActor)).toMatchObject({
      actorId: "actor.hero",
      definitionId: "actor.scout",
      entityId: entity
    });
    expect(world.get(entity, GasAttributes)?.current.health).toBe(100);
  });

  it("activates abilities, applies effects, emits cues, and records traces", () => {
    const world = createMemoryWorld();
    const eventBus = createEventBus({ clock: () => 10 });
    const events: string[] = [];
    const runtime = createTestGasRuntime(world, eventBus);
    const source = world.spawn();
    const target = world.spawn();
    eventBus.onAny((event) => events.push(event.type));

    runtime.createActor({ actorId: "actor.source", definitionId: "actor.scout", entityId: source });
    runtime.createActor({ actorId: "actor.target", definitionId: "actor.scout", entityId: target });
    const result = runtime.activateAbility({
      actorId: "actor.source",
      abilityId: "ability.strike",
      targetActorId: "actor.target"
    });

    expect(result).toMatchObject({
      status: "activated",
      actorId: "actor.source",
      abilityId: "ability.strike",
      cooldownUntil: 100,
      paidCosts: [{ attribute: "energy", amount: 5 }]
    });
    expect(result.status === "activated" ? result.appliedEffects : []).toEqual([
      {
        effectId: "effect.damage",
        sourceActorId: "actor.source",
        targetActorId: "actor.target",
        status: "applied",
        activeEffectId: "effect.damage:1",
        parentId: expect.any(String)
      }
    ]);
    expect(runtime.getActor("actor.source").attributes.current.energy).toBe(35);
    expect(runtime.getActor("actor.target").attributes.current.health).toBe(88);
    expect(runtime.getActor("actor.target").tags.values).toContain("state.marked");
    expect(events).toContain("gas.ability_activated");
    expect(events).toContain("gas.effect_applied");
    expect(events).toContain("gas.cue");
    expect(runtime.traceStore.list().map((trace) => trace.type)).toContain("ability.activated");
  });

  it("ticks periodic effects and removes granted tags on expiry", () => {
    const world = createMemoryWorld();
    const runtime = createTestGasRuntime(world);

    runtime.createActor({ actorId: "actor.source", definitionId: "actor.scout" });
    runtime.activateAbility({
      actorId: "actor.source",
      abilityId: "ability.regen",
      targetActorId: "actor.source"
    });

    runtime.update(250, 250);
    expect(runtime.getActor("actor.source").attributes.current.energy).toBe(42);
    expect(runtime.getActor("actor.source").tags.values).toContain("state.overcharged");

    runtime.update(800, 1050);
    expect(runtime.getActor("actor.source").tags.values).not.toContain("state.overcharged");
    expect(runtime.getActor("actor.source").effects.active).toHaveLength(0);
  });

  it("does not write unchanged entity actors back to the world during update", () => {
    let writes = 0;
    const world = createMemoryWorld(() => {
      writes += 1;
    });
    const runtime = createTestGasRuntime(world);
    const entity = world.spawn();

    runtime.createActor({
      actorId: "actor.source",
      definitionId: "actor.scout",
      entityId: entity
    });
    writes = 0;
    runtime.update(50, 50);

    expect(writes).toBe(0);

    runtime.applyEffect({
      effectId: "effect.regen",
      targetActorId: "actor.source"
    });
    writes = 0;
    runtime.update(50, 100);

    expect(writes).toBe(0);
  });

  it("returns rejected activation results without paying costs", () => {
    const world = createMemoryWorld();
    const runtime = createTestGasRuntime(world);

    runtime.createActor({ actorId: "actor.source", definitionId: "actor.scout" });
    runtime.createActor({ actorId: "actor.target", definitionId: "actor.scout" });

    expect(
      runtime.activateAbility({
        actorId: "actor.source",
        abilityId: "ability.strike",
        targetActorId: "actor.target"
      }).status
    ).toBe("activated");
    const rejected = runtime.activateAbility({
      actorId: "actor.source",
      abilityId: "ability.strike",
      targetActorId: "actor.target"
    });

    expect(rejected).toMatchObject({
      status: "rejected",
      reason: "ability is on cooldown"
    });
    expect(runtime.getActor("actor.source").attributes.current.energy).toBe(35);
  });

  it("validates effect periods and targets before charging an ability", () => {
    const world = createMemoryWorld();
    const runtime = createTestGasRuntime(world);
    runtime.createActor({ actorId: "actor.source", definitionId: "actor.scout" });
    expect(
      runtime.activateAbility({ actorId: "actor.source", abilityId: "ability.strike" })
    ).toMatchObject({ status: "rejected", reason: "ability target is required" });
    expect(runtime.getActor("actor.source").attributes.current.energy).toBe(40);
    expect(runtime.getActor("actor.source").abilities.cooldowns["ability.strike"]).toBeUndefined();
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects invalid period %s during data registration",
    (periodMs) => {
      const registry = createDataRegistry();
      for (const type of createGasDataTypes()) registry.registerType(type);
      expect(() =>
        registry.registerPack({
          id: "invalid",
          entries: [{ type: "gas.effect", id: "bad", data: { id: "bad", periodMs } }]
        })
      ).toThrow();
    }
  );

  it("refreshes lifecycle effects by default and enforces explicit stack limits", () => {
    const world = createMemoryWorld();
    const runtime = createTestGasRuntime(world);

    runtime.createActor({ actorId: "actor.target", definitionId: "actor.scout" });
    const applied = runtime.applyEffect({
      effectId: "effect.regen",
      targetActorId: "actor.target"
    });
    runtime.update(100, 100);
    const refreshed = runtime.applyEffect({
      effectId: "effect.regen",
      targetActorId: "actor.target"
    });

    expect(applied).toMatchObject({ status: "applied", activeEffectId: "effect.regen:1" });
    expect(refreshed).toMatchObject({ status: "refreshed", activeEffectId: "effect.regen:1" });
    expect(runtime.getActor("actor.target").effects.active).toMatchObject([
      { id: "effect.regen:1", startedAt: 100, expiresAt: 1100, nextTickAt: 350 }
    ]);

    expect(
      runtime.applyEffect({ effectId: "effect.stack", targetActorId: "actor.target" }).status
    ).toBe("applied");
    expect(
      runtime.applyEffect({ effectId: "effect.stack", targetActorId: "actor.target" }).status
    ).toBe("applied");
    expect(
      runtime.applyEffect({ effectId: "effect.stack", targetActorId: "actor.target" })
    ).toMatchObject({ status: "rejected", reason: "effect stack limit reached" });
    expect(
      runtime
        .getActor("actor.target")
        .effects.active.filter((effect) => effect.effectId === "effect.stack")
    ).toHaveLength(2);
  });

  it("keeps tags granted by another source when an effect expires", () => {
    const world = createMemoryWorld();
    const runtime = createTestGasRuntime(world);

    runtime.createActor({ actorId: "actor.source", definitionId: "actor.scout" });
    runtime.addTag("actor.source", "state.overcharged", "equipment");
    runtime.activateAbility({
      actorId: "actor.source",
      abilityId: "ability.regen",
      targetActorId: "actor.source"
    });

    runtime.update(1001, 1001);
    expect(runtime.getActor("actor.source").tags.values).toContain("state.overcharged");

    runtime.removeTag("actor.source", "state.overcharged", "equipment");
    expect(runtime.getActor("actor.source").tags.values).not.toContain("state.overcharged");
  });

  it("removes actor components explicitly and prunes mappings after entity despawn", () => {
    const world = createMemoryWorld();
    const runtime = createTestGasRuntime(world);
    const explicitEntity = world.spawn();
    const despawnedEntity = world.spawn();

    runtime.createActor({
      actorId: "actor.explicit",
      definitionId: "actor.scout",
      entityId: explicitEntity
    });
    runtime.createActor({
      actorId: "actor.despawned",
      definitionId: "actor.scout",
      entityId: despawnedEntity
    });

    expect(runtime.removeActor("actor.explicit")).toBe(true);
    expect(runtime.removeActor("actor.explicit")).toBe(false);
    expect(world.get(explicitEntity, GasActor)).toBeUndefined();

    world.despawn(despawnedEntity);
    runtime.update(16, 16);

    expect(runtime.hasActor("actor.despawned")).toBe(false);
    expect(runtime.traceStore.list()).toContainEqual(
      expect.objectContaining({
        type: "actor.removed",
        actorId: "actor.despawned",
        details: expect.objectContaining({ reason: "entity-missing" })
      })
    );
  });

  it("rebinds a stable actor id after its previous entity was despawned", () => {
    const world = createMemoryWorld();
    const runtime = createTestGasRuntime(world);
    const previousEntity = world.spawn();

    runtime.createActor({
      actorId: "actor.stable",
      definitionId: "actor.scout",
      entityId: previousEntity
    });
    world.despawn(previousEntity);
    const restoredEntity = world.spawn();

    runtime.createActor({
      actorId: "actor.stable",
      definitionId: "actor.scout",
      entityId: restoredEntity
    });

    expect(runtime.getActor("actor.stable").actor.entityId).toBe(restoredEntity);
    expect(runtime.actorForEntity(restoredEntity)?.actor.actorId).toBe("actor.stable");
  });

  it("restores actor state, elapsed time, entity remaps, and effect id sequence", () => {
    const world = createMemoryWorld();
    const runtime = createTestGasRuntime(world);
    const sourceEntity = world.spawn();
    const targetEntity = world.spawn();
    runtime.createActor({
      actorId: "actor.source",
      definitionId: "actor.scout",
      entityId: sourceEntity
    });
    runtime.createActor({
      actorId: "actor.target",
      definitionId: "actor.scout",
      entityId: targetEntity
    });
    runtime.update(50, 50);
    const activation = runtime.activateAbility({
      actorId: "actor.source",
      abilityId: "ability.strike",
      targetActorId: "actor.target"
    });
    const checkpoint = runtime.captureCheckpoint();
    const restoredSource = world.spawn();
    const restoredTarget = world.spawn();

    runtime.modifyAttribute("actor.source", {
      attribute: "energy",
      operation: "set",
      value: 0
    });
    runtime.restoreCheckpoint(checkpoint, {
      resolveEntityId(entityId) {
        if (entityId === sourceEntity) {
          return restoredSource;
        }
        return entityId === targetEntity ? restoredTarget : undefined;
      }
    });

    expect(activation.status).toBe("activated");
    expect(runtime.getActor("actor.source")).toMatchObject({
      actor: { entityId: restoredSource },
      attributes: { current: { energy: 35 } },
      abilities: { cooldowns: { "ability.strike": 150 } }
    });
    expect(runtime.getActor("actor.target")).toMatchObject({
      actor: { entityId: restoredTarget },
      attributes: { current: { health: 88 } },
      effects: { active: [{ id: "effect.damage:1" }] }
    });
    expect(world.get(sourceEntity, GasActor)).toBeUndefined();
    expect(runtime.traceStore.list()).toEqual([]);

    runtime.update(550, 600);
    const next = runtime.applyEffect({
      effectId: "effect.damage",
      targetActorId: "actor.target"
    });
    expect(next.activeEffectId).toBe("effect.damage:2");
  });

  it("preserves correlation across ability, effect, attribute and EventBus facts", () => {
    const world = createMemoryWorld();
    const eventBus = createEventBus();
    const events: GameEvent[] = [];
    const runtime = createTestGasRuntime(world, eventBus);
    eventBus.onAny((event) => events.push(event));

    runtime.createActor({ actorId: "actor.source", definitionId: "actor.scout" });
    runtime.createActor({ actorId: "actor.target", definitionId: "actor.scout" });
    runtime.activateAbility({
      actorId: "actor.source",
      abilityId: "ability.strike",
      targetActorId: "actor.target",
      correlationId: "command-17",
      parentId: "multiplayer-trace-4"
    });

    const traces = runtime.traceStore.list();
    const abilityTrace = traces.find((trace) => trace.type === "ability.activated");
    const effectTrace = traces.find((trace) => trace.type === "effect.applied");
    const damageTrace = traces.find(
      (trace) => trace.type === "attribute.changed" && trace.details?.source === "effect.damage"
    );
    const effectEvent = events.find((event) => event.type === "gas.effect_applied");

    expect(abilityTrace).toMatchObject({
      correlationId: "command-17",
      parentId: "multiplayer-trace-4"
    });
    expect(effectTrace).toMatchObject({
      correlationId: "command-17",
      parentId: abilityTrace?.id
    });
    expect(damageTrace).toMatchObject({
      correlationId: "command-17",
      parentId: effectTrace?.id
    });
    expect(effectEvent).toMatchObject({
      correlationId: "command-17",
      parentId: effectTrace?.id
    });
  });

  it("binds a GAS handle to Save contributors and invalidates it on dispose", async () => {
    const world = createMemoryWorld();
    const eventBus = createEventBus();
    const handle = createGasHandle({ id: "combat.gas" });
    const game = createGame({
      world,
      eventBus,
      seed: "gas-handle",
      modules: [
        createGasModule({
          dataRegistry: createTestGasRegistry(),
          handle
        })
      ]
    });

    expect(handle.isBound()).toBe(true);
    handle.createActor({ actorId: "actor.handle", definitionId: "actor.scout" });
    expect(handle.hasActor("actor.handle")).toBe(true);
    const section = await createGasSaveContributor({ handle }).capture({ now: 0 });
    expect(section?.data.actors).toHaveLength(1);

    game.dispose();

    expect(handle.isBound()).toBe(false);
    expect(() => handle.hasActor("actor.handle")).toThrowError(
      expect.objectContaining({ code: "gas.handle_unbound" })
    );
  });

  it("exposes TCA definitions that can drive GAS", () => {
    const world = createMemoryWorld();
    const runtime = createTestGasRuntime(world);
    const definitions = createGasTcaDefinitions({ runtime: () => runtime });
    const activate = definitions.actions?.find((action) => action.type === "gas.activate_ability");
    const compare = definitions.conditions?.find(
      (condition) => condition.type === "gas.attribute.compare"
    );

    runtime.createActor({ actorId: "actor.source", definitionId: "actor.scout" });
    runtime.createActor({ actorId: "actor.target", definitionId: "actor.scout" });

    expect(
      compare?.evaluate(createTcaContext(runtime), {
        type: "gas.attribute.compare",
        args: { actorId: "actor.target", attribute: "health", operator: ">", value: 0 }
      })
    ).toBe(true);

    activate?.execute(createTcaContext(runtime), {
      type: "gas.activate_ability",
      args: {
        actorId: "actor.source",
        abilityId: "ability.strike",
        targetActorId: "actor.target"
      }
    });

    expect(runtime.getActor("actor.target").attributes.current.health).toBe(88);
    expect(runtime.traceStore.list()).toContainEqual(
      expect.objectContaining({
        type: "ability.activated",
        correlationId: "tca-command",
        parentId: "tca-run-test"
      })
    );
  });
});

function createTestGasRuntime(world: GameWorld, eventBus = createEventBus()): GasRuntime {
  return createGasRuntime({
    world,
    dataRegistry: createTestGasRegistry(),
    eventBus,
    traceStore: createGasTraceStore({ limit: 50 })
  });
}

function createTestGasRegistry() {
  const registry = createDataRegistry();
  for (const type of createGasDataTypes()) {
    registry.registerType(type);
  }
  registry.registerPack(testPack);
  return registry;
}

const testPack: DataPack = {
  id: "gas.test",
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
      data: { id: "energy", min: 0, max: 50, defaultValue: 40 }
    },
    { type: "gas.tag", id: "state.marked", data: { id: "state.marked" } },
    { type: "gas.tag", id: "state.overcharged", data: { id: "state.overcharged" } },
    {
      type: "gas.cue",
      id: "cue.hit",
      data: { id: "cue.hit", type: "ui.floating_text", payload: { text: "hit" } }
    },
    {
      type: "gas.effect",
      id: "effect.damage",
      data: {
        id: "effect.damage",
        attributeModifiers: [{ attribute: "health", operation: "add", value: -12 }],
        grantedTags: ["state.marked"],
        durationMs: 500,
        cues: ["cue.hit"]
      }
    },
    {
      type: "gas.effect",
      id: "effect.regen",
      data: {
        id: "effect.regen",
        durationMs: 1000,
        periodMs: 250,
        periodicModifiers: [{ attribute: "energy", operation: "add", value: 2 }],
        grantedTags: ["state.overcharged"]
      }
    },
    {
      type: "gas.effect",
      id: "effect.stack",
      data: {
        id: "effect.stack",
        durationMs: 1000,
        stacking: { limit: 2, overflow: "reject-newest" }
      }
    },
    {
      type: "gas.ability",
      id: "ability.strike",
      data: {
        id: "ability.strike",
        costs: [{ attribute: "energy", amount: 5 }],
        cooldownMs: 100,
        effects: [{ effectId: "effect.damage", target: "target" }]
      }
    },
    {
      type: "gas.ability",
      id: "ability.regen",
      data: {
        id: "ability.regen",
        effects: [{ effectId: "effect.regen", target: "self" }]
      }
    },
    {
      type: "gas.actor",
      id: "actor.scout",
      data: {
        id: "actor.scout",
        attributes: { health: 100, energy: 40 },
        tags: [],
        abilities: ["ability.strike", "ability.regen"]
      }
    }
  ]
};

function createTcaContext(runtime: GasRuntime) {
  const eventBus = createEventBus();
  return {
    event: { type: "test", payload: {}, timestamp: 0 },
    eventBus,
    rule: {
      id: "rule.test",
      trigger: { type: "event.type", args: { eventType: "test" } },
      actions: []
    },
    traceId: "tca-run-test",
    correlationId: "tca-command",
    parentId: "source-trace",
    game: {
      world: createMemoryWorld(),
      eventBus,
      rng: {} as never,
      systems: {} as never
    },
    dataRegistry: undefined,
    runtime
  };
}

function createMemoryWorld(onSet?: () => void): GameWorld {
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
      onSet?.();
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
  if (!components) {
    throw new Error(`Missing entity: ${String(entity)}`);
  }

  return components;
}

describe("GAS periodic boundaries", () => {
  it.each([[1000], [100, 200, 250, 1000]])(
    "never applies periodic ticks at or beyond expiration: %j",
    (...times) => {
      const registry = createDataRegistry();
      for (const type of createGasDataTypes()) registry.registerType(type);
      registry.registerPack(testPack);
      registry.registerPack({
        id: "boundary",
        entries: [
          {
            type: "gas.effect",
            id: "poison",
            data: {
              id: "poison",
              periodMs: 100,
              durationMs: 250,
              periodicModifiers: [{ attribute: "health", operation: "add", value: -1 }]
            }
          }
        ]
      });
      const gas = createGasRuntime({
        world: createMemoryWorld(),
        dataRegistry: registry,
        eventBus: createEventBus()
      });
      gas.createActor({ actorId: "a", definitionId: "actor.scout" });
      gas.applyEffect({ effectId: "poison", sourceActorId: "a", targetActorId: "a" });
      for (const elapsed of times) gas.update(100, elapsed);
      expect(gas.getActor("a").attributes.current.health).toBe(98);
      expect(gas.getActor("a").effects.active).toEqual([]);
    }
  );

  it("defensively rejects an invalid effect before runtime mutation", () => {
    const registry = createDataRegistry();
    for (const type of createGasDataTypes()) registry.registerType(type);
    registry.registerPack(testPack);
    const definition = registry.getValue<{ periodMs?: number }>("gas.effect", "effect.regen");
    definition.periodMs = 0;
    const gas = createGasRuntime({
      world: createMemoryWorld(),
      dataRegistry: registry,
      eventBus: createEventBus()
    });
    gas.createActor({ actorId: "a", definitionId: "actor.scout" });
    expect(() =>
      gas.applyEffect({ effectId: "effect.regen", sourceActorId: "a", targetActorId: "a" })
    ).toThrow(/positive and finite/);
    expect(gas.getActor("a").effects.active).toEqual([]);
  });
});
