import { describe, expect, it } from "vitest";
import {
  createCharacterControlIntentBuffer,
  type CharacterControlIntent
} from "@gamekits/character-controller";

describe("character control intent buffer", () => {
  it("latches discrete edges until a fixed tick consumes the latest continuous sample", () => {
    const buffer = createCharacterControlIntentBuffer(intent(0));
    buffer.update(
      intent(1, {
        move: { x: 1, y: 0, z: 0 },
        jumpPressed: true,
        jumpHeld: true
      })
    );
    buffer.update(
      intent(2, {
        move: { x: 0, y: 0, z: -1 },
        jumpHeld: false,
        divePressed: true
      })
    );

    expect(buffer.consume(20)).toMatchObject({
      sequence: 20,
      move: { x: 0, y: 0, z: -1 },
      jumpPressed: true,
      jumpHeld: false,
      divePressed: true
    });
    expect(buffer.consume(21)).toMatchObject({
      sequence: 21,
      jumpPressed: false,
      divePressed: false
    });
  });

  it("clears pending edges when the owning runtime resets", () => {
    const buffer = createCharacterControlIntentBuffer(intent(0));
    buffer.update(intent(1, { jumpPressed: true }));
    buffer.reset(intent(2));

    expect(buffer.snapshot()).toEqual(intent(2));
  });
});

function intent(
  sequence: number,
  overrides: Partial<CharacterControlIntent> = {}
): CharacterControlIntent {
  return {
    sequence,
    move: { x: 0, y: 0, z: 0 },
    jumpPressed: false,
    jumpHeld: false,
    divePressed: false,
    ...overrides
  };
}
