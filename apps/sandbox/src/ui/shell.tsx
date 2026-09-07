import { createRef } from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import type { UiOpenPanel, UiRuntime } from "@gamekits/ui-core";
import {
  GameKitsUiShell,
  UiFocusBridge,
  UiModalHost,
  UiTip,
  useUiRuntime
} from "@gamekits/react-ui";
import type { SandboxUiHandles, SandboxWorkbenchState } from "./types";

type SandboxObjectiveBriefingModalProps = {
  label: string;
  status: string;
  progress: string;
  detail: string;
};

export function createSandboxWorkbenchState(): SandboxWorkbenchState {
  return {
    activeInspectorTab: "actor",
    timelineFilter: "all"
  };
}

export function renderSandboxShell(
  appElement: HTMLElement,
  uiRuntime: UiRuntime
): SandboxUiHandles {
  const rendererRootRef = createRef<HTMLDivElement>();
  const uiRootRef = createRef<HTMLElement>();
  const root = createRoot(appElement);

  flushSync(() => {
    root.render(
      <GameKitsUiShell
        runtime={uiRuntime}
        className="gamekits-sandbox-ui"
        density="compact"
        theme="tiny-camp"
      >
        <UiFocusBridge
          runtime={uiRuntime}
          gameViewportRef={rendererRootRef}
          uiRootRef={uiRootRef}
        />
        <section className="workbench" ref={uiRootRef}>
          <header className="topbar">
            <div>
              <p className="eyebrow">GameKits / Scene Workbench</p>
              <h1>Tiny Camp</h1>
            </div>
            <div className="status" data-ui="status">
              <span />
              stopped
            </div>
          </header>

          <main className="workspace">
            <section className="scene-column">
              <article className="stage-panel" data-ui-panel="sandbox.stage">
                <div className="stage-panel__bar">
                  <div>
                    <span className="label">Objective</span>
                    <strong data-ui="objective-label">Tiny Camp</strong>
                  </div>
                  <div className="objective-state">
                    <span data-ui="objective-status">waiting</span>
                    <strong data-ui="objective-progress">0%</strong>
                    <button type="button" className="objective-briefing" data-objective-briefing>
                      Briefing
                    </button>
                  </div>
                </div>
                <div className="objective-meter">
                  <span data-ui="objective-progress-bar" />
                </div>
                <p className="objective-detail" data-ui="objective-detail">
                  Waiting for runtime.
                </p>
                <div className="stage" data-ui="stage">
                  <div
                    className="renderer-root"
                    data-ui="renderer-root"
                    tabIndex={0}
                    ref={rendererRootRef}
                  />
                  <div className="scene-object-overlay" data-ui="scene-object-overlay" />
                  <aside className="three-preview" aria-label="Three driver preview">
                    <div className="three-preview__bar">
                      <span>Three Driver</span>
                      <strong>Mesh Adapter</strong>
                    </div>
                    <div className="three-preview__viewport" data-ui="three-preview-root" />
                  </aside>
                  <div className="stage-hint">
                    <span>WASD camera</span>
                    <span>Click object to focus</span>
                    <span>Confirm triggers GAS</span>
                    <span data-ui="entity-count">0</span>
                  </div>
                </div>
              </article>

              <section className="camp-strip" data-ui-panel="sandbox.hud">
                <div>
                  <span>Tick</span>
                  <strong data-ui="tick">0</strong>
                </div>
                <div>
                  <span>Modules</span>
                  <strong data-ui="modules">0</strong>
                </div>
                <div>
                  <span>Systems</span>
                  <strong data-ui="systems">0</strong>
                </div>
                <div>
                  <span>Input</span>
                  <strong data-ui="input-action">waiting</strong>
                </div>
                <div>
                  <span>Scope</span>
                  <strong data-ui="input-context">global</strong>
                </div>
                <div>
                  <span>Camera</span>
                  <strong data-ui="camera-position">0, 0</strong>
                </div>
                <div>
                  <span>Zoom</span>
                  <strong data-ui="camera-zoom">1.00</strong>
                </div>
                <div>
                  <span>Mode</span>
                  <strong data-ui="camera-mode">free</strong>
                </div>
              </section>
            </section>

            <aside className="inspector" data-ui-panel="sandbox.inspector">
              <div className="inspector__header">
                <div>
                  <span className="label">Selected Actor</span>
                  <strong data-ui="selected-actor">none</strong>
                </div>
              </div>
              <div className="tabs" role="tablist">
                <button type="button" data-inspector-tab="actor">
                  Actor
                </button>
                <button type="button" data-inspector-tab="runtime">
                  Runtime
                </button>
                <button type="button" data-inspector-tab="content">
                  Content
                </button>
                <button type="button" data-inspector-tab="rules">
                  Rules
                </button>
                <button type="button" data-inspector-tab="host">
                  Host
                </button>
              </div>
              <div className="inspector__body" data-ui="inspector-body" />
            </aside>
          </main>

          <UiModalHost
            className="scene-modal-host"
            renderPanel={(panel) => <SandboxObjectiveBriefingModal panel={panel} />}
          />

          <section className="timeline-panel" data-ui-panel="sandbox.timeline">
            <div className="timeline-panel__header">
              <div>
                <span className="label">Cross-module Timeline</span>
                <strong>input → TCA → GAS → cue</strong>
              </div>
              <div className="timeline-filters">
                <button type="button" data-timeline-filter="all">
                  All
                </button>
                <button type="button" data-timeline-filter="input">
                  Input
                </button>
                <button type="button" data-timeline-filter="tca">
                  TCA
                </button>
                <button type="button" data-timeline-filter="gas">
                  GAS
                </button>
                <button type="button" data-timeline-filter="renderer">
                  Renderer
                </button>
                <button type="button" data-timeline-filter="runtime">
                  Runtime
                </button>
              </div>
            </div>
            <ol className="timeline" data-ui="timeline-list" />
          </section>
        </section>
        <div className="devtools-overlay-root" data-ui="devtools-overlay-root" />
      </GameKitsUiShell>
    );
  });

  return {
    root: appElement,
    reactRoot: root,
    uiRuntime,
    stage: readElement(appElement, "stage", HTMLElement),
    devtoolsRoot: readElement(appElement, "devtools-overlay-root", HTMLElement),
    rendererRoot: readElement(appElement, "renderer-root", HTMLDivElement),
    threePreviewRoot: readElement(appElement, "three-preview-root", HTMLDivElement),
    sceneOverlay: readElement(appElement, "scene-object-overlay", HTMLElement),
    status: readElement(appElement, "status", HTMLDivElement),
    objectiveLabel: readElement(appElement, "objective-label", HTMLElement),
    objectiveStatus: readElement(appElement, "objective-status", HTMLElement),
    objectiveProgress: readElement(appElement, "objective-progress", HTMLElement),
    objectiveProgressBar: readElement(appElement, "objective-progress-bar", HTMLElement),
    objectiveDetail: readElement(appElement, "objective-detail", HTMLElement),
    entityCount: readElement(appElement, "entity-count", HTMLElement),
    tick: readElement(appElement, "tick", HTMLElement),
    modules: readElement(appElement, "modules", HTMLElement),
    systems: readElement(appElement, "systems", HTMLElement),
    inputAction: readElement(appElement, "input-action", HTMLElement),
    inputContext: readElement(appElement, "input-context", HTMLElement),
    cameraPosition: readElement(appElement, "camera-position", HTMLElement),
    cameraZoom: readElement(appElement, "camera-zoom", HTMLElement),
    cameraMode: readElement(appElement, "camera-mode", HTMLElement),
    selectedActor: readElement(appElement, "selected-actor", HTMLElement),
    inspectorTabs: [...appElement.querySelectorAll<HTMLButtonElement>("[data-inspector-tab]")],
    inspectorBody: readElement(appElement, "inspector-body", HTMLElement),
    timelineFilters: [...appElement.querySelectorAll<HTMLButtonElement>("[data-timeline-filter]")],
    timelineList: readElement(appElement, "timeline-list", HTMLElement)
  };
}

function SandboxObjectiveBriefingModal({ panel }: { panel: UiOpenPanel }) {
  const runtime = useUiRuntime();

  if (panel.id !== "sandbox.objective.briefing") {
    return (
      <p className="scene-modal-copy">No objective modal renderer registered for {panel.id}.</p>
    );
  }

  const props = panel.props as Partial<SandboxObjectiveBriefingModalProps> | undefined;

  return (
    <div className="scene-modal">
      <div className="scene-modal__hero">
        <span>Objective Briefing</span>
        <strong>{props?.label ?? "Tiny Camp"}</strong>
        <p>{props?.detail ?? "No objective telemetry available."}</p>
      </div>
      <dl className="scene-modal__stats">
        <div>
          <dt>Status</dt>
          <dd>{props?.status ?? "waiting"}</dd>
        </div>
        <div>
          <dt>Progress</dt>
          <dd>{props?.progress ?? "0%"}</dd>
        </div>
        <div>
          <dt>UI Source</dt>
          <dd>objective hud</dd>
        </div>
        <div>
          <dt>Runtime</dt>
          <dd>modal scope</dd>
        </div>
      </dl>
      <div className="scene-modal__actions">
        <UiTip
          side="top"
          content="Briefings are explicit UI actions, while scene clicks only focus objects."
        >
          <button type="button" className="scene-ui-action" onClick={() => runtime.close(panel.id)}>
            Return to Scene
          </button>
        </UiTip>
      </div>
    </div>
  );
}

export function bindSandboxWorkbenchControls(
  handles: SandboxUiHandles,
  state: SandboxWorkbenchState,
  actions: {
    onChange: () => void;
    onFollowEntity?(entityId: string | number): void;
    onStopFollow?(): void;
    onSave?(): void;
    onLoad?(): void;
    onSceneOverlayInput?(event: MouseEvent | WheelEvent): void;
  }
): void {
  for (const tab of handles.inspectorTabs) {
    tab.addEventListener("click", () => {
      state.activeInspectorTab = tab.dataset
        .inspectorTab as SandboxWorkbenchState["activeInspectorTab"];
      handles.uiRuntime.setFocus({
        scope: "ui",
        target: `inspector.${state.activeInspectorTab}`,
        reason: "sandbox.inspector_tab"
      });
      handles.lastWorkbenchRenderAt = undefined;
      actions.onChange();
    });
  }

  for (const filter of handles.timelineFilters) {
    filter.addEventListener("click", () => {
      state.timelineFilter = filter.dataset
        .timelineFilter as SandboxWorkbenchState["timelineFilter"];
      handles.uiRuntime.setFocus({
        scope: "ui",
        target: `timeline.${state.timelineFilter}`,
        reason: "sandbox.timeline_filter"
      });
      handles.lastWorkbenchRenderAt = undefined;
      actions.onChange();
    });
  }

  const objectiveBriefing = handles.root.querySelector<HTMLButtonElement>(
    "[data-objective-briefing]"
  );
  objectiveBriefing?.addEventListener("click", () => {
    openObjectiveBriefingModal(handles);
  });

  handles.sceneOverlay.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }

    const inspectButton = target.closest<HTMLButtonElement>("[data-scene-inspect]");
    if (inspectButton) {
      const entityId = readEntityDataset(inspectButton.dataset.sceneInspect);
      if (entityId !== undefined) {
        const entity = handles.latestSandbox
          ?.snapshot()
          .entities.find((entry) => entry.id === entityId);
        state.selectedEntityId = entityId;
        state.selectedActorId = entity?.actorId;
        state.selectionCleared = false;
        state.activeInspectorTab = "actor";
        handles.lastWorkbenchRenderAt = undefined;
        actions.onChange();
      }
      return;
    }

    const followButton = target.closest<HTMLButtonElement>("[data-camera-follow]");
    if (followButton) {
      const entityId = readEntityDataset(followButton.dataset.cameraFollow);
      if (entityId !== undefined) {
        state.followedEntityId = entityId;
        actions.onFollowEntity?.(entityId);
        handles.lastWorkbenchRenderAt = undefined;
        actions.onChange();
      }
      return;
    }

    if (target.closest(".scene-object-card")) {
      return;
    }

    actions.onSceneOverlayInput?.(event);
  });

  handles.sceneOverlay.addEventListener("wheel", (event) => {
    const target = event.target;
    if (target instanceof HTMLElement && target.closest(".scene-object-card")) {
      return;
    }

    actions.onSceneOverlayInput?.(event);
  });

  handles.inspectorBody.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }
    const actorButton = target.closest<HTMLButtonElement>("[data-select-actor]");
    if (actorButton) {
      state.selectedActorId = actorButton.dataset.selectActor;
      state.selectedEntityId = readEntityDataset(actorButton.dataset.selectEntity);
      state.selectionCleared = false;
      state.activeInspectorTab = "actor";
      handles.lastWorkbenchRenderAt = undefined;
      actions.onChange();
      return;
    }

    const entityButton = target.closest<HTMLButtonElement>("[data-select-entity]");
    if (entityButton) {
      state.selectedEntityId = readEntityDataset(entityButton.dataset.selectEntity);
      state.selectedActorId = entityButton.dataset.selectActor;
      state.selectionCleared = false;
      state.activeInspectorTab = "actor";
      handles.lastWorkbenchRenderAt = undefined;
      actions.onChange();
      return;
    }

    const followButton = target.closest<HTMLButtonElement>("[data-camera-follow]");
    if (followButton) {
      const entityId = readEntityDataset(followButton.dataset.cameraFollow);
      if (entityId !== undefined) {
        state.followedEntityId = entityId;
        actions.onFollowEntity?.(entityId);
        handles.lastWorkbenchRenderAt = undefined;
        actions.onChange();
      }
      return;
    }

    const stopFollowButton = target.closest<HTMLButtonElement>("[data-camera-stop-follow]");
    if (stopFollowButton) {
      state.followedEntityId = undefined;
      actions.onStopFollow?.();
      handles.lastWorkbenchRenderAt = undefined;
      actions.onChange();
      return;
    }

    const saveActionButton = target.closest<HTMLButtonElement>("[data-save-action]");
    if (saveActionButton?.dataset.saveAction === "save") {
      actions.onSave?.();
      return;
    }
    if (saveActionButton?.dataset.saveAction === "load") {
      actions.onLoad?.();
    }
  });
}

export function applySandboxSceneClickSelection(
  handles: SandboxUiHandles,
  state: SandboxWorkbenchState,
  selected: { entityId: string | number; actorId?: string } | undefined
): void {
  if (!selected) {
    state.selectedEntityId = undefined;
    state.selectedActorId = undefined;
    state.selectionCleared = true;
  } else {
    state.selectedEntityId = selected.entityId;
    state.selectedActorId = selected.actorId;
    state.selectionCleared = false;
  }
  state.activeInspectorTab = "actor";
  handles.lastWorkbenchRenderAt = undefined;
}

function openObjectiveBriefingModal(handles: SandboxUiHandles): void {
  const objective = handles.latestSandbox?.snapshot().objective;
  if (!objective) {
    return;
  }

  handles.uiRuntime.open("sandbox.objective.briefing", {
    label: objective.label,
    status: objective.status,
    progress: `${Math.round(objective.progress * 100)}%`,
    detail: objective.detail
  } satisfies SandboxObjectiveBriefingModalProps);
}

function readEntityDataset(value: string | undefined): string | number | undefined {
  if (value === undefined) {
    return undefined;
  }

  const numeric = Number(value);
  return Number.isFinite(numeric) && String(numeric) === value ? numeric : value;
}

function readElement<T extends Element>(root: Element, key: string, elementType: { new (): T }): T {
  const element = root.querySelector(`[data-ui="${key}"]`);
  if (!(element instanceof elementType)) {
    throw new Error(`Missing sandbox UI element: ${key}`);
  }

  return element;
}
