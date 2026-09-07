import type { AssetDefinition } from "@gamekits/asset";

export const OUTPOST_FEEDBACK_ASSET_IDS = {
  crosshair: "asset.outpost.feedback.crosshair",
  tracer: "asset.outpost.feedback.tracer",
  impact: "asset.outpost.feedback.impact",
  damageDirection: "asset.outpost.feedback.damage-direction"
} as const;

export type OutpostRuntimeFeedbackAsset = {
  id: (typeof OUTPOST_FEEDBACK_ASSET_IDS)[keyof typeof OUTPOST_FEEDBACK_ASSET_IDS];
  authoringSource: string;
  runtimeUrl: string;
  runtimeFormat: "webp";
  width: number;
  height: number;
};

export const outpostRuntimeFeedbackAssets: readonly OutpostRuntimeFeedbackAsset[] = [
  feedbackAsset("crosshair", 128, 128),
  feedbackAsset("tracer", 256, 32),
  feedbackAsset("impact", 128, 128),
  feedbackAsset("damageDirection", 128, 64)
];

export const outpostFeedbackAssetDefinitions: AssetDefinition[] = outpostRuntimeFeedbackAssets.map(
  (asset) => ({
    id: asset.id,
    type: "image",
    source: { type: "url", url: asset.runtimeUrl },
    group: "combat",
    preload: true,
    tags: ["outpost", "feedback", "combat", "svg"],
    metadata: {
      authoringSource: asset.authoringSource,
      width: asset.width,
      height: asset.height
    }
  })
);

function feedbackAsset(
  key: keyof typeof OUTPOST_FEEDBACK_ASSET_IDS,
  width: number,
  height: number
): OutpostRuntimeFeedbackAsset {
  const fileName = key === "damageDirection" ? "damage-direction" : key;
  return {
    id: OUTPOST_FEEDBACK_ASSET_IDS[key],
    authoringSource: `assets-src/outpost/feedback/${fileName}.svg`,
    runtimeUrl: `/assets/outpost/feedback/${fileName}.webp`,
    runtimeFormat: "webp",
    width,
    height
  };
}
