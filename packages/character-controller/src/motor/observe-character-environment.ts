import type { PhysicsQuery, PhysicsQueryResult, PhysicsVector } from "@gamekits/physics-core";

import type { CharacterControlIntent, CharacterMotorObservation } from "../contracts";
import {
  observeCharacterGround,
  type ObserveCharacterGroundOptions
} from "./observe-character-ground";

export type ObserveCharacterEnvironmentOptions = ObserveCharacterGroundOptions & {
  intent: Readonly<CharacterControlIntent>;
};

/** Produces stable ground, step, and ceiling facts for the pure character motor. */
export function observeCharacterEnvironment(
  options: ObserveCharacterEnvironmentOptions
): CharacterMotorObservation {
  const ground = observeCharacterGround(options);
  let queryCount = ground.queryCount ?? 0;
  let rejectedQueryCount = ground.rejectedQueryCount ?? 0;
  const observation: CharacterMotorObservation = { ...ground };
  const queryOptions = {
    triggerInteraction: "exclude" as const,
    mode: "closest" as const,
    sort: "distance" as const,
    maxResults: 1,
    ignoreBodies: uniqueSorted([options.body.id, ...(options.ignoreBodyIds ?? [])]),
    ignoreColliders: uniqueSorted(options.ignoreColliderIds ?? [])
  };
  const direction = normalizedHorizontal(options.intent.move);

  if (lengthSquared(direction) > 0) {
    const step = observeStep(options, direction, queryOptions);
    queryCount += step.queryCount;
    rejectedQueryCount += step.rejectedQueryCount;
    if (step.observation !== undefined) observation.step = step.observation;
  }

  if (options.intent.jumpHeld && options.body.linearVelocity.y > 0) {
    queryCount += 1;
    const halfHeight = options.definition.capsuleHeight / 2;
    const hits = stableHits(
      options.simulation.query({
        type: "raycast",
        origin: {
          x: options.body.position.x,
          y: options.body.position.y + halfHeight + 0.001,
          z: options.body.position.z ?? 0
        },
        direction: { x: 0, y: 1, z: 0 },
        maxDistance: options.definition.ceilingClearance,
        options: queryOptions
      })
    );
    const ceiling = firstStableHit(hits);
    rejectedQueryCount += ceiling.rejected;
    observation.ceilingBlocked = ceiling.hit !== undefined;
  }

  observation.queryCount = queryCount;
  observation.rejectedQueryCount = rejectedQueryCount;
  return observation;
}

function observeStep(
  options: ObserveCharacterEnvironmentOptions,
  direction: PhysicsVector,
  queryOptions: NonNullable<Extract<PhysicsQuery, { type: "raycast" }>["options"]>
): {
  observation?: CharacterMotorObservation["step"] | undefined;
  queryCount: number;
  rejectedQueryCount: number;
} {
  const halfHeight = options.definition.capsuleHeight / 2;
  const footY = options.body.position.y - halfHeight;
  const forwardDistance = options.definition.capsuleRadius + options.definition.stepHeight;
  const lowOrigin = {
    x: options.body.position.x,
    y: footY + Math.max(0.04, options.definition.stepHeight * 0.35),
    z: options.body.position.z ?? 0
  };
  const low = firstStableHit(
    stableHits(
      options.simulation.query({
        type: "raycast",
        origin: lowOrigin,
        direction,
        maxDistance: forwardDistance,
        options: queryOptions
      })
    )
  );
  let rejectedQueryCount = low.rejected;
  if (low.hit === undefined || isWalkable(low.hit.normal, options.definition.maxSlopeRadians)) {
    return { queryCount: 1, rejectedQueryCount };
  }

  const high = firstStableHit(
    stableHits(
      options.simulation.query({
        type: "raycast",
        origin: {
          ...lowOrigin,
          y: footY + options.definition.stepHeight + options.definition.ceilingClearance
        },
        direction,
        maxDistance: forwardDistance,
        options: queryOptions
      })
    )
  );
  rejectedQueryCount += high.rejected;
  if (high.hit !== undefined) {
    return { queryCount: 2, rejectedQueryCount };
  }

  const landingForwardDistance =
    finiteNonNegative(low.hit.distance) + options.definition.capsuleRadius + 0.02;
  const landingOrigin = {
    x: options.body.position.x + direction.x * landingForwardDistance,
    y:
      footY +
      options.definition.stepHeight +
      options.definition.groundProbeDistance +
      options.definition.groundSnapDistance,
    z: (options.body.position.z ?? 0) + (direction.z ?? 0) * landingForwardDistance
  };
  const landing = firstStableHit(
    stableHits(
      options.simulation.query({
        type: "raycast",
        origin: landingOrigin,
        direction: { x: 0, y: -1, z: 0 },
        maxDistance:
          options.definition.stepHeight +
          options.definition.groundProbeDistance +
          options.definition.groundSnapDistance,
        options: queryOptions
      })
    )
  );
  rejectedQueryCount += landing.rejected;
  if (landing.hit?.point === undefined) {
    return { queryCount: 3, rejectedQueryCount };
  }
  const height = landing.hit.point.y - footY;
  if (
    height <= 0 ||
    height > options.definition.stepHeight + 1e-4 ||
    !isWalkable(landing.hit.normal, options.definition.maxSlopeRadians)
  ) {
    return { queryCount: 3, rejectedQueryCount };
  }
  const clearanceHits = options.simulation.query({
    type: "check",
    shape: {
      type: "capsule",
      radius: options.definition.capsuleRadius,
      height: Math.max(
        0.001,
        options.definition.capsuleHeight - options.definition.capsuleRadius * 2
      )
    },
    position: {
      x: options.body.position.x,
      y: options.body.position.y + height + 0.005,
      z: options.body.position.z ?? 0
    },
    options: {
      ...queryOptions,
      mode: "any",
      ignoreColliders: uniqueSorted([
        ...(queryOptions.ignoreColliders ?? []),
        landing.hit.colliderId
      ])
    }
  });
  if (clearanceHits.some((hit) => hit.sensor !== true)) {
    return { queryCount: 4, rejectedQueryCount };
  }
  return {
    observation: {
      height,
      landingNormal: cloneVector(landing.hit.normal!),
      clearance: true
    },
    queryCount: 4,
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

function stableHits(hits: readonly PhysicsQueryResult[]): PhysicsQueryResult[] {
  return [...hits].sort((left, right) => {
    const distance = finiteNonNegative(left.distance) - finiteNonNegative(right.distance);
    return distance === 0 ? left.colliderId.localeCompare(right.colliderId) : distance;
  });
}

function isWalkable(normal: PhysicsVector | undefined, maxSlopeRadians: number): boolean {
  if (!finiteVector(normal)) return false;
  const normalized = normalize(normal);
  return Math.acos(Math.max(-1, Math.min(1, normalized.y))) <= maxSlopeRadians;
}

function normalizedHorizontal(vector: Readonly<PhysicsVector>): PhysicsVector {
  return normalize({ x: vector.x, y: 0, z: vector.z ?? 0 });
}

function normalize(vector: Readonly<PhysicsVector>): PhysicsVector {
  const length = Math.sqrt(lengthSquared(vector));
  if (length <= 1e-6) return { x: 0, y: 0, z: 0 };
  return {
    x: vector.x / length,
    y: vector.y / length,
    z: (vector.z ?? 0) / length
  };
}

function lengthSquared(vector: Readonly<PhysicsVector>): number {
  return vector.x ** 2 + vector.y ** 2 + (vector.z ?? 0) ** 2;
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
  return { x: value.x, y: value.y, z: value.z ?? 0 };
}
