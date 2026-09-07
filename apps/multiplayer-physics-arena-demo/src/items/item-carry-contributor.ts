import type {
  PhysicsPredictionIslandAuxiliaryContributor,
  PhysicsPredictionIslandCommand
} from "@gamekits/physics-core";

import { ARENA_MOVE_SPEED } from "../shared/config";

export const ARENA_ITEM_CARRY_CONTRIBUTOR_ID = "arena.item-carry";
export const ARENA_ITEM_CARRY_CONTRIBUTOR_VERSION = "1";

export type ArenaItemCarryModifierCommand = {
  memberId: string;
  speedMultiplier: number;
  jumpMultiplier: number;
  jumpPressed: boolean;
};

type ArenaItemCarryCheckpoint = { version: 1 };

export function createArenaItemCarryContributor(): PhysicsPredictionIslandAuxiliaryContributor<
  ArenaItemCarryModifierCommand,
  ArenaItemCarryCheckpoint
> {
  let disposed = false;
  return {
    id: ARENA_ITEM_CARRY_CONTRIBUTOR_ID,
    version: ARENA_ITEM_CARRY_CONTRIBUTOR_VERSION,
    order: 200,
    maxCheckpointBytes: 32,
    apply(command, context) {
      if (disposed) throw new Error("Arena item carry contributor is disposed");
      validateCommand(command);
      const body = context.simulation.body(command.memberId);
      if (body === undefined) return;
      const horizontalSpeed = Math.hypot(body.linearVelocity.x, body.linearVelocity.z ?? 0);
      const maxSpeed = ARENA_MOVE_SPEED * command.speedMultiplier;
      const horizontalScale = horizontalSpeed > maxSpeed ? maxSpeed / horizontalSpeed : 1;
      context.simulation.updateBody(command.memberId, {
        linearVelocity: {
          x: body.linearVelocity.x * horizontalScale,
          y:
            command.jumpPressed && body.linearVelocity.y > 0
              ? body.linearVelocity.y * command.jumpMultiplier
              : body.linearVelocity.y,
          z: (body.linearVelocity.z ?? 0) * horizontalScale
        }
      });
    },
    capture() {
      return { version: 1 };
    },
    validate(checkpoint) {
      return checkpoint.version === 1;
    },
    restore(checkpoint) {
      if (checkpoint.version !== 1) throw new Error("Invalid Arena item carry checkpoint");
    },
    measureBytes() {
      return 16;
    },
    hash() {
      return "arena-item-carry:v1";
    },
    dispose() {
      disposed = true;
    }
  };
}

export function createArenaItemCarryPredictionCommand(input: {
  memberId: string;
  speedMultiplier: number;
  jumpMultiplier: number;
  jumpPressed: boolean;
}): Omit<Extract<PhysicsPredictionIslandCommand, { type: "auxiliary" }>, "tick" | "sequence"> {
  validateCommand(input);
  return {
    type: "auxiliary",
    contributorId: ARENA_ITEM_CARRY_CONTRIBUTOR_ID,
    payload: { ...input }
  };
}

function validateCommand(command: ArenaItemCarryModifierCommand): void {
  if (
    command.memberId.length === 0 ||
    command.memberId.length > 256 ||
    !ratio(command.speedMultiplier) ||
    !ratio(command.jumpMultiplier) ||
    typeof command.jumpPressed !== "boolean"
  ) {
    throw new Error("Invalid Arena item carry modifier command");
  }
}

function ratio(value: number): boolean {
  return Number.isFinite(value) && value > 0 && value <= 1;
}
