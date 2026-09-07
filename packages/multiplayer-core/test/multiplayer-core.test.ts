import { createEventBus } from "@gamekits/event-bus";
import { describe, expect, it } from "vitest";
import {
  createMultiplayerBridgeModule,
  createMultiplayerModule,
  createMultiplayerAuthorityBindingStore,
  createMultiplayerAuthorityDiagnostics,
  createMultiplayerAuthorityHostLoop,
  createMultiplayerAuthorityReceiver,
  createMultiplayerFixedStepInputBundle,
  createMultiplayerLocalAuthorityLoop,
  createMultiplayerPeerPlayerBindingStore,
  createMultiplayerParticipantPolicy,
  createMultiplayerPredictionBuffer,
  createMultiplayerRuntime,
  createSnapshotBuffer,
  createSnapshotPresentationProjector,
  createSnapshotPlayback,
  createUniqueMultiplayerDisplayName,
  definePredictionAngleStateField,
  definePredictionQuaternionStateField,
  definePredictionScalarStateField,
  definePredictionStatePresentation,
  definePredictionStepStateField,
  definePredictionVector2StateField,
  definePredictionVector3StateField,
  defineSnapshotVector2Track,
  interpolateAngleRadians,
  interpolateNumber,
  interpolateQuaternion,
  interpolateVector2,
  interpolateVector3,
  MULTIPLAYER_ACTION_KIND,
  MULTIPLAYER_INPUT_KIND,
  MULTIPLAYER_PATCH_KIND,
  MULTIPLAYER_RESULT_KIND,
  MULTIPLAYER_SNAPSHOT_KIND,
  multiplayerErrorCodes,
  normalizeMultiplayerDisplayName,
  presentSnapshotTracks,
  stepValue,
  type MultiplayerBackendAdapter,
  type MultiplayerBackendConnection,
  type MultiplayerBackendListener,
  type MultiplayerBridgeInstallContext,
  type MultiplayerMessageEnvelope,
  type MultiplayerPeer,
  type MultiplayerSession,
  type NetworkAngleRadians,
  type NetworkScalar,
  type NetworkTransform2,
  type NetworkTransform3,
  type NetworkVector2
} from "../src";

describe("createMultiplayerRuntime", () => {
  it("creates sessions and normalizes outgoing messages", async () => {
    const fake = createFakeBackend();
    const runtime = createMultiplayerRuntime({
      id: "runtime",
      backend: fake.backend,
      clock: () => 123,
      idGenerator: () => "message-1"
    });

    await runtime.createSession({
      id: "session-1",
      localPeer: { id: "host", role: "host" }
    });
    await runtime.send({
      channel: "reliable",
      kind: "game.command",
      payload: { action: "move" }
    });

    expect(fake.sent).toEqual([
      {
        id: "message-1",
        sessionId: "session-1",
        channel: "reliable",
        kind: "game.command",
        sourcePeerId: "host",
        sequence: 1,
        timestamp: 123,
        payload: { action: "move" }
      }
    ]);
    expect(runtime.snapshot()).toMatchObject({
      id: "runtime",
      backendId: "fake",
      phase: "in-session",
      sent: 1,
      received: 0,
      session: {
        id: "session-1"
      },
      localPeer: {
        id: "host"
      }
    });
  });

  it("cleans listeners on dispose and rejects later sends", async () => {
    const fake = createFakeBackend();
    const runtime = createMultiplayerRuntime({
      id: "runtime",
      backend: fake.backend
    });
    const received: MultiplayerMessageEnvelope[] = [];

    runtime.subscribe((message) => received.push(message));
    await runtime.createSession({
      id: "session-1",
      localPeer: { id: "host" }
    });
    await runtime.dispose();
    fake.emit({
      id: "ignored",
      sessionId: "session-1",
      channel: "reliable",
      kind: "game.command",
      sourcePeerId: "remote",
      timestamp: 0,
      payload: {}
    });

    expect(received).toEqual([]);
    await expect(
      runtime.send({
        channel: "reliable",
        kind: "game.command",
        payload: {}
      })
    ).rejects.toThrowErrorMatchingInlineSnapshot(`
      [GameError: Multiplayer runtime has been disposed.]
    `);
  });

  it("refreshes phase from the backend connection snapshot", async () => {
    const fake = createFakeBackend();
    const runtime = createMultiplayerRuntime({
      id: "runtime",
      backend: fake.backend
    });

    await runtime.createSession({
      id: "session-1",
      localPeer: { id: "host" }
    });
    expect(runtime.phase()).toBe("in-session");

    fake.dropSession();

    expect(runtime.phase()).toBe("connected");
    expect(runtime.session()).toBeUndefined();
  });

  it("rejects reconnect with a stable unsupported capability error", async () => {
    const fake = createFakeBackend();
    const runtime = createMultiplayerRuntime({
      id: "runtime",
      backend: fake.backend
    });

    await expect(runtime.reconnect?.()).rejects.toMatchObject({
      code: multiplayerErrorCodes.unsupportedCapability,
      details: {
        backendId: "fake",
        capability: "reconnect"
      }
    });
  });
});

describe("multiplayer authority helpers", () => {
  it("applies snapshots only from the bound authority source", async () => {
    const fake = createFakeBackend();
    const runtime = createMultiplayerRuntime({
      id: "client-runtime",
      backend: fake.backend,
      clock: () => 100
    });
    await runtime.createSession({
      id: "session-1",
      authority: "host-authoritative",
      localPeer: { id: "client", role: "client" }
    });
    const binding = createMultiplayerAuthorityBindingStore({
      sessionId: "session-1",
      mode: "host-authoritative",
      authorityPeerId: "host",
      localPlayerId: "player-client"
    });
    let latestSnapshot: { x: number } | undefined;
    const receiver = createMultiplayerAuthorityReceiver<{ x: number }>({
      runtime,
      binding,
      clock: () => 150,
      readSnapshot(payload) {
        return isRecord(payload) && typeof payload.x === "number" ? { x: payload.x } : undefined;
      },
      applySnapshot(snapshot) {
        latestSnapshot = snapshot;
      }
    });

    fake.emit(messageFrom("client", MULTIPLAYER_SNAPSHOT_KIND, { x: 99 }));
    fake.emit(messageFrom("host", MULTIPLAYER_SNAPSHOT_KIND, { x: 7 }, { tick: 3 }));

    expect(latestSnapshot).toEqual({ x: 7 });
    expect(receiver.diagnostics()).toMatchObject({
      receivedSnapshots: 2,
      appliedSnapshots: 1,
      rejectedMessages: 1,
      lastAppliedTick: 3,
      lastSnapshotAgeMs: 50,
      lastRejected: {
        code: "non-authority-source",
        sourcePeerId: "client"
      }
    });
    expect(binding.current()).toMatchObject({ tick: 3 });
  });

  it("applies patches and results only from the bound authority source", async () => {
    const fake = createFakeBackend();
    const runtime = createMultiplayerRuntime({
      id: "client-runtime",
      backend: fake.backend,
      clock: () => 100
    });
    await runtime.createSession({
      id: "session-1",
      authority: "host-authoritative",
      localPeer: { id: "client", role: "client" }
    });
    const binding = createMultiplayerAuthorityBindingStore({
      sessionId: "session-1",
      mode: "host-authoritative",
      authorityPeerId: "host",
      localPlayerId: "player-client"
    });
    let latestPatch: { dx: number } | undefined;
    let latestResult: { accepted: boolean } | undefined;
    const receiver = createMultiplayerAuthorityReceiver<
      { x: number },
      { dx: number },
      { accepted: boolean }
    >({
      runtime,
      binding,
      readSnapshot(payload) {
        return isRecord(payload) && typeof payload.x === "number" ? { x: payload.x } : undefined;
      },
      readPatch(payload) {
        return isRecord(payload) && typeof payload.dx === "number" ? { dx: payload.dx } : undefined;
      },
      readResult(payload) {
        return isRecord(payload) && typeof payload.accepted === "boolean"
          ? { accepted: payload.accepted }
          : undefined;
      },
      applySnapshot() {
        // This test focuses on patch/result source gates.
      },
      applyPatch(patch) {
        latestPatch = patch;
      },
      applyResult(result) {
        latestResult = result;
      }
    });

    fake.emit(messageFrom("client", MULTIPLAYER_PATCH_KIND, { dx: 99 }));
    fake.emit(messageFrom("host", MULTIPLAYER_PATCH_KIND, { dx: 2 }, { tick: 5 }));
    fake.emit(messageFrom("client", MULTIPLAYER_RESULT_KIND, { accepted: false }));
    fake.emit(messageFrom("host", MULTIPLAYER_RESULT_KIND, { accepted: true }, { tick: 6 }));

    expect(latestPatch).toEqual({ dx: 2 });
    expect(latestResult).toEqual({ accepted: true });
    expect(receiver.diagnostics()).toMatchObject({
      receivedPatches: 2,
      appliedPatches: 1,
      receivedResults: 2,
      appliedResults: 1,
      rejectedMessages: 2,
      lastAppliedTick: 6,
      lastRejected: {
        code: "non-authority-source",
        sourcePeerId: "client",
        kind: MULTIPLAYER_RESULT_KIND
      }
    });
    expect(binding.current()).toMatchObject({ tick: 6 });
  });

  it("runs host authority actions and inputs before broadcasting a snapshot", async () => {
    const fake = createFakeBackend();
    const runtime = createMultiplayerRuntime({
      id: "host-runtime",
      backend: fake.backend,
      clock: () => 200
    });
    await runtime.createSession({
      id: "session-1",
      authority: "host-authoritative",
      localPeer: { id: "host", role: "host" }
    });
    const state = { started: false, x: 0 };
    const binding = createMultiplayerAuthorityBindingStore({
      sessionId: "session-1",
      mode: "host-authoritative",
      authorityPeerId: "host"
    });
    const loop = createMultiplayerAuthorityHostLoop<ActionPayload, InputPayload, SnapshotPayload>({
      runtime,
      binding,
      readAction: readAction,
      readInput: readInput,
      inputSequence: (input) => input.sequence,
      handleAction({ payload }) {
        if (payload.type === "start") {
          state.started = true;
        }
      },
      handleInput({ payload }) {
        if (!state.started) {
          return { allowed: false, code: "not-started", reason: "Game has not started." };
        }
        state.x += payload.dx;
      },
      captureSnapshot({ tick }) {
        return { ...state, tick };
      }
    });

    fake.emit(messageFrom("client", MULTIPLAYER_ACTION_KIND, { type: "start" }));
    fake.emit(messageFrom("client", MULTIPLAYER_INPUT_KIND, { sequence: 1, dx: 2 }));
    loop.tick(16);
    await waitFor(() => fake.sent.some((message) => message.kind === MULTIPLAYER_SNAPSHOT_KIND));

    expect(state).toEqual({ started: true, x: 2 });
    expect(fake.sent).toEqual([
      expect.objectContaining({
        kind: MULTIPLAYER_SNAPSHOT_KIND,
        sourcePeerId: "host",
        tick: 1,
        payload: { started: true, x: 2, tick: 1 }
      })
    ]);
    expect(loop.diagnostics()).toMatchObject({
      tick: 1,
      receivedActions: 1,
      acceptedActions: 1,
      receivedInputs: 1,
      acceptedInputs: 1,
      sentSnapshots: 1
    });
  });

  it("publishes captured snapshots through a provider-native writer", async () => {
    const fake = createFakeBackend();
    const runtime = createMultiplayerRuntime({
      id: "native-snapshot-host",
      backend: fake.backend,
      clock: () => 200
    });
    await runtime.createSession({
      id: "session-1",
      authority: "host-authoritative",
      localPeer: { id: "host", role: "host" }
    });
    const binding = createMultiplayerAuthorityBindingStore({
      sessionId: "session-1",
      mode: "host-authoritative",
      authorityPeerId: "host"
    });
    const published: SnapshotPayload[] = [];
    const loop = createMultiplayerAuthorityHostLoop<never, never, SnapshotPayload>({
      runtime,
      binding,
      captureSnapshot({ tick }) {
        return { started: true, x: 3, tick };
      },
      publishSnapshot(snapshot) {
        published.push(snapshot);
      }
    });

    loop.tick(16);
    await waitFor(() => loop.diagnostics().sentSnapshots === 1);

    expect(published).toEqual([{ started: true, x: 3, tick: 1 }]);
    expect(fake.sent).toEqual([]);
  });

  it("captures periodic authority snapshots at the declared cadence and keeps manual broadcast immediate", async () => {
    const fake = createFakeBackend();
    const runtime = createMultiplayerRuntime({
      id: "periodic-snapshot-host",
      backend: fake.backend
    });
    await runtime.createSession({
      id: "session-1",
      authority: "host-authoritative",
      localPeer: { id: "host", role: "host" }
    });
    const captured: number[] = [];
    const published: number[] = [];
    const loop = createMultiplayerAuthorityHostLoop<never, never, { tick: number }>({
      runtime,
      binding: createMultiplayerAuthorityBindingStore({
        sessionId: "session-1",
        mode: "host-authoritative",
        authorityPeerId: "host"
      }),
      snapshotIntervalTicks: 3,
      captureSnapshot({ tick }) {
        captured.push(tick);
        return { tick };
      },
      publishSnapshot(snapshot) {
        published.push(snapshot.tick);
      }
    });

    for (let tick = 0; tick < 5; tick += 1) loop.tick(16);
    await waitFor(() => loop.diagnostics().sentSnapshots === 1);
    expect(captured).toEqual([3]);
    expect(published).toEqual([3]);
    expect(loop.diagnostics()).toMatchObject({
      tick: 5,
      committedTicks: 5,
      sentSnapshots: 1
    });

    await loop.broadcastSnapshot();
    expect(captured).toEqual([3, 5]);
    expect(published).toEqual([3, 5]);
    expect(loop.diagnostics().sentSnapshots).toBe(2);
  });

  it("splits authority ingress from simulation commit without publishing partial state", async () => {
    const fake = createFakeBackend();
    const runtime = createMultiplayerRuntime({
      id: "staged-authority-host",
      backend: fake.backend,
      clock: () => 200
    });
    await runtime.createSession({
      id: "session-1",
      authority: "server-authoritative",
      localPeer: { id: "server", role: "server" }
    });
    const binding = createMultiplayerAuthorityBindingStore({
      sessionId: "session-1",
      mode: "server-authoritative",
      authorityPeerId: "server"
    });
    const order: string[] = [];
    const state = { x: 0 };
    const published: Array<{ tick: number; x: number }> = [];
    const loop = createMultiplayerAuthorityHostLoop<
      never,
      InputPayload,
      { tick: number; x: number }
    >({
      runtime,
      binding,
      readInput,
      inputSequence: (input) => input.sequence,
      handleInput({ payload }) {
        order.push("input");
        state.x += payload.dx;
      },
      tick() {
        order.push("ingress");
      },
      captureSnapshot({ tick }) {
        order.push("capture");
        return { tick, x: state.x };
      },
      publishSnapshot(snapshot) {
        order.push("publish");
        published.push(snapshot);
      }
    });

    fake.emit(messageFrom("client", MULTIPLAYER_INPUT_KIND, { sequence: 1, dx: 2 }));
    const frame = loop.beginTick(50);
    expect(frame).toMatchObject({ tick: 1, deltaMs: 50 });
    expect(order).toEqual(["input", "ingress"]);
    expect(published).toEqual([]);
    expect(loop.diagnostics()).toMatchObject({ activeTick: 1, committedTicks: 0 });

    order.push("physics");
    state.x += 10;
    await loop.commitTick();

    expect(order).toEqual(["input", "ingress", "physics", "capture", "publish"]);
    expect(published).toEqual([{ tick: 1, x: 12 }]);
    expect(loop.diagnostics()).toMatchObject({ tick: 1, committedTicks: 1, sentSnapshots: 1 });
    expect(loop.diagnostics().activeTick).toBeUndefined();
  });

  it("rejects invalid staged authority lifecycle transitions and keeps legacy ticks disposable", async () => {
    const fake = createFakeBackend();
    const runtime = createMultiplayerRuntime({ id: "staged-errors", backend: fake.backend });
    await runtime.createSession({
      id: "session-1",
      authority: "server-authoritative",
      localPeer: { id: "server", role: "server" }
    });
    const loop = createMultiplayerAuthorityHostLoop<never, never, { tick: number }>({
      runtime,
      binding: createMultiplayerAuthorityBindingStore({
        sessionId: "session-1",
        mode: "server-authoritative",
        authorityPeerId: "server"
      }),
      captureSnapshot: ({ tick }) => ({ tick })
    });

    expectMultiplayerError(() => loop.commitTick(), multiplayerErrorCodes.authorityFrameState);
    loop.beginTick(50);
    expectMultiplayerError(() => loop.beginTick(50), multiplayerErrorCodes.authorityFrameState);
    await loop.commitTick();
    loop.dispose();
    expect(() => loop.tick(50)).not.toThrow();
    expectMultiplayerError(() => loop.beginTick(50), multiplayerErrorCodes.disposed);
  });

  it("bounds discrete action queues and consumption per source", async () => {
    const fake = createFakeBackend();
    const runtime = createMultiplayerRuntime({
      id: "bounded-action-host",
      backend: fake.backend,
      clock: () => 200
    });
    await runtime.createSession({
      id: "session-1",
      authority: "host-authoritative",
      localPeer: { id: "host", role: "host" }
    });
    const binding = createMultiplayerAuthorityBindingStore({
      sessionId: "session-1",
      mode: "host-authoritative",
      authorityPeerId: "host"
    });
    const processed: string[] = [];
    const loop = createMultiplayerAuthorityHostLoop<ActionPayload, never, { tick: number }>({
      runtime,
      binding,
      readAction,
      maxActionsPerSourcePerTick: 1,
      maxQueuedActionsPerSource: 2,
      handleAction({ message }) {
        processed.push(message.sourcePeerId);
      },
      captureSnapshot({ tick }) {
        return { tick };
      }
    });

    fake.emit(messageFrom("client-a", MULTIPLAYER_ACTION_KIND, { type: "start" }));
    fake.emit(messageFrom("client-a", MULTIPLAYER_ACTION_KIND, { type: "start" }));
    fake.emit(messageFrom("client-a", MULTIPLAYER_ACTION_KIND, { type: "start" }));
    fake.emit(messageFrom("client-b", MULTIPLAYER_ACTION_KIND, { type: "start" }));
    fake.emit(messageFrom("client-b", MULTIPLAYER_ACTION_KIND, { type: "start" }));

    expect(loop.diagnostics()).toMatchObject({
      receivedActions: 5,
      rejectedActions: 1,
      queuedActions: 4,
      maxQueuedActions: 4,
      lastRejected: { code: "action-queue-full" }
    });

    loop.tick(50);
    expect(processed).toEqual(["client-a", "client-b"]);
    expect(loop.diagnostics()).toMatchObject({
      acceptedActions: 2,
      queuedActions: 2
    });

    loop.tick(50);
    expect(processed).toEqual(["client-a", "client-b", "client-a", "client-b"]);
    expect(loop.diagnostics()).toMatchObject({
      acceptedActions: 4,
      queuedActions: 0
    });
  });

  it("protects action processing with bounded defaults", async () => {
    const fake = createFakeBackend();
    const runtime = createMultiplayerRuntime({
      id: "default-bounded-action-host",
      backend: fake.backend,
      clock: () => 200
    });
    await runtime.createSession({
      id: "session-1",
      authority: "host-authoritative",
      localPeer: { id: "host", role: "host" }
    });
    const binding = createMultiplayerAuthorityBindingStore({
      sessionId: "session-1",
      mode: "host-authoritative",
      authorityPeerId: "host"
    });
    const loop = createMultiplayerAuthorityHostLoop<ActionPayload, never, { tick: number }>({
      runtime,
      binding,
      readAction,
      captureSnapshot({ tick }) {
        return { tick };
      }
    });

    for (let index = 0; index < 33; index += 1) {
      fake.emit(messageFrom("client-a", MULTIPLAYER_ACTION_KIND, { type: "start" }));
    }

    expect(loop.diagnostics()).toMatchObject({
      receivedActions: 33,
      rejectedActions: 1,
      overflowedActions: 1,
      queuedActions: 32,
      maxQueuedActions: 32,
      lastRejected: { code: "action-queue-full" }
    });

    loop.tick(50);
    expect(loop.diagnostics()).toMatchObject({
      acceptedActions: 8,
      queuedActions: 24
    });
  });

  it("enforces room-wide authority queue capacities across distinct sources", async () => {
    const fake = createFakeBackend();
    const runtime = createMultiplayerRuntime({ id: "room-bounded-host", backend: fake.backend });
    await runtime.createSession({
      id: "session-1",
      authority: "host-authoritative",
      localPeer: { id: "host", role: "host" }
    });
    const loop = createMultiplayerAuthorityHostLoop<ActionPayload, InputPayload, { tick: number }>({
      runtime,
      binding: createMultiplayerAuthorityBindingStore({
        sessionId: "session-1",
        mode: "host-authoritative",
        authorityPeerId: "host"
      }),
      readAction,
      readInput,
      inputSequence: (input) => input.sequence,
      maxQueuedActions: 2,
      maxQueuedActionsPerSource: 2,
      maxQueuedInputs: 2,
      maxQueuedInputsPerSource: 2,
      captureSnapshot: ({ tick }) => ({ tick })
    });

    for (const peerId of ["client-a", "client-b", "client-c"]) {
      fake.emit(messageFrom(peerId, MULTIPLAYER_ACTION_KIND, { type: "start" }));
      fake.emit(messageFrom(peerId, MULTIPLAYER_INPUT_KIND, { sequence: 1, dx: 1 }));
    }

    expect(loop.diagnostics()).toMatchObject({
      actionQueueCapacity: 2,
      queuedActions: 2,
      overflowedActions: 1,
      inputQueueCapacity: 2,
      queuedInputs: 2,
      overflowedInputs: 1
    });
  });

  it("bounds realtime input consumption per source at each authority tick", async () => {
    const fake = createFakeBackend();
    const runtime = createMultiplayerRuntime({
      id: "bounded-input-host",
      backend: fake.backend,
      clock: () => 200
    });
    await runtime.createSession({
      id: "session-1",
      authority: "host-authoritative",
      localPeer: { id: "host", role: "host" }
    });
    const binding = createMultiplayerAuthorityBindingStore({
      sessionId: "session-1",
      mode: "host-authoritative",
      authorityPeerId: "host"
    });
    const processed: string[] = [];
    const loop = createMultiplayerAuthorityHostLoop<never, InputPayload, { tick: number }>({
      runtime,
      binding,
      readInput,
      inputSequence: (input) => input.sequence,
      maxInputsPerSourcePerTick: 1,
      maxQueuedInputsPerSource: 2,
      handleInput({ message, payload }) {
        processed.push(`${message.sourcePeerId}:${payload.sequence}`);
      },
      captureSnapshot({ tick }) {
        return { tick };
      }
    });

    fake.emit(messageFrom("client-a", MULTIPLAYER_INPUT_KIND, { sequence: 1, dx: 1 }));
    fake.emit(messageFrom("client-a", MULTIPLAYER_INPUT_KIND, { sequence: 2, dx: 1 }));
    fake.emit(messageFrom("client-b", MULTIPLAYER_INPUT_KIND, { sequence: 1, dx: 1 }));

    loop.tick(50);
    expect(processed).toEqual(["client-a:1", "client-b:1"]);
    expect(loop.diagnostics()).toMatchObject({ acceptedInputs: 2, tick: 1 });

    loop.tick(50);
    expect(processed).toEqual(["client-a:1", "client-b:1", "client-a:2"]);
    expect(loop.diagnostics()).toMatchObject({ acceptedInputs: 3, tick: 2 });

    fake.emit(messageFrom("client-a", MULTIPLAYER_INPUT_KIND, { sequence: 4, dx: 1 }));
    fake.emit(messageFrom("client-a", MULTIPLAYER_INPUT_KIND, { sequence: 3, dx: 1 }));
    loop.tick(50);
    loop.tick(50);

    expect(processed).toEqual(["client-a:1", "client-b:1", "client-a:2", "client-a:4"]);
    expect(loop.diagnostics()).toMatchObject({
      acceptedInputs: 4,
      rejectedInputs: 1,
      tick: 4,
      lastRejected: { code: "stale-input" }
    });

    fake.emit(messageFrom("client-a", MULTIPLAYER_INPUT_KIND, { sequence: 5, dx: 1 }));
    fake.emit(messageFrom("client-a", MULTIPLAYER_INPUT_KIND, { sequence: 6, dx: 1 }));
    fake.emit(messageFrom("client-a", MULTIPLAYER_INPUT_KIND, { sequence: 7, dx: 1 }));
    loop.tick(50);
    loop.tick(50);

    expect(processed).toEqual([
      "client-a:1",
      "client-b:1",
      "client-a:2",
      "client-a:4",
      "client-a:5",
      "client-a:6"
    ]);
    expect(loop.diagnostics()).toMatchObject({
      acceptedInputs: 6,
      rejectedInputs: 2,
      tick: 6,
      lastRejected: { code: "input-queue-full" }
    });
  });

  it("consumes redundant fixed-step bundles once in contiguous authority order", async () => {
    const fake = createFakeBackend();
    const runtime = createMultiplayerRuntime({
      id: "bundled-input-host",
      backend: fake.backend,
      clock: () => 200
    });
    await runtime.createSession({
      id: "session-1",
      authority: "host-authoritative",
      localPeer: { id: "host", role: "host" }
    });
    const processed: number[] = [];
    const loop = createMultiplayerAuthorityHostLoop<never, InputPayload, { tick: number }>({
      runtime,
      binding: createMultiplayerAuthorityBindingStore({
        sessionId: "session-1",
        mode: "host-authoritative",
        authorityPeerId: "host"
      }),
      readInput,
      inputSequence: (input) => input.sequence,
      inputDelivery: {
        mode: "redundant-bundle",
        maxBufferedFramesPerSource: 8,
        gapPolicy: "wait"
      },
      maxInputsPerSourcePerTick: 1,
      handleInput({ payload }) {
        processed.push(payload.sequence);
      },
      captureSnapshot({ tick }) {
        return { tick };
      }
    });

    fake.emit(
      messageFrom(
        "client-a",
        MULTIPLAYER_INPUT_KIND,
        createMultiplayerFixedStepInputBundle([
          { sequence: 1, payload: { sequence: 1, dx: 1 } },
          { sequence: 2, payload: { sequence: 2, dx: 1 } }
        ])
      )
    );
    loop.tick(1000 / 60);
    expect(processed).toEqual([1]);
    expect(loop.diagnostics()).toMatchObject({
      receivedInputs: 1,
      acceptedInputs: 1,
      queuedInputs: 1,
      fixedStepInput: { acceptedFrames: 2, consumedFrames: 1, duplicateFrames: 0 }
    });

    fake.emit(
      messageFrom(
        "client-a",
        MULTIPLAYER_INPUT_KIND,
        createMultiplayerFixedStepInputBundle([
          { sequence: 1, payload: { sequence: 1, dx: 1 } },
          { sequence: 2, payload: { sequence: 2, dx: 1 } },
          { sequence: 3, payload: { sequence: 3, dx: 1 } }
        ])
      )
    );
    loop.tick(1000 / 60);
    loop.tick(1000 / 60);

    expect(processed).toEqual([1, 2, 3]);
    expect(loop.diagnostics()).toMatchObject({
      acceptedInputs: 3,
      queuedInputs: 0,
      fixedStepInput: {
        acceptedFrames: 3,
        consumedFrames: 3,
        duplicateFrames: 1,
        staleFrames: 1
      }
    });

    loop.releasePeer("client-a");
    expect(loop.diagnostics().fixedStepInput).toMatchObject({ sources: 0 });
    loop.dispose();
  });

  it("uses the bundle frame sequence when hold-last fills a fixed-step gap", async () => {
    const fake = createFakeBackend();
    const runtime = createMultiplayerRuntime({ id: "gap-fill-host", backend: fake.backend });
    await runtime.createSession({
      id: "session-1",
      authority: "host-authoritative",
      localPeer: { id: "host", role: "host" }
    });
    const processed: Array<{ frameSequence: number | undefined; payloadSequence: number }> = [];
    const loop = createMultiplayerAuthorityHostLoop<never, InputPayload, { tick: number }>({
      runtime,
      binding: createMultiplayerAuthorityBindingStore({
        sessionId: "session-1",
        mode: "host-authoritative",
        authorityPeerId: "host"
      }),
      readInput,
      inputSequence: (input) => input.sequence,
      inputDelivery: {
        mode: "redundant-bundle",
        maxGapTicks: 0,
        gapPolicy: "hold-last"
      },
      maxInputsPerSourcePerTick: 1,
      handleInput({ message, payload }) {
        processed.push({ frameSequence: message.sequence, payloadSequence: payload.sequence });
      },
      captureSnapshot: ({ tick }) => ({ tick })
    });

    fake.emit(
      messageFrom(
        "client-a",
        MULTIPLAYER_INPUT_KIND,
        createMultiplayerFixedStepInputBundle([
          { sequence: 1, payload: { sequence: 1, dx: 1 } },
          { sequence: 3, payload: { sequence: 3, dx: 1 } }
        ])
      )
    );
    loop.tick(1000 / 60);
    loop.tick(1000 / 60);
    loop.tick(1000 / 60);

    expect(processed).toEqual([
      { frameSequence: 1, payloadSequence: 1 },
      { frameSequence: 2, payloadSequence: 1 },
      { frameSequence: 3, payloadSequence: 3 }
    ]);
    expect(loop.diagnostics()).toMatchObject({
      acceptedInputs: 3,
      rejectedInputs: 0,
      fixedStepInput: { gapFills: 1, consumedFrames: 3 }
    });
    loop.dispose();
  });

  it("coalesces queued input state to the latest sequence per source", async () => {
    const fake = createFakeBackend();
    const runtime = createMultiplayerRuntime({
      id: "latest-input-host",
      backend: fake.backend,
      clock: () => 200
    });
    await runtime.createSession({
      id: "session-1",
      authority: "host-authoritative",
      localPeer: { id: "host", role: "host" }
    });
    const binding = createMultiplayerAuthorityBindingStore({
      sessionId: "session-1",
      mode: "host-authoritative",
      authorityPeerId: "host"
    });
    const processed: string[] = [];
    const loop = createMultiplayerAuthorityHostLoop<never, InputPayload, { tick: number }>({
      runtime,
      binding,
      readInput,
      inputSequence: (input) => input.sequence,
      inputQueueMode: "latest",
      handleInput({ message, payload }) {
        processed.push(`${message.sourcePeerId}:${payload.sequence}`);
      },
      captureSnapshot({ tick }) {
        return { tick };
      }
    });

    fake.emit(messageFrom("client-a", MULTIPLAYER_INPUT_KIND, { sequence: 1, dx: 1 }));
    fake.emit(messageFrom("client-a", MULTIPLAYER_INPUT_KIND, { sequence: 2, dx: 1 }));
    fake.emit(messageFrom("client-a", MULTIPLAYER_INPUT_KIND, { sequence: 3, dx: 1 }));
    fake.emit(messageFrom("client-b", MULTIPLAYER_INPUT_KIND, { sequence: 1, dx: 1 }));

    expect(loop.diagnostics()).toMatchObject({
      receivedInputs: 4,
      acceptedInputs: 0,
      coalescedInputs: 2,
      queuedInputs: 2,
      maxQueuedInputs: 2
    });

    loop.tick(50);
    expect(processed).toEqual(["client-a:3", "client-b:1"]);
    expect(loop.diagnostics()).toMatchObject({
      acceptedInputs: 2,
      coalescedInputs: 2,
      queuedInputs: 0
    });

    fake.emit(messageFrom("client-a", MULTIPLAYER_INPUT_KIND, { sequence: 5, dx: 1 }));
    fake.emit(messageFrom("client-a", MULTIPLAYER_INPUT_KIND, { sequence: 4, dx: 1 }));
    loop.tick(50);

    expect(processed).toEqual(["client-a:3", "client-b:1", "client-a:5"]);
    expect(loop.diagnostics()).toMatchObject({
      acceptedInputs: 3,
      rejectedInputs: 1,
      queuedInputs: 0,
      lastRejected: { code: "stale-input" }
    });

    fake.emit(messageFrom("client-a", MULTIPLAYER_INPUT_KIND, { sequence: 6, dx: 1 }));
    expect(loop.diagnostics().queuedInputs).toBe(1);
    loop.dispose();
    expect(loop.diagnostics().queuedInputs).toBe(0);
  });

  it("releases queued work and input sequence state when a peer disconnects", async () => {
    const fake = createFakeBackend();
    const runtime = createMultiplayerRuntime({
      id: "peer-release-host",
      backend: fake.backend,
      clock: () => 200
    });
    await runtime.createSession({
      id: "session-1",
      authority: "host-authoritative",
      localPeer: { id: "host", role: "host" }
    });
    const binding = createMultiplayerAuthorityBindingStore({
      sessionId: "session-1",
      mode: "host-authoritative",
      authorityPeerId: "host"
    });
    const processed: string[] = [];
    const loop = createMultiplayerAuthorityHostLoop<ActionPayload, InputPayload, { tick: number }>({
      runtime,
      binding,
      readAction,
      readInput,
      inputSequence: (input) => input.sequence,
      inputQueueMode: "latest",
      handleAction({ message }) {
        processed.push(`${message.sourcePeerId}:action`);
      },
      handleInput({ message, payload }) {
        processed.push(`${message.sourcePeerId}:input:${payload.sequence}`);
      },
      captureSnapshot({ tick }) {
        return { tick };
      }
    });

    fake.emit(messageFrom("client-a", MULTIPLAYER_INPUT_KIND, { sequence: 7, dx: 1 }));
    loop.tick(50);
    expect(processed).toEqual(["client-a:input:7"]);

    fake.emit(messageFrom("client-a", MULTIPLAYER_ACTION_KIND, { type: "start" }));
    fake.emit(messageFrom("client-a", MULTIPLAYER_INPUT_KIND, { sequence: 8, dx: 1 }));
    fake.emit(messageFrom("client-b", MULTIPLAYER_INPUT_KIND, { sequence: 1, dx: 1 }));
    expect(loop.diagnostics()).toMatchObject({ queuedActions: 1, queuedInputs: 2 });

    loop.releasePeer("client-a");
    expect(loop.diagnostics()).toMatchObject({ queuedActions: 0, queuedInputs: 1 });
    loop.tick(50);
    expect(processed).toEqual(["client-a:input:7", "client-b:input:1"]);

    fake.emit(messageFrom("client-a", MULTIPLAYER_INPUT_KIND, { sequence: 1, dx: 1 }));
    loop.tick(50);
    expect(processed).toEqual(["client-a:input:7", "client-b:input:1", "client-a:input:1"]);
  });

  it("uses the same action and input contract for local authority", () => {
    const state = { started: false, x: 0 };
    const loop = createMultiplayerLocalAuthorityLoop<ActionPayload, InputPayload, SnapshotPayload>({
      binding: {
        sessionId: "local-session",
        mode: "local",
        localPlayerId: "local-player"
      },
      inputSequence: (input) => input.sequence,
      handleAction({ payload }) {
        if (payload.type === "start") {
          state.started = true;
        }
      },
      handleInput({ payload }) {
        if (!state.started) {
          return { allowed: false, code: "not-started", reason: "Game has not started." };
        }
        state.x += payload.dx;
      },
      tick() {
        // Local authority still flows through the same tick boundary as remote authority.
      },
      captureSnapshot({ tick }) {
        return { ...state, tick };
      }
    });

    expect(loop.binding()).toMatchObject({
      mode: "local",
      status: "bound",
      authorityEndpoint: { kind: "local", id: "local" }
    });
    expect(loop.dispatchAction({ type: "start" })).toEqual({ allowed: true });
    expect(loop.dispatchInput({ sequence: 1, dx: 2 })).toEqual({ allowed: true });
    expect(loop.dispatchInput({ sequence: 1, dx: 2 })).toMatchObject({
      allowed: false,
      code: "duplicate-input"
    });
    loop.tick(16);

    expect(loop.snapshot()).toEqual({ started: true, x: 2, tick: 1 });
    expect(loop.diagnostics()).toMatchObject({
      receivedActions: 1,
      acceptedActions: 1,
      receivedInputs: 2,
      acceptedInputs: 1,
      rejectedInputs: 1,
      sentSnapshots: 1
    });
  });

  it("summarizes authority state without provider handles or payloads", () => {
    const bindingStore = createMultiplayerAuthorityBindingStore({
      sessionId: "session-1",
      mode: "host-authoritative",
      status: "resyncing",
      authorityPeerId: "host",
      authorityEndpoint: { kind: "peer", id: "host-endpoint", peerId: "host" },
      localPlayerId: "player-client",
      tick: 4,
      snapshotVersion: "state.v1"
    });

    const diagnostics = createMultiplayerAuthorityDiagnostics({
      binding: bindingStore.current(),
      loop: {
        tick: 5,
        receivedActions: 2,
        acceptedActions: 1,
        rejectedActions: 1,
        queuedActions: 1,
        maxQueuedActions: 2,
        actionQueueCapacity: 32,
        overflowedActions: 1,
        receivedInputs: 3,
        acceptedInputs: 2,
        rejectedInputs: 1,
        coalescedInputs: 0,
        queuedInputs: 1,
        maxQueuedInputs: 2,
        inputQueueCapacity: 32,
        overflowedInputs: 1,
        committedTicks: 4,
        sentSnapshots: 4,
        rejectedMessages: 2,
        lastRejected: { code: "stale-input", reason: "Input was stale." },
        lastBroadcastError: "transport closed"
      },
      receiver: {
        receivedSnapshots: 3,
        appliedSnapshots: 2,
        receivedPatches: 1,
        appliedPatches: 1,
        receivedResults: 1,
        appliedResults: 1,
        rejectedMessages: 1,
        lastAppliedTick: 4,
        lastSnapshotAgeMs: 25,
        lastRejected: {
          code: "non-authority-source",
          reason: "Rejected non-authority source.",
          sourcePeerId: "client"
        }
      },
      connection: {
        status: "closed",
        reason: "host-left",
        reconnectSupported: false,
        reconnectReason: "unsupported"
      }
    });

    expect(diagnostics).toMatchObject({
      sessionId: "session-1",
      mode: "host-authoritative",
      status: "resyncing",
      authoritativePath: "gamekits-envelope",
      resyncing: true,
      authorityPeerId: "host",
      localPlayerId: "player-client",
      tick: 4,
      snapshotVersion: "state.v1",
      receivedActions: 2,
      acceptedInputs: 2,
      sentSnapshots: 4,
      receivedSnapshots: 3,
      appliedPatches: 1,
      rejectedMessages: 3,
      lastAppliedTick: 4,
      lastSnapshotAgeMs: 25,
      lastRejected: {
        code: "non-authority-source",
        sourcePeerId: "client"
      },
      lastBroadcastError: "transport closed",
      connection: {
        status: "closed",
        reconnectSupported: false
      }
    });

    diagnostics.binding.status = "closed";
    expect(bindingStore.current().status).toBe("resyncing");
  });
});

describe("multiplayer prediction helpers", () => {
  it("reconciles authoritative state and replays unacknowledged inputs", () => {
    const prediction = createMultiplayerPredictionBuffer<
      { x: number; y: number },
      { dx: number; dy: number }
    >({
      initialState: { x: 0, y: 0 },
      cloneState(state) {
        return { ...state };
      },
      applyInput(state, input) {
        return {
          x: state.x + input.dx,
          y: state.y + input.dy
        };
      },
      measureCorrection(previous, next) {
        return Math.hypot(previous.x - next.x, previous.y - next.y);
      }
    });

    prediction.predict({ sequence: 1, input: { dx: 1, dy: 0 }, timestamp: 10 });
    prediction.predict({ sequence: 2, input: { dx: 1, dy: 0 }, timestamp: 20 });

    const result = prediction.reconcile({
      authoritativeState: { x: 1.25, y: 0 },
      acknowledgedSequence: 1
    });

    expect(result).toMatchObject({
      state: { x: 2.25, y: 0 },
      pendingInputs: 1,
      acknowledgedInputs: 1,
      replayedInputs: 1,
      correctionMagnitude: 0.25
    });
    expect(prediction.pendingInputs().map((frame) => frame.sequence)).toEqual([2]);
    expect(prediction.diagnostics()).toMatchObject({
      predictedInputs: 2,
      acknowledgedInputs: 1,
      replayedInputs: 1,
      corrections: 1,
      pendingInputs: 1,
      lastAcknowledgedSequence: 1,
      lastPredictedSequence: 2,
      lastCorrectionMagnitude: 0.25
    });
  });

  it("presents fixed-tick prediction continuously without mutating or rewinding it", () => {
    const prediction = createMultiplayerPredictionBuffer<
      { x: number; velocity: number },
      { velocity: number }
    >({
      initialState: { x: 0, velocity: 0 },
      predictionStepMs: 50,
      cloneState(state) {
        return { ...state };
      },
      applyInput(state, input) {
        return {
          x: state.x + input.velocity * 0.05,
          velocity: input.velocity
        };
      },
      presentState(fromState, toState, context) {
        return {
          x: fromState.x + (toState.x - fromState.x) * context.alpha,
          velocity: toState.velocity
        };
      }
    });

    prediction.predict({ sequence: 1, input: { velocity: 100 }, timestamp: 50 });

    expect(prediction.state()).toEqual({ x: 5, velocity: 100 });
    expect(prediction.present({ deltaMs: 10, timestamp: 60 })).toEqual({
      x: 1,
      velocity: 100
    });
    expect(prediction.present({ deltaMs: 10, timestamp: 70 })).toEqual({
      x: 2,
      velocity: 100
    });
    expect(prediction.state()).toEqual({ x: 5, velocity: 100 });

    prediction.reconcile({
      authoritativeState: { x: 5, velocity: 100 },
      acknowledgedSequence: 1,
      timestamp: 70
    });

    expect(prediction.present({ deltaMs: 10, timestamp: 80 })).toEqual({
      x: 3,
      velocity: 100
    });
    expect(prediction.present({ deltaMs: 120, timestamp: 200 })).toEqual({
      x: 5,
      velocity: 100
    });
    expect(prediction.diagnostics()).toMatchObject({
      presentedFrames: 4,
      clampedPresentationFrames: 1,
      presentationElapsedMs: 50,
      presentationAlpha: 1
    });
  });

  it("smooths correction only in presentation while simulation reconciles immediately", () => {
    const prediction = createMultiplayerPredictionBuffer<
      { x: number; velocity: number },
      { velocity: number }
    >({
      initialState: { x: 0, velocity: 0 },
      predictionStepMs: 50,
      cloneState(state) {
        return { ...state };
      },
      applyInput(state, input) {
        return {
          x: state.x + input.velocity * 0.05,
          velocity: input.velocity
        };
      },
      presentState(fromState, toState, context) {
        return {
          x: fromState.x + (toState.x - fromState.x) * context.alpha,
          velocity: toState.velocity
        };
      },
      measureCorrection(previous, next) {
        return Math.abs(previous.x - next.x);
      },
      correctionSmoothing: {
        durationMs: 100,
        maxMagnitude: 10,
        apply(target, context) {
          target.x +=
            (context.previousPresentedState.x - context.initialTargetState.x) *
            context.remainingAlpha;
          return target;
        }
      }
    });

    prediction.predict({ sequence: 1, input: { velocity: 100 }, timestamp: 50 });
    expect(prediction.present({ deltaMs: 20, timestamp: 70 }).x).toBe(2);

    prediction.reconcile({
      authoritativeState: { x: 0, velocity: 100 },
      acknowledgedSequence: 1,
      timestamp: 70
    });

    expect(prediction.state()).toEqual({ x: 0, velocity: 100 });
    expect(prediction.present({ deltaMs: 10, timestamp: 80 }).x).toBeCloseTo(1.8);

    prediction.predict({ sequence: 2, input: { velocity: 100 }, timestamp: 100 });
    expect(prediction.present({ deltaMs: 30, timestamp: 110 }).x).toBeCloseTo(2.2);
    expect(prediction.present({ deltaMs: 60, timestamp: 170 }).x).toBeCloseTo(5);
    expect(prediction.state()).toEqual({ x: 5, velocity: 100 });
    expect(prediction.diagnostics()).toMatchObject({
      corrections: 1,
      smoothedCorrections: 1,
      correctionSmoothingActive: false,
      correctionSmoothingElapsedMs: 100
    });

    prediction.reconcile({
      authoritativeState: { x: -100, velocity: 100 },
      acknowledgedSequence: 2,
      timestamp: 170
    });

    expect(prediction.present({ deltaMs: 10, timestamp: 180 }).x).toBeCloseTo(-100);
    expect(prediction.diagnostics()).toMatchObject({
      corrections: 2,
      smoothedCorrections: 1,
      correctionSmoothingActive: false,
      correctionSmoothingElapsedMs: 0
    });
  });

  it("presents declared prediction fields and correction offsets without game interpolation", () => {
    type State = { x: number; y: number; facing: number; velocity: number };
    type Input = { dx: number; facing: number };
    const position = definePredictionVector2StateField<State>({
      readX: (state) => state.x,
      readY: (state) => state.y,
      write(state, x, y) {
        state.x = x;
        state.y = y;
      }
    });
    const facing = definePredictionAngleStateField<State>({
      read: (state) => state.facing,
      write(state, value) {
        state.facing = value;
      }
    });
    const degrees = (value: number) => (value * Math.PI) / 180;
    const prediction = createMultiplayerPredictionBuffer<State, Input>({
      initialState: { x: 0, y: 0, facing: degrees(170), velocity: 0 },
      predictionStepMs: 50,
      cloneState: (state) => ({ ...state }),
      applyInput(state, input, context) {
        expect(context.stepMs).toBe(50);
        state.x += input.dx;
        state.velocity = input.dx / (context.stepMs / 1000);
        state.facing = input.facing;
        return state;
      },
      presentation: definePredictionStatePresentation({
        fields: [position, facing],
        correction: {
          measure: position,
          smooth: [position],
          durationMs: 100,
          maxMagnitude: 10
        }
      })
    });

    prediction.predict({ sequence: 1, input: { dx: 10, facing: degrees(-170) }, timestamp: 50 });
    expect(prediction.present({ deltaMs: 25, timestamp: 75 })).toMatchObject({
      x: 5,
      y: 0,
      velocity: 200
    });
    expect(prediction.present({ deltaMs: 0, timestamp: 75 }).facing).toBeCloseTo(Math.PI);

    prediction.reconcile({
      authoritativeState: { x: 8, y: 0, facing: degrees(-170), velocity: 200 },
      acknowledgedSequence: 1,
      timestamp: 75
    });

    expect(prediction.state().x).toBe(8);
    expect(prediction.present({ deltaMs: 25, timestamp: 100 }).x).toBeCloseTo(5.75);
    expect(prediction.diagnostics()).toMatchObject({
      corrections: 1,
      smoothedCorrections: 1,
      correctionSmoothingActive: true
    });
  });

  it("supports scalar, vector3, quaternion, and step prediction fields", () => {
    type State = {
      scalar: number;
      position: { x: number; y: number; z: number };
      rotation: { x: number; y: number; z: number; w: number };
      mode: "idle" | "moving";
    };
    const scalar = definePredictionScalarStateField<State>({
      read: (state) => state.scalar,
      write(state, value) {
        state.scalar = value;
      }
    });
    const position = definePredictionVector3StateField<State>({
      readX: (state) => state.position.x,
      readY: (state) => state.position.y,
      readZ: (state) => state.position.z,
      write(state, x, y, z) {
        state.position = { x, y, z };
      },
      snapDistance: 5
    });
    const rotation = definePredictionQuaternionStateField<State>({
      readX: (state) => state.rotation.x,
      readY: (state) => state.rotation.y,
      readZ: (state) => state.rotation.z,
      readW: (state) => state.rotation.w,
      write(state, value) {
        state.rotation = value;
      }
    });
    const mode = definePredictionStepStateField<State, State["mode"]>({
      read: (state) => state.mode,
      write(state, value) {
        state.mode = value;
      }
    });
    const prediction = createMultiplayerPredictionBuffer<State, State>({
      initialState: {
        scalar: 0,
        position: { x: 0, y: 0, z: 0 },
        rotation: { x: 0, y: 0, z: 0, w: 1 },
        mode: "idle"
      },
      predictionStepMs: 50,
      cloneState(state) {
        return {
          ...state,
          position: { ...state.position },
          rotation: { ...state.rotation }
        };
      },
      applyInput(_state, input) {
        return {
          ...input,
          position: { ...input.position },
          rotation: { ...input.rotation }
        };
      },
      presentation: definePredictionStatePresentation({
        fields: [scalar, position, rotation, mode]
      })
    });

    prediction.predict({
      sequence: 1,
      timestamp: 50,
      input: {
        scalar: 10,
        position: { x: 10, y: 0, z: 0 },
        rotation: { x: 0, y: 0, z: 1, w: 0 },
        mode: "moving"
      }
    });
    const presented = prediction.present({ deltaMs: 25, timestamp: 75 });

    expect(presented.scalar).toBe(5);
    expect(presented.position).toEqual({ x: 10, y: 0, z: 0 });
    expect(presented.rotation.z).toBeCloseTo(Math.SQRT1_2);
    expect(presented.rotation.w).toBeCloseTo(Math.SQRT1_2);
    expect(presented.mode).toBe("idle");
  });

  it("rejects ambiguous declarative and custom prediction presentation", () => {
    expect(() =>
      createMultiplayerPredictionBuffer<number, number>({
        initialState: 0,
        cloneState: (state) => state,
        applyInput: (state, input) => state + input,
        presentation: definePredictionStatePresentation({ fields: [] }),
        presentState: (_from, to) => to
      })
    ).toThrow(/cannot be combined/);
  });

  it("owns reusable prediction transition lifecycle", () => {
    let created = 0;
    let disposed = 0;
    const prediction = createMultiplayerPredictionBuffer<number, number>({
      initialState: 0,
      cloneState: (state) => state,
      transition() {
        created += 1;
        return {
          apply: (state, input) => state + input,
          dispose() {
            disposed += 1;
          }
        };
      }
    });

    expect(prediction.predict({ sequence: 1, input: 2 }).state).toBe(2);
    expect(created).toBe(1);
    prediction.dispose();
    expect(disposed).toBe(1);

    expect(() =>
      createMultiplayerPredictionBuffer<number, number>({
        initialState: 0,
        cloneState: (state) => state,
        applyInput: (state) => state,
        transition: () => ({ apply: (state) => state })
      })
    ).toThrow(/exactly one/);
    expect(() =>
      createMultiplayerPredictionBuffer<number, number>({
        initialState: 0,
        cloneState: (state) => state
      })
    ).toThrow(/exactly one/);
  });

  it("rejects stale input and bounds the pending input queue", () => {
    const prediction = createMultiplayerPredictionBuffer<number, number>({
      initialState: 0,
      maxInputs: 2,
      cloneState(state) {
        return state;
      },
      applyInput(state, input) {
        return state + input;
      }
    });

    expect(prediction.predict({ sequence: 1, input: 1 }).accepted).toBe(true);
    expect(prediction.predict({ sequence: 2, input: 1 }).accepted).toBe(true);
    expect(prediction.predict({ sequence: 2, input: 1 })).toMatchObject({
      accepted: false,
      reason: "stale-sequence"
    });
    expect(prediction.predict({ sequence: 3, input: 1 }).accepted).toBe(true);

    expect(prediction.pendingInputs().map((frame) => frame.sequence)).toEqual([2, 3]);
    expect(prediction.diagnostics()).toMatchObject({
      predictedInputs: 3,
      rejectedInputs: 1,
      droppedInputs: 1,
      pendingInputs: 2,
      lastRejectedReason: "stale-sequence"
    });
  });
});

describe("peer/player binding utility", () => {
  it("binds peers to unique player display names and cleans up leave state", () => {
    const store = createMultiplayerPeerPlayerBindingStore({
      displayNameFallback(_peer, index) {
        return `Player ${index}`;
      }
    });

    const alpha = store.bindPeer(peer("peer-a", { playerId: "player-a", displayName: " Scout " }));
    const bravo = store.bindPeer(peer("peer-b", { playerId: "player-b", displayName: "Scout" }));
    const charlie = store.bindPeer(peer("peer-c", { playerId: "player-c", displayName: "   " }));

    expect(alpha).toMatchObject({ playerId: "player-a", displayName: "Scout" });
    expect(bravo).toMatchObject({ playerId: "player-b", displayName: "Scout 2" });
    expect(charlie).toMatchObject({ playerId: "player-c", displayName: "Player 3" });
    expect(store.playerIdForPeer("peer-b")).toBe("player-b");
    expect(store.activeBindings().map((binding) => binding.playerId)).toEqual([
      "player-a",
      "player-b",
      "player-c"
    ]);

    const left = store.markPeerLeft("peer-b", {
      status: "disconnected",
      reason: "tab closed"
    });

    expect(left).toMatchObject({
      playerId: "player-b",
      status: "disconnected",
      reason: "tab closed"
    });
    expect(store.playerIdForPeer("peer-b")).toBeUndefined();
    expect(store.activeBindings().map((binding) => binding.playerId)).toEqual([
      "player-a",
      "player-c"
    ]);

    const restored = store.bindPeer(
      peer("peer-d", { playerId: "player-b", displayName: "Scout" }),
      { slot: "blue" }
    );
    expect(restored).toMatchObject({
      peerId: "peer-d",
      playerId: "player-b",
      displayName: "Scout 2",
      status: "active",
      slot: "blue"
    });

    const removed = store.markPeerLeft("peer-c", { remove: true });
    expect(removed).toMatchObject({ playerId: "player-c", status: "left" });
    expect(store.bindings().map((binding) => binding.playerId)).toEqual(["player-a", "player-b"]);
  });

  it("supports spectator bindings and closes a binding set", () => {
    const store = createMultiplayerPeerPlayerBindingStore();

    store.bindPeer(peer("peer-a", { playerId: "player-a", role: "host" }));
    store.bindPeer(peer("peer-s", { playerId: "spectator-a", role: "spectator" }));
    store.bindPeer(peer("peer-late", { playerId: "player-late" }), {
      status: "next-round"
    });

    expect(store.bindings()).toEqual([
      expect.objectContaining({ playerId: "player-a", status: "active" }),
      expect.objectContaining({ playerId: "spectator-a", status: "spectator" }),
      expect.objectContaining({ playerId: "player-late", status: "next-round" })
    ]);
    expect(store.activeBindings().map((binding) => binding.playerId)).toEqual(["player-a"]);

    const closed = store.close("room closed");
    expect(closed).toEqual([
      expect.objectContaining({ playerId: "player-a", status: "closed", reason: "room closed" }),
      expect.objectContaining({
        playerId: "spectator-a",
        status: "closed",
        reason: "room closed"
      }),
      expect.objectContaining({
        playerId: "player-late",
        status: "closed",
        reason: "room closed"
      })
    ]);
    expect(store.activeBindings()).toEqual([]);
    expect(() => store.bindPeer(peer("peer-b"))).toThrowErrorMatchingInlineSnapshot(
      `[GameError: Peer/player binding store is closed.]`
    );
  });

  it("normalizes and de-duplicates display names", () => {
    expect(normalizeMultiplayerDisplayName("  Alpha   Bravo  ", "Fallback")).toBe("Alpha Bravo");
    expect(normalizeMultiplayerDisplayName("   ", "Fallback")).toBe("Fallback");
    expect(createUniqueMultiplayerDisplayName("Scout", ["Scout", "Scout 2"])).toBe("Scout 3");
  });

  it("resolves configurable participant lifecycle policy with app-owned context", () => {
    const store = createMultiplayerPeerPlayerBindingStore();
    const activePeer = peer("peer-a", { playerId: "player-a" });
    const activeBinding = store.bindPeer(activePeer);
    const disconnectedBinding = store.markPeerLeft("peer-a", {
      status: "disconnected"
    });
    expect(disconnectedBinding).toBeDefined();

    const policy = createMultiplayerParticipantPolicy<{
      phase: "lobby" | "running";
      hasCapacity: boolean;
    }>({
      join: ({ context }) => (context.hasCapacity ? "active" : "reject"),
      lateJoin: "next-round",
      leave: "remove",
      disconnect: ({ context }) => (context.phase === "lobby" ? "remove" : "disconnected"),
      reconnect: "restore",
      boundary: ({ binding }) => (binding.status === "disconnected" ? "remove" : "retain")
    });
    const lobbyContext = { phase: "lobby" as const, hasCapacity: true };
    const runningContext = { phase: "running" as const, hasCapacity: true };

    expect(policy.join({ peer: activePeer, context: lobbyContext })).toBe("active");
    expect(
      policy.join({
        peer: activePeer,
        context: { phase: "lobby", hasCapacity: false }
      })
    ).toBe("reject");
    expect(policy.lateJoin({ peer: activePeer, context: runningContext })).toBe("next-round");
    expect(
      policy.leave({ peerId: activePeer.id, binding: activeBinding, context: runningContext })
    ).toBe("remove");
    expect(
      policy.disconnect({ peerId: activePeer.id, binding: activeBinding, context: lobbyContext })
    ).toBe("remove");
    expect(
      policy.disconnect({ peerId: activePeer.id, binding: activeBinding, context: runningContext })
    ).toBe("disconnected");
    expect(
      policy.reconnect({ peer: activePeer, binding: activeBinding, context: runningContext })
    ).toBe("restore");
    expect(
      policy.boundary({
        binding: disconnectedBinding as NonNullable<typeof disconnectedBinding>,
        context: lobbyContext
      })
    ).toBe("remove");
  });
});

describe("createSnapshotBuffer", () => {
  it("samples ordered authoritative snapshots with render delay diagnostics", () => {
    type Snapshot = {
      tick: number;
      position: { x: number; y: number };
    };
    const buffer = createSnapshotBuffer<Snapshot>({
      interpolationDelayMs: 100
    });

    expect(buffer.sample(1000)).toMatchObject({
      status: "empty",
      bufferLength: 0
    });

    buffer.push({
      snapshot: { tick: 3, position: { x: 100, y: 0 } },
      serverTime: 1100
    });
    buffer.push({
      snapshot: { tick: 1, position: { x: 0, y: 0 } },
      serverTime: 1000
    });
    buffer.push({
      snapshot: { tick: 2, position: { x: 50, y: 0 } },
      serverTime: 1050
    });

    const sample = buffer.sample(1125);

    expect(sample).toMatchObject({
      status: "interpolated",
      sampleTime: 1025,
      delayMs: 100,
      bufferLength: 3,
      snapshotAgeMs: 75
    });
    expect(sample.previous?.snapshot.tick).toBe(1);
    expect(sample.next?.snapshot.tick).toBe(2);
    expect(sample.alpha).toBeCloseTo(0.5);
    expect(buffer.diagnostics()).toMatchObject({
      bufferLength: 3,
      acceptedSnapshots: 3,
      lastSampleStatus: "interpolated",
      lastSampleAgeMs: 75
    });
  });

  it("tracks duplicate, stale, dropped and reset buffer diagnostics", () => {
    const buffer = createSnapshotBuffer<{ x: number }>({
      maxSnapshots: 2,
      maxAgeMs: 50
    });

    expect(buffer.push({ snapshot: { x: 1 }, time: 100 })).toEqual({
      accepted: true,
      time: 100
    });
    expect(buffer.push({ snapshot: { x: 2 }, time: 100 })).toEqual({
      accepted: true,
      reason: "duplicate",
      time: 100
    });
    buffer.push({ snapshot: { x: 3 }, time: 140 });
    buffer.push({ snapshot: { x: 4 }, time: 200 });
    expect(buffer.push({ snapshot: { x: 5 }, time: 100 })).toEqual({
      accepted: false,
      reason: "stale",
      time: 100
    });

    expect(buffer.frames().map((frame) => frame.time)).toEqual([200]);
    expect(buffer.diagnostics()).toMatchObject({
      acceptedSnapshots: 3,
      duplicateSnapshots: 1,
      droppedSnapshots: 2,
      staleSnapshots: 1,
      bufferLength: 1
    });

    buffer.reset();

    expect(buffer.frames()).toEqual([]);
    expect(buffer.diagnostics()).toMatchObject({
      bufferLength: 0,
      resets: 1
    });
  });

  it("falls back to stable buffer defaults for invalid numeric options", () => {
    const buffer = createSnapshotBuffer<{ x: number }>({
      interpolationDelayMs: Number.NaN,
      maxSnapshots: Number.NaN,
      maxAgeMs: Number.NaN
    });

    buffer.push({ snapshot: { x: 1 }, time: 0 });
    buffer.push({ snapshot: { x: 2 }, time: 10 });

    expect(buffer.frames().map((frame) => frame.time)).toEqual([0, 10]);
    expect(buffer.sample(110)).toMatchObject({
      delayMs: 100,
      sampleTime: 10,
      status: "exact"
    });
  });

  it("paces snapshot playback behind the latest authoritative timeline", () => {
    type Snapshot = {
      tick: number;
      x: number;
    };
    const playback = createSnapshotPlayback<Snapshot>({
      interpolationDelayMs: 100,
      readTime(entry) {
        return entry.snapshot.tick * 50;
      }
    });

    playback.present({ snapshot: { tick: 0, x: 0 } }, 0);
    playback.present({ snapshot: { tick: 1, x: 50 } }, 50);
    playback.present({ snapshot: { tick: 2, x: 100 } }, 50);
    const sample = playback.present({ snapshot: { tick: 3, x: 150 } }, 25);

    expect(sample.status).toBe("interpolated");
    expect(sample.previous?.snapshot.tick).toBe(0);
    expect(sample.next?.snapshot.tick).toBe(1);
    expect(sample.alpha).toBeCloseTo(0.5);
    expect(sample.clampedToLatest).toBe(false);
    expect(playback.diagnostics()).toMatchObject({
      bufferLength: 4,
      framesPresented: 4,
      frameDeltaMs: 25,
      lastSampleStatus: "interpolated"
    });
  });

  it("clamps snapshot playback when render frames outrun snapshot delivery", () => {
    const playback = createSnapshotPlayback<{ tick: number; x: number }>({
      interpolationDelayMs: 100,
      readTime(entry) {
        return entry.snapshot.tick * 50;
      }
    });
    const latest = { tick: 1, x: 50 };

    playback.present({ snapshot: { tick: 0, x: 0 } }, 0);
    let sample = playback.present({ snapshot: latest }, 50);
    for (let frame = 0; frame < 12; frame += 1) {
      sample = playback.advance(50);
    }

    expect(sample.status).toBe("exact");
    expect(sample.sampleTime).toBe(50);
    expect(sample.clampedToLatest).toBe(true);
    expect(playback.diagnostics()).toMatchObject({
      clampedFrames: expect.any(Number),
      renderTime: 150,
      latestSnapshotTime: 50,
      lastSampleStatus: "exact"
    });
    expect(playback.diagnostics().clampedFrames).toBeGreaterThan(0);
  });

  it("adapts interpolation delay to snapshot arrival jitter within bounds", () => {
    const playback = createSnapshotPlayback<{ tick: number }>({
      interpolationDelayMs: 50,
      adaptiveDelay: {
        minDelayMs: 50,
        maxDelayMs: 150,
        jitterMultiplier: 2,
        jitterSmoothing: 1,
        riseRate: 1,
        fallRate: 1
      },
      readTime(entry) {
        return entry.snapshot.tick * 50;
      }
    });

    playback.present({ snapshot: { tick: 0 } }, 0);
    playback.present({ snapshot: { tick: 1 } }, 50);
    expect(playback.diagnostics()).toMatchObject({
      adaptiveDelayEnabled: true,
      interpolationDelayMs: 50,
      targetDelayMs: 50,
      estimatedJitterMs: 0
    });

    playback.present({ snapshot: { tick: 1 } }, 50);
    playback.present({ snapshot: { tick: 2 } }, 100);
    expect(playback.diagnostics()).toMatchObject({
      interpolationDelayMs: 150,
      targetDelayMs: 150,
      estimatedJitterMs: 100
    });

    playback.present({ snapshot: { tick: 3 } }, 50);
    expect(playback.diagnostics()).toMatchObject({
      interpolationDelayMs: 50,
      targetDelayMs: 50,
      estimatedJitterMs: 0
    });
  });

  it("reports snapshot playback frame rate from presented deltas", () => {
    const playback = createSnapshotPlayback<{ tick: number }>({
      readTime(entry) {
        return entry.snapshot.tick * 50;
      }
    });

    for (let frame = 0; frame < 10; frame += 1) {
      playback.present({ snapshot: { tick: 0 } }, 100);
    }

    expect(playback.diagnostics()).toMatchObject({
      frameRate: 10,
      frameDeltaMs: 100,
      framesPresented: 10
    });
  });

  it("projects declared NetworkVector2 tracks into presented values", () => {
    type Snapshot = {
      tick: number;
      players: Array<{
        id: string;
        position: NetworkVector2;
      }>;
    };
    const playback = createSnapshotPlayback<Snapshot>({
      interpolationDelayMs: 0,
      readTime(entry) {
        return entry.snapshot.tick * 50;
      }
    });
    const tracks = [
      defineSnapshotVector2Track<Snapshot>({
        snapDistance: 1000,
        select(snapshot) {
          return snapshot.players.map((player) => ({
            key: `player:${player.id}:position`,
            value: player.position
          }));
        }
      })
    ];

    playback.present(
      {
        snapshot: {
          tick: 0,
          players: [{ id: "runner", position: { x: 0, y: 10 } }]
        }
      },
      0
    );
    const sample = playback.present(
      {
        snapshot: {
          tick: 1,
          players: [{ id: "runner", position: { x: 50, y: 30 } }]
        }
      },
      25
    );
    const presented = presentSnapshotTracks(sample, tracks);
    const position = presented.vector2("player:runner:position", { x: -1, y: -1 });

    expect(position).toEqual({ x: 25, y: 20 });
    position.x = 999;
    expect(presented.vector2("player:runner:position", { x: -1, y: -1 })).toEqual({
      x: 25,
      y: 20
    });
  });

  it("reuses projector state and writes presented vectors into caller targets", () => {
    type Snapshot = {
      tick: number;
      entities: Array<{
        id: number;
        position: NetworkVector2;
      }>;
    };
    const playback = createSnapshotPlayback<Snapshot>({
      interpolationDelayMs: 0,
      readTime(entry) {
        return entry.snapshot.tick * 50;
      }
    });
    let selectIntoCalls = 0;
    const projector = createSnapshotPresentationProjector<Snapshot>([
      defineSnapshotVector2Track<Snapshot>({
        selectInto(snapshot, writer) {
          selectIntoCalls += 1;
          for (const entity of snapshot.entities) {
            writer.add(entity.id, entity.position);
          }
        }
      })
    ]);

    playback.present(
      {
        snapshot: {
          tick: 0,
          entities: [{ id: 1, position: { x: 0, y: 0 } }]
        }
      },
      0
    );
    const firstSample = playback.present(
      {
        snapshot: {
          tick: 1,
          entities: [{ id: 1, position: { x: 10, y: 20 } }]
        }
      },
      25
    );
    const firstPresented = projector.present(firstSample);
    const storedValue = firstPresented.values.get(1);
    const target = { x: 0, y: 0 };

    expect(firstPresented.vector2Into(1, target, { x: -1, y: -1 })).toBe(target);
    expect(target).toEqual({ x: 5, y: 10 });
    expect(selectIntoCalls).toBe(2);

    const secondSample = playback.present(
      {
        snapshot: {
          tick: 2,
          entities: [{ id: 1, position: { x: 20, y: 40 } }]
        }
      },
      25
    );
    const secondPresented = projector.present(secondSample);

    expect(secondPresented).toBe(firstPresented);
    expect(secondPresented.values.get(1)).toBe(storedValue);
    expect(secondPresented.vector2(1, { x: -1, y: -1 })).toEqual({ x: 10, y: 20 });
  });

  it("snaps declared vector tracks beyond their snap distance", () => {
    type Snapshot = {
      tick: number;
      position: NetworkVector2;
    };
    const playback = createSnapshotPlayback<Snapshot>({
      interpolationDelayMs: 0,
      readTime(entry) {
        return entry.snapshot.tick * 50;
      }
    });
    const tracks = [
      defineSnapshotVector2Track<Snapshot>({
        snapDistance: 32,
        select(snapshot) {
          return [
            {
              key: "avatar:position",
              value: snapshot.position
            }
          ];
        }
      })
    ];

    playback.present({ snapshot: { tick: 0, position: { x: 0, y: 0 } } }, 0);
    const sample = playback.present({ snapshot: { tick: 1, position: { x: 400, y: 0 } } }, 25);

    expect(
      presentSnapshotTracks(sample, tracks).vector2("avatar:position", { x: -1, y: -1 })
    ).toEqual({ x: 400, y: 0 });
  });

  it("provides typed interpolation primitives without owning snapshot shape", () => {
    const scalar: NetworkScalar = interpolateNumber(10, 20, 0.25);
    expect(scalar).toBe(12.5);
    expect(interpolateVector2({ x: 0, y: 10 }, { x: 20, y: 30 }, 0.5)).toEqual({
      x: 10,
      y: 20
    });
    expect(interpolateVector3({ x: 0, y: 10, z: 20 }, { x: 30, y: 40, z: 50 }, 0.5)).toEqual({
      x: 15,
      y: 25,
      z: 35
    });
    const angle: NetworkAngleRadians = interpolateAngleRadians(0, Math.PI * 1.5, 0.5);
    expect(angle).toBeCloseTo(-Math.PI / 4);
    expect(stepValue("lobby", "running", 0.49, 0.5)).toBe("lobby");
    expect(stepValue("lobby", "running", 0.5, 0.5)).toBe("running");

    const halfTurn = interpolateQuaternion(
      { x: 0, y: 0, z: 0, w: 1 },
      { x: 0, y: 0, z: 1, w: 0 },
      0.5
    );
    expect(halfTurn.z).toBeCloseTo(Math.SQRT1_2);
    expect(halfTurn.w).toBeCloseTo(Math.SQRT1_2);

    const transform2: NetworkTransform2 = {
      position: { x: 10, y: 20 },
      rotation: angle,
      scale: { x: 1, y: 1 }
    };
    const transform3: NetworkTransform3 = {
      position: { x: 15, y: 25, z: 35 },
      rotation: halfTurn,
      scale: { x: 1, y: 1, z: 1 }
    };
    expect(transform2.position).toEqual({ x: 10, y: 20 });
    expect(transform3.position).toEqual({ x: 15, y: 25, z: 35 });
  });
});

describe("createMultiplayerModule", () => {
  it("keeps the bridge factory as a compatibility alias", () => {
    const runtime = createMultiplayerRuntime({
      id: "runtime",
      backend: createFakeBackend().backend
    });

    expect(createMultiplayerBridgeModule({ runtime }).id).toBe(
      createMultiplayerModule({ runtime }).id
    );
  });

  it("queues commands until the game system tick", async () => {
    const fake = createFakeBackend();
    const runtime = createMultiplayerRuntime({
      id: "runtime",
      backend: fake.backend
    });
    const eventBus = createEventBus({ clock: () => 10 });
    const systems: Array<{ id: string; update(): void }> = [];
    const handled: MultiplayerMessageEnvelope[] = [];
    const events: Array<{ type: string; correlationId?: string; parentId?: string }> = [];
    eventBus.onAny((event) =>
      events.push({
        type: event.type,
        ...(event.correlationId === undefined ? {} : { correlationId: event.correlationId }),
        ...(event.parentId === undefined ? {} : { parentId: event.parentId })
      })
    );

    const module = createMultiplayerModule({
      runtime,
      handleCommand({ message }) {
        handled.push(message);
      }
    });

    module.install({
      eventBus,
      systems: {
        register(system) {
          systems.push(system);
        }
      }
    });
    await runtime.createSession({
      id: "session-1",
      localPeer: { id: "host" }
    });

    fake.emit({
      id: "command-1",
      sessionId: "session-1",
      channel: "reliable",
      kind: "game.command",
      sourcePeerId: "client",
      correlationId: "combat-1",
      timestamp: 0,
      payload: { action: "move" }
    });

    expect(handled).toEqual([]);
    systems[0]?.update();
    expect(handled.map((message) => message.id)).toEqual(["command-1"]);
    expect(events).toEqual([
      {
        type: "multiplayer.command.accepted",
        correlationId: "combat-1",
        parentId: "command-1"
      }
    ]);
  });

  it("bounds and expires standard module commands with observable diagnostics", async () => {
    const fake = createFakeBackend();
    const runtime = createMultiplayerRuntime({
      id: "bounded-module-runtime",
      backend: fake.backend
    });
    const eventBus = createEventBus({ clock: () => 10 });
    const systems: Array<{ id: string; update(): void }> = [];
    const handled: string[] = [];
    const facts: string[] = [];
    const diagnostics: Array<{
      queued: number;
      handled: number;
      overflowed: number;
      expired: number;
    }> = [];
    let now = 0;
    eventBus.onAny((event) => facts.push(event.type));

    createMultiplayerModule({
      runtime,
      commandQueue: {
        capacity: 2,
        maxPerTick: 1,
        maxAgeMs: 50,
        clock: () => now,
        onDiagnostics(snapshot) {
          diagnostics.push(snapshot);
        }
      },
      handleCommand({ message }) {
        handled.push(message.id);
      }
    }).install({
      eventBus,
      systems: { register: (system) => systems.push(system) }
    });
    await runtime.createSession({ id: "session-1", localPeer: { id: "host" } });

    for (const id of ["command-1", "command-2", "command-3"]) {
      fake.emit({
        id,
        sessionId: "session-1",
        channel: "reliable",
        kind: "game.command",
        sourcePeerId: "client",
        timestamp: 0,
        payload: { action: "move" }
      });
    }

    expect(diagnostics.at(-1)).toMatchObject({ queued: 2, overflowed: 1 });
    systems[0]?.update();
    expect(handled).toEqual(["command-1"]);
    expect(diagnostics.at(-1)).toMatchObject({ queued: 1, handled: 1 });

    now = 100;
    systems[0]?.update();
    expect(handled).toEqual(["command-1"]);
    expect(diagnostics.at(-1)).toMatchObject({ queued: 0, overflowed: 1, expired: 1 });
    expect(facts).toContain("multiplayer.command.overflow");
    expect(facts).toContain("multiplayer.command.expired");
  });

  it("can drop the oldest standard module command on overflow", async () => {
    const fake = createFakeBackend();
    const runtime = createMultiplayerRuntime({ id: "drop-oldest-runtime", backend: fake.backend });
    const systems: Array<{ id: string; update(): void }> = [];
    const handled: string[] = [];
    createMultiplayerModule({
      runtime,
      commandQueue: { capacity: 2, overflowPolicy: "drop-oldest" },
      handleCommand: ({ message }) => handled.push(message.id)
    }).install({
      eventBus: createEventBus(),
      systems: { register: (system) => systems.push(system) }
    });
    await runtime.createSession({ id: "session-1", localPeer: { id: "host" } });

    for (const id of ["command-1", "command-2", "command-3"]) {
      fake.emit({
        id,
        sessionId: "session-1",
        channel: "reliable",
        kind: "game.command",
        sourcePeerId: "client",
        timestamp: 0,
        payload: {}
      });
    }
    systems[0]?.update();

    expect(handled).toEqual(["command-2", "command-3"]);
  });

  it("emits rejected command facts when authority denies a command", async () => {
    const fake = createFakeBackend();
    const runtime = createMultiplayerRuntime({
      id: "runtime",
      backend: fake.backend
    });
    const eventBus = createEventBus({ clock: () => 10 });
    const systems: Array<{ id: string; update(): void }> = [];
    const events: unknown[] = [];
    eventBus.on("multiplayer.command.rejected", (event) => events.push(event.payload));

    const module = createMultiplayerModule({
      runtime,
      authority() {
        return { allowed: false, code: "not_authorized", reason: "client cannot act" };
      },
      handleCommand() {
        throw new Error("should not run rejected command");
      }
    });

    module.install({
      eventBus,
      systems: {
        register(system) {
          systems.push(system);
        }
      }
    });
    await runtime.createSession({
      id: "session-1",
      localPeer: { id: "host" }
    });

    fake.emit({
      id: "command-1",
      sessionId: "session-1",
      channel: "reliable",
      kind: "game.command",
      sourcePeerId: "client",
      timestamp: 0,
      payload: { action: "move" }
    });
    systems[0]?.update();

    expect(events).toEqual([
      {
        messageId: "command-1",
        peerId: "client",
        code: "not_authorized",
        reason: "client cannot act"
      }
    ]);
  });

  it("runs snapshot presentation playback on the game system tick", () => {
    const fake = createFakeBackend();
    const runtime = createMultiplayerRuntime({
      id: "runtime",
      backend: fake.backend
    });
    const eventBus = createEventBus({ clock: () => 10 });
    const systems: Array<{
      id: string;
      update(ctx?: { delta?: number; elapsed?: number; tick?: number }): void;
    }> = [];
    let latestSnapshot: { tick: number; position: NetworkVector2 } | undefined = {
      tick: 0,
      position: { x: 0, y: 0 }
    };
    const applied: Array<{
      status: string;
      tick: number | undefined;
      position: NetworkVector2;
    }> = [];

    const module = createMultiplayerModule({
      runtime,
      presentation: {
        interpolationDelayMs: 50,
        readTime(entry) {
          return entry.snapshot.tick * 50;
        },
        tracks: [
          defineSnapshotVector2Track<{ tick: number; position: NetworkVector2 }>({
            selectInto(snapshot, writer) {
              writer.add("avatar:position", snapshot.position);
            }
          })
        ],
        readSnapshot() {
          return latestSnapshot === undefined
            ? undefined
            : {
                snapshot: latestSnapshot,
                tick: latestSnapshot.tick
              };
        },
        applySample({ sample, presented }) {
          applied.push({
            status: sample.status,
            tick: sample.next?.snapshot.tick,
            position: presented.vector2("avatar:position", { x: -1, y: -1 })
          });
        }
      }
    });

    module.install({
      eventBus,
      systems: {
        register(system) {
          systems.push(system);
        }
      }
    });

    expect(systems.map((system) => system.id)).toEqual([
      "gamekits.multiplayer.bridge.presentation"
    ]);

    systems[0]?.update({ delta: 0, elapsed: 0, tick: 1 });
    latestSnapshot = { tick: 1, position: { x: 50, y: 0 } };
    systems[0]?.update({ delta: 50, elapsed: 50, tick: 2 });
    latestSnapshot = { tick: 2, position: { x: 100, y: 0 } };
    systems[0]?.update({ delta: 50, elapsed: 100, tick: 3 });
    latestSnapshot = undefined;
    systems[0]?.update({ delta: 50, elapsed: 150, tick: 4 });

    expect(applied).toEqual([
      { status: "before-first", tick: 0, position: { x: 0, y: 0 } },
      { status: "exact", tick: 0, position: { x: 0, y: 0 } },
      { status: "exact", tick: 1, position: { x: 50, y: 0 } },
      { status: "exact", tick: 2, position: { x: 100, y: 0 } }
    ]);
  });

  it("automatically owns client snapshot playback, input prediction, and reconciliation", async () => {
    type ClientSnapshot = { tick: number; x: number; acknowledgedSequence: number };
    type ClientInput = { dx: number };
    type PredictedState = { x: number };

    const fake = createFakeBackend();
    const runtime = createMultiplayerRuntime({
      id: "managed-client-runtime",
      backend: fake.backend,
      clock: () => 100
    });
    const systems: Array<{
      id: string;
      update(ctx?: { delta?: number; elapsed?: number; tick?: number }): void;
    }> = [];
    const authoritativeTicks: number[] = [];
    const presented: Array<{ remoteX: number; predictedX?: number }> = [];
    let exposed = false;
    let readReplicationDiagnostics:
      | (() => {
          failedInputs: number;
          throttledInputs: number;
          prediction?: { pendingInputs: number; resets: number };
        })
      | undefined;

    const module = createMultiplayerModule<
      MultiplayerBridgeInstallContext,
      ClientSnapshot,
      ClientInput,
      PredictedState
    >({
      runtime,
      clientReplication: {
        authority: { resolveAuthorityPeerId: () => "server" },
        playback: {
          interpolationDelayMs: 50,
          timeSource: "tick",
          readTime(entry) {
            return entry.tick === undefined ? undefined : entry.tick * 50;
          }
        },
        tracks: [
          defineSnapshotVector2Track<ClientSnapshot>({
            selectInto(snapshot, writer) {
              writer.add("remote", { x: snapshot.x, y: 0 });
            }
          })
        ],
        readSnapshot(payload) {
          return isRecord(payload) &&
            typeof payload.tick === "number" &&
            typeof payload.x === "number" &&
            typeof payload.acknowledgedSequence === "number"
            ? (payload as ClientSnapshot)
            : undefined;
        },
        applyAuthoritative({ snapshot }) {
          authoritativeTicks.push(snapshot.tick);
        },
        prediction: {
          inputRateHz: 20,
          maxPredictionLeadInputs: 2,
          buffer: {
            cloneState: (state) => ({ ...state }),
            applyInput(state, input) {
              state.x += input.dx;
              return state;
            },
            presentState(from, to, context) {
              from.x += (to.x - from.x) * context.alpha;
              return from;
            },
            measureCorrection: (previous, next) => Math.abs(previous.x - next.x),
            predictionStepMs: 50
          },
          readInput() {
            return { dx: 1 };
          },
          encodeInput({ input, predictionFrame }) {
            return { sequence: predictionFrame.sequence, dx: input.dx };
          },
          readAuthoritativeState({ snapshot }) {
            return { x: snapshot.x };
          },
          readAcknowledgedSequence({ snapshot }) {
            return snapshot.acknowledgedSequence;
          }
        },
        applyFrame({ presented: tracks, predictedState }) {
          presented.push({
            remoteX: tracks.vector2("remote", { x: -1, y: 0 }).x,
            ...(predictedState === undefined ? {} : { predictedX: predictedState.x })
          });
        },
        expose(view) {
          exposed = view !== undefined;
          readReplicationDiagnostics = view === undefined ? undefined : () => view.diagnostics();
        }
      }
    });

    const dispose = module.install({
      eventBus: createEventBus(),
      systems: { register: (system) => systems.push(system) }
    });
    await runtime.createSession({
      id: "session-1",
      authority: "server-authoritative",
      localPeer: { id: "client", role: "client", playerId: "player.client" }
    });
    expect(exposed).toBe(true);
    expect(systems.map((system) => system.id)).toEqual([
      "gamekits.multiplayer.bridge.client-replication"
    ]);

    fake.emit(
      messageFrom(
        "stranger",
        MULTIPLAYER_SNAPSHOT_KIND,
        {
          tick: 0,
          x: 500,
          acknowledgedSequence: 0
        },
        { tick: 0 }
      )
    );
    fake.emit(
      messageFrom(
        "server",
        MULTIPLAYER_SNAPSHOT_KIND,
        {
          tick: 0,
          x: 0,
          acknowledgedSequence: 0
        },
        { tick: 0 }
      )
    );
    systems[0]?.update({ delta: 0, elapsed: 0, tick: 0 });
    systems[0]?.update({ delta: 25, elapsed: 25, tick: 1 });
    await waitFor(() => fake.sent.length === 1);

    expect(authoritativeTicks).toEqual([0]);
    expect(fake.sent[0]).toMatchObject({
      kind: MULTIPLAYER_INPUT_KIND,
      sourcePeerId: "client",
      targetPeerIds: ["server"],
      sequence: 1,
      payload: { sequence: 1, dx: 1 }
    });
    expect(fake.sent[0]).not.toHaveProperty("tick");
    expect(presented.at(-1)?.predictedX).toBeCloseTo(0.5);

    fake.emit(
      messageFrom(
        "server",
        MULTIPLAYER_SNAPSHOT_KIND,
        {
          tick: 1,
          x: 0.8,
          acknowledgedSequence: 1
        },
        { tick: 1 }
      )
    );
    systems[0]?.update({ delta: 25, elapsed: 50, tick: 2 });
    await waitFor(() => fake.sent.length === 2);

    expect(authoritativeTicks).toEqual([0, 1]);
    expect(fake.sent[1]).toMatchObject({ sequence: 2, payload: { sequence: 2, dx: 1 } });
    systems[0]?.update({ delta: 25, elapsed: 75, tick: 3 });
    expect(presented.at(-1)?.predictedX).toBeCloseTo(1.3);

    fake.failNextSend(new Error("transport interrupted"));
    systems[0]?.update({ delta: 25, elapsed: 100, tick: 4 });
    await waitFor(() => readReplicationDiagnostics?.().failedInputs === 1);
    expect(fake.sent).toHaveLength(2);
    expect(readReplicationDiagnostics?.().prediction?.pendingInputs).toBe(2);
    systems[0]?.update({ delta: 50, elapsed: 150, tick: 5 });
    expect(fake.sent).toHaveLength(2);
    expect(readReplicationDiagnostics?.().throttledInputs).toBe(1);

    fake.emit(
      messageFrom(
        "server",
        MULTIPLAYER_SNAPSHOT_KIND,
        {
          tick: 2,
          x: 1.6,
          acknowledgedSequence: 2
        },
        { tick: 2 }
      )
    );
    systems[0]?.update({ delta: 0, elapsed: 150, tick: 6 });
    expect(readReplicationDiagnostics?.().prediction).toMatchObject({
      pendingInputs: 0,
      resets: 1
    });

    dispose?.();
    expect(exposed).toBe(false);
  });

  it("uses one configured snapshot source and orders provider updates by sequence", async () => {
    type ClientSnapshot = { tick: number; x: number };

    const fake = createFakeBackend();
    const runtime = createMultiplayerRuntime({
      id: "managed-provider-source",
      backend: fake.backend,
      clock: () => 100
    });
    const systems: Array<{ update(ctx?: { delta?: number; elapsed?: number }): void }> = [];
    const sourceListeners = new Set<(message: MultiplayerMessageEnvelope) => void>();
    const applied: number[] = [];
    let sourceSessionId = "session-1";
    let currentSourceMessage: MultiplayerMessageEnvelope | undefined;
    let diagnostics:
      | (() => { rejectedSnapshots: number; lastAppliedSequence?: number })
      | undefined;
    const module = createMultiplayerModule<MultiplayerBridgeInstallContext, ClientSnapshot>({
      runtime,
      clientReplication: {
        authority: { resolveAuthorityPeerId: () => "server" },
        snapshotSource: {
          subscribe(listener) {
            sourceListeners.add(listener);
            return () => sourceListeners.delete(listener);
          },
          current() {
            return currentSourceMessage;
          }
        },
        playback: { interpolationDelayMs: 0 },
        readSnapshot(payload) {
          return isRecord(payload) &&
            typeof payload.tick === "number" &&
            typeof payload.x === "number"
            ? (payload as ClientSnapshot)
            : undefined;
        },
        applyAuthoritative({ snapshot }) {
          applied.push(snapshot.x);
        },
        applyFrame() {},
        expose(view) {
          diagnostics = view === undefined ? undefined : () => view.diagnostics();
        }
      }
    });
    const dispose = module.install({
      eventBus: createEventBus(),
      systems: { register: (system) => systems.push(system) }
    });
    const emitSource = (sequence: number, x: number) => {
      const message = {
        ...messageFrom("server", MULTIPLAYER_SNAPSHOT_KIND, { tick: 5, x }, { tick: 5 }),
        sessionId: sourceSessionId,
        sequence
      };
      currentSourceMessage = message;
      for (const listener of sourceListeners) {
        listener(message);
      }
    };
    emitSource(0, 0);
    await runtime.createSession({
      id: "session-1",
      authority: "server-authoritative",
      localPeer: { id: "client", role: "client" }
    });
    systems[0]?.update({ delta: 0, elapsed: 0 });
    fake.emit(messageFrom("server", MULTIPLAYER_SNAPSHOT_KIND, { tick: 1, x: 99 }, { tick: 1 }));
    emitSource(1, 1);
    systems[0]?.update({ delta: 0, elapsed: 0 });
    emitSource(2, 2);
    systems[0]?.update({ delta: 0, elapsed: 0 });
    emitSource(1, 3);
    systems[0]?.update({ delta: 0, elapsed: 0 });

    expect(applied).toEqual([0, 1, 2]);
    expect(diagnostics?.()).toMatchObject({
      rejectedSnapshots: 1,
      lastAppliedSequence: 2
    });

    await runtime.leaveSession("switch provider session");
    sourceSessionId = "session-2";
    await runtime.createSession({
      id: sourceSessionId,
      authority: "server-authoritative",
      localPeer: { id: "client", role: "client" }
    });
    emitSource(1, 4);
    systems[0]?.update({ delta: 0, elapsed: 0 });
    expect(applied).toEqual([0, 1, 2, 4]);
    expect(diagnostics?.()).toMatchObject({ lastAppliedSequence: 1 });
    dispose?.();
    expect(sourceListeners.size).toBe(0);
  });

  it("keeps managed prediction cadence smooth across irregular render frames", async () => {
    type ClientSnapshot = { tick: number; x: number; acknowledgedSequence: number };
    type ClientInput = { dx: number };
    type PredictedState = { x: number };

    const position = definePredictionVector2StateField<PredictedState>({
      readX: (state) => state.x,
      readY: () => 0,
      write(state, x) {
        state.x = x;
      }
    });
    const fake = createFakeBackend();
    const runtime = createMultiplayerRuntime({
      id: "managed-irregular-cadence",
      backend: fake.backend,
      clock: () => 100
    });
    const systems: Array<{
      update(ctx?: { delta?: number; elapsed?: number; tick?: number }): void;
    }> = [];
    const presented: number[] = [];
    let requestInputSample: (() => void) | undefined;
    const module = createMultiplayerModule<
      MultiplayerBridgeInstallContext,
      ClientSnapshot,
      ClientInput,
      PredictedState
    >({
      runtime,
      clientReplication: {
        authority: { resolveAuthorityPeerId: () => "server" },
        readSnapshot(payload) {
          return payload as ClientSnapshot;
        },
        prediction: {
          inputRateHz: 20,
          buffer: {
            cloneState: (state) => ({ ...state }),
            applyInput(state, input) {
              state.x += input.dx;
              return state;
            },
            presentation: definePredictionStatePresentation({ fields: [position] })
          },
          readInput() {
            return { dx: 1 };
          },
          encodeInput({ input, predictionFrame }) {
            return { sequence: predictionFrame.sequence, dx: input.dx };
          },
          readAuthoritativeState({ snapshot }) {
            return { x: snapshot.x };
          },
          readAcknowledgedSequence({ snapshot }) {
            return snapshot.acknowledgedSequence;
          }
        },
        applyFrame({ predictedState }) {
          if (predictedState !== undefined) {
            presented.push(predictedState.x);
          }
        },
        expose(view) {
          requestInputSample = view === undefined ? undefined : () => view.requestInputSample();
        }
      }
    });

    const dispose = module.install({
      eventBus: createEventBus(),
      systems: { register: (system) => systems.push(system) }
    });
    await runtime.createSession({
      id: "session-1",
      authority: "server-authoritative",
      localPeer: { id: "client", role: "client", playerId: "player.client" }
    });
    fake.emit(
      messageFrom(
        "server",
        MULTIPLAYER_SNAPSHOT_KIND,
        { tick: 0, x: 0, acknowledgedSequence: 0 },
        { tick: 0 }
      )
    );

    systems[0]?.update({ delta: 0, elapsed: 0, tick: 0 });
    for (const elapsed of [12, 24, 36, 48, 60]) {
      systems[0]?.update({ delta: 12, elapsed, tick: elapsed });
    }
    await waitFor(() => fake.sent.length === 2);

    requestInputSample?.();
    systems[0]?.update({ delta: 0, elapsed: 60, tick: 61 });
    await waitFor(() => fake.sent.length === 3);

    expect(presented).toHaveLength(7);
    expect(presented).toEqual([
      expect.closeTo(0),
      expect.closeTo(0.24),
      expect.closeTo(0.48),
      expect.closeTo(0.72),
      expect.closeTo(0.96),
      expect.closeTo(1.2),
      expect.closeTo(2)
    ]);
    expect(fake.sent[2]).toMatchObject({ sequence: 3, payload: { sequence: 3, dx: 1 } });

    dispose?.();
    await runtime.dispose();
  });
});

type ActionPayload = {
  type: "start";
};

type InputPayload = {
  sequence: number;
  dx: number;
};

type SnapshotPayload = {
  started: boolean;
  x: number;
  tick: number;
};

type FakeBackendHarness = {
  backend: MultiplayerBackendAdapter;
  sent: MultiplayerMessageEnvelope[];
  dropSession(): void;
  emit(message: MultiplayerMessageEnvelope): void;
  failNextSend(error?: unknown): void;
};

function createFakeBackend(): FakeBackendHarness {
  const listeners = new Set<MultiplayerBackendListener>();
  const sent: MultiplayerMessageEnvelope[] = [];
  let session: MultiplayerSession | undefined;
  let nextSendError: unknown;
  const connection: MultiplayerBackendConnection = {
    async createSession(request = {}) {
      const localPeer = {
        id: request.localPeer?.id ?? "host",
        role: request.localPeer?.role ?? "host",
        status: "connected" as const
      };
      session = {
        id: request.id ?? "session",
        kind: request.kind ?? "local",
        authority: request.authority ?? "host-authoritative",
        status: "open",
        peers: [localPeer]
      };
      return session;
    },
    async joinSession() {
      throw new Error("not implemented by fake backend");
    },
    async leaveSession() {
      session = undefined;
    },
    async send(message) {
      if (nextSendError !== undefined) {
        const error = nextSendError;
        nextSendError = undefined;
        throw error;
      }
      sent.push(message);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    close() {
      listeners.clear();
    },
    snapshot() {
      return {
        phase: session ? ("in-session" as const) : ("connected" as const),
        ...(session ? { localPeer: session.peers[0], session } : {}),
        peers: session?.peers ?? [],
        sent: sent.length,
        received: 0
      };
    }
  };

  return {
    sent,
    backend: {
      id: "fake",
      kind: "fake",
      capabilities: {
        channels: [{ id: "reliable", reliability: "reliable", ordering: "ordered" }]
      },
      async connect() {
        return connection;
      },
      snapshot() {
        return {
          id: "fake",
          kind: "fake",
          capabilities: this.capabilities
        };
      }
    },
    dropSession() {
      session = undefined;
    },
    failNextSend(error = new Error("fake backend send failed")) {
      nextSendError = error;
    },
    emit(message) {
      for (const listener of Array.from(listeners)) {
        listener(message);
      }
    }
  };
}

function readAction(payload: unknown): ActionPayload | undefined {
  return isRecord(payload) && payload.type === "start" ? { type: "start" } : undefined;
}

function readInput(payload: unknown): InputPayload | undefined {
  if (
    !isRecord(payload) ||
    typeof payload.sequence !== "number" ||
    typeof payload.dx !== "number"
  ) {
    return undefined;
  }

  return {
    sequence: payload.sequence,
    dx: payload.dx
  };
}

function messageFrom(
  sourcePeerId: string,
  kind: string,
  payload: unknown,
  options: { tick?: number } = {}
): MultiplayerMessageEnvelope {
  return {
    id: `${sourcePeerId}.${kind}.${Math.random()}`,
    sessionId: "session-1",
    channel: "reliable",
    kind,
    sourcePeerId,
    timestamp: 100,
    ...(options.tick === undefined ? {} : { tick: options.tick }),
    payload
  };
}

function peer(
  id: string,
  options: Partial<Omit<MultiplayerPeer, "id" | "status">> & {
    status?: MultiplayerPeer["status"];
  } = {}
): MultiplayerPeer {
  return {
    id,
    status: options.status ?? "connected",
    ...(options.displayName === undefined ? {} : { displayName: options.displayName }),
    ...(options.role === undefined ? {} : { role: options.role }),
    ...(options.playerId === undefined ? {} : { playerId: options.playerId }),
    ...(options.metadata === undefined ? {} : { metadata: options.metadata })
  };
}

function expectMultiplayerError(callback: () => unknown, code: string): void {
  try {
    callback();
  } catch (error) {
    expect(error).toMatchObject({ code });
    return;
  }
  throw new Error(`Expected multiplayer error: ${code}`);
}

async function waitFor(predicate: () => boolean): Promise<void> {
  const startedAt = Date.now();
  while (!predicate()) {
    if (Date.now() - startedAt > 500) {
      throw new Error("Timed out waiting for multiplayer-core condition.");
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
