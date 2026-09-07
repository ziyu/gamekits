import {
  compileCharacterMotorDefinition,
  observeCharacterEnvironment,
  stepCharacterMotor,
  type CharacterControlIntent,
  type CharacterMotorDefinition,
  type CharacterMotorObservation,
  type CharacterMotorState,
  type CharacterMotorStepResult,
  type CompiledCharacterMotorDefinition
} from "@gamekits/character-controller";
import type { PhysicsScene } from "@gamekits/physics-core";

export const CHARACTER_CONTROLLER_LAB_BODY_ID = "character-controller-lab.runner";
export const CHARACTER_CONTROLLER_LAB_COLLIDER_ID = "character-controller-lab.runner.collider";

export const CHARACTER_CONTROLLER_LAB_MOTOR_DEFINITION = compileCharacterMotorDefinition({
  id: "sandbox.character-controller-lab.runner",
  version: "1",
  capsuleRadius: 0.38,
  capsuleHeight: 1.64,
  maxGroundSpeed: 5.2,
  groundAcceleration: 34,
  groundBraking: 42,
  maxAirSpeed: 4.1,
  airAcceleration: 12,
  airBraking: 3.5,
  maxSlopeRadians: (48 * Math.PI) / 180,
  stepHeight: 0.42,
  groundProbeDistance: 0.24,
  groundSnapDistance: 0.12,
  ceilingClearance: 0.14,
  coyoteTimeMs: 120,
  jumpBufferMs: 140,
  jumpSpeed: 6.7,
  jumpHoldDurationMs: 150,
  jumpHoldAcceleration: 8,
  diveSpeed: 7.4,
  diveVerticalSpeed: 1.1,
  minimumDiveAirTimeMs: 80,
  diveDurationMs: 300,
  recoveryDurationMs: 240,
  diveCooldownMs: 720,
  diveSteeringScale: 0.3,
  staggerControlScale: 0.08,
  recoveryControlScale: 0.55,
  maxPlatformSpeed: 7,
  platformDepartureVelocityScale: 0.85,
  maxFacingRateRadiansPerSecond: Math.PI * 5
} satisfies CharacterMotorDefinition);

export type CharacterControllerLabAxes = {
  sequence: number;
  moveX: number;
  moveZ: number;
  jumpPressed: boolean;
  jumpHeld: boolean;
  divePressed: boolean;
};

export function characterControllerLabIntent(
  axes: Readonly<CharacterControllerLabAxes>
): CharacterControlIntent {
  return {
    sequence: axes.sequence,
    move: { x: axes.moveX, y: 0, z: axes.moveZ },
    facing: { x: axes.moveX, y: 0, z: axes.moveZ },
    jumpPressed: axes.jumpPressed,
    jumpHeld: axes.jumpHeld,
    divePressed: axes.divePressed
  };
}

export function neutralCharacterControllerLabIntent(sequence: number): CharacterControlIntent {
  return characterControllerLabIntent({
    sequence,
    moveX: 0,
    moveZ: 0,
    jumpPressed: false,
    jumpHeld: false,
    divePressed: false
  });
}

export function stepCharacterControllerLabMotor(options: {
  scene: PhysicsScene;
  definition?: CompiledCharacterMotorDefinition | undefined;
  state: Readonly<CharacterMotorState>;
  intent: Readonly<CharacterControlIntent>;
  tick: number;
  deltaMs: number;
  staggerDurationMs?: number | undefined;
}): CharacterMotorStepResult {
  const body = options.scene.getBodyState(CHARACTER_CONTROLLER_LAB_BODY_ID);
  if (!body) throw new Error("Character Controller Lab runner body is unavailable");
  const definition = options.definition ?? CHARACTER_CONTROLLER_LAB_MOTOR_DEFINITION;
  const observed = observeCharacterEnvironment({
    body,
    definition,
    intent: options.intent,
    simulation: {
      query: (query) => options.scene.query(query),
      body: (bodyId) => options.scene.getBodyState(bodyId)
    },
    ignoreColliderIds: [CHARACTER_CONTROLLER_LAB_COLLIDER_ID]
  });
  const observation: CharacterMotorObservation = {
    ...observed,
    ...(options.staggerDurationMs === undefined
      ? {}
      : { staggerDurationMs: options.staggerDurationMs })
  };
  const result = stepCharacterMotor({
    tick: options.tick,
    deltaMs: options.deltaMs,
    definition,
    state: options.state,
    intent: options.intent,
    body,
    observation
  });
  options.scene.updateBody(CHARACTER_CONTROLLER_LAB_BODY_ID, result.bodyPatch);
  for (const command of result.bodyCommands) {
    const applied = options.scene.applyBodyCommand?.(command);
    if (applied?.status !== "applied") {
      throw new Error(
        `Character Controller Lab command failed: ${applied?.status ?? "unsupported"}`
      );
    }
  }
  return result;
}
