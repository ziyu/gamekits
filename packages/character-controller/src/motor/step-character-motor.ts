import { GameError } from "@gamekits/core";
import type { PhysicsBodyPatch, PhysicsVector } from "@gamekits/physics-core";
import type {
  CharacterControlIntent,
  CharacterGroundObservation,
  CharacterMotorDefinition,
  CharacterMotorDiagnostics,
  CharacterMotorMode,
  CharacterMotorState,
  CharacterMotorStepInput,
  CharacterMotorStepResult,
  CharacterMotorTraceEntry
} from "../contracts";
import { cloneCharacterMotorState } from "./state";

const EPSILON = 1e-6;
// Contact solvers return small normal/velocity residuals even for resting bodies.
// Keep this far below intentional jump or impulse speeds while avoiding false departures.
const GROUND_SEPARATION_VELOCITY_TOLERANCE = 0.01;
const MAX_TRACE_ENTRIES = 16;

export function stepCharacterMotor(input: CharacterMotorStepInput): CharacterMotorStepResult {
  validateStepInput(input);
  const { body, definition, intent, observation = {}, tick } = input;
  const deltaMs = input.deltaMs;
  const deltaSeconds = deltaMs / 1_000;
  const state = cloneCharacterMotorState(input.state);
  const trace: CharacterMotorTraceEntry[] = [];
  const commands = [];
  const ground = classifyGround(observation.ground, definition);
  const groundSeparationSpeed = dotVector(
    subtractVector(body.linearVelocity, ground.observation?.bodyLinearVelocity),
    ground.normal
  );
  let grounded = ground.walkable && groundSeparationSpeed <= GROUND_SEPARATION_VELOCITY_TOLERANCE;
  const wasGrounded = state.grounded;

  state.lastStableTick = tick;
  state.jumpBufferRemainingMs = decrement(state.jumpBufferRemainingMs, deltaMs);
  state.jumpHoldRemainingMs = observation.ceilingBlocked
    ? 0
    : decrement(state.jumpHoldRemainingMs, deltaMs);
  state.diveRemainingMs = decrement(state.diveRemainingMs, deltaMs);
  state.diveCooldownRemainingMs = decrement(state.diveCooldownRemainingMs, deltaMs);
  state.recoveryRemainingMs = decrement(state.recoveryRemainingMs, deltaMs);
  state.staggerRemainingMs = decrement(state.staggerRemainingMs, deltaMs);

  if (grounded) {
    state.coyoteRemainingMs = definition.coyoteTimeMs;
    state.airborneTimeMs = 0;
    state.groundNormal = cloneVector(ground.normal);
    state.groundBodyId = ground.observation?.bodyId;
    state.surfaceId = ground.observation?.surfaceId;
    state.inheritedPlatformVelocity = limitedPlatformVelocity(
      ground.observation?.bodyLinearVelocity,
      definition.maxPlatformSpeed
    );
    pushTrace(trace, input, "grounded", {
      bodyId: state.groundBodyId,
      surfaceId: state.surfaceId,
      slopeRadians: ground.slopeRadians
    });
  } else {
    state.coyoteRemainingMs = wasGrounded
      ? definition.coyoteTimeMs
      : decrement(state.coyoteRemainingMs, deltaMs);
    state.airborneTimeMs += deltaMs;
    state.groundBodyId = undefined;
    state.surfaceId = undefined;
    if (ground.observation !== undefined) {
      pushTrace(trace, input, "ground-rejected", {
        slopeRadians: ground.slopeRadians,
        rising: groundSeparationSpeed > GROUND_SEPARATION_VELOCITY_TOLERANCE
      });
    }
    if (wasGrounded) {
      state.inheritedPlatformVelocity = scaleVector(
        state.inheritedPlatformVelocity,
        definition.platformDepartureVelocityScale
      );
    }
  }

  if (intent.jumpPressed) {
    if (intent.sequence <= state.lastConsumedJumpSequence) {
      pushTrace(trace, input, "jump-duplicate");
    } else {
      state.jumpBufferRemainingMs = definition.jumpBufferMs;
      pushTrace(trace, input, "jump-buffered");
    }
  }

  const staggerDuration = finiteNonNegative(observation.staggerDurationMs);
  if (staggerDuration > 0) {
    state.staggerRemainingMs = Math.max(state.staggerRemainingMs, staggerDuration);
    state.recoveryRemainingMs = 0;
    state.mode = "staggered";
    pushTrace(trace, input, "staggered", { durationMs: state.staggerRemainingMs });
  }

  let jumped = false;
  if (
    state.mode !== "eliminated" &&
    state.staggerRemainingMs <= 0 &&
    state.jumpBufferRemainingMs > 0 &&
    (grounded || state.coyoteRemainingMs > 0) &&
    intent.sequence > state.lastConsumedJumpSequence
  ) {
    jumped = true;
    grounded = false;
    state.lastConsumedJumpSequence = intent.sequence;
    state.jumpBufferRemainingMs = 0;
    state.jumpHoldRemainingMs = definition.jumpHoldDurationMs;
    state.coyoteRemainingMs = 0;
    state.airborneTimeMs = 0;
    state.groundBodyId = undefined;
    state.surfaceId = undefined;
    state.mode = "airborne";
    pushTrace(trace, input, "jump-consumed");
  }

  const diveDirection = normalizedHorizontal(intent.facing ?? intent.move);
  const diveRequested = intent.divePressed;
  const canDive =
    state.mode !== "eliminated" &&
    state.staggerRemainingMs <= 0 &&
    state.diveCooldownRemainingMs <= 0 &&
    state.airborneTimeMs >= definition.minimumDiveAirTimeMs &&
    vectorLengthSquared(diveDirection) > EPSILON;
  if (diveRequested && intent.sequence <= state.lastConsumedDiveSequence) {
    pushTrace(trace, input, "dive-duplicate");
  } else if (diveRequested && canDive) {
    state.lastConsumedDiveSequence = intent.sequence;
    state.diveRemainingMs = definition.diveDurationMs;
    state.diveCooldownRemainingMs = definition.diveCooldownMs;
    state.recoveryRemainingMs = 0;
    state.mode = "diving";
    commands.push({
      type: "linear-impulse" as const,
      bodyId: body.id,
      impulse: {
        x: diveDirection.x * definition.diveSpeed,
        y: definition.diveVerticalSpeed,
        z: (diveDirection.z ?? 0) * definition.diveSpeed
      },
      wake: "wake" as const
    });
    pushTrace(trace, input, "dive-consumed");
  } else if (diveRequested) {
    pushTrace(trace, input, "dive-rejected", {
      cooldownMs: state.diveCooldownRemainingMs,
      airborneTimeMs: state.airborneTimeMs
    });
  }

  if (input.state.mode === "diving" && state.diveRemainingMs <= 0 && state.mode === "diving") {
    state.mode = "recovering";
    state.recoveryRemainingMs = definition.recoveryDurationMs;
    pushTrace(trace, input, "dive-recovery");
  }
  if (
    input.state.mode === "staggered" &&
    state.staggerRemainingMs <= 0 &&
    state.mode === "staggered"
  ) {
    state.mode = "recovering";
    state.recoveryRemainingMs = definition.recoveryDurationMs;
    pushTrace(trace, input, "recovered", { from: "staggered" });
  }
  if (state.mode === "recovering" && state.recoveryRemainingMs <= 0) {
    state.mode = grounded ? "grounded" : "airborne";
    pushTrace(trace, input, "recovered", { from: "recovering" });
  }
  if (state.mode !== "diving" && state.mode !== "staggered" && state.mode !== "recovering") {
    state.mode = grounded ? "grounded" : "airborne";
  }

  const controlScale = controlScaleFor(state.mode, definition);
  const movement = normalizedHorizontal(intent.move);
  const locomotionDirection = grounded ? projectOntoGround(movement, ground.normal) : movement;
  const targetSpeed = grounded ? definition.maxGroundSpeed : definition.maxAirSpeed;
  const platformVelocity = state.inheritedPlatformVelocity;
  const relativeCurrent = {
    x: body.linearVelocity.x - platformVelocity.x,
    y: grounded ? body.linearVelocity.y - platformVelocity.y : 0,
    z: (body.linearVelocity.z ?? 0) - (platformVelocity.z ?? 0)
  };
  const hasMovement = vectorLengthSquared(movement) > EPSILON;
  const target = scaleVector(locomotionDirection, targetSpeed * controlScale);
  const acceleration = grounded
    ? hasMovement
      ? definition.groundAcceleration
      : definition.groundBraking
    : hasMovement
      ? definition.airAcceleration
      : definition.airBraking;
  const nextRelative = moveVectorTowards(relativeCurrent, target, acceleration * deltaSeconds);
  const bodyPatch: PhysicsBodyPatch = {
    linearVelocity: {
      x: nextRelative.x + platformVelocity.x,
      y: jumped
        ? definition.jumpSpeed
        : grounded
          ? nextRelative.y + platformVelocity.y
          : jumpHeldVelocity(body.linearVelocity.y, state, intent, definition, deltaSeconds),
      z: (nextRelative.z ?? 0) + (platformVelocity.z ?? 0)
    }
  };

  const step = observation.step;
  if (step !== undefined) {
    const stepSlope = slopeRadians(step.landingNormal);
    if (
      grounded &&
      !jumped &&
      step.clearance &&
      step.height > 0 &&
      step.height <= definition.stepHeight &&
      stepSlope <= definition.maxSlopeRadians
    ) {
      bodyPatch.position = {
        x: body.position.x,
        y: body.position.y + step.height,
        z: body.position.z ?? 0
      };
      pushTrace(trace, input, "step-applied", { height: step.height });
    } else {
      pushTrace(trace, input, "step-rejected", {
        height: step.height,
        clearance: step.clearance,
        slopeRadians: stepSlope
      });
    }
  }

  const facingDirection = normalizedHorizontal(intent.facing ?? intent.move);
  if (vectorLengthSquared(facingDirection) > EPSILON) {
    const targetYaw = Math.atan2(facingDirection.x, facingDirection.z ?? 0);
    state.facingYaw = moveAngleTowards(
      state.facingYaw,
      targetYaw,
      definition.maxFacingRateRadiansPerSecond * deltaSeconds * controlScale
    );
    pushTrace(trace, input, "facing-updated", { yaw: state.facingYaw });
  }

  state.grounded = grounded;
  const diagnostics: CharacterMotorDiagnostics = {
    tick,
    sequence: intent.sequence,
    mode: state.mode,
    grounded,
    groundBodyId: state.groundBodyId,
    surfaceId: state.surfaceId,
    groundSlopeRadians: ground.observation === undefined ? undefined : ground.slopeRadians,
    queryCount: integerNonNegative(observation.queryCount),
    rejectedQueryCount: integerNonNegative(observation.rejectedQueryCount),
    commandCount: commands.length,
    coyoteRemainingMs: state.coyoteRemainingMs,
    jumpBufferRemainingMs: state.jumpBufferRemainingMs,
    diveRemainingMs: state.diveRemainingMs,
    recoveryRemainingMs: state.recoveryRemainingMs,
    staggerRemainingMs: state.staggerRemainingMs,
    lastConsumedJumpSequence: state.lastConsumedJumpSequence,
    lastConsumedDiveSequence: state.lastConsumedDiveSequence
  };
  return { state, bodyPatch, bodyCommands: commands, diagnostics, trace };
}

function validateStepInput(input: CharacterMotorStepInput): void {
  if (!Number.isSafeInteger(input.tick) || input.tick < 0) {
    throw new GameError(
      "character.motor_tick_invalid",
      "Character motor tick must be non-negative"
    );
  }
  if (!Number.isFinite(input.deltaMs) || input.deltaMs <= 0) {
    throw new GameError(
      "character.motor_delta_invalid",
      "Character motor deltaMs must be positive and finite"
    );
  }
  if (!Number.isSafeInteger(input.intent.sequence) || input.intent.sequence < 0) {
    throw new GameError(
      "character.motor_sequence_invalid",
      "Character intent sequence must be a non-negative safe integer"
    );
  }
  assertFiniteVector(input.intent.move, "intent.move");
  if (input.intent.facing !== undefined) assertFiniteVector(input.intent.facing, "intent.facing");
  assertFiniteVector(input.body.position, "body.position");
  assertFiniteVector(input.body.linearVelocity, "body.linearVelocity");
}

function classifyGround(
  observation: Readonly<CharacterGroundObservation> | undefined,
  definition: Readonly<CharacterMotorDefinition>
): {
  observation?: Readonly<CharacterGroundObservation> | undefined;
  normal: PhysicsVector;
  slopeRadians: number;
  walkable: boolean;
} {
  const normal = observation === undefined ? { x: 0, y: 1, z: 0 } : normalized(observation.normal);
  const slope = slopeRadians(normal);
  return {
    observation,
    normal,
    slopeRadians: slope,
    walkable:
      observation !== undefined &&
      Number.isFinite(observation.distance) &&
      observation.distance >= 0 &&
      observation.distance <= definition.groundProbeDistance &&
      slope <= definition.maxSlopeRadians
  };
}

function jumpHeldVelocity(
  verticalVelocity: number,
  state: Readonly<CharacterMotorState>,
  intent: Readonly<CharacterControlIntent>,
  definition: Readonly<CharacterMotorDefinition>,
  deltaSeconds: number
): number {
  if (
    !intent.jumpHeld ||
    state.jumpHoldRemainingMs <= 0 ||
    state.mode === "staggered" ||
    verticalVelocity <= 0
  ) {
    return verticalVelocity;
  }
  return Math.min(
    definition.jumpSpeed,
    verticalVelocity + definition.jumpHoldAcceleration * deltaSeconds
  );
}

function controlScaleFor(
  mode: CharacterMotorMode,
  definition: Readonly<CharacterMotorDefinition>
): number {
  if (mode === "eliminated") return 0;
  if (mode === "staggered") return definition.staggerControlScale;
  if (mode === "recovering") return definition.recoveryControlScale;
  if (mode === "diving") return definition.diveSteeringScale;
  return 1;
}

function limitedPlatformVelocity(
  velocity: Readonly<PhysicsVector> | undefined,
  maximum: number
): PhysicsVector {
  if (velocity === undefined) return { x: 0, y: 0, z: 0 };
  const stableVelocity = { x: velocity.x, y: velocity.y, z: velocity.z ?? 0 };
  const length = Math.sqrt(vectorLengthSquared(stableVelocity));
  if (length <= maximum || length <= EPSILON) return stableVelocity;
  return scaleVector(stableVelocity, maximum / length);
}

function normalizedHorizontal(vector: Readonly<PhysicsVector>): PhysicsVector {
  return normalized({ x: vector.x, y: 0, z: vector.z ?? 0 });
}

function projectOntoGround(
  direction: Readonly<PhysicsVector>,
  normal: Readonly<PhysicsVector>
): PhysicsVector {
  const projected = subtractVector(direction, scaleVector(normal, dotVector(direction, normal)));
  return normalized(projected);
}

function normalized(vector: Readonly<PhysicsVector>): PhysicsVector {
  assertFiniteVector(vector, "vector");
  const length = Math.sqrt(vector.x ** 2 + vector.y ** 2 + (vector.z ?? 0) ** 2);
  if (length <= EPSILON) return { x: 0, y: 0, z: 0 };
  return { x: vector.x / length, y: vector.y / length, z: (vector.z ?? 0) / length };
}

function moveVectorTowards(
  current: Readonly<PhysicsVector>,
  target: Readonly<PhysicsVector>,
  maximumDelta: number
): PhysicsVector {
  const delta = {
    x: target.x - current.x,
    y: target.y - current.y,
    z: (target.z ?? 0) - (current.z ?? 0)
  };
  const length = Math.sqrt(vectorLengthSquared(delta));
  if (length <= maximumDelta || length <= EPSILON) return cloneVector(target);
  return {
    x: current.x + (delta.x / length) * maximumDelta,
    y: current.y + (delta.y / length) * maximumDelta,
    z: (current.z ?? 0) + ((delta.z ?? 0) / length) * maximumDelta
  };
}

function moveAngleTowards(current: number, target: number, maximumDelta: number): number {
  const delta = wrapAngle(target - current);
  if (Math.abs(delta) <= maximumDelta) return wrapAngle(target);
  return wrapAngle(current + Math.sign(delta) * maximumDelta);
}

function wrapAngle(angle: number): number {
  let wrapped = angle;
  while (wrapped > Math.PI) wrapped -= Math.PI * 2;
  while (wrapped < -Math.PI) wrapped += Math.PI * 2;
  return wrapped;
}

function slopeRadians(normal: Readonly<PhysicsVector>): number {
  return Math.acos(Math.max(-1, Math.min(1, normalized(normal).y)));
}

function dotVector(left: Readonly<PhysicsVector>, right: Readonly<PhysicsVector>): number {
  return left.x * right.x + left.y * right.y + (left.z ?? 0) * (right.z ?? 0);
}

function subtractVector(
  left: Readonly<PhysicsVector>,
  right: Readonly<PhysicsVector> | undefined
): PhysicsVector {
  if (right === undefined) return cloneVector(left);
  return {
    x: left.x - right.x,
    y: left.y - right.y,
    z: (left.z ?? 0) - (right.z ?? 0)
  };
}

function pushTrace(
  trace: CharacterMotorTraceEntry[],
  input: CharacterMotorStepInput,
  code: CharacterMotorTraceEntry["code"],
  details?: CharacterMotorTraceEntry["details"]
): void {
  if (trace.length >= MAX_TRACE_ENTRIES) return;
  trace.push({
    tick: input.tick,
    sequence: input.intent.sequence,
    code,
    ...(details === undefined ? {} : { details })
  });
}

function assertFiniteVector(vector: Readonly<PhysicsVector>, path: string): void {
  if (
    !Number.isFinite(vector.x) ||
    !Number.isFinite(vector.y) ||
    (vector.z !== undefined && !Number.isFinite(vector.z))
  ) {
    throw new GameError("character.motor_vector_invalid", `${path} must be finite`, {
      path,
      vector
    });
  }
}

function cloneVector(vector: Readonly<PhysicsVector>): PhysicsVector {
  return { x: vector.x, y: vector.y, z: vector.z ?? 0 };
}

function scaleVector(vector: Readonly<PhysicsVector>, scale: number): PhysicsVector {
  return { x: vector.x * scale, y: vector.y * scale, z: (vector.z ?? 0) * scale };
}

function vectorLengthSquared(vector: Readonly<PhysicsVector>): number {
  return vector.x ** 2 + vector.y ** 2 + (vector.z ?? 0) ** 2;
}

function decrement(value: number, deltaMs: number): number {
  return Math.max(0, finiteNonNegative(value) - deltaMs);
}

function finiteNonNegative(value: number | undefined): number {
  return value !== undefined && Number.isFinite(value) ? Math.max(0, value) : 0;
}

function integerNonNegative(value: number | undefined): number {
  return Math.max(0, Math.floor(finiteNonNegative(value)));
}
