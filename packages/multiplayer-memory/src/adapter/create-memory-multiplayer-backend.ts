import {
  clonePeer,
  cloneSession,
  createMultiplayerError,
  multiplayerErrorCodes,
  type CreateSessionRequest,
  type JoinSessionRequest,
  type MultiplayerBackendAdapter,
  type MultiplayerBackendCapabilities,
  type MultiplayerBackendConnection,
  type MultiplayerBackendListener,
  type MultiplayerBackendSnapshot,
  type MultiplayerMessageEnvelope,
  type MultiplayerPeer,
  type MultiplayerPeerInput,
  type MultiplayerSession
} from "@gamekits/multiplayer-core";

export type MemoryMultiplayerBackendOptions = {
  id?: string;
};

type MemorySessionState = {
  session: MultiplayerSession;
  connections: Map<string, MemoryConnectionState>;
};

type MemoryConnectionState = {
  runtimeId: string;
  phase: "connected" | "in-session" | "closed";
  localPeer?: MultiplayerPeer;
  sessionId?: string;
  listeners: Set<MultiplayerBackendListener>;
  sent: number;
  received: number;
  clock: () => number;
};

export function createMemoryMultiplayerBackend(
  options: MemoryMultiplayerBackendOptions = {}
): MultiplayerBackendAdapter {
  const id = options.id ?? "memory";
  const sessions = new Map<string, MemorySessionState>();
  const connections = new Set<MemoryConnectionState>();
  let generatedSessionId = 0;
  let generatedPeerId = 0;

  function snapshot(): MultiplayerBackendSnapshot {
    return {
      id,
      kind: "memory",
      capabilities: memoryCapabilities,
      activeSessions: sessions.size,
      activeConnections: connections.size
    };
  }

  return {
    id,
    kind: "memory",
    capabilities: memoryCapabilities,
    async connect(ctx) {
      const state: MemoryConnectionState = {
        runtimeId: ctx.runtimeId,
        phase: "connected",
        ...(ctx.localPeer ? { localPeer: toPeer(ctx.localPeer, "client") } : {}),
        listeners: new Set(),
        sent: 0,
        received: 0,
        clock: ctx.clock ?? (() => Date.now())
      };
      connections.add(state);

      async function leaveCurrentSession(reason?: string): Promise<void> {
        assertOpen(state);
        if (!state.sessionId || !state.localPeer) {
          return;
        }

        const sessionState = sessions.get(state.sessionId);
        if (!sessionState) {
          delete state.sessionId;
          state.phase = "connected";
          return;
        }

        const leftPeer: MultiplayerPeer = {
          ...state.localPeer,
          status: "left"
        };
        upsertPeer(sessionState.session, leftPeer);
        sessionState.connections.delete(state.localPeer.id);
        delete state.sessionId;
        state.localPeer = leftPeer;
        state.phase = "connected";
        broadcast(
          sessionState,
          createPresenceMessage(sessionState.session, leftPeer, "left", state.clock, reason)
        );

        if (sessionState.connections.size === 0) {
          sessionState.session.status = "closed";
          sessions.delete(sessionState.session.id);
        }
      }

      const connection: MultiplayerBackendConnection = {
        async createSession(request: CreateSessionRequest = {}) {
          assertOpen(state);
          const sessionId = request.id ?? `memory.session.${++generatedSessionId}`;
          if (sessions.has(sessionId)) {
            throw createMultiplayerError(
              multiplayerErrorCodes.duplicateSession,
              `Duplicate multiplayer session: ${sessionId}`,
              { sessionId }
            );
          }

          const localPeer = toPeer(
            request.localPeer ?? state.localPeer ?? { id: `memory.peer.${++generatedPeerId}` },
            "host"
          );
          state.localPeer = localPeer;
          state.sessionId = sessionId;
          state.phase = "in-session";

          const session: MultiplayerSession = {
            id: sessionId,
            kind: request.kind ?? "local",
            authority: request.authority ?? "host-authoritative",
            status: "open",
            peers: [clonePeer(localPeer)],
            ...(request.metadata ? { metadata: { ...request.metadata } } : {})
          };
          sessions.set(sessionId, {
            session,
            connections: new Map([[localPeer.id, state]])
          });
          deliver(state, createPresenceMessage(session, localPeer, "connected", state.clock));
          return cloneSession(session);
        },
        async joinSession(request: JoinSessionRequest) {
          assertOpen(state);
          const sessionState = requireSession(sessions, request.sessionId);
          const localPeer = toPeer(
            request.localPeer ?? state.localPeer ?? { id: `memory.peer.${++generatedPeerId}` },
            "client"
          );
          state.localPeer = localPeer;
          state.sessionId = request.sessionId;
          state.phase = "in-session";
          sessionState.connections.set(localPeer.id, state);
          upsertPeer(sessionState.session, localPeer);
          broadcast(
            sessionState,
            createPresenceMessage(sessionState.session, localPeer, "connected", state.clock)
          );
          return cloneSession(sessionState.session);
        },
        async leaveSession(reason?: string) {
          await leaveCurrentSession(reason);
        },
        async send(message: MultiplayerMessageEnvelope) {
          assertOpen(state);
          if (!state.sessionId) {
            throw createMultiplayerError(
              multiplayerErrorCodes.missingSession,
              "Cannot send memory multiplayer message without a joined session."
            );
          }

          const sessionState = requireSession(sessions, state.sessionId);
          state.sent += 1;
          broadcast(sessionState, message);
        },
        subscribe(listener) {
          state.listeners.add(listener);

          return () => {
            state.listeners.delete(listener);
          };
        },
        async close(reason?: string) {
          if (state.phase === "closed") {
            return;
          }

          await leaveCurrentSession(reason);
          state.phase = "closed";
          state.listeners.clear();
          connections.delete(state);
        },
        snapshot() {
          const sessionState = state.sessionId ? sessions.get(state.sessionId) : undefined;
          return {
            phase: state.phase,
            ...(state.localPeer ? { localPeer: clonePeer(state.localPeer) } : {}),
            ...(sessionState ? { session: cloneSession(sessionState.session) } : {}),
            peers: (sessionState?.session.peers ?? []).map(clonePeer),
            sent: state.sent,
            received: state.received
          };
        }
      };

      return connection;
    },
    snapshot
  };
}

const memoryCapabilities: MultiplayerBackendCapabilities = {
  channels: [
    {
      id: "reliable",
      reliability: "reliable",
      ordering: "ordered"
    }
  ],
  reconnect: false
} as const;

function toPeer(input: MultiplayerPeerInput, fallbackRole: string): MultiplayerPeer {
  if (!input.id) {
    throw createMultiplayerError(
      multiplayerErrorCodes.missingLocalPeer,
      "Memory multiplayer peer requires a stable id."
    );
  }

  return {
    id: input.id,
    ...(input.displayName === undefined ? {} : { displayName: input.displayName }),
    role: input.role ?? fallbackRole,
    status: "connected",
    ...(input.playerId === undefined ? {} : { playerId: input.playerId }),
    ...(input.metadata ? { metadata: { ...input.metadata } } : {})
  };
}

function requireSession(
  sessions: Map<string, MemorySessionState>,
  sessionId: string
): MemorySessionState {
  const sessionState = sessions.get(sessionId);
  if (!sessionState) {
    throw createMultiplayerError(
      multiplayerErrorCodes.missingSessionTarget,
      `Missing multiplayer session: ${sessionId}`,
      { sessionId }
    );
  }

  return sessionState;
}

function upsertPeer(session: MultiplayerSession, peer: MultiplayerPeer): void {
  const peerIndex = session.peers.findIndex((candidate) => candidate.id === peer.id);
  const nextPeer = clonePeer(peer);
  if (peerIndex >= 0) {
    session.peers[peerIndex] = nextPeer;
    return;
  }

  session.peers.push(nextPeer);
}

function broadcast(sessionState: MemorySessionState, message: MultiplayerMessageEnvelope): void {
  const targets = message.targetPeerIds
    ? message.targetPeerIds
        .map((peerId) => sessionState.connections.get(peerId))
        .filter((connection): connection is MemoryConnectionState => Boolean(connection))
    : [...sessionState.connections.values()];

  for (const connection of targets) {
    deliver(connection, message);
  }
}

function deliver(connection: MemoryConnectionState, message: MultiplayerMessageEnvelope): void {
  connection.received += 1;
  for (const listener of Array.from(connection.listeners)) {
    listener({ ...message });
  }
}

function createPresenceMessage(
  session: MultiplayerSession,
  peer: MultiplayerPeer,
  status: "connected" | "left",
  clock: () => number,
  reason?: string
): MultiplayerMessageEnvelope {
  return {
    id: `${session.id}.presence.${peer.id}.${status}`,
    sessionId: session.id,
    channel: "reliable",
    kind: "peer.presence",
    sourcePeerId: peer.id,
    timestamp: clock(),
    payload: {
      peer: clonePeer(peer),
      status,
      ...(reason === undefined ? {} : { reason }),
      session: cloneSession(session)
    }
  };
}

function assertOpen(state: MemoryConnectionState): void {
  if (state.phase === "closed") {
    throw createMultiplayerError(
      multiplayerErrorCodes.closedConnection,
      `Memory multiplayer connection is closed: ${state.runtimeId}`,
      { runtimeId: state.runtimeId }
    );
  }
}
