import * as RAPIER from "@dimforge/rapier3d-compat";
import { GameError } from "@gamekits/core";
import type {
  PhysicsBackendAdapter,
  PhysicsBackendCapabilities,
  PhysicsBodyCommand,
  PhysicsBodyCommandResult,
  PhysicsBodyDefinition,
  PhysicsBodyId,
  PhysicsBodyKind,
  PhysicsBodyPatch,
  PhysicsBodyState,
  PhysicsColliderDefinition,
  PhysicsColliderId,
  PhysicsColliderPatch,
  PhysicsColliderState,
  PhysicsCollisionFilter,
  PhysicsContactEvent,
  PhysicsContactKind,
  PhysicsMaterialDefinition,
  PhysicsQueryOptions,
  PhysicsQuery,
  PhysicsQueryResult,
  PhysicsRotation,
  PhysicsScene,
  PhysicsSceneCheckpoint,
  PhysicsSceneConfig,
  PhysicsShapeDefinition,
  PhysicsVector
} from "@gamekits/physics-core";

export type Rapier3dGroupMap = Record<string, number>;

export type Rapier3dPhysicsBackendOptions = {
  id?: string;
  groups?: Rapier3dGroupMap;
  lengthUnit?: number;
};

export type Rapier3dPhysicsNative = {
  rapier: typeof RAPIER;
  world: RAPIER.World;
  eventQueue: RAPIER.EventQueue;
  bodies: ReadonlyMap<PhysicsBodyId, RAPIER.RigidBody>;
  colliders: ReadonlyMap<PhysicsColliderId, RAPIER.Collider>;
};

type Rapier3dBodyRecord = {
  id: PhysicsBodyId;
  body: RAPIER.RigidBody;
  kind: PhysicsBodyKind;
  userData?: Record<string, unknown>;
};

type Rapier3dColliderRecord = {
  id: PhysicsColliderId;
  collider: RAPIER.Collider;
  definition: PhysicsColliderDefinition;
  enabled: boolean;
  userData?: Record<string, unknown>;
};

type Rapier3dSceneCheckpointPayload = {
  version: 1;
  bytes: Uint8Array;
  nextBodyId: number;
  nextColliderId: number;
  activeContactCount: number;
  bodies: Array<{
    id: PhysicsBodyId;
    handle: number;
    kind: PhysicsBodyKind;
    userData?: Record<string, unknown> | undefined;
  }>;
  colliders: Array<{
    id: PhysicsColliderId;
    handle: number;
    definition: PhysicsColliderDefinition;
    enabled: boolean;
    userData?: Record<string, unknown> | undefined;
  }>;
};

let rapier3dInitPromise: Promise<void> | undefined;
let rapier3dInitialized = false;

export async function initRapier3dPhysicsBackend(
  options: Rapier3dPhysicsBackendOptions = {}
): Promise<PhysicsBackendAdapter<Rapier3dPhysicsNative>> {
  await initRapier3dRuntime();
  return createRapier3dPhysicsBackend(options);
}

export function createRapier3dPhysicsBackend(
  options: Rapier3dPhysicsBackendOptions = {}
): PhysicsBackendAdapter<Rapier3dPhysicsNative> {
  const id = options.id ?? "rapier3d";

  return {
    id,
    kind: "rapier3d",
    dimension: "3d",
    createScene(config) {
      assertRapier3dInitialized();
      return createRapier3dPhysicsScene(id, options, {
        ...config,
        dimension: config?.dimension ?? "3d"
      });
    },
    capabilities(): PhysicsBackendCapabilities {
      return {
        dimension: "3d",
        bodies: true,
        colliders: true,
        sensors: true,
        queries: ["point", "raycast", "shape-cast", "overlap", "check", "bounds"],
        deterministic: false,
        checkpoints: {
          captureRestore: true,
          fullScene: true,
          deterministicReplay: true
        },
        bodyCommands: {
          linearImpulse: true,
          applicationPoint: true,
          angularImpulse: true,
          wakePolicy: true
        },
        custom: {
          wasm: "compat",
          backend: "rapier3d",
          quaternionRotation: true,
          queryModes: "any,closest,all",
          querySorting: "distance",
          triggerInteraction: "include,exclude,only"
        }
      };
    }
  };
}

function initRapier3dRuntime(): Promise<void> {
  rapier3dInitPromise ??= RAPIER.init().then(() => {
    rapier3dInitialized = true;
  });
  return rapier3dInitPromise;
}

function assertRapier3dInitialized(): void {
  if (!rapier3dInitialized) {
    throw new GameError(
      "physics.rapier_not_initialized",
      "Rapier 3D must be initialized with initRapier3dPhysicsBackend before creating a scene"
    );
  }
}

function createRapier3dPhysicsScene(
  backend: string,
  options: Rapier3dPhysicsBackendOptions,
  config: PhysicsSceneConfig = {}
): PhysicsScene<Rapier3dPhysicsNative> {
  if (config.dimension !== undefined && config.dimension !== "3d") {
    throw new GameError(
      "physics.rapier_dimension_unsupported",
      "Rapier 3D backend supports 3D scenes",
      {
        dimension: config.dimension
      }
    );
  }

  const sceneId = config.id ?? "physics.rapier3d.scene";
  const gravity = cloneVector3(config.gravity ?? { x: 0, y: -9.81, z: 0 }, "scene.gravity");
  let world = new RAPIER.World(gravity);
  let eventQueue = new RAPIER.EventQueue(true);
  const materials = createMaterialMap(config.materialDefinitions, sceneId);
  if (config.fixedDeltaMs !== undefined) {
    world.timestep = config.fixedDeltaMs / 1000;
  }
  if (options.lengthUnit !== undefined) {
    world.lengthUnit = options.lengthUnit;
  }

  const bodies = new Map<PhysicsBodyId, Rapier3dBodyRecord>();
  const colliders = new Map<PhysicsColliderId, Rapier3dColliderRecord>();
  const colliderHandles = new Map<number, PhysicsColliderId>();
  let nextBodyId = 1;
  let nextColliderId = 1;
  let activeContactCount = 0;
  let disposed = false;
  let checkpointBodies: Rapier3dSceneCheckpointPayload["bodies"] | undefined;
  let checkpointColliders: Rapier3dSceneCheckpointPayload["colliders"] | undefined;

  const assertActive = (): void => {
    if (disposed) {
      throw new GameError("physics.scene_disposed", "Rapier 3D physics scene has been disposed", {
        sceneId
      });
    }
  };

  return {
    id: sceneId,
    createBody(definition) {
      assertActive();
      const id = definition.id ?? `body-${nextBodyId}`;
      nextBodyId += definition.id === undefined ? 1 : 0;
      if (bodies.has(id)) {
        throw new GameError("physics.body_duplicate", `Duplicate physics body: ${id}`, {
          bodyId: id,
          backend
        });
      }

      const desc = createBodyDesc(definition);
      const body = world.createRigidBody(desc);
      bodies.set(id, {
        id,
        body,
        kind: definition.kind,
        ...(definition.userData === undefined ? {} : { userData: { ...definition.userData } })
      });
      invalidateCheckpointTopology();
      return id;
    },
    updateBody(id, patch, options) {
      assertActive();
      const record = requireBody(bodies, id);
      applyBodyPatch(record, patch, options?.kinematicTransformMode ?? "target");
    },
    applyBodyCommand(command) {
      assertActive();
      return applyRapier3dBodyCommand(bodies.get(command.bodyId), command);
    },
    destroyBody(id) {
      assertActive();
      const record = bodies.get(id);
      if (!record) {
        return;
      }

      const attachedColliders = [...colliders.values()].filter(
        (collider) => collider.definition.bodyId === id
      );
      world.removeRigidBody(record.body);
      bodies.delete(id);
      for (const collider of attachedColliders) {
        colliders.delete(collider.id);
        colliderHandles.delete(collider.collider.handle);
      }
      invalidateCheckpointTopology();
    },
    createCollider(definition) {
      assertActive();
      const id = definition.id ?? `collider-${nextColliderId}`;
      nextColliderId += definition.id === undefined ? 1 : 0;
      if (colliders.has(id)) {
        throw new GameError("physics.collider_duplicate", `Duplicate physics collider: ${id}`, {
          colliderId: id,
          backend
        });
      }

      const parent =
        definition.bodyId === undefined ? undefined : requireBody(bodies, definition.bodyId);
      const desc = createColliderDesc(definition, options.groups, materials, sceneId);
      const collider = world.createCollider(desc, parent?.body);
      colliders.set(id, {
        id,
        collider,
        definition: cloneColliderDefinition(definition),
        enabled: true,
        ...(definition.userData === undefined ? {} : { userData: { ...definition.userData } })
      });
      colliderHandles.set(collider.handle, id);
      invalidateCheckpointTopology();
      return id;
    },
    updateCollider(id, patch) {
      assertActive();
      const record = requireCollider(colliders, id);
      applyColliderPatch(record, patch, options.groups);
      invalidateCheckpointTopology();
    },
    destroyCollider(id) {
      assertActive();
      const record = colliders.get(id);
      if (!record) {
        return;
      }

      world.removeCollider(record.collider, true);
      colliders.delete(id);
      colliderHandles.delete(record.collider.handle);
      invalidateCheckpointTopology();
    },
    step(deltaMs) {
      assertActive();
      world.timestep = deltaMs / 1000;
      world.step(eventQueue);

      const contacts: PhysicsContactEvent[] = [];
      eventQueue.drainCollisionEvents((handleA, handleB, started) => {
        const contact = createContactEvent(colliderHandles, colliders, handleA, handleB, started);
        if (contact) {
          contacts.push(contact);
        }
      });
      activeContactCount += contacts.filter((contact) => contact.phase === "enter").length;
      activeContactCount -= contacts.filter((contact) => contact.phase === "exit").length;
      activeContactCount = Math.max(0, activeContactCount);

      return {
        deltaMs,
        contacts,
        diagnostics: []
      };
    },
    getBodyState(id) {
      const record = bodies.get(id);
      return record ? createBodyState(record) : undefined;
    },
    getColliderState(id) {
      const record = colliders.get(id);
      return record ? createColliderState(record) : undefined;
    },
    query(query) {
      assertActive();
      return queryScene(world, query, colliders, colliderHandles, options.groups);
    },
    snapshot() {
      return {
        id: sceneId,
        backend,
        dimension: "3d",
        gravity: cloneVector(gravity),
        bodyCount: bodies.size,
        colliderCount: colliders.size,
        activeContactCount,
        disposed
      };
    },
    captureCheckpoint() {
      assertActive();
      const bytes = world.takeSnapshot();
      const payload: Rapier3dSceneCheckpointPayload = {
        version: 1,
        bytes,
        nextBodyId,
        nextColliderId,
        activeContactCount,
        bodies: captureCheckpointBodies(),
        colliders: captureCheckpointColliders()
      };
      return {
        backend,
        sceneId,
        byteLength: bytes.byteLength,
        payload
      } satisfies PhysicsSceneCheckpoint;
    },
    restoreCheckpoint(checkpoint) {
      assertActive();
      const payload = requireRapier3dCheckpoint(checkpoint, backend, sceneId);
      const restoredWorld = RAPIER.World.restoreSnapshot(payload.bytes);
      eventQueue.free();
      world.free();
      world = restoredWorld;
      eventQueue = new RAPIER.EventQueue(true);
      bodies.clear();
      colliders.clear();
      colliderHandles.clear();
      for (const entry of payload.bodies) {
        const body = world.getRigidBody(entry.handle);
        if (body === null) {
          throw invalidRestoredHandle("body", entry.id, entry.handle, sceneId);
        }
        bodies.set(entry.id, {
          id: entry.id,
          body,
          kind: entry.kind,
          ...(entry.userData === undefined ? {} : { userData: { ...entry.userData } })
        });
      }
      for (const entry of payload.colliders) {
        const collider = world.getCollider(entry.handle);
        if (collider === null) {
          throw invalidRestoredHandle("collider", entry.id, entry.handle, sceneId);
        }
        colliders.set(entry.id, {
          id: entry.id,
          collider,
          definition: cloneColliderDefinition(entry.definition),
          enabled: entry.enabled,
          ...(entry.userData === undefined ? {} : { userData: { ...entry.userData } })
        });
        colliderHandles.set(entry.handle, entry.id);
      }
      nextBodyId = payload.nextBodyId;
      nextColliderId = payload.nextColliderId;
      activeContactCount = payload.activeContactCount;
      checkpointBodies = payload.bodies;
      checkpointColliders = payload.colliders;
    },
    native() {
      return {
        rapier: RAPIER,
        world,
        eventQueue,
        bodies: new Map([...bodies].map(([id, record]) => [id, record.body])),
        colliders: new Map([...colliders].map(([id, record]) => [id, record.collider]))
      };
    },
    dispose() {
      if (disposed) {
        return;
      }
      disposed = true;
      bodies.clear();
      colliders.clear();
      colliderHandles.clear();
      eventQueue.free();
      world.free();
    }
  };

  function invalidateCheckpointTopology(): void {
    checkpointBodies = undefined;
    checkpointColliders = undefined;
  }

  function captureCheckpointBodies(): Rapier3dSceneCheckpointPayload["bodies"] {
    checkpointBodies ??= [...bodies.values()].map((record) => ({
      id: record.id,
      handle: record.body.handle,
      kind: record.kind,
      ...(record.userData === undefined ? {} : { userData: { ...record.userData } })
    }));
    return checkpointBodies;
  }

  function captureCheckpointColliders(): Rapier3dSceneCheckpointPayload["colliders"] {
    checkpointColliders ??= [...colliders.values()].map((record) => ({
      id: record.id,
      handle: record.collider.handle,
      definition: cloneColliderDefinition(record.definition),
      enabled: record.enabled,
      ...(record.userData === undefined ? {} : { userData: { ...record.userData } })
    }));
    return checkpointColliders;
  }

  function createBodyDesc(definition: PhysicsBodyDefinition): RAPIER.RigidBodyDesc {
    const desc =
      definition.kind === "dynamic"
        ? RAPIER.RigidBodyDesc.dynamic()
        : definition.kind === "kinematic"
          ? RAPIER.RigidBodyDesc.kinematicPositionBased()
          : RAPIER.RigidBodyDesc.fixed();

    if (definition.position !== undefined) {
      const position = cloneVector3(definition.position, "body.position");
      desc.setTranslation(position.x, position.y, position.z);
    }
    if (definition.rotation !== undefined) {
      desc.setRotation(rotationToQuaternion(definition.rotation, "body.rotation"));
    }
    if (definition.linearVelocity !== undefined) {
      const velocity = cloneVector3(definition.linearVelocity, "body.linearVelocity");
      desc.setLinvel(velocity.x, velocity.y, velocity.z);
    }
    if (definition.angularVelocity !== undefined) {
      desc.setAngvel(rotationToAngularVelocity(definition.angularVelocity, "body.angularVelocity"));
    }
    if (definition.gravityScale !== undefined) {
      desc.setGravityScale(definition.gravityScale);
    }
    if (definition.damping?.linear !== undefined) {
      desc.setLinearDamping(definition.damping.linear);
    }
    if (definition.damping?.angular !== undefined) {
      desc.setAngularDamping(definition.damping.angular);
    }
    if (definition.continuousCollisionDetection !== undefined) {
      desc.setCcdEnabled(definition.continuousCollisionDetection);
    }
    applyLockedAxesToDesc(desc, definition.lockedAxes);
    if (definition.userData !== undefined) {
      desc.setUserData({ ...definition.userData });
    }

    return desc;
  }

  function createColliderDesc(
    definition: PhysicsColliderDefinition,
    groups: Rapier3dGroupMap | undefined,
    materialDefinitions: ReadonlyMap<string, PhysicsMaterialDefinition>,
    ownerSceneId: string
  ): RAPIER.ColliderDesc {
    const desc = createShapeColliderDesc(definition.shape);
    applyMaterialToColliderDesc(desc, definition, materialDefinitions, ownerSceneId);
    if (definition.sensor !== undefined) {
      desc.setSensor(definition.sensor);
    }
    desc.setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);
    desc.setActiveCollisionTypes(RAPIER.ActiveCollisionTypes.ALL);

    const interactionGroups = createInteractionGroups(definition.filter, groups);
    if (interactionGroups !== undefined) {
      desc.setCollisionGroups(interactionGroups);
    }
    if (definition.offset?.position !== undefined) {
      const offset = cloneVector3(definition.offset.position, "collider.offset.position");
      desc.setTranslation(offset.x, offset.y, offset.z);
    }
    if (definition.offset?.rotation !== undefined) {
      desc.setRotation(
        rotationToQuaternion(definition.offset.rotation, "collider.offset.rotation")
      );
    }

    return desc;
  }
}

function createMaterialMap(
  definitions: readonly PhysicsMaterialDefinition[] | undefined,
  sceneId: string
): ReadonlyMap<string, PhysicsMaterialDefinition> {
  const materials = new Map<string, PhysicsMaterialDefinition>();
  for (const definition of definitions ?? []) {
    if (materials.has(definition.id)) {
      throw new GameError(
        "physics.material_duplicate",
        `Duplicate physics material in scene ${sceneId}: ${definition.id}`,
        { sceneId, materialId: definition.id }
      );
    }
    materials.set(definition.id, structuredClone(definition));
  }
  return materials;
}

function applyMaterialToColliderDesc(
  desc: RAPIER.ColliderDesc,
  definition: PhysicsColliderDefinition,
  materials: ReadonlyMap<string, PhysicsMaterialDefinition>,
  sceneId: string
): void {
  if (definition.material === undefined) {
    return;
  }
  const material = materials.get(definition.material);
  if (material === undefined) {
    throw new GameError(
      "physics.material_missing",
      `Missing physics material in scene ${sceneId}: ${definition.material}`,
      { sceneId, materialId: definition.material, colliderId: definition.id }
    );
  }
  if (material.friction !== undefined) {
    desc.setFriction(material.friction);
  }
  if (material.restitution !== undefined) {
    desc.setRestitution(material.restitution);
  }
  if (material.density !== undefined) {
    desc.setDensity(material.density);
  }
  if (material.combine?.friction !== undefined) {
    desc.setFrictionCombineRule(toRapierCombineRule(material.combine.friction));
  }
  if (material.combine?.restitution !== undefined) {
    desc.setRestitutionCombineRule(toRapierCombineRule(material.combine.restitution));
  }
}

function toRapierCombineRule(
  value: NonNullable<NonNullable<PhysicsMaterialDefinition["combine"]>["friction"]>
): RAPIER.CoefficientCombineRule {
  switch (value) {
    case "min":
      return RAPIER.CoefficientCombineRule.Min;
    case "max":
      return RAPIER.CoefficientCombineRule.Max;
    case "multiply":
      return RAPIER.CoefficientCombineRule.Multiply;
    case "average":
      return RAPIER.CoefficientCombineRule.Average;
  }
}

function requireRapier3dCheckpoint(
  checkpoint: PhysicsSceneCheckpoint,
  backend: string,
  sceneId: string
): Rapier3dSceneCheckpointPayload {
  if (checkpoint.backend !== backend || checkpoint.sceneId !== sceneId) {
    throw new GameError(
      "physics.checkpoint_scene_mismatch",
      `Physics checkpoint does not belong to scene: ${sceneId}`,
      {
        checkpointBackend: checkpoint.backend,
        checkpointSceneId: checkpoint.sceneId,
        backend,
        sceneId
      }
    );
  }
  const payload = checkpoint.payload as Partial<Rapier3dSceneCheckpointPayload> | undefined;
  if (
    payload?.version !== 1 ||
    !(payload.bytes instanceof Uint8Array) ||
    !Array.isArray(payload.bodies) ||
    !Array.isArray(payload.colliders) ||
    !Number.isSafeInteger(payload.nextBodyId) ||
    !Number.isSafeInteger(payload.nextColliderId) ||
    !Number.isSafeInteger(payload.activeContactCount)
  ) {
    throw new GameError(
      "physics.checkpoint_invalid",
      `Invalid Rapier 3D checkpoint for scene: ${sceneId}`
    );
  }
  return payload as Rapier3dSceneCheckpointPayload;
}

function invalidRestoredHandle(
  kind: "body" | "collider",
  id: string,
  handle: number,
  sceneId: string
): GameError {
  return new GameError(
    "physics.checkpoint_invalid_handle",
    `Physics checkpoint restored without ${kind}: ${id}`,
    { sceneId, kind, id, handle }
  );
}

function requireBody(
  bodies: ReadonlyMap<PhysicsBodyId, Rapier3dBodyRecord>,
  id: PhysicsBodyId
): Rapier3dBodyRecord {
  const record = bodies.get(id);
  if (!record) {
    throw new GameError("physics.body_missing", `Missing physics body: ${id}`, { bodyId: id });
  }

  return record;
}

function requireCollider(
  colliders: ReadonlyMap<PhysicsColliderId, Rapier3dColliderRecord>,
  id: PhysicsColliderId
): Rapier3dColliderRecord {
  const record = colliders.get(id);
  if (!record) {
    throw new GameError("physics.collider_missing", `Missing physics collider: ${id}`, {
      colliderId: id
    });
  }

  return record;
}

function applyBodyPatch(
  record: Rapier3dBodyRecord,
  patch: PhysicsBodyPatch,
  kinematicTransformMode: "target" | "teleport"
): void {
  if (patch.position !== undefined) {
    const position = cloneVector3(patch.position, "body.patch.position");
    if (record.kind === "kinematic" && kinematicTransformMode === "target") {
      record.body.setNextKinematicTranslation(position);
    } else {
      record.body.setTranslation(position, true);
    }
  }
  if (patch.rotation !== undefined) {
    const rotation = rotationToQuaternion(patch.rotation, "body.patch.rotation");
    if (record.kind === "kinematic" && kinematicTransformMode === "target") {
      record.body.setNextKinematicRotation(rotation);
    } else {
      record.body.setRotation(rotation, true);
    }
  }
  if (patch.linearVelocity !== undefined) {
    record.body.setLinvel(cloneVector3(patch.linearVelocity, "body.patch.linearVelocity"), true);
  }
  if (patch.angularVelocity !== undefined) {
    record.body.setAngvel(
      rotationToAngularVelocity(patch.angularVelocity, "body.patch.angularVelocity"),
      true
    );
  }
  if (patch.gravityScale !== undefined) {
    record.body.setGravityScale(patch.gravityScale, true);
  }
  if (patch.sleeping !== undefined) {
    if (patch.sleeping) {
      record.body.sleep();
    } else {
      record.body.wakeUp();
    }
  }
  if (patch.userData !== undefined) {
    record.userData = { ...patch.userData };
  }
}

function applyRapier3dBodyCommand(
  record: Rapier3dBodyRecord | undefined,
  command: PhysicsBodyCommand
): PhysicsBodyCommandResult {
  if (record === undefined) {
    return bodyCommandResult(command, "body-missing", `Missing physics body: ${command.bodyId}`);
  }
  if (record.kind !== "dynamic") {
    return bodyCommandResult(
      command,
      "body-kind-mismatch",
      `Physics body command requires a dynamic body: ${command.bodyId}`
    );
  }
  const wake = command.wake !== "preserve";
  try {
    if (command.type === "linear-impulse") {
      const impulse = cloneVector3(command.impulse, "body.command.impulse");
      if (command.point === undefined) {
        record.body.applyImpulse(impulse, wake);
      } else {
        record.body.applyImpulseAtPoint(
          impulse,
          cloneVector3(command.point, "body.command.point"),
          wake
        );
      }
    } else {
      if (
        typeof command.impulse === "number" ||
        "w" in command.impulse ||
        command.impulse.z === undefined
      ) {
        return bodyCommandResult(
          command,
          "invalid-command",
          "Rapier 3D angular impulse must be a three-dimensional vector"
        );
      }
      record.body.applyTorqueImpulse(
        cloneVector3(command.impulse, "body.command.angularImpulse"),
        wake
      );
    }
  } catch (error) {
    return bodyCommandResult(
      command,
      "invalid-command",
      error instanceof Error ? error.message : "Invalid Rapier 3D body command"
    );
  }
  return bodyCommandResult(command, "applied");
}

function bodyCommandResult(
  command: PhysicsBodyCommand,
  status: PhysicsBodyCommandResult["status"],
  reason?: string
): PhysicsBodyCommandResult {
  return {
    status,
    bodyId: command.bodyId,
    commandType: command.type,
    ...(reason === undefined ? {} : { reason })
  };
}

function applyColliderPatch(
  record: Rapier3dColliderRecord,
  patch: PhysicsColliderPatch,
  groups: Rapier3dGroupMap | undefined
): void {
  if (patch.enabled !== undefined) {
    record.enabled = patch.enabled;
    record.collider.setEnabled(patch.enabled);
  }
  if (patch.sensor !== undefined) {
    record.definition = { ...record.definition, sensor: patch.sensor };
    record.collider.setSensor(patch.sensor);
  }
  if (patch.filter !== undefined) {
    record.definition = { ...record.definition, filter: cloneFilter(patch.filter) };
    const interactionGroups = createInteractionGroups(patch.filter, groups);
    if (interactionGroups !== undefined) {
      record.collider.setCollisionGroups(interactionGroups);
    }
  }
  if (patch.offset?.position !== undefined) {
    record.definition = {
      ...record.definition,
      offset: {
        ...record.definition.offset,
        position: cloneVector(patch.offset.position)
      }
    };
    const offset = cloneVector3(patch.offset.position, "collider.patch.offset.position");
    record.collider.setTranslationWrtParent(offset);
  }
  if (patch.offset?.rotation !== undefined) {
    record.definition = {
      ...record.definition,
      offset: {
        ...record.definition.offset,
        rotation: cloneRotation(patch.offset.rotation)
      }
    };
    record.collider.setRotationWrtParent(
      rotationToQuaternion(patch.offset.rotation, "collider.patch.offset.rotation")
    );
  }
  if (patch.userData !== undefined) {
    record.userData = { ...patch.userData };
  }
}

function createBodyState(record: Rapier3dBodyRecord): PhysicsBodyState {
  return {
    id: record.id,
    kind: bodyKindFromRapier(record.body),
    position: cloneVector(record.body.translation()),
    linearVelocity: cloneVector(record.body.linvel()),
    sleeping: record.body.isSleeping(),
    rotation: cloneQuaternion(record.body.rotation()),
    angularVelocity: cloneVector(record.body.angvel()),
    ...(record.userData === undefined ? {} : { userData: { ...record.userData } })
  };
}

function createColliderState(record: Rapier3dColliderRecord): PhysicsColliderState {
  const parent = record.collider.parent();
  return {
    id: record.id,
    ...(parent === null ? {} : { bodyId: record.definition.bodyId }),
    shape: cloneShape(record.definition.shape),
    sensor: record.collider.isSensor(),
    enabled: record.enabled && record.collider.isEnabled(),
    ...(record.definition.material === undefined ? {} : { material: record.definition.material }),
    ...(record.definition.filter === undefined
      ? {}
      : { filter: cloneFilter(record.definition.filter) }),
    ...(record.definition.offset === undefined
      ? {}
      : { offset: cloneOffset(record.definition.offset) }),
    ...(record.userData === undefined ? {} : { userData: { ...record.userData } })
  };
}

function createContactEvent(
  colliderHandles: ReadonlyMap<number, PhysicsColliderId>,
  colliders: ReadonlyMap<PhysicsColliderId, Rapier3dColliderRecord>,
  handleA: number,
  handleB: number,
  started: boolean
): PhysicsContactEvent | undefined {
  const colliderA = colliderHandles.get(handleA);
  const colliderB = colliderHandles.get(handleB);
  if (!colliderA || !colliderB) {
    return undefined;
  }

  const recordA = colliders.get(colliderA);
  const recordB = colliders.get(colliderB);
  if (!recordA || !recordB) {
    return undefined;
  }

  const sensor = recordA.collider.isSensor() || recordB.collider.isSensor();
  const kind: PhysicsContactKind = sensor ? "trigger" : "contact";
  return {
    phase: started ? "enter" : "exit",
    kind,
    colliderA,
    colliderB,
    ...(recordA.definition.bodyId === undefined ? {} : { bodyA: recordA.definition.bodyId }),
    ...(recordB.definition.bodyId === undefined ? {} : { bodyB: recordB.definition.bodyId }),
    sensor
  };
}

function queryScene(
  world: RAPIER.World,
  query: PhysicsQuery,
  colliders: ReadonlyMap<PhysicsColliderId, Rapier3dColliderRecord>,
  colliderHandles: ReadonlyMap<number, PhysicsColliderId>,
  groups: Rapier3dGroupMap | undefined
): PhysicsQueryResult[] {
  const options = resolveQueryOptions(query);
  const filterFlags = createQueryFilterFlags(options);
  const filterGroups = createInteractionGroups(options.filter, groups);
  const filterPredicate = (collider: RAPIER.Collider): boolean => {
    const id = colliderHandles.get(collider.handle);
    if (!id) {
      return false;
    }
    const record = colliders.get(id);
    return record?.enabled === true && canQueryCollider(record, options);
  };
  const results: PhysicsQueryResult[] = [];

  if (query.type === "point") {
    const point = cloneVector3(query.point, "query.point");
    world.intersectionsWithPoint(
      point,
      (collider) => {
        pushQueryResult(results, collider, colliders, colliderHandles, {
          point: cloneVector(point),
          distance: 0,
          inside: true
        });
        return shouldContinueCollecting(results, options);
      },
      filterFlags,
      filterGroups,
      undefined,
      undefined,
      filterPredicate
    );
    return finalizeQueryResults(results, options);
  }

  if (query.type === "raycast") {
    const origin = cloneVector3(query.origin, "query.origin");
    const direction = normalizeVector3(query.direction, "query.direction");
    const ray = new RAPIER.Ray(origin, direction);
    const maxDistance = query.maxDistance ?? Number.POSITIVE_INFINITY;

    if ((options.mode ?? "all") === "all") {
      world.intersectionsWithRay(
        ray,
        maxDistance,
        query.solid ?? true,
        (hit) => {
          pushQueryResult(results, hit.collider, colliders, colliderHandles, {
            point: cloneVector(ray.pointAt(hit.timeOfImpact)),
            normal: cloneVector(hit.normal),
            distance: hit.timeOfImpact,
            ...(Number.isFinite(maxDistance) ? { fraction: hit.timeOfImpact / maxDistance } : {})
          });
          return shouldContinueCollecting(results, options);
        },
        filterFlags,
        filterGroups,
        undefined,
        undefined,
        filterPredicate
      );
    } else {
      const hit = world.castRayAndGetNormal(
        ray,
        maxDistance,
        query.solid ?? true,
        filterFlags,
        filterGroups,
        undefined,
        undefined,
        filterPredicate
      );
      if (hit) {
        pushQueryResult(results, hit.collider, colliders, colliderHandles, {
          point: cloneVector(ray.pointAt(hit.timeOfImpact)),
          normal: cloneVector(hit.normal),
          distance: hit.timeOfImpact,
          ...(Number.isFinite(maxDistance) ? { fraction: hit.timeOfImpact / maxDistance } : {})
        });
      }
    }
    return finalizeQueryResults(results, options);
  }

  if (query.type === "bounds") {
    const bounds = normalizeBounds3(query.bounds);
    world.collidersWithAabbIntersectingAabb(bounds.center, bounds.halfExtents, (collider) => {
      if (!filterPredicate(collider)) {
        return true;
      }
      pushQueryResult(results, collider, colliders, colliderHandles, { distance: 0 });
      return shouldContinueCollecting(results, options);
    });
    return finalizeQueryResults(results, options);
  }

  if (query.type === "shape-cast") {
    if ((options.mode ?? "closest") === "all") {
      throw new GameError(
        "physics.query_mode_unsupported",
        "Rapier 3D shape cast supports any/closest mode only",
        { queryType: query.type, mode: options.mode }
      );
    }
    const position = cloneVector3(query.position ?? { x: 0, y: 0, z: 0 }, "query.position");
    const rotation =
      query.rotation === undefined
        ? identityRotation()
        : rotationToQuaternion(query.rotation, "query.rotation");
    const direction = normalizeVector3(query.direction, "query.direction");
    const desc = createShapeColliderDesc(query.shape);
    const maxDistance = query.maxDistance ?? Number.POSITIVE_INFINITY;
    const hit = world.castShape(
      position,
      rotation,
      direction,
      desc.shape,
      query.targetDistance ?? 0,
      maxDistance,
      query.stopAtPenetration ?? true,
      filterFlags,
      filterGroups,
      undefined,
      undefined,
      filterPredicate
    );
    if (hit) {
      pushQueryResult(results, hit.collider, colliders, colliderHandles, {
        point: cloneVector(hit.witness1),
        normal: cloneVector(hit.normal1),
        distance: hit.time_of_impact,
        ...(Number.isFinite(maxDistance) ? { fraction: hit.time_of_impact / maxDistance } : {})
      });
    }
    return finalizeQueryResults(results, options);
  }

  const position = cloneVector3(query.position ?? { x: 0, y: 0, z: 0 }, "query.position");
  const rotation =
    query.rotation === undefined
      ? identityRotation()
      : rotationToQuaternion(query.rotation, "query.rotation");
  const desc = createShapeColliderDesc(query.shape);
  const singleHit = query.type === "check" || (options.mode ?? "all") !== "all";
  if (singleHit) {
    const collider = world.intersectionWithShape(
      position,
      rotation,
      desc.shape,
      filterFlags,
      filterGroups,
      undefined,
      undefined,
      filterPredicate
    );
    if (collider) {
      pushQueryResult(results, collider, colliders, colliderHandles, {
        distance: 0,
        inside: true
      });
    }
    return finalizeQueryResults(results, { ...options, mode: "any" });
  }

  world.intersectionsWithShape(
    position,
    rotation,
    desc.shape,
    (collider) => {
      pushQueryResult(results, collider, colliders, colliderHandles, {
        distance: 0,
        inside: true
      });
      return shouldContinueCollecting(results, options);
    },
    filterFlags,
    filterGroups,
    undefined,
    undefined,
    filterPredicate
  );
  return finalizeQueryResults(results, options);
}

function pushQueryResult(
  results: PhysicsQueryResult[],
  collider: RAPIER.Collider,
  colliders: ReadonlyMap<PhysicsColliderId, Rapier3dColliderRecord>,
  colliderHandles: ReadonlyMap<number, PhysicsColliderId>,
  extras: Partial<PhysicsQueryResult> = {}
): void {
  const colliderId = colliderHandles.get(collider.handle);
  if (!colliderId) {
    return;
  }
  const record = colliders.get(colliderId);
  if (!record) {
    return;
  }

  results.push({
    colliderId,
    ...(record.definition.bodyId === undefined ? {} : { bodyId: record.definition.bodyId }),
    sensor: record.collider.isSensor(),
    ...extras
  });
}

function resolveQueryOptions(query: PhysicsQuery): PhysicsQueryOptions {
  const legacy: PhysicsQueryOptions = {
    ...(query.filter === undefined ? {} : { filter: query.filter }),
    ...(query.includeSensors === undefined
      ? {}
      : { triggerInteraction: query.includeSensors ? "include" : "exclude" })
  };

  return {
    ...legacy,
    ...query.options,
    ...(query.options?.filter === undefined ? {} : { filter: query.options.filter })
  };
}

function createQueryFilterFlags(options: PhysicsQueryOptions): RAPIER.QueryFilterFlags | undefined {
  switch (options.triggerInteraction) {
    case "exclude":
      return RAPIER.QueryFilterFlags.EXCLUDE_SENSORS;
    case "only":
      return RAPIER.QueryFilterFlags.EXCLUDE_SOLIDS;
    default:
      return undefined;
  }
}

function canQueryCollider(record: Rapier3dColliderRecord, options: PhysicsQueryOptions): boolean {
  if (options.ignoreColliders?.includes(record.id)) {
    return false;
  }
  if (
    record.definition.bodyId !== undefined &&
    options.ignoreBodies?.includes(record.definition.bodyId)
  ) {
    return false;
  }
  if (options.includeColliders !== undefined && !options.includeColliders.includes(record.id)) {
    return false;
  }
  if (
    options.includeBodies !== undefined &&
    (record.definition.bodyId === undefined ||
      !options.includeBodies.includes(record.definition.bodyId))
  ) {
    return false;
  }

  return filtersCompatible(options.filter, record.definition.filter);
}

function shouldContinueCollecting(
  results: PhysicsQueryResult[],
  options: PhysicsQueryOptions
): boolean {
  if (
    (options.mode ?? "all") === "any" ||
    (options.maxResults ?? Number.POSITIVE_INFINITY) <= results.length
  ) {
    return false;
  }
  return true;
}

function finalizeQueryResults(
  results: PhysicsQueryResult[],
  options: PhysicsQueryOptions
): PhysicsQueryResult[] {
  const mode = options.mode ?? "all";
  const shouldSort = options.sort === "distance" || mode === "closest";
  const sorted = shouldSort
    ? [...results].sort((a, b) => (a.distance ?? 0) - (b.distance ?? 0))
    : results;
  const limit =
    mode === "any" || mode === "closest"
      ? 1
      : options.maxResults === undefined
        ? sorted.length
        : Math.max(0, options.maxResults);
  return sorted.slice(0, limit);
}

function normalizeBounds3(bounds: { min: PhysicsVector; max: PhysicsVector }): {
  center: RAPIER.Vector;
  halfExtents: RAPIER.Vector;
} {
  const min = cloneVector3(
    {
      x: Math.min(bounds.min.x, bounds.max.x),
      y: Math.min(bounds.min.y, bounds.max.y),
      z: Math.min(bounds.min.z ?? 0, bounds.max.z ?? 0)
    },
    "query.bounds.min"
  );
  const max = cloneVector3(
    {
      x: Math.max(bounds.min.x, bounds.max.x),
      y: Math.max(bounds.min.y, bounds.max.y),
      z: Math.max(bounds.min.z ?? 0, bounds.max.z ?? 0)
    },
    "query.bounds.max"
  );
  return {
    center: {
      x: (min.x + max.x) / 2,
      y: (min.y + max.y) / 2,
      z: (min.z + max.z) / 2
    },
    halfExtents: {
      x: (max.x - min.x) / 2,
      y: (max.y - min.y) / 2,
      z: (max.z - min.z) / 2
    }
  };
}

function normalizeVector3(vector: PhysicsVector, path: string): RAPIER.Vector {
  const value = cloneVector3(vector, path);
  const length = Math.hypot(value.x, value.y, value.z);
  if (!Number.isFinite(length) || length <= 1e-9) {
    throw new GameError("physics.rapier_vector_invalid", "Rapier 3D query direction is zero", {
      path,
      vector
    });
  }
  return { x: value.x / length, y: value.y / length, z: value.z / length };
}

function filtersCompatible(
  filterA: PhysicsCollisionFilter | undefined,
  filterB: PhysicsCollisionFilter | undefined
): boolean {
  if (!bitsCompatible(filterA, filterB)) {
    return false;
  }

  const groupsA = filterA?.groups;
  const groupsB = filterB?.groups;
  const collidesWithA = filterA?.collidesWith;
  const collidesWithB = filterB?.collidesWith;
  if (collidesWithA && groupsB && !groupsB.some((group) => collidesWithA.includes(group))) {
    return false;
  }
  if (collidesWithB && groupsA && !groupsA.some((group) => collidesWithB.includes(group))) {
    return false;
  }
  return true;
}

function bitsCompatible(
  filterA: PhysicsCollisionFilter | undefined,
  filterB: PhysicsCollisionFilter | undefined
): boolean {
  if (
    filterA?.categoryBits === undefined &&
    filterA?.maskBits === undefined &&
    filterB?.categoryBits === undefined &&
    filterB?.maskBits === undefined
  ) {
    return true;
  }

  const categoryA = filterA?.categoryBits ?? 0xffff;
  const categoryB = filterB?.categoryBits ?? 0xffff;
  const maskA = filterA?.maskBits ?? 0xffff;
  const maskB = filterB?.maskBits ?? 0xffff;
  return (categoryA & maskB) !== 0 && (categoryB & maskA) !== 0;
}

function createShapeColliderDesc(shape: PhysicsShapeDefinition): RAPIER.ColliderDesc {
  switch (shape.type) {
    case "sphere":
      return RAPIER.ColliderDesc.ball(shape.radius);
    case "box":
      if (shape.depth === undefined) {
        throw new GameError(
          "physics.rapier_shape_unsupported",
          "Rapier 3D backend requires box.depth",
          {
            shape
          }
        );
      }
      return RAPIER.ColliderDesc.cuboid(shape.width / 2, shape.height / 2, shape.depth / 2);
    case "capsule":
      return RAPIER.ColliderDesc.capsule(shape.height / 2, shape.radius);
    case "polygon": {
      const desc = RAPIER.ColliderDesc.convexHull(pointsToFloat32(shape.points, "shape.points"));
      if (!desc) {
        throw new GameError(
          "physics.rapier_shape_invalid",
          "Rapier could not build a convex polyhedron",
          {
            shape
          }
        );
      }
      return desc;
    }
    case "polyline":
      return RAPIER.ColliderDesc.polyline(pointsToFloat32(shape.points, "shape.points"));
    case "circle":
    case "mesh":
    case "custom":
      throw new GameError(
        "physics.rapier_shape_unsupported",
        `Rapier 3D backend does not support shape: ${shape.type}`,
        { shape }
      );
  }
}

function pointsToFloat32(points: PhysicsVector[], path: string): Float32Array {
  const result = new Float32Array(points.length * 3);
  points.forEach((point, index) => {
    const vector = cloneVector3(point, `${path}[${index}]`);
    result[index * 3] = vector.x;
    result[index * 3 + 1] = vector.y;
    result[index * 3 + 2] = vector.z;
  });
  return result;
}

function applyLockedAxesToDesc(desc: RAPIER.RigidBodyDesc, lockedAxes: string[] | undefined): void {
  if (!lockedAxes?.length) {
    return;
  }

  const axes = new Set(lockedAxes.map((axis) => axis.toLowerCase()));
  if (axes.has("translation") || axes.has("translations")) {
    desc.lockTranslations();
  } else if (axes.has("x") || axes.has("y") || axes.has("z")) {
    desc.enabledTranslations(!axes.has("x"), !axes.has("y"), !axes.has("z"));
  }

  const lockRotationX = axes.has("rotation-x") || axes.has("angular-x") || axes.has("rx");
  const lockRotationY = axes.has("rotation-y") || axes.has("angular-y") || axes.has("ry");
  const lockRotationZ = axes.has("rotation-z") || axes.has("angular-z") || axes.has("rz");
  if (axes.has("rotation") || axes.has("rotations") || axes.has("angular")) {
    desc.lockRotations();
  } else if (lockRotationX || lockRotationY || lockRotationZ) {
    desc.enabledRotations(!lockRotationX, !lockRotationY, !lockRotationZ);
  }
}

function createInteractionGroups(
  filter: PhysicsCollisionFilter | undefined,
  groups: Rapier3dGroupMap | undefined
): number | undefined {
  if (!filter) {
    return undefined;
  }

  const memberships = filter.categoryBits ?? namesToBits(filter.groups, groups, "filter.groups");
  const mask = filter.maskBits ?? namesToBits(filter.collidesWith, groups, "filter.collidesWith");
  if (memberships === undefined && mask === undefined) {
    return undefined;
  }

  return (((memberships ?? 0xffff) & 0xffff) << 16) | ((mask ?? 0xffff) & 0xffff);
}

function namesToBits(
  names: string[] | undefined,
  groups: Rapier3dGroupMap | undefined,
  path: string
): number | undefined {
  if (!names?.length) {
    return undefined;
  }
  if (!groups) {
    throw new GameError(
      "physics.rapier_group_map_missing",
      "Rapier string collision groups require a group bit map",
      { path, names }
    );
  }

  let bits = 0;
  for (const name of names) {
    const bit = groups[name];
    if (bit === undefined) {
      throw new GameError(
        "physics.rapier_group_unknown",
        `Unknown Rapier collision group: ${name}`,
        {
          path,
          name
        }
      );
    }
    bits |= bit;
  }
  return bits;
}

function bodyKindFromRapier(body: RAPIER.RigidBody): PhysicsBodyKind {
  if (body.isDynamic()) {
    return "dynamic";
  }
  if (body.isKinematic()) {
    return "kinematic";
  }
  return "static";
}

function rotationToQuaternion(rotation: PhysicsRotation, path: string): RAPIER.Rotation {
  if (typeof rotation === "number") {
    return eulerToQuaternion({ x: 0, y: 0, z: rotation });
  }
  if ("w" in rotation) {
    assertFiniteRotation(rotation, path);
    return cloneQuaternion(rotation);
  }
  return eulerToQuaternion(cloneVector3(rotation, path));
}

function rotationToAngularVelocity(rotation: PhysicsRotation, path: string): RAPIER.Vector {
  if (typeof rotation === "number") {
    return { x: 0, y: 0, z: rotation };
  }
  if ("w" in rotation) {
    throw new GameError(
      "physics.rapier_rotation_unsupported",
      "Rapier 3D angular velocity must be a vector or number",
      {
        path,
        rotation
      }
    );
  }
  return cloneVector3(rotation, path);
}

function eulerToQuaternion(rotation: RAPIER.Vector): RAPIER.Rotation {
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
    x: sx * cy * cz - cx * sy * sz,
    y: cx * sy * cz + sx * cy * sz,
    z: cx * cy * sz - sx * sy * cz,
    w: cx * cy * cz + sx * sy * sz
  };
}

function identityRotation(): RAPIER.Rotation {
  return { x: 0, y: 0, z: 0, w: 1 };
}

function assertFiniteRotation(rotation: RAPIER.Rotation, path: string): void {
  if (
    !Number.isFinite(rotation.x) ||
    !Number.isFinite(rotation.y) ||
    !Number.isFinite(rotation.z) ||
    !Number.isFinite(rotation.w)
  ) {
    throw new GameError("physics.rapier_rotation_invalid", "Rapier 3D rotation must be finite", {
      path,
      rotation
    });
  }
}

function cloneVector3(vector: PhysicsVector, path: string): RAPIER.Vector {
  if (!Number.isFinite(vector.x) || !Number.isFinite(vector.y) || !Number.isFinite(vector.z ?? 0)) {
    throw new GameError("physics.rapier_vector_invalid", "Rapier 3D vector must be finite", {
      path,
      vector
    });
  }
  return { x: vector.x, y: vector.y, z: vector.z ?? 0 };
}

function cloneVector(vector: PhysicsVector): PhysicsVector {
  return {
    x: vector.x,
    y: vector.y,
    ...(vector.z === undefined ? {} : { z: vector.z })
  };
}

function cloneQuaternion(rotation: RAPIER.Rotation): RAPIER.Rotation {
  return {
    x: rotation.x,
    y: rotation.y,
    z: rotation.z,
    w: rotation.w
  };
}

function cloneShape(shape: PhysicsShapeDefinition): PhysicsShapeDefinition {
  switch (shape.type) {
    case "circle":
      return { ...shape };
    case "box":
      return { ...shape };
    case "capsule":
      return { ...shape };
    case "sphere":
      return { ...shape };
    case "polygon":
      return { type: "polygon", points: shape.points.map(cloneVector) };
    case "polyline":
      return { type: "polyline", points: shape.points.map(cloneVector) };
    case "mesh":
      return { ...shape };
    case "custom":
      return { type: "custom", backend: shape.backend, props: { ...shape.props } };
  }
}

function cloneColliderDefinition(definition: PhysicsColliderDefinition): PhysicsColliderDefinition {
  return {
    ...definition,
    shape: cloneShape(definition.shape),
    ...(definition.filter === undefined ? {} : { filter: cloneFilter(definition.filter) }),
    ...(definition.offset === undefined
      ? {}
      : {
          offset: {
            ...(definition.offset.position === undefined
              ? {}
              : { position: cloneVector(definition.offset.position) }),
            ...(definition.offset.rotation === undefined
              ? {}
              : { rotation: cloneRotation(definition.offset.rotation) })
          }
        }),
    ...(definition.userData === undefined ? {} : { userData: { ...definition.userData } })
  };
}

function cloneFilter(filter: PhysicsCollisionFilter): PhysicsCollisionFilter {
  return {
    ...(filter.groups === undefined ? {} : { groups: [...filter.groups] }),
    ...(filter.collidesWith === undefined ? {} : { collidesWith: [...filter.collidesWith] }),
    ...(filter.categoryBits === undefined ? {} : { categoryBits: filter.categoryBits }),
    ...(filter.maskBits === undefined ? {} : { maskBits: filter.maskBits })
  };
}

function cloneOffset(offset: NonNullable<PhysicsColliderState["offset"]>) {
  return {
    ...(offset.position === undefined ? {} : { position: cloneVector(offset.position) }),
    ...(offset.rotation === undefined ? {} : { rotation: cloneRotation(offset.rotation) })
  };
}

function cloneRotation(rotation: PhysicsRotation): PhysicsRotation {
  if (typeof rotation === "number") {
    return rotation;
  }
  if ("w" in rotation) {
    return cloneQuaternion(rotation);
  }
  return cloneVector(rotation);
}
