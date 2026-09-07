import type {
  PhysicsBodyCommand,
  PhysicsBodyPatch,
  PhysicsBodyState,
  PhysicsVector
} from "@gamekits/physics-core";

export type CharacterControlIntent = {
  sequence: number;
  move: PhysicsVector;
  facing?: PhysicsVector | undefined;
  jumpPressed: boolean;
  jumpHeld: boolean;
  divePressed: boolean;
};

export type CharacterMotorMode =
  | "grounded"
  | "airborne"
  | "diving"
  | "staggered"
  | "recovering"
  | "eliminated";

export type CharacterMotorDefinition = {
  id: string;
  version: string;
  capsuleRadius: number;
  capsuleHeight: number;
  maxGroundSpeed: number;
  groundAcceleration: number;
  groundBraking: number;
  maxAirSpeed: number;
  airAcceleration: number;
  airBraking: number;
  maxSlopeRadians: number;
  stepHeight: number;
  groundProbeDistance: number;
  groundSnapDistance: number;
  ceilingClearance: number;
  coyoteTimeMs: number;
  jumpBufferMs: number;
  jumpSpeed: number;
  jumpHoldDurationMs: number;
  jumpHoldAcceleration: number;
  diveSpeed: number;
  diveVerticalSpeed: number;
  minimumDiveAirTimeMs: number;
  diveDurationMs: number;
  recoveryDurationMs: number;
  diveCooldownMs: number;
  diveSteeringScale: number;
  staggerControlScale: number;
  recoveryControlScale: number;
  maxPlatformSpeed: number;
  platformDepartureVelocityScale: number;
  maxFacingRateRadiansPerSecond: number;
};

export type CompiledCharacterMotorDefinition = Readonly<CharacterMotorDefinition>;

export type CharacterGroundObservation = {
  distance: number;
  normal: PhysicsVector;
  bodyId?: string | undefined;
  bodyLinearVelocity?: PhysicsVector | undefined;
  surfaceId?: string | undefined;
};

export type CharacterStepObservation = {
  height: number;
  landingNormal: PhysicsVector;
  clearance: boolean;
};

export type CharacterMotorObservation = {
  ground?: CharacterGroundObservation | undefined;
  step?: CharacterStepObservation | undefined;
  ceilingBlocked?: boolean | undefined;
  queryCount?: number | undefined;
  rejectedQueryCount?: number | undefined;
  staggerDurationMs?: number | undefined;
};

export type CharacterMotorState = {
  mode: CharacterMotorMode;
  grounded: boolean;
  groundNormal: PhysicsVector;
  groundBodyId?: string | undefined;
  surfaceId?: string | undefined;
  inheritedPlatformVelocity: PhysicsVector;
  facingYaw: number;
  coyoteRemainingMs: number;
  jumpBufferRemainingMs: number;
  jumpHoldRemainingMs: number;
  diveRemainingMs: number;
  diveCooldownRemainingMs: number;
  recoveryRemainingMs: number;
  staggerRemainingMs: number;
  airborneTimeMs: number;
  lastConsumedJumpSequence: number;
  lastConsumedDiveSequence: number;
  lastStableTick: number;
};

export type CharacterMotorTraceCode =
  | "grounded"
  | "ground-rejected"
  | "step-applied"
  | "step-rejected"
  | "jump-buffered"
  | "jump-consumed"
  | "jump-duplicate"
  | "dive-consumed"
  | "dive-duplicate"
  | "dive-rejected"
  | "dive-recovery"
  | "staggered"
  | "recovered"
  | "facing-updated";

export type CharacterMotorTraceEntry = {
  tick: number;
  sequence: number;
  code: CharacterMotorTraceCode;
  details?: Record<string, boolean | number | string | undefined> | undefined;
};

export type CharacterMotorDiagnostics = {
  tick: number;
  sequence: number;
  mode: CharacterMotorMode;
  grounded: boolean;
  groundBodyId?: string | undefined;
  surfaceId?: string | undefined;
  groundSlopeRadians?: number | undefined;
  queryCount: number;
  rejectedQueryCount: number;
  commandCount: number;
  coyoteRemainingMs: number;
  jumpBufferRemainingMs: number;
  diveRemainingMs: number;
  recoveryRemainingMs: number;
  staggerRemainingMs: number;
  lastConsumedJumpSequence: number;
  lastConsumedDiveSequence: number;
};

export type CharacterMotorStepInput = {
  tick: number;
  deltaMs: number;
  definition: CompiledCharacterMotorDefinition;
  state: Readonly<CharacterMotorState>;
  intent: Readonly<CharacterControlIntent>;
  body: Readonly<PhysicsBodyState>;
  observation?: Readonly<CharacterMotorObservation> | undefined;
};

export type CharacterMotorStepResult = {
  state: CharacterMotorState;
  bodyPatch: PhysicsBodyPatch;
  bodyCommands: PhysicsBodyCommand[];
  diagnostics: CharacterMotorDiagnostics;
  trace: CharacterMotorTraceEntry[];
};
