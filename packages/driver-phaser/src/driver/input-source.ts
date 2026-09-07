import type { InputSourceAdapter, NormalizedInputEvent } from "@gamekits/input-core";
import {
  normalizePhaserKeyboardEvent,
  normalizePhaserPointerEvent,
  normalizePhaserWheelEvent
} from "./input-normalizers";

export type PhaserDriverInputRuntime = {
  coordinateScale?: number;
  on(eventName: string, listener: (...args: unknown[]) => void): void;
  off(eventName: string, listener: (...args: unknown[]) => void): void;
};

export type PhaserDriverInputSourceOptions = {
  runtime: () => PhaserDriverInputRuntime;
  onInput: (event: NormalizedInputEvent) => void;
  source?: string;
  clock?: () => number;
};

export function createPhaserDriverInputSource(
  options: PhaserDriverInputSourceOptions
): InputSourceAdapter {
  let started = false;
  let sequence = 0;

  const clock = options.clock ?? (() => performance.now());
  const source = options.source ?? "input.phaser";

  const keydown = (event: unknown) => {
    options.onInput(
      normalizePhaserKeyboardEvent({
        id: nextId(source, ++sequence),
        event: event as never,
        type: "keydown",
        timestamp: clock(),
        source,
        originalEvent: event
      })
    );
  };
  const keyup = (event: unknown) => {
    options.onInput(
      normalizePhaserKeyboardEvent({
        id: nextId(source, ++sequence),
        event: event as never,
        type: "keyup",
        timestamp: clock(),
        source,
        originalEvent: event
      })
    );
  };
  const pointer = (type: "pointerdown" | "pointerup" | "pointermove") => {
    return (event: unknown) => {
      options.onInput(
        normalizePhaserPointerEvent({
          id: nextId(source, ++sequence),
          event: event as never,
          type,
          timestamp: clock(),
          source,
          ...(runtime?.coordinateScale === undefined
            ? {}
            : { coordinateScale: runtime.coordinateScale }),
          originalEvent: event
        })
      );
    };
  };
  const wheel = (...args: unknown[]) => {
    options.onInput(
      normalizePhaserWheelEvent({
        id: nextId(source, ++sequence),
        event: normalizeWheelArgs(args) as never,
        timestamp: clock(),
        source,
        ...(runtime?.coordinateScale === undefined
          ? {}
          : { coordinateScale: runtime.coordinateScale }),
        originalEvent: args[args.length - 1] ?? args[0]
      })
    );
  };
  const pointerdown = pointer("pointerdown");
  const pointerup = pointer("pointerup");
  const pointermove = pointer("pointermove");
  let runtime: PhaserDriverInputRuntime | undefined;

  return {
    start() {
      if (started) {
        return;
      }

      started = true;
      runtime = options.runtime();
      runtime.on("keydown", keydown);
      runtime.on("keyup", keyup);
      runtime.on("pointerdown", pointerdown);
      runtime.on("pointerup", pointerup);
      runtime.on("pointermove", pointermove);
      runtime.on("wheel", wheel);
    },
    stop() {
      if (!started) {
        return;
      }

      started = false;
      runtime?.off("keydown", keydown);
      runtime?.off("keyup", keyup);
      runtime?.off("pointerdown", pointerdown);
      runtime?.off("pointerup", pointerup);
      runtime?.off("pointermove", pointermove);
      runtime?.off("wheel", wheel);
      runtime = undefined;
    },
    destroy() {
      this.stop();
    }
  };
}

function nextId(source: string, sequence: number): string {
  return `${source}:${sequence}`;
}

function normalizeWheelArgs(args: unknown[]): unknown {
  const pointer = isRecord(args[0]) ? args[0] : {};
  const deltaY = typeof args[3] === "number" ? args[3] : pointer.deltaY;
  return {
    ...pointer,
    deltaY
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
