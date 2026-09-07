import { createMemoryAudioBackend } from "@gamekits/audio-core/testing";
import type { PhysicsPredictionIslandStateSnapshot } from "@gamekits/physics-core";
import { describe, expect, it } from "vitest";

import { createArenaGameAudio, ARENA_AUDIO_IDS } from "../client/arena-audio-content";
import { createArenaFeedbackRuntime } from "../client/arena-feedback";
import { ARENA_COMPILED_CONTENT } from "../content/default-content";
import { sampleArenaStageHazards } from "../shared/arena-stage-course";
import {
  ARENA_DEFINITION_VERSION,
  ARENA_FIXED_STEP_MS,
  ARENA_ISLAND_ID,
  ARENA_SCHEMA_VERSION
} from "../shared/config";
import type { ArenaSnapshot } from "../shared/protocol";

describe("Knockout Circuit feedback presentation", () => {
  it("bounds audio, publishes hazard telegraph, and follows an active spectator target", async () => {
    const backend = createMemoryAudioBackend({ unlocked: true, maxRetainedCommands: 128 });
    const audio = createArenaGameAudio(backend);
    const feedback = createArenaFeedbackRuntime(audio);
    expect(await feedback.unlock()).toBe(true);

    const stage = ARENA_COMPILED_CONTENT.stages[0]!;
    const schedule = stage.courseProjection.hazardSchedules.find(
      (candidate) => candidate.activeTicks < candidate.periodTicks
    )!;
    const warningTick = findPhaseTick("warning");
    const snapshot = arenaSnapshot(warningTick);
    const predictedState: PhysicsPredictionIslandStateSnapshot = {
      generation: snapshot.frame.generation,
      tick: warningTick,
      members: [
        body("player.0", -2, 1, 3),
        body("bot.0", 2, 1, 1),
        body("bot.1", 3, 1, 2),
        body(schedule.memberId, schedule.origin.x, schedule.origin.y, schedule.origin.z ?? 0)
      ]
    };
    const presentation = {
      generation: 1,
      items: [],
      actors: [
        presented("player.0", "player.0", false),
        presented("bot.0", "bot.0", false),
        presented("bot.1", "bot.1", false)
      ]
    };

    feedback.sync({
      snapshot,
      predictedState,
      presentation,
      localMemberId: "player.0",
      deltaMs: ARENA_FIXED_STEP_MS
    });

    expect(feedback.snapshot()).toMatchObject({
      camera: { mode: "spectator", targetMemberId: "bot.0" },
      hazards: expect.arrayContaining([
        expect.objectContaining({ memberId: schedule.memberId, phase: "warning" })
      ])
    });
    expect(backend.instances().map((entry) => entry.instance.sourceId)).toEqual(
      expect.arrayContaining([
        ARENA_AUDIO_IDS.musicRunning,
        ARENA_AUDIO_IDS.stage,
        ARENA_AUDIO_IDS.hazardWarning
      ])
    );
    const hazardTransitions = feedback.diagnostics().hazardTransitions;
    feedback.sync({
      snapshot,
      predictedState,
      presentation,
      deltaMs: ARENA_FIXED_STEP_MS
    });
    expect(feedback.diagnostics().hazardTransitions).toBe(hazardTransitions);
    expect(feedback.diagnostics().trackedEmitters).toBe(4);

    feedback.cycleSpectatorTarget(1);
    feedback.sync({
      snapshot,
      predictedState,
      presentation,
      localMemberId: "player.0",
      deltaMs: ARENA_FIXED_STEP_MS
    });
    expect(feedback.snapshot().camera).toEqual({
      mode: "spectator",
      targetMemberId: "bot.1"
    });

    snapshot.phase = "countdown";
    snapshot.participants[0]!.status = "lobby";
    feedback.sync({
      snapshot,
      predictedState,
      presentation,
      localMemberId: "player.0",
      deltaMs: ARENA_FIXED_STEP_MS
    });
    expect(feedback.snapshot().camera).toEqual({
      mode: "playing",
      targetMemberId: "player.0"
    });

    const effect = {
      effectId: "item-hit:item.foam-ball:bot.0:12",
      kind: "item-hit" as const,
      phase: "confirm" as const,
      tick: 12
    };
    feedback.effect(effect);
    feedback.effect(effect);
    expect(feedback.diagnostics().effectSounds).toBe(1);
    expect(audio.sfx.snapshot().deduplicated).toBe(1);

    feedback.dispose();
    audio.dispose();
    expect(backend.snapshot()).toMatchObject({
      activePlaybackInstances: 0,
      disposed: true
    });

    function findPhaseTick(phase: "warning" | "active"): number {
      for (let tick = 0; tick <= schedule.periodTicks * 2; tick += 1) {
        const sample = sampleArenaStageHazards({ stageIndex: 0, tick, stageStartedAtTick: 0 }).find(
          (candidate) => candidate.memberId === schedule.memberId
        );
        if (sample?.phase === phase) return tick;
      }
      throw new Error(`Missing ${phase} phase for ${schedule.memberId}`);
    }
  });
});

function presented(memberId: string, participantId: string, local: boolean) {
  return {
    memberId,
    participantId,
    generation: 1,
    tick: 1,
    local,
    horizontalSpeed: 0,
    normalizedSpeed: 0,
    verticalVelocity: 0,
    facingYaw: 0,
    instability: 0,
    grounded: true,
    carrying: false,
    baseState: "idle" as const
  };
}

function body(id: string, x: number, y: number, z: number) {
  return {
    id,
    body: {
      id,
      kind: "dynamic" as const,
      position: { x, y, z },
      linearVelocity: { x: 0, y: 0, z: 0 },
      sleeping: false
    }
  };
}

function arenaSnapshot(tick: number): ArenaSnapshot {
  return {
    schemaVersion: ARENA_SCHEMA_VERSION,
    phase: "running",
    round: 1,
    countdownMs: 0,
    roundTimeMs: tick * ARENA_FIXED_STEP_MS,
    match: {
      matchId: "match.1",
      phaseInstanceId: "match.1.running",
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
    participants: [
      {
        id: "player.0",
        kind: "human-slot",
        slot: 0,
        actorMemberId: "player.0",
        peerId: "peer.0",
        connected: true,
        status: "eliminated",
        stageInstanceId: "match.1:stage.circuit-forge:1",
        revision: 2
      },
      {
        id: "bot.0",
        kind: "bot",
        slot: 1,
        actorMemberId: "bot.0",
        connected: false,
        status: "active",
        stageInstanceId: "match.1:stage.circuit-forge:1",
        revision: 1
      },
      {
        id: "bot.1",
        kind: "bot",
        slot: 2,
        actorMemberId: "bot.1",
        connected: false,
        status: "active",
        stageInstanceId: "match.1:stage.circuit-forge:1",
        revision: 1
      }
    ],
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
    removedMemberIds: ["player.0"],
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
