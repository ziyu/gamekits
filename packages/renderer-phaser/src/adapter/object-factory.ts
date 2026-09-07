import type { RenderNodeDefinition, RenderObjectDefinition } from "@gamekits/renderer-core";
import type { PhaserRenderRecord } from "./object-registry";
import { applyObjectDefinition } from "./target-state";

export const SUPPORTED_OBJECT_TYPES = [
  "debug.square",
  "sprite",
  "animated-sprite",
  "particle-emitter",
  "container"
] as const;

export function ensureDebugTexture(scene: any, debugTextureId: string): void {
  if (scene.textures.exists(debugTextureId)) {
    return;
  }

  const graphics = scene.make.graphics({ x: 0, y: 0, add: false });
  graphics.fillStyle(0x7fd16b, 1);
  graphics.fillRect(0, 0, 24, 24);
  graphics.lineStyle(3, 0x10100e, 1);
  graphics.strokeRect(1, 1, 22, 22);
  graphics.generateTexture(debugTextureId, 24, 24);
  graphics.destroy();
}

export function createPhaserRenderRecord(
  scene: any,
  id: string,
  definition: RenderObjectDefinition,
  debugTextureId: string
): PhaserRenderRecord {
  const native = createPhaserObject(scene, definition, debugTextureId);
  native.setData?.("renderObjectId", id);
  applyObjectDefinition(native, definition);

  const record: PhaserRenderRecord = {
    id,
    type: definition.type,
    native,
    nodes: new Map()
  };

  for (const child of definition.children ?? []) {
    attachChildNode(scene, native, record, child, debugTextureId, []);
  }

  return record;
}

function attachChildNode(
  scene: any,
  parent: any,
  record: PhaserRenderRecord,
  definition: RenderNodeDefinition,
  debugTextureId: string,
  pathPrefix: string[]
): void {
  const nodeId = definition.id ?? `${definition.type}-${record.nodes.size}`;
  const nodePath = [...pathPrefix, nodeId].join("/");
  const native = createPhaserObject(scene, definition, debugTextureId);
  native.setData?.("renderNodePath", nodePath);
  applyObjectDefinition(native, definition);
  parent.add?.(native);
  record.nodes.set(nodePath, native);

  for (const child of definition.children ?? []) {
    attachChildNode(scene, native, record, child, debugTextureId, [...pathPrefix, nodeId]);
  }
}

function createPhaserObject(
  scene: any,
  definition: RenderObjectDefinition | RenderNodeDefinition,
  debugTextureId: string
): any {
  const transform = definition.transform;
  const x = transform?.position?.x ?? 0;
  const y = transform?.position?.y ?? 0;

  if (definition.type === "container") {
    return scene.add.container(x, y);
  }

  const textureId = resolveTexture(scene, definition, debugTextureId);
  if (definition.type === "particle-emitter") {
    const config = isRecord(definition.props?.config) ? { ...definition.props.config } : {};
    return scene.add.particles(x, y, textureId, config);
  }
  return scene.add.sprite(x, y, textureId);
}

function resolveTexture(
  scene: any,
  definition: RenderObjectDefinition | RenderNodeDefinition,
  debugTextureId: string
): string {
  const textureId =
    typeof definition.props?.textureId === "string" ? definition.props.textureId : undefined;
  if (textureId && scene.textures.exists(textureId)) {
    return textureId;
  }

  return debugTextureId;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
