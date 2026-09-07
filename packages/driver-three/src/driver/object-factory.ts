import type { RenderNodeDefinition, RenderObjectDefinition } from "@gamekits/renderer-core";
import type { Object3D } from "three";
import type { ThreeRenderRecord } from "./object-registry";
import type { ThreeDriverRuntime } from "./runtime";
import { applyObjectDefinition } from "./target-state";

export const SUPPORTED_OBJECT_TYPES = [
  "container",
  "group",
  "mesh",
  "model",
  "debug.square",
  "debug.cube",
  "light"
] as const;

export function createThreeRenderRecord(
  runtime: ThreeDriverRuntime,
  id: string,
  definition: RenderObjectDefinition
): ThreeRenderRecord {
  const native = createThreeObject(runtime, definition);
  markObject(native, "renderObjectId", id);
  applyObjectDefinition(native, definition);
  runtime.scene.add?.(native);

  const record: ThreeRenderRecord = {
    id,
    type: definition.type,
    native,
    nodes: new Map()
  };

  for (const child of definition.children ?? []) {
    attachChildNode(runtime, native, record, child, []);
  }

  return record;
}

function attachChildNode(
  runtime: ThreeDriverRuntime,
  parent: Object3D,
  record: ThreeRenderRecord,
  definition: RenderNodeDefinition,
  pathPrefix: string[]
): void {
  const nodeId = definition.id ?? `${definition.type}-${record.nodes.size}`;
  const nodePath = [...pathPrefix, nodeId].join("/");
  const native = createThreeObject(runtime, definition);
  markObject(native, "renderNodePath", nodePath);
  applyObjectDefinition(native, definition);
  parent.add?.(native);
  record.nodes.set(nodePath, native);

  for (const child of definition.children ?? []) {
    attachChildNode(runtime, native, record, child, [...pathPrefix, nodeId]);
  }
}

function createThreeObject(
  runtime: ThreeDriverRuntime,
  definition: RenderObjectDefinition | RenderNodeDefinition
): Object3D {
  if (definition.type === "container" || definition.type === "group") {
    return runtime.factories.createGroup();
  }
  if (definition.type === "light") {
    return runtime.factories.createLight(definition.props ? { props: definition.props } : {});
  }
  if (definition.type === "model") {
    return runtime.factories.createModel(
      definition.props
        ? { type: definition.type, props: definition.props }
        : { type: definition.type }
    );
  }

  return runtime.factories.createMesh(
    definition.props
      ? { type: definition.type, props: definition.props }
      : { type: definition.type }
  );
}

function markObject(object: Object3D, key: string, value: string): void {
  object.userData ??= {};
  object.userData[key] = value;
}
