import { createGameKitsColyseusServer } from "@gamekits/multiplayer-colyseus/server";
import { describe, expect, it } from "vitest";
import { createMultiplayerDemoClient, type MultiplayerDemoClient } from "./client";
import type { RealtimeArenaSnapshot } from "./realtime/domain";
import {
  REALTIME_ARENA_ACTION_KIND,
  REALTIME_ARENA_CHANNEL,
  REALTIME_ARENA_INPUT_KIND,
  REALTIME_ARENA_SNAPSHOT_KIND
} from "./realtime/protocol";
import type { LocalMultiplayerDemoHost } from "./server/create-local-demo-server";
import {
  createLocalMultiplayerDemoServer,
  createLocalMultiplayerDemoHost,
  MULTIPLAYER_DEMO_ROOM_NAME
} from "./server/create-local-demo-server";
import { createMultiplayerDemoTestHarness, waitFor } from "./test/harness";

describe("multiplayer-demo", () => {
  it("applies a Colyseus client command on the host tick boundary", async () => {
    const harness = await createMultiplayerDemoTestHarness();

    try {
      await harness.connectClient();
      const before = harness.server.app.snapshot();
      await harness.sendClientCommand({ type: "confirm", objectId: "relay-alpha" });
      await harness.waitForHostCommand();

      expect(harness.server.app.snapshot().state.confirmations).toBe(before.state.confirmations);

      harness.tickHost();

      expect(harness.server.app.snapshot().state.confirmations).toBe(
        before.state.confirmations + 1
      );
      expect(
        harness.server.app.events.some((event) => event.type === "multiplayer.command.accepted")
      ).toBe(true);

      await waitFor(() =>
        harness.client.messages.some((message) => message.kind === "game.command.result")
      );
      expect(
        harness.client.messages.some(
          (message) =>
            message.kind === "game.command.result" && message.sourcePeerId === "demo-host"
        )
      ).toBe(true);
    } finally {
      await harness.dispose();
    }
  });

  it("rejects invalid client priority without mutating demo state", async () => {
    const harness = await createMultiplayerDemoTestHarness();

    try {
      await harness.connectClient();
      const before = harness.server.app.snapshot();
      await harness.sendClientCommand({
        type: "set-priority",
        objectId: "relay-alpha",
        priority: 99
      });
      await harness.waitForHostCommand();
      harness.tickHost();
      const after = harness.server.app.snapshot();
      const relay = after.state.objects.find((object) => object.id === "relay-alpha");

      expect(relay?.priority).toBe(
        before.state.objects.find((object) => object.id === "relay-alpha")?.priority
      );
      expect(after.state.rejectedCommands).toBe(before.state.rejectedCommands + 1);
      expect(
        harness.server.app.events.some((event) => event.type === "multiplayer.command.rejected")
      ).toBe(true);
    } finally {
      await harness.dispose();
    }
  });

  it("stops applying commands after the host runtime is disposed", async () => {
    const harness = await createMultiplayerDemoTestHarness();

    try {
      await harness.connectClient();
      await harness.server.disposeHost();
      const before = harness.server.app.snapshot();

      await waitFor(() => harness.client.runtime.phase() !== "in-session");
      await expect(
        harness.sendClientCommand({ type: "confirm", objectId: "relay-alpha" })
      ).rejects.toBeTruthy();
      harness.tickHost();

      expect(harness.server.app.snapshot().state.confirmations).toBe(before.state.confirmations);
    } finally {
      await harness.dispose();
    }
  });

  it("rejects client connection to an unhosted selected room", async () => {
    const colyseus = await createGameKitsColyseusServer({
      roomName: `${MULTIPLAYER_DEMO_ROOM_NAME}_unhosted_${Date.now()}_${Math.floor(
        Math.random() * 10000
      )}`
    });
    const client = createMultiplayerDemoClient({
      endpoint: colyseus.endpoint,
      roomName: colyseus.roomNames[0] ?? MULTIPLAYER_DEMO_ROOM_NAME,
      sessionId: "unhosted-room",
      hostPeerId: "demo-host",
      peerId: "unhosted-client",
      displayName: "unhosted-client"
    });

    try {
      await expect(client.connect()).rejects.toBeTruthy();
    } finally {
      await client.dispose();
      await colyseus.dispose();
    }
  });

  it("connects multiple clients to the selected room without counting left peers as active", async () => {
    const colyseus = await createGameKitsColyseusServer({
      roomName: `${MULTIPLAYER_DEMO_ROOM_NAME}_selected_${Date.now()}_${Math.floor(
        Math.random() * 10000
      )}`
    });
    const host = await createLocalMultiplayerDemoHost({
      endpoint: colyseus.endpoint,
      roomName: colyseus.roomNames[0] ?? MULTIPLAYER_DEMO_ROOM_NAME,
      sessionId: "selected-room"
    });
    const clientA = createClient(host, "client-a");
    const clientB = createClient(host, "client-b");

    try {
      await clientA.connect();
      await clientB.connect();
      await waitFor(() => countActivePeers(host) === 3);

      expect(countActivePeers(host)).toBe(3);

      await clientA.dispose();
      await waitFor(() => countActivePeers(host) === 2);

      expect(countActivePeers(host)).toBe(2);
      expect(
        host.host.peers().some((peer) => peer.id === "client-a" && peer.status === "left")
      ).toBe(true);
    } finally {
      await clientA.dispose();
      await clientB.dispose();
      await host.dispose();
      await colyseus.dispose();
    }
  });

  it("keeps specified rooms isolated on one Colyseus server", async () => {
    const colyseus = await createGameKitsColyseusServer({
      roomName: `${MULTIPLAYER_DEMO_ROOM_NAME}_isolated_${Date.now()}_${Math.floor(
        Math.random() * 10000
      )}`
    });
    const roomName = colyseus.roomNames[0] ?? MULTIPLAYER_DEMO_ROOM_NAME;
    const roomA = await createLocalMultiplayerDemoHost({
      endpoint: colyseus.endpoint,
      roomName,
      sessionId: "room-alpha"
    });
    const roomB = await createLocalMultiplayerDemoHost({
      endpoint: colyseus.endpoint,
      roomName,
      sessionId: "room-bravo"
    });
    const clientA = createClient(roomA, "client-alpha");
    const clientB = createClient(roomB, "client-bravo");

    try {
      await clientA.connect();
      await clientB.connect();
      await waitFor(() => countActivePeers(roomA) === 2 && countActivePeers(roomB) === 2);

      await clientA.sendCommand({ type: "confirm", objectId: "relay-alpha" });
      await waitFor(() =>
        roomA.hostMessages.some(
          (message) => message.kind === "game.command" && message.sourcePeerId === "client-alpha"
        )
      );

      roomA.tick();
      roomB.tick();

      expect(roomA.app.snapshot().state.confirmations).toBe(1);
      expect(roomB.app.snapshot().state.confirmations).toBe(0);
      expect(countActivePeers(roomA)).toBe(2);
      expect(countActivePeers(roomB)).toBe(2);
    } finally {
      await clientA.dispose();
      await clientB.dispose();
      await roomA.dispose();
      await roomB.dispose();
      await colyseus.dispose();
    }
  });

  it("synchronizes the realtime arena through the host authoritative room", async () => {
    const colyseus = await createGameKitsColyseusServer({
      roomName: `${MULTIPLAYER_DEMO_ROOM_NAME}_realtime_${Date.now()}_${Math.floor(
        Math.random() * 10000
      )}`
    });
    const host = await createLocalMultiplayerDemoHost({
      endpoint: colyseus.endpoint,
      roomName: colyseus.roomNames[0] ?? MULTIPLAYER_DEMO_ROOM_NAME,
      sessionId: "realtime-room"
    });
    const clientA = createClient(host, "client-a", "Runner");
    const clientB = createClient(host, "client-b", "Runner");
    const lateClient = createClient(host, "client-late", "Late Runner");
    let resumedClientB: MultiplayerDemoClient | undefined;

    try {
      await clientA.connect();
      await clientB.connect();
      host.tick(50);

      await waitFor(() => host.realtime.snapshot().snapshot.players.length === 2);
      await waitFor(
        () =>
          clientA.latestRealtimeSnapshot()?.snapshot.players.length === 2 &&
          clientB.latestRealtimeSnapshot()?.snapshot.players.length === 2
      );
      await waitFor(() => {
        const labels = host.realtime
          .snapshot()
          .snapshot.players.map((player) => player.label)
          .sort();
        return labels.join(",") === "Runner,Runner 2";
      });
      await waitFor(
        () =>
          clientA
            .latestRealtimeSnapshot()
            ?.snapshot.players.map((player) => player.label)
            .sort()
            .join(",") === "Runner,Runner 2" &&
          clientB
            .latestRealtimeSnapshot()
            ?.snapshot.players.map((player) => player.label)
            .sort()
            .join(",") === "Runner,Runner 2"
      );
      const hostSnapshotBeforeSpoof = clientA.latestRealtimeSnapshot();
      await clientB.runtime.send({
        channel: REALTIME_ARENA_CHANNEL,
        kind: REALTIME_ARENA_SNAPSHOT_KIND,
        payload: {}
      });
      await new Promise((resolve) => setTimeout(resolve, 30));
      expect(clientA.latestRealtimeSnapshot()).toBe(hostSnapshotBeforeSpoof);

      await clientA.sendRealtimeAction({ type: "start" });
      await waitForHostRealtimeMessages(host, REALTIME_ARENA_ACTION_KIND, 1);
      host.tick(50);
      await waitFor(
        () => findSnapshotPlayer(host.realtime.snapshot().snapshot, "client-a").ready === true
      );
      expect(host.realtime.snapshot().snapshot.phase).toBe("lobby");
      expect(findSnapshotPlayer(host.realtime.snapshot().snapshot, "client-b").ready).toBe(false);

      await clientA.sendRealtimeAction({ type: "ready", ready: true });
      await clientB.sendRealtimeAction({ type: "ready", ready: true });
      await waitForHostRealtimeMessages(host, REALTIME_ARENA_ACTION_KIND, 3);
      host.tick(50);
      await waitFor(() =>
        host.realtime.snapshot().snapshot.players.every((player) => player.ready)
      );
      host.tick(50);
      await waitFor(
        () =>
          clientA.latestRealtimeSnapshot()?.snapshot.players.every((player) => player.ready) ===
            true &&
          clientB.latestRealtimeSnapshot()?.snapshot.players.every((player) => player.ready) ===
            true
      );

      await clientA.sendRealtimeAction({ type: "start" });
      await waitForHostRealtimeMessages(host, REALTIME_ARENA_ACTION_KIND, 4);
      host.tick(50);
      await waitFor(() => host.realtime.snapshot().snapshot.phase === "countdown");
      host.tick(1800);
      await waitFor(
        () =>
          clientA.latestRealtimeSnapshot()?.snapshot.phase === "running" &&
          clientB.latestRealtimeSnapshot()?.snapshot.phase === "running"
      );

      const playerAId = clientA.latestRealtimeSnapshot()?.playersByPeerId[clientA.peerId];
      expect(playerAId).toBe("client-a");
      const beforeX = findSnapshotPlayer(host.realtime.snapshot().snapshot, playerAId).position.x;
      await clientA.sendRealtimeInput({
        sequence: 1,
        clientTime: 0,
        moveX: 1,
        moveY: 0,
        sprint: false
      });
      await clientA.sendRealtimeInput({
        sequence: 2,
        clientTime: 50,
        moveX: 1,
        moveY: 0,
        sprint: false
      });
      await waitForHostRealtimeMessages(host, REALTIME_ARENA_INPUT_KIND, 2);
      host.tick(50);
      await waitFor(
        () =>
          findSnapshotPlayer(host.realtime.snapshot().snapshot, playerAId).lastInputSequence === 2
      );
      const afterFirstInputX = findSnapshotPlayer(host.realtime.snapshot().snapshot, playerAId)
        .position.x;
      expect(afterFirstInputX - beforeX).toBeCloseTo(7.75);
      expect(host.realtime.diagnostics()).toMatchObject({
        coalescedInputs: 1,
        queuedInputs: 0,
        maxQueuedInputs: 1
      });

      host.tick(50);
      const afterSecondInputX = findSnapshotPlayer(host.realtime.snapshot().snapshot, playerAId)
        .position.x;
      expect(afterSecondInputX - afterFirstInputX).toBeCloseTo(7.75);

      await clientA.sendRealtimeInput({
        sequence: 3,
        clientTime: 100,
        moveX: 0,
        moveY: 0,
        sprint: false
      });
      await waitForHostRealtimeMessages(host, REALTIME_ARENA_INPUT_KIND, 3);
      host.tick(50);
      await waitFor(
        () =>
          findSnapshotPlayer(host.realtime.snapshot().snapshot, playerAId).lastInputSequence === 3
      );
      const afterReleaseX = findSnapshotPlayer(host.realtime.snapshot().snapshot, playerAId)
        .position.x;
      expect(afterReleaseX).toBeCloseTo(afterSecondInputX);
      await waitFor(() => {
        const snapshotA = clientA.latestRealtimeSnapshot();
        const snapshotB = clientB.latestRealtimeSnapshot();
        if (!snapshotA || !snapshotB) {
          return false;
        }

        const playerAOnA = findSnapshotPlayer(snapshotA.snapshot, playerAId);
        const playerAOnB = findSnapshotPlayer(snapshotB.snapshot, playerAId);
        return (
          playerAOnA.position.x === afterReleaseX &&
          playerAOnA.position.x === playerAOnB.position.x &&
          playerAOnA.position.y === playerAOnB.position.y
        );
      });

      const authorityPlayerA = host.realtime.state.players.find(
        (player) => player.id === playerAId
      );
      const authorityCore = host.realtime.state.cores[0];
      expect(authorityPlayerA).toBeDefined();
      expect(authorityCore).toBeDefined();
      if (!authorityPlayerA || !authorityCore) {
        throw new Error("Expected authoritative player and core.");
      }
      authorityPlayerA.position = { ...authorityCore.position };
      await clientA.sendRealtimeAction({ type: "interact" });
      await waitForHostRealtimeMessages(host, REALTIME_ARENA_ACTION_KIND, 5);
      host.tick(50);
      await waitFor(() => {
        const observerSnapshot = clientB.latestRealtimeSnapshot();
        return (
          observerSnapshot !== undefined &&
          findSnapshotPlayer(observerSnapshot.snapshot, playerAId).carryingCoreId ===
            authorityCore.id
        );
      });

      await clientB.sendRealtimeInput({
        sequence: 7,
        clientTime: 350,
        moveX: 0,
        moveY: 0,
        sprint: false
      });
      await waitForHostRealtimeMessages(host, REALTIME_ARENA_INPUT_KIND, 4);
      host.tick(50);
      await waitFor(
        () =>
          findSnapshotPlayer(host.realtime.snapshot().snapshot, clientB.peerId)
            .lastInputSequence === 7
      );

      await lateClient.connect();
      await waitFor(() => countActivePeers(host) === 4);
      host.tick(50);
      await waitFor(() => {
        const snapshot = lateClient.latestRealtimeSnapshot();
        return (
          snapshot?.participantsByPeerId?.[lateClient.peerId]?.status === "next-round" &&
          snapshot.playersByPeerId[lateClient.peerId] === undefined &&
          snapshot.snapshot.players.every((player) => player.id !== lateClient.peerId)
        );
      });
      expect(host.realtime.snapshot().participantSummary).toEqual({
        active: 2,
        tracked: 3,
        round: 2,
        waiting: 1,
        disconnected: 0
      });

      await lateClient.sendRealtimeInput({
        sequence: 1,
        clientTime: 0,
        moveX: 1,
        moveY: 0,
        sprint: false
      });
      await waitForHostRealtimeMessages(host, REALTIME_ARENA_INPUT_KIND, 5);
      host.tick(50);
      expect(host.realtime.diagnostics().lastAction).toMatchObject({
        accepted: false,
        code: "participant-waiting"
      });

      await clientB.dispose();
      await waitFor(() => countActivePeers(host) === 3);
      host.tick(50);
      await waitFor(() => {
        const hostSnapshot = host.realtime.snapshot();
        const clientSnapshot = clientA.latestRealtimeSnapshot();
        if (!clientSnapshot) {
          return false;
        }
        return (
          findSnapshotPlayer(hostSnapshot.snapshot, clientB.peerId).connected === false &&
          findSnapshotPlayer(clientSnapshot.snapshot, clientB.peerId).connected === false &&
          clientSnapshot.playersByPeerId[clientB.peerId] === undefined &&
          clientSnapshot.participantsByPeerId?.[clientB.peerId]?.status === "disconnected"
        );
      });
      expect(host.realtime.snapshot().participantSummary).toEqual({
        active: 1,
        tracked: 3,
        round: 2,
        waiting: 1,
        disconnected: 1
      });

      const disconnectedPlayer = findSnapshotPlayer(
        host.realtime.snapshot().snapshot,
        clientB.peerId
      );
      resumedClientB = createClient(host, "client-b", "Runner");
      await resumedClientB.connect();
      await waitFor(() => countActivePeers(host) === 4);
      host.tick(50);
      await waitFor(() => {
        const snapshot = clientA.latestRealtimeSnapshot();
        const participant = snapshot?.participantsByPeerId?.[clientB.peerId];
        const player = snapshot?.snapshot.players.find(
          (candidate) => candidate.id === clientB.peerId
        );
        return (
          snapshot?.playersByPeerId[clientB.peerId] === clientB.peerId &&
          participant?.status === "active" &&
          participant.slot === disconnectedPlayer.slot &&
          player?.connected === true
        );
      });
      expect(
        findSnapshotPlayer(host.realtime.snapshot().snapshot, clientB.peerId).lastInputSequence
      ).toBe(0);

      await resumedClientB.sendRealtimeInput({
        sequence: 1,
        clientTime: 0,
        moveX: 0,
        moveY: 0,
        sprint: false
      });
      await waitForHostRealtimeMessages(host, REALTIME_ARENA_INPUT_KIND, 6);
      host.tick(50);
      await waitFor(() => {
        const snapshot = clientA.latestRealtimeSnapshot();
        return (
          snapshot?.inputAcksByPeerId[clientB.peerId] === 1 &&
          findSnapshotPlayer(snapshot.snapshot, clientB.peerId).lastInputSequence === 1
        );
      });

      await resumedClientB.dispose();
      resumedClientB = undefined;
      await waitFor(() => countActivePeers(host) === 3);
      host.tick(50);
      await waitFor(
        () =>
          clientA.latestRealtimeSnapshot()?.participantsByPeerId?.[clientB.peerId]?.status ===
          "disconnected"
      );

      host.tick(host.realtime.state.rules.roundDurationMs);
      host.tick(host.realtime.state.rules.endingDurationMs);
      await waitFor(() => clientA.latestRealtimeSnapshot()?.snapshot.phase === "results");
      await clientA.sendRealtimeAction({ type: "rematch" });
      await waitForHostRealtimeMessages(host, REALTIME_ARENA_ACTION_KIND, 6);
      host.tick(50);
      await waitFor(() => {
        const snapshot = clientA.latestRealtimeSnapshot();
        return (
          snapshot?.snapshot.phase === "lobby" &&
          snapshot.playersByPeerId[lateClient.peerId] === lateClient.peerId &&
          snapshot.participantsByPeerId?.[lateClient.peerId]?.status === "active" &&
          snapshot.participantsByPeerId?.[clientB.peerId] === undefined &&
          snapshot.snapshot.players
            .map((player) => player.id)
            .sort()
            .join(",") === "client-a,client-late"
        );
      });
      expect(host.realtime.snapshot().participantSummary).toEqual({
        active: 2,
        tracked: 2,
        round: 2,
        waiting: 0,
        disconnected: 0
      });
    } finally {
      await clientA.dispose();
      await clientB.dispose();
      await resumedClientB?.dispose();
      await lateClient.dispose();
      await host.dispose();
      await colyseus.dispose();
    }
  });

  it("synchronizes the same arena view model through Colyseus Schema state", async () => {
    const host = await createLocalMultiplayerDemoServer({
      roomName: `${MULTIPLAYER_DEMO_ROOM_NAME}_schema_${Date.now()}`,
      sessionId: "schema-realtime-room",
      authoritativePath: "colyseus-schema"
    });
    const clientA = createClient(host, "schema-client-a", "Schema A");
    const clientB = createClient(host, "schema-client-b", "Schema B");

    try {
      await clientA.connect();
      await clientB.connect();
      host.tick(50);
      await waitFor(
        () =>
          clientA.latestRealtimeSnapshot()?.snapshot.players.length === 2 &&
          clientB.latestRealtimeSnapshot()?.snapshot.players.length === 2
      );

      expect(clientA.authoritativePath).toBe("colyseus-schema");
      expect(clientA.nativeStateDiagnostics()).toMatchObject({
        authoritativePath: "colyseus-schema",
        appliedUpdates: expect.any(Number),
        rejectedUpdates: 0
      });
      expect(clientA.nativeStateDiagnostics()!.appliedUpdates).toBeGreaterThan(0);
      expect(
        host.hostMessages.some((message) => message.kind === REALTIME_ARENA_SNAPSHOT_KIND)
      ).toBe(false);

      await clientA.sendRealtimeAction({ type: "ready", ready: true });
      await clientB.sendRealtimeAction({ type: "ready", ready: true });
      await waitForHostRealtimeMessages(host, REALTIME_ARENA_ACTION_KIND, 2);
      host.tick(50);
      await clientA.sendRealtimeAction({ type: "start" });
      await waitForHostRealtimeMessages(host, REALTIME_ARENA_ACTION_KIND, 3);
      host.tick(50);
      host.tick(1800);
      await waitFor(
        () =>
          clientA.latestRealtimeSnapshot()?.snapshot.phase === "running" &&
          clientB.latestRealtimeSnapshot()?.snapshot.phase === "running"
      );

      const beforeX = findSnapshotPlayer(clientB.latestRealtimeSnapshot()!.snapshot, clientA.peerId)
        .position.x;
      await clientA.sendRealtimeInput({
        sequence: 1,
        clientTime: 0,
        moveX: 1,
        moveY: 0,
        sprint: false
      });
      await waitForHostRealtimeMessages(host, REALTIME_ARENA_INPUT_KIND, 1);
      host.tick(50);
      await waitFor(
        () =>
          findSnapshotPlayer(clientB.latestRealtimeSnapshot()!.snapshot, clientA.peerId).position
            .x > beforeX
      );

      expect(clientA.latestRealtimeSnapshot()).toEqual(clientB.latestRealtimeSnapshot());
      const nativeDiagnostics = clientB.nativeStateDiagnostics();
      expect(nativeDiagnostics).toMatchObject({
        appliedUpdates: expect.any(Number),
        lastStateVersion: expect.any(Number),
        lastVersion: "realtime-arena.v1"
      });
      expect(nativeDiagnostics?.rejectedUpdates, JSON.stringify(nativeDiagnostics)).toBe(0);
    } finally {
      await clientA.dispose();
      await clientB.dispose();
      await host.dispose();
    }
  });
});

function createClient(
  host: LocalMultiplayerDemoHost,
  peerId: string,
  displayName = peerId
): MultiplayerDemoClient {
  return createMultiplayerDemoClient({
    endpoint: host.endpoint,
    roomName: host.roomName,
    sessionId: host.sessionId,
    hostPeerId: host.hostPeerId,
    peerId,
    displayName,
    authoritativePath: host.authoritativePath
  });
}

function countActivePeers(host: LocalMultiplayerDemoHost): number {
  return host.host
    .peers()
    .filter(
      (peer) => peer.status === "joining" || peer.status === "connected" || peer.status === "ready"
    ).length;
}

async function waitForHostRealtimeMessages(
  host: LocalMultiplayerDemoHost,
  kind: string,
  count: number
): Promise<void> {
  await waitFor(
    () =>
      host.hostMessages.filter(
        (message) => message.kind === kind && message.sourcePeerId !== host.hostPeerId
      ).length >= count
  );
}

function findSnapshotPlayer(
  snapshot: RealtimeArenaSnapshot,
  playerId: string | undefined
): RealtimeArenaSnapshot["players"][number] {
  expect(playerId).toBeDefined();
  const player = snapshot.players.find((candidate) => candidate.id === playerId);
  expect(player).toBeDefined();
  return player as RealtimeArenaSnapshot["players"][number];
}
