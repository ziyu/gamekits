import { createEventBus } from "@gamekits/event-bus";
import { createGame, type GameRuntime } from "@gamekits/game-runtime";
import {
  PhysicsBodyComponent,
  PhysicsColliderComponent,
  PhysicsTransformComponent,
  PhysicsVelocityComponent,
  createPhysicsHandle,
  createPhysicsModule,
  createPhysicsTraceStore,
  type PhysicsBackendAdapter,
  type PhysicsBodyId,
  type PhysicsColliderId,
  type PhysicsCollisionFilter,
  type PhysicsContactEvent,
  type PhysicsHandle,
  type PhysicsQuery,
  type PhysicsQueryResult,
  type PhysicsScene,
  type PhysicsSceneSnapshot,
  type PhysicsShapeDefinition,
  type PhysicsTraceEntry,
  type PhysicsTraceStore,
  type PhysicsVector
} from "@gamekits/physics-core";
import type { Rapier2dPhysicsNative } from "@gamekits/physics-rapier2d";
import { createMemoryWorld } from "./memory-world";

export const PHYSICS_2D_GROUPS = {
  actor: 0b0001,
  wall: 0b0010,
  sensor: 0b0100,
  query: 0b1000
} as const;

export type Physics2dLabShape = "circle" | "box" | "capsule";
export type Physics2dLabQueryMode = "point" | "overlap-circle" | "overlap-box";
export type Physics2dLabGroupPreset = "all" | "actor-only" | "sensor-only";
export type Physics2dLabRole = "mover" | "paddle" | "trigger" | "obstacle" | "bounds";

export type Physics2dLabObject = {
  id: string;
  role: Physics2dLabRole;
  bodyId: PhysicsBodyId;
  colliderId: PhysicsColliderId;
  shape: PhysicsShapeDefinition;
  sensor: boolean;
  position: PhysicsVector;
  rotation?: number | undefined;
  linearVelocity: PhysicsVector;
};

export type Physics2dLabSnapshot = {
  paused: boolean;
  elapsedMs: number;
  stepCount: number;
  shape: Physics2dLabShape;
  queryMode: Physics2dLabQueryMode;
  groupPreset: Physics2dLabGroupPreset;
  queryPoint: PhysicsVector;
  scene: PhysicsSceneSnapshot;
  objects: Physics2dLabObject[];
  contacts: PhysicsContactEvent[];
  recentContacts: PhysicsContactEvent[];
  queryHits: PhysicsQueryResult[];
  traces: PhysicsTraceEntry[];
  nativeSummary: {
    backend: string;
    bodyCount: number;
    colliderCount: number;
  };
};

export type Physics2dLab = {
  step(deltaMs: number): Physics2dLabSnapshot;
  singleStep(deltaMs?: number): Physics2dLabSnapshot;
  reset(): Physics2dLabSnapshot;
  dispose(): void;
  setPaused(paused: boolean): Physics2dLabSnapshot;
  setShape(shape: Physics2dLabShape): Physics2dLabSnapshot;
  setQueryMode(mode: Physics2dLabQueryMode): Physics2dLabSnapshot;
  setGroupPreset(preset: Physics2dLabGroupPreset): Physics2dLabSnapshot;
  setQueryPoint(point: PhysicsVector): Physics2dLabSnapshot;
  applyImpulse(): Physics2dLabSnapshot;
  snapshot(): Physics2dLabSnapshot;
};

type LabBodyRecord = {
  id: string;
  role: Physics2dLabRole;
  bodyId: PhysicsBodyId;
  colliderId: PhysicsColliderId;
  shape: PhysicsShapeDefinition;
  sensor: boolean;
};

export function createPhysics2dLab(
  backend: PhysicsBackendAdapter<Rapier2dPhysicsNative>
): Physics2dLab {
  let scene = backend.createScene({
    id: "physics-2d-lab.scene",
    dimension: "2d",
    gravity: { x: 0, y: -8 },
    fixedDeltaMs: 1000 / 60
  });
  let records: LabBodyRecord[] = [];
  let paused = false;
  let elapsedMs = 0;
  let stepCount = 0;
  let shape: Physics2dLabShape = "circle";
  let queryMode: Physics2dLabQueryMode = "overlap-circle";
  let groupPreset: Physics2dLabGroupPreset = "all";
  let queryPoint: PhysicsVector = { x: -3.45, y: 0.85 };
  let contacts: PhysicsContactEvent[] = [];
  let recentContacts: PhysicsContactEvent[] = [];
  const traceStore = createPhysicsTraceStore({ limit: 80 });

  const rebuild = (): void => {
    scene.dispose();
    scene = backend.createScene({
      id: "physics-2d-lab.scene",
      dimension: "2d",
      gravity: { x: 0, y: -8 },
      fixedDeltaMs: 1000 / 60
    });
    records = createSceneObjects(scene, shape);
    elapsedMs = 0;
    stepCount = 0;
    contacts = [];
    recentContacts = [];
    traceStore.clear();
  };

  records = createSceneObjects(scene, shape);

  const captureSnapshot = (): Physics2dLabSnapshot => {
    const queryHits = runQuery(scene, queryMode, groupPreset, queryPoint);
    return {
      paused,
      elapsedMs,
      stepCount,
      shape,
      queryMode,
      groupPreset,
      queryPoint: cloneVector(queryPoint),
      scene: scene.snapshot(),
      objects: readObjects(scene, records),
      contacts: [...contacts],
      recentContacts: [...recentContacts],
      queryHits,
      traces: traceStore.list().slice(-12),
      nativeSummary: readNativeSummary(scene)
    };
  };

  return {
    step(deltaMs) {
      if (paused) {
        return captureSnapshot();
      }
      updateKinematicPaddle(scene, elapsedMs);
      const result = scene.step(Math.max(0, Math.min(deltaMs, 100)));
      elapsedMs += deltaMs;
      stepCount += 1;
      contacts = result.contacts;
      if (contacts.length > 0) {
        recentContacts = [...contacts, ...recentContacts].slice(0, 8);
      }
      for (const contact of result.contacts) {
        traceStore.push({
          kind: "contact",
          tick: stepCount,
          elapsed: elapsedMs,
          label: `physics.${contact.kind}.${contact.phase}`,
          colliderId: contact.colliderA,
          payload: contact
        });
      }
      traceStore.push({
        kind: "step",
        tick: stepCount,
        elapsed: elapsedMs,
        label: "physics.step",
        payload: {
          deltaMs: result.deltaMs,
          contactCount: result.contacts.length,
          queryHitCount: runQuery(scene, queryMode, groupPreset, queryPoint).length
        }
      });
      return captureSnapshot();
    },
    singleStep(deltaMs = 1000 / 60) {
      const wasPaused = paused;
      paused = false;
      const next = this.step(deltaMs);
      paused = wasPaused;
      return next;
    },
    reset() {
      rebuild();
      return captureSnapshot();
    },
    dispose() {
      scene.dispose();
    },
    setPaused(nextPaused) {
      paused = nextPaused;
      return captureSnapshot();
    },
    setShape(nextShape) {
      if (shape !== nextShape) {
        shape = nextShape;
        rebuild();
      }
      return captureSnapshot();
    },
    setQueryMode(mode) {
      queryMode = mode;
      return captureSnapshot();
    },
    setGroupPreset(preset) {
      groupPreset = preset;
      return captureSnapshot();
    },
    setQueryPoint(point) {
      queryPoint = { x: point.x, y: point.y };
      return captureSnapshot();
    },
    applyImpulse() {
      scene.updateBody("body.mover", {
        linearVelocity: {
          x: 4.2,
          y: 4.8
        }
      });
      return captureSnapshot();
    },
    snapshot() {
      return captureSnapshot();
    }
  };
}

function createSceneObjects(scene: PhysicsScene, moverShape: Physics2dLabShape): LabBodyRecord[] {
  return [
    createBodyWithCollider(scene, {
      id: "floor",
      role: "bounds",
      kind: "static",
      position: { x: 0, y: -3 },
      shape: { type: "box", width: 13.6, height: 0.42 },
      filter: wallFilter()
    }),
    createBodyWithCollider(scene, {
      id: "left-wall",
      role: "bounds",
      kind: "static",
      position: { x: -6.7, y: 0.45 },
      shape: { type: "box", width: 0.36, height: 6.8 },
      filter: wallFilter()
    }),
    createBodyWithCollider(scene, {
      id: "right-wall",
      role: "bounds",
      kind: "static",
      position: { x: 6.7, y: 0.45 },
      shape: { type: "box", width: 0.36, height: 6.8 },
      filter: wallFilter()
    }),
    createBodyWithCollider(scene, {
      id: "obstacle",
      role: "obstacle",
      kind: "static",
      position: { x: 2.35, y: -1.9 },
      rotation: -0.22,
      shape: { type: "box", width: 1.25, height: 1.05 },
      filter: wallFilter()
    }),
    createBodyWithCollider(scene, {
      id: "trigger",
      role: "trigger",
      kind: "static",
      position: { x: -3.45, y: 0.8 },
      shape: { type: "box", width: 2.4, height: 1.7 },
      sensor: true,
      filter: sensorFilter()
    }),
    createBodyWithCollider(scene, {
      id: "paddle",
      role: "paddle",
      kind: "kinematic",
      position: { x: -0.25, y: -1.55 },
      rotation: 0.12,
      shape: { type: "box", width: 1.9, height: 0.26 },
      filter: wallFilter()
    }),
    createBodyWithCollider(scene, {
      id: "mover",
      role: "mover",
      kind: "dynamic",
      position: { x: -3.9, y: 1.05 },
      linearVelocity: { x: 2.8, y: 0.6 },
      shape: shapeDefinition(moverShape),
      filter: actorFilter(),
      damping: {
        linear: 0.08,
        angular: 0.04
      }
    })
  ];
}

function createBodyWithCollider(
  scene: PhysicsScene,
  options: {
    id: string;
    role: Physics2dLabRole;
    kind: "static" | "dynamic" | "kinematic";
    position: PhysicsVector;
    rotation?: number | undefined;
    linearVelocity?: PhysicsVector | undefined;
    shape: PhysicsShapeDefinition;
    sensor?: boolean | undefined;
    filter?: { groups: string[]; collidesWith: string[] } | undefined;
    damping?: { linear?: number; angular?: number } | undefined;
  }
): LabBodyRecord {
  const bodyId = scene.createBody({
    id: `body.${options.id}`,
    kind: options.kind,
    position: options.position,
    ...(options.rotation === undefined ? {} : { rotation: options.rotation }),
    ...(options.linearVelocity === undefined ? {} : { linearVelocity: options.linearVelocity }),
    ...(options.damping === undefined ? {} : { damping: options.damping })
  });
  const colliderId = scene.createCollider({
    id: `collider.${options.id}`,
    bodyId,
    shape: options.shape,
    ...(options.sensor === undefined ? {} : { sensor: options.sensor }),
    ...(options.filter === undefined ? {} : { filter: options.filter })
  });
  return {
    id: options.id,
    role: options.role,
    bodyId,
    colliderId,
    shape: options.shape,
    sensor: options.sensor === true
  };
}

function updateKinematicPaddle(scene: PhysicsScene, elapsedMs: number): void {
  const phase = elapsedMs / 1000;
  scene.updateBody("body.paddle", {
    position: {
      x: -0.2 + Math.sin(phase * 1.35) * 1.2,
      y: -1.55 + Math.cos(phase * 1.1) * 0.22
    },
    rotation: Math.sin(phase * 1.6) * 0.34
  });
}

function runQuery(
  scene: PhysicsScene,
  mode: Physics2dLabQueryMode,
  preset: Physics2dLabGroupPreset,
  point: PhysicsVector
): PhysicsQueryResult[] {
  const base = {
    options: {
      triggerInteraction: "include",
      filter: queryFilterForPreset(preset),
      sort: "distance"
    }
  } satisfies Pick<PhysicsQuery, "options">;
  const query: PhysicsQuery =
    mode === "point"
      ? {
          type: "point",
          point,
          ...base
        }
      : {
          type: "overlap",
          position: point,
          shape:
            mode === "overlap-box"
              ? { type: "box", width: 1.3, height: 0.9 }
              : { type: "circle", radius: 0.72 },
          ...base
        };
  return scene.query(query);
}

function queryFilterForPreset(preset: Physics2dLabGroupPreset): PhysicsCollisionFilter {
  if (preset === "actor-only") {
    return { groups: ["query"], collidesWith: ["actor"] };
  }
  if (preset === "sensor-only") {
    return { groups: ["query"], collidesWith: ["sensor"] };
  }
  return { groups: ["query"], collidesWith: ["actor", "wall", "sensor"] };
}

function readObjects(scene: PhysicsScene, records: LabBodyRecord[]): Physics2dLabObject[] {
  return records.flatMap((record) => {
    const body = scene.getBodyState(record.bodyId);
    if (!body) {
      return [];
    }
    return [
      {
        id: record.id,
        role: record.role,
        bodyId: record.bodyId,
        colliderId: record.colliderId,
        shape: record.shape,
        sensor: record.sensor,
        position: cloneVector(body.position),
        rotation: typeof body.rotation === "number" ? body.rotation : undefined,
        linearVelocity: cloneVector(body.linearVelocity)
      }
    ];
  });
}

function readNativeSummary(scene: PhysicsScene<Rapier2dPhysicsNative>) {
  const native = scene.native?.();
  return {
    backend: "rapier2d",
    bodyCount: native?.bodies.size ?? 0,
    colliderCount: native?.colliders.size ?? 0
  };
}

function shapeDefinition(shape: Physics2dLabShape): PhysicsShapeDefinition {
  if (shape === "box") {
    return { type: "box", width: 0.9, height: 0.9 };
  }
  if (shape === "capsule") {
    return { type: "capsule", radius: 0.32, height: 0.74 };
  }
  return { type: "circle", radius: 0.45 };
}

function actorFilter() {
  return { groups: ["actor"], collidesWith: ["wall", "sensor", "query"] };
}

function wallFilter() {
  return { groups: ["wall"], collidesWith: ["actor", "query"] };
}

function sensorFilter() {
  return { groups: ["sensor"], collidesWith: ["actor", "query"] };
}

function cloneVector(vector: PhysicsVector): PhysicsVector {
  return {
    x: vector.x,
    y: vector.y,
    ...(vector.z === undefined ? {} : { z: vector.z })
  };
}

export function createPhysics2dModuleHarness(
  backend: PhysicsBackendAdapter<Rapier2dPhysicsNative>
): {
  runtime: GameRuntime;
  traceStore: PhysicsTraceStore;
  physics: PhysicsHandle;
  contacts: PhysicsContactEvent[];
  mover: string | number;
  trigger: string | number;
} {
  const world = createMemoryWorld();
  const mover = world.spawn();
  const trigger = world.spawn();
  world.add(mover, PhysicsBodyComponent, {
    definition: {
      kind: "dynamic",
      linearVelocity: { x: 1, y: 0 }
    }
  });
  world.add(mover, PhysicsTransformComponent, {
    position: { x: 0, y: 0 }
  });
  world.add(mover, PhysicsVelocityComponent, {
    linear: { x: 1, y: 0 }
  });
  world.add(mover, PhysicsColliderComponent, {
    definition: {
      shape: { type: "circle", radius: 0.5 },
      filter: actorFilter()
    }
  });
  world.add(trigger, PhysicsBodyComponent, {
    definition: { kind: "static" }
  });
  world.add(trigger, PhysicsTransformComponent, {
    position: { x: 0, y: 0 }
  });
  world.add(trigger, PhysicsColliderComponent, {
    definition: {
      shape: { type: "box", width: 2, height: 2 },
      sensor: true,
      filter: sensorFilter()
    }
  });

  const eventBus = createEventBus({ clock: () => 1 });
  const contacts: PhysicsContactEvent[] = [];
  eventBus.on<PhysicsContactEvent>("physics.trigger.enter", (event) => {
    contacts.push(event.payload);
  });
  const traceStore = createPhysicsTraceStore();
  const physics = createPhysicsHandle({ id: "physics-2d-lab.module" });
  const runtime = createGame({
    modules: [
      createPhysicsModule({
        backend,
        fixedDeltaMs: 1000 / 60,
        scene: {
          id: "physics-2d-lab.module-scene",
          dimension: "2d",
          gravity: { x: 0, y: 0 }
        },
        traceStore,
        handle: physics
      })
    ],
    world,
    eventBus,
    seed: "physics-2d-lab"
  });

  return {
    runtime,
    traceStore,
    physics,
    contacts,
    mover,
    trigger
  };
}
