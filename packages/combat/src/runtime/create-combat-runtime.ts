import type { PhysicsQueryResult } from "@gamekits/physics-core";
import {
  PhysicsBodyComponent,
  PhysicsColliderComponent,
  PhysicsTransformComponent
} from "@gamekits/physics-core";
import type { EntityId } from "@gamekits/world";
import { COMBAT_DELIVERY_TYPE } from "../data";
import { createCombatError } from "./errors";
import { createCombatProjectileController } from "./projectile-controller";
import {
  addVectors,
  cloneDeliveryResult,
  cloneVector,
  comparePhysicsCandidates,
  isFiniteVector,
  normalizeVector,
  requestFingerprint,
  resolveCombatRuntimeLimits,
  subjectKey
} from "./runtime-helpers";
import {
  createBlockResult,
  createPhysicsEntityIndex,
  definitionDelivery,
  hitResult,
  isDeliveryRejection,
  nonEmpty,
  requiredPosition,
  resolvedDeliveryResult,
  validateResolvedDelivery,
  withSourceIgnored,
  type CandidateResolution,
  type CombatHitInput,
  type DeliveryHistory,
  type PhysicsEntityIndex,
  type ResolvedDelivery
} from "./runtime-internals";
import { createCombatTraceStore } from "./trace-store";
import type {
  CombatDeliveryDefinition,
  CombatDeliveryRejection,
  CombatDeliveryRejectionReason,
  CombatDeliveryRequest,
  CombatDeliveryRequestResult,
  CombatDeliverySpec,
  CombatHitContext,
  CombatHitResult,
  CombatPayloadResult,
  CombatProjectileCancellation,
  CombatProjectileId,
  CombatProjectileQuery,
  CombatRuntime,
  CombatRuntimeCheckpoint,
  CombatRuntimeConfig,
  CombatSubject
} from "./types";

export function createCombatRuntime(config: CombatRuntimeConfig): CombatRuntime {
  const runtimeId = config.id ?? "gamekits.combat";
  const limits = resolveCombatRuntimeLimits(config.limits);
  const traceStore = config.traceStore ?? createCombatTraceStore();
  const deliveryHistory = new Map<string, DeliveryHistory>();
  const deliveryOrder: string[] = [];
  const resolvedTickets = new Set<string>();
  const resolvedTicketOrder: string[] = [];
  let elapsedNow = 0;
  let disposed = false;

  const projectileController = createCombatProjectileController({
    runtimeId,
    config,
    limits,
    traceStore,
    now: () => elapsedNow,
    reject,
    resolveCandidate(input) {
      return resolveCandidateDisposition(
        input.requestId,
        input.deliveryType,
        input.relationshipPolicy,
        input.source,
        input.target,
        input.candidate,
        input.projectileId
      );
    },
    resolveSubject: resolveQuerySubject,
    applyHit
  });

  function assertActive(): void {
    if (disposed) {
      throw createCombatError("combat.runtime_disposed", "Combat runtime is disposed", {
        runtimeId
      });
    }
  }

  function deliver(request: CombatDeliveryRequest): CombatDeliveryRequestResult {
    assertActive();
    const correlationId = request.correlationId ?? request.id;
    if (!nonEmpty(request.id) || !nonEmpty(request.sourceActorId)) {
      return reject(request, "invalid-request", "Combat delivery requires request and source ids");
    }
    if (
      request.issuedAt !== undefined &&
      (!Number.isFinite(request.issuedAt) || request.issuedAt < 0)
    ) {
      return reject(request, "invalid-request", "Combat delivery issuedAt must be non-negative");
    }

    const fingerprint = requestFingerprint(request);
    const previous = deliveryHistory.get(request.id);
    if (previous !== undefined) {
      if (previous.fingerprint !== fingerprint) {
        return reject(
          request,
          "duplicate-request-conflict",
          `Combat delivery ${request.id} was already used with different input`
        );
      }
      const duplicate = cloneDeliveryResult(previous.result);
      if (duplicate.status === "resolved") {
        duplicate.duplicate = true;
      }
      return duplicate;
    }

    const resolved = resolveDelivery(request);
    if (isDeliveryRejection(resolved)) {
      return remember(request.id, fingerprint, resolved);
    }
    const sourceActor = tryGetActor(request.sourceActorId);
    if (sourceActor === undefined) {
      return remember(
        request.id,
        fingerprint,
        reject(request, "source-missing", `Combat source actor ${request.sourceActorId} is missing`)
      );
    }
    if (
      request.sourceEntityId !== undefined &&
      sourceActor.actor.entityId !== undefined &&
      request.sourceEntityId !== sourceActor.actor.entityId
    ) {
      return remember(
        request.id,
        fingerprint,
        reject(request, "source-entity-mismatch", "Combat source entity does not match GAS")
      );
    }
    const source = resolveActorSubject(request.sourceActorId, sourceActor);
    traceStore.add({
      type: "delivery.accepted",
      timestamp: request.issuedAt ?? elapsedNow,
      requestId: request.id,
      sourceActorId: request.sourceActorId,
      correlationId,
      parentId: request.parentId,
      details: { deliveryType: resolved.spec.type }
    });

    let result: CombatDeliveryRequestResult;
    switch (resolved.spec.type) {
      case "direct":
        result = resolveDirect(request, resolved, source);
        break;
      case "melee":
      case "hitscan":
      case "area":
        result = resolveQueryDelivery(request, resolved, source);
        break;
      case "projectile":
        result = projectileController.spawn(request, resolved, source);
        break;
    }
    remember(request.id, fingerprint, result);
    if (result.status === "resolved") {
      traceStore.add({
        type: "delivery.resolved",
        timestamp: request.issuedAt ?? elapsedNow,
        requestId: request.id,
        sourceActorId: request.sourceActorId,
        correlationId,
        parentId: request.parentId,
        details: {
          deliveryType: result.deliveryType,
          hitCount: result.hits.length,
          candidateCount: result.queriedCandidates
        }
      });
      if (config.eventPolicy?.emitDeliveries !== false) {
        config.eventBus?.emit("combat.delivery_resolved", cloneDeliveryResult(result), runtimeId, {
          correlationId,
          parentId: request.parentId
        });
      }
    }
    return cloneDeliveryResult(result);
  }

  function resolveDelivery(
    request: CombatDeliveryRequest
  ): ResolvedDelivery | CombatDeliveryRejection {
    if (request.definition !== undefined) {
      if (
        request.delivery !== undefined ||
        request.payloads !== undefined ||
        request.relationshipPolicy !== undefined
      ) {
        return reject(
          request,
          "definition-conflict",
          "Definition-backed combat deliveries cannot override delivery, payloads, or policy"
        );
      }
      if (
        request.definition.type !== COMBAT_DELIVERY_TYPE ||
        !config.dataRegistry.has(COMBAT_DELIVERY_TYPE, request.definition.id)
      ) {
        return reject(request, "definition-missing", "Combat delivery definition is missing");
      }
      const definition = config.dataRegistry.getValue<CombatDeliveryDefinition>(
        COMBAT_DELIVERY_TYPE,
        request.definition.id
      );
      const validation = validateResolvedDelivery(definition.delivery, definition.payloads);
      if (validation !== undefined) {
        return reject(request, "invalid-request", validation);
      }
      return definitionDelivery(definition);
    }
    if (request.delivery === undefined || !nonEmpty(request.relationshipPolicy)) {
      return reject(
        request,
        "delivery-context-missing",
        "Inline combat delivery requires delivery and relationshipPolicy"
      );
    }
    const payloads = (request.payloads ?? []).map((payload) => ({ ...payload }));
    const validation = validateResolvedDelivery(request.delivery, payloads);
    if (validation !== undefined) {
      return reject(request, "invalid-request", validation);
    }
    return {
      spec: request.delivery,
      payloads,
      relationshipPolicy: request.relationshipPolicy
    };
  }

  function resolveDirect(
    request: CombatDeliveryRequest,
    resolved: ResolvedDelivery,
    source: CombatSubject
  ): CombatDeliveryRequestResult {
    if (resolved.spec.type !== "direct") {
      throw new Error("Combat direct resolver received a non-direct delivery");
    }
    const targetActorId = request.targetActorId ?? resolved.spec.targetActorId;
    if (!nonEmpty(targetActorId)) {
      return reject(request, "target-missing", "Direct combat delivery requires a target");
    }
    const actor = tryGetActor(targetActorId);
    if (actor === undefined) {
      return reject(request, "target-missing", `Combat target actor ${targetActorId} is missing`);
    }
    const target = resolveActorSubject(targetActorId, actor);
    const candidate = resolveCandidateDisposition(
      request.id,
      resolved.spec.type,
      resolved.relationshipPolicy,
      source,
      target,
      undefined,
      undefined
    );
    if (candidate.decision.disposition !== "target") {
      return reject(
        request,
        "target-disallowed",
        "Combat target is rejected by relationship policy"
      );
    }
    const hit = applyHit({
      request,
      deliveryType: "direct",
      relationshipPolicy: resolved.relationshipPolicy,
      payloads: resolved.payloads,
      source,
      target,
      relationship: candidate.relationship ?? "unknown",
      ticketId: `${request.id}:${subjectKey(target)}`
    });
    return resolvedDeliveryResult(request, resolved.spec.type, [hit], 0, 0);
  }

  function resolveQueryDelivery(
    request: CombatDeliveryRequest,
    resolved: ResolvedDelivery,
    source: CombatSubject
  ): CombatDeliveryRequestResult {
    const spec = resolved.spec;
    if (spec.type !== "melee" && spec.type !== "hitscan" && spec.type !== "area") {
      throw new Error("Combat query resolver received a non-query delivery");
    }
    const sourcePosition = request.position ?? request.origin ?? source.position;
    if (!hasSpatialContext(request, spec, sourcePosition)) {
      return reject(
        request,
        "delivery-context-missing",
        "Combat spatial delivery requires a source or explicit position"
      );
    }
    const queryOptions = withSourceIgnored(spec.query, source);
    let candidates: PhysicsQueryResult[];
    if (spec.type === "melee") {
      const position =
        request.position ??
        spec.position ??
        addVectors(requiredPosition(sourcePosition), spec.offset);
      candidates = config.physics.overlapShape(spec.shape, position, {
        ...queryOptions,
        ...(spec.rotation === undefined ? {} : { rotation: spec.rotation }),
        mode: "all",
        sort: "distance",
        maxResults: limits.maxCandidatesPerRequest
      });
    } else if (spec.type === "area") {
      const position = request.position ?? spec.position ?? requiredPosition(sourcePosition);
      candidates = config.physics.overlapShape(spec.shape, position, {
        ...queryOptions,
        ...(spec.rotation === undefined ? {} : { rotation: spec.rotation }),
        mode: "all",
        sort: "distance",
        maxResults: limits.maxCandidatesPerRequest
      });
    } else {
      const origin = request.origin ?? spec.origin ?? requiredPosition(sourcePosition);
      const direction = normalizeVector(request.direction ?? spec.direction ?? { x: 1, y: 0 });
      if (direction === undefined) {
        return reject(request, "invalid-request", "Hitscan direction must be non-zero");
      }
      if ((spec.radius ?? 0) > 0) {
        const shape =
          config.physics.snapshot().dimension === "3d"
            ? ({ type: "sphere", radius: spec.radius! } as const)
            : ({ type: "circle", radius: spec.radius! } as const);
        candidates = config.physics.shapeCast(shape, origin, direction, {
          ...queryOptions,
          maxDistance: spec.range,
          mode: "closest",
          sort: "distance",
          maxResults: 1
        });
      } else {
        candidates = config.physics.raycast(origin, direction, {
          ...queryOptions,
          maxDistance: spec.range,
          mode: "all",
          sort: "distance",
          maxResults: limits.maxCandidatesPerRequest
        });
      }
    }
    candidates = candidates.slice(0, limits.maxCandidatesPerRequest).sort(comparePhysicsCandidates);
    traceStore.add({
      type: "query.completed",
      timestamp: request.issuedAt ?? elapsedNow,
      requestId: request.id,
      sourceActorId: request.sourceActorId,
      correlationId: request.correlationId ?? request.id,
      parentId: request.parentId,
      details: { deliveryType: spec.type, candidateCount: candidates.length }
    });

    const maxTargets = Math.min(
      spec.selection?.maxTargets ?? (spec.type === "area" ? limits.maxTargetsPerRequest : 1),
      limits.maxTargetsPerRequest
    );
    const stopOnBlocker = spec.selection?.stopOnBlocker ?? spec.type !== "area";
    const hits: CombatHitResult[] = [];
    let ignoredCandidates = 0;
    let blockedBy;
    const seenSubjects = new Set<string>();
    const entityIndex = createPhysicsEntityIndex(config.world);
    for (const candidate of candidates) {
      const target = resolveQuerySubject(candidate, entityIndex);
      const key = subjectKey(target);
      if (seenSubjects.has(key)) {
        ignoredCandidates += 1;
        continue;
      }
      seenSubjects.add(key);
      const resolution = resolveCandidateDisposition(
        request.id,
        spec.type,
        resolved.relationshipPolicy,
        source,
        target,
        candidate,
        undefined
      );
      if (resolution.decision.disposition === "ignore") {
        ignoredCandidates += 1;
        traceStore.add({
          type: "candidate.rejected",
          timestamp: request.issuedAt ?? elapsedNow,
          requestId: request.id,
          sourceActorId: request.sourceActorId,
          targetActorId: target.actorId,
          targetEntityId: target.entityId,
          correlationId: request.correlationId ?? request.id,
          parentId: request.parentId,
          message: resolution.decision.reason ?? "ignored"
        });
        continue;
      }
      if (resolution.decision.disposition === "blocker") {
        blockedBy = createBlockResult(target, candidate);
        if (stopOnBlocker) {
          break;
        }
        ignoredCandidates += 1;
        continue;
      }
      hits.push(
        applyHit({
          request,
          deliveryType: spec.type,
          relationshipPolicy: resolved.relationshipPolicy,
          payloads: resolved.payloads,
          source,
          target,
          relationship: resolution.relationship ?? "unknown",
          ticketId: `${request.id}:${key}`,
          candidate
        })
      );
      if (hits.length >= maxTargets || spec.selection?.mode === "closest") {
        break;
      }
    }
    return resolvedDeliveryResult(
      request,
      spec.type,
      hits,
      candidates.length,
      ignoredCandidates,
      blockedBy
    );
  }

  function applyHit(input: CombatHitInput): CombatHitResult {
    const targetActorId = input.target.actorId!;
    if (resolvedTickets.has(input.ticketId)) {
      traceStore.add({
        type: "hit.duplicate",
        timestamp: input.request.issuedAt ?? elapsedNow,
        requestId: input.request.id,
        projectileId: input.projectileId,
        ticketId: input.ticketId,
        sourceActorId: input.request.sourceActorId,
        targetActorId,
        targetEntityId: input.target.entityId,
        correlationId: input.request.correlationId ?? input.request.id,
        parentId: input.request.parentId
      });
      return hitResult(input, "duplicate", []);
    }
    rememberTicket(input.ticketId);
    const resolving = traceStore.add({
      type: "hit.resolving",
      timestamp: input.request.issuedAt ?? elapsedNow,
      requestId: input.request.id,
      projectileId: input.projectileId,
      ticketId: input.ticketId,
      sourceActorId: input.request.sourceActorId,
      targetActorId,
      targetEntityId: input.target.entityId,
      correlationId: input.request.correlationId ?? input.request.id,
      parentId: input.request.parentId
    });
    const payloadResults: CombatPayloadResult[] = input.payloads.map((payload) => {
      const effectTarget =
        payload.target === "source-actor" ? input.request.sourceActorId : targetActorId;
      let gas;
      try {
        gas = config.gas.applyEffect({
          effectId: payload.effectId,
          targetActorId: effectTarget,
          sourceActorId: input.request.sourceActorId,
          correlationId: input.request.correlationId ?? input.request.id,
          parentId: resolving.id
        });
      } catch (error) {
        gas = {
          status: "rejected" as const,
          effectId: payload.effectId,
          targetActorId: effectTarget,
          sourceActorId: input.request.sourceActorId,
          correlationId: input.request.correlationId ?? input.request.id,
          parentId: resolving.id,
          reason: error instanceof Error ? error.message : String(error)
        };
      }
      return {
        payload: { ...payload },
        status: gas.status === "rejected" ? ("rejected" as const) : ("applied" as const),
        gas
      };
    });
    const status = payloadResults.some((payload) => payload.status === "applied")
      ? "applied"
      : "effect-rejected";
    const result = hitResult(input, status, payloadResults);
    traceStore.add({
      type: status === "applied" ? "hit.applied" : "hit.rejected",
      timestamp: input.request.issuedAt ?? elapsedNow,
      requestId: input.request.id,
      projectileId: input.projectileId,
      ticketId: input.ticketId,
      sourceActorId: input.request.sourceActorId,
      targetActorId,
      targetEntityId: input.target.entityId,
      correlationId: input.request.correlationId ?? input.request.id,
      parentId: resolving.id,
      details: { payloadCount: payloadResults.length }
    });
    if (config.eventPolicy?.emitHits !== false) {
      config.eventBus?.emit("combat.hit_resolved", result, runtimeId, {
        correlationId: input.request.correlationId ?? input.request.id,
        parentId: resolving.id
      });
    }
    return result;
  }

  function resolveCandidateDisposition(
    requestId: string,
    deliveryType: CombatDeliverySpec["type"],
    relationshipPolicy: string,
    source: CombatSubject,
    target: CombatSubject,
    candidate: PhysicsQueryResult | undefined,
    projectileId: string | undefined
  ): CandidateResolution {
    if (target.actorId === undefined) {
      const context = candidateContext(
        requestId,
        deliveryType,
        source,
        target,
        candidate,
        projectileId
      );
      const custom = config.candidatePolicy?.evaluate(context);
      return {
        subject: target,
        decision:
          custom?.disposition === "ignore" || custom?.disposition === "blocker"
            ? custom
            : { disposition: "blocker" }
      };
    }
    const relationship = config.relationshipResolver.resolve(source, target);
    const context = candidateContext(
      requestId,
      deliveryType,
      source,
      target,
      candidate,
      projectileId,
      relationship
    );
    const allowed = config.relationshipResolver.allows(relationshipPolicy, relationship, context);
    if (allowed) {
      const custom = config.candidatePolicy?.evaluate(context);
      return {
        subject: target,
        actorId: target.actorId,
        relationship,
        decision: custom ?? { disposition: "target" }
      };
    }
    const custom = config.candidatePolicy?.evaluate(context);
    return {
      subject: target,
      actorId: target.actorId,
      relationship,
      decision:
        custom?.disposition === "blocker"
          ? custom
          : { disposition: "ignore", reason: "relationship-disallowed" }
    };
  }

  function candidateContext(
    requestId: string,
    deliveryType: CombatDeliverySpec["type"],
    source: CombatSubject,
    target: CombatSubject,
    candidate: PhysicsQueryResult | undefined,
    projectileId: string | undefined,
    relationship?: string
  ): CombatHitContext {
    return {
      requestId,
      deliveryType,
      source,
      target,
      elapsed: elapsedNow,
      ...(relationship === undefined ? {} : { relationship }),
      ...(projectileId === undefined ? {} : { projectileId }),
      ...(candidate === undefined ? {} : { candidate })
    };
  }

  function resolveActorSubject(
    actorId: string,
    actor: ReturnType<typeof config.gas.getActor>
  ): CombatSubject {
    return (
      config.subjectResolver?.resolveActor(actorId, actor) ?? defaultActorSubject(actorId, actor)
    );
  }

  function resolveQuerySubject(
    candidate: PhysicsQueryResult,
    entityIndex: PhysicsEntityIndex
  ): CombatSubject {
    const entityId =
      candidate.entityId ??
      (candidate.bodyId === undefined ? undefined : entityIndex.byBodyId.get(candidate.bodyId)) ??
      entityIndex.byColliderId.get(candidate.colliderId);
    const actor = entityId === undefined ? undefined : config.gas.actorForEntity(entityId);
    const resolvedCandidate =
      entityId === undefined || candidate.entityId !== undefined
        ? candidate
        : { ...candidate, entityId };
    const transform =
      entityId === undefined ? undefined : config.world.get(entityId, PhysicsTransformComponent);
    const fallback: CombatSubject = {
      ...(actor === undefined
        ? {}
        : { actorId: actor.actor.actorId, tags: [...actor.tags.values] }),
      ...(entityId === undefined ? {} : { entityId }),
      ...(candidate.bodyId === undefined ? {} : { bodyId: candidate.bodyId }),
      colliderId: candidate.colliderId,
      ...(transform === undefined && candidate.point === undefined
        ? {}
        : { position: cloneVector(transform?.position ?? candidate.point!) })
    };
    return config.subjectResolver?.resolveCandidate(resolvedCandidate, actor) ?? fallback;
  }

  function defaultActorSubject(
    actorId: string,
    actor: ReturnType<typeof config.gas.getActor>
  ): CombatSubject {
    const entityId = actor.actor.entityId;
    const transform =
      entityId === undefined ? undefined : config.world.get(entityId, PhysicsTransformComponent);
    const body =
      entityId === undefined ? undefined : config.world.get(entityId, PhysicsBodyComponent);
    const collider =
      entityId === undefined ? undefined : config.world.get(entityId, PhysicsColliderComponent);
    return {
      actorId,
      ...(entityId === undefined ? {} : { entityId }),
      ...(body?.bodyId === undefined ? {} : { bodyId: body.bodyId }),
      ...(collider?.colliderId === undefined ? {} : { colliderId: collider.colliderId }),
      ...(transform === undefined ? {} : { position: cloneVector(transform.position) }),
      tags: [...actor.tags.values]
    };
  }

  function update(delta: number, elapsed: number): void {
    if (disposed) {
      return;
    }
    if (!Number.isFinite(elapsed) || elapsed < 0) {
      throw new RangeError("Combat elapsed time must be a non-negative finite number");
    }
    elapsedNow = elapsed;
    projectileController.update(delta, elapsed);
  }

  function cancelProjectile(input: CombatProjectileCancellation) {
    assertActive();
    return projectileController.cancel(input);
  }

  function captureCheckpoint(): CombatRuntimeCheckpoint {
    assertActive();
    return projectileController.captureCheckpoint();
  }

  function restoreCheckpoint(
    checkpoint: CombatRuntimeCheckpoint,
    options: { resolveEntityId?(savedEntityId: EntityId): EntityId | undefined } = {}
  ): void {
    assertActive();
    projectileController.restoreCheckpoint(checkpoint, options);
    elapsedNow = checkpoint.elapsed;
    clearTransientHistory();
  }

  function snapshot() {
    return {
      elapsed: elapsedNow,
      projectiles: disposed ? [] : projectileController.list(),
      recentDeliveries: disposed
        ? []
        : deliveryOrder
            .map((id) => deliveryHistory.get(id))
            .filter((entry): entry is DeliveryHistory => entry !== undefined)
            .map((entry) => cloneDeliveryResult(entry.result)),
      resolvedTicketCount: disposed ? 0 : resolvedTickets.size,
      traces: traceStore.list(),
      disposed
    };
  }

  function dispose(): void {
    if (disposed) {
      return;
    }
    projectileController.dispose();
    clearTransientHistory();
    traceStore.clear();
    disposed = true;
  }

  function rememberTicket(ticketId: string): void {
    resolvedTickets.add(ticketId);
    resolvedTicketOrder.push(ticketId);
    while (resolvedTicketOrder.length > limits.resolvedTicketLimit) {
      resolvedTickets.delete(resolvedTicketOrder.shift()!);
    }
  }

  function remember<T extends CombatDeliveryRequestResult>(
    requestId: string,
    fingerprint: string,
    result: T
  ): T {
    deliveryHistory.set(requestId, { fingerprint, result: cloneDeliveryResult(result) });
    deliveryOrder.push(requestId);
    while (deliveryOrder.length > limits.recentDeliveryLimit) {
      deliveryHistory.delete(deliveryOrder.shift()!);
    }
    return result;
  }

  function clearTransientHistory(): void {
    deliveryHistory.clear();
    deliveryOrder.length = 0;
    resolvedTickets.clear();
    resolvedTicketOrder.length = 0;
  }

  function tryGetActor(actorId: string) {
    return config.gas.hasActor(actorId) ? config.gas.getActor(actorId) : undefined;
  }

  function reject(
    request: Pick<CombatDeliveryRequest, "id" | "correlationId" | "parentId" | "sourceActorId">,
    reason: CombatDeliveryRejectionReason,
    message: string
  ): CombatDeliveryRejection {
    const result: CombatDeliveryRejection = {
      status: "rejected",
      requestId: request.id,
      reason,
      message,
      correlationId: request.correlationId ?? request.id
    };
    traceStore.add({
      type: "delivery.rejected",
      timestamp: elapsedNow,
      requestId: request.id,
      sourceActorId: request.sourceActorId,
      correlationId: request.correlationId ?? request.id,
      parentId: request.parentId,
      message,
      details: { reason }
    });
    if (config.eventPolicy?.emitDeliveries !== false) {
      config.eventBus?.emit("combat.delivery_rejected", result, runtimeId, {
        correlationId: result.correlationId,
        parentId: request.parentId
      });
    }
    return result;
  }

  return {
    traceStore,
    deliver,
    getProjectile: (projectileId: CombatProjectileId) => projectileController.get(projectileId),
    listProjectiles: (query?: CombatProjectileQuery) => projectileController.list(query),
    cancelProjectile,
    update,
    captureCheckpoint,
    restoreCheckpoint,
    snapshot,
    dispose
  };
}

function hasSpatialContext(
  request: CombatDeliveryRequest,
  spec: Extract<CombatDeliverySpec, { type: "melee" | "hitscan" | "area" }>,
  sourcePosition: CombatSubject["position"]
): boolean {
  if (spec.type === "hitscan") {
    return (
      request.origin !== undefined || spec.origin !== undefined || isFiniteVector(sourcePosition)
    );
  }
  return (
    request.position !== undefined || spec.position !== undefined || isFiniteVector(sourcePosition)
  );
}
