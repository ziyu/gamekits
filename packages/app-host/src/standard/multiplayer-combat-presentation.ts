import {
  reconcileCombatKinematicProjectileRecords,
  sampleCombatKinematicProjectileRecord,
  type CombatKinematicProjectileReconciliation,
  type CombatKinematicProjectileReconciliationOptions,
  type CombatKinematicProjectileRecord,
  type CombatKinematicProjectileSample
} from "@gamekits/combat";
import {
  createMultiplayerTimeAlignedPresentationTransition,
  definePredictionVector3StateField,
  type MultiplayerTimeAlignedPresentationResult
} from "@gamekits/multiplayer-core";

export type StandardCombatKinematicProjectilePresentationOptions = {
  reconciliation?: CombatKinematicProjectileReconciliationOptions | undefined;
  minCorrectionMs?: number | undefined;
  maxCorrectionMs?: number | undefined;
  correctionTravelFactor?: number | undefined;
  maxEntries?: number | undefined;
};

export type StandardCombatKinematicProjectilePresentationInput = {
  predicted?: CombatKinematicProjectileRecord | undefined;
  authoritative?: CombatKinematicProjectileRecord | undefined;
  authorityTick: number;
  elapsedMs: number;
};

export type StandardCombatKinematicProjectilePresentationReconcileResult = {
  correlationId: string;
  predictedProjectileId: string;
  authorityProjectileId: string;
  /** Authority fire tick minus predicted fire tick; diagnostic in shot-relative presentation. */
  fireTickOffset: number;
  reconciliation: CombatKinematicProjectileReconciliation;
  correctionDistance: number;
  correctionDurationMs: number;
  holdsPredictedFinish: boolean;
};

export type StandardCombatKinematicProjectilePresentationDiagnostics = {
  reconciled: number;
  confirmedTrajectories: number;
  correctedTrajectories: number;
  smoothedCorrections: number;
  heldPredictedFinishes: number;
  completedCorrections: number;
  evictedEntries: number;
  resets: number;
  entries: number;
  activeCorrections: number;
  lastFireTickOffset?: number | undefined;
};

export type StandardCombatKinematicProjectilePresentationTransition = {
  reconcile(
    input: StandardCombatKinematicProjectilePresentationInput & {
      predicted: CombatKinematicProjectileRecord;
      authoritative: CombatKinematicProjectileRecord;
    }
  ): StandardCombatKinematicProjectilePresentationReconcileResult;
  sample(
    input: StandardCombatKinematicProjectilePresentationInput
  ): CombatKinematicProjectileSample | undefined;
  remove(generation: string | number, correlationId: string): void;
  reset(): void;
  diagnostics(): StandardCombatKinematicProjectilePresentationDiagnostics;
  dispose(): void;
};

type DomainReconciliation = {
  reconciliation: CombatKinematicProjectileReconciliation;
  predictedProjectileId: string;
  authorityProjectileId: string;
  correlationId: string;
};

const DEFAULT_MIN_CORRECTION_MS = 100;
const DEFAULT_MAX_CORRECTION_MS = 260;
const DEFAULT_CORRECTION_TRAVEL_FACTOR = 1.5;

/**
 * Standard App Host integration for Combat kinematic records and Multiplayer authority handoff.
 * Combat owns trajectory facts; Multiplayer Core owns identity-local bounded presentation state,
 * lifecycle-relative time alignment, correction smoothing, and diagnostics.
 */
export function createStandardCombatKinematicProjectilePresentationTransition(
  options: StandardCombatKinematicProjectilePresentationOptions = {}
): StandardCombatKinematicProjectilePresentationTransition {
  const minCorrectionMs = normalizeNonNegativeNumber(
    options.minCorrectionMs,
    DEFAULT_MIN_CORRECTION_MS
  );
  const maxCorrectionMs = Math.max(
    minCorrectionMs,
    normalizeNonNegativeNumber(options.maxCorrectionMs, DEFAULT_MAX_CORRECTION_MS)
  );
  const correctionTravelFactor = normalizePositiveNumber(
    options.correctionTravelFactor,
    DEFAULT_CORRECTION_TRAVEL_FACTOR
  );
  const position = definePredictionVector3StateField<CombatKinematicProjectileSample>({
    readX(sample) {
      return sample.position.x;
    },
    readY(sample) {
      return sample.position.y;
    },
    readZ(sample) {
      return sample.position.z ?? 0;
    },
    write(sample, x, y, z) {
      sample.position = {
        x,
        y,
        ...(sample.position.z === undefined ? {} : { z })
      };
    }
  });
  const transition = createMultiplayerTimeAlignedPresentationTransition<
    CombatKinematicProjectileRecord,
    CombatKinematicProjectileRecord,
    CombatKinematicProjectileSample,
    DomainReconciliation
  >({
    key(_predicted, authoritative) {
      return entryKey(authoritative.generation, authoritative.correlationId);
    },
    version(predicted, authoritative) {
      return entryVersion(predicted, authoritative);
    },
    reconcile(predicted, authoritative) {
      const reconciliation = reconcileCombatKinematicProjectileRecords(predicted, authoritative, {
        timeline: "shot-relative",
        ...options.reconciliation
      });
      return {
        status: reconciliation.status === "corrected" ? "corrected" : "confirmed",
        result: {
          reconciliation,
          predictedProjectileId: predicted.projectileId,
          authorityProjectileId: authoritative.projectileId,
          correlationId: predicted.correlationId
        },
        alignment:
          reconciliation.timeline === "shot-relative"
            ? {
                mode: "relative-origin",
                predictedOriginTime: predicted.fireTick,
                authorityOriginTime: authoritative.fireTick
              }
            : {
                mode: "absolute",
                predictedOriginTime: predicted.fireTick,
                authorityOriginTime: authoritative.fireTick
              },
        holdPrediction: predicted.finish !== undefined && authoritative.finish === undefined
      };
    },
    samplePredicted: sampleCombatKinematicProjectileRecord,
    sampleAuthority: sampleCombatKinematicProjectileRecord,
    cloneSample(sample) {
      return {
        ...sample,
        position: { ...sample.position },
        ...(sample.finish === undefined
          ? {}
          : {
              finish: {
                ...sample.finish,
                position: { ...sample.finish.position },
                ...(sample.finish.normal === undefined
                  ? {}
                  : { normal: { ...sample.finish.normal } }),
                ...(sample.finish.subject === undefined
                  ? {}
                  : { subject: { ...sample.finish.subject } })
              }
            })
      };
    },
    presentation: {
      fields: [position],
      correction: {
        measure: position,
        smooth: [position],
        durationMs: minCorrectionMs
      }
    },
    correctionDurationMs(context) {
      const speed = Math.max(
        1,
        Math.hypot(
          context.authoritative.fireVelocity.x,
          context.authoritative.fireVelocity.y,
          context.authoritative.fireVelocity.z ?? 0
        )
      );
      return Math.max(
        minCorrectionMs,
        Math.min(
          maxCorrectionMs,
          (context.correctionMagnitude / speed) * 1_000 * correctionTravelFactor
        )
      );
    },
    isActive(sample) {
      return sample.active;
    },
    maxEntries: options.maxEntries
  });

  return {
    reconcile(input) {
      return toReconcileResult(
        transition.reconcile({
          predicted: input.predicted,
          authoritative: input.authoritative,
          presentationTime: input.authorityTick,
          elapsedMs: input.elapsedMs
        })
      );
    },
    sample(input) {
      return transition.sample({
        predicted: input.predicted,
        authoritative: input.authoritative,
        presentationTime: input.authorityTick,
        elapsedMs: input.elapsedMs
      });
    },
    remove(generation, correlationId) {
      transition.remove(entryKey(generation, correlationId));
    },
    reset() {
      transition.reset();
    },
    diagnostics() {
      const snapshot = transition.diagnostics();
      return {
        reconciled: snapshot.reconciliations,
        confirmedTrajectories: snapshot.confirmed,
        correctedTrajectories: snapshot.corrected,
        smoothedCorrections: snapshot.smoothedCorrections,
        heldPredictedFinishes: snapshot.heldPredictions,
        completedCorrections: snapshot.completedCorrections,
        evictedEntries: snapshot.evictedEntries,
        resets: snapshot.resets,
        entries: snapshot.entries,
        activeCorrections: snapshot.activeCorrections,
        ...(snapshot.lastOriginTimeOffset === undefined
          ? {}
          : { lastFireTickOffset: snapshot.lastOriginTimeOffset })
      };
    },
    dispose() {
      transition.dispose();
    }
  };
}

function toReconcileResult(
  result: MultiplayerTimeAlignedPresentationResult<DomainReconciliation>
): StandardCombatKinematicProjectilePresentationReconcileResult {
  return {
    correlationId: result.result.correlationId,
    predictedProjectileId: result.result.predictedProjectileId,
    authorityProjectileId: result.result.authorityProjectileId,
    fireTickOffset: result.originTimeOffset,
    reconciliation: result.result.reconciliation,
    correctionDistance: result.correctionMagnitude,
    correctionDurationMs: result.correctionDurationMs,
    holdsPredictedFinish: result.holdsPrediction
  };
}

function entryKey(generation: string | number, correlationId: string): string {
  return `${String(generation)}\u0000${correlationId}`;
}

function entryVersion(
  predicted: CombatKinematicProjectileRecord,
  authoritative: CombatKinematicProjectileRecord
): string {
  return [
    predicted.projectileId,
    predicted.finish?.tick ?? "active",
    predicted.finish?.reason ?? "active",
    authoritative.projectileId,
    authoritative.finish?.tick ?? "active",
    authoritative.finish?.reason ?? "active"
  ].join("\u0000");
}

function normalizeNonNegativeNumber(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(0, value);
}

function normalizePositiveNumber(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value) || value <= 0) {
    return fallback;
  }
  return value;
}
