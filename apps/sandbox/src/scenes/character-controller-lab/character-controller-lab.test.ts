import { initRapier3dPhysicsBackend } from "@gamekits/physics-rapier3d";
import { describe, expect, it } from "vitest";
import { characterControllerLabIntent } from "./motor";
import { createCharacterControllerLab } from "./runtime";

describe("Character Controller Lab", () => {
  it("runs the public character motor over the visible Rapier3D course", async () => {
    const backend = await initRapier3dPhysicsBackend({
      id: "character-controller-lab.test.course"
    });
    const lab = createCharacterControllerLab(backend);
    let sequence = 0;
    for (let tick = 0; tick < 150; tick += 1) {
      sequence += 1;
      lab.setIntent(
        characterControllerLabIntent({
          sequence,
          moveX: 1,
          moveZ: 0,
          jumpPressed: false,
          jumpHeld: false,
          divePressed: false
        })
      );
      lab.singleStep();
    }
    const snapshot = lab.snapshot();
    expect(snapshot.body.position.x).toBeGreaterThan(-7.2);
    expect(snapshot.diagnostics?.queryCount).toBeGreaterThan(0);
    expect(backend.kind).toBe("rapier3d");
    expect(snapshot.scene.backend).toBe("character-controller-lab.test.course");
    expect(snapshot.course.some((object) => object.role === "slope")).toBe(true);
    expect(snapshot.course.some((object) => object.role === "step")).toBe(true);
    expect(snapshot.course.some((object) => object.role === "beam")).toBe(true);
    expect(snapshot.course.some((object) => object.role === "crate")).toBe(true);
    expect(snapshot.course.some((object) => object.role === "hazard")).toBe(true);
    expect(snapshot.course.filter((object) => object.role === "platform")).toHaveLength(2);
    expect(snapshot.trace.length).toBeLessThanOrEqual(18);
    lab.dispose();
    expect(lab.snapshot().running).toBe(false);
  });

  it("stays grounded while running at speed over a flat Rapier surface", async () => {
    const lab = createCharacterControllerLab(
      await initRapier3dPhysicsBackend({ id: "character-controller-lab.test.flat-ground" })
    );
    const modes = [];
    for (let tick = 1; tick <= 90; tick += 1) {
      lab.setIntent(
        characterControllerLabIntent({
          sequence: tick,
          moveX: 1,
          moveZ: 0,
          jumpPressed: false,
          jumpHeld: false,
          divePressed: false
        })
      );
      const snapshot = lab.singleStep();
      modes.push(snapshot.motor.mode);
      expect(snapshot.motor.groundBodyId).toBe("character-controller-lab.course.proving-ground");
    }
    expect(new Set(modes)).toEqual(new Set(["grounded"]));
    expect(lab.snapshot().body.position.x).toBeGreaterThan(6);
    lab.dispose();
  });

  it("preserves a jump pressed between 144 Hz presentation frames and the next fixed tick", async () => {
    const lab = createCharacterControllerLab(
      await initRapier3dPhysicsBackend({ id: "character-controller-lab.test.input-buffer" })
    );
    for (let tick = 1; tick <= 45; tick += 1) {
      lab.setIntent(neutral(tick));
      lab.singleStep();
    }

    const before = lab.snapshot();
    lab.setIntent(
      characterControllerLabIntent({
        sequence: 46,
        moveX: 1,
        moveZ: 0,
        jumpPressed: true,
        jumpHeld: true,
        divePressed: false
      })
    );
    expect(lab.advance(1000 / 144).tick).toBe(before.tick);

    lab.setIntent(neutral(47));
    expect(lab.advance(1000 / 144).tick).toBe(before.tick);

    lab.setIntent(neutral(48));
    const jumped = lab.advance(1000 / 144);
    expect(jumped.tick).toBe(before.tick + 1);
    expect(jumped.motor.lastConsumedJumpSequence).toBe(jumped.tick);
    expect(jumped.body.linearVelocity.y).toBeGreaterThan(0);
    expect(jumped.trace.map((entry) => entry.code)).toContain("jump-consumed");
    lab.dispose();
  });

  it("jumps while continuously pressing into a wall", async () => {
    const lab = createCharacterControllerLab(
      await initRapier3dPhysicsBackend({ id: "character-controller-lab.test.wall-jump" })
    );
    lab.moveToStation("impact");
    let snapshot = lab.snapshot();
    for (let tick = 1; tick <= 144; tick += 1) {
      lab.setIntent(
        characterControllerLabIntent({
          sequence: tick,
          moveX: -1,
          moveZ: 0,
          jumpPressed: false,
          jumpHeld: false,
          divePressed: false
        })
      );
      snapshot = lab.singleStep();
    }
    expect(snapshot.body.position.x).toBeLessThan(-11.8);
    expect(snapshot.motor.grounded).toBe(true);
    expect(snapshot.motor.groundBodyId).toBe("character-controller-lab.course.tunnel-floor");

    lab.setIntent(
      characterControllerLabIntent({
        sequence: 145,
        moveX: -1,
        moveZ: 0,
        jumpPressed: true,
        jumpHeld: true,
        divePressed: false
      })
    );
    snapshot = lab.singleStep();
    expect(snapshot.motor.lastConsumedJumpSequence).toBe(145);
    expect(snapshot.motor.mode).toBe("airborne");
    expect(snapshot.body.linearVelocity.y).toBeGreaterThan(0);
    expect(snapshot.trace.map((entry) => entry.code)).toContain("jump-consumed");
    lab.dispose();
  });

  it("exposes deterministic jump, dive, stagger, and recovery transitions", async () => {
    const lab = createCharacterControllerLab(
      await initRapier3dPhysicsBackend({ id: "character-controller-lab.test.transitions" })
    );
    let sequence = 0;
    for (let tick = 0; tick < 50; tick += 1) {
      sequence += 1;
      lab.setIntent(neutral(sequence));
      lab.singleStep();
    }
    sequence += 1;
    lab.setIntent(
      characterControllerLabIntent({
        sequence,
        moveX: 1,
        moveZ: 0,
        jumpPressed: true,
        jumpHeld: true,
        divePressed: false
      })
    );
    let snapshot = lab.singleStep();
    expect(snapshot.motor.lastConsumedJumpSequence).toBe(sequence);
    expect(snapshot.body.linearVelocity.y).toBeGreaterThan(0);

    for (let tick = 0; tick < 7; tick += 1) {
      sequence += 1;
      lab.setIntent(
        characterControllerLabIntent({
          sequence,
          moveX: 1,
          moveZ: 0,
          jumpPressed: false,
          jumpHeld: true,
          divePressed: false
        })
      );
      snapshot = lab.singleStep();
    }
    sequence += 1;
    lab.setIntent(
      characterControllerLabIntent({
        sequence,
        moveX: 1,
        moveZ: 0,
        jumpPressed: false,
        jumpHeld: false,
        divePressed: true
      })
    );
    snapshot = lab.singleStep();
    expect(snapshot.motor.lastConsumedDiveSequence).toBe(sequence);
    expect(snapshot.motor.mode).toBe("diving");

    snapshot = lab.queueStagger(360);
    expect(snapshot.queuedStaggerMs).toBe(360);
    sequence += 1;
    lab.setIntent(neutral(sequence));
    snapshot = lab.singleStep();
    expect(snapshot.motor.mode).toBe("staggered");
    expect(snapshot.motor.staggerRemainingMs).toBeGreaterThan(0);

    for (let tick = 0; tick < 45; tick += 1) {
      sequence += 1;
      lab.setIntent(neutral(sequence));
      snapshot = lab.singleStep();
    }
    expect(["recovering", "grounded", "airborne"]).toContain(snapshot.motor.mode);
    expect(snapshot.trace.some((entry) => entry.code === "staggered")).toBe(true);
    lab.dispose();
  });

  it("keeps external impulse while the motor enters stagger", async () => {
    const lab = createCharacterControllerLab(
      await initRapier3dPhysicsBackend({ id: "character-controller-lab.test.impulse" })
    );
    for (let tick = 0; tick < 40; tick += 1) {
      lab.setIntent(neutral(tick + 1));
      lab.singleStep();
    }
    const before = lab.snapshot().body.linearVelocity;
    lab.applyExternalImpulse();
    lab.setIntent(neutral(41));
    const after = lab.singleStep();
    expect(after.motor.mode).toBe("staggered");
    expect(after.body.linearVelocity.x).toBeLessThan(before.x - 1);
    expect(after.body.linearVelocity.y).toBeGreaterThan(before.y);
    lab.dispose();
  });

  it("moves directly to a qualification station with clean motor state", async () => {
    const lab = createCharacterControllerLab(
      await initRapier3dPhysicsBackend({ id: "character-controller-lab.test.stations" })
    );
    lab.queueStagger(500);
    const snapshot = lab.moveToStation("impact");
    expect(snapshot.body.position.x).toBeCloseTo(-4.6);
    expect(snapshot.body.position.z).toBeCloseTo(11.8);
    expect(snapshot.body.linearVelocity).toMatchObject({ x: 0, y: 0, z: 0 });
    expect(snapshot.motor.mode).toBe("airborne");
    expect(snapshot.trace).toEqual([]);
    expect(snapshot.queuedStaggerMs).toBe(0);
    lab.dispose();
  });
});

function neutral(sequence: number) {
  return characterControllerLabIntent({
    sequence,
    moveX: 0,
    moveZ: 0,
    jumpPressed: false,
    jumpHeld: false,
    divePressed: false
  });
}
