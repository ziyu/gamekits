import {
  compileCharacterMotorDefinition,
  createCharacterMotorPredictionContributor,
  observeCharacterEnvironment,
  type CharacterControlIntent,
  type CharacterMotorDefinition,
  type CharacterMotorPredictionCommand,
  type CharacterMotorPredictionContributor
} from "@gamekits/character-controller";

import { ARENA_CONTENT_VERSION, ARENA_STANDARD_MOTOR_PROFILE } from "../content/pack";
import { ARENA_FIXED_STEP_MS, type ArenaActorControl, type ArenaActorControlFrame } from "./config";

export const ARENA_CHARACTER_MOTOR_CONTRIBUTOR_ID = "character.motor";

export const ARENA_CHARACTER_MOTOR_DEFINITION = compileCharacterMotorDefinition({
  id: ARENA_STANDARD_MOTOR_PROFILE.id,
  version: ARENA_CONTENT_VERSION,
  capsuleRadius: 0.52,
  capsuleHeight: 1.89,
  maxGroundSpeed: ARENA_STANDARD_MOTOR_PROFILE.maxGroundSpeed,
  groundAcceleration: ARENA_STANDARD_MOTOR_PROFILE.groundAcceleration,
  groundBraking: ARENA_STANDARD_MOTOR_PROFILE.groundBraking,
  maxAirSpeed: 5.4,
  airAcceleration: ARENA_STANDARD_MOTOR_PROFILE.airAcceleration,
  airBraking: 5,
  maxSlopeRadians: (50 * Math.PI) / 180,
  stepHeight: 0.42,
  groundProbeDistance: 0.22,
  groundSnapDistance: 0.12,
  ceilingClearance: 0.12,
  coyoteTimeMs: ARENA_STANDARD_MOTOR_PROFILE.coyoteTicks * ARENA_FIXED_STEP_MS,
  jumpBufferMs: ARENA_STANDARD_MOTOR_PROFILE.jumpBufferTicks * ARENA_FIXED_STEP_MS,
  jumpSpeed: ARENA_STANDARD_MOTOR_PROFILE.jumpSpeed,
  jumpHoldDurationMs: 120,
  jumpHoldAcceleration: 8,
  diveSpeed: ARENA_STANDARD_MOTOR_PROFILE.diveSpeed,
  diveVerticalSpeed: 1.8,
  minimumDiveAirTimeMs: 100,
  diveDurationMs: 380,
  recoveryDurationMs: 260,
  diveCooldownMs: 900,
  diveSteeringScale: 0.35,
  staggerControlScale: 0.12,
  recoveryControlScale: 0.55,
  maxPlatformSpeed: 14,
  platformDepartureVelocityScale: 0.8,
  maxFacingRateRadiansPerSecond: Math.PI * 5
} satisfies CharacterMotorDefinition);

export type ArenaCharacterControlCommand = {
  memberId: string;
  command: CharacterMotorPredictionCommand;
};

export function createArenaCharacterIntent(
  control: Readonly<ArenaActorControl>,
  sequence: number
): CharacterControlIntent {
  return {
    sequence,
    move: { x: control.moveX, y: 0, z: control.moveZ },
    facing: { x: control.moveX, y: 0, z: control.moveZ },
    jumpPressed: control.jump,
    jumpHeld: control.jump,
    divePressed: false
  };
}

export function createArenaCharacterControlCommands(
  controlsByMemberId: Readonly<Record<string, ArenaActorControlFrame>>
): ArenaCharacterControlCommand[] {
  return Object.entries(controlsByMemberId)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([memberId, control]) => ({
      memberId,
      command: {
        type: "control" as const,
        memberId,
        intent: createArenaCharacterIntent(control, control.sequence)
      }
    }));
}

export function createArenaCharacterMotorContributor(): CharacterMotorPredictionContributor {
  return createCharacterMotorPredictionContributor({
    id: ARENA_CHARACTER_MOTOR_CONTRIBUTOR_ID,
    version: ARENA_CHARACTER_MOTOR_DEFINITION.version,
    maxCheckpointBytes: 256 * 1024,
    resolveDefinition() {
      return ARENA_CHARACTER_MOTOR_DEFINITION;
    },
    observe({ memberId, intent, context }) {
      const body = context.simulation.body(memberId);
      if (body === undefined) return undefined;
      return observeCharacterEnvironment({
        body,
        definition: ARENA_CHARACTER_MOTOR_DEFINITION,
        intent,
        simulation: context.simulation,
        ignoreColliderIds: [`${memberId}.collider`]
      });
    }
  });
}
