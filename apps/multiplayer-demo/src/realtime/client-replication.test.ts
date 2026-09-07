import {
  createMultiplayerAuthorityBindingStore,
  createMultiplayerRuntime
} from "@gamekits/multiplayer-core";
import { createMemoryMultiplayerBackend } from "@gamekits/multiplayer-memory";
import { describe, expect, it, vi } from "vitest";
import { createRealtimeArenaState, captureRealtimeArenaSnapshot } from "./domain";
import { createRealtimeArenaClientReplication } from "./client-replication";
import {
  REALTIME_ARENA_CHANNEL,
  REALTIME_ARENA_SNAPSHOT_KIND,
  type RealtimeArenaSnapshotPayload
} from "./protocol";
import { REALTIME_ARENA_SCHEMA_VERSION } from "./authority-path";

describe("realtime arena managed client replication", () => {
  it("owns snapshot playback, input sequencing, prediction, and reconciliation", async () => {
    const backend = createMemoryMultiplayerBackend();
    const host = createMultiplayerRuntime({ id: "managed-host", backend, clock: () => 100 });
    const client = createMultiplayerRuntime({ id: "managed-client", backend, clock: () => 100 });
    await host.createSession({
      id: "managed-room",
      authority: "host-authoritative",
      localPeer: { id: "host", role: "host" }
    });
    await client.joinSession({
      sessionId: "managed-room",
      localPeer: { id: "client", role: "client" }
    });
    const binding = createMultiplayerAuthorityBindingStore({
      sessionId: "managed-room",
      mode: "host-authoritative",
      authorityPeerId: "host",
      localPlayerId: "runner"
    });
    const state = createRealtimeArenaState({
      players: [{ id: "runner", teamId: "green" }]
    });
    state.phase = "running";
    const sentInputs: Array<{ sequence: number; moveX: number }> = [];
    const replication = createRealtimeArenaClientReplication({
      runtime: client,
      authority: binding,
      peerId: "client",
      readInput(elapsed) {
        return {
          sequence: 0,
          clientTime: elapsed,
          moveX: 1,
          moveY: 0,
          sprint: false
        };
      },
      async sendInput(frame) {
        sentInputs.push({ sequence: frame.sequence, moveX: frame.moveX });
      },
      wallClock: () => 100
    });
    const initial = createPayload(state, 0);
    const startX = initial.snapshot.players[0]?.position.x ?? 0;
    await host.send({
      channel: REALTIME_ARENA_CHANNEL,
      kind: REALTIME_ARENA_SNAPSHOT_KIND,
      targetPeerIds: ["client"],
      tick: 0,
      payload: initial
    });

    replication.update({ delta: 0, elapsed: 0 });
    expect(sentInputs).toEqual([{ sequence: 1, moveX: 1 }]);
    expect(replication.authoritativePayload()?.snapshot.tick).toBe(0);
    replication.update({ delta: 25, elapsed: 25 });
    await vi.waitFor(() => {
      expect(replication.diagnostics().replication.sentInputs).toBe(1);
    });
    expect(replication.presentedSnapshot()?.players[0]?.position.x).toBeGreaterThan(startX);
    expect(replication.diagnostics()).toMatchObject({
      replication: { sentInputs: 1 },
      prediction: { lastPredictedSequence: 1, pendingInputs: 1 }
    });

    state.players[0]!.lastInputSequence = 1;
    state.tick = 1;
    await host.send({
      channel: REALTIME_ARENA_CHANNEL,
      kind: REALTIME_ARENA_SNAPSHOT_KIND,
      targetPeerIds: ["client"],
      tick: 1,
      payload: createPayload(state, 1)
    });
    replication.update({ delta: 25, elapsed: 50 });
    expect(replication.diagnostics().prediction).toMatchObject({
      inputAckSequence: 1,
      pendingInputs: 1,
      lastAcknowledgedSequence: 1
    });

    replication.dispose();
    await client.dispose();
    await host.dispose();
  });

  it("rejects authority/version/stale faults, bounds prediction during loss, and recovers on ack", async () => {
    const backend = createMemoryMultiplayerBackend();
    const host = createMultiplayerRuntime({ id: "fault-host", backend, clock: () => 100 });
    const client = createMultiplayerRuntime({ id: "fault-client", backend, clock: () => 100 });
    const rogue = createMultiplayerRuntime({ id: "fault-rogue", backend, clock: () => 100 });
    await host.createSession({
      id: "fault-room",
      authority: "host-authoritative",
      localPeer: { id: "host", role: "host" }
    });
    await client.joinSession({
      sessionId: "fault-room",
      localPeer: { id: "client", role: "client" }
    });
    await rogue.joinSession({
      sessionId: "fault-room",
      localPeer: { id: "rogue", role: "client" }
    });
    const binding = createMultiplayerAuthorityBindingStore({
      sessionId: "fault-room",
      mode: "host-authoritative",
      authorityPeerId: "host",
      localPlayerId: "runner"
    });
    const state = createRealtimeArenaState({
      players: [{ id: "runner", teamId: "green" }]
    });
    state.phase = "running";
    const sentInputs: number[] = [];
    const replication = createRealtimeArenaClientReplication({
      runtime: client,
      authority: binding,
      peerId: "client",
      readInput(elapsed) {
        return {
          sequence: 0,
          clientTime: elapsed,
          moveX: 1,
          moveY: 0,
          sprint: false
        };
      },
      async sendInput(frame) {
        sentInputs.push(frame.sequence);
      },
      wallClock: () => 100
    });

    await host.send({
      channel: REALTIME_ARENA_CHANNEL,
      kind: REALTIME_ARENA_SNAPSHOT_KIND,
      targetPeerIds: ["client"],
      tick: 0,
      schemaVersion: REALTIME_ARENA_SCHEMA_VERSION,
      payload: createPayload(state, 0)
    });
    replication.update({ delta: 0, elapsed: 0 });

    await host.send({
      channel: REALTIME_ARENA_CHANNEL,
      kind: REALTIME_ARENA_SNAPSHOT_KIND,
      targetPeerIds: ["client"],
      tick: 1,
      schemaVersion: "realtime-arena.incompatible",
      payload: createPayload(state, 0)
    });
    await rogue.send({
      channel: REALTIME_ARENA_CHANNEL,
      kind: REALTIME_ARENA_SNAPSHOT_KIND,
      targetPeerIds: ["client"],
      tick: 2,
      schemaVersion: REALTIME_ARENA_SCHEMA_VERSION,
      payload: createPayload(state, 0)
    });
    replication.update({ delta: 0, elapsed: 0 });
    expect(replication.authoritativePayload()?.snapshot.tick).toBe(0);
    expect(replication.diagnostics().replication).toMatchObject({ rejectedSnapshots: 2 });

    for (let frame = 1; frame <= 12; frame += 1) {
      replication.update({ delta: 50, elapsed: frame * 50 });
      await Promise.resolve();
    }
    expect(sentInputs).toHaveLength(8);
    expect(replication.diagnostics().prediction).toMatchObject({ pendingInputs: 8 });
    expect(replication.diagnostics().replication.throttledInputs).toBeGreaterThan(0);

    state.tick = 3;
    await host.send({
      channel: REALTIME_ARENA_CHANNEL,
      kind: REALTIME_ARENA_SNAPSHOT_KIND,
      targetPeerIds: ["client"],
      tick: 3,
      schemaVersion: REALTIME_ARENA_SCHEMA_VERSION,
      payload: createPayload(state, 8)
    });
    replication.update({ delta: 0, elapsed: 600 });
    expect(replication.authoritativePayload()?.snapshot.tick).toBe(3);
    expect(replication.diagnostics().prediction).toMatchObject({
      lastAcknowledgedSequence: 8,
      pendingInputs: 0
    });

    state.tick = 2;
    await host.send({
      channel: REALTIME_ARENA_CHANNEL,
      kind: REALTIME_ARENA_SNAPSHOT_KIND,
      targetPeerIds: ["client"],
      tick: 2,
      schemaVersion: REALTIME_ARENA_SCHEMA_VERSION,
      payload: createPayload(state, 8)
    });
    replication.update({ delta: 0, elapsed: 600 });
    expect(replication.authoritativePayload()?.snapshot.tick).toBe(3);
    expect(replication.diagnostics().replication).toMatchObject({
      rejectedSnapshots: 3,
      lastRejectedCode: "stale-snapshot"
    });

    replication.dispose();
    await rogue.dispose();
    await client.dispose();
    await host.dispose();
  });
});

function createPayload(
  state: ReturnType<typeof createRealtimeArenaState>,
  acknowledgedSequence: number
): RealtimeArenaSnapshotPayload {
  return {
    snapshot: captureRealtimeArenaSnapshot(state),
    playersByPeerId: { client: "runner" },
    inputAcksByPeerId: { client: acknowledgedSequence },
    serverTime: 100
  };
}
