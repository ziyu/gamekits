import type { DataRef } from "@gamekits/data";
import type { EntityId } from "@gamekits/world";

export type PhysicsSceneId = string;
export type PhysicsBodyId = string;
export type PhysicsColliderId = string;
export type PhysicsMaterialId = string;
export type PhysicsDimension = "2d" | "3d";

export type PhysicsVector = {
  x: number;
  y: number;
  z?: number;
};

export type PhysicsQuaternion = {
  x: number;
  y: number;
  z: number;
  w: number;
};

export type PhysicsRotation = number | PhysicsVector | PhysicsQuaternion;
export type PhysicsBodyKind = "static" | "dynamic" | "kinematic";

export type PhysicsCollisionFilter = {
  groups?: string[];
  collidesWith?: string[];
  categoryBits?: number;
  maskBits?: number;
};

export type PhysicsBodyDefinition = {
  id?: PhysicsBodyId;
  kind: PhysicsBodyKind;
  position?: PhysicsVector;
  rotation?: PhysicsRotation;
  linearVelocity?: PhysicsVector;
  angularVelocity?: PhysicsRotation;
  gravityScale?: number;
  damping?: {
    linear?: number;
    angular?: number;
  };
  continuousCollisionDetection?: boolean;
  lockedAxes?: string[];
  userData?: Record<string, unknown>;
};

export type PhysicsBodyPatch = {
  position?: PhysicsVector;
  rotation?: PhysicsRotation;
  linearVelocity?: PhysicsVector;
  angularVelocity?: PhysicsRotation;
  gravityScale?: number;
  sleeping?: boolean;
  userData?: Record<string, unknown>;
};

export type PhysicsBodyUpdateOptions = {
  /**
   * Kinematic bodies normally interpret position and rotation as the target of
   * the next simulation step so they can impart solver velocity. Rollback and
   * authoritative correction can explicitly install an already-simulated pose.
   */
  kinematicTransformMode?: "target" | "teleport";
};

export type PhysicsBodyCommandWakePolicy = "wake" | "preserve";

export type PhysicsLinearImpulseCommandPayload = {
  type: "linear-impulse";
  impulse: PhysicsVector;
  point?: PhysicsVector | undefined;
  wake?: PhysicsBodyCommandWakePolicy | undefined;
};

export type PhysicsAngularImpulseCommandPayload = {
  type: "angular-impulse";
  impulse: PhysicsRotation;
  wake?: PhysicsBodyCommandWakePolicy | undefined;
};

export type PhysicsBodyCommandPayload =
  | PhysicsLinearImpulseCommandPayload
  | PhysicsAngularImpulseCommandPayload;

export type PhysicsBodyCommand = PhysicsBodyCommandPayload & {
  bodyId: PhysicsBodyId;
};

export type PhysicsBodyCommandEnvelope = {
  tick: number;
  sequence: number;
  correlationId?: string | undefined;
  command: PhysicsBodyCommand;
};

export type PhysicsBodyCommandResult = {
  status: "applied" | "body-missing" | "invalid-command" | "unsupported" | "body-kind-mismatch";
  bodyId: PhysicsBodyId;
  commandType: PhysicsBodyCommand["type"];
  reason?: string | undefined;
};

export type PhysicsShapeDefinition =
  | { type: "circle"; radius: number }
  | { type: "box"; width: number; height: number; depth?: number }
  | { type: "capsule"; radius: number; height: number }
  | { type: "sphere"; radius: number }
  | { type: "polygon"; points: PhysicsVector[] }
  | { type: "polyline"; points: PhysicsVector[] }
  | { type: "mesh"; assetId: string; convex?: boolean }
  | { type: "custom"; backend: string; props: Record<string, unknown> };

export type PhysicsMaterialDefinition = {
  id: PhysicsMaterialId;
  friction?: number;
  restitution?: number;
  density?: number;
  combine?: {
    friction?: "min" | "max" | "multiply" | "average";
    restitution?: "min" | "max" | "multiply" | "average";
  };
};

export type PhysicsColliderDefinition = {
  id?: PhysicsColliderId;
  bodyId?: PhysicsBodyId;
  shape: PhysicsShapeDefinition;
  material?: PhysicsMaterialId;
  sensor?: boolean;
  filter?: PhysicsCollisionFilter;
  offset?: {
    position?: PhysicsVector;
    rotation?: PhysicsRotation;
  };
  userData?: Record<string, unknown>;
};

export type PhysicsColliderPatch = {
  enabled?: boolean;
  sensor?: boolean;
  filter?: PhysicsCollisionFilter;
  offset?: {
    position?: PhysicsVector;
    rotation?: PhysicsRotation;
  };
  userData?: Record<string, unknown>;
};

export type PhysicsSceneConfig = {
  id?: PhysicsSceneId;
  dimension?: PhysicsDimension;
  gravity?: PhysicsVector;
  fixedDeltaMs?: number;
  materialDefinitions?: readonly PhysicsMaterialDefinition[];
};

export type PhysicsSceneCheckpoint = {
  backend: string;
  sceneId: PhysicsSceneId;
  byteLength: number;
  payload: unknown;
};

export type PhysicsCheckpointCapability = {
  captureRestore: boolean;
  fullScene: boolean;
  deterministicReplay: boolean;
};

export type PhysicsBackendCapabilities = {
  dimension: PhysicsDimension;
  bodies: boolean;
  colliders: boolean;
  sensors: boolean;
  queries: Array<PhysicsQuery["type"]>;
  deterministic?: boolean;
  checkpoints?: PhysicsCheckpointCapability;
  bodyCommands?: {
    linearImpulse: boolean;
    applicationPoint: boolean;
    angularImpulse: boolean;
    wakePolicy: boolean;
  };
  custom?: Record<string, boolean | string | number>;
};

export type PhysicsBackendAdapter<TNative = unknown> = {
  id: string;
  kind: string;
  dimension: PhysicsDimension;
  createScene(config?: PhysicsSceneConfig): PhysicsScene<TNative>;
  capabilities(): PhysicsBackendCapabilities;
};

export type PhysicsBodyState = {
  id: PhysicsBodyId;
  kind: PhysicsBodyKind;
  position: PhysicsVector;
  linearVelocity: PhysicsVector;
  sleeping: boolean;
  rotation?: PhysicsRotation;
  angularVelocity?: PhysicsRotation;
  userData?: Record<string, unknown>;
};

export type PhysicsInterpolationTransform = {
  position: PhysicsVector;
  rotation?: PhysicsRotation;
};

export type ReadonlyPhysicsRotation =
  | number
  | Readonly<PhysicsVector>
  | Readonly<PhysicsQuaternion>;

export type ReadonlyPhysicsInterpolationTransform = {
  readonly position: Readonly<PhysicsVector>;
  readonly rotation?: ReadonlyPhysicsRotation;
};

export type PhysicsTransformInterpolator = (
  previous: ReadonlyPhysicsInterpolationTransform,
  current: ReadonlyPhysicsInterpolationTransform,
  alpha: number,
  target?: PhysicsInterpolationTransform
) => PhysicsInterpolationTransform;

export type PhysicsInterpolationResetPredicate = (
  bodyId: PhysicsBodyId,
  previous: ReadonlyPhysicsInterpolationTransform,
  current: ReadonlyPhysicsInterpolationTransform
) => boolean;

export type PhysicsInterpolationPolicy = {
  interpolate?: PhysicsTransformInterpolator;
  shouldResetHistory?: PhysicsInterpolationResetPredicate;
};

export type PhysicsInterpolationSnapshot = {
  alpha: number;
  fixedDeltaMs: number;
  trackedBodyCount: number;
};

export type PhysicsInterpolationStore = {
  sample(
    bodyId: PhysicsBodyId,
    target?: PhysicsInterpolationTransform
  ): PhysicsInterpolationTransform | undefined;
  snapshot(): PhysicsInterpolationSnapshot;
  isBound(): boolean;
};

export type PhysicsColliderState = {
  id: PhysicsColliderId;
  bodyId?: PhysicsBodyId;
  shape: PhysicsShapeDefinition;
  sensor: boolean;
  enabled: boolean;
  material?: PhysicsMaterialId;
  filter?: PhysicsCollisionFilter;
  offset?: {
    position?: PhysicsVector;
    rotation?: PhysicsRotation;
  };
  userData?: Record<string, unknown>;
};

export type PhysicsContactPhase = "enter" | "exit";
export type PhysicsContactKind = "contact" | "trigger";

export type PhysicsContactEvent = {
  phase: PhysicsContactPhase;
  kind: PhysicsContactKind;
  colliderA: PhysicsColliderId;
  colliderB: PhysicsColliderId;
  bodyA?: PhysicsBodyId;
  bodyB?: PhysicsBodyId;
  entityA?: EntityId;
  entityB?: EntityId;
  sensor: boolean;
};

export type PhysicsDiagnostic = {
  code: string;
  message: string;
  severity: "info" | "warning" | "error";
  bodyId?: PhysicsBodyId;
  colliderId?: PhysicsColliderId;
  details?: Record<string, unknown>;
};

export type PhysicsStepOptions = {
  tick?: number;
  elapsed?: number;
};

export type PhysicsStepResult = {
  deltaMs: number;
  contacts: PhysicsContactEvent[];
  diagnostics: PhysicsDiagnostic[];
};

export type PhysicsQuery =
  | PhysicsPointQuery
  | PhysicsRaycastQuery
  | PhysicsShapeCastQuery
  | PhysicsOverlapQuery
  | PhysicsCheckQuery
  | PhysicsBoundsQuery;

export type PhysicsQueryTriggerInteraction = "use-scene" | "include" | "exclude" | "only";
export type PhysicsQueryMode = "any" | "closest" | "all";
export type PhysicsQuerySort = "none" | "distance";

export type PhysicsQueryOptions = {
  filter?: PhysicsCollisionFilter;
  triggerInteraction?: PhysicsQueryTriggerInteraction;
  mode?: PhysicsQueryMode;
  sort?: PhysicsQuerySort;
  maxResults?: number;
  ignoreBodies?: PhysicsBodyId[];
  ignoreColliders?: PhysicsColliderId[];
  includeBodies?: PhysicsBodyId[];
  includeColliders?: PhysicsColliderId[];
};

export type PhysicsLegacyQueryOptions = {
  filter?: PhysicsCollisionFilter;
  includeSensors?: boolean;
  options?: PhysicsQueryOptions;
};

export type PhysicsPointQuery = PhysicsLegacyQueryOptions & {
  type: "point";
  point: PhysicsVector;
  solid?: boolean;
};

export type PhysicsRaycastQuery = PhysicsLegacyQueryOptions & {
  type: "raycast";
  origin: PhysicsVector;
  direction: PhysicsVector;
  maxDistance?: number;
  solid?: boolean;
};

export type PhysicsShapeCastQuery = PhysicsLegacyQueryOptions & {
  type: "shape-cast";
  shape: PhysicsShapeDefinition;
  position?: PhysicsVector;
  rotation?: PhysicsRotation;
  direction: PhysicsVector;
  maxDistance?: number;
  targetDistance?: number;
  stopAtPenetration?: boolean;
};

export type PhysicsOverlapQuery = PhysicsLegacyQueryOptions & {
  type: "overlap";
  shape: PhysicsShapeDefinition;
  position?: PhysicsVector;
  rotation?: PhysicsRotation;
};

export type PhysicsCheckQuery = PhysicsLegacyQueryOptions & {
  type: "check";
  shape: PhysicsShapeDefinition;
  position?: PhysicsVector;
  rotation?: PhysicsRotation;
};

export type PhysicsBounds = {
  min: PhysicsVector;
  max: PhysicsVector;
};

export type PhysicsBoundsQuery = PhysicsLegacyQueryOptions & {
  type: "bounds";
  bounds: PhysicsBounds;
};

export type PhysicsQueryResult = {
  colliderId: PhysicsColliderId;
  bodyId?: PhysicsBodyId;
  point?: PhysicsVector;
  normal?: PhysicsVector;
  distance?: number;
  fraction?: number;
  inside?: boolean;
  sensor?: boolean;
  entityId?: EntityId;
};

export type PhysicsSceneSnapshot = {
  id: PhysicsSceneId;
  backend: string;
  dimension: PhysicsDimension;
  gravity: PhysicsVector;
  bodyCount: number;
  colliderCount: number;
  activeContactCount: number;
  disposed: boolean;
};

export type PhysicsScene<TNative = unknown> = {
  readonly id: PhysicsSceneId;
  createBody(definition: PhysicsBodyDefinition): PhysicsBodyId;
  updateBody(id: PhysicsBodyId, patch: PhysicsBodyPatch, options?: PhysicsBodyUpdateOptions): void;
  applyBodyCommand?(command: PhysicsBodyCommand): PhysicsBodyCommandResult;
  destroyBody(id: PhysicsBodyId): void;
  createCollider(definition: PhysicsColliderDefinition): PhysicsColliderId;
  updateCollider(id: PhysicsColliderId, patch: PhysicsColliderPatch): void;
  destroyCollider(id: PhysicsColliderId): void;
  step(deltaMs: number, options?: PhysicsStepOptions): PhysicsStepResult;
  getBodyState(id: PhysicsBodyId): PhysicsBodyState | undefined;
  getColliderState(id: PhysicsColliderId): PhysicsColliderState | undefined;
  query(query: PhysicsQuery): PhysicsQueryResult[];
  snapshot(): PhysicsSceneSnapshot;
  captureCheckpoint?(): PhysicsSceneCheckpoint;
  restoreCheckpoint?(checkpoint: PhysicsSceneCheckpoint): void;
  native?(): TNative;
  dispose(): void;
};

export type PhysicsQueries = {
  query(query: PhysicsQuery): PhysicsQueryResult[];
  queryPoint(point: PhysicsVector, options?: PhysicsQueryOptions): PhysicsQueryResult[];
  raycast(
    origin: PhysicsVector,
    direction: PhysicsVector,
    options?: PhysicsQueryOptions & { maxDistance?: number; solid?: boolean }
  ): PhysicsQueryResult[];
  shapeCast(
    shape: PhysicsShapeDefinition,
    position: PhysicsVector,
    direction: PhysicsVector,
    options?: PhysicsQueryOptions & {
      maxDistance?: number;
      rotation?: PhysicsRotation;
      stopAtPenetration?: boolean;
      targetDistance?: number;
    }
  ): PhysicsQueryResult[];
  overlapShape(
    shape: PhysicsShapeDefinition,
    position: PhysicsVector,
    options?: PhysicsQueryOptions & { rotation?: PhysicsRotation }
  ): PhysicsQueryResult[];
  checkOverlap(
    shape: PhysicsShapeDefinition,
    position: PhysicsVector,
    options?: PhysicsQueryOptions & { rotation?: PhysicsRotation }
  ): boolean;
  checkCollision(colliderId: PhysicsColliderId, options?: PhysicsQueryOptions): boolean;
  queryBounds(bounds: PhysicsBounds, options?: PhysicsQueryOptions): PhysicsQueryResult[];
  snapshot(): PhysicsSceneSnapshot;
};

export type PhysicsHandle = PhysicsQueries & {
  captureCheckpoint(): PhysicsRuntimeCheckpoint;
  restoreCheckpoint(
    checkpoint: PhysicsRuntimeCheckpoint,
    options?: PhysicsCheckpointRestoreOptions
  ): void;
  isBound(): boolean;
};

export type PhysicsEntityCheckpoint = {
  entityId: EntityId;
  body?: {
    definition: PhysicsBodyDefinition;
    enabled: boolean;
    syncFromWorld: boolean;
    syncVelocityFromWorld: boolean;
    syncToWorld: boolean;
    state?: PhysicsCheckpointBodyState;
  };
  collider?: {
    definition: PhysicsColliderDefinition;
    enabled: boolean;
  };
  transform?: {
    position: PhysicsVector;
    rotation?: PhysicsRotation;
  };
  velocity?: {
    linear: PhysicsVector;
    angular?: PhysicsRotation;
  };
};

export type PhysicsCheckpointBodyState = Omit<PhysicsBodyState, "id">;

export type PhysicsRuntimeCheckpoint = {
  accumulator: number;
  entities: PhysicsEntityCheckpoint[];
};

export type PhysicsCheckpointRestoreOptions = {
  resolveEntityId?(savedEntityId: EntityId): EntityId | undefined;
};

export type PhysicsBodyData = PhysicsBodyDefinition & {
  colliders?: Array<DataRef<"physics.collider">>;
  tags?: string[];
};

export type PhysicsColliderData = PhysicsColliderDefinition & {
  tags?: string[];
};

export type PhysicsSceneData = PhysicsSceneConfig & {
  materials?: Array<DataRef<"physics.material">>;
};

export type PhysicsLayoutColliderInstanceData = {
  id: string;
  collider: DataRef<"physics.collider">;
  overrides?: Partial<Omit<PhysicsColliderDefinition, "id" | "bodyId">>;
  enabled?: boolean;
};

export type PhysicsLayoutBodyInstanceData = {
  id: string;
  body: DataRef<"physics.body">;
  position?: PhysicsVector;
  rotation?: PhysicsRotation;
  overrides?: Partial<Omit<PhysicsBodyDefinition, "id" | "position" | "rotation">>;
  colliders?: PhysicsLayoutColliderInstanceData[];
  enabled?: boolean;
};

export type PhysicsLayoutData = {
  id: string;
  scene?: DataRef<"physics.scene">;
  bounds?: PhysicsBounds;
  bodies: PhysicsLayoutBodyInstanceData[];
  tags?: string[];
};

export type PhysicsTraceKind = "step" | "contact" | "query" | "diagnostic";

export type PhysicsTraceEntry = {
  id: string;
  kind: PhysicsTraceKind;
  tick?: number;
  elapsed?: number;
  label: string;
  bodyId?: PhysicsBodyId;
  colliderId?: PhysicsColliderId;
  entityId?: EntityId;
  correlationId?: string;
  parentId?: string;
  payload?: Record<string, unknown>;
};

export type PhysicsTraceStore = {
  push(entry: Omit<PhysicsTraceEntry, "id">): PhysicsTraceEntry;
  list(): PhysicsTraceEntry[];
  clear(): void;
};
