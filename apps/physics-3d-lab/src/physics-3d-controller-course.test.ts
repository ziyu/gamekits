import { initRapier3dPhysicsBackend } from "@gamekits/physics-rapier3d";
import { beforeAll, describe, expect, it } from "vitest";

import { runPhysics3dControllerCourse } from "./physics-3d-controller-course";
import { PHYSICS_3D_GROUPS } from "./physics-3d-lab";

let backend: Awaited<ReturnType<typeof initRapier3dPhysicsBackend>>;

beforeAll(async () => {
  backend = await initRapier3dPhysicsBackend({
    id: "physics-3d-controller-course.test",
    groups: PHYSICS_3D_GROUPS
  });
});

describe("Physics 3D character controller course", () => {
  it("passes every real Rapier3D movement obstacle", () => {
    const report = runPhysics3dControllerCourse(backend);

    expect(report, JSON.stringify(report, null, 2)).toMatchObject({
      backend: "rapier3d",
      fixedDeltaMs: 1000 / 60,
      passed: true
    });
    expect(report.cases.map((entry) => entry.id)).toEqual([
      "flat-braking",
      "walkable-slope",
      "bounded-step",
      "moving-platform",
      "edge-coyote",
      "actor-push",
      "landing"
    ]);
    expect(report.cases.every((entry) => entry.passed)).toBe(true);
  });
});
