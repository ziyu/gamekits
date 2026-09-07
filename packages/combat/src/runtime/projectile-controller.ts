import type {
  PhysicsBodyData,
  PhysicsColliderData,
  PhysicsQueryResult,
  PhysicsVector
} from "@gamekits/physics-core";
import {
  PhysicsBodyComponent,
  PhysicsColliderComponent,
  PhysicsContactsComponent,
  PhysicsTransformComponent,
  PhysicsVelocityComponent
} from "@gamekits/physics-core";
import type { EntityId } from "@gamekits/world";
import { CombatProjectileComponent } from "../components";
import { COMBAT_PROJECTILE_TYPE } from "../data";
import { createCombatError } from "./errors";
import type { ResolvedCombatRuntimeLimits } from "./runtime-helpers";
import {
  cloneProjectile,
  cloneQueryOptions,
  cloneSubject,
  cloneVector,
  comparePhysicsCandidates,
  isFiniteVector,
  isInsideBounds,
  normalizeVector,
  reflectVector,
  scaleVector,
  subjectKey,
  subtractVectors,
  vectorLength
} from "./runtime-helpers";
import {
  clonePhysicsShape,
  createPhysicsEntityIndex,
  resolvedDeliveryResult,
  vectorsEqual,
  withSourceIgnored,
  type CandidateResolution,
  type CombatHitInput,
  type PhysicsEntityIndex,
  type ResolvedDelivery
} from "./runtime-internals";
import type {
  CombatDeliveryRejection,
  CombatDeliveryRejectionReason,
  CombatDeliveryRequest,
  CombatDeliveryRequestResult,
  CombatHitResult,
  CombatProjectileCancellation,
  CombatProjectileCancellationResult,
  CombatProjectileDefinition,
  CombatProjectileDespawnFact,
  CombatProjectileId,
  CombatProjectileImpactFact,
  CombatProjectileQuery,
  CombatProjectileSpawnFact,
  CombatProjectileState,
  CombatRuntimeCheckpoint,
  CombatRuntimeConfig,
  CombatSubject,
  CombatTraceStore
} from "./types";

type ProjectileRemoval = {
  reason: string;
  impact?: CombatProjectileImpactFact | undefined;
};

export type CombatProjectileController = {
  spawn(
    request: CombatDeliveryRequest,
    resolved: ResolvedDelivery,
    source: CombatSubject
  ): CombatDeliveryRequestResult;
  update(delta: number, elapsed: number): void;
  get(projectileId: CombatProjectileId): CombatProjectileState | undefined;
  list(query?: CombatProjectileQuery): CombatProjectileState[];
  cancel(input: CombatProjectileCancellation): CombatProjectileCancellationResult;
  captureCheckpoint(): CombatRuntimeCheckpoint;
  restoreCheckpoint(
    checkpoint: CombatRuntimeCheckpoint,
    options?: { resolveEntityId?(savedEntityId: EntityId): EntityId | undefined }
  ): void;
  dispose(): void;
};

export type CreateCombatProjectileControllerOptions = {
  runtimeId: string;
  config: CombatRuntimeConfig;
  limits: ResolvedCombatRuntimeLimits;
  traceStore: CombatTraceStore;
  now(): number;
  reject(
    request: Pick<CombatDeliveryRequest, "id" | "correlationId" | "parentId" | "sourceActorId">,
    reason: CombatDeliveryRejectionReason,
    message: string
  ): CombatDeliveryRejection;
  resolveCandidate(input: {
    requestId: string;
    deliveryType: "projectile";
    relationshipPolicy: string;
    source: CombatSubject;
    target: CombatSubject;
    candidate: PhysicsQueryResult;
    projectileId: string;
  }): CandidateResolution;
  resolveSubject(candidate: PhysicsQueryResult, entityIndex: PhysicsEntityIndex): CombatSubject;
  applyHit(input: CombatHitInput): CombatHitResult;
};

export function createCombatProjectileController(
  options: CreateCombatProjectileControllerOptions
): CombatProjectileController {
  const { config, limits, runtimeId, traceStore } = options;
  const activeEntityByProjectileId = new Map<CombatProjectileId, EntityId>();
  const hitMemoryByProjectileId = new Map<CombatProjectileId, Map<string, number>>();

  function spawn(
    request: CombatDeliveryRequest,
    resolved: ResolvedDelivery,
    source: CombatSubject
  ): CombatDeliveryRequestResult {
    if (resolved.spec.type !== "projectile") {
      throw new Error("Combat projectile controller received a non-projectile delivery");
    }
    if (activeEntityByProjectileId.size >= limits.maxActiveProjectiles) {
      return options.reject(request, "projectile-limit", "Combat active projectile limit reached");
    }
    const reference = resolved.spec.projectile;
    if (
      reference.type !== COMBAT_PROJECTILE_TYPE ||
      !config.dataRegistry.has(COMBAT_PROJECTILE_TYPE, reference.id)
    ) {
      return options.reject(
        request,
        "definition-missing",
        "Combat projectile definition is missing"
      );
    }
    const definition = config.dataRegistry.getValue<CombatProjectileDefinition>(
      COMBAT_PROJECTILE_TYPE,
      reference.id
    );
    const validation = validateProjectileDefinition(definition);
    if (validation !== undefined) {
      return options.reject(request, "projectile-definition-invalid", validation);
    }
    if (!config.dataRegistry.has("physics.body", definition.body.id)) {
      return options.reject(
        request,
        "definition-missing",
        "Combat projectile physics body is missing"
      );
    }
    const bodyData = config.dataRegistry.getValue<PhysicsBodyData>(
      "physics.body",
      definition.body.id
    );
    const colliderReference = bodyData.colliders?.[0];
    const colliderData =
      colliderReference !== undefined &&
      config.dataRegistry.has("physics.collider", colliderReference.id)
        ? config.dataRegistry.getValue<PhysicsColliderData>(
            "physics.collider",
            colliderReference.id
          )
        : undefined;
    if (colliderData === undefined) {
      return options.reject(
        request,
        "projectile-definition-invalid",
        "Combat projectiles require a resolvable physics collider"
      );
    }
    const position = request.position ?? resolved.spec.position ?? source.position;
    const direction = normalizeVector(
      request.direction ?? resolved.spec.direction ?? { x: 1, y: 0 }
    );
    if (!isFiniteVector(position) || direction === undefined) {
      return options.reject(
        request,
        "delivery-context-missing",
        "Projectile position and direction are required"
      );
    }
    const projectileId = `${request.id}.projectile`;
    if (activeEntityByProjectileId.has(projectileId)) {
      return options.reject(
        request,
        "duplicate-request-conflict",
        "Projectile id is already active"
      );
    }
    const now = request.issuedAt ?? options.now();
    const lifetimeMs = Math.min(definition.lifetimeMs, limits.maxProjectileLifetimeMs);
    const payloads = resolved.payloads.length > 0 ? resolved.payloads : definition.payloads;
    if (payloads.length === 0) {
      return options.reject(
        request,
        "projectile-definition-invalid",
        "Combat projectile requires at least one payload"
      );
    }
    const bodyId = `${projectileId}.body`;
    const colliderId = `${projectileId}.collider`;
    const entityId = config.world.spawn();
    const {
      colliders: _colliders,
      tags: _bodyTags,
      id: _bodyDefinitionId,
      ...bodyDefinition
    } = bodyData;
    const {
      tags: _colliderTags,
      id: _colliderDefinitionId,
      bodyId: _bodyId,
      ...colliderDefinition
    } = colliderData;
    const state: CombatProjectileState = {
      runtimeId,
      projectileId,
      definitionId: definition.id,
      entityId,
      sourceActorId: request.sourceActorId,
      ...(source.entityId === undefined ? {} : { sourceEntityId: source.entityId }),
      sourceSubject: cloneSubject(source),
      ...(request.executionId === undefined ? {} : { executionId: request.executionId }),
      relationshipPolicy: resolved.relationshipPolicy,
      payloads: payloads.map((payload) => ({ ...payload })),
      collisionMode: definition.collisionMode,
      hitPolicy: definition.hitPolicy,
      spawnedAt: now,
      expiresAt: now + lifetimeMs,
      previousPosition: cloneVector(position),
      ...(definition.collisionMode === "shape-sweep"
        ? { sweepShape: clonePhysicsShape(colliderData.shape) }
        : {}),
      hitCount: 0,
      bounceCount: 0,
      maxHits: Math.min(definition.maxHits ?? 1, limits.maxHitsPerProjectile),
      maxBounces: Math.min(definition.maxBounces ?? 0, limits.maxBouncesPerProjectile),
      ...(definition.repeatHitCooldownMs === undefined
        ? {}
        : { repeatHitCooldownMs: definition.repeatHitCooldownMs }),
      hitMemory: [],
      ...(definition.query === undefined ? {} : { query: cloneQueryOptions(definition.query) }),
      executionOwnership: definition.executionOwnership ?? "independent",
      correlationId: request.correlationId ?? request.id,
      ...(request.parentId === undefined ? {} : { parentId: request.parentId })
    };
    config.world.add(entityId, CombatProjectileComponent, state);
    config.world.add(entityId, PhysicsBodyComponent, {
      definition: { ...bodyDefinition, id: bodyId, position: cloneVector(position) },
      bodyId,
      enabled: true,
      syncFromWorld: bodyDefinition.kind !== "dynamic",
      syncVelocityFromWorld: true,
      syncToWorld: true
    });
    config.world.add(entityId, PhysicsColliderComponent, {
      definition: { ...colliderDefinition, id: colliderId, bodyId },
      colliderId,
      enabled: true
    });
    config.world.add(entityId, PhysicsTransformComponent, { position: cloneVector(position) });
    const velocity = scaleVector(direction, definition.speed ?? 0);
    config.world.add(entityId, PhysicsVelocityComponent, {
      linear: velocity
    });
    activeEntityByProjectileId.set(projectileId, entityId);
    hitMemoryByProjectileId.set(projectileId, new Map());
    traceStore.add({
      type: "projectile.spawned",
      timestamp: now,
      requestId: request.id,
      projectileId,
      sourceActorId: request.sourceActorId,
      correlationId: state.correlationId,
      parentId: state.parentId,
      details: { entityId, definitionId: definition.id }
    });
    if (config.eventPolicy?.emitProjectiles !== false && config.eventBus !== undefined) {
      const fact: CombatProjectileSpawnFact = {
        runtimeId,
        projectileId,
        entityId,
        definitionId: definition.id,
        sourceActorId: state.sourceActorId,
        ...(state.sourceEntityId === undefined ? {} : { sourceEntityId: state.sourceEntityId }),
        ...(state.executionId === undefined ? {} : { executionId: state.executionId }),
        position: cloneVector(position),
        velocity: cloneVector(velocity),
        spawnedAt: state.spawnedAt,
        expiresAt: state.expiresAt,
        ...(state.correlationId === undefined ? {} : { correlationId: state.correlationId }),
        ...(state.parentId === undefined ? {} : { parentId: state.parentId })
      };
      config.eventBus.emit("combat.projectile_spawned", fact, runtimeId, {
        correlationId: state.correlationId,
        parentId: state.parentId
      });
    }
    return resolvedDeliveryResult(request, "projectile", [], 0, 0, undefined, state);
  }

  function update(_delta: number, elapsed: number): void {
    if (activeEntityByProjectileId.size === 0) {
      return;
    }
    const removals = new Map<CombatProjectileId, ProjectileRemoval>();
    const entityIndex = createPhysicsEntityIndex(config.world);
    for (const projectileId of [...activeEntityByProjectileId.keys()].sort()) {
      const entityId = activeEntityByProjectileId.get(projectileId)!;
      if (!config.world.has(entityId)) {
        forget(projectileId);
        continue;
      }
      const componentState = config.world.get(entityId, CombatProjectileComponent);
      const transform = config.world.get(entityId, PhysicsTransformComponent);
      if (
        componentState === undefined ||
        componentState.runtimeId !== runtimeId ||
        transform === undefined
      ) {
        removals.set(projectileId, { reason: "invalid-entity-state" });
        continue;
      }
      const state = cloneProjectile(componentState);
      if (elapsed >= state.expiresAt) {
        traceStore.add({
          type: "projectile.expired",
          timestamp: elapsed,
          projectileId,
          sourceActorId: state.sourceActorId,
          correlationId: state.correlationId,
          parentId: state.parentId
        });
        removals.set(projectileId, { reason: "expired" });
        continue;
      }
      if (
        config.projectileBounds !== undefined &&
        !isInsideBounds(transform.position, config.projectileBounds)
      ) {
        removals.set(projectileId, { reason: "out-of-bounds" });
        continue;
      }
      if (state.executionOwnership === "cancel-with-execution" && state.executionId !== undefined) {
        const execution = config.gas.getAbilityExecution(state.executionId);
        if (
          execution === undefined ||
          execution.phase === "cancelled" ||
          execution.phase === "completed"
        ) {
          removals.set(projectileId, { reason: "execution-ended" });
          continue;
        }
      }
      const candidates = collectCandidates(entityId, state, transform.position);
      const previousHitCount = state.hitCount;
      const previousBounceCount = state.bounceCount;
      resolveCandidates(entityId, state, candidates, entityIndex, removals);
      if (!removals.has(projectileId) && config.world.has(entityId)) {
        const positionChanged = !vectorsEqual(state.previousPosition, transform.position);
        const nextHitMemory = serializeHitMemory(projectileId);
        if (
          positionChanged ||
          state.hitCount !== previousHitCount ||
          state.bounceCount !== previousBounceCount ||
          nextHitMemory.length !== state.hitMemory.length
        ) {
          state.previousPosition = cloneVector(transform.position);
          state.hitMemory = nextHitMemory;
          config.world.set(entityId, CombatProjectileComponent, state);
        }
      }
    }
    for (const [projectileId, removal] of removals) {
      despawn(projectileId, removal.reason, removal.impact);
    }
  }

  function collectCandidates(
    entityId: EntityId,
    state: CombatProjectileState,
    currentPosition: PhysicsVector
  ): PhysicsQueryResult[] {
    const body = config.world.get(entityId, PhysicsBodyComponent);
    const collider = config.world.get(entityId, PhysicsColliderComponent);
    const query = withSourceIgnored(
      state.query,
      state.sourceSubject,
      body?.bodyId,
      collider?.colliderId
    );
    if (state.collisionMode === "contact") {
      const contacts = config.world.get(entityId, PhysicsContactsComponent)?.contacts ?? [];
      return contacts
        .filter((contact) => contact.phase === "enter")
        .map((contact) => {
          const isA = contact.entityA === entityId || contact.colliderA === collider?.colliderId;
          const bodyId = isA ? contact.bodyB : contact.bodyA;
          const otherEntityId = isA ? contact.entityB : contact.entityA;
          return {
            colliderId: isA ? contact.colliderB : contact.colliderA,
            ...(bodyId === undefined ? {} : { bodyId }),
            ...(otherEntityId === undefined ? {} : { entityId: otherEntityId }),
            distance: 0,
            sensor: contact.sensor
          };
        })
        .slice(0, limits.maxCandidatesPerRequest)
        .sort(comparePhysicsCandidates);
    }
    const displacement = subtractVectors(currentPosition, state.previousPosition);
    const distance = vectorLength(displacement);
    const direction = normalizeVector(displacement);
    if (direction === undefined || distance <= Number.EPSILON) {
      return [];
    }
    const candidates =
      state.collisionMode === "shape-sweep" && state.sweepShape !== undefined
        ? config.physics.shapeCast(state.sweepShape, state.previousPosition, direction, {
            ...query,
            maxDistance: distance,
            mode: "closest",
            sort: "distance",
            maxResults: 1
          })
        : config.physics.raycast(state.previousPosition, direction, {
            ...query,
            maxDistance: distance,
            mode: "all",
            sort: "distance",
            maxResults: limits.maxCandidatesPerRequest
          });
    return candidates.slice(0, limits.maxCandidatesPerRequest).sort(comparePhysicsCandidates);
  }

  function resolveCandidates(
    entityId: EntityId,
    state: CombatProjectileState,
    candidates: PhysicsQueryResult[],
    entityIndex: PhysicsEntityIndex,
    removals: Map<CombatProjectileId, ProjectileRemoval>
  ): void {
    if (candidates.length === 0) {
      return;
    }
    const seenSubjects = new Set<string>();
    for (const candidate of candidates) {
      const target = options.resolveSubject(candidate, entityIndex);
      const key = subjectKey(target);
      if (seenSubjects.has(key) || hitSuppressed(state, key)) {
        continue;
      }
      seenSubjects.add(key);
      const resolvedCandidate = options.resolveCandidate({
        requestId: state.projectileId,
        deliveryType: "projectile",
        relationshipPolicy: state.relationshipPolicy,
        source: state.sourceSubject,
        target,
        candidate,
        projectileId: state.projectileId
      });
      if (resolvedCandidate.decision.disposition === "ignore") {
        traceStore.add({
          type: "candidate.rejected",
          timestamp: options.now(),
          projectileId: state.projectileId,
          sourceActorId: state.sourceActorId,
          targetActorId: target.actorId,
          targetEntityId: target.entityId,
          correlationId: state.correlationId,
          parentId: state.parentId,
          message: resolvedCandidate.decision.reason ?? "ignored"
        });
        continue;
      }
      if (resolvedCandidate.decision.disposition === "target") {
        const ticketId = `${state.projectileId}:hit:${state.hitCount + 1}:${key}`;
        const hit = options.applyHit({
          request: {
            id: state.projectileId,
            sourceActorId: state.sourceActorId,
            sourceEntityId: state.sourceEntityId,
            executionId: state.executionId,
            correlationId: state.correlationId,
            parentId: state.parentId
          },
          deliveryType: "projectile",
          relationshipPolicy: state.relationshipPolicy,
          payloads: state.payloads,
          source: state.sourceSubject,
          target,
          relationship: resolvedCandidate.relationship ?? "unknown",
          ticketId,
          candidate,
          projectileId: state.projectileId
        });
        state.hitCount += 1;
        rememberHit(state.projectileId, key);
        traceStore.add({
          type: "projectile.hit",
          timestamp: options.now(),
          projectileId: state.projectileId,
          ticketId: hit.ticketId,
          sourceActorId: state.sourceActorId,
          targetActorId: target.actorId,
          targetEntityId: target.entityId,
          correlationId: state.correlationId,
          parentId: state.parentId,
          details: { status: hit.status, hitCount: state.hitCount }
        });
      }
      if (state.hitPolicy === "bounce") {
        const velocity = config.world.get(entityId, PhysicsVelocityComponent);
        if (velocity !== undefined) {
          config.world.set(entityId, PhysicsVelocityComponent, {
            linear: reflectVector(velocity.linear, candidate.normal)
          });
        }
        state.bounceCount += 1;
        traceStore.add({
          type: "projectile.bounced",
          timestamp: options.now(),
          projectileId: state.projectileId,
          sourceActorId: state.sourceActorId,
          correlationId: state.correlationId,
          parentId: state.parentId,
          details: { bounceCount: state.bounceCount }
        });
        if (state.bounceCount > state.maxBounces) {
          removals.set(state.projectileId, {
            reason: "bounce-limit",
            impact: createProjectileImpactFact(
              resolvedCandidate.decision.disposition,
              target,
              candidate
            )
          });
        }
        break;
      }
      if (state.hitPolicy === "stop") {
        removals.set(state.projectileId, {
          reason: "impact",
          impact: createProjectileImpactFact(
            resolvedCandidate.decision.disposition,
            target,
            candidate
          )
        });
        break;
      }
      if (state.hitCount >= state.maxHits) {
        removals.set(state.projectileId, {
          reason: "hit-limit",
          impact: createProjectileImpactFact(
            resolvedCandidate.decision.disposition,
            target,
            candidate
          )
        });
        break;
      }
    }
  }

  function get(projectileId: CombatProjectileId): CombatProjectileState | undefined {
    const entityId = activeEntityByProjectileId.get(projectileId);
    if (entityId === undefined || !config.world.has(entityId)) {
      return undefined;
    }
    const state = config.world.get(entityId, CombatProjectileComponent);
    return state?.runtimeId === runtimeId ? cloneProjectile(state) : undefined;
  }

  function list(query: CombatProjectileQuery = {}): CombatProjectileState[] {
    return [...activeEntityByProjectileId.keys()]
      .sort()
      .map(get)
      .filter((state): state is CombatProjectileState => state !== undefined)
      .filter(
        (state) =>
          (query.sourceActorId === undefined || state.sourceActorId === query.sourceActorId) &&
          (query.definitionId === undefined || state.definitionId === query.definitionId)
      );
  }

  function cancel(input: CombatProjectileCancellation): CombatProjectileCancellationResult {
    if (!activeEntityByProjectileId.has(input.projectileId)) {
      return {
        status: "rejected",
        projectileId: input.projectileId,
        reason: "missing-projectile"
      };
    }
    despawn(input.projectileId, input.reason ?? "cancelled");
    return { status: "cancelled", projectileId: input.projectileId };
  }

  function captureCheckpoint(): CombatRuntimeCheckpoint {
    return {
      elapsed: options.now(),
      projectiles: list().map((state) => ({ entityId: state.entityId, state }))
    };
  }

  function restoreCheckpoint(
    checkpoint: CombatRuntimeCheckpoint,
    restoreOptions: { resolveEntityId?(savedEntityId: EntityId): EntityId | undefined } = {}
  ): void {
    validateCheckpoint(checkpoint);
    const mappedEntityKeys = new Set<string>();
    const restored = checkpoint.projectiles.map((entry) => {
      const entityId = restoreOptions.resolveEntityId?.(entry.entityId) ?? entry.entityId;
      const entityKey = `${typeof entityId}:${String(entityId)}`;
      if (mappedEntityKeys.has(entityKey)) {
        throw createCombatError(
          "combat.restore_entity_conflict",
          `Multiple Combat projectiles map to entity ${String(entityId)}`
        );
      }
      if (!config.world.has(entityId)) {
        throw createCombatError(
          "combat.restore_entity_missing",
          `Combat projectile entity ${String(entityId)} is missing during restore`
        );
      }
      const existing = config.world.get(entityId, CombatProjectileComponent);
      if (existing !== undefined && existing.runtimeId !== runtimeId) {
        throw createCombatError(
          "combat.restore_entity_owned",
          `Combat projectile entity ${String(entityId)} belongs to another runtime`
        );
      }
      mappedEntityKeys.add(entityKey);
      return { entityId, state: { ...cloneProjectile(entry.state), entityId, runtimeId } };
    });
    const restoredEntityByProjectileId = new Map(
      restored.map((entry) => [entry.state.projectileId, entry.entityId] as const)
    );
    for (const [projectileId, currentEntityId] of activeEntityByProjectileId) {
      if (restoredEntityByProjectileId.get(projectileId) !== currentEntityId) {
        despawn(projectileId, "checkpoint-restore");
      }
    }
    activeEntityByProjectileId.clear();
    hitMemoryByProjectileId.clear();
    for (const entry of restored) {
      if (config.world.get(entry.entityId, CombatProjectileComponent) === undefined) {
        config.world.add(entry.entityId, CombatProjectileComponent, entry.state);
      } else {
        config.world.set(entry.entityId, CombatProjectileComponent, entry.state);
      }
      activeEntityByProjectileId.set(entry.state.projectileId, entry.entityId);
      hitMemoryByProjectileId.set(
        entry.state.projectileId,
        new Map(entry.state.hitMemory.map((memory) => [memory.subjectKey, memory.lastHitAt]))
      );
    }
  }

  function validateCheckpoint(checkpoint: CombatRuntimeCheckpoint): void {
    if (
      !Number.isFinite(checkpoint.elapsed) ||
      checkpoint.elapsed < 0 ||
      !Array.isArray(checkpoint.projectiles)
    ) {
      throw createCombatError("combat.checkpoint_invalid", "Combat checkpoint is invalid");
    }
    if (checkpoint.projectiles.length > limits.maxActiveProjectiles) {
      throw createCombatError(
        "combat.checkpoint_limit",
        "Combat checkpoint exceeds projectile limit"
      );
    }
    const projectileIds = new Set<string>();
    const entityIds = new Set<string>();
    for (const entry of checkpoint.projectiles) {
      const state = entry.state;
      const entityKey = `${typeof entry.entityId}:${String(entry.entityId)}`;
      if (
        state.runtimeId.length === 0 ||
        state.projectileId.length === 0 ||
        projectileIds.has(state.projectileId) ||
        entityIds.has(entityKey) ||
        state.hitMemory.length > limits.maxHitMemoryPerProjectile ||
        !Number.isFinite(state.spawnedAt) ||
        !Number.isFinite(state.expiresAt) ||
        state.expiresAt < state.spawnedAt ||
        state.maxHits > limits.maxHitsPerProjectile ||
        state.maxBounces > limits.maxBouncesPerProjectile ||
        !config.dataRegistry.has(COMBAT_PROJECTILE_TYPE, state.definitionId)
      ) {
        throw createCombatError(
          "combat.checkpoint_invalid_projectile",
          "Combat checkpoint projectile is invalid",
          {
            projectileId: state.projectileId
          }
        );
      }
      for (const memory of state.hitMemory) {
        if (
          memory.subjectKey.length === 0 ||
          !Number.isFinite(memory.lastHitAt) ||
          memory.lastHitAt < 0
        ) {
          throw createCombatError(
            "combat.checkpoint_invalid_hit_memory",
            "Combat hit memory is invalid"
          );
        }
      }
      projectileIds.add(state.projectileId);
      entityIds.add(entityKey);
    }
  }

  function hitSuppressed(state: CombatProjectileState, key: string): boolean {
    const lastHitAt = hitMemoryByProjectileId.get(state.projectileId)?.get(key);
    if (lastHitAt === undefined) {
      return false;
    }
    return (
      state.repeatHitCooldownMs === undefined ||
      options.now() - lastHitAt < state.repeatHitCooldownMs
    );
  }

  function rememberHit(projectileId: string, key: string): void {
    const memory = hitMemoryByProjectileId.get(projectileId) ?? new Map<string, number>();
    memory.delete(key);
    memory.set(key, options.now());
    while (memory.size > limits.maxHitMemoryPerProjectile) {
      memory.delete(memory.keys().next().value!);
    }
    hitMemoryByProjectileId.set(projectileId, memory);
  }

  function serializeHitMemory(projectileId: string) {
    return [...(hitMemoryByProjectileId.get(projectileId) ?? new Map()).entries()].map(
      ([key, lastHitAt]) => ({ subjectKey: key, lastHitAt })
    );
  }

  function despawn(
    projectileId: string,
    reason: string,
    impact?: CombatProjectileImpactFact
  ): void {
    const entityId = activeEntityByProjectileId.get(projectileId);
    if (entityId === undefined) {
      return;
    }
    const entityExists = config.world.has(entityId);
    const state = entityExists ? config.world.get(entityId, CombatProjectileComponent) : undefined;
    const eventBus = config.eventBus;
    let fact: CombatProjectileDespawnFact | undefined;
    if (config.eventPolicy?.emitProjectiles !== false && eventBus !== undefined) {
      const transform = entityExists
        ? config.world.get(entityId, PhysicsTransformComponent)
        : undefined;
      const velocity = entityExists
        ? config.world.get(entityId, PhysicsVelocityComponent)
        : undefined;
      fact = {
        runtimeId,
        projectileId,
        entityId,
        reason,
        ...(state?.definitionId === undefined ? {} : { definitionId: state.definitionId }),
        ...(state?.sourceActorId === undefined ? {} : { sourceActorId: state.sourceActorId }),
        ...(state?.sourceEntityId === undefined ? {} : { sourceEntityId: state.sourceEntityId }),
        ...(state?.executionId === undefined ? {} : { executionId: state.executionId }),
        ...(transform === undefined ? {} : { finalPosition: cloneVector(transform.position) }),
        ...(velocity === undefined ? {} : { finalVelocity: cloneVector(velocity.linear) }),
        ...(impact === undefined ? {} : { impact }),
        ...(state?.correlationId === undefined ? {} : { correlationId: state.correlationId }),
        ...(state?.parentId === undefined ? {} : { parentId: state.parentId })
      };
    }
    if (entityExists && state?.runtimeId === runtimeId) {
      config.world.despawn(entityId);
    }
    forget(projectileId);
    traceStore.add({
      type: "projectile.despawned",
      timestamp: options.now(),
      projectileId,
      sourceActorId: state?.sourceActorId,
      correlationId: state?.correlationId,
      parentId: state?.parentId,
      details: { reason, hasImpact: impact !== undefined }
    });
    if (fact !== undefined && eventBus !== undefined) {
      eventBus.emit("combat.projectile_despawned", fact, runtimeId, {
        correlationId: state?.correlationId,
        parentId: state?.parentId
      });
    }
  }

  function forget(projectileId: string): void {
    activeEntityByProjectileId.delete(projectileId);
    hitMemoryByProjectileId.delete(projectileId);
  }

  function dispose(): void {
    for (const projectileId of activeEntityByProjectileId.keys()) {
      despawn(projectileId, "runtime-disposed");
    }
    activeEntityByProjectileId.clear();
    hitMemoryByProjectileId.clear();
  }

  return {
    spawn,
    update,
    get,
    list,
    cancel,
    captureCheckpoint,
    restoreCheckpoint,
    dispose
  };
}

function createProjectileImpactFact(
  disposition: "target" | "blocker",
  subject: CombatSubject,
  candidate: PhysicsQueryResult
): CombatProjectileImpactFact {
  const entityId = subject.entityId ?? candidate.entityId;
  const bodyId = subject.bodyId ?? candidate.bodyId;
  return {
    disposition,
    subject: {
      ...(subject.actorId === undefined ? {} : { actorId: subject.actorId }),
      ...(entityId === undefined ? {} : { entityId }),
      ...(bodyId === undefined ? {} : { bodyId }),
      colliderId: subject.colliderId ?? candidate.colliderId
    },
    ...(candidate.point === undefined ? {} : { point: cloneVector(candidate.point) }),
    ...(candidate.normal === undefined ? {} : { normal: cloneVector(candidate.normal) }),
    ...(candidate.distance === undefined ? {} : { distance: candidate.distance })
  };
}

function validateProjectileDefinition(definition: CombatProjectileDefinition): string | undefined {
  if (
    definition.id.length === 0 ||
    !Number.isFinite(definition.lifetimeMs) ||
    definition.lifetimeMs <= 0 ||
    (definition.speed !== undefined &&
      (!Number.isFinite(definition.speed) || definition.speed < 0)) ||
    (definition.maxHits !== undefined &&
      (!Number.isSafeInteger(definition.maxHits) || definition.maxHits <= 0)) ||
    (definition.maxBounces !== undefined &&
      (!Number.isSafeInteger(definition.maxBounces) || definition.maxBounces < 0))
  ) {
    return "Combat projectile definition contains invalid limits";
  }
  return undefined;
}
