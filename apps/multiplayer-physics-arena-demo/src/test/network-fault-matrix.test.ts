import { createMemoryMultiplayerBackend } from "@gamekits/multiplayer-memory";
import {
  createMultiplayerAuthorityBindingStore,
  createMultiplayerAuthorityHostLoop,
  createMultiplayerFixedStepInputBundle,
  createMultiplayerNetworkConditionSimulator,
  createMultiplayerPredictedLifecycleDomain,
  createMultiplayerRuntime,
  createMultiplayerSpeculativeEffectJournal,
  type MultiplayerFixedStepInputFrame,
  type MultiplayerNetworkConditionProfile
} from "@gamekits/multiplayer-core";
import { createMemoryPhysicsBackend } from "@gamekits/physics-core";
import { describe, expect, it } from "vitest";

import { createArenaAuthorityRuntime } from "../server/arena-authority";
import { arenaParticipantCommandEpoch } from "../shared/arena-identity";
import {
  ARENA_ACTION_KIND,
  ARENA_FIXED_STEP_MS,
  ARENA_INPUT_KIND,
  ARENA_SCHEMA_VERSION,
  ARENA_SNAPSHOT_INTERVAL_TICKS,
  ARENA_SNAPSHOT_KIND
} from "../shared/config";
import { readArenaMoveInput, readArenaSnapshot, type ArenaSnapshot } from "../shared/protocol";

type FaultSnapshot = Pick<ArenaSnapshot, "schemaVersion"> & { tick: number; ack: number };

const MATRIX: Array<{
  name: string;
  profile: MultiplayerNetworkConditionProfile;
  maximumAckLag: number;
}> = [
  {
    name: "baseline",
    profile: { latencyMs: 0, jitterMs: 0, lossPercent: 0, seed: 11 },
    maximumAckLag: 4
  },
  {
    name: "50ms latency and 20ms jitter",
    profile: { latencyMs: 50, jitterMs: 20, lossPercent: 0, seed: 22 },
    maximumAckLag: 12
  },
  {
    name: "100ms latency, 30ms jitter and 2% loss",
    profile: { latencyMs: 100, jitterMs: 30, lossPercent: 2, seed: 33 },
    maximumAckLag: 24
  },
  {
    name: "150ms latency, 50ms jitter, 5% loss and duplicates",
    profile: {
      latencyMs: 150,
      jitterMs: 50,
      lossPercent: 5,
      duplicatePercent: 2,
      seed: 44
    },
    maximumAckLag: 36
  }
];

describe("Knockout Arena deterministic network fault matrix", () => {
  for (const matrixCase of MATRIX) {
    it(matrixCase.name, async () => {
      const result = await runMatrixCase(matrixCase.profile);
      expect(result.finalSequence - result.acknowledgedSequence).toBeLessThanOrEqual(
        matrixCase.maximumAckLag
      );
      expect(result.processedSequences).toEqual(
        [...result.processedSequences].sort((left, right) => left - right)
      );
      expect(new Set(result.processedSequences).size).toBe(result.processedSequences.length);
      expect(result.authorityDiagnostics.rejectedInputs).toBe(0);
      expect(result.authorityDiagnostics.fixedStepInput).toMatchObject({
        queuedFrames: expect.any(Number),
        frameCapacityRejections: 0,
        sourceCapacityRejections: 0
      });
      expect(result.networkDiagnostics.capacityDrops).toBe(0);
      expect(result.networkDiagnostics.deliveryErrors).toBe(0);
      expect(result.acknowledgements).toEqual(
        [...result.acknowledgements].sort((left, right) => left - right)
      );
      if ((matrixCase.profile.lossPercent ?? 0) > 0) {
        expect(result.networkDiagnostics.droppedMessages).toBeGreaterThan(0);
        expect(result.authorityDiagnostics.fixedStepInput?.duplicateFrames ?? 0).toBeGreaterThan(0);
      }
    });
  }

  it("settles predicted item spawn, action, and hit once across loss, duplicates, and gaps", async () => {
    const simulator = createMultiplayerNetworkConditionSimulator(
      createMemoryMultiplayerBackend({ id: "arena.item-fault" }),
      {
        latencyMs: 90,
        jitterMs: 35,
        lossPercent: 8,
        duplicatePercent: 25,
        seed: 404,
        maxPendingDeliveries: 512,
        affects: (direction, message) =>
          direction === "outgoing" && message.kind === "arena.item-fault.snapshot"
      }
    );
    const host = createMultiplayerRuntime({
      id: "arena.item-fault.host",
      backend: simulator.backend
    });
    const client = createMultiplayerRuntime({
      id: "arena.item-fault.client",
      backend: simulator.backend
    });
    await host.createSession({
      id: "arena-item-fault",
      authority: "host-authoritative",
      localPeer: { id: "host", role: "host" }
    });
    await client.joinSession({
      sessionId: "arena-item-fault",
      localPeer: { id: "client", role: "client" }
    });
    const lifecycle = createMultiplayerPredictedLifecycleDomain<number, number>({
      kind: "arena-item",
      generation: "stage-1",
      stepMs: ARENA_FIXED_STEP_MS,
      maxPending: 8,
      maxResolved: 32,
      maxBindings: 8
    });
    const journal = createMultiplayerSpeculativeEffectJournal<number, number>({
      generation: "stage-1",
      maxPending: 8,
      maxResolved: 32,
      maxAgeTicks: 120
    });
    lifecycle.register({ correlationId: "throw-1", localId: "item.local.g2", tick: 10, value: 1 });
    journal.anticipate({ effectId: "item-action:throw-1", tick: 10, value: 1 });
    journal.anticipate({ effectId: "item-hit:throw-1:bot.0", tick: 12, value: 2 });
    let deliveredFacts = 0;
    const unsubscribe = client.subscribe((message) => {
      if (message.kind !== "arena.item-fault.snapshot") return;
      const payload = message.payload as { tick: number; settled: boolean };
      if (!payload.settled) return;
      deliveredFacts += 1;
      lifecycle.sync({
        generation: "stage-1",
        authorityTime: payload.tick * ARENA_FIXED_STEP_MS,
        localTime: payload.tick * ARENA_FIXED_STEP_MS,
        authoritySpawns: [
          { correlationId: "throw-1", authorityId: "item.0.body.g2", tick: 18, value: 2 }
        ]
      });
      journal.resolve({
        effectId: "item-action:throw-1",
        generation: "stage-1",
        tick: 18,
        outcome: "confirm",
        authority: 1
      });
      journal.resolve({
        effectId: "item-hit:throw-1:bot.0",
        generation: "stage-1",
        tick: 20,
        outcome: "confirm",
        authority: 2
      });
    });

    for (let index = 0; index < 48; index += 1) {
      await host.send({
        channel: "reliable",
        kind: "arena.item-fault.snapshot",
        payload: { tick: 18 + index * 3, settled: index >= 4 }
      });
      await simulator.advance(ARENA_FIXED_STEP_MS);
    }
    await simulator.flush();

    expect(deliveredFacts).toBeGreaterThan(1);
    expect(lifecycle.diagnostics()).toMatchObject({
      bindings: 1,
      spawns: { matched: 1, pending: 0 }
    });
    expect(journal.diagnostics()).toMatchObject({
      confirmed: 2,
      pending: 0,
      duplicates: expect.any(Number)
    });
    expect(journal.diagnostics().duplicates).toBeGreaterThan(0);
    expect(simulator.diagnostics()).toMatchObject({
      droppedMessages: expect.any(Number),
      duplicatedMessages: expect.any(Number),
      capacityDrops: 0,
      deliveryErrors: 0
    });
    expect(simulator.diagnostics().droppedMessages).toBeGreaterThan(0);
    expect(simulator.diagnostics().duplicatedMessages).toBeGreaterThan(0);

    unsubscribe();
    lifecycle.dispose();
    journal.dispose();
    await client.dispose();
    await host.dispose();
    simulator.dispose();
  });
});

describe("Knockout Arena gameplay network fault matrix", () => {
  // These cases run the full gameplay authority, so allow shared CI CPU contention.
  for (const matrixCase of MATRIX) {
    it(`projects gameplay under ${matrixCase.name}`, async () => {
      const result = await runGameplayMatrixCase(matrixCase.profile);
      expect(
        result.snapshots.length,
        JSON.stringify({
          authority: result.authorityDiagnostics,
          network: result.networkDiagnostics,
          host: result.hostSnapshot,
          client: result.clientSnapshot
        })
      ).toBeGreaterThan(10);
      expect(result.snapshots.some((snapshot) => snapshot.phase === "running")).toBe(true);
      expect(result.snapshots.at(-1)).toMatchObject({
        participants: expect.arrayContaining([
          expect.objectContaining({ peerId: "peer.gameplay", kind: "human-slot" })
        ]),
        authority: {
          acceptedInputs: expect.any(Number),
          payloadBytes: expect.any(Number),
          activePeers: 1
        }
      });
      expect(result.snapshots.at(-1)?.authority.acceptedInputs ?? 0).toBeGreaterThan(0);
      expect(result.finalSequence - result.acknowledgedSequence).toBeLessThanOrEqual(
        matrixCase.maximumAckLag
      );
      expect(result.snapshotTicks).toEqual(
        [...result.snapshotTicks].sort((left, right) => left - right)
      );
      expect(result.membershipRevisions).toEqual(
        [...result.membershipRevisions].sort((left, right) => left - right)
      );
      expect(new Set(result.generations).size).toBe(1);
      expect(result.authorityDiagnostics.fixedStepInput).toMatchObject({
        frameCapacityRejections: 0,
        sourceCapacityRejections: 0
      });
      expect(result.networkDiagnostics).toMatchObject({
        capacityDrops: 0,
        deliveryErrors: 0
      });
      expect(result.retainedAfterDispose).toMatchObject({
        disposed: true,
        participants: 0,
        physicsMembers: 0,
        itemActions: 0,
        combatHits: 0,
        aiMemoryFacts: 0
      });
      if ((matrixCase.profile.lossPercent ?? 0) > 0) {
        expect(result.networkDiagnostics.droppedMessages).toBeGreaterThan(0);
        expect(result.maximumSnapshotGap).toBeGreaterThan(ARENA_SNAPSHOT_INTERVAL_TICKS);
      }
      if ((matrixCase.profile.duplicatePercent ?? 0) > 0) {
        expect(result.networkDiagnostics.duplicatedMessages).toBeGreaterThan(0);
        expect(result.duplicateSnapshots).toBeGreaterThan(0);
      }
    }, 15_000);
  }

  it("rejects delayed pre-reconnect input and item action epochs while keeping late join spectator-only", async () => {
    const result = await runPresenceEpochFaultCase();
    expect(result).toMatchObject({
      staleAcknowledgedSequence: 0,
      freshAcknowledgedSequence: 2,
      staleActionPublished: false,
      primary: { status: "active", connected: true },
      late: { kind: "spectator", status: "next-match", connected: true },
      participantIdsUnique: true
    });
    expect(result.rejectedInputs).toBeGreaterThan(0);
    expect(result.rejectedActions).toBeGreaterThan(0);
  });
});

async function runGameplayMatrixCase(profile: MultiplayerNetworkConditionProfile) {
  const simulator = createMultiplayerNetworkConditionSimulator(
    createMemoryMultiplayerBackend({ id: `arena.gameplay-fault.${profile.seed}` }),
    {
      ...profile,
      maxPendingDeliveries: 2_048,
      affects: (direction, message) =>
        direction === "outgoing" &&
        (message.kind === ARENA_INPUT_KIND || message.kind === ARENA_SNAPSHOT_KIND)
    }
  );
  const sessionId = `arena-gameplay-fault-${profile.seed}`;
  const authorityPeerId = `${sessionId}.server`;
  const host = createMultiplayerRuntime({
    id: `${sessionId}.host`,
    backend: simulator.backend,
    connectContext: { localPeer: { id: authorityPeerId, role: "server" } }
  });
  const client = createMultiplayerRuntime({
    id: `${sessionId}.client`,
    backend: simulator.backend,
    connectContext: { localPeer: { id: "peer.gameplay", role: "client" } }
  });
  await host.createSession({
    id: sessionId,
    authority: "server-authoritative",
    localPeer: { id: authorityPeerId, role: "server" }
  });
  await client.joinSession({
    sessionId,
    localPeer: { id: "peer.gameplay", role: "client" }
  });
  const authority = createArenaAuthorityRuntime({
    runtime: host,
    backend: createZeroGravityBackend(`gameplay-${profile.seed}`),
    sessionId,
    authorityPeerId,
    now: () => 1_000
  });
  const snapshots: ArenaSnapshot[] = [];
  const unsubscribe = client.subscribe((message) => {
    if (message.kind !== ARENA_SNAPSHOT_KIND) return;
    const snapshot = readArenaSnapshot(message.payload);
    if (snapshot !== undefined) snapshots.push(snapshot);
  });
  const pendingInputs = new Map<number, MultiplayerFixedStepInputFrame>();
  const totalFrames = 300;
  try {
    authority.tick();
    await simulator.advance(ARENA_FIXED_STEP_MS);
    for (let sequence = 1; sequence <= totalFrames; sequence += 1) {
      const snapshot = authority.latestSnapshot();
      const participant = snapshot.participants.find(
        (candidate) => candidate.peerId === "peer.gameplay"
      );
      if (participant === undefined) throw new Error("Gameplay fault peer was not bound");
      const frame: MultiplayerFixedStepInputFrame = {
        sequence,
        payload: {
          sequence,
          moveX: sequence % 120 < 60 ? 1 : -1,
          moveZ: -1,
          jump: sequence % 90 === 0,
          authorityEpoch: arenaParticipantCommandEpoch(
            snapshot.frame.generation,
            participant.revision
          )
        }
      };
      pendingInputs.set(sequence, frame);
      const authorityAck = snapshot.inputAcksByPeerId["peer.gameplay"] ?? 0;
      for (const pendingSequence of pendingInputs.keys()) {
        if (pendingSequence <= authorityAck) pendingInputs.delete(pendingSequence);
      }
      await client.send({
        channel: "reliable",
        kind: ARENA_INPUT_KIND,
        payload: createMultiplayerFixedStepInputBundle(
          selectGameplayRedundantFrames(pendingInputs, sequence)
        )
      });
      await simulator.advance(ARENA_FIXED_STEP_MS);
      authority.tick();
      await simulator.advance(0);
    }
    for (let recoveryTick = 0; recoveryTick < 90; recoveryTick += 1) {
      await simulator.advance(ARENA_FIXED_STEP_MS);
      authority.tick();
      await simulator.advance(0);
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    await simulator.flush();
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    await simulator.flush();

    const snapshotTicks = snapshots.map((snapshot) => snapshot.frame.tick);
    const membershipRevisions = snapshots.map((snapshot) => snapshot.match.membershipRevision);
    const generations = snapshots.map((snapshot) => String(snapshot.frame.generation));
    const duplicateSnapshots = snapshotTicks.filter(
      (tick, index) => index > 0 && tick === snapshotTicks[index - 1]
    ).length;
    const maximumSnapshotGap = snapshotTicks.reduce(
      (maximum, tick, index) =>
        index === 0 ? maximum : Math.max(maximum, tick - snapshotTicks[index - 1]!),
      0
    );
    const acknowledgedSequence = Math.max(
      0,
      ...snapshots.map((snapshot) => snapshot.inputAcksByPeerId["peer.gameplay"] ?? 0)
    );
    const authorityDiagnostics = authority.snapshot().input;
    const networkDiagnostics = simulator.diagnostics();
    const hostSnapshot = host.snapshot();
    const clientSnapshot = client.snapshot();
    authority.dispose();
    const retainedAfterDispose = authority.retainedState();
    return {
      snapshots,
      snapshotTicks,
      membershipRevisions,
      generations,
      duplicateSnapshots,
      maximumSnapshotGap,
      finalSequence: totalFrames,
      acknowledgedSequence,
      authorityDiagnostics,
      networkDiagnostics,
      hostSnapshot,
      clientSnapshot,
      retainedAfterDispose
    };
  } finally {
    unsubscribe();
    authority.dispose();
    await client.dispose();
    await host.dispose();
    simulator.dispose();
  }
}

async function runPresenceEpochFaultCase() {
  const simulator = createMultiplayerNetworkConditionSimulator(
    createMemoryMultiplayerBackend({ id: "arena.presence-epoch-fault" }),
    {
      latencyMs: 150,
      jitterMs: 0,
      lossPercent: 0,
      seed: 909,
      maxPendingDeliveries: 1_024,
      affects: (direction, message) =>
        direction === "outgoing" &&
        (message.kind === ARENA_INPUT_KIND ||
          message.kind === ARENA_ACTION_KIND ||
          message.kind === ARENA_SNAPSHOT_KIND)
    }
  );
  const sessionId = "arena-presence-epoch-fault";
  const authorityPeerId = `${sessionId}.server`;
  const host = createMultiplayerRuntime({
    id: `${sessionId}.host`,
    backend: simulator.backend,
    connectContext: { localPeer: { id: authorityPeerId, role: "server" } }
  });
  const primary = createMultiplayerRuntime({
    id: `${sessionId}.primary`,
    backend: simulator.backend,
    connectContext: { localPeer: { id: "peer.primary", role: "client" } }
  });
  const late = createMultiplayerRuntime({
    id: `${sessionId}.late`,
    backend: simulator.backend,
    connectContext: { localPeer: { id: "peer.late", role: "client" } }
  });
  await host.createSession({
    id: sessionId,
    authority: "server-authoritative",
    localPeer: { id: authorityPeerId, role: "server" }
  });
  await primary.joinSession({
    sessionId,
    localPeer: { id: "peer.primary", role: "client" }
  });
  const authority = createArenaAuthorityRuntime({
    runtime: host,
    backend: createZeroGravityBackend("presence-epoch"),
    sessionId,
    authorityPeerId,
    now: () => 1_000
  });
  try {
    for (let tick = 0; tick < 190; tick += 1) {
      authority.tick();
      await simulator.advance(ARENA_FIXED_STEP_MS);
    }
    const beforeDisconnect = authority.latestSnapshot();
    const participantBefore = beforeDisconnect.participants.find(
      (candidate) => candidate.peerId === "peer.primary"
    );
    if (participantBefore === undefined) throw new Error("Primary participant was not bound");
    const staleEpoch = arenaParticipantCommandEpoch(
      beforeDisconnect.frame.generation,
      participantBefore.revision
    );
    const staleItem = beforeDisconnect.items[0];
    await primary.send({
      channel: "reliable",
      kind: ARENA_INPUT_KIND,
      payload: createMultiplayerFixedStepInputBundle([
        {
          sequence: 1,
          payload: {
            sequence: 1,
            moveX: 1,
            moveZ: -1,
            jump: false,
            authorityEpoch: staleEpoch
          }
        }
      ])
    });
    const staleCommandId = "peer.primary.stale.interact";
    await primary.send({
      id: staleCommandId,
      channel: "reliable",
      kind: ARENA_ACTION_KIND,
      correlationId: staleCommandId,
      payload: {
        type: "interact",
        commandId: staleCommandId,
        inputSequence: 1,
        aimX: 0,
        aimZ: -1,
        charge: 0,
        authorityEpoch: staleEpoch,
        ...(staleItem === undefined
          ? {}
          : {
              targetItemId: staleItem.id,
              targetItemGeneration: staleItem.instanceGeneration
            })
      }
    });

    await primary.leaveSession("epoch-fault");
    authority.tick();
    await primary.joinSession({
      sessionId,
      localPeer: { id: "peer.primary", role: "client" }
    });
    authority.tick();
    await late.joinSession({
      sessionId,
      localPeer: { id: "peer.late", role: "client" }
    });
    authority.tick();
    await simulator.advance(200);
    authority.tick();
    const afterStale = authority.latestSnapshot();

    const participantAfter = afterStale.participants.find(
      (candidate) => candidate.peerId === "peer.primary"
    );
    if (participantAfter === undefined) throw new Error("Primary participant did not reconnect");
    const freshEpoch = arenaParticipantCommandEpoch(
      afterStale.frame.generation,
      participantAfter.revision
    );
    await primary.send({
      channel: "reliable",
      kind: ARENA_INPUT_KIND,
      payload: createMultiplayerFixedStepInputBundle([
        {
          sequence: 2,
          payload: {
            sequence: 2,
            moveX: -1,
            moveZ: 0,
            jump: false,
            authorityEpoch: freshEpoch
          }
        }
      ])
    });
    await simulator.advance(200);
    authority.tick();
    authority.tick();
    const final = authority.latestSnapshot();
    const inputDiagnostics = authority.snapshot().input;
    const primaryFinal = final.participants.find(
      (candidate) => candidate.peerId === "peer.primary"
    );
    const lateFinal = final.participants.find((candidate) => candidate.peerId === "peer.late");
    return {
      staleAcknowledgedSequence: afterStale.inputAcksByPeerId["peer.primary"] ?? 0,
      freshAcknowledgedSequence: final.inputAcksByPeerId["peer.primary"] ?? 0,
      staleActionPublished: final.itemActions.some((action) => action.id === staleCommandId),
      primary: primaryFinal,
      late: lateFinal,
      participantIdsUnique:
        new Set(final.participants.map((participant) => participant.id)).size ===
        final.participants.length,
      rejectedInputs: inputDiagnostics.rejectedInputs,
      rejectedActions: inputDiagnostics.rejectedActions
    };
  } finally {
    authority.dispose();
    await late.dispose();
    await primary.dispose();
    await host.dispose();
    simulator.dispose();
  }
}

function createZeroGravityBackend(id: string) {
  const memory = createMemoryPhysicsBackend({ id: `${id}.physics`, dimension: "3d" });
  return {
    ...memory,
    createScene(config: Parameters<typeof memory.createScene>[0]) {
      return memory.createScene({ ...config, gravity: { x: 0, y: 0, z: 0 } });
    }
  };
}

function selectGameplayRedundantFrames(
  pending: ReadonlyMap<number, MultiplayerFixedStepInputFrame>,
  currentSequence: number
): MultiplayerFixedStepInputFrame[] {
  const current = pending.get(currentSequence);
  if (current === undefined) throw new Error("Missing current gameplay input frame");
  const ordered = [...pending.values()].sort((left, right) => left.sequence - right.sequence);
  if (ordered.length <= 6) return ordered;
  return [...ordered.slice(0, 5), current];
}

async function runMatrixCase(profile: MultiplayerNetworkConditionProfile) {
  const simulator = createMultiplayerNetworkConditionSimulator(
    createMemoryMultiplayerBackend({ id: `arena.fault.${profile.seed}` }),
    {
      ...profile,
      maxPendingDeliveries: 1_024,
      affects: (direction, message) =>
        direction === "outgoing" &&
        (message.kind === ARENA_INPUT_KIND || message.kind === ARENA_SNAPSHOT_KIND)
    }
  );
  const host = createMultiplayerRuntime({ id: "arena.fault.host", backend: simulator.backend });
  const client = createMultiplayerRuntime({
    id: "arena.fault.client",
    backend: simulator.backend
  });
  await host.createSession({
    id: "arena-fault-matrix",
    authority: "host-authoritative",
    localPeer: { id: "host", role: "host" }
  });
  await client.joinSession({
    sessionId: "arena-fault-matrix",
    localPeer: { id: "client", role: "client" }
  });
  let authorityAcknowledgedSequence = 0;
  let clientAcknowledgedSequence = 0;
  const acknowledgements: number[] = [];
  const processedSequences: number[] = [];
  const pendingInputs = new Map<number, MultiplayerFixedStepInputFrame>();
  const authority = createMultiplayerAuthorityHostLoop<
    never,
    ReturnType<typeof requireInput>,
    FaultSnapshot
  >({
    runtime: host,
    binding: createMultiplayerAuthorityBindingStore({
      sessionId: "arena-fault-matrix",
      mode: "host-authoritative",
      authorityPeerId: "host"
    }),
    inputKind: ARENA_INPUT_KIND,
    snapshotKind: ARENA_SNAPSHOT_KIND,
    readInput: readArenaMoveInput,
    inputSequence: (input) => input.sequence,
    inputDelivery: {
      mode: "redundant-bundle",
      maxBufferedFramesPerSource: 64,
      maxGapTicks: 3,
      gapPolicy: "hold-last"
    },
    maxInputsPerSourcePerTick: 1,
    maxQueuedInputsPerSource: 64,
    maxQueuedInputs: 128,
    handleInput({ message }) {
      const sequence = message.sequence;
      if (sequence !== undefined) {
        processedSequences.push(sequence);
        authorityAcknowledgedSequence = sequence;
      }
    },
    captureSnapshot: ({ tick }) => ({
      schemaVersion: ARENA_SCHEMA_VERSION,
      tick,
      ack: authorityAcknowledgedSequence
    })
  });
  const unsubscribe = client.subscribe((message) => {
    if (message.kind !== ARENA_SNAPSHOT_KIND) return;
    const snapshot = message.payload as FaultSnapshot;
    if (snapshot.ack > clientAcknowledgedSequence) clientAcknowledgedSequence = snapshot.ack;
    const last = acknowledgements.at(-1) ?? 0;
    if (snapshot.ack > last) acknowledgements.push(snapshot.ack);
    for (const sequence of pendingInputs.keys()) {
      if (sequence <= snapshot.ack) pendingInputs.delete(sequence);
    }
  });

  const totalFrames = 480;
  for (let sequence = 1; sequence <= totalFrames; sequence += 1) {
    const frame: MultiplayerFixedStepInputFrame = {
      sequence,
      payload: {
        sequence,
        moveX: sequence % 120 < 60 ? 1 : -1,
        moveZ: -1,
        jump: sequence % 90 === 0
      }
    };
    pendingInputs.set(sequence, frame);
    await client.send({
      channel: "reliable",
      kind: ARENA_INPUT_KIND,
      payload: createMultiplayerFixedStepInputBundle(selectRedundantFrames(pendingInputs, sequence))
    });
    await simulator.advance(ARENA_FIXED_STEP_MS);
    authority.beginTick(ARENA_FIXED_STEP_MS);
    await authority.commitTick();
    await simulator.advance(0);
  }
  for (let recoveryTick = 0; recoveryTick < 120; recoveryTick += 1) {
    await simulator.advance(ARENA_FIXED_STEP_MS);
    authority.beginTick(ARENA_FIXED_STEP_MS);
    await authority.commitTick();
    await simulator.advance(0);
  }
  await simulator.flush();

  const authorityDiagnostics = authority.diagnostics();
  const networkDiagnostics = simulator.diagnostics();
  unsubscribe();
  authority.dispose();
  await client.dispose();
  await host.dispose();
  simulator.dispose();
  return {
    finalSequence: totalFrames,
    acknowledgedSequence: clientAcknowledgedSequence,
    acknowledgements,
    processedSequences,
    authorityDiagnostics,
    networkDiagnostics
  };
}

function selectRedundantFrames(
  pending: ReadonlyMap<number, MultiplayerFixedStepInputFrame>,
  currentSequence: number
): MultiplayerFixedStepInputFrame[] {
  const current = pending.get(currentSequence);
  if (!current) throw new Error("Missing current fault-matrix input frame.");
  const ordered = [...pending.values()].sort((left, right) => left.sequence - right.sequence);
  if (ordered.length <= 8) return ordered;
  return [...ordered.slice(0, 7), current];
}

function requireInput(value: unknown) {
  const input = readArenaMoveInput(value);
  if (!input) throw new Error("Invalid Arena fault-matrix input.");
  return input;
}
