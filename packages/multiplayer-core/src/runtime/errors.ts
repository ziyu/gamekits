import { GameError } from "@gamekits/core";

export const multiplayerErrorCodes = {
  disposed: "MULTIPLAYER_DISPOSED",
  missingConnection: "MULTIPLAYER_MISSING_CONNECTION",
  missingSession: "MULTIPLAYER_MISSING_SESSION",
  missingLocalPeer: "MULTIPLAYER_MISSING_LOCAL_PEER",
  invalidMessage: "MULTIPLAYER_INVALID_MESSAGE",
  unsupportedCapability: "MULTIPLAYER_UNSUPPORTED_CAPABILITY",
  duplicateSession: "MULTIPLAYER_DUPLICATE_SESSION",
  missingSessionTarget: "MULTIPLAYER_MISSING_SESSION_TARGET",
  closedConnection: "MULTIPLAYER_CLOSED_CONNECTION",
  closedBinding: "MULTIPLAYER_CLOSED_BINDING",
  authorityFrameState: "MULTIPLAYER_AUTHORITY_FRAME_STATE"
} as const;

export type MultiplayerErrorCode =
  (typeof multiplayerErrorCodes)[keyof typeof multiplayerErrorCodes];

export function createMultiplayerError(
  code: MultiplayerErrorCode,
  message: string,
  details?: unknown
): GameError {
  return new GameError(code, message, details);
}
