import { GameError } from "@gamekits/core";
import type { AssetDefinition } from "./types";

export function createDuplicateAssetError(assetId: string): GameError {
  return new GameError("asset.duplicate", `Duplicate asset: ${assetId}`, { assetId });
}

export function createMissingAssetError(assetId: string): GameError {
  return new GameError("asset.missing", `Missing asset: ${assetId}`, { assetId });
}

export function createUnsupportedAssetError(asset: AssetDefinition, adapterId: string): GameError {
  return new GameError(
    "asset.unsupported",
    `Asset adapter ${adapterId} does not support asset: ${asset.id}`,
    {
      assetId: asset.id,
      assetType: asset.type,
      sourceType: asset.source.type,
      adapterId
    }
  );
}
