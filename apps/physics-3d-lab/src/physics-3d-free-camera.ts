import type { ThreeRendererNative } from "@gamekits/driver-three";
import * as THREE from "three";

export type Physics3dFreeCameraState = {
  target: { x: number; y: number; z: number };
  yaw: number;
  pitch: number;
  distance: number;
  zoom: number;
};

export type Physics3dFreeCameraController = {
  apply(): void;
  destroy(): void;
  isDragging(): boolean;
  state(): Physics3dFreeCameraState;
};

const DEFAULT_STATE: Physics3dFreeCameraState = {
  target: { x: 0, y: 80, z: 0 },
  yaw: 0.64,
  pitch: 0.36,
  distance: 1000,
  zoom: 0.7
};
const MIN_PITCH = -0.85;
const MAX_PITCH = 1.15;
const MIN_ZOOM = 0.32;
const MAX_ZOOM = 2.4;
const ORBIT_SPEED = 0.008;
const PITCH_SPEED = 0.006;
const PAN_SPEED = 0.85;
const ZOOM_SPEED = 0.0015;

export function createPhysics3dFreeCameraState(
  initial?: Partial<Physics3dFreeCameraState>
): Physics3dFreeCameraState {
  return {
    target: { ...DEFAULT_STATE.target, ...initial?.target },
    yaw: initial?.yaw ?? DEFAULT_STATE.yaw,
    pitch: initial?.pitch ?? DEFAULT_STATE.pitch,
    distance: initial?.distance ?? DEFAULT_STATE.distance,
    zoom: initial?.zoom ?? DEFAULT_STATE.zoom
  };
}

export function createPhysics3dFreeCamera(
  native: ThreeRendererNative,
  viewport: HTMLElement,
  options: { enabled: () => boolean }
): Physics3dFreeCameraController {
  const state = createPhysics3dFreeCameraState();
  let pointerId: number | undefined;
  let lastX = 0;
  let lastY = 0;
  let mode: "orbit" | "pan" = "orbit";

  const finishDrag = (): void => {
    pointerId = undefined;
    viewport.dataset.cameraDragging = "false";
  };

  const onPointerDown = (event: PointerEvent): void => {
    if (!options.enabled() || (event.button !== 0 && event.button !== 2)) {
      return;
    }
    event.preventDefault();
    viewport.focus();
    pointerId = event.pointerId;
    lastX = event.clientX;
    lastY = event.clientY;
    mode = event.button === 2 || event.shiftKey ? "pan" : "orbit";
    viewport.dataset.cameraDragging = "true";
    viewport.setPointerCapture(event.pointerId);
  };
  const onPointerMove = (event: PointerEvent): void => {
    if (!options.enabled()) {
      finishDrag();
      return;
    }
    if (pointerId !== event.pointerId) {
      return;
    }
    event.preventDefault();
    const deltaX = event.clientX - lastX;
    const deltaY = event.clientY - lastY;
    lastX = event.clientX;
    lastY = event.clientY;
    if (mode === "pan" || event.shiftKey) {
      panPhysics3dFreeCamera(state, deltaX, deltaY);
    } else {
      orbitPhysics3dFreeCamera(state, deltaX, deltaY);
    }
    applyPhysics3dFreeCamera(native, state);
  };
  const onPointerUp = (event: PointerEvent): void => {
    if (pointerId !== event.pointerId) {
      return;
    }
    finishDrag();
  };
  const onWheel = (event: WheelEvent): void => {
    if (!options.enabled()) {
      return;
    }
    event.preventDefault();
    zoomPhysics3dFreeCamera(state, event.deltaY);
    applyPhysics3dFreeCamera(native, state);
  };
  const onContextMenu = (event: MouseEvent): void => {
    if (options.enabled()) {
      event.preventDefault();
    }
  };

  viewport.addEventListener("pointerdown", onPointerDown);
  viewport.addEventListener("pointermove", onPointerMove);
  viewport.addEventListener("pointerup", onPointerUp);
  viewport.addEventListener("pointercancel", onPointerUp);
  viewport.addEventListener("wheel", onWheel, { passive: false });
  viewport.addEventListener("contextmenu", onContextMenu);

  return {
    apply() {
      applyPhysics3dFreeCamera(native, state);
    },
    destroy() {
      viewport.removeEventListener("pointerdown", onPointerDown);
      viewport.removeEventListener("pointermove", onPointerMove);
      viewport.removeEventListener("pointerup", onPointerUp);
      viewport.removeEventListener("pointercancel", onPointerUp);
      viewport.removeEventListener("wheel", onWheel);
      viewport.removeEventListener("contextmenu", onContextMenu);
      finishDrag();
    },
    isDragging() {
      return pointerId !== undefined;
    },
    state() {
      return cloneState(state);
    }
  };
}

export function orbitPhysics3dFreeCamera(
  state: Physics3dFreeCameraState,
  deltaX: number,
  deltaY: number
): void {
  state.yaw -= deltaX * ORBIT_SPEED;
  state.pitch = clamp(state.pitch - deltaY * PITCH_SPEED, MIN_PITCH, MAX_PITCH);
}

export function panPhysics3dFreeCamera(
  state: Physics3dFreeCameraState,
  deltaX: number,
  deltaY: number
): void {
  const right = cameraRight(state.yaw);
  const up = cameraUp(state.yaw, state.pitch);
  const scale = PAN_SPEED / Math.max(MIN_ZOOM, state.zoom);
  state.target.x += (-right.x * deltaX + up.x * deltaY) * scale;
  state.target.y += up.y * deltaY * scale;
  state.target.z += (-right.z * deltaX + up.z * deltaY) * scale;
}

export function zoomPhysics3dFreeCamera(state: Physics3dFreeCameraState, deltaY: number): void {
  state.zoom = clamp(state.zoom * Math.exp(-deltaY * ZOOM_SPEED), MIN_ZOOM, MAX_ZOOM);
}

export function applyPhysics3dFreeCamera(
  native: Pick<ThreeRendererNative, "camera">,
  state: Physics3dFreeCameraState
): void {
  const camera = native.camera as THREE.Camera & {
    zoom?: number | undefined;
    updateProjectionMatrix?: (() => void) | undefined;
  };
  const offset = cameraOffset(state);
  camera.up.set(0, 1, 0);
  camera.position.set(
    state.target.x + offset.x,
    state.target.y + offset.y,
    state.target.z + offset.z
  );
  camera.lookAt(state.target.x, state.target.y, state.target.z);
  if (typeof camera.zoom === "number") {
    camera.zoom = state.zoom;
    camera.updateProjectionMatrix?.();
  }
  camera.updateMatrixWorld();
}

function cameraOffset(state: Physics3dFreeCameraState): { x: number; y: number; z: number } {
  const cosPitch = Math.cos(state.pitch);
  return {
    x: Math.sin(state.yaw) * cosPitch * state.distance,
    y: Math.sin(state.pitch) * state.distance,
    z: Math.cos(state.yaw) * cosPitch * state.distance
  };
}

function cameraRight(yaw: number): { x: number; z: number } {
  return {
    x: Math.cos(yaw),
    z: -Math.sin(yaw)
  };
}

function cameraUp(
  yaw: number,
  pitch: number
): {
  x: number;
  y: number;
  z: number;
} {
  return {
    x: -Math.sin(yaw) * Math.sin(pitch),
    y: Math.cos(pitch),
    z: -Math.cos(yaw) * Math.sin(pitch)
  };
}

function cloneState(state: Physics3dFreeCameraState): Physics3dFreeCameraState {
  return {
    target: { ...state.target },
    yaw: state.yaw,
    pitch: state.pitch,
    distance: state.distance,
    zoom: state.zoom
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
