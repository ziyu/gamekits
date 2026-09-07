import type { AppHostSnapshot } from "@gamekits/app-host";
import type {
  ThreeDemoCameraPreset,
  ThreeDemoClip,
  ThreeDemoLightingPreset,
  ThreeDemoMaterial,
  ThreeDemoMode,
  ThreeDemoModel,
  ThreeDemoSceneSnapshot,
  ThreeDemoTexture
} from "./demo-scene";

export type ThreeDemoUiHandles = {
  root: HTMLElement;
  viewport: HTMLElement;
  loadingOverlay: HTMLElement;
  loadingTitle: HTMLElement;
  loadingDetail: HTMLElement;
  loadingFill: HTMLElement;
  hostPhase: HTMLElement;
  rendererId: HTMLElement;
  assetCount: HTMLElement;
  resourceCount: HTMLElement;
  modelValue: HTMLElement;
  textureValue: HTMLElement;
  clipValue: HTMLElement;
  diagnostics: HTMLElement;
  hostSnapshot: HTMLElement;
  sceneSnapshot: HTMLElement;
  assetList: HTMLElement;
  resourceList: HTMLElement;
  modeButtons: Record<ThreeDemoMode, HTMLButtonElement>;
  materialButtons: Record<ThreeDemoMaterial, HTMLButtonElement>;
  modelButtons: Record<ThreeDemoModel, HTMLButtonElement>;
  textureButtons: Record<ThreeDemoTexture, HTMLButtonElement>;
  clipButtons: Record<ThreeDemoClip, HTMLButtonElement>;
  cameraButtons: Record<ThreeDemoCameraPreset, HTMLButtonElement>;
  lightingButtons: Record<ThreeDemoLightingPreset, HTMLButtonElement>;
  playingToggle: HTMLInputElement;
  wireframeToggle: HTMLInputElement;
  speedSlider: HTMLInputElement;
  timelineSlider: HTMLInputElement;
  resetButton: HTMLButtonElement;
  pushDiagnostic(type: string, source?: string | undefined): void;
};

export type ThreeDemoControlHandlers = {
  onMode(mode: ThreeDemoMode): void;
  onMaterial(material: ThreeDemoMaterial): void;
  onModel(model: ThreeDemoModel): void;
  onTexture(texture: ThreeDemoTexture): void;
  onClip(clip: ThreeDemoClip): void;
  onCameraPreset(preset: ThreeDemoCameraPreset): void;
  onLightingPreset(preset: ThreeDemoLightingPreset): void;
  onAnimationSpeed(speed: number): void;
  onTimeline(timeMs: number): void;
  onPlaying(enabled: boolean): void;
  onWireframe(enabled: boolean): void;
  onReset(): void;
};

export function renderThreeDemoShell(root: HTMLElement): ThreeDemoUiHandles {
  root.className = "three-demo";

  const shell = element("section", "three-demo__shell");
  const viewport = element("section", "three-demo__viewport");
  viewport.tabIndex = 0;
  viewport.setAttribute("aria-label", "Three renderer viewport");
  const loadingOverlay = element("section", "three-demo__loading");
  loadingOverlay.setAttribute("aria-live", "polite");
  const loadingTitle = element("strong", undefined, "Booting Three driver");
  const loadingDetail = element("span", undefined, "Preparing renderer runtime");
  const loadingTrack = element("div", "three-demo__loading-track");
  const loadingFill = element("div", "three-demo__loading-fill");
  loadingTrack.append(loadingFill);
  const loadingPanel = element("div", "three-demo__loading-panel");
  loadingPanel.append(loadingTitle, loadingDetail, loadingTrack);
  loadingOverlay.append(loadingPanel);
  viewport.append(loadingOverlay);

  const panel = element("aside", "three-demo__panel");
  const title = element("header", "three-demo__header");
  title.append(
    element("p", "three-demo__eyebrow", "GameKits"),
    element("h1", "three-demo__title", "Three Capability Lab")
  );

  const statusGrid = element("section", "three-demo__status-grid");
  const hostPhase = element("strong", undefined, "registered");
  const rendererId = element("strong", undefined, "pending");
  const assetCount = element("strong", undefined, "0");
  const resourceCount = element("strong", undefined, "0");
  const modelValue = element("strong", undefined, "robot");
  const textureValue = element("strong", undefined, "uv");
  const clipValue = element("strong", undefined, "auto");
  statusGrid.append(
    statusTile("Host", hostPhase),
    statusTile("Renderer", rendererId),
    statusTile("Assets", assetCount),
    statusTile("Resources", resourceCount),
    statusTile("Model", modelValue),
    statusTile("Texture", textureValue),
    statusTile("Clip", clipValue)
  );

  const modeButtons: Record<ThreeDemoMode, HTMLButtonElement> = {
    assets: controlButton("Assets"),
    materials: controlButton("Materials"),
    animation: controlButton("Animation")
  };
  modeButtons.assets.classList.add("is-active");

  const materialButtons: Record<ThreeDemoMaterial, HTMLButtonElement> = {
    original: controlButton("Original"),
    studio: controlButton("Studio"),
    chrome: controlButton("Chrome"),
    hologram: controlButton("Hologram"),
    physical: controlButton("Physical")
  };
  materialButtons.original.classList.add("is-active");

  const modelButtons: Record<ThreeDemoModel, HTMLButtonElement> = {
    robot: controlButton("Robot"),
    tokyo: controlButton("Tokyo"),
    flamingo: controlButton("Flamingo"),
    relay: controlButton("Relay")
  };
  modelButtons.robot.classList.add("is-active");

  const textureButtons: Record<ThreeDemoTexture, HTMLButtonElement> = {
    none: controlButton("None"),
    uv: controlButton("UV"),
    brick: controlButton("Brick"),
    wood: controlButton("Wood")
  };
  textureButtons.uv.classList.add("is-active");

  const clipButtons: Record<ThreeDemoClip, HTMLButtonElement> = {
    auto: controlButton("Auto"),
    Idle: controlButton("Idle"),
    Walking: controlButton("Walk"),
    Running: controlButton("Run"),
    Dance: controlButton("Dance")
  };
  clipButtons.auto.classList.add("is-active");

  const cameraButtons: Record<ThreeDemoCameraPreset, HTMLButtonElement> = {
    studio: controlButton("Studio"),
    overhead: controlButton("Overhead"),
    macro: controlButton("Macro")
  };
  cameraButtons.studio.classList.add("is-active");

  const lightingButtons: Record<ThreeDemoLightingPreset, HTMLButtonElement> = {
    neutral: controlButton("Neutral"),
    neon: controlButton("Neon"),
    inspection: controlButton("Inspect")
  };
  lightingButtons.neutral.classList.add("is-active");

  const playingToggle = checkbox(true);
  const wireframeToggle = checkbox(false);
  const speedSlider = range("0.1", "3", "0.1", "1");
  const timelineSlider = range("0", "8000", "100", "0");
  const resetButton = controlButton("Reset");
  resetButton.classList.add("three-demo__reset");

  const controls = element("section", "three-demo__controls");
  controls.append(
    controlGroup("Mode", segmentedRow(modeButtons)),
    controlGroup("Model", segmentedRow(modelButtons)),
    controlGroup("Material", segmentedRow(materialButtons)),
    controlGroup("Texture", segmentedRow(textureButtons)),
    controlGroup("Clip", segmentedRow(clipButtons)),
    controlGroup("Camera", segmentedRow(cameraButtons)),
    controlGroup("Lighting", segmentedRow(lightingButtons)),
    controlGroup("Timeline", timelineControl(timelineSlider, playingToggle)),
    controlGroup("Speed", speedSlider),
    toggleRow("Wireframe", wireframeToggle),
    resetButton
  );

  const diagnostics = element("ol", "three-demo__diagnostics");
  const hostSnapshot = element("pre", "three-demo__snapshot", "{}");
  const sceneSnapshot = element("pre", "three-demo__snapshot", "{}");
  const assetList = element("ol", "three-demo__resource-list");
  const resourceList = element("ol", "three-demo__resource-list");

  panel.append(
    title,
    statusGrid,
    controls,
    panelSection("Assets", assetList),
    panelSection("Driver Cache", resourceList),
    panelSection("Diagnostics", diagnostics),
    panelSection("Host", hostSnapshot),
    panelSection("Scene", sceneSnapshot)
  );
  shell.append(viewport, panel);
  root.replaceChildren(shell);

  return {
    root,
    viewport,
    loadingOverlay,
    loadingTitle,
    loadingDetail,
    loadingFill,
    hostPhase,
    rendererId,
    assetCount,
    resourceCount,
    modelValue,
    textureValue,
    clipValue,
    diagnostics,
    hostSnapshot,
    sceneSnapshot,
    assetList,
    resourceList,
    modeButtons,
    materialButtons,
    modelButtons,
    textureButtons,
    clipButtons,
    cameraButtons,
    lightingButtons,
    playingToggle,
    wireframeToggle,
    speedSlider,
    timelineSlider,
    resetButton,
    pushDiagnostic(type, source) {
      const entry = element("li", undefined, source ? `${source}: ${type}` : type);
      diagnostics.prepend(entry);
      while (diagnostics.childElementCount > 8) {
        diagnostics.lastElementChild?.remove();
      }
    }
  };
}

export function bindThreeDemoControls(
  ui: ThreeDemoUiHandles,
  handlers: ThreeDemoControlHandlers
): void {
  bindButtonRecord(ui.modeButtons, handlers.onMode);
  bindButtonRecord(ui.materialButtons, handlers.onMaterial);
  bindButtonRecord(ui.modelButtons, handlers.onModel);
  bindButtonRecord(ui.textureButtons, handlers.onTexture);
  bindButtonRecord(ui.clipButtons, handlers.onClip);
  bindButtonRecord(ui.cameraButtons, handlers.onCameraPreset);
  bindButtonRecord(ui.lightingButtons, handlers.onLightingPreset);
  ui.speedSlider.addEventListener("input", () => {
    handlers.onAnimationSpeed(Number(ui.speedSlider.value));
  });
  ui.timelineSlider.addEventListener("input", () => {
    handlers.onTimeline(Number(ui.timelineSlider.value));
  });
  ui.playingToggle.addEventListener("change", () => {
    handlers.onPlaying(ui.playingToggle.checked);
  });
  ui.wireframeToggle.addEventListener("change", () => {
    handlers.onWireframe(ui.wireframeToggle.checked);
  });
  ui.resetButton.addEventListener("click", () => {
    handlers.onReset();
  });
}

export function updateHostSnapshot(ui: ThreeDemoUiHandles, snapshot: AppHostSnapshot): void {
  ui.hostPhase.textContent = snapshot.phase;
  const renderer = snapshot.services.find((service) => service.id === "renderer");
  ui.rendererId.textContent = readRendererId(renderer?.snapshot) ?? "pending";
  const resources = readDriverResources(snapshot);
  ui.resourceCount.textContent = String(resources.length);
  renderResourceList(ui.resourceList, resources);
  ui.hostSnapshot.textContent = JSON.stringify(
    {
      phase: snapshot.phase,
      services: snapshot.services.map((service) => ({
        id: service.id,
        phase: service.phase,
        standard: service.standard
      })),
      resources,
      diagnostics: snapshot.diagnostics.slice(-4).map((event) => ({
        type: event.type,
        source: event.source
      }))
    },
    null,
    2
  );
}

export function updateSceneSnapshot(
  ui: ThreeDemoUiHandles,
  snapshot: ThreeDemoSceneSnapshot
): void {
  ui.assetCount.textContent = `${snapshot.assets.filter((asset) => asset.status === "loaded").length}/${snapshot.assets.length}`;
  ui.modelValue.textContent = snapshot.model;
  ui.textureValue.textContent = snapshot.texture;
  ui.clipValue.textContent = snapshot.clip;
  ui.sceneSnapshot.textContent = JSON.stringify(snapshot, null, 2);
  ui.playingToggle.checked = snapshot.playing;
  ui.wireframeToggle.checked = snapshot.wireframe;
  ui.speedSlider.value = String(snapshot.animationSpeed);
  ui.timelineSlider.value = String(snapshot.timelineMs);
  renderAssetList(ui.assetList, snapshot.assets);
  syncButtons(ui.modeButtons, snapshot.mode);
  syncButtons(ui.materialButtons, snapshot.material);
  syncButtons(ui.modelButtons, snapshot.model);
  syncButtons(ui.textureButtons, snapshot.texture);
  syncButtons(ui.clipButtons, snapshot.clip);
  syncButtons(ui.cameraButtons, snapshot.cameraPreset);
  syncButtons(ui.lightingButtons, snapshot.lightingPreset);
}

export function updateLoadingState(
  ui: ThreeDemoUiHandles,
  state: {
    visible: boolean;
    title?: string | undefined;
    detail?: string | undefined;
    loaded?: number | undefined;
    total?: number | undefined;
  }
): void {
  ui.loadingOverlay.toggleAttribute("hidden", !state.visible);
  ui.viewport.setAttribute("aria-busy", state.visible ? "true" : "false");
  if (state.title !== undefined) {
    ui.loadingTitle.textContent = state.title;
  }
  if (state.detail !== undefined) {
    ui.loadingDetail.textContent = state.detail;
  }
  const total = Math.max(0, state.total ?? 0);
  const loaded = Math.max(0, Math.min(state.loaded ?? 0, total));
  const progress = total > 0 ? Math.round((loaded / total) * 100) : 8;
  ui.loadingFill.style.width = `${progress}%`;
}

export function renderBootError(root: HTMLElement, error: unknown): void {
  root.className = "three-demo three-demo--error";
  const panel = element("section", "three-demo__error");
  panel.append(
    element("p", "three-demo__eyebrow", "Boot failed"),
    element("h1", "three-demo__title", readErrorMessage(error))
  );
  root.replaceChildren(panel);
}

function bindButtonRecord<TName extends string>(
  buttons: Record<TName, HTMLButtonElement>,
  handler: (name: TName) => void
): void {
  for (const [name, button] of Object.entries(buttons) as Array<[TName, HTMLButtonElement]>) {
    button.addEventListener("click", () => {
      handler(name);
    });
  }
}

function panelSection(title: string, child: HTMLElement): HTMLElement {
  const section = element("section", "three-demo__section");
  section.append(element("h2", undefined, title), child);
  return section;
}

function controlGroup(title: string, child: HTMLElement): HTMLElement {
  const group = element("section", "three-demo__control-group");
  group.append(element("h2", undefined, title), child);
  return group;
}

function segmentedRow<TName extends string>(
  buttons: Record<TName, HTMLButtonElement>
): HTMLElement {
  const row = element("div", "three-demo__segmented");
  row.append(...(Object.values(buttons) as HTMLButtonElement[]));
  return row;
}

function statusTile(label: string, value: HTMLElement): HTMLElement {
  const tile = element("div", "three-demo__status");
  tile.append(element("span", undefined, label), value);
  return tile;
}

function timelineControl(
  timelineSlider: HTMLInputElement,
  playingToggle: HTMLInputElement
): HTMLElement {
  const wrapper = element("div", "three-demo__timeline");
  wrapper.append(timelineSlider, toggleRow("Play", playingToggle));
  return wrapper;
}

function toggleRow(label: string, input: HTMLInputElement): HTMLElement {
  const row = element("label", "three-demo__toggle");
  row.append(input, element("span", undefined, label));
  return row;
}

function checkbox(checked: boolean): HTMLInputElement {
  const input = document.createElement("input");
  input.type = "checkbox";
  input.checked = checked;
  return input;
}

function range(min: string, max: string, step: string, value: string): HTMLInputElement {
  const input = document.createElement("input");
  input.type = "range";
  input.min = min;
  input.max = max;
  input.step = step;
  input.value = value;
  return input;
}

function controlButton(label: string): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = label;
  return button;
}

function syncButtons<TName extends string>(
  buttons: Record<TName, HTMLButtonElement>,
  active: TName
): void {
  for (const [name, button] of Object.entries(buttons) as Array<[TName, HTMLButtonElement]>) {
    button.classList.toggle("is-active", name === active);
    button.setAttribute("aria-pressed", name === active ? "true" : "false");
  }
}

function renderAssetList(list: HTMLElement, assets: ThreeDemoSceneSnapshot["assets"]): void {
  list.replaceChildren(
    ...assets.map((asset) => {
      const item = element("li", `is-${asset.status}`);
      if (asset.error) {
        item.title = asset.error;
      }
      const stateLabel =
        asset.status === "registered" && asset.lazy
          ? "lazy"
          : asset.status === "failed" && asset.error
            ? "failed"
            : asset.status;
      item.append(
        element("strong", undefined, asset.label),
        element("span", undefined, `${asset.type} / ${stateLabel}`)
      );
      return item;
    })
  );
}

function renderResourceList(list: HTMLElement, resources: DriverResourceSummary[]): void {
  list.replaceChildren(
    ...resources.map((resource) => {
      const item = element("li", "is-loaded");
      const clipLabel = resource.clipNames.length > 0 ? ` / ${resource.clipNames.join(", ")}` : "";
      item.append(
        element("strong", undefined, resource.id),
        element("span", undefined, `${resource.kind}${clipLabel}`)
      );
      return item;
    })
  );
}

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string | undefined,
  text?: string | undefined
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) {
    node.className = className;
  }
  if (text !== undefined) {
    node.textContent = text;
  }
  return node;
}

function readRendererId(snapshot: unknown): string | undefined {
  if (!snapshot || typeof snapshot !== "object" || !("id" in snapshot)) {
    return undefined;
  }
  const id = (snapshot as { id?: unknown }).id;
  return typeof id === "string" ? id : undefined;
}

type DriverResourceSummary = {
  id: string;
  kind: string;
  clipNames: string[];
};

function readDriverResources(snapshot: AppHostSnapshot): DriverResourceSummary[] {
  const driversService = snapshot.services.find((service) => service.id === "drivers");
  const driversSnapshot = readRecord(driversService?.snapshot);
  const drivers = Array.isArray(driversSnapshot?.drivers) ? driversSnapshot.drivers : [];
  const resources: DriverResourceSummary[] = [];
  for (const driver of drivers) {
    const details = readRecord(readRecord(driver)?.details);
    const entries = Array.isArray(details?.resources) ? details.resources : [];
    for (const entry of entries) {
      const record = readRecord(entry);
      if (typeof record?.id === "string" && typeof record.kind === "string") {
        resources.push({
          id: record.id,
          kind: record.kind,
          clipNames: Array.isArray(record.clipNames)
            ? record.clipNames.filter((name): name is string => typeof name === "string")
            : []
        });
      }
    }
  }
  return resources;
}

function readRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function readErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
