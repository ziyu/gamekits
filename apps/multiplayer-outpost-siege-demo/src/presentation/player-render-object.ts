import type { DataRegistry } from "@gamekits/data";
import type { RenderObjectDefinition } from "@gamekits/renderer-core";

import { OUTPOST_RENDER_OBJECT_TYPE, type OutpostRenderObjectDefinition } from "../domain";
import { OUTPOST_PRESENTATION_SIZE } from "../gameplay/constants";
import { outpostFacingRotation } from "./render-rotation";

export function createOutpostPlayerRenderObjectDefinition(
  registry: DataRegistry,
  renderKey: string,
  id: string,
  x: number,
  y: number,
  rotation: number
): RenderObjectDefinition {
  return createOutpostDynamicRenderObjectDefinition(registry, renderKey, id, x, y, rotation, [
    "outpost.client-player"
  ]);
}

export function createOutpostDynamicRenderObjectDefinition(
  registry: DataRegistry,
  renderKey: string,
  id: string,
  x: number,
  y: number,
  rotation: number,
  tags: readonly string[] = []
): RenderObjectDefinition {
  const source = registry.getValue<OutpostRenderObjectDefinition>(
    OUTPOST_RENDER_OBJECT_TYPE,
    renderKey
  );
  const size = OUTPOST_PRESENTATION_SIZE[renderKey as keyof typeof OUTPOST_PRESENTATION_SIZE];
  if (!size) {
    throw new Error(`Outpost player render object requires presentation size: ${renderKey}`);
  }
  const texture = source.assetRefs.texture;
  if (!texture) {
    throw new Error(`Outpost player render object requires texture AssetRef: ${renderKey}`);
  }
  return {
    id,
    type: source.type,
    ...(source.layer === undefined ? {} : { layer: source.layer }),
    tags: [...(source.tags ?? []), ...tags],
    transform: {
      position: { x, y },
      rotation: { z: outpostFacingRotation(source, rotation) }
    },
    props: { textureId: texture.assetId, ...size }
  };
}
