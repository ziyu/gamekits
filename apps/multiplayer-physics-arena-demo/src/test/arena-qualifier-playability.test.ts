import { createMemoryMultiplayerBackend } from "@gamekits/multiplayer-memory";
import { createMultiplayerRuntime } from "@gamekits/multiplayer-core";
import { initRapier3dPhysicsBackend } from "@gamekits/physics-rapier3d";
import { describe, expect, it } from "vitest";

import { prepareArenaBotNavigationRuntime } from "../ai/navigation";
import { ARENA_COMPILED_CONTENT } from "../content/default-content";
import { createArenaAuthorityRuntime } from "../server/arena-authority";

describe("Knockout Arena qualifier playability", () => {
  it("keeps bots racing forward through the expanded course instead of wiping at the start", async () => {
    const multiplayer = createMemoryMultiplayerBackend({ id: "arena.qualifier-playability" });
    const sessionId = "arena.qualifier-playability.session";
    const authorityPeerId = "arena.qualifier-playability.server";
    const host = createMultiplayerRuntime({
      id: "arena.qualifier-playability.host",
      backend: multiplayer,
      connectContext: { localPeer: { id: authorityPeerId, role: "server" } }
    });
    const client = createMultiplayerRuntime({
      id: "arena.qualifier-playability.client",
      backend: multiplayer,
      connectContext: { localPeer: { id: "peer.primary", role: "client" } }
    });
    await host.createSession({
      id: sessionId,
      kind: "private",
      authority: "server-authoritative",
      localPeer: { id: authorityPeerId, role: "server" }
    });
    await client.joinSession({
      sessionId,
      localPeer: { id: "peer.primary", role: "client" }
    });
    const physics = await initRapier3dPhysicsBackend({
      id: "arena.qualifier-playability.rapier",
      groups: { "arena-item": 0b001, "arena-actor": 0b010, "arena-world": 0b100 }
    });
    const navigation = await prepareArenaBotNavigationRuntime(ARENA_COMPILED_CONTENT);
    const authority = createArenaAuthorityRuntime({
      runtime: host,
      backend: physics,
      navigation,
      sessionId,
      authorityPeerId,
      now: () => 1_000
    });

    try {
      advanceUntil(authority, (snapshot) => snapshot.phase === "running", 240);
      for (let tick = 0; tick < 12; tick += 1) authority.tick();
      const started = authority.latestSnapshot();
      const sweeper = started.frame.members.find(({ id }) => id === "circuit.sweeper-alpha");
      expect(started.match.physicsStageStartedAtTick).toBeLessThan(started.frame.tick);
      expect(sweeper?.body.rotation).not.toEqual({ x: 0, y: 0, z: 0, w: 1 });
      const startZ = average(botPositions(started).map(({ z }) => z));
      for (let tick = 0; tick < 1_500; tick += 1) {
        try {
          authority.tick();
        } catch (error) {
          throw new Error(`Qualifier failed at sample tick ${tick}`, { cause: error });
        }
      }
      const sampled = authority.latestSnapshot();
      const activeBots = sampled.participants.filter(
        (participant) => participant.kind === "bot" && participant.status === "active"
      );
      const positions = botPositions(sampled);
      const furthestProgress = Math.min(...positions.map(({ z }) => z));

      expect(activeBots.length).toBeGreaterThanOrEqual(4);
      expect(positions).toHaveLength(activeBots.length);
      expect(furthestProgress).toBeLessThan(startZ - 24);
      expect(sampled.qualifierProgress.some(({ checkpointCount }) => checkpointCount > 0)).toBe(
        true
      );
    } finally {
      authority.dispose();
      await client.dispose();
      await host.dispose();
    }
  }, 30_000);
});

function advanceUntil(
  authority: ReturnType<typeof createArenaAuthorityRuntime>,
  predicate: (snapshot: ReturnType<typeof authority.latestSnapshot>) => boolean,
  maxTicks: number
): void {
  for (let tick = 0; tick < maxTicks; tick += 1) {
    authority.tick();
    if (predicate(authority.latestSnapshot())) return;
  }
  throw new Error(`Arena authority did not reach the expected state within ${maxTicks} ticks`);
}

function botPositions(
  snapshot: ReturnType<ReturnType<typeof createArenaAuthorityRuntime>["latestSnapshot"]>
) {
  return snapshot.frame.members.flatMap((member) =>
    member.id.startsWith("bot.")
      ? [
          {
            id: member.id,
            x: member.body.position.x,
            y: member.body.position.y,
            z: member.body.position.z ?? 0
          }
        ]
      : []
  );
}

function average(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
}
