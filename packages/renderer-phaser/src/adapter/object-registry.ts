import { GameError } from "@gamekits/core";

export type PhaserRenderRecord = {
  id: string;
  type: string;
  native: any;
  nodes: Map<string, any>;
};

export function requireRenderRecord(
  objects: Map<string, PhaserRenderRecord>,
  objectId: string
): PhaserRenderRecord {
  const record = objects.get(objectId);
  if (!record) {
    throw new GameError("renderer.missing_object", `Missing render object: ${objectId}`, {
      objectId
    });
  }

  return record;
}

export function resolveNodePath(nodePath: string | string[]): string {
  return Array.isArray(nodePath) ? nodePath.join("/") : nodePath;
}
