import { Room, type Client } from "@colyseus/core";
import {
  createColyseusNativeCapabilitySummary,
  type GameKitsColyseusRoomJoinOptions
} from "@gamekits/multiplayer-colyseus";
import {
  createColyseusRoomRuntimeBridge,
  type ColyseusRoomRuntimeBridge,
  type ColyseusRoomRuntimeBridgeSnapshot
} from "@gamekits/multiplayer-colyseus/server";
import type { MultiplayerPeerInput } from "@gamekits/multiplayer-core";
import type { PhysicsBackendAdapter } from "@gamekits/physics-core";

import {
  createOutpostColyseusState,
  OUTPOST_COLYSEUS_SCHEMA_VERSION,
  projectOutpostMatchToColyseusState,
  type OutpostColyseusState
} from "../realtime/colyseus-state";
import {
  createOutpostRoomAuthorityRuntime,
  type OutpostRoomAuthorityRuntimeSnapshot
} from "./outpost-room-authority-runtime";

const OUTPOST_MESSAGE_TYPE = "gamekits.message";

export type OutpostSiegeRoomCreateOptions = GameKitsColyseusRoomJoinOptions & {
  seed?: string;
};

export type OutpostSiegeRoomRuntimeOptions = {
  fixedStepMs?: number;
  maxPayloadBytes?: number;
  maxClients?: number;
  countdownMs?: number;
  minPlayers?: number;
  maxPlayers?: number;
  physicsBackend?: PhysicsBackendAdapter;
  clock?: () => number;
  onRoomCreated?(room: OutpostSiegeRoom): void;
};

type OutpostRoomBridge = ColyseusRoomRuntimeBridge<
  OutpostSiegeRoom,
  Client,
  OutpostSiegeRoomCreateOptions,
  OutpostRoomAuthorityRuntimeSnapshot
>;

export class OutpostSiegeRoom extends Room<{ state: OutpostColyseusState }> {
  private authorityBridge: OutpostRoomBridge | undefined;
  private unbindMessage: (() => void) | undefined;

  protected runtimeOptions(): OutpostSiegeRoomRuntimeOptions {
    return {};
  }

  async onCreate(options: OutpostSiegeRoomCreateOptions = {}): Promise<void> {
    const runtimeOptions = this.runtimeOptions();
    if (typeof options.roomId === "string" && options.roomId.length > 0) {
      this.roomId = options.roomId;
    }

    const sessionId = options.sessionId ?? this.roomId;
    const authorityPeerId = `${sessionId}.server`;
    this.maxClients = runtimeOptions.maxClients ?? runtimeOptions.maxPlayers ?? 4;
    this.setState(
      createOutpostColyseusState(sessionId, authorityPeerId, runtimeOptions.clock?.() ?? Date.now())
    );
    this.metadata = {
      gamekits: {
        kind: options.sessionKind ?? "private",
        authority: "server-authoritative",
        nativeCapabilities: createColyseusNativeCapabilitySummary({
          authoritativePath: "colyseus-schema",
          stateSync: {
            available: true,
            lane: "colyseus-schema",
            schemaVersion: OUTPOST_COLYSEUS_SCHEMA_VERSION
          }
        })
      }
    };

    const bridge = createColyseusRoomRuntimeBridge<
      OutpostSiegeRoom,
      Client,
      OutpostSiegeRoomCreateOptions,
      OutpostRoomAuthorityRuntimeSnapshot
    >({
      id: `outpost.room.${this.roomId}`,
      ...(runtimeOptions.fixedStepMs === undefined
        ? {}
        : { fixedStepMs: runtimeOptions.fixedStepMs }),
      ...(runtimeOptions.maxPayloadBytes === undefined
        ? {}
        : { maxPayloadBytes: runtimeOptions.maxPayloadBytes }),
      ...(runtimeOptions.clock === undefined ? {} : { clock: runtimeOptions.clock }),
      messageType: OUTPOST_MESSAGE_TYPE,
      sessionKind: options.sessionKind ?? "private",
      serverPeer: {
        id: authorityPeerId,
        displayName: "Outpost Authority",
        role: "server"
      },
      resolveSessionId(room, createOptions) {
        return createOptions.sessionId ?? room.roomId;
      },
      createRuntime({ multiplayer, room, sessionId, options: createOptions }) {
        return createOutpostRoomAuthorityRuntime({
          multiplayer,
          ...(runtimeOptions.physicsBackend === undefined
            ? {}
            : { physicsBackend: runtimeOptions.physicsBackend }),
          ...(runtimeOptions.clock === undefined ? {} : { clock: runtimeOptions.clock }),
          ...(runtimeOptions.countdownMs === undefined
            ? {}
            : { countdownMs: runtimeOptions.countdownMs }),
          ...(runtimeOptions.minPlayers === undefined
            ? {}
            : { minPlayers: runtimeOptions.minPlayers }),
          ...(runtimeOptions.maxPlayers === undefined
            ? {}
            : { maxPlayers: runtimeOptions.maxPlayers }),
          publishSnapshot(snapshot) {
            projectOutpostMatchToColyseusState(
              room.state,
              snapshot,
              runtimeOptions.clock?.() ?? Date.now()
            );
          },
          seed: createOptions.seed ?? `outpost.room.${sessionId}`
        });
      }
    });
    this.authorityBridge = bridge;
    await bridge.create(this, options);
    this.unbindMessage = this.onMessage(OUTPOST_MESSAGE_TYPE, (client, message) => {
      bridge.receive(client, message);
    });
    runtimeOptions.onRoomCreated?.(this);
  }

  onJoin(client: Client, options: OutpostSiegeRoomCreateOptions = {}): void {
    this.requireAuthorityBridge().join(client, toOutpostPeer(client, options.localPeer));
  }

  onLeave(client: Client, code?: number): void {
    this.authorityBridge?.leave(client, code);
  }

  async onDispose(): Promise<void> {
    this.unbindMessage?.();
    this.unbindMessage = undefined;
    await this.authorityBridge?.dispose();
  }

  authoritySnapshot(): ColyseusRoomRuntimeBridgeSnapshot<OutpostRoomAuthorityRuntimeSnapshot> {
    return this.requireAuthorityBridge().snapshot();
  }

  private requireAuthorityBridge(): OutpostRoomBridge {
    if (!this.authorityBridge) {
      throw new Error("Outpost Siege Room authority bridge has not been created.");
    }
    return this.authorityBridge;
  }
}

export type OutpostSiegeRoomClass = new () => OutpostSiegeRoom;

export function createOutpostSiegeRoomClass(
  options: OutpostSiegeRoomRuntimeOptions = {}
): OutpostSiegeRoomClass {
  return class ConfiguredOutpostSiegeRoom extends OutpostSiegeRoom {
    protected override runtimeOptions(): OutpostSiegeRoomRuntimeOptions {
      return options;
    }
  };
}

function toOutpostPeer(
  client: Client,
  input: MultiplayerPeerInput | undefined
): MultiplayerPeerInput {
  return {
    id: input?.id ?? client.sessionId,
    ...(input?.displayName === undefined ? {} : { displayName: input.displayName }),
    role: input?.role === "host" ? "party-leader" : (input?.role ?? "client"),
    ...(input?.playerId === undefined ? {} : { playerId: input.playerId }),
    ...(input?.metadata ? { metadata: { ...input.metadata } } : {})
  };
}
