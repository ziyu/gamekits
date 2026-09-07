import {
  createMultiplayerPredictionBuffer,
  definePredictionStatePresentation,
  definePredictionVector2StateField,
  type MultiplayerPredictionBuffer,
  type MultiplayerPredictionDiagnostics,
  type NetworkVector2
} from "@gamekits/multiplayer-core";
import { REALTIME_ARENA_TICK_MS } from "./config";
import type {
  RealtimeArenaRules,
  RealtimeArenaSnapshot,
  RealtimeArenaWall,
  RealtimeInputFrame
} from "./domain";
import type { RealtimeArenaSnapshotPayload } from "./protocol";

export type RealtimeArenaPredictedPlayer = {
  playerId: string;
  position: NetworkVector2;
  velocity: NetworkVector2;
  sprintRemainingMs: number;
  sprintCooldownMs: number;
};

export type RealtimeArenaPredictionTiming = {
  frameTime: number;
  wallTime: number;
};

export type RealtimeArenaPredictionDiagnostics = MultiplayerPredictionDiagnostics & {
  inputAckSequence?: number;
  roundTripTimeMs?: number;
  snapshotAgeMs?: number;
  inputLead?: number;
};

export type RealtimeArenaPlayerPrediction = {
  predict(
    snapshot: RealtimeArenaSnapshot,
    playerId: string,
    frame: RealtimeInputFrame
  ): RealtimeArenaPredictedPlayer | undefined;
  reconcile(
    payload: RealtimeArenaSnapshotPayload,
    peerId: string,
    timing: RealtimeArenaPredictionTiming
  ): RealtimeArenaPredictedPlayer | undefined;
  state(): RealtimeArenaPredictedPlayer | undefined;
  present(deltaMs: number, timestamp?: number): RealtimeArenaPredictedPlayer | undefined;
  reset(): void;
  diagnostics(): RealtimeArenaPredictionDiagnostics;
};

type PredictionContext = {
  bounds: RealtimeArenaSnapshot["bounds"];
  rules: RealtimeArenaRules;
  walls: RealtimeArenaWall[];
};

const CORRECTION_SMOOTHING_MS = 100;
const MAX_SMOOTHED_CORRECTION_DISTANCE = 48;

export function createRealtimeArenaPlayerPrediction(): RealtimeArenaPlayerPrediction {
  const predictedPosition = definePredictionVector2StateField<RealtimeArenaPredictedPlayer>({
    readX: (state) => state.position.x,
    readY: (state) => state.position.y,
    write(state, x, y) {
      state.position.x = x;
      state.position.y = y;
    }
  });
  const presentation = definePredictionStatePresentation({
    fields: [predictedPosition],
    correction: {
      measure: predictedPosition,
      smooth: [predictedPosition],
      durationMs: CORRECTION_SMOOTHING_MS,
      maxMagnitude: MAX_SMOOTHED_CORRECTION_DISTANCE
    }
  });
  let context: PredictionContext | undefined;
  let buffer:
    | MultiplayerPredictionBuffer<RealtimeArenaPredictedPlayer, RealtimeInputFrame>
    | undefined;
  let activePlayerId: string | undefined;
  let presentationActive = false;
  let latestDiagnostics: Pick<
    RealtimeArenaPredictionDiagnostics,
    "inputAckSequence" | "roundTripTimeMs" | "snapshotAgeMs" | "inputLead"
  > = {};
  const inputTimesBySequence = new Map<number, number>();

  function ensureBuffer(
    snapshot: RealtimeArenaSnapshot,
    playerId: string
  ): MultiplayerPredictionBuffer<RealtimeArenaPredictedPlayer, RealtimeInputFrame> | undefined {
    const authoritative = readRealtimeArenaPredictedPlayer(snapshot, playerId);
    if (!authoritative) {
      return undefined;
    }
    context = readRealtimeArenaPredictionContext(snapshot);
    if (!buffer || activePlayerId !== playerId) {
      activePlayerId = playerId;
      buffer = createMultiplayerPredictionBuffer({
        initialState: authoritative,
        cloneState: cloneRealtimeArenaPredictedPlayer,
        applyInput(state, input) {
          return applyRealtimeArenaPredictionInput(state, input, context);
        },
        presentation,
        predictionStepMs: REALTIME_ARENA_TICK_MS
      });
    }
    return buffer;
  }

  return {
    predict(snapshot, playerId, frame) {
      const currentBuffer = ensureBuffer(snapshot, playerId);
      if (!currentBuffer || snapshot.phase !== "running") {
        presentationActive = false;
        return undefined;
      }
      presentationActive = true;

      inputTimesBySequence.set(frame.sequence, frame.clientTime);
      currentBuffer.predict({
        sequence: frame.sequence,
        input: frame,
        timestamp: frame.clientTime
      });
      const inputLead = calculateRealtimeArenaInputLead(currentBuffer.diagnostics());
      latestDiagnostics = {
        ...latestDiagnostics,
        ...(inputLead === undefined ? {} : { inputLead })
      };
      return currentBuffer.state();
    },
    reconcile(payload, peerId, timing) {
      const playerId = payload.playersByPeerId[peerId];
      if (!playerId) {
        resetPrediction();
        return undefined;
      }

      const authoritative = readRealtimeArenaPredictedPlayer(payload.snapshot, playerId);
      if (!authoritative) {
        resetPrediction();
        return undefined;
      }

      context = readRealtimeArenaPredictionContext(payload.snapshot);
      const acknowledgedSequence =
        payload.inputAcksByPeerId[peerId] ??
        payload.snapshot.players.find((player) => player.id === playerId)?.lastInputSequence;

      const currentBuffer = ensureBuffer(payload.snapshot, playerId);
      if (!currentBuffer) {
        return undefined;
      }

      if (payload.snapshot.phase !== "running") {
        presentationActive = false;
        currentBuffer.reset(
          authoritative,
          acknowledgedSequence === undefined
            ? {}
            : { lastAcknowledgedSequence: acknowledgedSequence }
        );
      } else {
        presentationActive = true;
        currentBuffer.reconcile({
          authoritativeState: authoritative,
          ...(acknowledgedSequence === undefined ? {} : { acknowledgedSequence }),
          timestamp: timing.frameTime
        });
      }

      const roundTripTimeMs = readRoundTripTime(acknowledgedSequence, timing.frameTime);
      const inputLead = calculateRealtimeArenaInputLead(currentBuffer.diagnostics());
      latestDiagnostics = {
        snapshotAgeMs: Math.max(0, timing.wallTime - payload.serverTime),
        ...(acknowledgedSequence === undefined ? {} : { inputAckSequence: acknowledgedSequence }),
        ...(roundTripTimeMs === undefined ? {} : { roundTripTimeMs }),
        ...(inputLead === undefined ? {} : { inputLead })
      };
      deleteAcknowledgedInputs(acknowledgedSequence);
      return payload.snapshot.phase === "running" ? currentBuffer.state() : undefined;
    },
    state() {
      return buffer?.state();
    },
    present(deltaMs, timestamp) {
      return presentationActive
        ? buffer?.present({
            deltaMs,
            ...(timestamp === undefined ? {} : { timestamp })
          })
        : undefined;
    },
    reset() {
      resetPrediction();
    },
    diagnostics() {
      const coreDiagnostics = buffer?.diagnostics() ?? emptyRealtimeArenaPredictionDiagnostics();
      return {
        ...coreDiagnostics,
        ...latestDiagnostics
      };
    }
  };

  function resetPrediction(): void {
    buffer = undefined;
    activePlayerId = undefined;
    presentationActive = false;
    context = undefined;
    inputTimesBySequence.clear();
    latestDiagnostics = {};
  }

  function readRoundTripTime(
    acknowledgedSequence: number | undefined,
    frameTime: number
  ): number | undefined {
    if (acknowledgedSequence === undefined) {
      return undefined;
    }
    let inputTime = inputTimesBySequence.get(acknowledgedSequence);
    if (inputTime === undefined) {
      for (const [sequence, timestamp] of inputTimesBySequence) {
        if (sequence <= acknowledgedSequence) {
          inputTime = timestamp;
        }
      }
    }
    return inputTime === undefined ? undefined : Math.max(0, frameTime - inputTime);
  }

  function deleteAcknowledgedInputs(acknowledgedSequence: number | undefined): void {
    if (acknowledgedSequence === undefined) {
      return;
    }
    for (const sequence of Array.from(inputTimesBySequence.keys())) {
      if (sequence <= acknowledgedSequence) {
        inputTimesBySequence.delete(sequence);
      }
    }
  }
}

export function readRealtimeArenaPredictedPlayer(
  snapshot: RealtimeArenaSnapshot,
  playerId: string
): RealtimeArenaPredictedPlayer | undefined {
  const player = snapshot.players.find((candidate) => candidate.id === playerId);
  if (!player) {
    return undefined;
  }

  return {
    playerId: player.id,
    position: { ...player.position },
    velocity: { ...player.velocity },
    sprintRemainingMs: player.sprintRemainingMs,
    sprintCooldownMs: player.sprintCooldownMs
  };
}

export function readRealtimeArenaPredictionContext(
  snapshot: RealtimeArenaSnapshot
): PredictionContext {
  return {
    bounds: { ...snapshot.bounds },
    rules: { ...snapshot.rules },
    walls: snapshot.walls.map((wall) => ({ ...wall }))
  };
}

export function cloneRealtimeArenaPredictedPlayer(
  state: RealtimeArenaPredictedPlayer
): RealtimeArenaPredictedPlayer {
  return {
    playerId: state.playerId,
    position: { ...state.position },
    velocity: { ...state.velocity },
    sprintRemainingMs: state.sprintRemainingMs,
    sprintCooldownMs: state.sprintCooldownMs
  };
}

export function applyRealtimeArenaPredictionInput(
  state: RealtimeArenaPredictedPlayer,
  input: RealtimeInputFrame,
  context: PredictionContext | undefined
): RealtimeArenaPredictedPlayer {
  return advancePredictionState(state, input, REALTIME_ARENA_TICK_MS, context);
}

function advancePredictionState(
  state: RealtimeArenaPredictedPlayer,
  input: RealtimeInputFrame,
  deltaMs: number,
  context: PredictionContext | undefined
): RealtimeArenaPredictedPlayer {
  if (!context) {
    return state;
  }
  if (deltaMs <= 0) {
    return state;
  }

  state.sprintRemainingMs = Math.max(0, state.sprintRemainingMs - deltaMs);
  state.sprintCooldownMs = Math.max(0, state.sprintCooldownMs - deltaMs);
  if (input.sprint && state.sprintCooldownMs <= 0 && state.sprintRemainingMs <= 0) {
    state.sprintRemainingMs = context.rules.sprintDurationMs;
    state.sprintCooldownMs = context.rules.sprintCooldownMs;
  }

  const direction = normalizeVector({ x: input.moveX, y: input.moveY });
  const speed =
    context.rules.playerSpeedPerSecond *
    (state.sprintRemainingMs > 0 ? context.rules.sprintMultiplier : 1);
  const distancePerTick = (speed * deltaMs) / 1000;
  const nextPosition = {
    x: state.position.x + direction.x * distancePerTick,
    y: state.position.y + direction.y * distancePerTick
  };
  const resolved = resolveMovement(
    context,
    state.position,
    nextPosition,
    context.rules.playerRadius
  );
  state.velocity = {
    x: ((resolved.x - state.position.x) / deltaMs) * 1000,
    y: ((resolved.y - state.position.y) / deltaMs) * 1000
  };
  state.position = resolved;
  return state;
}

export function calculateRealtimeArenaInputLead(
  diagnostics: MultiplayerPredictionDiagnostics
): number | undefined {
  if (
    diagnostics.lastPredictedSequence === undefined ||
    diagnostics.lastAcknowledgedSequence === undefined
  ) {
    return undefined;
  }

  return Math.max(0, diagnostics.lastPredictedSequence - diagnostics.lastAcknowledgedSequence);
}

export function emptyRealtimeArenaPredictionDiagnostics(): MultiplayerPredictionDiagnostics {
  return {
    predictedInputs: 0,
    rejectedInputs: 0,
    acknowledgedInputs: 0,
    replayedInputs: 0,
    droppedInputs: 0,
    corrections: 0,
    resets: 0,
    presentedFrames: 0,
    clampedPresentationFrames: 0,
    smoothedCorrections: 0,
    correctionSmoothingActive: false,
    correctionSmoothingElapsedMs: 0,
    pendingInputs: 0,
    presentationElapsedMs: 0,
    presentationAlpha: 0,
    maxCorrectionMagnitude: 0
  };
}

function resolveMovement(
  context: PredictionContext,
  current: NetworkVector2,
  target: NetworkVector2,
  radius: number
): NetworkVector2 {
  const clampedTarget = clampToBounds(context, target, radius);
  if (!collidesWithWall(context.walls, clampedTarget, radius)) {
    return clampedTarget;
  }

  const xOnly = clampToBounds(context, { x: clampedTarget.x, y: current.y }, radius);
  if (!collidesWithWall(context.walls, xOnly, radius)) {
    return xOnly;
  }

  const yOnly = clampToBounds(context, { x: current.x, y: clampedTarget.y }, radius);
  if (!collidesWithWall(context.walls, yOnly, radius)) {
    return yOnly;
  }

  return { ...current };
}

function clampToBounds(
  context: PredictionContext,
  point: NetworkVector2,
  radius: number
): NetworkVector2 {
  return {
    x: clamp(point.x, radius, context.bounds.width - radius),
    y: clamp(point.y, radius, context.bounds.height - radius)
  };
}

function collidesWithWall(
  walls: RealtimeArenaWall[],
  point: NetworkVector2,
  radius: number
): boolean {
  return walls.some((wall) => pointIntersectsExpandedWall(wall, point, radius));
}

function pointIntersectsExpandedWall(
  wall: RealtimeArenaWall,
  point: NetworkVector2,
  radius: number
): boolean {
  return (
    point.x >= wall.x - radius &&
    point.x <= wall.x + wall.width + radius &&
    point.y >= wall.y - radius &&
    point.y <= wall.y + wall.height + radius
  );
}

function normalizeVector(vector: NetworkVector2): NetworkVector2 {
  const length = Math.hypot(vector.x, vector.y);
  if (length === 0) {
    return { x: 0, y: 0 };
  }

  return {
    x: vector.x / length,
    y: vector.y / length
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
