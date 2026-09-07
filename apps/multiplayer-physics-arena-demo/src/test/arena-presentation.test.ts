import type {
  CharacterMotorMode,
  CharacterMotorPredictionCheckpoint,
  CharacterMotorState
} from "@gamekits/character-controller";
import type { PhysicsPredictionIslandStateSnapshot } from "@gamekits/physics-core";
import { describe, expect, it } from "vitest";

import { createArenaPresentationRuntime } from "../client/arena-presentation";
import {
  ARENA_CHARACTER_MOTOR_CONTRIBUTOR_ID,
  ARENA_CHARACTER_MOTOR_DEFINITION
} from "../shared/arena-control";
import {
  ARENA_DEFINITION_VERSION,
  ARENA_FIXED_STEP_MS,
  ARENA_ISLAND_ID,
  ARENA_SCHEMA_VERSION
} from "../shared/config";
import type { ArenaPublicParticipantState, ArenaSnapshot } from "../shared/protocol";

describe("Knockout Circuit presented state", () => {
  it("maps motor, carry, combat, and elimination facts into semantic actor states", () => {
    const runtime = createArenaPresentationRuntime();
    const snapshot = arenaSnapshot(20, [participant("player.0"), participant("bot.0", "bot")]);
    snapshot.items.push({
      id: "item.0",
      definitionId: "item.foam-ball",
      instanceGeneration: 1,
      state: "carried",
      ownerParticipantId: "player.0",
      stateChangedAtTick: 18,
      revision: 1
    });
    snapshot.combat.actors.push({
      participantId: "player.0",
      instability: 0.42,
      staggerUntilTick: 0,
      revision: 1
    });
    const state = predictedState(
      20,
      [actor("player.0", { x: 3.6, y: 0, z: -3.6 }), actor("bot.0", { x: 0, y: -2, z: 0 })],
      [motor("player.0", "grounded"), motor("bot.0", "airborne")]
    );

    runtime.sync({ snapshot, predictedState: state, localMemberId: "player.0", deltaMs: 16 });

    expect(runtime.actor("player.0")).toMatchObject({
      local: true,
      baseState: "run",
      grounded: true,
      carrying: true,
      instability: 0.42
    });
    expect(runtime.snapshot().items).toEqual([
      expect.objectContaining({
        itemId: "item.0",
        definitionId: "item.foam-ball",
        ownerMemberId: "player.0",
        state: "carried"
      })
    ]);
    expect(runtime.actor("bot.0")).toMatchObject({
      local: false,
      baseState: "fall",
      grounded: false
    });

    state.auxiliary = motorCheckpoint([motor("player.0", "staggered"), motor("bot.0", "airborne")]);
    runtime.sync({ snapshot, predictedState: state, localMemberId: "player.0", deltaMs: 16 });
    expect(runtime.actor("player.0")?.baseState).toBe("stagger");

    snapshot.participants[0]!.status = "qualified";
    snapshot.removedMemberIds = ["player.0"];
    runtime.sync({ snapshot, predictedState: state, deltaMs: 16 });
    expect(runtime.actor("player.0")?.baseState).toBe("stagger");

    snapshot.participants[0]!.status = "eliminated";
    snapshot.removedMemberIds = ["player.0"];
    runtime.sync({ snapshot, predictedState: state, deltaMs: 16 });
    expect(runtime.actor("player.0")?.baseState).toBe("eliminated");
    runtime.dispose();
  });

  it("consumes a stable effect identity once across confirmation replay", () => {
    const runtime = createArenaPresentationRuntime();
    const snapshot = arenaSnapshot(12, [participant("player.0")]);
    const state = predictedState(
      12,
      [actor("player.0", { x: 0, y: 0, z: 0 })],
      [motor("player.0", "grounded")]
    );
    const event = {
      effectId: "item-action:peer.0.item.1.use",
      kind: "item-action" as const,
      phase: "confirm" as const,
      tick: 12
    };
    runtime.sync({ snapshot, predictedState: state, localMemberId: "player.0", deltaMs: 16 });
    runtime.effect(event);
    runtime.effect(event);
    runtime.sync({ snapshot, predictedState: state, localMemberId: "player.0", deltaMs: 16 });
    expect(runtime.actor("player.0")?.actionClip).toBe("clip.knockout.item-action");
    expect(runtime.diagnostics().consumedEffectIdentities).toBe(1);

    runtime.sync({ snapshot, predictedState: state, localMemberId: "player.0", deltaMs: 50 });
    runtime.sync({ snapshot, predictedState: state, localMemberId: "player.0", deltaMs: 50 });
    runtime.sync({ snapshot, predictedState: state, localMemberId: "player.0", deltaMs: 50 });
    runtime.sync({ snapshot, predictedState: state, localMemberId: "player.0", deltaMs: 50 });
    runtime.sync({ snapshot, predictedState: state, localMemberId: "player.0", deltaMs: 50 });
    runtime.sync({ snapshot, predictedState: state, localMemberId: "player.0", deltaMs: 50 });
    runtime.sync({ snapshot, predictedState: state, localMemberId: "player.0", deltaMs: 50 });
    runtime.effect(event);
    runtime.sync({ snapshot, predictedState: state, localMemberId: "player.0", deltaMs: 16 });
    expect(runtime.actor("player.0")?.actionClip).toBeUndefined();
    expect(runtime.diagnostics().consumedEffectIdentities).toBe(1);
    runtime.dispose();
  });

  it("seeks a late-joined windup to authority progress without restarting it", () => {
    const runtime = createArenaPresentationRuntime();
    const snapshot = arenaSnapshot(25, [participant("player.0")]);
    snapshot.items.push({
      id: "item.0",
      definitionId: "item.foam-ball",
      instanceGeneration: 1,
      state: "windup",
      ownerParticipantId: "player.0",
      executionId: "execution.item.0",
      stateChangedAtTick: 10,
      deadlineTick: 40,
      revision: 2
    });
    const state = predictedState(
      25,
      [actor("player.0", { x: 0, y: 0, z: 0 })],
      [motor("player.0", "grounded")]
    );

    runtime.sync({ snapshot, predictedState: state, localMemberId: "player.0", deltaMs: 16 });
    expect(runtime.actor("player.0")).toMatchObject({
      actionClip: "clip.knockout.windup",
      carrying: true
    });
    expect(runtime.actor("player.0")?.actionNormalizedTime).toBeCloseTo(0.5, 2);
    expect(runtime.snapshot().items[0]).toMatchObject({
      itemId: "item.0",
      ownerMemberId: "player.0",
      state: "windup",
      normalizedActionTime: 0.5
    });
    expect(runtime.diagnostics().phaseSeeks).toBe(1);

    state.tick = 26;
    runtime.sync({ snapshot, predictedState: state, localMemberId: "player.0", deltaMs: 16 });
    expect(runtime.diagnostics().phaseSeeks).toBe(1);
    expect(runtime.actor("player.0")?.actionNormalizedTime).toBeGreaterThan(0.5);
    runtime.dispose();
  });

  it("resets generations, removes departed controllers, and releases all retained playback", () => {
    const runtime = createArenaPresentationRuntime();
    const snapshot = arenaSnapshot(10, [participant("player.0")]);
    const state = predictedState(
      10,
      [actor("player.0", { x: 0, y: 0, z: 0 })],
      [motor("player.0", "grounded")]
    );
    runtime.sync({ snapshot, predictedState: state, localMemberId: "player.0", deltaMs: 16 });
    expect(runtime.diagnostics()).toMatchObject({ controllers: 1, retainedFrames: 1 });

    state.generation = "m1.s2.r1";
    runtime.sync({ snapshot, predictedState: state, localMemberId: "player.0", deltaMs: 16 });
    expect(runtime.diagnostics()).toMatchObject({ generation: 2, generationResets: 2 });

    snapshot.participants = [];
    runtime.sync({ snapshot, predictedState: state, deltaMs: 16 });
    expect(runtime.diagnostics()).toMatchObject({ controllers: 0, retainedFrames: 0 });
    runtime.dispose();
    expect(runtime.diagnostics()).toMatchObject({
      controllers: 0,
      retainedFrames: 0,
      consumedEffectIdentities: 0,
      disposed: true
    });
  });
});

function participant(
  id: string,
  kind: ArenaPublicParticipantState["kind"] = "human-slot"
): ArenaPublicParticipantState {
  return {
    id,
    kind,
    slot: id === "player.0" ? 0 : 1,
    actorMemberId: id,
    ...(kind === "human-slot" ? { peerId: "peer.0", connected: true } : { connected: false }),
    status: "active",
    stageInstanceId: "match.1:stage.circuit-forge:1",
    revision: 1
  };
}

function actor(
  id: string,
  linearVelocity: { x: number; y: number; z: number }
): PhysicsPredictionIslandStateSnapshot["members"][number] {
  return {
    id,
    body: {
      id,
      kind: "dynamic",
      position: { x: 0, y: 1.2, z: 0 },
      linearVelocity,
      sleeping: false
    }
  };
}

function motor(
  memberId: string,
  mode: CharacterMotorMode
): { memberId: string; state: CharacterMotorState } {
  const grounded = mode === "grounded" || mode === "recovering";
  return {
    memberId,
    state: {
      mode,
      grounded,
      groundNormal: { x: 0, y: 1, z: 0 },
      inheritedPlatformVelocity: { x: 0, y: 0, z: 0 },
      facingYaw: memberId === "player.0" ? Math.PI / 3 : 0,
      coyoteRemainingMs: 0,
      jumpBufferRemainingMs: 0,
      jumpHoldRemainingMs: 0,
      diveRemainingMs: mode === "diving" ? ARENA_CHARACTER_MOTOR_DEFINITION.diveDurationMs : 0,
      diveCooldownRemainingMs: 0,
      recoveryRemainingMs:
        mode === "recovering" ? ARENA_CHARACTER_MOTOR_DEFINITION.recoveryDurationMs : 0,
      staggerRemainingMs: mode === "staggered" ? 250 : 0,
      airborneTimeMs: grounded ? 0 : ARENA_FIXED_STEP_MS * 4,
      lastConsumedJumpSequence: 0,
      lastConsumedDiveSequence: 0,
      lastStableTick: 0
    }
  };
}

function predictedState(
  tick: number,
  members: PhysicsPredictionIslandStateSnapshot["members"],
  motors: CharacterMotorPredictionCheckpoint["members"]
): PhysicsPredictionIslandStateSnapshot {
  return {
    generation: "m1.s1.r1",
    tick,
    members,
    auxiliary: motorCheckpoint(motors)
  };
}

function motorCheckpoint(
  members: CharacterMotorPredictionCheckpoint["members"]
): PhysicsPredictionIslandStateSnapshot["auxiliary"] {
  return [
    {
      id: ARENA_CHARACTER_MOTOR_CONTRIBUTOR_ID,
      version: ARENA_CHARACTER_MOTOR_DEFINITION.version,
      state: { version: 1, members } satisfies CharacterMotorPredictionCheckpoint
    }
  ];
}

function arenaSnapshot(tick: number, participants: ArenaPublicParticipantState[]): ArenaSnapshot {
  return {
    schemaVersion: ARENA_SCHEMA_VERSION,
    phase: "running",
    round: 1,
    countdownMs: 0,
    roundTimeMs: tick * ARENA_FIXED_STEP_MS,
    match: {
      matchId: "match.1",
      phaseInstanceId: "match.1.phase.running",
      stageIndex: 0,
      stageCount: 3,
      stageId: "stage.circuit-forge",
      stageKind: "qualifier",
      qualificationCount: 6,
      durationTicks: 5_400,
      stageInstanceId: "match.1:stage.circuit-forge:1",
      startedAtTick: 0,
      stageStartedAtTick: 0,
      physicsStageStartedAtTick: 0,
      membershipRevision: 1
    },
    participants,
    qualifierProgress: [],
    stageResults: [],
    items: [],
    itemActions: [],
    combat: { actors: [], hits: [] },
    frame: {
      islandId: ARENA_ISLAND_ID,
      generation: "m1.s1.r1",
      tick,
      membershipRevision: 1,
      definitionVersion: ARENA_DEFINITION_VERSION,
      members: []
    },
    playerIdsByPeerId: { "peer.0": "player.0" },
    inputAcksByPeerId: { "peer.0": tick },
    actorControlsByMemberId: {},
    removedMemberIds: [],
    serverTime: tick * ARENA_FIXED_STEP_MS,
    authority: {
      receivedInputBundles: 0,
      acceptedInputs: 0,
      rejectedInputs: 0,
      queuedInputs: 0,
      payloadBytes: 0,
      activePeers: 1
    }
  };
}
