import type { DataDocument } from "@gamekits/data";
import type { PhysicsBodyState } from "@gamekits/physics-core";
import { describe, expect, it } from "vitest";
import {
  characterMotorCommandSignature,
  characterMotorStateSignature,
  cloneCharacterMotorState,
  compileCharacterMotorDefinition,
  createCharacterMotorDataType,
  createCharacterMotorState,
  stepCharacterMotor,
  validateCharacterMotorDefinition,
  type CharacterControlIntent,
  type CharacterMotorDefinition,
  type CharacterMotorObservation,
  type CharacterMotorState
} from "@gamekits/character-controller";

const definition = compileCharacterMotorDefinition({
  id: "party.default",
  version: "1",
  capsuleRadius: 0.5,
  capsuleHeight: 1.8,
  maxGroundSpeed: 8,
  groundAcceleration: 20,
  groundBraking: 30,
  maxAirSpeed: 7,
  airAcceleration: 5,
  airBraking: 2,
  maxSlopeRadians: Math.PI / 4,
  stepHeight: 0.5,
  groundProbeDistance: 0.3,
  groundSnapDistance: 0.15,
  ceilingClearance: 0.2,
  coyoteTimeMs: 120,
  jumpBufferMs: 140,
  jumpSpeed: 9,
  jumpHoldDurationMs: 160,
  jumpHoldAcceleration: 12,
  diveSpeed: 5,
  diveVerticalSpeed: 1,
  minimumDiveAirTimeMs: 80,
  diveDurationMs: 180,
  recoveryDurationMs: 240,
  diveCooldownMs: 600,
  diveSteeringScale: 0.2,
  staggerControlScale: 0,
  recoveryControlScale: 0.35,
  maxPlatformSpeed: 6,
  platformDepartureVelocityScale: 0.5,
  maxFacingRateRadiansPerSecond: Math.PI
});

describe("character motor definition", () => {
  it("compiles a bounded profile and reports Data diagnostics for invalid values", () => {
    expect(Object.isFrozen(definition)).toBe(true);
    const invalid = { ...definition, maxSlopeRadians: Infinity, stepHeight: 3 };
    expect(validateCharacterMotorDefinition(invalid)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "character.motor_value_not_finite" }),
        expect.objectContaining({ code: "character.motor_step_too_high" })
      ])
    );
    const dataType = createCharacterMotorDataType();
    const diagnostics = dataType.validate?.(document(invalid), {
      type: "character.motor",
      pack: { id: "test", version: "1", entries: [] },
      path: "entries[0]"
    });
    expect(diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "character.motor_value_not_finite",
          path: "data.maxSlopeRadians"
        })
      ])
    );
  });
});

describe("pure character motor", () => {
  it("normalizes diagonal ground input and brakes instead of overwriting velocity", () => {
    const accelerated = run({
      state: createCharacterMotorState({ grounded: true }),
      intent: intent(1, { move: { x: 1, y: 0, z: 1 } }),
      observation: ground(),
      body: body({ x: 0, y: 0, z: 0 }),
      deltaMs: 100
    });
    const velocity = accelerated.bodyPatch.linearVelocity!;
    expect(Math.hypot(velocity.x, velocity.z ?? 0)).toBeCloseTo(2, 6);

    const braking = run({
      state: createCharacterMotorState(),
      intent: intent(2),
      body: body({ x: 10, y: 0, z: 0 }),
      deltaMs: 100
    });
    expect(braking.bodyPatch.linearVelocity?.x).toBeCloseTo(9.8, 6);
  });

  it("rejects steep ground but preserves coyote time for one buffered jump", () => {
    const edge = run({
      state: createCharacterMotorState({ grounded: true }),
      intent: intent(1),
      observation: ground({ normal: { x: 0.9, y: 0.1, z: 0 } })
    });
    expect(edge.state.grounded).toBe(false);
    expect(edge.state.coyoteRemainingMs).toBe(120);
    expect(edge.trace.map((entry) => entry.code)).toContain("ground-rejected");

    const jumped = run({
      state: edge.state,
      intent: intent(2, { jumpPressed: true, jumpHeld: true }),
      deltaMs: 16
    });
    expect(jumped.state.lastConsumedJumpSequence).toBe(2);
    expect(jumped.bodyPatch.linearVelocity?.y).toBe(9);
    expect(jumped.trace.map((entry) => entry.code)).toContain("jump-consumed");
  });

  it("buffers an airborne jump until landing and rejects a duplicate sequence", () => {
    const buffered = run({
      state: createCharacterMotorState(),
      intent: intent(7, { jumpPressed: true }),
      deltaMs: 16
    });
    expect(buffered.state.jumpBufferRemainingMs).toBe(140);

    const landed = run({
      state: buffered.state,
      intent: intent(7),
      observation: ground(),
      deltaMs: 16
    });
    expect(landed.state.lastConsumedJumpSequence).toBe(7);
    expect(landed.bodyPatch.linearVelocity?.y).toBe(9);

    const duplicate = run({
      state: landed.state,
      intent: intent(7, { jumpPressed: true }),
      observation: ground(),
      deltaMs: 16
    });
    expect(duplicate.state.lastConsumedJumpSequence).toBe(7);
    expect(duplicate.trace.map((entry) => entry.code)).toContain("jump-duplicate");
    expect(duplicate.bodyPatch.linearVelocity?.y).not.toBe(9);
  });

  it("applies only clear, bounded, walkable steps", () => {
    const accepted = run({
      state: createCharacterMotorState({ grounded: true }),
      intent: intent(1, { move: { x: 1, y: 0, z: 0 } }),
      observation: {
        ...ground(),
        step: { height: 0.4, landingNormal: { x: 0, y: 1, z: 0 }, clearance: true }
      }
    });
    expect(accepted.bodyPatch.position?.y).toBe(2.4);
    expect(accepted.trace.map((entry) => entry.code)).toContain("step-applied");

    const rejected = run({
      state: createCharacterMotorState({ grounded: true }),
      intent: intent(2),
      observation: {
        ...ground(),
        step: { height: 0.7, landingNormal: { x: 0, y: 1, z: 0 }, clearance: true }
      }
    });
    expect(rejected.bodyPatch.position).toBeUndefined();
    expect(rejected.trace.map((entry) => entry.code)).toContain("step-rejected");
  });

  it("projects grounded locomotion onto a walkable slope without becoming airborne", () => {
    const slopeNormal = { x: -Math.sin(0.2), y: Math.cos(0.2), z: 0 };
    const result = run({
      state: createCharacterMotorState({ grounded: true }),
      intent: intent(1, { move: { x: 1, y: 0, z: 0 } }),
      observation: ground({ normal: slopeNormal }),
      body: body({ x: 0, y: 0, z: 0 }),
      deltaMs: 100
    });

    expect(result.state.grounded).toBe(true);
    expect(result.bodyPatch.linearVelocity?.x).toBeGreaterThan(1.9);
    expect(result.bodyPatch.linearVelocity?.y).toBeGreaterThan(0.3);
  });

  it("keeps solver-scale normal noise grounded but preserves real separation", () => {
    const noisyNormal = { x: 0.00001, y: Math.sqrt(1 - 0.00001 ** 2), z: 0 };
    const supported = run({
      state: createCharacterMotorState({ grounded: true }),
      intent: intent(1, { move: { x: 1, y: 0, z: 0 } }),
      observation: ground({ normal: noisyNormal }),
      body: body({ x: 8, y: 0, z: 0 })
    });
    expect(supported.state.grounded).toBe(true);
    expect(supported.state.mode).toBe("grounded");

    const separating = run({
      state: supported.state,
      intent: intent(2),
      observation: ground(),
      body: body({ x: 0, y: 0.02, z: 0 })
    });
    expect(separating.state.grounded).toBe(false);
    expect(separating.state.mode).toBe("airborne");
    expect(separating.trace).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "ground-rejected",
          details: expect.objectContaining({ rising: true })
        })
      ])
    );
  });

  it("inherits bounded moving-platform velocity and keeps the declared departure fraction", () => {
    const supported = run({
      state: createCharacterMotorState({ grounded: true }),
      intent: intent(1),
      observation: ground({ bodyId: "platform", bodyLinearVelocity: { x: 20, y: 0, z: 0 } }),
      body: body({ x: 6, y: 0, z: 0 })
    });
    expect(supported.state.inheritedPlatformVelocity.x).toBe(6);
    expect(supported.bodyPatch.linearVelocity?.x).toBe(6);

    const departed = run({
      state: supported.state,
      intent: intent(2),
      body: body({ x: 6, y: 0, z: 0 })
    });
    expect(departed.state.inheritedPlatformVelocity.x).toBe(3);
    expect(departed.bodyPatch.linearVelocity?.x).toBe(5.968);
  });

  it("commits one dive impulse, then enters deterministic recovery and cooldown", () => {
    const ready = createCharacterMotorState();
    ready.airborneTimeMs = 100;
    const diving = run({
      state: ready,
      intent: intent(9, { move: { x: 1, y: 0, z: 0 }, divePressed: true })
    });
    expect(diving.state.mode).toBe("diving");
    expect(diving.bodyCommands).toEqual([
      expect.objectContaining({
        type: "linear-impulse",
        bodyId: "actor",
        impulse: { x: 5, y: 1, z: 0 }
      })
    ]);

    const duplicate = run({
      state: diving.state,
      intent: intent(9, { move: { x: 1, y: 0, z: 0 }, divePressed: true }),
      deltaMs: 100
    });
    expect(duplicate.bodyCommands).toHaveLength(0);
    expect(duplicate.trace.map((entry) => entry.code)).toContain("dive-duplicate");

    const recovery = run({
      state: duplicate.state,
      intent: intent(10),
      deltaMs: 100
    });
    expect(recovery.state.mode).toBe("recovering");
    expect(recovery.state.recoveryRemainingMs).toBe(240);
    expect(recovery.state.diveCooldownRemainingMs).toBe(400);
  });

  it("keeps external velocity during stagger and exits through recovery", () => {
    const staggered = run({
      state: createCharacterMotorState(),
      intent: intent(1, { move: { x: -1, y: 0, z: 0 } }),
      observation: { staggerDurationMs: 100 },
      body: body({ x: 12, y: 3, z: 0 }),
      deltaMs: 16
    });
    expect(staggered.state.mode).toBe("staggered");
    expect(staggered.bodyPatch.linearVelocity).toEqual({ x: 11.92, y: 3, z: 0 });

    const recovery = run({
      state: staggered.state,
      intent: intent(2),
      body: body(staggered.bodyPatch.linearVelocity!),
      deltaMs: 100
    });
    expect(recovery.state.mode).toBe("recovering");
    expect(recovery.state.recoveryRemainingMs).toBe(240);
  });

  it("bounds facing response and produces stable replay signatures", () => {
    const input = {
      state: createCharacterMotorState({ grounded: true }),
      intent: intent(4, { facing: { x: 1, y: 0, z: 0 } }),
      observation: ground(),
      deltaMs: 100
    };
    const first = run(input);
    const replay = run({ ...input, state: cloneCharacterMotorState(input.state) });
    expect(first.state.facingYaw).toBeCloseTo(Math.PI * 0.1, 6);
    expect(characterMotorCommandSignature(first)).toBe(characterMotorCommandSignature(replay));
    expect(characterMotorStateSignature(first.state)).toBe(
      characterMotorStateSignature(replay.state)
    );
    expect(first.diagnostics).toEqual(
      expect.objectContaining({ tick: 1, sequence: 4, grounded: true, commandCount: 0 })
    );
    expect(input.state).toEqual(createCharacterMotorState({ grounded: true }));
  });
});

function run(options: {
  state: CharacterMotorState;
  intent: CharacterControlIntent;
  observation?: CharacterMotorObservation;
  body?: PhysicsBodyState;
  deltaMs?: number;
}) {
  return stepCharacterMotor({
    tick: 1,
    deltaMs: options.deltaMs ?? 16,
    definition,
    state: options.state,
    intent: options.intent,
    body: options.body ?? body(),
    observation: options.observation
  });
}

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

function body(linearVelocity = { x: 0, y: 0, z: 0 }): PhysicsBodyState {
  return {
    id: "actor",
    kind: "dynamic",
    position: { x: 0, y: 2, z: 0 },
    linearVelocity,
    sleeping: false
  };
}

function ground(
  overrides: Partial<NonNullable<CharacterMotorObservation["ground"]>> = {}
): CharacterMotorObservation {
  return {
    ground: {
      distance: 0.05,
      normal: { x: 0, y: 1, z: 0 },
      ...overrides
    },
    queryCount: 1,
    rejectedQueryCount: 0
  };
}

function document(data: CharacterMotorDefinition): DataDocument<CharacterMotorDefinition> {
  return {
    type: "character.motor",
    id: data.id,
    data,
    priority: 0,
    tags: []
  };
}
