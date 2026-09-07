import type { CreateGameAudioOptions } from "@gamekits/audio-core";
import { AUDIO_LAB_ASSET_IDS, type AudioLabAssetId } from "./audio-assets";
import { AUDIO_LAB_DISTANCE_SPATIAL, AUDIO_LAB_FIELD_SPATIAL } from "./spatial-calibration";

export const AUDIO_LAB_IDS = {
  music: {
    frontier: "music.audio-lab.frontier",
    combat: "music.audio-lab.combat",
    nightDrive: "music.audio-lab.night-drive",
    quietRuins: "music.audio-lab.quiet-ruins"
  },
  sfx: {
    weapon: "sfx.audio-lab.weapon",
    impact: "sfx.audio-lab.impact",
    ui: "sfx.audio-lab.ui",
    beacon: "sfx.audio-lab.beacon",
    spatialField: "sfx.audio-lab.spatial-field"
  },
  dialogue: {
    scout: "dialogue.audio-lab.scout",
    operator: "dialogue.audio-lab.operator"
  },
  snapshots: {
    dialogueDuck: "mix.audio-lab.dialogue-duck",
    musicFocus: "mix.audio-lab.music-focus",
    sfxFocus: "mix.audio-lab.sfx-focus"
  }
} as const;

export type AudioLabMusicId = (typeof AUDIO_LAB_IDS.music)[keyof typeof AUDIO_LAB_IDS.music];

export const AUDIO_LAB_MUSIC_PROGRAMS = [
  {
    id: AUDIO_LAB_IDS.music.frontier,
    label: "Frontier signal",
    detail: "80 BPM · adaptive"
  },
  {
    id: AUDIO_LAB_IDS.music.combat,
    label: "Combat vector",
    detail: "120 BPM · tactical"
  },
  {
    id: AUDIO_LAB_IDS.music.nightDrive,
    label: "Night drive",
    detail: "120 BPM · arpeggio"
  },
  {
    id: AUDIO_LAB_IDS.music.quietRuins,
    label: "Quiet ruins",
    detail: "60 BPM · ambient"
  }
] as const satisfies readonly { id: AudioLabMusicId; label: string; detail: string }[];

export const AUDIO_LAB_AUDIO_CONFIG = {
  id: "sandbox.audio-lab.audio",
  music: [
    {
      id: AUDIO_LAB_IDS.music.frontier,
      source: {
        kind: "asset",
        clips: [clip("frontier-bed", AUDIO_LAB_ASSET_IDS.frontierBed, { loop: true })]
      },
      stems: [
        {
          id: "signal",
          source: {
            kind: "asset",
            clips: [clip("frontier-signal", AUDIO_LAB_ASSET_IDS.frontierSignal, { loop: true })]
          },
          intensity: { min: 0.15, max: 1 }
        }
      ],
      loop: true,
      bpm: 80,
      beatsPerBar: 4,
      markers: [
        { id: "bar.3", positionMs: 6_000 },
        { id: "loop", positionMs: 11_950 }
      ],
      defaultTransition: { type: "crossfade", durationMs: 900 }
    },
    {
      id: AUDIO_LAB_IDS.music.combat,
      source: {
        kind: "asset",
        clips: [clip("combat", AUDIO_LAB_ASSET_IDS.combat, { loop: true })]
      },
      loop: true,
      bpm: 120,
      beatsPerBar: 4,
      defaultTransition: { type: "crossfade", durationMs: 900 }
    },
    {
      id: AUDIO_LAB_IDS.music.nightDrive,
      source: {
        kind: "asset",
        clips: [clip("night-drive", AUDIO_LAB_ASSET_IDS.nightDrive, { loop: true })]
      },
      loop: true,
      bpm: 120,
      beatsPerBar: 4,
      markers: [
        { id: "break", positionMs: 4_000 },
        { id: "loop", positionMs: 7_950 }
      ],
      defaultTransition: { type: "crossfade", durationMs: 900 }
    },
    {
      id: AUDIO_LAB_IDS.music.quietRuins,
      source: {
        kind: "asset",
        clips: [clip("quiet-ruins", AUDIO_LAB_ASSET_IDS.quietRuins, { loop: true })]
      },
      loop: true,
      bpm: 60,
      beatsPerBar: 4,
      markers: [
        { id: "chime", positionMs: 6_000 },
        { id: "loop", positionMs: 11_950 }
      ],
      defaultTransition: { type: "crossfade", durationMs: 900 }
    }
  ],
  sfx: [
    {
      id: AUDIO_LAB_IDS.sfx.weapon,
      bus: "sfx",
      concurrency: ["audio-lab.weapon"],
      layers: [
        {
          id: "shot",
          selection: "sequence",
          clips: [
            clip("shot-a", AUDIO_LAB_ASSET_IDS.shotA),
            clip("shot-b", AUDIO_LAB_ASSET_IDS.shotB)
          ]
        }
      ]
    },
    {
      id: AUDIO_LAB_IDS.sfx.impact,
      bus: "sfx",
      layers: [
        {
          id: "body",
          clips: [clip("impact-body", AUDIO_LAB_ASSET_IDS.impactBody)]
        },
        {
          id: "debris",
          clips: [clip("impact-debris", AUDIO_LAB_ASSET_IDS.impactDebris, { volume: 0.7 })]
        }
      ]
    },
    {
      id: AUDIO_LAB_IDS.sfx.ui,
      bus: "sfx/ui",
      layers: [{ id: "ui", clips: [clip("ui-click", AUDIO_LAB_ASSET_IDS.uiClick)] }]
    },
    {
      id: AUDIO_LAB_IDS.sfx.beacon,
      bus: "sfx/ambience",
      loop: true,
      spatial: AUDIO_LAB_DISTANCE_SPATIAL,
      layers: [
        {
          id: "signal",
          clips: [clip("beacon", AUDIO_LAB_ASSET_IDS.beacon, { loop: true })]
        }
      ]
    },
    {
      id: AUDIO_LAB_IDS.sfx.spatialField,
      bus: "sfx/ambience",
      loop: true,
      spatial: AUDIO_LAB_FIELD_SPATIAL,
      layers: [
        {
          id: "field-tone",
          clips: [clip("field-tone", AUDIO_LAB_ASSET_IDS.spatialField, { loop: true })]
        }
      ]
    }
  ],
  dialogue: [
    {
      id: AUDIO_LAB_IDS.dialogue.scout,
      speakerId: "speaker.scout",
      subtitleKey: "audio-lab.scout.check-in",
      source: {
        kind: "asset",
        clips: [clip("scout-line", AUDIO_LAB_ASSET_IDS.scoutLine)]
      },
      markers: [{ id: "radio-gesture", positionMs: 1_100 }],
      duckingSnapshotId: AUDIO_LAB_IDS.snapshots.dialogueDuck,
      priority: 4
    },
    {
      id: AUDIO_LAB_IDS.dialogue.operator,
      speakerId: "speaker.operator",
      subtitleKey: "audio-lab.operator-response",
      source: {
        kind: "asset",
        clips: [clip("operator-line", AUDIO_LAB_ASSET_IDS.operatorLine)]
      },
      markers: [{ id: "radio-confirm", positionMs: 1_450 }],
      duckingSnapshotId: AUDIO_LAB_IDS.snapshots.dialogueDuck,
      priority: 10
    }
  ],
  concurrency: [
    {
      id: "audio-lab.weapon",
      maxInstances: 3,
      resolution: "stop-oldest",
      retriggerMs: 35
    }
  ],
  mixSnapshots: [
    {
      id: AUDIO_LAB_IDS.snapshots.dialogueDuck,
      priority: 20,
      buses: [
        { busId: "music", volume: 0.28 },
        { busId: "sfx", volume: 0.62 }
      ]
    },
    {
      id: AUDIO_LAB_IDS.snapshots.musicFocus,
      priority: 5,
      buses: [
        { busId: "music", volume: 1 },
        { busId: "sfx", volume: 0.22 },
        { busId: "dialogue", volume: 0.45 }
      ]
    },
    {
      id: AUDIO_LAB_IDS.snapshots.sfxFocus,
      priority: 5,
      buses: [
        { busId: "music", volume: 0.2 },
        { busId: "sfx", volume: 1 },
        { busId: "dialogue", volume: 0.45 }
      ]
    }
  ],
  dedupeWindowMs: 300,
  diagnosticLimit: 96,
  playbackBudgets: {
    music: { maxPlaybackInstances: 2, maxNativePlaybackCount: 4 },
    sfx: { maxPlaybackInstances: 16, maxNativePlaybackCount: 24 },
    dialogue: { maxPlaybackInstances: 2, maxNativePlaybackCount: 2 }
  }
} satisfies Omit<CreateGameAudioOptions, "backend" | "disposeBackend">;

function clip(
  id: string,
  assetId: AudioLabAssetId,
  options: { loop?: boolean; volume?: number } = {}
) {
  return {
    id,
    asset: { type: "audio" as const, assetId },
    ...options
  };
}
