import type { Client as ColyseusClient, ClientOptions, Room as ColyseusRoom } from "@colyseus/sdk";
import type {
  MultiplayerAuthorityMode,
  MultiplayerBackendAdapter,
  MultiplayerChannel,
  MultiplayerPeerInput,
  MultiplayerSessionKind
} from "@gamekits/multiplayer-core";
import type {
  ColyseusNativeCapabilityInput,
  ColyseusNativeCapabilitySummary,
  ColyseusNativeStateBridge,
  ColyseusNativeStateBridgeOptions,
  ColyseusNativeStateListener,
  ColyseusNativeStateUpdate
} from "./native-state";

export type ColyseusMessageType = string | number;

export type GameKitsColyseusRoomJoinOptions = {
  sessionId?: string;
  roomId?: string;
  sessionKind?: MultiplayerSessionKind;
  authority?: MultiplayerAuthorityMode;
  localPeer?: MultiplayerPeerInput;
  metadata?: Record<string, unknown>;
  [key: string]: unknown;
};

export type ColyseusMultiplayerBackendOptions = {
  id?: string;
  endpoint: string;
  roomName: string;
  client?: ColyseusClient;
  clientOptions?: ClientOptions;
  messageType?: ColyseusMessageType;
  presenceType?: ColyseusMessageType;
  sessionKind?: MultiplayerSessionKind;
  authority?: MultiplayerAuthorityMode;
  channels?: MultiplayerChannel[];
  maxPayloadBytes?: number;
  metadata?: Record<string, unknown>;
  nativeCapabilities?: ColyseusNativeCapabilityInput;
  nativeStateSync?: {
    enabled?: boolean;
    messageType?: ColyseusMessageType;
    sourceEndpointId?: string;
    schemaVersion?: string;
    maxStateBytes?: number;
    readRoomState?(state: unknown): ColyseusNativeStateUpdate<unknown> | undefined;
  };
  createOptions?: Record<string, unknown>;
  joinOptions?: Record<string, unknown>;
  joinByIdFallback?: boolean;
};

export type ColyseusMultiplayerNative = {
  readonly client: ColyseusClient;
  readonly endpoint: string;
  readonly roomName: string;
  currentRoom(): ColyseusRoom | undefined;
  capabilities(): ColyseusNativeCapabilitySummary;
  publishState(update: ColyseusNativeStateUpdate): void;
  subscribeState(listener: ColyseusNativeStateListener): () => void;
  createStateBridge<TProviderState, TViewState = TProviderState>(
    options: ColyseusNativeStateBridgeOptions<TProviderState, TViewState>
  ): ColyseusNativeStateBridge;
};

export type ColyseusMultiplayerBackendAdapter = Omit<MultiplayerBackendAdapter, "native"> & {
  native(): ColyseusMultiplayerNative;
};
