import type { GameAudio, PlaybackHandle, SfxPlayResult } from "@gamekits/audio-core";
import { createConfiguredAppHost } from "@gamekits/app-host";
import { audioLabAppDefinition } from "./app-definition";
import { AUDIO_LAB_IDS, AUDIO_LAB_MUSIC_PROGRAMS } from "./audio-catalog";
import { createAudioLabAssetBundle } from "./audio-assets";
import { createAudioLabWebProfile, type AudioLabAppContext } from "./app-profile";
import {
  AUDIO_LAB_DISTANCE_EMITTER_ID,
  AUDIO_LAB_DISTANCE_OWNER_ID,
  AUDIO_LAB_DISTANCE_SPATIAL,
  AUDIO_LAB_FIELD_EMITTER_ID,
  AUDIO_LAB_FIELD_OWNER_ID,
  AUDIO_LAB_PAN_OWNER_ID,
  audioLabDistanceGain,
  audioLabSpatialMetrics,
  clampAudioLabSpatialPoint,
  type AudioLabSpatialPoint
} from "./spatial-calibration";
import {
  renderAudioLabUi,
  type AudioLabActions,
  type AudioLabMixMode,
  type AudioLabUiHandle
} from "./ui";
import "./styles.css";

const AUDIO_LAB_LISTENER_ID = "audio-lab.listener";
const DEFAULT_DISTANCE_METERS = 6;
const DEFAULT_FIELD_LISTENER = { x: 0, y: 0 } as const satisfies AudioLabSpatialPoint;
const DEFAULT_FIELD_EMITTER = { x: -6, y: 6 } as const satisfies AudioLabSpatialPoint;

export async function mount(root: HTMLElement): Promise<void> {
  const bundle = createAudioLabAssetBundle();
  let context: AudioLabAppContext | undefined;
  let ui: AudioLabUiHandle | undefined;
  let audio: GameAudio | undefined;
  let panLoop: PlaybackHandle | undefined;
  let distanceLoop: PlaybackHandle | undefined;
  let fieldLoop: PlaybackHandle | undefined;
  let activeMixSnapshot: string | undefined;
  let autoPan = false;
  let stereoPan = 0;
  let distanceMeters = DEFAULT_DISTANCE_METERS;
  let fieldListener: AudioLabSpatialPoint = DEFAULT_FIELD_LISTENER;
  let fieldEmitter: AudioLabSpatialPoint = DEFAULT_FIELD_EMITTER;
  let dedupeSequence = 0;
  let disposed = false;
  let frameHandle = 0;
  let lastTime: number | undefined;
  let lastUiUpdate = 0;
  const pendingTimers = new Set<number>();

  const actions: AudioLabActions = {
    unlock() {
      runUnlocked("Audio device unlocked", () => undefined);
    },
    toggleOutput() {
      const instance = requireAudio();
      if (instance.snapshot().output === "suspended") {
        instance.resume();
        requireUi().setNotice("Backend output resumed; manually paused instances stay paused.");
      } else {
        instance.suspend();
        requireUi().setNotice("Backend output suspended without disposing logical instances.");
      }
    },
    selectMusic(trackId, fadeMs) {
      const instance = requireAudio();
      const state = instance.music.getState();
      const target = musicProgramName(trackId);
      if (state.status !== "stopped" && state.trackId === trackId) {
        requireUi().setNotice(`${target} is already the current program.`);
        return;
      }
      const durationMs = Math.max(0, Math.round(fadeMs));
      const current = musicProgramName(state.trackId);
      const notice =
        state.status === "stopped"
          ? `${target} fade-in scheduled (${durationMs} ms)`
          : `Crossfade scheduled: ${current} → ${target} (${durationMs} ms)`;
      runUnlocked(notice, (unlockedAudio) => {
        if (unlockedAudio.music.getState().status === "stopped") {
          unlockedAudio.music.play(trackId, { fadeInMs: durationMs });
          return;
        }
        unlockedAudio.music.transitionTo(trackId, {
          type: "crossfade",
          durationMs
        });
      });
    },
    pauseMusic() {
      requireAudio().music.pause();
      requireUi().setNotice("Music instance paused through MusicPlayer.");
    },
    resumeMusic() {
      runUnlocked("Music instance resumed through MusicPlayer", (instance) => {
        instance.music.resume();
      });
    },
    stopMusic() {
      requireAudio().music.stop({ fadeMs: 350 });
      requireUi().setNotice("Music stopped with a 350 ms fade.");
    },
    setMusicIntensity(value) {
      requireAudio().music.setIntensity(value, 180);
      requireUi().setNotice(`Adaptive music intensity set to ${Math.round(value * 100)}%.`);
    },
    playWeapon() {
      runUnlocked("Sequential weapon variation triggered", (instance) => {
        reportSfxResult(instance.sfx.play(AUDIO_LAB_IDS.sfx.weapon, { ownerId: "audio-lab" }));
      });
    },
    playWeaponBurst() {
      runUnlocked("Five-shot burst exercising a three-instance concurrency group", (instance) => {
        for (let index = 0; index < 5; index += 1) {
          schedule(() => {
            reportSfxResult(
              instance.sfx.play(AUDIO_LAB_IDS.sfx.weapon, {
                ownerId: "audio-lab.burst",
                priority: index
              }),
              false
            );
          }, index * 45);
        }
      });
    },
    playLayeredImpact() {
      runUnlocked("One logical impact started two native tracks", (instance) => {
        reportSfxResult(instance.sfx.play(AUDIO_LAB_IDS.sfx.impact));
      });
    },
    playUiClick(delayMs = 0) {
      runUnlocked(
        delayMs > 0 ? "UI click scheduled 500 ms ahead" : "UI click routed through sfx/ui",
        (instance) => {
          reportSfxResult(instance.sfx.play(AUDIO_LAB_IDS.sfx.ui, { delayMs }));
        }
      );
    },
    playDedupePair() {
      runUnlocked(
        "Duplicate SFX identity submitted twice; the second request should dedupe",
        (instance) => {
          dedupeSequence += 1;
          const dedupeKey = `audio-lab.dedupe.${dedupeSequence}`;
          reportSfxResult(instance.sfx.play(AUDIO_LAB_IDS.sfx.weapon, { dedupeKey }), false);
          reportSfxResult(instance.sfx.play(AUDIO_LAB_IDS.sfx.weapon, { dedupeKey }), false);
        }
      );
    },
    playDialogue(line) {
      runUnlocked(
        line === "operator"
          ? "Priority operator line replaced the current dialogue"
          : "Scout dialogue started on the dialogue bus",
        (instance) => {
          const dialogue = requireDialogue(instance);
          dialogue.play(AUDIO_LAB_IDS.dialogue[line], {
            interrupt: line === "operator" ? "replace-current" : "queue"
          });
        }
      );
    },
    enqueueDialogue(line) {
      runUnlocked(`${line} line added to the priority queue`, (instance) => {
        requireDialogue(instance).enqueue(AUDIO_LAB_IDS.dialogue[line]);
      });
    },
    skipDialogue() {
      const dialogue = requireDialogue(requireAudio());
      const skipped = dialogue.skipCurrent();
      const next = dialogue.getState().current;
      requireUi().setNotice(
        !skipped
          ? "No active dialogue to skip."
          : next === undefined
            ? "Current dialogue skipped; playback stopped immediately."
            : `Current dialogue skipped; now playing ${next.lineId}.`
      );
    },
    setBusVolume(busId, volume) {
      requireAudio().mix.setBus(busId, { volume }, 80);
      requireUi().setNotice(`${busId} bus target volume: ${Math.round(volume * 100)}%.`);
    },
    toggleBusMute(busId) {
      const instance = requireAudio();
      const muted = !(instance.mix.getBus(busId)?.muted ?? false);
      instance.mix.setBus(busId, { muted });
      requireUi().setNotice(`${busId} bus ${muted ? "muted" : "unmuted"}.`);
    },
    setMixMode(mode) {
      setMixMode(mode);
    },
    toggleStereoPanLoop() {
      if (panLoop?.getState()) {
        panLoop.stop();
        panLoop = undefined;
        autoPan = false;
        requireUi().setAutoPan(false);
        requireUi().setNotice("Stereo pan tone stopped immediately.");
        return;
      }
      distanceLoop?.stop();
      distanceLoop = undefined;
      fieldLoop?.stop();
      fieldLoop = undefined;
      setListenerPosition(DEFAULT_FIELD_LISTENER);
      runUnlocked("Stereo pan tone started at a constant 100% gain", (instance) => {
        const result = instance.sfx.play(AUDIO_LAB_IDS.sfx.beacon, {
          ownerId: AUDIO_LAB_PAN_OWNER_ID,
          loop: true,
          pan: stereoPan,
          fadeInMs: 150
        });
        if (result.status === "playing" || result.status === "scheduled") {
          panLoop = result.handle;
        }
        reportSfxResult(result, false);
      });
    },
    setStereoPan(value) {
      autoPan = false;
      requireUi().setAutoPan(false);
      updateStereoPan(value);
      refreshUi();
      requireUi().setNotice(`Stereo pan set to ${formatSigned(stereoPan)} at 100% gain.`);
    },
    toggleAutoPan() {
      autoPan = !autoPan;
      requireUi().setAutoPan(autoPan);
      requireUi().setNotice(autoPan ? "Constant-gain pan sweep enabled." : "Pan sweep stopped.");
    },
    toggleDistanceLoop() {
      if (distanceLoop?.getState()) {
        distanceLoop.stop();
        distanceLoop = undefined;
        requireUi().setNotice("Distance attenuation tone stopped immediately.");
        return;
      }
      panLoop?.stop();
      panLoop = undefined;
      fieldLoop?.stop();
      fieldLoop = undefined;
      autoPan = false;
      requireUi().setAutoPan(false);
      setListenerPosition(DEFAULT_FIELD_LISTENER);
      runUnlocked(distanceNotice("Distance tone started"), (instance) => {
        const result = instance.sfx.play(AUDIO_LAB_IDS.sfx.beacon, {
          emitterId: AUDIO_LAB_DISTANCE_EMITTER_ID,
          ownerId: AUDIO_LAB_DISTANCE_OWNER_ID,
          loop: true,
          fadeInMs: 150
        });
        if (result.status === "playing" || result.status === "scheduled") {
          distanceLoop = result.handle;
        }
        reportSfxResult(result, false);
      });
    },
    setDistance(value) {
      updateDistance(value);
      refreshUi();
      requireUi().setNotice(distanceNotice("Emitter distance updated"));
    },
    toggleSpatialFieldLoop() {
      if (fieldLoop?.getState()) {
        fieldLoop.stop();
        fieldLoop = undefined;
        setListenerPosition(DEFAULT_FIELD_LISTENER);
        requireUi().setNotice("2D spatial field tone stopped immediately.");
        refreshUi();
        return;
      }
      panLoop?.stop();
      panLoop = undefined;
      distanceLoop?.stop();
      distanceLoop = undefined;
      autoPan = false;
      requireUi().setAutoPan(false);
      syncSpatialField();
      runUnlocked(spatialFieldNotice("2D field tone started"), (instance) => {
        const result = instance.sfx.play(AUDIO_LAB_IDS.sfx.spatialField, {
          emitterId: AUDIO_LAB_FIELD_EMITTER_ID,
          ownerId: AUDIO_LAB_FIELD_OWNER_ID,
          loop: true,
          fadeInMs: 150
        });
        if (result.status === "playing" || result.status === "scheduled") {
          fieldLoop = result.handle;
        }
        reportSfxResult(result, false);
      });
    },
    setSpatialFieldListener(point) {
      fieldListener = clampAudioLabSpatialPoint(point);
      if (fieldLoop?.getState()) {
        setListenerPosition(fieldListener);
      }
      refreshUi();
      requireUi().setNotice(spatialFieldNotice("Listener moved"));
    },
    setSpatialFieldEmitter(point) {
      fieldEmitter = clampAudioLabSpatialPoint(point);
      requireAudio().spatial.setEmitter({
        id: AUDIO_LAB_FIELD_EMITTER_ID,
        transform: { position: fieldEmitter }
      });
      refreshUi();
      requireUi().setNotice(spatialFieldNotice("Emitter moved"));
    },
    resetSpatialField() {
      fieldListener = DEFAULT_FIELD_LISTENER;
      fieldEmitter = DEFAULT_FIELD_EMITTER;
      if (fieldLoop?.getState()) {
        syncSpatialField();
      } else {
        requireAudio().spatial.setEmitter({
          id: AUDIO_LAB_FIELD_EMITTER_ID,
          transform: { position: fieldEmitter }
        });
      }
      refreshUi();
      requireUi().setNotice(spatialFieldNotice("2D field reset"));
    }
  };

  ui = renderAudioLabUi(root, actions);
  context = { driverRoot: ui.driverRoot };
  const configured = createConfiguredAppHost({
    app: audioLabAppDefinition,
    profile: createAudioLabWebProfile(bundle),
    context
  });
  const { host } = configured;
  audio = requireContextAudio(context);
  const unsubscribe = audio.subscribe((event) => requireUi().pushEvent(event));

  refreshUi();
  await host.boot();
  audio.spatial.setListener({
    id: AUDIO_LAB_LISTENER_ID,
    transform: { position: { x: 0, y: 0 } },
    weight: 1
  });
  audio.spatial.setEmitter({
    id: AUDIO_LAB_DISTANCE_EMITTER_ID,
    transform: { position: { x: 0, y: distanceMeters } }
  });
  audio.spatial.setEmitter({
    id: AUDIO_LAB_FIELD_EMITTER_ID,
    transform: { position: fieldEmitter }
  });
  await host.start();
  ui.setNotice("Ready. Any sound control can unlock the browser audio device.");
  refreshUi();

  function frame(now: number): void {
    if (disposed) {
      return;
    }
    const delta = lastTime === undefined ? 0 : Math.max(0, Math.min(now - lastTime, 64));
    lastTime = now;
    host.tick(delta, now);
    if (autoPan) {
      updateStereoPan(Math.sin(now / 1_250));
    }
    if (now - lastUiUpdate >= 1000 / 12) {
      lastUiUpdate = now;
      refreshUi();
    }
    frameHandle = requestAnimationFrame(frame);
  }

  frameHandle = requestAnimationFrame(frame);

  const dispose = (): void => {
    if (disposed) {
      return;
    }
    disposed = true;
    cancelAnimationFrame(frameHandle);
    for (const timer of pendingTimers) {
      window.clearTimeout(timer);
    }
    pendingTimers.clear();
    unsubscribe();
    panLoop?.stop();
    distanceLoop?.stop();
    fieldLoop?.stop();
    void host.dispose().finally(() => {
      bundle.dispose();
      ui?.dispose();
    });
  };

  window.addEventListener("pagehide", dispose, { once: true });

  function refreshUi(): void {
    const instance = requireAudio();
    const manager = context?.assets;
    const states = manager?.states() ?? [];
    requireUi().update({
      hostPhase: host.snapshot().phase,
      assetLoaded: states.filter((state) => state.status === "loaded").length,
      assetTotal: states.length,
      snapshot: instance.snapshot(),
      diagnostics: instance.diagnostics(),
      stereoPan,
      distanceMeters,
      fieldListener,
      fieldEmitter
    });
  }

  function runUnlocked(notice: string, action: (instance: GameAudio) => void): void {
    const instance = requireAudio();
    void instance
      .unlock()
      .then((unlocked) => {
        if (!unlocked) {
          requireUi().setNotice(
            "Browser audio unlock was rejected. Click Unlock device and try again."
          );
          return;
        }
        action(instance);
        requireUi().setNotice(notice);
        refreshUi();
      })
      .catch((error: unknown) => {
        requireUi().setNotice(error instanceof Error ? error.message : String(error));
      });
  }

  function reportSfxResult(result: SfxPlayResult, updateNotice = true): void {
    if (!updateNotice) {
      return;
    }
    const notice =
      result.status === "rejected"
        ? `SFX rejected: ${result.reason}`
        : result.status === "deduplicated"
          ? "SFX request deduplicated."
          : `SFX ${result.status}: ${result.handle.id}`;
    requireUi().setNotice(notice);
  }

  function updateStereoPan(value: number): void {
    stereoPan = Math.max(-1, Math.min(1, value));
    panLoop?.set({ pan: stereoPan });
  }

  function updateDistance(value: number): void {
    distanceMeters = Math.max(0, Math.min(AUDIO_LAB_DISTANCE_SPATIAL.maxDistance, value));
    requireAudio().spatial.setEmitter({
      id: AUDIO_LAB_DISTANCE_EMITTER_ID,
      transform: { position: { x: 0, y: distanceMeters } }
    });
  }

  function distanceNotice(prefix: string): string {
    const gain = audioLabDistanceGain(distanceMeters);
    return `${prefix}: ${distanceMeters.toFixed(1)} m → ${(gain * 100).toFixed(1)}% linear gain.`;
  }

  function setListenerPosition(position: AudioLabSpatialPoint): void {
    requireAudio().spatial.setListener({
      id: AUDIO_LAB_LISTENER_ID,
      transform: { position },
      weight: 1
    });
  }

  function syncSpatialField(): void {
    setListenerPosition(fieldListener);
    requireAudio().spatial.setEmitter({
      id: AUDIO_LAB_FIELD_EMITTER_ID,
      transform: { position: fieldEmitter }
    });
  }

  function spatialFieldNotice(prefix: string): string {
    const metrics = audioLabSpatialMetrics(fieldListener, fieldEmitter);
    return `${prefix}: ${metrics.distanceMeters.toFixed(1)} m · pan ${formatSigned(metrics.pan)} · ${(metrics.gain * 100).toFixed(1)}% gain.`;
  }

  function setMixMode(mode: AudioLabMixMode): void {
    const instance = requireAudio();
    if (activeMixSnapshot) {
      instance.mix.deactivateSnapshot(activeMixSnapshot, 180);
      activeMixSnapshot = undefined;
    }
    if (mode !== "flat") {
      const snapshotId =
        mode === "music" ? AUDIO_LAB_IDS.snapshots.musicFocus : AUDIO_LAB_IDS.snapshots.sfxFocus;
      activeMixSnapshot = instance.mix.activateSnapshot(snapshotId, { fadeMs: 180 });
    }
    requireUi().setMixMode(mode);
    requireUi().setNotice(
      `${mode === "flat" ? "Flat" : `${mode.toUpperCase()} focus`} mix selected.`
    );
  }

  function schedule(action: () => void, delayMs: number): void {
    const timer = window.setTimeout(() => {
      pendingTimers.delete(timer);
      if (!disposed) {
        action();
      }
    }, delayMs);
    pendingTimers.add(timer);
  }

  function requireAudio(): GameAudio {
    if (!audio) {
      throw new Error("Audio Lab GameAudio service is unavailable");
    }
    return audio;
  }

  function requireUi(): AudioLabUiHandle {
    if (!ui) {
      throw new Error("Audio Lab UI is unavailable");
    }
    return ui;
  }
}

function requireContextAudio(context: AudioLabAppContext): GameAudio {
  if (!context.audio) {
    throw new Error("Audio Lab profile did not expose the GameAudio service");
  }
  return context.audio;
}

function requireDialogue(audio: GameAudio) {
  if (!audio.dialogue) {
    throw new Error("Audio Lab requires the DialoguePlayer facade");
  }
  return audio.dialogue;
}

function formatSigned(value: number): string {
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}`;
}

function musicProgramName(trackId: string | undefined): string {
  return (
    AUDIO_LAB_MUSIC_PROGRAMS.find((program) => program.id === trackId)?.label ??
    (trackId ? "Unknown program" : "Silence")
  );
}
