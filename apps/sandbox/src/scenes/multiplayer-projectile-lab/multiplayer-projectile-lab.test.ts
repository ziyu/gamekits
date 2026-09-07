import { createMemoryPhysicsBackend } from "@gamekits/physics-core";
import { initRapier2dPhysicsBackend } from "@gamekits/physics-rapier2d";
import { describe, expect, it } from "vitest";
import { createMultiplayerProjectileLabRuntime } from "./runtime";

describe("Sandbox multiplayer projectile lab", () => {
  it("runs three real peers and confirms a zero-penetration owner prediction", async () => {
    const runtime = await createMultiplayerProjectileLabRuntime({
      physicsBackend: createMemoryPhysicsBackend(),
      latencyMs: 240
    });
    await runtime.fire();
    await advance(runtime, 2_500);
    const snapshot = runtime.snapshot();

    expect(snapshot).toMatchObject({
      peers: 3,
      matchStatus: "matched",
      reconciliation: { status: "confirmed", finishPositionError: 0 },
      owner: { active: false, finished: true, finishReason: "impact" },
      authority: { active: false, finished: true, finishReason: "impact" },
      remote: { active: false, finished: true, finishReason: "impact" },
      ownerPenetration: 0,
      damageDealt: 23
    });
    expect(snapshot.targets[0]).toMatchObject({
      id: "target.gunner",
      health: 187,
      maxHealth: 210,
      alive: true,
      selected: true
    });
    expect(snapshot.owner!.x).toBeLessThanOrEqual(snapshot.ownerWallX);
    expect(snapshot.authority!.x).toBeLessThanOrEqual(snapshot.authorityWallX);
    expect(snapshot.remote!.x).toBeLessThanOrEqual(snapshot.authorityWallX);
    await runtime.dispose();
  });

  it("shows owner prediction before the delayed authority command arrives", async () => {
    const runtime = await createMultiplayerProjectileLabRuntime({
      physicsBackend: createMemoryPhysicsBackend(),
      latencyMs: 400
    });
    await runtime.fire();
    await advance(runtime, 100);
    expect(runtime.snapshot()).toMatchObject({
      matchStatus: "predicted",
      owner: { active: true },
      pendingCommands: 1
    });
    expect(runtime.snapshot().authority).toBeUndefined();

    await advance(runtime, 2_500);
    expect(runtime.snapshot().reconciliation?.status).toBe("confirmed");
    await runtime.dispose();
  });

  it("fault injection produces one correction without changing owner collision", async () => {
    const runtime = await createMultiplayerProjectileLabRuntime({
      physicsBackend: createMemoryPhysicsBackend(),
      latencyMs: 120
    });
    runtime.setFaultInjection(true);
    await runtime.fire();
    await advance(runtime, 2_500);
    const snapshot = runtime.snapshot();

    expect(snapshot).toMatchObject({
      faultInjection: true,
      reconciliation: { status: "corrected" },
      ownerPenetration: 0,
      diagnostics: { corrected: 1 }
    });
    expect(snapshot.authorityWallX).toBeLessThan(snapshot.ownerWallX);
    expect(snapshot.owner!.x).toBeGreaterThan(snapshot.authority!.x);
    await runtime.dispose();
  });

  it("generation reset drops delayed old messages and clears every lane", async () => {
    const runtime = await createMultiplayerProjectileLabRuntime({
      physicsBackend: createMemoryPhysicsBackend(),
      latencyMs: 600
    });
    await runtime.fire();
    await advance(runtime, 50);
    runtime.reset();
    const generation = runtime.snapshot().generation;
    await advance(runtime, 1_000);

    expect(runtime.snapshot()).toMatchObject({
      generation,
      pendingCommands: 0,
      pendingRecords: 0
    });
    expect(runtime.snapshot().owner).toBeUndefined();
    expect(runtime.snapshot().authority).toBeUndefined();
    expect(runtime.snapshot().remote).toBeUndefined();
    await runtime.dispose();
  });

  it("fires distinct rifle, plasma, rocket, and pellet definitions through the same pipeline", async () => {
    const runtime = await createMultiplayerProjectileLabRuntime({
      physicsBackend: createMemoryPhysicsBackend(),
      latencyMs: 0
    });

    runtime.selectWeapon("pulse-carbine");
    await runtime.fire();
    await advance(runtime, 200);
    runtime.selectWeapon("plasma-caster");
    await runtime.fire();
    await advance(runtime, 500);
    runtime.selectWeapon("rocket-pod");
    await runtime.fire();
    await advance(runtime, 1_100);
    runtime.selectWeapon("scattergun");
    await runtime.fire();

    const shots = runtime.snapshot().shots;
    expect(shots.filter((shot) => shot.weaponId === "pulse-carbine")).toHaveLength(1);
    expect(shots.filter((shot) => shot.weaponId === "plasma-caster")).toHaveLength(1);
    expect(shots.filter((shot) => shot.weaponId === "rocket-pod")).toHaveLength(1);
    expect(shots.filter((shot) => shot.weaponId === "scattergun")).toHaveLength(6);
    expect(runtime.snapshot().diagnostics.predicted).toBe(9);
    await runtime.dispose();
  });

  it("runs a solver-owned CCD round through gravity, rigid contacts, and island replay", async () => {
    const runtime = await createMultiplayerProjectileLabRuntime({
      physicsBackend: await initRapier2dPhysicsBackend({
        id: "sandbox.multiplayer-projectile-lab.test.rapier2d"
      }),
      latencyMs: 240
    });
    runtime.selectWeapon("gravity-ricochet");
    const targetBefore = runtime
      .snapshot()
      .targets.find((target) => target.id === "target.gunner")!;

    await runtime.fire();
    await advance(runtime, 2_600);
    const snapshot = runtime.snapshot();
    const shot = snapshot.shots.at(-1);
    const targetAfter = snapshot.targets.find((target) => target.id === "target.gunner")!;

    expect(shot).toMatchObject({
      weaponId: "gravity-ricochet",
      simulation: "physics-island",
      matchStatus: "matched"
    });
    expect(shot?.physicsReconciliation?.status).toMatch(/confirmed|corrected/);
    expect(snapshot.diagnostics.physicsSteps).toBeGreaterThan(200);
    expect(snapshot.diagnostics.resimulatedTicks).toBeGreaterThan(0);
    expect(snapshot.diagnostics.checkpointBytes).toBeGreaterThan(0);
    expect(snapshot.diagnostics.physicsContacts).toBeGreaterThan(0);
    expect(snapshot.damageDealt).toBeGreaterThan(0);
    expect(targetAfter.position.x).toBeGreaterThan(targetBefore.position.x);

    await advance(runtime, 2_000);
    const remoteSnapshotsAfterExpiry = runtime.snapshot().diagnostics.remoteRecords;
    await advance(runtime, 1_000);
    expect(runtime.snapshot().diagnostics.remoteRecords).toBe(remoteSnapshotsAfterExpiry);
    await runtime.dispose();
  });

  it("corrects the complete rigid-body island after an authority target-state divergence", async () => {
    const runtime = await createMultiplayerProjectileLabRuntime({
      physicsBackend: await initRapier2dPhysicsBackend({
        id: "sandbox.multiplayer-projectile-lab.test.correction"
      }),
      latencyMs: 180
    });
    runtime.setFaultInjection(true);
    runtime.selectWeapon("gravity-ricochet");
    await runtime.fire();
    await advance(runtime, 1_800);

    const snapshot = runtime.snapshot();
    expect(snapshot.shots.at(-1)?.physicsReconciliation?.status).toMatch(/confirmed|corrected/);
    expect(snapshot.diagnostics.corrected).toBeGreaterThan(0);
    expect(snapshot.diagnostics.resimulatedTicks).toBeGreaterThan(0);
    await runtime.dispose();
  });

  it("aims at a selected battlefield unit and applies authority-confirmed damage", async () => {
    const runtime = await createMultiplayerProjectileLabRuntime({
      physicsBackend: createMemoryPhysicsBackend(),
      latencyMs: 180
    });
    runtime.selectTarget("target.drone");
    runtime.selectWeapon("plasma-caster");
    await runtime.fire();
    await advance(runtime, 3_500);

    const snapshot = runtime.snapshot();
    const drone = snapshot.targets.find((target) => target.id === "target.drone");
    expect(snapshot.selectedTargetId).toBe("target.drone");
    expect(snapshot.shots.at(-1)).toMatchObject({
      weaponId: "plasma-caster",
      targetId: "target.drone",
      matchStatus: "matched",
      reconciliation: { status: "confirmed" },
      owner: { subjectId: "target.drone" },
      authority: { subjectId: "target.drone" }
    });
    expect(drone?.health).toBeLessThan(drone?.maxHealth ?? 0);
    expect(snapshot.damageDealt).toBeGreaterThan(0);
    await runtime.dispose();
  });
});

async function advance(
  runtime: Awaited<ReturnType<typeof createMultiplayerProjectileLabRuntime>>,
  durationMs: number
): Promise<void> {
  for (let elapsed = 0; elapsed < durationMs; elapsed += 16) {
    runtime.update(Math.min(16, durationMs - elapsed));
    await Promise.resolve();
  }
}
