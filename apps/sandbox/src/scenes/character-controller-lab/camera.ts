import type { ThreeRendererNative } from "@gamekits/driver-three";
import * as THREE from "three";

const UNIT = 42;
const LOOK_SPEED_X = 0.006;
const LOOK_SPEED_Y = 0.006;
const ZOOM_SPEED = 0.00145;
const MIN_PITCH = -0.35;
const MAX_PITCH = 1.4;
const MIN_DISTANCE = 3.2;
const MAX_DISTANCE = 20;
const MIN_GROUND_CLEARANCE = 0.28;

export type CharacterControllerLabCameraInput = {
  lookDeltaX: number;
  lookDeltaY: number;
  zoomDelta: number;
};

export type CharacterControllerLabCameraSnapshot = {
  yaw: number;
  pitch: number;
  distance: number;
};

export type CharacterControllerLabThirdPersonCamera = {
  camera: THREE.PerspectiveCamera;
  applyInput(input: Readonly<CharacterControllerLabCameraInput>): void;
  movement(moveX: number, moveZ: number): { x: number; z: number };
  update(
    target: Readonly<{ x: number; y: number; z?: number | undefined }>,
    deltaMs: number,
    obstacles: readonly THREE.Object3D[]
  ): void;
  snapshot(): CharacterControllerLabCameraSnapshot;
  destroy(): void;
};

export function createCharacterControllerLabThirdPersonCamera(
  native: ThreeRendererNative
): CharacterControllerLabThirdPersonCamera {
  const camera = new THREE.PerspectiveCamera(55, 16 / 9, 0.12 * UNIT, 120 * UNIT);
  const state: CharacterControllerLabCameraSnapshot = {
    yaw: 0.72,
    pitch: 0.38,
    distance: 8.4
  };
  const target = new THREE.Vector3();
  const desiredTarget = new THREE.Vector3();
  const desiredPosition = new THREE.Vector3();
  const direction = new THREE.Vector3();
  const raycaster = new THREE.Raycaster();
  let initialized = false;
  let renderedDistance = state.distance;
  native.scene.add(camera);

  return {
    camera,
    applyInput(input) {
      Object.assign(state, applyCharacterControllerLabCameraInput(state, input));
    },
    movement(moveX, moveZ) {
      return cameraRelativeCharacterMovement(moveX, moveZ, state.yaw);
    },
    update(nextTarget, deltaMs, obstacles) {
      desiredTarget.set(
        nextTarget.x * UNIT,
        nextTarget.y * UNIT + 0.82 * UNIT,
        (nextTarget.z ?? 0) * UNIT
      );
      if (!initialized || target.distanceToSquared(desiredTarget) > (10 * UNIT) ** 2) {
        target.copy(desiredTarget);
        initialized = true;
      } else {
        target.lerp(desiredTarget, exponentialAlpha(deltaMs, 90));
      }

      const horizontal = Math.cos(state.pitch);
      direction.set(
        Math.sin(state.yaw) * horizontal,
        Math.sin(state.pitch),
        Math.cos(state.yaw) * horizontal
      );
      const collisionDistance = characterControllerLabCameraCollisionDistance(
        raycaster,
        target,
        direction,
        state.distance * UNIT,
        obstacles
      );
      const nextDistance = collisionDistance / UNIT;
      const distanceAlpha = nextDistance < renderedDistance ? 1 : exponentialAlpha(deltaMs, 180);
      renderedDistance = THREE.MathUtils.lerp(renderedDistance, nextDistance, distanceAlpha);
      desiredPosition.copy(target).addScaledVector(direction, renderedDistance * UNIT);
      applyCharacterControllerLabCameraGroundClearance(desiredPosition);
      camera.position.copy(desiredPosition);
      camera.up.set(0, 1, 0);
      camera.lookAt(target);
      updatePerspectiveAspect(native, camera);
      camera.updateMatrixWorld();
    },
    snapshot() {
      return { ...state };
    },
    destroy() {
      camera.removeFromParent();
    }
  };
}

export function applyCharacterControllerLabCameraInput(
  state: Readonly<CharacterControllerLabCameraSnapshot>,
  input: Readonly<CharacterControllerLabCameraInput>
): CharacterControllerLabCameraSnapshot {
  return {
    yaw: wrapRadians(state.yaw - input.lookDeltaX * LOOK_SPEED_X),
    pitch: clamp(state.pitch - input.lookDeltaY * LOOK_SPEED_Y, MIN_PITCH, MAX_PITCH),
    distance: clamp(
      state.distance * Math.exp(input.zoomDelta * ZOOM_SPEED),
      MIN_DISTANCE,
      MAX_DISTANCE
    )
  };
}

export function cameraRelativeCharacterMovement(
  moveX: number,
  moveZ: number,
  cameraYaw: number
): { x: number; z: number } {
  const length = Math.hypot(moveX, moveZ);
  if (length <= Number.EPSILON) return { x: 0, z: 0 };
  const scale = length > 1 ? 1 / length : 1;
  const localX = moveX * scale;
  const localZ = moveZ * scale;
  const sine = Math.sin(cameraYaw);
  const cosine = Math.cos(cameraYaw);
  return {
    x: cosine * localX + sine * localZ,
    z: -sine * localX + cosine * localZ
  };
}

export function characterControllerLabCameraCollisionDistance(
  raycaster: THREE.Raycaster,
  target: THREE.Vector3,
  direction: THREE.Vector3,
  desiredDistance: number,
  obstacles: readonly THREE.Object3D[]
): number {
  if (obstacles.length === 0) return desiredDistance;
  raycaster.set(target, direction);
  raycaster.far = desiredDistance;
  const hit = raycaster.intersectObjects([...obstacles], false)[0];
  return hit === undefined ? desiredDistance : Math.max(1.7 * UNIT, hit.distance - 0.38 * UNIT);
}

export function applyCharacterControllerLabCameraGroundClearance(
  position: THREE.Vector3,
  groundY = 0
): THREE.Vector3 {
  position.y = Math.max(position.y, (groundY + MIN_GROUND_CLEARANCE) * UNIT);
  return position;
}

function updatePerspectiveAspect(
  native: ThreeRendererNative,
  camera: THREE.PerspectiveCamera
): void {
  const canvas = native.renderer?.domElement;
  const width = canvas?.clientWidth || canvas?.width || 1280;
  const height = canvas?.clientHeight || canvas?.height || 720;
  const aspect = width / Math.max(1, height);
  if (Math.abs(camera.aspect - aspect) <= 0.001) return;
  camera.aspect = aspect;
  camera.updateProjectionMatrix();
}

function exponentialAlpha(deltaMs: number, responseMs: number): number {
  return 1 - Math.exp(-Math.max(0, Math.min(80, deltaMs)) / responseMs);
}

function wrapRadians(value: number): number {
  return Math.atan2(Math.sin(value), Math.cos(value));
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
