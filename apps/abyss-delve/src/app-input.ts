import type { InputActionEvent, InputRouter, NormalizedInputEvent } from "@gamekits/input-core";
import type { AbyssInputState } from "./game";
export { createAbyssInputState } from "./game/input-state";

export const ABYSS_GAME_CONTEXT_ID = "abyss.gameplay";

export const ABYSS_ACTION = {
  moveUp: "abyss.move_up",
  moveDown: "abyss.move_down",
  moveLeft: "abyss.move_left",
  moveRight: "abyss.move_right",
  aim: "abyss.aim",
  attack: "abyss.attack.basic",
  skillPrimary: "abyss.skill.primary",
  skillSecondary: "abyss.skill.secondary",
  dodge: "abyss.dodge",
  interact: "abyss.interact",
  cameraZoom: "abyss.camera.zoom",
  inventory: "abyss.inventory.toggle",
  pause: "abyss.pause.toggle"
} as const;

export function configureAbyssInputRouter(router: InputRouter): void {
  router.addContext({
    id: ABYSS_GAME_CONTEXT_ID,
    priority: 100,
    scopes: ["game"],
    capture: true,
    actionIds: Object.values(ABYSS_ACTION)
  });

  register(router, ABYSS_ACTION.moveUp, "Move Up", [
    { device: "keyboard", code: "KeyW", phase: "pressed" },
    { device: "keyboard", code: "KeyW", phase: "held" },
    { device: "keyboard", code: "KeyW", phase: "released" }
  ]);
  register(router, ABYSS_ACTION.moveDown, "Move Down", [
    { device: "keyboard", code: "KeyS", phase: "pressed" },
    { device: "keyboard", code: "KeyS", phase: "held" },
    { device: "keyboard", code: "KeyS", phase: "released" }
  ]);
  register(router, ABYSS_ACTION.moveLeft, "Move Left", [
    { device: "keyboard", code: "KeyA", phase: "pressed" },
    { device: "keyboard", code: "KeyA", phase: "held" },
    { device: "keyboard", code: "KeyA", phase: "released" }
  ]);
  register(router, ABYSS_ACTION.moveRight, "Move Right", [
    { device: "keyboard", code: "KeyD", phase: "pressed" },
    { device: "keyboard", code: "KeyD", phase: "held" },
    { device: "keyboard", code: "KeyD", phase: "released" }
  ]);
  register(router, ABYSS_ACTION.aim, "Aim", [{ device: "mouse", phase: "moved" }]);
  register(router, ABYSS_ACTION.attack, "Basic Attack", [
    { device: "mouse", button: "primary", phase: "pressed" }
  ]);
  register(router, ABYSS_ACTION.skillPrimary, "Cinder Bolt", [
    { device: "mouse", button: "secondary", phase: "pressed" }
  ]);
  register(router, ABYSS_ACTION.skillSecondary, "Void Cleave", [
    { device: "keyboard", code: "Digit1", phase: "pressed" }
  ]);
  register(router, ABYSS_ACTION.dodge, "Dodge", [
    { device: "keyboard", code: "Space", phase: "pressed" }
  ]);
  register(router, ABYSS_ACTION.interact, "Interact", [
    { device: "keyboard", code: "KeyE", phase: "pressed" }
  ]);
  register(router, ABYSS_ACTION.cameraZoom, "Camera Zoom", [
    { device: "mouse", phase: "scrolled" }
  ]);
  register(router, ABYSS_ACTION.inventory, "Inventory", [
    { device: "keyboard", code: "KeyI", phase: "pressed" },
    { device: "keyboard", code: "Tab", phase: "pressed" }
  ]);
  register(router, ABYSS_ACTION.pause, "Pause", [
    { device: "keyboard", code: "Escape", phase: "pressed" }
  ]);
}

export function applyAbyssInputAction(state: AbyssInputState, event: InputActionEvent): void {
  if (
    state.gameplayBlocked &&
    isGameplayAction(event.actionId) &&
    event.phase !== "released" &&
    event.phase !== "cancelled"
  ) {
    return;
  }

  if (event.actionId === ABYSS_ACTION.moveUp) {
    state.held.up = event.phase !== "released" && event.phase !== "cancelled";
    updateMoveVector(state);
    return;
  }
  if (event.actionId === ABYSS_ACTION.moveDown) {
    state.held.down = event.phase !== "released" && event.phase !== "cancelled";
    updateMoveVector(state);
    return;
  }
  if (event.actionId === ABYSS_ACTION.moveLeft) {
    state.held.left = event.phase !== "released" && event.phase !== "cancelled";
    updateMoveVector(state);
    return;
  }
  if (event.actionId === ABYSS_ACTION.moveRight) {
    state.held.right = event.phase !== "released" && event.phase !== "cancelled";
    updateMoveVector(state);
    return;
  }
  if (event.actionId === ABYSS_ACTION.aim) {
    state.aimX = event.input.x ?? state.aimX;
    state.aimY = event.input.y ?? state.aimY;
    return;
  }
  if (event.actionId === ABYSS_ACTION.attack) {
    state.attackRequested = true;
    return;
  }
  if (event.actionId === ABYSS_ACTION.skillPrimary) {
    state.skillPrimaryRequested = true;
    return;
  }
  if (event.actionId === ABYSS_ACTION.skillSecondary) {
    state.skillSecondaryRequested = true;
    return;
  }
  if (event.actionId === ABYSS_ACTION.dodge) {
    state.dodgeRequested = true;
    return;
  }
  if (event.actionId === ABYSS_ACTION.interact) {
    state.interactRequested = true;
    return;
  }
  if (event.actionId === ABYSS_ACTION.cameraZoom) {
    state.cameraZoomDelta = event.input.wheelDelta ?? 0;
    state.cameraZoomX = event.input.x;
    state.cameraZoomY = event.input.y;
    return;
  }
  if (event.actionId === ABYSS_ACTION.inventory) {
    state.inventoryToggleRequested = true;
    return;
  }
  if (event.actionId === ABYSS_ACTION.pause) {
    state.pauseToggleRequested = true;
  }
}

export function updateAbyssHeldMovement(state: AbyssInputState, router: InputRouter): void {
  for (const event of router.tick({ timestamp: performance.now() })) {
    applyAbyssInputAction(state, event);
  }
}

export function createPointerAimInput(
  event: PointerEvent,
  target: HTMLElement
): NormalizedInputEvent {
  const rect = target.getBoundingClientRect();
  return {
    id: `abyss.pointer.${event.timeStamp}`,
    device: "mouse",
    phase: "moved",
    x: event.clientX - rect.left,
    y: event.clientY - rect.top,
    timestamp: event.timeStamp,
    scope: "game",
    source: "abyss.viewport"
  };
}

function register(
  router: InputRouter,
  id: string,
  name: string,
  defaultBindings: Parameters<InputRouter["registerAction"]>[0]["defaultBindings"]
): void {
  router.registerAction({
    id,
    name,
    category: "gameplay",
    scopes: ["game"],
    defaultBindings
  });
}

function isGameplayAction(actionId: string): boolean {
  return ![ABYSS_ACTION.inventory, ABYSS_ACTION.pause].includes(actionId as never);
}

function updateMoveVector(state: AbyssInputState): void {
  state.moveX = (state.held.right ? 1 : 0) - (state.held.left ? 1 : 0);
  state.moveY = (state.held.down ? 1 : 0) - (state.held.up ? 1 : 0);
}
