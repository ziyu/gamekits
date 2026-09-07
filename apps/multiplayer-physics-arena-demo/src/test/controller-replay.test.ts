import {
  characterMotorStateSignature,
  type CharacterMotorPredictionContributor
} from "@gamekits/character-controller";
import {
  createPhysicsPredictionIsland,
  type PhysicsPredictionIsland,
  type PhysicsPredictionIslandCommand,
  type PhysicsPredictionIslandMemberDefinition
} from "@gamekits/physics-core";
import { initRapier3dPhysicsBackend } from "@gamekits/physics-rapier3d";
import { beforeAll, describe, expect, it } from "vitest";

import { ARENA_COMPILED_CONTENT } from "../content/default-content";
import {
  ARENA_CHARACTER_MOTOR_CONTRIBUTOR_ID,
  createArenaCharacterIntent,
  createArenaCharacterMotorContributor
} from "../shared/arena-control";
import { ARENA_ENVIRONMENT, createArenaMemberDefinitions } from "../shared/arena-definition";
import { createArenaPhysicsMaterialDefinitions } from "../shared/arena-physics-materials";
import { ARENA_FIXED_STEP_MS } from "../shared/config";

const LATENCY_MS = 150;
const LATENCY_TICKS = Math.round(LATENCY_MS / ARENA_FIXED_STEP_MS);
const TOTAL_TICKS = 240;
const AUTHORITY_IMPULSE_TICK = 60;

let backend: Awaited<ReturnType<typeof initRapier3dPhysicsBackend>>;

beforeAll(async () => {
  backend = await initRapier3dPhysicsBackend({ id: "arena.controller-replay.test" });
});

describe("Knockout Arena controller replay", () => {
  it("reconciles an authority-only push across 150 ms and replays Physics plus motor state", () => {
    const authority = createHarness();
    const client = createHarness();
    const reconciliations: Array<ReturnType<PhysicsPredictionIsland["reconcile"]>> = [];

    for (let wallTick = 1; wallTick <= TOTAL_TICKS; wallTick += 1) {
      client.island.queue(controlCommand(wallTick));
      client.island.advanceTo(wallTick);

      const authorityTick = wallTick - LATENCY_TICKS;
      if (authorityTick <= 0) continue;
      advanceAuthority(authority, authorityTick);
      if (authorityTick % 3 === 0) {
        reconciliations.push(client.island.reconcile(authority.island.state()));
      }
    }

    for (
      let authorityTick = TOTAL_TICKS - LATENCY_TICKS + 1;
      authorityTick <= TOTAL_TICKS;
      authorityTick += 1
    ) {
      advanceAuthority(authority, authorityTick);
      if (authorityTick % 3 === 0 || authorityTick === TOTAL_TICKS) {
        reconciliations.push(client.island.reconcile(authority.island.state()));
      }
    }

    const duplicate = client.island.reconcile(authority.island.state());
    const authorityBody = authority.island.body("player.0")!;
    const clientBody = client.island.body("player.0")!;
    const authorityMotor = authority.contributor.state("player.0")!;
    const clientMotor = client.contributor.state("player.0")!;

    expect(LATENCY_TICKS).toBe(9);
    expect(reconciliations.some((result) => result.status === "corrected")).toBe(true);
    expect(
      Math.max(...reconciliations.map((result) => result.replayedTicks))
    ).toBeGreaterThanOrEqual(LATENCY_TICKS);
    expect(duplicate.status).toBe("confirmed");
    expect(clientBody.position.x).toBeCloseTo(authorityBody.position.x, 8);
    expect(clientBody.position.y).toBeCloseTo(authorityBody.position.y, 8);
    expect(clientBody.position.z ?? 0).toBeCloseTo(authorityBody.position.z ?? 0, 8);
    expect(clientBody.linearVelocity.x).toBeCloseTo(authorityBody.linearVelocity.x, 8);
    expect(characterMotorStateSignature(clientMotor)).toBe(
      characterMotorStateSignature(authorityMotor)
    );
    expect(clientMotor.lastConsumedJumpSequence).toBeGreaterThan(0);
    expect(client.island.diagnostics()).toMatchObject({
      historyOverflows: 0,
      replayBudgetOverflows: 0,
      hardCorrectionFailures: 0,
      auxiliaryFailures: 0,
      auxiliaryHashMismatches: 0
    });
    expect(client.island.diagnostics().corrections).toBeGreaterThan(0);
    expect(client.island.diagnostics().resimulatedTicks).toBeGreaterThanOrEqual(LATENCY_TICKS);
    expect(client.contributor.diagnostics()).toMatchObject({
      rejectedCommands: 0,
      emittedBodyCommands: 0
    });
    expect(client.contributor.diagnostics().reconciliations).toBeGreaterThan(0);
    expect(client.contributor.diagnostics().replayedControls).toBeGreaterThanOrEqual(LATENCY_TICKS);

    disposeHarness(client);
    disposeHarness(authority);
  });
});

function createHarness(): {
  island: PhysicsPredictionIsland;
  contributor: CharacterMotorPredictionContributor;
} {
  const contributor = createArenaCharacterMotorContributor();
  const actor = createArenaMemberDefinitions().find((member) => member.id === "player.0");
  if (actor === undefined) throw new Error("Arena controller replay actor is unavailable");
  const island = createPhysicsPredictionIsland({
    backend,
    generation: "controller-replay.round-1",
    initialMembers: [structuredClone(actor)] satisfies PhysicsPredictionIslandMemberDefinition[],
    environment: ARENA_ENVIRONMENT,
    fixedDeltaMs: ARENA_FIXED_STEP_MS,
    maxHistoryTicks: 64,
    maxReplayTicksPerOperation: 32,
    maxCommands: 512,
    auxiliaryContributors: [contributor],
    scene: {
      dimension: "3d",
      gravity: { x: 0, y: -18, z: 0 },
      materialDefinitions: createArenaPhysicsMaterialDefinitions({
        content: ARENA_COMPILED_CONTENT
      })
    }
  });
  return { island, contributor };
}

function advanceAuthority(harness: { island: PhysicsPredictionIsland }, tick: number): void {
  harness.island.queue(controlCommand(tick));
  if (tick === AUTHORITY_IMPULSE_TICK) {
    harness.island.queue({
      type: "body-command",
      tick,
      sequence: tick * 4 + 1,
      memberId: "player.0",
      command: {
        type: "linear-impulse",
        impulse: { x: 4.5, y: 1.2, z: 0 },
        wake: "wake"
      }
    });
  }
  harness.island.advanceTo(tick);
}

function controlCommand(tick: number): PhysicsPredictionIslandCommand {
  const phase = Math.floor((tick - 1) / 60) % 2;
  const control = {
    moveX: phase === 0 ? 0.8 : -0.65,
    moveZ: -0.35,
    jump: tick === 42 || tick === 156
  };
  return {
    type: "auxiliary",
    tick,
    sequence: tick * 4,
    contributorId: ARENA_CHARACTER_MOTOR_CONTRIBUTOR_ID,
    payload: {
      type: "control",
      memberId: "player.0",
      intent: createArenaCharacterIntent(control, tick)
    }
  };
}

function disposeHarness(harness: {
  island: PhysicsPredictionIsland;
  contributor: CharacterMotorPredictionContributor;
}): void {
  harness.island.dispose();
  expect(harness.island.diagnostics()).toMatchObject({
    members: 0,
    historyEntries: 0,
    commands: 0,
    disposed: true
  });
  expect(harness.contributor.diagnostics()).toMatchObject({ members: 0, disposed: true });
}
