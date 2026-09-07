import { GameError } from "@gamekits/core";
import type { CharacterControlIntent } from "../contracts";

export type CharacterControlIntentBuffer = {
  update(intent: Readonly<CharacterControlIntent>): void;
  consume(sequence?: number): CharacterControlIntent;
  snapshot(sequence?: number): CharacterControlIntent;
  reset(intent?: Readonly<CharacterControlIntent>): void;
};

/**
 * Bridges presentation-rate control samples into a fixed-step character motor.
 * Continuous values use the latest sample while discrete edges remain latched
 * until one fixed tick consumes them.
 */
export function createCharacterControlIntentBuffer(
  initialIntent: Readonly<CharacterControlIntent>
): CharacterControlIntentBuffer {
  let latest = cloneIntent(initialIntent);
  let jumpPressed = initialIntent.jumpPressed;
  let divePressed = initialIntent.divePressed;

  return {
    update(intent) {
      assertSequence(intent.sequence);
      latest = cloneIntent(intent);
      jumpPressed ||= intent.jumpPressed;
      divePressed ||= intent.divePressed;
    },
    consume(sequence = latest.sequence) {
      const consumed = read(sequence);
      jumpPressed = false;
      divePressed = false;
      latest = {
        ...latest,
        sequence,
        jumpPressed: false,
        divePressed: false
      };
      return consumed;
    },
    snapshot(sequence = latest.sequence) {
      return read(sequence);
    },
    reset(intent = initialIntent) {
      assertSequence(intent.sequence);
      latest = cloneIntent(intent);
      jumpPressed = intent.jumpPressed;
      divePressed = intent.divePressed;
    }
  };

  function read(sequence: number): CharacterControlIntent {
    assertSequence(sequence);
    return {
      ...cloneIntent(latest),
      sequence,
      jumpPressed,
      divePressed
    };
  }
}

function cloneIntent(intent: Readonly<CharacterControlIntent>): CharacterControlIntent {
  assertSequence(intent.sequence);
  return {
    sequence: intent.sequence,
    move: { x: intent.move.x, y: intent.move.y, z: intent.move.z ?? 0 },
    ...(intent.facing === undefined
      ? {}
      : {
          facing: {
            x: intent.facing.x,
            y: intent.facing.y,
            z: intent.facing.z ?? 0
          }
        }),
    jumpPressed: intent.jumpPressed,
    jumpHeld: intent.jumpHeld,
    divePressed: intent.divePressed
  };
}

function assertSequence(sequence: number): void {
  if (!Number.isSafeInteger(sequence) || sequence < 0) {
    throw new GameError(
      "character.intent_buffer_sequence_invalid",
      "Character intent buffer sequence must be a non-negative safe integer"
    );
  }
}
