import {
  clonePeer,
  cloneSession,
  type MultiplayerMessageEnvelope,
  type MultiplayerPeer,
  type MultiplayerSession
} from "@gamekits/multiplayer-core";

export type GameKitsColyseusPresenceStatus = "connected" | "left";

export type GameKitsColyseusPresencePayload = {
  peer: MultiplayerPeer;
  status: GameKitsColyseusPresenceStatus;
  session: MultiplayerSession;
  reason?: string;
};

export function isMultiplayerMessageEnvelope(value: unknown): value is MultiplayerMessageEnvelope {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.id === "string" &&
    typeof value.sessionId === "string" &&
    typeof value.channel === "string" &&
    typeof value.kind === "string" &&
    typeof value.sourcePeerId === "string" &&
    typeof value.timestamp === "number" &&
    "payload" in value &&
    (value.targetPeerIds === undefined ||
      (Array.isArray(value.targetPeerIds) &&
        value.targetPeerIds.every((targetPeerId) => typeof targetPeerId === "string"))) &&
    (value.sequence === undefined || typeof value.sequence === "number") &&
    (value.tick === undefined || typeof value.tick === "number") &&
    (value.schemaVersion === undefined || typeof value.schemaVersion === "string") &&
    (value.correlationId === undefined || typeof value.correlationId === "string")
  );
}

export function isPresencePayload(value: unknown): value is GameKitsColyseusPresencePayload {
  if (!isRecord(value) || !isRecord(value.peer) || !isRecord(value.session)) {
    return false;
  }

  return (
    (value.status === "connected" || value.status === "left") &&
    typeof value.peer.id === "string" &&
    typeof value.session.id === "string" &&
    Array.isArray(value.session.peers)
  );
}

export function cloneEnvelope(message: MultiplayerMessageEnvelope): MultiplayerMessageEnvelope {
  return {
    ...message,
    ...(message.targetPeerIds ? { targetPeerIds: [...message.targetPeerIds] } : {})
  };
}

export function clonePresencePayload(
  payload: GameKitsColyseusPresencePayload
): GameKitsColyseusPresencePayload {
  return {
    peer: clonePeer(payload.peer),
    status: payload.status,
    session: cloneSession(payload.session),
    ...(payload.reason === undefined ? {} : { reason: payload.reason })
  };
}

export function estimatePayloadBytes(value: unknown): number {
  const serialized = JSON.stringify(value);
  return serialized === undefined ? 0 : new TextEncoder().encode(serialized).byteLength;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
