import { GameError } from "@gamekits/core";
import type { RenderNodePath } from "@gamekits/renderer-core";
import type { Object3D } from "three";

export type ThreeRenderRecord = {
  id: string;
  type: string;
  native: Object3D;
  nodes: Map<string, Object3D>;
};

export function requireRenderRecord(
  objects: Map<string, ThreeRenderRecord>,
  objectId: string
): ThreeRenderRecord {
  const record = objects.get(objectId);
  if (!record) {
    throw new GameError("renderer.missing_object", `Missing render object: ${objectId}`, {
      objectId
    });
  }

  return record;
}

export function resolveNodePath(nodePath: RenderNodePath): string {
  return Array.isArray(nodePath) ? nodePath.join("/") : nodePath;
}
