import type { DevToolsRuntime } from "@gamekits/devtools";
import { DevToolsOverlay } from "@gamekits/devtools-ui";
import { GameKitsUiShell, UiFocusBridge } from "@gamekits/react-ui";
import type { UiRuntime } from "@gamekits/ui-core";
import { createRef } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root as ReactRoot } from "react-dom/client";
import {
  NAVIGATION_LAB_DEBUG_LAYERS,
  type NavigationLabBackendDebugView,
  type NavigationLabDebugLayerId
} from "./backends";
import { drawNavigationLab, navigationLabCanvasPoint } from "./canvas";
import {
  NAVIGATION_LAB_PROFILES,
  NAVIGATION_LAB_UNITS,
  type NavigationLabScenarioDefinition
} from "./scenario";
import type { NavigationLabScenarioPresentation } from "./scenarios";
import type {
  NavigationLabController,
  NavigationLabPointMode,
  NavigationLabSnapshot
} from "./types";

type NavigationLabAction =
  | "path"
  | "field"
  | "repeat"
  | "cost-cap"
  | "cancel"
  | "burst"
  | "stress"
  | "stress-stop"
  | "release"
  | "freeze"
  | "gate"
  | "swamp"
  | "portal"
  | "lockdown"
  | "unsupported"
  | "reset";

export type NavigationLabUi = {
  root: HTMLElement;
  reactRoot: ReactRoot;
  uiRuntime: UiRuntime;
  canvas: HTMLCanvasElement;
  status: HTMLElement;
  notice: HTMLElement;
  backendState: HTMLElement;
  traceList: HTMLOListElement;
  profileButtons: HTMLButtonElement[];
  pointModeButtons: HTMLButtonElement[];
  actionButtons: HTMLButtonElement[];
  scenarioButtons: HTMLButtonElement[];
  backendButtons: HTMLButtonElement[];
  backendDebugState: HTMLElement;
  backendDebugButtons: HTMLButtonElement[];
  backendDebugViews: ReadonlyMap<string, NavigationLabBackendDebugView>;
  backendPresentations: ReadonlyMap<string, NavigationLabScenarioPresentation["backends"][number]>;
  overlayButton: HTMLButtonElement;
  stressCount: HTMLSelectElement;
  devtoolsRoot: HTMLElement;
  devtoolsReactRoot?: ReactRoot | undefined;
  showNavigationOverlay: boolean;
  backendDebugLayers: Set<NavigationLabDebugLayerId>;
  lastSnapshot?: NavigationLabSnapshot | undefined;
};

export type NavigationLabUiBindings = {
  scene(): NavigationLabController;
  selectScenario(scenarioId: string): Promise<void>;
  selectBackend(backendId: string): Promise<void>;
};

const PRIMARY_ORDERS = [
  ["path", "Send Unit", "One unit follows a complete point path"],
  ["field", "Rally Party", "Shared field or per-unit backend paths"]
] as const satisfies ReadonlyArray<readonly [NavigationLabAction, string, string]>;

const QA_ACTIONS = [
  ["repeat", "Repeat Last Order", "Positive or negative cache probe"],
  ["cost-cap", "Set Cost Limit 8", "Explicit cost-limit failure"],
  ["cancel", "Cancel Before Start", "Cancel before backend submission"],
  ["burst", "Queue 18 Orders", "Exercise request budgets and fairness"],
  ["release", "Release Route", "Release retained route ownership"],
  ["unsupported", "Weather-front Probe", "Unsupported custom obstacle capability"]
] as const satisfies ReadonlyArray<readonly [NavigationLabAction, string, string]>;

export function renderNavigationLabUi(
  rootElement: HTMLElement,
  uiRuntime: UiRuntime,
  scenarios: readonly NavigationLabScenarioPresentation[]
): NavigationLabUi {
  const initialScenario = scenarios[0];
  if (!initialScenario) {
    throw new Error("Navigation Lab requires at least one scenario");
  }
  const initialDefinition = initialScenario.definition;
  const backends = [
    ...new Map(
      scenarios.flatMap((scenario) =>
        scenario.backends.map((backend) => [backend.id, backend] as const)
      )
    ).values()
  ];
  const canvasRef = createRef<HTMLCanvasElement>();
  const uiRootRef = createRef<HTMLElement>();
  const root = createRoot(rootElement);

  flushSync(() => {
    root.render(
      <GameKitsUiShell
        runtime={uiRuntime}
        className="navigation-lab-ui"
        density="compact"
        theme="navigation-lab"
      >
        <UiFocusBridge runtime={uiRuntime} gameViewportRef={canvasRef} uiRootRef={uiRootRef} />
        <section className="navigation-lab" ref={uiRootRef}>
          <header className="navigation-lab__header">
            <div className="navigation-lab__title-block">
              <span data-ui="navigation-campaign-label">{initialDefinition.campaignLabel}</span>
              <h1 data-ui="navigation-scenario-title">{initialDefinition.title}</h1>
              <p data-ui="navigation-scenario-mission">{initialDefinition.mission}</p>
              <div
                className="navigation-lab__scenario-options"
                role="group"
                aria-label="Navigation test scenario"
              >
                {scenarios.map((scenario) => (
                  <button
                    type="button"
                    data-nav-scenario={scenario.definition.id}
                    key={scenario.definition.id}
                    disabled
                  >
                    <span>{scenario.definition.title}</span>
                    <small>{scenario.definition.complexity}</small>
                  </button>
                ))}
              </div>
            </div>
            <div className="navigation-lab__backend-switcher">
              <div className="navigation-lab__section-kicker">
                <span>Navigation backend</span>
                <small data-ui="navigation-backend-state">starting…</small>
              </div>
              <div
                className="navigation-lab__backend-options"
                role="group"
                aria-label="Navigation backend"
              >
                {backends.map((backend) => (
                  <button type="button" data-nav-backend={backend.id} key={backend.id} disabled>
                    <i aria-hidden="true" />
                    <span>
                      <strong>{backend.label}</strong>
                      <small>{backend.technology}</small>
                    </span>
                  </button>
                ))}
              </div>
              <p>Scenario and backend both rebuild one isolated App Host session.</p>
            </div>
            <div className="navigation-lab__status" data-ui="navigation-status">
              <i aria-hidden="true" />
              <span>preparing map</span>
            </div>
          </header>

          <main className="navigation-lab__workspace">
            <section
              className="navigation-lab__map-card"
              data-ui-panel="sandbox.navigation-lab.map"
            >
              <div className="navigation-lab__map-toolbar">
                <div>
                  <span>Field map</span>
                  <strong data-ui="navigation-map-prompt">{initialDefinition.mapPrompt}</strong>
                </div>
                <div className="navigation-lab__map-tools">
                  <div
                    className="navigation-lab__point-modes"
                    role="group"
                    aria-label="Map click mode"
                  >
                    {[
                      ["probe", "Inspect"],
                      ["start", "Departure"],
                      ["goal", "Destination"]
                    ].map(([mode, label]) => (
                      <button type="button" data-nav-point-mode={mode} key={mode} disabled>
                        {label}
                      </button>
                    ))}
                  </div>
                  <button
                    type="button"
                    className="navigation-lab__overlay-toggle"
                    data-nav-ui-action="overlay"
                    disabled
                  >
                    Route overlay
                  </button>
                </div>
              </div>
              <div className="navigation-lab__debug-toolbar">
                <div className="navigation-lab__debug-heading">
                  <span>Draw backend data</span>
                  <strong data-ui="navigation-backend-debug-state">Preparing topology…</strong>
                </div>
                <div
                  className="navigation-lab__debug-layers"
                  role="group"
                  aria-label="Backend navigation data layers"
                >
                  {NAVIGATION_LAB_DEBUG_LAYERS.map((layer) => (
                    <button
                      type="button"
                      data-nav-debug-layer={layer.id}
                      aria-pressed="false"
                      title={layer.description}
                      key={layer.id}
                      disabled
                    >
                      <i aria-hidden="true" />
                      <span>
                        <strong>{layer.label}</strong>
                        <small>{layer.description}</small>
                      </span>
                    </button>
                  ))}
                </div>
              </div>
              <div className="navigation-lab__canvas-wrap">
                <canvas
                  ref={canvasRef}
                  tabIndex={0}
                  data-ui="navigation-canvas"
                  aria-label={`${initialDefinition.title} game terrain`}
                />
                <div className="navigation-lab__mission-card" aria-hidden="true">
                  <span>Objective</span>
                  <strong data-ui="navigation-objective-title">
                    {initialDefinition.objectiveTitle}
                  </strong>
                  <small data-ui="navigation-objective-detail">
                    {initialDefinition.objectiveDetail}
                  </small>
                </div>
                <div className="navigation-lab__terrain-state" aria-label="Terrain state">
                  <span data-ui="navigation-bridge-state">
                    {initialDefinition.controls.bridge.openState}
                  </span>
                  <span data-ui="navigation-marsh-state">
                    {initialDefinition.controls.marsh.normalState}
                  </span>
                  <span data-ui="navigation-waystone-state">
                    {initialDefinition.controls.portal.disabledState}
                  </span>
                </div>
              </div>
              <div
                className="navigation-lab__notice"
                aria-live="polite"
                data-ui="navigation-notice"
              >
                Preparing the field map…
              </div>
            </section>

            <aside
              className="navigation-lab__orders"
              data-ui-panel="sandbox.navigation-lab.controls"
            >
              <section className="navigation-lab__order-section navigation-lab__order-section--roster">
                <div className="navigation-lab__section-kicker">
                  <span>Choose unit</span>
                  <small>clearance changes the route</small>
                </div>
                <div className="navigation-lab__unit-list">
                  {NAVIGATION_LAB_PROFILES.map((profile) => {
                    const unit = NAVIGATION_LAB_UNITS[profile.id];
                    return (
                      <button type="button" data-nav-profile={profile.id} key={profile.id} disabled>
                        <b aria-hidden="true">{unit.marker}</b>
                        <span>
                          <strong>{unit.label}</strong>
                          <small>{unit.description}</small>
                        </span>
                        <em>R {profile.radius.toFixed(2)}</em>
                      </button>
                    );
                  })}
                </div>
              </section>

              <section className="navigation-lab__order-section navigation-lab__order-section--primary">
                <div className="navigation-lab__section-kicker">
                  <span>Issue order</span>
                  <small>same calls for every backend</small>
                </div>
                <div className="navigation-lab__primary-orders">
                  {PRIMARY_ORDERS.map(([action, label, detail]) => (
                    <button type="button" data-nav-action={action} key={action} disabled>
                      <strong>{label}</strong>
                      <small>{detail}</small>
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  className="navigation-lab__hold-button"
                  data-nav-action="freeze"
                  disabled
                >
                  Hold / resume party
                </button>
              </section>

              <section className="navigation-lab__order-section navigation-lab__order-section--world">
                <div className="navigation-lab__section-kicker">
                  <span>Change the world</span>
                  <small>live topology updates</small>
                </div>
                <div className="navigation-lab__world-actions">
                  {scenarioWorldActions(initialDefinition).map(([action, label, detail]) => (
                    <button type="button" data-nav-action={action} key={action} disabled>
                      <strong data-nav-action-label={action}>{label}</strong>
                      <small data-nav-action-detail={action}>{detail}</small>
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  className="navigation-lab__reset"
                  data-nav-action="reset"
                  disabled
                >
                  <span data-ui="navigation-reset-label">
                    {initialDefinition.controls.resetLabel}
                  </span>
                </button>
              </section>

              <details className="navigation-lab__qa">
                <summary>
                  <span>Navigation QA tools</span>
                  <small>cache · budget · lifecycle</small>
                </summary>
                <div className="navigation-lab__stress-test">
                  <div>
                    <span>Live unit limit</span>
                    <small>one shared field · sampling + steering · 4 ms budget</small>
                  </div>
                  <label>
                    <span>Units</span>
                    <select data-nav-stress-count defaultValue="1000" disabled>
                      {[100, 500, 1000, 1500, 2000, 2500, 5000, 10_000, 20_000].map((count) => (
                        <option value={count} key={count}>
                          {count.toLocaleString()}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div className="navigation-lab__stress-actions">
                    <button type="button" data-nav-action="stress" disabled>
                      <strong>Start live load</strong>
                      <small>Continuously loop every unit to the goal</small>
                    </button>
                    <button type="button" data-nav-action="stress-stop" disabled>
                      Stop
                    </button>
                  </div>
                  <p data-ui="navigation-stress">idle</p>
                  <small>Canvas markers are sampled so rendering does not define the result.</small>
                </div>
                <div className="navigation-lab__qa-actions">
                  {QA_ACTIONS.map(([action, label, detail]) => (
                    <button type="button" data-nav-action={action} key={action} disabled>
                      <strong>{label}</strong>
                      <small>{detail}</small>
                    </button>
                  ))}
                </div>
              </details>
            </aside>
          </main>

          <footer className="navigation-lab__telemetry">
            <section className="navigation-lab__mission-readout">
              <div className="navigation-lab__section-kicker">
                <span>Mission readout</span>
                <small>player-facing result</small>
              </div>
              <p>
                <span>Order</span>
                <strong data-ui="navigation-result">No route order</strong>
              </p>
              <p>
                <span>Map inspect</span>
                <strong data-ui="navigation-projection">Choose Inspect, then click terrain</strong>
              </p>
              <p>
                <span>Queue test</span>
                <strong data-ui="navigation-burst">idle</strong>
              </p>
            </section>
            <section className="navigation-lab__metrics">
              <div className="navigation-lab__section-kicker">
                <span>Navigation telemetry</span>
                <small>bounded public snapshot</small>
              </div>
              <div className="navigation-lab__metric-grid">
                <Metric label="revision" name="revision" />
                <Metric label="pending" name="pending" />
                <Metric label="queued" name="queued" />
                <Metric label="routes" name="routes" />
                <Metric label="cache" name="cache" />
                <Metric label="fields" name="fields" />
                <Metric label="party" name="agents" />
                <Metric label="stuck" name="stuck" />
              </div>
            </section>
            <section className="navigation-lab__trace" data-ui-panel="sandbox.navigation-lab.trace">
              <div className="navigation-lab__section-kicker">
                <span>Recent route facts</span>
                <small>public trace</small>
              </div>
              <ol data-ui="navigation-traces" />
            </section>
          </footer>
        </section>
        <div className="navigation-lab__devtools" data-ui="navigation-devtools" />
      </GameKitsUiShell>
    );
  });

  return {
    root: rootElement,
    reactRoot: root,
    uiRuntime,
    canvas: readElement(rootElement, "navigation-canvas", HTMLCanvasElement),
    status: readElement(rootElement, "navigation-status", HTMLElement),
    notice: readElement(rootElement, "navigation-notice", HTMLElement),
    backendState: readElement(rootElement, "navigation-backend-state", HTMLElement),
    traceList: readElement(rootElement, "navigation-traces", HTMLOListElement),
    profileButtons: [...rootElement.querySelectorAll<HTMLButtonElement>("[data-nav-profile]")],
    pointModeButtons: [...rootElement.querySelectorAll<HTMLButtonElement>("[data-nav-point-mode]")],
    actionButtons: [...rootElement.querySelectorAll<HTMLButtonElement>("[data-nav-action]")],
    scenarioButtons: [...rootElement.querySelectorAll<HTMLButtonElement>("[data-nav-scenario]")],
    backendButtons: [...rootElement.querySelectorAll<HTMLButtonElement>("[data-nav-backend]")],
    backendDebugState: readElement(rootElement, "navigation-backend-debug-state", HTMLElement),
    backendDebugButtons: [
      ...rootElement.querySelectorAll<HTMLButtonElement>("[data-nav-debug-layer]")
    ],
    backendDebugViews: new Map(
      scenarios.flatMap((scenario) =>
        scenario.backends.map(
          (backend) =>
            [presentationKey(scenario.definition.id, backend.id), backend.debugView] as const
        )
      )
    ),
    backendPresentations: new Map(
      scenarios.flatMap((scenario) =>
        scenario.backends.map(
          (backend) => [presentationKey(scenario.definition.id, backend.id), backend] as const
        )
      )
    ),
    overlayButton: rootElement.querySelector<HTMLButtonElement>("[data-nav-ui-action='overlay']")!,
    stressCount: rootElement.querySelector<HTMLSelectElement>("[data-nav-stress-count]")!,
    devtoolsRoot: readElement(rootElement, "navigation-devtools", HTMLElement),
    showNavigationOverlay: false,
    backendDebugLayers: new Set()
  };
}

export function bindNavigationLabUi(ui: NavigationLabUi, bindings: NavigationLabUiBindings): void {
  for (const button of ui.profileButtons) {
    button.disabled = false;
    button.addEventListener("click", () => {
      const profileId = button.dataset.navProfile as NavigationLabSnapshot["profileId"];
      focusUi(ui, `navigation.profile.${profileId}`);
      bindings.scene().setProfile(profileId);
      updateNavigationLabUi(ui, bindings.scene().snapshot());
    });
  }
  for (const button of ui.pointModeButtons) {
    button.disabled = false;
    button.addEventListener("click", () => {
      const mode = button.dataset.navPointMode as NavigationLabPointMode;
      focusUi(ui, `navigation.point-mode.${mode}`);
      bindings.scene().setPointMode(mode);
      updateNavigationLabUi(ui, bindings.scene().snapshot());
    });
  }
  ui.stressCount.disabled = false;
  for (const button of ui.actionButtons) {
    button.disabled = false;
    button.addEventListener("click", () => {
      const action = button.dataset.navAction as NavigationLabAction;
      focusUi(ui, `navigation.action.${action}`);
      runAction(bindings.scene(), action, Number(ui.stressCount.value));
      updateNavigationLabUi(ui, bindings.scene().snapshot());
    });
  }
  for (const button of ui.scenarioButtons) {
    button.disabled = false;
    button.addEventListener("click", () => {
      const scenarioId = button.dataset.navScenario;
      if (!scenarioId) {
        return;
      }
      focusUi(ui, `navigation.scenario.${scenarioId}`);
      void bindings.selectScenario(scenarioId).catch((error: unknown) => {
        setNavigationLabBackendBusy(ui, false);
        ui.notice.textContent = `Scenario switch failed: ${errorMessage(error)}`;
      });
    });
  }
  for (const button of ui.backendButtons) {
    button.disabled = false;
    button.addEventListener("click", () => {
      const backendId = button.dataset.navBackend;
      if (!backendId) {
        return;
      }
      focusUi(ui, `navigation.backend.${backendId}`);
      void bindings.selectBackend(backendId).catch((error: unknown) => {
        setNavigationLabBackendBusy(ui, false);
        ui.notice.textContent = `Backend switch failed: ${errorMessage(error)}`;
      });
    });
  }
  for (const button of ui.backendDebugButtons) {
    button.disabled = false;
    button.addEventListener("click", () => {
      const layer = button.dataset.navDebugLayer as NavigationLabDebugLayerId;
      if (ui.backendDebugLayers.has(layer)) {
        ui.backendDebugLayers.delete(layer);
      } else {
        ui.backendDebugLayers.add(layer);
      }
      button.dataset.active = ui.backendDebugLayers.has(layer) ? "true" : "false";
      button.setAttribute("aria-pressed", String(ui.backendDebugLayers.has(layer)));
      if (ui.lastSnapshot) {
        drawNavigationLabState(ui, ui.lastSnapshot);
      }
    });
  }
  ui.overlayButton.disabled = false;
  ui.overlayButton.addEventListener("click", () => {
    ui.showNavigationOverlay = !ui.showNavigationOverlay;
    ui.overlayButton.dataset.active = ui.showNavigationOverlay ? "true" : "false";
    ui.overlayButton.textContent = ui.showNavigationOverlay
      ? "Hide route overlay"
      : "Route overlay";
    if (ui.lastSnapshot) {
      drawNavigationLabState(ui, ui.lastSnapshot);
    }
  });
  ui.canvas.addEventListener("pointerdown", (event) => {
    ui.uiRuntime.setFocus({
      scope: "game",
      target: `navigation.${bindings.scene().snapshot().scenario.id}`,
      reason: "sandbox.navigation_map"
    });
    const snapshot = bindings.scene().snapshot();
    bindings
      .scene()
      .placePoint(
        navigationLabCanvasPoint(ui.canvas, event.clientX, event.clientY, snapshot.scenario.bounds)
      );
    updateNavigationLabUi(ui, bindings.scene().snapshot());
  });
}

export function mountNavigationLabDevTools(ui: NavigationLabUi, runtime: DevToolsRuntime): void {
  const root = ui.devtoolsReactRoot ?? createRoot(ui.devtoolsRoot);
  ui.devtoolsReactRoot = root;
  root.render(<DevToolsOverlay runtime={runtime} uiRuntime={ui.uiRuntime} />);
}

export function setNavigationLabBackendBusy(
  ui: NavigationLabUi,
  busy: boolean,
  message = "ready"
): void {
  ui.root.dataset.navigationBackendBusy = busy ? "true" : "false";
  ui.backendState.textContent = message;
  ui.stressCount.disabled = busy;
  for (const button of ui.scenarioButtons) {
    button.disabled = busy;
  }
  for (const button of ui.backendButtons) {
    button.disabled = busy;
  }
}

export function updateNavigationLabUi(ui: NavigationLabUi, snapshot: NavigationLabSnapshot): void {
  ui.lastSnapshot = snapshot;
  ui.root.dataset.navigationProfile = snapshot.profileId;
  ui.root.dataset.navigationScenario = snapshot.scenario.id;
  ui.root.dataset.navigationBackend = snapshot.backend.id;
  ui.root.dataset.navigationLockdown = snapshot.lockdown ? "true" : "false";
  ui.status.classList.toggle("navigation-lab__status--ready", snapshot.running);
  const statusLabel = ui.status.querySelector("span");
  if (statusLabel) {
    statusLabel.textContent = snapshot.running ? "map live" : "paused";
  }
  ui.notice.textContent = snapshot.notice;
  ui.backendState.textContent = `${snapshot.backend.label} ready`;
  ui.canvas.setAttribute("aria-label", `${snapshot.scenario.title} game terrain`);
  setText(ui, "navigation-campaign-label", snapshot.scenario.campaignLabel);
  setText(ui, "navigation-scenario-title", snapshot.scenario.title);
  setText(ui, "navigation-scenario-mission", snapshot.scenario.mission);
  setText(ui, "navigation-map-prompt", snapshot.scenario.mapPrompt);
  setText(ui, "navigation-objective-title", snapshot.scenario.objectiveTitle);
  setText(ui, "navigation-objective-detail", snapshot.scenario.objectiveDetail);
  setText(ui, "navigation-reset-label", snapshot.scenario.controls.resetLabel);
  setActionCopy(ui, "gate", snapshot.scenario.controls.bridge);
  setActionCopy(ui, "swamp", snapshot.scenario.controls.marsh);
  setActionCopy(ui, "portal", snapshot.scenario.controls.portal);
  setActionCopy(ui, "lockdown", snapshot.scenario.controls.lockdown);

  for (const button of ui.profileButtons) {
    button.dataset.active = button.dataset.navProfile === snapshot.profileId ? "true" : "false";
  }
  for (const button of ui.pointModeButtons) {
    button.dataset.active = button.dataset.navPointMode === snapshot.pointMode ? "true" : "false";
  }
  for (const button of ui.scenarioButtons) {
    button.dataset.active = button.dataset.navScenario === snapshot.scenario.id ? "true" : "false";
  }
  for (const button of ui.backendButtons) {
    button.dataset.active = button.dataset.navBackend === snapshot.backend.id ? "true" : "false";
    const presentation = ui.backendPresentations.get(
      presentationKey(snapshot.scenario.id, button.dataset.navBackend ?? "")
    );
    button.hidden = presentation === undefined;
    button.disabled = presentation === undefined;
    const label = button.querySelector("strong");
    const technology = button.querySelector("small");
    if (presentation !== undefined && label !== null && technology !== null) {
      label.textContent = presentation.label;
      technology.textContent = presentation.technology;
      button.title = presentation.description;
    }
  }
  const debugView = ui.backendDebugViews.get(
    presentationKey(snapshot.scenario.id, snapshot.backend.id)
  );
  ui.backendDebugState.textContent = debugView
    ? `${snapshot.backend.label} · ${debugView.summary}`
    : `${snapshot.backend.label} · no geometry projection`;
  setActionState(ui, "gate", snapshot.gateBlocked);
  setActionState(ui, "swamp", snapshot.swampMode !== "normal");
  setActionState(ui, "portal", snapshot.portalEnabled);
  setActionState(ui, "freeze", snapshot.agentsFrozen);
  setActionState(ui, "lockdown", snapshot.lockdown);
  setActionState(
    ui,
    "stress",
    snapshot.stress?.status === "planning" || snapshot.stress?.status === "running"
  );

  const backendDetails = snapshot.navigation.backend.details ?? {};
  setMetric(ui, "revision", String(snapshot.navigation.revision));
  setMetric(ui, "pending", String(snapshot.navigation.pendingRequests));
  setMetric(ui, "queued", String(snapshot.navigation.queuedRequests));
  setMetric(ui, "routes", String(snapshot.navigation.retainedRoutes));
  setMetric(ui, "cache", String(snapshot.navigation.cacheEntries));
  setMetric(ui, "fields", String(readNumber(backendDetails.routeFields)));
  setMetric(ui, "agents", String(snapshot.agents.length));
  setMetric(
    ui,
    "stuck",
    String(snapshot.agents.filter((agent) => agent.progress === "stuck").length)
  );

  setText(ui, "navigation-result", describeResult(snapshot));
  setText(ui, "navigation-projection", describeProjection(snapshot));
  setText(ui, "navigation-burst", describeBurst(snapshot));
  setText(ui, "navigation-stress", describeStress(snapshot));
  setText(
    ui,
    "navigation-bridge-state",
    snapshot.gateBlocked
      ? snapshot.scenario.controls.bridge.blockedState
      : snapshot.scenario.controls.bridge.openState
  );
  setText(
    ui,
    "navigation-marsh-state",
    snapshot.swampMode === "normal"
      ? snapshot.scenario.controls.marsh.normalState
      : snapshot.swampMode === "costly"
        ? snapshot.scenario.controls.marsh.costlyState
        : snapshot.scenario.controls.marsh.blockedState
  );
  setText(
    ui,
    "navigation-waystone-state",
    snapshot.portalEnabled
      ? snapshot.scenario.controls.portal.enabledState
      : snapshot.scenario.controls.portal.disabledState
  );

  ui.traceList.replaceChildren(
    ...[...snapshot.traces]
      .reverse()
      .slice(0, 6)
      .map((trace) => {
        const item = document.createElement("li");
        item.dataset.kind = trace.kind;
        const sequence = document.createElement("span");
        sequence.textContent = String(trace.sequence).padStart(3, "0");
        const label = document.createElement("strong");
        label.textContent = trace.label.replace("navigation.", "");
        const revision = document.createElement("small");
        revision.textContent = `r${trace.revision}`;
        item.append(sequence, label, revision);
        return item;
      })
  );
  drawNavigationLabState(ui, snapshot);
}

function drawNavigationLabState(ui: NavigationLabUi, snapshot: NavigationLabSnapshot): void {
  drawNavigationLab(ui.canvas, snapshot, {
    showNavigationOverlay: ui.showNavigationOverlay,
    backendDebugView: ui.backendDebugViews.get(
      presentationKey(snapshot.scenario.id, snapshot.backend.id)
    ),
    backendDebugLayers: [...ui.backendDebugLayers]
  });
}

function Metric({ label, name }: { label: string; name: string }) {
  return (
    <div className="navigation-lab__metric">
      <span>{label}</span>
      <strong data-nav-metric={name}>0</strong>
    </div>
  );
}

function runAction(
  scene: NavigationLabController,
  action: NavigationLabAction,
  stressCount: number
): void {
  switch (action) {
    case "path":
      scene.requestPath();
      return;
    case "field":
      scene.requestField();
      return;
    case "repeat":
      scene.repeatLastRequest();
      return;
    case "cost-cap":
      scene.requestCostCappedPath();
      return;
    case "cancel":
      scene.cancelProbe();
      return;
    case "burst":
      scene.runBurst();
      return;
    case "stress":
      scene.runStress(stressCount);
      return;
    case "stress-stop":
      scene.stopStress();
      return;
    case "release":
      scene.releaseRoute();
      return;
    case "freeze":
      scene.toggleAgentsFrozen();
      return;
    case "gate":
      scene.toggleGate();
      return;
    case "swamp":
      scene.cycleSwamp();
      return;
    case "portal":
      scene.togglePortal();
      return;
    case "lockdown":
      scene.runLockdown();
      return;
    case "unsupported":
      scene.probeUnsupportedObstacle();
      return;
    case "reset":
      scene.reset();
  }
}

function describeResult(snapshot: NavigationLabSnapshot): string {
  if (snapshot.currentRequestId) {
    const phase =
      snapshot.lastResult?.status === "pending" ? snapshot.lastResult.phase : "accepted";
    return `${phase} · ${snapshot.currentRequestId}`;
  }
  const result = snapshot.lastResult;
  if (!result) {
    return snapshot.releasedSample
      ? `Route released · sample ${snapshot.releasedSample.status}`
      : "No route order";
  }
  if (result.status === "complete") {
    const route = result.route.kind === "field" ? "Party rally field" : "Unit path";
    return `${route} · cost ${result.route.cost.toFixed(2)} · cache ${result.cache}`;
  }
  if (result.status === "failed") {
    return `No route · ${result.reason} · cache ${result.cache}`;
  }
  if (result.status === "cancelled") {
    return `Order cancelled · revision ${result.revision}`;
  }
  if (result.status === "rejected") {
    return `Order rejected · ${result.reason}`;
  }
  return result.status;
}

function describeProjection(snapshot: NavigationLabSnapshot): string {
  if (!snapshot.projection) {
    return "Choose Inspect, then click terrain";
  }
  return `${snapshot.projection.distance.toFixed(2)} m to walkable ${snapshot.projection.area ?? "ground"}`;
}

function describeBurst(snapshot: NavigationLabSnapshot): string {
  if (!snapshot.burst) {
    return "idle";
  }
  return `${snapshot.burst.pending}/${snapshot.burst.total} pending · ${snapshot.burst.completed} complete · ${snapshot.burst.failed} failed`;
}

function describeStress(snapshot: NavigationLabSnapshot): string {
  const stress = snapshot.stress;
  if (stress === undefined) {
    return "idle";
  }
  if (stress.status === "planning") {
    return `planning one shared field for ${stress.targetAgents.toLocaleString()} units`;
  }
  if (stress.status === "failed") {
    return `failed after ${stress.planningMs.toFixed(2)} ms`;
  }
  const verdict =
    stress.withinBudget === undefined
      ? "warming up"
      : stress.withinBudget
        ? "within budget"
        : "over budget";
  return `${stress.status} · ${stress.activeAgents.toLocaleString()} units · p95 ${stress.p95StepMs.toFixed(2)} ms / ${stress.budgetMs.toFixed(0)} ms · avg ${stress.averageStepMs.toFixed(2)} ms · ${stress.sampledTicks} ticks · ${verdict}`;
}

function focusUi(ui: NavigationLabUi, target: string): void {
  ui.uiRuntime.setFocus({ scope: "ui", target, reason: "sandbox.navigation_control" });
}

function setActionState(ui: NavigationLabUi, action: NavigationLabAction, active: boolean): void {
  const button = ui.actionButtons.find((candidate) => candidate.dataset.navAction === action);
  if (button) {
    button.dataset.active = active ? "true" : "false";
  }
}

function setActionCopy(
  ui: NavigationLabUi,
  action: NavigationLabAction,
  copy: { label: string; detail: string }
): void {
  const label = ui.root.querySelector(`[data-nav-action-label="${action}"]`);
  const detail = ui.root.querySelector(`[data-nav-action-detail="${action}"]`);
  if (label) {
    label.textContent = copy.label;
  }
  if (detail) {
    detail.textContent = copy.detail;
  }
}

function setMetric(ui: NavigationLabUi, name: string, value: string): void {
  const element = ui.root.querySelector(`[data-nav-metric="${name}"]`);
  if (element) {
    element.textContent = value;
  }
}

function setText(ui: NavigationLabUi, name: string, value: string): void {
  const element = ui.root.querySelector(`[data-ui="${name}"]`);
  if (element) {
    element.textContent = value;
  }
}

function readElement<T extends HTMLElement>(
  root: HTMLElement,
  name: string,
  type: { new (): T }
): T {
  const element = root.querySelector(`[data-ui="${name}"]`);
  if (!(element instanceof type)) {
    throw new Error(`Navigation Lab UI element is missing: ${name}`);
  }
  return element;
}

function readNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function scenarioWorldActions(
  scenario: NavigationLabScenarioDefinition
): ReadonlyArray<readonly [NavigationLabAction, string, string]> {
  return [
    ["gate", scenario.controls.bridge.label, scenario.controls.bridge.detail],
    ["swamp", scenario.controls.marsh.label, scenario.controls.marsh.detail],
    ["portal", scenario.controls.portal.label, scenario.controls.portal.detail],
    ["lockdown", scenario.controls.lockdown.label, scenario.controls.lockdown.detail]
  ];
}

function presentationKey(scenarioId: string, backendId: string): string {
  return `${scenarioId}:${backendId}`;
}
