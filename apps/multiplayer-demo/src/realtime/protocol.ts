import {
  MULTIPLAYER_ACTION_KIND,
  MULTIPLAYER_AUTHORITY_CHANNEL,
  MULTIPLAYER_INPUT_KIND,
  MULTIPLAYER_SNAPSHOT_KIND
} from "@gamekits/multiplayer-core";
import type { RealtimeArenaSnapshot, RealtimeInputFrame } from "./domain";

export const REALTIME_ARENA_CHANNEL = MULTIPLAYER_AUTHORITY_CHANNEL;
export const REALTIME_ARENA_ACTION_KIND = MULTIPLAYER_ACTION_KIND;
export const REALTIME_ARENA_INPUT_KIND = MULTIPLAYER_INPUT_KIND;
export const REALTIME_ARENA_SNAPSHOT_KIND = MULTIPLAYER_SNAPSHOT_KIND;

export type RealtimeArenaNetworkAction =
  | { type: "set-name"; name: string }
  | { type: "ready"; ready: boolean }
  | { type: "start" }
  | { type: "interact" }
  | { type: "rematch" }
  | { type: "reset" };

export type RealtimeArenaInputPayload = {
  frame: RealtimeInputFrame;
};

export type RealtimeArenaAuthorityInputDiagnostics = {
  queuedInputs: number;
  maxQueuedInputs: number;
  coalescedInputs: number;
};

export type RealtimeArenaParticipantStatus = "active" | "spectator" | "next-round" | "disconnected";

export type RealtimeArenaParticipant = {
  peerId: string;
  status: RealtimeArenaParticipantStatus;
  displayName?: string;
  playerId?: string;
  slot?: number;
  reason?: string;
};

export type RealtimeArenaParticipantSummary = {
  active: number;
  tracked: number;
  round: number;
  waiting: number;
  disconnected: number;
};

export type RealtimeArenaSnapshotPayload = {
  snapshot: RealtimeArenaSnapshot;
  playersByPeerId: Record<string, string>;
  inputAcksByPeerId: Record<string, number>;
  serverTime: number;
  authorityInput?: RealtimeArenaAuthorityInputDiagnostics;
  participantsByPeerId?: Record<string, RealtimeArenaParticipant>;
  participantSummary?: RealtimeArenaParticipantSummary;
};

export function isRealtimeArenaNetworkAction(value: unknown): value is RealtimeArenaNetworkAction {
  if (!isRecord(value) || typeof value.type !== "string") {
    return false;
  }

  switch (value.type) {
    case "set-name":
      return typeof value.name === "string";
    case "ready":
      return typeof value.ready === "boolean";
    case "start":
    case "interact":
    case "rematch":
    case "reset":
      return true;
    default:
      return false;
  }
}

export function readRealtimeArenaInputPayload(
  value: unknown
): RealtimeArenaInputPayload | undefined {
  if (!isRecord(value) || !isRealtimeInputFrame(value.frame)) {
    return undefined;
  }

  return {
    frame: {
      sequence: value.frame.sequence,
      clientTime: value.frame.clientTime,
      moveX: value.frame.moveX,
      moveY: value.frame.moveY,
      sprint: value.frame.sprint
    }
  };
}

export function readRealtimeArenaSnapshotPayload(
  value: unknown
): RealtimeArenaSnapshotPayload | undefined {
  if (
    !isRecord(value) ||
    !isRealtimeArenaSnapshot(value.snapshot) ||
    !isRecord(value.playersByPeerId) ||
    !isFiniteNumber(value.serverTime)
  ) {
    return undefined;
  }

  const playersByPeerId: Record<string, string> = {};
  for (const [peerId, playerId] of Object.entries(value.playersByPeerId)) {
    if (typeof playerId !== "string") {
      return undefined;
    }
    playersByPeerId[peerId] = playerId;
  }
  const inputAcksByPeerId: Record<string, number> = {};
  if (value.inputAcksByPeerId !== undefined) {
    if (!isRecord(value.inputAcksByPeerId)) {
      return undefined;
    }
    for (const [peerId, sequence] of Object.entries(value.inputAcksByPeerId)) {
      if (typeof sequence !== "number" || !Number.isInteger(sequence) || sequence < 0) {
        return undefined;
      }
      inputAcksByPeerId[peerId] = sequence;
    }
  }
  const authorityInput = readAuthorityInputDiagnostics(value.authorityInput);
  if (value.authorityInput !== undefined && authorityInput === undefined) {
    return undefined;
  }
  const participantsByPeerId = readParticipantsByPeerId(value.participantsByPeerId);
  if (value.participantsByPeerId !== undefined && participantsByPeerId === undefined) {
    return undefined;
  }
  const participantSummary = readParticipantSummary(value.participantSummary);
  if (value.participantSummary !== undefined && participantSummary === undefined) {
    return undefined;
  }

  return {
    snapshot: value.snapshot,
    playersByPeerId,
    inputAcksByPeerId,
    serverTime: value.serverTime,
    ...(authorityInput === undefined ? {} : { authorityInput }),
    ...(participantsByPeerId === undefined ? {} : { participantsByPeerId }),
    ...(participantSummary === undefined ? {} : { participantSummary })
  };
}

function readParticipantsByPeerId(
  value: unknown
): Record<string, RealtimeArenaParticipant> | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!isRecord(value)) {
    return undefined;
  }

  const participants: Record<string, RealtimeArenaParticipant> = {};
  for (const [peerId, candidate] of Object.entries(value)) {
    const participant = readParticipant(candidate);
    if (participant === undefined || participant.peerId !== peerId) {
      return undefined;
    }
    participants[peerId] = participant;
  }
  return participants;
}

function readParticipant(value: unknown): RealtimeArenaParticipant | undefined {
  if (
    !isRecord(value) ||
    typeof value.peerId !== "string" ||
    !isParticipantStatus(value.status) ||
    (value.displayName !== undefined && typeof value.displayName !== "string") ||
    (value.playerId !== undefined && typeof value.playerId !== "string") ||
    (value.slot !== undefined && !isNonNegativeInteger(value.slot)) ||
    (value.reason !== undefined && typeof value.reason !== "string")
  ) {
    return undefined;
  }

  return {
    peerId: value.peerId,
    status: value.status,
    ...(value.displayName === undefined ? {} : { displayName: value.displayName }),
    ...(value.playerId === undefined ? {} : { playerId: value.playerId }),
    ...(value.slot === undefined ? {} : { slot: value.slot }),
    ...(value.reason === undefined ? {} : { reason: value.reason })
  };
}

function readParticipantSummary(value: unknown): RealtimeArenaParticipantSummary | undefined {
  if (
    !isRecord(value) ||
    !isNonNegativeInteger(value.active) ||
    !isNonNegativeInteger(value.tracked) ||
    !isNonNegativeInteger(value.round) ||
    !isNonNegativeInteger(value.waiting) ||
    !isNonNegativeInteger(value.disconnected)
  ) {
    return undefined;
  }
  return {
    active: value.active,
    tracked: value.tracked,
    round: value.round,
    waiting: value.waiting,
    disconnected: value.disconnected
  };
}

function isParticipantStatus(value: unknown): value is RealtimeArenaParticipantStatus {
  return (
    value === "active" ||
    value === "spectator" ||
    value === "next-round" ||
    value === "disconnected"
  );
}

function readAuthorityInputDiagnostics(
  value: unknown
): RealtimeArenaAuthorityInputDiagnostics | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (
    !isRecord(value) ||
    !isNonNegativeInteger(value.queuedInputs) ||
    !isNonNegativeInteger(value.maxQueuedInputs) ||
    !isNonNegativeInteger(value.coalescedInputs)
  ) {
    return undefined;
  }
  return {
    queuedInputs: value.queuedInputs,
    maxQueuedInputs: value.maxQueuedInputs,
    coalescedInputs: value.coalescedInputs
  };
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function isRealtimeInputFrame(value: unknown): value is RealtimeInputFrame {
  if (!isRecord(value)) {
    return false;
  }

  return (
    isNonNegativeSafeInteger(value.sequence) &&
    isNonNegativeFiniteNumber(value.clientTime) &&
    isAxis(value.moveX) &&
    isAxis(value.moveY) &&
    typeof value.sprint === "boolean"
  );
}

function isRealtimeArenaSnapshot(value: unknown): value is RealtimeArenaSnapshot {
  return (
    isRecord(value) &&
    isArenaPhase(value.phase) &&
    isNonNegativeSafeInteger(value.tick) &&
    isNonNegativeFiniteNumber(value.phaseElapsedMs) &&
    isNonNegativeFiniteNumber(value.roundElapsedMs) &&
    isBounds(value.bounds) &&
    isRules(value.rules) &&
    Array.isArray(value.players) &&
    value.players.every(isPlayer) &&
    Array.isArray(value.cores) &&
    value.cores.every(isCore) &&
    Array.isArray(value.relayNodes) &&
    value.relayNodes.every(isRelayNode) &&
    Array.isArray(value.walls) &&
    value.walls.every(isWall) &&
    isScore(value.score) &&
    Array.isArray(value.events) &&
    value.events.every(isArenaEvent) &&
    (value.result === undefined || isRoundResult(value.result))
  );
}

function isArenaPhase(value: unknown): boolean {
  return (
    value === "lobby" ||
    value === "countdown" ||
    value === "running" ||
    value === "ending" ||
    value === "results"
  );
}

function isBounds(value: unknown): boolean {
  return (
    isRecord(value) &&
    isNonNegativeFiniteNumber(value.width) &&
    isNonNegativeFiniteNumber(value.height)
  );
}

function isRules(value: unknown): boolean {
  if (!isRecord(value)) {
    return false;
  }
  return [
    value.countdownMs,
    value.roundDurationMs,
    value.endingDurationMs,
    value.scoreLimit,
    value.playerRadius,
    value.playerSpeedPerSecond,
    value.inputTimeoutMs,
    value.sprintMultiplier,
    value.sprintDurationMs,
    value.sprintCooldownMs,
    value.pickupRadius,
    value.deliverRadius,
    value.maxEvents
  ].every(isNonNegativeFiniteNumber);
}

function isPlayer(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.label === "string" &&
    typeof value.teamId === "string" &&
    isNonNegativeSafeInteger(value.slot) &&
    typeof value.ready === "boolean" &&
    typeof value.connected === "boolean" &&
    isVector(value.spawn) &&
    isVector(value.position) &&
    isVector(value.velocity) &&
    isNonNegativeSafeInteger(value.lastInputSequence) &&
    isNonNegativeFiniteNumber(value.inputStateAgeMs) &&
    isNonNegativeFiniteNumber(value.sprintRemainingMs) &&
    isNonNegativeFiniteNumber(value.sprintCooldownMs) &&
    isNonNegativeSafeInteger(value.deliveredCores) &&
    isNonNegativeSafeInteger(value.rejectedInputs) &&
    (value.carryingCoreId === undefined || typeof value.carryingCoreId === "string") &&
    (value.inputState === undefined || isRealtimeInputFrame(value.inputState))
  );
}

function isCore(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    isVector(value.spawn) &&
    isVector(value.position) &&
    isNonNegativeFiniteNumber(value.radius) &&
    (value.carriedByPlayerId === undefined || typeof value.carriedByPlayerId === "string")
  );
}

function isRelayNode(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.teamId === "string" &&
    isVector(value.position) &&
    isNonNegativeFiniteNumber(value.radius)
  );
}

function isWall(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    isFiniteNumber(value.x) &&
    isFiniteNumber(value.y) &&
    isNonNegativeFiniteNumber(value.width) &&
    isNonNegativeFiniteNumber(value.height)
  );
}

function isVector(value: unknown): boolean {
  return isRecord(value) && isFiniteNumber(value.x) && isFiniteNumber(value.y);
}

function isScore(value: unknown): boolean {
  return isRecord(value) && Object.values(value).every(isNonNegativeFiniteNumber);
}

function isArenaEvent(value: unknown): boolean {
  return (
    isRecord(value) &&
    isNonNegativeSafeInteger(value.id) &&
    isNonNegativeSafeInteger(value.tick) &&
    isArenaEventType(value.type) &&
    (value.playerId === undefined || typeof value.playerId === "string") &&
    (value.teamId === undefined || typeof value.teamId === "string") &&
    (value.coreId === undefined || typeof value.coreId === "string") &&
    (value.code === undefined || typeof value.code === "string") &&
    typeof value.label === "string"
  );
}

function isArenaEventType(value: unknown): boolean {
  return (
    value === "player.joined" ||
    value === "player.disconnected" ||
    value === "player.reconnected" ||
    value === "player.left" ||
    value === "player.name" ||
    value === "player.ready" ||
    value === "round.countdown" ||
    value === "round.started" ||
    value === "round.ending" ||
    value === "round.results" ||
    value === "round.rematch" ||
    value === "core.picked" ||
    value === "core.delivered" ||
    value === "input.rejected"
  );
}

function isRoundResult(value: unknown): boolean {
  return (
    isRecord(value) &&
    (value.reason === "score-limit" || value.reason === "time-limit" || value.reason === "draw") &&
    isScore(value.score) &&
    isNonNegativeFiniteNumber(value.durationMs) &&
    (value.winnerTeamId === undefined || typeof value.winnerTeamId === "string")
  );
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isNonNegativeFiniteNumber(value: unknown): value is number {
  return isFiniteNumber(value) && value >= 0;
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isAxis(value: unknown): value is -1 | 0 | 1 {
  return value === -1 || value === 0 || value === 1;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
