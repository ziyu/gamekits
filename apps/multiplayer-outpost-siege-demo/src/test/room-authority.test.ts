import { createColyseusMultiplayerBackend } from "@gamekits/multiplayer-colyseus";
import { createGameKitsColyseusServer } from "@gamekits/multiplayer-colyseus/server";
import { createMultiplayerRuntime } from "@gamekits/multiplayer-core";
import type { CombatKinematicProjectileRecord } from "@gamekits/combat";
import { describe, expect, it } from "vitest";

import { readOutpostClientAuthoritySnapshot } from "../gameplay";
import { OUTPOST_COLYSEUS_SCHEMA_VERSION, readOutpostColyseusStateUpdate } from "../realtime";
import { createOutpostSiegeRoomClass, type OutpostSiegeRoom } from "../server";

describe("Outpost Room-owned authority", () => {
  it("keeps the headless App Host ticking after the party leader leaves", async () => {
    const roomName = uniqueRoomName();
    let room: OutpostSiegeRoom | undefined;
    const RoomClass = createOutpostSiegeRoomClass({
      fixedStepMs: 10,
      clock: () => 100,
      onRoomCreated(createdRoom) {
        room = createdRoom;
      }
    });
    const server = await createGameKitsColyseusServer({ roomName, roomClass: RoomClass });
    const leader = createMultiplayerRuntime({
      id: "outpost.room-test.leader",
      backend: createColyseusMultiplayerBackend({
        endpoint: server.endpoint,
        roomName,
        joinByIdFallback: true
      }),
      connectContext: {
        localPeer: { id: "leader", role: "host", playerId: "player.leader" }
      },
      clock: () => 100
    });
    const client = createMultiplayerRuntime({
      id: "outpost.room-test.client",
      backend: createColyseusMultiplayerBackend({
        endpoint: server.endpoint,
        roomName,
        joinByIdFallback: true
      }),
      connectContext: {
        localPeer: { id: "client", role: "client", playerId: "player.client" }
      },
      clock: () => 100
    });

    try {
      await leader.createSession({
        id: "outpost-room-session",
        authority: "server-authoritative",
        localPeer: { id: "leader", role: "host", playerId: "player.leader" }
      });
      await client.joinSession({
        sessionId: "outpost-room-session",
        localPeer: { id: "client", role: "client", playerId: "player.client" }
      });

      await waitFor(() => {
        const snapshot = room?.authoritySnapshot();
        return (
          snapshot !== undefined &&
          snapshot.activePeers === 2 &&
          snapshot.ticks >= 2 &&
          snapshot.runtime?.match.participants.length === 2 &&
          leader.session()?.peers.length === 3 &&
          client.session()?.peers.length === 3
        );
      });
      expect(leader.session()?.peers.map((peer) => peer.id)).toEqual([
        "outpost-room-session.server",
        "leader",
        "client"
      ]);
      expect(client.session()?.peers.map((peer) => peer.id)).toEqual([
        "outpost-room-session.server",
        "leader",
        "client"
      ]);
      const beforeLeaderLeave = requireRoom(room).authoritySnapshot();
      expect(beforeLeaderLeave).toMatchObject({
        phase: "running",
        sessionId: "outpost-room-session",
        activePeers: 2,
        runtime: {
          hostPhase: "started",
          running: true,
          entityCount: 33,
          physicsBound: true,
          physicsBackend: "rapier2d",
          match: {
            phase: "lobby",
            participants: [
              { peerId: "leader", playerId: "player.leader", ready: false },
              { peerId: "client", playerId: "player.client", ready: false }
            ]
          }
        }
      });

      await client.send({
        id: "outpost-room.input.1",
        sessionId: "outpost-room-session",
        channel: "reliable",
        kind: "game.input",
        targetPeerIds: ["outpost-room-session.server"],
        sequence: 1,
        timestamp: 100,
        payload: { moveX: 1, moveY: 0 }
      });
      await waitFor(() => (room?.authoritySnapshot().receivedMessages ?? 0) === 1);

      await leader.dispose();
      await waitFor(() => {
        const snapshot = room?.authoritySnapshot();
        return (
          snapshot !== undefined &&
          snapshot.activePeers === 1 &&
          snapshot.ticks > beforeLeaderLeave.ticks &&
          snapshot.runtime?.match.participants.length === 1
        );
      });

      expect(requireRoom(room).authoritySnapshot()).toMatchObject({
        phase: "running",
        activePeers: 1,
        joins: 2,
        leaves: 1,
        receivedMessages: 1,
        runtime: {
          running: true,
          entityCount: 33,
          match: { phase: "lobby", participants: [{ peerId: "client" }] }
        }
      });
      expect(client.snapshot()).toMatchObject({
        phase: "in-session",
        session: { id: "outpost-room-session" }
      });
    } finally {
      await client.dispose();
      await leader.dispose();
      await server.dispose();
    }

    expect(requireRoom(room).authoritySnapshot()).toMatchObject({
      phase: "disposed",
      activePeers: 0,
      runtime: {
        hostPhase: "disposed",
        running: false,
        entityCount: 0,
        physicsBound: false
      }
    });
  });

  it("isolates App Host, World, Physics, ingress, and lifecycle between rooms", async () => {
    const roomName = uniqueRoomName();
    const rooms: OutpostSiegeRoom[] = [];
    const RoomClass = createOutpostSiegeRoomClass({
      fixedStepMs: 10,
      clock: () => 200,
      onRoomCreated(room) {
        rooms.push(room);
      }
    });
    const server = await createGameKitsColyseusServer({ roomName, roomClass: RoomClass });
    const alpha = createMultiplayerRuntime({
      id: "outpost.room-isolation.alpha",
      backend: createColyseusMultiplayerBackend({
        endpoint: server.endpoint,
        roomName,
        joinByIdFallback: true
      }),
      connectContext: { localPeer: { id: "alpha-leader", role: "host" } },
      clock: () => 200
    });
    const bravo = createMultiplayerRuntime({
      id: "outpost.room-isolation.bravo",
      backend: createColyseusMultiplayerBackend({
        endpoint: server.endpoint,
        roomName,
        joinByIdFallback: true
      }),
      connectContext: { localPeer: { id: "bravo-leader", role: "host" } },
      clock: () => 200
    });

    try {
      await alpha.createSession({
        id: "outpost-room-alpha",
        authority: "server-authoritative",
        localPeer: { id: "alpha-leader", role: "host" }
      });
      await bravo.createSession({
        id: "outpost-room-bravo",
        authority: "server-authoritative",
        localPeer: { id: "bravo-leader", role: "host" }
      });
      await waitFor(
        () => rooms.length === 2 && rooms.every((room) => room.authoritySnapshot().ticks > 0)
      );

      const alphaRoom = requireSessionRoom(rooms, "outpost-room-alpha");
      const bravoRoom = requireSessionRoom(rooms, "outpost-room-bravo");
      expect(alphaRoom).not.toBe(bravoRoom);
      expect(alphaRoom.authoritySnapshot().runtime).toMatchObject({ entityCount: 33 });
      expect(bravoRoom.authoritySnapshot().runtime).toMatchObject({ entityCount: 33 });

      await alpha.send({
        id: "outpost-room-alpha.input.1",
        sessionId: "outpost-room-alpha",
        channel: "reliable",
        kind: "game.input",
        targetPeerIds: ["outpost-room-alpha.server"],
        sequence: 1,
        timestamp: 200,
        payload: { moveX: -1, moveY: 0 }
      });
      await waitFor(() => alphaRoom.authoritySnapshot().receivedMessages === 1);
      expect(bravoRoom.authoritySnapshot().receivedMessages).toBe(0);

      const bravoTickBeforeAlphaClose = bravoRoom.authoritySnapshot().ticks;
      await alpha.dispose();
      await waitFor(
        () =>
          alphaRoom.authoritySnapshot().phase === "disposed" &&
          bravoRoom.authoritySnapshot().ticks > bravoTickBeforeAlphaClose
      );
      expect(bravoRoom.authoritySnapshot()).toMatchObject({
        phase: "running",
        activePeers: 1,
        runtime: { running: true, entityCount: 33 }
      });
    } finally {
      await bravo.dispose();
      await alpha.dispose();
      await server.dispose();
    }

    expect(rooms).toHaveLength(2);
    expect(rooms.every((room) => room.authoritySnapshot().phase === "disposed")).toBe(true);
    expect(rooms.every((room) => room.authoritySnapshot().runtime?.entityCount === 0)).toBe(true);
  });

  it("runs four core clients through ready, countdown, physical movement, and leader leave", async () => {
    const roomName = uniqueRoomName();
    let room: OutpostSiegeRoom | undefined;
    const RoomClass = createOutpostSiegeRoomClass({
      fixedStepMs: 40,
      countdownMs: 80,
      onRoomCreated(createdRoom) {
        room = createdRoom;
      }
    });
    const server = await createGameKitsColyseusServer({ roomName, roomClass: RoomClass });
    const observerBackend = createColyseusMultiplayerBackend({
      endpoint: server.endpoint,
      roomName,
      joinByIdFallback: true,
      nativeCapabilities: {
        authoritativePath: "colyseus-schema",
        stateSync: {
          available: true,
          lane: "colyseus-schema",
          schemaVersion: OUTPOST_COLYSEUS_SCHEMA_VERSION
        }
      },
      nativeStateSync: {
        enabled: true,
        schemaVersion: OUTPOST_COLYSEUS_SCHEMA_VERSION,
        readRoomState: readOutpostColyseusStateUpdate
      }
    });
    const clients = [
      createRoomClient(server.endpoint, roomName, "leader", "host"),
      createRoomClient(server.endpoint, roomName, "ranger-2", "client"),
      createRoomClient(server.endpoint, roomName, "ranger-3", "client"),
      createMultiplayerRuntime({
        id: "outpost.room-four-client.ranger-4",
        backend: observerBackend,
        connectContext: {
          localPeer: {
            id: "ranger-4",
            role: "client",
            playerId: "player.ranger-4"
          }
        }
      })
    ];
    let replicatedPhase: string | undefined;
    let replicatedRifleRecord: CombatKinematicProjectileRecord | undefined;
    const replicatedInputAcks: number[] = [];
    let envelopeSnapshots = 0;
    const unsubscribeEnvelope = clients[3]?.subscribe((message) => {
      if (message.kind === "game.snapshot") {
        envelopeSnapshots += 1;
      }
    });
    const unsubscribeState = observerBackend.native().subscribeState((update) => {
      const snapshot = readOutpostClientAuthoritySnapshot(update.state);
      if (snapshot === undefined) {
        return;
      }
      replicatedPhase = snapshot.phase;
      replicatedRifleRecord = snapshot.combat.projectileRecords.find(
        (record) => record.correlationId === "player.ranger-4.rifle.1"
      );
      const acknowledged = snapshot.inputAcksByPeerId["ranger-4"];
      if (acknowledged !== undefined && replicatedInputAcks.at(-1) !== acknowledged) {
        replicatedInputAcks.push(acknowledged);
      }
    });

    try {
      await clients[0]?.createSession({
        id: "outpost-four-client-session",
        authority: "server-authoritative",
        localPeer: { id: "leader", role: "host", playerId: "player.leader" }
      });
      for (const [index, client] of clients.entries()) {
        if (index === 0) {
          continue;
        }
        await client.joinSession({
          sessionId: "outpost-four-client-session",
          localPeer: {
            id: `ranger-${index + 1}`,
            role: "client",
            playerId: `player.ranger-${index + 1}`
          }
        });
      }

      await waitFor(() => {
        const match = room?.authoritySnapshot().runtime?.match;
        return match?.phase === "lobby" && match.participants.length === 4;
      });
      expect(requireRoom(room).authoritySnapshot().runtime).toMatchObject({
        entityCount: 33,
        match: { phase: "lobby", countdownMsRemaining: 80 }
      });

      await Promise.all(
        clients.map((client) =>
          client.send({
            channel: "reliable",
            kind: "game.action",
            targetPeerIds: ["outpost-four-client-session.server"],
            payload: { type: "ready", ready: true }
          })
        )
      );
      await waitFor(() => {
        const runtime = room?.authoritySnapshot().runtime;
        return (
          runtime?.match.phase === "running" &&
          runtime.match.players.length === 4 &&
          runtime.entityCount === 40 &&
          replicatedPhase === "running"
        );
      });

      const running = requireRoom(room).authoritySnapshot();
      expect(running).toMatchObject({
        activePeers: 4,
        runtime: {
          entityCount: 40,
          match: {
            phase: "running",
            participants: [
              { peerId: "leader", ready: true, slot: 0 },
              { peerId: "ranger-2", ready: true, slot: 1 },
              { peerId: "ranger-3", ready: true, slot: 2 },
              { peerId: "ranger-4", ready: true, slot: 3 }
            ],
            authorityInput: { acceptedActions: 4 }
          }
        }
      });
      const playerBefore = running.runtime?.match.players.find(
        (player) => player.playerId === "player.ranger-4"
      );
      expect(playerBefore).toBeDefined();

      await Promise.all(
        [1, 2, 3].map((sequence) =>
          clients[3]?.send({
            channel: "reliable",
            kind: "game.input",
            targetPeerIds: ["outpost-four-client-session.server"],
            sequence,
            payload: {
              sequence,
              moveX: 1,
              moveY: 0,
              aimX: 1_200,
              aimY: 500
            }
          })
        )
      );
      await waitFor(() => {
        const match = room?.authoritySnapshot().runtime?.match;
        const moved = match?.players.find((player) => player.playerId === "player.ranger-4");
        return (
          match?.inputAcksByPeerId["ranger-4"] === 3 &&
          replicatedInputAcks.includes(3) &&
          moved !== undefined &&
          playerBefore !== undefined &&
          moved.x > playerBefore.x
        );
      });
      expect(requireRoom(room).authoritySnapshot().runtime?.match.authorityInput).toMatchObject({
        acceptedInputs: 3,
        coalescedInputs: 0,
        queuedInputs: 0
      });
      expect(replicatedInputAcks.at(-1)).toBe(3);
      expect(
        replicatedInputAcks.every(
          (acknowledged, index) => index === 0 || acknowledged > replicatedInputAcks[index - 1]!
        )
      ).toBe(true);
      expect(envelopeSnapshots).toBe(0);
      expect(observerBackend.native().capabilities()).toMatchObject({
        authoritativePath: "colyseus-schema",
        stateSync: { active: true, schemaVersion: OUTPOST_COLYSEUS_SCHEMA_VERSION }
      });
      expect(
        readOutpostColyseusStateUpdate(observerBackend.native().currentRoom()?.state)?.state.players
      ).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            networkEntityId: "player.ranger-4",
            generation: 0,
            archetypeId: "player.outpost.ranger",
            playerId: "player.ranger-4"
          })
        ])
      );

      const combatBefore = requireRoom(room).authoritySnapshot().runtime?.combat;
      expect(combatBefore).toBeDefined();
      const rejectedActionsBefore =
        requireRoom(room).authoritySnapshot().runtime?.match.authorityInput.rejectedActions ?? 0;
      await clients[3]?.send({
        channel: "reliable",
        kind: "game.action",
        targetPeerIds: ["outpost-four-client-session.server"],
        correlationId: "outpost.test.reject-rifle-action-bypass",
        payload: {
          type: "player-action",
          action: "rifle",
          aimX: 1_200,
          aimY: 500
        }
      });
      await waitFor(
        () =>
          room?.authoritySnapshot().runtime?.match.authorityInput.rejectedActions ===
          rejectedActionsBefore + 1
      );

      await clients[3]?.send({
        channel: "reliable",
        kind: "game.action",
        targetPeerIds: ["outpost-four-client-session.server"],
        correlationId: "outpost.test.bound-player",
        payload: {
          type: "player-action",
          action: "dash",
          aimX: 1_200,
          aimY: 500,
          dashSequence: 1,
          playerId: "player.leader"
        }
      });
      await waitFor(
        () =>
          room?.authoritySnapshot().runtime?.combat?.acceptedCommands ===
          (combatBefore?.acceptedCommands ?? 0) + 1
      );
      const combatAfterDash = requireRoom(room).authoritySnapshot().runtime?.combat;
      expect(combatAfterDash?.actors.find((actor) => actor.id === "player.ranger-4")?.stamina).toBe(
        75
      );
      expect(combatAfterDash?.actors.find((actor) => actor.id === "player.leader")?.stamina).toBe(
        100
      );

      await clients[3]?.send({
        channel: "reliable",
        kind: "game.action",
        targetPeerIds: ["outpost-four-client-session.server"],
        correlationId: "outpost.test.reload-edge",
        payload: { type: "player-action", action: "reload", aimX: 1_200, aimY: 500 }
      });
      await waitFor(
        () =>
          room
            ?.authoritySnapshot()
            .runtime?.combat?.actors.find((actor) => actor.id === "player.ranger-4")?.weapon
            ?.lastFeedback?.reason === "magazine-full"
      );
      expect(
        requireRoom(room)
          .authoritySnapshot()
          .runtime?.combat?.actors.find((actor) => actor.id === "player.ranger-4")?.weapon
          ?.lastFeedback
      ).toMatchObject({
        kind: "rejected",
        action: "reload",
        correlationId: "outpost.test.reload-edge"
      });

      const acceptedActionsBeforeRifle =
        requireRoom(room).authoritySnapshot().runtime?.match.authorityInput.acceptedActions ?? 0;
      await clients[3]?.send({
        channel: "reliable",
        kind: "game.action",
        targetPeerIds: ["outpost-four-client-session.server"],
        correlationId: "outpost.test.reliable-rifle-press",
        payload: {
          type: "player-action",
          action: "rifle",
          aimX: 1_200,
          aimY: 500,
          fireSequence: 1,
          fireHeld: true
        }
      });
      await waitFor(
        () =>
          room
            ?.authoritySnapshot()
            .runtime?.combat?.actors.find((actor) => actor.id === "player.ranger-4")?.weapon
            ?.shotSequence === 1
      );
      await clients[3]?.send({
        channel: "reliable",
        kind: "game.action",
        targetPeerIds: ["outpost-four-client-session.server"],
        correlationId: "outpost.test.reliable-rifle-release",
        payload: {
          type: "player-action",
          action: "rifle",
          aimX: 1_200,
          aimY: 500,
          fireSequence: 1,
          fireHeld: false
        }
      });
      await waitFor(
        () =>
          room?.authoritySnapshot().runtime?.match.authorityInput.acceptedActions ===
          acceptedActionsBeforeRifle + 2
      );
      expect(
        requireRoom(room)
          .authoritySnapshot()
          .runtime?.combat?.actors.find((actor) => actor.id === "player.ranger-4")?.weapon
      ).toMatchObject({ magazine: 23, shotSequence: 1 });
      await waitFor(
        () =>
          room
            ?.authoritySnapshot()
            .runtime?.combat?.projectileRecords.some(
              (record) =>
                record.correlationId === "player.ranger-4.rifle.1" && record.finish !== undefined
            ) === true &&
          replicatedRifleRecord?.finish !== undefined &&
          room?.authoritySnapshot().runtime?.combat?.projectiles.length === 0
      );
      expect(replicatedRifleRecord).toMatchObject({
        projectileId: expect.any(String),
        correlationId: "player.ranger-4.rifle.1",
        generation: "outpost-four-client-session",
        definitionId: "combat.outpost.projectile.rifle",
        definitionVersion: "outpost.rifle-projectile.v1",
        fixedDeltaMs: 1000 / 60,
        finish: {
          reason: expect.stringMatching(/^(impact|expired|out-of-bounds)$/),
          position: { x: expect.any(Number), y: expect.any(Number) }
        }
      });

      await clients[3]?.send({
        channel: "reliable",
        kind: "game.action",
        targetPeerIds: ["outpost-four-client-session.server"],
        correlationId: "outpost.test.cooldown-rejection",
        payload: {
          type: "player-action",
          action: "dash",
          aimX: 1_200,
          aimY: 500,
          dashSequence: 2
        }
      });
      await waitFor(
        () =>
          room?.authoritySnapshot().runtime?.combat?.rejectedCommands ===
          (combatAfterDash?.rejectedCommands ?? 0) + 1
      );
      expect(
        requireRoom(room)
          .authoritySnapshot()
          .runtime?.match.players.find((player) => player.playerId === "player.ranger-4")
      ).toMatchObject({ dashSequence: 2 });

      const beforeLeaderLeave = requireRoom(room).authoritySnapshot();
      await clients[0]?.dispose();
      await waitFor(() => {
        const snapshot = room?.authoritySnapshot();
        return (
          snapshot?.activePeers === 3 &&
          snapshot.ticks > beforeLeaderLeave.ticks &&
          snapshot.runtime?.match.players.length === 3
        );
      });
      expect(requireRoom(room).authoritySnapshot()).toMatchObject({
        phase: "running",
        activePeers: 3,
        runtime: {
          running: true,
          entityCount: 39,
          match: { phase: "running" }
        }
      });
      expect(
        requireRoom(room)
          .authoritySnapshot()
          .runtime?.match.participants.map((participant) => participant.peerId)
      ).toEqual(["ranger-2", "ranger-3", "ranger-4"]);
      expect(clients[3]?.phase()).toBe("in-session");
    } finally {
      unsubscribeState();
      unsubscribeEnvelope?.();
      await Promise.all(clients.map((client) => client.dispose()));
      await server.dispose();
    }
  });
});

function createRoomClient(
  endpoint: string,
  roomName: string,
  peerId: string,
  role: "host" | "client"
) {
  return createMultiplayerRuntime({
    id: `outpost.room-four-client.${peerId}`,
    backend: createColyseusMultiplayerBackend({ endpoint, roomName, joinByIdFallback: true }),
    connectContext: {
      localPeer: { id: peerId, role, playerId: `player.${peerId}` }
    }
  });
}

function uniqueRoomName(): string {
  return `outpost_room_${Date.now()}_${Math.floor(Math.random() * 10_000)}`;
}

function requireRoom(room: OutpostSiegeRoom | undefined): OutpostSiegeRoom {
  if (!room) {
    throw new Error("Outpost test Room was not created.");
  }
  return room;
}

function requireSessionRoom(rooms: OutpostSiegeRoom[], sessionId: string): OutpostSiegeRoom {
  const room = rooms.find((candidate) => candidate.authoritySnapshot().sessionId === sessionId);
  if (!room) {
    throw new Error(`Missing Outpost test Room for session: ${sessionId}`);
  }
  return room;
}

async function waitFor(predicate: () => boolean): Promise<void> {
  const startedAt = Date.now();
  while (!predicate()) {
    if (Date.now() - startedAt > 2_000) {
      throw new Error("Timed out waiting for Outpost Room authority state.");
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
