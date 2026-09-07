import type { MultiplayerMessageEnvelope } from "@gamekits/multiplayer-core";
import { describe, expect, it } from "vitest";

import {
  createColyseusRoomRuntimeBridge,
  type ColyseusRoomRuntimeClient,
  type ColyseusRoomRuntimeFrame,
  type ColyseusRoomRuntimeHost
} from "../src/server";

type TestRuntimeSnapshot = {
  events: string[];
  lastTick: number;
};

class TestRoom implements ColyseusRoomRuntimeHost {
  readonly broadcasts: Array<{ type: string | number; message: unknown }> = [];
  simulation?: (deltaTime: number) => void;
  simulationDelay?: number;

  constructor(readonly roomId: string) {}

  setSimulationInterval(
    onTickCallback?: ((deltaTime: number) => void) | undefined,
    delay?: number
  ): void {
    this.simulation = onTickCallback;
    this.simulationDelay = delay;
  }

  broadcast(type: string | number, message: unknown): void {
    this.broadcasts.push({ type, message });
  }
}

class TestClient implements ColyseusRoomRuntimeClient {
  readonly sent: Array<{ type: string | number; message: unknown }> = [];

  constructor(readonly sessionId: string) {}

  send(type: string | number, message: unknown): void {
    this.sent.push({ type, message });
  }
}

describe("Colyseus Room runtime bridge", () => {
  it("owns one Room clock and releases runtime, peers, listeners, and timers", async () => {
    const events: string[] = [];
    let lastTick = 0;
    const room = new TestRoom("provider-room-1");
    const bridge = createColyseusRoomRuntimeBridge<
      TestRoom,
      TestClient,
      { sessionId: string },
      TestRuntimeSnapshot
    >({
      id: "test.room-runtime",
      fixedStepMs: 20,
      clock: () => 100,
      resolveSessionId(_room, options) {
        return options.sessionId;
      },
      createRuntime({ multiplayer, sessionId }) {
        expect(multiplayer.session()?.id).toBe(sessionId);
        return {
          boot() {
            events.push("boot");
          },
          start() {
            events.push("start");
          },
          tick(frame: ColyseusRoomRuntimeFrame) {
            lastTick = frame.tick;
            events.push(`tick:${frame.tick}:${frame.deltaMs}`);
          },
          stop() {
            events.push("stop");
          },
          dispose() {
            events.push("dispose");
          },
          snapshot() {
            return { events: [...events], lastTick };
          }
        };
      }
    });
    const authorityMessages: MultiplayerMessageEnvelope[] = [];
    const unsubscribe = bridge.multiplayer.subscribe((message) => authorityMessages.push(message));

    await bridge.create(room, { sessionId: "game-session-1" });
    expect(room.simulationDelay).toBe(20);
    expect(bridge.multiplayer.snapshot()).toMatchObject({
      backendId: "test.room-runtime.backend",
      phase: "in-session",
      localPeer: { id: "game-session-1.server", role: "server" },
      session: { id: "game-session-1", authority: "server-authoritative" },
      backend: { kind: "colyseus-room", activeSessions: 1, activeConnections: 1 },
      connection: { phase: "in-session", session: { id: "game-session-1" } }
    });

    const leader = new TestClient("transport-leader");
    const client = new TestClient("transport-client");
    bridge.join(leader, { id: "peer-leader", role: "party-leader" });
    bridge.join(client, { id: "peer-client", role: "client" });
    expect(room.broadcasts.map((entry) => entry.type)).toEqual([
      "gamekits.presence",
      "gamekits.presence"
    ]);
    expect(bridge.multiplayer.session()).toMatchObject({
      id: "game-session-1",
      status: "open",
      peers: [
        { id: "game-session-1.server", role: "server" },
        { id: "peer-leader", role: "party-leader" },
        { id: "peer-client", role: "client" }
      ]
    });

    const command: MultiplayerMessageEnvelope = {
      id: "command-1",
      sessionId: "game-session-1",
      channel: "reliable",
      kind: "game.action",
      sourcePeerId: "peer-client",
      targetPeerIds: ["game-session-1.server"],
      sequence: 1,
      timestamp: 100,
      payload: { action: "ready" }
    };
    expect(bridge.receive(client, command)).toBe(true);
    expect(authorityMessages.at(-1)).toEqual(command);

    room.simulation?.(20);
    room.simulation?.(22);
    expect(lastTick).toBe(2);

    await bridge.multiplayer.send({
      channel: "reliable",
      kind: "game.command.result",
      targetPeerIds: ["peer-client"],
      payload: { accepted: true }
    });
    expect(client.sent).toHaveLength(1);
    expect(leader.sent).toHaveLength(0);
    await expect(
      bridge.multiplayer.send({
        sessionId: "some-other-session",
        channel: "reliable",
        kind: "game.command.result",
        payload: { accepted: false }
      })
    ).rejects.toMatchObject({ code: "MULTIPLAYER_INVALID_MESSAGE" });
    await expect(bridge.multiplayer.createSession()).rejects.toMatchObject({
      code: "MULTIPLAYER_UNSUPPORTED_CAPABILITY"
    });
    await expect(
      bridge.multiplayer.joinSession({ sessionId: "game-session-1" })
    ).rejects.toMatchObject({ code: "MULTIPLAYER_UNSUPPORTED_CAPABILITY" });
    await expect(bridge.multiplayer.leaveSession()).rejects.toMatchObject({
      code: "MULTIPLAYER_UNSUPPORTED_CAPABILITY"
    });
    expect(bridge.multiplayer.snapshot()).toMatchObject({
      sent: 1,
      received: 3,
      connection: { sent: 3, received: 3 }
    });

    bridge.leave(leader, 1000);
    const beforeDispose = bridge.snapshot();
    expect(beforeDispose).toMatchObject({
      phase: "running",
      ticks: 2,
      elapsedMs: 42,
      joins: 2,
      leaves: 1,
      receivedMessages: 1,
      activePeers: 1
    });

    unsubscribe();
    await bridge.dispose();
    await bridge.dispose();

    expect(room.simulation).toBeUndefined();
    expect(events).toEqual(["boot", "start", "tick:1:20", "tick:2:22", "stop", "dispose"]);
    expect(bridge.snapshot()).toMatchObject({
      phase: "disposed",
      activePeers: 0,
      runtime: { lastTick: 2 }
    });
    expect(bridge.multiplayer.snapshot()).toMatchObject({
      phase: "disposed",
      peers: []
    });
  });

  it("rejects spoofed, misdirected, and oversized authority ingress", async () => {
    const diagnostics: string[] = [];
    const room = new TestRoom("provider-room-2");
    const bridge = createColyseusRoomRuntimeBridge<TestRoom, TestClient, Record<string, never>>({
      maxPayloadBytes: 180,
      onDiagnostic(diagnostic) {
        diagnostics.push(diagnostic.code);
      },
      createRuntime() {
        return {
          tick() {},
          dispose() {}
        };
      }
    });

    await bridge.create(room, {});
    const client = new TestClient("transport-client");
    bridge.join(client, { id: "peer-client" });

    expect(bridge.receive(client, { nope: true })).toBe(false);
    expect(
      bridge.receive(client, envelope({ sourcePeerId: "spoofed", payload: { ok: true } }))
    ).toBe(false);
    expect(
      bridge.receive(
        client,
        envelope({ targetPeerIds: ["some-other-peer"], payload: { ok: true } })
      )
    ).toBe(false);
    expect(bridge.receive(client, envelope({ payload: { text: "x".repeat(512) } }))).toBe(false);

    expect(bridge.snapshot()).toMatchObject({
      receivedMessages: 0,
      rejectedMessages: 4,
      activePeers: 1
    });
    expect(diagnostics).toEqual([
      "invalid-envelope",
      "invalid-source",
      "invalid-target",
      "payload-too-large"
    ]);

    await bridge.dispose();
  });

  it("cleans a partially created runtime without starting the simulation interval", async () => {
    const events: string[] = [];
    const room = new TestRoom("provider-room-3");
    const bridge = createColyseusRoomRuntimeBridge<TestRoom, TestClient, Record<string, never>>({
      createRuntime() {
        return {
          boot() {
            events.push("boot");
            throw new Error("boot failed");
          },
          tick() {},
          stop() {
            events.push("stop");
          },
          dispose() {
            events.push("dispose");
          }
        };
      }
    });

    await expect(bridge.create(room, {})).rejects.toThrow("boot failed");
    expect(events).toEqual(["boot", "stop", "dispose"]);
    expect(room.simulation).toBeUndefined();
    expect(bridge.snapshot()).toMatchObject({ phase: "failed", activePeers: 0 });

    await bridge.dispose();
    expect(bridge.snapshot().phase).toBe("disposed");
  });
});

function envelope(patch: Partial<MultiplayerMessageEnvelope>): MultiplayerMessageEnvelope {
  return {
    id: "message-1",
    sessionId: "provider-room-2",
    channel: "reliable",
    kind: "game.input",
    sourcePeerId: "peer-client",
    targetPeerIds: ["provider-room-2.server"],
    sequence: 1,
    timestamp: 100,
    payload: {},
    ...patch
  };
}
