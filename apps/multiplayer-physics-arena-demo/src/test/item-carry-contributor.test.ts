import { createMemoryPhysicsBackend, createPhysicsPredictionIsland } from "@gamekits/physics-core";
import { describe, expect, it } from "vitest";

import {
  ARENA_ITEM_CARRY_CONTRIBUTOR_ID,
  createArenaItemCarryContributor,
  createArenaItemCarryPredictionCommand
} from "../items/item-carry-contributor";

describe("Arena item carry prediction contributor", () => {
  it("replays bounded speed and jump modifiers after the character motor", () => {
    const island = createPhysicsPredictionIsland({
      backend: createMemoryPhysicsBackend({ id: "arena-carry", dimension: "3d" }),
      generation: "arena-carry.v1",
      initialMembers: [
        {
          id: "player.0",
          body: {
            id: "player.0",
            kind: "dynamic",
            position: { x: 0, y: 1, z: 0 },
            linearVelocity: { x: 10, y: 7, z: 0 }
          },
          colliders: [{ id: "player.0.collider", shape: { type: "sphere", radius: 0.5 } }]
        }
      ],
      environment: { bodies: [], colliders: [] },
      fixedDeltaMs: 1000 / 60,
      maxHistoryTicks: 16,
      maxCheckpointBytes: 64 * 1024,
      maxHistoryBytes: 512 * 1024,
      maxReplayTicksPerOperation: 8,
      maxMembers: 4,
      maxCommands: 32,
      auxiliaryContributors: [createArenaItemCarryContributor()],
      scene: { dimension: "3d", gravity: { x: 0, y: 0, z: 0 } }
    });
    island.queue({
      ...createArenaItemCarryPredictionCommand({
        memberId: "player.0",
        speedMultiplier: 0.5,
        jumpMultiplier: 0.8,
        jumpPressed: true
      }),
      tick: 1,
      sequence: 1
    });
    island.advanceTo(1);
    expect(island.body("player.0")?.linearVelocity.x).toBeCloseTo(3.2);
    expect(island.body("player.0")?.linearVelocity.y).toBeCloseTo(5.6);
    expect(island.body("player.0")?.linearVelocity.z).toBeCloseTo(0);
    expect(island.state().auxiliary).toEqual([
      { id: ARENA_ITEM_CARRY_CONTRIBUTOR_ID, version: "1", state: { version: 1 } }
    ]);
    island.dispose();
  });
});
