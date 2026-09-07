import type { AssetLoaderAdapter } from "@gamekits/asset";
import type { CameraState2D, PointLike } from "@gamekits/camera-core";
import type { DriverAdapterMap, GameDriver } from "@gamekits/driver-core";
import type {
  RenderNodePath,
  RenderObjectId,
  RendererAdapter,
  RendererBootContext
} from "@gamekits/renderer-core";
import type { Camera, Object3D, Scene, WebGLRenderer } from "three";
import type { ThreeRendererOptions } from "./create-three-renderer";
import type { ThreeDriverRuntime, ThreeDriverRuntimeOptions } from "./runtime";
import type { ThreeRenderTargetState } from "./target-state";

export type ThreeDriverOptions = {
  id?: string;
  backgroundColor?: string | number;
  clearAlpha?: number;
  renderer?: Omit<ThreeRendererOptions, "id" | "runtime">;
  runtime?: ThreeDriverRuntime | (() => ThreeDriverRuntime | undefined);
  runtimeOptions?: Partial<ThreeDriverRuntimeOptions>;
};

export type ThreeDriverCameraAdapter = {
  applyCameraState(state: CameraState2D): void;
  getState(): CameraState2D | undefined;
  worldToScreen(point: PointLike): PointLike;
  screenToWorld(point: PointLike): PointLike;
};

export type ThreeVector3Summary = {
  x: number;
  y: number;
  z: number;
};

export type ThreeRenderTargetDiagnostics = {
  type: string;
  name?: string | undefined;
  visible: boolean;
  assetId?: string | undefined;
  assetBacked: boolean;
  nodeCount: number;
  meshCount: number;
  skinnedMeshCount: number;
  visibleMeshCount: number;
  frustumCulledMeshCount: number;
  materialCount: number;
  invisibleMaterialCount: number;
  transparentMaterialCount: number;
  wireframeMaterialCount: number;
  minOpacity?: number | undefined;
  maxOpacity?: number | undefined;
  childCount: number;
  clipNames: string[];
  bounds?: {
    min: ThreeVector3Summary;
    max: ThreeVector3Summary;
    center: ThreeVector3Summary;
    size: ThreeVector3Summary;
  };
};

export type ThreeNativeObject = Object3D;
export type ThreeNativeScene = Scene;
export type ThreeNativeCamera = Camera;
export type ThreeNativeRenderer = WebGLRenderer;

export type ThreeRendererNative<TScene = ThreeNativeScene, TObject = ThreeNativeObject> = Omit<
  ThreeDriverRuntime,
  "scene" | "camera" | "renderer"
> & {
  scene: TScene;
  camera: ThreeNativeCamera;
  renderer?: ThreeNativeRenderer | undefined;
  object(id: RenderObjectId): TObject;
  node(objectId: RenderObjectId, nodePath: RenderNodePath): TObject;
  inspectObject(id: RenderObjectId): ThreeRenderTargetDiagnostics;
  inspectNode(objectId: RenderObjectId, nodePath: RenderNodePath): ThreeRenderTargetDiagnostics;
  applyObjectState(id: RenderObjectId, state: ThreeRenderTargetState): void;
  applyNodeState(
    objectId: RenderObjectId,
    nodePath: RenderNodePath,
    state: ThreeRenderTargetState
  ): void;
  applyTargetState(target: TObject, state: ThreeRenderTargetState): void;
};

export type ThreeRendererAdapter = RendererAdapter<ThreeRendererNative, ThreeNativeObject>;

export type ThreeDriverAdapters = DriverAdapterMap & {
  renderer: ThreeRendererAdapter;
  assetLoader: AssetLoaderAdapter;
  camera: ThreeDriverCameraAdapter;
};

export type ThreeGameDriver = GameDriver<ThreeDriverAdapters> & {
  boot(ctx: RendererBootContext): Promise<void>;
};
