import { defineGameModule } from "@gamekits/core";
import type { GameInstallContext } from "@gamekits/game-runtime";
import {
  createMultiplayerSpeculativeEffectJournal,
  type MultiplayerSpeculativeEffectJournal
} from "@gamekits/multiplayer-core";

import type { OutpostReplicatedWeaponState } from "../../domain";

export type OutpostPlayerPresentationCue = {
  sequence: number;
  semanticId: "outpost.player.rifle-shot";
  phase: "anticipated" | "confirmed" | "rejected" | "expired";
  sourcePlayerId: string;
  correlationId: string;
  predictedShotSequence: number;
  at: number;
  reason?: string | undefined;
};

export type OutpostPlayerPresentationSnapshot = {
  cueWatermark: number;
  pendingAnticipations: number;
  anticipatedShots: number;
  confirmedShots: number;
  rejectedShots: number;
  expiredShots: number;
};

export type OutpostPlayerPresentationFrame = {
  elapsed: number;
  active: boolean;
  health: number;
  fireHeld: boolean;
  fireSequence: number;
  aim: { x: number; y: number };
  weapon?: OutpostReplicatedWeaponState | undefined;
};

export type OutpostClientPlayerPresentation = {
  update(frame: OutpostClientPlayerPresentationUpdate): void;
  cuesAfter(sequence: number): OutpostPlayerPresentationCue[];
  currentFrame(): OutpostPlayerPresentationFrame;
  snapshot(): OutpostPlayerPresentationSnapshot;
  reset(): void;
};

export type OutpostClientPlayerPresentationUpdate = {
  elapsed: number;
  active: boolean;
  health: number;
  fireHeld: boolean;
  fireSequence: number;
  aimX: number;
  aimY: number;
  weapon?: OutpostReplicatedWeaponState | undefined;
};

export type CreateOutpostClientPlayerPresentationOptions = {
  playerId: string;
  fireIntervalMs: number;
  cueHistoryLimit?: number | undefined;
  anticipationTimeoutMs?: number | undefined;
  maxPendingAnticipations?: number | undefined;
};

type PendingRifleAnticipation = {
  correlationId: string;
  predictedShotSequence: number;
  anticipatedAt: number;
};

type RifleAnticipationResolution = {
  elapsed: number;
};

const DEFAULT_CUE_HISTORY_LIMIT = 32;
const DEFAULT_ANTICIPATION_TIMEOUT_MS = 1_000;
const DEFAULT_MAX_PENDING_ANTICIPATIONS = 8;

export function createOutpostClientPlayerPresentation(
  options: CreateOutpostClientPlayerPresentationOptions
): OutpostClientPlayerPresentation {
  const cueHistoryLimit = positiveInteger(
    options.cueHistoryLimit,
    DEFAULT_CUE_HISTORY_LIMIT,
    "cueHistoryLimit"
  );
  const anticipationTimeoutMs = positiveNumber(
    options.anticipationTimeoutMs,
    DEFAULT_ANTICIPATION_TIMEOUT_MS,
    "anticipationTimeoutMs"
  );
  const maxPendingAnticipations = positiveInteger(
    options.maxPendingAnticipations,
    DEFAULT_MAX_PENDING_ANTICIPATIONS,
    "maxPendingAnticipations"
  );
  const fireIntervalMs = positiveNumber(options.fireIntervalMs, undefined, "fireIntervalMs");
  const cues: OutpostPlayerPresentationCue[] = [];
  let initialized = false;
  let effectGeneration = 0;
  let cueSequence = 0;
  let lastInputFireSequence = 0;
  let lastAuthorityShotSequence = 0;
  let lastFeedbackSequence = 0;
  let nextAnticipationAt = 0;
  let queuedFireEdge = false;
  let anticipatedShots = 0;
  let confirmedShots = 0;
  let rejectedShots = 0;
  let expiredShots = 0;
  let currentFrame = emptyPresentationFrame();
  const effects = createRifleEffectJournal();

  return {
    update(frame) {
      currentFrame = clonePresentationFrame(frame);
      const weapon = frame.weapon;
      if (!frame.active || frame.health <= 0 || weapon === undefined) {
        clearTransientState(frame.fireSequence);
        return;
      }
      if (!initialized) {
        initialized = true;
        lastInputFireSequence = frame.fireSequence;
        lastAuthorityShotSequence = weapon.shotSequence;
        lastFeedbackSequence = weapon.lastFeedback?.sequence ?? 0;
        nextAnticipationAt = frame.elapsed;
        return;
      }

      reconcileAuthority(frame.elapsed, weapon);
      expireStaleAnticipations(frame.elapsed);

      if (frame.fireSequence !== lastInputFireSequence) {
        lastInputFireSequence = frame.fireSequence;
        queuedFireEdge = true;
      }
      if (weapon.magazine === 0 || weapon.phase === "empty") {
        // Authority consumes an empty-magazine fire edge to start/continue reload and does not
        // retain it as a shot request. Do the same locally so it cannot surface at reload commit.
        queuedFireEdge = false;
        return;
      }
      const fireRequested =
        weapon.phase === "reloading" ? queuedFireEdge : frame.fireHeld || queuedFireEdge;
      if (!fireRequested) {
        return;
      }
      if (
        frame.elapsed < nextAnticipationAt ||
        pendingAnticipations().length >= maxPendingAnticipations ||
        weapon.magazine <= pendingAnticipations().length ||
        (weapon.phase !== "ready" && weapon.phase !== "reloading")
      ) {
        return;
      }

      const pending = pendingAnticipations();
      const predictedShotSequence = lastAuthorityShotSequence + pending.length + 1;
      const correlationId = `${options.playerId}.rifle.${predictedShotSequence}`;
      if (pending.some((candidate) => candidate.correlationId === correlationId)) {
        return;
      }
      const anticipated = effects.anticipate({
        effectId: correlationId,
        tick: effectTick(frame.elapsed),
        value: { correlationId, predictedShotSequence, anticipatedAt: frame.elapsed }
      });
      if (anticipated.status !== "anticipated") {
        return;
      }
      queuedFireEdge = false;
      nextAnticipationAt = frame.elapsed + fireIntervalMs;
    },
    cuesAfter(sequence) {
      return cues.filter((cue) => cue.sequence > sequence).map(cloneCue);
    },
    currentFrame() {
      return clonePresentationFrame(currentFrame);
    },
    snapshot() {
      return {
        cueWatermark: cueSequence,
        pendingAnticipations: effects.diagnostics().pending,
        anticipatedShots,
        confirmedShots,
        rejectedShots,
        expiredShots
      };
    },
    reset() {
      initialized = false;
      cueSequence = 0;
      lastInputFireSequence = 0;
      lastAuthorityShotSequence = 0;
      lastFeedbackSequence = 0;
      nextAnticipationAt = 0;
      queuedFireEdge = false;
      anticipatedShots = 0;
      confirmedShots = 0;
      rejectedShots = 0;
      expiredShots = 0;
      currentFrame = emptyPresentationFrame();
      effectGeneration += 1;
      effects.reset(effectGeneration);
      cues.length = 0;
    }
  };

  function createRifleEffectJournal(): MultiplayerSpeculativeEffectJournal<
    PendingRifleAnticipation,
    RifleAnticipationResolution
  > {
    return createMultiplayerSpeculativeEffectJournal({
      generation: effectGeneration,
      maxPending: maxPendingAnticipations,
      maxResolved: cueHistoryLimit,
      maxAgeTicks: Math.max(1, Math.ceil(anticipationTimeoutMs)),
      clonePredicted: (value) => ({ ...value }),
      cloneAuthority: (value) => ({ ...value }),
      hooks: {
        onAnticipate(effect) {
          anticipatedShots += 1;
          appendCue({
            phase: "anticipated",
            correlationId: effect.value.correlationId,
            predictedShotSequence: effect.value.predictedShotSequence,
            at: effect.value.anticipatedAt
          });
        },
        onConfirm({ effect, authority, tick }) {
          confirmedShots += 1;
          appendCue({
            phase: "confirmed",
            correlationId: effect.value.correlationId,
            predictedShotSequence: effect.value.predictedShotSequence,
            at: authority?.elapsed ?? tick
          });
        },
        onCancel({ effect, reason, detail, tick }) {
          if (
            reason === "generation-changed" ||
            reason === "explicit-reset" ||
            reason === "disposed"
          ) {
            return;
          }
          const expired =
            reason === "expired" ||
            reason === "capacity" ||
            detail === "authority-timeout" ||
            detail === "correlation-chain-invalidated";
          if (expired) {
            expiredShots += 1;
          } else {
            rejectedShots += 1;
          }
          appendCue({
            phase: expired ? "expired" : "rejected",
            correlationId: effect.value.correlationId,
            predictedShotSequence: effect.value.predictedShotSequence,
            at: tick,
            ...(detail === undefined ? {} : { reason: detail })
          });
        }
      }
    });
  }

  function reconcileAuthority(elapsed: number, weapon: OutpostReplicatedWeaponState): void {
    if (weapon.shotSequence < lastAuthorityShotSequence) {
      resetEffects();
      queuedFireEdge = false;
      lastAuthorityShotSequence = weapon.shotSequence;
    } else if (weapon.shotSequence > lastAuthorityShotSequence) {
      const correlated = weapon.lastShotCorrelationId;
      if (correlated !== undefined) {
        const pending = pendingAnticipations();
        const index = pending.findIndex((candidate) => candidate.correlationId === correlated);
        if (index >= 0) {
          for (let count = 0; count <= index; count += 1) {
            confirmPending(0, elapsed);
          }
        }
      }
      while (
        pendingAnticipations()[0] !== undefined &&
        pendingAnticipations()[0]!.predictedShotSequence <= weapon.shotSequence
      ) {
        confirmPending(0, elapsed);
      }
      lastAuthorityShotSequence = weapon.shotSequence;
    }

    const feedback = weapon.lastFeedback;
    if (feedback === undefined || feedback.sequence <= lastFeedbackSequence) {
      return;
    }
    lastFeedbackSequence = feedback.sequence;
    if (feedback.action !== "rifle" || feedback.correlationId === undefined) {
      return;
    }
    const pending = pendingAnticipations();
    const index = pending.findIndex(
      (candidate) => candidate.correlationId === feedback.correlationId
    );
    if (index < 0) {
      return;
    }
    const invalidated = pending.slice(index);
    const rejected = invalidated.shift();
    if (!rejected) {
      return;
    }
    effects.resolve({
      effectId: rejected.correlationId,
      generation: effectGeneration,
      tick: effectTick(elapsed),
      outcome: "cancel",
      reason: feedback.reason
    });
    for (const dependent of invalidated) {
      effects.resolve({
        effectId: dependent.correlationId,
        generation: effectGeneration,
        tick: effectTick(elapsed),
        outcome: "cancel",
        reason: "correlation-chain-invalidated"
      });
    }
  }

  function confirmPending(index: number, elapsed: number): void {
    const confirmed = pendingAnticipations()[index];
    if (!confirmed) {
      return;
    }
    effects.resolve({
      effectId: confirmed.correlationId,
      generation: effectGeneration,
      tick: effectTick(elapsed),
      outcome: "confirm",
      authority: { elapsed }
    });
  }

  function expireStaleAnticipations(elapsed: number): void {
    const pending = pendingAnticipations();
    const first = pending[0];
    if (first === undefined || elapsed - first.anticipatedAt < anticipationTimeoutMs) {
      return;
    }
    for (let index = 0; index < pending.length; index += 1) {
      const expired = pending[index]!;
      effects.resolve({
        effectId: expired.correlationId,
        generation: effectGeneration,
        tick: effectTick(elapsed),
        outcome: "cancel",
        reason: index === 0 ? "authority-timeout" : "correlation-chain-invalidated"
      });
    }
  }

  function pendingAnticipations(): PendingRifleAnticipation[] {
    return effects.pending().map((effect) => effect.value);
  }

  function resetEffects(): void {
    effectGeneration += 1;
    effects.reset(effectGeneration);
  }

  function appendCue(
    cue: Omit<OutpostPlayerPresentationCue, "sequence" | "semanticId" | "sourcePlayerId">
  ): void {
    cueSequence += 1;
    cues.push({
      sequence: cueSequence,
      semanticId: "outpost.player.rifle-shot",
      sourcePlayerId: options.playerId,
      ...cue
    });
    if (cues.length > cueHistoryLimit) {
      cues.splice(0, cues.length - cueHistoryLimit);
    }
  }

  function clearTransientState(fireSequence: number): void {
    const resetRequired = initialized || effects.diagnostics().pending > 0;
    initialized = false;
    lastInputFireSequence = fireSequence;
    nextAnticipationAt = 0;
    queuedFireEdge = false;
    if (resetRequired) {
      resetEffects();
    }
  }
}

function effectTick(elapsed: number): number {
  return Math.max(0, Math.floor(elapsed));
}

export function createOutpostClientPlayerPresentationModule(options: {
  presentation: OutpostClientPlayerPresentation;
  readFrame():
    | {
        active: boolean;
        health: number;
        fireHeld: boolean;
        fireSequence: number;
        aimX: number;
        aimY: number;
        weapon?: OutpostReplicatedWeaponState | undefined;
      }
    | undefined;
}) {
  return defineGameModule<GameInstallContext>({
    id: "outpost.client.player-presentation",
    install(ctx) {
      ctx.systems.register({
        id: "outpost.client.player-presentation.update",
        update({ elapsed }) {
          const frame = options.readFrame();
          options.presentation.update({
            elapsed,
            active: frame?.active ?? false,
            health: frame?.health ?? 0,
            fireHeld: frame?.fireHeld ?? false,
            fireSequence: frame?.fireSequence ?? 0,
            aimX: frame?.aimX ?? 0,
            aimY: frame?.aimY ?? 0,
            ...(frame?.weapon === undefined ? {} : { weapon: frame.weapon })
          });
        }
      });
      return () => options.presentation.reset();
    }
  });
}

function emptyPresentationFrame(): OutpostPlayerPresentationFrame {
  return {
    elapsed: 0,
    active: false,
    health: 0,
    fireHeld: false,
    fireSequence: 0,
    aim: { x: 0, y: 0 }
  };
}

function clonePresentationFrame(
  frame: OutpostClientPlayerPresentationUpdate | OutpostPlayerPresentationFrame
): OutpostPlayerPresentationFrame {
  const aim = "aim" in frame ? frame.aim : { x: frame.aimX, y: frame.aimY };
  return {
    elapsed: frame.elapsed,
    active: frame.active,
    health: frame.health,
    fireHeld: frame.fireHeld,
    fireSequence: frame.fireSequence,
    aim: { x: aim.x, y: aim.y },
    ...(frame.weapon === undefined ? {} : { weapon: frame.weapon })
  };
}

function cloneCue(cue: OutpostPlayerPresentationCue): OutpostPlayerPresentationCue {
  return { ...cue };
}

function positiveInteger(value: number | undefined, fallback: number, label: string): number {
  const resolved = value ?? fallback;
  if (!Number.isInteger(resolved) || resolved <= 0) {
    throw new Error(`Outpost player presentation ${label} must be a positive integer.`);
  }
  return resolved;
}

function positiveNumber(
  value: number | undefined,
  fallback: number | undefined,
  label: string
): number {
  const resolved = value ?? fallback;
  if (resolved === undefined || !Number.isFinite(resolved) || resolved <= 0) {
    throw new Error(`Outpost player presentation ${label} must be a positive number.`);
  }
  return resolved;
}
