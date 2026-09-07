import { createEventBus } from "@gamekits/event-bus";
import { createGame, type GameRuntime } from "@gamekits/game-runtime";
import {
  createCharacterMotorState,
  type CharacterControlIntent,
  type CharacterMotorDiagnostics,
  type CharacterMotorState
} from "@gamekits/character-controller";
import {
  PhysicsBodyComponent,
  PhysicsColliderComponent,
  PhysicsTransformComponent,
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
  type PhysicsQuaternion,
  type PhysicsRotation,
  type PhysicsScene,
  type PhysicsSceneSnapshot,
  type PhysicsShapeDefinition,
  type PhysicsTraceEntry,
  type PhysicsTraceStore,
  type PhysicsVector
} from "@gamekits/physics-core";
import type { Rapier3dPhysicsNative } from "@gamekits/physics-rapier3d";
import { createMemoryWorld } from "./memory-world";
import {
  createPhysics3dCharacterIntent,
  stepPhysics3dCharacter
} from "./physics-3d-character-controller";

export const PHYSICS_3D_GROUPS = {
  actor: 0b0001,
  wall: 0b0010,
  sensor: 0b0100,
  query: 0b1000
} as const;

export type Physics3dLabShape = "box" | "sphere" | "capsule";
export type Physics3dLabQueryMode = "point" | "overlap-box" | "overlap-sphere";
export type Physics3dLabCameraPreset = "overview" | "side" | "probe" | "free";
export type Physics3dLabGroupPreset = "all" | "actor-only" | "sensor-only";
export type Physics3dLabRole = "floor" | "drop" | "spinner" | "trigger" | "character";

export type Physics3dLabObject = {
  id: string;
  role: Physics3dLabRole;
  bodyId: PhysicsBodyId;
  colliderId: PhysicsColliderId;
  shape: PhysicsShapeDefinition;
  sensor: boolean;
  position: PhysicsVector;
  rotation?: PhysicsRotation | undefined;
  linearVelocity: PhysicsVector;
};

export type Physics3dLabSnapshot = {
  paused: boolean;
  elapsedMs: number;
  stepCount: number;
  shape: Physics3dLabShape;
  queryMode: Physics3dLabQueryMode;
  groupPreset: Physics3dLabGroupPreset;
  cameraPreset: Physics3dLabCameraPreset;
  queryPoint: PhysicsVector;
  scene: PhysicsSceneSnapshot;
  objects: Physics3dLabObject[];
  contacts: PhysicsContactEvent[];
  recentContacts: PhysicsContactEvent[];
  queryHits: PhysicsQueryResult[];
  traces: PhysicsTraceEntry[];
  spinnerQuaternion?: PhysicsQuaternion | undefined;
  character: {
    state: CharacterMotorState;
    diagnostics?: CharacterMotorDiagnostics | undefined;
  };
  nativeSummary: {
    backend: string;
    bodyCount: number;
    colliderCount: number;
  };
};

export type Physics3dLab = {
  step(deltaMs: number): Physics3dLabSnapshot;
  singleStep(deltaMs?: number): Physics3dLabSnapshot;
  reset(): Physics3dLabSnapshot;
  dispose(): void;
  setPaused(paused: boolean): Physics3dLabSnapshot;
  setShape(shape: Physics3dLabShape): Physics3dLabSnapshot;
  setQueryMode(mode: Physics3dLabQueryMode): Physics3dLabSnapshot;
  setGroupPreset(preset: Physics3dLabGroupPreset): Physics3dLabSnapshot;
  setCameraPreset(preset: Physics3dLabCameraPreset): Physics3dLabSnapshot;
  setQueryPoint(point: PhysicsVector): Physics3dLabSnapshot;
  setCharacterIntent(intent: CharacterControlIntent): void;
  spawnDrop(): Physics3dLabSnapshot;
  snapshot(): Physics3dLabSnapshot;
};

type LabBodyRecord = {
  id: string;
  role: Physics3dLabRole;
  bodyId: PhysicsBodyId;
  colliderId: PhysicsColliderId;
  shape: PhysicsShapeDefinition;
  sensor: boolean;
};

export function createPhysics3dLab(
  backend: PhysicsBackendAdapter<Rapier3dPhysicsNative>
): Physics3dLab {
  let scene = createScene(backend);
  let records: LabBodyRecord[] = [];
  let paused = false;
  let elapsedMs = 0;
  let stepCount = 0;
  let shape: Physics3dLabShape = "box";
  let queryMode: Physics3dLabQueryMode = "overlap-sphere";
  let groupPreset: Physics3dLabGroupPreset = "all";
  let cameraPreset: Physics3dLabCameraPreset = "free";
  let queryPoint: PhysicsVector = { x: 0, y: 2.1, z: 0 };
  let contacts: PhysicsContactEvent[] = [];
  let recentContacts: PhysicsContactEvent[] = [];
  let nextDropId = 1;
  let characterState = createCharacterMotorState();
  let characterDiagnostics: CharacterMotorDiagnostics | undefined;
  let characterIntent = neutralCharacterIntent();
  const traceStore = createPhysicsTraceStore({ limit: 90 });

  const rebuild = (): void => {
    scene.dispose();
    scene = createScene(backend);
    nextDropId = 1;
    records = createSceneObjects(scene, shape, () => nextDropId++);
    elapsedMs = 0;
    stepCount = 0;
    contacts = [];
    recentContacts = [];
    nextDropId = 4;
    characterState = createCharacterMotorState();
    characterDiagnostics = undefined;
    characterIntent = neutralCharacterIntent();
    traceStore.clear();
    flushSceneState();
  };

  records = createSceneObjects(scene, shape, () => nextDropId++);
  nextDropId = 4;
  flushSceneState();

  const captureSnapshot = (): Physics3dLabSnapshot => {
    const queryHits = runQuery(scene, queryMode, groupPreset, queryPoint);
    const spinner = scene.getBodyState("body.spinner");
    const spinnerQuaternion =
      spinner?.rotation !== undefined &&
      typeof spinner.rotation !== "number" &&
      "w" in spinner.rotation
        ? spinner.rotation
        : undefined;
    return {
      paused,
      elapsedMs,
      stepCount,
      shape,
      queryMode,
      groupPreset,
      cameraPreset,
      queryPoint: cloneVector(queryPoint),
      scene: scene.snapshot(),
      objects: readObjects(scene, records),
      contacts: [...contacts],
      recentContacts: [...recentContacts],
      queryHits,
      traces: traceStore.list().slice(-12),
      spinnerQuaternion,
      character: {
        state: structuredClone(characterState),
        diagnostics:
          characterDiagnostics === undefined ? undefined : structuredClone(characterDiagnostics)
      },
      nativeSummary: readNativeSummary(scene)
    };
  };

  return {
    step(deltaMs) {
      if (paused) {
        return captureSnapshot();
      }
      updateSpinner(scene, elapsedMs);
      const stepDeltaMs = Math.max(0, Math.min(deltaMs, 100));
      if (stepDeltaMs > 0) {
        const character = stepPhysics3dCharacter({
          scene,
          state: characterState,
          intent: characterIntent,
          tick: stepCount + 1,
          deltaMs: stepDeltaMs
        });
        characterState = character.state;
        characterDiagnostics = character.diagnostics;
      }
      const result = scene.step(stepDeltaMs);
      elapsedMs += deltaMs;
      stepCount += 1;
      contacts = result.contacts;
      if (contacts.length > 0) {
        recentContacts = [...contacts, ...recentContacts].slice(0, 10);
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
      if (shape === nextShape) {
        return captureSnapshot();
      }
      shape = nextShape;
      rebuild();
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
    setCameraPreset(preset) {
      cameraPreset = preset;
      return captureSnapshot();
    },
    setQueryPoint(point) {
      queryPoint = {
        x: point.x,
        y: point.y,
        z: point.z ?? 0
      };
      return captureSnapshot();
    },
    setCharacterIntent(intent) {
      characterIntent = structuredClone(intent);
    },
    spawnDrop() {
      records.push(createDrop(scene, nextDropId++, shape));
      flushSceneState();
      return captureSnapshot();
    },
    snapshot() {
      return captureSnapshot();
    }
  };

  function flushSceneState(): void {
    const result = scene.step(0);
    contacts = result.contacts;
    if (contacts.length > 0) {
      recentContacts = [...contacts, ...recentContacts].slice(0, 10);
    }
  }
}

function createScene(backend: PhysicsBackendAdapter<Rapier3dPhysicsNative>) {
  return backend.createScene({
    id: "physics-3d-lab.scene",
    dimension: "3d",
    gravity: { x: 0, y: -9.81, z: 0 },
    fixedDeltaMs: 1000 / 60
  });
}

function createSceneObjects(
  scene: PhysicsScene,
  dropShape: Physics3dLabShape,
  nextId: () => number
): LabBodyRecord[] {
  return [
    createBodyWithCollider(scene, {
      id: "floor",
      role: "floor",
      kind: "static",
      position: { x: 0, y: -2, z: 0 },
      shape: { type: "box", width: 8, height: 0.35, depth: 6 },
      filter: wallFilter()
    }),
    createBodyWithCollider(scene, {
      id: "character",
      role: "character",
      kind: "dynamic",
      position: { x: -2.6, y: 0.2, z: 1.7 },
      shape: { type: "capsule", radius: 0.36, height: 0.78 },
      filter: actorFilter(),
      damping: { linear: 1.8, angular: 7 },
      lockedAxes: ["rotation-x", "rotation-z"],
      continuousCollisionDetection: true
    }),
    createBodyWithCollider(scene, {
      id: "spinner",
      role: "spinner",
      kind: "kinematic",
      position: { x: 0, y: 0.05, z: 0 },
      rotation: eulerToQuaternion({ x: 0, y: 0.18, z: 0.25 }),
      shape: { type: "box", width: 3.8, height: 0.28, depth: 0.46 },
      filter: wallFilter()
    }),
    createBodyWithCollider(scene, {
      id: "trigger",
      role: "trigger",
      kind: "static",
      position: { x: 0, y: 2.1, z: 0 },
      shape: { type: "box", width: 4.6, height: 4.2, depth: 4.2 },
      sensor: true,
      filter: sensorFilter()
    }),
    createDrop(scene, nextId(), dropShape),
    createDrop(scene, nextId(), "sphere"),
    createDrop(scene, nextId(), "capsule")
  ];
}

function createDrop(
  scene: PhysicsScene,
  index: number,
  dropShape: Physics3dLabShape
): LabBodyRecord {
  const slot = (index - 1) % 6;
  const x = ((slot % 3) - 1) * 0.72;
  const z = (slot < 3 ? -1 : 1) * 0.42;
  const y = 3.75 + Math.floor(slot / 3) * 0.55;
  return createBodyWithCollider(scene, {
    id: `drop-${index}`,
    role: "drop",
    kind: "dynamic",
    position: { x, y, z },
    rotation: { x: 0.18 * index, y: 0.11 * index, z: 0.2 },
    linearVelocity: {
      x: index % 2 === 0 ? -0.18 : 0.18,
      y: -0.4,
      z: index % 2 === 0 ? 0.12 : -0.12
    },
    shape: shapeDefinition(dropShape),
    filter: actorFilter(),
    damping: {
      linear: 0.02,
      angular: 0.04
    }
  });
}

function createBodyWithCollider(
  scene: PhysicsScene,
  options: {
    id: string;
    role: Physics3dLabRole;
    kind: "static" | "dynamic" | "kinematic";
    position: PhysicsVector;
    rotation?: PhysicsRotation | undefined;
    linearVelocity?: PhysicsVector | undefined;
    shape: PhysicsShapeDefinition;
    sensor?: boolean | undefined;
    filter?: { groups: string[]; collidesWith: string[] } | undefined;
    damping?: { linear?: number; angular?: number } | undefined;
    lockedAxes?: string[] | undefined;
    continuousCollisionDetection?: boolean | undefined;
  }
): LabBodyRecord {
  const bodyId = scene.createBody({
    id: `body.${options.id}`,
    kind: options.kind,
    position: options.position,
    ...(options.rotation === undefined ? {} : { rotation: options.rotation }),
    ...(options.linearVelocity === undefined ? {} : { linearVelocity: options.linearVelocity }),
    ...(options.damping === undefined ? {} : { damping: options.damping }),
    ...(options.lockedAxes === undefined ? {} : { lockedAxes: options.lockedAxes }),
    ...(options.continuousCollisionDetection === undefined
      ? {}
      : { continuousCollisionDetection: options.continuousCollisionDetection })
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

function updateSpinner(scene: PhysicsScene, elapsedMs: number): void {
  const phase = elapsedMs / 1000;
  scene.updateBody("body.spinner", {
    position: {
      x: Math.sin(phase * 0.55) * 0.24,
      y: 0.05,
      z: Math.cos(phase * 0.5) * 0.18
    },
    rotation: {
      x: 0.08,
      y: phase * 1.4,
      z: 0.28
    }
  });
}

function runQuery(
  scene: PhysicsScene,
  mode: Physics3dLabQueryMode,
  preset: Physics3dLabGroupPreset,
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
              ? { type: "box", width: 1.4, height: 1.4, depth: 1.4 }
              : { type: "sphere", radius: 1.05 },
          ...base
        };
  return scene.query(query);
}

function queryFilterForPreset(preset: Physics3dLabGroupPreset): PhysicsCollisionFilter {
  if (preset === "actor-only") {
    return { groups: ["query"], collidesWith: ["actor"] };
  }
  if (preset === "sensor-only") {
    return { groups: ["query"], collidesWith: ["sensor"] };
  }
  return { groups: ["query"], collidesWith: ["actor", "wall", "sensor"] };
}

function readObjects(scene: PhysicsScene, records: LabBodyRecord[]): Physics3dLabObject[] {
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
        rotation: body.rotation,
        linearVelocity: cloneVector(body.linearVelocity)
      }
    ];
  });
}

function readNativeSummary(scene: PhysicsScene<Rapier3dPhysicsNative>) {
  const native = scene.native?.();
  return {
    backend: "rapier3d",
    bodyCount: native?.bodies.size ?? 0,
    colliderCount: native?.colliders.size ?? 0
  };
}

function shapeDefinition(shape: Physics3dLabShape): PhysicsShapeDefinition {
  if (shape === "sphere") {
    return { type: "sphere", radius: 0.42 };
  }
  if (shape === "capsule") {
    return { type: "capsule", radius: 0.28, height: 0.7 };
  }
  return { type: "box", width: 0.72, height: 0.72, depth: 0.72 };
}

function actorFilter() {
  return { groups: ["actor"], collidesWith: ["actor", "wall", "sensor", "query"] };
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
    z: vector.z ?? 0
  };
}

function neutralCharacterIntent(): CharacterControlIntent {
  return createPhysics3dCharacterIntent({
    sequence: 0,
    moveX: 0,
    moveZ: 0,
    jumpPressed: false,
    jumpHeld: false,
    divePressed: false
  });
}

function eulerToQuaternion(rotation: Required<PhysicsVector>): PhysicsQuaternion {
  const hx = rotation.x / 2;
  const hy = rotation.y / 2;
  const hz = rotation.z / 2;
  const sx = Math.sin(hx);
  const cx = Math.cos(hx);
  const sy = Math.sin(hy);
  const cy = Math.cos(hy);
  const sz = Math.sin(hz);
  const cz = Math.cos(hz);

  return {
    x: sx * cy * cz + cx * sy * sz,
    y: cx * sy * cz - sx * cy * sz,
    z: cx * cy * sz + sx * sy * cz,
    w: cx * cy * cz - sx * sy * sz
  };
}

export function createPhysics3dModuleHarness(
  backend: PhysicsBackendAdapter<Rapier3dPhysicsNative>
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
      rotation: eulerToQuaternion({ x: 0.12, y: 0.2, z: 0.1 })
    }
  });
  world.add(mover, PhysicsTransformComponent, {
    position: { x: 0, y: 1.2, z: 0 },
    rotation: eulerToQuaternion({ x: 0.12, y: 0.2, z: 0.1 })
  });
  world.add(mover, PhysicsColliderComponent, {
    definition: {
      shape: { type: "sphere", radius: 0.5 },
      filter: actorFilter()
    }
  });
  world.add(trigger, PhysicsBodyComponent, {
    definition: { kind: "static" }
  });
  world.add(trigger, PhysicsTransformComponent, {
    position: { x: 0, y: 1.2, z: 0 }
  });
  world.add(trigger, PhysicsColliderComponent, {
    definition: {
      shape: { type: "box", width: 2, height: 2, depth: 2 },
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
  const physics = createPhysicsHandle({ id: "physics-3d-lab.module" });
  const runtime = createGame({
    modules: [
      createPhysicsModule({
        backend,
        fixedDeltaMs: 1000 / 60,
        scene: {
          id: "physics-3d-lab.module-scene",
          dimension: "3d",
          gravity: { x: 0, y: 0, z: 0 }
        },
        traceStore,
        handle: physics
      })
    ],
    world,
    eventBus,
    seed: "physics-3d-lab"
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
