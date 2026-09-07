import { GameError } from "@gamekits/core";
import type { RenderCommand } from "@gamekits/renderer-core";
import type { Object3D } from "three";
import type { ThreeRenderRecord } from "./object-registry";

export function applyRenderCommand(record: ThreeRenderRecord, command: RenderCommand): void {
  if (command.type === "animation.play" || command.type === "animation.sample") {
    const target = resolveCommandTarget(record, command.target);
    target.userData ??= {};
    target.userData.lastRenderCommand = {
      type: command.type,
      args: command.args ?? {}
    };
    return;
  }

  if (command.type === "render.once") {
    record.native.userData ??= {};
    record.native.userData.renderRequested = true;
    return;
  }

  throw new GameError(
    "renderer.unsupported_command",
    `Unsupported Three render command: ${command.type}`,
    {
      objectId: record.id,
      commandType: command.type
    }
  );
}

function resolveCommandTarget(
  record: ThreeRenderRecord,
  target: RenderCommand["target"]
): Object3D {
  if (!target) {
    return record.native;
  }

  const nodePath = Array.isArray(target) ? target.join("/") : target;
  const node = record.nodes.get(nodePath);
  if (!node) {
    throw new GameError("renderer.missing_node", `Missing render node: ${nodePath}`, {
      objectId: record.id,
      nodePath
    });
  }
  return node;
}
