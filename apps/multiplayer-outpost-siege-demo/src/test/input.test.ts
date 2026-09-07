import { createInputRouter, type NormalizedInputEvent } from "@gamekits/input-core";
import { STANDARD_GAMEPAD_CONTROL } from "@gamekits/input-dom";
import { describe, expect, it } from "vitest";

import {
  applyOutpostGamepadAimTarget,
  applyOutpostInputAction,
  configureOutpostInputRouter,
  createOutpostInputState,
  outpostPlayerActionForInputAction,
  setOutpostPointerViewportPosition
} from "../gameplay";

describe("Outpost gamepad input", () => {
  it("keeps pointer viewport position separate from world-space aim", () => {
    const state = createOutpostInputState();
    setOutpostPointerViewportPosition(state, { x: 641, y: 360 });

    expect({ x: state.pointerViewportX, y: state.pointerViewportY }).toEqual({ x: 641, y: 360 });
    expect({ x: state.aimX, y: state.aimY }).toEqual({ x: 0, y: 0 });
  });

  it("combines analog movement across physical input sources without false release", () => {
    const router = createInputRouter();
    const state = createOutpostInputState();
    configureOutpostInputRouter(router);
    router.onAction((event) => applyOutpostInputAction(state, event));

    router.handle(
      gamepadInput({
        id: "stick-right",
        code: STANDARD_GAMEPAD_CONTROL.leftXPositive,
        value: 0.6
      })
    );
    expect(state.moveX).toBe(0.6);

    router.handle({
      id: "keyboard-right",
      device: "keyboard",
      code: "KeyD",
      phase: "pressed",
      scope: "game",
      timestamp: 11
    });
    expect(state.moveX).toBe(1);

    router.handle({
      id: "keyboard-right-up",
      device: "keyboard",
      code: "KeyD",
      phase: "released",
      scope: "game",
      timestamp: 12
    });
    expect(state.moveX).toBe(0.6);

    router.handle(
      gamepadInput({
        id: "stick-right-change",
        code: STANDARD_GAMEPAD_CONTROL.leftXPositive,
        phase: "moved",
        value: 0.8,
        timestamp: 13
      })
    );
    router.tick({ timestamp: 14 });
    expect(state.moveX).toBe(0.8);

    router.handle(
      gamepadInput({
        id: "stick-right-cancel",
        code: STANDARD_GAMEPAD_CONTROL.leftXPositive,
        phase: "cancelled",
        value: 0,
        timestamp: 15
      })
    );
    expect(state.moveX).toBe(0);
  });

  it("converts right-stick actions into a stable world-space aim target", () => {
    const router = createInputRouter();
    const state = createOutpostInputState();
    configureOutpostInputRouter(router);
    router.onAction((event) => applyOutpostInputAction(state, event));

    router.handle(
      gamepadInput({
        id: "aim-right",
        code: STANDARD_GAMEPAD_CONTROL.rightXPositive,
        value: 0.6
      })
    );
    router.handle(
      gamepadInput({
        id: "aim-up",
        code: STANDARD_GAMEPAD_CONTROL.rightYNegative,
        value: 0.8
      })
    );

    expect(applyOutpostGamepadAimTarget(state, { x: 100, y: 200 }, 100)).toBe(true);
    expect(state.aimX).toBeCloseTo(160);
    expect(state.aimY).toBeCloseTo(120);

    router.handle(
      gamepadInput({
        id: "aim-right-release",
        code: STANDARD_GAMEPAD_CONTROL.rightXPositive,
        phase: "released",
        value: 0
      })
    );
    router.handle(
      gamepadInput({
        id: "aim-up-release",
        code: STANDARD_GAMEPAD_CONTROL.rightYNegative,
        phase: "released",
        value: 0
      })
    );
    expect(applyOutpostGamepadAimTarget(state, { x: 200, y: 300 }, 100)).toBe(true);
    expect(state.aimX).toBeCloseTo(260);
    expect(state.aimY).toBeCloseTo(220);

    router.handle({
      id: "mouse-aim",
      device: "mouse",
      phase: "moved",
      x: 420,
      y: 210,
      scope: "game",
      timestamp: 20
    });
    expect(applyOutpostGamepadAimTarget(state, { x: 0, y: 0 })).toBe(false);
    expect({ x: state.aimX, y: state.aimY }).toEqual({ x: 420, y: 210 });
  });

  it("maps gamepad buttons to held fire and reliable player actions", () => {
    const router = createInputRouter();
    const state = createOutpostInputState();
    const actions: string[] = [];
    configureOutpostInputRouter(router);
    router.onAction((event) => {
      applyOutpostInputAction(state, event);
      const action = outpostPlayerActionForInputAction(event);
      if (action) {
        actions.push(action);
      }
    });

    router.handle(
      gamepadInput({ id: "fire", code: STANDARD_GAMEPAD_CONTROL.rightTrigger, value: 0.7 })
    );
    expect(state.fireHeld).toBe(true);
    expect(state.fireSequence).toBe(1);
    router.handle(
      gamepadInput({
        id: "fire-cancel",
        code: STANDARD_GAMEPAD_CONTROL.rightTrigger,
        phase: "cancelled",
        value: 0
      })
    );
    expect(state.fireHeld).toBe(false);

    router.handle(gamepadInput({ id: "reload", code: STANDARD_GAMEPAD_CONTROL.buttonWest }));
    router.handle(gamepadInput({ id: "dash", code: STANDARD_GAMEPAD_CONTROL.buttonSouth }));
    expect(state.dashSequence).toBe(1);
    router.handle(gamepadInput({ id: "shock", code: STANDARD_GAMEPAD_CONTROL.leftBumper }));
    router.handle(gamepadInput({ id: "deploy", code: STANDARD_GAMEPAD_CONTROL.buttonNorth }));
    expect(actions).toEqual(["rifle", "rifle", "reload", "dash", "shock-field", "deploy-turret"]);
  });
});

function gamepadInput(patch: Partial<NormalizedInputEvent>): NormalizedInputEvent {
  return {
    id: "gamepad-input",
    device: "gamepad",
    deviceId: "outpost.test.pad:0:1",
    phase: "pressed",
    scope: "game",
    timestamp: 10,
    ...patch
  };
}
