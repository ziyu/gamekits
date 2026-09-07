import { createMemoryPhysicsBackend, createPhysicsPredictionIsland } from "@gamekits/physics-core";
import { describe, expect, it } from "vitest";

import {
  resetArenaRoundPhysics,
  resolveArenaActorAuthorityStep
} from "../server/arena-actor-lifecycle";
import { createArenaMemberDefinitions } from "../shared/arena-definition";

describe("Knockout Arena actor lifecycle", () => {
  it("despawns an eliminated actor instead of teleporting it back into the live round", () => {
    const removed = resolveArenaActorAuthorityStep({
      phase: "running",
      removed: true,
      input: { sequence: 7, moveX: 1, moveZ: -1, jump: true },
      memberAvailable: true
    });

    expect(removed).toEqual({
      control: { sequence: 7, moveX: 0, moveZ: 0, jump: false },
      action: { type: "despawn" }
    });
    expect(
      resolveArenaActorAuthorityStep({
        phase: "running",
        removed: true,
        input: { sequence: 8, moveX: 1, moveZ: 0, jump: false },
        memberAvailable: false
      }).action
    ).toEqual({ type: "none" });
  });

  it("restores the initial actor membership only when the next round begins", () => {
    const actor = createArenaMemberDefinitions()[0]!;
    const island = createPhysicsPredictionIsland({
      backend: createMemoryPhysicsBackend({ dimension: "3d" }),
      generation: "round.1",
      initialMembers: [actor],
      scene: {
        dimension: "3d",
        gravity: { x: 0, y: 0, z: 0 },
        materialDefinitions: [{ id: "actor" }]
      }
    });

    try {
      island.queue({ type: "despawn", tick: 1, sequence: 1, memberId: actor.id });
      island.advanceTo(1);
      expect(island.body(actor.id)).toBeUndefined();

      resetArenaRoundPhysics(island, "m2.s1.r2");

      expect(island.state()).toMatchObject({
        generation: "m2.s1.r2",
        tick: 1,
        members: [{ id: actor.id, body: { position: actor.body.position } }]
      });
    } finally {
      island.dispose();
    }
  });
});
