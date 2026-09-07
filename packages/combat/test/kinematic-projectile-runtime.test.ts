import type { PhysicsKinematicSweepQueries } from "@gamekits/physics-core";
import { describe, expect, it } from "vitest";
import {
  createCombatKinematicProjectileRecordBuffer,
  createCombatKinematicProjectileRuntime,
  reconcileCombatKinematicProjectileRecords,
  sampleCombatKinematicProjectileRecord,
  type CombatKinematicProjectileDefinition,
  type CombatKinematicProjectileRecord
} from "../src";

const DEFINITION: CombatKinematicProjectileDefinition = {
  id: "projectile.test",
  version: "v1",
  collisionMode: "ray-sweep",
  lifetimeTicks: 10
};

describe("Combat kinematic projectile runtime", () => {
  it("uses the shared sweep, stops at the wall, and records a bounded finish", () => {
    const runtime = createRuntime();
    const fired = runtime.fire(fireInput("predicted-1", "shot-1", 1));
    expect(fired.status).toBe("fired");

    const advance = runtime.advanceTo(4);
    const record = runtime.getRecord("predicted-1");
    expect(advance.finished).toHaveLength(1);
    expect(record).toMatchObject({
      fireTick: 1,
      expiresTick: 11,
      finish: {
        tick: 2,
        reason: "impact",
        position: { x: 5, y: 0 },
        subject: { colliderId: "wall.collider" }
      }
    });
    expect(runtime.listActive()).toEqual([]);
    expect(runtime.diagnostics()).toMatchObject({
      fired: 1,
      physicsSweeps: 1,
      impacts: 1,
      active: 0,
      records: 1
    });
    expect(sampleCombatKinematicProjectileRecord(record!, 100)).toMatchObject({
      active: false,
      position: { x: 5, y: 0 }
    });
    runtime.dispose();
    expect(() => runtime.listRecords()).toThrow("disposed");
  });

  it("confirms equal authority outcomes and identifies one bounded correction", () => {
    const predictedRuntime = createRuntime();
    const authorityRuntime = createRuntime();
    predictedRuntime.fire(fireInput("local-1", "shot-1", 1));
    authorityRuntime.fire(fireInput("authority-1", "shot-1", 1));
    predictedRuntime.advanceTo(4);
    authorityRuntime.advanceTo(4);
    const predicted = predictedRuntime.getRecord("local-1")!;
    const authoritative = {
      ...authorityRuntime.getRecord("authority-1")!,
      projectileId: "authority-1"
    };
    expect(reconcileCombatKinematicProjectileRecords(predicted, authoritative)).toMatchObject({
      status: "confirmed",
      finishPositionError: 0,
      finishTickError: 0,
      reasonMatches: true
    });

    const corrected: CombatKinematicProjectileRecord = {
      ...authoritative,
      finish: { ...authoritative.finish!, position: { x: 4.5, y: 0 } }
    };
    expect(reconcileCombatKinematicProjectileRecords(predicted, corrected)).toMatchObject({
      status: "corrected",
      finishPositionError: 0.5
    });
    predictedRuntime.dispose();
    authorityRuntime.dispose();
  });

  it("bounds record history, rejects conflicts/stale generation, and resets cleanly", () => {
    const buffer = createCombatKinematicProjectileRecordBuffer({ generation: 1, capacity: 2 });
    const first = record("p1", "c1", 1);
    expect(buffer.upsert(first).status).toBe("inserted");
    expect(buffer.upsert(first).status).toBe("duplicate");
    expect(buffer.upsert({ ...first, fireTick: 2, expiresTick: 12 }).status).toBe("conflict");
    buffer.upsert(record("p2", "c2", 1));
    const third = buffer.upsert(record("p3", "c3", 1));
    expect(third.evicted?.projectileId).toBe("p1");
    expect(buffer.list().map((entry) => entry.projectileId)).toEqual(["p2", "p3"]);

    buffer.reset(2);
    expect(buffer.upsert(record("old", "old", 1)).status).toBe("stale-generation");
    expect(buffer.diagnostics()).toMatchObject({
      generation: 2,
      duplicates: 1,
      conflicts: 1,
      staleGenerations: 1,
      evicted: 1,
      records: 0
    });
    buffer.dispose();
  });

  it("limits catch-up work instead of silently skipping simulation ticks", () => {
    const runtime = createCombatKinematicProjectileRuntime({
      queries: noHitQueries(),
      generation: 1,
      fixedDeltaMs: 50,
      maxCatchUpTicksPerAdvance: 2,
      resolveDefinition: () => ({ ...DEFINITION, lifetimeTicks: 20 })
    });
    runtime.fire(fireInput("slow", "slow", 0));
    expect(runtime.advanceTo(10)).toMatchObject({ advancedTicks: 2, catchUpLimited: 1 });
    expect(runtime.listActive()[0]).toMatchObject({ tick: 2, position: { x: 10, y: 0 } });
    expect(runtime.advanceTo(10)).toMatchObject({ advancedTicks: 2, catchUpLimited: 1 });
    runtime.reset(2);
    expect(runtime.listActive()).toEqual([]);
    expect(runtime.diagnostics()).toMatchObject({ generation: 2, active: 0, records: 0 });
    runtime.dispose();
  });
});

function createRuntime() {
  return createCombatKinematicProjectileRuntime({
    queries: wallQueries(5),
    generation: 1,
    fixedDeltaMs: 50,
    resolveDefinition(id, version) {
      return id === DEFINITION.id && version === DEFINITION.version ? DEFINITION : undefined;
    }
  });
}

function fireInput(projectileId: string, correlationId: string, fireTick: number) {
  return {
    projectileId,
    correlationId,
    generation: 1,
    definitionId: DEFINITION.id,
    definitionVersion: DEFINITION.version,
    fireTick,
    firePosition: { x: 0, y: 0 },
    fireVelocity: { x: 100, y: 0 }
  };
}

function record(projectileId: string, correlationId: string, generation: number) {
  return {
    projectileId,
    correlationId,
    generation,
    definitionId: DEFINITION.id,
    definitionVersion: DEFINITION.version,
    fireTick: 1,
    fixedDeltaMs: 50,
    firePosition: { x: 0, y: 0 },
    fireVelocity: { x: 100, y: 0 },
    expiresTick: 11
  } satisfies CombatKinematicProjectileRecord;
}

function wallQueries(wallX: number): PhysicsKinematicSweepQueries {
  return {
    raycast(origin, _direction, options) {
      const maxDistance = options?.maxDistance ?? 0;
      if (origin.x <= wallX && origin.x + maxDistance >= wallX) {
        return [
          {
            colliderId: "wall.collider",
            bodyId: "wall.body",
            point: { x: wallX, y: origin.y },
            normal: { x: -1, y: 0 },
            distance: wallX - origin.x
          }
        ];
      }
      return [];
    },
    shapeCast(_shape, origin, direction, options) {
      return this.raycast(origin, direction, options);
    }
  };
}

function noHitQueries(): PhysicsKinematicSweepQueries {
  return {
    raycast: () => [],
    shapeCast: () => []
  };
}
