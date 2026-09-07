import { GameError } from "@gamekits/core";
import type {
  RenderCommand,
  RenderNodePath,
  RenderObjectDefinition,
  RenderObjectHandle,
  RenderObjectId,
  RendererBootContext
} from "@gamekits/renderer-core";
import { Box3, type Object3D, Vector3 } from "three";
import { applyRenderCommand } from "./command-handlers";
import { createThreeRenderRecord, SUPPORTED_OBJECT_TYPES } from "./object-factory";
import { requireRenderRecord, resolveNodePath, type ThreeRenderRecord } from "./object-registry";
import { disposeObjectTree, type ThreeDriverRuntime } from "./runtime";
import type { ThreeMaterialSlot, ThreeObjectTarget } from "./structural-types";
import { applyThreeRenderTargetState } from "./target-state";
import type {
  ThreeNativeObject,
  ThreeRendererAdapter,
  ThreeRendererNative,
  ThreeRenderTargetDiagnostics
} from "./types";

export type ThreeRendererOptions = {
  id?: string;
  runtime: ThreeDriverRuntime | (() => ThreeDriverRuntime | undefined);
};

export function createThreeRenderer(options: ThreeRendererOptions): ThreeRendererAdapter {
  const rendererId = options.id ?? "renderer.three";
  const liveObjects = new Set<RenderObjectId>();
  const objects = new Map<string, ThreeRenderRecord>();
  let nextObjectId = 0;
  let bootContext: RendererBootContext | undefined;

  const getRuntime = (): ThreeDriverRuntime | undefined => {
    return typeof options.runtime === "function" ? options.runtime() : options.runtime;
  };

  const requireRuntime = (): ThreeDriverRuntime => {
    const runtime = getRuntime();
    if (!runtime) {
      throw new GameError(
        "renderer.three.runtime_unavailable",
        "Three renderer runtime is unavailable",
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

  const renderNow = (): void => {
    getRuntime()?.render();
  };

  return {
    id: rendererId,
    kind: "three",
    async boot(ctx) {
      if (bootContext) {
        return;
      }

      bootContext = ctx;
      requireRuntime().resize(ctx.width, ctx.height);
      emitDiagnostic("renderer.booted", { rendererId, width: ctx.width, height: ctx.height });
    },
    destroy() {
      emitDiagnostic("renderer.destroyed", { rendererId });
      const runtime = getRuntime();
      for (const record of objects.values()) {
        runtime?.scene.remove?.(record.native);
        disposeObjectTree(record.native as unknown as ThreeObjectTarget);
      }
      objects.clear();
      liveObjects.clear();
      bootContext = undefined;
      renderNow();
    },
    getView() {
      return requireRuntime().view;
    },
    resize(width, height) {
      requireRuntime().resize(width, height);
      emitDiagnostic("renderer.resized", { rendererId, width, height });
    },
    createObject(definition: RenderObjectDefinition) {
      ensureSupportedType(rendererId, definition);
      const objectId = definition.id ?? `render-object-${nextObjectId}`;
      nextObjectId += 1;
      if (liveObjects.has(objectId)) {
        throw new GameError("renderer.duplicate_object", `Duplicate render object: ${objectId}`, {
          rendererId,
          objectId
        });
      }

      const runtime = requireRuntime();
      objects.set(objectId, createThreeRenderRecord(runtime, objectId, definition));
      liveObjects.add(objectId);
      emitDiagnostic("renderer.object_created", { rendererId, objectId, type: definition.type });
      renderNow();
      return objectId;
    },
    destroyObject(objectId) {
      requireObject(objectId);
      const runtime = requireRuntime();
      const record = requireRenderRecord(objects, objectId);
      runtime.scene.remove?.(record.native);
      disposeObjectTree(record.native as unknown as ThreeObjectTarget);
      objects.delete(objectId);
      liveObjects.delete(objectId);
      emitDiagnostic("renderer.object_destroyed", { rendererId, objectId });
      renderNow();
    },
    command(objectId, command: RenderCommand) {
      requireObject(objectId);
      applyRenderCommand(requireRenderRecord(objects, objectId), command);
      renderNow();
    },
    native(): ThreeRendererNative {
      const runtime = requireRuntime();
      return {
        view: runtime.view,
        scene: runtime.scene as unknown as ThreeRendererNative["scene"],
        camera: runtime.camera as unknown as ThreeRendererNative["camera"],
        renderer: runtime.renderer as unknown as ThreeRendererNative["renderer"],
        resources: runtime.resources,
        factories: runtime.factories,
        resize: runtime.resize,
        render: runtime.render,
        destroy: runtime.destroy,
        object(objectId) {
          return requireRenderRecord(objects, objectId).native as unknown as ThreeNativeObject;
        },
        node(objectId, nodePath) {
          return requireNode(objects, objectId, nodePath) as unknown as ThreeNativeObject;
        },
        inspectObject(objectId) {
          return inspectThreeTarget(requireRenderRecord(objects, objectId).native);
        },
        inspectNode(objectId, nodePath) {
          return inspectThreeTarget(requireNode(objects, objectId, nodePath));
        },
        applyObjectState(objectId, state) {
          applyThreeRenderTargetState(requireRenderRecord(objects, objectId).native, state);
          renderNow();
        },
        applyNodeState(objectId, nodePath, state) {
          applyThreeRenderTargetState(requireNode(objects, objectId, nodePath), state);
          renderNow();
        },
        applyTargetState(target, state) {
          applyThreeRenderTargetState(target, state);
          renderNow();
        }
      };
    },
    getObjectHandle(objectId): RenderObjectHandle<ThreeNativeObject, unknown> {
      requireObject(objectId);
      const record = requireRenderRecord(objects, objectId);
      return {
        id: objectId,
        type: record.type,
        native: record.native as unknown as ThreeNativeObject,
        escaped: true
      };
    },
    getNodeHandle(objectId, nodePath): RenderObjectHandle<ThreeNativeObject, unknown> {
      requireObject(objectId);
      const node = requireNode(objects, objectId, nodePath);
      return {
        id: objectId,
        type: readNativeType(node),
        native: node as unknown as ThreeNativeObject,
        escaped: true
      };
    }
  };
}

function ensureSupportedType(rendererId: string, definition: RenderObjectDefinition): void {
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
    ensureSupportedType(rendererId, child);
  }
}

function requireNode(
  objects: Map<string, ThreeRenderRecord>,
  objectId: RenderObjectId,
  nodePath: RenderNodePath
): Object3D {
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

function readNativeType(native: Object3D): string {
  return typeof native.type === "string" ? native.type : "native";
}

function inspectThreeTarget(target: Object3D): ThreeRenderTargetDiagnostics {
  let nodeCount = 0;
  let meshCount = 0;
  let skinnedMeshCount = 0;
  let visibleMeshCount = 0;
  let frustumCulledMeshCount = 0;
  let materialCount = 0;
  let invisibleMaterialCount = 0;
  let transparentMaterialCount = 0;
  let wireframeMaterialCount = 0;
  let minOpacity: number | undefined;
  let maxOpacity: number | undefined;

  const visit = (object: Object3D, parentVisible: boolean): void => {
    const targetObject = object as unknown as ThreeObjectTarget;
    nodeCount += 1;
    const visible = parentVisible && object.visible !== false;
    if (isMeshTarget(object)) {
      meshCount += 1;
      if (isSkinnedMeshTarget(object)) {
        skinnedMeshCount += 1;
      }
      if (visible) {
        visibleMeshCount += 1;
      }
      if (object.frustumCulled !== false) {
        frustumCulledMeshCount += 1;
      }
      for (const material of readMaterials(targetObject.material)) {
        materialCount += 1;
        if (material.visible === false) {
          invisibleMaterialCount += 1;
        }
        if (material.transparent === true) {
          transparentMaterialCount += 1;
        }
        if (material.wireframe === true) {
          wireframeMaterialCount += 1;
        }
        if (typeof material.opacity === "number") {
          minOpacity =
            minOpacity === undefined ? material.opacity : Math.min(minOpacity, material.opacity);
          maxOpacity =
            maxOpacity === undefined ? material.opacity : Math.max(maxOpacity, material.opacity);
        }
      }
    }
    for (const child of object.children ?? []) {
      visit(child, visible);
    }
  };
  visit(target, true);

  const diagnostics: ThreeRenderTargetDiagnostics = {
    type: target.type ?? "native",
    visible: target.visible !== false,
    assetBacked: target.userData?.assetModel === true,
    nodeCount,
    meshCount,
    skinnedMeshCount,
    visibleMeshCount,
    frustumCulledMeshCount,
    materialCount,
    invisibleMaterialCount,
    transparentMaterialCount,
    wireframeMaterialCount,
    childCount: target.children?.length ?? 0,
    clipNames: readClipNames(target)
  };
  if (minOpacity !== undefined) {
    diagnostics.minOpacity = roundDiagnosticNumber(minOpacity);
  }
  if (maxOpacity !== undefined) {
    diagnostics.maxOpacity = roundDiagnosticNumber(maxOpacity);
  }
  if (target.name && target.name.length > 0) {
    diagnostics.name = target.name;
  }
  const assetId = readString(target.userData?.assetId);
  if (assetId) {
    diagnostics.assetId = assetId;
  }
  const bounds = readBounds(target);
  if (bounds) {
    diagnostics.bounds = bounds;
  }
  return diagnostics;
}

function readBounds(target: Object3D): ThreeRenderTargetDiagnostics["bounds"] {
  try {
    const box = new Box3().setFromObject(target);
    if (box.isEmpty()) {
      return undefined;
    }
    const center = new Vector3();
    const size = new Vector3();
    box.getCenter(center);
    box.getSize(size);
    return {
      min: toVectorSummary(box.min),
      max: toVectorSummary(box.max),
      center: toVectorSummary(center),
      size: toVectorSummary(size)
    };
  } catch {
    return undefined;
  }
}

function toVectorSummary(vector: Vector3): { x: number; y: number; z: number } {
  return {
    x: roundDiagnosticNumber(vector.x),
    y: roundDiagnosticNumber(vector.y),
    z: roundDiagnosticNumber(vector.z)
  };
}

function roundDiagnosticNumber(value: number): number {
  return Number.isFinite(value) ? Math.round(value * 1000) / 1000 : 0;
}

function isMeshTarget(object: Object3D): boolean {
  const record = object as unknown as ThreeObjectTarget;
  return record.isMesh === true || record.isSkinnedMesh === true || record.geometry !== undefined;
}

function isSkinnedMeshTarget(object: Object3D): boolean {
  return (object as unknown as ThreeObjectTarget).isSkinnedMesh === true;
}

function readMaterials(
  material: ThreeMaterialSlot | undefined
): Array<{ visible?: boolean; transparent?: boolean; wireframe?: boolean; opacity?: number }> {
  if (Array.isArray(material)) {
    return material as Array<{
      visible?: boolean;
      transparent?: boolean;
      wireframe?: boolean;
      opacity?: number;
    }>;
  }
  if (!material) {
    return [];
  }
  return [
    material as {
      visible?: boolean;
      transparent?: boolean;
      wireframe?: boolean;
      opacity?: number;
    }
  ];
}

function readClipNames(target: Object3D): string[] {
  const names = target.userData?.assetClipNames;
  return Array.isArray(names)
    ? names.filter((name): name is string => typeof name === "string")
    : [];
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
