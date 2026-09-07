import { createMemoryPhysicsBackend, createPhysicsPredictionIsland } from "@gamekits/physics-core";
import { describe, expect, it } from "vitest";

import { compileArenaContent, createArenaDataRegistry } from "../content/registry";
import { createArenaItemAuthorityRuntime } from "../items/item-authority-runtime";
import { compileArenaStageItemManifest } from "../items/item-definition";
import {
  arenaItemPhysicsMemberId,
  createArenaItemPhysicsMaterial,
  createArenaItemPhysicsMember,
  planArenaItemPickup,
  planArenaItemRelease
} from "../items/item-physics";

describe("Knockout Arena item Physics mapping", () => {
  it("despawns carried state and spawns a new clamped release generation", () => {
    const content = compileArenaContent(createArenaDataRegistry());
    const manifest = compileArenaStageItemManifest(content.stages[1]!);
    const definition = manifest.definitions.find((entry) => entry.id === "item.foam-ball")!;
    const items = createArenaItemAuthorityRuntime({ definitions: manifest.definitions });
    const initial = items
      .installStage({
        stageInstanceId: "match.1:stage.scrap-yard:2",
        generation: { match: 1, stage: 2, membershipRevision: 4 },
        manifest,
        tick: 0
      })
      .find((entry) => entry.definitionId === definition.id)!;
    const island = createPhysicsPredictionIsland({
      backend: createMemoryPhysicsBackend({ dimension: "3d" }),
      generation: "item.physics",
      initialMembers: [
        createArenaItemPhysicsMember({
          definition,
          item: initial,
          position: initial.spawnPosition
        })
      ],
      scene: {
        dimension: "3d",
        gravity: { x: 0, y: 0, z: 0 },
        materialDefinitions: [createArenaItemPhysicsMaterial(definition)]
      }
    });
    try {
      items.dispatch({
        type: "claim",
        id: "claim.1",
        itemId: initial.id,
        itemGeneration: 1,
        participantId: "player.0",
        tick: 1
      });
      const carried = items.dispatch({
        type: "resolve-claim",
        id: "resolve.1",
        claimId: "claim.1",
        accepted: true,
        tick: 1
      }).item!;
      island.queue(planArenaItemPickup({ item: carried, tick: 1, sequence: 1 }));
      island.advanceTo(1);
      expect(island.body(arenaItemPhysicsMemberId(carried))).toBeUndefined();

      const dropped = items.dispatch({
        type: "drop",
        id: "drop.1",
        itemId: carried.id,
        itemGeneration: carried.instanceGeneration,
        participantId: "player.0",
        tick: 2
      }).item!;
      island.queue(
        planArenaItemRelease({
          definition,
          item: dropped,
          position: { x: 0, y: 2, z: 0 },
          aim: { x: 0, y: 0.2, z: -1 },
          inheritedVelocity: { x: 50, y: 0, z: 0 },
          charge: 1,
          tick: 2,
          sequence: 2,
          mode: "drop"
        })
      );
      island.advanceTo(2);
      const released = island.body(arenaItemPhysicsMemberId(dropped))!;
      expect(released.position.x).toBeGreaterThan(0);
      expect(released.position.z).toBeLessThan(0);
      const speed = released.linearVelocity!;
      expect(Math.hypot(speed.x, speed.y, speed.z ?? 0)).toBeLessThanOrEqual(
        definition.maxLinearSpeed + 0.0001
      );
    } finally {
      island.dispose();
      items.dispose();
    }
  });
});
