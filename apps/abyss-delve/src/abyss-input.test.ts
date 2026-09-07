import { createInputRouter, type NormalizedInputEvent } from "@gamekits/input-core";
import { describe, expect, it } from "vitest";
import { applyAbyssInputAction, configureAbyssInputRouter } from "./app-input";
import { createAbyssInputState } from "./game";

describe("Abyss Delve input", () => {
  it("clears held movement when a movement key is released", () => {
    const { router, state } = createInputHarness();

    handle(router, state, key("keydown", "KeyW", 10));
    expect(state.held.up).toBe(true);
    expect(state.moveY).toBe(-1);

    handle(router, state, key("keyup", "KeyW", 30));
    expect(state.held.up).toBe(false);
    expect(state.moveY).toBe(0);

    const heldAfterRelease = router.tick({ timestamp: 46, delta: 16 });
    expect(heldAfterRelease).toHaveLength(0);
  });

  it("allows release events to clear movement while gameplay input is blocked", () => {
    const { router, state } = createInputHarness();

    handle(router, state, key("keydown", "KeyW", 10));
    state.gameplayBlocked = true;
    handle(router, state, key("keyup", "KeyW", 30));

    expect(state.held.up).toBe(false);
    expect(state.moveY).toBe(0);
  });
});

function createInputHarness() {
  const router = createInputRouter();
  configureAbyssInputRouter(router);
  return {
    router,
    state: createAbyssInputState()
  };
}

function handle(
  router: ReturnType<typeof createInputRouter>,
  state: ReturnType<typeof createAbyssInputState>,
  input: NormalizedInputEvent
): void {
  for (const event of router.handle(input)) {
    applyAbyssInputAction(state, event);
  }
}

function key(type: "keydown" | "keyup", code: string, timestamp: number): NormalizedInputEvent {
  return {
    id: `${type}.${code}.${timestamp}`,
    device: "keyboard",
    phase: type === "keyup" ? "released" : "pressed",
    code,
    timestamp,
    scope: "game",
    source: "test"
  };
}
