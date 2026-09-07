import {
  createInputRouter,
  type InputActionEvent,
  type InputActionId,
  type InputRouter
} from "@gamekits/input-core";
import { createDomInputAdapter } from "@gamekits/input-dom";
import type { CharacterControllerLabCameraInput } from "./camera";
import type { CharacterControllerLabAxes } from "./motor";

const scope = "character-controller-lab.game";
const contextId = "character-controller-lab.gameplay";
const actions = {
  forward: "character.move.forward",
  backward: "character.move.backward",
  left: "character.move.left",
  right: "character.move.right",
  jump: "character.jump",
  dive: "character.dive",
  cameraLook: "camera.look",
  cameraOrbitPrimary: "camera.orbit.primary",
  cameraOrbitSecondary: "camera.orbit.secondary",
  cameraZoom: "camera.zoom"
} as const satisfies Record<string, InputActionId>;

export type CharacterControllerLabInputFrame = {
  axes: CharacterControllerLabAxes;
  camera: CharacterControllerLabCameraInput;
};

export type CharacterControllerLabInput = {
  start(): void;
  tick(timestamp: number): void;
  sample(sequence: number): CharacterControllerLabInputFrame;
  destroy(): void;
};

export function createCharacterControllerLabInput(
  viewport: HTMLElement
): CharacterControllerLabInput {
  const router = createInputRouter();
  const held = new Set<InputActionId>();
  let jumpPressed = false;
  let divePressed = false;
  let lookDeltaX = 0;
  let lookDeltaY = 0;
  let zoomDelta = 0;
  const orbitPointers = new Set<string>();
  registerActions(router);
  router.addContext({
    id: contextId,
    priority: 20,
    actionIds: Object.values(actions),
    scopes: [scope]
  });
  const unsubscribe = router.onAction((event) => updateActionState(event));
  const adapter = createDomInputAdapter({
    target: viewport,
    source: "sandbox.character-controller-lab.dom",
    scope,
    eventFilter(event) {
      if (event instanceof KeyboardEvent) {
        if (!isCharacterKey(event.code)) return false;
        event.preventDefault();
        return true;
      }
      if (event instanceof PointerEvent || event instanceof WheelEvent) {
        event.preventDefault();
        return true;
      }
      return false;
    },
    onInput(event) {
      router.handle(event);
    }
  });
  const reset = (): void => {
    held.clear();
    orbitPointers.clear();
    jumpPressed = false;
    divePressed = false;
    lookDeltaX = 0;
    lookDeltaY = 0;
    zoomDelta = 0;
    viewport.dataset.cameraDragging = "false";
  };
  const preventContextMenu = (event: Event): void => event.preventDefault();
  viewport.addEventListener("blur", reset);
  viewport.addEventListener("contextmenu", preventContextMenu);

  return {
    start() {
      adapter.start();
    },
    tick(timestamp) {
      router.tick({ timestamp });
    },
    sample(sequence) {
      const frame: CharacterControllerLabInputFrame = {
        axes: {
          sequence,
          moveX: Number(held.has(actions.right)) - Number(held.has(actions.left)),
          moveZ: Number(held.has(actions.backward)) - Number(held.has(actions.forward)),
          jumpPressed,
          jumpHeld: held.has(actions.jump),
          divePressed
        },
        camera: { lookDeltaX, lookDeltaY, zoomDelta }
      };
      jumpPressed = false;
      divePressed = false;
      lookDeltaX = 0;
      lookDeltaY = 0;
      zoomDelta = 0;
      return frame;
    },
    destroy() {
      viewport.removeEventListener("blur", reset);
      viewport.removeEventListener("contextmenu", preventContextMenu);
      unsubscribe();
      adapter.destroy();
      reset();
    }
  };

  function updateActionState(event: InputActionEvent): void {
    if (event.phase === "pressed" || event.phase === "held") held.add(event.actionId);
    if (event.phase === "released" || event.phase === "cancelled") held.delete(event.actionId);
    if (event.phase === "pressed" && event.actionId === actions.jump) jumpPressed = true;
    if (event.phase === "pressed" && event.actionId === actions.dive) divePressed = true;
    if (
      event.actionId === actions.cameraOrbitPrimary ||
      event.actionId === actions.cameraOrbitSecondary
    ) {
      const pointerId = event.input.pointerId ?? "mouse";
      if (event.phase === "pressed") {
        orbitPointers.add(pointerId);
        viewport.dataset.cameraDragging = "true";
        const original = event.input.originalEvent;
        if (original instanceof PointerEvent) viewport.setPointerCapture(original.pointerId);
      }
      if (event.phase === "released" || event.phase === "cancelled") {
        orbitPointers.delete(pointerId);
        viewport.dataset.cameraDragging = String(orbitPointers.size > 0);
      }
    }
    if (event.actionId === actions.cameraLook && orbitPointers.size > 0) {
      lookDeltaX += event.input.dx ?? 0;
      lookDeltaY += event.input.dy ?? 0;
    }
    if (event.actionId === actions.cameraZoom) zoomDelta += event.input.wheelDelta ?? 0;
  }
}

function registerActions(router: InputRouter): void {
  registerKeyAction(router, actions.forward, "Move Forward", "KeyW");
  registerKeyAction(router, actions.backward, "Move Backward", "KeyS");
  registerKeyAction(router, actions.left, "Move Left", "KeyA");
  registerKeyAction(router, actions.right, "Move Right", "KeyD");
  registerKeyAction(router, actions.jump, "Jump", "Space");
  registerKeyAction(router, actions.dive, "Dive", "ShiftLeft", ["ShiftRight"]);
  router.registerAction({
    id: actions.cameraLook,
    name: "Orbit Camera",
    category: "camera",
    scopes: [scope],
    defaultBindings: [{ device: "mouse", phase: "moved" }]
  });
  registerPointerAction(router, actions.cameraOrbitPrimary, "Primary Camera Orbit", "primary");
  registerPointerAction(
    router,
    actions.cameraOrbitSecondary,
    "Secondary Camera Orbit",
    "secondary"
  );
  router.registerAction({
    id: actions.cameraZoom,
    name: "Camera Zoom",
    category: "camera",
    scopes: [scope],
    defaultBindings: [{ device: "mouse", phase: "scrolled" }]
  });
}

function registerPointerAction(
  router: InputRouter,
  id: string,
  name: string,
  button: string
): void {
  router.registerAction({
    id,
    name,
    category: "camera",
    scopes: [scope],
    defaultBindings: (["pressed", "released", "cancelled"] as const).map((phase) => ({
      device: "mouse" as const,
      button,
      phase
    }))
  });
}

function registerKeyAction(
  router: InputRouter,
  id: string,
  name: string,
  code: string,
  alternateCodes: string[] = []
): void {
  router.registerAction({
    id,
    name,
    category: "character",
    scopes: [scope],
    defaultBindings: [code, ...alternateCodes].flatMap((bindingCode) => [
      { device: "keyboard" as const, code: bindingCode, phase: "pressed" as const },
      { device: "keyboard" as const, code: bindingCode, phase: "held" as const },
      { device: "keyboard" as const, code: bindingCode, phase: "released" as const },
      { device: "keyboard" as const, code: bindingCode, phase: "cancelled" as const }
    ])
  });
}

function isCharacterKey(code: string): boolean {
  return (
    code === "KeyW" ||
    code === "KeyA" ||
    code === "KeyS" ||
    code === "KeyD" ||
    code === "Space" ||
    code === "ShiftLeft" ||
    code === "ShiftRight"
  );
}
