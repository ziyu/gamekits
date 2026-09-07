import { DEFAULT_ASSET_DATA_TYPE } from "@gamekits/asset";
import type { DataTypeDefinition } from "@gamekits/data";
import type { AnimationClipDefinition } from "./clip-definition";
import {
  animatorDataDiagnostic,
  isAnimatorNonEmptyString,
  isAnimatorNonNegativeFinite,
  isAnimatorPositiveFinite,
  validateAnimatorDefinitionId
} from "./content-validation";
import { ANIMATION_CLIP_TYPE } from "./data-type-contract";

export function createAnimationClipDataType(): DataTypeDefinition<AnimationClipDefinition> {
  return {
    type: ANIMATION_CLIP_TYPE,
    getTags: (clip) => clip.tags ?? [],
    validate(document) {
      const diagnostics = validateAnimatorDefinitionId(document, "animator.clip_missing_id");
      if (!isAnimatorPositiveFinite(document.data.durationMs)) {
        diagnostics.push(
          animatorDataDiagnostic(
            "animator.clip_invalid_duration",
            "Animation clip durationMs must be positive and finite",
            document,
            "durationMs"
          )
        );
      }
      if (!isAnimatorNonEmptyString(document.data.asset?.assetId)) {
        diagnostics.push(
          animatorDataDiagnostic(
            "animator.clip_missing_asset",
            "Animation clip requires an asset reference",
            document,
            "asset.assetId"
          )
        );
      }
      const markerIds = new Set<string>();
      let previousTime = -1;
      for (const [index, marker] of (document.data.markers ?? []).entries()) {
        if (!isAnimatorNonEmptyString(marker.id) || markerIds.has(marker.id)) {
          diagnostics.push(
            animatorDataDiagnostic(
              markerIds.has(marker.id)
                ? "animator.clip_duplicate_marker"
                : "animator.clip_marker_missing_id",
              "Animation clip markers require unique ids",
              document,
              `markers[${index}].id`
            )
          );
        }
        if (
          !isAnimatorNonNegativeFinite(marker.timeMs) ||
          marker.timeMs > document.data.durationMs ||
          marker.timeMs < previousTime
        ) {
          diagnostics.push(
            animatorDataDiagnostic(
              "animator.clip_invalid_marker_time",
              "Animation clip markers must be sorted within the clip duration",
              document,
              `markers[${index}].timeMs`
            )
          );
        }
        markerIds.add(marker.id);
        previousTime = marker.timeMs;
      }
      return diagnostics;
    },
    references(document) {
      return isAnimatorNonEmptyString(document.data.asset?.assetId)
        ? [
            {
              type: DEFAULT_ASSET_DATA_TYPE,
              id: document.data.asset.assetId,
              path: "asset.assetId"
            }
          ]
        : [];
    }
  };
}
