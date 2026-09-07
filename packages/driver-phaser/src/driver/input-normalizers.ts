import type { InputModifiers, NormalizedInputEvent } from "@gamekits/input-core";

export type PhaserKeyboardEventLike = {
  code?: string;
  key?: string;
  repeat?: boolean;
  shiftKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
  metaKey?: boolean;
  event?: {
    shiftKey?: boolean;
    ctrlKey?: boolean;
    altKey?: boolean;
    metaKey?: boolean;
  };
};

export type PhaserPointerEventLike = {
  id?: number;
  pointerId?: number;
  pointerType?: string;
  button?: number;
  x?: number;
  y?: number;
  position?: { x?: number; y?: number };
  prevPosition?: { x?: number; y?: number };
  movementX?: number;
  movementY?: number;
  shiftKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
  metaKey?: boolean;
  event?: {
    shiftKey?: boolean;
    ctrlKey?: boolean;
    altKey?: boolean;
    metaKey?: boolean;
  };
};

export type PhaserWheelEventLike = PhaserPointerEventLike & {
  deltaY?: number;
};

export function normalizePhaserKeyboardEvent(args: {
  id: string;
  event: PhaserKeyboardEventLike;
  type: "keydown" | "keyup";
  timestamp: number;
  source?: string;
  originalEvent?: unknown;
}): NormalizedInputEvent {
  return withOptionalFields(
    {
      id: args.id,
      device: "keyboard",
      phase: args.type === "keyup" ? "released" : args.event.repeat ? "held" : "pressed",
      modifiers: modifiersFromEvent(args.event),
      timestamp: args.timestamp
    },
    {
      code: args.event.code ?? args.event.key,
      source: args.source,
      originalEvent: args.originalEvent
    }
  );
}

export function normalizePhaserPointerEvent(args: {
  id: string;
  event: PhaserPointerEventLike;
  type: "pointerdown" | "pointerup" | "pointermove";
  timestamp: number;
  source?: string;
  coordinateScale?: number;
  originalEvent?: unknown;
}): NormalizedInputEvent {
  const coordinateScale = normalizeCoordinateScale(args.coordinateScale);
  const x = (args.event.x ?? args.event.position?.x ?? 0) / coordinateScale;
  const y = (args.event.y ?? args.event.position?.y ?? 0) / coordinateScale;
  const previousX = (args.event.prevPosition?.x ?? x * coordinateScale) / coordinateScale;
  const previousY = (args.event.prevPosition?.y ?? y * coordinateScale) / coordinateScale;

  return withOptionalFields(
    {
      id: args.id,
      device: pointerDevice(args.event.pointerType),
      phase: pointerPhase(args.type),
      pointerId: String(args.event.pointerId ?? args.event.id ?? 0),
      x,
      y,
      dx: args.event.movementX || x - previousX,
      dy: args.event.movementY || y - previousY,
      modifiers: modifiersFromEvent(args.event),
      timestamp: args.timestamp
    },
    {
      button: pointerButton(args.event.button),
      source: args.source,
      originalEvent: args.originalEvent
    }
  );
}

export function normalizePhaserWheelEvent(args: {
  id: string;
  event: PhaserWheelEventLike;
  timestamp: number;
  source?: string;
  coordinateScale?: number;
  originalEvent?: unknown;
}): NormalizedInputEvent {
  const coordinateScale = normalizeCoordinateScale(args.coordinateScale);
  return withOptionalFields(
    {
      id: args.id,
      device: "mouse",
      phase: "scrolled",
      pointerId: String(args.event.pointerId ?? args.event.id ?? 0),
      x: (args.event.x ?? args.event.position?.x ?? 0) / coordinateScale,
      y: (args.event.y ?? args.event.position?.y ?? 0) / coordinateScale,
      wheelDelta: args.event.deltaY ?? 0,
      modifiers: modifiersFromEvent(args.event),
      timestamp: args.timestamp
    },
    {
      source: args.source,
      originalEvent: args.originalEvent
    }
  );
}

function normalizeCoordinateScale(value: number | undefined): number {
  return value !== undefined && Number.isFinite(value) && value > 0 ? value : 1;
}

function modifiersFromEvent(
  event: PhaserKeyboardEventLike | PhaserPointerEventLike
): InputModifiers {
  return {
    shift: event.shiftKey === true || event.event?.shiftKey === true,
    ctrl: event.ctrlKey === true || event.event?.ctrlKey === true,
    alt: event.altKey === true || event.event?.altKey === true,
    meta: event.metaKey === true || event.event?.metaKey === true
  };
}

function pointerDevice(pointerType: string | undefined): "mouse" | "touch" | "pen" {
  if (pointerType === "touch" || pointerType === "pen") {
    return pointerType;
  }
  return "mouse";
}

function pointerPhase(
  type: "pointerdown" | "pointerup" | "pointermove"
): NormalizedInputEvent["phase"] {
  if (type === "pointerdown") {
    return "pressed";
  }
  if (type === "pointerup") {
    return "released";
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
