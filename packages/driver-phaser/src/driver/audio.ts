import type {
  AudioBusState,
  AudioEmitterState,
  AudioListenerState,
  AudioParameterValue,
  PlaybackInstanceState,
  ResolvedAudioTrack
} from "@gamekits/audio-core";
import type {
  AudioBackend,
  AudioBackendCapabilities,
  AudioBackendEvent,
  BackendPlaybackRequest
} from "@gamekits/audio-core/backend";

export type PhaserDriverAudioTrack = Pick<
  ResolvedAudioTrack,
  "id" | "asset" | "volume" | "pitch" | "loop" | "startOffsetMs"
>;

export type PhaserDriverAudioRuntime = {
  start(input: {
    instanceId: string;
    tracks: PhaserDriverAudioTrack[];
    volume: number;
    rate: number;
    pan: number;
    delayMs: number;
    fadeInMs: number;
    onEnded(reason: "completed" | "stopped" | "failed"): void;
  }): boolean;
  stop(instanceIds: string[], fadeMs: number): void;
  pause(instanceIds: string[]): void;
  resume(instanceIds: string[]): void;
  seek(instanceId: string, positionMs: number): boolean;
  updateInstance(
    instanceId: string,
    state: {
      volume: number;
      rate: number;
      pan: number;
      loop: boolean;
      transitionMs: number;
      tracks: Array<Pick<ResolvedAudioTrack, "id" | "volume" | "pitch">>;
    }
  ): void;
  unlock(): Promise<boolean> | boolean;
  suspend(): void;
  resumeOutput(): void;
  snapshot(): {
    activePlaybackInstances: number;
    nativePlaybackCount: number;
    unlocked: boolean;
    suspended: boolean;
  };
  destroy(): void;
};

type BoundInstance = {
  request: BackendPlaybackRequest;
  pausedByBus: boolean;
};

const PHASER_AUDIO_CAPABILITIES: AudioBackendCapabilities = {
  pause: true,
  seek: true,
  fades: true,
  scheduledStart: true,
  multipleTracks: true,
  spatial: true,
  multipleListeners: false,
  parameters: false,
  markers: false,
  streaming: false,
  authoredObjects: false
};

export function createPhaserAudioBackend(options: {
  id: string;
  runtime: () => PhaserDriverAudioRuntime;
}): AudioBackend {
  const instances = new Map<string, BoundInstance>();
  const buses = new Map<string, AudioBusState>();
  const listeners = new Map<string, AudioListenerState>();
  const emitters = new Map<string, AudioEmitterState>();
  const globalParameters: Record<string, AudioParameterValue> = {};
  let eventListener: ((event: AudioBackendEvent) => void) | undefined;
  let suspended = false;
  let disposed = false;

  return {
    id: options.id,
    capabilities: { ...PHASER_AUDIO_CAPABILITIES },
    start(request) {
      const mix = mixFor(
        request.instance,
        buses.get(request.instance.busId),
        primaryListener(),
        request.emitter
      );
      const accepted = options.runtime().start({
        instanceId: request.instance.id,
        tracks: request.instance.tracks.map((track) => ({
          id: track.id,
          asset: { ...track.asset },
          volume: track.volume,
          pitch: track.pitch,
          loop: track.loop,
          startOffsetMs: track.startOffsetMs
        })),
        volume: mix.volume,
        rate: request.instance.pitch,
        pan: mix.pan,
        delayMs: request.delayMs,
        fadeInMs: request.fadeInMs,
        onEnded(reason) {
          if (instances.delete(request.instance.id)) {
            eventListener?.({ type: "ended", instanceId: request.instance.id, reason });
          }
        }
      });
      if (!accepted) {
        return { accepted: false, reason: "phaser-start-rejected" };
      }
      instances.set(request.instance.id, {
        request: cloneRequest(request),
        pausedByBus: false
      });
      if (request.paused) {
        options.runtime().pause([request.instance.id]);
      }
      return { accepted: true };
    },
    stop(instanceIds, fadeMs) {
      options.runtime().stop(instanceIds, fadeMs);
      if (fadeMs === 0) {
        for (const instanceId of instanceIds) {
          instances.delete(instanceId);
        }
      }
    },
    pause(instanceIds) {
      options.runtime().pause(instanceIds);
      for (const instanceId of instanceIds) {
        const instance = instances.get(instanceId);
        if (instance !== undefined) {
          instance.request.instance.status = "paused";
        }
      }
    },
    resume(instanceIds) {
      options.runtime().resume(instanceIds);
      for (const instanceId of instanceIds) {
        const instance = instances.get(instanceId);
        if (instance !== undefined) {
          instance.request.instance.status = "playing";
        }
      }
    },
    seek(instanceId, positionMs) {
      const seeked = options.runtime().seek(instanceId, positionMs);
      const instance = instances.get(instanceId);
      if (seeked && instance !== undefined) {
        instance.request.instance.positionMs = positionMs;
      }
      return seeked;
    },
    updateInstances(updates) {
      for (const update of updates) {
        const bound = instances.get(update.instanceId);
        if (bound === undefined) {
          continue;
        }
        bound.request.instance = cloneInstance(update.state);
        bound.request.emitter =
          update.emitter === undefined ? undefined : cloneEmitter(update.emitter);
        refreshInstance(update.instanceId, bound, update.transitionMs);
      }
    },
    setBuses(nextBuses) {
      buses.clear();
      for (const bus of nextBuses) {
        buses.set(bus.id, { ...bus });
      }
      refreshInstances();
    },
    setListeners(nextListeners) {
      listeners.clear();
      for (const listener of nextListeners) {
        listeners.set(listener.id, cloneListener(listener));
      }
      refreshInstances();
    },
    setEmitters(nextEmitters) {
      emitters.clear();
      for (const emitter of nextEmitters) {
        emitters.set(emitter.id, cloneEmitter(emitter));
      }
      for (const bound of instances.values()) {
        if (bound.request.instance.emitterId !== undefined) {
          bound.request.emitter = emitters.get(bound.request.instance.emitterId);
        }
      }
      refreshInstances();
    },
    setGlobalParameter(parameterId, value) {
      globalParameters[parameterId] = value;
    },
    unlock() {
      return options.runtime().unlock();
    },
    suspend() {
      if (suspended) {
        return;
      }
      options.runtime().suspend();
      suspended = true;
    },
    resumeOutput() {
      if (!suspended) {
        return;
      }
      options.runtime().resumeOutput();
      suspended = false;
    },
    setEventListener(listener) {
      eventListener = listener;
    },
    snapshot() {
      const runtime = safeRuntimeSnapshot(options.runtime);
      return {
        id: options.id,
        activePlaybackInstances: instances.size,
        nativePlaybackCount: runtime?.nativePlaybackCount ?? 0,
        retainedCommands: 0,
        unlocked: runtime?.unlocked ?? false,
        suspended: runtime?.suspended ?? suspended,
        disposed,
        capabilities: { ...PHASER_AUDIO_CAPABILITIES },
        details: {
          nativeActivePlaybackInstances: runtime?.activePlaybackInstances ?? 0,
          buses: buses.size,
          listeners: listeners.size,
          emitters: emitters.size,
          globalParameters: Object.keys(globalParameters).length
        }
      };
    },
    dispose() {
      if (disposed) {
        return;
      }
      const instanceIds = [...instances.keys()].sort();
      if (instanceIds.length > 0) {
        options.runtime().stop(instanceIds, 0);
      }
      instances.clear();
      buses.clear();
      listeners.clear();
      emitters.clear();
      for (const id of Object.keys(globalParameters)) {
        delete globalParameters[id];
      }
      eventListener = undefined;
      suspended = false;
      disposed = true;
    }
  };

  function primaryListener(): AudioListenerState | undefined {
    return [...listeners.values()].sort(
      (left, right) => right.weight - left.weight || left.id.localeCompare(right.id)
    )[0];
  }

  function refreshInstances(): void {
    let runtime: PhaserDriverAudioRuntime;
    try {
      runtime = options.runtime();
    } catch {
      return;
    }
    for (const [instanceId, instance] of instances) {
      refreshInstance(instanceId, instance, 0, runtime);
    }
  }

  function refreshInstance(
    instanceId: string,
    bound: BoundInstance,
    transitionMs: number,
    runtime = options.runtime()
  ): void {
    const instance = bound.request.instance;
    const bus = buses.get(instance.busId);
    const emitter =
      bound.request.emitter ??
      (instance.emitterId === undefined ? undefined : emitters.get(instance.emitterId));
    const mix = mixFor(instance, bus, primaryListener(), emitter);
    runtime.updateInstance(instanceId, {
      volume: mix.volume,
      rate: instance.pitch,
      pan: mix.pan,
      loop: instance.loop,
      transitionMs,
      tracks: instance.tracks.map(({ id, volume, pitch }) => ({ id, volume, pitch }))
    });
    if (bus?.effectivePaused === true && !bound.pausedByBus) {
      runtime.pause([instanceId]);
      bound.pausedByBus = true;
    } else if (bus?.effectivePaused !== true && bound.pausedByBus) {
      if (instance.status === "playing") {
        runtime.resume([instanceId]);
      }
      bound.pausedByBus = false;
    }
  }
}

function mixFor(
  instance: PlaybackInstanceState,
  bus: AudioBusState | undefined,
  listener: AudioListenerState | undefined,
  emitter: AudioEmitterState | undefined
): { volume: number; pan: number } {
  const busVolume = bus?.effectiveVolume ?? 1;
  const muted = bus?.effectiveMuted ?? false;
  const transform = emitter?.transform ?? instance.transform;
  if (instance.spatial === undefined || transform === undefined || listener === undefined) {
    return { volume: muted ? 0 : instance.volume * busVolume, pan: instance.pan };
  }
  const source = transform.position;
  const target = listener.transform.position;
  const dx = source.x - target.x;
  const dy = source.y - target.y;
  const dz = (source.z ?? 0) - (target.z ?? 0);
  const distance = Math.hypot(dx, dy, dz);
  const attenuation = spatialAttenuation(
    distance,
    instance.spatial.minDistance ?? 0,
    instance.spatial.maxDistance,
    instance.spatial.rolloff ?? "linear",
    instance.spatial.rolloffFactor ?? 1
  );
  return {
    volume: muted ? 0 : instance.volume * busVolume * attenuation,
    pan: clamp(instance.pan + dx / instance.spatial.maxDistance, -1, 1)
  };
}

function spatialAttenuation(
  distance: number,
  minDistance: number,
  maxDistance: number,
  rolloff: "linear" | "inverse" | "exponential",
  factor: number
): number {
  if (distance <= minDistance) {
    return 1;
  }
  if (distance >= maxDistance) {
    return 0;
  }
  const safeMin = Math.max(1, minDistance);
  switch (rolloff) {
    case "linear":
      return clamp(1 - factor * ((distance - minDistance) / (maxDistance - minDistance)), 0, 1);
    case "inverse":
      return clamp(safeMin / (safeMin + factor * (distance - safeMin)), 0, 1);
    case "exponential":
      return clamp(Math.pow(Math.max(distance, safeMin) / safeMin, -factor), 0, 1);
  }
}

function safeRuntimeSnapshot(
  runtime: () => PhaserDriverAudioRuntime
): ReturnType<PhaserDriverAudioRuntime["snapshot"]> | undefined {
  try {
    return runtime().snapshot();
  } catch {
    return undefined;
  }
}

function cloneRequest(request: BackendPlaybackRequest): BackendPlaybackRequest {
  return {
    ...request,
    instance: cloneInstance(request.instance),
    listeners: request.listeners.map(cloneListener),
    ...(request.emitter === undefined ? {} : { emitter: cloneEmitter(request.emitter) })
  };
}

function cloneInstance(instance: PlaybackInstanceState): PlaybackInstanceState {
  return {
    ...instance,
    tracks: instance.tracks.map((track) => ({ ...track, asset: { ...track.asset } })),
    ...(instance.transform === undefined
      ? {}
      : {
          transform: {
            position: { ...instance.transform.position },
            ...(instance.transform.forward === undefined
              ? {}
              : { forward: { ...instance.transform.forward } }),
            ...(instance.transform.up === undefined ? {} : { up: { ...instance.transform.up } })
          }
        }),
    ...(instance.spatial === undefined ? {} : { spatial: { ...instance.spatial } }),
    parameters: { ...instance.parameters },
    tags: [...instance.tags]
  };
}

function cloneListener(listener: AudioListenerState): AudioListenerState {
  return {
    ...listener,
    transform: {
      position: { ...listener.transform.position },
      ...(listener.transform.forward === undefined
        ? {}
        : { forward: { ...listener.transform.forward } }),
      ...(listener.transform.up === undefined ? {} : { up: { ...listener.transform.up } })
    }
  };
}

function cloneEmitter(emitter: AudioEmitterState): AudioEmitterState {
  return {
    ...emitter,
    transform: cloneListener({ id: emitter.id, transform: emitter.transform, weight: 1 }).transform,
    ...(emitter.velocity === undefined ? {} : { velocity: { ...emitter.velocity } })
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
