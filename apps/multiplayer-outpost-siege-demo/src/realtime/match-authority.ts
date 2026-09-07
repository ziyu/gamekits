import {
  createMultiplayerAuthorityBindingStore,
  createMultiplayerAuthorityHostLoop,
  createMultiplayerParticipantPolicy,
  createMultiplayerPeerPlayerBindingStore,
  type MultiplayerAuthorityDecision,
  type MultiplayerAuthorityHostLoop,
  type MultiplayerMessageEnvelope,
  type MultiplayerPeer,
  type MultiplayerPeerPlayerBinding,
  type MultiplayerRuntime
} from "@gamekits/multiplayer-core";

import { OUTPOST_ARENA } from "../content";
import type { OutpostPlayerAction, OutpostReplicatedCombatState } from "../domain";
import type {
  OutpostAuthorityGameplaySnapshot,
  OutpostAuthorityPlayerInput,
  OutpostAuthorityPlayerSnapshot,
  OutpostAuthorityPlayerState
} from "../gameplay/authority-runtime";
import type { OutpostAuthorityCombatCommand } from "../gameplay/authority-combat";
import type { OutpostAuthorityPlayerActionCommand } from "../gameplay/player/action-types";

const DEFAULT_COUNTDOWN_MS = 3_000;
const DEFAULT_MAX_PLAYERS = 4;
const DEFAULT_MIN_PLAYERS = 1;
const MAX_INPUT_BACKLOG_PER_PLAYER = 4;
const DEFAULT_SPAWN_POINTS = Object.freeze([
  { x: OUTPOST_ARENA.width / 2 - 64, y: OUTPOST_ARENA.height / 2 },
  { x: OUTPOST_ARENA.width / 2 + 64, y: OUTPOST_ARENA.height / 2 },
  { x: OUTPOST_ARENA.width / 2, y: OUTPOST_ARENA.height / 2 - 64 },
  { x: OUTPOST_ARENA.width / 2, y: OUTPOST_ARENA.height / 2 + 64 }
]);

export type OutpostMatchPhase = "lobby" | "countdown" | "running";

export type OutpostMatchAction =
  | {
      type: "ready";
      ready: boolean;
    }
  | {
      type: "player-action";
      action: OutpostPlayerAction;
      aimX: number;
      aimY: number;
      fireSequence?: number;
      fireHeld?: boolean;
      dashSequence?: number;
    };

export type OutpostMatchInput = OutpostAuthorityPlayerInput;

export type OutpostMatchParticipantSnapshot = {
  peerId: string;
  playerId: string;
  status: "active" | "next-round" | "spectator";
  ready: boolean;
  slot?: number;
  displayName?: string;
};

export type OutpostMatchAuthoritySnapshot = {
  phase: OutpostMatchPhase;
  tick: number;
  elapsedMs: number;
  countdownMsRemaining: number;
  participants: OutpostMatchParticipantSnapshot[];
  players: OutpostAuthorityPlayerSnapshot[];
  combat: OutpostReplicatedCombatState;
  inputAcksByPeerId: Record<string, number>;
  authorityInput: {
    acceptedActions: number;
    rejectedActions: number;
    acceptedInputs: number;
    rejectedInputs: number;
    coalescedInputs: number;
    queuedInputs: number;
  };
};

export type OutpostMatchAuthority = {
  beginTick(deltaMs: number): void;
  commitTick(): Promise<void>;
  simulationPlayers(): OutpostAuthorityPlayerState[];
  drainPlayerActions(): OutpostAuthorityPlayerActionCommand[];
  drainCombatCommands(): OutpostAuthorityCombatCommand[];
  snapshot(): OutpostMatchAuthoritySnapshot;
  dispose(): void;
};

export type CreateOutpostMatchAuthorityOptions = {
  runtime: MultiplayerRuntime;
  sessionId: string;
  authorityPeerId: string;
  countdownMs?: number;
  minPlayers?: number;
  maxPlayers?: number;
  spawnPoints?: readonly { x: number; y: number }[];
  gameplaySnapshot?(): OutpostAuthorityGameplaySnapshot | undefined;
  publishSnapshot?(snapshot: OutpostMatchAuthoritySnapshot): void | Promise<void>;
};

type ParticipantPolicyContext = {
  phase: OutpostMatchPhase;
};

const PARTICIPANT_POLICY = createMultiplayerParticipantPolicy<ParticipantPolicyContext>({
  join: "active",
  lateJoin: "next-round",
  leave: "remove",
  disconnect: "remove",
  reconnect: "restore",
  boundary: "retain"
});

export function createOutpostMatchAuthority(
  options: CreateOutpostMatchAuthorityOptions
): OutpostMatchAuthority {
  const countdownMs = nonNegativeFinite(options.countdownMs ?? DEFAULT_COUNTDOWN_MS, "countdownMs");
  const minPlayers = positiveInteger(options.minPlayers ?? DEFAULT_MIN_PLAYERS, "minPlayers");
  const maxPlayers = positiveInteger(options.maxPlayers ?? DEFAULT_MAX_PLAYERS, "maxPlayers");
  if (minPlayers > maxPlayers) {
    throw new Error("minPlayers must not exceed maxPlayers.");
  }
  const spawnPoints = normalizeSpawnPoints(options.spawnPoints ?? DEFAULT_SPAWN_POINTS, maxPlayers);
  const bindings = createMultiplayerPeerPlayerBindingStore({
    defaultDisplayName: "Ranger",
    maxDisplayNameLength: 24
  });
  const readyByPeerId = new Map<string, boolean>();
  const inputsByPlayerId = new Map<string, OutpostMatchInput>();
  const inputAcksByPeerId = new Map<string, number>();
  const pendingPlayerActions: OutpostAuthorityPlayerActionCommand[] = [];
  const pendingCombatCommands: OutpostAuthorityCombatCommand[] = [];
  let phase: OutpostMatchPhase = "lobby";
  let countdownMsRemaining = countdownMs;
  let disposed = false;

  const authorityBinding = createMultiplayerAuthorityBindingStore({
    sessionId: options.sessionId,
    mode: "server-authoritative",
    authorityPeerId: options.authorityPeerId,
    authorityEndpoint: {
      kind: "server",
      id: options.authorityPeerId,
      peerId: options.authorityPeerId
    }
  });
  const authorityLoop: MultiplayerAuthorityHostLoop = createMultiplayerAuthorityHostLoop<
    OutpostMatchAction,
    OutpostMatchInput,
    OutpostMatchAuthoritySnapshot
  >({
    runtime: options.runtime,
    binding: authorityBinding,
    readAction: readMatchAction,
    readInput: readMatchInput,
    inputSequence(input) {
      return input.sequence;
    },
    inputQueueMode: "fifo",
    maxInputsPerSourcePerTick: 1,
    maxActionsPerSourcePerTick: 4,
    maxQueuedActionsPerSource: 16,
    maxQueuedActions: maxPlayers * 16,
    maxQueuedInputs: maxPlayers * MAX_INPUT_BACKLOG_PER_PLAYER,
    maxQueuedInputsPerSource: MAX_INPUT_BACKLOG_PER_PLAYER,
    handleAction({ message, payload }) {
      return handleAction(message, payload);
    },
    handleInput({ message, payload }) {
      return handleInput(message.sourcePeerId, payload);
    },
    tick({ deltaMs }) {
      reconcilePeers();
      advanceMatch(deltaMs);
    },
    captureSnapshot() {
      return createSnapshot();
    },
    ...(options.publishSnapshot === undefined ? {} : { publishSnapshot: options.publishSnapshot })
  });

  function handleAction(
    message: MultiplayerMessageEnvelope,
    action: OutpostMatchAction
  ): MultiplayerAuthorityDecision {
    const peerId = message.sourcePeerId;
    const binding = ensurePeerFromRuntime(peerId);
    if (!binding || binding.status !== "active") {
      return reject("participant-inactive", `Peer is not an active Outpost participant: ${peerId}`);
    }
    if (action.type === "ready") {
      if (phase === "running") {
        return reject("match-already-running", "Ready state cannot change after the match starts.");
      }
      readyByPeerId.set(peerId, action.ready);
      evaluateCountdownEligibility();
      return { allowed: true };
    }
    if (phase !== "running") {
      return reject(
        "match-not-running",
        "Combat actions are accepted only while the match is running."
      );
    }
    if (pendingCombatCommands.length + pendingPlayerActions.length >= maxPlayers * 4) {
      return reject(
        "player-action-queue-full",
        "Outpost player action queue is full for this tick."
      );
    }
    pendingPlayerActions.push({
      id: message.id,
      playerId: binding.playerId,
      action: action.action,
      aimX: action.aimX,
      aimY: action.aimY,
      ...(action.fireSequence === undefined ? {} : { fireSequence: action.fireSequence }),
      ...(action.fireHeld === undefined ? {} : { fireHeld: action.fireHeld }),
      ...(action.dashSequence === undefined ? {} : { dashSequence: action.dashSequence }),
      ...(message.correlationId === undefined ? {} : { correlationId: message.correlationId }),
      parentId: message.id
    });
    return { allowed: true };
  }

  function handleInput(peerId: string, input: OutpostMatchInput): MultiplayerAuthorityDecision {
    if (phase !== "running") {
      return reject(
        "match-not-running",
        "Movement input is accepted only while the match is running."
      );
    }
    const binding = bindings.bindingForPeer(peerId);
    if (!binding || binding.status !== "active") {
      return reject("participant-inactive", `Peer is not an active Outpost participant: ${peerId}`);
    }
    inputsByPlayerId.set(binding.playerId, input);
    inputAcksByPeerId.set(peerId, input.sequence);
    return { allowed: true };
  }

  function reconcilePeers(): void {
    const activePeerIds = new Set<string>();
    for (const peer of options.runtime.peers()) {
      if (peer.id === options.authorityPeerId || peer.role === "server") {
        continue;
      }
      if (isActivePeer(peer)) {
        activePeerIds.add(peer.id);
        ensurePeer(peer);
      }
    }

    for (const binding of bindings.bindings()) {
      if (!activePeerIds.has(binding.peerId)) {
        removePeer(binding);
      }
    }
    evaluateCountdownEligibility();
  }

  function ensurePeerFromRuntime(peerId: string): MultiplayerPeerPlayerBinding | undefined {
    const current = bindings.bindingForPeer(peerId);
    if (current) {
      return current;
    }
    const peer = options.runtime.peers().find((candidate) => candidate.id === peerId);
    return peer && isActivePeer(peer) ? ensurePeer(peer) : undefined;
  }

  function ensurePeer(peer: MultiplayerPeer): MultiplayerPeerPlayerBinding | undefined {
    const current = bindings.bindingForPeer(peer.id);
    if (current) {
      return current;
    }
    const decision =
      phase === "running"
        ? PARTICIPANT_POLICY.lateJoin({ peer, context: { phase } })
        : PARTICIPANT_POLICY.join({ peer, context: { phase } });
    const activeBindings = bindings.activeBindings();
    const resolvedDecision =
      decision === "active" && activeBindings.length >= maxPlayers ? "spectator" : decision;
    if (resolvedDecision === "reject") {
      return undefined;
    }

    const playerId = peer.playerId ?? peer.id;
    const conflictingBinding = bindings
      .bindings()
      .find((binding) => binding.playerId === playerId && binding.peerId !== peer.id);
    if (conflictingBinding) {
      return undefined;
    }
    const status = resolvedDecision === "active" ? "active" : resolvedDecision;
    const slot = status === "active" ? firstAvailableSlot(activeBindings, maxPlayers) : undefined;
    const binding = bindings.bindPeer(peer, {
      playerId,
      status,
      ...(slot === undefined ? {} : { slot })
    });
    readyByPeerId.set(peer.id, false);
    if (status === "active") {
      inputsByPlayerId.set(playerId, idleInput());
      inputAcksByPeerId.set(peer.id, 0);
    }
    return binding;
  }

  function removePeer(binding: MultiplayerPeerPlayerBinding): void {
    authorityLoop.releasePeer(binding.peerId);
    const decision = PARTICIPANT_POLICY.disconnect({
      peerId: binding.peerId,
      binding,
      context: { phase }
    });
    bindings.markPeerLeft(binding.peerId, {
      status: decision === "spectator" ? "spectator" : "left",
      remove: decision === "remove"
    });
    readyByPeerId.delete(binding.peerId);
    inputAcksByPeerId.delete(binding.peerId);
    inputsByPlayerId.delete(binding.playerId);
  }

  function evaluateCountdownEligibility(): void {
    if (phase === "running") {
      return;
    }
    const active = bindings.activeBindings();
    const allReady =
      active.length >= minPlayers && active.every((binding) => readyByPeerId.get(binding.peerId));
    if (!allReady) {
      phase = "lobby";
      countdownMsRemaining = countdownMs;
      return;
    }
    if (countdownMs === 0) {
      phase = "running";
      countdownMsRemaining = 0;
      return;
    }
    if (phase === "lobby") {
      phase = "countdown";
      countdownMsRemaining = countdownMs;
    }
  }

  function advanceMatch(deltaMs: number): void {
    if (phase !== "countdown") {
      return;
    }
    countdownMsRemaining = Math.max(0, countdownMsRemaining - Math.max(0, deltaMs));
    if (countdownMsRemaining === 0) {
      phase = "running";
    }
  }

  function simulationPlayers(): OutpostAuthorityPlayerState[] {
    if (phase !== "running") {
      return [];
    }
    return bindings
      .activeBindings()
      .flatMap((binding) => {
        if (typeof binding.slot !== "number") {
          return [];
        }
        const spawn = spawnPoints[binding.slot];
        if (!spawn) {
          return [];
        }
        return [
          {
            playerId: binding.playerId,
            slot: binding.slot,
            spawn,
            input: inputsByPlayerId.get(binding.playerId) ?? idleInput()
          }
        ];
      })
      .sort((left, right) => left.slot - right.slot);
  }

  function createSnapshot(): OutpostMatchAuthoritySnapshot {
    const diagnostics = authorityLoop.diagnostics();
    const gameplay = options.gameplaySnapshot?.();
    const physicalPlayers = gameplay?.players ?? [];
    return {
      phase,
      tick: diagnostics.tick,
      elapsedMs: gameplay?.elapsedMs ?? 0,
      countdownMsRemaining,
      participants: bindings
        .bindings()
        .map((binding) => participantSnapshot(binding, readyByPeerId.get(binding.peerId) ?? false))
        .sort((left, right) => (left.slot ?? maxPlayers) - (right.slot ?? maxPlayers)),
      players: physicalPlayers.map((player) => ({ ...player })),
      combat: projectCombatState(gameplay),
      inputAcksByPeerId: Object.fromEntries(inputAcksByPeerId),
      authorityInput: {
        acceptedActions: diagnostics.acceptedActions,
        rejectedActions: diagnostics.rejectedActions,
        acceptedInputs: diagnostics.acceptedInputs,
        rejectedInputs: diagnostics.rejectedInputs,
        coalescedInputs: diagnostics.coalescedInputs,
        queuedInputs: diagnostics.queuedInputs
      }
    };
  }

  return {
    beginTick(deltaMs) {
      if (!disposed) {
        authorityLoop.beginTick(deltaMs);
      }
    },
    commitTick() {
      return disposed ? Promise.resolve() : authorityLoop.commitTick();
    },
    simulationPlayers,
    drainPlayerActions() {
      return pendingPlayerActions.splice(0, pendingPlayerActions.length);
    },
    drainCombatCommands() {
      return pendingCombatCommands.splice(0, pendingCombatCommands.length);
    },
    snapshot: createSnapshot,
    dispose() {
      if (disposed) {
        return;
      }
      disposed = true;
      authorityLoop.dispose();
      authorityBinding.close("Outpost match authority disposed");
      bindings.close("Outpost match authority disposed");
      readyByPeerId.clear();
      inputsByPlayerId.clear();
      inputAcksByPeerId.clear();
      pendingPlayerActions.length = 0;
      pendingCombatCommands.length = 0;
    }
  };
}

function projectCombatState(
  gameplay: OutpostAuthorityGameplaySnapshot | undefined
): OutpostReplicatedCombatState {
  const combat = gameplay?.combat;
  if (!combat) {
    return {
      actors: [],
      projectiles: [],
      projectileGeneration: "outpost.unbound",
      projectileRecords: [],
      cueWatermark: 0,
      cues: [],
      acceptedCommands: 0,
      rejectedCommands: 0,
      projectileHits: 0,
      enemyAttacks: 0,
      kills: 0,
      drops: 0,
      objectiveProgress: 0
    };
  }
  return {
    actors: combat.actors.map(({ id, entityId: _entityId, actorId: _actorId, ...actor }) => ({
      objectId: id,
      ...actor,
      tags: [...actor.tags],
      cooldowns: { ...actor.cooldowns },
      ...(actor.weapon === undefined
        ? {}
        : {
            weapon: {
              ...actor.weapon,
              ...(actor.weapon.lastFeedback === undefined
                ? {}
                : { lastFeedback: { ...actor.weapon.lastFeedback } })
            }
          })
    })),
    projectiles: combat.projectiles.map(({ id, entityId: _entityId, ...projectile }) => ({
      objectId: id,
      ...projectile
    })),
    projectileGeneration: combat.projectileGeneration,
    projectileRecords: combat.projectileRecords.map((record) => ({
      ...record,
      firePosition: { ...record.firePosition },
      fireVelocity: { ...record.fireVelocity },
      ...(record.finish === undefined
        ? {}
        : {
            finish: {
              ...record.finish,
              position: { ...record.finish.position },
              ...(record.finish.normal === undefined
                ? {}
                : { normal: { ...record.finish.normal } }),
              ...(record.finish.subject === undefined
                ? {}
                : { subject: { ...record.finish.subject } })
            }
          })
    })),
    cueWatermark: combat.cueWatermark,
    cues: combat.cues.map((cue) => ({
      ...cue,
      ...(cue.position === undefined ? {} : { position: { ...cue.position } }),
      ...(cue.normal === undefined ? {} : { normal: { ...cue.normal } }),
      ...(cue.direction === undefined ? {} : { direction: { ...cue.direction } })
    })),
    acceptedCommands: combat.acceptedCommands,
    rejectedCommands: combat.rejectedCommands,
    projectileHits: combat.projectileHits,
    enemyAttacks: combat.enemyAttacks,
    kills: combat.kills,
    drops: combat.drops,
    objectiveProgress: combat.objectiveProgress
  };
}

function participantSnapshot(
  binding: MultiplayerPeerPlayerBinding,
  ready: boolean
): OutpostMatchParticipantSnapshot {
  const status =
    binding.status === "active"
      ? "active"
      : binding.status === "next-round"
        ? "next-round"
        : "spectator";
  return {
    peerId: binding.peerId,
    playerId: binding.playerId,
    status,
    ready: binding.status === "active" && ready,
    ...(typeof binding.slot === "number" ? { slot: binding.slot } : {}),
    ...(binding.displayName === undefined ? {} : { displayName: binding.displayName })
  };
}

function readMatchAction(payload: unknown): OutpostMatchAction | undefined {
  if (!isRecord(payload)) {
    return undefined;
  }
  if (payload.type === "ready" && typeof payload.ready === "boolean") {
    return { type: "ready", ready: payload.ready };
  }
  if (
    payload.type === "player-action" &&
    isPlayerAction(payload.action) &&
    finiteNumber(payload.aimX) &&
    finiteNumber(payload.aimY) &&
    (payload.action !== "rifle" ||
      (uint32(payload.fireSequence) && typeof payload.fireHeld === "boolean")) &&
    (payload.action !== "dash" ||
      payload.dashSequence === undefined ||
      uint32(payload.dashSequence))
  ) {
    return {
      type: "player-action",
      action: payload.action,
      aimX: payload.aimX,
      aimY: payload.aimY,
      ...(payload.action === "rifle"
        ? { fireSequence: payload.fireSequence as number, fireHeld: payload.fireHeld as boolean }
        : {}),
      ...(payload.action === "dash" && uint32(payload.dashSequence)
        ? { dashSequence: payload.dashSequence }
        : {})
    };
  }
  return undefined;
}

function readMatchInput(payload: unknown): OutpostMatchInput | undefined {
  if (
    !isRecord(payload) ||
    typeof payload.sequence !== "number" ||
    !Number.isSafeInteger(payload.sequence) ||
    payload.sequence < 0 ||
    !finiteNumber(payload.moveX) ||
    !finiteNumber(payload.moveY)
  ) {
    return undefined;
  }
  return {
    sequence: payload.sequence,
    moveX: clamp(payload.moveX, -1, 1),
    moveY: clamp(payload.moveY, -1, 1),
    aimX: finiteNumber(payload.aimX) ? payload.aimX : OUTPOST_ARENA.width / 2,
    aimY: finiteNumber(payload.aimY) ? payload.aimY : OUTPOST_ARENA.height / 2,
    fireHeld: payload.fireHeld === true,
    fireSequence: uint32(payload.fireSequence) ? payload.fireSequence : 0,
    dashSequence: uint32(payload.dashSequence) ? payload.dashSequence : 0
  };
}

function idleInput(): OutpostMatchInput {
  return {
    sequence: 0,
    moveX: 0,
    moveY: 0,
    aimX: OUTPOST_ARENA.width / 2,
    aimY: OUTPOST_ARENA.height / 2,
    fireHeld: false,
    fireSequence: 0,
    dashSequence: 0
  };
}

function uint32(value: unknown): value is number {
  return (
    typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= 0xffff_ffff
  );
}

function firstAvailableSlot(
  bindings: readonly MultiplayerPeerPlayerBinding[],
  maxPlayers: number
): number {
  const used = new Set(
    bindings.flatMap((binding) => (typeof binding.slot === "number" ? [binding.slot] : []))
  );
  for (let slot = 0; slot < maxPlayers; slot += 1) {
    if (!used.has(slot)) {
      return slot;
    }
  }
  throw new Error("Outpost participant slot capacity was exhausted.");
}

function normalizeSpawnPoints(
  points: readonly { x: number; y: number }[],
  maxPlayers: number
): ReadonlyArray<{ x: number; y: number }> {
  if (points.length < maxPlayers) {
    throw new Error(`Outpost match requires at least ${maxPlayers} spawn points.`);
  }
  return points.slice(0, maxPlayers).map((point, index) => {
    if (!finiteNumber(point.x) || !finiteNumber(point.y)) {
      throw new Error(`Outpost spawn point ${index} must contain finite coordinates.`);
    }
    return Object.freeze({ x: point.x, y: point.y });
  });
}

function isActivePeer(peer: MultiplayerPeer): boolean {
  return peer.status === "joining" || peer.status === "connected" || peer.status === "ready";
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive safe integer.`);
  }
  return value;
}

function nonNegativeFinite(value: number, name: string): number {
  if (!finiteNumber(value) || value < 0) {
    throw new Error(`${name} must be a non-negative finite number.`);
  }
  return value;
}

function finiteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function reject(code: string, reason: string): MultiplayerAuthorityDecision {
  return { allowed: false, code, reason };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPlayerAction(value: unknown): value is OutpostPlayerAction {
  return (
    value === "rifle" ||
    value === "reload" ||
    value === "dash" ||
    value === "shock-field" ||
    value === "deploy-turret"
  );
}
