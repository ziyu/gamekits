import { GameError } from "@gamekits/core";
import type { RenderCommand } from "@gamekits/renderer-core";
import { resolveNodePath, type PhaserRenderRecord } from "./object-registry";

export function applyRenderCommand(record: PhaserRenderRecord, command: RenderCommand): void {
  const target = resolveCommandTarget(record, command);
  switch (command.type) {
    case "animation.play": {
      const animationId = requireStringArg(record, command, "animationId");
      const ignoreIfPlaying = command.args?.ignoreIfPlaying === true;
      target.play?.(animationId, ignoreIfPlaying);
      return;
    }
    case "animation.stop":
      target.stop?.();
      return;
    case "animation.seek": {
      const progress = command.args?.progress;
      if (
        typeof progress !== "number" ||
        !Number.isFinite(progress) ||
        progress < 0 ||
        progress > 1
      ) {
        throw invalidCommand(
          record,
          command,
          "animation.seek requires progress between zero and one"
        );
      }
      target.anims?.setProgress?.(progress);
      return;
    }
    case "particle.start":
      target.start?.();
      return;
    case "particle.stop":
      target.stop?.();
      return;
    case "particle.emit": {
      const quantity = command.args?.quantity ?? 1;
      if (typeof quantity !== "number" || !Number.isSafeInteger(quantity) || quantity <= 0) {
        throw invalidCommand(record, command, "particle.emit requires a positive integer quantity");
      }
      const x = typeof command.args?.x === "number" ? command.args.x : undefined;
      const y = typeof command.args?.y === "number" ? command.args.y : undefined;
      if (x === undefined || y === undefined) {
        target.explode?.(quantity);
      } else {
        target.explode?.(quantity, x, y);
      }
      return;
    }
    default:
      throw new GameError(
        "renderer.unsupported_command",
        `Unsupported render command: ${command.type}`,
        {
          objectId: record.id,
          commandType: command.type
        }
      );
  }
}

function requireStringArg(record: PhaserRenderRecord, command: RenderCommand, key: string): string {
  const value = command.args?.[key];
  if (typeof value !== "string" || value.length === 0) {
    throw invalidCommand(record, command, `${command.type} requires args.${key}`);
  }
  return value;
}

function invalidCommand(
  record: PhaserRenderRecord,
  command: RenderCommand,
  message: string
): GameError {
  return new GameError("renderer.invalid_command", message, {
    objectId: record.id,
    commandType: command.type
  });
}

function resolveCommandTarget(record: PhaserRenderRecord, command: RenderCommand): any {
  if (!command.target) {
    return record.native;
  }

  const nodePath = resolveNodePath(command.target);
  const node = record.nodes.get(nodePath);
  if (!node) {
    throw new GameError("renderer.missing_node", `Missing render node: ${nodePath}`, {
      objectId: record.id,
      nodePath
    });
  }

  return node;
}
