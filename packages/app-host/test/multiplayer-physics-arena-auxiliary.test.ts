import { createEventBus } from "@gamekits/event-bus";
import type {
  MultiplayerAuthorityBinding,
  MultiplayerBridgeInstallContext,
  MultiplayerRuntime
} from "@gamekits/multiplayer-core";
import {
  createMemoryPhysicsBackend,
  type PhysicsPredictionIslandAuxiliaryContributor,
  type PhysicsPredictionIslandMemberDefinition
} from "@gamekits/physics-core";
import { describe, expect, it } from "vitest";
import {
  createStandardMultiplayerPhysicsArenaAuthorityProjection,
  createStandardMultiplayerPhysicsArenaPrediction,
  type StandardMultiplayerPhysicsArenaClientFrame
} from "../src";

const ACTOR: PhysicsPredictionIslandMemberDefinition = {
  id: "actor",
  body: {
    id: "actor.body",
    kind: "dynamic",
    position: { x: 0, y: 0 },
    linearVelocity: { x: 0, y: 0 },
    gravityScale: 0
  }
};

describe("standard multiplayer Physics Arena auxiliary replay", () => {
  it("creates a fresh contributor per baseline and maps typed auxiliary input", () => {
    const contributors: ReturnType<typeof createCounterContributor>[] = [];
    const arena = createStandardMultiplayerPhysicsArenaPrediction<
      MultiplayerBridgeInstallContext,
      StandardMultiplayerPhysicsArenaClientFrame,
      { delta: number }
    >({
      id: "test.auxiliary-arena",
      island: {
        backend: createMemoryPhysicsBackend(),
        fixedDeltaMs: 16,
        maxHistoryTicks: 8
      },
      createAuxiliaryContributors() {
        const contributor = createCounterContributor();
        contributors.push(contributor);
        return [contributor];
      },
      selectFrame: ({ snapshot }) => snapshot,
      resolveMemberDefinition: () => ACTOR,
      mapInput({ input }) {
        return [
          {
            type: "auxiliary",
            contributorId: "test.counter",
            payload: { delta: input.delta }
          }
        ];
      }
    });
    const runtime = arena.descriptor.create({
      installContext: installContext(),
      runtime: {} as MultiplayerRuntime,
      binding: BINDING
    });
    let frame = authorityFrame(0, 1, 0);
    runtime.applyAuthoritative?.(authorityContext(frame));
    runtime.applyInput?.({
      installContext: installContext(),
      runtime: {} as MultiplayerRuntime,
      binding: BINDING,
      snapshot: frame,
      frame: { delta: 16, elapsed: 16, tick: 1 },
      input: { delta: 3 },
      predictionFrame: { sequence: 1, tick: 1, timestamp: 16, input: { delta: 3 } },
      encodedInput: { sequence: 1, delta: 3 }
    });
    expect(contributors).toHaveLength(1);
    expect(contributors[0]?.value()).toBe(3);
    expect(arena.state()?.auxiliary).toEqual([
      { id: "test.counter", version: "1", state: { value: 3 } }
    ]);

    frame = authorityFrame(1, 2, 0);
    runtime.applyAuthoritative?.(authorityContext(frame));
    expect(contributors).toHaveLength(2);
    expect(contributors[0]?.disposed()).toBe(true);
    expect(contributors[1]?.value()).toBe(0);

    const projection = createStandardMultiplayerPhysicsArenaAuthorityProjection();
    expect(
      projection.capture({
        islandId: frame.islandId,
        generation: frame.generation,
        tick: frame.tick,
        membershipRevision: frame.membershipRevision,
        definitionVersion: frame.definitionVersion,
        members: frame.members,
        auxiliary: frame.auxiliary
      })
    ).toMatchObject({
      status: "captured",
      frame: { auxiliary: [{ id: "test.counter", state: { value: 0 } }] }
    });
    runtime.dispose();
    expect(contributors[1]?.disposed()).toBe(true);
  });
});

function authorityFrame(
  tick: number,
  membershipRevision: number,
  value: number
): StandardMultiplayerPhysicsArenaClientFrame {
  return {
    islandId: "arena",
    generation: "round-1",
    tick,
    membershipRevision,
    definitionVersion: "v1",
    acknowledgedInputSequence: 0,
    members: [
      {
        id: ACTOR.id,
        body: {
          id: ACTOR.body.id,
          kind: "dynamic",
          position: { x: 0, y: 0 },
          linearVelocity: { x: 0, y: 0 },
          sleeping: false
        }
      }
    ],
    auxiliary: [{ id: "test.counter", version: "1", state: { value } }]
  };
}

function createCounterContributor() {
  let value = 0;
  let isDisposed = false;
  return {
    id: "test.counter",
    version: "1",
    maxCheckpointBytes: 128,
    apply(command: { delta: number }) {
      value += command.delta;
    },
    capture: () => ({ value }),
    validate: (checkpoint: { value: number }) => Number.isFinite(checkpoint.value),
    restore(checkpoint: { value: number }) {
      value = checkpoint.value;
    },
    reconcile(checkpoint: { value: number }) {
      value = checkpoint.value;
    },
    reset() {
      value = 0;
    },
    measureBytes: (checkpoint: { value: number }) =>
      new TextEncoder().encode(JSON.stringify(checkpoint)).byteLength,
    hash: (checkpoint: { value: number }) => String(checkpoint.value),
    dispose() {
      isDisposed = true;
      value = 0;
    },
    value: () => value,
    disposed: () => isDisposed
  } satisfies PhysicsPredictionIslandAuxiliaryContributor<{ delta: number }, { value: number }> & {
    value(): number;
    disposed(): boolean;
  };
}

const BINDING: MultiplayerAuthorityBinding = {
  sessionId: "session-1",
  mode: "server-authoritative",
  status: "bound",
  authorityPeerId: "server",
  authorityEndpoint: { kind: "server", id: "server", peerId: "server" }
};

function authorityContext(snapshot: StandardMultiplayerPhysicsArenaClientFrame) {
  return {
    installContext: installContext(),
    runtime: {} as MultiplayerRuntime,
    binding: BINDING,
    message: {
      id: `snapshot-${snapshot.tick}`,
      sessionId: BINDING.sessionId,
      channel: "reliable" as const,
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
