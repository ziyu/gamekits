import { createEventBus } from "@gamekits/event-bus";
import { createGame } from "@gamekits/game-runtime";
import {
  PhysicsBodyComponent,
  PhysicsColliderComponent,
  PhysicsTransformComponent,
  PhysicsVelocityComponent,
  createMemoryPhysicsBackend,
  createPhysicsHandle,
  createPhysicsModule
} from "@gamekits/physics-core";
import {
  defineComponent,
  type CheckpointGameWorld,
  type ComponentDef,
  type EntityId
} from "@gamekits/world";
import {
  createStandardMultiplayerPhysicsRollbackContributor,
  createStandardMultiplayerRollbackDomain
} from "../src";
import { describe, expect, it } from "vitest";

const RollbackScopeComponent = defineComponent<{ enabled: boolean }>({
  id: "test.rollback-scope",
  create: (data) => ({ enabled: data?.enabled ?? true })
});

const GameplayCounterComponent = defineComponent<{ value: number }>({
  id: "test.gameplay-counter",
  create: (data) => ({ value: data?.value ?? 0 })
});

describe("standard multiplayer rollback contributors", () => {
  it("restores and deterministically replays World, RNG, and Physics on one tick boundary", () => {
    const world = createStableWorld();
    const player = world.spawnWithId("player");
    world.add(player, RollbackScopeComponent);
    world.add(player, GameplayCounterComponent);
    world.add(player, PhysicsBodyComponent, { definition: { kind: "dynamic" } });
    world.add(player, PhysicsColliderComponent, {
      definition: { shape: { type: "circle", radius: 0.5 } }
    });
    world.add(player, PhysicsTransformComponent, { position: { x: 0, y: 0 } });
    world.add(player, PhysicsVelocityComponent, { linear: { x: 0, y: 0 } });

    const physics = createPhysicsHandle({ id: "rollback.physics" });
    const game = createGame({
      modules: [
        createPhysicsModule({
          backend: createMemoryPhysicsBackend(),
          fixedDeltaMs: 100,
          scene: { gravity: { x: 0, y: 0 } },
          handle: physics
        })
      ],
      world,
      eventBus: createEventBus({ clock: () => 1 }),
      seed: "managed-rollback"
    });
    game.start();
    game.tick(0);

    const coordinator = createStandardMultiplayerRollbackDomain({
      generation: "round-1",
      world: {
        world,
        components: [RollbackScopeComponent, GameplayCounterComponent],
        selectEntities: () => world.query([RollbackScopeComponent])
      },
      rng: { source: game.rng },
      physics: { handle: physics }
    });
    const initialRngState = game.rng.captureState();

    expect(coordinator.capture(0)).toMatchObject({
      status: "captured",
      contributors: ["world", "rng", "physics"]
    });
    simulateInput(game, world, player);
    simulateInput(game, world, player);
    const originalTickTwo = coordinator.capture(2);
    expect(originalTickTwo).toMatchObject({ status: "captured" });
    if (originalTickTwo.status !== "captured") {
      throw new Error("Expected the original tick-two checkpoint to be captured.");
    }
    const originalCounter = world.get(player, GameplayCounterComponent)?.value;
    const originalPosition = world.get(player, PhysicsTransformComponent)?.position.x;

    simulateInput(game, world, player);
    const transient = world.spawnWithId("transient-effect");
    world.add(transient, RollbackScopeComponent);
    world.add(transient, GameplayCounterComponent, { value: 99 });
    world.despawn(player);
    game.tick(0);

    expect(coordinator.restore(0)).toMatchObject({
      status: "restored",
      contributors: ["world", "rng", "physics"]
    });
    expect(world.has(player)).toBe(true);
    expect(world.has(transient)).toBe(false);
    expect(world.get(player, GameplayCounterComponent)?.value).toBe(0);
    expect(world.get(player, PhysicsTransformComponent)?.position.x).toBe(0);
    expect(game.rng.captureState()).toEqual(initialRngState);
    expect(coordinator.checkpoint(2)).toBeUndefined();

    simulateInput(game, world, player);
    simulateInput(game, world, player);
    const replayedTickTwo = coordinator.capture(2);
    expect(replayedTickTwo).toMatchObject({
      status: "captured",
      hash: originalTickTwo.hash
    });
    expect(world.get(player, GameplayCounterComponent)?.value).toBe(originalCounter);
    expect(world.get(player, PhysicsTransformComponent)?.position.x).toBe(originalPosition);
    expect(coordinator.diagnostics()).toMatchObject({
      captures: 3,
      restores: 1,
      checkpoints: 2,
      latestTick: 2
    });

    coordinator.dispose();
    game.dispose();
  });

  it("rejects malformed or remap-colliding Physics checkpoints before restore", () => {
    const physics = createPhysicsHandle({ id: "validation.physics" });
    const world = createStableWorld();
    const game = createGame({
      modules: [
        createPhysicsModule({
          backend: createMemoryPhysicsBackend(),
          handle: physics
        })
      ],
      world,
      eventBus: createEventBus({ clock: () => 1 }),
      seed: "validation"
    });
    const contributor = createStandardMultiplayerPhysicsRollbackContributor({
      handle: physics,
      resolveEntityId: () => "same-entity"
    });

    expect(
      contributor.validate?.(
        {
          accumulator: 0,
          entities: [{ entityId: "first" }, { entityId: "second" }]
        },
        { generation: 1, tick: 0, phase: "validate" }
      )
    ).toBe(false);
    expect(
      contributor.validate?.(
        { accumulator: Number.NaN, entities: [] },
        { generation: 1, tick: 0, phase: "validate" }
      )
    ).toBe(false);

    game.dispose();
  });
});

function simulateInput(
  game: ReturnType<typeof createGame>,
  world: CheckpointGameWorld,
  entityId: EntityId
): void {
  const movement = game.rng.int(1, 5);
  const counter = world.get(entityId, GameplayCounterComponent)?.value ?? 0;
  world.set(entityId, GameplayCounterComponent, { value: counter + movement });
  world.set(entityId, PhysicsVelocityComponent, { linear: { x: movement, y: 0 } });
  game.tick(100);
}

function createStableWorld(): CheckpointGameWorld {
  const components = new Map<EntityId, Map<string, object>>();
  let nextEntity = 0;

  return {
    spawn() {
      let entityId: EntityId;
      do {
        entityId = `entity-${nextEntity++}`;
      } while (components.has(entityId));
      components.set(entityId, new Map());
      return entityId;
    },
    spawnWithId(entityId) {
      if (components.has(entityId)) {
        throw new Error(`Duplicate entity: ${String(entityId)}`);
      }
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
