import type {
  MultiplayerAuthorityDecision,
  MultiplayerAuthorityPolicy
} from "@gamekits/multiplayer-core";
import type { GameInstallContext } from "@gamekits/game-runtime";
import { decodeMultiplayerDemoCommand } from "./commands";
import { hasDemoObject, recordDemoTimelineEntry, type MultiplayerDemoState } from "./state";

export function createMultiplayerDemoAuthority(
  state: MultiplayerDemoState
): MultiplayerAuthorityPolicy<GameInstallContext> {
  return (ctx): MultiplayerAuthorityDecision => {
    const peer = ctx.runtime.peers().find((candidate) => candidate.id === ctx.message.sourcePeerId);
    if (ctx.message.sourcePeerId === ctx.runtime.localPeer()?.id || peer?.role !== "client") {
      return reject(state, {
        code: "demo.peer.role",
        reason: "Only connected client peers may submit demo commands.",
        messageId: ctx.message.id,
        peerId: ctx.message.sourcePeerId
      });
    }

    const decoded = decodeMultiplayerDemoCommand(ctx.message.payload);
    if (!decoded.ok) {
      return reject(state, {
        code: decoded.code,
        reason: decoded.reason,
        messageId: ctx.message.id,
        peerId: ctx.message.sourcePeerId
      });
    }

    const command = decoded.command;
    if (
      (command.type === "select" || command.type === "set-priority") &&
      !hasDemoObject(state, command.objectId)
    ) {
      return reject(state, {
        code: "demo.target.missing",
        reason: `Unknown demo object: ${command.objectId}`,
        messageId: ctx.message.id,
        peerId: ctx.message.sourcePeerId
      });
    }

    if (command.type === "confirm" && command.objectId && !hasDemoObject(state, command.objectId)) {
      return reject(state, {
        code: "demo.target.missing",
        reason: `Unknown demo object: ${command.objectId}`,
        messageId: ctx.message.id,
        peerId: ctx.message.sourcePeerId
      });
    }

    if (command.type === "set-priority" && (command.priority < 0 || command.priority > 5)) {
      return reject(state, {
        code: "demo.priority.range",
        reason: "Priority must be between 0 and 5.",
        messageId: ctx.message.id,
        peerId: ctx.message.sourcePeerId
      });
    }

    return { allowed: true };
  };
}

function reject(
  state: MultiplayerDemoState,
  input: {
    code: string;
    reason: string;
    messageId: string;
    peerId: string;
  }
): MultiplayerAuthorityDecision {
  state.rejectedCommands += 1;
  recordDemoTimelineEntry(state, {
    type: "rejected",
    label: input.reason,
    commandId: input.messageId,
    peerId: input.peerId,
    code: input.code
  });

  return {
    allowed: false,
    code: input.code,
    reason: input.reason
  };
}
