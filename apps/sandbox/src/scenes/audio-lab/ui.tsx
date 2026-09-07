import type {
  AudioBusId,
  AudioDiagnosticEntry,
  GameAudioEvent,
  GameAudioSnapshot
} from "@gamekits/audio-core";
import {
  createRef,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type RefObject
} from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { AUDIO_LAB_MUSIC_PROGRAMS, type AudioLabMusicId } from "./audio-catalog";
import {
  AUDIO_LAB_DISTANCE_CALIBRATION_POINTS,
  AUDIO_LAB_DISTANCE_OWNER_ID,
  AUDIO_LAB_DISTANCE_SPATIAL,
  AUDIO_LAB_FIELD_EXTENT_METERS,
  AUDIO_LAB_FIELD_OWNER_ID,
  AUDIO_LAB_PAN_OWNER_ID,
  audioGainToDecibels,
  audioLabDistanceGain,
  audioLabSpatialMetrics,
  clampAudioLabSpatialPoint,
  type AudioLabSpatialPoint
} from "./spatial-calibration";

export type AudioLabMixMode = "flat" | "music" | "sfx";

export type AudioLabActions = {
  unlock(): void;
  toggleOutput(): void;
  selectMusic(trackId: AudioLabMusicId, fadeMs: number): void;
  pauseMusic(): void;
  resumeMusic(): void;
  stopMusic(): void;
  setMusicIntensity(value: number): void;
  playWeapon(): void;
  playWeaponBurst(): void;
  playLayeredImpact(): void;
  playUiClick(delayMs?: number): void;
  playDedupePair(): void;
  playDialogue(line: "scout" | "operator"): void;
  enqueueDialogue(line: "scout" | "operator"): void;
  skipDialogue(): void;
  setBusVolume(busId: AudioBusId, volume: number): void;
  toggleBusMute(busId: AudioBusId): void;
  setMixMode(mode: AudioLabMixMode): void;
  toggleStereoPanLoop(): void;
  setStereoPan(value: number): void;
  toggleAutoPan(): void;
  toggleDistanceLoop(): void;
  setDistance(value: number): void;
  toggleSpatialFieldLoop(): void;
  setSpatialFieldListener(point: AudioLabSpatialPoint): void;
  setSpatialFieldEmitter(point: AudioLabSpatialPoint): void;
  resetSpatialField(): void;
};

type AudioLabUiState = {
  hostPhase: string;
  assetLoaded: number;
  assetTotal: number;
  snapshot?: GameAudioSnapshot | undefined;
  diagnostics: AudioDiagnosticEntry[];
  events: GameAudioEvent[];
  notice: string;
  mixMode: AudioLabMixMode;
  autoPan: boolean;
  stereoPan: number;
  distanceMeters: number;
  fieldListener: AudioLabSpatialPoint;
  fieldEmitter: AudioLabSpatialPoint;
};

type AudioLabUiStore = {
  subscribe(listener: () => void): () => void;
  getSnapshot(): AudioLabUiState;
  patch(patch: Partial<AudioLabUiState>): void;
  pushEvent(event: GameAudioEvent): void;
};

export type AudioLabUiHandle = {
  driverRoot: HTMLElement;
  update(input: {
    hostPhase: string;
    assetLoaded: number;
    assetTotal: number;
    snapshot: GameAudioSnapshot;
    diagnostics: AudioDiagnosticEntry[];
    stereoPan: number;
    distanceMeters: number;
    fieldListener: AudioLabSpatialPoint;
    fieldEmitter: AudioLabSpatialPoint;
  }): void;
  pushEvent(event: GameAudioEvent): void;
  setNotice(notice: string): void;
  setMixMode(mode: AudioLabMixMode): void;
  setAutoPan(enabled: boolean): void;
  dispose(): void;
};

const BUS_ORDER: AudioBusId[] = ["master", "music", "sfx", "dialogue"];
const MUSIC_FADE_PRESETS = [250, 900, 2_400] as const;
const OSCILLOSCOPE_BARS = [
  18, 34, 46, 26, 72, 84, 52, 38, 66, 92, 58, 30, 44, 78, 96, 64, 40, 54, 82, 48, 28, 68, 88, 56,
  36, 74, 98, 62, 42, 80, 50, 24
];

export function renderAudioLabUi(
  appElement: HTMLElement,
  actions: AudioLabActions
): AudioLabUiHandle {
  const driverRootRef = createRef<HTMLDivElement>();
  const store = createAudioLabUiStore();
  const root = createRoot(appElement);
  flushSync(() => {
    root.render(<AudioLabConsole actions={actions} driverRootRef={driverRootRef} store={store} />);
  });
  if (!driverRootRef.current) {
    throw new Error("Audio Lab UI did not mount the Phaser driver root");
  }

  return {
    driverRoot: driverRootRef.current,
    update(input) {
      store.patch(input);
    },
    pushEvent(event) {
      store.pushEvent(event);
    },
    setNotice(notice) {
      store.patch({ notice });
    },
    setMixMode(mixMode) {
      store.patch({ mixMode });
    },
    setAutoPan(autoPan) {
      store.patch({ autoPan });
    },
    dispose() {
      root.unmount();
    }
  };
}

function AudioLabConsole(props: {
  actions: AudioLabActions;
  driverRootRef: RefObject<HTMLDivElement>;
  store: AudioLabUiStore;
}) {
  const { actions, driverRootRef, store } = props;
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  const snapshot = state.snapshot;
  const dialogue = snapshot?.dialogue;
  const currentDialogue = dialogue?.current;
  const music = snapshot?.music;
  const [musicFadeMs, setMusicFadeMs] = useState<number>(900);
  const panActive =
    snapshot?.playback.some((instance) => instance.ownerId === AUDIO_LAB_PAN_OWNER_ID) ?? false;
  const distanceActive =
    snapshot?.playback.some((instance) => instance.ownerId === AUDIO_LAB_DISTANCE_OWNER_ID) ??
    false;
  const fieldActive =
    snapshot?.playback.some((instance) => instance.ownerId === AUDIO_LAB_FIELD_OWNER_ID) ?? false;
  const subtitle = currentDialogue ? subtitleFor(currentDialogue.subtitleKey) : "Queue standing by";

  return (
    <main className="audio-lab">
      <header className="audio-lab__masthead">
        <div className="audio-lab__identity">
          <p className="audio-lab__kicker">GameKits / hardware verification deck</p>
          <h1>
            Audio Lab <span>A–03</span>
          </h1>
          <p className="audio-lab__lede">
            One driver. Three content domains. Every active playback stays observable.
          </p>
        </div>
        <div className="audio-lab__system-strip" aria-label="Audio system status">
          <StatusCell label="Host" value={state.hostPhase} active={state.hostPhase === "started"} />
          <StatusCell
            label="Assets"
            value={`${state.assetLoaded}/${state.assetTotal}`}
            active={state.assetTotal > 0 && state.assetLoaded === state.assetTotal}
          />
          <StatusCell
            label="Device"
            value={snapshot?.unlock ?? "booting"}
            active={snapshot?.unlock === "unlocked"}
          />
          <StatusCell
            label="Output"
            value={snapshot?.output ?? "waiting"}
            active={snapshot?.output === "running"}
          />
        </div>
        <div className="audio-lab__master-actions">
          <button
            className="audio-lab__unlock"
            type="button"
            onClick={actions.unlock}
            data-audio-action="unlock"
          >
            <span aria-hidden="true">◉</span>
            Unlock device
          </button>
          <button className="audio-lab__utility" type="button" onClick={actions.toggleOutput}>
            {snapshot?.output === "suspended" ? "Resume output" : "Suspend output"}
          </button>
        </div>
      </header>

      <section className="audio-lab__scope" aria-label="Audio output oscilloscope">
        <div className="audio-lab__driver" ref={driverRootRef} aria-hidden="true" />
        <div className="audio-lab__scope-grid" aria-hidden="true" />
        <div className="audio-lab__wave" aria-hidden="true">
          {OSCILLOSCOPE_BARS.map((height, index) => (
            <i
              key={`${height}-${index}`}
              style={
                { "--bar-height": `${height}%`, "--bar-delay": `${index * -37}ms` } as CSSProperties
              }
            />
          ))}
        </div>
        <div className="audio-lab__scope-readout">
          <span>Logical instances</span>
          <strong>{pad(snapshot?.activePlaybackInstances ?? 0)}</strong>
          <span>Native playback</span>
          <strong>{pad(snapshot?.nativePlaybackCount ?? 0)}</strong>
          <span>Backend</span>
          <strong>{snapshot?.backend.id ?? "—"}</strong>
        </div>
        <p className="audio-lab__notice">{state.notice}</p>
      </section>

      <section className="audio-lab__console-grid">
        <section className="audio-module audio-module--music" data-audio-panel="music">
          <ModuleHeader index="01" eyebrow="Stateful controller" title="Music transport">
            <span className="audio-module__state" data-state={music?.status ?? "stopped"}>
              {music?.status ?? "stopped"}
            </span>
          </ModuleHeader>
          <div className="audio-module__body">
            <div className="audio-track-display">
              <div>
                <span>Current program</span>
                <strong>{shortTrackName(music?.trackId)}</strong>
              </div>
              <time>{formatPosition(music?.positionMs ?? 0)}</time>
            </div>
            <div className="audio-program-grid" aria-label="Music programs">
              {AUDIO_LAB_MUSIC_PROGRAMS.map((program, index) => {
                const active = music?.trackId === program.id;
                return (
                  <button
                    key={program.id}
                    type="button"
                    data-active={active}
                    disabled={active}
                    onClick={() => actions.selectMusic(program.id, musicFadeMs)}
                    data-audio-action={`music-program-${index + 1}`}
                  >
                    <span>0{index + 1}</span>
                    <strong>{program.label}</strong>
                    <small>{program.detail}</small>
                  </button>
                );
              })}
            </div>
            <div className="audio-fade-control">
              <span>Fade profile</span>
              <div>
                {MUSIC_FADE_PRESETS.map((durationMs) => (
                  <button
                    key={durationMs}
                    type="button"
                    data-active={musicFadeMs === durationMs}
                    onClick={() => setMusicFadeMs(durationMs)}
                  >
                    {durationMs < 1_000 ? `${durationMs} ms` : `${durationMs / 1_000} s`}
                  </button>
                ))}
              </div>
            </div>
            <div className="audio-transport audio-transport--compact">
              <button type="button" onClick={actions.pauseMusic} aria-label="Pause music">
                Ⅱ
              </button>
              <button type="button" onClick={actions.resumeMusic} aria-label="Resume music">
                ▶
              </button>
              <button type="button" onClick={actions.stopMusic} aria-label="Stop music">
                ■
              </button>
            </div>
            <LabeledRange
              label="Frontier adaptive stem"
              value={music?.intensity ?? 0}
              onChange={actions.setMusicIntensity}
            />
            <div className="audio-module__annotation">
              <span>Test</span>
              <p>4 stereo loops + selectable 250 / 900 / 2400 ms crossfade</p>
            </div>
          </div>
        </section>

        <section className="audio-module audio-module--sfx" data-audio-panel="sfx">
          <ModuleHeader index="02" eyebrow="Event surface" title="SFX trigger matrix">
            <strong className="audio-module__counter">{pad(snapshot?.sfx.active ?? 0)}</strong>
          </ModuleHeader>
          <div className="audio-pad-grid">
            <AudioPad
              code="SEQ"
              title="Weapon"
              detail="A/B variation"
              onClick={actions.playWeapon}
            />
            <AudioPad
              code="03×"
              title="Burst"
              detail="Concurrency"
              onClick={actions.playWeaponBurst}
            />
            <AudioPad
              code="LYR"
              title="Impact"
              detail="2 native tracks"
              onClick={actions.playLayeredImpact}
            />
            <AudioPad
              code="UI"
              title="Interface"
              detail="sfx/ui bus"
              onClick={() => actions.playUiClick()}
            />
            <AudioPad
              code="+0.5"
              title="Scheduled"
              detail="Delayed start"
              onClick={() => actions.playUiClick(500)}
            />
            <AudioPad
              code="DUP"
              title="Dedupe pair"
              detail="Bounded identity"
              onClick={actions.playDedupePair}
            />
          </div>
          <div className="audio-sfx-stats">
            <Stat label="Rejected" value={snapshot?.sfx.rejected ?? 0} />
            <Stat label="Deduped" value={snapshot?.sfx.deduplicated ?? 0} />
            <Stat label="Culled" value={snapshot?.sfx.distanceCulled ?? 0} />
            <Stat label="Stolen" value={snapshot?.sfx.stoppedForConcurrency ?? 0} />
          </div>
        </section>

        <section className="audio-module audio-module--dialogue" data-audio-panel="dialogue">
          <ModuleHeader index="03" eyebrow="Queued performance" title="Dialogue channel">
            <span className="audio-module__queue">Q {dialogue?.queue.length ?? 0}</span>
          </ModuleHeader>
          <div className="audio-module__body">
            <div className="dialogue-now" data-active={currentDialogue ? "true" : "false"}>
              <div className="dialogue-now__avatar">
                {speakerInitial(currentDialogue?.speakerId)}
              </div>
              <div>
                <span>{speakerName(currentDialogue?.speakerId)}</span>
                <p>{subtitle}</p>
              </div>
              <i aria-hidden="true" />
            </div>
            <div className="dialogue-actions">
              <button type="button" onClick={() => actions.playDialogue("scout")}>
                Play scout
              </button>
              <button type="button" onClick={() => actions.enqueueDialogue("operator")}>
                Queue operator
              </button>
              <button type="button" onClick={() => actions.playDialogue("operator")}>
                Priority replace
              </button>
              <button type="button" onClick={actions.skipDialogue}>
                Skip current
              </button>
            </div>
            <div className="audio-module__annotation">
              <span>Test</span>
              <p>Priority queue + speaker identity + subtitle key + music ducking</p>
            </div>
          </div>
        </section>

        <section className="audio-module audio-module--spatial" data-audio-panel="spatial">
          <ModuleHeader
            index="04"
            eyebrow="Two isolated + one combined"
            title="Spatial calibration"
          >
            <span
              className="audio-module__state"
              data-state={panActive || distanceActive || fieldActive ? "playing" : "stopped"}
            >
              {panActive ? "pan" : distanceActive ? "distance" : fieldActive ? "2d field" : "idle"}
            </span>
          </ModuleHeader>
          <div className="spatial-calibration-grid">
            <StereoPanCalibration
              active={panActive}
              autoPan={state.autoPan}
              pan={state.stereoPan}
              actions={actions}
            />
            <DistanceAttenuationCalibration
              active={distanceActive}
              distanceMeters={state.distanceMeters}
              actions={actions}
            />
            <SpatialFieldCalibration
              active={fieldActive}
              listener={state.fieldListener}
              emitter={state.fieldEmitter}
              actions={actions}
            />
          </div>
        </section>

        <section className="audio-module audio-module--mix" data-audio-panel="mix">
          <ModuleHeader index="05" eyebrow="Hierarchical buses" title="Mix desk">
            <span className="audio-module__queue">{state.mixMode}</span>
          </ModuleHeader>
          <div className="mix-snapshots" role="group" aria-label="Mix snapshots">
            {(["flat", "music", "sfx"] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                data-active={state.mixMode === mode ? "true" : "false"}
                onClick={() => actions.setMixMode(mode)}
              >
                {mode === "flat" ? "Flat" : `${mode.toUpperCase()} focus`}
              </button>
            ))}
          </div>
          <div className="mix-channels">
            {BUS_ORDER.map((busId) => {
              const bus = snapshot?.mix.buses.find((candidate) => candidate.id === busId);
              return (
                <div className="mix-channel" key={busId} data-muted={bus?.muted ? "true" : "false"}>
                  <span>{busId}</span>
                  <strong>{Math.round((bus?.effectiveVolume ?? 1) * 100)}</strong>
                  <input
                    aria-label={`${busId} bus volume`}
                    type="range"
                    min="0"
                    max="1"
                    step="0.01"
                    value={bus?.volume ?? 1}
                    onChange={(event) =>
                      actions.setBusVolume(busId, Number(event.currentTarget.value))
                    }
                  />
                  <button type="button" onClick={() => actions.toggleBusMute(busId)}>
                    {bus?.muted ? "ON" : "M"}
                  </button>
                </div>
              );
            })}
          </div>
        </section>

        <section className="audio-module audio-module--telemetry" data-audio-panel="telemetry">
          <ModuleHeader index="06" eyebrow="Observable lifecycle" title="Signal ledger">
            <span className="audio-module__queue">{state.diagnostics.length} diag</span>
          </ModuleHeader>
          <div className="signal-ledger">
            <div className="signal-ledger__column">
              <span className="signal-ledger__label">Playback events</span>
              <ol>
                {state.events.length === 0 ? (
                  <li className="signal-ledger__empty">Waiting for a control input.</li>
                ) : (
                  state.events.slice(0, 7).map((event) => (
                    <li key={`${event.sequence}-${event.type}`}>
                      <time>{formatPosition(event.timestamp)}</time>
                      <strong>{event.type}</strong>
                      <span>{event.sourceId ?? event.instanceId}</span>
                    </li>
                  ))
                )}
              </ol>
            </div>
            <div className="signal-ledger__column">
              <span className="signal-ledger__label">Core diagnostics</span>
              <ol>
                {state.diagnostics
                  .slice(-7)
                  .reverse()
                  .map((entry) => (
                    <li key={`${entry.sequence}-${entry.type}`}>
                      <time>{formatPosition(entry.timestamp)}</time>
                      <strong>{entry.type.replace("audio.", "")}</strong>
                      <span>{diagnosticDetail(entry)}</span>
                    </li>
                  ))}
              </ol>
            </div>
          </div>
        </section>
      </section>
    </main>
  );
}

function StereoPanCalibration(props: {
  active: boolean;
  autoPan: boolean;
  pan: number;
  actions: AudioLabActions;
}) {
  const panPosition = ((props.pan + 1) / 2) * 100;
  return (
    <section className="spatial-calibration-card" data-active={props.active ? "true" : "false"}>
      <header className="spatial-calibration-card__header">
        <span>A</span>
        <div>
          <p>Constant gain</p>
          <h3>Stereo pan</h3>
        </div>
        <strong>{props.active ? "LIVE" : "READY"}</strong>
      </header>
      <div className="pan-calibration-stage" aria-label="Constant-gain stereo pan field">
        <div className="calibration-axis" />
        <span className="calibration-axis-label calibration-axis-label--left">L −1.00</span>
        <span className="calibration-axis-label calibration-axis-label--right">+1.00 R</span>
        <div className="pan-calibration-stage__center" title="Acoustic center">
          C
        </div>
        <div
          className="pan-calibration-stage__cursor"
          style={{ "--pan-position": `${panPosition}%` } as CSSProperties}
          title={`Pan ${formatSigned(props.pan)}`}
        >
          <i />P
        </div>
      </div>
      <div className="spatial-calibration-readout spatial-calibration-readout--two">
        <div>
          <span>Pan</span>
          <strong>{formatSigned(props.pan)}</strong>
        </div>
        <div>
          <span>Gain</span>
          <strong>100.0%</strong>
        </div>
      </div>
      <label className="calibration-range">
        <span>Stereo position</span>
        <input
          aria-label="Stereo pan position"
          type="range"
          min="-1"
          max="1"
          step="0.01"
          value={props.pan}
          onChange={(event) => props.actions.setStereoPan(Number(event.currentTarget.value))}
        />
      </label>
      <div className="spatial-actions">
        <button type="button" onClick={props.actions.toggleStereoPanLoop}>
          {props.active ? "Stop pan tone" : "Start pan tone"}
        </button>
        <button type="button" onClick={props.actions.toggleAutoPan} aria-pressed={props.autoPan}>
          {props.autoPan ? "Stop sweep" : "Auto sweep"}
        </button>
      </div>
      <p className="spatial-calibration-note">
        Distance attenuation is bypassed; only the native stereo pan value changes.
      </p>
    </section>
  );
}

function DistanceAttenuationCalibration(props: {
  active: boolean;
  distanceMeters: number;
  actions: AudioLabActions;
}) {
  const gain = audioLabDistanceGain(props.distanceMeters);
  const decibels = audioGainToDecibels(gain);
  const distancePosition = 8 + (props.distanceMeters / AUDIO_LAB_DISTANCE_SPATIAL.maxDistance) * 84;
  return (
    <section className="spatial-calibration-card" data-active={props.active ? "true" : "false"}>
      <header className="spatial-calibration-card__header">
        <span>B</span>
        <div>
          <p>Front axis</p>
          <h3>Distance attenuation</h3>
        </div>
        <strong>{props.active ? "LIVE" : "READY"}</strong>
      </header>
      <div className="distance-calibration-stage" aria-label="Distance attenuation field">
        <div className="calibration-axis" />
        <div className="distance-calibration-stage__listener" title="Listener at 0 metres">
          L
        </div>
        <div
          className="distance-calibration-stage__emitter"
          style={
            {
              "--distance-position": `${distancePosition}%`,
              "--distance-gain": Math.max(0.18, gain)
            } as CSSProperties
          }
          title={`Emitter at ${props.distanceMeters.toFixed(1)} metres`}
        >
          <i />E
        </div>
        <span className="calibration-axis-label calibration-axis-label--left">0 m</span>
        <span className="calibration-axis-label calibration-axis-label--right">
          {AUDIO_LAB_DISTANCE_SPATIAL.maxDistance} m
        </span>
      </div>
      <div className="spatial-calibration-readout">
        <div>
          <span>Distance</span>
          <strong>{props.distanceMeters.toFixed(1)} m</strong>
        </div>
        <div>
          <span>Linear gain</span>
          <strong>{formatGain(gain)}</strong>
        </div>
        <div>
          <span>Level</span>
          <strong>{formatDecibels(decibels)}</strong>
        </div>
      </div>
      <label className="calibration-range">
        <span>Emitter distance</span>
        <input
          aria-label="Emitter distance"
          type="range"
          min="0"
          max={AUDIO_LAB_DISTANCE_SPATIAL.maxDistance}
          step="0.1"
          value={props.distanceMeters}
          onChange={(event) => props.actions.setDistance(Number(event.currentTarget.value))}
        />
      </label>
      <div
        className="distance-calibration-presets"
        role="group"
        aria-label="Distance calibration points"
      >
        {AUDIO_LAB_DISTANCE_CALIBRATION_POINTS.map((distance) => {
          const calibrationGain = audioLabDistanceGain(distance);
          return (
            <button
              key={distance}
              type="button"
              aria-label={`Set distance to ${distance} metres: ${formatGain(calibrationGain)} gain`}
              aria-pressed={Math.abs(props.distanceMeters - distance) < 0.05}
              onClick={() => props.actions.setDistance(distance)}
            >
              <strong>{distance} m</strong>
              <span>{formatGain(calibrationGain)}</span>
            </button>
          );
        })}
      </div>
      <div className="spatial-actions spatial-actions--single">
        <button type="button" onClick={props.actions.toggleDistanceLoop}>
          {props.active ? "Stop distance tone" : "Start distance tone"}
        </button>
      </div>
      <table className="distance-calibration-table">
        <caption>Linear rolloff calibration</caption>
        <thead>
          <tr>
            <th scope="col">Distance</th>
            <th scope="col">Gain</th>
            <th scope="col">Level</th>
          </tr>
        </thead>
        <tbody>
          {AUDIO_LAB_DISTANCE_CALIBRATION_POINTS.map((distance) => {
            const calibrationGain = audioLabDistanceGain(distance);
            return (
              <tr key={distance}>
                <th scope="row">{distance} m</th>
                <td>{formatGain(calibrationGain)}</td>
                <td>{formatDecibels(audioGainToDecibels(calibrationGain))}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}

function SpatialFieldCalibration(props: {
  active: boolean;
  listener: AudioLabSpatialPoint;
  emitter: AudioLabSpatialPoint;
  actions: AudioLabActions;
}) {
  const dragTarget = useRef<"listener" | "emitter">();
  const metrics = audioLabSpatialMetrics(props.listener, props.emitter);
  const listenerPosition = spatialStagePosition(props.listener);
  const emitterPosition = spatialStagePosition(props.emitter);
  const moveEmitter = (point: AudioLabSpatialPoint) => props.actions.setSpatialFieldEmitter(point);
  return (
    <section
      className="spatial-calibration-card spatial-calibration-card--field"
      data-active={props.active ? "true" : "false"}
    >
      <header className="spatial-calibration-card__header">
        <span>C</span>
        <div>
          <p>Combined projection</p>
          <h3>2D listener / emitter field</h3>
        </div>
        <strong>{props.active ? "LIVE" : "READY"}</strong>
      </header>
      <div className="spatial-field-layout">
        <div
          className="spatial-field-stage"
          aria-label="Two-dimensional spatial audio field. Click to move the emitter."
          onPointerDown={(event) => {
            const target =
              event.target instanceof Element
                ? event.target.closest("[data-spatial-field-node]")
                : null;
            dragTarget.current =
              target?.getAttribute("data-spatial-field-node") === "listener"
                ? "listener"
                : "emitter";
            event.currentTarget.setPointerCapture(event.pointerId);
            moveSpatialFieldTarget(
              dragTarget.current,
              spatialPointFromPointer(event, event.currentTarget),
              props.actions
            );
          }}
          onPointerMove={(event) => {
            if (dragTarget.current && event.currentTarget.hasPointerCapture(event.pointerId)) {
              moveSpatialFieldTarget(
                dragTarget.current,
                spatialPointFromPointer(event, event.currentTarget),
                props.actions
              );
            }
          }}
          onMouseMove={(event) => {
            if (dragTarget.current && event.buttons === 1) {
              moveSpatialFieldTarget(
                dragTarget.current,
                spatialPointFromPointer(event, event.currentTarget),
                props.actions
              );
            }
          }}
          onMouseUp={() => {
            dragTarget.current = undefined;
          }}
          onPointerUp={(event) => {
            dragTarget.current = undefined;
            if (event.currentTarget.hasPointerCapture(event.pointerId)) {
              event.currentTarget.releasePointerCapture(event.pointerId);
            }
          }}
          onPointerCancel={(event) => {
            dragTarget.current = undefined;
            if (event.currentTarget.hasPointerCapture(event.pointerId)) {
              event.currentTarget.releasePointerCapture(event.pointerId);
            }
          }}
        >
          <span className="spatial-field-stage__direction spatial-field-stage__direction--front">
            FRONT / +Y
          </span>
          <span className="spatial-field-stage__direction spatial-field-stage__direction--rear">
            REAR / −Y
          </span>
          <span className="spatial-field-stage__direction spatial-field-stage__direction--left">
            L / −X
          </span>
          <span className="spatial-field-stage__direction spatial-field-stage__direction--right">
            +X / R
          </span>
          <div
            className="spatial-field-stage__range spatial-field-stage__range--max"
            style={{ left: `${listenerPosition.x}%`, top: `${listenerPosition.y}%` }}
            aria-hidden="true"
          />
          <div
            className="spatial-field-stage__range spatial-field-stage__range--min"
            style={{ left: `${listenerPosition.x}%`, top: `${listenerPosition.y}%` }}
            aria-hidden="true"
          />
          <svg
            className="spatial-field-stage__vector"
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            aria-hidden="true"
          >
            <line
              x1={listenerPosition.x}
              y1={listenerPosition.y}
              x2={emitterPosition.x}
              y2={emitterPosition.y}
            />
          </svg>
          <SpatialFieldNode
            kind="listener"
            label="L"
            point={props.listener}
            onChange={props.actions.setSpatialFieldListener}
          />
          <SpatialFieldNode
            kind="emitter"
            label="E"
            point={props.emitter}
            gain={metrics.gain}
            onChange={moveEmitter}
          />
        </div>
        <div className="spatial-field-console">
          <div className="spatial-field-coordinate-pair">
            <FieldMetric
              label="Listener"
              value={`${formatSignedMeters(props.listener.x)} / ${formatSignedMeters(props.listener.y)}`}
            />
            <FieldMetric
              label="Emitter"
              value={`${formatSignedMeters(props.emitter.x)} / ${formatSignedMeters(props.emitter.y)}`}
            />
          </div>
          <div className="spatial-field-readout">
            <FieldMetric label="Distance" value={`${metrics.distanceMeters.toFixed(2)} m`} />
            <FieldMetric label="Pan" value={formatSigned(metrics.pan)} />
            <FieldMetric label="Gain" value={formatGain(metrics.gain)} />
            <FieldMetric label="Level" value={formatDecibels(metrics.decibels)} />
            <FieldMetric
              label="Bearing"
              value={`${formatSignedDegrees(metrics.bearingDegrees)} ${bearingLabel(metrics.bearingDegrees)}`}
            />
            <FieldMetric
              label="Delta x / y"
              value={`${formatSignedMeters(metrics.deltaX)} / ${formatSignedMeters(metrics.deltaY)}`}
            />
          </div>
          <div className="spatial-field-presets" role="group" aria-label="Emitter positions">
            {(
              [
                ["Front", { x: props.listener.x, y: props.listener.y + 6 }],
                ["Right", { x: props.listener.x + 6, y: props.listener.y }],
                ["Rear", { x: props.listener.x, y: props.listener.y - 6 }],
                ["Left", { x: props.listener.x - 6, y: props.listener.y }]
              ] as const
            ).map(([label, point]) => (
              <button
                key={label}
                type="button"
                onClick={() => moveEmitter(clampAudioLabSpatialPoint(point))}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="spatial-actions spatial-actions--field">
            <button type="button" onClick={props.actions.toggleSpatialFieldLoop}>
              {props.active ? "Stop 2D field" : "Start 2D field"}
            </button>
            <button type="button" onClick={props.actions.resetSpatialField}>
              Reset positions
            </button>
          </div>
          <p className="spatial-calibration-note">
            Drag L or E; click the plane to move E. Euclidean distance drives gain while Δx projects
            to stereo pan. The outer ring marks the 12 m silence boundary.
          </p>
        </div>
      </div>
    </section>
  );
}

function SpatialFieldNode(props: {
  kind: "listener" | "emitter";
  label: string;
  point: AudioLabSpatialPoint;
  gain?: number;
  onChange(point: AudioLabSpatialPoint): void;
}) {
  const position = spatialStagePosition(props.point);
  return (
    <button
      className={`spatial-field-node spatial-field-node--${props.kind}`}
      data-spatial-field-node={props.kind}
      type="button"
      aria-label={`${props.kind} at x ${props.point.x.toFixed(1)}, y ${props.point.y.toFixed(1)} metres`}
      style={
        {
          left: `${position.x}%`,
          top: `${position.y}%`,
          "--field-node-gain": props.gain ?? 1
        } as CSSProperties
      }
      onKeyDown={(event) => moveSpatialNodeFromKeyboard(event, props.point, props.onChange)}
    >
      <i aria-hidden="true" />
      <span>{props.label}</span>
    </button>
  );
}

function moveSpatialFieldTarget(
  target: "listener" | "emitter",
  point: AudioLabSpatialPoint,
  actions: AudioLabActions
): void {
  if (target === "listener") {
    actions.setSpatialFieldListener(point);
  } else {
    actions.setSpatialFieldEmitter(point);
  }
}

function FieldMetric(props: { label: string; value: string }) {
  return (
    <div>
      <span>{props.label}</span>
      <strong>{props.value}</strong>
    </div>
  );
}

function spatialStagePosition(point: AudioLabSpatialPoint): { x: number; y: number } {
  return {
    x: 50 + (point.x / AUDIO_LAB_FIELD_EXTENT_METERS) * 42,
    y: 50 - (point.y / AUDIO_LAB_FIELD_EXTENT_METERS) * 42
  };
}

function spatialPointFromPointer(
  event: { clientX: number; clientY: number },
  stage: HTMLElement
): AudioLabSpatialPoint {
  const bounds = stage.getBoundingClientRect();
  const normalizedX = (event.clientX - bounds.left) / Math.max(1, bounds.width);
  const normalizedY = (event.clientY - bounds.top) / Math.max(1, bounds.height);
  return clampAudioLabSpatialPoint({
    x: ((normalizedX - 0.5) / 0.42) * AUDIO_LAB_FIELD_EXTENT_METERS,
    y: ((0.5 - normalizedY) / 0.42) * AUDIO_LAB_FIELD_EXTENT_METERS
  });
}

function moveSpatialNodeFromKeyboard(
  event: ReactKeyboardEvent<HTMLButtonElement>,
  point: AudioLabSpatialPoint,
  onChange: (point: AudioLabSpatialPoint) => void
): void {
  const delta = event.shiftKey ? 1 : 0.5;
  const changes: Partial<Record<typeof event.key, AudioLabSpatialPoint>> = {
    ArrowLeft: { x: point.x - delta, y: point.y },
    ArrowRight: { x: point.x + delta, y: point.y },
    ArrowUp: { x: point.x, y: point.y + delta },
    ArrowDown: { x: point.x, y: point.y - delta }
  };
  const next = changes[event.key];
  if (next) {
    event.preventDefault();
    onChange(clampAudioLabSpatialPoint(next));
  }
}

function ModuleHeader(props: {
  index: string;
  eyebrow: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <header className="audio-module__header">
      <span className="audio-module__index">{props.index}</span>
      <div>
        <p>{props.eyebrow}</p>
        <h2>{props.title}</h2>
      </div>
      <div className="audio-module__header-status">{props.children}</div>
    </header>
  );
}

function StatusCell(props: { label: string; value: string; active: boolean }) {
  return (
    <div className="audio-status-cell" data-active={props.active ? "true" : "false"}>
      <span>{props.label}</span>
      <strong>{props.value}</strong>
    </div>
  );
}

function AudioPad(props: { code: string; title: string; detail: string; onClick(): void }) {
  return (
    <button className="audio-pad" type="button" onClick={props.onClick}>
      <span>{props.code}</span>
      <strong>{props.title}</strong>
      <small>{props.detail}</small>
    </button>
  );
}

function LabeledRange(props: { label: string; value: number; onChange(value: number): void }) {
  return (
    <label className="audio-range">
      <span>{props.label}</span>
      <strong>{Math.round(props.value * 100)}%</strong>
      <input
        type="range"
        min="0"
        max="1"
        step="0.01"
        value={props.value}
        onChange={(event) => props.onChange(Number(event.currentTarget.value))}
      />
    </label>
  );
}

function Stat(props: { label: string; value: number }) {
  return (
    <div>
      <span>{props.label}</span>
      <strong>{pad(props.value)}</strong>
    </div>
  );
}

function createAudioLabUiStore(): AudioLabUiStore {
  let state: AudioLabUiState = {
    hostPhase: "registered",
    assetLoaded: 0,
    assetTotal: 0,
    diagnostics: [],
    events: [],
    notice: "Booting the shared Phaser audio runtime…",
    mixMode: "flat",
    autoPan: false,
    stereoPan: 0,
    distanceMeters: 6,
    fieldListener: { x: 0, y: 0 },
    fieldEmitter: { x: -6, y: 6 }
  };
  const listeners = new Set<() => void>();
  const publish = () => {
    for (const listener of listeners) {
      listener();
    }
  };
  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot: () => state,
    patch(patch) {
      state = { ...state, ...patch };
      publish();
    },
    pushEvent(event) {
      state = { ...state, events: [{ ...event }, ...state.events].slice(0, 24) };
      publish();
    }
  };
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function formatSigned(value: number): string {
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}`;
}

function formatSignedMeters(value: number): string {
  return `${value >= 0 ? "+" : ""}${value.toFixed(1)}m`;
}

function formatSignedDegrees(value: number): string {
  return `${value >= 0 ? "+" : ""}${value.toFixed(0)}°`;
}

function bearingLabel(value: number): string {
  const absolute = Math.abs(value);
  if (absolute <= 22.5) {
    return "FRONT";
  }
  if (absolute >= 157.5) {
    return "REAR";
  }
  if (value > 0) {
    return value < 67.5 ? "FR" : value < 112.5 ? "RIGHT" : "RR";
  }
  return value > -67.5 ? "FL" : value > -112.5 ? "LEFT" : "RL";
}

function formatGain(gain: number): string {
  return `${(gain * 100).toFixed(1)}%`;
}

function formatDecibels(decibels: number): string {
  return Number.isFinite(decibels) ? `${decibels.toFixed(1)} dB` : "−∞ dB";
}

function formatPosition(positionMs: number): string {
  const seconds = Math.max(0, positionMs) / 1_000;
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes).padStart(2, "0")}:${(seconds % 60).toFixed(1).padStart(4, "0")}`;
}

function shortTrackName(trackId: string | undefined): string {
  if (!trackId) {
    return "No program loaded";
  }
  return (
    AUDIO_LAB_MUSIC_PROGRAMS.find((program) => program.id === trackId)?.label ?? "Unknown program"
  );
}

function speakerName(speakerId: string | undefined): string {
  if (speakerId === "speaker.scout") {
    return "Scout / channel 04";
  }
  if (speakerId === "speaker.operator") {
    return "Operator / priority 10";
  }
  return "No active speaker";
}

function speakerInitial(speakerId: string | undefined): string {
  return speakerId === "speaker.operator" ? "O" : speakerId === "speaker.scout" ? "S" : "—";
}

function subtitleFor(subtitleKey: string | undefined): string {
  if (subtitleKey === "audio-lab.scout.check-in") {
    return "[Radio synthesis] Scout checking the perimeter.";
  }
  if (subtitleKey === "audio-lab.operator-response") {
    return "[Radio synthesis] Operator confirms the signal.";
  }
  return subtitleKey ?? "Audio line playing";
}

function diagnosticDetail(entry: AudioDiagnosticEntry): string {
  const values = Object.values(entry.payload);
  return values.length === 0 ? "core" : values.slice(0, 2).map(String).join(" · ");
}
