import { worldToScreen } from "@gamekits/camera-core";
import type { EntityId } from "@gamekits/world";
import { SANDBOX_RENDER_SIZE, type SandboxSnapshot } from "../game";
import { formatNumber } from "./format";
import type { SandboxUiHandles, SandboxWorkbenchState } from "./types";

export type SceneOverlayLiveData = {
  resolveEntityPosition?:
    | ((entityId: EntityId) => { x: number; y: number } | undefined)
    | undefined;
};

export function renderSceneOverlay(
  handles: SandboxUiHandles,
  snapshot: SandboxSnapshot,
  state: SandboxWorkbenchState,
  liveData: SceneOverlayLiveData = {}
): void {
  const selectedEntity = readSelectedEntity(snapshot, state);
  if (!selectedEntity) {
    delete handles.sceneOverlay.dataset.overlayKey;
    handles.sceneOverlay.replaceChildren();
    return;
  }

  const camera = handles.latestCameraStatus ?? {
    mode: "free",
    x: SANDBOX_RENDER_SIZE.width / 2,
    y: SANDBOX_RENDER_SIZE.height / 2,
    zoom: 1,
    rotation: 0,
    viewport: SANDBOX_RENDER_SIZE,
    minZoom: 0.5,
    maxZoom: 3
  };
  const livePosition = liveData.resolveEntityPosition?.(selectedEntity.id);
  const screen = worldToScreen(
    camera,
    worldPercentToPoint(livePosition?.x ?? selectedEntity.x, livePosition?.y ?? selectedEntity.y)
  );
  const left = `${(screen.x / SANDBOX_RENDER_SIZE.width) * 100}%`;
  const top = `${(screen.y / SANDBOX_RENDER_SIZE.height) * 100}%`;
  const size = selectedEntity.role === "campfire" ? 82 : selectedEntity.role === "worker" ? 48 : 66;
  const storage = renderEntityStorage(selectedEntity);
  const building = renderBuildingState(selectedEntity);
  const task = renderWorkState(selectedEntity);
  const overlayKey = `${selectedEntity.id}:${state.followedEntityId === selectedEntity.id}`;

  if (handles.sceneOverlay.dataset.overlayKey === overlayKey) {
    updateSceneOverlayPosition(handles.sceneOverlay, left, top, size);
    if (!isSceneObjectCardActive(handles.sceneOverlay)) {
      updateSceneObjectCard(handles.sceneOverlay, {
        storage,
        building,
        task
      });
    }
    return;
  }

  handles.sceneOverlay.dataset.overlayKey = overlayKey;
  handles.sceneOverlay.replaceChildren(
    createFocusElement({
      left,
      top,
      role: selectedEntity.role,
      size
    }),
    createSceneObjectCard({
      building,
      entityId: String(selectedEntity.id),
      isFollowed: state.followedEntityId === selectedEntity.id,
      label: selectedEntity.label ?? selectedEntity.objectId ?? String(selectedEntity.id),
      left,
      role: selectedEntity.role ?? "object",
      storage,
      task,
      top
    })
  );
}

function createFocusElement(input: {
  left: string;
  role: string | undefined;
  size: number;
  top: string;
}): HTMLElement {
  const focus = document.createElement("div");
  focus.className =
    input.role === "worker" ? "scene-focus scene-focus--unit" : "scene-focus scene-focus--building";
  focus.style.left = input.left;
  focus.style.top = input.top;
  focus.style.setProperty("--focus-size", `${input.size}px`);
  focus.append(
    createFocusCorner("nw"),
    createFocusCorner("ne"),
    createFocusCorner("sw"),
    createFocusCorner("se")
  );
  return focus;
}

function createFocusCorner(position: "nw" | "ne" | "sw" | "se"): HTMLElement {
  const corner = document.createElement("span");
  corner.className = `scene-focus__corner scene-focus__corner--${position}`;
  return corner;
}

function createSceneObjectCard(input: {
  building: string;
  entityId: string;
  isFollowed: boolean;
  label: string;
  left: string;
  role: string;
  storage: string;
  task: string;
  top: string;
}): HTMLElement {
  const card = document.createElement("section");
  card.className = "scene-object-card";
  card.style.left = input.left;
  card.style.top = input.top;

  const title = document.createElement("div");
  const role = document.createElement("span");
  role.textContent = input.role;
  const label = document.createElement("strong");
  label.textContent = input.label;
  title.append(role, label);

  const stats = document.createElement("dl");
  stats.append(
    createCardField("Storage", "storage", input.storage),
    createCardField("Building", "building", input.building),
    createCardField("Task", "task", input.task)
  );

  const actions = document.createElement("div");
  actions.className = "scene-object-card__actions";

  const inspect = document.createElement("button");
  inspect.type = "button";
  inspect.dataset.sceneInspect = input.entityId;
  inspect.textContent = "Inspect";

  const follow = document.createElement("button");
  follow.type = "button";
  follow.dataset.cameraFollow = input.entityId;
  follow.textContent = "Follow";
  follow.classList.toggle("is-selected", input.isFollowed);

  actions.append(inspect, follow);
  card.append(title, stats, actions);
  return card;
}

function createCardField(
  labelText: string,
  field: "storage" | "building" | "task",
  value: string
): HTMLElement {
  const row = document.createElement("div");
  const label = document.createElement("dt");
  label.textContent = labelText;
  const data = document.createElement("dd");
  data.dataset.sceneCardField = field;
  data.textContent = value;
  row.append(label, data);
  return row;
}

function updateSceneOverlayPosition(
  overlay: HTMLElement,
  left: string,
  top: string,
  size: number
): void {
  const focus = overlay.querySelector<HTMLElement>(".scene-focus");
  if (focus) {
    focus.style.left = left;
    focus.style.top = top;
    focus.style.setProperty("--focus-size", `${size}px`);
  }

  const card = overlay.querySelector<HTMLElement>(".scene-object-card");
  if (card) {
    card.style.left = left;
    card.style.top = top;
  }
}

function updateSceneObjectCard(
  overlay: HTMLElement,
  fields: { storage: string; building: string; task: string }
): void {
  setCardField(overlay, "storage", fields.storage);
  setCardField(overlay, "building", fields.building);
  setCardField(overlay, "task", fields.task);
}

function setCardField(overlay: HTMLElement, field: string, value: string): void {
  const element = overlay.querySelector<HTMLElement>(`[data-scene-card-field="${field}"]`);
  if (element && element.textContent !== value) {
    element.textContent = value;
  }
}

function isSceneObjectCardActive(overlay: HTMLElement): boolean {
  const card = overlay.querySelector<HTMLElement>(".scene-object-card");
  if (!card) {
    return false;
  }

  const selection = document.getSelection();
  return (
    card.matches(":hover") ||
    card.contains(document.activeElement) ||
    (selection !== null &&
      selection.type === "Range" &&
      selection.anchorNode !== null &&
      card.contains(selection.anchorNode))
  );
}

function readSelectedEntity(
  snapshot: SandboxSnapshot,
  state: SandboxWorkbenchState
): SandboxSnapshot["entities"][number] | undefined {
  if (state.selectionCleared === true) {
    return undefined;
  }

  return (
    snapshot.entities.find((entity) => entity.id === snapshot.selected?.entityId) ??
    snapshot.entities.find((entity) => entity.id === state.selectedEntityId) ??
    snapshot.entities.find((entity) => entity.actorId === state.selectedActorId)
  );
}

function worldPercentToPoint(percentX: number, percentY: number): { x: number; y: number } {
  return {
    x: (percentX / 100) * SANDBOX_RENDER_SIZE.width,
    y: (percentY / 100) * SANDBOX_RENDER_SIZE.height
  };
}

function renderEntityStorage(entity: SandboxSnapshot["entities"][number]): string {
  if (entity.resource === undefined || entity.capacity === undefined) {
    return "none";
  }

  const materials =
    entity.materials && entity.materials > 0 ? ` · ${formatNumber(entity.materials)} mat` : "";
  return `${formatNumber(entity.resource)} / ${formatNumber(entity.capacity)} res${materials}`;
}

function renderBuildingState(entity: SandboxSnapshot["entities"][number]): string {
  if (!entity.building) {
    return "none";
  }

  return `${entity.building.zone} · ${formatNumber(entity.building.health)} health · ${formatNumber(entity.building.heat)} heat`;
}

function renderWorkState(entity: SandboxSnapshot["entities"][number]): string {
  if (!entity.task) {
    return entity.role === "worker" ? "idle" : "none";
  }

  return `${entity.task}/${entity.taskStatus ?? "idle"} → ${entity.targetObjectId ?? "none"}`;
}
