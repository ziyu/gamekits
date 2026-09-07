import type { DataPackEntry } from "@gamekits/data";
import type { RenderNodeDefinition, RenderObjectDefinition } from "@gamekits/renderer-core";
import { sandboxVisualAssetEntries } from "./visual-assets";
import { sandboxVisualRenderObjectEntries } from "./visual-render-objects";
import { sandboxVisualRenderRigEntries } from "./visual-render-rigs";

export const sandboxVisualEntries: DataPackEntry[] = [
  ...sandboxVisualAssetEntries,
  ...withTintFillMode(sandboxVisualRenderObjectEntries),
  ...sandboxVisualRenderRigEntries
];

function withTintFillMode(entries: DataPackEntry[]): DataPackEntry[] {
  return entries.map((entry) => {
    if (entry.type !== "render.object") {
      return entry;
    }

    return {
      ...entry,
      data: normalizeRenderObjectTintMode(entry.data as RenderObjectDefinition)
    };
  });
}

function normalizeRenderObjectTintMode(definition: RenderObjectDefinition): RenderObjectDefinition {
  return {
    ...definition,
    ...withProps(normalizeTintProps(definition.props)),
    ...withChildren(definition.children?.map(normalizeRenderNodeTintMode))
  };
}

function normalizeRenderNodeTintMode(definition: RenderNodeDefinition): RenderNodeDefinition {
  return {
    ...definition,
    ...withProps(normalizeTintProps(definition.props)),
    ...withChildren(definition.children?.map(normalizeRenderNodeTintMode))
  };
}

function normalizeTintProps(
  props: Partial<Record<string, unknown>> | undefined
): Partial<Record<string, unknown>> | undefined {
  if (typeof props?.tint !== "number" || props.tintMode !== undefined) {
    return props;
  }

  return {
    ...props,
    tintMode: "fill"
  };
}

function withProps(
  props: Partial<Record<string, unknown>> | undefined
): { props: Partial<Record<string, unknown>> } | Record<string, never> {
  return props === undefined ? {} : { props };
}

function withChildren(
  children: RenderNodeDefinition[] | undefined
): { children: RenderNodeDefinition[] } | Record<string, never> {
  return children === undefined ? {} : { children };
}
