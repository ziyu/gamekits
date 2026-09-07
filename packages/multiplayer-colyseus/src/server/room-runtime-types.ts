import type {
  MultiplayerPeer,
  MultiplayerPeerInput,
  MultiplayerRuntime,
  MultiplayerSessionKind
} from "@gamekits/multiplayer-core";

import type { ColyseusMessageType } from "../adapter";

export type ColyseusRoomRuntimeBridgePhase =
  | "idle"
  | "creating"
  | "running"
  | "stopping"
  | "stopped"
  | "failed"
  | "disposed";

export type ColyseusRoomRuntimeHost = {
  readonly roomId: string;
  setSimulationInterval(
    onTickCallback?: ((deltaTime: number) => void) | undefined,
    delay?: number
  ): void;
  broadcast(type: ColyseusMessageType, message: unknown): void;
};

export type ColyseusRoomRuntimeClient = {
  readonly sessionId: string;
  send(type: ColyseusMessageType, message: unknown): void;
};

export type ColyseusRoomRuntimeFrame = {
  tick: number;
  deltaMs: number;
  elapsedMs: number;
};

export type ColyseusRoomOwnedRuntime<TSnapshot = unknown> = {
  boot?(): Promise<void> | void;
  start?(): Promise<void> | void;
  tick(frame: ColyseusRoomRuntimeFrame): void;
  stop?(): Promise<void> | void;
  dispose(): Promise<void> | void;
  snapshot?(): TSnapshot;
};

export type ColyseusRoomRuntimeCreateContext<
  TRoom extends ColyseusRoomRuntimeHost,
  TCreateOptions
> = {
  room: TRoom;
  roomId: string;
  sessionId: string;
  options: TCreateOptions;
  multiplayer: MultiplayerRuntime;
};

export type ColyseusRoomRuntimeBridgeDiagnostic = {
  kind: "lifecycle-failed" | "message-rejected";
  phase: ColyseusRoomRuntimeBridgePhase;
  operation: "create" | "tick" | "stop" | "dispose" | "join" | "leave" | "message" | "snapshot";
  code: string;
  message: string;
};

export type ColyseusRoomRuntimeBridgeSnapshot<TRuntimeSnapshot = unknown> = {
  id: string;
  phase: ColyseusRoomRuntimeBridgePhase;
  roomId?: string;
  sessionId?: string;
  fixedStepMs: number;
  ticks: number;
  elapsedMs: number;
  joins: number;
  leaves: number;
  receivedMessages: number;
  sentMessages: number;
  rejectedMessages: number;
  activePeers: number;
  runtime?: TRuntimeSnapshot;
  lastDiagnostic?: ColyseusRoomRuntimeBridgeDiagnostic;
};

export type CreateColyseusRoomRuntimeBridgeOptions<
  TRoom extends ColyseusRoomRuntimeHost,
  TCreateOptions,
  TRuntime extends ColyseusRoomOwnedRuntime<TRuntimeSnapshot>,
  TRuntimeSnapshot = unknown
> = {
  id?: string;
  fixedStepMs?: number;
  clock?: () => number;
  messageType?: ColyseusMessageType;
  presenceType?: ColyseusMessageType;
  maxPayloadBytes?: number;
  sessionKind?: MultiplayerSessionKind;
  serverPeer?: MultiplayerPeerInput;
  resolveSessionId?(room: TRoom, options: TCreateOptions): string;
  createRuntime(
    context: ColyseusRoomRuntimeCreateContext<TRoom, TCreateOptions>
  ): Promise<TRuntime> | TRuntime;
  onDiagnostic?(diagnostic: ColyseusRoomRuntimeBridgeDiagnostic): void;
};

export type ColyseusRoomRuntimeBridge<
  TRoom extends ColyseusRoomRuntimeHost,
  TClient extends ColyseusRoomRuntimeClient,
  TCreateOptions,
  TRuntimeSnapshot = unknown
> = {
  readonly multiplayer: MultiplayerRuntime;
  create(room: TRoom, options: TCreateOptions): Promise<void>;
  join(client: TClient, peer: MultiplayerPeerInput): void;
  leave(client: TClient, code?: number): void;
  receive(client: TClient, message: unknown): boolean;
  stop(): Promise<void>;
  dispose(): Promise<void>;
  snapshot(): ColyseusRoomRuntimeBridgeSnapshot<TRuntimeSnapshot>;
};

export type ColyseusRoomRuntimePeerRecord<TClient extends ColyseusRoomRuntimeClient> = {
  client: TClient;
  peer: MultiplayerPeer;
};
