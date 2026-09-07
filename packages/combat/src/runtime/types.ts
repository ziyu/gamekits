import type { DataRef, DataRegistry } from "@gamekits/data";
import type { EventBus } from "@gamekits/event-bus";
import type { GameInstallContext } from "@gamekits/game-runtime";
import type {
  GasAbilityExecutionState,
  GasActorRuntimeState,
  GasEffectApplicationResult,
  GasHandle
} from "@gamekits/gas";
import type {
  PhysicsBounds,
  PhysicsCollisionFilter,
  PhysicsQueries,
  PhysicsQueryResult,
  PhysicsQueryTriggerInteraction,
  PhysicsRotation,
  PhysicsShapeDefinition,
  PhysicsVector
} from "@gamekits/physics-core";
import type { EntityId, GameWorld } from "@gamekits/world";

export type CombatDeliveryId = string;
export type CombatProjectileId = string;
export type CombatHitTicketId = string;
export type CombatRelationship = string;

export type CombatOperationContext = {
  correlationId?: string | undefined;
  parentId?: string | undefined;
};

export type CombatPayloadSpec = {
  effectId: string;
  target: "hit-actor" | "source-actor";
};

export type CombatQueryOptions = {
  filter?: PhysicsCollisionFilter | undefined;
  triggerInteraction?: PhysicsQueryTriggerInteraction | undefined;
  ignoreBodies?: string[] | undefined;
  ignoreColliders?: string[] | undefined;
  includeBodies?: string[] | undefined;
  includeColliders?: string[] | undefined;
};

export type CombatTargetSelection = {
  mode?: "closest" | "all" | undefined;
  maxTargets?: number | undefined;
  stopOnBlocker?: boolean | undefined;
};

export type CombatDeliverySpec =
  | {
      type: "direct";
      targetActorId?: string | undefined;
    }
  | {
      type: "melee";
      shape: PhysicsShapeDefinition;
      position?: PhysicsVector | undefined;
      offset?: PhysicsVector | undefined;
      rotation?: PhysicsRotation | undefined;
      query?: CombatQueryOptions | undefined;
      selection?: CombatTargetSelection | undefined;
    }
  | {
      type: "hitscan";
      range: number;
      radius?: number | undefined;
      origin?: PhysicsVector | undefined;
      direction?: PhysicsVector | undefined;
      query?: CombatQueryOptions | undefined;
      selection?: CombatTargetSelection | undefined;
    }
  | {
      type: "area";
      shape: PhysicsShapeDefinition;
      position?: PhysicsVector | undefined;
      rotation?: PhysicsRotation | undefined;
      query?: CombatQueryOptions | undefined;
      selection?: CombatTargetSelection | undefined;
    }
  | {
      type: "projectile";
      projectile: DataRef<"combat.projectile">;
      position?: PhysicsVector | undefined;
      direction?: PhysicsVector | undefined;
    };

export type CombatDeliveryDefinition = {
  id: string;
  delivery: CombatDeliverySpec;
  payloads: CombatPayloadSpec[];
  relationshipPolicy: string;
  tags?: string[] | undefined;
};

export type CombatProjectileDefinition = {
  id: string;
  body: DataRef<"physics.body">;
  lifetimeMs: number;
  speed?: number | undefined;
  collisionMode: "contact" | "ray-sweep" | "shape-sweep";
  hitPolicy: "stop" | "pierce" | "bounce";
  maxHits?: number | undefined;
  maxBounces?: number | undefined;
  repeatHitCooldownMs?: number | undefined;
  query?: CombatQueryOptions | undefined;
  payloads: CombatPayloadSpec[];
  executionOwnership?: "independent" | "cancel-with-execution" | undefined;
  tags?: string[] | undefined;
};

export type CombatRelationshipPolicyDefinition = {
  id: string;
  tags?: string[] | undefined;
  metadata?: Record<string, unknown> | undefined;
};

export type CombatAbilityDeliveryDefinition = {
  id: string;
  ability: DataRef<"gas.ability">;
  delivery: DataRef<"combat.delivery">;
  phase?: "committed" | undefined;
  tags?: string[] | undefined;
};

export type CombatDeliveryRequest = CombatOperationContext & {
  id: CombatDeliveryId;
  sourceActorId: string;
  sourceEntityId?: EntityId | undefined;
  executionId?: string | undefined;
  definition?: DataRef<"combat.delivery"> | undefined;
  delivery?: CombatDeliverySpec | undefined;
  payloads?: CombatPayloadSpec[] | undefined;
  relationshipPolicy?: string | undefined;
  targetActorId?: string | undefined;
  origin?: PhysicsVector | undefined;
  position?: PhysicsVector | undefined;
  direction?: PhysicsVector | undefined;
  issuedAt?: number | undefined;
};

export type CombatSubject = {
  actorId?: string | undefined;
  entityId?: EntityId | undefined;
  bodyId?: string | undefined;
  colliderId?: string | undefined;
  position?: PhysicsVector | undefined;
  tags?: string[] | undefined;
  metadata?: Record<string, unknown> | undefined;
};

export type CombatSubjectResolver = {
  resolveActor(actorId: string, actor: GasActorRuntimeState): CombatSubject | undefined;
  resolveCandidate(
    candidate: PhysicsQueryResult,
    actor: GasActorRuntimeState | undefined
  ): CombatSubject | undefined;
};

export type CombatHitContext = {
  requestId: CombatDeliveryId;
  deliveryType: CombatDeliverySpec["type"];
  source: CombatSubject;
  target: CombatSubject;
  elapsed: number;
  relationship?: CombatRelationship | undefined;
  projectileId?: CombatProjectileId | undefined;
  ticketId?: CombatHitTicketId | undefined;
  candidate?: PhysicsQueryResult | undefined;
};

export type CombatRelationshipResolver = {
  resolve(source: CombatSubject, target: CombatSubject): CombatRelationship;
  allows(policyId: string, relationship: CombatRelationship, context: CombatHitContext): boolean;
};

export type CombatCandidateDecision = {
  disposition: "target" | "blocker" | "ignore";
  reason?: string | undefined;
};

export type CombatCandidatePolicy = {
  evaluate(context: CombatHitContext): CombatCandidateDecision;
};

export type CombatPayloadResult = {
  payload: CombatPayloadSpec;
  status: "applied" | "rejected";
  gas: GasEffectApplicationResult;
};

export type CombatHitResult = {
  ticketId: CombatHitTicketId;
  status: "applied" | "effect-rejected" | "duplicate";
  sourceActorId: string;
  targetActorId: string;
  targetEntityId?: EntityId | undefined;
  relationship: CombatRelationship;
  projectileId?: CombatProjectileId | undefined;
  point?: PhysicsVector | undefined;
  normal?: PhysicsVector | undefined;
  distance?: number | undefined;
  payloads: CombatPayloadResult[];
};

export type CombatBlockResult = {
  subject: CombatSubject;
  point?: PhysicsVector | undefined;
  normal?: PhysicsVector | undefined;
  distance?: number | undefined;
};

export type CombatDeliveryResult = {
  status: "resolved";
  duplicate: boolean;
  requestId: CombatDeliveryId;
  deliveryType: CombatDeliverySpec["type"];
  hits: CombatHitResult[];
  ignoredCandidates: number;
  queriedCandidates: number;
  projectile?: CombatProjectileState | undefined;
  blockedBy?: CombatBlockResult | undefined;
  correlationId?: string | undefined;
};

export type CombatDeliveryRejectionReason =
  | "invalid-request"
  | "duplicate-request-conflict"
  | "source-missing"
  | "source-entity-mismatch"
  | "target-missing"
  | "target-disallowed"
  | "definition-missing"
  | "definition-conflict"
  | "delivery-context-missing"
  | "projectile-limit"
  | "projectile-definition-invalid"
  | "runtime-limit";

export type CombatDeliveryRejection = {
  status: "rejected";
  requestId: CombatDeliveryId;
  reason: CombatDeliveryRejectionReason;
  message: string;
  correlationId?: string | undefined;
};

export type CombatDeliveryRequestResult = CombatDeliveryResult | CombatDeliveryRejection;

export type CombatProjectileHitMemoryEntry = {
  subjectKey: string;
  lastHitAt: number;
};

export type CombatProjectileState = {
  runtimeId: string;
  projectileId: CombatProjectileId;
  definitionId: string;
  entityId: EntityId;
  sourceActorId: string;
  sourceEntityId?: EntityId | undefined;
  sourceSubject: CombatSubject;
  executionId?: string | undefined;
  relationshipPolicy: string;
  payloads: CombatPayloadSpec[];
  collisionMode: CombatProjectileDefinition["collisionMode"];
  hitPolicy: CombatProjectileDefinition["hitPolicy"];
  spawnedAt: number;
  expiresAt: number;
  previousPosition: PhysicsVector;
  sweepShape?: PhysicsShapeDefinition | undefined;
  hitCount: number;
  bounceCount: number;
  maxHits: number;
  maxBounces: number;
  repeatHitCooldownMs?: number | undefined;
  hitMemory: CombatProjectileHitMemoryEntry[];
  query?: CombatQueryOptions | undefined;
  executionOwnership: "independent" | "cancel-with-execution";
  correlationId?: string | undefined;
  parentId?: string | undefined;
};

export type CombatProjectileImpactSubject = Pick<
  CombatSubject,
  "actorId" | "entityId" | "bodyId" | "colliderId"
>;

export type CombatProjectileImpactFact = {
  disposition: "target" | "blocker";
  subject: CombatProjectileImpactSubject;
  point?: PhysicsVector | undefined;
  normal?: PhysicsVector | undefined;
  distance?: number | undefined;
};

export type CombatProjectileSpawnFact = CombatOperationContext & {
  runtimeId: string;
  projectileId: CombatProjectileId;
  entityId: EntityId;
  definitionId: string;
  sourceActorId: string;
  sourceEntityId?: EntityId | undefined;
  executionId?: string | undefined;
  position: PhysicsVector;
  velocity: PhysicsVector;
  spawnedAt: number;
  expiresAt: number;
};

export type CombatProjectileDespawnFact = CombatOperationContext & {
  runtimeId: string;
  projectileId: CombatProjectileId;
  entityId: EntityId;
  reason: string;
  definitionId?: string | undefined;
  sourceActorId?: string | undefined;
  sourceEntityId?: EntityId | undefined;
  executionId?: string | undefined;
  finalPosition?: PhysicsVector | undefined;
  finalVelocity?: PhysicsVector | undefined;
  impact?: CombatProjectileImpactFact | undefined;
};

export type CombatProjectileQuery = {
  sourceActorId?: string | undefined;
  definitionId?: string | undefined;
};

export type CombatProjectileCancellation = CombatOperationContext & {
  projectileId: CombatProjectileId;
  reason?: string | undefined;
};

export type CombatProjectileCancellationResult =
  | { status: "cancelled"; projectileId: CombatProjectileId }
  | { status: "rejected"; projectileId: CombatProjectileId; reason: "missing-projectile" };

export type CombatProjectileCheckpoint = {
  entityId: EntityId;
  state: CombatProjectileState;
};

export type CombatRuntimeCheckpoint = {
  elapsed: number;
  projectiles: CombatProjectileCheckpoint[];
};

export type CombatCheckpointRestoreOptions = {
  resolveEntityId?(savedEntityId: EntityId): EntityId | undefined;
};

export type CombatTraceType =
  | "delivery.accepted"
  | "delivery.resolved"
  | "delivery.rejected"
  | "query.completed"
  | "candidate.rejected"
  | "hit.applied"
  | "hit.resolving"
  | "hit.rejected"
  | "hit.duplicate"
  | "projectile.spawned"
  | "projectile.hit"
  | "projectile.bounced"
  | "projectile.expired"
  | "projectile.despawned";

export type CombatTraceEntry = {
  id: string;
  type: CombatTraceType;
  timestamp: number;
  requestId?: CombatDeliveryId | undefined;
  projectileId?: CombatProjectileId | undefined;
  ticketId?: CombatHitTicketId | undefined;
  sourceActorId?: string | undefined;
  targetActorId?: string | undefined;
  targetEntityId?: EntityId | undefined;
  correlationId?: string | undefined;
  parentId?: string | undefined;
  message?: string | undefined;
  details?: Record<string, unknown> | undefined;
};

export type CombatTraceSnapshot = {
  entries: CombatTraceEntry[];
};

export type CombatTraceStore = {
  add(entry: Omit<CombatTraceEntry, "id">): CombatTraceEntry;
  list(): CombatTraceEntry[];
  clear(): void;
  snapshot(): CombatTraceSnapshot;
};

export type CombatRuntimeLimits = {
  maxCandidatesPerRequest?: number | undefined;
  maxTargetsPerRequest?: number | undefined;
  maxActiveProjectiles?: number | undefined;
  maxHitsPerProjectile?: number | undefined;
  maxBouncesPerProjectile?: number | undefined;
  maxHitMemoryPerProjectile?: number | undefined;
  maxProjectileLifetimeMs?: number | undefined;
  recentDeliveryLimit?: number | undefined;
  resolvedTicketLimit?: number | undefined;
};

export type CombatEventPolicy = {
  emitDeliveries?: boolean | undefined;
  emitHits?: boolean | undefined;
  emitProjectiles?: boolean | undefined;
};

export type CombatGasFacade = Pick<
  GasHandle,
  "hasActor" | "getActor" | "actorForEntity" | "getAbilityExecution" | "applyEffect"
>;

export type CombatRuntimeConfig = {
  id?: string | undefined;
  world: GameWorld;
  physics: PhysicsQueries;
  gas: CombatGasFacade;
  dataRegistry: DataRegistry;
  eventBus?: EventBus | undefined;
  relationshipResolver: CombatRelationshipResolver;
  subjectResolver?: CombatSubjectResolver | undefined;
  candidatePolicy?: CombatCandidatePolicy | undefined;
  traceStore?: CombatTraceStore | undefined;
  limits?: CombatRuntimeLimits | undefined;
  eventPolicy?: CombatEventPolicy | undefined;
  projectileBounds?: PhysicsBounds | undefined;
};

export type CombatRuntimeSnapshot = {
  elapsed: number;
  projectiles: CombatProjectileState[];
  recentDeliveries: CombatDeliveryRequestResult[];
  resolvedTicketCount: number;
  traces: CombatTraceEntry[];
  disposed: boolean;
};

export type CombatRuntime = {
  readonly traceStore: CombatTraceStore;
  deliver(request: CombatDeliveryRequest): CombatDeliveryRequestResult;
  getProjectile(projectileId: CombatProjectileId): CombatProjectileState | undefined;
  listProjectiles(query?: CombatProjectileQuery): CombatProjectileState[];
  cancelProjectile(input: CombatProjectileCancellation): CombatProjectileCancellationResult;
  update(delta: number, elapsed: number): void;
  captureCheckpoint(): CombatRuntimeCheckpoint;
  restoreCheckpoint(
    checkpoint: CombatRuntimeCheckpoint,
    options?: CombatCheckpointRestoreOptions
  ): void;
  snapshot(): CombatRuntimeSnapshot;
  dispose(): void;
};

export type CombatHandle = Pick<
  CombatRuntime,
  | "deliver"
  | "getProjectile"
  | "listProjectiles"
  | "cancelProjectile"
  | "captureCheckpoint"
  | "restoreCheckpoint"
  | "snapshot"
> & {
  isBound(): boolean;
};

export type CombatAbilityDeliveryRequestOverrides = {
  targetActorId?: string | undefined;
  origin?: PhysicsVector | undefined;
  position?: PhysicsVector | undefined;
  direction?: PhysicsVector | undefined;
};

export type CombatAbilityDeliveryResolutionContext = {
  binding: CombatAbilityDeliveryDefinition;
  execution: GasAbilityExecutionState;
  request: Readonly<CombatDeliveryRequest>;
};

export type CombatAbilityDeliveryDispatch = CombatAbilityDeliveryResolutionContext & {
  request: CombatDeliveryRequest;
  result: CombatDeliveryRequestResult;
};

export type CombatAbilityDeliveryFailure = CombatAbilityDeliveryResolutionContext & {
  error: unknown;
};

export type CombatAbilityDeliveryBridgeConfig = {
  bindings?: Array<DataRef<"combat.ability-delivery">> | undefined;
  resolveRequest?:
    | ((
        context: CombatAbilityDeliveryResolutionContext
      ) => CombatAbilityDeliveryRequestOverrides | false | undefined)
    | undefined;
  onResult?: ((dispatch: CombatAbilityDeliveryDispatch) => void) | undefined;
  onError?: ((failure: CombatAbilityDeliveryFailure) => void) | undefined;
};

export type CreateCombatModuleConfig = Omit<CombatRuntimeConfig, "world"> & {
  handle?: CombatHandle | undefined;
  abilityDelivery?: CombatAbilityDeliveryBridgeConfig | undefined;
  onRuntime?: ((runtime: CombatRuntime) => void) | undefined;
};

export type CombatModuleInstallContext = GameInstallContext;
