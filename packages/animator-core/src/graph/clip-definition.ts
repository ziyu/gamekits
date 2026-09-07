import type { AssetRef } from "@gamekits/asset";

export type AnimationClipMarkerDefinition = {
  id: string;
  timeMs: number;
  tags?: string[] | undefined;
};

export type AnimationClipDefinition = {
  id: string;
  asset: AssetRef;
  backendClip?: string | undefined;
  durationMs: number;
  loop?: boolean | undefined;
  markers?: AnimationClipMarkerDefinition[] | undefined;
  tags?: string[] | undefined;
};
