import {
  createMemoryPhysicsBackend,
  createPhysicsPredictionIsland,
  type PhysicsPredictionIslandMemberDefinition
} from "@gamekits/physics-core";
import { describe, expect, it } from "vitest";
import {
  characterMotorStateSignature,
  compileCharacterMotorDefinition,
  createCharacterMotorPredictionContributor
} from "@gamekits/character-controller";

const ACTOR: PhysicsPredictionIslandMemberDefinition = {
  id: "actor",
  body: {
    id: "actor.body",
    kind: "dynamic",
    position: { x: 0, y: 1, z: 0 },
    linearVelocity: { x: 0, y: 0, z: 0 },
    gravityScale: 0
  }
};

const definition = compileCharacterMotorDefinition({
  id: "prediction.default",
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
  minimumDiveAirTimeMs: 0,
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

describe("character motor prediction contributor", () => {
  it("replays late control with Physics at the same tick and releases retained state", () => {
    const predicted = createHarness();
    predicted.island.queue(control(1, 1, 1, 0));
    predicted.island.queue(control(3, 3, 3, 1));
    predicted.island.advanceTo(4);
    expect(predicted.island.queue(control(2, 2, 2, 0)).status).toBe("replayed");

    const reference = createHarness();
    reference.island.queue(control(1, 1, 1, 0));
    reference.island.queue(control(2, 2, 2, 0));
    reference.island.queue(control(3, 3, 3, 1));
    reference.island.advanceTo(4);

    expect(predicted.island.body("actor")).toEqual(reference.island.body("actor"));
    expect(characterMotorStateSignature(predicted.contributor.state("actor")!)).toBe(
      characterMotorStateSignature(reference.contributor.state("actor")!)
    );
    expect(predicted.contributor.diagnostics()).toMatchObject({
      members: 1,
      appliedControls: 4,
      replayedControls: 2,
      rejectedCommands: 0
    });
    expect(predicted.island.diagnostics()).toMatchObject({
      auxiliaryFailures: 0,
      auxiliaryCommandsApplied: 4
    });

    predicted.island.reset("round-2", 0);
    expect(predicted.contributor.state("actor")).toBeUndefined();
    predicted.island.dispose();
    expect(predicted.contributor.diagnostics()).toMatchObject({ disposed: true, members: 0 });
    reference.island.dispose();
  });

  it("restores authority motor timers independently of identical body state", () => {
    const owner = createHarness();
    owner.island.queue(control(1, 1, 1, 0, true));
    owner.island.advanceTo(2);

    const authority = createHarness();
    authority.island.queue(control(1, 1, 1, 0, false, true));
    authority.island.advanceTo(2);
    const frame = authority.island.state();

    expect(owner.island.reconcile(frame).status).toBe("corrected");
    expect(characterMotorStateSignature(owner.contributor.state("actor")!)).toBe(
      characterMotorStateSignature(authority.contributor.state("actor")!)
    );
    expect(owner.contributor.diagnostics().reconciliations).toBe(1);
    owner.island.dispose();
    authority.island.dispose();
  });
});

function createHarness() {
  const contributor = createCharacterMotorPredictionContributor({
    resolveDefinition: () => definition,
    observe: () => ({
      ground: { distance: 0.05, normal: { x: 0, y: 1, z: 0 } },
      queryCount: 1,
      rejectedQueryCount: 0
    })
  });
  const island = createPhysicsPredictionIsland({
    backend: createMemoryPhysicsBackend(),
    generation: "round-1",
    scene: { dimension: "3d", gravity: { x: 0, y: 0, z: 0 } },
    fixedDeltaMs: 16,
    initialMembers: [ACTOR],
    auxiliaryContributors: [contributor],
    maxHistoryTicks: 16
  });
  return { contributor, island };
}

function control(
  tick: number,
  sequence: number,
  intentSequence: number,
  moveX: number,
  jumpPressed = false,
  divePressed = false
) {
  return {
    type: "auxiliary" as const,
    tick,
    sequence,
    contributorId: "character.motor",
    payload: {
      type: "control" as const,
      memberId: "actor",
      intent: {
        sequence: intentSequence,
        move: { x: moveX, y: 0, z: 0 },
        jumpPressed,
        jumpHeld: jumpPressed,
        divePressed
      }
    }
  };
}
