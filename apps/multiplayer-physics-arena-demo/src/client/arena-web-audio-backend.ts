import type { AudioBackend } from "@gamekits/audio-core/backend";
import type {
  AudioBackendEvent,
  AudioBackendSnapshot,
  BackendPlaybackRequest,
  BackendPlaybackUpdate
} from "@gamekits/audio-core/backend";

type ArenaWebVoice = {
  request: BackendPlaybackRequest;
  oscillator?: OscillatorNode | undefined;
  gain?: GainNode | undefined;
  pan?: StereoPannerNode | undefined;
  ended: boolean;
};

const CAPABILITIES = {
  pause: false,
  seek: false,
  fades: true,
  scheduledStart: true,
  multipleTracks: false,
  spatial: true,
  multipleListeners: false,
  parameters: false,
  markers: false,
  streaming: false,
  authoredObjects: true
} as const;

export function createArenaWebAudioBackend(
  options: {
    contextFactory?: (() => AudioContext) | undefined;
    maxVoices?: number | undefined;
  } = {}
): AudioBackend {
  const maxVoices = Math.max(4, options.maxVoices ?? 28);
  const voices = new Map<string, ArenaWebVoice>();
  let context: AudioContext | undefined;
  let listener: ((event: AudioBackendEvent) => void) | undefined;
  let listeners: Parameters<AudioBackend["setListeners"]>[0] = [];
  let emitters: Parameters<AudioBackend["setEmitters"]>[0] = [];
  let suspended = false;
  let disposed = false;

  return {
    id: "knockout.web-audio",
    capabilities: { ...CAPABILITIES },
    start(request) {
      if (disposed || voices.size >= maxVoices)
        return { accepted: false, reason: "voice-capacity" };
      const voice: ArenaWebVoice = { request: structuredClone(request), ended: false };
      voices.set(request.instance.id, voice);
      if (context !== undefined) startVoice(context, voice);
      return { accepted: true };
    },
    stop(instanceIds, fadeMs) {
      for (const instanceId of instanceIds) stopVoice(instanceId, fadeMs, "stopped");
    },
    pause() {},
    resume() {},
    seek() {
      return false;
    },
    updateInstances(updates) {
      for (const update of updates) updateVoice(update);
    },
    setBuses() {},
    setListeners(values) {
      listeners = structuredClone(values);
      refreshSpatialPans();
    },
    setEmitters(values) {
      emitters = structuredClone(values);
      refreshSpatialPans();
    },
    setGlobalParameter() {},
    async unlock() {
      if (disposed) return false;
      context ??= createContext(options.contextFactory);
      if (context === undefined) return false;
      await context.resume();
      suspended = false;
      for (const voice of voices.values()) {
        if (voice.oscillator === undefined) startVoice(context, voice);
      }
      return context.state === "running";
    },
    suspend() {
      suspended = true;
      void context?.suspend();
    },
    resumeOutput() {
      suspended = false;
      void context?.resume();
    },
    setEventListener(next) {
      listener = next;
    },
    snapshot(): AudioBackendSnapshot {
      return {
        id: "knockout.web-audio",
        activePlaybackInstances: voices.size,
        nativePlaybackCount: [...voices.values()].filter((voice) => voice.oscillator !== undefined)
          .length,
        retainedCommands: 0,
        unlocked: context?.state === "running",
        suspended,
        disposed,
        capabilities: { ...CAPABILITIES },
        details: { maxVoices, listeners: listeners.length, emitters: emitters.length }
      };
    },
    dispose() {
      if (disposed) return;
      for (const instanceId of voices.keys()) stopVoice(instanceId, 0, "stopped");
      void context?.close();
      context = undefined;
      listener = undefined;
      listeners = [];
      emitters = [];
      disposed = true;
    }
  };

  function startVoice(audioContext: AudioContext, voice: ArenaWebVoice): void {
    const recipe = synthRecipe(
      voice.request.instance.backendObject ?? voice.request.instance.sourceId
    );
    const now = audioContext.currentTime;
    const startAt = now + Math.max(0, voice.request.delayMs) / 1_000;
    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();
    const pan = audioContext.createStereoPanner();
    oscillator.type = recipe.wave;
    oscillator.frequency.setValueAtTime(recipe.frequency, startAt);
    if (!recipe.loop) {
      oscillator.frequency.exponentialRampToValueAtTime(
        Math.max(30, recipe.frequency * recipe.frequencyEndScale),
        startAt + recipe.durationMs / 1_000
      );
    }
    const targetGain = Math.min(0.28, recipe.gain * voice.request.instance.effectiveVolume);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(
      targetGain,
      startAt + Math.max(8, voice.request.fadeInMs) / 1_000
    );
    if (!recipe.loop) {
      gain.gain.exponentialRampToValueAtTime(0.0001, startAt + recipe.durationMs / 1_000);
    }
    pan.pan.value = spatialPan(voice.request);
    oscillator.connect(gain).connect(pan).connect(audioContext.destination);
    voice.oscillator = oscillator;
    voice.gain = gain;
    voice.pan = pan;
    oscillator.onended = () => finishVoice(voice.request.instance.id, "completed");
    oscillator.start(startAt);
    if (!recipe.loop) oscillator.stop(startAt + recipe.durationMs / 1_000 + 0.02);
  }

  function updateVoice(update: BackendPlaybackUpdate): void {
    const voice = voices.get(update.instanceId);
    if (voice === undefined) return;
    voice.request.instance = structuredClone(update.state);
    voice.request.emitter =
      update.emitter === undefined ? undefined : structuredClone(update.emitter);
    if (voice.gain !== undefined && context !== undefined) {
      voice.gain.gain.setTargetAtTime(
        Math.min(0.28, update.state.effectiveVolume),
        context.currentTime,
        Math.max(0.008, update.transitionMs / 3_000)
      );
    }
    if (voice.pan !== undefined) voice.pan.pan.value = spatialPan(voice.request);
  }

  function stopVoice(
    instanceId: string,
    fadeMs: number,
    reason: Extract<AudioBackendEvent, { type: "ended" }>["reason"]
  ): void {
    const voice = voices.get(instanceId);
    if (voice === undefined) return;
    if (voice.oscillator !== undefined && context !== undefined) {
      const stopAt = context.currentTime + Math.max(0, fadeMs) / 1_000;
      voice.gain?.gain.setTargetAtTime(
        0.0001,
        context.currentTime,
        Math.max(0.005, fadeMs / 3_000)
      );
      try {
        voice.oscillator.stop(stopAt);
      } catch {
        finishVoice(instanceId, reason);
      }
    } else {
      finishVoice(instanceId, reason);
    }
  }

  function finishVoice(
    instanceId: string,
    reason: Extract<AudioBackendEvent, { type: "ended" }>["reason"]
  ): void {
    const voice = voices.get(instanceId);
    if (voice === undefined || voice.ended) return;
    voice.ended = true;
    voice.oscillator?.disconnect();
    voice.gain?.disconnect();
    voice.pan?.disconnect();
    voices.delete(instanceId);
    listener?.({ type: "ended", instanceId, reason });
  }

  function refreshSpatialPans(): void {
    for (const voice of voices.values()) {
      if (voice.pan !== undefined) voice.pan.pan.value = spatialPan(voice.request);
    }
  }

  function spatialPan(request: BackendPlaybackRequest): number {
    const emitter =
      request.emitter ?? emitters.find((candidate) => candidate.id === request.instance.emitterId);
    const primary = listeners[0] ?? request.listeners[0];
    if (emitter === undefined || primary === undefined) return request.instance.pan;
    return Math.max(
      -1,
      Math.min(1, (emitter.transform.position.x - primary.transform.position.x) / 16)
    );
  }
}

function createContext(factory: (() => AudioContext) | undefined): AudioContext | undefined {
  if (factory !== undefined) return factory();
  const Constructor = globalThis.AudioContext;
  return Constructor === undefined ? undefined : new Constructor();
}

function synthRecipe(key: string): {
  frequency: number;
  frequencyEndScale: number;
  gain: number;
  durationMs: number;
  loop: boolean;
  wave: OscillatorType;
} {
  if (key.includes("music.running")) return recipe(92, 1, 0.12, 8_000, true, "sawtooth");
  if (key.includes("music.results")) return recipe(196, 1, 0.1, 8_000, true, "triangle");
  if (key.includes("music")) return recipe(73, 1, 0.09, 8_000, true, "sine");
  if (key.includes("hazard-warning")) return recipe(540, 1.8, 0.16, 260, false, "square");
  if (key.includes("hazard-active")) return recipe(110, 0.45, 0.2, 420, false, "sawtooth");
  if (key.includes("impact")) return recipe(150, 0.2, 0.24, 210, false, "square");
  if (key.includes("jump")) return recipe(280, 2.2, 0.15, 170, false, "sine");
  if (key.includes("item")) return recipe(420, 1.45, 0.14, 240, false, "triangle");
  return recipe(220, 1.6, 0.12, 360, false, "triangle");
}

function recipe(
  frequency: number,
  frequencyEndScale: number,
  gain: number,
  durationMs: number,
  loop: boolean,
  wave: OscillatorType
) {
  return { frequency, frequencyEndScale, gain, durationMs, loop, wave };
}
