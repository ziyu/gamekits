import {
  sweepPhysicsKinematicStep,
  type PhysicsKinematicSweepQueries,
  type PhysicsQueryResult,
  type PhysicsVector
} from "@gamekits/physics-core";
import {
  cloneCombatKinematicProjectileRecord,
  createCombatKinematicProjectileRecordBuffer,
  type CombatKinematicProjectileRecordUpsertResult
} from "./projectile-record-buffer";
import type {
  CombatKinematicProjectileActiveState,
  CombatKinematicProjectileAdvanceResult,
  CombatKinematicProjectileDefinition,
  CombatKinematicProjectileFinish,
  CombatKinematicProjectileFireInput,
  CombatKinematicProjectileFireResult,
  CombatKinematicProjectileHitResolver,
  CombatKinematicProjectileReconciliation,
  CombatKinematicProjectileReconciliationOptions,
  CombatKinematicProjectileRecord,
  CombatKinematicProjectileRuntimeDiagnostics,
  CombatKinematicProjectileSample
} from "./projectile-network-types";

export type CombatKinematicProjectileRuntimeOptions = {
  queries: PhysicsKinematicSweepQueries;
  generation: string | number;
  fixedDeltaMs: number;
  maxActiveProjectiles?: number | undefined;
  maxRecords?: number | undefined;
  maxCatchUpTicksPerAdvance?: number | undefined;
  resolveDefinition(
    definitionId: string,
    definitionVersion: string
  ): CombatKinematicProjectileDefinition | undefined;
  resolveSubject?: CombatKinematicProjectileHitResolver | undefined;
};

export type CombatKinematicProjectileRuntime = {
  fire(input: CombatKinematicProjectileFireInput): CombatKinematicProjectileFireResult;
  advanceTo(targetTick: number): CombatKinematicProjectileAdvanceResult;
  applyAuthorityRecord(
    record: CombatKinematicProjectileRecord
  ): CombatKinematicProjectileRecordUpsertResult;
  cancel(projectileId: string, tick: number, reason?: string): boolean;
  getRecord(projectileId: string): CombatKinematicProjectileRecord | undefined;
  listRecords(): CombatKinematicProjectileRecord[];
  listActive(): CombatKinematicProjectileActiveState[];
  sample(projectileId: string, tick: number): CombatKinematicProjectileSample | undefined;
  reset(generation: string | number): void;
  diagnostics(): CombatKinematicProjectileRuntimeDiagnostics;
  dispose(): void;
};

const DEFAULT_MAX_ACTIVE_PROJECTILES = 256;
const DEFAULT_MAX_RECORDS = 512;
const DEFAULT_MAX_CATCH_UP_TICKS = 32;

export function createCombatKinematicProjectileRuntime(
  options: CombatKinematicProjectileRuntimeOptions
): CombatKinematicProjectileRuntime {
  if (!Number.isFinite(options.fixedDeltaMs) || options.fixedDeltaMs <= 0) {
    throw new Error("Combat kinematic projectile fixedDeltaMs must be positive and finite.");
  }
  const maxActiveProjectiles = normalizePositiveInteger(
    options.maxActiveProjectiles,
    DEFAULT_MAX_ACTIVE_PROJECTILES
  );
  const maxRecords = Math.max(
    maxActiveProjectiles,
    normalizePositiveInteger(options.maxRecords, DEFAULT_MAX_RECORDS)
  );
  const maxCatchUpTicksPerAdvance = normalizePositiveInteger(
    options.maxCatchUpTicksPerAdvance,
    DEFAULT_MAX_CATCH_UP_TICKS
  );
  const recordBuffer = createCombatKinematicProjectileRecordBuffer({
    generation: options.generation,
    capacity: maxRecords
  });
  const active = new Map<string, CombatKinematicProjectileActiveState>();
  let generation = options.generation;
  let disposed = false;
  const diagnostics: Omit<
    CombatKinematicProjectileRuntimeDiagnostics,
    "generation" | "active" | "records" | "recordBuffer"
  > = {
    fired: 0,
    rejected: 0,
    physicsSweeps: 0,
    impacts: 0,
    expired: 0,
    cancelled: 0,
    catchUpLimited: 0
  };

  return {
    fire(input) {
      assertActive();
      validateFireInput(input);
      if (input.generation !== generation) {
        diagnostics.rejected += 1;
        return { status: "stale-generation" };
      }
      if (
        active.size >= maxActiveProjectiles &&
        recordBuffer.get(input.projectileId) === undefined
      ) {
        diagnostics.rejected += 1;
        return { status: "capacity" };
      }
      const definition = options.resolveDefinition(input.definitionId, input.definitionVersion);
      if (definition === undefined || !validDefinition(definition, input)) {
        diagnostics.rejected += 1;
        return { status: "invalid-definition" };
      }
      const record: CombatKinematicProjectileRecord = {
        projectileId: input.projectileId,
        correlationId: input.correlationId,
        generation: input.generation,
        definitionId: input.definitionId,
        definitionVersion: input.definitionVersion,
        fireTick: input.fireTick,
        fixedDeltaMs: options.fixedDeltaMs,
        firePosition: cloneVector(input.firePosition),
        fireVelocity: cloneVector(input.fireVelocity),
        expiresTick: input.fireTick + definition.lifetimeTicks
      };
      const upsert = recordBuffer.upsert(record);
      if (upsert.evicted !== undefined) {
        active.delete(upsert.evicted.projectileId);
      }
      if (upsert.status === "stale-generation") {
        diagnostics.rejected += 1;
        return { status: "stale-generation" };
      }
      if (upsert.status === "conflict") {
        diagnostics.rejected += 1;
        return { status: "conflict", record: upsert.record };
      }
      if (upsert.status === "duplicate") {
        return { status: "duplicate", record: upsert.record };
      }
      active.set(input.projectileId, {
        record: cloneCombatKinematicProjectileRecord(record),
        tick: input.fireTick,
        position: cloneVector(input.firePosition)
      });
      diagnostics.fired += 1;
      return { status: "fired", record: cloneCombatKinematicProjectileRecord(record) };
    },
    advanceTo(targetTick) {
      assertActive();
      if (!Number.isSafeInteger(targetTick)) {
        throw new Error("Combat kinematic projectile target tick must be a safe integer.");
      }
      const finished: CombatKinematicProjectileRecord[] = [];
      let advancedTicks = 0;
      let catchUpLimited = 0;
      for (const projectileId of [...active.keys()].sort()) {
        const state = active.get(projectileId);
        if (state === undefined || targetTick <= state.tick) {
          continue;
        }
        const definition = options.resolveDefinition(
          state.record.definitionId,
          state.record.definitionVersion
        );
        if (definition === undefined || !validDefinition(definition, state.record)) {
          const record = finishState(state, {
            tick: state.tick,
            reason: "rejected",
            position: cloneVector(state.position)
          });
          diagnostics.rejected += 1;
          finished.push(record);
          continue;
        }
        let steps = 0;
        while (
          active.has(projectileId) &&
          state.tick < targetTick &&
          steps < maxCatchUpTicksPerAdvance
        ) {
          const nextTick = state.tick + 1;
          const result = sweepPhysicsKinematicStep({
            queries: options.queries,
            mode: definition.collisionMode === "shape-sweep" ? "shape" : "ray",
            position: state.position,
            velocity: state.record.fireVelocity,
            deltaMs: options.fixedDeltaMs,
            ...(definition.sweepShape === undefined ? {} : { shape: definition.sweepShape }),
            ...(definition.rotation === undefined ? {} : { rotation: definition.rotation }),
            ...(definition.query === undefined ? {} : { query: definition.query })
          });
          diagnostics.physicsSweeps += 1;
          advancedTicks += 1;
          steps += 1;
          state.tick = nextTick;
          state.position = cloneVector(result.position);
          if (result.hit !== undefined) {
            const record = finishState(state, {
              tick: nextTick,
              reason: "impact",
              position: cloneVector(result.position),
              ...(result.hit.normal === undefined
                ? {}
                : { normal: cloneVector(result.hit.normal) }),
              subject: resolveSubject(result.hit, state.record)
            });
            diagnostics.impacts += 1;
            finished.push(record);
            break;
          }
          if (nextTick >= state.record.expiresTick) {
            const record = finishState(state, {
              tick: nextTick,
              reason: "expired",
              position: cloneVector(state.position)
            });
            diagnostics.expired += 1;
            finished.push(record);
            break;
          }
        }
        if (active.has(projectileId) && state.tick < targetTick) {
          catchUpLimited += 1;
          diagnostics.catchUpLimited += 1;
        }
      }
      return { targetTick, advancedTicks, finished, catchUpLimited };
    },
    applyAuthorityRecord(record) {
      assertActive();
      const result = recordBuffer.upsert(record);
      if (result.evicted !== undefined) {
        active.delete(result.evicted.projectileId);
      }
      if (
        record.finish !== undefined &&
        result.status !== "conflict" &&
        result.status !== "stale-generation"
      ) {
        active.delete(record.projectileId);
      }
      return result;
    },
    cancel(projectileId, tick, reason = "cancelled") {
      assertActive();
      if (!Number.isSafeInteger(tick)) {
        throw new Error("Combat kinematic projectile cancel tick must be a safe integer.");
      }
      const state = active.get(projectileId);
      if (state === undefined) {
        return false;
      }
      finishState(state, {
        tick: Math.max(state.tick, Math.min(state.record.expiresTick, tick)),
        reason,
        position: cloneVector(state.position)
      });
      diagnostics.cancelled += 1;
      return true;
    },
    getRecord(projectileId) {
      assertActive();
      return recordBuffer.get(projectileId);
    },
    listRecords() {
      assertActive();
      return recordBuffer.list();
    },
    listActive() {
      assertActive();
      return [...active.values()]
        .sort((left, right) => left.record.projectileId.localeCompare(right.record.projectileId))
        .map(cloneActiveState);
    },
    sample(projectileId, tick) {
      assertActive();
      const record = recordBuffer.get(projectileId);
      return record === undefined ? undefined : sampleCombatKinematicProjectileRecord(record, tick);
    },
    reset(nextGeneration) {
      assertActive();
      generation = nextGeneration;
      active.clear();
      recordBuffer.reset(nextGeneration);
    },
    diagnostics() {
      const bufferDiagnostics = recordBuffer.diagnostics();
      return {
        ...diagnostics,
        generation,
        active: active.size,
        records: bufferDiagnostics.records,
        recordBuffer: bufferDiagnostics
      };
    },
    dispose() {
      if (disposed) {
        return;
      }
      disposed = true;
      active.clear();
      recordBuffer.dispose();
    }
  };

  function finishState(
    state: CombatKinematicProjectileActiveState,
    finish: CombatKinematicProjectileFinish
  ): CombatKinematicProjectileRecord {
    const record: CombatKinematicProjectileRecord = {
      ...cloneCombatKinematicProjectileRecord(state.record),
      finish: cloneFinish(finish)
    };
    const result = recordBuffer.upsert(record);
    if (result.status === "conflict" || result.status === "stale-generation") {
      throw new Error(`Combat kinematic projectile finish was rejected: ${result.status}`);
    }
    active.delete(state.record.projectileId);
    return result.record ?? cloneCombatKinematicProjectileRecord(record);
  }

  function resolveSubject(hit: PhysicsQueryResult, record: CombatKinematicProjectileRecord) {
    const resolved = options.resolveSubject?.(hit, record);
    if (resolved !== undefined) {
      return { ...resolved };
    }
    return {
      ...(hit.entityId === undefined ? {} : { entityId: hit.entityId }),
      ...(hit.bodyId === undefined ? {} : { bodyId: hit.bodyId }),
      colliderId: hit.colliderId
    };
  }

  function assertActive(): void {
    if (disposed) {
      throw new Error("Combat kinematic projectile runtime has been disposed.");
    }
  }
}

export function sampleCombatKinematicProjectileRecord(
  record: CombatKinematicProjectileRecord,
  tick: number
): CombatKinematicProjectileSample {
  if (!Number.isFinite(tick)) {
    throw new Error("Combat kinematic projectile sample tick must be finite.");
  }
  const finishTick = record.finish?.tick ?? record.expiresTick;
  const sampledTick = Math.max(record.fireTick, Math.min(finishTick, tick));
  if (record.finish !== undefined && tick >= record.finish.tick) {
    return {
      projectileId: record.projectileId,
      tick: sampledTick,
      position: cloneVector(record.finish.position),
      active: false,
      finish: cloneFinish(record.finish)
    };
  }
  const seconds = ((sampledTick - record.fireTick) * record.fixedDeltaMs) / 1000;
  return {
    projectileId: record.projectileId,
    tick: sampledTick,
    position: addScaledVector(record.firePosition, record.fireVelocity, seconds),
    active: sampledTick < record.expiresTick
  };
}

export function reconcileCombatKinematicProjectileRecords(
  predicted: CombatKinematicProjectileRecord,
  authoritative: CombatKinematicProjectileRecord,
  epsilonOrOptions: number | CombatKinematicProjectileReconciliationOptions = 0.001
): CombatKinematicProjectileReconciliation {
  const options =
    typeof epsilonOrOptions === "number" ? { epsilon: epsilonOrOptions } : epsilonOrOptions;
  const timeline = options.timeline ?? "absolute";
  const epsilon = normalizeNonNegativeNumber(options.epsilon, 0.001);
  const firePositionTolerance = normalizeNonNegativeNumber(options.firePositionTolerance, epsilon);
  const fireVelocityTolerance = normalizeNonNegativeNumber(
    options.fireVelocityTolerance,
    options.fireSpeedTolerance !== undefined || options.fireDirectionToleranceRadians !== undefined
      ? Number.POSITIVE_INFINITY
      : epsilon
  );
  const fireSpeedTolerance = normalizeNonNegativeNumber(
    options.fireSpeedTolerance,
    Number.POSITIVE_INFINITY
  );
  const fireDirectionToleranceRadians = normalizeNonNegativeNumber(
    options.fireDirectionToleranceRadians,
    Number.POSITIVE_INFINITY
  );
  const finishPositionTolerance = normalizeNonNegativeNumber(
    options.finishPositionTolerance,
    epsilon
  );
  const finishTickTolerance = normalizeNonNegativeNumber(options.finishTickTolerance, 0);
  const fireTickError = Math.abs(predicted.fireTick - authoritative.fireTick);
  const firePositionError = vectorDistance(predicted.firePosition, authoritative.firePosition);
  const fireVelocityError = vectorDistance(predicted.fireVelocity, authoritative.fireVelocity);
  const predictedSpeed = vectorLength(predicted.fireVelocity);
  const authoritySpeed = vectorLength(authoritative.fireVelocity);
  const fireSpeedError = Math.abs(predictedSpeed - authoritySpeed);
  const fireDirectionErrorRadians = vectorDirectionErrorRadians(
    predicted.fireVelocity,
    authoritative.fireVelocity
  );
  const finishPositionError =
    predicted.finish === undefined || authoritative.finish === undefined
      ? predicted.finish === authoritative.finish
        ? 0
        : Number.POSITIVE_INFINITY
      : vectorDistance(predicted.finish.position, authoritative.finish.position);
  const finishTickError =
    predicted.finish === undefined || authoritative.finish === undefined
      ? predicted.finish === authoritative.finish
        ? 0
        : Number.POSITIVE_INFINITY
      : timeline === "shot-relative"
        ? Math.abs(
            predicted.finish.tick -
              predicted.fireTick -
              (authoritative.finish.tick - authoritative.fireTick)
          )
        : Math.abs(predicted.finish.tick - authoritative.finish.tick);
  const reasonMatches = predicted.finish?.reason === authoritative.finish?.reason;
  const predictedLifetime = predicted.expiresTick - predicted.fireTick;
  const authorityLifetime = authoritative.expiresTick - authoritative.fireTick;
  const fireMatches =
    predicted.correlationId === authoritative.correlationId &&
    predicted.generation === authoritative.generation &&
    predicted.definitionId === authoritative.definitionId &&
    predicted.definitionVersion === authoritative.definitionVersion &&
    (timeline === "shot-relative" || predicted.fireTick === authoritative.fireTick) &&
    predicted.fixedDeltaMs === authoritative.fixedDeltaMs &&
    (timeline === "shot-relative"
      ? predictedLifetime === authorityLifetime
      : predicted.expiresTick === authoritative.expiresTick) &&
    firePositionError <= firePositionTolerance &&
    fireVelocityError <= fireVelocityTolerance &&
    fireSpeedError <= fireSpeedTolerance &&
    fireDirectionErrorRadians <= fireDirectionToleranceRadians;
  if (!fireMatches) {
    return {
      status: "corrected",
      timeline,
      fireTickError,
      firePositionError,
      fireVelocityError,
      fireSpeedError,
      fireDirectionErrorRadians,
      finishPositionError,
      finishTickError,
      reasonMatches
    };
  }
  if (authoritative.finish === undefined) {
    return {
      status: "pending",
      timeline,
      fireTickError,
      firePositionError,
      fireVelocityError,
      fireSpeedError,
      fireDirectionErrorRadians,
      finishPositionError,
      finishTickError,
      reasonMatches
    };
  }
  const confirmed =
    predicted.finish !== undefined &&
    finishPositionError <= finishPositionTolerance &&
    finishTickError <= finishTickTolerance &&
    reasonMatches;
  return {
    status: confirmed ? "confirmed" : "corrected",
    timeline,
    fireTickError,
    firePositionError,
    fireVelocityError,
    fireSpeedError,
    fireDirectionErrorRadians,
    finishPositionError,
    finishTickError,
    reasonMatches
  };
}

function vectorLength(vector: PhysicsVector): number {
  return Math.hypot(vector.x, vector.y, vector.z ?? 0);
}

function vectorDirectionErrorRadians(left: PhysicsVector, right: PhysicsVector): number {
  const leftLength = vectorLength(left);
  const rightLength = vectorLength(right);
  if (leftLength <= Number.EPSILON || rightLength <= Number.EPSILON) {
    return leftLength <= Number.EPSILON && rightLength <= Number.EPSILON
      ? 0
      : Number.POSITIVE_INFINITY;
  }
  const dot =
    (left.x * right.x + left.y * right.y + (left.z ?? 0) * (right.z ?? 0)) /
    (leftLength * rightLength);
  return Math.acos(Math.max(-1, Math.min(1, dot)));
}

function normalizeNonNegativeNumber(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(0, value);
}

function validDefinition(
  definition: CombatKinematicProjectileDefinition,
  input:
    | Pick<CombatKinematicProjectileRecord, "definitionId" | "definitionVersion">
    | CombatKinematicProjectileFireInput
): boolean {
  return (
    definition.id === input.definitionId &&
    definition.version === input.definitionVersion &&
    Number.isSafeInteger(definition.lifetimeTicks) &&
    definition.lifetimeTicks > 0 &&
    (definition.collisionMode === "ray-sweep" ||
      (definition.collisionMode === "shape-sweep" && definition.sweepShape !== undefined))
  );
}

function validateFireInput(input: CombatKinematicProjectileFireInput): void {
  if (
    input.projectileId.length === 0 ||
    input.correlationId.length === 0 ||
    input.definitionId.length === 0 ||
    input.definitionVersion.length === 0 ||
    !Number.isSafeInteger(input.fireTick)
  ) {
    throw new Error("Combat kinematic projectile fire input is invalid.");
  }
  validateVector(input.firePosition, "firePosition");
  validateVector(input.fireVelocity, "fireVelocity");
}

function validateVector(vector: PhysicsVector, label: string): void {
  if (
    !Number.isFinite(vector.x) ||
    !Number.isFinite(vector.y) ||
    (vector.z !== undefined && !Number.isFinite(vector.z))
  ) {
    throw new Error(`Combat kinematic projectile ${label} must be finite.`);
  }
}

function cloneActiveState(
  state: CombatKinematicProjectileActiveState
): CombatKinematicProjectileActiveState {
  return {
    record: cloneCombatKinematicProjectileRecord(state.record),
    tick: state.tick,
    position: cloneVector(state.position)
  };
}

function cloneFinish(finish: CombatKinematicProjectileFinish): CombatKinematicProjectileFinish {
  return {
    ...finish,
    position: cloneVector(finish.position),
    ...(finish.normal === undefined ? {} : { normal: cloneVector(finish.normal) }),
    ...(finish.subject === undefined ? {} : { subject: { ...finish.subject } })
  };
}

function cloneVector(vector: PhysicsVector): PhysicsVector {
  return {
    x: vector.x,
    y: vector.y,
    ...(vector.z === undefined ? {} : { z: vector.z })
  };
}

function addScaledVector(
  origin: PhysicsVector,
  velocity: PhysicsVector,
  seconds: number
): PhysicsVector {
  return {
    x: origin.x + velocity.x * seconds,
    y: origin.y + velocity.y * seconds,
    ...(origin.z === undefined && velocity.z === undefined
      ? {}
      : { z: (origin.z ?? 0) + (velocity.z ?? 0) * seconds })
  };
}

function vectorDistance(left: PhysicsVector, right: PhysicsVector): number {
  return Math.hypot(left.x - right.x, left.y - right.y, (left.z ?? 0) - (right.z ?? 0));
}

function normalizePositiveInteger(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(1, Math.floor(value));
}
