import { GameError } from "@gamekits/core";
import type {
  PhysicsBackendAdapter,
  PhysicsBackendCapabilities,
  PhysicsBodyCommand,
  PhysicsBodyCommandResult,
  PhysicsBodyDefinition,
  PhysicsBodyId,
  PhysicsBodyPatch,
  PhysicsBodyState,
  PhysicsColliderDefinition,
  PhysicsColliderId,
  PhysicsColliderPatch,
  PhysicsColliderState,
  PhysicsContactEvent,
  PhysicsContactKind,
  PhysicsQueryOptions,
  PhysicsRotation,
  PhysicsQuery,
  PhysicsQueryResult,
  PhysicsScene,
  PhysicsSceneConfig,
  PhysicsSceneCheckpoint,
  PhysicsSceneSnapshot,
  PhysicsShapeDefinition,
  PhysicsVector
} from "./types";

type Bounds = {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
};

type RayHit = {
  distance: number;
  point: PhysicsVector;
  normal: PhysicsVector;
  inside: boolean;
};

type MemoryBodyRecord = {
  state: PhysicsBodyState;
  gravityScale: number;
};

type MemoryColliderRecord = {
  state: PhysicsColliderState;
};

type MemoryPhysicsSceneCheckpointPayload = {
  version: 1;
  nextBodyId: number;
  nextColliderId: number;
  bodies: Array<[PhysicsBodyId, MemoryBodyRecord]>;
  colliders: Array<[PhysicsColliderId, MemoryColliderRecord]>;
  activePairs: string[];
};

export type MemoryPhysicsBackendOptions = {
  id?: string;
  dimension?: "2d" | "3d";
};

export function createMemoryPhysicsBackend(
  options: MemoryPhysicsBackendOptions = {}
): PhysicsBackendAdapter<PhysicsSceneSnapshot> {
  const dimension = options.dimension ?? "2d";
  const id = options.id ?? "memory-physics";

  return {
    id,
    kind: "memory",
    dimension,
    createScene(config) {
      return createMemoryPhysicsScene(id, { ...config, dimension: config?.dimension ?? dimension });
    },
    capabilities(): PhysicsBackendCapabilities {
      return {
        dimension,
        bodies: true,
        colliders: true,
        sensors: true,
        queries: ["point", "raycast", "shape-cast", "overlap", "check", "bounds"],
        deterministic: true,
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
          queryModes: "any,closest,all",
          querySorting: "distance",
          triggerInteraction: "include,exclude,only"
        }
      };
    }
  };
}

function createMemoryPhysicsScene(
  backend: string,
  config: PhysicsSceneConfig = {}
): PhysicsScene<PhysicsSceneSnapshot> {
  const sceneId = config.id ?? "physics.scene";
  const dimension = config.dimension ?? "2d";
  const gravity = cloneVector(config.gravity ?? { x: 0, y: 0 });
  const bodies = new Map<PhysicsBodyId, MemoryBodyRecord>();
  const colliders = new Map<PhysicsColliderId, MemoryColliderRecord>();
  let nextBodyId = 1;
  let nextColliderId = 1;
  let disposed = false;
  let activePairs = new Set<string>();

  const assertActive = (): void => {
    if (disposed) {
      throw new GameError("physics.scene_disposed", "Physics scene has been disposed", {
        sceneId
      });
    }
  };

  const requireBody = (id: PhysicsBodyId): MemoryBodyRecord => {
    const body = bodies.get(id);
    if (!body) {
      throw new GameError("physics.body_missing", `Missing physics body: ${id}`, { bodyId: id });
    }

    return body;
  };

  const requireCollider = (id: PhysicsColliderId): MemoryColliderRecord => {
    const collider = colliders.get(id);
    if (!collider) {
      throw new GameError("physics.collider_missing", `Missing physics collider: ${id}`, {
        colliderId: id
      });
    }

    return collider;
  };

  return {
    id: sceneId,
    createBody(definition) {
      assertActive();
      const id = definition.id ?? `body-${nextBodyId}`;
      nextBodyId += definition.id === undefined ? 1 : 0;
      if (bodies.has(id)) {
        throw new GameError("physics.body_duplicate", `Duplicate physics body: ${id}`, {
          bodyId: id
        });
      }

      bodies.set(id, {
        state: createBodyState(id, definition),
        gravityScale: definition.gravityScale ?? 1
      });

      return id;
    },
    updateBody(id, patch) {
      assertActive();
      const body = requireBody(id);
      body.state = patchBodyState(body.state, patch);
      if (patch.gravityScale !== undefined) {
        body.gravityScale = patch.gravityScale;
      }
    },
    applyBodyCommand(command) {
      assertActive();
      const body = bodies.get(command.bodyId);
      if (body === undefined) {
        return bodyCommandResult(
          command,
          "body-missing",
          `Missing physics body: ${command.bodyId}`
        );
      }
      return applyMemoryBodyCommand(body, command, dimension);
    },
    destroyBody(id) {
      assertActive();
      bodies.delete(id);
      for (const [colliderId, collider] of colliders.entries()) {
        if (collider.state.bodyId === id) {
          colliders.delete(colliderId);
        }
      }
      activePairs = filterActivePairs(activePairs, colliders);
    },
    createCollider(definition) {
      assertActive();
      const id = definition.id ?? `collider-${nextColliderId}`;
      nextColliderId += definition.id === undefined ? 1 : 0;
      if (colliders.has(id)) {
        throw new GameError("physics.collider_duplicate", `Duplicate physics collider: ${id}`, {
          colliderId: id
        });
      }
      if (definition.bodyId !== undefined && !bodies.has(definition.bodyId)) {
        throw new GameError("physics.body_missing", `Missing physics body: ${definition.bodyId}`, {
          bodyId: definition.bodyId,
          colliderId: id
        });
      }

      colliders.set(id, { state: createColliderState(id, definition) });
      return id;
    },
    updateCollider(id, patch) {
      assertActive();
      const collider = requireCollider(id);
      collider.state = patchColliderState(collider.state, patch);
    },
    destroyCollider(id) {
      assertActive();
      colliders.delete(id);
      activePairs = filterActivePairs(activePairs, colliders);
    },
    step(deltaMs) {
      assertActive();
      const deltaSeconds = deltaMs / 1000;
      for (const body of bodies.values()) {
        if (body.state.kind !== "dynamic" || body.state.sleeping) {
          continue;
        }

        const velocity = addVectors(
          body.state.linearVelocity,
          scaleVector(gravity, body.gravityScale * deltaSeconds)
        );
        body.state = {
          ...body.state,
          linearVelocity: velocity,
          position: addVectors(body.state.position, scaleVector(velocity, deltaSeconds))
        };
      }

      const nextPairs = collectOverlappingPairs(colliders, bodies);
      const contacts: PhysicsContactEvent[] = [];
      for (const pair of nextPairs) {
        if (!activePairs.has(pair.key)) {
          contacts.push(createContactEvent("enter", pair.colliderA, pair.colliderB));
        }
      }
      for (const pairKey of activePairs) {
        if (!nextPairs.some((pair) => pair.key === pairKey)) {
          const [colliderA, colliderB] = pairKey.split("|");
          if (colliderA && colliderB && colliders.has(colliderA) && colliders.has(colliderB)) {
            contacts.push(createContactEvent("exit", colliderA, colliderB));
          }
        }
      }
      activePairs = new Set(nextPairs.map((pair) => pair.key));

      return {
        deltaMs,
        contacts,
        diagnostics: []
      };
    },
    getBodyState(id) {
      const body = bodies.get(id);
      return body ? cloneBodyState(body.state) : undefined;
    },
    getColliderState(id) {
      const collider = colliders.get(id);
      return collider ? cloneColliderState(collider.state) : undefined;
    },
    query(query) {
      assertActive();
      return queryScene(query, colliders, bodies);
    },
    snapshot() {
      return {
        id: sceneId,
        backend,
        dimension,
        gravity: cloneVector(gravity),
        bodyCount: bodies.size,
        colliderCount: colliders.size,
        activeContactCount: activePairs.size,
        disposed
      };
    },
    captureCheckpoint() {
      assertActive();
      const payload: MemoryPhysicsSceneCheckpointPayload = {
        version: 1,
        nextBodyId,
        nextColliderId,
        bodies: [...bodies].map(([id, record]) => [
          id,
          { state: cloneBodyState(record.state), gravityScale: record.gravityScale }
        ]),
        colliders: [...colliders].map(([id, record]) => [
          id,
          { state: cloneColliderState(record.state) }
        ]),
        activePairs: [...activePairs]
      };
      return {
        backend,
        sceneId,
        byteLength: JSON.stringify(payload).length,
        payload
      } satisfies PhysicsSceneCheckpoint;
    },
    restoreCheckpoint(checkpoint) {
      assertActive();
      const payload = requireMemoryCheckpoint(checkpoint, backend, sceneId);
      bodies.clear();
      colliders.clear();
      for (const [id, record] of payload.bodies) {
        bodies.set(id, {
          state: cloneBodyState(record.state),
          gravityScale: record.gravityScale
        });
      }
      for (const [id, record] of payload.colliders) {
        colliders.set(id, { state: cloneColliderState(record.state) });
      }
      nextBodyId = payload.nextBodyId;
      nextColliderId = payload.nextColliderId;
      activePairs = new Set(payload.activePairs);
    },
    native() {
      return this.snapshot();
    },
    dispose() {
      disposed = true;
      bodies.clear();
      colliders.clear();
      activePairs.clear();
    }
  };

  function createContactEvent(
    phase: "enter" | "exit",
    colliderA: PhysicsColliderId,
    colliderB: PhysicsColliderId
  ): PhysicsContactEvent {
    const stateA = requireCollider(colliderA).state;
    const stateB = requireCollider(colliderB).state;
    const sensor = stateA.sensor || stateB.sensor;
    const kind: PhysicsContactKind = sensor ? "trigger" : "contact";

    return {
      phase,
      kind,
      colliderA,
      colliderB,
      ...(stateA.bodyId === undefined ? {} : { bodyA: stateA.bodyId }),
      ...(stateB.bodyId === undefined ? {} : { bodyB: stateB.bodyId }),
      sensor
    };
  }
}

function requireMemoryCheckpoint(
  checkpoint: PhysicsSceneCheckpoint,
  backend: string,
  sceneId: string
): MemoryPhysicsSceneCheckpointPayload {
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
  const payload = checkpoint.payload as Partial<MemoryPhysicsSceneCheckpointPayload> | undefined;
  if (
    payload?.version !== 1 ||
    !Array.isArray(payload.bodies) ||
    !Array.isArray(payload.colliders) ||
    !Array.isArray(payload.activePairs) ||
    !Number.isSafeInteger(payload.nextBodyId) ||
    !Number.isSafeInteger(payload.nextColliderId)
  ) {
    throw new GameError(
      "physics.checkpoint_invalid",
      `Invalid memory physics checkpoint for scene: ${sceneId}`
    );
  }
  return payload as MemoryPhysicsSceneCheckpointPayload;
}

function createBodyState(id: PhysicsBodyId, definition: PhysicsBodyDefinition): PhysicsBodyState {
  return {
    id,
    kind: definition.kind,
    position: cloneVector(definition.position ?? { x: 0, y: 0 }),
    linearVelocity: cloneVector(definition.linearVelocity ?? { x: 0, y: 0 }),
    sleeping: false,
    ...(definition.rotation === undefined ? {} : { rotation: cloneRotation(definition.rotation) }),
    ...(definition.angularVelocity === undefined
      ? {}
      : { angularVelocity: cloneRotation(definition.angularVelocity) }),
    ...(definition.userData === undefined ? {} : { userData: { ...definition.userData } })
  };
}

function patchBodyState(state: PhysicsBodyState, patch: PhysicsBodyPatch): PhysicsBodyState {
  return {
    ...state,
    ...(patch.position === undefined ? {} : { position: cloneVector(patch.position) }),
    ...(patch.rotation === undefined ? {} : { rotation: cloneRotation(patch.rotation) }),
    ...(patch.linearVelocity === undefined
      ? {}
      : { linearVelocity: cloneVector(patch.linearVelocity) }),
    ...(patch.angularVelocity === undefined
      ? {}
      : { angularVelocity: cloneRotation(patch.angularVelocity) }),
    ...(patch.sleeping === undefined ? {} : { sleeping: patch.sleeping }),
    ...(patch.userData === undefined ? {} : { userData: { ...patch.userData } })
  };
}

function applyMemoryBodyCommand(
  body: MemoryBodyRecord,
  command: PhysicsBodyCommand,
  dimension: "2d" | "3d"
): PhysicsBodyCommandResult {
  if (body.state.kind !== "dynamic") {
    return bodyCommandResult(
      command,
      "body-kind-mismatch",
      `Physics body command requires a dynamic body: ${command.bodyId}`
    );
  }
  if (command.type === "linear-impulse") {
    if (
      !validVectorForDimension(command.impulse, dimension) ||
      (command.point !== undefined && !validVectorForDimension(command.point, dimension))
    ) {
      return bodyCommandResult(command, "invalid-command", "Linear impulse vectors are invalid");
    }
    body.state = {
      ...body.state,
      linearVelocity: addVectors(body.state.linearVelocity, command.impulse),
      sleeping: command.wake === "preserve" ? body.state.sleeping : false
    };
    if (command.point !== undefined) {
      body.state = applyPointAngularImpulse(body.state, command.point, command.impulse, dimension);
    }
    return bodyCommandResult(command, "applied");
  }
  const angularImpulse = readAngularImpulse(command.impulse, dimension);
  if (angularImpulse === undefined) {
    return bodyCommandResult(command, "invalid-command", "Angular impulse dimension is invalid");
  }
  body.state = {
    ...body.state,
    angularVelocity: addAngularVelocity(body.state.angularVelocity, angularImpulse, dimension),
    sleeping: command.wake === "preserve" ? body.state.sleeping : false
  };
  return bodyCommandResult(command, "applied");
}

function applyPointAngularImpulse(
  state: PhysicsBodyState,
  point: PhysicsVector,
  impulse: PhysicsVector,
  dimension: "2d" | "3d"
): PhysicsBodyState {
  const offset = {
    x: point.x - state.position.x,
    y: point.y - state.position.y,
    z: (point.z ?? 0) - (state.position.z ?? 0)
  };
  if (dimension === "2d") {
    const torque = offset.x * impulse.y - offset.y * impulse.x;
    const current = typeof state.angularVelocity === "number" ? state.angularVelocity : 0;
    return { ...state, angularVelocity: current + torque };
  }
  const torque = {
    x: offset.y * (impulse.z ?? 0) - offset.z * impulse.y,
    y: offset.z * impulse.x - offset.x * (impulse.z ?? 0),
    z: offset.x * impulse.y - offset.y * impulse.x
  };
  return {
    ...state,
    angularVelocity: addAngularVelocity(state.angularVelocity, torque, dimension)
  };
}

function addAngularVelocity(
  current: PhysicsRotation | undefined,
  impulse: number | PhysicsVector,
  dimension: "2d" | "3d"
): PhysicsRotation {
  if (dimension === "2d") {
    return (
      (typeof current === "number" ? current : 0) + (typeof impulse === "number" ? impulse : 0)
    );
  }
  const currentVector = isPhysicsVector(current) ? current : { x: 0, y: 0, z: 0 };
  const impulseVector = typeof impulse === "number" ? { x: 0, y: 0, z: impulse } : impulse;
  return addVectors(currentVector, impulseVector);
}

function readAngularImpulse(
  impulse: PhysicsRotation,
  dimension: "2d" | "3d"
): number | PhysicsVector | undefined {
  if (dimension === "2d") {
    return typeof impulse === "number" && Number.isFinite(impulse) ? impulse : undefined;
  }
  return isPhysicsVector(impulse) && impulse.z !== undefined ? cloneVector(impulse) : undefined;
}

function validVectorForDimension(vector: PhysicsVector, dimension: "2d" | "3d"): boolean {
  if (
    !Number.isFinite(vector.x) ||
    !Number.isFinite(vector.y) ||
    (vector.z !== undefined && !Number.isFinite(vector.z))
  ) {
    return false;
  }
  return dimension === "3d" || vector.z === undefined || vector.z === 0;
}

function isPhysicsVector(value: PhysicsRotation | undefined): value is PhysicsVector {
  return (
    typeof value === "object" &&
    value !== null &&
    !("w" in value) &&
    Number.isFinite(value.x) &&
    Number.isFinite(value.y) &&
    (value.z === undefined || Number.isFinite(value.z))
  );
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

function createColliderState(
  id: PhysicsColliderId,
  definition: PhysicsColliderDefinition
): PhysicsColliderState {
  return {
    id,
    shape: cloneShape(definition.shape),
    sensor: definition.sensor ?? false,
    enabled: true,
    ...(definition.bodyId === undefined ? {} : { bodyId: definition.bodyId }),
    ...(definition.material === undefined ? {} : { material: definition.material }),
    ...(definition.filter === undefined ? {} : { filter: cloneFilter(definition.filter) }),
    ...(definition.offset === undefined ? {} : { offset: cloneOffset(definition.offset) }),
    ...(definition.userData === undefined ? {} : { userData: { ...definition.userData } })
  };
}

function patchColliderState(
  state: PhysicsColliderState,
  patch: PhysicsColliderPatch
): PhysicsColliderState {
  return {
    ...state,
    ...(patch.enabled === undefined ? {} : { enabled: patch.enabled }),
    ...(patch.sensor === undefined ? {} : { sensor: patch.sensor }),
    ...(patch.filter === undefined ? {} : { filter: cloneFilter(patch.filter) }),
    ...(patch.offset === undefined ? {} : { offset: cloneOffset(patch.offset) }),
    ...(patch.userData === undefined ? {} : { userData: { ...patch.userData } })
  };
}

function collectOverlappingPairs(
  colliders: Map<PhysicsColliderId, MemoryColliderRecord>,
  bodies: Map<PhysicsBodyId, MemoryBodyRecord>
): Array<{ key: string; colliderA: PhysicsColliderId; colliderB: PhysicsColliderId }> {
  const records = [...colliders.values()].filter((collider) => collider.state.enabled);
  const pairs: Array<{ key: string; colliderA: PhysicsColliderId; colliderB: PhysicsColliderId }> =
    [];

  for (let index = 0; index < records.length; index += 1) {
    const colliderA = records[index];
    if (!colliderA) {
      continue;
    }
    for (let next = index + 1; next < records.length; next += 1) {
      const colliderB = records[next];
      if (!colliderB) {
        continue;
      }
      if (!canCollide(colliderA.state, colliderB.state)) {
        continue;
      }
      if (
        !boundsOverlap(
          colliderBounds(colliderA.state, bodies),
          colliderBounds(colliderB.state, bodies)
        )
      ) {
        continue;
      }

      const ids = [colliderA.state.id, colliderB.state.id].sort();
      const first = ids[0];
      const second = ids[1];
      if (first && second) {
        pairs.push({ key: `${first}|${second}`, colliderA: first, colliderB: second });
      }
    }
  }

  return pairs;
}

function filterActivePairs(
  activePairs: Set<string>,
  colliders: Map<PhysicsColliderId, MemoryColliderRecord>
): Set<string> {
  return new Set(
    [...activePairs].filter((pair) => {
      const [colliderA, colliderB] = pair.split("|");
      return (
        colliderA !== undefined &&
        colliderB !== undefined &&
        colliders.has(colliderA) &&
        colliders.has(colliderB)
      );
    })
  );
}

function queryScene(
  query: PhysicsQuery,
  colliders: Map<PhysicsColliderId, MemoryColliderRecord>,
  bodies: Map<PhysicsBodyId, MemoryBodyRecord>
): PhysicsQueryResult[] {
  const options = resolveQueryOptions(query);
  const results: PhysicsQueryResult[] = [];

  for (const collider of colliders.values()) {
    if (!canQueryCollider(collider.state, options)) {
      continue;
    }

    const bounds = colliderBounds(collider.state, bodies);
    const result = queryCollider(query, options, collider.state, bounds);
    if (!result) {
      continue;
    }
    results.push(result);

    if ((options.mode === "any" || query.type === "check") && results.length > 0) {
      break;
    }
  }

  return finalizeQueryResults(results, options);
}

function colliderBounds(
  collider: PhysicsColliderState,
  bodies: Map<PhysicsBodyId, MemoryBodyRecord>
): Bounds {
  const bodyPosition =
    collider.bodyId === undefined
      ? { x: 0, y: 0, z: 0 }
      : bodies.get(collider.bodyId)?.state.position;
  const offset = collider.offset?.position;
  return boundsForShape(
    collider.shape,
    addVectors(bodyPosition ?? { x: 0, y: 0, z: 0 }, offset ?? { x: 0, y: 0, z: 0 })
  );
}

function boundsForShape(shape: PhysicsShapeDefinition, position: PhysicsVector): Bounds {
  switch (shape.type) {
    case "circle":
    case "sphere":
      return {
        minX: position.x - shape.radius,
        maxX: position.x + shape.radius,
        minY: position.y - shape.radius,
        maxY: position.y + shape.radius,
        minZ: (position.z ?? 0) - shape.radius,
        maxZ: (position.z ?? 0) + shape.radius
      };
    case "box":
      return {
        minX: position.x - shape.width / 2,
        maxX: position.x + shape.width / 2,
        minY: position.y - shape.height / 2,
        maxY: position.y + shape.height / 2,
        minZ: (position.z ?? 0) - (shape.depth ?? 0) / 2,
        maxZ: (position.z ?? 0) + (shape.depth ?? 0) / 2
      };
    case "capsule":
      return {
        minX: position.x - shape.radius,
        maxX: position.x + shape.radius,
        minY: position.y - shape.height / 2 - shape.radius,
        maxY: position.y + shape.height / 2 + shape.radius,
        minZ: (position.z ?? 0) - shape.radius,
        maxZ: (position.z ?? 0) + shape.radius
      };
    case "polygon":
    case "polyline":
      return pointsBounds(shape.points, position);
    case "mesh":
    case "custom":
      return {
        minX: position.x,
        maxX: position.x,
        minY: position.y,
        maxY: position.y,
        minZ: position.z ?? 0,
        maxZ: position.z ?? 0
      };
  }
}

function pointsBounds(points: PhysicsVector[], position: PhysicsVector): Bounds {
  if (points.length === 0) {
    return {
      minX: position.x,
      maxX: position.x,
      minY: position.y,
      maxY: position.y,
      minZ: position.z ?? 0,
      maxZ: position.z ?? 0
    };
  }

  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let minZ = Number.POSITIVE_INFINITY;
  let maxZ = Number.NEGATIVE_INFINITY;
  for (const point of points) {
    minX = Math.min(minX, position.x + point.x);
    maxX = Math.max(maxX, position.x + point.x);
    minY = Math.min(minY, position.y + point.y);
    maxY = Math.max(maxY, position.y + point.y);
    minZ = Math.min(minZ, (position.z ?? 0) + (point.z ?? 0));
    maxZ = Math.max(maxZ, (position.z ?? 0) + (point.z ?? 0));
  }

  return { minX, maxX, minY, maxY, minZ, maxZ };
}

function boundsOverlap(a: Bounds, b: Bounds): boolean {
  return (
    a.minX <= b.maxX &&
    a.maxX >= b.minX &&
    a.minY <= b.maxY &&
    a.maxY >= b.minY &&
    a.minZ <= b.maxZ &&
    a.maxZ >= b.minZ
  );
}

function pointInBounds(point: PhysicsVector, bounds: Bounds): boolean {
  return (
    point.x >= bounds.minX &&
    point.x <= bounds.maxX &&
    point.y >= bounds.minY &&
    point.y <= bounds.maxY &&
    (point.z ?? 0) >= bounds.minZ &&
    (point.z ?? 0) <= bounds.maxZ
  );
}

function queryCollider(
  query: PhysicsQuery,
  options: PhysicsQueryOptions,
  collider: PhysicsColliderState,
  colliderBoundsValue: Bounds
): PhysicsQueryResult | undefined {
  const base = createQueryResult(collider);

  if (query.type === "point") {
    if (!pointInBounds(query.point, colliderBoundsValue)) {
      return undefined;
    }
    return { ...base, point: cloneVector(query.point), distance: 0, inside: true };
  }

  if (query.type === "raycast") {
    const hit = intersectRayWithBounds(
      query.origin,
      query.direction,
      query.maxDistance ?? Number.POSITIVE_INFINITY,
      colliderBoundsValue
    );
    if (!hit) {
      return undefined;
    }
    return {
      ...base,
      point: hit.point,
      normal: hit.normal,
      distance: hit.distance,
      ...(query.maxDistance === undefined || !Number.isFinite(query.maxDistance)
        ? {}
        : { fraction: hit.distance / query.maxDistance }),
      inside: hit.inside
    };
  }

  if (query.type === "bounds") {
    if (!boundsOverlap(normalizeBounds(query.bounds), colliderBoundsValue)) {
      return undefined;
    }
    return { ...base, distance: 0 };
  }

  if (query.type === "shape-cast") {
    const shapeBounds = boundsForShape(query.shape, query.position ?? { x: 0, y: 0, z: 0 });
    const hit = sweepBounds(
      shapeBounds,
      query.direction,
      query.maxDistance ?? Number.POSITIVE_INFINITY,
      colliderBoundsValue
    );
    if (!hit) {
      return undefined;
    }
    return {
      ...base,
      point: hit.point,
      normal: hit.normal,
      distance: hit.distance,
      ...(query.maxDistance === undefined || !Number.isFinite(query.maxDistance)
        ? {}
        : { fraction: hit.distance / query.maxDistance }),
      inside: hit.inside
    };
  }

  const shapeBounds = boundsForShape(query.shape, query.position ?? { x: 0, y: 0, z: 0 });
  if (!boundsOverlap(shapeBounds, colliderBoundsValue)) {
    return undefined;
  }
  return { ...base, distance: 0, inside: true };
}

function createQueryResult(collider: PhysicsColliderState): PhysicsQueryResult {
  return {
    colliderId: collider.id,
    ...(collider.bodyId === undefined ? {} : { bodyId: collider.bodyId }),
    sensor: collider.sensor
  };
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

function canQueryCollider(collider: PhysicsColliderState, options: PhysicsQueryOptions): boolean {
  if (!collider.enabled) {
    return false;
  }
  if (options.ignoreColliders?.includes(collider.id)) {
    return false;
  }
  if (collider.bodyId !== undefined && options.ignoreBodies?.includes(collider.bodyId)) {
    return false;
  }
  if (options.includeColliders !== undefined && !options.includeColliders.includes(collider.id)) {
    return false;
  }
  if (
    options.includeBodies !== undefined &&
    (collider.bodyId === undefined || !options.includeBodies.includes(collider.bodyId))
  ) {
    return false;
  }

  const triggerInteraction = options.triggerInteraction ?? "use-scene";
  if (triggerInteraction === "exclude" && collider.sensor) {
    return false;
  }
  if (triggerInteraction === "only" && !collider.sensor) {
    return false;
  }

  return filtersCompatible(options.filter, collider.filter);
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

function normalizeBounds(bounds: { min: PhysicsVector; max: PhysicsVector }): Bounds {
  return {
    minX: Math.min(bounds.min.x, bounds.max.x),
    maxX: Math.max(bounds.min.x, bounds.max.x),
    minY: Math.min(bounds.min.y, bounds.max.y),
    maxY: Math.max(bounds.min.y, bounds.max.y),
    minZ: Math.min(bounds.min.z ?? 0, bounds.max.z ?? 0),
    maxZ: Math.max(bounds.min.z ?? 0, bounds.max.z ?? 0)
  };
}

function sweepBounds(
  movingBounds: Bounds,
  direction: PhysicsVector,
  maxDistance: number,
  targetBounds: Bounds
): RayHit | undefined {
  if (boundsOverlap(movingBounds, targetBounds)) {
    return {
      distance: 0,
      point: boundsCenter(movingBounds),
      normal: { x: 0, y: 0, z: 0 },
      inside: true
    };
  }

  const half = boundsHalfExtents(movingBounds);
  const expanded = expandBounds(targetBounds, half);
  return intersectRayWithBounds(boundsCenter(movingBounds), direction, maxDistance, expanded);
}

function intersectRayWithBounds(
  origin: PhysicsVector,
  direction: PhysicsVector,
  maxDistance: number,
  bounds: Bounds
): RayHit | undefined {
  const normalized = normalizeVector(direction);
  if (!normalized) {
    return undefined;
  }

  let tMin = 0;
  let tMax = maxDistance;
  let normal: PhysicsVector = { x: 0, y: 0, z: 0 };

  const axes = [
    ["x", origin.x, normalized.x, bounds.minX, bounds.maxX] as const,
    ["y", origin.y, normalized.y, bounds.minY, bounds.maxY] as const,
    ["z", origin.z ?? 0, normalized.z ?? 0, bounds.minZ, bounds.maxZ] as const
  ];

  for (const [axis, axisOrigin, axisDirection, min, max] of axes) {
    if (Math.abs(axisDirection) < 1e-9) {
      if (axisOrigin < min || axisOrigin > max) {
        return undefined;
      }
      continue;
    }

    const inverse = 1 / axisDirection;
    let near = (min - axisOrigin) * inverse;
    let far = (max - axisOrigin) * inverse;
    let axisNormal = axisDirection > 0 ? -1 : 1;
    if (near > far) {
      [near, far] = [far, near];
      axisNormal *= -1;
    }

    if (near > tMin) {
      tMin = near;
      normal =
        axis === "x"
          ? { x: axisNormal, y: 0, z: 0 }
          : axis === "y"
            ? { x: 0, y: axisNormal, z: 0 }
            : { x: 0, y: 0, z: axisNormal };
    }
    tMax = Math.min(tMax, far);
    if (tMin > tMax) {
      return undefined;
    }
  }

  if (tMax < 0 || tMin > maxDistance) {
    return undefined;
  }

  const distance = Math.max(0, tMin);
  return {
    distance,
    point: addVectors(origin, scaleVector(normalized, distance)),
    normal,
    inside: tMin === 0 && pointInBounds(origin, bounds)
  };
}

function normalizeVector(vector: PhysicsVector): PhysicsVector | undefined {
  const z = vector.z ?? 0;
  const length = Math.hypot(vector.x, vector.y, z);
  if (!Number.isFinite(length) || length <= 1e-9) {
    return undefined;
  }

  return {
    x: vector.x / length,
    y: vector.y / length,
    ...(vector.z === undefined ? {} : { z: z / length })
  };
}

function boundsCenter(bounds: Bounds): PhysicsVector {
  return {
    x: (bounds.minX + bounds.maxX) / 2,
    y: (bounds.minY + bounds.maxY) / 2,
    z: (bounds.minZ + bounds.maxZ) / 2
  };
}

function boundsHalfExtents(bounds: Bounds): PhysicsVector {
  return {
    x: (bounds.maxX - bounds.minX) / 2,
    y: (bounds.maxY - bounds.minY) / 2,
    z: (bounds.maxZ - bounds.minZ) / 2
  };
}

function expandBounds(bounds: Bounds, amount: PhysicsVector): Bounds {
  return {
    minX: bounds.minX - amount.x,
    maxX: bounds.maxX + amount.x,
    minY: bounds.minY - amount.y,
    maxY: bounds.maxY + amount.y,
    minZ: bounds.minZ - (amount.z ?? 0),
    maxZ: bounds.maxZ + (amount.z ?? 0)
  };
}

function canCollide(a: PhysicsColliderState, b: PhysicsColliderState): boolean {
  return filtersCompatible(a.filter, b.filter);
}

function filtersCompatible(
  filterA: PhysicsColliderState["filter"] | undefined,
  filterB: PhysicsColliderState["filter"] | undefined
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
  filterA: PhysicsColliderState["filter"] | undefined,
  filterB: PhysicsColliderState["filter"] | undefined
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

function addVectors(a: PhysicsVector, b: PhysicsVector): PhysicsVector {
  return {
    x: a.x + b.x,
    y: a.y + b.y,
    ...((a.z ?? b.z) === undefined ? {} : { z: (a.z ?? 0) + (b.z ?? 0) })
  };
}

function scaleVector(vector: PhysicsVector, scalar: number): PhysicsVector {
  return {
    x: vector.x * scalar,
    y: vector.y * scalar,
    ...(vector.z === undefined ? {} : { z: vector.z * scalar })
  };
}

function cloneBodyState(state: PhysicsBodyState): PhysicsBodyState {
  return {
    ...state,
    position: cloneVector(state.position),
    linearVelocity: cloneVector(state.linearVelocity),
    ...(state.rotation === undefined ? {} : { rotation: cloneRotation(state.rotation) }),
    ...(state.angularVelocity === undefined
      ? {}
      : { angularVelocity: cloneRotation(state.angularVelocity) }),
    ...(state.userData === undefined ? {} : { userData: { ...state.userData } })
  };
}

function cloneColliderState(state: PhysicsColliderState): PhysicsColliderState {
  return {
    ...state,
    shape: cloneShape(state.shape),
    ...(state.filter === undefined ? {} : { filter: cloneFilter(state.filter) }),
    ...(state.offset === undefined ? {} : { offset: cloneOffset(state.offset) }),
    ...(state.userData === undefined ? {} : { userData: { ...state.userData } })
  };
}

function cloneVector(vector: PhysicsVector): PhysicsVector {
  return {
    x: vector.x,
    y: vector.y,
    ...(vector.z === undefined ? {} : { z: vector.z })
  };
}

function cloneRotation(rotation: PhysicsRotation): PhysicsRotation {
  if (typeof rotation === "number") {
    return rotation;
  }
  if ("w" in rotation) {
    return { x: rotation.x, y: rotation.y, z: rotation.z, w: rotation.w };
  }
  return cloneVector(rotation);
}

function cloneOffset(offset: NonNullable<PhysicsColliderState["offset"]>) {
  return {
    ...(offset.position === undefined ? {} : { position: cloneVector(offset.position) }),
    ...(offset.rotation === undefined ? {} : { rotation: cloneRotation(offset.rotation) })
  };
}

function cloneShape(shape: PhysicsShapeDefinition): PhysicsShapeDefinition {
  switch (shape.type) {
    case "polygon":
    case "polyline":
      return { ...shape, points: shape.points.map(cloneVector) };
    case "custom":
      return { ...shape, props: { ...shape.props } };
    default:
      return { ...shape };
  }
}

function cloneFilter(filter: NonNullable<PhysicsColliderState["filter"]>) {
  return {
    ...(filter.groups === undefined ? {} : { groups: [...filter.groups] }),
    ...(filter.collidesWith === undefined ? {} : { collidesWith: [...filter.collidesWith] }),
    ...(filter.categoryBits === undefined ? {} : { categoryBits: filter.categoryBits }),
    ...(filter.maskBits === undefined ? {} : { maskBits: filter.maskBits })
  };
}
