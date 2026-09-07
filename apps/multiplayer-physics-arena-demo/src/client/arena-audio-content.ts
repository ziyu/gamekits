import { createGameAudio, type CreateGameAudioOptions, type GameAudio } from "@gamekits/audio-core";
import type { AudioBackend } from "@gamekits/audio-core/backend";

export const ARENA_AUDIO_IDS = {
  musicLobby: "music.knockout.lobby",
  musicRunning: "music.knockout.running",
  musicResults: "music.knockout.results",
  jump: "sfx.knockout.jump",
  impact: "sfx.knockout.impact",
  item: "sfx.knockout.item",
  hazardWarning: "sfx.knockout.hazard-warning",
  hazardActive: "sfx.knockout.hazard-active",
  stage: "sfx.knockout.stage"
} as const;

export const ARENA_AUDIO_CONFIG = {
  id: "knockout.audio",
  music: [
    music(ARENA_AUDIO_IDS.musicLobby, "arena.music.lobby", 0.2),
    music(ARENA_AUDIO_IDS.musicRunning, "arena.music.running", 0.24),
    music(ARENA_AUDIO_IDS.musicResults, "arena.music.results", 0.22)
  ],
  sfx: [
    sfx(ARENA_AUDIO_IDS.jump, "arena.sfx.jump", 8, ["arena.movement"]),
    sfx(ARENA_AUDIO_IDS.impact, "arena.sfx.impact", 30, ["arena.impact"]),
    sfx(ARENA_AUDIO_IDS.item, "arena.sfx.item", 18, ["arena.item"]),
    sfx(ARENA_AUDIO_IDS.hazardWarning, "arena.sfx.hazard-warning", 24, ["arena.hazard"]),
    sfx(ARENA_AUDIO_IDS.hazardActive, "arena.sfx.hazard-active", 28, ["arena.hazard"]),
    sfx(ARENA_AUDIO_IDS.stage, "arena.sfx.stage", 32, ["arena.broadcast"], false)
  ],
  concurrency: [
    concurrency("arena.movement", 6, 70),
    concurrency("arena.impact", 10, 28),
    concurrency("arena.item", 6, 60),
    concurrency("arena.hazard", 8, 0),
    concurrency("arena.broadcast", 2, 250)
  ],
  playbackBudgets: {
    music: { maxPlaybackInstances: 2, maxNativePlaybackCount: 2 },
    sfx: { maxPlaybackInstances: 24, maxNativePlaybackCount: 24 },
    dialogue: { maxPlaybackInstances: 1, maxNativePlaybackCount: 1 }
  },
  maxPlaybackInstances: 28,
  maxNativePlaybackCount: 28,
  maxDedupeEntries: 256,
  dedupeWindowMs: 30_000,
  diagnosticLimit: 160,
  random: () => 0.5
} satisfies Omit<CreateGameAudioOptions, "backend" | "disposeBackend">;

export function createArenaGameAudio(backend: AudioBackend): GameAudio {
  return createGameAudio({ ...ARENA_AUDIO_CONFIG, backend, disposeBackend: true });
}

function music(id: string, key: string, volume: number) {
  return {
    id,
    source: { kind: "backend" as const, key },
    loop: true,
    volume,
    defaultTransition: { type: "crossfade" as const, durationMs: 480 }
  };
}

function sfx(
  id: string,
  backendObject: string,
  priority: number,
  concurrencyIds: string[],
  spatial = true
) {
  return {
    id,
    backendObject,
    priority,
    concurrency: concurrencyIds,
    ...(spatial ? { spatial: { minDistance: 2, maxDistance: 42, rolloff: "linear" as const } } : {})
  };
}

function concurrency(id: string, maxInstances: number, retriggerMs: number) {
  return {
    id,
    maxInstances,
    resolution: "stop-lowest-priority" as const,
    retriggerMs
  };
}
