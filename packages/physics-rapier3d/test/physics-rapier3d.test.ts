import { createEventBus } from "@gamekits/event-bus";
import { createGame } from "@gamekits/game-runtime";
import {
  PhysicsBodyComponent,
  PhysicsColliderComponent,
  PhysicsTransformComponent,
  createPhysicsModule,
  checkCollision,
  checkOverlap,
  queryBounds,
  queryPoint,
  raycast,
  shapeCast,
  type PhysicsContactEvent,
  type PhysicsQuaternion
} from "@gamekits/physics-core";
import { type ComponentDef, type EntityId, type GameWorld } from "@gamekits/world";
import { beforeAll, describe, expect, it } from "vitest";
import { initRapier3dPhysicsBackend, type Rapier3dPhysicsNative } from "../src";

let backend: Awaited<ReturnType<typeof initRapier3dPhysicsBackend>>;

beforeAll(async () => {
  backend = await initRapier3dPhysicsBackend();
});

describe("Rapier 3D physics backend", () => {
  it("distinguishes kinematic next-step targets from immediate authority correction", () => {
    const scene = backend.createScene({ gravity: { x: 0, y: 0, z: 0 } });
    scene.createBody({
      id: "kinematic.body",
      kind: "kinematic",
      position: { x: 0, y: 0, z: 0 }
    });

    scene.updateBody("kinematic.body", {
      position: { x: 2, y: 0, z: 0 },
      rotation: { x: 0, y: Math.PI / 3, z: 0 }
    });
    expect(scene.getBodyState("kinematic.body")).toMatchObject({
      position: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0, w: 1 }
    });
    scene.step(1000 / 60);
    expect(scene.getBodyState("kinematic.body")?.position.x).toBeCloseTo(2, 6);

    scene.updateBody(
      "kinematic.body",
      {
        position: { x: 7, y: 1, z: -3 },
        rotation: { x: 0, y: -Math.PI / 2, z: 0 }
      },
      { kinematicTransformMode: "teleport" }
    );
    const corrected = scene.getBodyState("kinematic.body")!;
    expect(corrected.position).toEqual({ x: 7, y: 1, z: -3 });
    expect((corrected.rotation as PhysicsQuaternion).y).toBeCloseTo(-Math.SQRT1_2, 6);
    expect((corrected.rotation as PhysicsQuaternion).w).toBeCloseTo(Math.SQRT1_2, 6);

    scene.dispose();
  });

  it("restores solver-owned CCD bodies with material response from a full checkpoint", () => {
    const scene = backend.createScene({
      id: "rapier3d.prediction-island.checkpoint",
      gravity: { x: 0, y: -9.81, z: 0 },
      materialDefinitions: [
        {
          id: "material.ballistic",
          friction: 0.05,
          restitution: 0.85,
          density: 3,
          combine: { restitution: "max" }
        },
        {
          id: "material.floor",
          friction: 0.5,
          restitution: 0.75,
          combine: { restitution: "max" }
        }
      ]
    });
    scene.createBody({ id: "floor.body", kind: "static", position: { x: 0, y: -2, z: 0 } });
    scene.createCollider({
      id: "floor.collider",
      bodyId: "floor.body",
      shape: { type: "box", width: 40, height: 1, depth: 40 },
      material: "material.floor"
    });
    scene.createBody({
      id: "round.body",
      kind: "dynamic",
      position: { x: 0, y: 4, z: 0 },
      linearVelocity: { x: 3, y: -32, z: 2 },
      continuousCollisionDetection: true
    });
    scene.createCollider({
      id: "round.collider",
      bodyId: "round.body",
      shape: { type: "sphere", radius: 0.35 },
      material: "material.ballistic"
    });

    const checkpoint = scene.captureCheckpoint?.();
    expect(checkpoint).toBeDefined();
    const checkpointBytes = new Uint8Array(
      (checkpoint!.payload as { bytes: Uint8Array }).bytes
    ).slice();
    for (let tick = 0; tick < 24; tick += 1) {
      scene.step(1000 / 60);
    }
    const firstReplay = scene.getBodyState("round.body")!;
    expect(firstReplay.linearVelocity.y).toBeGreaterThan(0);

    scene.restoreCheckpoint?.(checkpoint!);
    for (let tick = 0; tick < 24; tick += 1) {
      scene.step(1000 / 60);
    }
    const secondReplay = scene.getBodyState("round.body")!;
    expect(secondReplay.position.x).toBeCloseTo(firstReplay.position.x, 6);
    expect(secondReplay.position.y).toBeCloseTo(firstReplay.position.y, 6);
    expect(secondReplay.position.z).toBeCloseTo(firstReplay.position.z ?? Number.NaN, 6);
    expect(secondReplay.linearVelocity.y).toBeCloseTo(firstReplay.linearVelocity.y, 6);
    scene.restoreCheckpoint?.(checkpoint!);
    expect((checkpoint!.payload as { bytes: Uint8Array }).bytes).toEqual(checkpointBytes);
    for (let tick = 0; tick < 24; tick += 1) {
      scene.step(1000 / 60);
    }
    expect(scene.getBodyState("round.body")?.position).toEqual(secondReplay.position);
    expect(backend.capabilities().checkpoints).toMatchObject({
      captureRestore: true,
      fullScene: true,
      deterministicReplay: true
    });
    scene.dispose();
  });

  it("steps bodies, emits collision events, and supports point and overlap queries", () => {
    const scene = backend.createScene({ gravity: { x: 0, y: 0, z: 0 } });
    const bodyA = scene.createBody({
      kind: "dynamic",
      position: { x: 0, y: 0, z: 0 },
      linearVelocity: { x: 1, y: 0, z: 0.5 },
      rotation: { x: 0, y: 0, z: 0.25 }
    });
    const bodyB = scene.createBody({
      kind: "static",
      position: { x: 0, y: 0, z: 0 }
    });
    const colliderA = scene.createCollider({
      bodyId: bodyA,
      shape: { type: "sphere", radius: 0.5 }
    });
    const colliderB = scene.createCollider({
      bodyId: bodyB,
      shape: { type: "sphere", radius: 0.5 },
      sensor: true
    });

    const result = scene.step(1000);
    const state = scene.getBodyState(bodyA);
    const rotation = state?.rotation as PhysicsQuaternion | undefined;

    expect(state?.position.x).toBeGreaterThan(0.9);
    expect(state?.position.z).toBeGreaterThan(0.4);
    expect(rotation?.z).toBeCloseTo(Math.sin(0.125));
    expect(rotation?.w).toBeCloseTo(Math.cos(0.125));
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
      scene.query({ type: "point", point: { x: 0, y: 0, z: 0 }, includeSensors: true })
    ).toHaveLength(1);
    expect(
      scene.query({
        type: "overlap",
        shape: { type: "box", width: 3, height: 3, depth: 3 },
        position: { x: 0, y: 0, z: 0 },
        includeSensors: true
      })
    ).toHaveLength(2);
    expect(scene.snapshot()).toMatchObject({
      backend: "rapier3d",
      dimension: "3d",
      bodyCount: 2,
      colliderCount: 2
    });
    expect((scene.native() as Rapier3dPhysicsNative).world).toBeDefined();

    scene.dispose();
    scene.dispose();
  });

  it("maps string collision groups when a group bit map is provided", async () => {
    const groupedBackend = await initRapier3dPhysicsBackend({
      id: "rapier3d-groups",
      groups: {
        actor: 0b0001,
        wall: 0b0010
      }
    });
    const scene = groupedBackend.createScene({ gravity: { x: 0, y: 0, z: 0 } });
    const bodyA = scene.createBody({ kind: "static", position: { x: 0, y: 0, z: 0 } });
    const bodyB = scene.createBody({ kind: "static", position: { x: 0, y: 0, z: 0 } });
    scene.createCollider({
      bodyId: bodyA,
      shape: { type: "sphere", radius: 1 },
      filter: { groups: ["actor"], collidesWith: ["wall"] }
    });
    scene.createCollider({
      bodyId: bodyB,
      shape: { type: "sphere", radius: 1 },
      filter: { groups: ["wall"], collidesWith: ["actor"] }
    });
    scene.step(1000 / 60);

    expect(
      scene.query({
        type: "overlap",
        shape: { type: "sphere", radius: 1 },
        includeSensors: true,
        filter: { groups: ["actor"], collidesWith: ["wall"] }
      })
    ).toHaveLength(1);

    scene.dispose();
  });

  it("supports raycast, shape cast, check, bounds, and query options", () => {
    const scene = backend.createScene({ gravity: { x: 0, y: 0, z: 0 } });
    const actorBody = scene.createBody({ kind: "static", position: { x: 1, y: 0, z: 0 } });
    const wallBody = scene.createBody({ kind: "static", position: { x: 3, y: 0, z: 0 } });
    const sensorBody = scene.createBody({ kind: "static", position: { x: 5, y: 0, z: 0 } });
    const actorCollider = scene.createCollider({
      bodyId: actorBody,
      shape: { type: "sphere", radius: 0.45 }
    });
    const wallCollider = scene.createCollider({
      bodyId: wallBody,
      shape: { type: "box", width: 1, height: 1, depth: 1 }
    });
    const sensorCollider = scene.createCollider({
      bodyId: sensorBody,
      shape: { type: "sphere", radius: 0.5 },
      sensor: true
    });
    scene.step(1000 / 60);

    expect(
      raycast(
        scene,
        { x: 0, y: 0, z: 0 },
        { x: 1, y: 0, z: 0 },
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
          shape: { type: "sphere", radius: 0.6 },
          position: { x: 5, y: 0, z: 0 },
          options: { triggerInteraction: "only" }
        })
        .map((hit) => hit.colliderId)
    ).toEqual([sensorCollider]);
    expect(
      shapeCast(
        scene,
        { type: "sphere", radius: 0.25 },
        { x: 0, y: 0, z: 0 },
        { x: 1, y: 0, z: 0 },
        {
          maxDistance: 2,
          mode: "any"
        }
      )
    ).toHaveLength(1);
    expect(
      checkOverlap(scene, { type: "box", width: 1, height: 1, depth: 1 }, { x: 3, y: 0, z: 0 })
    ).toBe(true);
    expect(
      queryBounds(scene, {
        min: { x: 4.4, y: -1, z: -1 },
        max: { x: 5.6, y: 1, z: 1 }
      }).map((hit) => hit.colliderId)
    ).toEqual([sensorCollider]);

    scene.dispose();
  });

  it("honors offset colliders, bit masks, include filters, result limits, and unsupported shape cast modes", () => {
    const scene = backend.createScene({ gravity: { x: 0, y: 0, z: 0 } });
    const offsetBody = scene.createBody({ kind: "static", position: { x: 0, y: 0, z: 0 } });
    const bodyB = scene.createBody({ kind: "static", position: { x: 2.75, y: 0, z: 0 } });
    const bodyC = scene.createBody({ kind: "static", position: { x: 4.2, y: 0, z: 0 } });
    const offsetCollider = scene.createCollider({
      bodyId: offsetBody,
      shape: { type: "sphere", radius: 0.5 },
      offset: { position: { x: 2, y: 0, z: 0 } },
      filter: { categoryBits: 0b0001, maskBits: 0b0100 }
    });
    const colliderB = scene.createCollider({
      bodyId: bodyB,
      shape: { type: "sphere", radius: 0.5 },
      filter: { categoryBits: 0b0010, maskBits: 0b0100 }
    });
    const colliderC = scene.createCollider({
      bodyId: bodyC,
      shape: { type: "sphere", radius: 0.5 },
      filter: { categoryBits: 0b1000, maskBits: 0b0010 }
    });
    const rayBodyA = scene.createBody({ kind: "static", position: { x: 1, y: 2, z: 0 } });
    const rayBodyB = scene.createBody({ kind: "static", position: { x: 3, y: 2, z: 0 } });
    const rayBodyC = scene.createBody({ kind: "static", position: { x: 5, y: 2, z: 0 } });
    const rayColliderA = scene.createCollider({
      bodyId: rayBodyA,
      shape: { type: "sphere", radius: 0.25 }
    });
    const rayColliderB = scene.createCollider({
      bodyId: rayBodyB,
      shape: { type: "sphere", radius: 0.25 }
    });
    const rayColliderC = scene.createCollider({
      bodyId: rayBodyC,
      shape: { type: "sphere", radius: 0.25 }
    });
    scene.step(1000 / 60);

    expect(scene.getColliderState(offsetCollider)?.offset).toMatchObject({
      position: { x: 2, y: 0, z: 0 }
    });
    expect(queryPoint(scene, { x: 2, y: 0, z: 0 }).map((hit) => hit.colliderId)).toEqual([
      offsetCollider
    ]);
    expect(checkCollision(scene, offsetCollider)).toBe(true);
    expect(
      queryBounds(
        scene,
        {
          min: { x: 0, y: -1, z: -1 },
          max: { x: 5, y: 1, z: 1 }
        },
        { includeBodies: [bodyB] }
      ).map((hit) => hit.colliderId)
    ).toEqual([colliderB]);
    expect(
      queryBounds(
        scene,
        {
          min: { x: 0, y: -1, z: -1 },
          max: { x: 5, y: 1, z: 1 }
        },
        { includeColliders: [offsetCollider] }
      ).map((hit) => hit.colliderId)
    ).toEqual([offsetCollider]);
    expect(
      queryBounds(
        scene,
        {
          min: { x: 0, y: -1, z: -1 },
          max: { x: 5, y: 1, z: 1 }
        },
        { filter: { categoryBits: 0b0100, maskBits: 0b0001 } }
      ).map((hit) => hit.colliderId)
    ).toEqual([offsetCollider]);
    expect(colliderC).toBeDefined();
    const limitedOverlapHits = scene
      .query({
        type: "overlap",
        shape: { type: "box", width: 6, height: 1, depth: 1 },
        position: { x: 3, y: 2, z: 0 },
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
        { type: "sphere", radius: 0.25 },
        { x: 0, y: 2, z: 0 },
        { x: 1, y: 0, z: 0 },
        {
          maxDistance: 2,
          mode: "all"
        }
      )
    ).toThrow("Rapier 3D shape cast supports any/closest mode only");

    scene.dispose();
  });
});

describe("Rapier 3D physics module", () => {
  it("syncs through the standard Physics GameModule helper", () => {
    const world = createMemoryWorld();
    const mover = world.spawn();
    const wall = world.spawn();
    world.add(mover, PhysicsBodyComponent, {
      definition: { kind: "dynamic" }
    });
    world.add(mover, PhysicsTransformComponent, {
      position: { x: 0, y: 0, z: 0 }
    });
    world.add(mover, PhysicsColliderComponent, {
      definition: { shape: { type: "sphere", radius: 0.5 } }
    });
    world.add(wall, PhysicsBodyComponent, {
      definition: { kind: "static" }
    });
    world.add(wall, PhysicsTransformComponent, {
      position: { x: 0, y: 0, z: 0 }
    });
    world.add(wall, PhysicsColliderComponent, {
      definition: { shape: { type: "sphere", radius: 0.5 }, sensor: true }
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
          scene: { dimension: "3d", gravity: { x: 0, y: 0, z: 0 } }
        })
      ],
      world,
      eventBus,
      seed: "rapier3d"
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
