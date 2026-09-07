import { createAssetLifecycle } from "./lifecycle";
import type { DataRegistry } from "@gamekits/data";
import { createDuplicateAssetError, createMissingAssetError } from "./errors";
import { DEFAULT_ASSET_DATA_TYPE } from "./asset-data-type";
import type {
  AssetAnimationManifest,
  AssetDefinition,
  AssetDiagnosticEvent,
  AssetLoadState,
  AssetManager,
  CreateAssetManagerOptions,
  RegisterAssetsFromDataOptions
} from "./types";

export function createAssetManager(options: CreateAssetManagerOptions): AssetManager {
  const assets = new Map<string, AssetDefinition>();
  const states = new Map<string, AssetLoadState>();

  const emit = (
    type: string,
    assetId: string | undefined,
    payload: Record<string, unknown>
  ): void => {
    const event: Parameters<NonNullable<CreateAssetManagerOptions["onDiagnostic"]>>[0] = {
      type,
      payload: cloneRecord(payload),
      source: "asset.manager"
    };
    if (assetId) {
      event.assetId = assetId;
    }
    if (options.onDiagnostic === undefined) {
      return;
    }
    try {
      options.onDiagnostic(cloneDiagnostic(event));
    } catch (error) {
      try {
        options.onDiagnosticError?.(error, cloneDiagnostic(event));
      } catch {
        // Diagnostics cannot change asset registration or loading results.
      }
    }
  };

  const requireAsset = (assetId: string): AssetDefinition => {
    const asset = assets.get(assetId);
    if (!asset) {
      throw createMissingAssetError(assetId);
    }

    return asset;
  };

  const lifecycle = createAssetLifecycle(options, {
    get: (id) => cloneAssetDefinition(requireAsset(id)),
    assets: () => [...assets.values()].map(cloneAssetDefinition),
    states,
    emit
  });

  return {
    register(asset) {
      lifecycle.assertActive();
      if (assets.has(asset.id)) {
        throw createDuplicateAssetError(asset.id);
      }

      assets.set(asset.id, cloneAssetDefinition(asset));
      states.set(asset.id, { id: asset.id, status: "registered" });
      emit("asset.registered", asset.id, { assetId: asset.id, assetType: asset.type });
    },
    registerMany(nextAssets) {
      const ids = new Set<string>();
      for (const asset of nextAssets) {
        if (assets.has(asset.id) || ids.has(asset.id)) {
          throw createDuplicateAssetError(asset.id);
        }
        ids.add(asset.id);
      }
      for (const asset of nextAssets) {
        this.register(asset);
      }
    },
    registerFromDataRegistry(
      registry: DataRegistry,
      registerOptions: RegisterAssetsFromDataOptions = {}
    ) {
      const type = registerOptions.type ?? DEFAULT_ASSET_DATA_TYPE;
      const definitions = registry
        .list<AssetDefinition>(type)
        .map((document) => cloneAssetDefinition(document.data));
      this.registerMany(definitions);
      return definitions.map(cloneAssetDefinition);
    },
    has(id) {
      return assets.has(id);
    },
    get(id) {
      return cloneAssetDefinition(requireAsset(id));
    },
    assets() {
      return [...assets.values()].map(cloneAssetDefinition);
    },
    state(id) {
      const state = states.get(id);
      if (!state) {
        throw createMissingAssetError(id);
      }

      return { ...state };
    },
    states() {
      return [...states.values()].map((state) => ({ ...state }));
    },
    load: lifecycle.load,
    loadGroup: lifecycle.loadGroup,
    unload: lifecycle.unload,
    createScope: lifecycle.createScope,
    lifecycleSnapshot: lifecycle.lifecycleSnapshot,
    async dispose() {
      try {
        await lifecycle.dispose();
      } finally {
        assets.clear();
        states.clear();
      }
    }
  };
}

function cloneDiagnostic(event: AssetDiagnosticEvent): AssetDiagnosticEvent {
  return {
    type: event.type,
    payload: cloneRecord(event.payload),
    ...(event.assetId === undefined ? {} : { assetId: event.assetId }),
    ...(event.source === undefined ? {} : { source: event.source })
  };
}

function cloneAssetDefinition(asset: AssetDefinition): AssetDefinition {
  return {
    ...asset,
    source: cloneSource(asset.source),
    ...(asset.tags === undefined ? {} : { tags: [...asset.tags] }),
    ...(asset.metadata === undefined ? {} : { metadata: cloneRecord(asset.metadata) }),
    ...(asset.frame === undefined ? {} : { frame: { ...asset.frame } }),
    ...(asset.atlas === undefined
      ? {}
      : { atlas: { ...asset.atlas, dataSource: cloneSource(asset.atlas.dataSource) } }),
    ...(asset.audio === undefined
      ? {}
      : {
          audio: {
            ...asset.audio,
            ...(asset.audio.sources === undefined
              ? {}
              : { sources: asset.audio.sources.map(cloneSource) })
          }
        }),
    ...(asset.variants === undefined
      ? {}
      : {
          variants: Object.fromEntries(
            Object.entries(asset.variants).map(([id, variant]) => [
              id,
              {
                source: cloneSource(variant.source),
                ...(variant.metadata === undefined
                  ? {}
                  : { metadata: cloneRecord(variant.metadata) })
              }
            ])
          )
        }),
    ...(asset.animations === undefined
      ? {}
      : {
          animations: asset.animations.map((animation) => ({
            ...animation,
            frames: cloneAnimationFrames(animation.frames)
          }))
        })
  };
}

function cloneAnimationFrames(
  frames: AssetAnimationManifest["frames"]
): AssetAnimationManifest["frames"] {
  if (!Array.isArray(frames)) {
    return { ...frames };
  }
  return frames.every((frame): frame is number => typeof frame === "number")
    ? [...frames]
    : [...(frames as string[])];
}

function cloneSource(source: AssetDefinition["source"]): AssetDefinition["source"] {
  return source.type === "memory"
    ? { ...source, data: new Uint8Array(source.data) }
    : { ...source };
}

function cloneRecord(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, cloneValue(item)]));
}

function cloneValue<T>(value: T): T {
  if (value instanceof Uint8Array) {
    return new Uint8Array(value) as T;
  }
  if (Array.isArray(value)) {
    return value.map(cloneValue) as T;
  }
  if (value !== null && typeof value === "object") {
    return cloneRecord(value as Record<string, unknown>) as T;
  }
  return value;
}
