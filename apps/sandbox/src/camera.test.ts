import { describe, expect, it } from "vitest";
import { createCameraController } from "@gamekits/camera-core";
import { toRendererLocalInput, type SandboxInputContext } from "./app-input";
import { applySandboxCameraAction, createSandboxCameraController } from "./camera";

describe("applySandboxCameraAction", () => {
  it("pans camera from semantic input actions", () => {
    const camera = createCameraController({
      viewport: { width: 100, height: 100 },
      state: { x: 100, y: 100 }
    });

    applySandboxCameraAction(camera, {
      actionId: "camera.pan_up",
      input: { id: "1", device: "keyboard", phase: "pressed", timestamp: 0 }
    });

    expect(camera.getState().y).toBe(52);
  });

  it("zooms with wheel direction", () => {
    const camera = createCameraController({
      viewport: { width: 100, height: 100 },
      state: { zoom: 1 }
    });

    applySandboxCameraAction(camera, {
      actionId: "camera.zoom_in",
      input: {
        id: "1",
        device: "mouse",
        phase: "scrolled",
        timestamp: 0,
        wheelDelta: -100
      }
    });

    expect(camera.getState().zoom).toBeGreaterThan(1);
  });

  it("converts viewport pointer coordinates to renderer-local input coordinates", () => {
    const input = toRendererLocalInput(
      {
        activeInputScope: "game",
        ui: {
          stage: {
            getBoundingClientRect: () => ({
              left: 100,
              top: 50,
              width: 360,
              height: 262
            })
          }
        }
      } as SandboxInputContext,
      {
        id: "wheel",
        device: "mouse",
        phase: "scrolled",
        timestamp: 0,
        scope: "game",
        x: 280,
        y: 181
      }
    );

    expect(input.x).toBe(360);
    expect(input.y).toBe(262);
  });

  it("keeps Phaser driver pointer coordinates in renderer-local space", () => {
    const input = toRendererLocalInput(
      {
        activeInputScope: "game",
        ui: {
          stage: {
            getBoundingClientRect: () => ({
              left: 100,
              top: 50,
              width: 360,
              height: 262
            })
          }
        }
      } as SandboxInputContext,
      {
        id: "pointer",
        device: "mouse",
        phase: "released",
        timestamp: 0,
        scope: "game",
        source: "sandbox.phaser.input",
        x: 240,
        y: 120
      }
    );

    expect(input.x).toBe(240);
    expect(input.y).toBe(120);
  });

  it("allows initial sandbox camera movement in every pan direction", () => {
    const camera = createSandboxCameraController({ width: 720, height: 524 });
    const initial = camera.getState();

    applySandboxCameraAction(camera, {
      actionId: "camera.pan_left",
      input: { id: "1", device: "keyboard", phase: "pressed", timestamp: 0 }
    });
    expect(camera.getState().x).toBeLessThan(initial.x);

    camera.setState(initial);
    applySandboxCameraAction(camera, {
      actionId: "camera.pan_up",
      input: { id: "2", device: "keyboard", phase: "pressed", timestamp: 0 }
    });
    expect(camera.getState().y).toBeLessThan(initial.y);

    camera.setState(initial);
    applySandboxCameraAction(camera, {
      actionId: "camera.pan_right",
      input: { id: "3", device: "keyboard", phase: "pressed", timestamp: 0 }
    });
    expect(camera.getState().x).toBeGreaterThan(initial.x);

    camera.setState(initial);
    applySandboxCameraAction(camera, {
      actionId: "camera.pan_down",
      input: { id: "4", device: "keyboard", phase: "pressed", timestamp: 0 }
    });
    expect(camera.getState().y).toBeGreaterThan(initial.y);
  });
});
