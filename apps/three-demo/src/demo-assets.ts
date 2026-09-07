import { createAssetDataType, type AssetDefinition } from "@gamekits/asset";
import {
  createDataRegistry,
  type DataPack,
  type DataPackEntry,
  type DataRegistry
} from "@gamekits/data";

export const THREE_DEMO_ASSET_GROUP = "three-demo.remote";

export const THREE_DEMO_ASSET_IDS = {
  robot: "asset.three.robot",
  tokyo: "asset.three.tokyo",
  flamingo: "asset.three.flamingo",
  uvTexture: "asset.three.texture.uv",
  brickTexture: "asset.three.texture.brick",
  woodTexture: "asset.three.texture.wood"
} as const;

export const THREE_DEMO_MODEL_ASSET_IDS = [
  THREE_DEMO_ASSET_IDS.robot,
  THREE_DEMO_ASSET_IDS.tokyo,
  THREE_DEMO_ASSET_IDS.flamingo
] as const;

export const THREE_DEMO_TEXTURE_ASSET_IDS = [
  THREE_DEMO_ASSET_IDS.uvTexture,
  THREE_DEMO_ASSET_IDS.brickTexture,
  THREE_DEMO_ASSET_IDS.woodTexture
] as const;

export const THREE_DEMO_BOOT_ASSET_IDS = [
  THREE_DEMO_ASSET_IDS.robot,
  THREE_DEMO_ASSET_IDS.flamingo,
  THREE_DEMO_ASSET_IDS.uvTexture,
  THREE_DEMO_ASSET_IDS.brickTexture,
  THREE_DEMO_ASSET_IDS.woodTexture
] as const;

const THREE_R181_CDN_EXAMPLES = "https://cdn.jsdelivr.net/gh/mrdoob/three.js@r181/examples";

const assetDefinitions: AssetDefinition[] = [
  {
    id: THREE_DEMO_ASSET_IDS.robot,
    type: "model",
    source: {
      type: "url",
      url: `${THREE_R181_CDN_EXAMPLES}/models/gltf/RobotExpressive/RobotExpressive.glb`
    },
    group: THREE_DEMO_ASSET_GROUP,
    tags: ["three-demo", "remote", "model", "animated"],
    metadata: {
      label: "Robot Expressive",
      clipHints: ["Idle", "Walking", "Running", "Dance"]
    }
  },
  {
    id: THREE_DEMO_ASSET_IDS.tokyo,
    type: "model",
    source: {
      type: "url",
      url: `${THREE_R181_CDN_EXAMPLES}/models/gltf/LittlestTokyo.glb`
    },
    group: THREE_DEMO_ASSET_GROUP,
    lazy: true,
    tags: ["three-demo", "remote", "model", "environment"],
    metadata: {
      label: "Littlest Tokyo"
    }
  },
  {
    id: THREE_DEMO_ASSET_IDS.flamingo,
    type: "model",
    source: {
      type: "url",
      url: `${THREE_R181_CDN_EXAMPLES}/models/gltf/Flamingo.glb`
    },
    group: THREE_DEMO_ASSET_GROUP,
    tags: ["three-demo", "remote", "model", "animated"],
    metadata: {
      label: "Flamingo"
    }
  },
  {
    id: THREE_DEMO_ASSET_IDS.uvTexture,
    type: "texture",
    source: {
      type: "url",
      url: "https://threejs.org/examples/textures/uv_grid_opengl.jpg"
    },
    group: THREE_DEMO_ASSET_GROUP,
    tags: ["three-demo", "remote", "texture", "debug"]
  },
  {
    id: THREE_DEMO_ASSET_IDS.brickTexture,
    type: "texture",
    source: {
      type: "url",
      url: "https://threejs.org/examples/textures/brick_diffuse.jpg"
    },
    group: THREE_DEMO_ASSET_GROUP,
    tags: ["three-demo", "remote", "texture", "material"]
  },
  {
    id: THREE_DEMO_ASSET_IDS.woodTexture,
    type: "texture",
    source: {
      type: "url",
      url: "https://threejs.org/examples/textures/hardwood2_diffuse.jpg"
    },
    group: THREE_DEMO_ASSET_GROUP,
    tags: ["three-demo", "remote", "texture", "material"]
  }
];

export const threeDemoAssetPack: DataPack = {
  id: "three-demo.assets",
  version: "1.0.0",
  namespace: "three-demo",
  entries: assetDefinitions.map<DataPackEntry>((asset) => ({
    type: "asset.definition",
    id: asset.id,
    data: asset
  }))
};

export function createThreeDemoDataRegistry(): DataRegistry {
  const registry = createDataRegistry();
  registry.registerType(createAssetDataType({ supportedTypes: ["model", "texture"] }));
  registry.registerPack(threeDemoAssetPack);
  return registry;
}

export function listThreeDemoAssetDefinitions(): AssetDefinition[] {
  return [...assetDefinitions];
}
