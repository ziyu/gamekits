import { createEventBus } from "@gamekits/event-bus";
import type {
  MultiplayerAuthorityBinding,
  MultiplayerBridgeInstallContext,
  MultiplayerRuntime
} from "@gamekits/multiplayer-core";
import {
  createMemoryPhysicsBackend,
  createPhysicsPredictionIsland,
  type PhysicsPredictionIslandMemberDefinition,
  type PhysicsPredictionIslandMemberState
} from "@gamekits/physics-core";
import { describe, expect, it } from "vitest";
import {
  createStandardMultiplayerPhysicsArenaAuthorityProjection,
  createStandardMultiplayerPhysicsArenaPrediction,
  createStandardMultiplayerPhysicsPredictionDomain,
  type StandardMultiplayerPhysicsArenaClientFrame
} from "../src";

const PLAYER: PhysicsPredictionIslandMemberDefinition = {
  id: "player-1",
  body: {
    id: "player-1.body",
    kind: "dynamic",
    position: { x: 0, y: 0 },
    linearVelocity: { x: 0, y: 0 },
    gravityScale: 0
  },
  colliders: [{ id: "player-1.collider", shape: { type: "circle", radius: 0.5 } }]
};

const PROP: PhysicsPredictionIslandMemberDefinition = {
  id: "prop-1",
  body: {
    id: "prop-1.body",
    kind: "dynamic",
    position: { x: 2, y: 0 },
    linearVelocity: { x: 0, y: 0 },
    gravityScale: 0
  }
};

const PREDICTED_PROP: PhysicsPredictionIslandMemberDefinition = {
  ...structuredClone(PROP),
  id: "prop-predicted",
  body: { ...structuredClone(PROP.body), id: "prop-predicted.body" }
};

const REJECTED_PROP: PhysicsPredictionIslandMemberDefinition = {
  ...structuredClone(PROP),
  id: "prop-rejected",
  body: { ...structuredClone(PROP.body), id: "prop-rejected.body" }
};

describe("standard multiplayer Physics Arena prediction", () => {
  it("installs a complete baseline, advances mapped input, and rebuilds on membership revision", () => {
    const definitions = new Map([
      [PLAYER.id, PLAYER],
      [PROP.id, PROP],
      [PREDICTED_PROP.id, PREDICTED_PROP],
      [REJECTED_PROP.id, REJECTED_PROP]
    ]);
    const arena = createStandardMultiplayerPhysicsArenaPrediction<
      MultiplayerBridgeInstallContext,
      StandardMultiplayerPhysicsArenaClientFrame,
      { moveX: number }
    >({
      id: "test.arena",
      island: {
        backend: createMemoryPhysicsBackend(),
        scene: { gravity: { x: 0, y: 0 } },
        fixedDeltaMs: 16,
        maxHistoryTicks: 16,
        maxReplayTicksPerOperation: 8
      },
      selectFrame: ({ snapshot }) => snapshot,
      resolveMemberDefinition: (member) => definitions.get(member.id),
      resolveAuthoritySpawn: (member) => ({
        correlationId: member.id === PREDICTED_PROP.id ? "throw-1" : member.id
      }),
      mapInput({ input }) {
        return [
          {
            type: "patch",
            memberId: PLAYER.id,
            patch: { linearVelocity: { x: input.moveX, y: 0 } }
          }
        ];
      }
    });
    const runtime = arena.descriptor.create({
      installContext: installContext(),
      runtime: {} as MultiplayerRuntime,
      binding: BINDING
    });
    let frame = authorityFrame(0, 0, 1, [memberState(PLAYER)]);
    runtime.applyAuthoritative?.(authorityContext(frame));
    expect(arena.diagnostics()).toMatchObject({
      status: "active",
      baselineInstalls: 1,
      lastBaselineResult: { status: "corrected", correctedMembers: 1 },
      authorityTick: 0,
      island: { members: 1, tick: 0 }
    });

    expect(
      arena.registerPredictedMember({
        correlationId: "throw-1",
        tick: 1,
        member: PREDICTED_PROP
      })
    ).toEqual({ status: "registered", memberId: PREDICTED_PROP.id });
    expect(
      arena.registerPredictedMember({
        correlationId: "throw-1",
        tick: 1,
        member: PREDICTED_PROP
      })
    ).toEqual({ status: "duplicate", memberId: PREDICTED_PROP.id });

    runtime.applyInput?.({
      installContext: installContext(),
      runtime: {} as MultiplayerRuntime,
      binding: BINDING,
      snapshot: frame,
      frame: { delta: 16, elapsed: 16, tick: 1 },
      input: { moveX: 2 },
      predictionFrame: {
        sequence: 1,
        tick: 1,
        timestamp: 16,
        input: { moveX: 2 }
      },
      encodedInput: { sequence: 1, moveX: 2 }
    });
    expect(arena.state()).toMatchObject({
      tick: 1,
      members: [{ id: PLAYER.id }, { id: PREDICTED_PROP.id }]
    });
    expect(arena.body(PLAYER.id)?.position.x).toBeGreaterThan(0);

    frame = authorityFrame(1, 1, 1, [
      { ...memberState(PLAYER), body: { ...memberState(PLAYER).body, position: { x: 0.5, y: 0 } } },
      memberState(PREDICTED_PROP)
    ]);
    runtime.applyAuthoritative?.(authorityContext(frame));
    expect(arena.body(PLAYER.id)?.position.x).toBeCloseTo(0.5);
    expect(arena.diagnostics()).toMatchObject({
      reconciliations: 1,
      predictedMemberRegistrations: 1,
      predictedMemberRegistrationFailures: 0,
      lastReconciliation: {
        reconciliation: { status: "corrected" }
      }
    });
    expect(
      arena
        .diagnostics()
        .lastReconciliation?.lifecycle.matches.some(
          ({ match }) =>
            match.status === "matched" && match.authority?.authorityId === PREDICTED_PROP.id
        )
    ).toBe(true);

    expect(
      arena.registerPredictedMember({
        correlationId: "throw-rejected",
        tick: 2,
        member: REJECTED_PROP
      })
    ).toMatchObject({ status: "registered" });
    runtime.applyInput?.({
      installContext: installContext(),
      runtime: {} as MultiplayerRuntime,
      binding: BINDING,
      snapshot: frame,
      frame: { delta: 16, elapsed: 32, tick: 2 },
      input: { moveX: 0 },
      predictionFrame: { sequence: 2, tick: 2, timestamp: 32, input: { moveX: 0 } },
      encodedInput: { sequence: 2, moveX: 0 }
    });
    expect(arena.body(REJECTED_PROP.id)).toBeDefined();
    frame = authorityFrame(2, 2, 1, [memberState(PLAYER), memberState(PREDICTED_PROP)]);
    runtime.applyAuthoritative?.(authorityContext(frame));
    expect(arena.body(REJECTED_PROP.id)).toBeUndefined();
    expect(arena.diagnostics().lastReconciliation).toMatchObject({
      reconciliation: { status: "membership-mismatch" },
      hardCorrection: { status: "corrected" }
    });

    frame = authorityFrame(3, 2, 2, [memberState(PLAYER), memberState(PROP)]);
    runtime.applyAuthoritative?.(authorityContext(frame));
    expect(arena.state()).toMatchObject({
      tick: 3,
      members: [{ id: PLAYER.id }, { id: PROP.id }]
    });
    expect(arena.diagnostics()).toMatchObject({
      baselineInstalls: 2,
      membershipRevision: 2,
      island: { members: 2 }
    });
    runtime.dispose();
    expect(arena.diagnostics()).toMatchObject({ status: "disposed" });
  });

  it("hard-corrects when replay work exceeds the island budget", () => {
    const island = createPhysicsPredictionIsland({
      backend: createMemoryPhysicsBackend(),
      generation: 1,
      initialMembers: [PLAYER],
      maxHistoryTicks: 16,
      maxReplayTicksPerOperation: 2
    });
    island.advanceTo(6);
    const authority = createPhysicsPredictionIsland({
      backend: createMemoryPhysicsBackend(),
      generation: 1,
      initialMembers: [PLAYER]
    });
    authority.advanceTo(3);
    const domain = createStandardMultiplayerPhysicsPredictionDomain({
      kind: "arena-member",
      generation: 1,
      stepMs: 16,
      island,
      resolveAuthoritySpawn: (member: PhysicsPredictionIslandMemberState) => ({
        correlationId: member.id
      }),
      resolveMemberDefinition: () => PLAYER
    });
    expect(domain.reconcile(authority.state())).toMatchObject({
      reconciliation: { status: "replay-budget" },
      hardCorrection: { status: "corrected" }
    });
    expect(island.tick()).toBe(3);
    domain.dispose();
    authority.dispose();
  });

  it("projects sorted authority members without leaking user data and enforces payload budgets", () => {
    const projection = createStandardMultiplayerPhysicsArenaAuthorityProjection({
      maxMembers: 2,
      maxPayloadBytes: 4_096
    });
    const player = memberState(PLAYER);
    player.body.userData = { secret: "do-not-replicate" };
    const result = projection.capture({
      islandId: "arena",
      generation: "round-1",
      tick: 5,
      membershipRevision: 1,
      definitionVersion: "v1",
      members: [memberState(PROP), player]
    });
    expect(result).toMatchObject({
      status: "captured",
      frame: { members: [{ id: PLAYER.id }, { id: PROP.id }] }
    });
    if (result.status !== "captured") {
      throw new Error("Expected authority projection");
    }
    expect(result.frame.members[0]?.body).not.toHaveProperty("userData");

    const tiny = createStandardMultiplayerPhysicsArenaAuthorityProjection({
      maxPayloadBytes: 10
    });
    expect(
      tiny.capture({
        islandId: "arena",
        generation: 1,
        tick: 0,
        membershipRevision: 0,
        definitionVersion: "v1",
        members: [memberState(PLAYER)]
      }).status
    ).toBe("payload-budget");
  });
});

const BINDING: MultiplayerAuthorityBinding = {
  sessionId: "session-1",
  mode: "server-authoritative",
  status: "bound",
  authorityPeerId: "server",
  authorityEndpoint: { kind: "server", id: "server", peerId: "server" }
};

function authorityFrame(
  tick: number,
  acknowledgedInputSequence: number,
  membershipRevision: number,
  members: PhysicsPredictionIslandMemberState[]
): StandardMultiplayerPhysicsArenaClientFrame {
  return {
    islandId: "arena",
    generation: "round-1",
    tick,
    membershipRevision,
    definitionVersion: "v1",
    acknowledgedInputSequence,
    members
  };
}

function memberState(definition: PhysicsPredictionIslandMemberDefinition) {
  return {
    id: definition.id,
    body: {
      id: definition.body.id,
      kind: definition.body.kind,
      position: structuredClone(definition.body.position ?? { x: 0, y: 0 }),
      linearVelocity: structuredClone(definition.body.linearVelocity ?? { x: 0, y: 0 }),
      sleeping: false
    }
  } satisfies PhysicsPredictionIslandMemberState;
}

function authorityContext(snapshot: StandardMultiplayerPhysicsArenaClientFrame) {
  return {
    installContext: installContext(),
    runtime: {} as MultiplayerRuntime,
    binding: BINDING,
    message: {
      id: `snapshot-${snapshot.tick}`,
      sessionId: BINDING.sessionId,
      channel: "reliable",
      kind: "game.snapshot",
      sourcePeerId: "server",
      timestamp: snapshot.tick * 16,
      payload: snapshot
    },
    snapshot
  };
}

function installContext(): MultiplayerBridgeInstallContext {
  return { eventBus: createEventBus(), systems: { register() {} } };
}
