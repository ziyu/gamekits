import type { AssetRef } from "@gamekits/asset";

export type AudioValueRange = number | { min: number; max: number };

export type AudioClipRef = {
  id: string;
  asset: AssetRef<"audio">;
  weight?: number | undefined;
  volume?: AudioValueRange | undefined;
  pitch?: AudioValueRange | undefined;
  loop?: boolean | undefined;
  startOffsetMs?: number | undefined;
};

export type AudioClipDefinition = AudioClipRef;

export type AudioSourceDefinition =
  | {
      kind: "asset";
      clips: AudioClipDefinition[];
    }
  | {
      kind: "backend";
      key: string;
    };

export type AudioMarkerDefinition = {
  id: string;
  positionMs: number;
};

export type ResolvedAudioTrack = {
  id: string;
  asset: AssetRef<"audio">;
  volume: number;
  pitch: number;
  loop: boolean;
  startOffsetMs: number;
};
