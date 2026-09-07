import {
  createMultiplayerNetworkConditionSimulator,
  createMultiplayerRuntime,
  type MultiplayerMessageEnvelope
} from "@gamekits/multiplayer-core";
import { describe, expect, it } from "vitest";
import { createMemoryMultiplayerBackend } from "../src";

describe("multiplayer network-condition simulator", () => {
  it("delays, drops, duplicates and flushes selected messages deterministically", async () => {
    const simulator = createMultiplayerNetworkConditionSimulator(
      createMemoryMultiplayerBackend({ id: "network-simulator.memory" }),
      {
        latencyMs: 50,
        jitterMs: 10,
        lossPercent: 20,
        duplicatePercent: 25,
        seed: 42,
        maxPendingDeliveries: 64,
        affects: (direction, message) => direction === "outgoing" && message.kind === "game.input"
      }
    );
    const host = createMultiplayerRuntime({
      id: "network-simulator.host",
      backend: simulator.backend
    });
    const client = createMultiplayerRuntime({
      id: "network-simulator.client",
      backend: simulator.backend
    });
    const received: MultiplayerMessageEnvelope[] = [];
    host.subscribe((message) => {
      if (message.kind === "game.input") received.push(message);
    });
    await host.createSession({ id: "network-simulator", localPeer: { id: "host" } });
    await client.joinSession({ sessionId: "network-simulator", localPeer: { id: "client" } });

    for (let sequence = 1; sequence <= 20; sequence += 1) {
      await client.send({
        channel: "reliable",
        kind: "game.input",
        payload: { sequence }
      });
    }
    expect(received).toHaveLength(0);
    expect(simulator.diagnostics().pendingDeliveries).toBeGreaterThan(0);
    await simulator.advance(100);
    await simulator.flush();

    const diagnostics = simulator.diagnostics();
    expect(diagnostics.pendingDeliveries).toBe(0);
    expect(diagnostics.droppedMessages).toBeGreaterThan(0);
    expect(diagnostics.duplicatedMessages).toBeGreaterThan(0);
    expect(diagnostics.capacityDrops).toBe(0);
    expect(diagnostics.deliveryErrors).toBe(0);
    expect(diagnostics.activeConnections).toBe(2);
    expect(received.length).toBeGreaterThan(0);
    expect(received.length).toBeLessThan(30);

    await host.dispose();
    await client.dispose();
    expect(simulator.diagnostics().activeConnections).toBe(0);
    simulator.dispose();
    expect(simulator.diagnostics()).toMatchObject({ disposed: true, pendingDeliveries: 0 });
  });
});

describe("multiplayer network-condition simulator delivery diagnostics", () => {
  it("retains the last delivery failure reason", async () => {
    const simulator = createMultiplayerNetworkConditionSimulator(
      createMemoryMultiplayerBackend({ id: "network-simulator.failure" }),
      { latencyMs: 10, seed: 7 }
    );
    const host = createMultiplayerRuntime({
      id: "network-simulator.failure.host",
      backend: simulator.backend
    });
    const client = createMultiplayerRuntime({
      id: "network-simulator.failure.client",
      backend: simulator.backend
    });
    client.subscribe((message) => {
      if (message.kind === "game.snapshot") throw new Error("snapshot decode failed");
    });
    await host.createSession({ id: "network-simulator-failure", localPeer: { id: "host" } });
    await client.joinSession({
      sessionId: "network-simulator-failure",
      localPeer: { id: "client" }
    });
    await host.send({
      channel: "reliable",
      kind: "game.snapshot",
      payload: { tick: 1 }
    });
    await simulator.advance(10);

    expect(simulator.diagnostics()).toMatchObject({
      deliveryErrors: 1,
      lastDeliveryError: "snapshot decode failed"
    });

    await client.dispose();
    await host.dispose();
    simulator.dispose();
  });
});
