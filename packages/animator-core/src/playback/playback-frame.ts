import type { AssetRef } from "@gamekits/asset";
import type { RenderNodePath, RenderObjectId } from "@gamekits/renderer-core";
import type { AnimatorMarkerEvent } from "../marker/marker-event";

export type AnimationPlaybackLayerFrame = {
  layerId: string;
  stateId?: string | undefined;
  clipId: string;
  backendClip?: string | undefined;
  asset: AssetRef;
  kind: "state" | "one-shot" | "gameplay-phase";
  timeMs: number;
  normalizedTime: number;
  speed: number;
  loop: boolean;
  weight: number;
  mode: "replace" | "additive";
  target?: RenderNodePath | undefined;
  seek: boolean;
};

export type AnimationPlaybackFrame = {
  controllerId: string;
  renderObjectId: RenderObjectId;
  generation: number;
  timestamp: number;
  layers: AnimationPlaybackLayerFrame[];
  markers: AnimatorMarkerEvent[];
  reasons: string[];
};
