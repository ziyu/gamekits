import type { RenderObjectDefinition } from "@gamekits/renderer-core";
import type { SandboxRenderRigDefinition } from "../../sandbox-data";

export function createRenderableDefinition(
  definition: RenderObjectDefinition
): RenderObjectDefinition {
  const { id: _id, ...renderable } = definition;
  return definition.children
    ? {
        ...renderable,
        children: definition.children.map((child) => ({ ...child }))
      }
    : renderable;
}

export function createPresentationData(
  definition: RenderObjectDefinition,
  nodeAnimations: SandboxRenderRigDefinition["nodeAnimations"] | undefined
) {
  return nodeAnimations ? { definition, nodeAnimations } : { definition };
}
