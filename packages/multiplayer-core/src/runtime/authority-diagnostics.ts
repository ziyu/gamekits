import { cloneAuthorityBinding } from "./authority-binding";
import type { MultiplayerAuthorityLoopDiagnostics } from "./authority-loop";
import type { MultiplayerAuthorityReceiverDiagnostics } from "./authority-receiver";
import type {
  MultiplayerAuthorityBinding,
  MultiplayerAuthorityBindingStatus,
  MultiplayerAuthorityEndpoint,
  MultiplayerAuthorityRejectedPayload
} from "./authority-types";
import type { MultiplayerAuthorityMode } from "./types";

export type MultiplayerAuthoritativePath =
  | "local-loop"
  | "gamekits-envelope"
  | "provider-native"
  | "colyseus-schema"
  | string;

export type MultiplayerAuthorityConnectionDiagnostics = {
  status?: string;
  reason?: string;
  reconnectSupported?: boolean;
  reconnectReason?: string;
};

export type MultiplayerAuthorityDiagnostics = {
  binding: MultiplayerAuthorityBinding;
  sessionId: string;
  mode: MultiplayerAuthorityMode;
  status: MultiplayerAuthorityBindingStatus;
  authoritativePath: MultiplayerAuthoritativePath;
  resyncing: boolean;
  authorityEndpoint?: MultiplayerAuthorityEndpoint;
  authorityPeerId?: string;
  localPlayerId?: string;
  tick?: number;
  snapshotVersion?: string;
  lastAppliedTick?: number;
  lastSnapshotAgeMs?: number;
  receivedActions: number;
  acceptedActions: number;
  rejectedActions: number;
  queuedActions: number;
  maxQueuedActions: number;
  actionQueueCapacity: number;
  overflowedActions: number;
  receivedInputs: number;
  acceptedInputs: number;
  rejectedInputs: number;
  coalescedInputs: number;
  queuedInputs: number;
  maxQueuedInputs: number;
  inputQueueCapacity: number;
  overflowedInputs: number;
  committedTicks: number;
  activeTick?: number;
  sentSnapshots: number;
  receivedSnapshots: number;
  appliedSnapshots: number;
  receivedPatches: number;
  appliedPatches: number;
  receivedResults: number;
  appliedResults: number;
  rejectedMessages: number;
  lastRejected?: MultiplayerAuthorityRejectedPayload;
  lastBroadcastError?: string;
  connection?: MultiplayerAuthorityConnectionDiagnostics;
};

export type CreateMultiplayerAuthorityDiagnosticsOptions = {
  binding: MultiplayerAuthorityBinding;
  authoritativePath?: MultiplayerAuthoritativePath;
  loop?: MultiplayerAuthorityLoopDiagnostics;
  receiver?: MultiplayerAuthorityReceiverDiagnostics;
  connection?: MultiplayerAuthorityConnectionDiagnostics;
};

export function createMultiplayerAuthorityDiagnostics(
  options: CreateMultiplayerAuthorityDiagnosticsOptions
): MultiplayerAuthorityDiagnostics {
  const binding = cloneAuthorityBinding(options.binding);
  const loop = options.loop;
  const receiver = options.receiver;
  const lastRejected = receiver?.lastRejected ?? loop?.lastRejected;
  const tick = binding.tick ?? receiver?.lastAppliedTick ?? loop?.tick;

  return {
    binding,
    sessionId: binding.sessionId,
    mode: binding.mode,
    status: binding.status,
    authoritativePath: options.authoritativePath ?? inferAuthoritativePath(binding),
    resyncing: binding.status === "resyncing",
    ...(binding.authorityEndpoint === undefined
      ? {}
      : { authorityEndpoint: cloneAuthorityEndpoint(binding.authorityEndpoint) }),
    ...(binding.authorityPeerId === undefined ? {} : { authorityPeerId: binding.authorityPeerId }),
    ...(binding.localPlayerId === undefined ? {} : { localPlayerId: binding.localPlayerId }),
    ...(tick === undefined ? {} : { tick }),
    ...(binding.snapshotVersion === undefined ? {} : { snapshotVersion: binding.snapshotVersion }),
    ...(receiver?.lastAppliedTick === undefined
      ? {}
      : { lastAppliedTick: receiver.lastAppliedTick }),
    ...(receiver?.lastSnapshotAgeMs === undefined
      ? {}
      : { lastSnapshotAgeMs: receiver.lastSnapshotAgeMs }),
    receivedActions: loop?.receivedActions ?? 0,
    acceptedActions: loop?.acceptedActions ?? 0,
    rejectedActions: loop?.rejectedActions ?? 0,
    queuedActions: loop?.queuedActions ?? 0,
    maxQueuedActions: loop?.maxQueuedActions ?? 0,
    actionQueueCapacity: loop?.actionQueueCapacity ?? 0,
    overflowedActions: loop?.overflowedActions ?? 0,
    receivedInputs: loop?.receivedInputs ?? 0,
    acceptedInputs: loop?.acceptedInputs ?? 0,
    rejectedInputs: loop?.rejectedInputs ?? 0,
    coalescedInputs: loop?.coalescedInputs ?? 0,
    queuedInputs: loop?.queuedInputs ?? 0,
    maxQueuedInputs: loop?.maxQueuedInputs ?? 0,
    inputQueueCapacity: loop?.inputQueueCapacity ?? 0,
    overflowedInputs: loop?.overflowedInputs ?? 0,
    committedTicks: loop?.committedTicks ?? 0,
    ...(loop?.activeTick === undefined ? {} : { activeTick: loop.activeTick }),
    sentSnapshots: loop?.sentSnapshots ?? 0,
    receivedSnapshots: receiver?.receivedSnapshots ?? 0,
    appliedSnapshots: receiver?.appliedSnapshots ?? 0,
    receivedPatches: receiver?.receivedPatches ?? 0,
    appliedPatches: receiver?.appliedPatches ?? 0,
    receivedResults: receiver?.receivedResults ?? 0,
    appliedResults: receiver?.appliedResults ?? 0,
    rejectedMessages: (loop?.rejectedMessages ?? 0) + (receiver?.rejectedMessages ?? 0),
    ...(lastRejected === undefined ? {} : { lastRejected: { ...lastRejected } }),
    ...(loop?.lastBroadcastError === undefined
      ? {}
      : { lastBroadcastError: loop.lastBroadcastError }),
    ...(options.connection === undefined ? {} : { connection: { ...options.connection } })
  };
}

function inferAuthoritativePath(
  binding: MultiplayerAuthorityBinding
): MultiplayerAuthoritativePath {
  if (binding.mode === "local") {
    return "local-loop";
  }

  return "gamekits-envelope";
}

function cloneAuthorityEndpoint(
  endpoint: MultiplayerAuthorityEndpoint
): MultiplayerAuthorityEndpoint {
  return {
    kind: endpoint.kind,
    id: endpoint.id,
    ...(endpoint.peerId === undefined ? {} : { peerId: endpoint.peerId })
  };
}
