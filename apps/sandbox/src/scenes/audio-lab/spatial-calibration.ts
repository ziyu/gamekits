import type { AudioSpatialDefinition } from "@gamekits/audio-core";

export const AUDIO_LAB_PAN_OWNER_ID = "audio-lab.spatial-pan";
export const AUDIO_LAB_DISTANCE_OWNER_ID = "audio-lab.spatial-distance";
export const AUDIO_LAB_DISTANCE_EMITTER_ID = "audio-lab.distance-emitter";
export const AUDIO_LAB_FIELD_OWNER_ID = "audio-lab.spatial-field";
export const AUDIO_LAB_FIELD_EMITTER_ID = "audio-lab.field-emitter";
export const AUDIO_LAB_FIELD_EXTENT_METERS = 12;

export type AudioLabSpatialPoint = Readonly<{ x: number; y: number }>;

export const AUDIO_LAB_DISTANCE_SPATIAL = {
  minDistance: 1,
  maxDistance: 12,
  rolloff: "linear",
  rolloffFactor: 1,
  distanceCulling: true
} as const satisfies AudioSpatialDefinition;

export const AUDIO_LAB_FIELD_SPATIAL = {
  ...AUDIO_LAB_DISTANCE_SPATIAL,
  distanceCulling: false
} as const satisfies AudioSpatialDefinition;

export const AUDIO_LAB_DISTANCE_CALIBRATION_POINTS = [1, 4, 7, 10, 12] as const;

export function audioLabDistanceGain(distanceMeters: number): number {
  const distance = Math.max(0, distanceMeters);
  const { minDistance, maxDistance, rolloffFactor } = AUDIO_LAB_DISTANCE_SPATIAL;
  if (distance <= minDistance) {
    return 1;
  }
  if (distance >= maxDistance) {
    return 0;
  }
  return clamp(1 - rolloffFactor * ((distance - minDistance) / (maxDistance - minDistance)), 0, 1);
}

export function audioGainToDecibels(gain: number): number {
  return gain <= 0 ? Number.NEGATIVE_INFINITY : 20 * Math.log10(gain);
}

export function audioLabSpatialMetrics(
  listener: AudioLabSpatialPoint,
  emitter: AudioLabSpatialPoint
): {
  deltaX: number;
  deltaY: number;
  distanceMeters: number;
  pan: number;
  gain: number;
  decibels: number;
  bearingDegrees: number;
} {
  const deltaX = emitter.x - listener.x;
  const deltaY = emitter.y - listener.y;
  const distanceMeters = Math.hypot(deltaX, deltaY);
  const gain = audioLabDistanceGain(distanceMeters);
  return {
    deltaX,
    deltaY,
    distanceMeters,
    pan: clamp(deltaX / AUDIO_LAB_FIELD_SPATIAL.maxDistance, -1, 1),
    gain,
    decibels: audioGainToDecibels(gain),
    bearingDegrees: normalizeDegrees((Math.atan2(deltaX, deltaY) * 180) / Math.PI)
  };
}

export function clampAudioLabSpatialPoint(point: AudioLabSpatialPoint): AudioLabSpatialPoint {
  return {
    x: clamp(point.x, -AUDIO_LAB_FIELD_EXTENT_METERS, AUDIO_LAB_FIELD_EXTENT_METERS),
    y: clamp(point.y, -AUDIO_LAB_FIELD_EXTENT_METERS, AUDIO_LAB_FIELD_EXTENT_METERS)
  };
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function normalizeDegrees(value: number): number {
  const normalized = ((((value + 180) % 360) + 360) % 360) - 180;
  return Object.is(normalized, -0) ? 0 : normalized;
}
