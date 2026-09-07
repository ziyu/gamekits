import {
  compileCharacterMotorDefinition,
  observeCharacterEnvironment,
  stepCharacterMotor,
  type CharacterControlIntent,
  type CharacterMotorDefinition,
  type CharacterMotorState,
  type CharacterMotorStepResult
} from "@gamekits/character-controller";
import type { PhysicsScene } from "@gamekits/physics-core";

export const PHYSICS_3D_CHARACTER_BODY_ID = "body.character";
export const PHYSICS_3D_CHARACTER_COLLIDER_ID = "collider.character";

export const PHYSICS_3D_CHARACTER_MOTOR_DEFINITION = compileCharacterMotorDefinition({
  id: "physics-3d-lab.character",
  version: "1",
  capsuleRadius: 0.36,
  capsuleHeight: 1.5,
  maxGroundSpeed: 3.8,
  groundAcceleration: 28,
  groundBraking: 36,
  maxAirSpeed: 3.2,
  airAcceleration: 10,
  airBraking: 4,
  maxSlopeRadians: (48 * Math.PI) / 180,
  stepHeight: 0.34,
  groundProbeDistance: 0.2,
  groundSnapDistance: 0.1,
  ceilingClearance: 0.1,
  coyoteTimeMs: 100,
  jumpBufferMs: 120,
  jumpSpeed: 5.8,
  jumpHoldDurationMs: 120,
  jumpHoldAcceleration: 7,
  diveSpeed: 6.8,
  diveVerticalSpeed: 1.2,
  minimumDiveAirTimeMs: 90,
  diveDurationMs: 320,
  recoveryDurationMs: 220,
  diveCooldownMs: 760,
  diveSteeringScale: 0.35,
  staggerControlScale: 0.1,
  recoveryControlScale: 0.55,
  maxPlatformSpeed: 8,
  platformDepartureVelocityScale: 0.8,
  maxFacingRateRadiansPerSecond: Math.PI * 4
} satisfies CharacterMotorDefinition);

export type Physics3dCharacterAxes = {
  sequence: number;
  moveX: number;
  moveZ: number;
  jumpPressed: boolean;
  jumpHeld: boolean;
  divePressed: boolean;
};

export function createPhysics3dCharacterIntent(
  input: Readonly<Physics3dCharacterAxes>
): CharacterControlIntent {
  return {
    sequence: input.sequence,
    move: { x: input.moveX, y: 0, z: input.moveZ },
    facing: { x: input.moveX, y: 0, z: input.moveZ },
    jumpPressed: input.jumpPressed,
    jumpHeld: input.jumpHeld,
    divePressed: input.divePressed
  };
}

export function stepPhysics3dCharacter(options: {
  scene: PhysicsScene;
  state: Readonly<CharacterMotorState>;
  intent: Readonly<CharacterControlIntent>;
  tick: number;
  deltaMs: number;
}): CharacterMotorStepResult {
  const body = options.scene.getBodyState(PHYSICS_3D_CHARACTER_BODY_ID);
  if (body === undefined) {
    throw new Error("Physics 3D Lab character body is unavailable");
  }
  const observation = observeCharacterEnvironment({
    body,
    definition: PHYSICS_3D_CHARACTER_MOTOR_DEFINITION,
    intent: options.intent,
    simulation: {
      query: (query) => options.scene.query(query),
      body: (bodyId) => options.scene.getBodyState(bodyId)
    },
    ignoreColliderIds: [PHYSICS_3D_CHARACTER_COLLIDER_ID]
  });
  const result = stepCharacterMotor({
    tick: options.tick,
    deltaMs: options.deltaMs,
    definition: PHYSICS_3D_CHARACTER_MOTOR_DEFINITION,
    state: options.state,
    intent: options.intent,
    body,
    observation
  });
  options.scene.updateBody(PHYSICS_3D_CHARACTER_BODY_ID, result.bodyPatch);
  for (const command of result.bodyCommands) {
    const applied = options.scene.applyBodyCommand?.(command);
    if (applied?.status !== "applied") {
      throw new Error(
        `Physics 3D Lab character command failed: ${applied?.status ?? "unsupported"}`
      );
    }
  }
  return result;
}
