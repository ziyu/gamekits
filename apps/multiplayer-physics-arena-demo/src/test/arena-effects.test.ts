import type { PhysicsPredictionIslandContact } from "@gamekits/physics-core";
import { describe, expect, it } from "vitest";

import { createArenaClientEffectController } from "../client/arena-effects";
import { ARENA_DEFINITION_VERSION, ARENA_ISLAND_ID, ARENA_SCHEMA_VERSION } from "../shared/config";
import type { ArenaSnapshot } from "../shared/protocol";

describe("Knockout Arena speculative effects", () => {
  it("ignores ordinary physics contacts while settling semantic jump feedback", () => {
    const presented: string[] = [];
    const effects = createArenaClientEffectController(1, (event) => {
      presented.push(`${event.kind}:${event.phase}`);
    });
    effects.anticipateJump({ memberId: "player.0", inputSequence: 7, predictionTick: 10 });
    effects.anticipateJump({ memberId: "player.0", inputSequence: 7, predictionTick: 10 });
    const contact = groundContact(20);
    const current = snapshot(24, 1, 7);
    effects.anticipateItemContacts([contact, contact], current, "peer.0");
    effects.reconcile(current, "peer.0");

    expect(effects.diagnostics()).toMatchObject({
      presentation: { anticipated: 1, confirmed: 1, cancelled: 0 },
      journal: { duplicates: 1, pending: 0, confirmed: 1 }
    });
    expect(presented).toEqual(["jump:anticipate", "jump:confirm"]);
    effects.dispose();
  });

  it("cancels unresolved anticipation on generation reset and expiry", () => {
    const effects = createArenaClientEffectController();
    effects.anticipateJump({ memberId: "player.0", inputSequence: 10, predictionTick: 10 });
    effects.reconcile(snapshot(20, 2, 0), "peer.0");
    effects.anticipateJump({ memberId: "player.0", inputSequence: 20, predictionTick: 21 });
    effects.reconcile(snapshot(70, 2, 0), "peer.0");

    expect(effects.diagnostics()).toMatchObject({
      presentation: { cancelled: 2 },
      journal: {
        generation: "m2.s1.r2",
        resets: 1,
        expired: 1,
        pending: 0
      }
    });
    effects.dispose();
  });

  it("settles item actions and predicted hits once across duplicate and gapped snapshots", () => {
    const presented: string[] = [];
    const effects = createArenaClientEffectController(1, (event) => {
      presented.push(`${event.kind}:${event.phase}`);
    });
    const pending = itemSnapshot(30);
    effects.anticipateItemAction({ commandId: "peer.0.item.1.use", itemId: "item.0", tick: 30 });
    const contact = itemContact(38);
    effects.anticipateItemContacts([contact, contact], pending, "peer.0");

    effects.reconcile(pending, "peer.0");
    effects.reconcile(pending, "peer.0");
    const settled = itemSnapshot(50, true);
    effects.reconcile(settled, "peer.0");
    effects.reconcile(settled, "peer.0");
    effects.anticipateItemAction({ commandId: "peer.0.item.1.use", itemId: "item.0", tick: 30 });
    effects.anticipateItemContacts([contact], pending, "peer.0");

    expect(presented).toEqual([
      "item-action:anticipate",
      "item-hit:anticipate",
      "item-action:confirm",
      "item-hit:confirm"
    ]);
    expect(effects.diagnostics()).toMatchObject({
      presentation: { anticipated: 2, confirmed: 2, cancelled: 0 },
      journal: { pending: 0, duplicates: 3, confirmed: 2 }
    });
    effects.dispose();
  });
});

function groundContact(tick: number): PhysicsPredictionIslandContact {
  return {
    phase: "enter",
    kind: "contact",
    colliderA: "player.0.collider",
    colliderB: "circuit.floor.collider",
    bodyA: "player.0",
    bodyB: "circuit.floor",
    sensor: false,
    tick
  };
}

function itemContact(tick: number): PhysicsPredictionIslandContact {
  return {
    phase: "enter",
    kind: "contact",
    colliderA: "item.0.body.g2.collider",
    colliderB: "bot.0.collider",
    bodyA: "item.0.body.g2",
    bodyB: "bot.0",
    sensor: false,
    tick
  };
}

function itemSnapshot(tick: number, settled = false): ArenaSnapshot {
  const value = snapshot(tick, 1, 9);
  value.participants.push({
    id: "bot.0",
    kind: "bot",
    slot: 1,
    actorMemberId: "bot.0",
    connected: false,
    status: "active",
    stageInstanceId: value.match.stageInstanceId,
    revision: 1
  });
  value.items = [
    {
      id: "item.0",
      definitionId: "item.foam-ball",
      instanceGeneration: settled ? 2 : 1,
      state: settled ? "released" : "windup",
      ownerParticipantId: settled ? undefined : "player.0",
      sourceParticipantId: settled ? "player.0" : undefined,
      executionId: "peer.0.item.1.use:execution",
      stateChangedAtTick: settled ? 38 : 30,
      revision: settled ? 3 : 2,
      ...(settled ? { bodyMemberId: "item.0.body.g2" } : {})
    }
  ];
  value.itemActions = [
    {
      id: "peer.0.item.1.use",
      participantId: "player.0",
      type: "use",
      status: settled ? "confirmed" : "windup",
      code: settled ? "action-active" : "action-windup",
      tick: settled ? 38 : 30,
      itemId: "item.0",
      itemGeneration: settled ? 2 : 1,
      executionId: "peer.0.item.1.use:execution"
    }
  ];
  value.combat.hits = settled
    ? [
        {
          id: "hit.1",
          sourceParticipantId: "player.0",
          targetParticipantId: "bot.0",
          itemId: "item.0",
          itemGeneration: 2,
          definitionId: "item.foam-ball",
          tick: 39,
          impulseMagnitude: 8,
          instability: 0.2
        }
      ]
    : [];
  return value;
}

function snapshot(tick: number, round: number, acknowledgedSequence: number): ArenaSnapshot {
  return {
    schemaVersion: ARENA_SCHEMA_VERSION,
    phase: "running",
    round,
    countdownMs: 0,
    roundTimeMs: tick * (1000 / 60),
    match: {
      matchId: `match.${round}`,
      phaseInstanceId: `match.${round}.phase.3`,
      stageIndex: 0,
      stageCount: 3,
      stageId: "stage.circuit-forge",
      stageKind: "qualifier",
      qualificationCount: 6,
      durationTicks: 5_400,
      stageInstanceId: `match.${round}:stage.circuit-forge:1`,
      startedAtTick: tick,
      stageStartedAtTick: tick,
      physicsStageStartedAtTick: tick,
      membershipRevision: round
    },
    participants: [
      {
        id: "player.0",
        kind: "human-slot",
        slot: 0,
        actorMemberId: "player.0",
        peerId: "peer.0",
        connected: true,
        status: "active",
        stageInstanceId: `match.${round}:stage.circuit-forge:1`,
        revision: round
      }
    ],
    qualifierProgress: [],
    stageResults: [],
    items: [],
    itemActions: [],
    combat: { actors: [], hits: [] },
    frame: {
      islandId: ARENA_ISLAND_ID,
      generation: `m${round}.s1.r${round}`,
      tick,
      membershipRevision: round,
      definitionVersion: ARENA_DEFINITION_VERSION,
      members: []
    },
    playerIdsByPeerId: { "peer.0": "player.0" },
    inputAcksByPeerId: { "peer.0": acknowledgedSequence },
    actorControlsByMemberId: {
      "player.0": { sequence: tick, moveX: 0, moveZ: 0, jump: false }
    },
    removedMemberIds: [],
    serverTime: tick * (1000 / 60),
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
