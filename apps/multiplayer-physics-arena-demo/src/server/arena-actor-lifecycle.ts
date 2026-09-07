import type { PhysicsPredictionIsland } from "@gamekits/physics-core";
import type { ArenaActorControlFrame, ArenaMatchPhase, ArenaMoveInput } from "../shared/config";

export type ArenaActorAuthorityAction =
  | { type: "none" }
  | { type: "control" }
  | { type: "despawn" };

export type ArenaActorAuthorityStep = {
  control: ArenaActorControlFrame;
  action: ArenaActorAuthorityAction;
};

/** Resolves one authority tick without allowing an eliminated actor to re-enter the round. */
export function resolveArenaActorAuthorityStep(options: {
  phase: ArenaMatchPhase;
  removed: boolean;
  input: ArenaMoveInput;
  memberAvailable: boolean;
}): ArenaActorAuthorityStep {
  if (!options.memberAvailable) {
    return { control: neutralControl(options.input.sequence), action: { type: "none" } };
  }
  if (options.removed) {
    return { control: neutralControl(options.input.sequence), action: { type: "despawn" } };
  }
  if (options.phase === "countdown" || options.phase === "lobby") {
    return {
      control: neutralControl(options.input.sequence),
      action: { type: "control" }
    };
  }
  const control = actorControl(options.input);
  return {
    control,
    action: { type: "control" }
  };
}

/** Restores the initial island for a new authority-owned stage generation. */
export function resetArenaRoundPhysics(island: PhysicsPredictionIsland, generation: string): void {
  island.reset(generation, island.tick());
}

function neutralControl(sequence: number): ArenaActorControlFrame {
  return { sequence, moveX: 0, moveZ: 0, jump: false };
}

function actorControl(input: ArenaMoveInput): ArenaActorControlFrame {
  return { sequence: input.sequence, moveX: input.moveX, moveZ: input.moveZ, jump: input.jump };
}
