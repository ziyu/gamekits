import { describe, expect, it } from "vitest";
import type { NormalizedInputEvent } from "@gamekits/input-core";
import {
  createPhaserDriverInputSource,
  type PhaserDriverInputRuntime
} from "../src/driver/input-source";

describe("createPhaserDriverInputSource", () => {
  it("normalizes Phaser wheel callback arguments", () => {
    const events: NormalizedInputEvent[] = [];
    const runtime = createFakeRuntime();
    const source = createPhaserDriverInputSource({
      runtime: () => runtime,
      onInput(event) {
        events.push(event);
      },
      source: "test.phaser.input",
      clock: () => 10
    });

    source.start();
    runtime.emit("wheel", { x: 20, y: 30, pointerId: 7 }, [], 0, -120, 0, {
      type: "wheel"
    });

    expect(events).toMatchObject([
      {
        device: "mouse",
        phase: "scrolled",
        pointerId: "7",
        x: 20,
        y: 30,
        wheelDelta: -120,
        source: "test.phaser.input",
        timestamp: 10
      }
    ]);
  });

  it("normalizes high-density pointer coordinates back to the logical viewport", () => {
    const events: NormalizedInputEvent[] = [];
    const runtime = createFakeRuntime(2);
    const source = createPhaserDriverInputSource({
      runtime: () => runtime,
      onInput(event) {
        events.push(event);
      },
      clock: () => 10
    });

    source.start();
    runtime.emit("pointermove", {
      x: 400,
      y: 240,
      prevPosition: { x: 380, y: 220 },
      pointerId: 3
    });

    expect(events).toMatchObject([
      {
        phase: "moved",
        x: 200,
        y: 120,
        dx: 10,
        dy: 10
      }
    ]);
  });
});

type Listener = (...args: unknown[]) => void;

function createFakeRuntime(coordinateScale?: number): PhaserDriverInputRuntime & {
  emit(eventName: string, ...args: unknown[]): void;
} {
  const listeners = new Map<string, Set<Listener>>();

  return {
    ...(coordinateScale === undefined ? {} : { coordinateScale }),
    on(eventName, listener) {
      const eventListeners = listeners.get(eventName) ?? new Set<Listener>();
      eventListeners.add(listener);
      listeners.set(eventName, eventListeners);
    },
    off(eventName, listener) {
      listeners.get(eventName)?.delete(listener);
    },
    emit(eventName, ...args) {
      for (const listener of listeners.get(eventName) ?? []) {
        listener(...args);
      }
    }
  };
}
