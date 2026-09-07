import type { PhysicsBounds, PhysicsQueryResult, PhysicsVector } from "@gamekits/physics-core";
import type {
  CombatBlockResult,
  CombatDeliveryRequest,
  CombatDeliveryRequestResult,
  CombatHitResult,
  CombatProjectileState,
  CombatQueryOptions,
  CombatRuntimeLimits,
  CombatSubject
} from "./types";

export type ResolvedCombatRuntimeLimits = {
  maxCandidatesPerRequest: number;
  maxTargetsPerRequest: number;
  maxActiveProjectiles: number;
  maxHitsPerProjectile: number;
  maxBouncesPerProjectile: number;
  maxHitMemoryPerProjectile: number;
  maxProjectileLifetimeMs: number;
  recentDeliveryLimit: number;
  resolvedTicketLimit: number;
};

const DEFAULT_LIMITS: ResolvedCombatRuntimeLimits = {
  maxCandidatesPerRequest: 256,
  maxTargetsPerRequest: 32,
  maxActiveProjectiles: 2_048,
  maxHitsPerProjectile: 32,
  maxBouncesPerProjectile: 16,
  maxHitMemoryPerProjectile: 64,
  maxProjectileLifetimeMs: 120_000,
  recentDeliveryLimit: 256,
  resolvedTicketLimit: 8_192
};

export function resolveCombatRuntimeLimits(
  input: CombatRuntimeLimits | undefined
): ResolvedCombatRuntimeLimits {
  return {
    maxCandidatesPerRequest: readPositiveInteger(
      input?.maxCandidatesPerRequest,
      DEFAULT_LIMITS.maxCandidatesPerRequest,
      "maxCandidatesPerRequest"
    ),
    maxTargetsPerRequest: readPositiveInteger(
      input?.maxTargetsPerRequest,
      DEFAULT_LIMITS.maxTargetsPerRequest,
      "maxTargetsPerRequest"
    ),
    maxActiveProjectiles: readPositiveInteger(
      input?.maxActiveProjectiles,
      DEFAULT_LIMITS.maxActiveProjectiles,
      "maxActiveProjectiles"
    ),
    maxHitsPerProjectile: readPositiveInteger(
      input?.maxHitsPerProjectile,
      DEFAULT_LIMITS.maxHitsPerProjectile,
      "maxHitsPerProjectile"
    ),
    maxBouncesPerProjectile: readNonNegativeInteger(
      input?.maxBouncesPerProjectile,
      DEFAULT_LIMITS.maxBouncesPerProjectile,
      "maxBouncesPerProjectile"
    ),
    maxHitMemoryPerProjectile: readPositiveInteger(
      input?.maxHitMemoryPerProjectile,
      DEFAULT_LIMITS.maxHitMemoryPerProjectile,
      "maxHitMemoryPerProjectile"
    ),
    maxProjectileLifetimeMs: readPositiveFinite(
      input?.maxProjectileLifetimeMs,
      DEFAULT_LIMITS.maxProjectileLifetimeMs,
      "maxProjectileLifetimeMs"
    ),
    recentDeliveryLimit: readPositiveInteger(
      input?.recentDeliveryLimit,
      DEFAULT_LIMITS.recentDeliveryLimit,
      "recentDeliveryLimit"
    ),
    resolvedTicketLimit: readPositiveInteger(
      input?.resolvedTicketLimit,
      DEFAULT_LIMITS.resolvedTicketLimit,
      "resolvedTicketLimit"
    )
  };
}

export function cloneVector(vector: PhysicsVector): PhysicsVector {
  return {
    x: vector.x,
    y: vector.y,
    ...(vector.z === undefined ? {} : { z: vector.z })
  };
}

export function addVectors(left: PhysicsVector, right: PhysicsVector | undefined): PhysicsVector {
  if (right === undefined) {
    return cloneVector(left);
  }
  return {
    x: left.x + right.x,
    y: left.y + right.y,
    ...(left.z === undefined && right.z === undefined ? {} : { z: (left.z ?? 0) + (right.z ?? 0) })
  };
}

export function subtractVectors(left: PhysicsVector, right: PhysicsVector): PhysicsVector {
  return {
    x: left.x - right.x,
    y: left.y - right.y,
    ...(left.z === undefined && right.z === undefined ? {} : { z: (left.z ?? 0) - (right.z ?? 0) })
  };
}

export function scaleVector(vector: PhysicsVector, scalar: number): PhysicsVector {
  return {
    x: vector.x * scalar,
    y: vector.y * scalar,
    ...(vector.z === undefined ? {} : { z: vector.z * scalar })
  };
}

export function vectorLength(vector: PhysicsVector): number {
  return Math.hypot(vector.x, vector.y, vector.z ?? 0);
}

export function normalizeVector(vector: PhysicsVector): PhysicsVector | undefined {
  const length = vectorLength(vector);
  if (!Number.isFinite(length) || length <= Number.EPSILON) {
    return undefined;
  }
  return scaleVector(vector, 1 / length);
}

export function reflectVector(
  vector: PhysicsVector,
  normal: PhysicsVector | undefined
): PhysicsVector {
  const unitNormal = normal === undefined ? undefined : normalizeVector(normal);
  if (unitNormal === undefined) {
    return scaleVector(vector, -1);
  }
  const dot =
    vector.x * unitNormal.x + vector.y * unitNormal.y + (vector.z ?? 0) * (unitNormal.z ?? 0);
  return subtractVectors(vector, scaleVector(unitNormal, 2 * dot));
}

export function isFiniteVector(vector: PhysicsVector | undefined): vector is PhysicsVector {
  return (
    vector !== undefined &&
    Number.isFinite(vector.x) &&
    Number.isFinite(vector.y) &&
    (vector.z === undefined || Number.isFinite(vector.z))
  );
}

export function isInsideBounds(position: PhysicsVector, bounds: PhysicsBounds): boolean {
  return (
    position.x >= bounds.min.x &&
    position.x <= bounds.max.x &&
    position.y >= bounds.min.y &&
    position.y <= bounds.max.y &&
    (bounds.min.z === undefined || (position.z ?? 0) >= bounds.min.z) &&
    (bounds.max.z === undefined || (position.z ?? 0) <= bounds.max.z)
  );
}

export function comparePhysicsCandidates(
  left: PhysicsQueryResult,
  right: PhysicsQueryResult
): number {
  const distance = finiteDistance(left.distance) - finiteDistance(right.distance);
  if (distance !== 0) {
    return distance;
  }
  const collider = left.colliderId.localeCompare(right.colliderId);
  if (collider !== 0) {
    return collider;
  }
  const body = (left.bodyId ?? "").localeCompare(right.bodyId ?? "");
  if (body !== 0) {
    return body;
  }
  return stableId(left.entityId).localeCompare(stableId(right.entityId));
}

export function subjectKey(subject: CombatSubject): string {
  if (subject.actorId !== undefined) {
    return `actor:${subject.actorId}`;
  }
  if (subject.entityId !== undefined) {
    return `entity:${stableId(subject.entityId)}`;
  }
  if (subject.colliderId !== undefined) {
    return `collider:${subject.colliderId}`;
  }
  if (subject.bodyId !== undefined) {
    return `body:${subject.bodyId}`;
  }
  return "subject:unknown";
}

export function requestFingerprint(request: CombatDeliveryRequest): string {
  return stableSerialize(request);
}

export function cloneSubject(subject: CombatSubject): CombatSubject {
  return {
    ...(subject.actorId === undefined ? {} : { actorId: subject.actorId }),
    ...(subject.entityId === undefined ? {} : { entityId: subject.entityId }),
    ...(subject.bodyId === undefined ? {} : { bodyId: subject.bodyId }),
    ...(subject.colliderId === undefined ? {} : { colliderId: subject.colliderId }),
    ...(subject.position === undefined ? {} : { position: cloneVector(subject.position) }),
    ...(subject.tags === undefined ? {} : { tags: [...subject.tags] }),
    ...(subject.metadata === undefined ? {} : { metadata: { ...subject.metadata } })
  };
}

export function cloneQueryOptions(
  query: CombatQueryOptions | undefined
): CombatQueryOptions | undefined {
  if (query === undefined) {
    return undefined;
  }
  return {
    ...(query.filter === undefined
      ? {}
      : {
          filter: {
            ...query.filter,
            ...(query.filter.groups === undefined ? {} : { groups: [...query.filter.groups] }),
            ...(query.filter.collidesWith === undefined
              ? {}
              : { collidesWith: [...query.filter.collidesWith] })
          }
        }),
    ...(query.triggerInteraction === undefined
      ? {}
      : { triggerInteraction: query.triggerInteraction }),
    ...(query.ignoreBodies === undefined ? {} : { ignoreBodies: [...query.ignoreBodies] }),
    ...(query.ignoreColliders === undefined ? {} : { ignoreColliders: [...query.ignoreColliders] }),
    ...(query.includeBodies === undefined ? {} : { includeBodies: [...query.includeBodies] }),
    ...(query.includeColliders === undefined
      ? {}
      : { includeColliders: [...query.includeColliders] })
  };
}

export function cloneProjectile(state: CombatProjectileState): CombatProjectileState {
  return {
    ...state,
    sourceSubject: cloneSubject(state.sourceSubject),
    payloads: state.payloads.map((payload) => ({ ...payload })),
    previousPosition: cloneVector(state.previousPosition),
    ...(state.sweepShape === undefined ? {} : { sweepShape: cloneShape(state.sweepShape) }),
    hitMemory: state.hitMemory.map((entry) => ({ ...entry })),
    ...(state.query === undefined ? {} : { query: cloneQueryOptions(state.query) })
  };
}

function cloneShape(shape: NonNullable<CombatProjectileState["sweepShape"]>) {
  if (shape.type === "polygon" || shape.type === "polyline") {
    return { ...shape, points: shape.points.map(cloneVector) };
  }
  if (shape.type === "custom") {
    return { ...shape, props: { ...shape.props } };
  }
  return { ...shape };
}

export function cloneDeliveryResult(
  result: CombatDeliveryRequestResult
): CombatDeliveryRequestResult {
  if (result.status === "rejected") {
    return { ...result };
  }
  return {
    ...result,
    hits: result.hits.map(cloneHitResult),
    ...(result.projectile === undefined ? {} : { projectile: cloneProjectile(result.projectile) }),
    ...(result.blockedBy === undefined ? {} : { blockedBy: cloneBlockResult(result.blockedBy) })
  };
}

export function cloneHitResult(hit: CombatHitResult): CombatHitResult {
  return {
    ...hit,
    payloads: hit.payloads.map((payload) => ({
      payload: { ...payload.payload },
      status: payload.status,
      gas: { ...payload.gas }
    })),
    ...(hit.point === undefined ? {} : { point: cloneVector(hit.point) }),
    ...(hit.normal === undefined ? {} : { normal: cloneVector(hit.normal) })
  };
}

function cloneBlockResult(block: CombatBlockResult): CombatBlockResult {
  return {
    subject: cloneSubject(block.subject),
    ...(block.point === undefined ? {} : { point: cloneVector(block.point) }),
    ...(block.normal === undefined ? {} : { normal: cloneVector(block.normal) }),
    ...(block.distance === undefined ? {} : { distance: block.distance })
  };
}

function stableSerialize(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableSerialize).join(",")}]`;
  }
  return `{${Object.entries(value as Record<string, unknown>)
    .filter(([, entry]) => entry !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => `${JSON.stringify(key)}:${stableSerialize(entry)}`)
    .join(",")}}`;
}

function stableId(value: string | number | undefined): string {
  return value === undefined ? "" : `${typeof value}:${String(value)}`;
}

function finiteDistance(value: number | undefined): number {
  return value !== undefined && Number.isFinite(value) ? value : Number.POSITIVE_INFINITY;
}

function readPositiveInteger(value: number | undefined, fallback: number, field: string): number {
  if (value === undefined) {
    return fallback;
  }
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`Combat ${field} must be a positive integer`);
  }
  return value;
}

function readNonNegativeInteger(
  value: number | undefined,
  fallback: number,
  field: string
): number {
  if (value === undefined) {
    return fallback;
  }
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`Combat ${field} must be a non-negative integer`);
  }
  return value;
}

function readPositiveFinite(value: number | undefined, fallback: number, field: string): number {
  if (value === undefined) {
    return fallback;
  }
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`Combat ${field} must be a positive finite number`);
  }
  return value;
}
