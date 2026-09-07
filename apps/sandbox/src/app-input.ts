import { clientToViewportPoint } from "@gamekits/camera-core";
import type { InputBinding, InputRouter, NormalizedInputEvent } from "@gamekits/input-core";
import { SANDBOX_RENDER_SIZE, type SandboxRuntime } from "./game";
import type { SandboxUiHandles } from "./ui/render-sandbox";
import { updateInputStatus } from "./ui/render-sandbox";

export const SANDBOX_SCENE_CLICK_ACTION_ID = "scene.click";
const INPUT_ACTION_HELD_EVENT_INTERVAL_MS = 250;

export type SandboxInputContext = {
  ui: SandboxUiHandles;
  activeInputScope: SandboxInputScope;
  sandbox?: SandboxRuntime | undefined;
  inputRouter?: InputRouter | undefined;
};

export function configureSandboxInputRouter(
  context: SandboxInputContext,
  inputRouter: InputRouter
): void {
  const inputTrace = createInputActionTraceGate(INPUT_ACTION_HELD_EVENT_INTERVAL_MS);
  context.ui.rendererRoot.addEventListener("focus", () => {
    focusGameViewport(context, "sandbox.focus");
  });
  context.ui.rendererRoot.addEventListener("blur", () => {
    context.activeInputScope = "ui";
    context.ui.uiRuntime.setFocus({ scope: "ui", reason: "sandbox.blur" });
  });
  context.ui.stage.addEventListener("pointerdown", () => {
    focusGameViewport(context, "sandbox.pointer");
  });
  inputRouter.registerAction({
    id: "camera.pan_up",
    name: "Pan Up",
    category: "camera",
    scopes: ["game"],
    defaultBindings: keyboardPanBindings("KeyW")
  });
  inputRouter.registerAction({
    id: "camera.pan_down",
    name: "Pan Down",
    category: "camera",
    scopes: ["game"],
    defaultBindings: keyboardPanBindings("KeyS")
  });
  inputRouter.registerAction({
    id: "camera.pan_left",
    name: "Pan Left",
    category: "camera",
    scopes: ["game"],
    defaultBindings: keyboardPanBindings("KeyA")
  });
  inputRouter.registerAction({
    id: "camera.pan_right",
    name: "Pan Right",
    category: "camera",
    scopes: ["game"],
    defaultBindings: keyboardPanBindings("KeyD")
  });
  inputRouter.registerAction({
    id: "camera.zoom_in",
    name: "Zoom In",
    category: "camera",
    scopes: ["game"],
    defaultBindings: [
      { device: "mouse", phase: "scrolled" },
      { device: "keyboard", code: "Equal", phase: "pressed" }
    ]
  });
  inputRouter.registerAction({
    id: "camera.zoom_out",
    name: "Zoom Out",
    category: "camera",
    scopes: ["game"],
    defaultBindings: [{ device: "keyboard", code: "Minus", phase: "pressed" }]
  });
  inputRouter.registerAction({
    id: "game.confirm",
    name: "Confirm",
    category: "gameplay",
    scopes: ["game"],
    defaultBindings: [{ device: "keyboard", code: "Enter", phase: "pressed" }]
  });
  inputRouter.registerAction({
    id: SANDBOX_SCENE_CLICK_ACTION_ID,
    name: "Scene Click",
    category: "scene",
    scopes: ["game"],
    defaultBindings: [
      { device: "mouse", button: "primary", phase: "released" },
      { device: "touch", phase: "released" },
      { device: "pen", phase: "released" }
    ]
  });
  inputRouter.addContext({
    id: "camera",
    priority: 10,
    actionIds: [
      "camera.pan_up",
      "camera.pan_down",
      "camera.pan_left",
      "camera.pan_right",
      "camera.zoom_in",
      "camera.zoom_out"
    ],
    scopes: ["game"],
    capture: false
  });
  inputRouter.addContext({
    id: "gameplay",
    priority: 5,
    actionIds: ["game.confirm"],
    scopes: ["game"]
  });
  inputRouter.addContext({
    id: "scene",
    priority: 15,
    actionIds: [SANDBOX_SCENE_CLICK_ACTION_ID],
    scopes: ["game"],
    capture: false
  });
  inputRouter.onAction((event) => {
    const input = toRendererLocalInput(context, event.input);
    if (inputTrace.shouldEmit(event.actionId, event.phase, input.timestamp)) {
      context.sandbox?.runtime.eventBus.emit(
        "input.action",
        {
          actionId: event.actionId,
          contextId: event.contextId,
          phase: event.phase,
          value: event.value,
          input: {
            device: input.device,
            code: input.code,
            button: input.button,
            x: input.x,
            y: input.y,
            dx: input.dx,
            dy: input.dy,
            wheelDelta: input.wheelDelta,
            scope: input.scope
          }
        },
        "sandbox.input"
      );
    }
    updateInputStatus(context.ui, {
      action:
        input.x === undefined || input.y === undefined
          ? event.actionId
          : `${event.actionId} ${Math.round(input.x)},${Math.round(input.y)}`,
      context: event.contextId
    });
  });
}

function createInputActionTraceGate(intervalMs: number) {
  const lastHeldEventAt = new Map<string, number>();

  return {
    shouldEmit(actionId: string, phase: string, timestamp: number): boolean {
      if (phase !== "held") {
        if (phase === "released" || phase === "cancelled") {
          lastHeldEventAt.delete(actionId);
        }
        return true;
      }

      const previous = lastHeldEventAt.get(actionId);
      if (previous !== undefined && timestamp - previous < intervalMs) {
        return false;
      }

      lastHeldEventAt.set(actionId, timestamp);
      return true;
    }
  };
}

export function toRendererLocalInput(
  context: SandboxInputContext,
  input: NormalizedInputEvent
): NormalizedInputEvent {
  if (
    input.x === undefined ||
    input.y === undefined ||
    input.scope !== "game" ||
    isRendererLocalInput(input)
  ) {
    return input;
  }

  const bounds = context.ui.stage.getBoundingClientRect();
  if (bounds.width <= 0 || bounds.height <= 0) {
    return input;
  }

  return {
    ...input,
    ...clientToViewportPoint({ x: input.x, y: input.y }, bounds, SANDBOX_RENDER_SIZE)
  };
}

export function routeSandboxSceneOverlayInput(
  context: SandboxInputContext,
  event: MouseEvent | WheelEvent
): void {
  context.activeInputScope = "game";
  context.ui.uiRuntime.setFocus({
    scope: "game",
    target: "viewport",
    reason: "sandbox.scene_overlay"
  });
  context.ui.rendererRoot.focus({ preventScroll: true });
  const input = {
    id: `scene-overlay-${Math.round(event.timeStamp)}`,
    device: "mouse",
    phase: event instanceof WheelEvent ? "scrolled" : "released",
    scope: "game",
    source: "sandbox.scene-overlay",
    x: event.clientX,
    y: event.clientY,
    timestamp: event.timeStamp
  } as const;
  context.inputRouter?.handle(
    event instanceof WheelEvent
      ? { ...input, wheelDelta: event.deltaY }
      : { ...input, button: "primary" }
  );
}

export function resolveSandboxInputScope(
  context: SandboxInputContext,
  event: Event
): SandboxInputScope {
  if (isPointerLikeInput(event)) {
    context.activeInputScope = isEventInElement(event, context.ui.stage) ? "game" : "ui";
    if (context.activeInputScope === "game" && event.type === "pointerdown") {
      context.ui.uiRuntime.setFocus({
        scope: "game",
        target: "viewport",
        reason: "sandbox.pointer"
      });
      context.ui.rendererRoot.focus({ preventScroll: true });
    } else if (context.activeInputScope === "ui") {
      context.ui.uiRuntime.setFocus({ scope: "ui", reason: "sandbox.pointer" });
    }
  }

  return context.activeInputScope;
}

function focusGameViewport(context: SandboxInputContext, reason: string): void {
  context.activeInputScope = "game";
  context.ui.uiRuntime.setFocus({ scope: "game", target: "viewport", reason });
  context.ui.rendererRoot.focus({ preventScroll: true });
}

function isRendererLocalInput(input: NormalizedInputEvent): boolean {
  return input.source === "sandbox.phaser.input" || input.source === "input.phaser";
}

function keyboardPanBindings(code: string): InputBinding[] {
  return [
    { device: "keyboard", code, phase: "pressed" },
    { device: "keyboard", code, phase: "held" },
    { device: "keyboard", code, phase: "released" },
    { device: "keyboard", code, phase: "cancelled" }
  ];
}

export type SandboxInputScope = "game" | "ui";

function isPointerLikeInput(event: Event): boolean {
  return event.type.startsWith("pointer") || event.type === "wheel";
}

function isEventInElement(event: Event, element: Element): boolean {
  return event.target instanceof Node && element.contains(event.target);
}
