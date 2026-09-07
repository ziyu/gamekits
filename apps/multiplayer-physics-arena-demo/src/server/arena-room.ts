import { Room, type Client } from "@colyseus/core";
import type { GameKitsColyseusRoomJoinOptions } from "@gamekits/multiplayer-colyseus";
import {
  createColyseusRoomRuntimeBridge,
  type ColyseusRoomOwnedRuntime,
  type ColyseusRoomRuntimeBridge
} from "@gamekits/multiplayer-colyseus/server";
import { initRapier3dPhysicsBackend } from "@gamekits/physics-rapier3d";

import { prepareArenaBotNavigationRuntime } from "../ai/navigation";
import { ARENA_COMPILED_CONTENT } from "../content/default-content";
import { ARENA_FIXED_STEP_MS, ARENA_MESSAGE_TYPE, arenaAuthorityPeerId } from "../shared/config";
import {
  ARENA_STAGE_SELECTION_METADATA_KEY,
  readArenaStageSelection,
  resolveArenaStageSelection
} from "../shared/arena-stage-selection";
import {
  createArenaAuthorityRuntime,
  type ArenaAuthorityRuntime,
  type ArenaAuthorityRuntimeSnapshot
} from "./arena-authority";

export type ArenaRoomCreateOptions = GameKitsColyseusRoomJoinOptions;

type ArenaRoomBridge = ColyseusRoomRuntimeBridge<
  KnockoutArenaRoom,
  Client,
  ArenaRoomCreateOptions,
  ArenaAuthorityRuntimeSnapshot
>;

export class KnockoutArenaRoom extends Room {
  private authorityBridge: ArenaRoomBridge | undefined;
  private unbindMessage: (() => void) | undefined;

  async onCreate(options: ArenaRoomCreateOptions = {}): Promise<void> {
    if (typeof options.roomId === "string" && options.roomId.length > 0) {
      this.roomId = options.roomId;
    }
    const sessionId = options.sessionId ?? this.roomId;
    const authorityPeerId = arenaAuthorityPeerId(sessionId);
    const legacyOpeningStage = readArenaStageSelection(
      ARENA_COMPILED_CONTENT.stages[0]!.definition.id
    );
    if (legacyOpeningStage === undefined) {
      throw new Error("Knockout Arena content has no valid opening stage.");
    }
    const requestedStage =
      readArenaStageSelection(options.metadata?.[ARENA_STAGE_SELECTION_METADATA_KEY]) ??
      legacyOpeningStage;
    const stageSelection = resolveArenaStageSelection(requestedStage);
    this.maxClients = 8;
    this.metadata = {
      gamekits: {
        kind: options.sessionKind ?? "private",
        authority: "server-authoritative",
        demo: "knockout-circuit",
        requestedStage: stageSelection.requested,
        initialStageId: stageSelection.stageId
      }
    };
    const bridge = createColyseusRoomRuntimeBridge<
      KnockoutArenaRoom,
      Client,
      ArenaRoomCreateOptions,
      ArenaAuthorityRuntimeSnapshot,
      ColyseusRoomOwnedRuntime<ArenaAuthorityRuntimeSnapshot>
    >({
      id: `knockout.room.${sessionId}`,
      fixedStepMs: ARENA_FIXED_STEP_MS,
      maxPayloadBytes: 256 * 1024,
      messageType: ARENA_MESSAGE_TYPE,
      sessionKind: options.sessionKind ?? "private",
      serverPeer: {
        id: authorityPeerId,
        displayName: "Knockout Authority",
        role: "server"
      },
      resolveSessionId: (_room, createOptions) => createOptions.sessionId ?? sessionId,
      async createRuntime({ multiplayer }) {
        const backend = await initRapier3dPhysicsBackend({
          id: `knockout.rapier3d.${sessionId}`,
          groups: { "arena-item": 0b001, "arena-actor": 0b010, "arena-world": 0b100 }
        });
        const navigation = await prepareArenaBotNavigationRuntime(ARENA_COMPILED_CONTENT);
        const authority: ArenaAuthorityRuntime = createArenaAuthorityRuntime({
          runtime: multiplayer,
          backend,
          navigation,
          sessionId,
          authorityPeerId,
          initialStageIndex: stageSelection.stageIndex
        });
        return {
          tick(frame) {
            authority.tick(frame.deltaMs);
          },
          dispose() {
            authority.dispose();
          },
          snapshot() {
            return authority.snapshot();
          }
        };
      }
    });
    this.authorityBridge = bridge;
    await bridge.create(this, options);
    this.unbindMessage = this.onMessage(ARENA_MESSAGE_TYPE, (client, message) => {
      bridge.receive(client, message);
    });
  }

  onJoin(client: Client, options: ArenaRoomCreateOptions = {}): void {
    const local = options.localPeer;
    this.requireBridge().join(client, {
      id: local?.id ?? client.sessionId,
      ...(local?.displayName === undefined ? {} : { displayName: local.displayName }),
      role: "client",
      ...(local?.playerId === undefined ? {} : { playerId: local.playerId })
    });
  }

  onLeave(client: Client, code?: number): void {
    this.authorityBridge?.leave(client, code);
  }

  async onDispose(): Promise<void> {
    this.unbindMessage?.();
    this.unbindMessage = undefined;
    await this.authorityBridge?.dispose();
  }

  authoritySnapshot(): ReturnType<ArenaRoomBridge["snapshot"]> {
    return this.requireBridge().snapshot();
  }

  private requireBridge(): ArenaRoomBridge {
    if (!this.authorityBridge) throw new Error("Knockout arena authority bridge is not ready.");
    return this.authorityBridge;
  }
}
