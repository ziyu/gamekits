import { raycast, shapeCast, type PhysicsKinematicSweepQueries } from "@gamekits/physics-core";
import { initRapier2dPhysicsBackend } from "@gamekits/physics-rapier2d";
import { beforeAll, describe, expect, it } from "vitest";
import {
  createCombatKinematicProjectileRuntime,
  type CombatKinematicProjectileDefinition
} from "../src";

const FIXED_DELTA_MS = 1000 / 60;
const DEFINITION: CombatKinematicProjectileDefinition = {
  id: "projectile.rapier",
  version: "v1",
  collisionMode: "ray-sweep",
  lifetimeTicks: 180
};
const SHAPE_DEFINITION: CombatKinematicProjectileDefinition = {
  id: "projectile.rapier.shape",
  version: "v1",
  collisionMode: "shape-sweep",
  sweepShape: { type: "circle", radius: 0.75 },
  lifetimeTicks: 180
};

let backend: Awaited<ReturnType<typeof initRapier2dPhysicsBackend>>;

beforeAll(async () => {
  backend = await initRapier2dPhysicsBackend({ id: "combat.kinematic-projectile.rapier" });
});

describe("Combat kinematic projectile with Rapier", () => {
  it("primes the query scene and never advances beyond a real static blocker", () => {
    const scene = backend.createScene({ gravity: { x: 0, y: 0 }, fixedDeltaMs: FIXED_DELTA_MS });
    scene.createBody({ id: "wall.body", kind: "static", position: { x: 70, y: 0 } });
    scene.createCollider({
      id: "wall.collider",
      bodyId: "wall.body",
      shape: { type: "box", width: 3, height: 30 }
    });
    scene.step(FIXED_DELTA_MS);
    const queries: PhysicsKinematicSweepQueries = {
      raycast(origin, direction, options) {
        return raycast(scene, origin, direction, options);
      },
      shapeCast(shape, position, direction, options) {
        return shapeCast(scene, shape, position, direction, options);
      }
    };
    const runtime = createCombatKinematicProjectileRuntime({
      queries,
      generation: 1,
      fixedDeltaMs: FIXED_DELTA_MS,
      maxCatchUpTicksPerAdvance: 240,
      resolveDefinition: () => DEFINITION
    });
    runtime.fire({
      projectileId: "rapier.projectile",
      correlationId: "rapier.shot",
      generation: 1,
      definitionId: DEFINITION.id,
      definitionVersion: DEFINITION.version,
      fireTick: 0,
      firePosition: { x: 8, y: 0 },
      fireVelocity: { x: 48, y: 0 }
    });

    runtime.advanceTo(180);
    const record = runtime.getRecord("rapier.projectile");
    expect(record).toMatchObject({
      finish: {
        reason: "impact",
        subject: { colliderId: "wall.collider", bodyId: "wall.body" }
      }
    });
    expect(record!.finish!.position.x).toBeLessThanOrEqual(68.501);
    expect(runtime.diagnostics()).toMatchObject({ active: 0, impacts: 1 });
    runtime.dispose();
    scene.dispose();
  });

  it("records the moving shape origin instead of the blocker contact witness", () => {
    const scene = backend.createScene({ gravity: { x: 0, y: 0 }, fixedDeltaMs: FIXED_DELTA_MS });
    scene.createBody({ id: "wall.body", kind: "static", position: { x: 70, y: 0 } });
    scene.createCollider({
      id: "wall.collider",
      bodyId: "wall.body",
      shape: { type: "box", width: 3, height: 30 }
    });
    scene.step(FIXED_DELTA_MS);
    const runtime = createCombatKinematicProjectileRuntime({
      queries: {
        raycast(origin, direction, options) {
          return raycast(scene, origin, direction, options);
        },
        shapeCast(shape, position, direction, options) {
          return shapeCast(scene, shape, position, direction, options);
        }
      },
      generation: 1,
      fixedDeltaMs: FIXED_DELTA_MS,
      maxCatchUpTicksPerAdvance: 240,
      resolveDefinition: () => SHAPE_DEFINITION
    });
    runtime.fire({
      projectileId: "rapier.shape-projectile",
      correlationId: "rapier.shape-shot",
      generation: 1,
      definitionId: SHAPE_DEFINITION.id,
      definitionVersion: SHAPE_DEFINITION.version,
      fireTick: 0,
      firePosition: { x: 8, y: 0 },
      fireVelocity: { x: 48, y: 0 }
    });

    runtime.advanceTo(180);
    const record = runtime.getRecord("rapier.shape-projectile");
    expect(record).toMatchObject({ finish: { reason: "impact" } });
    expect(record!.finish!.position.x).toBeCloseTo(67.75, 2);
    runtime.dispose();
    scene.dispose();
  });
});
