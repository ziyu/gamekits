import { GameError } from "@gamekits/core";
import { createDataRegistry } from "@gamekits/data";
import { createEventBus } from "@gamekits/event-bus";
import { createGame } from "@gamekits/game-runtime";
import { type ComponentDef, type EntityId, type GameWorld } from "@gamekits/world";
import { describe, expect, it } from "vitest";
import {
  PhysicsBodyComponent,
  PhysicsColliderComponent,
  PhysicsTransformComponent,
  PhysicsVelocityComponent,
  createMemoryPhysicsBackend,
  createPhysicsBodyPredictionTransition,
  createPhysicsHandle,
  createPhysicsInterpolationStore,
  createPhysicsDataTypes,
  createPhysicsLayoutModule,
  createPhysicsLayoutDefinitions,
  createPhysicsModule,
  createPhysicsSaveContributor,
  createPhysicsTraceStore,
  checkCollision,
  checkOverlap,
  overlapShape,
  queryBounds,
  queryPoint,
  raycast,
  shapeCast,
  type PhysicsContactEvent
} from "../src";

describe("Physics data types", () => {
  it("validates physics documents and tracks references", () => {
    const registry = createDataRegistry();
    for (const definition of createPhysicsDataTypes()) {
      registry.registerType(definition);
    }

    const validation = registry.registerPack({
      id: "physics",
      version: "1.0.0",
      entries: [
        {
          type: "physics.material",
          id: "mat.stone",
          data: { id: "mat.stone", density: 1 }
        },
        {
          type: "physics.collider",
          id: "collider.hero",
          data: { shape: { type: "circle", radius: 1 }, material: "mat.stone" }
        },
        {
          type: "physics.body",
          id: "body.hero",
          data: {
            kind: "dynamic",
            colliders: [{ type: "physics.collider", id: "collider.hero" }]
          }
        },
        {
          type: "physics.scene",
          id: "scene.test",
          data: { id: "scene.test", dimension: "2d", gravity: { x: 0, y: 0 } }
        },
        {
          type: "physics.layout",
          id: "layout.test",
          data: {
            id: "layout.test",
            scene: { type: "physics.scene", id: "scene.test" },
            bodies: [
              {
                id: "hero",
                body: { type: "physics.body", id: "body.hero" },
                position: { x: 2, y: 3 }
              }
            ]
          }
        }
      ]
    });

    expect(validation.diagnostics).toEqual([]);
    expect(registry.referencesFrom({ type: "physics.body", id: "body.hero" })).toMatchObject([
      { to: { type: "physics.collider", id: "collider.hero" } }
    ]);
    expect(
      registry.referencesFrom({ type: "physics.collider", id: "collider.hero" })
    ).toMatchObject([{ to: { type: "physics.material", id: "mat.stone" } }]);
    expect(registry.referencesFrom({ type: "physics.layout", id: "layout.test" })).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ to: { type: "physics.scene", id: "scene.test" } }),
        expect.objectContaining({ to: { type: "physics.body", id: "body.hero" } })
      ])
    );
  });

  it("validates two- and three-dimensional layout bounds consistently", () => {
    const registry = createDataRegistry();
    for (const definition of createPhysicsDataTypes()) {
      registry.registerType(definition);
    }

    const validation = registry.validatePack({
      id: "invalid-3d-layout",
      version: "1.0.0",
      entries: [
        {
          type: "physics.layout",
          id: "layout.invalid-3d",
          data: {
            id: "layout.invalid-3d",
            bounds: { min: { x: 0, y: 0, z: 0 }, max: { x: 10, y: 10 } },
            bodies: []
          }
        }
      ]
    });

    expect(validation.diagnostics).toEqual([
      expect.objectContaining({ code: "physics.layout_invalid_bounds" })
    ]);
  });
});

describe("Physics layout module", () => {
  it("materializes one shared body with independently placed collider instances", () => {
    const registry = createDataRegistry();
    for (const definition of createPhysicsDataTypes()) {
      registry.registerType(definition);
    }
    registry.registerPack({
      id: "layout-fixture",
      version: "1.0.0",
      entries: [
        {
          type: "physics.collider",
          id: "collider.solid",
          data: { id: "collider.solid", shape: { type: "box", width: 1, height: 1 } }
        },
        {
          type: "physics.body",
          id: "body.architecture",
          data: { id: "body.architecture", kind: "static" }
        },
        {
          type: "physics.layout",
          id: "layout.arena",
          data: {
            id: "layout.arena",
            bounds: { min: { x: 0, y: 0 }, max: { x: 20, y: 10 } },
            bodies: [
              {
                id: "architecture",
                body: { type: "physics.body", id: "body.architecture" },
                overrides: {
                  damping: { linear: 0.5 },
                  userData: { source: "layout-fixture" }
                },
                colliders: [
                  {
                    id: "wall.left",
                    collider: { type: "physics.collider", id: "collider.solid" },
                    overrides: {
                      shape: { type: "box", width: 2, height: 10 },
                      offset: { position: { x: 1, y: 5 } }
                    }
                  },
                  {
                    id: "wall.right",
                    collider: { type: "physics.collider", id: "collider.solid" },
                    overrides: {
                      shape: { type: "box", width: 2, height: 10 },
                      offset: { position: { x: 19, y: 5 } }
                    }
                  }
                ]
              }
            ]
          }
        }
      ]
    });
    const world = createMemoryWorld();
    const definitions = createPhysicsLayoutDefinitions({
      dataRegistry: registry,
      layoutId: "layout.arena",
      idPrefix: "prediction.arena"
    });
    expect(definitions).toMatchObject({
      layoutId: "layout.arena",
      bodies: [
        {
          instanceId: "architecture",
          definition: { id: "prediction.arena.architecture.body", kind: "static" }
        }
      ],
      colliders: [
        {
          instanceId: "wall.left",
          definition: {
            id: "prediction.arena.architecture.wall.left.collider",
            bodyId: "prediction.arena.architecture.body"
          }
        },
        {
          instanceId: "wall.right",
          definition: {
            id: "prediction.arena.architecture.wall.right.collider",
            bodyId: "prediction.arena.architecture.body"
          }
        }
      ]
    });
    const physics = createPhysicsHandle({ id: "layout.physics" });
    const runtime = createGame({
      modules: [
        createPhysicsLayoutModule({ dataRegistry: registry, layoutId: "layout.arena" }),
        createPhysicsModule({
          backend: createMemoryPhysicsBackend(),
          fixedDeltaMs: 16,
          scene: { gravity: { x: 0, y: 0 } },
          handle: physics
        })
      ],
      world,
      eventBus: createEventBus({ clock: () => 1 }),
      seed: "physics-layout"
    });

    expect(world.count()).toBe(3);
    const bodyEntity = [...world.query([PhysicsBodyComponent])][0];
    expect(bodyEntity).toBeDefined();
    if (bodyEntity === undefined) {
      throw new Error("Expected materialized layout body");
    }
    expect(world.get(bodyEntity, PhysicsBodyComponent)?.definition).toMatchObject({
      damping: { linear: 0.5 },
      userData: {
        source: "layout-fixture",
        physicsLayoutId: "layout.arena",
        physicsLayoutBodyInstanceId: "architecture"
      }
    });
    runtime.start();
    runtime.tick(16);
    expect(physics.snapshot()).toMatchObject({ bodyCount: 1, colliderCount: 2 });
    expect(physics.queryPoint({ x: 1, y: 5 }).map((hit) => hit.colliderId)).toEqual([
      "layout.arena.architecture.wall.left.collider"
    ]);
    expect(physics.queryPoint({ x: 19, y: 5 }).map((hit) => hit.colliderId)).toEqual([
      "layout.arena.architecture.wall.right.collider"
    ]);

    runtime.dispose();
    expect(world.count()).toBe(0);
  });
});

describe("Physics body prediction transition", () => {
  it("steps a backend-owned subject from declarative state and input bindings", () => {
    const transition = createPhysicsBodyPredictionTransition<
      { x: number; velocityX: number },
      { velocityX: number }
    >({
      backend: createMemoryPhysicsBackend(),
      scene: { gravity: { x: 0, y: 0 } },
      fixedDeltaMs: 25,
      subject: {
        body: { id: "prediction.player", kind: "dynamic" },
        readState(state) {
          return {
            position: { x: state.x, y: 0 },
            linearVelocity: { x: state.velocityX, y: 0 }
          };
        },
        applyInput(_state, input) {
          return { linearVelocity: { x: input.velocityX, y: 0 } };
        },
        writeState(state, body) {
          state.x = body.position.x;
          state.velocityX = body.linearVelocity.x;
          return state;
        }
      }
    });
    const state = transition.apply(
      { x: 0, velocityX: 0 },
      { velocityX: 4 },
      { sequence: 1, input: { velocityX: 4 }, replay: false, stepMs: 50 }
    );

    expect(state).toEqual({ x: 0.2, velocityX: 4 });
    expect(transition.diagnostics()).toMatchObject({
      predictedInputs: 1,
      replayedInputs: 0,
      physicsSteps: 2,
      lastSubSteps: 2,
      droppedStepTimeMs: 0
    });

    transition.dispose();
    expect(() =>
      transition.apply(
        state,
        { velocityX: 0 },
        { sequence: 2, input: { velocityX: 0 }, replay: true, stepMs: 50 }
      )
    ).toThrow("disposed");
  });

  it("reuses matching sequence checkpoints without rewinding the backend scene", () => {
    let physicsSteps = 0;
    const transition = createPhysicsBodyPredictionTransition<
      { x: number; velocityX: number },
      { velocityX: number }
    >({
      backend: createMemoryPhysicsBackend(),
      scene: { gravity: { x: 0, y: 0 } },
      fixedDeltaMs: 25,
      onStep() {
        physicsSteps += 1;
      },
      subject: {
        body: { id: "prediction.cached-player", kind: "dynamic" },
        readState(state) {
          return {
            position: { x: state.x, y: 0 },
            linearVelocity: { x: state.velocityX, y: 0 }
          };
        },
        applyInput(_state, input) {
          return { linearVelocity: { x: input.velocityX, y: 0 } };
        },
        writeState(_state, body) {
          return { x: body.position.x, velocityX: body.linearVelocity.x };
        }
      }
    });
    const firstInput = { velocityX: 2 };
    const secondInput = { velocityX: 4 };
    const first = transition.apply({ x: 0, velocityX: 0 }, firstInput, {
      sequence: 1,
      input: firstInput,
      replay: false,
      stepMs: 50
    });
    const second = transition.apply(first, secondInput, {
      sequence: 2,
      input: secondInput,
      replay: false,
      stepMs: 50
    });
    const replayed = transition.apply({ ...first }, secondInput, {
      sequence: 2,
      input: secondInput,
      replay: true,
      stepMs: 50
    });

    expect(replayed).toEqual(second);
    expect(physicsSteps).toBe(4);
    expect(transition.diagnostics()).toMatchObject({
      cachedReplays: 1,
      replayCacheMisses: 0,
      cachedFrames: 2,
      lastSubSteps: 0
    });
    transition.dispose();
  });
});

describe("Memory physics backend", () => {
  it("steps bodies, tracks contacts, and supports overlap queries", () => {
    const backend = createMemoryPhysicsBackend();
    const scene = backend.createScene({ gravity: { x: 0, y: 0 } });
    const bodyA = scene.createBody({
      kind: "dynamic",
      position: { x: 0, y: 0 },
      linearVelocity: { x: 2, y: 0 }
    });
    const bodyB = scene.createBody({
      kind: "static",
      position: { x: 2, y: 0 }
    });
    const colliderA = scene.createCollider({
      bodyId: bodyA,
      shape: { type: "circle", radius: 0.5 }
    });
    scene.createCollider({
      bodyId: bodyB,
      shape: { type: "circle", radius: 0.5 },
      sensor: true
    });

    const result = scene.step(1000);

    expect(scene.getBodyState(bodyA)?.position).toMatchObject({ x: 2, y: 0 });
    expect(result.contacts).toMatchObject([{ phase: "enter", kind: "trigger", colliderA }]);
    expect(
      scene.query({
        type: "overlap",
        shape: { type: "circle", radius: 1 },
        position: { x: 2, y: 0 }
      })
    ).toHaveLength(2);
  });

  it("supports query families, trigger interaction, filters, sorting, and ignore lists", () => {
    const backend = createMemoryPhysicsBackend({ dimension: "3d" });
    const scene = backend.createScene({ dimension: "3d", gravity: { x: 0, y: 0, z: 0 } });
    const actorBody = scene.createBody({ kind: "static", position: { x: 1, y: 0, z: 0 } });
    const wallBody = scene.createBody({ kind: "static", position: { x: 3, y: 0, z: 0 } });
    const sensorBody = scene.createBody({ kind: "static", position: { x: 5, y: 0, z: 0 } });
    const actorCollider = scene.createCollider({
      bodyId: actorBody,
      shape: { type: "sphere", radius: 0.45 },
      filter: { groups: ["actor"], collidesWith: ["query"] }
    });
    const wallCollider = scene.createCollider({
      bodyId: wallBody,
      shape: { type: "box", width: 1, height: 1, depth: 1 },
      filter: { groups: ["wall"], collidesWith: ["query"] }
    });
    const sensorCollider = scene.createCollider({
      bodyId: sensorBody,
      shape: { type: "sphere", radius: 0.5 },
      sensor: true,
      filter: { groups: ["sensor"], collidesWith: ["query"] }
    });

    expect(
      raycast(
        scene,
        { x: 0, y: 0, z: 0 },
        { x: 1, y: 0, z: 0 },
        {
          maxDistance: 10,
          mode: "closest",
          sort: "distance",
          filter: { groups: ["query"], collidesWith: ["wall"] }
        }
      ).map((hit) => hit.colliderId)
    ).toEqual([wallCollider]);
    expect(
      raycast(
        scene,
        { x: 0, y: 0, z: 0 },
        { x: 1, y: 0, z: 0 },
        {
          maxDistance: 10,
          triggerInteraction: "exclude",
          ignoreColliders: [actorCollider],
          sort: "distance"
        }
      ).map((hit) => hit.colliderId)
    ).toEqual([wallCollider]);
    expect(
      overlapShape(
        scene,
        { type: "sphere", radius: 0.6 },
        { x: 5, y: 0, z: 0 },
        {
          triggerInteraction: "only"
        }
      ).map((hit) => hit.colliderId)
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
    expect(scene.getColliderState(sensorCollider)).toMatchObject({ sensor: true });
  });

  it("honors collider offsets, include lists, bit masks, and max result limits", () => {
    const backend = createMemoryPhysicsBackend({ dimension: "3d" });
    const scene = backend.createScene({ dimension: "3d", gravity: { x: 0, y: 0, z: 0 } });
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
    const limitedRayHits = raycast(
      scene,
      { x: 0, y: 0, z: 0 },
      { x: 1, y: 0, z: 0 },
      {
        maxDistance: 10,
        sort: "distance",
        maxResults: 2
      }
    ).map((hit) => hit.colliderId);
    expect(limitedRayHits).toEqual([offsetCollider, colliderB]);
    expect(limitedRayHits).not.toContain(colliderC);
  });
});

describe("Physics trace store", () => {
  it("isolates observer failures from gameplay writes", () => {
    const observerError = new Error("observer failed");
    const errors: unknown[] = [];
    const traceStore = createPhysicsTraceStore({
      onEntry() {
        throw observerError;
      },
      onEntryError(error) {
        errors.push(error);
        throw new Error("error observer failed");
      }
    });

    expect(() => traceStore.push({ kind: "step", label: "safe" })).not.toThrow();
    expect(traceStore.list()).toHaveLength(1);
    expect(errors).toEqual([observerError]);
  });
});

describe("Physics module", () => {
  it("runs integral fixed sub-steps despite floating-point division residue", () => {
    const traceStore = createPhysicsTraceStore();
    const runtime = createGame({
      modules: [
        createPhysicsModule({
          backend: createMemoryPhysicsBackend(),
          fixedDeltaMs: 1_000 / 60,
          maxSubSteps: 4,
          traceStore
        })
      ],
      world: createMemoryWorld(),
      eventBus: createEventBus({ clock: () => 1 }),
      seed: "physics-integral-substeps"
    });

    runtime.start();
    runtime.tick(50);

    expect(traceStore.list().filter((entry) => entry.kind === "step")).toHaveLength(3);
    expect(
      traceStore.list().some((entry) => entry.label === "physics.max_sub_steps_exceeded")
    ).toBe(false);
    runtime.dispose();
  });

  it("samples fixed-step transforms smoothly without changing authoritative world state", () => {
    const world = createMemoryWorld();
    const mover = world.spawn();
    world.add(mover, PhysicsBodyComponent, {
      definition: { kind: "dynamic" }
    });
    world.add(mover, PhysicsTransformComponent, {
      position: { x: 0, y: 0 }
    });
    world.add(mover, PhysicsVelocityComponent, {
      linear: { x: 10, y: 0 }
    });

    const interpolation = createPhysicsInterpolationStore({ id: "test.interpolation" });
    const runtime = createGame({
      modules: [
        createPhysicsModule({
          backend: createMemoryPhysicsBackend(),
          fixedDeltaMs: 1_000,
          scene: { gravity: { x: 0, y: 0 } },
          interpolationStore: interpolation
        })
      ],
      world,
      eventBus: createEventBus({ clock: () => 1 }),
      seed: "physics-interpolation"
    });

    runtime.start();
    runtime.tick(1_000);
    const bodyId = world.get(mover, PhysicsBodyComponent)?.bodyId;
    expect(bodyId).toBeDefined();
    if (!bodyId) {
      throw new Error("Expected interpolated physics body id");
    }
    expect(world.get(mover, PhysicsTransformComponent)?.position.x).toBe(10);
    expect(interpolation.sample(bodyId)?.position.x).toBe(0);

    const reusable = { position: { x: 0, y: 0 } };
    runtime.tick(500);
    expect(interpolation.sample(bodyId, reusable)).toBe(reusable);
    expect(reusable.position.x).toBe(5);
    expect(world.get(mover, PhysicsTransformComponent)?.position.x).toBe(10);
    expect(interpolation.snapshot()).toMatchObject({
      alpha: 0.5,
      fixedDeltaMs: 1_000,
      trackedBodyCount: 1
    });

    runtime.tick(500);
    expect(interpolation.sample(bodyId, reusable)?.position.x).toBe(10);
    expect(world.get(mover, PhysicsTransformComponent)?.position.x).toBe(20);
    runtime.dispose();
    expect(interpolation.isBound()).toBe(false);
    expect(interpolation.snapshot()).toMatchObject({ trackedBodyCount: 0 });
  });

  it("supports application-defined interpolation and discontinuity policies", () => {
    const world = createMemoryWorld();
    const mover = world.spawn();
    world.add(mover, PhysicsBodyComponent, {
      definition: { kind: "dynamic" }
    });
    world.add(mover, PhysicsTransformComponent, {
      position: { x: 0, y: 0 }
    });
    world.add(mover, PhysicsVelocityComponent, {
      linear: { x: 100, y: 0 }
    });

    const resetBodies: string[] = [];
    const interpolation = createPhysicsInterpolationStore({
      policy: {
        shouldResetHistory(bodyId, previous, current) {
          const shouldReset = Math.abs(current.position.x - previous.position.x) > 50;
          if (shouldReset) {
            resetBodies.push(bodyId);
          }
          return shouldReset;
        },
        interpolate(_previous, current, _alpha, target) {
          const output = target ?? { position: { x: 0, y: 0 } };
          output.position.x = current.position.x;
          output.position.y = current.position.y;
          return output;
        }
      }
    });
    const runtime = createGame({
      modules: [
        createPhysicsModule({
          backend: createMemoryPhysicsBackend(),
          fixedDeltaMs: 1_000,
          scene: { gravity: { x: 0, y: 0 } },
          interpolationStore: interpolation
        })
      ],
      world,
      eventBus: createEventBus({ clock: () => 1 }),
      seed: "physics-interpolation-policy"
    });

    runtime.start();
    runtime.tick(1_000);
    runtime.tick(500);
    const bodyId = world.get(mover, PhysicsBodyComponent)?.bodyId;
    expect(bodyId).toBeDefined();
    if (!bodyId) {
      throw new Error("Expected interpolated physics body id");
    }
    const reusable = { position: { x: 0, y: 0 } };
    expect(interpolation.sample(bodyId, reusable)).toBe(reusable);
    expect(reusable.position.x).toBe(100);
    expect(resetBodies).toEqual([bodyId]);
    runtime.dispose();
  });

  it("tracks only physics-owned moving bodies", () => {
    const world = createMemoryWorld();
    const dynamicBody = world.spawn();
    world.add(dynamicBody, PhysicsBodyComponent, {
      definition: { kind: "dynamic" }
    });
    const staticBody = world.spawn();
    world.add(staticBody, PhysicsBodyComponent, {
      definition: { kind: "static" },
      syncToWorld: true
    });
    const worldDrivenBody = world.spawn();
    world.add(worldDrivenBody, PhysicsBodyComponent, {
      definition: { kind: "kinematic" }
    });

    const interpolation = createPhysicsInterpolationStore();
    const runtime = createGame({
      modules: [
        createPhysicsModule({
          backend: createMemoryPhysicsBackend(),
          fixedDeltaMs: 20,
          interpolationStore: interpolation
        })
      ],
      world,
      eventBus: createEventBus({ clock: () => 1 }),
      seed: "physics-interpolation-ownership"
    });

    runtime.start();
    runtime.tick(20);
    expect(interpolation.snapshot().trackedBodyCount).toBe(1);
    runtime.dispose();
  });

  it("syncs world components, emits contact events, and writes trace entries", () => {
    const world = createMemoryWorld();
    const mover = world.spawn();
    const wall = world.spawn();
    world.add(mover, PhysicsBodyComponent, {
      definition: { kind: "dynamic" }
    });
    world.add(mover, PhysicsTransformComponent, {
      position: { x: 0, y: 0 }
    });
    world.add(mover, PhysicsVelocityComponent, {
      linear: { x: 1, y: 0 }
    });
    world.add(mover, PhysicsColliderComponent, {
      definition: { shape: { type: "circle", radius: 0.5 } }
    });
    world.add(wall, PhysicsBodyComponent, {
      definition: { kind: "static" }
    });
    world.add(wall, PhysicsTransformComponent, {
      position: { x: 1, y: 0 }
    });
    world.add(wall, PhysicsColliderComponent, {
      definition: { shape: { type: "circle", radius: 0.5 }, sensor: true }
    });

    const eventBus = createEventBus({ clock: () => 1 });
    const contacts: PhysicsContactEvent[] = [];
    eventBus.on<PhysicsContactEvent>("physics.trigger.enter", (event) => {
      contacts.push(event.payload);
    });
    const traceStore = createPhysicsTraceStore();
    const runtime = createGame({
      modules: [
        createPhysicsModule({
          backend: createMemoryPhysicsBackend(),
          fixedDeltaMs: 1000,
          scene: { gravity: { x: 0, y: 0 } },
          traceStore
        })
      ],
      world,
      eventBus,
      seed: "physics"
    });

    runtime.start();
    runtime.tick(1000);

    expect(world.get(mover, PhysicsTransformComponent)?.position).toMatchObject({ x: 1, y: 0 });
    expect(world.get(mover, PhysicsBodyComponent)?.bodyId).toBeDefined();
    expect(world.get(mover, PhysicsColliderComponent)?.colliderId).toBeDefined();
    expect(contacts).toHaveLength(1);
    expect(contacts[0]).toMatchObject({
      phase: "enter",
      kind: "trigger",
      entityA: mover,
      entityB: wall
    });
    expect(traceStore.list().map((entry) => entry.kind)).toEqual(["contact", "step"]);

    runtime.dispose();
  });

  it("binds an injected physics handle for gameplay queries", () => {
    const world = createMemoryWorld();
    const actor = world.spawn();
    world.add(actor, PhysicsBodyComponent, {
      definition: { kind: "static" }
    });
    world.add(actor, PhysicsTransformComponent, {
      position: { x: 2, y: 0 }
    });
    world.add(actor, PhysicsColliderComponent, {
      definition: {
        shape: { type: "circle", radius: 0.5 },
        filter: { groups: ["actor"], collidesWith: ["query"] }
      }
    });

    const physics = createPhysicsHandle({ id: "test.physics" });
    expect(physics.isBound()).toBe(false);

    const runtime = createGame({
      modules: [
        createPhysicsModule({
          backend: createMemoryPhysicsBackend(),
          fixedDeltaMs: 1000,
          scene: { gravity: { x: 0, y: 0 } },
          handle: physics
        })
      ],
      world,
      eventBus: createEventBus({ clock: () => 1 }),
      seed: "physics-handle"
    });

    expect(physics.isBound()).toBe(true);
    runtime.start();
    runtime.tick(1000);

    const colliderId = world.get(actor, PhysicsColliderComponent)?.colliderId;
    expect(colliderId).toBeDefined();
    expect(
      physics
        .raycast(
          { x: 0, y: 0 },
          { x: 1, y: 0 },
          {
            maxDistance: 4,
            filter: { groups: ["query"], collidesWith: ["actor"] }
          }
        )
        .map((hit) => hit.colliderId)
    ).toEqual([colliderId]);
    expect(physics.checkOverlap({ type: "circle", radius: 0.25 }, { x: 2, y: 0 })).toBe(true);
    expect(physics.snapshot()).toMatchObject({
      backend: "memory-physics",
      bodyCount: 1,
      colliderCount: 1
    });

    runtime.dispose();
    expect(physics.isBound()).toBe(false);
    expectPhysicsError(() => physics.queryPoint({ x: 2, y: 0 }), "physics.handle_unbound");
  });

  it("indexes contact handles and releases despawned world bodies without contact scans", () => {
    let queryCount = 0;
    const world = createMemoryWorld(() => {
      queryCount += 1;
    });
    const entities: EntityId[] = [];
    for (let index = 0; index < 24; index += 1) {
      const entity = world.spawn();
      entities.push(entity);
      world.add(entity, PhysicsBodyComponent, {
        definition: { kind: "static" }
      });
      world.add(entity, PhysicsTransformComponent, {
        position: { x: 0, y: 0 }
      });
      world.add(entity, PhysicsColliderComponent, {
        definition: { shape: { type: "circle", radius: 1 } }
      });
    }

    const physics = createPhysicsHandle({ id: "indexed.physics" });
    const runtime = createGame({
      modules: [
        createPhysicsModule({
          backend: createMemoryPhysicsBackend(),
          fixedDeltaMs: 16,
          scene: { gravity: { x: 0, y: 0 } },
          eventPolicy: { emitContacts: false },
          handle: physics
        })
      ],
      world,
      eventBus: createEventBus({ clock: () => 1 }),
      seed: "physics-index"
    });

    runtime.start();
    runtime.tick(16);
    expect(queryCount).toBe(4);
    expect(physics.snapshot()).toMatchObject({ bodyCount: 24, colliderCount: 24 });

    for (const entity of entities.slice(0, 12)) {
      world.despawn(entity);
    }
    queryCount = 0;
    runtime.tick(16);

    expect(queryCount).toBe(4);
    expect(physics.snapshot()).toMatchObject({ bodyCount: 12, colliderCount: 12 });

    const disabled = entities[12];
    if (disabled !== undefined) {
      world.set(disabled, PhysicsBodyComponent, { enabled: false });
      runtime.tick(16);
      expect(physics.snapshot()).toMatchObject({ bodyCount: 11, colliderCount: 11 });
      world.set(disabled, PhysicsBodyComponent, { enabled: true });
      runtime.tick(16);
      expect(physics.snapshot()).toMatchObject({ bodyCount: 12, colliderCount: 12 });
    }
    runtime.dispose();
  });

  it("restores stable physics state, entity remaps, and the fixed-step accumulator", async () => {
    const world = createMemoryWorld();
    const actor = world.spawn();
    world.add(actor, PhysicsBodyComponent, {
      definition: { kind: "dynamic" }
    });
    world.add(actor, PhysicsTransformComponent, {
      position: { x: 0, y: 0 }
    });
    world.add(actor, PhysicsVelocityComponent, {
      linear: { x: 2, y: 0 }
    });
    world.add(actor, PhysicsColliderComponent, {
      definition: { shape: { type: "circle", radius: 0.5 } }
    });
    const physics = createPhysicsHandle({ id: "checkpoint.physics" });
    const runtime = createGame({
      modules: [
        createPhysicsModule({
          backend: createMemoryPhysicsBackend(),
          fixedDeltaMs: 1_000,
          scene: { gravity: { x: 0, y: 0 } },
          handle: physics
        })
      ],
      world,
      eventBus: createEventBus({ clock: () => 1 }),
      seed: "physics-checkpoint"
    });
    runtime.start();
    runtime.tick(500);
    const contributor = createPhysicsSaveContributor({ handle: physics });
    const section = await contributor.capture({ now: 500 });
    const restoredActor = world.spawn();
    if (section === undefined) {
      throw new Error("Physics contributor did not capture a section");
    }
    expect(section.data.entities[0]?.body?.state).not.toHaveProperty("id");

    runtime.tick(500);
    expect(world.get(actor, PhysicsTransformComponent)?.position.x).toBe(2);
    physics.restoreCheckpoint(section.data, {
      resolveEntityId(entityId) {
        return entityId === actor ? restoredActor : undefined;
      }
    });

    expect(physics.snapshot()).toMatchObject({ bodyCount: 0, colliderCount: 0 });
    expect(world.get(actor, PhysicsBodyComponent)).toBeUndefined();
    expect(world.get(restoredActor, PhysicsBodyComponent)?.bodyId).toBeUndefined();

    runtime.tick(500);
    expect(world.get(restoredActor, PhysicsTransformComponent)?.position.x).toBe(2);
    expect(physics.snapshot()).toMatchObject({ bodyCount: 1, colliderCount: 1 });
    runtime.dispose();
  });

  it("rejects unbound and duplicate physics handle access", () => {
    const physics = createPhysicsHandle({ id: "duplicate.physics" });
    expectPhysicsError(() => physics.snapshot(), "physics.handle_unbound");

    const runtime = createGame({
      modules: [
        createPhysicsModule({
          backend: createMemoryPhysicsBackend(),
          handle: physics
        })
      ],
      world: createMemoryWorld(),
      eventBus: createEventBus({ clock: () => 1 }),
      seed: "physics-handle-owner"
    });

    expectPhysicsError(
      () =>
        createGame({
          modules: [
            createPhysicsModule({
              backend: createMemoryPhysicsBackend(),
              handle: physics
            })
          ],
          world: createMemoryWorld(),
          eventBus: createEventBus({ clock: () => 1 }),
          seed: "physics-handle-duplicate"
        }),
      "physics.handle_bound"
    );

    runtime.dispose();
  });
});

function expectPhysicsError(callback: () => void, code: string): void {
  try {
    callback();
  } catch (error) {
    expect(error).toBeInstanceOf(GameError);
    expect((error as GameError).code).toBe(code);
    return;
  }

  throw new Error(`Expected physics error: ${code}`);
}

function createMemoryWorld(onQuery?: () => void): GameWorld {
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
      onQuery?.();
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
