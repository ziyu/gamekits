import type { InputModifiers, NormalizedInputEvent } from "@gamekits/input-core";

export type DomKeyboardEventLike = {
  code: string;
  key?: string;
  repeat?: boolean;
  shiftKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
  metaKey?: boolean;
};

export type DomPointerEventLike = {
  pointerId?: number;
  pointerType?: string;
  button?: number;
  buttons?: number;
  clientX?: number;
  clientY?: number;
  movementX?: number;
  movementY?: number;
  shiftKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
  metaKey?: boolean;
};

export type DomWheelEventLike = {
  deltaY: number;
  clientX?: number;
  clientY?: number;
  shiftKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
  metaKey?: boolean;
};

export function normalizeDomKeyboardEvent(args: {
  id: string;
  event: DomKeyboardEventLike;
  type: "keydown" | "keyup";
  timestamp: number;
  source?: string;
  scope?: string | undefined;
  originalEvent?: unknown;
}): NormalizedInputEvent {
  const event = withOptionalFields(
    {
      id: args.id,
      device: "keyboard",
      phase: args.type === "keyup" ? "released" : args.event.repeat ? "held" : "pressed",
      modifiers: modifiersFromEvent(args.event),
      timestamp: args.timestamp
    },
    {
      code: args.event.code || args.event.key,
      source: args.source,
      scope: args.scope,
      originalEvent: args.originalEvent
    }
  );

  return event;
}

export function normalizeDomPointerEvent(args: {
  id: string;
  event: DomPointerEventLike;
  type: "pointerdown" | "pointerup" | "pointermove" | "pointercancel";
  timestamp: number;
  source?: string;
  scope?: string | undefined;
  originalEvent?: unknown;
}): NormalizedInputEvent {
  return withOptionalFields(
    {
      id: args.id,
      device: pointerDevice(args.event.pointerType),
      phase: pointerPhase(args.type),
      pointerId: String(args.event.pointerId ?? 0),
      x: args.event.clientX ?? 0,
      y: args.event.clientY ?? 0,
      dx: args.event.movementX ?? 0,
      dy: args.event.movementY ?? 0,
      modifiers: modifiersFromEvent(args.event),
      timestamp: args.timestamp
    },
    {
      button: pointerButton(args.event.button),
      source: args.source,
      scope: args.scope,
      originalEvent: args.originalEvent
    }
  );
}

export function normalizeDomWheelEvent(args: {
  id: string;
  event: DomWheelEventLike;
  timestamp: number;
  source?: string;
  scope?: string | undefined;
  originalEvent?: unknown;
}): NormalizedInputEvent {
  return withOptionalFields(
    {
      id: args.id,
      device: "mouse",
      phase: "scrolled",
      x: args.event.clientX ?? 0,
      y: args.event.clientY ?? 0,
      wheelDelta: args.event.deltaY,
      modifiers: modifiersFromEvent(args.event),
      timestamp: args.timestamp
    },
    {
      source: args.source,
      scope: args.scope,
      originalEvent: args.originalEvent
    }
  );
}

function modifiersFromEvent(event: {
  shiftKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
  metaKey?: boolean;
}): InputModifiers {
  return {
    shift: event.shiftKey === true,
    ctrl: event.ctrlKey === true,
    alt: event.altKey === true,
    meta: event.metaKey === true
  };
}

function pointerDevice(pointerType: string | undefined): "mouse" | "touch" | "pen" {
  if (pointerType === "touch" || pointerType === "pen") {
    return pointerType;
  }
  return "mouse";
}

function pointerPhase(
  type: "pointerdown" | "pointerup" | "pointermove" | "pointercancel"
): NormalizedInputEvent["phase"] {
  if (type === "pointerdown") {
    return "pressed";
  }
  if (type === "pointerup") {
    return "released";
  }
  if (type === "pointercancel") {
    return "cancelled";
  }
  return "moved";
}

function pointerButton(button: number | undefined): string | undefined {
  if (button === undefined || button < 0) {
    return undefined;
  }
  if (button === 0) {
    return "primary";
  }
  if (button === 1) {
    return "middle";
  }
  if (button === 2) {
    return "secondary";
  }
  return `button${button}`;
}

function withOptionalFields(
  event: Omit<NormalizedInputEvent, "originalEvent">,
  fields: Record<string, unknown>
): NormalizedInputEvent {
  const next: NormalizedInputEvent = { ...event };

  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined) {
      (next as Record<string, unknown>)[key] = value;
    }
  }

  return next;
}
