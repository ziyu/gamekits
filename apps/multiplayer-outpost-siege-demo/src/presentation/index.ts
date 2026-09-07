import type { RenderObjectId } from "@gamekits/renderer-core";

export * from "./client-presentation-module";
export * from "./audio-content";
export * from "./combat";
export * from "./player-render-object";
export * from "./player";
export * from "./preview-presentation-module";
export * from "./render-rotation";

export type OutpostPresentationBinding = {
  gameplayObjectId: string;
  renderObjectId: RenderObjectId;
};
