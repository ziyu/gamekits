import { GameError } from "@gamekits/core";

export type AudioErrorCode =
  | "audio.backend_rejected"
  | "audio.bus_cycle"
  | "audio.bus_missing"
  | "audio.concurrency_missing"
  | "audio.dialogue_missing"
  | "audio.duplicate_definition"
  | "audio.emitter_missing"
  | "audio.invalid_config"
  | "audio.music_missing"
  | "audio.parameter_missing"
  | "audio.playback_missing"
  | "audio.runtime_disposed"
  | "audio.sfx_missing"
  | "audio.snapshot_missing";

export function createAudioError(
  code: AudioErrorCode,
  message: string,
  context?: Record<string, unknown>
): GameError {
  return new GameError(code, message, context);
}
