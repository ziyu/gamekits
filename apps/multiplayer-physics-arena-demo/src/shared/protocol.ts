import type { MultiplayerPhysicsArenaFrame } from "@gamekits/app-host";

import type { ArenaItemActionType } from "../items/item-action";
import type { ArenaItemAuthorityState } from "../items/item-authority-runtime";

import {
  ARENA_DEFINITION_VERSION,
  ARENA_SCHEMA_VERSION,
  type ArenaActorControlFrame,
  type ArenaMatchPhase,
  type ArenaMoveInput
} from "./config";

export type ArenaAuthorityDiagnostics = {
  receivedInputBundles: number;
  acceptedInputs: number;
  rejectedInputs: number;
  queuedInputs: number;
  payloadBytes: number;
  activePeers: number;
};

export type ArenaPublicParticipantStatus =
  | "lobby"
  | "active"
  | "qualified"
  | "eliminated"
  | "spectator"
  | "next-match"
  | "disconnected"
  | "finished";

export type ArenaPublicParticipantState = {
  id: string;
  kind: "human-slot" | "bot" | "spectator";
  slot: number;
  actorMemberId?: string | undefined;
  peerId?: string | undefined;
  connected: boolean;
  status: ArenaPublicParticipantStatus;
  resumeStatus?: ArenaPublicParticipantStatus | undefined;
  stageInstanceId?: string | undefined;
  revision: number;
};

export type ArenaPublicMatchState = {
  matchId: string;
  phaseInstanceId: string;
  stageIndex: number;
  stageCount: number;
  stageId: string;
  stageKind: "qualifier" | "brawl" | "final";
  qualificationCount: number;
  durationTicks: number;
  stageInstanceId: string;
  startedAtTick: number;
  stageStartedAtTick?: number | undefined;
  physicsStageStartedAtTick: number;
  deadlineTick?: number | undefined;
  membershipRevision: number;
};

export type ArenaPublicQualifierProgress = {
  participantId: string;
  checkpointCount: number;
  checkpointTotal: number;
  finished: boolean;
  normalizedProgress: number;
  progressTick: number;
};

export type ArenaPublicStagePlacement = {
  id: string;
  rank: number;
  participantId: string;
  outcome: "qualified" | "eliminated" | "winner";
  rankingKey: Array<number | string>;
};

export type ArenaPublicStageResult = {
  id: string;
  stageInstanceId: string;
  stageKind: "qualifier" | "brawl" | "final";
  reason: "stage-rule" | "timeout-tiebreak";
  placements: ArenaPublicStagePlacement[];
  qualifiedParticipantIds: string[];
  eliminatedParticipantIds: string[];
  winnerParticipantId?: string | undefined;
};

export type ArenaPublicItemState = {
  id: string;
  definitionId: string;
  instanceGeneration: number;
  state: ArenaItemAuthorityState;
  ownerParticipantId?: string | undefined;
  sourceParticipantId?: string | undefined;
  executionId?: string | undefined;
  stateChangedAtTick: number;
  deadlineTick?: number | undefined;
  revision: number;
  bodyMemberId?: string | undefined;
};

export type ArenaPublicItemAction = {
  id: string;
  participantId: string;
  type: ArenaItemActionType;
  status: "windup" | "confirmed" | "rejected";
  code: string;
  tick: number;
  itemId?: string | undefined;
  itemGeneration?: number | undefined;
  executionId?: string | undefined;
};

export type ArenaPublicCombatState = {
  participantId: string;
  instability: number;
  staggerUntilTick: number;
  lastHitTick?: number | undefined;
  revision: number;
};

export type ArenaPublicCombatHit = {
  id: string;
  sourceParticipantId: string;
  targetParticipantId: string;
  itemId: string;
  itemGeneration: number;
  definitionId: string;
  tick: number;
  impulseMagnitude: number;
  instability: number;
};

export type ArenaPublicCombatProjection = {
  actors: ArenaPublicCombatState[];
  hits: ArenaPublicCombatHit[];
};

export type ArenaSnapshot = {
  schemaVersion: typeof ARENA_SCHEMA_VERSION;
  phase: ArenaMatchPhase;
  round: number;
  countdownMs: number;
  roundTimeMs: number;
  winnerId?: string | undefined;
  match: ArenaPublicMatchState;
  participants: ArenaPublicParticipantState[];
  qualifierProgress: ArenaPublicQualifierProgress[];
  stageResults: ArenaPublicStageResult[];
  items: ArenaPublicItemState[];
  itemActions: ArenaPublicItemAction[];
  combat: ArenaPublicCombatProjection;
  frame: MultiplayerPhysicsArenaFrame;
  playerIdsByPeerId: Record<string, string>;
  inputAcksByPeerId: Record<string, number>;
  actorControlsByMemberId: Record<string, ArenaActorControlFrame>;
  removedMemberIds: string[];
  serverTime: number;
  authority: ArenaAuthorityDiagnostics;
};

export function readArenaMoveInput(value: unknown): ArenaMoveInput | undefined {
  if (
    !isRecord(value) ||
    !nonNegativeSafeInteger(value.sequence) ||
    !axis(value.moveX) ||
    !axis(value.moveZ) ||
    typeof value.jump !== "boolean" ||
    (value.authorityEpoch !== undefined && !boundedId(value.authorityEpoch))
  ) {
    return undefined;
  }
  return {
    sequence: value.sequence,
    moveX: value.moveX,
    moveZ: value.moveZ,
    jump: value.jump,
    ...(value.authorityEpoch === undefined ? {} : { authorityEpoch: value.authorityEpoch })
  };
}

export function readArenaSnapshot(value: unknown): ArenaSnapshot | undefined {
  if (
    !isRecord(value) ||
    value.schemaVersion !== ARENA_SCHEMA_VERSION ||
    !isPhase(value.phase) ||
    !nonNegativeSafeInteger(value.round) ||
    !nonNegativeFinite(value.countdownMs) ||
    !nonNegativeFinite(value.roundTimeMs) ||
    (value.winnerId !== undefined && typeof value.winnerId !== "string") ||
    !isPublicMatchState(value.match) ||
    value.match.membershipRevision < 1 ||
    value.match.stageIndex >= value.match.stageCount ||
    !Array.isArray(value.participants) ||
    value.participants.length > 64 ||
    !value.participants.every(isPublicParticipantState) ||
    new Set(value.participants.map((participant) => participant.id)).size !==
      value.participants.length ||
    !Array.isArray(value.qualifierProgress) ||
    value.qualifierProgress.length > 64 ||
    !value.qualifierProgress.every(isPublicQualifierProgress) ||
    new Set(value.qualifierProgress.map((entry) => entry.participantId)).size !==
      value.qualifierProgress.length ||
    !Array.isArray(value.stageResults) ||
    value.stageResults.length > 8 ||
    !value.stageResults.every(isPublicStageResult) ||
    new Set(value.stageResults.map((result) => result.id)).size !== value.stageResults.length ||
    !Array.isArray(value.items) ||
    value.items.length > 32 ||
    !value.items.every(isPublicItemState) ||
    new Set(value.items.map((item) => item.id)).size !== value.items.length ||
    !Array.isArray(value.itemActions) ||
    value.itemActions.length > 64 ||
    !value.itemActions.every(isPublicItemAction) ||
    new Set(value.itemActions.map((action) => action.id)).size !== value.itemActions.length ||
    !isPublicCombatProjection(value.combat) ||
    !isRecord(value.frame) ||
    value.frame.definitionVersion !== ARENA_DEFINITION_VERSION ||
    value.frame.membershipRevision !== value.match.membershipRevision ||
    !isRecord(value.playerIdsByPeerId) ||
    !isRecord(value.inputAcksByPeerId) ||
    !isRecord(value.actorControlsByMemberId) ||
    !boundedIdArray(value.removedMemberIds, 64) ||
    !nonNegativeFinite(value.serverTime) ||
    !isAuthorityDiagnostics(value.authority)
  ) {
    return undefined;
  }
  const playerIdsByPeerId = readStringMap(value.playerIdsByPeerId);
  const inputAcksByPeerId = readIntegerMap(value.inputAcksByPeerId);
  const actorControlsByMemberId = readActorControlMap(value.actorControlsByMemberId);
  if (
    playerIdsByPeerId === undefined ||
    inputAcksByPeerId === undefined ||
    actorControlsByMemberId === undefined
  ) {
    return undefined;
  }
  return structuredClone(value) as ArenaSnapshot;
}

function isPublicQualifierProgress(value: unknown): value is ArenaPublicQualifierProgress {
  return (
    isRecord(value) &&
    boundedId(value.participantId) &&
    nonNegativeSafeInteger(value.checkpointCount) &&
    nonNegativeSafeInteger(value.checkpointTotal) &&
    value.checkpointCount <= value.checkpointTotal &&
    typeof value.finished === "boolean" &&
    nonNegativeFinite(value.normalizedProgress) &&
    value.normalizedProgress <= 1 &&
    nonNegativeSafeInteger(value.progressTick)
  );
}

function isPublicCombatProjection(value: unknown): value is ArenaPublicCombatProjection {
  return (
    isRecord(value) &&
    Array.isArray(value.actors) &&
    value.actors.length <= 64 &&
    value.actors.every(isPublicCombatState) &&
    new Set(value.actors.map((actor) => actor.participantId)).size === value.actors.length &&
    Array.isArray(value.hits) &&
    value.hits.length <= 64 &&
    value.hits.every(isPublicCombatHit) &&
    new Set(value.hits.map((hit) => hit.id)).size === value.hits.length
  );
}

function isPublicCombatState(value: unknown): value is ArenaPublicCombatState {
  return (
    isRecord(value) &&
    boundedId(value.participantId) &&
    typeof value.instability === "number" &&
    Number.isFinite(value.instability) &&
    value.instability >= 0 &&
    value.instability <= 1 &&
    nonNegativeSafeInteger(value.staggerUntilTick) &&
    (value.lastHitTick === undefined || nonNegativeSafeInteger(value.lastHitTick)) &&
    positiveSafeInteger(value.revision)
  );
}

function isPublicCombatHit(value: unknown): value is ArenaPublicCombatHit {
  return (
    isRecord(value) &&
    boundedId(value.id) &&
    boundedId(value.sourceParticipantId) &&
    boundedId(value.targetParticipantId) &&
    value.sourceParticipantId !== value.targetParticipantId &&
    boundedId(value.itemId) &&
    positiveSafeInteger(value.itemGeneration) &&
    boundedId(value.definitionId) &&
    nonNegativeSafeInteger(value.tick) &&
    typeof value.impulseMagnitude === "number" &&
    Number.isFinite(value.impulseMagnitude) &&
    value.impulseMagnitude > 0 &&
    typeof value.instability === "number" &&
    Number.isFinite(value.instability) &&
    value.instability >= 0 &&
    value.instability <= 1
  );
}

function isPublicItemState(value: unknown): value is ArenaPublicItemState {
  return (
    isRecord(value) &&
    boundedId(value.id) &&
    boundedId(value.definitionId) &&
    positiveSafeInteger(value.instanceGeneration) &&
    isItemAuthorityState(value.state) &&
    (value.ownerParticipantId === undefined || boundedId(value.ownerParticipantId)) &&
    (value.sourceParticipantId === undefined || boundedId(value.sourceParticipantId)) &&
    (value.executionId === undefined || boundedId(value.executionId)) &&
    nonNegativeSafeInteger(value.stateChangedAtTick) &&
    (value.deadlineTick === undefined || nonNegativeSafeInteger(value.deadlineTick)) &&
    positiveSafeInteger(value.revision) &&
    (value.bodyMemberId === undefined || boundedId(value.bodyMemberId)) &&
    (value.bodyMemberId === undefined ||
      value.state === "world" ||
      value.state === "released" ||
      value.state === "triggered")
  );
}

function isPublicItemAction(value: unknown): value is ArenaPublicItemAction {
  return (
    isRecord(value) &&
    boundedId(value.id) &&
    boundedId(value.participantId) &&
    (value.type === "interact" || value.type === "use" || value.type === "drop") &&
    (value.status === "windup" || value.status === "confirmed" || value.status === "rejected") &&
    boundedId(value.code) &&
    nonNegativeSafeInteger(value.tick) &&
    (value.itemId === undefined || boundedId(value.itemId)) &&
    (value.itemGeneration === undefined || positiveSafeInteger(value.itemGeneration)) &&
    (value.itemId === undefined) === (value.itemGeneration === undefined) &&
    (value.executionId === undefined || boundedId(value.executionId))
  );
}

function isItemAuthorityState(value: unknown): value is ArenaItemAuthorityState {
  return (
    value === "world" ||
    value === "pickup-pending" ||
    value === "carried" ||
    value === "windup" ||
    value === "released" ||
    value === "melee-active" ||
    value === "triggered" ||
    value === "spent" ||
    value === "cooldown" ||
    value === "respawning"
  );
}

function isPublicMatchState(value: unknown): value is ArenaPublicMatchState {
  return (
    isRecord(value) &&
    boundedId(value.matchId) &&
    boundedId(value.phaseInstanceId) &&
    nonNegativeSafeInteger(value.stageIndex) &&
    nonNegativeSafeInteger(value.stageCount) &&
    value.stageCount > 0 &&
    boundedId(value.stageId) &&
    isStageKind(value.stageKind) &&
    positiveSafeInteger(value.qualificationCount) &&
    positiveSafeInteger(value.durationTicks) &&
    boundedId(value.stageInstanceId) &&
    nonNegativeSafeInteger(value.startedAtTick) &&
    (value.stageStartedAtTick === undefined || nonNegativeSafeInteger(value.stageStartedAtTick)) &&
    nonNegativeSafeInteger(value.physicsStageStartedAtTick) &&
    (value.deadlineTick === undefined || nonNegativeSafeInteger(value.deadlineTick)) &&
    nonNegativeSafeInteger(value.membershipRevision)
  );
}

function isPublicParticipantState(value: unknown): value is ArenaPublicParticipantState {
  return (
    isRecord(value) &&
    boundedId(value.id) &&
    (value.kind === "human-slot" || value.kind === "bot" || value.kind === "spectator") &&
    nonNegativeSafeInteger(value.slot) &&
    (value.actorMemberId === undefined || boundedId(value.actorMemberId)) &&
    (value.peerId === undefined || boundedId(value.peerId)) &&
    typeof value.connected === "boolean" &&
    isParticipantStatus(value.status) &&
    (value.resumeStatus === undefined || isParticipantStatus(value.resumeStatus)) &&
    (value.stageInstanceId === undefined || boundedId(value.stageInstanceId)) &&
    nonNegativeSafeInteger(value.revision) &&
    value.revision > 0
  );
}

function isPublicStageResult(value: unknown): value is ArenaPublicStageResult {
  if (
    !isRecord(value) ||
    !boundedId(value.id) ||
    !boundedId(value.stageInstanceId) ||
    !isStageKind(value.stageKind) ||
    (value.reason !== "stage-rule" && value.reason !== "timeout-tiebreak") ||
    !Array.isArray(value.placements) ||
    value.placements.length > 64 ||
    !value.placements.every(isPublicStagePlacement) ||
    new Set(value.placements.map((placement) => placement.id)).size !== value.placements.length ||
    !boundedIdArray(value.qualifiedParticipantIds, 64) ||
    !boundedIdArray(value.eliminatedParticipantIds, 64) ||
    (value.winnerParticipantId !== undefined && !boundedId(value.winnerParticipantId))
  ) {
    return false;
  }
  return true;
}

function isPublicStagePlacement(value: unknown): value is ArenaPublicStagePlacement {
  return (
    isRecord(value) &&
    boundedId(value.id) &&
    nonNegativeSafeInteger(value.rank) &&
    value.rank > 0 &&
    boundedId(value.participantId) &&
    (value.outcome === "qualified" ||
      value.outcome === "eliminated" ||
      value.outcome === "winner") &&
    Array.isArray(value.rankingKey) &&
    value.rankingKey.length <= 16 &&
    value.rankingKey.every(
      (entry) =>
        (typeof entry === "number" && Number.isFinite(entry)) ||
        (typeof entry === "string" && entry.length <= 256)
    )
  );
}

function isParticipantStatus(value: unknown): value is ArenaPublicParticipantStatus {
  return (
    value === "lobby" ||
    value === "active" ||
    value === "qualified" ||
    value === "eliminated" ||
    value === "spectator" ||
    value === "next-match" ||
    value === "disconnected" ||
    value === "finished"
  );
}

function isStageKind(value: unknown): value is ArenaPublicMatchState["stageKind"] {
  return value === "qualifier" || value === "brawl" || value === "final";
}

function boundedIdArray(value: unknown, capacity: number): value is string[] {
  return (
    Array.isArray(value) &&
    value.length <= capacity &&
    value.every(boundedId) &&
    new Set(value).size === value.length
  );
}

function boundedId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 256;
}

function readActorControlMap(
  value: Record<string, unknown>
): Record<string, ArenaActorControlFrame> | undefined {
  if (Object.keys(value).length > 64) return undefined;
  const result: Record<string, ArenaActorControlFrame> = {};
  for (const [memberId, entry] of Object.entries(value)) {
    if (
      memberId.length === 0 ||
      !isRecord(entry) ||
      !axis(entry.moveX) ||
      !axis(entry.moveZ) ||
      typeof entry.jump !== "boolean" ||
      !nonNegativeSafeInteger(entry.sequence)
    ) {
      return undefined;
    }
    result[memberId] = {
      sequence: entry.sequence,
      moveX: entry.moveX,
      moveZ: entry.moveZ,
      jump: entry.jump
    };
  }
  return result;
}

function readStringMap(value: Record<string, unknown>): Record<string, string> | undefined {
  const result: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (key.length === 0 || typeof entry !== "string" || entry.length === 0) return undefined;
    result[key] = entry;
  }
  return result;
}

function readIntegerMap(value: Record<string, unknown>): Record<string, number> | undefined {
  const result: Record<string, number> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (key.length === 0 || !nonNegativeSafeInteger(entry)) return undefined;
    result[key] = entry;
  }
  return result;
}

function isAuthorityDiagnostics(value: unknown): value is ArenaAuthorityDiagnostics {
  return (
    isRecord(value) &&
    nonNegativeSafeInteger(value.receivedInputBundles) &&
    nonNegativeSafeInteger(value.acceptedInputs) &&
    nonNegativeSafeInteger(value.rejectedInputs) &&
    nonNegativeSafeInteger(value.queuedInputs) &&
    nonNegativeSafeInteger(value.payloadBytes) &&
    nonNegativeSafeInteger(value.activePeers)
  );
}

function isPhase(value: unknown): value is ArenaMatchPhase {
  return value === "lobby" || value === "countdown" || value === "running" || value === "results";
}

function axis(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= -1 && value <= 1;
}

function nonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function positiveSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function nonNegativeFinite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
