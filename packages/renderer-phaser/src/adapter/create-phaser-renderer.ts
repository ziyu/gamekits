import { GameError } from "@gamekits/core";
import type {
  RenderCommand,
  RenderNodePath,
  RenderObjectDefinition,
  RenderObjectHandle,
  RenderObjectId,
  RendererAdapter,
  RendererBootContext
} from "@gamekits/renderer-core";
import { applyRenderCommand } from "./command-handlers";
import {
  createPhaserRenderRecord,
  ensureDebugTexture,
  SUPPORTED_OBJECT_TYPES
} from "./object-factory";
import { requireRenderRecord, resolveNodePath, type PhaserRenderRecord } from "./object-registry";
import { applyPhaserRenderTargetState } from "./target-state";
import type { PhaserRendererNative, PhaserRendererOptions, PhaserRendererRuntime } from "./types";

const DEFAULT_DEBUG_TEXTURE_ID = "gamekits.debug.square";

export function createPhaserRenderer(
  options: PhaserRendererOptions
): RendererAdapter<PhaserRendererNative, unknown> {
  const rendererId = options.id ?? "renderer.phaser";
  const debugTextureId = options.debugTextureId ?? DEFAULT_DEBUG_TEXTURE_ID;
  const liveObjects = new Set<RenderObjectId>();
  const objects = new Map<string, PhaserRenderRecord>();
  let nextObjectId = 0;
  let bootContext: RendererBootContext | undefined;

  const getRuntime = (): PhaserRendererRuntime | undefined => {
    return typeof options.runtime === "function" ? options.runtime() : options.runtime;
  };

  const requireRuntime = (): PhaserRendererRuntime => {
    const runtime = getRuntime();
    if (!runtime) {
      throw new GameError(
        "renderer.phaser.runtime_unavailable",
        "Phaser renderer runtime is unavailable",
        { rendererId }
      );
    }

    return runtime;
  };

  const requireObject = (objectId: RenderObjectId): void => {
    if (!liveObjects.has(objectId)) {
      throw new GameError("renderer.missing_object", `Missing render object: ${objectId}`, {
        rendererId,
        objectId
      });
    }
  };

  const emitDiagnostic = (type: string, payload: Record<string, unknown>): void => {
    bootContext?.onDiagnostic?.({ type, payload, source: rendererId });
  };

  const ensureSupportedType = (definition: RenderObjectDefinition): void => {
    if (
      !SUPPORTED_OBJECT_TYPES.includes(definition.type as (typeof SUPPORTED_OBJECT_TYPES)[number])
    ) {
      throw new GameError(
        "renderer.unsupported_object_type",
        `Renderer does not support render object type: ${definition.type}`,
        {
          rendererId,
          objectType: definition.type
        }
      );
    }

    for (const child of definition.children ?? []) {
      ensureSupportedType(child);
    }
  };

  return {
    id: rendererId,
    kind: "phaser",
    async boot(ctx) {
      if (bootContext) {
        return;
      }

      bootContext = ctx;
      ensureDebugTexture(requireRuntime().scene, debugTextureId);
      emitDiagnostic("renderer.booted", { rendererId, width: ctx.width, height: ctx.height });
    },
    destroy() {
      emitDiagnostic("renderer.destroyed", { rendererId });
      bootContext = undefined;
      for (const record of objects.values()) {
        record.native.destroy();
      }
      objects.clear();
      liveObjects.clear();
    },
    getView() {
      return requireRuntime().view;
    },
    resize(width, height) {
      requireRuntime().resize?.(width, height);
      emitDiagnostic("renderer.resized", { rendererId, width, height });
    },
    createObject(definition: RenderObjectDefinition) {
      ensureSupportedType(definition);
      const objectId = definition.id ?? `render-object-${nextObjectId}`;
      nextObjectId += 1;
      if (liveObjects.has(objectId)) {
        throw new GameError("renderer.duplicate_object", `Duplicate render object: ${objectId}`, {
          rendererId,
          objectId
        });
      }

      const runtime = requireRuntime();
      objects.set(
        objectId,
        createPhaserRenderRecord(runtime.scene, objectId, definition, debugTextureId)
      );
      liveObjects.add(objectId);
      emitDiagnostic("renderer.object_created", { rendererId, objectId, type: definition.type });
      return objectId;
    },
    destroyObject(objectId) {
      requireObject(objectId);
      const record = requireRenderRecord(objects, objectId);
      record.native.destroy();
      objects.delete(objectId);
      liveObjects.delete(objectId);
      emitDiagnostic("renderer.object_destroyed", { rendererId, objectId });
    },
    command(objectId, command: RenderCommand) {
      requireObject(objectId);
      applyRenderCommand(requireRenderRecord(objects, objectId), command);
    },
    native(): PhaserRendererNative {
      const runtime = requireRuntime();
      return {
        ...runtime,
        gameObject(objectId) {
          return requireRenderRecord(objects, objectId).native;
        },
        node(objectId, nodePath) {
          return requireNode(objects, objectId, nodePath);
        },
        applyObjectState(objectId, state) {
          applyPhaserRenderTargetState(requireRenderRecord(objects, objectId).native, state);
        },
        applyNodeState(objectId, nodePath, state) {
          applyPhaserRenderTargetState(requireNode(objects, objectId, nodePath), state);
        },
        applyTargetState(target, state) {
          applyPhaserRenderTargetState(target, state);
        },
        applyBatch(writes) {
          for (const write of writes) {
            const target =
              write.nodePath === undefined
                ? requireRenderRecord(objects, write.objectId).native
                : requireNode(objects, write.objectId, write.nodePath);
            applyPhaserRenderTargetState(target, write.state);
          }
        }
      };
    },
    getObjectHandle(objectId): RenderObjectHandle<unknown, unknown> {
      requireObject(objectId);
      const record = requireRenderRecord(objects, objectId);
      return {
        id: objectId,
        type: record.type,
        native: record.native,
        escaped: true
      };
    },
    getNodeHandle(objectId, nodePath): RenderObjectHandle<unknown, unknown> {
      requireObject(objectId);
      const node = requireNode(objects, objectId, nodePath);
      return {
        id: objectId,
        type: readNativeType(node),
        native: node,
        escaped: true
      };
    }
  };
}

function requireNode(
  objects: Map<string, PhaserRenderRecord>,
  objectId: RenderObjectId,
  nodePath: RenderNodePath
): unknown {
  const record = requireRenderRecord(objects, objectId);
  const resolvedPath = resolveNodePath(nodePath);
  const node = record.nodes.get(resolvedPath);
  if (!node) {
    throw new GameError("renderer.missing_node", `Missing render node: ${resolvedPath}`, {
      objectId,
      nodePath: resolvedPath
    });
  }

  return node;
}

function readNativeType(native: unknown): string {
  if (typeof native === "object" && native && "type" in native) {
    const type = (native as { type?: unknown }).type;
    if (typeof type === "string") {
      return type;
    }
  }

  return "native";
}
