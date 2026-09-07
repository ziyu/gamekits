import { createAssetManager, type AssetDefinition, type AssetLoaderAdapter } from "@gamekits/asset";
import { createDataRegistry, type DataPack, type DataTypeDefinition } from "@gamekits/data";
import type { MultiplayerRuntime } from "@gamekits/multiplayer-core";
import type {
  RenderNodePath,
  RenderObjectDefinition,
  RenderObjectId,
  RendererAdapter,
  RendererBootContext
} from "@gamekits/renderer-core";
import type { SaveStore } from "@gamekits/save";
import { createConfiguredAppHost } from "../definition/create-configured-app-host";
import { defineGameApp } from "../definition/define-game-app";
import type { AppHost, AppServiceBinding, CreateAppHostOptions } from "../runtime/types";
import { createStandardAppProfile } from "../standard/create-standard-app-profile";

export type CreateHeadlessHostOptions = {
  id?: string;
  types?: Array<DataTypeDefinition> | undefined;
  dataPacks?: DataPack[] | undefined;
  preloadGroups?: string[] | undefined;
  saveStore?: SaveStore | undefined;
  multiplayer?: MultiplayerRuntime | undefined;
  devtools?: boolean | undefined;
  services?: Array<AppServiceBinding> | undefined;
  configSources?: CreateAppHostOptions["configSources"] | undefined;
};

export function createHeadlessHost(options: CreateHeadlessHostOptions = {}): AppHost {
  const data = createDataRegistry();
  const renderer = createHeadlessRenderer();
  const assets = createAssetManager({
    adapter: createMemoryAssetAdapter()
  });
  const extensionServices = options.services ?? [];
  const appId = options.id ?? "headless-host";
  const app = defineGameApp({
    id: appId,
    ...(options.configSources === undefined ? {} : { configSources: options.configSources }),
    services: [
      { id: "data" },
      { id: "renderer" },
      { id: "assets" },
      ...(options.multiplayer === undefined ? [] : [{ id: "multiplayer" }]),
      ...(options.saveStore === undefined ? [] : [{ id: "save", dependencies: ["data"] }]),
      ...(options.devtools === true ? [{ id: "devtools", dependencies: ["data", "assets"] }] : []),
      ...extensionServices.map((binding) => ({
        id: binding.key.id,
        dependencies: binding.lifecycle.dependencies
      }))
    ]
  });
  const profile = createStandardAppProfile({
    id: "headless",
    services: {
      data: {
        registry: data,
        types: () => options.types ?? [],
        dataPacks: () => options.dataPacks ?? []
      },
      renderer: {
        adapter: renderer
      },
      assets: {
        manager: assets,
        dataRegistry: () => data,
        preloadGroups: () => options.preloadGroups
      },
      ...(options.saveStore === undefined
        ? {}
        : {
            save: {
              store: options.saveStore,
              formatVersion: "1.0.0",
              appId,
              gameId: appId,
              gameVersion: "0.1.0"
            }
          }),
      ...(options.multiplayer === undefined
        ? {}
        : {
            multiplayer: {
              runtime: options.multiplayer
            }
          }),
      ...(options.devtools === true
        ? {
            devtools: true
          }
        : {})
    },
    extensions: Object.fromEntries(
      extensionServices.map((binding) => [binding.key.id, () => binding])
    )
  });

  return createConfiguredAppHost({
    app,
    profile,
    context: {}
  }).host;
}

export function createMemoryAssetAdapter(): AssetLoaderAdapter {
  return {
    id: "headless-asset-loader",
    supports() {
      return true;
    },
    async load(_asset: AssetDefinition) {
      return undefined;
    },
    unload() {}
  };
}

export function createHeadlessRenderer(): RendererAdapter {
  let nextId = 0;
  const objects = new Map<string, RenderObjectDefinition>();

  return {
    id: "headless-renderer",
    kind: "headless",
    async boot(_ctx: RendererBootContext) {
      return undefined;
    },
    destroy() {
      objects.clear();
    },
    getView() {
      return { dataset: { renderer: "headless" } } as unknown as HTMLElement;
    },
    resize() {
      return undefined;
    },
    createObject(definition) {
      const id = definition.id ?? `headless-object-${nextId}`;
      nextId += 1;
      objects.set(id, { ...definition, id });
      return id;
    },
    destroyObject(id: RenderObjectId) {
      objects.delete(id);
    },
    native() {
      return { objects };
    },
    command() {
      return undefined;
    },
    getObjectHandle(id) {
      const object = objects.get(id);
      if (!object) {
        throw new Error(`Missing render object: ${id}`);
      }
      return {
        id,
        type: object.type,
        native: object,
        escaped: true
      };
    },
    getNodeHandle(id: RenderObjectId, nodePath: RenderNodePath) {
      const object = objects.get(id);
      if (!object) {
        throw new Error(`Missing render object: ${id}`);
      }
      const node = findNode(object.children ?? [], nodePath);
      if (!node) {
        throw new Error(
          `Missing render node: ${Array.isArray(nodePath) ? nodePath.join("/") : nodePath}`
        );
      }
      return {
        id,
        type: node.type,
        native: node,
        escaped: true
      };
    }
  };
}

function findNode(
  children: NonNullable<RenderObjectDefinition["children"]>,
  nodePath: RenderNodePath
): NonNullable<RenderObjectDefinition["children"]>[number] | undefined {
  const [head, ...tail] = Array.isArray(nodePath) ? nodePath : nodePath.split("/");
  for (const child of children) {
    const childId = child.id ?? child.type;
    if (childId !== head) {
      continue;
    }
    if (tail.length === 0) {
      return child;
    }
    return findNode(child.children ?? [], tail);
  }
  return undefined;
}
