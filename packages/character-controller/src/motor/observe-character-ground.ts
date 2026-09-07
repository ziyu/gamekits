import type {
  PhysicsBodyState,
  PhysicsQuery,
  PhysicsQueryResult,
  PhysicsVector
} from "@gamekits/physics-core";
import type { CharacterMotorObservation, CompiledCharacterMotorDefinition } from "../contracts";

export type CharacterGroundProbeSimulation = {
  query(query: PhysicsQuery): PhysicsQueryResult[];
  body?(bodyId: string): PhysicsBodyState | undefined;
};

export type ObserveCharacterGroundOptions = {
  body: Readonly<PhysicsBodyState>;
  definition: CompiledCharacterMotorDefinition;
  simulation: CharacterGroundProbeSimulation;
  ignoreBodyIds?: readonly string[] | undefined;
  ignoreColliderIds?: readonly string[] | undefined;
  surfaceId?(hit: Readonly<PhysicsQueryResult>): string | undefined;
};

/** Produces a stable backend-neutral ground fact for the pure character motor. */
export function observeCharacterGround(
  options: ObserveCharacterGroundOptions
): CharacterMotorObservation {
  const probeLift = Math.min(
    options.definition.groundSnapDistance,
    options.definition.groundProbeDistance
  );
  const queryOptions = {
    triggerInteraction: "exclude" as const,
    mode: "closest" as const,
    sort: "distance" as const,
    maxResults: 1,
    ignoreBodies: uniqueSorted([options.body.id, ...(options.ignoreBodyIds ?? [])]),
    ignoreColliders: uniqueSorted(options.ignoreColliderIds ?? [])
  };
  const hits = options.simulation
    .query({
      type: "shape-cast",
      shape: {
        type: "capsule",
        radius: options.definition.capsuleRadius,
        height: Math.max(
          0.001,
          options.definition.capsuleHeight - options.definition.capsuleRadius * 2
        )
      },
      position: {
        ...cloneVector(options.body.position),
        y: options.body.position.y + probeLift
      },
      direction: { x: 0, y: -1, z: 0 },
      maxDistance: options.definition.groundProbeDistance + probeLift,
      stopAtPenetration: true,
      options: queryOptions
    })
    .sort(compareHit);
  const primary = firstStableHit(hits);
  if (primary.hit === undefined) {
    return {
      queryCount: 1,
      rejectedQueryCount: primary.rejected
    };
  }
  if (isWalkable(primary.hit.normal!, options.definition.maxSlopeRadians)) {
    return groundObservation(options, primary.hit, probeLift, 1, primary.rejected);
  }

  // A capsule touching a wall can make a closest-only shape cast report that
  // side face at distance zero and hide the floor beneath it. Probe from the
  // foot center to recover only a valid upward support; keep the primary hit
  // when the fallback is empty or still too steep so rejection stays explicit.
  const halfHeight = options.definition.capsuleHeight / 2;
  const support = firstStableHit(
    options.simulation
      .query({
        type: "raycast",
        origin: {
          x: options.body.position.x,
          y: options.body.position.y - halfHeight + probeLift,
          z: options.body.position.z ?? 0
        },
        direction: { x: 0, y: -1, z: 0 },
        maxDistance: options.definition.groundProbeDistance + probeLift,
        options: queryOptions
      })
      .sort(compareHit)
  );
  const rejectedQueryCount = primary.rejected + 1 + support.rejected;
  if (
    support.hit !== undefined &&
    isWalkable(support.hit.normal!, options.definition.maxSlopeRadians)
  ) {
    return groundObservation(options, support.hit, probeLift, 2, rejectedQueryCount);
  }
  return groundObservation(
    options,
    primary.hit,
    probeLift,
    2,
    rejectedQueryCount + Number(support.hit !== undefined)
  );
}

function groundObservation(
  options: ObserveCharacterGroundOptions,
  hit: Readonly<PhysicsQueryResult>,
  probeLift: number,
  queryCount: number,
  rejectedQueryCount: number
): CharacterMotorObservation {
  const body = hit.bodyId === undefined ? undefined : options.simulation.body?.(hit.bodyId);
  return {
    ground: {
      distance: Math.max(0, finiteNonNegative(hit.distance) - probeLift),
      normal: cloneVector(hit.normal!),
      bodyId: hit.bodyId,
      bodyLinearVelocity: body?.linearVelocity,
      surfaceId: options.surfaceId?.(hit) ?? hit.colliderId
    },
    queryCount,
    rejectedQueryCount
  };
}

function firstStableHit(hits: readonly PhysicsQueryResult[]): {
  hit?: PhysicsQueryResult | undefined;
  rejected: number;
} {
  let rejected = 0;
  for (const hit of hits) {
    if (hit.sensor === true || !finiteVector(hit.normal)) {
      rejected += 1;
      continue;
    }
    return { hit, rejected };
  }
  return { rejected };
}

function isWalkable(normal: PhysicsVector, maxSlopeRadians: number): boolean {
  const length = Math.sqrt(normal.x ** 2 + normal.y ** 2 + (normal.z ?? 0) ** 2);
  if (length <= 1e-6) return false;
  return Math.acos(Math.max(-1, Math.min(1, normal.y / length))) <= maxSlopeRadians;
}

function compareHit(left: PhysicsQueryResult, right: PhysicsQueryResult): number {
  const distance = finiteNonNegative(left.distance) - finiteNonNegative(right.distance);
  return distance === 0 ? left.colliderId.localeCompare(right.colliderId) : distance;
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values.filter((value) => value.length > 0))].sort();
}

function finiteVector(value: PhysicsVector | undefined): value is PhysicsVector {
  return (
    value !== undefined &&
    Number.isFinite(value.x) &&
    Number.isFinite(value.y) &&
    (value.z === undefined || Number.isFinite(value.z))
  );
}

function finiteNonNegative(value: number | undefined): number {
  return value !== undefined && Number.isFinite(value) && value >= 0 ? value : 0;
}

function cloneVector(value: Readonly<PhysicsVector>): PhysicsVector {
  return {
    x: value.x,
    y: value.y,
    ...(value.z === undefined ? {} : { z: value.z })
  };
}
