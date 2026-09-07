import { createMemoryMultiplayerBackend } from "@gamekits/multiplayer-memory";
import {
  createMultiplayerFixedStepInputBundle,
  createMultiplayerRuntime
} from "@gamekits/multiplayer-core";
import { createMemoryPhysicsBackend } from "@gamekits/physics-core";
import { describe, expect, it } from "vitest";

import { createArenaAuthorityRuntime } from "../server/arena-authority";
import { arenaParticipantCommandEpoch } from "../shared/arena-identity";
import { ARENA_ACTION_KIND, ARENA_INPUT_KIND } from "../shared/config";

describe("Knockout Arena item authority integration", () => {
  it("arbitrates one owner, then drop and throw create stable physics generations", async () => {
    const fixture = await createFixture("arena-item-integration");
    try {
      advanceUntil(fixture.authority, (snapshot) => snapshot.phase === "running", 240);
      expect(fixture.authority.latestSnapshot().items).toHaveLength(3);

      let inputSequence = 0;
      let bothInRange = false;
      for (let sequence = 1; sequence <= 180; sequence += 1) {
        inputSequence = sequence;
        await Promise.all([
          sendInput(fixture.authority, fixture.clientA, "peer.a", sequence, 0.58, -0.82),
          sendInput(fixture.authority, fixture.clientB, "peer.b", sequence, -0.58, -0.82)
        ]);
        fixture.authority.tick();
        const snapshot = fixture.authority.latestSnapshot();
        const itemBodyId = snapshot.items[0]?.bodyMemberId;
        const itemBody = snapshot.frame.members.find((member) => member.id === itemBodyId)?.body;
        const players = ["player.0", "player.1"].map(
          (id) => snapshot.frame.members.find((member) => member.id === id)?.body
        );
        bothInRange =
          itemBody !== undefined &&
          players.every(
            (body) =>
              body !== undefined &&
              Math.hypot(
                body.position.x - itemBody.position.x,
                (body.position.z ?? 0) - (itemBody.position.z ?? 0)
              ) <= 2.7
          );
        if (bothInRange) break;
      }
      expect(bothInRange).toBe(true);

      const beforeClaim = fixture.authority.latestSnapshot();
      const worldItem = beforeClaim.items[0]!;
      expect(worldItem).toMatchObject({ state: "world", instanceGeneration: 1 });
      await Promise.all([
        sendAction(
          fixture.authority,
          fixture.clientA,
          "peer.a",
          "claim",
          inputSequence,
          0.58,
          -0.82,
          worldItem
        ),
        sendAction(
          fixture.authority,
          fixture.clientA,
          "peer.a",
          "claim",
          inputSequence,
          0.58,
          -0.82,
          worldItem
        ),
        sendAction(
          fixture.authority,
          fixture.clientB,
          "peer.b",
          "claim",
          inputSequence,
          -0.58,
          -0.82,
          worldItem
        )
      ]);
      fixture.authority.tick();

      const claimed = fixture.authority.latestSnapshot();
      expect(claimed.items[0]).toMatchObject({ state: "carried", instanceGeneration: 1 });
      expect(claimed.items[0]?.ownerParticipantId).toBeDefined();
      expect(claimed.items[0]?.bodyMemberId).toBeUndefined();
      const humanClaimActions = claimed.itemActions.filter((action) =>
        action.id.startsWith("peer.")
      );
      expect(humanClaimActions.filter((action) => action.status === "confirmed")).toHaveLength(1);
      expect(humanClaimActions.filter((action) => action.status === "rejected")).toHaveLength(1);
      expect(humanClaimActions).toHaveLength(2);

      const ownerPeerId = claimed.participants.find(
        (participant) => participant.id === claimed.items[0]?.ownerParticipantId
      )?.peerId;
      const owner = ownerPeerId === "peer.a" ? fixture.clientA : fixture.clientB;
      const ownerAimX = ownerPeerId === "peer.a" ? 0.58 : -0.58;

      await sendAction(
        fixture.authority,
        owner,
        ownerPeerId!,
        "drop",
        inputSequence + 1,
        ownerAimX,
        -0.82
      );
      fixture.authority.tick();
      const dropped = fixture.authority.latestSnapshot();
      expect(dropped.items[0]).toMatchObject({
        state: "world",
        instanceGeneration: 2
      });
      expect(dropped.items[0]?.ownerParticipantId).toBeUndefined();
      expect(dropped.items[0]?.bodyMemberId).toContain(".body.g2");
      expect(
        dropped.frame.members.some((member) => member.id === dropped.items[0]?.bodyMemberId)
      ).toBe(true);

      await sendAction(
        fixture.authority,
        owner,
        ownerPeerId!,
        "reclaim",
        inputSequence + 2,
        ownerAimX,
        -0.82,
        dropped.items[0]
      );
      fixture.authority.tick();
      expect(fixture.authority.latestSnapshot().items[0]).toMatchObject({
        state: "carried",
        instanceGeneration: 2
      });

      await sendAction(
        fixture.authority,
        owner,
        ownerPeerId!,
        "use",
        inputSequence + 3,
        ownerAimX,
        -0.82
      );
      fixture.authority.tick();
      expect(fixture.authority.latestSnapshot().items[0]?.state).toBe("windup");
      for (let index = 0; index < 9; index += 1) fixture.authority.tick();
      const thrown = fixture.authority.latestSnapshot();
      expect(thrown.items[0]).toMatchObject({ state: "released", instanceGeneration: 3 });
      expect(thrown.items[0]?.bodyMemberId).toContain(".body.g3");
      expect(thrown.itemActions.find((action) => action.id.endsWith(".use"))).toMatchObject({
        status: "confirmed",
        code: "action-active",
        itemGeneration: 3
      });
    } finally {
      await fixture.dispose();
    }
  });
});

async function createFixture(id: string) {
  const multiplayer = createMemoryMultiplayerBackend({ id });
  const sessionId = `${id}.session`;
  const authorityPeerId = `${id}.server`;
  const host = createMultiplayerRuntime({
    id: `${id}.host`,
    backend: multiplayer,
    connectContext: { localPeer: { id: authorityPeerId, role: "server" } }
  });
  const clientA = createClient(multiplayer, `${id}.a`, "peer.a");
  const clientB = createClient(multiplayer, `${id}.b`, "peer.b");
  await host.createSession({
    id: sessionId,
    kind: "private",
    authority: "server-authoritative",
    localPeer: { id: authorityPeerId, role: "server" }
  });
  await clientA.joinSession({ sessionId, localPeer: { id: "peer.a", role: "client" } });
  await clientB.joinSession({ sessionId, localPeer: { id: "peer.b", role: "client" } });
  const memory = createMemoryPhysicsBackend({ id: `${id}.physics`, dimension: "3d" });
  const authority = createArenaAuthorityRuntime({
    runtime: host,
    backend: {
      ...memory,
      createScene(config: Parameters<typeof memory.createScene>[0]) {
        return memory.createScene({ ...config, gravity: { x: 0, y: 0, z: 0 } });
      }
    },
    sessionId,
    authorityPeerId,
    now: () => 1_000
  });
  return {
    authority,
    clientA,
    clientB,
    async dispose() {
      authority.dispose();
      await clientA.dispose();
      await clientB.dispose();
      await host.dispose();
    }
  };
}

function createClient(
  backend: ReturnType<typeof createMemoryMultiplayerBackend>,
  runtimeId: string,
  peerId: string
) {
  return createMultiplayerRuntime({
    id: runtimeId,
    backend,
    connectContext: { localPeer: { id: peerId, role: "client" } }
  });
}

async function sendInput(
  authority: ReturnType<typeof createArenaAuthorityRuntime>,
  runtime: ReturnType<typeof createMultiplayerRuntime>,
  peerId: string,
  sequence: number,
  moveX: number,
  moveZ: number
): Promise<void> {
  await runtime.send({
    channel: "reliable",
    kind: ARENA_INPUT_KIND,
    payload: createMultiplayerFixedStepInputBundle([
      {
        sequence,
        payload: {
          sequence,
          moveX,
          moveZ,
          jump: false,
          authorityEpoch: commandEpoch(authority, peerId)
        }
      }
    ])
  });
}

async function sendAction(
  authority: ReturnType<typeof createArenaAuthorityRuntime>,
  runtime: ReturnType<typeof createMultiplayerRuntime>,
  peerId: string,
  label: "claim" | "drop" | "reclaim" | "use",
  inputSequence: number,
  aimX: number,
  aimZ: number,
  target?: { id: string; instanceGeneration: number }
): Promise<void> {
  const type = label === "claim" || label === "reclaim" ? "interact" : label;
  const commandId = `${peerId}.${label}.${type}`;
  await runtime.send({
    id: commandId,
    channel: "reliable",
    kind: ARENA_ACTION_KIND,
    correlationId: commandId,
    payload: {
      type,
      commandId,
      inputSequence,
      aimX,
      aimZ,
      charge: type === "use" ? 1 : 0,
      authorityEpoch: commandEpoch(authority, peerId),
      ...(target === undefined
        ? {}
        : { targetItemId: target.id, targetItemGeneration: target.instanceGeneration })
    }
  });
}

function commandEpoch(
  authority: ReturnType<typeof createArenaAuthorityRuntime>,
  peerId: string
): string {
  const snapshot = authority.latestSnapshot();
  const participant = snapshot.participants.find((candidate) => candidate.peerId === peerId);
  if (participant === undefined) throw new Error(`Missing participant for ${peerId}`);
  return arenaParticipantCommandEpoch(snapshot.frame.generation, participant.revision);
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
