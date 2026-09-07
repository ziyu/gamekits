import { runPhysicsBodyCommandConformance } from "@gamekits/physics-core/testing";
import { describe, expect, it } from "vitest";
import { initRapier2dPhysicsBackend } from "../src";

describe("Rapier 2D body command", () => {
  it("passes the shared Physics body command conformance", async () => {
    const backend = await initRapier2dPhysicsBackend({ id: "rapier2d.body-command" });
    const report = runPhysicsBodyCommandConformance({
      dimension: "2d",
      createBackend: () => backend
    });

    expect(report.checks).toHaveLength(8);
    expect(report.linearVelocity.x).toBeGreaterThan(0);
  });
});
