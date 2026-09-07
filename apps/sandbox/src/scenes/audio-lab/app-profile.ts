import { createAssetManager, type AssetManager } from "@gamekits/asset";
import type { GameAudio } from "@gamekits/audio-core";
import { createStandardAppProfile, type AppProfile } from "@gamekits/app-host";
import type { DriverRegistry } from "@gamekits/driver-core";
import { createPhaserDriver } from "@gamekits/driver-phaser";
import { AUDIO_LAB_AUDIO_CONFIG } from "./audio-catalog";
import { AUDIO_LAB_ASSET_GROUP, type AudioLabAssetBundle } from "./audio-assets";

const AUDIO_LAB_DRIVER_ID = "sandbox.audio-lab.phaser";

export type AudioLabAppContext = {
  driverRoot: HTMLElement;
  audio?: GameAudio | undefined;
  assets?: AssetManager | undefined;
  drivers?: DriverRegistry | undefined;
};

export function createAudioLabWebProfile(
  bundle: AudioLabAssetBundle
): AppProfile<AudioLabAppContext> {
  const driver = createPhaserDriver({
    id: AUDIO_LAB_DRIVER_ID,
    backgroundColor: "#090d0e",
    render: { pixelRatio: 1, antialias: true, roundPixels: true }
  });
  const assets = createAssetManager({ adapter: driver.adapters().assetLoader });
  assets.registerMany(bundle.assets);

  return createStandardAppProfile({
    id: "web-audio-lab",
    expose({ context, state }) {
      context.audio = state.audio;
      context.assets = state.assets;
      context.drivers = state.drivers;
    },
    services: {
      drivers: {
        drivers: [driver],
        boot({ context }) {
          return {
            container: context.driverRoot,
            width: 720,
            height: 132,
            debug: true
          };
        }
      },
      assets: {
        manager: assets,
        preloadGroups: () => [AUDIO_LAB_ASSET_GROUP]
      },
      audio: {
        driver: AUDIO_LAB_DRIVER_ID,
        config: AUDIO_LAB_AUDIO_CONFIG
      }
    }
  });
}
