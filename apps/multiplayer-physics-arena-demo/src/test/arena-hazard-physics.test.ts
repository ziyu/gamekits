import { createPhysicsPredictionIsland } from "@gamekits/physics-core";
import { initRapier3dPhysicsBackend, type Rapier3dPhysicsNative } from "@gamekits/physics-rapier3d";
import { describe, expect, it } from "vitest";

import { ARENA_COMPILED_CONTENT } from "../content/default-content";
import { createArenaMemberDefinitions } from "../shared/arena-definition";
import { createArenaPhysicsMaterialDefinitions } from "../shared/arena-physics-materials";
import { ARENA_FIXED_STEP_MS } from "../shared/config";
import { planArenaHazardBodyCommands, sampleArenaStageHazards } from "../shared/arena-stage-course";

describe("Knockout Arena real hazard Physics", () => {
  it("moves and rotates every authored transform hazard through real Rapier", async () => {
    const backend = await initRapier3dPhysicsBackend({ id: "arena.hazard-physics.transforms" });

    try {
      for (const [stageIndex, stage] of ARENA_COMPILED_CONTENT.stages.entries()) {
        const island = createIsland(backend, stageIndex);
        const start = new Map(
          island.state().members.map(({ id, body }) => [id, structuredClone(body)])
        );
        const moved = new Set<string>();
        for (let tick = 1; tick <= 180; tick += 1) {
          for (const [hazardIndex, hazard] of sampleArenaStageHazards({
            stageIndex,
            tick,
            stageStartedAtTick: 0
          }).entries()) {
            island.queue({
              type: "patch",
              tick,
              sequence: tick * 64 + hazardIndex,
              memberId: hazard.memberId,
              patch: hazard.patch
            });
          }
          island.advanceTo(tick);
          for (const schedule of stage.courseProjection.hazardSchedules) {
            const before = start.get(schedule.memberId);
            const current = island.body(schedule.memberId);
            if (before === undefined || current === undefined) continue;
            if (
              schedule.kind === "rotating-sweeper"
                ? JSON.stringify(current.rotation) !== JSON.stringify(before.rotation)
                : JSON.stringify(current.position) !== JSON.stringify(before.position)
            ) {
              moved.add(schedule.memberId);
            }
          }
        }

        for (const schedule of stage.courseProjection.hazardSchedules) {
          if (
            schedule.kind !== "rotating-sweeper" &&
            schedule.kind !== "moving-platform" &&
            schedule.kind !== "piston" &&
            schedule.kind !== "crusher" &&
            schedule.kind !== "extending-wall"
          ) {
            continue;
          }
          expect(moved.has(schedule.memberId), schedule.memberId).toBe(true);
        }
        island.dispose();
      }
    } finally {
      // Rapier backend owns no process-global lifecycle; each island disposes its scene.
    }
  });

  it("applies all volume mechanics to real dynamic bodies", async () => {
    const backend = await initRapier3dPhysicsBackend({ id: "arena.hazard-physics.volumes" });

    try {
      for (const [stageIndex, stage] of ARENA_COMPILED_CONTENT.stages.entries()) {
        for (const schedule of stage.courseProjection.hazardSchedules) {
          if (
            schedule.kind !== "conveyor" &&
            schedule.kind !== "wind-zone" &&
            schedule.kind !== "bounce-pad" &&
            schedule.kind !== "shrinking-zone"
          ) {
            continue;
          }
          const activationTick = Math.ceil(
            schedule.activationProgress * stage.definition.durationTicks
          );
          let tick = Math.max(
            6,
            schedule.kind === "shrinking-zone"
              ? Math.ceil(stage.definition.durationTicks * 0.82)
              : activationTick
          );
          while (
            !sampleArenaStageHazards({ stageIndex, tick, stageStartedAtTick: 0 }).find(
              ({ memberId }) => memberId === schedule.memberId
            )?.active ||
            ((schedule.kind === "wind-zone" ||
              schedule.kind === "bounce-pad" ||
              schedule.kind === "shrinking-zone") &&
              tick % 6 !== 0)
          ) {
            tick += 1;
          }
          const body = {
            id: `probe.${schedule.memberId}`,
            kind: "dynamic" as const,
            position:
              schedule.kind === "shrinking-zone"
                ? {
                    x: schedule.origin.x + schedule.size.width * 0.42,
                    y: schedule.origin.y,
                    z: schedule.origin.z ?? 0
                  }
                : { ...schedule.origin },
            linearVelocity: { x: 0, y: 0, z: 0 },
            sleeping: false
          };
          const commands = planArenaHazardBodyCommands({
            stageIndex,
            tick,
            stageStartedAtTick: 0,
            bodies: [body]
          });
          const command = commands.find(({ memberId }) => memberId === body.id)?.command;
          expect(command, schedule.memberId).toMatchObject({ type: "linear-impulse" });
          if (command?.type !== "linear-impulse") continue;

          const scene = backend.createScene({
            id: `arena.hazard-physics.${stageIndex}.${schedule.memberId}`,
            gravity: { x: 0, y: 0, z: 0 },
            materialDefinitions: [{ id: "probe", density: 1 }]
          });
          scene.createBody({ ...body, id: body.id });
          scene.createCollider({
            id: `${body.id}.collider`,
            bodyId: body.id,
            shape: { type: "sphere", radius: 0.5 },
            material: "probe"
          });
          const result = scene.applyBodyCommand?.({ bodyId: body.id, ...command });
          scene.step(ARENA_FIXED_STEP_MS);
          expect(result?.status, schedule.memberId).toBe("applied");
          expect(scene.getBodyState(body.id)?.linearVelocity, schedule.memberId).not.toEqual({
            x: 0,
            y: 0,
            z: 0
          });
          scene.dispose();
        }
      }
    } finally {
      // Each probe scene is disposed in the loop.
    }
  });

  it("keeps authored prop mass distinct in the real Rapier solver", async () => {
    const backend = await initRapier3dPhysicsBackend({ id: "arena.hazard-physics.prop-mass" });
    const stage = ARENA_COMPILED_CONTENT.stages[1]!;
    const scene = backend.createScene({
      id: "arena.hazard-physics.prop-mass.scene",
      gravity: { x: 0, y: 0, z: 0 },
      materialDefinitions: createArenaPhysicsMaterialDefinitions({
        content: ARENA_COMPILED_CONTENT
      })
    });
    try {
      for (const definition of stage.courseProjection.memberDefinitions.filter(({ id }) =>
        id.startsWith("scrap.prop.")
      )) {
        scene.createBody(definition.body);
        for (const collider of definition.colliders ?? []) {
          scene.createCollider({ ...collider, bodyId: definition.id });
        }
      }
      const native = scene.native?.() as Rapier3dPhysicsNative;
      expect(native.bodies.get("scrap.prop.heavy-a")!.mass()).toBeCloseTo(4.5, 4);
      expect(native.bodies.get("scrap.prop.roller-a")!.mass()).toBeCloseTo(2.4, 4);
      expect(native.bodies.get("scrap.prop.heavy-a")!.mass()).toBeGreaterThan(
        native.bodies.get("scrap.prop.roller-a")!.mass()
      );
    } finally {
      scene.dispose();
    }
  });
});

function createIsland(
  backend: Awaited<ReturnType<typeof initRapier3dPhysicsBackend>>,
  stageIndex: number
) {
  return createPhysicsPredictionIsland({
    backend,
    generation: `arena.hazard-physics.stage.${stageIndex}`,
    initialMembers: createArenaMemberDefinitions(stageIndex),
    environment: ARENA_COMPILED_CONTENT.physicsEnvironment,
    fixedDeltaMs: ARENA_FIXED_STEP_MS,
    maxHistoryTicks: 200,
    maxReplayTicksPerOperation: 200,
    maxMembers: 64,
    maxCommands: 20_000,
    scene: {
      dimension: "3d",
      gravity: { x: 0, y: -18, z: 0 },
      materialDefinitions: createArenaPhysicsMaterialDefinitions({
        content: ARENA_COMPILED_CONTENT
      })
    }
  });
}
