import type { NormalizedInputEvent } from "@gamekits/input-core";
import { describe, expect, it } from "vitest";
import {
  createWebGamepadInputAdapter,
  STANDARD_GAMEPAD_CONTROL,
  type WebGamepadButtonSnapshot,
  type WebGamepadInputDiagnostic,
  type WebGamepadSnapshot,
  type WebGamepadSnapshotProvider
} from "../src";

describe("createWebGamepadInputAdapter", () => {
  it("emits standard controls only for edges and meaningful analog changes", () => {
    const gamepad = mutableGamepad();
    const provider = mutableProvider(gamepad);
    const events: NormalizedInputEvent[] = [];
    const diagnostics: WebGamepadInputDiagnostic[] = [];
    const adapter = createWebGamepadInputAdapter({
      provider,
      changeEpsilon: 0.01,
      onInput: (event) => events.push(event),
      onDiagnostic: (event) => diagnostics.push(event)
    });

    adapter.poll?.({ timestamp: 0 });
    adapter.start();
    adapter.poll?.({ timestamp: 10 });
    expect(events).toEqual([]);
    expect(diagnostics).toEqual([
      expect.objectContaining({ kind: "connected", gamepadIndex: 0, gamepadId: "Test Pad" })
    ]);

    gamepad.buttons[7] = button(0.75, true);
    gamepad.axes[0] = 0.59;
    adapter.poll?.({ timestamp: 20 });

    expect(events).toHaveLength(2);
    expect(events[0]).toEqual(
      expect.objectContaining({
        code: STANDARD_GAMEPAD_CONTROL.rightTrigger,
        phase: "pressed",
        value: 0.75,
        timestamp: 20
      })
    );
    expect(events[1]).toEqual(
      expect.objectContaining({
        code: STANDARD_GAMEPAD_CONTROL.leftXPositive,
        phase: "pressed",
        timestamp: 20
      })
    );
    expect(events[1]!.value).toBeCloseTo(0.5, 8);
    const deviceId = events[0]!.deviceId;
    expect(deviceId).toBe(events[1]!.deviceId);

    events.length = 0;
    adapter.poll?.({ timestamp: 30 });
    expect(events).toEqual([]);

    gamepad.axes[0] = 0.8;
    adapter.poll?.({ timestamp: 40 });
    expect(events).toEqual([
      expect.objectContaining({
        code: STANDARD_GAMEPAD_CONTROL.leftXPositive,
        phase: "moved",
        value: expect.closeTo((0.8 - 0.18) / 0.82, 8)
      })
    ]);

    events.length = 0;
    gamepad.buttons[7] = button(0, false);
    gamepad.axes[0] = 0;
    adapter.poll?.({ timestamp: 50 });
    expect(events.map(({ code, phase, value }) => ({ code, phase, value }))).toEqual([
      { code: STANDARD_GAMEPAD_CONTROL.rightTrigger, phase: "released", value: 0 },
      { code: STANDARD_GAMEPAD_CONTROL.leftXPositive, phase: "released", value: 0 }
    ]);
  });

  it("applies a radial dead zone to stick axes", () => {
    const gamepad = mutableGamepad();
    const events: NormalizedInputEvent[] = [];
    const adapter = createWebGamepadInputAdapter({
      provider: mutableProvider(gamepad),
      deadZone: 0.2,
      onInput: (event) => events.push(event)
    });
    adapter.start();

    gamepad.axes[0] = 0.1;
    gamepad.axes[1] = 0.1;
    adapter.poll?.({ timestamp: 10 });
    expect(events).toEqual([]);

    gamepad.axes[0] = 0.6;
    gamepad.axes[1] = 0.8;
    adapter.poll?.({ timestamp: 20 });
    expect(events).toEqual([
      expect.objectContaining({ code: STANDARD_GAMEPAD_CONTROL.leftXPositive, value: 0.6 }),
      expect.objectContaining({ code: STANDARD_GAMEPAD_CONTROL.leftYPositive, value: 0.8 })
    ]);
  });

  it("isolates connection generations when a browser index is reused", () => {
    const first = mutableGamepad({ id: "Pad A" });
    first.buttons[0] = button(1, true);
    const provider = mutableProvider(first);
    const events: NormalizedInputEvent[] = [];
    const adapter = createWebGamepadInputAdapter({
      provider,
      onInput: (event) => events.push(event)
    });
    adapter.start();
    adapter.poll?.({ timestamp: 10 });
    const firstDeviceId = events[0]!.deviceId;

    const second = mutableGamepad({ id: "Pad B" });
    second.buttons[0] = button(1, true);
    provider.slots[0] = second;
    adapter.poll?.({ timestamp: 20 });

    expect(events.slice(1)).toEqual([
      expect.objectContaining({ deviceId: firstDeviceId, phase: "cancelled" }),
      expect.objectContaining({ phase: "pressed", code: STANDARD_GAMEPAD_CONTROL.buttonSouth })
    ]);
    expect(events.at(-1)!.deviceId).not.toBe(firstDeviceId);
  });

  it("cancels active controls on disconnect", () => {
    const gamepad = mutableGamepad();
    gamepad.buttons[0] = button(1, true);
    const provider = mutableProvider(gamepad);
    const events: NormalizedInputEvent[] = [];
    const adapter = createWebGamepadInputAdapter({
      provider,
      onInput: (event) => events.push(event)
    });
    adapter.start();
    adapter.poll?.({ timestamp: 10 });
    provider.slots[0] = null;
    adapter.poll?.({ timestamp: 20 });

    expect(events.map((event) => event.phase)).toEqual(["pressed", "cancelled"]);
  });

  it("requires neutral re-arm after the input scope changes", () => {
    const gamepad = mutableGamepad();
    gamepad.buttons[7] = button(1, true);
    let scope = "game";
    const events: NormalizedInputEvent[] = [];
    const adapter = createWebGamepadInputAdapter({
      provider: mutableProvider(gamepad),
      scope: () => scope,
      onInput: (event) => events.push(event)
    });
    adapter.start();
    adapter.poll?.({ timestamp: 10 });

    scope = "ui";
    adapter.poll?.({ timestamp: 20 });
    adapter.poll?.({ timestamp: 30 });
    expect(events).toEqual([
      expect.objectContaining({ phase: "pressed", scope: "game" }),
      expect.objectContaining({ phase: "cancelled", scope: "game" })
    ]);

    gamepad.buttons[7] = button(0, false);
    adapter.poll?.({ timestamp: 40 });
    gamepad.buttons[7] = button(1, true);
    adapter.poll?.({ timestamp: 50 });
    expect(events.at(-1)).toEqual(expect.objectContaining({ phase: "pressed", scope: "ui" }));
  });

  it("stops polling and cancels active controls with an injected clock", () => {
    const gamepad = mutableGamepad();
    gamepad.buttons[0] = button(1, true);
    const provider = mutableProvider(gamepad);
    const events: NormalizedInputEvent[] = [];
    const adapter = createWebGamepadInputAdapter({
      provider,
      clock: () => 99,
      onInput: (event) => events.push(event)
    });
    adapter.start();
    adapter.poll?.({ timestamp: 10 });
    adapter.stop();
    adapter.poll?.({ timestamp: 20 });

    expect(provider.polls).toBe(1);
    expect(events.at(-1)).toEqual(expect.objectContaining({ phase: "cancelled", timestamp: 99 }));
  });

  it("deduplicates unsupported mapping and provider failure diagnostics", () => {
    const gamepad = mutableGamepad({ mapping: "" });
    let fail = false;
    const provider: WebGamepadSnapshotProvider = {
      getGamepads() {
        if (fail) {
          throw new Error("device access failed");
        }
        return [gamepad];
      }
    };
    const diagnostics: WebGamepadInputDiagnostic[] = [];
    const adapter = createWebGamepadInputAdapter({
      provider,
      onInput: () => undefined,
      onDiagnostic: (event) => diagnostics.push(event)
    });
    adapter.start();
    adapter.poll?.({ timestamp: 10 });
    adapter.poll?.({ timestamp: 20 });
    fail = true;
    adapter.poll?.({ timestamp: 30 });
    adapter.poll?.({ timestamp: 40 });

    expect(diagnostics.map((diagnostic) => diagnostic.kind)).toEqual([
      "unsupported-mapping",
      "poll-failed"
    ]);
  });

  it("cancels and neutral-gates active controls across provider failures", () => {
    const gamepad = mutableGamepad();
    gamepad.buttons[0] = button(1, true);
    let fail = false;
    const events: NormalizedInputEvent[] = [];
    const adapter = createWebGamepadInputAdapter({
      provider: {
        getGamepads() {
          if (fail) {
            throw new Error("temporarily unavailable");
          }
          return [gamepad];
        }
      },
      onInput: (event) => events.push(event)
    });
    adapter.start();
    adapter.poll?.({ timestamp: 10 });
    fail = true;
    adapter.poll?.({ timestamp: 20 });
    fail = false;
    adapter.poll?.({ timestamp: 30 });

    expect(events.map((event) => event.phase)).toEqual(["pressed", "cancelled"]);
    gamepad.buttons[0] = button(0, false);
    adapter.poll?.({ timestamp: 40 });
    gamepad.buttons[0] = button(1, true);
    adapter.poll?.({ timestamp: 50 });
    expect(events.map((event) => event.phase)).toEqual(["pressed", "cancelled", "pressed"]);
  });

  it("validates bounded adapter configuration", () => {
    expect(() =>
      createWebGamepadInputAdapter({ maxGamepads: 5, onInput: () => undefined })
    ).toThrowError(/maxGamepads/);
    expect(() =>
      createWebGamepadInputAdapter({ deadZone: 1, onInput: () => undefined })
    ).toThrowError(/deadZone/);
  });

  it("keeps four neutral controllers silent across sixty seconds of polling", () => {
    const provider = mutableProvider(
      mutableGamepad({ id: "Pad 0", index: 0 }),
      mutableGamepad({ id: "Pad 1", index: 1 }),
      mutableGamepad({ id: "Pad 2", index: 2 }),
      mutableGamepad({ id: "Pad 3", index: 3 })
    );
    const events: NormalizedInputEvent[] = [];
    const adapter = createWebGamepadInputAdapter({
      provider,
      onInput: (event) => events.push(event)
    });
    adapter.start();
    for (let frame = 0; frame < 3_600; frame += 1) {
      adapter.poll?.({ timestamp: frame * (1000 / 60) });
    }

    expect(provider.polls).toBe(3_600);
    expect(events).toEqual([]);
  });
});

type MutableWebGamepad = Omit<WebGamepadSnapshot, "axes" | "buttons"> & {
  axes: number[];
  buttons: WebGamepadButtonSnapshot[];
};

function mutableGamepad(
  patch: Partial<Pick<WebGamepadSnapshot, "id" | "index" | "mapping">> = {}
): MutableWebGamepad {
  return {
    id: patch.id ?? "Test Pad",
    index: patch.index ?? 0,
    mapping: patch.mapping ?? "standard",
    connected: true,
    axes: [0, 0, 0, 0],
    buttons: Array.from({ length: 17 }, () => button(0, false))
  };
}

function mutableProvider(...gamepads: Array<MutableWebGamepad | null>) {
  return {
    slots: [...gamepads] as Array<MutableWebGamepad | null>,
    polls: 0,
    getGamepads() {
      this.polls += 1;
      return this.slots;
    }
  } satisfies WebGamepadSnapshotProvider & {
    slots: Array<MutableWebGamepad | null>;
    polls: number;
  };
}

function button(value: number, pressed: boolean): WebGamepadButtonSnapshot {
  return { value, pressed };
}
