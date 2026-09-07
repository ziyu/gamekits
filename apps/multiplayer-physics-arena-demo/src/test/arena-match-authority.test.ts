import { createMemoryMultiplayerBackend } from "@gamekits/multiplayer-memory";
import { createMultiplayerRuntime } from "@gamekits/multiplayer-core";
import { createMemoryPhysicsBackend } from "@gamekits/physics-core";
import { describe, expect, it } from "vitest";

import { prepareArenaBotNavigationRuntime } from "../ai/navigation";
import { ARENA_COMPILED_CONTENT } from "../content/default-content";
import { createArenaAuthorityRuntime } from "../server/arena-authority";
import { arenaPlayerMemberId } from "../shared/config";

describe("Knockout Arena multi-stage authority", () => {
  // Full AI-driven rounds exceed 30s on shared CI runners; performance has separate budgets.
  it("keeps eliminated actors out of later generations and publishes all stage results", async () => {
    const fixture = await createAuthorityFixture("arena-stage-authority", true);
    try {
      advanceUntil(fixture.authority, (snapshot) => snapshot.phase === "running", 240);
      const qualifier = fixture.authority.latestSnapshot();
      expect(qualifier.match).toMatchObject({
        stageIndex: 0,
        stageCount: 3,
        stageKind: "qualifier"
      });
      expect(qualifier).not.toHaveProperty("effects");
      expect(qualifier.qualifierProgress).toHaveLength(8);
      expect(qualifier.qualifierProgress).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            checkpointCount: 0,
            checkpointTotal: 7,
            finished: false,
            normalizedProgress: 0
          })
        ])
      );

      advanceUntil(fixture.authority, (snapshot) => snapshot.stageResults.length === 1, 5_500);
      const qualifierResult = fixture.authority.latestSnapshot();
      expect(actorIds(qualifierResult)).toHaveLength(0);
      expect(qualifierResult.stageResults[0]).toMatchObject({
        stageKind: "qualifier",
        qualifiedParticipantIds: expect.arrayContaining([expect.any(String), expect.any(String)])
      });
      expect(qualifierResult.stageResults[0]?.qualifiedParticipantIds).toHaveLength(6);
      expect(qualifierResult.stageResults[0]?.eliminatedParticipantIds).toHaveLength(2);

      advanceUntil(
        fixture.authority,
        (snapshot) => snapshot.match.stageIndex === 1 && snapshot.phase === "countdown",
        360
      );
      const brawlBaseline = fixture.authority.latestSnapshot();
      expect(brawlBaseline.frame.generation).not.toBe(qualifier.frame.generation);
      expect(actorIds(brawlBaseline)).toHaveLength(6);
      expect(brawlBaseline.frame.members.map(({ id }) => id)).toContain("scrap.outer-conveyor");
      expect(brawlBaseline.frame.members.map(({ id }) => id)).not.toContain("circuit.piston-gate");
      expect(
        brawlBaseline.participants.filter((participant) => participant.status === "spectator")
      ).toHaveLength(2);

      advanceUntil(
        fixture.authority,
        (snapshot) => snapshot.match.stageIndex === 1 && snapshot.phase === "running",
        240
      );
      advanceUntil(fixture.authority, (snapshot) => snapshot.stageResults.length === 2, 5_500);
      expect(actorIds(fixture.authority.latestSnapshot())).toHaveLength(0);

      advanceUntil(
        fixture.authority,
        (snapshot) => snapshot.match.stageIndex === 2 && snapshot.phase === "running",
        600
      );
      expect(fixture.authority.latestSnapshot().frame.members.map(({ id }) => id)).toContain(
        "crown.shrinking-zone"
      );
      expect(fixture.authority.latestSnapshot().frame.members.map(({ id }) => id)).not.toContain(
        "scrap.outer-conveyor"
      );
      advanceUntil(fixture.authority, (snapshot) => snapshot.stageResults.length === 3, 4_600);
      const finalResult = fixture.authority.latestSnapshot();
      expect(actorIds(finalResult)).toHaveLength(1);
      expect(finalResult.stageResults.map((result) => result.stageKind)).toEqual([
        "qualifier",
        "brawl",
        "final"
      ]);
      expect(finalResult.winnerId).toBe(finalResult.stageResults[2]?.winnerParticipantId);
      expect(
        finalResult.participants.filter((participant) => participant.status === "finished")
      ).toHaveLength(1);
      const ai = fixture.authority.snapshot().ai;
      expect(ai.behavior).toMatchObject({
        movementIntents: expect.any(Number),
        jumpIntents: expect.any(Number),
        actionIntents: expect.any(Number),
        interactionIntents: expect.any(Number),
        goalSelections: expect.any(Number)
      });
      expect(ai.behavior.movementIntents).toBeGreaterThan(0);
      expect(ai.behavior.jumpIntents).toBeGreaterThan(0);
      expect(ai.behavior.actionIntents).toBeGreaterThan(0);
      expect(ai.behavior.interactionIntents).toBeGreaterThan(0);
      expect(Object.keys(ai.behavior.goalSelectionsByGoal)).toEqual(
        expect.arrayContaining([
          expect.stringContaining(".sprinter."),
          expect.stringContaining(".brawler."),
          expect.stringContaining(".opportunist.")
        ])
      );
      expect(fixture.authority.snapshot().navigation).toMatchObject({
        activeStageIndex: 2,
        stageChanges: 2,
        artifacts: 3
      });
      expect(JSON.stringify(finalResult)).not.toContain("goalSelectionsByGoal");

      advanceUntil(
        fixture.authority,
        (snapshot) => snapshot.round === 2 && snapshot.phase === "countdown",
        360
      );
      const rematch = fixture.authority.latestSnapshot();
      expect(rematch).toMatchObject({
        round: 2,
        match: {
          matchId: "match.2",
          stageIndex: 0,
          stageKind: "qualifier",
          membershipRevision: rematch.frame.membershipRevision
        },
        stageResults: [],
        removedMemberIds: []
      });
      expect(rematch.winnerId).toBeUndefined();
      expect(rematch.frame.generation).not.toBe(finalResult.frame.generation);
      expect(actorIds(rematch)).toHaveLength(8);
      expect(
        rematch.participants.filter(
          (participant) => participant.actorMemberId !== undefined && participant.status === "lobby"
        )
      ).toHaveLength(8);

      fixture.authority.dispose();
      expect(fixture.authority.retainedState()).toEqual({
        disposed: true,
        participants: 0,
        physicsMembers: 0,
        physicsHistoryEntries: 0,
        physicsCommands: 0,
        impactEntries: 0,
        impactAttributions: 0,
        inputs: 0,
        inputAcks: 0,
        actorControls: 0,
        rankingFacts: 0,
        stageEntrants: 0,
        stageResults: 0,
        latestSnapshots: 0,
        itemInstances: 0,
        itemCommands: 0,
        itemActions: 0,
        itemExecutions: 0,
        combatHits: 0,
        combatKnockbacks: 0,
        aiAgents: 0,
        aiActiveTasks: 0,
        aiMemoryFacts: 0,
        aiPendingActions: 0,
        navigationPendingRequests: 0,
        navigationRetainedRoutes: 0
      });
      expect(() => fixture.authority.latestSnapshot()).toThrow(
        "Knockout arena authority is disposed"
      );
    } finally {
      await fixture.dispose();
    }
  }, 60_000);

  it("projects late join as next-match spectator and restores a disconnected active peer", async () => {
    const fixture = await createAuthorityFixture("arena-presence-authority");
    const late = createMultiplayerRuntime({
      id: "arena-presence-late",
      backend: fixture.multiplayer,
      connectContext: {
        localPeer: { id: "peer.late", displayName: "Late Bean", role: "client" }
      }
    });
    try {
      advanceUntil(fixture.authority, (snapshot) => snapshot.phase === "running", 240);
      const generation = fixture.authority.latestSnapshot().frame.generation;

      await late.joinSession({
        sessionId: fixture.sessionId,
        localPeer: { id: "peer.late", displayName: "Late Bean", role: "client" }
      });
      fixture.authority.tick();
      expect(
        fixture.authority
          .latestSnapshot()
          .participants.find((participant) => participant.peerId === "peer.late")
      ).toMatchObject({ kind: "spectator", status: "next-match", connected: true });
      expect(fixture.authority.latestSnapshot().playerIdsByPeerId["peer.late"]).toBeUndefined();

      await fixture.client.leaveSession("connection-test");
      fixture.authority.tick();
      expect(
        fixture.authority
          .latestSnapshot()
          .participants.find((participant) => participant.peerId === "peer.primary")
      ).toMatchObject({ status: "disconnected", resumeStatus: "active", connected: false });

      await fixture.client.joinSession({
        sessionId: fixture.sessionId,
        localPeer: { id: "peer.primary", displayName: "Primary Bean", role: "client" }
      });
      fixture.authority.tick();
      expect(
        fixture.authority
          .latestSnapshot()
          .participants.find((participant) => participant.peerId === "peer.primary")
      ).toMatchObject({ status: "active", connected: true });
      expect(fixture.authority.latestSnapshot()).toMatchObject({
        frame: { generation },
        playerIdsByPeerId: { "peer.primary": arenaPlayerMemberId(0) }
      });
    } finally {
      await late.dispose();
      await fixture.dispose();
    }
  });
});

async function createAuthorityFixture(id: string, withNavigation = false) {
  const multiplayer = createMemoryMultiplayerBackend({ id });
  const sessionId = `${id}.session`;
  const authorityPeerId = `${id}.server`;
  const host = createMultiplayerRuntime({
    id: `${id}.host`,
    backend: multiplayer,
    connectContext: {
      localPeer: { id: authorityPeerId, displayName: "Authority", role: "server" }
    }
  });
  const client = createMultiplayerRuntime({
    id: `${id}.client`,
    backend: multiplayer,
    connectContext: {
      localPeer: { id: "peer.primary", displayName: "Primary Bean", role: "client" }
    }
  });
  await host.createSession({
    id: sessionId,
    kind: "private",
    authority: "server-authoritative",
    localPeer: { id: authorityPeerId, displayName: "Authority", role: "server" }
  });
  await client.joinSession({
    sessionId,
    localPeer: { id: "peer.primary", displayName: "Primary Bean", role: "client" }
  });
  const navigation = withNavigation
    ? await prepareArenaBotNavigationRuntime(ARENA_COMPILED_CONTENT)
    : undefined;
  const authority = createArenaAuthorityRuntime({
    runtime: host,
    backend: createZeroGravityMemoryPhysicsBackend(id),
    ...(navigation === undefined ? {} : { navigation }),
    sessionId,
    authorityPeerId,
    now: () => 1_000
  });
  return {
    multiplayer,
    sessionId,
    host,
    client,
    authority,
    async dispose() {
      authority.dispose();
      await client.dispose();
      await host.dispose();
    }
  };
}

function createZeroGravityMemoryPhysicsBackend(id: string) {
  const memory = createMemoryPhysicsBackend({ id: `${id}.physics`, dimension: "3d" });
  return {
    ...memory,
    createScene(config: Parameters<typeof memory.createScene>[0]) {
      return memory.createScene({ ...config, gravity: { x: 0, y: 0, z: 0 } });
    }
  };
}

function advanceUntil(
  authority: ReturnType<typeof createArenaAuthorityRuntime>,
  predicate: (snapshot: ReturnType<typeof authority.latestSnapshot>) => boolean,
  maxTicks: number
): void {
  for (let index = 0; index < maxTicks; index += 1) {
    authority.tick();
    if (predicate(authority.latestSnapshot())) return;
  }
  throw new Error(`Arena authority did not reach the expected state within ${maxTicks} ticks`);
}

function actorIds(
  snapshot: ReturnType<ReturnType<typeof createArenaAuthorityRuntime>["latestSnapshot"]>
) {
  return snapshot.frame.members
    .map((member) => member.id)
    .filter((id) => id.startsWith("player.") || id.startsWith("bot."));
}
