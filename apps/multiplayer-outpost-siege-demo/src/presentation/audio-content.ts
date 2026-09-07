import type { CreateGameAudioOptions } from "@gamekits/audio-core";

import { OUTPOST_AUDIO_ASSET_IDS } from "../content";

export const OUTPOST_AUDIO_IDS = {
  music: "music.outpost.frontier",
  rifle: "sfx.outpost.rifle",
  enemyTelegraph: "sfx.outpost.enemy-telegraph",
  hit: "sfx.outpost.hit"
} as const;

export const OUTPOST_AUDIO_CONFIG = {
  id: "outpost.audio",
  music: [
    {
      id: OUTPOST_AUDIO_IDS.music,
      source: {
        kind: "asset",
        clips: [clip("frontier-bed", OUTPOST_AUDIO_ASSET_IDS.ambience, true)]
      },
      loop: true,
      volume: 0.32,
      defaultTransition: { type: "crossfade", durationMs: 700 }
    }
  ],
  sfx: [
    {
      id: OUTPOST_AUDIO_IDS.rifle,
      bus: "sfx",
      concurrency: ["outpost.rifle"],
      priority: 12,
      pitch: { min: 0.98, max: 1.02 },
      spatial: { minDistance: 80, maxDistance: 900, rolloff: "linear" },
      layers: [
        {
          id: "shot",
          clips: OUTPOST_AUDIO_ASSET_IDS.rifle.map((assetId, index) =>
            clip(`shot-${index + 1}`, assetId)
          )
        }
      ]
    },
    {
      id: OUTPOST_AUDIO_IDS.enemyTelegraph,
      bus: "sfx",
      concurrency: ["outpost.enemy-telegraph"],
      priority: 20,
      spatial: { minDistance: 100, maxDistance: 1_100, rolloff: "linear" },
      layers: [
        {
          id: "warning",
          clips: OUTPOST_AUDIO_ASSET_IDS.enemyTelegraph.map((assetId, index) =>
            clip(`warning-${index + 1}`, assetId)
          )
        }
      ]
    },
    {
      id: OUTPOST_AUDIO_IDS.hit,
      bus: "sfx",
      concurrency: ["outpost.hit"],
      priority: 10,
      pitch: { min: 0.97, max: 1.03 },
      spatial: { minDistance: 60, maxDistance: 760, rolloff: "linear" },
      layers: [
        {
          id: "impact",
          clips: OUTPOST_AUDIO_ASSET_IDS.hit.map((assetId, index) =>
            clip(`impact-${index + 1}`, assetId)
          )
        }
      ]
    }
  ],
  concurrency: [
    {
      id: "outpost.rifle",
      maxInstances: 12,
      resolution: "stop-oldest",
      retriggerMs: 28
    },
    {
      id: "outpost.enemy-telegraph",
      maxInstances: 8,
      resolution: "stop-lowest-priority",
      retriggerMs: 80
    },
    {
      id: "outpost.hit",
      maxInstances: 10,
      resolution: "stop-oldest",
      retriggerMs: 24
    }
  ],
  playbackBudgets: {
    music: { maxPlaybackInstances: 2, maxNativePlaybackCount: 2 },
    sfx: { maxPlaybackInstances: 32, maxNativePlaybackCount: 40 },
    dialogue: { maxPlaybackInstances: 1, maxNativePlaybackCount: 1 }
  },
  maxPlaybackInstances: 40,
  maxNativePlaybackCount: 48,
  maxDedupeEntries: 256,
  dedupeWindowMs: 400,
  diagnosticLimit: 160
} satisfies Omit<CreateGameAudioOptions, "backend" | "disposeBackend">;

function clip(id: string, assetId: string, loop = false) {
  return {
    id,
    asset: { type: "audio" as const, assetId },
    loop
  };
}
