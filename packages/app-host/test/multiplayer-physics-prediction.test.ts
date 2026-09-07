import {
  createStandardMultiplayerPhysicsPredictionDomain,
  type StandardMultiplayerPhysicsAuthoritySpawn
} from "../src";
import {
  createMemoryPhysicsBackend,
  createPhysicsPredictionIsland,
  type PhysicsPredictionIslandMemberDefinition
} from "@gamekits/physics-core";
import { describe, expect, it } from "vitest";

const TARGET: PhysicsPredictionIslandMemberDefinition = {
  id: "target",
  body: { id: "target.body", kind: "dynamic", position: { x: 8, y: 0 }, gravityScale: 0 }
};
const PROJECTILE: PhysicsPredictionIslandMemberDefinition = {
  id: "shot-1.projectile",
  body: {
    id: "shot-1.projectile.body",
    kind: "dynamic",
    position: { x: 0, y: 0 },
    linearVelocity: { x: 2, y: 0 },
    gravityScale: 0
  }
};

describe("standard Multiplayer + Physics prediction domain", () => {
  it("matches predicted members and hard-corrects an unreplayable authority baseline", () => {
    const backend = createMemoryPhysicsBackend();
    const owner = createPhysicsPredictionIsland({
      backend,
      generation: 1,
      initialMembers: [TARGET],
      maxHistoryTicks: 2
    });
    owner.queue({ type: "spawn", tick: 1, sequence: 1, member: PROJECTILE });
    owner.queue({ type: "despawn", tick: 6, sequence: 2, memberId: PROJECTILE.id });
    owner.advanceTo(8);
    const domain = createStandardMultiplayerPhysicsPredictionDomain({
      kind: "physics-projectile",
      generation: 1,
      stepMs: 16,
      island: owner,
      resolveAuthoritySpawn(member): StandardMultiplayerPhysicsAuthoritySpawn | undefined {
        return member.id.endsWith(".projectile")
          ? { correlationId: member.id.slice(0, -".projectile".length), tick: 1 }
          : undefined;
      }
    });
    domain.registerPredicted({ correlationId: "shot-1", tick: 1, member: PROJECTILE });

    const authority = createPhysicsPredictionIsland({
      backend,
      generation: 1,
      initialMembers: [TARGET],
      maxHistoryTicks: 16
    });
    authority.queue({ type: "spawn", tick: 1, sequence: 1, member: PROJECTILE });
    authority.advanceTo(4);
    const snapshot = authority.state();
    const target = snapshot.members.find((member) => member.id === TARGET.id);
    target!.body.position.x = 12;

    const result = domain.reconcile(snapshot);
    expect(result).toMatchObject({
      lifecycle: {
        matches: [
          {
            binding: {
              correlationId: "shot-1",
              localId: PROJECTILE.id,
              authorityId: PROJECTILE.id
            },
            match: { status: "matched" }
          }
        ]
      },
      reconciliation: { status: "history-overflow" },
      hardCorrection: { status: "corrected", correctedMembers: 2 }
    });
    expect(owner.state()).toMatchObject({
      tick: 4,
      members: [{ id: PROJECTILE.id }, { id: TARGET.id }]
    });
    expect(owner.body(TARGET.id)?.position.x).toBe(12);
    expect(domain.diagnostics()).toMatchObject({
      hardCorrectionAttempts: 1,
      hardCorrectionFailures: 0,
      lifecycle: { bindings: 1, spawns: { matched: 1 } },
      island: { hardCorrections: 1 }
    });

    domain.dispose();
    authority.dispose();
  });
});
