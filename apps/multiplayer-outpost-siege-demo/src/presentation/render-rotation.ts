import type { DataRegistry } from "@gamekits/data";

import { OUTPOST_RENDER_OBJECT_TYPE, type OutpostRenderObjectDefinition } from "../domain";

export function outpostFacingRotation(
  definition: Pick<OutpostRenderObjectDefinition, "facingOffsetRadians">,
  gameplayFacing: number
): number {
  return gameplayFacing + (definition.facingOffsetRadians ?? 0);
}

export function resolveOutpostFacingRotation(
  registry: DataRegistry,
  renderKey: string,
  gameplayFacing: number
): number {
  return outpostFacingRotation(
    registry.getValue<OutpostRenderObjectDefinition>(OUTPOST_RENDER_OBJECT_TYPE, renderKey),
    gameplayFacing
  );
}
