import type { AssetLoaderAdapter } from "@gamekits/asset";
import type { AnimationPlaybackAdapter } from "@gamekits/animator-core/playback";
import type { AudioBackend } from "@gamekits/audio-core/backend";
import type { DriverAdapterMap, GameDriver } from "@gamekits/driver-core";
import type { InputSourceAdapter, NormalizedInputEvent } from "@gamekits/input-core";
import type { RendererAdapter, RendererBootContext } from "@gamekits/renderer-core";
import type { PhaserRendererOptions } from "@gamekits/renderer-phaser";
import type { PhaserDriverCameraAdapter } from "./camera";

export type PhaserMipmapFilter =
  | "none"
  | "NEAREST"
  | "LINEAR"
  | "NEAREST_MIPMAP_NEAREST"
  | "LINEAR_MIPMAP_NEAREST"
  | "NEAREST_MIPMAP_LINEAR"
  | "LINEAR_MIPMAP_LINEAR";

export type PhaserDriverRenderOptions = {
  pixelRatio?: number;
  antialias?: boolean;
  antialiasGL?: boolean;
  roundPixels?: boolean;
  mipmapFilter?: PhaserMipmapFilter;
};

export type PhaserDriverOptions = {
  id?: string;
  backgroundColor?: string;
  render?: PhaserDriverRenderOptions;
  renderer?: Omit<PhaserRendererOptions, "id" | "runtime">;
};

export type PhaserInputSourceOptions = {
  onInput: (event: NormalizedInputEvent) => void;
  source?: string;
  clock?: () => number;
};

export type PhaserDriverAdapters = DriverAdapterMap & {
  renderer: RendererAdapter;
  assetLoader: AssetLoaderAdapter;
  camera: PhaserDriverCameraAdapter;
  animation: AnimationPlaybackAdapter;
  audio: AudioBackend;
  createInputSource(options: PhaserInputSourceOptions): InputSourceAdapter;
};

export type PhaserGameDriver = GameDriver<PhaserDriverAdapters> & {
  boot(ctx: RendererBootContext): Promise<void>;
};
