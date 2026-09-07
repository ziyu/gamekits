import {
  createMultiplayerAuthorityBindingStore,
  createMultiplayerAuthorityHostLoop,
  createMultiplayerParticipantPolicy,
  createMultiplayerPeerPlayerBindingStore,
  type MultiplayerAuthorityDecision,
  type MultiplayerMessageEnvelope,
  type MultiplayerPeer,
  type MultiplayerPeerPlayerBinding,
  type MultiplayerPeerPlayerBindingStore,
  type MultiplayerRuntime
} from "@gamekits/multiplayer-core";
import { createRealtimePracticeArenaState, REALTIME_ARENA_TICK_MS } from "./config";
import {
  applyRealtimeArenaPlayerInteract,
  applyRealtimeInputFrame,
  captureRealtimeArenaSnapshot,
  disconnectRealtimeArenaPlayer,
  joinRealtimeArenaPlayer,
  rematchRealtimeArena,
  removeRealtimeArenaPlayer,
  reconnectRealtimeArenaPlayer,
  setRealtimeArenaPlayerName,
  setRealtimeArenaPlayerReady,
  startRealtimeArenaCountdown,
  tickRealtimeArena,
  type RealtimeArenaActionResult,
  type RealtimeArenaState,
  type RealtimeInputFrame
} from "./domain";
import {
  isRealtimeArenaNetworkAction,
  readRealtimeArenaInputPayload,
  REALTIME_ARENA_ACTION_KIND,
  REALTIME_ARENA_CHANNEL,
  REALTIME_ARENA_INPUT_KIND,
  REALTIME_ARENA_SNAPSHOT_KIND,
  type RealtimeArenaParticipant,
  type RealtimeArenaParticipantStatus,
  type RealtimeArenaParticipantSummary,
  type RealtimeArenaNetworkAction,
  type RealtimeArenaSnapshotPayload
} from "./protocol";

export type RealtimeArenaHost = {
  readonly state: RealtimeArenaState;
  snapshot(): RealtimeArenaSnapshotPayload;
  diagnostics(): RealtimeArenaHostDiagnostics;
  tick(delta?: number): void;
  dispose(): void;
};

export type RealtimeArenaHostDiagnostics = {
  sentSnapshots: number;
  rejectedMessages: number;
  coalescedInputs: number;
  queuedInputs: number;
  maxQueuedInputs: number;
  activeParticipants: number;
  trackedParticipants: number;
  roundParticipants: number;
  waitingParticipants: number;
  disconnectedParticipants: number;
  lastAction?: RealtimeArenaActionResult;
  lastBroadcastError?: string;
};

export type RealtimeArenaHostOptions = {
  runtime: MultiplayerRuntime;
  sessionId: string;
  hostPeerId: string;
  clock?: () => number;
  publishSnapshot?(snapshot: RealtimeArenaSnapshotPayload, tick: number): void | Promise<void>;
};

type PresencePayload = {
  peer: MultiplayerPeer;
  status: "connected" | "left";
  reason?: string;
};

type RealtimeArenaParticipantPolicyContext = {
  phase: RealtimeArenaState["phase"];
};

const REALTIME_ARENA_PARTICIPANT_POLICY =
  createMultiplayerParticipantPolicy<RealtimeArenaParticipantPolicyContext>({
    join: "active",
    lateJoin: "next-round",
    leave: "remove",
    disconnect: ({ context }) => (context.phase === "lobby" ? "remove" : "disconnected"),
    reconnect: "restore",
    boundary: ({ binding }) => {
      if (binding.status === "disconnected" || binding.status === "left") {
        return "remove";
      }
      return binding.status === "next-round" ? "activate" : "retain";
    }
  });

export function createRealtimeArenaHost(options: RealtimeArenaHostOptions): RealtimeArenaHost {
  const clock = options.clock ?? (() => Date.now());
  const connectedPeers = new Map<string, MultiplayerPeer>();
  const playerIdsByPeerId = new Map<string, string>();
  const inputAcksByPeerId = new Map<string, number>();
  let peerBindings = createParticipantBindingStore();
  const diagnostics: RealtimeArenaHostDiagnostics = {
    sentSnapshots: 0,
    rejectedMessages: 0,
    coalescedInputs: 0,
    queuedInputs: 0,
    maxQueuedInputs: 0,
    activeParticipants: 0,
    trackedParticipants: 0,
    roundParticipants: 0,
    waitingParticipants: 0,
    disconnectedParticipants: 0
  };
  let state = createRealtimePracticeArenaState();
  const authorityBinding = createMultiplayerAuthorityBindingStore({
    sessionId: options.sessionId,
    mode: "host-authoritative",
    authorityPeerId: options.hostPeerId,
    authorityEndpoint: {
      kind: "peer",
      id: options.hostPeerId,
      peerId: options.hostPeerId
    }
  });
  const authorityLoop = createMultiplayerAuthorityHostLoop<
    RealtimeArenaNetworkAction,
    RealtimeInputFrame,
    RealtimeArenaSnapshotPayload
  >({
    runtime: options.runtime,
    binding: authorityBinding,
    channel: REALTIME_ARENA_CHANNEL,
    actionKind: REALTIME_ARENA_ACTION_KIND,
    inputKind: REALTIME_ARENA_INPUT_KIND,
    snapshotKind: REALTIME_ARENA_SNAPSHOT_KIND,
    readAction(payload) {
      return isRealtimeArenaNetworkAction(payload) ? payload : undefined;
    },
    readInput(payload) {
      return readRealtimeArenaInputPayload(payload)?.frame;
    },
    inputSequence(input) {
      return input.sequence;
    },
    inputQueueMode: "latest",
    handleAction({ message, payload }) {
      return toAuthorityDecision(handleActionFromPeer(message.sourcePeerId, payload));
    },
    handleInput({ message, payload }) {
      return toAuthorityDecision(handleInputFromPeer(message.sourcePeerId, payload));
    },
    tick({ deltaMs }) {
      reconcilePeers();
      tickRealtimeArena(state, deltaMs);
    },
    captureSnapshot() {
      return createSnapshotPayload();
    },
    ...(options.publishSnapshot === undefined
      ? {}
      : {
          publishSnapshot(snapshot: RealtimeArenaSnapshotPayload, context: { tick: number }) {
            return options.publishSnapshot?.(snapshot, context.tick);
          }
        }),
    onRejected(rejection) {
      diagnostics.lastAction = {
        accepted: false,
        code: rejection.code,
        reason: rejection.reason
      };
    }
  });

  const unsubscribe = options.runtime.subscribe((message) => {
    handleMessage(message);
  });

  function handleMessage(message: MultiplayerMessageEnvelope): void {
    if (message.kind === "peer.presence") {
      handlePresenceMessage(message.payload);
      void authorityLoop.broadcastSnapshot();
    }
  }

  function handlePresenceMessage(payload: unknown): void {
    const presence = readPresencePayload(payload);
    if (!presence || presence.peer.id === options.hostPeerId) {
      return;
    }

    if (presence.status === "left") {
      markPeerLeft(presence.peer.id, presence.reason);
      return;
    }

    ensurePlayerForPeer(presence.peer);
  }

  function handleActionFromPeer(
    peerId: string,
    action: RealtimeArenaNetworkAction
  ): RealtimeArenaActionResult {
    const playerId = ensurePlayerForPeer(
      connectedPeers.get(peerId) ?? {
        id: peerId,
        role: "client",
        status: "connected"
      }
    );
    if (!playerId) {
      if (action.type === "set-name") {
        return updateWaitingParticipantName(peerId, action.name);
      }
      const participant = participantForPeer(peerId);
      const inactiveParticipant =
        participant?.status === "next-round" || participant?.status === "spectator";
      diagnostics.lastAction = {
        accepted: false,
        code: inactiveParticipant ? "participant-waiting" : "unknown-player",
        reason:
          participant?.status === "next-round"
            ? "This participant is queued for the next round."
            : participant?.status === "spectator"
              ? "This participant is spectating."
              : `No realtime arena player is mapped to peer: ${peerId}`
      };
      return diagnostics.lastAction;
    }

    switch (action.type) {
      case "set-name":
        diagnostics.lastAction = setRealtimeArenaPlayerName(state, playerId, action.name);
        updateConnectedPeerDisplayName(peerId, findPlayerLabel(playerId));
        if (diagnostics.lastAction.accepted) {
          const peer = connectedPeers.get(peerId);
          if (peer) {
            bindActiveParticipant(peer, playerId);
          }
        }
        break;
      case "ready":
        diagnostics.lastAction = setRealtimeArenaPlayerReady(state, playerId, action.ready);
        break;
      case "start":
        if (state.phase === "lobby") {
          setRealtimeArenaPlayerReady(state, playerId, true);
        }
        diagnostics.lastAction = startRealtimeArenaCountdown(state);
        break;
      case "interact":
        diagnostics.lastAction = applyRealtimeArenaPlayerInteract(state, playerId);
        break;
      case "rematch":
        diagnostics.lastAction = rematchRealtimeArena(state);
        if (diagnostics.lastAction.accepted) {
          rebuildLobbyParticipants();
        }
        break;
      case "reset":
        resetArena();
        diagnostics.lastAction = { accepted: true };
        break;
    }

    return diagnostics.lastAction;
  }

  function handleInputFromPeer(
    peerId: string,
    input: RealtimeInputFrame
  ): RealtimeArenaActionResult {
    const playerId = playerIdsByPeerId.get(peerId);
    if (!playerId) {
      const participant = participantForPeer(peerId);
      const inactiveParticipant =
        participant?.status === "next-round" || participant?.status === "spectator";
      diagnostics.lastAction = {
        accepted: false,
        code: inactiveParticipant ? "participant-waiting" : "unknown-player",
        reason:
          participant?.status === "next-round"
            ? "This participant is queued for the next round."
            : participant?.status === "spectator"
              ? "This participant is spectating."
              : `No realtime arena player is mapped to peer: ${peerId}`
      };
      return diagnostics.lastAction;
    }

    diagnostics.lastAction = applyRealtimeInputFrame(state, playerId, input);
    if (diagnostics.lastAction.accepted) {
      inputAcksByPeerId.set(peerId, input.sequence);
    }
    return diagnostics.lastAction;
  }

  function ensurePlayerForPeer(peer: MultiplayerPeer): string | undefined {
    if (peer.id === options.hostPeerId || peer.role === "host" || peer.role === "server") {
      return undefined;
    }

    const currentPeer = connectedPeers.get(peer.id);
    const currentBinding = trackedBindingForPeer(peer.id);
    const trackedDisplayName =
      currentBinding?.displayName ??
      (currentPeer !== undefined && isActivePeer(currentPeer)
        ? currentPeer.displayName
        : undefined);
    const nextDisplayName = trackedDisplayName ?? peer.displayName;
    const trackedPeer = clonePeer(
      {
        ...peer,
        ...(nextDisplayName === undefined ? {} : { displayName: nextDisplayName })
      },
      "connected"
    );
    connectedPeers.set(peer.id, trackedPeer);
    const participantPlayerId = currentBinding?.playerId ?? peer.playerId ?? peer.id;
    const mappedPlayerId = playerIdsByPeerId.get(peer.id) ?? participantPlayerId;
    const mappedPlayer =
      mappedPlayerId === undefined
        ? undefined
        : state.players.find((player) => player.id === mappedPlayerId);
    if (mappedPlayer) {
      return restorePlayerForPeer(trackedPeer, mappedPlayer.id, currentBinding);
    }

    const directPlayer = state.players.find((player) => player.id === participantPlayerId);
    if (directPlayer) {
      return restorePlayerForPeer(trackedPeer, directPlayer.id, currentBinding);
    }

    const joinDecision =
      state.phase === "lobby"
        ? REALTIME_ARENA_PARTICIPANT_POLICY.join({
            peer: trackedPeer,
            context: participantPolicyContext()
          })
        : REALTIME_ARENA_PARTICIPANT_POLICY.lateJoin({
            peer: trackedPeer,
            context: participantPolicyContext()
          });
    if (joinDecision === "reject") {
      diagnostics.lastAction = {
        accepted: false,
        code: "participant-rejected",
        reason: "Participant policy rejected this peer."
      };
      return undefined;
    }
    if (joinDecision === "next-round" || joinDecision === "spectator") {
      bindInactiveParticipant(trackedPeer, participantPlayerId, joinDecision);
      return undefined;
    }

    const playerId = peer.playerId ?? peer.id;
    const result = joinRealtimeArenaPlayer(state, {
      id: playerId,
      label: trackedPeer.displayName ?? playerId
    });
    diagnostics.lastAction = result;
    if (!result.accepted) {
      return undefined;
    }

    playerIdsByPeerId.set(peer.id, playerId);
    inputAcksByPeerId.set(peer.id, 0);
    bindActiveParticipant(trackedPeer, playerId);
    return playerId;
  }

  function restorePlayerForPeer(
    peer: MultiplayerPeer,
    playerId: string,
    binding: MultiplayerPeerPlayerBinding | undefined
  ): string | undefined {
    const player = state.players.find((candidate) => candidate.id === playerId);
    if (!player) {
      return undefined;
    }

    if (!player.connected && binding) {
      const reconnectDecision = REALTIME_ARENA_PARTICIPANT_POLICY.reconnect({
        peer,
        binding,
        context: participantPolicyContext()
      });
      if (reconnectDecision === "reject") {
        return undefined;
      }
      if (reconnectDecision === "next-round" || reconnectDecision === "spectator") {
        bindInactiveParticipant(peer, playerId, reconnectDecision);
        return undefined;
      }
    }

    reconnectRealtimeArenaPlayer(state, playerId);
    bindActiveParticipant(peer, playerId);
    playerIdsByPeerId.set(peer.id, playerId);
    if (!inputAcksByPeerId.has(peer.id)) {
      inputAcksByPeerId.set(peer.id, player.lastInputSequence);
    }
    return playerId;
  }

  function bindActiveParticipant(peer: MultiplayerPeer, playerId: string): void {
    const player = state.players.find((candidate) => candidate.id === playerId);
    peerBindings.bindPeer(peer, {
      playerId,
      status: "active",
      ...(player === undefined ? {} : { displayName: player.label, slot: player.slot })
    });
  }

  function bindInactiveParticipant(
    peer: MultiplayerPeer,
    playerId: string,
    status: "next-round" | "spectator"
  ): void {
    const current = peerBindings.bindingForPeer(peer.id);
    if (current?.status === status) {
      return;
    }
    peerBindings.bindPeer(peer, {
      playerId,
      status
    });
  }

  function updateWaitingParticipantName(peerId: string, name: string): RealtimeArenaActionResult {
    const peer = connectedPeers.get(peerId);
    const binding = peerBindings.bindingForPeer(peerId);
    if (!peer || !binding || (binding.status !== "next-round" && binding.status !== "spectator")) {
      return {
        accepted: false,
        code: "unknown-participant",
        reason: `No waiting participant is mapped to peer: ${peerId}`
      };
    }

    const updated = peerBindings.bindPeer(peer, {
      playerId: binding.playerId,
      displayName: name,
      status: binding.status
    });
    updateConnectedPeerDisplayName(peerId, updated.displayName);
    diagnostics.lastAction = { accepted: true };
    return diagnostics.lastAction;
  }

  function updateConnectedPeerDisplayName(peerId: string, label: string | undefined): void {
    const current = connectedPeers.get(peerId);
    if (!current || label === undefined) {
      return;
    }

    connectedPeers.set(peerId, {
      ...current,
      displayName: label
    });
  }

  function findPlayerLabel(playerId: string): string | undefined {
    return state.players.find((player) => player.id === playerId)?.label;
  }

  function participantForPeer(peerId: string): RealtimeArenaParticipant | undefined {
    const binding = peerBindings.bindingForPeer(peerId);
    return binding === undefined ? undefined : createParticipant(binding, state);
  }

  function trackedBindingForPeer(peerId: string): MultiplayerPeerPlayerBinding | undefined {
    return (
      peerBindings.bindingForPeer(peerId) ??
      peerBindings.bindings().find((binding) => binding.peerId === peerId)
    );
  }

  function participantPolicyContext(): RealtimeArenaParticipantPolicyContext {
    return { phase: state.phase };
  }

  function markPeerLeft(peerId: string, reason?: string): void {
    authorityLoop.releasePeer(peerId);
    const current = connectedPeers.get(peerId);
    if (current) {
      connectedPeers.set(peerId, clonePeer(current, "left"));
    }

    const binding = peerBindings.bindingForPeer(peerId);
    const playerId = playerIdsByPeerId.get(peerId) ?? binding?.playerId;
    const player =
      playerId === undefined
        ? undefined
        : state.players.find((candidate) => candidate.id === playerId);
    const departureDecision = REALTIME_ARENA_PARTICIPANT_POLICY.disconnect({
      peerId,
      ...(binding === undefined ? {} : { binding }),
      context: participantPolicyContext()
    });
    if (departureDecision === "disconnected") {
      if (player !== undefined) {
        diagnostics.lastAction = disconnectRealtimeArenaPlayer(state, player.id);
      }
      peerBindings.markPeerLeft(peerId, {
        status: "disconnected",
        ...(reason === undefined ? {} : { reason })
      });
    } else if (departureDecision === "spectator") {
      if (player !== undefined) {
        diagnostics.lastAction = removeRealtimeArenaPlayer(state, player.id);
      }
      peerBindings.markPeerLeft(peerId, {
        status: "spectator",
        ...(reason === undefined ? {} : { reason })
      });
    } else {
      if (player !== undefined) {
        diagnostics.lastAction = removeRealtimeArenaPlayer(state, player.id);
      }
      peerBindings.markPeerLeft(peerId, {
        status: "left",
        remove: true,
        ...(reason === undefined ? {} : { reason })
      });
    }
    if (playerId !== undefined) {
      playerIdsByPeerId.delete(peerId);
      inputAcksByPeerId.delete(peerId);
    }
  }

  function reconcilePeers(): void {
    for (const peer of options.runtime.peers()) {
      if (peer.id === options.hostPeerId) {
        continue;
      }

      if (isActivePeer(peer)) {
        ensurePlayerForPeer(peer);
      } else if (peer.status === "left" || peer.status === "disconnected") {
        markPeerLeft(peer.id);
      }
    }
  }

  function resetArena(): void {
    state = createRealtimePracticeArenaState();
    rebuildLobbyParticipants();
  }

  function rebuildLobbyParticipants(): void {
    const previousBindings = peerBindings.bindings();
    const boundaryDecisions = new Map(
      previousBindings.map((binding) => [
        binding.peerId,
        REALTIME_ARENA_PARTICIPANT_POLICY.boundary({
          binding,
          context: participantPolicyContext()
        })
      ])
    );
    const activePeers = [...connectedPeers.values()].filter(isActivePeer);
    for (const binding of previousBindings) {
      if (
        boundaryDecisions.get(binding.peerId) === "remove" &&
        state.players.some((player) => player.id === binding.playerId)
      ) {
        removeRealtimeArenaPlayer(state, binding.playerId);
      }
    }
    peerBindings.close("arena participant bindings rebuilt");
    peerBindings = createParticipantBindingStore();
    playerIdsByPeerId.clear();
    inputAcksByPeerId.clear();
    for (const peer of activePeers) {
      const previousBinding = previousBindings.find((binding) => binding.peerId === peer.id);
      const boundaryDecision = boundaryDecisions.get(peer.id);
      if (boundaryDecision === "remove") {
        continue;
      }
      if (
        boundaryDecision === "retain" &&
        (previousBinding?.status === "next-round" || previousBinding?.status === "spectator")
      ) {
        bindInactiveParticipant(peer, previousBinding.playerId, previousBinding.status);
        continue;
      }
      ensurePlayerForPeer(peer);
    }
  }

  function createSnapshotPayload(): RealtimeArenaSnapshotPayload {
    const authorityDiagnostics = authorityLoop.diagnostics();
    const participantsByPeerId = createParticipantsByPeerId(peerBindings, state);
    const participantSummary = summarizeParticipants(participantsByPeerId, state.players.length);
    return {
      snapshot: captureRealtimeArenaSnapshot(state),
      playersByPeerId: Object.fromEntries(playerIdsByPeerId.entries()),
      inputAcksByPeerId: Object.fromEntries(inputAcksByPeerId.entries()),
      serverTime: clock(),
      participantsByPeerId,
      participantSummary,
      authorityInput: {
        queuedInputs: authorityDiagnostics.queuedInputs,
        maxQueuedInputs: authorityDiagnostics.maxQueuedInputs,
        coalescedInputs: authorityDiagnostics.coalescedInputs
      }
    };
  }

  return {
    get state() {
      return state;
    },
    snapshot() {
      return createSnapshotPayload();
    },
    diagnostics() {
      const authorityDiagnostics = authorityLoop.diagnostics();
      const participants = createParticipantsByPeerId(peerBindings, state);
      const participantSummary = summarizeParticipants(participants, state.players.length);
      return {
        ...diagnostics,
        sentSnapshots: authorityDiagnostics.sentSnapshots,
        rejectedMessages: authorityDiagnostics.rejectedMessages,
        coalescedInputs: authorityDiagnostics.coalescedInputs,
        queuedInputs: authorityDiagnostics.queuedInputs,
        maxQueuedInputs: authorityDiagnostics.maxQueuedInputs,
        activeParticipants: participantSummary.active,
        trackedParticipants: participantSummary.tracked,
        roundParticipants: participantSummary.round,
        waitingParticipants: participantSummary.waiting,
        disconnectedParticipants: participantSummary.disconnected,
        ...(authorityDiagnostics.lastBroadcastError === undefined
          ? {}
          : { lastBroadcastError: authorityDiagnostics.lastBroadcastError })
      };
    },
    tick(delta = REALTIME_ARENA_TICK_MS) {
      authorityLoop.tick(delta);
    },
    dispose() {
      unsubscribe();
      authorityLoop.dispose();
      peerBindings.close("realtime arena host disposed");
    }
  };
}

function createParticipantBindingStore(): MultiplayerPeerPlayerBindingStore {
  return createMultiplayerPeerPlayerBindingStore({
    defaultDisplayName: "Runner",
    maxDisplayNameLength: 18
  });
}

function createParticipantsByPeerId(
  bindings: MultiplayerPeerPlayerBindingStore,
  state: RealtimeArenaState
): Record<string, RealtimeArenaParticipant> {
  return Object.fromEntries(
    bindings.bindings().map((binding) => [binding.peerId, createParticipant(binding, state)])
  );
}

function createParticipant(
  binding: MultiplayerPeerPlayerBinding,
  state: RealtimeArenaState
): RealtimeArenaParticipant {
  const player = state.players.find((candidate) => candidate.id === binding.playerId);
  const slot = typeof binding.slot === "number" ? binding.slot : player?.slot;
  const status = readBindingParticipation(binding);
  return {
    peerId: binding.peerId,
    status,
    ...(binding.displayName === undefined ? {} : { displayName: binding.displayName }),
    ...(player === undefined && (status === "next-round" || status === "spectator")
      ? {}
      : { playerId: binding.playerId }),
    ...(slot === undefined ? {} : { slot }),
    ...(binding.reason === undefined ? {} : { reason: binding.reason })
  };
}

function readBindingParticipation(
  binding: MultiplayerPeerPlayerBinding
): RealtimeArenaParticipantStatus {
  if (binding.status === "disconnected" || binding.status === "left") {
    return "disconnected";
  }
  if (binding.status === "next-round" || binding.status === "spectator") {
    return binding.status;
  }
  return "active";
}

function summarizeParticipants(
  participantsByPeerId: Record<string, RealtimeArenaParticipant>,
  roundParticipants: number
): RealtimeArenaParticipantSummary {
  const participants = Object.values(participantsByPeerId);
  return {
    active: participants.filter((participant) => participant.status === "active").length,
    tracked: participants.length,
    round: roundParticipants,
    waiting: participants.filter((participant) => participant.status === "next-round").length,
    disconnected: participants.filter((participant) => participant.status === "disconnected").length
  };
}

function toAuthorityDecision(result: RealtimeArenaActionResult): MultiplayerAuthorityDecision {
  return result.accepted
    ? { allowed: true }
    : { allowed: false, code: result.code, reason: result.reason };
}

function readPresencePayload(value: unknown): PresencePayload | undefined {
  if (!isRecord(value) || !isRecord(value.peer)) {
    return undefined;
  }
  if (value.status !== "connected" && value.status !== "left") {
    return undefined;
  }
  if (typeof value.peer.id !== "string") {
    return undefined;
  }

  const peer: MultiplayerPeer = {
    id: value.peer.id,
    ...(typeof value.peer.displayName === "string" ? { displayName: value.peer.displayName } : {}),
    ...(typeof value.peer.role === "string" ? { role: value.peer.role } : {}),
    status: value.status === "connected" ? "connected" : "left",
    ...(typeof value.peer.playerId === "string" ? { playerId: value.peer.playerId } : {})
  };
  return {
    peer,
    status: value.status,
    ...(typeof value.reason === "string" ? { reason: value.reason } : {})
  };
}

function isActivePeer(peer: MultiplayerPeer): boolean {
  return peer.status === "joining" || peer.status === "connected" || peer.status === "ready";
}

function clonePeer(peer: MultiplayerPeer, status: MultiplayerPeer["status"]): MultiplayerPeer {
  return {
    id: peer.id,
    ...(peer.displayName === undefined ? {} : { displayName: peer.displayName }),
    ...(peer.role === undefined ? {} : { role: peer.role }),
    status,
    ...(peer.playerId === undefined ? {} : { playerId: peer.playerId }),
    ...(peer.metadata === undefined ? {} : { metadata: { ...peer.metadata } })
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
