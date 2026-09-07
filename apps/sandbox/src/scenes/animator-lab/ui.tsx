import type { DevToolsRuntime } from "@gamekits/devtools";
import { DevToolsOverlay } from "@gamekits/devtools-ui";
import { GameKitsUiShell, UiFocusBridge } from "@gamekits/react-ui";
import type { UiRuntime } from "@gamekits/ui-core";
import { createRef, type ReactNode, type RefObject } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root as ReactRoot } from "react-dom/client";
import type { AnimatorLabController, AnimatorLabSnapshot } from "./runtime";

export type AnimatorLabUi = {
  uiRuntime: UiRuntime;
  stageRoot: HTMLElement;
  devtoolsRoot: HTMLElement;
  bind(controller: AnimatorLabController): void;
  update(snapshot: AnimatorLabSnapshot): void;
  mountDevTools(runtime: DevToolsRuntime): void;
  dispose(): void;
};

export function renderAnimatorLabUi(rootElement: HTMLElement, uiRuntime: UiRuntime): AnimatorLabUi {
  const reactRoot = createRoot(rootElement);
  const shellRef = createRef<HTMLElement>();
  const stageRef = createRef<HTMLDivElement>();
  const devtoolsRef = createRef<HTMLDivElement>();
  let controller: AnimatorLabController | undefined;
  let snapshot: AnimatorLabSnapshot | undefined;
  let devtoolsReactRoot: ReactRoot | undefined;

  const invoke = (action: (value: AnimatorLabController) => void): void => {
    if (!controller) {
      return;
    }
    action(controller);
    snapshot = controller.snapshot();
    render();
  };

  const render = (): void => {
    reactRoot.render(
      <AnimatorLabView
        uiRuntime={uiRuntime}
        shellRef={shellRef}
        stageRef={stageRef}
        devtoolsRef={devtoolsRef}
        snapshot={snapshot}
        invoke={invoke}
      />
    );
  };

  flushSync(render);
  if (!stageRef.current || !devtoolsRef.current) {
    throw new Error("Animator Lab UI did not create its mount targets");
  }

  return {
    uiRuntime,
    stageRoot: stageRef.current,
    devtoolsRoot: devtoolsRef.current,
    bind(nextController) {
      controller = nextController;
      snapshot = nextController.snapshot();
      render();
    },
    update(nextSnapshot) {
      snapshot = nextSnapshot;
      render();
    },
    mountDevTools(runtime) {
      devtoolsReactRoot ??= createRoot(devtoolsRef.current!);
      devtoolsReactRoot.render(<DevToolsOverlay runtime={runtime} uiRuntime={uiRuntime} />);
    },
    dispose() {
      devtoolsReactRoot?.unmount();
      reactRoot.unmount();
    }
  };
}

function AnimatorLabView({
  uiRuntime,
  shellRef,
  stageRef,
  devtoolsRef,
  snapshot,
  invoke
}: {
  uiRuntime: UiRuntime;
  shellRef: RefObject<HTMLElement>;
  stageRef: RefObject<HTMLDivElement>;
  devtoolsRef: RefObject<HTMLDivElement>;
  snapshot: AnimatorLabSnapshot | undefined;
  invoke(action: (controller: AnimatorLabController) => void): void;
}) {
  const layers = snapshot?.frame?.layers ?? [];
  const controllerLayers = snapshot?.controller?.layers ?? [];
  const phaseProgress = snapshot?.phaseProgress ?? 0.64;
  const status = snapshot?.running ? "CHANNEL LIVE" : "BOOTING";

  return (
    <GameKitsUiShell
      runtime={uiRuntime}
      className="animator-lab-ui"
      density="compact"
      theme="animator-lab"
    >
      <UiFocusBridge runtime={uiRuntime} gameViewportRef={stageRef} uiRootRef={shellRef} />
      <section className="animator-lab" ref={shellRef}>
        <header className="animator-lab__header">
          <div className="animator-lab__wordmark">
            <span className="animator-lab__eyebrow">GK / SYSTEM VERIFICATION 05</span>
            <h1>MOTION BAY</h1>
            <p>Animator graph, layered playback, one-shot policy, marker and phase probe.</p>
          </div>
          <div className="animator-lab__status" data-ready={snapshot?.running ?? false}>
            <i aria-hidden="true" />
            <span>{status}</span>
            <small>GEN {String(snapshot?.generation ?? 0).padStart(2, "0")}</small>
          </div>
          <div className="animator-lab__header-readout">
            <span>ADAPTER FRAMES</span>
            <strong>{String(snapshot?.runtime.adapter.appliedFrames ?? 0).padStart(5, "0")}</strong>
          </div>
        </header>

        <main className="animator-lab__workspace">
          <section className="animator-lab__stage-card" data-ui-panel="sandbox.animator-lab.stage">
            <div className="animator-lab__panel-heading">
              <span>01 / PLAYBACK WINDOW</span>
              <div>
                <b>BODY</b>
                <b>ACTION</b>
              </div>
            </div>
            <div className="animator-lab__viewport-wrap">
              <div
                className="animator-lab__viewport"
                ref={stageRef}
                tabIndex={0}
                aria-label="Animator Lab Phaser playback viewport"
              />
              <div className="animator-lab__reticle" aria-hidden="true">
                <span />
                <span />
              </div>
              <div className="animator-lab__stage-label animator-lab__stage-label--top">
                SIGNAL RUNNER / R-01
              </div>
              <div className="animator-lab__stage-label animator-lab__stage-label--bottom">
                <span>GRAPH</span>
                <strong>{describeLocomotion(snapshot)}</strong>
              </div>
              <div className="animator-lab__stage-grid" aria-hidden="true" />
            </div>
            <div className="animator-lab__notice" aria-live="polite">
              <span>LAST COMMAND</span>
              <strong>{snapshot?.notice ?? "Booting motion channel…"}</strong>
            </div>
            <div className="animator-lab__layer-strip">
              {["locomotion", "action"].map((layerId) => {
                const frame = layers.find((candidate) => candidate.layerId === layerId);
                const controllerLayer = controllerLayers.find(
                  (candidate) => candidate.layerId === layerId
                );
                return (
                  <div key={layerId} data-kind={frame?.kind ?? "state"}>
                    <span>{layerId.toUpperCase()}</span>
                    <strong>
                      {shortClip(frame?.clipId ?? controllerLayer?.stateId ?? "waiting")}
                    </strong>
                    <small>
                      {frame
                        ? `${frame.kind} · ${Math.round(frame.normalizedTime * 100)}%${frame.seek ? " · seek" : ""}`
                        : "awaiting frame"}
                    </small>
                  </div>
                );
              })}
            </div>
          </section>

          <aside className="animator-lab__controls" data-ui-panel="sandbox.animator-lab.controls">
            <div className="animator-lab__panel-heading">
              <span>02 / TEST CONTROLS</span>
              <b>MANUAL</b>
            </div>

            <ControlSection number="A" title="Graph parameter">
              <div className="animator-lab__range-readout">
                <label htmlFor="animator-lab-speed">SPEED</label>
                <output>{(snapshot?.speed ?? 0).toFixed(2)}</output>
              </div>
              <input
                id="animator-lab-speed"
                type="range"
                min="0"
                max="1"
                step="0.01"
                value={snapshot?.speed ?? 0}
                disabled={!snapshot?.running}
                onChange={(event) =>
                  invoke((value) => value.setSpeed(event.currentTarget.valueAsNumber))
                }
              />
              <div className="animator-lab__segmented">
                <button type="button" onClick={() => invoke((value) => value.setSpeed(0))}>
                  IDLE
                </button>
                <button type="button" onClick={() => invoke((value) => value.setSpeed(0.42))}>
                  RUN
                </button>
                <button type="button" onClick={() => invoke((value) => value.setSpeed(0.92))}>
                  SPRINT
                </button>
              </div>
            </ControlSection>

            <ControlSection number="B" title="One-shot policy">
              <div className="animator-lab__button-grid">
                <button type="button" onClick={() => invoke((value) => value.triggerFire())}>
                  <span>FIRE</span>
                  <small>priority 10</small>
                </button>
                <button type="button" onClick={() => invoke((value) => value.triggerBurst())}>
                  <span>BURST ×3</span>
                  <small>queue-one</small>
                </button>
                <button
                  type="button"
                  className="animator-lab__danger-button"
                  onClick={() => invoke((value) => value.triggerHit())}
                >
                  <span>HIT REACTION</span>
                  <small>interrupt / 30</small>
                </button>
              </div>
            </ControlSection>

            <ControlSection number="C" title="Gameplay phase authority">
              <div className="animator-lab__range-readout">
                <label htmlFor="animator-lab-phase">RESTORE POINT</label>
                <output>{Math.round(phaseProgress * 100)}%</output>
              </div>
              <input
                id="animator-lab-phase"
                type="range"
                min="0"
                max="1"
                step="0.01"
                value={phaseProgress}
                disabled={!snapshot?.running}
                onChange={(event) =>
                  invoke((value) => value.seekGameplayPhase(event.currentTarget.valueAsNumber))
                }
              />
              <button
                type="button"
                className="animator-lab__wide-button"
                onClick={() => invoke((value) => value.cancelGameplayPhase())}
              >
                RELEASE PHASE AUTHORITY
              </button>
            </ControlSection>

            <div className="animator-lab__control-footer">
              <button
                type="button"
                data-active={snapshot?.auto ?? false}
                onClick={() => invoke((value) => value.toggleAuto())}
              >
                {snapshot?.auto ? "PAUSE AUTO RUN" : "RUN AUTO CHECK"}
              </button>
              <button type="button" onClick={() => invoke((value) => value.resetGeneration())}>
                RESET GEN
              </button>
            </div>
          </aside>

          <aside className="animator-lab__telemetry" data-ui-panel="sandbox.animator-lab.telemetry">
            <div className="animator-lab__panel-heading">
              <span>03 / SIGNAL LEDGER</span>
              <b>LIVE</b>
            </div>
            <div className="animator-lab__metrics">
              <Metric label="ONE-SHOTS" value={snapshot?.runtime.activeOneShots ?? 0} />
              <Metric label="QUEUED" value={snapshot?.runtime.queuedOneShots ?? 0} />
              <Metric label="PHASES" value={snapshot?.runtime.activeGameplayPhases ?? 0} />
              <Metric label="MARKERS" value={snapshot?.runtime.emittedMarkers ?? 0} />
            </div>

            <Ledger title="Marker receiver" empty="No marker crossed yet.">
              {[...(snapshot?.markers ?? [])]
                .reverse()
                .slice(0, 5)
                .map((marker) => (
                  <li key={marker.id} data-kind="marker">
                    <time>{formatTime(marker.timestamp)}</time>
                    <strong>{marker.markerId}</strong>
                    <small>{shortClip(marker.clipId)}</small>
                  </li>
                ))}
            </Ledger>

            <Ledger title="Animator trace" empty="Waiting for runtime trace.">
              {[...(snapshot?.traces ?? [])]
                .reverse()
                .slice(0, 6)
                .map((trace) => (
                  <li key={trace.sequence} data-kind={trace.kind}>
                    <time>{String(trace.sequence).padStart(3, "0")}</time>
                    <strong>{trace.label.replace("animator.", "")}</strong>
                    <small>{trace.kind}</small>
                  </li>
                ))}
            </Ledger>
          </aside>
        </main>

        <section className="animator-lab__devtools">
          <div className="animator-lab__devtools-heading">
            <span>FRAMEWORK DIAGNOSTICS</span>
            <small>Standard Driver / Asset / Renderer / Game / Animator sources</small>
          </div>
          <div ref={devtoolsRef} />
        </section>
      </section>
    </GameKitsUiShell>
  );
}

function ControlSection({
  number,
  title,
  children
}: {
  number: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="animator-lab__control-section">
      <header>
        <span>{number}</span>
        <strong>{title}</strong>
      </header>
      {children}
    </section>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <span>{label}</span>
      <strong>{String(value).padStart(2, "0")}</strong>
    </div>
  );
}

function Ledger({ title, empty, children }: { title: string; empty: string; children: ReactNode }) {
  const entries = Array.isArray(children) ? children : [children];
  return (
    <section className="animator-lab__ledger">
      <h2>{title}</h2>
      <ol>{entries.length > 0 ? children : <li className="animator-lab__empty">{empty}</li>}</ol>
    </section>
  );
}

function describeLocomotion(snapshot: AnimatorLabSnapshot | undefined): string {
  const layer = snapshot?.controller?.layers.find(
    (candidate) => candidate.layerId === "locomotion"
  );
  return layer?.stateId.toUpperCase() ?? "WAITING";
}

function shortClip(clipId: string): string {
  return clipId.split(".").at(-1)?.toUpperCase() ?? clipId.toUpperCase();
}

function formatTime(timestamp: number): string {
  return `${(timestamp / 1000).toFixed(2)}s`;
}
