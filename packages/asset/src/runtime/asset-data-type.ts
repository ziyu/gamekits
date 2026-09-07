import type { DataTypeDefinition } from "@gamekits/data";
import type { AssetAnimationManifest, AssetDefinition, AssetSource, AssetType } from "./types";

export type AssetDataTypeOptions = {
  type?: string;
  supportedTypes?: AssetType[];
  supportedSources?: AssetSource["type"][];
};

export const DEFAULT_ASSET_DATA_TYPE = "asset.definition";

export function createAssetDataType(
  options: AssetDataTypeOptions = {}
): DataTypeDefinition<AssetDefinition> {
  const type = options.type ?? DEFAULT_ASSET_DATA_TYPE;
  const supportedTypes = new Set(
    options.supportedTypes ?? [
      "image",
      "spritesheet",
      "atlas",
      "audio",
      "json",
      "tilemap",
      "font",
      "shader",
      "model",
      "texture",
      "custom"
    ]
  );
  const supportedSources = new Set(
    options.supportedSources ?? ["url", "platform-file", "resource", "memory"]
  );

  return {
    type,
    getTags: (asset) => asset.tags ?? [],
    getMetadata: (asset) => asset.metadata,
    validate(document) {
      const diagnostics = [];
      const asset = document.data;
      if (
        asset.estimatedBytes !== undefined &&
        (!Number.isSafeInteger(asset.estimatedBytes) || asset.estimatedBytes < 0)
      ) {
        diagnostics.push({
          code: "asset.invalid_size",
          message: "estimatedBytes must be a nonnegative safe integer",
          severity: "error" as const,
          key: document
        });
      }

      if (!supportedTypes.has(asset.type)) {
        diagnostics.push({
          code: "asset.unknown_type",
          message: `Unknown asset type: ${asset.type}`,
          severity: "error" as const,
          key: document
        });
      }

      if (asset.source === undefined || !supportedSources.has(asset.source.type)) {
        diagnostics.push({
          code: "asset.unsupported_source",
          message: `Unsupported asset source: ${asset.source?.type ?? "missing"}`,
          severity: "error" as const,
          key: document
        });
      }

      if (asset.type === "spritesheet" && !asset.frame) {
        diagnostics.push({
          code: "asset.missing_spritesheet_frame",
          message: `Spritesheet asset requires frame config: ${asset.id}`,
          severity: "error" as const,
          key: document
        });
      }

      diagnostics.push(...validateSource(asset.source, document, "source"));

      if (asset.frame) {
        if (
          !positiveInteger(asset.frame.width) ||
          !positiveInteger(asset.frame.height) ||
          (asset.frame.margin !== undefined && !nonNegativeInteger(asset.frame.margin)) ||
          (asset.frame.spacing !== undefined && !nonNegativeInteger(asset.frame.spacing))
        ) {
          diagnostics.push({
            code: "asset.invalid_spritesheet_frame",
            message: `Spritesheet frame config is invalid: ${asset.id}`,
            severity: "error" as const,
            key: document,
            path: "frame"
          });
        }
      }

      if (asset.type === "atlas") {
        if (!asset.atlas) {
          diagnostics.push({
            code: "asset.missing_atlas_metadata",
            message: `Atlas asset requires atlas metadata: ${asset.id}`,
            severity: "error" as const,
            key: document,
            path: "atlas"
          });
        } else {
          diagnostics.push(...validateSource(asset.atlas.dataSource, document, "atlas.dataSource"));
        }
      }

      if (asset.type === "audio") {
        const sources = asset.audio?.sources ?? (asset.source === undefined ? [] : [asset.source]);
        if (sources.length === 0) {
          diagnostics.push({
            code: "asset.missing_audio_source",
            message: `Audio asset requires at least one source: ${asset.id}`,
            severity: "error" as const,
            key: document,
            path: "audio.sources"
          });
        }
        const seenSources = new Set<string>();
        for (const [index, source] of sources.entries()) {
          diagnostics.push(...validateSource(source, document, `audio.sources[${index}]`));
          const key = sourceKey(source);
          if (seenSources.has(key)) {
            diagnostics.push({
              code: "asset.duplicate_audio_source",
              message: `Audio asset sources must be unique: ${asset.id}`,
              severity: "error" as const,
              key: document,
              path: `audio.sources[${index}]`
            });
          }
          seenSources.add(key);
        }
        if (asset.audio?.instances !== undefined && !positiveInteger(asset.audio.instances)) {
          diagnostics.push({
            code: "asset.invalid_audio_instances",
            message: `Audio asset instances must be a positive integer: ${asset.id}`,
            severity: "error" as const,
            key: document,
            path: "audio.instances"
          });
        }
      }

      for (const [variant, definition] of Object.entries(asset.variants ?? {})) {
        if (!variant.trim()) {
          diagnostics.push({
            code: "asset.invalid_variant",
            message: `Asset variant names must be non-empty: ${asset.id}`,
            severity: "error" as const,
            key: document,
            path: "variants"
          });
        }
        diagnostics.push(
          ...validateSource(definition?.source, document, `variants.${variant}.source`)
        );
      }

      const animationIds = new Set<string>();
      for (const [index, animation] of (asset.animations ?? []).entries()) {
        if (!animation.id || animationIds.has(animation.id) || !validFrames(animation.frames)) {
          diagnostics.push({
            code: "asset.invalid_animation_manifest",
            message: `Asset animation manifests require unique ids and valid frames: ${asset.id}`,
            severity: "error" as const,
            key: document,
            path: `animations[${index}]`
          });
        }
        if (
          animation.frameRate !== undefined &&
          (!Number.isFinite(animation.frameRate) || animation.frameRate <= 0)
        ) {
          diagnostics.push({
            code: "asset.invalid_animation_frame_rate",
            message: `Asset animation frameRate must be positive: ${asset.id}`,
            severity: "error" as const,
            key: document,
            path: `animations[${index}].frameRate`
          });
        }
        if (
          animation.durationMs !== undefined &&
          (!Number.isFinite(animation.durationMs) || animation.durationMs <= 0)
        ) {
          diagnostics.push({
            code: "asset.invalid_animation_duration",
            message: `Asset animation durationMs must be positive: ${asset.id}`,
            severity: "error" as const,
            key: document,
            path: `animations[${index}].durationMs`
          });
        }
        if (
          animation.repeat !== undefined &&
          (!Number.isSafeInteger(animation.repeat) || animation.repeat < -1)
        ) {
          diagnostics.push({
            code: "asset.invalid_animation_repeat",
            message: `Asset animation repeat must be -1 or a non-negative integer: ${asset.id}`,
            severity: "error" as const,
            key: document,
            path: `animations[${index}].repeat`
          });
        }
        animationIds.add(animation.id);
      }

      return diagnostics;
    }
  };
}

function validateSource(
  source: AssetSource | undefined,
  document: Parameters<NonNullable<DataTypeDefinition<AssetDefinition>["validate"]>>[0],
  path: string
) {
  const value = sourceValue(source);
  return value.length > 0
    ? []
    : [
        {
          code: "asset.invalid_source",
          message: `Asset source must not be empty: ${document.data.id}`,
          severity: "error" as const,
          key: document,
          path
        }
      ];
}

function sourceValue(source: AssetSource | undefined): string {
  if (source === undefined) {
    return "";
  }
  switch (source.type) {
    case "url":
      return source.url.trim();
    case "platform-file":
    case "resource":
      return source.path.trim();
    case "memory":
      return source.data.byteLength > 0 ? "memory" : "";
  }
}

function sourceKey(source: AssetSource): string {
  return `${source.type}:${sourceValue(source)}`;
}

function positiveInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

function nonNegativeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

function validFrames(frames: AssetAnimationManifest["frames"] | undefined): boolean {
  if (frames === undefined) {
    return false;
  }
  if (Array.isArray(frames)) {
    return (
      frames.length > 0 &&
      frames.every((frame) =>
        typeof frame === "number" ? Number.isSafeInteger(frame) && frame >= 0 : frame.length > 0
      )
    );
  }
  return (
    Number.isSafeInteger(frames.start) &&
    Number.isSafeInteger(frames.end) &&
    frames.start >= 0 &&
    frames.end >= frames.start &&
    (frames.zeroPad === undefined || nonNegativeInteger(frames.zeroPad))
  );
}
