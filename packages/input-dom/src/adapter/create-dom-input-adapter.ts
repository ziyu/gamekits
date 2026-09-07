import type { InputScopeId, InputSourceAdapter, NormalizedInputEvent } from "@gamekits/input-core";
import {
  normalizeDomKeyboardEvent,
  normalizeDomPointerEvent,
  normalizeDomWheelEvent
} from "./normalizers";
import type { DomInputAdapterOptions } from "./types";

export function createDomInputAdapter(options: DomInputAdapterOptions): InputSourceAdapter {
  let started = false;
  let sequence = 0;

  const clock = options.clock ?? (() => performance.now());
  const source = options.source ?? "input.dom";
  const listenerOptions = options.capture ? { capture: true } : undefined;

  const pressed = new Map<string, NormalizedInputEvent>();
  const blurTarget = typeof window === "undefined" ? options.target : window;
  const visibilityTarget = typeof document === "undefined" ? undefined : document;
  const identity = (input: NormalizedInputEvent) =>
    `${input.device}:${input.code ?? ""}:${input.button ?? ""}:${input.pointerId ?? ""}`;
  const publish = (input: NormalizedInputEvent, accepted = true): void => {
    const key = identity(input);
    const ending = input.phase === "released" || input.phase === "cancelled";
    if (!accepted && !(ending && pressed.has(key))) return;
    if (input.phase === "pressed") pressed.set(key, input);
    if (ending) pressed.delete(key);
    options.onInput(accepted ? input : { ...input, phase: "cancelled" });
  };
  const cancelPressed = () => {
    const inputs = [...pressed.values()];
    pressed.clear();
    for (const input of inputs)
      options.onInput({
        ...input,
        id: nextId(source, ++sequence),
        phase: "cancelled",
        timestamp: clock()
      });
  };
  const visibilityChange = () => {
    if (visibilityTarget?.hidden) cancelPressed();
  };

  const keydown = (event: Event) => {
    if (!shouldHandleEvent(options, event)) {
      return;
    }
    if ((event as KeyboardEvent).repeat) {
      return;
    }

    const scope = resolveScope(options.scope, event);
    publish(
      normalizeDomKeyboardEvent({
        id: nextId(source, ++sequence),
        event: event as KeyboardEvent,
        type: "keydown",
        timestamp: clock(),
        source,
        scope,
        originalEvent: event
      })
    );
  };
  const keyup = (event: Event) => {
    const scope = resolveScope(options.scope, event);
    publish(
      normalizeDomKeyboardEvent({
        id: nextId(source, ++sequence),
        event: event as KeyboardEvent,
        type: "keyup",
        timestamp: clock(),
        source,
        scope,
        originalEvent: event
      }),
      shouldHandleEvent(options, event)
    );
  };
  const pointer = (type: "pointerdown" | "pointerup" | "pointermove" | "pointercancel") => {
    return (event: Event) => {
      const scope = resolveScope(options.scope, event);
      publish(
        normalizeDomPointerEvent({
          id: nextId(source, ++sequence),
          event: event as PointerEvent,
          type,
          timestamp: clock(),
          source,
          scope,
          originalEvent: event
        }),
        shouldHandleEvent(options, event)
      );
    };
  };
  const wheel = (event: Event) => {
    if (!shouldHandleEvent(options, event)) {
      return;
    }
    const scope = resolveScope(options.scope, event);
    publish(
      normalizeDomWheelEvent({
        id: nextId(source, ++sequence),
        event: event as WheelEvent,
        timestamp: clock(),
        source,
        scope,
        originalEvent: event
      })
    );
  };
  const pointerdown = pointer("pointerdown");
  const pointerup = pointer("pointerup");
  const pointermove = pointer("pointermove");
  const pointercancel = pointer("pointercancel");

  return {
    start() {
      if (started) {
        return;
      }

      started = true;
      options.target.addEventListener("keydown", keydown, listenerOptions);
      options.target.addEventListener("keyup", keyup, listenerOptions);
      options.target.addEventListener("pointerdown", pointerdown, listenerOptions);
      options.target.addEventListener("pointerup", pointerup, listenerOptions);
      options.target.addEventListener("pointermove", pointermove, listenerOptions);
      options.target.addEventListener("pointercancel", pointercancel, listenerOptions);
      options.target.addEventListener("wheel", wheel, listenerOptions);
      options.target.addEventListener("focusin", cancelPressed, listenerOptions);
      blurTarget.addEventListener("blur", cancelPressed);
      visibilityTarget?.addEventListener("visibilitychange", visibilityChange);
    },
    stop() {
      if (!started) {
        return;
      }

      started = false;
      options.target.removeEventListener("keydown", keydown, listenerOptions);
      options.target.removeEventListener("keyup", keyup, listenerOptions);
      options.target.removeEventListener("pointerdown", pointerdown, listenerOptions);
      options.target.removeEventListener("pointerup", pointerup, listenerOptions);
      options.target.removeEventListener("pointermove", pointermove, listenerOptions);
      options.target.removeEventListener("pointercancel", pointercancel, listenerOptions);
      options.target.removeEventListener("wheel", wheel, listenerOptions);
      options.target.removeEventListener("focusin", cancelPressed, listenerOptions);
      blurTarget.removeEventListener("blur", cancelPressed);
      visibilityTarget?.removeEventListener("visibilitychange", visibilityChange);
      cancelPressed();
    },
    destroy() {
      this.stop();
    }
  };
}

function shouldHandleEvent(options: DomInputAdapterOptions, event: Event): boolean {
  return options.eventFilter?.(event) ?? true;
}

function nextId(source: string, sequence: number): string {
  return `${source}:${sequence}`;
}

function resolveScope(
  scope: DomInputAdapterOptions["scope"],
  event: Event
): InputScopeId | undefined {
  if (typeof scope === "function") {
    return scope(event);
  }

  return scope;
}
