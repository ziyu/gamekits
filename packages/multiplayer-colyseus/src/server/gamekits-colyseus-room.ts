import { Room, type Client } from "@colyseus/core";
import {
  clonePeer,
  cloneSession,
  type MultiplayerMessageEnvelope,
  type MultiplayerPeer,
  type MultiplayerPeerInput,
  type MultiplayerSession
} from "@gamekits/multiplayer-core";

import {
  cloneEnvelope,
  estimatePayloadBytes,
  isMultiplayerMessageEnvelope
} from "../adapter/messages";
import {
  createColyseusNativeCapabilitySummary,
  GAMEKITS_COLYSEUS_NATIVE_STATE_MESSAGE
} from "../adapter/native-state";
import type { ColyseusMessageType } from "../adapter/types";
import type { GameKitsColyseusRoomOptions } from "./types";
import {
  GameKitsColyseusNativeState,
  type GameKitsColyseusNativeStateMessage
} from "./native-state-schema";

const HOST_AUTHORITY_LEFT_CLOSE_CODE = 4001;

type GameKitsColyseusClient = Client<{
  userData: {
    peer?: MultiplayerPeer;
  };
}>;

export class GameKitsColyseusRoom extends Room<{
  client: GameKitsColyseusClient;
  state: GameKitsColyseusNativeState;
}> {
  private messageType: ColyseusMessageType = "gamekits.message";
  private presenceType: ColyseusMessageType = "gamekits.presence";
  private gamekitsSessionId: string | undefined;
  private sessionKind: MultiplayerSession["kind"] = "private";
  private authority: MultiplayerSession["authority"] = "server-authoritative";
  private sessionMetadata: Record<string, unknown> | undefined;
  private maxPayloadBytes = 32 * 1024;
  private nativeStateMessageType: ColyseusMessageType = GAMEKITS_COLYSEUS_NATIVE_STATE_MESSAGE;
  private nativeStateSchemaVersion = "gamekits.native-state.v1";
  private nativeStateMaxBytes = 256 * 1024;
  private nativeStateEnabled = false;
  private peers = new Map<string, MultiplayerPeer>();
  private peerIdsBySessionId = new Map<string, string>();
  private invalidMessages = 0;
  private invalidNativeStateUpdates = 0;

  onCreate(options: GameKitsColyseusRoomOptions = {}): void {
    if (typeof options.roomId === "string" && options.roomId.length > 0) {
      this.roomId = options.roomId;
    }

    this.gamekitsSessionId = options.sessionId;
    this.messageType = options.messageType ?? this.messageType;
    this.presenceType = options.presenceType ?? this.presenceType;
    this.sessionKind = options.sessionKind ?? this.sessionKind;
    this.authority = options.authority ?? this.authority;
    this.sessionMetadata = cloneRecord(options.metadata);
    this.maxPayloadBytes = options.maxPayloadBytes ?? this.maxPayloadBytes;
    this.maxClients = options.maxClients ?? this.maxClients;
    this.nativeStateEnabled = options.nativeStateSync?.enabled === true;
    this.nativeStateMessageType =
      options.nativeStateSync?.messageType ?? this.nativeStateMessageType;
    this.nativeStateSchemaVersion =
      options.nativeStateSync?.schemaVersion ?? this.nativeStateSchemaVersion;
    this.nativeStateMaxBytes = options.nativeStateSync?.maxStateBytes ?? this.nativeStateMaxBytes;
    if (this.nativeStateEnabled) {
      const nativeState = new GameKitsColyseusNativeState();
      nativeState.sessionId = "";
      nativeState.sourcePeerId = "";
      nativeState.tick = 0;
      nativeState.version = this.nativeStateSchemaVersion;
      nativeState.timestamp = 0;
      nativeState.stateJson = "";
      nativeState.stateBytes = 0;
      nativeState.updateCount = 0;
      this.state = nativeState;
    }
    const nativeCapabilities = createColyseusNativeCapabilitySummary({
      ...options.nativeCapabilities,
      ...(this.nativeStateEnabled
        ? {
            stateSync: {
              ...options.nativeCapabilities?.stateSync,
              available: true,
              lane: "colyseus-schema" as const,
              schemaVersion: this.nativeStateSchemaVersion
            }
          }
        : {})
    });
    this.metadata = {
      gamekits: {
        kind: this.sessionKind,
        authority: this.authority,
        nativeCapabilities
      }
    };

    this.onMessage<MultiplayerMessageEnvelope>(this.messageType, (client, message) => {
      this.handleGameKitsMessage(client as GameKitsColyseusClient, message);
    });
    if (this.nativeStateEnabled) {
      this.onMessage<GameKitsColyseusNativeStateMessage>(
        this.nativeStateMessageType,
        (client, message) => {
          this.handleNativeStateMessage(client as GameKitsColyseusClient, message);
        }
      );
    }
  }

  onJoin(client: GameKitsColyseusClient, options: GameKitsColyseusRoomOptions = {}): void {
    const peer = toPeer(
      options.localPeer,
      client.sessionId,
      this.hasConnectedPeers() ? "client" : "host"
    );
    client.userData = { peer };
    this.peerIdsBySessionId.set(client.sessionId, peer.id);
    this.peers.set(peer.id, peer);
    this.broadcastPresence(peer, "connected");
  }

  onLeave(client: GameKitsColyseusClient, code?: number): void {
    const peerId = this.peerIdsBySessionId.get(client.sessionId);
    const peer = (peerId ? this.peers.get(peerId) : undefined) ?? client.userData?.peer;
    if (!peer) {
      return;
    }

    const leftPeer: MultiplayerPeer = {
      ...peer,
      status: "left"
    };
    this.peerIdsBySessionId.delete(client.sessionId);
    this.peers.set(leftPeer.id, leftPeer);
    client.userData = { peer: leftPeer };
    this.broadcastPresence(leftPeer, "left", code === undefined ? undefined : String(code));

    if (this.authority === "host-authoritative" && leftPeer.role === "host") {
      void this.disconnect(code ?? HOST_AUTHORITY_LEFT_CLOSE_CODE);
    }
  }

  snapshot(): MultiplayerSession {
    return this.createSessionSummary();
  }

  diagnostics(): {
    invalidMessages: number;
    invalidNativeStateUpdates: number;
    nativeStateUpdates: number;
    peers: MultiplayerPeer[];
  } {
    return {
      invalidMessages: this.invalidMessages,
      invalidNativeStateUpdates: this.invalidNativeStateUpdates,
      nativeStateUpdates: this.state?.updateCount ?? 0,
      peers: [...this.peers.values()].map(clonePeer)
    };
  }

  private get sessionId(): string {
    return this.gamekitsSessionId ?? this.roomId;
  }

  private handleGameKitsMessage(
    client: GameKitsColyseusClient,
    message: MultiplayerMessageEnvelope
  ): void {
    const peer = client.userData?.peer;
    if (!peer || !isMultiplayerMessageEnvelope(message)) {
      this.invalidMessages += 1;
      return;
    }

    if (message.sessionId !== this.sessionId || message.sourcePeerId !== peer.id) {
      this.invalidMessages += 1;
      return;
    }

    try {
      if (estimatePayloadBytes(message) > this.maxPayloadBytes) {
        this.invalidMessages += 1;
        return;
      }
    } catch {
      this.invalidMessages += 1;
      return;
    }

    const targets = this.resolveTargets(message);
    const outbound = cloneEnvelope(message);
    for (const target of targets) {
      target.send(this.messageType, outbound);
    }
  }

  private handleNativeStateMessage(
    client: GameKitsColyseusClient,
    message: GameKitsColyseusNativeStateMessage
  ): void {
    const peer = client.userData?.peer;
    if (
      !peer ||
      peer.role !== "host" ||
      !isNativeStateMessage(message) ||
      message.sessionId !== this.sessionId ||
      message.sourcePeerId !== peer.id ||
      message.version !== this.nativeStateSchemaVersion
    ) {
      this.invalidNativeStateUpdates += 1;
      return;
    }

    const stateBytes = new TextEncoder().encode(message.stateJson).byteLength;
    if (stateBytes > this.nativeStateMaxBytes) {
      this.invalidNativeStateUpdates += 1;
      return;
    }

    this.state.sessionId = message.sessionId;
    this.state.sourcePeerId = message.sourcePeerId;
    this.state.tick = message.tick;
    this.state.version = message.version || this.nativeStateSchemaVersion;
    this.state.timestamp = message.timestamp;
    this.state.stateJson = message.stateJson;
    this.state.stateBytes = stateBytes;
    this.state.updateCount += 1;
  }

  private resolveTargets(message: MultiplayerMessageEnvelope): GameKitsColyseusClient[] {
    if (!message.targetPeerIds) {
      return [...this.clients] as GameKitsColyseusClient[];
    }

    const targetPeerIds = new Set(message.targetPeerIds);
    return (this.clients as GameKitsColyseusClient[]).filter((client) => {
      const peerId = this.peerIdsBySessionId.get(client.sessionId);
      return peerId ? targetPeerIds.has(peerId) : false;
    });
  }

  private broadcastPresence(peer: MultiplayerPeer, status: "connected" | "left", reason?: string) {
    const session = this.createSessionSummary();
    const message: MultiplayerMessageEnvelope = {
      id: `${this.sessionId}.presence.${peer.id}.${status}.${Date.now()}`,
      sessionId: this.sessionId,
      channel: "reliable",
      kind: "peer.presence",
      sourcePeerId: peer.id,
      timestamp: Date.now(),
      payload: {
        peer: clonePeer(peer),
        status,
        session: cloneSession(session),
        ...(reason === undefined ? {} : { reason })
      }
    };
    this.broadcast(this.presenceType, message);
  }

  private createSessionSummary(): MultiplayerSession {
    return {
      id: this.sessionId,
      kind: this.sessionKind,
      authority: this.authority,
      status: "open",
      peers: [...this.peers.values()].map(clonePeer),
      ...(this.sessionMetadata ? { metadata: { ...this.sessionMetadata } } : {})
    };
  }

  private hasConnectedPeers(): boolean {
    for (const peer of this.peers.values()) {
      if (peer.status === "connected" || peer.status === "ready") {
        return true;
      }
    }

    return false;
  }
}

function isNativeStateMessage(value: unknown): value is GameKitsColyseusNativeStateMessage {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const message = value as Record<string, unknown>;
  return (
    typeof message.sessionId === "string" &&
    typeof message.sourcePeerId === "string" &&
    typeof message.tick === "number" &&
    Number.isSafeInteger(message.tick) &&
    message.tick >= 0 &&
    typeof message.version === "string" &&
    typeof message.timestamp === "number" &&
    Number.isFinite(message.timestamp) &&
    message.timestamp >= 0 &&
    typeof message.stateJson === "string"
  );
}

function toPeer(
  input: MultiplayerPeerInput | undefined,
  fallbackId: string,
  fallbackRole: string
): MultiplayerPeer {
  return {
    id: input?.id ?? fallbackId,
    ...(input?.displayName === undefined ? {} : { displayName: input.displayName }),
    role: input?.role ?? fallbackRole,
    status: "connected",
    ...(input?.playerId === undefined ? {} : { playerId: input.playerId }),
    ...(input?.metadata ? { metadata: { ...input.metadata } } : {})
  };
}

function cloneRecord(
  value: Record<string, unknown> | undefined
): Record<string, unknown> | undefined {
  return value ? { ...value } : undefined;
}
