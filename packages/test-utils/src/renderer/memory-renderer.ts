import type {
  RenderCommand,
  RenderNodePath,
  RenderObjectDefinition,
  RendererAdapter,
  RendererBootContext,
  RenderTransform
} from "@gamekits/renderer-core";

export type MemoryRenderObject = RenderObjectDefinition & {
  id: string;
  commands: RenderCommand[];
  nodes: Map<string, MemoryRenderNode>;
};

export type MemoryRenderNode = {
  id: string;
  type: string;
  transform?: RenderTransform;
  visible?: boolean;
  alpha?: number;
  layer?: string;
  props?: Record<string, unknown>;
};

export type MemoryRendererNative = {
  object(id: string): MemoryRenderObject;
  node(objectId: string, nodePath: RenderNodePath): MemoryRenderNode;
};

export type MemoryRendererAdapter = RendererAdapter<
  MemoryRendererNative,
  MemoryRenderObject | MemoryRenderNode
> & {
  objects(): MemoryRenderObject[];
};

const SUPPORTED_OBJECT_TYPES = ["debug.square", "sprite", "container"] as const;

function createRendererView(rendererId: string): HTMLElement {
  if (typeof document !== "undefined") {
    const element = document.createElement("div");
    element.dataset.renderer = rendererId;
    return element;
  }

  return {
    dataset: { renderer: rendererId },
    remove() {
      // Test-only stand-in for environments without DOM globals.
    }
  } as unknown as HTMLElement;
}

export function createMemoryRenderer(id = "memory-renderer"): MemoryRendererAdapter {
  let nextId = 0;
  let view: HTMLElement | undefined;
  let width = 0;
  let height = 0;
  const objects = new Map<string, MemoryRenderObject>();
  let onDiagnostic: RendererBootContext["onDiagnostic"];
  const requireObject = (objectId: string): MemoryRenderObject => {
    const object = objects.get(objectId);
    if (!object) {
      throw new Error(`Missing render object: ${objectId}`);
    }

    return object;
  };

  return {
    id,
    kind: "memory",
    async boot(ctx: RendererBootContext) {
      view = createRendererView(id);
      width = ctx.width;
      height = ctx.height;
      onDiagnostic = ctx.onDiagnostic;
      ctx.container.append?.(view);
      onDiagnostic?.({
        type: "renderer.booted",
        payload: { rendererId: id, width, height },
        source: id
      });
    },
    destroy() {
      objects.clear();
      view?.remove();
      view = undefined;
      onDiagnostic?.({ type: "renderer.destroyed", payload: { rendererId: id }, source: id });
      onDiagnostic = undefined;
    },
    getView() {
      if (!view) {
        throw new Error("Renderer has not booted");
      }

      return view;
    },
    resize(nextWidth, nextHeight) {
      width = nextWidth;
      height = nextHeight;
      onDiagnostic?.({
        type: "renderer.resized",
        payload: { rendererId: id, width, height },
        source: id
      });
    },
    createObject(definition) {
      if (
        !SUPPORTED_OBJECT_TYPES.includes(definition.type as (typeof SUPPORTED_OBJECT_TYPES)[number])
      ) {
        throw new Error(`Unsupported render object type: ${definition.type}`);
      }

      const objectId = definition.id ?? `render-object-${nextId}`;
      nextId += 1;
      if (objects.has(objectId)) {
        throw new Error(`Duplicate render object: ${objectId}`);
      }

      objects.set(objectId, {
        ...definition,
        id: objectId,
        commands: [],
        nodes: createNodeMap(definition.children)
      });
      onDiagnostic?.({
        type: "renderer.object_created",
        payload: { rendererId: id, objectId, type: definition.type },
        source: id
      });
      return objectId;
    },
    destroyObject(objectId) {
      if (!objects.delete(objectId)) {
        throw new Error(`Missing render object: ${objectId}`);
      }
      onDiagnostic?.({
        type: "renderer.object_destroyed",
        payload: { rendererId: id, objectId },
        source: id
      });
    },
    native() {
      return {
        object: requireObject,
        node(objectId, nodePath) {
          return requireNode(requireObject(objectId), nodePath);
        }
      };
    },
    command(objectId, command) {
      const object = requireObject(objectId);
      if (command.type !== "animation.play") {
        throw new Error(`Unsupported render command: ${command.type}`);
      }

      objects.set(objectId, { ...object, commands: [...object.commands, command] });
    },
    getObjectHandle(objectId) {
      const object = requireObject(objectId);
      return {
        id: objectId,
        type: object.type,
        native: object,
        escaped: true
      };
    },
    getNodeHandle(objectId, nodePath) {
      const node = requireNode(requireObject(objectId), nodePath);
      return {
        id: objectId,
        type: node.type,
        native: node,
        escaped: true
      };
    },
    objects() {
      return [...objects.values()];
    }
  };
}

function createNodeMap(
  children: RenderObjectDefinition["children"] = [],
  prefix: string[] = []
): Map<string, MemoryRenderNode> {
  const nodes = new Map<string, MemoryRenderNode>();
  for (const child of children) {
    const nodeId = child.id ?? `${child.type}-${nodes.size}`;
    const nodePath = [...prefix, nodeId].join("/");
    const node: MemoryRenderNode = {
      id: nodeId,
      type: child.type
    };
    if (child.transform) {
      node.transform = child.transform;
    }
    if (child.visible !== undefined) {
      node.visible = child.visible;
    }
    if (child.alpha !== undefined) {
      node.alpha = child.alpha;
    }
    if (child.layer !== undefined) {
      node.layer = child.layer;
    }
    if (child.props) {
      node.props = child.props;
    }
    nodes.set(nodePath, node);

    for (const [path, node] of createNodeMap(child.children, [...prefix, nodeId])) {
      nodes.set(path, node);
    }
  }

  return nodes;
}

function resolveNodePath(nodePath: RenderNodePath): string {
  return Array.isArray(nodePath) ? nodePath.join("/") : nodePath;
}

function requireNode(object: MemoryRenderObject, nodePath: RenderNodePath): MemoryRenderNode {
  const path = resolveNodePath(nodePath);
  const node = object.nodes.get(path);
  if (!node) {
    throw new Error(`Missing render node: ${path}`);
  }

  return node;
}
