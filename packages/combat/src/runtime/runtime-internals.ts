import type {
  PhysicsColliderData,
  PhysicsQueryOptions,
  PhysicsQueryResult,
  PhysicsVector
} from "@gamekits/physics-core";
import { PhysicsBodyComponent, PhysicsColliderComponent } from "@gamekits/physics-core";
import type { EntityId, GameWorld } from "@gamekits/world";
import type {
  CombatBlockResult,
  CombatCandidateDecision,
  CombatDeliveryDefinition,
  CombatDeliveryRejection,
  CombatDeliveryRequest,
  CombatDeliveryRequestResult,
  CombatDeliveryResult,
  CombatDeliverySpec,
  CombatHitResult,
  CombatPayloadResult,
  CombatPayloadSpec,
  CombatProjectileState,
  CombatQueryOptions,
  CombatSubject
} from "./types";
import { cloneProjectile, cloneSubject, cloneVector, isFiniteVector } from "./runtime-helpers";
import { createCombatError } from "./errors";

export type ResolvedDelivery = {
  spec: CombatDeliverySpec;
  payloads: CombatPayloadSpec[];
  relationshipPolicy: string;
};

export type DeliveryHistory = {
  fingerprint: string;
  result: CombatDeliveryRequestResult;
};

export type CandidateResolution = {
  decision: CombatCandidateDecision;
  relationship?: string | undefined;
  subject: CombatSubject;
  actorId?: string | undefined;
};

export type PhysicsEntityIndex = {
  byBodyId: Map<string, EntityId>;
  byColliderId: Map<string, EntityId>;
};

export type CombatHitInput = {
  request: CombatDeliveryRequest;
  deliveryType: CombatDeliverySpec["type"];
  relationshipPolicy: string;
  payloads: CombatPayloadSpec[];
  source: CombatSubject;
  target: CombatSubject;
  relationship: string;
  ticketId: string;
  candidate?: PhysicsQueryResult | undefined;
  projectileId?: string | undefined;
};

export function resolvedDeliveryResult(
  request: CombatDeliveryRequest,
  deliveryType: CombatDeliverySpec["type"],
  hits: CombatHitResult[],
  queriedCandidates: number,
  ignoredCandidates: number,
  blockedBy?: CombatBlockResult,
  projectile?: CombatProjectileState
): CombatDeliveryResult {
  return {
    status: "resolved",
    duplicate: false,
    requestId: request.id,
    deliveryType,
    hits,
    queriedCandidates,
    ignoredCandidates,
    ...(projectile === undefined ? {} : { projectile: cloneProjectile(projectile) }),
    ...(blockedBy === undefined ? {} : { blockedBy }),
    correlationId: request.correlationId ?? request.id
  };
}

export function createBlockResult(
  subject: CombatSubject,
  candidate: PhysicsQueryResult
): CombatBlockResult {
  return {
    subject: cloneSubject(subject),
    ...(candidate.point === undefined ? {} : { point: cloneVector(candidate.point) }),
    ...(candidate.normal === undefined ? {} : { normal: cloneVector(candidate.normal) }),
    ...(candidate.distance === undefined ? {} : { distance: candidate.distance })
  };
}

export function withSourceIgnored(
  query: CombatQueryOptions | undefined,
  source: CombatSubject,
  ownBodyId?: string,
  ownColliderId?: string
): PhysicsQueryOptions {
  return {
    ...(query?.filter === undefined ? {} : { filter: query.filter }),
    ...(query?.triggerInteraction === undefined
      ? {}
      : { triggerInteraction: query.triggerInteraction }),
    ignoreBodies: uniqueStrings([
      ...(query?.ignoreBodies ?? []),
      ...(source.bodyId === undefined ? [] : [source.bodyId]),
      ...(ownBodyId === undefined ? [] : [ownBodyId])
    ]),
    ignoreColliders: uniqueStrings([
      ...(query?.ignoreColliders ?? []),
      ...(source.colliderId === undefined ? [] : [source.colliderId]),
      ...(ownColliderId === undefined ? [] : [ownColliderId])
    ]),
    ...(query?.includeBodies === undefined ? {} : { includeBodies: [...query.includeBodies] }),
    ...(query?.includeColliders === undefined
      ? {}
      : { includeColliders: [...query.includeColliders] })
  };
}

export function requiredPosition(position: PhysicsVector | undefined): PhysicsVector {
  if (!isFiniteVector(position)) {
    throw createCombatError(
      "combat.delivery_position_missing",
      "Combat spatial delivery requires a source or explicit position"
    );
  }
  return position;
}

export function clonePhysicsShape<T extends PhysicsColliderData["shape"]>(shape: T): T {
  if (shape.type === "polygon" || shape.type === "polyline") {
    return { ...shape, points: shape.points.map(cloneVector) } as T;
  }
  if (shape.type === "custom") {
    return { ...shape, props: { ...shape.props } } as T;
  }
  return { ...shape };
}

export function vectorsEqual(left: PhysicsVector, right: PhysicsVector): boolean {
  return left.x === right.x && left.y === right.y && (left.z ?? 0) === (right.z ?? 0);
}

export function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function validateResolvedDelivery(
  spec: CombatDeliverySpec,
  payloads: CombatPayloadSpec[]
): string | undefined {
  if (
    !spec ||
    !(
      spec.type === "direct" ||
      spec.type === "melee" ||
      spec.type === "hitscan" ||
      spec.type === "area" ||
      spec.type === "projectile"
    )
  ) {
    return "Combat delivery type is invalid";
  }
  if (spec.type !== "projectile" && payloads.length === 0) {
    return "Combat delivery requires at least one payload";
  }
  for (const payload of payloads) {
    if (
      !nonEmpty(payload.effectId) ||
      (payload.target !== "hit-actor" && payload.target !== "source-actor")
    ) {
      return "Combat delivery payload is invalid";
    }
  }
  if (spec.type === "hitscan" && (!Number.isFinite(spec.range) || spec.range <= 0)) {
    return "Combat hitscan range must be positive";
  }
  if (
    spec.type === "hitscan" &&
    spec.radius !== undefined &&
    (!Number.isFinite(spec.radius) || spec.radius < 0)
  ) {
    return "Combat hitscan radius must be non-negative";
  }
  if (
    "selection" in spec &&
    spec.selection?.maxTargets !== undefined &&
    (!Number.isSafeInteger(spec.selection.maxTargets) || spec.selection.maxTargets <= 0)
  ) {
    return "Combat delivery maxTargets must be a positive integer";
  }
  return undefined;
}

export function createPhysicsEntityIndex(world: GameWorld): PhysicsEntityIndex {
  const index: PhysicsEntityIndex = {
    byBodyId: new Map(),
    byColliderId: new Map()
  };
  for (const entityId of world.query([PhysicsBodyComponent])) {
    const bodyId = world.get(entityId, PhysicsBodyComponent)?.bodyId;
    if (bodyId !== undefined) {
      index.byBodyId.set(bodyId, entityId);
    }
  }
  for (const entityId of world.query([PhysicsColliderComponent])) {
    const colliderId = world.get(entityId, PhysicsColliderComponent)?.colliderId;
    if (colliderId !== undefined) {
      index.byColliderId.set(colliderId, entityId);
    }
  }
  return index;
}

export function hitResult(
  input: CombatHitInput,
  status: CombatHitResult["status"],
  payloads: CombatPayloadResult[]
): CombatHitResult {
  return {
    ticketId: input.ticketId,
    status,
    sourceActorId: input.request.sourceActorId,
    targetActorId: input.target.actorId!,
    ...(input.target.entityId === undefined ? {} : { targetEntityId: input.target.entityId }),
    relationship: input.relationship,
    ...(input.projectileId === undefined ? {} : { projectileId: input.projectileId }),
    ...(input.candidate?.point === undefined ? {} : { point: cloneVector(input.candidate.point) }),
    ...(input.candidate?.normal === undefined
      ? {}
      : { normal: cloneVector(input.candidate.normal) }),
    ...(input.candidate?.distance === undefined ? {} : { distance: input.candidate.distance }),
    payloads
  };
}

export function isDeliveryRejection(
  value: ResolvedDelivery | CombatDeliveryRejection
): value is CombatDeliveryRejection {
  return "reason" in value;
}

export function definitionDelivery(definition: CombatDeliveryDefinition): ResolvedDelivery {
  return {
    spec: definition.delivery,
    payloads: definition.payloads.map((payload) => ({ ...payload })),
    relationshipPolicy: definition.relationshipPolicy
  };
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}
