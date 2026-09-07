import type { Room, Server, ServerOptions } from "@colyseus/core";
import type { TransportOptions, WebSocketTransport } from "@colyseus/ws-transport";
import type { MultiplayerAuthorityMode, MultiplayerSessionKind } from "@gamekits/multiplayer-core";

import type {
  ColyseusMessageType,
  ColyseusNativeCapabilityInput,
  GameKitsColyseusRoomJoinOptions
} from "../adapter";

export type GameKitsColyseusRoomOptions = GameKitsColyseusRoomJoinOptions & {
  messageType?: ColyseusMessageType;
  presenceType?: ColyseusMessageType;
  sessionKind?: MultiplayerSessionKind;
  authority?: MultiplayerAuthorityMode;
  maxPayloadBytes?: number;
  maxClients?: number;
  nativeCapabilities?: ColyseusNativeCapabilityInput;
  nativeStateSync?: {
    enabled?: boolean;
    messageType?: ColyseusMessageType;
    schemaVersion?: string;
    maxStateBytes?: number;
  };
};

export type ColyseusRoomClass = new () => Room;

export type GameKitsColyseusRoomDefinition =
  | ColyseusRoomClass
  | {
      room: ColyseusRoomClass;
      options?: GameKitsColyseusRoomOptions;
    };

export type CreateGameKitsColyseusServerOptions = {
  host?: string;
  port?: number;
  roomName?: string;
  roomClass?: ColyseusRoomClass;
  roomOptions?: GameKitsColyseusRoomOptions;
  rooms?: Record<string, GameKitsColyseusRoomDefinition>;
  transportOptions?: TransportOptions;
  serverOptions?: Omit<ServerOptions, "transport">;
};

export type GameKitsColyseusServerHandle = {
  readonly server: Server;
  readonly transport: WebSocketTransport;
  readonly host: string;
  readonly port: number;
  readonly endpoint: string;
  readonly roomNames: string[];
  dispose(): Promise<void>;
};
