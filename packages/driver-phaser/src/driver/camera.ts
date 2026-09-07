import {
  screenToWorld as fallbackScreenToWorld,
  worldToScreen as fallbackWorldToScreen,
  type CameraState2D,
  type PointLike
} from "@gamekits/camera-core";
import { GameError } from "@gamekits/core";

export type PhaserDriverCameraRuntime = {
  setScroll(x: number, y: number): void;
  centerOn?(x: number, y: number): void;
  setZoom(zoom: number): void;
  setRotation(rotation: number): void;
};

export type PhaserDriverCameraAdapter = {
  applyCameraState(state: CameraState2D): void;
  getState(): CameraState2D | undefined;
  worldToScreen(point: PointLike): PointLike;
  screenToWorld(point: PointLike): PointLike;
};

export function createPhaserDriverCameraAdapter(options: {
  runtime: PhaserDriverCameraRuntime;
}): PhaserDriverCameraAdapter {
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
      const scrollX = nextState.x - nextState.viewport.width / (2 * nextState.zoom);
      const scrollY = nextState.y - nextState.viewport.height / (2 * nextState.zoom);

      options.runtime.setZoom(nextState.zoom);
      if (options.runtime.centerOn) {
        options.runtime.centerOn(nextState.x, nextState.y);
      } else {
        options.runtime.setScroll(scrollX, scrollY);
      }
      options.runtime.setRotation(nextState.rotation);
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
