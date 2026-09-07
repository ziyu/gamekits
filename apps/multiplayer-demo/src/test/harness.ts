import type { MultiplayerMessageEnvelope } from "@gamekits/multiplayer-core";
import { createMultiplayerDemoClient, type MultiplayerDemoClient } from "../client";
import {
  createLocalMultiplayerDemoServer,
  type LocalMultiplayerDemoServer
} from "../server/create-local-demo-server";

export type MultiplayerDemoTestHarness = {
  server: LocalMultiplayerDemoServer;
  client: MultiplayerDemoClient;
  connectClient(): Promise<void>;
  sendClientCommand: MultiplayerDemoClient["sendCommand"];
  tickHost(delta?: number): void;
  waitForHostCommand(fromPeerId?: string): Promise<MultiplayerMessageEnvelope>;
  dispose(): Promise<void>;
};

export async function createMultiplayerDemoTestHarness(): Promise<MultiplayerDemoTestHarness> {
  const server = await createLocalMultiplayerDemoServer({
    roomName: `gamekits_multiplayer_demo_test_${Date.now()}_${Math.floor(Math.random() * 10000)}`
  });
  const client = createMultiplayerDemoClient({
    endpoint: server.endpoint,
    roomName: server.roomName,
    sessionId: server.sessionId,
    hostPeerId: server.hostPeerId,
    peerId: "demo-client",
    displayName: "Demo Client"
  });
  let disposed = false;

  return {
    server,
    client,
    async connectClient() {
      await client.connect();
      await waitFor(() => server.host.peers().some((peer) => peer.id === "demo-client"));
    },
    sendClientCommand: client.sendCommand,
    tickHost(delta) {
      server.tick(delta);
    },
    async waitForHostCommand(fromPeerId = "demo-client") {
      await waitFor(() =>
        server.hostMessages.some(
          (message) => message.kind === "game.command" && message.sourcePeerId === fromPeerId
        )
      );
      const message = server.hostMessages.find(
        (candidate) => candidate.kind === "game.command" && candidate.sourcePeerId === fromPeerId
      );
      if (!message) {
        throw new Error("Host command disappeared before the test could read it.");
      }
      return message;
    },
    async dispose() {
      if (disposed) {
        return;
      }

      disposed = true;
      await client.dispose();
      await server.dispose();
    }
  };
}

export async function waitFor(
  predicate: () => boolean,
  options: { timeoutMs?: number; intervalMs?: number } = {}
): Promise<void> {
  const timeoutMs = options.timeoutMs ?? 1000;
  const intervalMs = options.intervalMs ?? 5;
  const startedAt = Date.now();

  while (!predicate()) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error("Timed out waiting for multiplayer demo condition.");
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}
