import {
  screenToWorld as fallbackScreenToWorld,
  worldToScreen as fallbackWorldToScreen,
  type CameraState2D
} from "@gamekits/camera-core";
import { GameError } from "@gamekits/core";
import type { ThreeDriverRuntime } from "./runtime";
import type { ThreeCameraSyncTarget } from "./structural-types";
import type { ThreeDriverCameraAdapter } from "./types";

export function createThreeDriverCameraAdapter(options: {
  runtime: () => ThreeDriverRuntime;
}): ThreeDriverCameraAdapter {
  let state: CameraState2D | undefined;

  const requireState = (): CameraState2D => {
    if (!state) {
      throw new GameError("camera.not_applied", "Camera state has not been applied");
    }

    return state;
  };

  return {
    applyCameraState(nextState) {
      state = { ...nextState };
      applyCamera(options.runtime().camera, nextState);
      options.runtime().render();
    },
    getState() {
      return state ? { ...state } : undefined;
    },
    worldToScreen(point) {
      return fallbackWorldToScreen(requireState(), point);
    },
    screenToWorld(point) {
      return fallbackScreenToWorld(requireState(), point);
    }
  };
}

function applyCamera(camera: ThreeDriverRuntime["camera"], state: CameraState2D): void {
  const target = camera as unknown as ThreeCameraSyncTarget;
  const z = target.position?.z ?? 1000;
  if (target.position?.set) {
    target.position.set(state.x, state.y, z);
  } else if (target.position) {
    target.position.x = state.x;
    target.position.y = state.y;
    target.position.z = z;
  }

  if (target.rotation?.set) {
    target.rotation.set(0, 0, state.rotation);
  } else if (target.rotation) {
    target.rotation.x = 0;
    target.rotation.y = 0;
    target.rotation.z = state.rotation;
  }

  target.zoom = state.zoom;
  target.updateProjectionMatrix?.();
}
