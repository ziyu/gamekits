import {
  createMultiplayerPredictedLifecycleDomain,
  type MultiplayerPredictedLifecycleDomain,
  type MultiplayerPredictedLifecycleDomainDiagnostics,
  type MultiplayerPredictedLifecycleHooks,
  type MultiplayerPredictedLifecycleSyncResult,
  type MultiplayerPredictionGeneration
} from "@gamekits/multiplayer-core";
import type {
  PhysicsPredictionIsland,
  PhysicsPredictionIslandDiagnostics,
  PhysicsPredictionIslandHardCorrectResult,
  PhysicsPredictionIslandMemberDefinition,
  PhysicsPredictionIslandMemberState,
  PhysicsPredictionIslandReconcileResult,
  PhysicsPredictionIslandStateSnapshot
} from "@gamekits/physics-core";

export type StandardMultiplayerPhysicsAuthoritySpawn = {
  correlationId: string;
  tick?: number | undefined;
};

export type StandardMultiplayerPhysicsPredictionDomainOptions = {
  kind: string;
  generation: MultiplayerPredictionGeneration;
  stepMs: number;
  island: PhysicsPredictionIsland;
  maxPending?: number | undefined;
  maxResolved?: number | undefined;
  maxAgeTicks?: number | undefined;
  maxBindings?: number | undefined;
  hardCorrection?: boolean | undefined;
  disposeIsland?: boolean | undefined;
  resolveAuthoritySpawn(
    member: PhysicsPredictionIslandMemberState,
    snapshot: PhysicsPredictionIslandStateSnapshot
  ): StandardMultiplayerPhysicsAuthoritySpawn | undefined;
  resolveMemberDefinition?(
    member: PhysicsPredictionIslandMemberState,
    snapshot: PhysicsPredictionIslandStateSnapshot
  ): PhysicsPredictionIslandMemberDefinition | undefined;
  hooks?: MultiplayerPredictedLifecycleHooks | undefined;
};

export type StandardMultiplayerPhysicsPredictionReconcileResult = {
  lifecycle: MultiplayerPredictedLifecycleSyncResult<
    PhysicsPredictionIslandMemberDefinition,
    PhysicsPredictionIslandMemberState
  >;
  reconciliation: PhysicsPredictionIslandReconcileResult;
  hardCorrection?: PhysicsPredictionIslandHardCorrectResult | undefined;
};

export type StandardMultiplayerPhysicsPredictionDiagnostics = {
  lifecycle: MultiplayerPredictedLifecycleDomainDiagnostics;
  island: PhysicsPredictionIslandDiagnostics;
  hardCorrectionAttempts: number;
  hardCorrectionFailures: number;
};

export type StandardMultiplayerPhysicsPredictionDomain = {
  registerPredicted(input: {
    correlationId: string;
    tick: number;
    member: PhysicsPredictionIslandMemberDefinition;
  }): ReturnType<
    MultiplayerPredictedLifecycleDomain<
      PhysicsPredictionIslandMemberDefinition,
      PhysicsPredictionIslandMemberState
    >["register"]
  >;
  rejectPredicted(
    correlationId: string,
    tick: number,
    reason?: string
  ): ReturnType<
    MultiplayerPredictedLifecycleDomain<
      PhysicsPredictionIslandMemberDefinition,
      PhysicsPredictionIslandMemberState
    >["reject"]
  >;
  expire(atTick: number): void;
  reconcile(
    snapshot: PhysicsPredictionIslandStateSnapshot,
    localTime?: number
  ): StandardMultiplayerPhysicsPredictionReconcileResult;
  binding(
    reference: string
  ): ReturnType<
    MultiplayerPredictedLifecycleDomain<
      PhysicsPredictionIslandMemberDefinition,
      PhysicsPredictionIslandMemberState
    >["binding"]
  >;
  reset(generation: MultiplayerPredictionGeneration, tick?: number): void;
  diagnostics(): StandardMultiplayerPhysicsPredictionDiagnostics;
  dispose(): void;
};

/**
 * Standard cross-domain owner for Multiplayer predicted identity and Physics island rollback.
 * The app still declares member/correlation mapping and queues gameplay-specific commands.
 */
export function createStandardMultiplayerPhysicsPredictionDomain(
  options: StandardMultiplayerPhysicsPredictionDomainOptions
): StandardMultiplayerPhysicsPredictionDomain {
  const hardCorrectionEnabled = options.hardCorrection ?? true;
  const disposeIsland = options.disposeIsland ?? true;
  const lifecycle = createMultiplayerPredictedLifecycleDomain<
    PhysicsPredictionIslandMemberDefinition,
    PhysicsPredictionIslandMemberState
  >({
    kind: options.kind,
    generation: options.generation,
    stepMs: options.stepMs,
    ...(options.maxPending === undefined ? {} : { maxPending: options.maxPending }),
    ...(options.maxResolved === undefined ? {} : { maxResolved: options.maxResolved }),
    ...(options.maxAgeTicks === undefined ? {} : { maxAgeTicks: options.maxAgeTicks }),
    ...(options.maxBindings === undefined ? {} : { maxBindings: options.maxBindings }),
    clonePredicted: cloneMemberDefinition,
    cloneAuthority: cloneMemberState,
    ...(options.hooks === undefined ? {} : { hooks: options.hooks })
  });
  let hardCorrectionAttempts = 0;
  let hardCorrectionFailures = 0;
  let disposed = false;

  return {
    registerPredicted(input) {
      assertActive();
      return lifecycle.register({
        correlationId: input.correlationId,
        localId: input.member.id,
        tick: input.tick,
        value: input.member
      });
    },
    rejectPredicted(correlationId, tick, reason) {
      assertActive();
      return lifecycle.reject(correlationId, tick, reason);
    },
    expire(atTick) {
      assertActive();
      lifecycle.expire(atTick);
    },
    reconcile(snapshot, localTime = snapshot.tick * options.stepMs) {
      assertActive();
      const lifecycleResult = lifecycle.sync({
        generation: snapshot.generation,
        authorityTime: snapshot.tick * options.stepMs,
        localTime,
        authoritySpawns: snapshot.members.flatMap((member) => {
          const spawn = options.resolveAuthoritySpawn(member, snapshot);
          return spawn === undefined
            ? []
            : [
                {
                  correlationId: spawn.correlationId,
                  authorityId: member.id,
                  tick: spawn.tick ?? snapshot.tick,
                  value: member
                }
              ];
        })
      });
      const reconciliation = options.island.reconcile(snapshot);
      if (
        !hardCorrectionEnabled ||
        (reconciliation.status !== "history-overflow" &&
          reconciliation.status !== "replay-budget" &&
          reconciliation.status !== "membership-mismatch" &&
          reconciliation.status !== "stale-generation")
      ) {
        return { lifecycle: lifecycleResult, reconciliation };
      }

      hardCorrectionAttempts += 1;
      const matchedDefinitions = lifecycleResult.matches.flatMap(({ match }) =>
        match.predicted === undefined ? [] : [match.predicted.value]
      );
      const mappedDefinitions = snapshot.members.flatMap((member) => {
        const definition = options.resolveMemberDefinition?.(member, snapshot);
        return definition === undefined ? [] : [definition];
      });
      const hardCorrection = options.island.hardCorrect(snapshot, [
        ...matchedDefinitions,
        ...mappedDefinitions
      ]);
      if (hardCorrection.status !== "corrected") {
        hardCorrectionFailures += 1;
      }
      return { lifecycle: lifecycleResult, reconciliation, hardCorrection };
    },
    binding(reference) {
      assertActive();
      return lifecycle.binding(reference);
    },
    reset(generation, tick) {
      assertActive();
      lifecycle.reset(generation);
      options.island.reset(generation, tick);
    },
    diagnostics() {
      assertActive();
      return {
        lifecycle: lifecycle.diagnostics(),
        island: options.island.diagnostics(),
        hardCorrectionAttempts,
        hardCorrectionFailures
      };
    },
    dispose() {
      if (disposed) {
        return;
      }
      disposed = true;
      lifecycle.dispose();
      if (disposeIsland) {
        options.island.dispose();
      }
    }
  };

  function assertActive(): void {
    if (disposed) {
      throw new Error("Standard multiplayer Physics prediction domain is disposed.");
    }
  }
}

function cloneMemberDefinition(
  member: PhysicsPredictionIslandMemberDefinition
): PhysicsPredictionIslandMemberDefinition {
  return structuredClone(member);
}

function cloneMemberState(
  member: PhysicsPredictionIslandMemberState
): PhysicsPredictionIslandMemberState {
  return structuredClone(member);
}
