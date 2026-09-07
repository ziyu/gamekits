import type { AssetAnimationManifest, AssetDefinition, AssetLoaderAdapter } from "@gamekits/asset";
import { GameError } from "@gamekits/core";

export type PhaserDriverAssetRuntime = {
  hasTexture(id: string): boolean;
  loadImage(assetId: string, url: string): Promise<void>;
  loadSpritesheet(
    assetId: string,
    url: string,
    frame: { width: number; height: number; margin?: number; spacing?: number }
  ): Promise<void>;
  loadAtlas(
    assetId: string,
    textureUrl: string,
    dataUrl: string,
    format: "json-array" | "json-hash"
  ): Promise<void>;
  hasAudio(id: string): boolean;
  loadAudio(assetId: string, urls: string[]): Promise<void>;
  createAnimations(textureId: string, animations: AssetAnimationManifest[]): void;
  unloadAsset(assetId: string, type: AssetDefinition["type"]): void;
};

export function createPhaserDriverAssetLoader(options: {
  id: string;
  runtime: () => PhaserDriverAssetRuntime;
}): AssetLoaderAdapter {
  return {
    id: options.id,
    supports(asset) {
      if (asset.source.type !== "url") {
        return false;
      }
      if (asset.type === "image" || asset.type === "spritesheet") {
        return true;
      }
      if (asset.type === "atlas") {
        return asset.atlas?.dataSource.type === "url";
      }
      if (asset.type === "audio") {
        return (asset.audio?.sources ?? [asset.source]).every((source) => source.type === "url");
      }
      return false;
    },
    async load(asset, loadOptions) {
      loadOptions?.signal?.throwIfAborted();
      const runtime = options.runtime();
      const finish = () => {
        if (loadOptions?.signal?.aborted) {
          runtime.unloadAsset(asset.id, asset.type);
          loadOptions.signal.throwIfAborted();
        }
      };
      if (asset.source.type !== "url") {
        throw unsupported(asset);
      }
      if (asset.type === "image") {
        if (!runtime.hasTexture(asset.id)) {
          await runtime.loadImage(asset.id, asset.source.url);
        }
        return finish();
      }

      if (asset.type === "spritesheet") {
        if (!asset.frame) {
          throw new GameError(
            "asset.phaser.missing_spritesheet_frame",
            `Spritesheet asset requires frame config: ${asset.id}`,
            { assetId: asset.id }
          );
        }
        if (!runtime.hasTexture(asset.id)) {
          await runtime.loadSpritesheet(asset.id, asset.source.url, asset.frame);
        }
        if (asset.animations && asset.animations.length > 0) {
          runtime.createAnimations(asset.id, asset.animations);
        }
        return finish();
      }

      if (asset.type === "atlas") {
        const dataSource = asset.atlas?.dataSource;
        if (dataSource?.type !== "url") {
          throw unsupported(asset);
        }
        if (!runtime.hasTexture(asset.id)) {
          await runtime.loadAtlas(
            asset.id,
            asset.source.url,
            dataSource.url,
            asset.atlas?.format ?? "json-hash"
          );
        }
        if (asset.animations && asset.animations.length > 0) {
          runtime.createAnimations(asset.id, asset.animations);
        }
        return finish();
      }

      if (asset.type === "audio") {
        const sources = asset.audio?.sources ?? [asset.source];
        const urls = sources.flatMap((source) => (source.type === "url" ? [source.url] : []));
        if (urls.length !== sources.length) {
          throw unsupported(asset);
        }
        if (!runtime.hasAudio(asset.id)) {
          await runtime.loadAudio(asset.id, urls);
        }
        return finish();
      }

      throw unsupported(asset);
    },
    unload(asset) {
      options.runtime().unloadAsset(asset.id, asset.type);
    }
  };
}

function unsupported(asset: AssetDefinition): GameError {
  return new GameError("asset.phaser.unsupported", `Unsupported Phaser asset: ${asset.id}`, {
    assetId: asset.id,
    assetType: asset.type,
    sourceType: asset.source.type
  });
}
