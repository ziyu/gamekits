import { createColyseusMultiplayerBackend } from "@gamekits/multiplayer-colyseus";
import { createGameKitsColyseusServer } from "@gamekits/multiplayer-colyseus/server";
import {
  createMultiplayerFixedStepInputBundle,
  createMultiplayerRuntime,
  type MultiplayerMessageEnvelope
} from "@gamekits/multiplayer-core";
import { describe, expect, it } from "vitest";

import { ARENA_COMPILED_CONTENT } from "../content/default-content";
import { ARENA_CONTENT_VERSION } from "../content/pack";
import {
  ARENA_INPUT_KIND,
  ARENA_ROOM_NAME,
  ARENA_SNAPSHOT_KIND,
  arenaPlayerMemberId
} from "../shared/config";
import { ARENA_STAGE_SELECTION_METADATA_KEY } from "../shared/arena-stage-selection";
import { arenaParticipantCommandEpoch } from "../shared/arena-identity";
import { readArenaSnapshot, type ArenaSnapshot } from "../shared/protocol";
import { KnockoutArenaRoom } from "../server/arena-room";

describe("Knockout Arena Room authority", () => {
  it("replicates one full physics island and acknowledges redundant input from two clients", async () => {
    const server = await createGameKitsColyseusServer({
      roomName: ARENA_ROOM_NAME,
      roomClass: KnockoutArenaRoom
    });
    const sessionId = "knockout-test";
    const clientA = createClient(server.endpoint, "bean-a");
    const clientB = createClient(server.endpoint, "bean-b");
    const snapshotsA: ArenaSnapshot[] = [];
    const snapshotsB: ArenaSnapshot[] = [];
    const unsubscribeA = clientA.subscribe((message) => captureSnapshot(message, snapshotsA));
    const unsubscribeB = clientB.subscribe((message) => captureSnapshot(message, snapshotsB));

    try {
      await clientA.createSession({
        id: sessionId,
        kind: "private",
        authority: "server-authoritative",
        localPeer: { id: "bean-a", displayName: "Bean A", role: "host" }
      });
      await clientB.joinSession({
        sessionId,
        localPeer: { id: "bean-b", displayName: "Bean B", role: "client" }
      });
      await waitFor(() =>
        [snapshotsA, snapshotsB].every((snapshots) => {
          const snapshot = snapshots.at(-1);
          return (
            snapshot?.playerIdsByPeerId["bean-a"] === arenaPlayerMemberId(0) &&
            snapshot.playerIdsByPeerId["bean-b"] === arenaPlayerMemberId(1)
          );
        })
      );
      const inputEpochA = commandEpoch(snapshotsA.at(-1)!, "bean-a");
      const inputEpochB = commandEpoch(snapshotsB.at(-1)!, "bean-b");

      await Promise.all([
        clientA.send({
          channel: "reliable",
          kind: ARENA_INPUT_KIND,
          payload: createMultiplayerFixedStepInputBundle([
            {
              sequence: 1,
              payload: {
                sequence: 1,
                moveX: 1,
                moveZ: 0,
                jump: false,
                authorityEpoch: inputEpochA
              }
            },
            {
              sequence: 2,
              payload: {
                sequence: 2,
                moveX: 1,
                moveZ: -1,
                jump: false,
                authorityEpoch: inputEpochA
              }
            }
          ])
        }),
        clientB.send({
          channel: "reliable",
          kind: ARENA_INPUT_KIND,
          payload: createMultiplayerFixedStepInputBundle([
            {
              sequence: 1,
              payload: {
                sequence: 1,
                moveX: -1,
                moveZ: 0,
                jump: false,
                authorityEpoch: inputEpochB
              }
            }
          ])
        })
      ]);
      await waitFor(() => {
        const latest = snapshotsA.at(-1);
        return (
          (latest?.inputAcksByPeerId["bean-a"] ?? 0) >= 2 &&
          (latest?.inputAcksByPeerId["bean-b"] ?? 0) >= 1
        );
      });

      const latestA = snapshotsA.at(-1)!;
      const latestB = snapshotsB.at(-1)!;
      const qualifier = ARENA_COMPILED_CONTENT.stages[0]!;
      const qualifierMemberCount =
        qualifier.courseProjection.participantSpawns.length +
        qualifier.courseProjection.memberDefinitions.length +
        qualifier.courseProjection.itemSpawns.length;
      expect(latestA.frame.islandId).toBe("knockout.full-arena");
      expect(latestA.frame.members).toHaveLength(qualifierMemberCount);
      expect(latestA.frame.auxiliary).toMatchObject([
        {
          id: "arena.item-carry",
          version: "1",
          state: { version: 1 }
        },
        {
          id: "character.motor",
          version: ARENA_CONTENT_VERSION,
          state: { version: 1 }
        }
      ]);
      const motorState = latestA.frame.auxiliary?.find(
        (contributor) => contributor.id === "character.motor"
      )?.state as { members?: unknown[] | undefined } | undefined;
      expect(motorState?.members).toHaveLength(8);
      expect(latestB.frame.tick).toBeGreaterThan(0);
      expect(latestA.authority).toMatchObject({
        activePeers: 2,
        acceptedInputs: 3,
        rejectedInputs: 0
      });
      expect(latestA.authority.payloadBytes).toBeGreaterThan(1_000);
      expect(latestA.actorControlsByMemberId).toMatchObject({
        "player.0": { moveX: 0, moveZ: 0, jump: false },
        "player.1": { moveX: 0, moveZ: 0, jump: false }
      });
      expect(Object.keys(latestA.actorControlsByMemberId)).toHaveLength(8);

      await waitFor(() => snapshotsA.at(-1)?.phase === "running");
      const running = snapshotsA.at(-1)!;
      expect(running).toMatchObject({
        phase: "running",
        round: 1,
        countdownMs: 0,
        removedMemberIds: []
      });
      expect(running.actorControlsByMemberId["player.0"]).toMatchObject({
        moveX: 1,
        moveZ: -1,
        sequence: 2
      });
      expect(running.frame.members).toHaveLength(qualifierMemberCount);
    } finally {
      unsubscribeA();
      unsubscribeB();
      await clientA.dispose();
      await clientB.dispose();
      await server.dispose();
    }
  }, 15_000);

  it("installs the authority-selected opening scene, actors, and item manifest", async () => {
    const server = await createGameKitsColyseusServer({
      roomName: ARENA_ROOM_NAME,
      roomClass: KnockoutArenaRoom
    });
    const client = createClient(server.endpoint, "scene-host");
    const snapshots: ArenaSnapshot[] = [];
    const unsubscribe = client.subscribe((message) => captureSnapshot(message, snapshots));

    try {
      await client.createSession({
        id: "knockout-scrap-yard",
        kind: "private",
        authority: "server-authoritative",
        localPeer: { id: "scene-host", displayName: "Scene Host", role: "host" },
        metadata: { [ARENA_STAGE_SELECTION_METADATA_KEY]: "stage.scrap-yard" }
      });
      await waitFor(() =>
        snapshots.some(
          (snapshot) =>
            snapshot.match.stageIndex === 1 &&
            snapshot.playerIdsByPeerId["scene-host"] === arenaPlayerMemberId(0)
        )
      );

      const snapshot = snapshots.at(-1)!;
      const stage = ARENA_COMPILED_CONTENT.stages[1]!;
      const expectedMemberCount =
        stage.courseProjection.participantSpawns.length +
        stage.courseProjection.memberDefinitions.length +
        stage.courseProjection.itemSpawns.length;
      expect(snapshot.match).toMatchObject({
        stageIndex: 1,
        stageCount: 3,
        stageId: "stage.scrap-yard",
        stageKind: "brawl"
      });
      expect(snapshot.frame.generation).toBe("m1.s2.r1");
      expect(snapshot.frame.members).toHaveLength(expectedMemberCount);
      expect(snapshot.frame.members.some((member) => member.id === "scrap.crusher-west")).toBe(
        true
      );
      expect(snapshot.frame.members.some((member) => member.id === "circuit.sweeper-alpha")).toBe(
        false
      );
      expect(snapshot.items).toHaveLength(stage.courseProjection.itemSpawns.length);
      expect(
        snapshot.items.every((item) =>
          stage.items.some((definition) => definition.id === item.definitionId)
        )
      ).toBe(true);
    } finally {
      unsubscribe();
      await client.dispose();
      await server.dispose();
    }
  }, 15_000);
});

function createClient(endpoint: string, peerId: string) {
  return createMultiplayerRuntime({
    id: `knockout.test.${peerId}`,
    backend: createColyseusMultiplayerBackend({
      endpoint,
      roomName: ARENA_ROOM_NAME,
      joinByIdFallback: true
    }),
    connectContext: {
      localPeer: { id: peerId, displayName: peerId, role: "client" }
    }
  });
}

function captureSnapshot(message: MultiplayerMessageEnvelope, snapshots: ArenaSnapshot[]): void {
  if (message.kind !== ARENA_SNAPSHOT_KIND) return;
  const snapshot = readArenaSnapshot(message.payload);
  if (snapshot) snapshots.push(snapshot);
}

function commandEpoch(snapshot: ArenaSnapshot, peerId: string): string {
  const participant = snapshot.participants.find((candidate) => candidate.peerId === peerId);
  if (participant === undefined) throw new Error(`Missing participant for ${peerId}`);
  return arenaParticipantCommandEpoch(snapshot.frame.generation, participant.revision);
}

async function waitFor(predicate: () => boolean): Promise<void> {
  const startedAt = Date.now();
  while (!predicate()) {
    if (Date.now() - startedAt > 5_000) throw new Error("Timed out waiting for arena authority.");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}
