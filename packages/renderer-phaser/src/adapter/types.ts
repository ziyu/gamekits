import type { RenderNodePath, RenderObjectId } from "@gamekits/renderer-core";
import type { PhaserRenderTargetState } from "./target-state";

export type PhaserRenderStateWrite = {
  objectId: RenderObjectId;
  nodePath?: RenderNodePath | undefined;
  state: PhaserRenderTargetState;
};

export type PhaserRendererOptions = {
  id?: string;
  debugTextureId?: string;
  runtime: PhaserRendererRuntime | (() => PhaserRendererRuntime | undefined);
};

export type PhaserRendererRuntime = {
  view: HTMLElement | HTMLCanvasElement;
  scene: unknown;
  resize?(width: number, height: number): void;
};

export type PhaserRendererNative<TScene = unknown, TObject = unknown> = Omit<
  PhaserRendererRuntime,
  "scene"
> & {
  scene: TScene;
  gameObject(id: RenderObjectId): TObject;
  node(objectId: RenderObjectId, nodePath: RenderNodePath): TObject;
  applyObjectState(id: RenderObjectId, state: PhaserRenderTargetState): void;
  applyNodeState(
    objectId: RenderObjectId,
    nodePath: RenderNodePath,
    state: PhaserRenderTargetState
  ): void;
  applyTargetState(target: TObject, state: PhaserRenderTargetState): void;
  applyBatch(writes: PhaserRenderStateWrite[]): void;
};
