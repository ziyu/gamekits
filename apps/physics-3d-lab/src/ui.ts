import type {
  Physics3dLab,
  Physics3dLabCameraPreset,
  Physics3dLabGroupPreset,
  Physics3dLabQueryMode,
  Physics3dLabShape,
  Physics3dLabSnapshot
} from "./physics-3d-lab";

export type Physics3dLabUi = {
  root: HTMLElement;
  viewport: HTMLElement;
  loading: HTMLElement;
  loadingTitle: HTMLElement;
  loadingDetail: HTMLElement;
  status: HTMLElement;
  diagnostics: HTMLElement;
  snapshot: HTMLElement;
  shapeButtons: Record<Physics3dLabShape, HTMLButtonElement>;
  queryButtons: Record<Physics3dLabQueryMode, HTMLButtonElement>;
  groupButtons: Record<Physics3dLabGroupPreset, HTMLButtonElement>;
  cameraButtons: Record<Physics3dLabCameraPreset, HTMLButtonElement>;
  pauseButton: HTMLButtonElement;
  stepButton: HTMLButtonElement;
  spawnButton: HTMLButtonElement;
  resetButton: HTMLButtonElement;
  pushDiagnostic(message: string): void;
};

export type Physics3dLabSnapshotCommit = (snapshot: Physics3dLabSnapshot) => void;

export function renderPhysics3dLabShell(root: HTMLElement): Physics3dLabUi {
  root.className = "physics-3d-lab";

  const shell = element("section", "physics-3d-lab__shell");
  const viewport = element("section", "physics-3d-lab__viewport");
  viewport.tabIndex = 0;
  viewport.setAttribute("aria-label", "Physics 3D Lab viewport");
  const loading = element("section", "physics-3d-lab__loading");
  const loadingPanel = element("div", "physics-3d-lab__loading-panel");
  const loadingTitle = element("strong", undefined, "Booting Physics 3D Lab");
  const loadingDetail = element("span", undefined, "Preparing Three driver and Rapier3D");
  loadingPanel.append(loadingTitle, loadingDetail);
  loading.append(loadingPanel);
  viewport.append(loading);

  const panel = element("aside", "physics-3d-lab__panel");
  const header = element("header", "physics-3d-lab__header");
  header.append(
    element("p", "physics-3d-lab__eyebrow", "GameKits Physics"),
    element("h1", "physics-3d-lab__title", "Physics 3D Lab"),
    element(
      "p",
      "physics-3d-lab__character-hint",
      "Focus the viewport · WASD move · Space jump · Shift dive"
    )
  );

  const status = element("section", "physics-3d-lab__status");
  const diagnostics = element("ol", "physics-3d-lab__diagnostics");
  const snapshot = element("pre", "physics-3d-lab__snapshot", "{}");
  const shapeButtons: Record<Physics3dLabShape, HTMLButtonElement> = {
    box: button("Box", { control: "shape", value: "box" }),
    sphere: button("Sphere", { control: "shape", value: "sphere" }),
    capsule: button("Capsule", { control: "shape", value: "capsule" })
  };
  const queryButtons: Record<Physics3dLabQueryMode, HTMLButtonElement> = {
    point: button("Point", { control: "query", value: "point" }),
    "overlap-box": button("Box", { control: "query", value: "overlap-box" }),
    "overlap-sphere": button("Sphere", { control: "query", value: "overlap-sphere" })
  };
  const groupButtons: Record<Physics3dLabGroupPreset, HTMLButtonElement> = {
    all: button("All", { control: "group", value: "all" }),
    "actor-only": button("Actor", { control: "group", value: "actor-only" }),
    "sensor-only": button("Sensor", { control: "group", value: "sensor-only" })
  };
  const cameraButtons: Record<Physics3dLabCameraPreset, HTMLButtonElement> = {
    overview: button("Overview", { control: "camera", value: "overview" }),
    side: button("Side", { control: "camera", value: "side" }),
    probe: button("Probe", { control: "camera", value: "probe" }),
    free: button("Free", { control: "camera", value: "free" })
  };
  const pauseButton = button("Pause", { control: "pause" });
  const stepButton = button("Step", { control: "step" });
  const spawnButton = button("Spawn", { control: "spawn" });
  const resetButton = button("Reset", { control: "reset" });
  shapeButtons.box.classList.add("is-active");
  queryButtons["overlap-sphere"].classList.add("is-active");
  groupButtons.all.classList.add("is-active");
  cameraButtons.free.classList.add("is-active");

  const transport = element("div", "physics-3d-lab__transport");
  transport.append(pauseButton, stepButton, spawnButton, resetButton);

  panel.append(
    header,
    status,
    controlGroup("Spawn shape", segmented(shapeButtons)),
    controlGroup("Query mode", segmented(queryButtons)),
    controlGroup("Query filter", segmented(groupButtons)),
    controlGroup("Camera", segmented(cameraButtons, "physics-3d-lab__segmented--camera")),
    transport,
    panelSection("Diagnostics", diagnostics),
    panelSection("Snapshot", snapshot)
  );
  shell.append(viewport, panel);
  root.replaceChildren(shell);

  return {
    root,
    viewport,
    loading,
    loadingTitle,
    loadingDetail,
    status,
    diagnostics,
    snapshot,
    shapeButtons,
    queryButtons,
    groupButtons,
    cameraButtons,
    pauseButton,
    stepButton,
    spawnButton,
    resetButton,
    pushDiagnostic(message) {
      const item = element("li", undefined, message);
      diagnostics.prepend(item);
      while (diagnostics.childElementCount > 9) {
        diagnostics.lastElementChild?.remove();
      }
    }
  };
}

export function setPhysics3dLabLoading(
  ui: Physics3dLabUi,
  state: { visible: boolean; title?: string | undefined; detail?: string | undefined }
): void {
  ui.loading.hidden = !state.visible;
  if (state.title !== undefined) {
    ui.loadingTitle.textContent = state.title;
  }
  if (state.detail !== undefined) {
    ui.loadingDetail.textContent = state.detail;
  }
}

export function bindPhysics3dLabUi(
  ui: Physics3dLabUi,
  lab: Physics3dLab,
  commit: Physics3dLabSnapshotCommit = (snapshot) => updatePhysics3dLabUi(ui, snapshot)
): void {
  const apply = (snapshot: Physics3dLabSnapshot, diagnostic?: string | undefined): void => {
    if (diagnostic !== undefined) {
      ui.pushDiagnostic(diagnostic);
    }
    commit(snapshot);
  };
  bindButtons(ui.shapeButtons, (shape) => {
    apply(lab.setShape(shape), `shape ${shape}`);
  });
  bindButtons(ui.queryButtons, (mode) => {
    apply(lab.setQueryMode(mode), `query ${mode}`);
  });
  bindButtons(ui.groupButtons, (preset) => {
    apply(lab.setGroupPreset(preset), `filter ${preset}`);
  });
  bindButtons(ui.cameraButtons, (preset) => {
    apply(lab.setCameraPreset(preset), `camera ${preset}`);
  });
  ui.pauseButton.addEventListener("click", () => {
    const paused = ui.pauseButton.dataset.paused !== "true";
    ui.pauseButton.dataset.paused = String(paused);
    ui.pauseButton.textContent = paused ? "Resume" : "Pause";
    apply(lab.setPaused(paused), paused ? "paused" : "resumed");
  });
  ui.stepButton.addEventListener("click", () => {
    apply(lab.singleStep(), "single step");
  });
  ui.spawnButton.addEventListener("click", () => {
    const snapshot = lab.spawnDrop();
    const spawned = snapshot.objects[snapshot.objects.length - 1];
    apply(snapshot, `spawn ${spawned?.shape.type ?? snapshot.shape}`);
  });
  ui.resetButton.addEventListener("click", () => {
    ui.pauseButton.dataset.paused = "false";
    ui.pauseButton.textContent = "Pause";
    apply(lab.reset(), "reset scene");
  });
}

export function updatePhysics3dLabUi(ui: Physics3dLabUi, snapshot: Physics3dLabSnapshot): void {
  activateButton(ui.shapeButtons, snapshot.shape);
  activateButton(ui.queryButtons, snapshot.queryMode);
  activateButton(ui.groupButtons, snapshot.groupPreset);
  activateButton(ui.cameraButtons, snapshot.cameraPreset);
  ui.viewport.dataset.cameraPreset = snapshot.cameraPreset;
  ui.status.replaceChildren(
    statusTile("Backend", snapshot.scene.backend),
    statusTile("Shape", snapshot.shape),
    statusTile("Bodies", String(snapshot.scene.bodyCount)),
    statusTile("Colliders", String(snapshot.scene.colliderCount)),
    statusTile("Contacts", String(snapshot.scene.activeContactCount)),
    statusTile("Query", String(snapshot.queryHits.length)),
    statusTile("Motor", snapshot.character.state.mode),
    statusTile("Step", String(snapshot.stepCount))
  );
  ui.snapshot.textContent = JSON.stringify(
    {
      paused: snapshot.paused,
      shape: snapshot.shape,
      queryMode: snapshot.queryMode,
      groupPreset: snapshot.groupPreset,
      cameraPreset: snapshot.cameraPreset,
      queryPoint: snapshot.queryPoint,
      character: {
        mode: snapshot.character.state.mode,
        grounded: snapshot.character.state.grounded,
        facingYaw: snapshot.character.state.facingYaw,
        diagnostics: snapshot.character.diagnostics
      },
      objects: snapshot.objects.map((object) => ({
        id: object.id,
        role: object.role,
        shape: object.shape.type,
        position: roundVector(object.position)
      })),
      spinnerQuaternion: snapshot.spinnerQuaternion,
      contacts: snapshot.contacts.map((contact) => ({
        type: `${contact.kind}.${contact.phase}`,
        colliderA: contact.colliderA,
        colliderB: contact.colliderB
      })),
      queryHits: snapshot.queryHits.map((hit) => hit.colliderId),
      native: snapshot.nativeSummary
    },
    null,
    2
  );
}

function bindButtons<T extends string>(
  buttons: Record<T, HTMLButtonElement>,
  handler: (value: T) => void
): void {
  for (const [value, target] of Object.entries(buttons) as Array<[T, HTMLButtonElement]>) {
    target.addEventListener("click", () => handler(value));
  }
}

function activateButton<T extends string>(buttons: Record<T, HTMLButtonElement>, active: T): void {
  for (const [value, target] of Object.entries(buttons) as Array<[T, HTMLButtonElement]>) {
    target.classList.toggle("is-active", value === active);
  }
}

function panelSection(title: string, content: HTMLElement): HTMLElement {
  const section = element("section", "physics-3d-lab__section");
  section.append(element("h2", undefined, title), content);
  return section;
}

function controlGroup(title: string, content: HTMLElement): HTMLElement {
  const group = element("section", "physics-3d-lab__control-group");
  group.append(element("h2", undefined, title), content);
  return group;
}

function segmented<T extends string>(
  buttons: Record<T, HTMLButtonElement>,
  modifier?: string | undefined
): HTMLElement {
  const row = element(
    "div",
    modifier ? `physics-3d-lab__segmented ${modifier}` : "physics-3d-lab__segmented"
  );
  row.append(...(Object.values(buttons) as HTMLButtonElement[]));
  return row;
}

function statusTile(label: string, value: string): HTMLElement {
  const tile = element("div", "physics-3d-lab__status-tile");
  tile.append(element("span", undefined, label), element("strong", undefined, value));
  return tile;
}

function button(
  label: string,
  data?: { control: string; value?: string | undefined } | undefined
): HTMLButtonElement {
  const target = document.createElement("button");
  target.type = "button";
  target.textContent = label;
  if (data !== undefined) {
    target.dataset.physicsControl = data.control;
    if (data.value !== undefined) {
      target.dataset.physicsValue = data.value;
    }
  }
  return target;
}

function roundVector(vector: { x: number; y: number; z?: number | undefined }) {
  return {
    x: round(vector.x),
    y: round(vector.y),
    z: round(vector.z ?? 0)
  };
}

function round(value: number): number {
  return Number(value.toFixed(2));
}

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string | undefined,
  text?: string | undefined
): HTMLElementTagNameMap[K] {
  const target = document.createElement(tag);
  if (className) {
    target.className = className;
  }
  if (text !== undefined) {
    target.textContent = text;
  }
  return target;
}
