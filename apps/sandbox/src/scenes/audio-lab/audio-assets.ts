import type { AssetDefinition } from "@gamekits/asset";

export const AUDIO_LAB_ASSET_GROUP = "sandbox.audio-lab";
export const AUDIO_LAB_SAMPLE_RATE = 32_000;

export const AUDIO_LAB_ASSET_IDS = {
  frontierBed: "audio.lab.music.frontier.bed",
  frontierSignal: "audio.lab.music.frontier.signal",
  combat: "audio.lab.music.combat",
  nightDrive: "audio.lab.music.night-drive",
  quietRuins: "audio.lab.music.quiet-ruins",
  shotA: "audio.lab.sfx.shot-a",
  shotB: "audio.lab.sfx.shot-b",
  impactBody: "audio.lab.sfx.impact-body",
  impactDebris: "audio.lab.sfx.impact-debris",
  uiClick: "audio.lab.sfx.ui-click",
  beacon: "audio.lab.sfx.beacon",
  spatialField: "audio.lab.sfx.spatial-field",
  scoutLine: "audio.lab.dialogue.scout",
  operatorLine: "audio.lab.dialogue.operator"
} as const;

export type AudioLabAssetId = (typeof AUDIO_LAB_ASSET_IDS)[keyof typeof AUDIO_LAB_ASSET_IDS];

export type AudioLabAssetBundle = {
  assets: AssetDefinition[];
  dispose(): void;
};

type SynthDefinition = {
  durationMs: number;
  channels?: 1 | 2;
  render(time: number, duration: number, channel: number): number;
};

const SYNTH_DEFINITIONS: Record<AudioLabAssetId, SynthDefinition> = {
  [AUDIO_LAB_ASSET_IDS.frontierBed]: {
    durationMs: 12_000,
    channels: 2,
    render: renderFrontierBed
  },
  [AUDIO_LAB_ASSET_IDS.frontierSignal]: {
    durationMs: 12_000,
    channels: 2,
    render: renderFrontierSignal
  },
  [AUDIO_LAB_ASSET_IDS.combat]: {
    durationMs: 8_000,
    channels: 2,
    render: renderCombatMusic
  },
  [AUDIO_LAB_ASSET_IDS.nightDrive]: {
    durationMs: 8_000,
    channels: 2,
    render: renderNightDriveMusic
  },
  [AUDIO_LAB_ASSET_IDS.quietRuins]: {
    durationMs: 12_000,
    channels: 2,
    render: renderQuietRuinsMusic
  },
  [AUDIO_LAB_ASSET_IDS.shotA]: {
    durationMs: 260,
    render: (time, duration) => renderShot(time, duration, 620)
  },
  [AUDIO_LAB_ASSET_IDS.shotB]: {
    durationMs: 290,
    render: (time, duration) => renderShot(time, duration, 510)
  },
  [AUDIO_LAB_ASSET_IDS.impactBody]: {
    durationMs: 620,
    render: renderImpactBody
  },
  [AUDIO_LAB_ASSET_IDS.impactDebris]: {
    durationMs: 480,
    render: renderImpactDebris
  },
  [AUDIO_LAB_ASSET_IDS.uiClick]: {
    durationMs: 110,
    render: renderUiClick
  },
  [AUDIO_LAB_ASSET_IDS.beacon]: {
    durationMs: 1_600,
    render: renderBeacon
  },
  [AUDIO_LAB_ASSET_IDS.spatialField]: {
    durationMs: 2_000,
    render: renderSpatialField
  },
  [AUDIO_LAB_ASSET_IDS.scoutLine]: {
    durationMs: 2_600,
    render: (time, duration) => renderRadioLine(time, duration, 132, 0)
  },
  [AUDIO_LAB_ASSET_IDS.operatorLine]: {
    durationMs: 3_000,
    render: (time, duration) => renderRadioLine(time, duration, 104, 3)
  }
};

export function createAudioLabAssetBundle(): AudioLabAssetBundle {
  const urls: string[] = [];
  const assets = Object.values(AUDIO_LAB_ASSET_IDS).map((assetId) => {
    const bytes = createAudioLabWaveBytes(assetId);
    const buffer = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength
    ) as ArrayBuffer;
    const url = URL.createObjectURL(new Blob([buffer], { type: "audio/wav" }));
    urls.push(url);
    return {
      id: assetId,
      type: "audio" as const,
      source: { type: "url" as const, url },
      group: AUDIO_LAB_ASSET_GROUP,
      tags: ["sandbox", "audio-lab", audioCategory(assetId)],
      audio: { stream: false, instances: 12 }
    };
  });

  let disposed = false;
  return {
    assets,
    dispose() {
      if (disposed) {
        return;
      }
      disposed = true;
      for (const url of urls) {
        URL.revokeObjectURL(url);
      }
    }
  };
}

export function createAudioLabWaveBytes(assetId: AudioLabAssetId): Uint8Array {
  const definition = SYNTH_DEFINITIONS[assetId];
  const frameCount = Math.max(
    1,
    Math.round((definition.durationMs / 1_000) * AUDIO_LAB_SAMPLE_RATE)
  );
  const channelCount = definition.channels ?? 1;
  const dataSize = frameCount * channelCount * 2;
  const bytes = new Uint8Array(44 + dataSize);
  const view = new DataView(bytes.buffer);
  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channelCount, true);
  view.setUint32(24, AUDIO_LAB_SAMPLE_RATE, true);
  view.setUint32(28, AUDIO_LAB_SAMPLE_RATE * channelCount * 2, true);
  view.setUint16(32, channelCount * 2, true);
  view.setUint16(34, 16, true);
  writeAscii(view, 36, "data");
  view.setUint32(40, dataSize, true);

  const duration = frameCount / AUDIO_LAB_SAMPLE_RATE;
  for (let frame = 0; frame < frameCount; frame += 1) {
    const time = frame / AUDIO_LAB_SAMPLE_RATE;
    for (let channel = 0; channel < channelCount; channel += 1) {
      const sample = clamp(definition.render(time, duration, channel), -1, 1);
      const sampleOffset = 44 + (frame * channelCount + channel) * 2;
      view.setInt16(sampleOffset, Math.round(sample * 32_767), true);
    }
  }
  return bytes;
}

function renderFrontierBed(time: number, duration: number, channel: number): number {
  const chords = [
    [65.41, 130.81, 164.81, 196, 246.94],
    [55, 110, 130.81, 164.81, 196],
    [43.65, 87.31, 130.81, 164.81, 196],
    [49, 98, 130.81, 146.83, 196]
  ] as const;
  const pad = evolvingChord(time, chords, 3, channel, 0.94);
  const air = sine(channel === 0 ? 523.25 : 526.4, time) * (0.5 + sine(0.083, time) * 0.5);
  return softClip((pad * 0.72 + air * 0.025) * loopSeam(time, duration, 0.12), 1.15) * 0.54;
}

function renderFrontierSignal(time: number, duration: number, channel: number): number {
  const stepDuration = 0.375;
  const notes = [392, 523.25, 440, 659.25, 523.25, 440, 349.23, 392] as const;
  const step = Math.floor(time / stepDuration);
  const local = time % stepDuration;
  const note = notes[step % notes.length] ?? 392;
  const envelope = attackRelease(local, stepDuration, 0.018, 0.17);
  const detune = channel === 0 ? 0.997 : 1.003;
  const bell =
    sine(note * detune, local) * 0.58 +
    sine(note * detune * 2.01, local) * 0.2 +
    sine(note * detune * 3.98, local) * 0.07;
  return bell * envelope * loopSeam(time, duration, 0.08) * 0.42;
}

function renderCombatMusic(time: number, duration: number, channel: number): number {
  const step = Math.floor((time * 4) % 8);
  const notes = [82.41, 82.41, 98, 110, 82.41, 123.47, 110, 98];
  const stepLocal = time % 0.25;
  const bassEnvelope = attackRelease(stepLocal, 0.25, 0.008, 0.06);
  const detune = channel === 0 ? 0.998 : 1.002;
  const bass = triangle((notes[step] ?? 82.41) * detune, stepLocal) * bassEnvelope * 0.3;
  const kick = renderKick(time % 0.5) * 0.52;
  const hatOffset = channel === 0 ? 0 : 0.012;
  const hat =
    deterministicNoise(time, 41 + channel * 17) *
    pulseEnvelope(time + 0.25 + hatOffset, 0.5, 0.035) *
    0.09;
  return softClip((bass + kick + hat) * loopSeam(time, duration, 0.04), 1.6) * 0.72;
}

function renderNightDriveMusic(time: number, duration: number, channel: number): number {
  const roots = [55, 65.41, 73.42, 49] as const;
  const chordIntervals = [1, 1.5, 2, 3] as const;
  const bar = Math.floor(time / 2) % roots.length;
  const root = roots[bar] ?? 55;
  const stepDuration = 0.25;
  const step = Math.floor(time / stepDuration) % chordIntervals.length;
  const local = time % stepDuration;
  const detune = channel === 0 ? 0.996 : 1.004;
  const arpEnvelope = attackRelease(local, stepDuration, 0.008, 0.075);
  const arpFrequency = root * 4 * (chordIntervals[step] ?? 1) * detune;
  const arpeggio =
    (sine(arpFrequency, local) * 0.72 + sine(arpFrequency * 2, local) * 0.11) * arpEnvelope;
  const bassLocal = time % 0.5;
  const bass =
    triangle(root * detune, bassLocal) * attackRelease(bassLocal, 0.5, 0.012, 0.16) * 0.38;
  const kick = renderKick(time % 0.5) * 0.28;
  return softClip((arpeggio * 0.35 + bass + kick) * loopSeam(time, duration, 0.06), 1.35) * 0.64;
}

function renderQuietRuinsMusic(time: number, duration: number, channel: number): number {
  const chords = [
    [73.42, 146.83, 174.61, 220, 261.63],
    [58.27, 116.54, 146.83, 174.61, 220],
    [87.31, 174.61, 220, 261.63, 329.63]
  ] as const;
  const pad = evolvingChord(time, chords, 4, channel, 1.08);
  const chimeStep = 1.5;
  const shiftedTime = time + channel * 0.055;
  const chimeLocal = shiftedTime % chimeStep;
  const chimeNotes = [587.33, 440, 523.25, 349.23, 659.25, 523.25] as const;
  const chimeIndex = Math.floor(shiftedTime / chimeStep) % chimeNotes.length;
  const chime =
    sine(chimeNotes[chimeIndex] ?? 440, chimeLocal) *
    attackRelease(chimeLocal, chimeStep, 0.03, 0.8) *
    0.09;
  return (pad * 0.62 + chime) * loopSeam(time, duration, 0.16) * 0.52;
}

function evolvingChord(
  time: number,
  chords: readonly (readonly number[])[],
  chordDuration: number,
  channel: number,
  brightness: number
): number {
  const chordIndex = Math.floor(time / chordDuration) % chords.length;
  const nextIndex = (chordIndex + 1) % chords.length;
  const local = time % chordDuration;
  const blend = smoothStep((local - chordDuration * 0.68) / (chordDuration * 0.32));
  const current = renderPadChord(chords[chordIndex] ?? chords[0] ?? [], time, channel, brightness);
  const next = renderPadChord(chords[nextIndex] ?? chords[0] ?? [], time, channel, brightness);
  return current * (1 - blend) + next * blend;
}

function renderPadChord(
  notes: readonly number[],
  time: number,
  channel: number,
  brightness: number
): number {
  const detune = channel === 0 ? 0.9985 : 1.0015;
  const weights = [0.34, 0.24, 0.18, 0.13, 0.09];
  let value = 0;
  for (let index = 0; index < notes.length; index += 1) {
    const frequency = (notes[index] ?? 110) * detune;
    const weight = weights[index] ?? 0.07;
    value += sine(frequency, time) * weight;
    value += sine(frequency * 2, time) * weight * 0.055 * brightness;
  }
  const movement = 0.82 + sine(0.07 + channel * 0.009, time) * 0.18;
  return value * movement;
}

function renderKick(local: number): number {
  const envelope = Math.exp(-local * 9) * attack(local, 0.004);
  const phase = Math.PI * 2 * (48 * local + (72 * (1 - Math.exp(-18 * local))) / 18);
  return Math.sin(phase) * envelope;
}

function renderShot(time: number, duration: number, startFrequency: number): number {
  const progress = time / duration;
  const envelope = Math.exp(-progress * 8) * attack(time, 0.008);
  const frequency = startFrequency * Math.pow(0.18, progress);
  const transient = deterministicNoise(time, Math.round(startFrequency)) * Math.exp(-progress * 24);
  return softClip((sine(frequency, time) * 0.72 + transient * 0.5) * envelope, 2.2) * 0.8;
}

function renderImpactBody(time: number, duration: number): number {
  const progress = time / duration;
  const body = sine(72 - progress * 28, time) * Math.exp(-progress * 5.5);
  const crack = deterministicNoise(time, 73) * Math.exp(-progress * 18);
  return softClip(body * 0.85 + crack * 0.52, 1.8) * 0.72;
}

function renderImpactDebris(time: number, duration: number): number {
  const progress = time / duration;
  const scatter = deterministicNoise(time, 211) * Math.exp(-progress * 6.5);
  const ring = sine(1_280, time) * Math.exp(-progress * 13);
  return (scatter * 0.42 + ring * 0.18) * attack(time, 0.002);
}

function renderUiClick(time: number, duration: number): number {
  const progress = time / duration;
  return (sine(1_240, time) + sine(1_860, time) * 0.45) * Math.exp(-progress * 8) * 0.38;
}

function renderBeacon(time: number, duration: number): number {
  const phase = (time % 0.8) / 0.8;
  const envelope = phase < 0.35 ? Math.sin((phase / 0.35) * Math.PI) : 0;
  const signal = sine(420, time) * 0.32 + sine(840, time) * 0.12;
  return signal * envelope * loopSeam(time, duration, 0.03);
}

function renderSpatialField(time: number, duration: number): number {
  const movement = 0.82 + sine(0.5, time) * 0.12;
  const signal = sine(330, time) * 0.3 + sine(660, time) * 0.09 + sine(990, time) * 0.035;
  return signal * movement * loopSeam(time, duration, 0.02);
}

function renderRadioLine(
  time: number,
  duration: number,
  fundamental: number,
  noteOffset: number
): number {
  const cadence = 0.26;
  const syllable = Math.floor(time / cadence);
  const local = time % cadence;
  const notes = [1, 1.12, 0.94, 1.26, 1.06, 0.88, 1.18, 1.03];
  const note = notes[(syllable + noteOffset) % notes.length] ?? 1;
  const envelope = attackRelease(local, cadence, 0.025, 0.08);
  const carrier =
    sine(fundamental * note, time) * 0.5 +
    sine(fundamental * note * 2.05, time) * 0.24 +
    sine(fundamental * note * 3.9, time) * 0.1;
  const consonant = deterministicNoise(time, 503 + syllable) * (local < 0.055 ? 0.16 : 0.025);
  return softClip((carrier + consonant) * envelope, 1.8) * loopSeam(time, duration, 0.015) * 0.62;
}

function sine(frequency: number, time: number): number {
  return Math.sin(Math.PI * 2 * frequency * time);
}

function triangle(frequency: number, time: number): number {
  return (2 / Math.PI) * Math.asin(Math.sin(Math.PI * 2 * frequency * time));
}

function attack(time: number, attackTime: number): number {
  return clamp(time / attackTime, 0, 1);
}

function attackRelease(
  time: number,
  duration: number,
  attackTime: number,
  releaseTime: number
): number {
  return Math.min(attack(time, attackTime), clamp((duration - time) / releaseTime, 0, 1));
}

function loopSeam(time: number, duration: number, seam: number): number {
  return Math.min(1, time / seam, (duration - time) / seam);
}

function pulseEnvelope(time: number, interval: number, decay: number): number {
  const local = ((time % interval) + interval) % interval;
  return Math.exp(-local / decay);
}

function deterministicNoise(time: number, seed: number): number {
  const sample = Math.floor(time * AUDIO_LAB_SAMPLE_RATE);
  const value = Math.sin((sample + seed * 1_013) * 12.9898) * 43_758.5453;
  return (value - Math.floor(value)) * 2 - 1;
}

function softClip(value: number, drive: number): number {
  return Math.tanh(value * drive) / Math.tanh(drive);
}

function smoothStep(value: number): number {
  const normalized = clamp(value, 0, 1);
  return normalized * normalized * (3 - 2 * normalized);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function writeAscii(view: DataView, offset: number, value: string): void {
  for (let index = 0; index < value.length; index += 1) {
    view.setUint8(offset + index, value.charCodeAt(index));
  }
}

function audioCategory(assetId: AudioLabAssetId): string {
  if (assetId.includes(".music.")) {
    return "music";
  }
  if (assetId.includes(".dialogue.")) {
    return "dialogue";
  }
  return "sfx";
}
