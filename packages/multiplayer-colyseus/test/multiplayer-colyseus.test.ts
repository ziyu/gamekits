import {
  createMultiplayerAuthorityBindingStore,
  runMultiplayerAuthorityConformance,
  runMultiplayerBackendConformance,
  type MultiplayerMessageEnvelope
} from "@gamekits/multiplayer-core";
import { describe, expect, it } from "vitest";

import { createColyseusMultiplayerBackend, createColyseusNativeStateBridge } from "../src";
import {
  createGameKitsColyseusServer,
  GameKitsColyseusRoom,
  type GameKitsColyseusRoomOptions
} from "../src/server";

describe("@gamekits/multiplayer-colyseus", () => {
  it("passes the multiplayer backend conformance against a local Colyseus room", async () => {
    const roomName = uniqueRoomName("conformance");
    const server = await createGameKitsColyseusServer({ roomName });

    try {
      const report = await runMultiplayerBackendConformance({
        createBackend: () =>
          createColyseusMultiplayerBackend({
            endpoint: server.endpoint,
            roomName
          }),
        clock: () => 1000
      });

      expect(report.sessionId).toBe("conformance.session");
      expect(report.receivedByClient.some((message) => message.sourcePeerId === "host")).toBe(true);
      expect(report.receivedByHost.some((message) => message.sourcePeerId === "client")).toBe(true);
    } finally {
      await server.dispose();
    }
  });

  it("passes the multiplayer authority conformance against local Colyseus rooms", async () => {
    const roomName = uniqueRoomName("authority");
    const server = await createGameKitsColyseusServer({ roomName });

    try {
      const report = await runMultiplayerAuthorityConformance({
        createBackend: () =>
          createColyseusMultiplayerBackend({
            endpoint: server.endpoint,
            roomName
          }),
        clock: () => 1000,
        messageTimeoutMs: 1500
      });

      expect(report.authoritativeSnapshot).toEqual(report.localSnapshot);
      expect(report.authoritativeSnapshot).toMatchObject({
        started: true,
        positions: {
          "client-a": 2,
          "client-b": 3
        },
        tick: 2
      });
      expect(report.hostDiagnostics).toMatchObject({
        acceptedActions: 1,
        acceptedInputs: 2,
        rejectedInputs: 1
      });
      expect(report.clientDiagnostics.clientB).toMatchObject({
        rejectedMessages: 3,
        appliedSnapshots: 2,
        appliedPatches: 1,
        appliedResults: 1
      });
      expect(report.authoritativePatch).toEqual({
        positions: {
          "client-a": 2,
          "client-b": 3
        }
      });
      expect(report.authoritativeResult).toEqual({
        commandId: "start",
        accepted: true
      });
      expect(
        report.receivedByHost.some((message) => message.sourcePeerId === "isolated-client")
      ).toBe(false);
      expect(
        report.receivedByIsolatedHost.some((message) => message.sourcePeerId === "isolated-client")
      ).toBe(true);
    } finally {
      await server.dispose();
    }
  });

  it("rejects oversized outgoing envelopes before they reach the room", async () => {
    const roomName = uniqueRoomName("payload");
    const server = await createGameKitsColyseusServer({
      roomName,
      roomOptions: { maxPayloadBytes: 64 }
    });
    const backend = createColyseusMultiplayerBackend({
      endpoint: server.endpoint,
      roomName,
      maxPayloadBytes: 64
    });
    const connection = await backend.connect({
      runtimeId: "payload.host",
      localPeer: { id: "host", role: "host" },
      clock: () => 1000
    });

    try {
      const session = await connection.createSession({
        id: "payload.session",
        localPeer: { id: "host", role: "host" }
      });

      await expect(
        connection.send({
          id: "payload.too-large",
          sessionId: session.id,
          channel: "reliable",
          kind: "game.command",
          sourcePeerId: "host",
          timestamp: 1000,
          payload: { text: "x".repeat(256) }
        })
      ).rejects.toMatchObject({ code: "MULTIPLAYER_INVALID_MESSAGE" });
    } finally {
      await connection.close("test cleanup");
      await server.dispose();
    }
  });

  it("joins the requested GameKits session across independent backend instances", async () => {
    const roomName = uniqueRoomName("session-map");
    const server = await createGameKitsColyseusServer({ roomName });
    const hostA = await createColyseusMultiplayerBackend({
      endpoint: server.endpoint,
      roomName,
      joinByIdFallback: true
    }).connect({
      runtimeId: "session-map.host-a",
      localPeer: { id: "host-a", role: "host" },
      clock: () => 1000
    });
    const hostB = await createColyseusMultiplayerBackend({
      endpoint: server.endpoint,
      roomName,
      joinByIdFallback: true
    }).connect({
      runtimeId: "session-map.host-b",
      localPeer: { id: "host-b", role: "host" },
      clock: () => 1000
    });
    const clientB = await createColyseusMultiplayerBackend({
      endpoint: server.endpoint,
      roomName,
      joinByIdFallback: true
    }).connect({
      runtimeId: "session-map.client-b",
      localPeer: { id: "client-b", role: "client" },
      clock: () => 1000
    });
    const hostAMessages: MultiplayerMessageEnvelope[] = [];
    const hostBMessages: MultiplayerMessageEnvelope[] = [];
    const unsubscribeHostA = hostA.subscribe((message) => hostAMessages.push(message));
    const unsubscribeHostB = hostB.subscribe((message) => hostBMessages.push(message));

    try {
      await hostA.createSession({
        id: "session-map-alpha",
        localPeer: { id: "host-a", role: "host" }
      });
      await hostB.createSession({
        id: "session-map-bravo",
        localPeer: { id: "host-b", role: "host" }
      });
      await clientB.joinSession({
        sessionId: "session-map-bravo",
        localPeer: { id: "client-b", role: "client" }
      });
      await waitFor(() =>
        hostB.snapshot().peers.some((peer) => peer.id === "client-b" && peer.status === "connected")
      );

      expect(hostA.snapshot().peers.map((peer) => peer.id)).toEqual(["host-a"]);
      expect(
        hostB
          .snapshot()
          .peers.map((peer) => peer.id)
          .sort()
      ).toEqual(["client-b", "host-b"]);

      await clientB.send({
        id: "session-map.client-b.1",
        sessionId: "session-map-bravo",
        channel: "reliable",
        kind: "session-map.command",
        sourcePeerId: "client-b",
        targetPeerIds: ["host-b"],
        timestamp: 1000,
        payload: { ok: true }
      });
      await waitFor(() => hostBMessages.some((message) => message.kind === "session-map.command"));

      expect(hostAMessages.some((message) => message.kind === "session-map.command")).toBe(false);
    } finally {
      unsubscribeHostA();
      unsubscribeHostB();
      await clientB.close("test cleanup");
      await hostB.close("test cleanup");
      await hostA.close("test cleanup");
      await server.dispose();
    }
  });

  it("closes a host-authoritative room when the host peer leaves", async () => {
    const roomName = uniqueRoomName("host-close");
    const sessionId = "host-close-session";
    const server = await createGameKitsColyseusServer({ roomName });
    const host = await createColyseusMultiplayerBackend({
      endpoint: server.endpoint,
      roomName,
      joinByIdFallback: true
    }).connect({
      runtimeId: "host-close.host",
      localPeer: { id: "host", role: "host" },
      clock: () => 1000
    });
    const client = await createColyseusMultiplayerBackend({
      endpoint: server.endpoint,
      roomName
    }).connect({
      runtimeId: "host-close.client",
      localPeer: { id: "client", role: "client" },
      clock: () => 1000
    });
    const lateClient = await createColyseusMultiplayerBackend({
      endpoint: server.endpoint,
      roomName
    }).connect({
      runtimeId: "host-close.late-client",
      localPeer: { id: "late-client", role: "client" },
      clock: () => 1000
    });

    try {
      await host.createSession({
        id: sessionId,
        authority: "host-authoritative",
        localPeer: { id: "host", role: "host" }
      });
      await client.joinSession({
        sessionId,
        localPeer: { id: "client", role: "client" }
      });
      await waitFor(() =>
        host.snapshot().peers.some((peer) => peer.id === "client" && peer.status === "connected")
      );

      await host.close("host left");
      await waitFor(() => client.snapshot().phase !== "in-session");

      expect(client.snapshot().session).toBeUndefined();
      await expect(
        lateClient.joinSession({
          sessionId,
          localPeer: { id: "late-client", role: "client" }
        })
      ).rejects.toBeTruthy();
    } finally {
      await lateClient.close("test cleanup");
      await client.close("test cleanup");
      await host.close("test cleanup");
      await server.dispose();
    }
  });

  it("redacts endpoint credentials from backend diagnostics", () => {
    const backend = createColyseusMultiplayerBackend({
      endpoint: "http://user:secret@127.0.0.1:2567",
      roomName: "diagnostics"
    });

    expect(backend.snapshot().metadata?.endpoint).toBe("http://127.0.0.1:2567/");
  });

  it("publishes host-owned state through a real Colyseus Schema room", async () => {
    const roomName = uniqueRoomName("schema-state");
    const roomInstances: GameKitsColyseusRoom[] = [];
    class SchemaTestRoom extends GameKitsColyseusRoom {
      override onCreate(options: GameKitsColyseusRoomOptions = {}): void {
        super.onCreate(options);
        roomInstances.push(this);
      }
    }
    const server = await createGameKitsColyseusServer({
      roomName,
      roomClass: SchemaTestRoom,
      roomOptions: {
        authority: "host-authoritative",
        nativeStateSync: {
          enabled: true,
          schemaVersion: "arena.v1"
        },
        nativeCapabilities: {
          authoritativePath: "colyseus-schema"
        }
      }
    });
    const hostBackend = createColyseusMultiplayerBackend({
      endpoint: server.endpoint,
      roomName,
      nativeCapabilities: { authoritativePath: "colyseus-schema" },
      nativeStateSync: { enabled: true, schemaVersion: "arena.v1" }
    });
    const clientBackend = createColyseusMultiplayerBackend({
      endpoint: server.endpoint,
      roomName,
      joinByIdFallback: true,
      nativeCapabilities: { authoritativePath: "colyseus-schema" },
      nativeStateSync: { enabled: true, schemaVersion: "arena.v1" }
    });
    const host = await hostBackend.connect({
      runtimeId: "schema.host",
      localPeer: { id: "host", role: "host" }
    });
    const client = await clientBackend.connect({
      runtimeId: "schema.client",
      localPeer: { id: "client", role: "client" }
    });
    const binding = createMultiplayerAuthorityBindingStore({
      sessionId: "schema-session",
      mode: "host-authoritative",
      authorityPeerId: "host",
      authorityEndpoint: { kind: "server", id: "colyseus-schema", peerId: "host" },
      snapshotVersion: "arena.v1"
    });
    const applied: number[] = [];
    const bridge = clientBackend.native().createStateBridge<{ x: number }>({
      binding,
      sourceEndpointId: "colyseus-schema",
      readState(state) {
        return isRecord(state) && typeof state.x === "number" ? { x: state.x } : undefined;
      },
      applyState(state) {
        applied.push(state.x);
      }
    });
    const unsubscribe = clientBackend.native().subscribeState((update) => {
      bridge.receiveState(update);
    });

    try {
      await host.createSession({
        id: "schema-session",
        authority: "host-authoritative",
        localPeer: { id: "host", role: "host" }
      });
      await client.joinSession({
        sessionId: "schema-session",
        localPeer: { id: "client", role: "client" }
      });

      hostBackend.native().publishState({
        sessionId: "schema-session",
        sourcePeerId: "host",
        tick: 1,
        version: "arena.v2",
        timestamp: 90,
        state: { x: 6 }
      });
      hostBackend.native().publishState({
        sessionId: "schema-session",
        sourcePeerId: "host",
        tick: 1,
        version: "arena.v1",
        timestamp: 100,
        state: { x: 7 }
      });
      await waitFor(() => applied.includes(7));

      clientBackend.native().publishState({
        sessionId: "schema-session",
        sourcePeerId: "client",
        tick: 2,
        version: "arena.v1",
        timestamp: 110,
        state: { x: 99 }
      });
      hostBackend.native().publishState({
        sessionId: "schema-session",
        sourcePeerId: "host",
        tick: 2,
        version: "arena.v1",
        timestamp: 120,
        state: { x: 8 }
      });
      await waitFor(() => applied.includes(8));

      expect(applied).toEqual([7, 8]);
      expect(bridge.diagnostics()).toMatchObject({
        authoritativePath: "colyseus-schema",
        appliedUpdates: 2,
        rejectedUpdates: 0,
        lastAppliedTick: 2,
        lastStateVersion: 2,
        lastVersion: "arena.v1"
      });
      expect(roomInstances[0]?.diagnostics()).toMatchObject({
        invalidNativeStateUpdates: 2,
        nativeStateUpdates: 2
      });
    } finally {
      unsubscribe();
      await client.close("test cleanup");
      await host.close("test cleanup");
      await server.dispose();
    }
  });

  it("declares provider-native capability lanes without exposing room handles in snapshots", () => {
    const backend = createColyseusMultiplayerBackend({
      endpoint: "http://127.0.0.1:2567",
      roomName: "native-capabilities",
      nativeCapabilities: {
        authoritativePath: "colyseus-schema",
        stateSync: {
          available: true,
          lane: "colyseus-schema",
          schemaVersion: "arena.v1"
        },
        reconnect: {
          available: true,
          mode: "seat-reservation"
        },
        matchmaking: true,
        roomMetadata: {
          region: "local"
        }
      }
    });

    expect(backend.native().capabilities()).toMatchObject({
      authoritativePath: "colyseus-schema",
      stateSync: {
        active: true,
        schemaVersion: "arena.v1"
      }
    });
    expect(backend.snapshot().metadata).toMatchObject({
      nativeCapabilities: {
        authoritativePath: "colyseus-schema",
        lanes: ["gamekits-envelope", "colyseus-schema"],
        stateSync: {
          available: true,
          active: true,
          schemaVersion: "arena.v1"
        },
        reconnect: {
          available: true,
          mode: "seat-reservation"
        },
        matchmaking: {
          available: true
        },
        roomMetadata: {
          region: "local"
        }
      }
    });
    expect(backend.snapshot().metadata).not.toHaveProperty("room");
    expect(backend.snapshot().metadata).not.toHaveProperty("client");
  });

  it("gates provider-native state through authority binding diagnostics", () => {
    const binding = createMultiplayerAuthorityBindingStore({
      sessionId: "native-session",
      mode: "server-authoritative",
      authorityEndpoint: {
        kind: "server",
        id: "colyseus-schema"
      }
    });
    let latest: { x: number } | undefined;
    const bridge = createColyseusNativeStateBridge<{ x: number }>({
      binding,
      authoritativePath: "colyseus-schema",
      sourceEndpointId: "colyseus-schema",
      clock: () => 150,
      readState(state) {
        return isRecord(state) && typeof state.x === "number" ? { x: state.x } : undefined;
      },
      applyState(state) {
        latest = state;
      }
    });

    expect(
      bridge.receiveState({
        sessionId: "other-session",
        state: { x: 1 },
        timestamp: 100
      })
    ).toMatchObject({
      allowed: false,
      code: "session-mismatch"
    });
    expect(
      bridge.receiveState({
        sessionId: "native-session",
        sourceEndpointId: "other-endpoint",
        state: { x: 2 },
        timestamp: 100
      })
    ).toMatchObject({
      allowed: false,
      code: "authority-endpoint-mismatch"
    });

    expect(
      bridge.receiveState({
        sessionId: "native-session",
        state: { x: 7 },
        tick: 3,
        version: "arena.v1",
        timestamp: 100
      })
    ).toEqual({ allowed: true });

    expect(latest).toEqual({ x: 7 });
    expect(binding.current()).toMatchObject({
      tick: 3,
      snapshotVersion: "arena.v1"
    });
    expect(
      bridge.receiveState({
        sessionId: "native-session",
        state: { x: 8 },
        tick: 4,
        version: "arena.v2",
        timestamp: 100
      })
    ).toMatchObject({ allowed: false, code: "snapshot-version-mismatch" });
    expect(
      bridge.receiveState({
        sessionId: "native-session",
        state: { x: 6 },
        tick: 2,
        version: "arena.v1",
        timestamp: 100
      })
    ).toMatchObject({ allowed: false, code: "stale-native-state" });
    expect(bridge.diagnostics()).toMatchObject({
      authoritativePath: "colyseus-schema",
      sourceEndpointId: "colyseus-schema",
      receivedUpdates: 5,
      appliedUpdates: 1,
      rejectedUpdates: 4,
      lastAppliedTick: 3,
      lastVersion: "arena.v1",
      lastStateAgeMs: 50,
      lastRejected: {
        code: "stale-native-state",
        sessionId: "native-session",
        sourceEndpointId: "colyseus-schema"
      }
    });

    const boundedBridge = createColyseusNativeStateBridge<{ x: number }>({
      binding,
      sourceEndpointId: "colyseus-schema",
      maxStateBytes: 8,
      applyState() {}
    });
    expect(
      boundedBridge.receiveState({
        sessionId: "native-session",
        sourceEndpointId: "colyseus-schema",
        version: "arena.v1",
        stateVersion: 1,
        stateBytes: 9,
        state: { x: 1 }
      })
    ).toMatchObject({ allowed: false, code: "native-state-too-large" });
    expect(
      boundedBridge.receiveState({
        sessionId: "native-session",
        sourceEndpointId: "colyseus-schema",
        version: "arena.v1",
        stateVersion: 2,
        stateBytes: -1,
        state: { x: 1 }
      })
    ).toMatchObject({ allowed: false, code: "invalid-native-state-size" });
  });
});

function uniqueRoomName(scope: string): string {
  return `gamekits_${scope}_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
}

async function waitFor(predicate: () => boolean): Promise<void> {
  const startedAt = Date.now();

  while (!predicate()) {
    if (Date.now() - startedAt > 1000) {
      throw new Error("Timed out waiting for Colyseus multiplayer condition.");
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
