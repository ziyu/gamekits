import type { RenderObjectId } from "@gamekits/renderer-core";
import type { AnimatorBindingDefinition } from "../graph/binding-definition";
import type { AnimationPlaybackFrame } from "./playback-frame";

export type AnimationPlaybackAdapterSnapshot = {
  id: string;
  boundControllers: number;
  retainedFrames: number;
  appliedFrames: number;
  disposed?: boolean | undefined;
  details?: Record<string, unknown> | undefined;
};

export type AnimationPlaybackAdapter = {
  id: string;
  bind(
    controllerId: string,
    binding: AnimatorBindingDefinition,
    renderObjectId: RenderObjectId
  ): void;
  apply(controllerId: string, frame: AnimationPlaybackFrame): void;
  applyBatch?(frames: AnimationPlaybackFrame[]): void;
  reset?(controllerId: string, generation: number): void;
  unbind(controllerId: string): void;
  snapshot(): AnimationPlaybackAdapterSnapshot;
  dispose?(): void;
};
