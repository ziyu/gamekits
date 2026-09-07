import {
  raycast,
  shapeCast,
  sweepPhysicsKinematicStep,
  type PhysicsKinematicSweepQueries
} from "@gamekits/physics-core";
import { describe, expect, it } from "vitest";
import { initRapier3dPhysicsBackend } from "../src";

describe("Rapier 3D kinematic sweep", () => {
  it("stops a sphere origin outside the blocker and preserves the contact witness", async () => {
    const backend = await initRapier3dPhysicsBackend({ id: "rapier3d.kinematic-sweep" });
    const scene = backend.createScene({ gravity: { x: 0, y: 0, z: 0 }, fixedDeltaMs: 100 });
    scene.createBody({ id: "wall.body", kind: "static", position: { x: 5, y: 0, z: 0 } });
    scene.createCollider({
      id: "wall.collider",
      bodyId: "wall.body",
      shape: { type: "box", width: 1, height: 8, depth: 8 }
    });
    scene.step(100);

    const result = sweepPhysicsKinematicStep({
      queries: sceneQueries(scene),
      mode: "shape",
      shape: { type: "sphere", radius: 0.5 },
      position: { x: 0, y: 0, z: 0 },
      velocity: { x: 100, y: 0, z: 0 },
      deltaMs: 100
    });

    expect(result.hit).toMatchObject({ colliderId: "wall.collider" });
    expect(result.hit!.normal!.x).toBeCloseTo(-1, 6);
    expect(Math.abs(result.hit!.normal!.y)).toBeCloseTo(0, 6);
    expect(Math.abs(result.hit!.normal!.z!)).toBeCloseTo(0, 6);
    expect(result.position.x).toBeCloseTo(4, 3);
    expect(result.hit!.point!.x).toBeCloseTo(4.5, 3);
    expect(result.position.x).toBeLessThan(result.hit!.point!.x);
    scene.dispose();
  });
});

function sceneQueries(
  scene: ReturnType<Awaited<ReturnType<typeof initRapier3dPhysicsBackend>>["createScene"]>
): PhysicsKinematicSweepQueries {
  return {
    raycast(origin, direction, options) {
      return raycast(scene, origin, direction, options);
    },
    shapeCast(shape, position, direction, options) {
      return shapeCast(scene, shape, position, direction, options);
    }
  };
}
