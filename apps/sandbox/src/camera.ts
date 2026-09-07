import {
  createCameraController,
  type CameraController,
  type CameraViewport
} from "@gamekits/camera-core";
import type { InputActionEvent } from "@gamekits/input-core";

export const SANDBOX_CAMERA_PAN_STEP = 48;

export function createSandboxCameraController(viewport: CameraViewport): CameraController {
  return createCameraController({
    viewport,
    state: {
      x: viewport.width / 2,
      y: viewport.height / 2,
      bounds: {
        x: -viewport.width,
        y: -viewport.height,
        width: viewport.width * 3,
        height: viewport.height * 3
      },
      minZoom: 0.5,
      maxZoom: 3
    }
  });
}

export function applySandboxCameraAction(
  camera: CameraController,
  event: Pick<InputActionEvent, "actionId" | "input">
): boolean {
  switch (event.actionId) {
    case "camera.pan_up":
      camera.pan(0, -SANDBOX_CAMERA_PAN_STEP);
      return true;
    case "camera.pan_down":
      camera.pan(0, SANDBOX_CAMERA_PAN_STEP);
      return true;
    case "camera.pan_left":
      camera.pan(-SANDBOX_CAMERA_PAN_STEP, 0);
      return true;
    case "camera.pan_right":
      camera.pan(SANDBOX_CAMERA_PAN_STEP, 0);
      return true;
    case "camera.zoom_in":
      camera.zoom(zoomDirection(event.input.wheelDelta, 1), anchorFromInput(event.input));
      return true;
    case "camera.zoom_out":
      camera.zoom(zoomDirection(event.input.wheelDelta, -1), anchorFromInput(event.input));
      return true;
    default:
      return false;
  }
}

function zoomDirection(wheelDelta: number | undefined, fallback: number): number {
  if (wheelDelta === undefined || wheelDelta === 0) {
    return fallback;
  }

  return wheelDelta < 0 ? 1 : -1;
}

function anchorFromInput(input: InputActionEvent["input"]) {
  if (input.x === undefined || input.y === undefined) {
    return undefined;
  }

  return {
    x: input.x,
    y: input.y
  };
}
