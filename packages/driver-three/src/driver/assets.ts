import type { AssetDefinition, AssetLoaderAdapter } from "@gamekits/asset";
import { GameError } from "@gamekits/core";
import type { ThreeDriverRuntime } from "./runtime";

export function createThreeDriverAssetLoader(options: {
  id: string;
  runtime: () => ThreeDriverRuntime;
}): AssetLoaderAdapter {
  return {
    id: options.id,
    supports(asset) {
      return asset.source.type === "url" && (asset.type === "model" || asset.type === "texture");
    },
    async load(asset, loadOptions) {
      loadOptions?.signal?.throwIfAborted();
      if (asset.source.type !== "url") {
        throw unsupported(asset);
      }

      const runtime = options.runtime();
      if (asset.type === "texture") {
        await runtime.resources.loadTexture(asset.id, asset.source.url, loadOptions?.signal);
        return;
      }
      if (asset.type === "model") {
        await runtime.resources.loadModel(asset.id, asset.source.url, loadOptions?.signal);
        return;
      }

      throw unsupported(asset);
    },
    unload(asset) {
      options.runtime().resources.unload(asset.id);
    }
  };
}

function unsupported(asset: AssetDefinition): GameError {
  return new GameError("asset.three.unsupported", `Unsupported Three asset: ${asset.id}`, {
    assetId: asset.id,
    assetType: asset.type,
    sourceType: asset.source.type
  });
}
