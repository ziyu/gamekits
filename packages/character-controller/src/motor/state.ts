import type { PhysicsVector } from "@gamekits/physics-core";
import type { CharacterMotorMode, CharacterMotorState } from "../contracts";

export type CreateCharacterMotorStateOptions = {
  mode?: CharacterMotorMode | undefined;
  grounded?: boolean | undefined;
  facingYaw?: number | undefined;
};

export function createCharacterMotorState(
  options: CreateCharacterMotorStateOptions = {}
): CharacterMotorState {
  const grounded = options.grounded ?? options.mode === "grounded";
  return {
    mode: options.mode ?? (grounded ? "grounded" : "airborne"),
    grounded,
    groundNormal: { x: 0, y: 1, z: 0 },
    inheritedPlatformVelocity: zeroVector(),
    facingYaw: finiteOr(options.facingYaw, 0),
    coyoteRemainingMs: 0,
    jumpBufferRemainingMs: 0,
    jumpHoldRemainingMs: 0,
    diveRemainingMs: 0,
    diveCooldownRemainingMs: 0,
    recoveryRemainingMs: 0,
    staggerRemainingMs: 0,
    airborneTimeMs: grounded ? 0 : 0,
    lastConsumedJumpSequence: -1,
    lastConsumedDiveSequence: -1,
    lastStableTick: 0
  };
}

export function cloneCharacterMotorState(
  state: Readonly<CharacterMotorState>
): CharacterMotorState {
  return {
    ...state,
    groundNormal: cloneVector(state.groundNormal),
    inheritedPlatformVelocity: cloneVector(state.inheritedPlatformVelocity)
  };
}

function zeroVector(): PhysicsVector {
  return { x: 0, y: 0, z: 0 };
}

function cloneVector(vector: Readonly<PhysicsVector>): PhysicsVector {
  return { x: vector.x, y: vector.y, z: vector.z ?? 0 };
}

function finiteOr(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isFinite(value) ? value : fallback;
}
