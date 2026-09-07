import type { AssetManager } from "@gamekits/asset";
import type { GameAudio } from "@gamekits/audio-core";
import type { DataRegistry } from "@gamekits/data";
import type { DevToolsRuntime } from "@gamekits/devtools";
import type { DriverRegistry } from "@gamekits/driver-core";
import type { GameRuntime } from "@gamekits/game-runtime";
import type { InputRouter } from "@gamekits/input-core";
import type { MultiplayerRuntime } from "@gamekits/multiplayer-core";
import type { PlatformRuntime } from "@gamekits/platform-core";
import type { RendererAdapter } from "@gamekits/renderer-core";
import type { SaveManager } from "@gamekits/save";
import type { UiRuntime } from "@gamekits/ui-core";
import type { AppServiceKey } from "./types";

export const PLATFORM_SERVICE: AppServiceKey<PlatformRuntime> = {
  id: "platform",
  description: "Platform runtime"
};

export const DRIVER_SERVICE: AppServiceKey<DriverRegistry> = {
  id: "drivers",
  description: "Driver registry"
};

export const DATA_SERVICE: AppServiceKey<DataRegistry> = {
  id: "data",
  description: "Data registry"
};

export const ASSET_SERVICE: AppServiceKey<AssetManager> = {
  id: "assets",
  description: "Asset manager"
};

export const AUDIO_SERVICE: AppServiceKey<GameAudio> = {
  id: "audio",
  description: "Game audio"
};

export const RENDERER_SERVICE: AppServiceKey<RendererAdapter> = {
  id: "renderer",
  description: "Renderer adapter"
};

export const INPUT_SERVICE: AppServiceKey<InputRouter> = {
  id: "input",
  description: "Input router"
};

export const MULTIPLAYER_SERVICE: AppServiceKey<MultiplayerRuntime> = {
  id: "multiplayer",
  description: "Multiplayer runtime"
};

export const GAME_SERVICE: AppServiceKey<GameRuntime> = {
  id: "game",
  description: "Game runtime"
};

export const UI_SERVICE: AppServiceKey<UiRuntime> = {
  id: "ui",
  description: "UI runtime"
};

export const SAVE_SERVICE: AppServiceKey<SaveManager> = {
  id: "save",
  description: "Save manager"
};

export const DEVTOOLS_SERVICE: AppServiceKey<DevToolsRuntime> = {
  id: "devtools",
  description: "DevTools runtime"
};
