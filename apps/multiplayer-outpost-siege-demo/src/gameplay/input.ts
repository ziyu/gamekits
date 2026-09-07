import type { InputActionEvent, InputRouter } from "@gamekits/input-core";
import { STANDARD_GAMEPAD_CONTROL } from "@gamekits/input-dom";

export const OUTPOST_GAME_CONTEXT_ID = "outpost.gameplay";
const MAX_ACTIVE_CONTROLS_PER_ACTION = 8;

export const OUTPOST_ACTION = {
  moveUp: "outpost.move.up",
  moveDown: "outpost.move.down",
  moveLeft: "outpost.move.left",
  moveRight: "outpost.move.right",
  aim: "outpost.aim",
  aimUp: "outpost.aim.up",
  aimDown: "outpost.aim.down",
  aimLeft: "outpost.aim.left",
  aimRight: "outpost.aim.right",
  primary: "outpost.ability.primary",
  dash: "outpost.ability.dash",
  shockField: "outpost.ability.shock-field",
  deployTurret: "outpost.build.turret",
  reload: "outpost.weapon.reload",
  cameraZoom: "outpost.camera.zoom"
} as const;

export type OutpostInputState = {
  held: {
    up: boolean;
    down: boolean;
    left: boolean;
    right: boolean;
  };
  moveX: number;
  moveY: number;
  aimX: number;
  aimY: number;
  aimMode: "pointer" | "gamepad";
  pointerViewportX?: number | undefined;
  pointerViewportY?: number | undefined;
  aimStickX: number;
  aimStickY: number;
  lastAimStickX: number;
  lastAimStickY: number;
  fireHeld: boolean;
  fireSequence: number;
  dashSequence: number;
  primaryRequested: boolean;
  dashRequested: boolean;
  shockFieldRequested: boolean;
  deployTurretRequested: boolean;
  cameraZoomDelta: number;
  cameraZoomX?: number | undefined;
  cameraZoomY?: number | undefined;
  activeControls: {
    moveUp: Map<string, number>;
    moveDown: Map<string, number>;
    moveLeft: Map<string, number>;
    moveRight: Map<string, number>;
    aimUp: Map<string, number>;
    aimDown: Map<string, number>;
    aimLeft: Map<string, number>;
    aimRight: Map<string, number>;
    primary: Map<string, number>;
  };
};

export function createOutpostInputState(): OutpostInputState {
  return {
    held: { up: false, down: false, left: false, right: false },
    moveX: 0,
    moveY: 0,
    aimX: 0,
    aimY: 0,
    aimMode: "pointer",
    aimStickX: 0,
    aimStickY: 0,
    lastAimStickX: 1,
    lastAimStickY: 0,
    fireHeld: false,
    fireSequence: 0,
    dashSequence: 0,
    primaryRequested: false,
    dashRequested: false,
    shockFieldRequested: false,
    deployTurretRequested: false,
    cameraZoomDelta: 0,
    activeControls: createActiveControlState()
  };
}

export function configureOutpostInputRouter(router: InputRouter): void {
  router.addContext({
    id: OUTPOST_GAME_CONTEXT_ID,
    priority: 100,
    scopes: ["game"],
    capture: true,
    actionIds: Object.values(OUTPOST_ACTION)
  });

  registerMovement(
    router,
    OUTPOST_ACTION.moveUp,
    "Move up",
    "KeyW",
    STANDARD_GAMEPAD_CONTROL.leftYNegative
  );
  registerMovement(
    router,
    OUTPOST_ACTION.moveDown,
    "Move down",
    "KeyS",
    STANDARD_GAMEPAD_CONTROL.leftYPositive
  );
  registerMovement(
    router,
    OUTPOST_ACTION.moveLeft,
    "Move left",
    "KeyA",
    STANDARD_GAMEPAD_CONTROL.leftXNegative
  );
  registerMovement(
    router,
    OUTPOST_ACTION.moveRight,
    "Move right",
    "KeyD",
    STANDARD_GAMEPAD_CONTROL.leftXPositive
  );
  register(router, OUTPOST_ACTION.aim, "Aim", [{ device: "mouse", phase: "moved" }]);
  registerGamepadAnalog(
    router,
    OUTPOST_ACTION.aimUp,
    "Aim up",
    STANDARD_GAMEPAD_CONTROL.rightYNegative
  );
  registerGamepadAnalog(
    router,
    OUTPOST_ACTION.aimDown,
    "Aim down",
    STANDARD_GAMEPAD_CONTROL.rightYPositive
  );
  registerGamepadAnalog(
    router,
    OUTPOST_ACTION.aimLeft,
    "Aim left",
    STANDARD_GAMEPAD_CONTROL.rightXNegative
  );
  registerGamepadAnalog(
    router,
    OUTPOST_ACTION.aimRight,
    "Aim right",
    STANDARD_GAMEPAD_CONTROL.rightXPositive
  );
  register(router, OUTPOST_ACTION.primary, "Rifle fire", [
    { device: "mouse", button: "primary", phase: "pressed" },
    { device: "mouse", button: "primary", phase: "held" },
    { device: "mouse", button: "primary", phase: "released" },
    { device: "mouse", button: "primary", phase: "cancelled" },
    ...gamepadAnalogBindings(STANDARD_GAMEPAD_CONTROL.rightTrigger)
  ]);
  register(router, OUTPOST_ACTION.reload, "Reload rifle", [
    { device: "keyboard", code: "KeyR", phase: "pressed" },
    { device: "gamepad", code: STANDARD_GAMEPAD_CONTROL.buttonWest, phase: "pressed" }
  ]);
  register(router, OUTPOST_ACTION.dash, "Dash", [
    { device: "keyboard", code: "Space", phase: "pressed" },
    { device: "gamepad", code: STANDARD_GAMEPAD_CONTROL.buttonSouth, phase: "pressed" }
  ]);
  register(router, OUTPOST_ACTION.shockField, "Shock field", [
    { device: "keyboard", code: "KeyQ", phase: "pressed" },
    { device: "gamepad", code: STANDARD_GAMEPAD_CONTROL.leftBumper, phase: "pressed" }
  ]);
  register(router, OUTPOST_ACTION.deployTurret, "Deploy turret", [
    { device: "keyboard", code: "KeyE", phase: "pressed" },
    { device: "gamepad", code: STANDARD_GAMEPAD_CONTROL.buttonNorth, phase: "pressed" }
  ]);
  register(router, OUTPOST_ACTION.cameraZoom, "Camera zoom", [
    { device: "mouse", phase: "scrolled" }
  ]);
}

export function applyOutpostInputAction(state: OutpostInputState, event: InputActionEvent): void {
  const active = event.phase !== "released" && event.phase !== "cancelled";
  switch (event.actionId) {
    case OUTPOST_ACTION.moveUp:
      state.held.up = updateActiveControl(state.activeControls.moveUp, event) > 0;
      updateMovement(state);
      return;
    case OUTPOST_ACTION.moveDown:
      state.held.down = updateActiveControl(state.activeControls.moveDown, event) > 0;
      updateMovement(state);
      return;
    case OUTPOST_ACTION.moveLeft:
      state.held.left = updateActiveControl(state.activeControls.moveLeft, event) > 0;
      updateMovement(state);
      return;
    case OUTPOST_ACTION.moveRight:
      state.held.right = updateActiveControl(state.activeControls.moveRight, event) > 0;
      updateMovement(state);
      return;
    case OUTPOST_ACTION.aim:
      state.aimX = event.input.x ?? state.aimX;
      state.aimY = event.input.y ?? state.aimY;
      state.aimMode = "pointer";
      return;
    case OUTPOST_ACTION.aimUp:
      updateActiveControl(state.activeControls.aimUp, event);
      updateStickAim(state, active);
      return;
    case OUTPOST_ACTION.aimDown:
      updateActiveControl(state.activeControls.aimDown, event);
      updateStickAim(state, active);
      return;
    case OUTPOST_ACTION.aimLeft:
      updateActiveControl(state.activeControls.aimLeft, event);
      updateStickAim(state, active);
      return;
    case OUTPOST_ACTION.aimRight:
      updateActiveControl(state.activeControls.aimRight, event);
      updateStickAim(state, active);
      return;
    case OUTPOST_ACTION.primary:
      state.fireHeld = updateActiveControl(state.activeControls.primary, event) > 0;
      if (event.phase === "pressed") {
        state.fireSequence = (state.fireSequence + 1) >>> 0;
      }
      state.primaryRequested ||= event.phase === "pressed";
      return;
    case OUTPOST_ACTION.reload:
      return;
    case OUTPOST_ACTION.dash:
      if (event.phase === "pressed") {
        state.dashSequence = (state.dashSequence + 1) >>> 0;
      }
      state.dashRequested ||= event.phase === "pressed";
      return;
    case OUTPOST_ACTION.shockField:
      state.shockFieldRequested ||= event.phase === "pressed";
      return;
    case OUTPOST_ACTION.deployTurret:
      state.deployTurretRequested ||= event.phase === "pressed";
      return;
    case OUTPOST_ACTION.cameraZoom:
      state.cameraZoomDelta = event.input.wheelDelta ?? 0;
      state.cameraZoomX = event.input.x;
      state.cameraZoomY = event.input.y;
  }
}

export function applyOutpostGamepadAimTarget(
  state: OutpostInputState,
  origin: { x: number; y: number },
  distance = 480
): boolean {
  if (state.aimMode !== "gamepad") {
    return false;
  }
  const x = state.aimStickX === 0 && state.aimStickY === 0 ? state.lastAimStickX : state.aimStickX;
  const y = state.aimStickX === 0 && state.aimStickY === 0 ? state.lastAimStickY : state.aimStickY;
  const length = Math.hypot(x, y);
  if (length === 0) {
    return false;
  }
  state.aimX = origin.x + (x / length) * distance;
  state.aimY = origin.y + (y / length) * distance;
  return true;
}

export function setOutpostPointerViewportPosition(
  state: OutpostInputState,
  point: { x: number; y: number }
): void {
  state.pointerViewportX = point.x;
  state.pointerViewportY = point.y;
}

export function clearOutpostTransientInput(state: OutpostInputState): void {
  state.primaryRequested = false;
  state.dashRequested = false;
  state.shockFieldRequested = false;
  state.deployTurretRequested = false;
  state.cameraZoomDelta = 0;
  delete state.cameraZoomX;
  delete state.cameraZoomY;
}

function updateMovement(state: OutpostInputState): void {
  state.moveX =
    maxActiveValue(state.activeControls.moveRight) - maxActiveValue(state.activeControls.moveLeft);
  state.moveY =
    maxActiveValue(state.activeControls.moveDown) - maxActiveValue(state.activeControls.moveUp);
}

function registerMovement(
  router: InputRouter,
  id: string,
  name: string,
  code: string,
  gamepadCode: string
): void {
  register(router, id, name, [
    { device: "keyboard", code, phase: "pressed" },
    { device: "keyboard", code, phase: "held" },
    { device: "keyboard", code, phase: "released" },
    ...gamepadAnalogBindings(gamepadCode)
  ]);
}

function registerGamepadAnalog(router: InputRouter, id: string, name: string, code: string): void {
  register(router, id, name, gamepadAnalogBindings(code));
}

function gamepadAnalogBindings(code: string) {
  return [
    { device: "gamepad" as const, code, phase: "pressed" as const },
    { device: "gamepad" as const, code, phase: "held" as const },
    { device: "gamepad" as const, code, phase: "released" as const },
    { device: "gamepad" as const, code, phase: "cancelled" as const }
  ];
}

function createActiveControlState(): OutpostInputState["activeControls"] {
  return {
    moveUp: new Map(),
    moveDown: new Map(),
    moveLeft: new Map(),
    moveRight: new Map(),
    aimUp: new Map(),
    aimDown: new Map(),
    aimLeft: new Map(),
    aimRight: new Map(),
    primary: new Map()
  };
}

function updateActiveControl(controls: Map<string, number>, event: InputActionEvent): number {
  const key = inputControlKey(event);
  if (event.phase === "released" || event.phase === "cancelled" || event.value <= 0) {
    controls.delete(key);
  } else {
    if (!controls.has(key) && controls.size >= MAX_ACTIVE_CONTROLS_PER_ACTION) {
      return maxActiveValue(controls);
    }
    controls.set(key, Math.min(1, event.value));
  }
  return maxActiveValue(controls);
}

function maxActiveValue(controls: Map<string, number>): number {
  let maximum = 0;
  for (const value of controls.values()) {
    maximum = Math.max(maximum, value);
  }
  return maximum;
}

function inputControlKey(event: InputActionEvent): string {
  return `${event.input.device}:${event.input.deviceId ?? event.input.source ?? "default"}:${event.input.code ?? ""}:${event.input.button ?? ""}:${event.input.pointerId ?? ""}`;
}

function updateStickAim(state: OutpostInputState, active: boolean): void {
  state.aimStickX =
    maxActiveValue(state.activeControls.aimRight) - maxActiveValue(state.activeControls.aimLeft);
  state.aimStickY =
    maxActiveValue(state.activeControls.aimDown) - maxActiveValue(state.activeControls.aimUp);
  if (!active || (state.aimStickX === 0 && state.aimStickY === 0)) {
    return;
  }
  state.aimMode = "gamepad";
  state.lastAimStickX = state.aimStickX;
  state.lastAimStickY = state.aimStickY;
}

function register(
  router: InputRouter,
  id: string,
  name: string,
  defaultBindings: Parameters<InputRouter["registerAction"]>[0]["defaultBindings"]
): void {
  router.registerAction({ id, name, category: "gameplay", scopes: ["game"], defaultBindings });
}
