import { createDataRegistry } from "@gamekits/data";
import { createEventBus } from "@gamekits/event-bus";
import {
  createGasDataTypes,
  createGasHandle,
  createGasModule,
  createGasSaveContributor,
  createGasTcaDefinitions
} from "@gamekits/gas";
import { createGame } from "@gamekits/game-runtime";
import {
  PhysicsBodyComponent,
  PhysicsTransformComponent,
  PhysicsVelocityComponent,
  createMemoryPhysicsBackend,
  createPhysicsHandle,
  createPhysicsModule,
  createPhysicsSaveContributor
} from "@gamekits/physics-core";
import { createMemorySaveStore, createSaveManager } from "@gamekits/save";
import {
  createTcaHandle,
  createTcaModule,
  createTcaRuleDataType,
  createTcaSaveContributor
} from "@gamekits/tca";
import type { ComponentDef, EntityId, GameWorld } from "@gamekits/world";
import { describe, expect, it } from "vitest";

describe("gameplay checkpoint composition", () => {
  it("continues Physics, GAS, and once-rule state through SaveManager restore", async () => {
    const world = createCheckpointWorld();
    const eventBus = createEventBus({ clock: () => 1 });
    const registry = createCheckpointRegistry();
    const gas = createGasHandle({ id: "checkpoint.gas" });
    const tca = createTcaHandle({ id: "checkpoint.tca" });
    const physics = createPhysicsHandle({ id: "checkpoint.physics" });
    const game = createGame({
      modules: [
        createTcaModule({
          dataRegistry: registry,
          definitions: createGasTcaDefinitions({ runtime: () => gas }),
          handle: tca
        }),
        createGasModule({ dataRegistry: registry, handle: gas }),
        createPhysicsModule({
          backend: createMemoryPhysicsBackend(),
          fixedDeltaMs: 1_000,
          scene: { gravity: { x: 0, y: 0 } },
          handle: physics
        })
      ],
      world,
      eventBus,
      seed: "gameplay-checkpoint"
    });
    const entityId = world.spawn();
    world.add(entityId, PhysicsBodyComponent, { definition: { kind: "dynamic" } });
    world.add(entityId, PhysicsTransformComponent, { position: { x: 0, y: 0 } });
    world.add(entityId, PhysicsVelocityComponent, { linear: { x: 2, y: 0 } });
    gas.createActor({ actorId: "hero", definitionId: "actor.hero", entityId });
    game.start();
    game.tick(500);
    eventBus.emit("combat.request", {}, "test", { correlationId: "command-1" });

    const save = createSaveManager({
      appId: "checkpoint-test",
      gameId: "checkpoint-test",
      gameVersion: "1",
      formatVersion: "1",
      store: createMemorySaveStore(),
      clock: () => 500
    });
    save.registerContributor(createPhysicsSaveContributor({ handle: physics }));
    save.registerContributor(createGasSaveContributor({ handle: gas }));
    save.registerContributor(createTcaSaveContributor({ handle: tca }));
    const savedClock = game.clock.snapshot();
    await save.save("authority", {
      runtime: {
        seed: "gameplay-checkpoint",
        clock: { ticks: savedClock.ticks, elapsed: savedClock.elapsed }
      }
    });

    gas.modifyAttribute("hero", { attribute: "health", operation: "set", value: 1 });
    game.tick(500);
    expect(world.get(entityId, PhysicsTransformComponent)?.position.x).toBe(2);
    game.stop();

    const loaded = await save.load("authority");
    game.clock.restore({
      ticks: loaded.envelope.payload.runtime.clock.ticks,
      elapsed: loaded.envelope.payload.runtime.clock.elapsed,
      running: false
    });

    expect(gas.getActor("hero").attributes.current.health).toBe(90);
    eventBus.emit("combat.request", {}, "test", { correlationId: "command-2" });
    expect(gas.getActor("hero").attributes.current.health).toBe(90);

    game.start();
    game.tick(500);
    expect(world.get(entityId, PhysicsTransformComponent)?.position.x).toBe(2);
    expect(game.clock.snapshot()).toMatchObject({ ticks: 2, elapsed: 1_000 });
    game.dispose();
  });
});

function createCheckpointRegistry() {
  const registry = createDataRegistry();
  registry.registerType(createTcaRuleDataType());
  for (const type of createGasDataTypes()) {
    registry.registerType(type);
  }
  registry.registerPack({
    id: "checkpoint.content",
    version: "1",
    entries: [
      {
        type: "gas.attribute",
        id: "health",
        data: { id: "health", min: 0, max: 100, defaultValue: 100 }
      },
      {
        type: "gas.effect",
        id: "effect.damage",
        data: {
          id: "effect.damage",
          durationMs: 1_000,
          attributeModifiers: [{ attribute: "health", operation: "add", value: -10 }]
        }
      },
      {
        type: "gas.ability",
        id: "ability.strike",
        data: {
          id: "ability.strike",
          effects: [{ effectId: "effect.damage", target: "self" }]
        }
      },
      {
        type: "gas.actor",
        id: "actor.hero",
        data: {
          id: "actor.hero",
          attributes: { health: 100 },
          abilities: ["ability.strike"]
        }
      },
      {
        type: "tca.rule",
        id: "rule.combat-once",
        data: {
          id: "rule.combat-once",
          once: true,
          trigger: { type: "event.type", args: { eventType: "combat.request" } },
          actions: [
            {
              type: "gas.activate_ability",
              args: {
                actorId: "hero",
                abilityId: "ability.strike",
                targetActorId: "hero"
              }
            }
          ]
        }
      }
    ]
  });
  return registry;
}

function createCheckpointWorld(): GameWorld {
  const components = new Map<EntityId, Map<string, object>>();
  let nextEntity = 0;
  return {
    spawn() {
      const entityId = `entity-${nextEntity++}`;
      components.set(entityId, new Map());
      return entityId;
    },
    despawn(entityId) {
      components.delete(entityId);
    },
    has(entityId) {
      return components.has(entityId);
    },
    add(entityId, component, data) {
      requireEntity(components, entityId).set(component.id, component.create(data));
    },
    get(entityId, component) {
      return requireEntity(components, entityId).get(component.id) as
        | ReturnType<typeof component.create>
        | undefined;
    },
    set(entityId, component, data) {
      const values = requireEntity(components, entityId);
      const current =
        (values.get(component.id) as ReturnType<typeof component.create>) ?? component.create();
      values.set(component.id, { ...current, ...data });
    },
    remove(entityId, component) {
      requireEntity(components, entityId).delete(component.id);
    },
    query(required: Array<ComponentDef<object>> = []) {
      return [...components.entries()]
        .filter(([, values]) => required.every((component) => values.has(component.id)))
        .map(([entityId]) => entityId);
    },
    count() {
      return components.size;
    }
  };
}

function requireEntity(
  components: Map<EntityId, Map<string, object>>,
  entityId: EntityId
): Map<string, object> {
  const values = components.get(entityId);
  if (values === undefined) {
    throw new Error(`Missing entity: ${String(entityId)}`);
  }
  return values;
}
