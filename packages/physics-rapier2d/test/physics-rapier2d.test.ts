import { createEventBus } from "@gamekits/event-bus";
import { createGame } from "@gamekits/game-runtime";
import {
  PhysicsBodyComponent,
  PhysicsColliderComponent,
  PhysicsTransformComponent,
  createPhysicsBodyPredictionTransition,
  createPhysicsModule,
  checkCollision,
  checkOverlap,
  queryBounds,
  queryPoint,
  raycast,
  shapeCast,
  type PhysicsContactEvent
} from "@gamekits/physics-core";
import { type ComponentDef, type EntityId, type GameWorld } from "@gamekits/world";
import { beforeAll, describe, expect, it } from "vitest";
import { initRapier2dPhysicsBackend, type Rapier2dPhysicsNative } from "../src";

let backend: Awaited<ReturnType<typeof initRapier2dPhysicsBackend>>;

beforeAll(async () => {
  backend = await initRapier2dPhysicsBackend();
});

describe("Rapier 2D physics backend", () => {
  it("installs an authority pose immediately without changing default kinematic targets", () => {
    const scene = backend.createScene({ gravity: { x: 0, y: 0 } });
    scene.createBody({ id: "kinematic.body", kind: "kinematic", position: { x: 0, y: 0 } });

    scene.updateBody("kinematic.body", { position: { x: 2, y: 0 }, rotation: Math.PI / 3 });
    expect(scene.getBodyState("kinematic.body")).toMatchObject({
      position: { x: 0, y: 0 },
      rotation: 0
    });
    scene.step(1000 / 60);
    expect(scene.getBodyState("kinematic.body")?.position.x).toBeCloseTo(2, 6);

    scene.updateBody(
      "kinematic.body",
      { position: { x: 7, y: 1 }, rotation: -Math.PI / 2 },
      { kinematicTransformMode: "teleport" }
    );
    const corrected = scene.getBodyState("kinematic.body")!;
    expect(corrected.position).toEqual({ x: 7, y: 1 });
    expect(corrected.rotation).toBeCloseTo(-Math.PI / 2, 6);

    scene.dispose();
  });

  it("keeps speculative contact solving aligned with continuous authority stepping", () => {
    const sceneConfig = { gravity: { x: 0, y: 0 } } as const;
    const wallBody = {
      id: "prediction.wall.body",
      kind: "static",
      position: { x: 2, y: 0 }
    } as const;
    const wallCollider = {
      id: "prediction.wall.collider",
      bodyId: wallBody.id,
      shape: { type: "box", width: 1, height: 6 }
    } as const;
    const playerBody = {
      id: "prediction.player.body",
      kind: "dynamic",
      position: { x: 0, y: 0 },
      lockedAxes: ["rotation"]
    } as const;
    const playerCollider = {
      id: "prediction.player.collider",
      bodyId: playerBody.id,
      shape: { type: "circle", radius: 0.5 }
    } as const;
    const authority = backend.createScene(sceneConfig);
    authority.createBody(wallBody);
    authority.createCollider(wallCollider);
    authority.createBody(playerBody);
    authority.createCollider(playerCollider);
    const transition = createPhysicsBodyPredictionTransition<
      { x: number; y: number; velocityX: number; velocityY: number },
      { velocityX: number; velocityY: number }
    >({
      backend,
      scene: sceneConfig,
      fixedDeltaMs: 1000 / 60,
      environment: { bodies: [wallBody], colliders: [wallCollider] },
      subject: {
        body: playerBody,
        colliders: [playerCollider],
        readState(state) {
          return {
            position: { x: state.x, y: state.y },
            linearVelocity: { x: state.velocityX, y: state.velocityY }
          };
        },
        applyInput(_state, input) {
          return { linearVelocity: { x: input.velocityX, y: input.velocityY } };
        },
        writeState(_state, body) {
          return {
            x: body.position.x,
            y: body.position.y,
            velocityX: body.linearVelocity.x,
            velocityY: body.linearVelocity.y
          };
        }
      }
    });
    let predicted = { x: 0, y: 0, velocityX: 0, velocityY: 0 };
    const input = { velocityX: 6, velocityY: 2 };

    for (let sequence = 1; sequence <= 12; sequence += 1) {
      const beforePrediction = { ...predicted };
      authority.updateBody(playerBody.id, {
        linearVelocity: { x: input.velocityX, y: input.velocityY }
      });
      for (let subStep = 0; subStep < 3; subStep += 1) {
        authority.step(1000 / 60);
      }
      predicted = transition.apply(predicted, input, {
        sequence,
        input,
        replay: false,
        stepMs: 50
      });
      const replayed = transition.apply(beforePrediction, input, {
        sequence,
        input,
        replay: true,
        stepMs: 50
      });
      const authoritative = authority.getBodyState(playerBody.id);
      expect(authoritative).toBeDefined();
      expect(predicted.x).toBeCloseTo(authoritative!.position.x, 6);
      expect(predicted.y).toBeCloseTo(authoritative!.position.y, 6);
      expect(predicted.velocityX).toBeCloseTo(authoritative!.linearVelocity.x, 6);
      expect(predicted.velocityY).toBeCloseTo(authoritative!.linearVelocity.y, 6);
      expect(replayed).toEqual(predicted);
      predicted = replayed;
    }

    expect(predicted.x).toBeLessThan(1.1);
    expect(predicted.y).toBeGreaterThan(0.3);
    expect(transition.diagnostics()).toMatchObject({
      cachedReplays: 12,
      replayCacheMisses: 0,
      cachedFrames: 12
    });
    transition.dispose();
    authority.dispose();
  });

  it("steps bodies, emits collision events, and supports point and overlap queries", () => {
    const scene = backend.createScene({ gravity: { x: 0, y: 0 } });
    const bodyA = scene.createBody({
      kind: "dynamic",
      position: { x: 0, y: 0 },
      linearVelocity: { x: 1, y: 0 },
      rotation: { x: 0, y: 0, z: 0.25 }
    });
    const bodyB = scene.createBody({
      kind: "static",
      position: { x: 0, y: 0 }
    });
    const colliderA = scene.createCollider({
      bodyId: bodyA,
      shape: { type: "circle", radius: 0.5 }
    });
    const colliderB = scene.createCollider({
      bodyId: bodyB,
      shape: { type: "circle", radius: 0.5 },
      sensor: true
    });

    const result = scene.step(1000);

    expect(scene.getBodyState(bodyA)?.position.x).toBeGreaterThan(0.9);
    expect(scene.getBodyState(bodyA)?.rotation).toBeCloseTo(0.25);
    expect(result.contacts).toMatchObject([
      {
        phase: "enter",
        kind: "trigger",
        colliderA,
        colliderB,
        bodyA,
        bodyB,
        sensor: true
      }
    ]);
    expect(
      scene.query({ type: "point", point: { x: 0, y: 0 }, includeSensors: true })
    ).toHaveLength(1);
    expect(
      scene.query({
        type: "overlap",
        shape: { type: "circle", radius: 2 },
        position: { x: 0, y: 0 },
        includeSensors: true
      })
    ).toHaveLength(2);
    expect(scene.snapshot()).toMatchObject({
      backend: "rapier2d",
      dimension: "2d",
      bodyCount: 2,
      colliderCount: 2
    });
    expect((scene.native() as Rapier2dPhysicsNative).world).toBeDefined();

    scene.dispose();
    scene.dispose();
  });

  it("maps string collision groups when a group bit map is provided", async () => {
    const groupedBackend = await initRapier2dPhysicsBackend({
      id: "rapier2d-groups",
      groups: {
        actor: 0b0001,
        wall: 0b0010
      }
    });
    const scene = groupedBackend.createScene({ gravity: { x: 0, y: 0 } });
    const bodyA = scene.createBody({ kind: "static", position: { x: 0, y: 0 } });
    const bodyB = scene.createBody({ kind: "static", position: { x: 0, y: 0 } });
    scene.createCollider({
      bodyId: bodyA,
      shape: { type: "circle", radius: 1 },
      filter: { groups: ["actor"], collidesWith: ["wall"] }
    });
    scene.createCollider({
      bodyId: bodyB,
      shape: { type: "circle", radius: 1 },
      filter: { groups: ["wall"], collidesWith: ["actor"] }
    });
    scene.step(1000 / 60);

    expect(
      scene.query({
        type: "overlap",
        shape: { type: "circle", radius: 1 },
        includeSensors: true,
        filter: { groups: ["actor"], collidesWith: ["wall"] }
      })
    ).toHaveLength(1);

    scene.dispose();
  });

  it("supports raycast, shape cast, check, bounds, and query options", () => {
    const scene = backend.createScene({ gravity: { x: 0, y: 0 } });
    const actorBody = scene.createBody({ kind: "static", position: { x: 1, y: 0 } });
    const wallBody = scene.createBody({ kind: "static", position: { x: 3, y: 0 } });
    const sensorBody = scene.createBody({ kind: "static", position: { x: 5, y: 0 } });
    const actorCollider = scene.createCollider({
      bodyId: actorBody,
      shape: { type: "circle", radius: 0.45 }
    });
    const wallCollider = scene.createCollider({
      bodyId: wallBody,
      shape: { type: "box", width: 1, height: 1 }
    });
    const sensorCollider = scene.createCollider({
      bodyId: sensorBody,
      shape: { type: "circle", radius: 0.5 },
      sensor: true
    });
    scene.step(1000 / 60);

    expect(
      raycast(
        scene,
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        {
          maxDistance: 10,
          mode: "closest",
          triggerInteraction: "exclude",
          ignoreColliders: [actorCollider]
        }
      ).map((hit) => hit.colliderId)
    ).toEqual([wallCollider]);
    expect(
      scene
        .query({
          type: "overlap",
          shape: { type: "circle", radius: 0.6 },
          position: { x: 5, y: 0 },
          options: { triggerInteraction: "only" }
        })
        .map((hit) => hit.colliderId)
    ).toEqual([sensorCollider]);
    expect(
      shapeCast(
        scene,
        { type: "circle", radius: 0.25 },
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        {
          maxDistance: 2,
          mode: "any"
        }
      )
    ).toHaveLength(1);
    expect(checkOverlap(scene, { type: "box", width: 1, height: 1 }, { x: 3, y: 0 })).toBe(true);
    expect(
      queryBounds(scene, {
        min: { x: 4.4, y: -1 },
        max: { x: 5.6, y: 1 }
      }).map((hit) => hit.colliderId)
    ).toEqual([sensorCollider]);

    scene.dispose();
  });

  it("honors offset colliders, bit masks, include filters, result limits, and unsupported shape cast modes", () => {
    const scene = backend.createScene({ gravity: { x: 0, y: 0 } });
    const offsetBody = scene.createBody({ kind: "static", position: { x: 0, y: 0 } });
    const bodyB = scene.createBody({ kind: "static", position: { x: 2.75, y: 0 } });
    const bodyC = scene.createBody({ kind: "static", position: { x: 4.2, y: 0 } });
    const offsetCollider = scene.createCollider({
      bodyId: offsetBody,
      shape: { type: "circle", radius: 0.5 },
      offset: { position: { x: 2, y: 0 } },
      filter: { categoryBits: 0b0001, maskBits: 0b0100 }
    });
    const colliderB = scene.createCollider({
      bodyId: bodyB,
      shape: { type: "circle", radius: 0.5 },
      filter: { categoryBits: 0b0010, maskBits: 0b0100 }
    });
    const colliderC = scene.createCollider({
      bodyId: bodyC,
      shape: { type: "circle", radius: 0.5 },
      filter: { categoryBits: 0b1000, maskBits: 0b0010 }
    });
    const rayBodyA = scene.createBody({ kind: "static", position: { x: 1, y: 2 } });
    const rayBodyB = scene.createBody({ kind: "static", position: { x: 3, y: 2 } });
    const rayBodyC = scene.createBody({ kind: "static", position: { x: 5, y: 2 } });
    const rayColliderA = scene.createCollider({
      bodyId: rayBodyA,
      shape: { type: "circle", radius: 0.25 }
    });
    const rayColliderB = scene.createCollider({
      bodyId: rayBodyB,
      shape: { type: "circle", radius: 0.25 }
    });
    const rayColliderC = scene.createCollider({
      bodyId: rayBodyC,
      shape: { type: "circle", radius: 0.25 }
    });
    scene.step(1000 / 60);

    expect(scene.getColliderState(offsetCollider)?.offset).toMatchObject({
      position: { x: 2, y: 0 }
    });
    expect(queryPoint(scene, { x: 2, y: 0 }).map((hit) => hit.colliderId)).toEqual([
      offsetCollider
    ]);
    expect(checkCollision(scene, offsetCollider)).toBe(true);
    expect(
      queryBounds(
        scene,
        {
          min: { x: 0, y: -1 },
          max: { x: 5, y: 1 }
        },
        { includeBodies: [bodyB] }
      ).map((hit) => hit.colliderId)
    ).toEqual([colliderB]);
    expect(
      queryBounds(
        scene,
        {
          min: { x: 0, y: -1 },
          max: { x: 5, y: 1 }
        },
        { includeColliders: [offsetCollider] }
      ).map((hit) => hit.colliderId)
    ).toEqual([offsetCollider]);
    expect(
      queryBounds(
        scene,
        {
          min: { x: 0, y: -1 },
          max: { x: 5, y: 1 }
        },
        { filter: { categoryBits: 0b0100, maskBits: 0b0001 } }
      ).map((hit) => hit.colliderId)
    ).toEqual([offsetCollider]);
    expect(colliderC).toBeDefined();
    const limitedOverlapHits = scene
      .query({
        type: "overlap",
        shape: { type: "box", width: 6, height: 1 },
        position: { x: 3, y: 2 },
        options: { maxResults: 2 }
      })
      .map((hit) => hit.colliderId);
    expect(limitedOverlapHits).toHaveLength(2);
    expect(new Set(limitedOverlapHits).size).toBe(2);
    expect([rayColliderA, rayColliderB, rayColliderC]).toEqual(
      expect.arrayContaining(limitedOverlapHits)
    );
    expect(() =>
      shapeCast(
        scene,
        { type: "circle", radius: 0.25 },
        { x: 0, y: 2 },
        { x: 1, y: 0 },
        {
          maxDistance: 2,
          mode: "all"
        }
      )
    ).toThrow("Rapier 2D shape cast supports any/closest mode only");

    scene.dispose();
  });
});

describe("Rapier 2D physics module", () => {
  it("syncs through the standard Physics GameModule helper", () => {
    const world = createMemoryWorld();
    const mover = world.spawn();
    const wall = world.spawn();
    world.add(mover, PhysicsBodyComponent, {
      definition: { kind: "dynamic" }
    });
    world.add(mover, PhysicsTransformComponent, {
      position: { x: 0, y: 0 }
    });
    world.add(mover, PhysicsColliderComponent, {
      definition: { shape: { type: "circle", radius: 0.5 } }
    });
    world.add(wall, PhysicsBodyComponent, {
      definition: { kind: "static" }
    });
    world.add(wall, PhysicsTransformComponent, {
      position: { x: 0, y: 0 }
    });
    world.add(wall, PhysicsColliderComponent, {
      definition: { shape: { type: "circle", radius: 0.5 }, sensor: true }
    });

    const eventBus = createEventBus({ clock: () => 1 });
    const contacts: PhysicsContactEvent[] = [];
    eventBus.on<PhysicsContactEvent>("physics.trigger.enter", (event) => {
      contacts.push(event.payload);
    });
    const runtime = createGame({
      modules: [
        createPhysicsModule({
          backend,
          fixedDeltaMs: 1000 / 60,
          scene: { gravity: { x: 0, y: 0 } }
        })
      ],
      world,
      eventBus,
      seed: "rapier"
    });

    runtime.start();
    runtime.tick(1000 / 60);

    expect(world.get(mover, PhysicsBodyComponent)?.bodyId).toBeDefined();
    expect(world.get(mover, PhysicsColliderComponent)?.colliderId).toBeDefined();
    expect(contacts).toHaveLength(1);
    expect(contacts[0]).toMatchObject({
      phase: "enter",
      kind: "trigger",
      entityA: mover,
      entityB: wall
    });

    runtime.dispose();
  });
});

function createMemoryWorld(): GameWorld {
  let nextEntity = 1;
  const components = new Map<EntityId, Map<string, object>>();

  return {
    spawn() {
      const entity = nextEntity;
      nextEntity += 1;
      components.set(entity, new Map());
      return entity;
    },
    despawn(entity) {
      components.delete(entity);
    },
    has(entity) {
      return components.has(entity);
    },
    add<T extends object>(entity: EntityId, component: ComponentDef<T>, data?: Partial<T>) {
      requireEntity(components, entity).set(component.id, component.create(data));
    },
    get<T extends object>(entity: EntityId, component: ComponentDef<T>) {
      return requireEntity(components, entity).get(component.id) as T | undefined;
    },
    set<T extends object>(entity: EntityId, component: ComponentDef<T>, data: Partial<T>) {
      const entityComponents = requireEntity(components, entity);
      const current = entityComponents.get(component.id) as T | undefined;
      entityComponents.set(component.id, { ...(current ?? component.create()), ...data });
    },
    remove(entity, component) {
      requireEntity(components, entity).delete(component.id);
    },
    query(required = []) {
      const result: EntityId[] = [];
      for (const [entity, entityComponents] of components.entries()) {
        if (required.every((component) => entityComponents.has(component.id))) {
          result.push(entity);
        }
      }

      return result;
    },
    count() {
      return components.size;
    }
  };
}

function requireEntity(
  components: Map<EntityId, Map<string, object>>,
  entity: EntityId
): Map<string, object> {
  const entityComponents = components.get(entity);
  if (!entityComponents) {
    throw new Error(`Missing entity: ${String(entity)}`);
  }

  return entityComponents;
}
