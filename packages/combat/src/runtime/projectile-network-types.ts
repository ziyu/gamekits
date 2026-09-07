import type {
  PhysicsQueryOptions,
  PhysicsQueryResult,
  PhysicsRotation,
  PhysicsShapeDefinition,
  PhysicsVector
} from "@gamekits/physics-core";

export type CombatProjectileNetworkStrategy =
  | "hitscan-lag-compensated"
  | "kinematic-data-buffer"
  | "predicted-entity"
  | "authority-only";

export type CombatKinematicProjectileFinishReason =
  | "impact"
  | "expired"
  | "cancelled"
  | "rejected"
  | string;

export type CombatKinematicProjectileSubject = {
  actorId?: string | undefined;
  entityId?: string | number | undefined;
  bodyId?: string | undefined;
  colliderId?: string | undefined;
};

export type CombatKinematicProjectileFinish = {
  tick: number;
  reason: CombatKinematicProjectileFinishReason;
  position: PhysicsVector;
  normal?: PhysicsVector | undefined;
  subject?: CombatKinematicProjectileSubject | undefined;
};

export type CombatKinematicProjectileRecord = {
  projectileId: string;
  correlationId: string;
  generation: string | number;
  definitionId: string;
  definitionVersion: string;
  fireTick: number;
  fixedDeltaMs: number;
  firePosition: PhysicsVector;
  fireVelocity: PhysicsVector;
  expiresTick: number;
  finish?: CombatKinematicProjectileFinish | undefined;
};

export type CombatKinematicProjectileDefinition = {
  id: string;
  version: string;
  collisionMode: "ray-sweep" | "shape-sweep";
  lifetimeTicks: number;
  sweepShape?: PhysicsShapeDefinition | undefined;
  rotation?: PhysicsRotation | undefined;
  query?: PhysicsQueryOptions | undefined;
};

export type CombatKinematicProjectileFireInput = {
  projectileId: string;
  correlationId: string;
  generation: string | number;
  definitionId: string;
  definitionVersion: string;
  fireTick: number;
  firePosition: PhysicsVector;
  fireVelocity: PhysicsVector;
};

export type CombatKinematicProjectileSample = {
  projectileId: string;
  tick: number;
  position: PhysicsVector;
  active: boolean;
  finish?: CombatKinematicProjectileFinish | undefined;
};

export type CombatKinematicProjectileActiveState = {
  record: CombatKinematicProjectileRecord;
  tick: number;
  position: PhysicsVector;
};

export type CombatKinematicProjectileFireResult = {
  status:
    | "fired"
    | "duplicate"
    | "conflict"
    | "stale-generation"
    | "capacity"
    | "invalid-definition";
  record?: CombatKinematicProjectileRecord | undefined;
};

export type CombatKinematicProjectileAdvanceResult = {
  targetTick: number;
  advancedTicks: number;
  finished: CombatKinematicProjectileRecord[];
  catchUpLimited: number;
};

export type CombatKinematicProjectileReconciliation = {
  status: "pending" | "confirmed" | "corrected";
  timeline: "absolute" | "shot-relative";
  fireTickError: number;
  firePositionError: number;
  fireVelocityError: number;
  fireSpeedError: number;
  fireDirectionErrorRadians: number;
  finishPositionError: number;
  finishTickError: number;
  reasonMatches: boolean;
};

export type CombatKinematicProjectileReconciliationOptions = {
  /**
   * Absolute compares authority ticks directly. Shot-relative compares each lifecycle from its
   * own fire tick, which is required when an owner predicts before the authority commits.
   */
  timeline?: "absolute" | "shot-relative" | undefined;
  epsilon?: number | undefined;
  firePositionTolerance?: number | undefined;
  fireVelocityTolerance?: number | undefined;
  fireSpeedTolerance?: number | undefined;
  fireDirectionToleranceRadians?: number | undefined;
  finishPositionTolerance?: number | undefined;
  finishTickTolerance?: number | undefined;
};

export type CombatKinematicProjectileRecordBufferDiagnostics = {
  generation: string | number;
  inserted: number;
  updated: number;
  duplicates: number;
  conflicts: number;
  staleGenerations: number;
  evicted: number;
  resets: number;
  records: number;
};

export type CombatKinematicProjectileRuntimeDiagnostics = {
  generation: string | number;
  fired: number;
  rejected: number;
  physicsSweeps: number;
  impacts: number;
  expired: number;
  cancelled: number;
  catchUpLimited: number;
  active: number;
  records: number;
  recordBuffer: CombatKinematicProjectileRecordBufferDiagnostics;
};

export type CombatKinematicProjectileHitResolver = (
  hit: PhysicsQueryResult,
  record: CombatKinematicProjectileRecord
) => CombatKinematicProjectileSubject | undefined;
