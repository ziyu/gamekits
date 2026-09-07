import { beforeAll, describe, expect, it } from "vitest";
import { initRapier2dPhysicsBackend } from "@gamekits/physics-rapier2d";
import {
  PHYSICS_2D_GROUPS,
  createPhysics2dLab,
  createPhysics2dModuleHarness,
  type Physics2dLab
} from "./physics-2d-lab";

let backend: Awaited<ReturnType<typeof initRapier2dPhysicsBackend>>;

beforeAll(async () => {
  backend = await initRapier2dPhysicsBackend({
    id: "physics-2d-lab.test",
    groups: PHYSICS_2D_GROUPS
  });
});

describe("Physics 2D Lab runtime", () => {
  it("boots a Rapier 2D scene with body, collider, trigger, query, and diagnostics", () => {
    const lab = createPhysics2dLab(backend);

    const snapshot = stepLab(lab, 8);

    expect(snapshot.scene).toMatchObject({
      backend: "physics-2d-lab.test",
      dimension: "2d",
      bodyCount: 7,
      colliderCount: 7
    });
    expect(snapshot.objects.map((object) => object.role)).toContain("mover");
    expect(snapshot.recentContacts.map((contact) => `${contact.kind}.${contact.phase}`)).toContain(
      "trigger.enter"
    );
    expect(snapshot.queryHits.map((hit) => hit.colliderId)).toContain("collider.trigger");
    expect(snapshot.nativeSummary).toMatchObject({
      backend: "rapier2d",
      bodyCount: 7,
      colliderCount: 7
    });

    lab.dispose();
  });

  it("can switch shape and query collision-group presets", () => {
    const lab = createPhysics2dLab(backend);

    lab.setShape("capsule");
    lab.setGroupPreset("sensor-only");
    lab.setQueryPoint({ x: -3.45, y: 0.85 });
    const snapshot = lab.singleStep();

    expect(snapshot.shape).toBe("capsule");
    expect(snapshot.objects.find((object) => object.id === "mover")?.shape).toMatchObject({
      type: "capsule"
    });
    expect(snapshot.queryHits.map((hit) => hit.colliderId)).toEqual(["collider.trigger"]);

    lab.dispose();
  });

  it("runs through the standard Physics GameModule helper", () => {
    const harness = createPhysics2dModuleHarness(backend);
    expect(harness.physics.isBound()).toBe(true);

    harness.runtime.start();
    harness.runtime.tick(1000 / 60);

    expect(harness.contacts).toHaveLength(1);
    expect(harness.contacts[0]).toMatchObject({
      kind: "trigger",
      phase: "enter",
      entityA: harness.mover,
      entityB: harness.trigger
    });
    expect(harness.traceStore.list().map((entry) => entry.kind)).toContain("step");
    expect(harness.physics.snapshot()).toMatchObject({
      backend: "physics-2d-lab.test",
      dimension: "2d",
      bodyCount: 2,
      colliderCount: 2
    });
    expect(
      harness.physics
        .overlapShape(
          { type: "circle", radius: 0.25 },
          { x: 0, y: 0 },
          { triggerInteraction: "only" }
        )
        .map((hit) => hit.colliderId)
    ).toContain(harness.contacts[0]?.colliderB);

    harness.runtime.dispose();
    expect(harness.physics.isBound()).toBe(false);
  });
});

function stepLab(lab: Physics2dLab, frames: number) {
  let snapshot = lab.snapshot();
  for (let index = 0; index < frames; index += 1) {
    snapshot = lab.step(1000 / 60);
  }
  return snapshot;
}
