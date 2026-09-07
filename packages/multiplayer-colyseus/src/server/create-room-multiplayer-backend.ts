import { GameError } from "@gamekits/core";
import {
  clonePeer,
  cloneSession,
  createMultiplayerError,
  multiplayerErrorCodes,
  normalizeOutgoingMessage,
  type JoinSessionRequest,
  type MultiplayerBackendAdapter,
  type MultiplayerBackendCapabilities,
  type MultiplayerBackendConnection,
  type MultiplayerBackendListener,
  type MultiplayerConnectionSnapshot,
  type MultiplayerMessageEnvelope,
  type MultiplayerPeer,
  type MultiplayerPhase,
  type MultiplayerSession,
  type MultiplayerSessionKind
} from "@gamekits/multiplayer-core";

import {
  cloneEnvelope,
  estimatePayloadBytes,
  isMultiplayerMessageEnvelope
} from "../adapter/messages";
import type { ColyseusMessageType } from "../adapter/types";
import type {
  ColyseusRoomRuntimeClient,
  ColyseusRoomRuntimeHost,
  ColyseusRoomRuntimePeerRecord
} from "./room-runtime-types";

type RoomMultiplayerAttachment<TRoom extends ColyseusRoomRuntimeHost> = {
  room: TRoom;
  sessionId: string;
  sessionKind: MultiplayerSessionKind;
  serverPeer: MultiplayerPeer;
};

type RoomMultiplayerConnectionState = {
  phase: MultiplayerPhase;
  localPeer?: MultiplayerPeer;
  sessionActive: boolean;
  listeners: Set<MultiplayerBackendListener>;
  sent: number;
  received: number;
  closed: boolean;
};

export type RoomMultiplayerBackendSnapshot = {
  joins: number;
  leaves: number;
  receivedMessages: number;
  sentMessages: number;
  rejectedMessages: number;
  activePeers: number;
};

export type CreateRoomMultiplayerBackendOptions = {
  id: string;
  messageType: ColyseusMessageType;
  presenceType: ColyseusMessageType;
  maxPayloadBytes: number;
  clock: () => number;
  invalidPeer(message: string, details: unknown): GameError;
  onMessageRejected(code: string, message: string): void;
};

export type RoomMultiplayerBackend<
  TRoom extends ColyseusRoomRuntimeHost,
  TClient extends ColyseusRoomRuntimeClient
> = {
  readonly adapter: MultiplayerBackendAdapter;
  attach(attachment: RoomMultiplayerAttachment<TRoom>): void;
  join(client: TClient, peer: MultiplayerPeer): void;
  leave(client: TClient, code?: number): void;
  receive(client: TClient, message: unknown): boolean;
  closeSession(): void;
  clear(): void;
  snapshot(): RoomMultiplayerBackendSnapshot;
};

export function createRoomMultiplayerBackend<
  TRoom extends ColyseusRoomRuntimeHost,
  TClient extends ColyseusRoomRuntimeClient
>(options: CreateRoomMultiplayerBackendOptions): RoomMultiplayerBackend<TRoom, TClient> {
  const peersById = new Map<string, ColyseusRoomRuntimePeerRecord<TClient>>();
  const peerIdsByConnectionId = new Map<string, string>();
  const capabilities: MultiplayerBackendCapabilities = {
    channels: [{ id: "reliable", reliability: "reliable", ordering: "ordered" }],
    reconnect: false,
    maxPayloadBytes: options.maxPayloadBytes
  };
  let attachment: RoomMultiplayerAttachment<TRoom> | undefined;
  let connection: RoomMultiplayerConnectionState | undefined;
  let joins = 0;
  let leaves = 0;
  let receivedMessages = 0;
  let sentMessages = 0;
  let rejectedMessages = 0;
  let providerSequence = 0;

  const adapter: MultiplayerBackendAdapter = {
    id: `${options.id}.backend`,
    kind: "colyseus-room",
    capabilities,
    async connect() {
      const activeAttachment = requireAttachment();
      if (connection && !connection.closed) {
        throw createMultiplayerError(
          multiplayerErrorCodes.duplicateSession,
          "Colyseus Room backend already has an active core connection.",
          { backendId: adapter.id, sessionId: activeAttachment.sessionId }
        );
      }

      const state: RoomMultiplayerConnectionState = {
        phase: "connected",
        sessionActive: false,
        listeners: new Set(),
        sent: 0,
        received: 0,
        closed: false
      };
      connection = state;

      const backendConnection: MultiplayerBackendConnection = {
        async createSession() {
          throw unsupportedOperation("createSession");
        },
        async joinSession(request) {
          assertConnectionOpen(state);
          if (state.sessionActive) {
            throw unsupportedOperation("joinSession");
          }
          bindAuthoritySession(state, request);
          return cloneSession(currentSession());
        },
        async leaveSession() {
          throw unsupportedOperation("leaveSession");
        },
        async send(message) {
          assertConnectionOpen(state);
          validateOutboundMessage(message, state);
          sendEnvelope(options.messageType, message);
          state.sent += 1;
        },
        subscribe(listener) {
          assertConnectionOpen(state);
          state.listeners.add(listener);
          return () => {
            state.listeners.delete(listener);
          };
        },
        close(reason) {
          if (state.closed) {
            return;
          }
          state.closed = true;
          state.sessionActive = false;
          state.phase = "closed";
          state.listeners.clear();
          void reason;
        },
        snapshot() {
          return connectionSnapshot(state);
        }
      };

      return backendConnection;
    },
    snapshot() {
      const activeConnection = connection && !connection.closed ? connection : undefined;
      return {
        id: adapter.id,
        kind: adapter.kind,
        capabilities,
        activeSessions: activeConnection?.sessionActive ? 1 : 0,
        activeConnections: activeConnection ? 1 : 0
      };
    }
  };

  function requireAttachment(): RoomMultiplayerAttachment<TRoom> {
    if (!attachment) {
      throw createMultiplayerError(
        multiplayerErrorCodes.missingConnection,
        "Colyseus Room backend is not attached to a provider Room.",
        { backendId: adapter.id }
      );
    }
    return attachment;
  }

  function requireConnection(): RoomMultiplayerConnectionState {
    if (!connection || connection.closed || !connection.sessionActive) {
      throw createMultiplayerError(
        multiplayerErrorCodes.missingSession,
        "Colyseus Room backend does not have an active core session.",
        { backendId: adapter.id }
      );
    }
    return connection;
  }

  function unsupportedOperation(operation: string): GameError {
    return createMultiplayerError(
      multiplayerErrorCodes.unsupportedCapability,
      `Room-owned multiplayer backend does not support ${operation}; its provider Room owns that lifecycle.`,
      { backendId: adapter.id, operation }
    );
  }

  function bindAuthoritySession(
    state: RoomMultiplayerConnectionState,
    request: JoinSessionRequest
  ): void {
    const activeAttachment = requireAttachment();
    if (request.sessionId !== activeAttachment.sessionId) {
      throw createMultiplayerError(
        multiplayerErrorCodes.invalidMessage,
        "Core session id does not match the attached Colyseus Room session id.",
        {
          backendId: adapter.id,
          expectedSessionId: activeAttachment.sessionId,
          actualSessionId: request.sessionId
        }
      );
    }
    if (request.localPeer?.id && request.localPeer.id !== activeAttachment.serverPeer.id) {
      throw createMultiplayerError(
        multiplayerErrorCodes.invalidMessage,
        "Core authority peer does not match the attached Colyseus Room server peer.",
        {
          backendId: adapter.id,
          expectedPeerId: activeAttachment.serverPeer.id,
          actualPeerId: request.localPeer.id
        }
      );
    }
    state.localPeer = clonePeer(activeAttachment.serverPeer);
    state.sessionActive = true;
    state.phase = "in-session";
  }

  function currentPeers(): MultiplayerPeer[] {
    const activeAttachment = attachment;
    return [
      ...(activeAttachment ? [clonePeer(activeAttachment.serverPeer)] : []),
      ...Array.from(peersById.values(), (record) => clonePeer(record.peer))
    ];
  }

  function currentSession(): MultiplayerSession {
    const activeAttachment = requireAttachment();
    return {
      id: activeAttachment.sessionId,
      kind: activeAttachment.sessionKind,
      authority: "server-authoritative",
      status: connection?.sessionActive ? "open" : "closed",
      peers: currentPeers()
    };
  }

  function connectionSnapshot(
    state: RoomMultiplayerConnectionState
  ): MultiplayerConnectionSnapshot {
    const activeSession = state.sessionActive && attachment ? currentSession() : undefined;
    return {
      phase: state.closed ? "closed" : activeSession ? "in-session" : state.phase,
      ...(state.localPeer ? { localPeer: clonePeer(state.localPeer) } : {}),
      ...(activeSession ? { session: cloneSession(activeSession) } : {}),
      peers: activeSession?.peers.map(clonePeer) ?? [],
      sent: state.sent,
      received: state.received
    };
  }

  function assertConnectionOpen(state: RoomMultiplayerConnectionState): void {
    if (state.closed) {
      throw createMultiplayerError(
        multiplayerErrorCodes.disposed,
        "Colyseus Room backend connection is closed.",
        { backendId: adapter.id }
      );
    }
  }

  function validateOutboundMessage(
    message: MultiplayerMessageEnvelope,
    state: RoomMultiplayerConnectionState
  ): void {
    const activeAttachment = requireAttachment();
    if (!state.sessionActive || message.sessionId !== activeAttachment.sessionId) {
      throw createMultiplayerError(
        multiplayerErrorCodes.invalidMessage,
        "Colyseus Room outbound message session does not match the active core session.",
        {
          backendId: adapter.id,
          expectedSessionId: activeAttachment.sessionId,
          actualSessionId: message.sessionId
        }
      );
    }
    if (message.sourcePeerId !== activeAttachment.serverPeer.id) {
      throw createMultiplayerError(
        multiplayerErrorCodes.invalidMessage,
        "Colyseus Room outbound message source does not match the core authority peer.",
        {
          backendId: adapter.id,
          expectedPeerId: activeAttachment.serverPeer.id,
          actualPeerId: message.sourcePeerId
        }
      );
    }
    validatePayloadSize(message);
  }

  function validatePayloadSize(message: MultiplayerMessageEnvelope): void {
    let payloadBytes = 0;
    try {
      payloadBytes = estimatePayloadBytes(message);
    } catch (error) {
      throw createMultiplayerError(
        multiplayerErrorCodes.invalidMessage,
        "Colyseus Room message must be JSON serializable.",
        { backendId: adapter.id, cause: error }
      );
    }
    if (payloadBytes > options.maxPayloadBytes) {
      throw createMultiplayerError(
        multiplayerErrorCodes.invalidMessage,
        `Colyseus Room message exceeds max payload bytes: ${options.maxPayloadBytes}.`,
        { backendId: adapter.id, maxPayloadBytes: options.maxPayloadBytes }
      );
    }
  }

  function sendEnvelope(type: ColyseusMessageType, message: MultiplayerMessageEnvelope): void {
    const activeAttachment = requireAttachment();
    const outbound = cloneEnvelope(message);
    if (!message.targetPeerIds) {
      activeAttachment.room.broadcast(type, outbound);
    } else {
      for (const targetPeerId of message.targetPeerIds) {
        peersById.get(targetPeerId)?.client.send(type, outbound);
      }
    }
    sentMessages += 1;
  }

  function emitToCore(message: MultiplayerMessageEnvelope): void {
    const state = requireConnection();
    state.received += 1;
    const inbound = cloneEnvelope(message);
    for (const listener of Array.from(state.listeners)) {
      listener(inbound);
    }
  }

  function publishPresence(
    peer: MultiplayerPeer,
    status: "connected" | "left",
    reason?: string
  ): void {
    const activeAttachment = requireAttachment();
    const state = requireConnection();
    providerSequence += 1;
    const envelope = normalizeOutgoingMessage(
      {
        id: `${options.id}.presence.${peer.id}.${status}.${joins + leaves}`,
        channel: "reliable",
        kind: "peer.presence",
        sequence: providerSequence,
        payload: {
          peer: clonePeer(peer),
          status,
          session: cloneSession(currentSession()),
          ...(reason === undefined ? {} : { reason })
        }
      },
      activeAttachment.sessionId,
      activeAttachment.serverPeer.id,
      providerSequence,
      options.clock(),
      () => `${options.id}.presence.${providerSequence}`
    );
    sendEnvelope(options.presenceType, envelope);
    state.sent += 1;
    emitToCore(envelope);
  }

  function rejectMessage(code: string, message: string): false {
    rejectedMessages += 1;
    options.onMessageRejected(code, message);
    return false;
  }

  return {
    adapter,
    attach(nextAttachment) {
      if (attachment) {
        throw createMultiplayerError(
          multiplayerErrorCodes.duplicateSession,
          "Colyseus Room backend is already attached.",
          { backendId: adapter.id, sessionId: attachment.sessionId }
        );
      }
      attachment = {
        ...nextAttachment,
        serverPeer: clonePeer(nextAttachment.serverPeer)
      };
    },
    join(client, peer) {
      requireConnection();
      if (peerIdsByConnectionId.has(client.sessionId) || peersById.has(peer.id)) {
        throw options.invalidPeer(
          "Colyseus Room runtime bridge requires unique active client connection and peer ids.",
          { clientSessionId: client.sessionId, peerId: peer.id }
        );
      }
      peerIdsByConnectionId.set(client.sessionId, peer.id);
      peersById.set(peer.id, { client, peer: clonePeer(peer) });
      joins += 1;
      publishPresence(peer, "connected");
    },
    leave(client, code) {
      if (!attachment || !connection?.sessionActive) {
        return;
      }
      const peerId = peerIdsByConnectionId.get(client.sessionId);
      const record = peerId ? peersById.get(peerId) : undefined;
      if (!peerId || !record) {
        return;
      }
      peerIdsByConnectionId.delete(client.sessionId);
      peersById.delete(peerId);
      leaves += 1;
      publishPresence(
        { ...record.peer, status: "left" },
        "left",
        code === undefined ? undefined : String(code)
      );
    },
    receive(client, message) {
      if (!attachment || !connection?.sessionActive) {
        return rejectMessage("room-not-running", "Room authority session is not active.");
      }
      const peerId = peerIdsByConnectionId.get(client.sessionId);
      const record = peerId ? peersById.get(peerId) : undefined;
      if (!record || !isMultiplayerMessageEnvelope(message)) {
        return rejectMessage("invalid-envelope", "Message is not a valid GameKits envelope.");
      }
      if (message.sessionId !== attachment.sessionId || message.sourcePeerId !== record.peer.id) {
        return rejectMessage(
          "invalid-source",
          "Message session or source peer does not match the joined client."
        );
      }
      if (message.targetPeerIds && !message.targetPeerIds.includes(attachment.serverPeer.id)) {
        return rejectMessage(
          "invalid-target",
          "Room authority ingress only accepts messages addressed to the server peer."
        );
      }
      try {
        validatePayloadSize(message);
      } catch (error) {
        if (error instanceof GameError && error.message.includes("JSON serializable")) {
          return rejectMessage("payload-unserializable", "Message payload is not serializable.");
        }
        return rejectMessage("payload-too-large", "Message exceeds the configured payload limit.");
      }

      receivedMessages += 1;
      emitToCore(message);
      return true;
    },
    closeSession() {
      if (!connection || connection.closed) {
        return;
      }
      connection.sessionActive = false;
      connection.phase = "closed";
    },
    clear() {
      peersById.clear();
      peerIdsByConnectionId.clear();
      attachment = undefined;
    },
    snapshot() {
      return {
        joins,
        leaves,
        receivedMessages,
        sentMessages,
        rejectedMessages,
        activePeers: peersById.size
      };
    }
  };
}
