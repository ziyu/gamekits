import { runPhysicsBodyCommandConformance } from "@gamekits/physics-core/testing";
import { describe, expect, it } from "vitest";
import { initRapier3dPhysicsBackend } from "../src";

describe("Rapier 3D body command", () => {
  it("passes the shared Physics body command conformance", async () => {
    const backend = await initRapier3dPhysicsBackend({ id: "rapier3d.body-command" });
    const report = runPhysicsBodyCommandConformance({
      dimension: "3d",
      createBackend: () => backend
    });

    expect(report.checks).toHaveLength(8);
    expect(report.linearVelocity.x).toBeGreaterThan(0);
  });
});
