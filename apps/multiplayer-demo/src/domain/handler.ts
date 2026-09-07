import type { GameInstallContext } from "@gamekits/game-runtime";
import type { MultiplayerCommandHandler } from "@gamekits/multiplayer-core";
import {
  decodeMultiplayerDemoCommand,
  MULTIPLAYER_DEMO_RELIABLE_CHANNEL,
  MULTIPLAYER_DEMO_RESULT_KIND,
  MULTIPLAYER_DEMO_SCHEMA_VERSION,
  type MultiplayerDemoCommandResultPayload
} from "./commands";
import {
  applyMultiplayerDemoCommand,
  recordDemoTimelineEntry,
  type MultiplayerDemoState
} from "./state";

export function createMultiplayerDemoCommandHandler(
  state: MultiplayerDemoState
): MultiplayerCommandHandler<GameInstallContext> {
  return (ctx) => {
    const decoded = decodeMultiplayerDemoCommand(ctx.message.payload);
    if (!decoded.ok) {
      return;
    }

    applyMultiplayerDemoCommand(state, decoded.command);
    recordDemoTimelineEntry(state, {
      type: "accepted",
      label: `${decoded.command.type} applied`,
      commandId: ctx.message.id,
      peerId: ctx.message.sourcePeerId
    });

    const result: MultiplayerDemoCommandResultPayload = {
      schemaVersion: MULTIPLAYER_DEMO_SCHEMA_VERSION,
      commandId: ctx.message.id,
      status: "accepted",
      commandType: decoded.command.type,
      summary: {
        ...(state.selectedObjectId ? { selectedObjectId: state.selectedObjectId } : {}),
        strategy: state.strategy,
        confirmations: state.confirmations,
        appliedCommands: state.appliedCommands
      }
    };

    void ctx.runtime
      .send({
        channel: MULTIPLAYER_DEMO_RELIABLE_CHANNEL,
        kind: MULTIPLAYER_DEMO_RESULT_KIND,
        targetPeerIds: [ctx.message.sourcePeerId],
        correlationId: ctx.message.correlationId ?? ctx.message.id,
        payload: result
      })
      .then(() => {
        recordDemoTimelineEntry(state, {
          type: "result",
          label: `${decoded.command.type} result sent`,
          commandId: ctx.message.id,
          peerId: ctx.message.sourcePeerId
        });
      })
      .catch((error: unknown) => {
        ctx.installContext.eventBus.emit(
          "multiplayer.demo.result_failed",
          {
            commandId: ctx.message.id,
            peerId: ctx.message.sourcePeerId,
            reason: error instanceof Error ? error.message : String(error)
          },
          "multiplayer-demo"
        );
      });
  };
}
