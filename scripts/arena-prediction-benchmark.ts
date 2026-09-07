import { performance } from "node:perf_hooks";
import { createStandardMultiplayerPhysicsArenaAuthorityProjection } from "../packages/app-host/src";
import {
  createPhysicsPredictionIsland,
  type PhysicsPredictionIslandCommand,
  type PhysicsPredictionIslandMemberDefinition,
  type PhysicsPredictionIslandStateSnapshot
} from "../packages/physics-core/src";
import { initRapier3dPhysicsBackend } from "../packages/physics-rapier3d/src";
import { ARENA_COMPILED_CONTENT } from "../apps/multiplayer-physics-arena-demo/src/content/default-content";
import {
  ARENA_ENVIRONMENT,
  createArenaMemberDefinitions
} from "../apps/multiplayer-physics-arena-demo/src/shared/arena-definition";
import { createArenaPhysicsMaterialDefinitions } from "../apps/multiplayer-physics-arena-demo/src/shared/arena-physics-materials";
import {
  ARENA_DEFINITION_VERSION,
  ARENA_FIXED_STEP_MS,
  ARENA_ISLAND_ID
} from "../apps/multiplayer-physics-arena-demo/src/shared/config";
import {
  arenaPredictionBenchmarkBudgetCount,
  checkArenaPredictionBenchmarkBudgets,
  type ArenaPredictionBenchmarkCase,
  type ArenaPredictionBenchmarkSuite
} from "./arena-prediction-benchmark-budget";

const checkEnabled = process.argv.includes("--check");
const backend = await initRapier3dPhysicsBackend({ id: "benchmark.arena.rapier3d" });
const CURRENT_PROFILE: ArenaBenchmarkProfile = {
  id: "current-14",
  actors: 8,
  dynamicMembers: 3,
  kinematicMembers: 3
};
const TARGET_PROFILE: ArenaBenchmarkProfile = {
  id: "target-36",
  actors: 8,
  dynamicMembers: 16,
  kinematicMembers: 12
};
const CAPACITY_PROFILE: ArenaBenchmarkProfile = {
  id: "capacity-64",
  actors: 8,
  dynamicMembers: 32,
  kinematicMembers: 24
};
const suite: ArenaPredictionBenchmarkSuite = {
  suite: "rapier3d-arena-rollback",
  cases: [
    runArenaCase({
      profile: CURRENT_PROFILE,
      simulatedTicks: 128,
      rollbackTicks: 12,
      rounds: 24
    }),
    runArenaCase({
      profile: TARGET_PROFILE,
      simulatedTicks: 128,
      rollbackTicks: 30,
      rounds: 24
    }),
    runArenaCase({
      profile: CAPACITY_PROFILE,
      simulatedTicks: 32,
      rollbackTicks: 0,
      rounds: 6
    })
  ]
};
const suites = [suite];
const failures = checkEnabled ? checkArenaPredictionBenchmarkBudgets(suites) : [];

console.log(
  JSON.stringify(
    {
      benchmark: "arena-prediction",
      packages: ["@gamekits/app-host", "@gamekits/physics-core", "@gamekits/physics-rapier3d"],
      methodology: {
        backend: "real Rapier3D compat WASM",
        timing: "wall-clock performance.now",
        budgetPolicy:
          "P0 coarse regression guard; final 5 ms / 12 ms replay targets remain in quality-and-acceptance.md for P7 optimization and P8 acceptance",
        fixtureConstruction: "excluded from each measured round",
        measuredWork:
          "fixed-step authority simulation with 20 Hz projection, authoritative rewind, pending command replay, and authority frame projection after a prebuilt history",
        reports: [
          "authority step p50/p95/max",
          "replay p50/p95/max",
          "snapshot payload p50/p95/max",
          "history p50/p95/max and checkpoint max bytes",
          "hard correction failures",
          "dispose retained state"
        ]
      },
      suites,
      ...(checkEnabled
        ? {
            budgetCheck: {
              budgets: arenaPredictionBenchmarkBudgetCount(),
              passed: failures.length === 0,
              failures
            }
          }
        : {})
    },
    null,
    2
  )
);

if (failures.length > 0) process.exitCode = 1;

function runArenaCase(input: {
  profile: ArenaBenchmarkProfile;
  simulatedTicks: number;
  rollbackTicks: number;
  rounds: number;
}): ArenaPredictionBenchmarkCase {
  const definitions = createStressDefinitions(input.profile);
  const projection = createStandardMultiplayerPhysicsArenaAuthorityProjection({
    maxMembers: 64,
    maxPayloadBytes: 128 * 1024
  });
  const authorityStepSamples: number[] = [];
  const replaySamples: number[] = [];
  const payloadSamples: number[] = [];
  const historyBytesSamples: number[] = [];
  let payloadBytes = 0;
  let maxHistoryBytes = 0;
  let maxHistoryEntries = 0;
  let maxCheckpointBytes = 0;
  let hardCorrectionFailures = 0;
  let replayBudgetOverflows = 0;
  let retainedAfterDispose = 0;
  let totalReplayedTicks = 0;
  let checksum = 0;

  for (let round = 0; round < input.rounds; round += 1) {
    const island = createPhysicsPredictionIsland({
      backend,
      generation: round + 1,
      initialMembers: definitions,
      environment: ARENA_ENVIRONMENT,
      fixedDeltaMs: ARENA_FIXED_STEP_MS,
      maxHistoryTicks: input.simulatedTicks + 8,
      maxCheckpointBytes: 2 * 1024 * 1024,
      maxHistoryBytes: 64 * 1024 * 1024,
      maxReplayTicksPerOperation: input.simulatedTicks,
      maxMembers: 64,
      maxCommands: definitions.length * (input.simulatedTicks + 8),
      scene: {
        dimension: "3d",
        gravity: { x: 0, y: -18, z: 0 },
        materialDefinitions: createArenaPhysicsMaterialDefinitions({
          content: ARENA_COMPILED_CONTENT
        })
      }
    });
    const rollbackAt = input.simulatedTicks - input.rollbackTicks;
    const warmupTicks = Math.min(16, Math.max(1, Math.floor(input.simulatedTicks / 4)));
    let authoritySnapshot: PhysicsPredictionIslandStateSnapshot | undefined;
    for (let tick = 1; tick <= input.simulatedTicks; tick += 1) {
      const authorityStartedAt = performance.now();
      queueArenaCommands(island, definitions, tick, round);
      island.advanceTo(tick);
      if (tick % 3 === 0) {
        const authorityProjection = projection.capture({
          islandId: ARENA_ISLAND_ID,
          generation: round + 1,
          tick,
          membershipRevision: round + 1,
          definitionVersion: ARENA_DEFINITION_VERSION,
          members: island.state().members
        });
        if (authorityProjection.status !== "captured") {
          throw new Error(`Arena authority projection failed: ${authorityProjection.status}`);
        }
        payloadBytes = Math.max(payloadBytes, authorityProjection.payloadBytes);
        payloadSamples.push(authorityProjection.payloadBytes);
      }
      if (tick > warmupTicks) {
        authorityStepSamples.push(performance.now() - authorityStartedAt);
        historyBytesSamples.push(island.diagnostics().historyBytes);
      }
      if (tick === rollbackAt) authoritySnapshot = island.state();
    }
    if (authoritySnapshot === undefined) throw new Error("Missing Arena rollback snapshot.");
    const beforeReconcile = island.diagnostics();
    maxHistoryBytes = Math.max(maxHistoryBytes, beforeReconcile.historyBytes);
    maxHistoryEntries = Math.max(maxHistoryEntries, beforeReconcile.historyEntries);
    maxCheckpointBytes = Math.max(maxCheckpointBytes, beforeReconcile.maxCheckpointBytesObserved);
    authoritySnapshot.members[0]!.body.position.x += 0.02;
    const startedAt = performance.now();
    const reconciliation = island.reconcile(authoritySnapshot);
    replaySamples.push(performance.now() - startedAt);
    totalReplayedTicks += reconciliation.replayedTicks;
    const projected = projection.capture({
      islandId: ARENA_ISLAND_ID,
      generation: round + 1,
      tick: island.tick(),
      membershipRevision: round + 1,
      definitionVersion: ARENA_DEFINITION_VERSION,
      members: island.state().members
    });
    if (projected.status !== "captured") {
      throw new Error(`Arena benchmark projection failed: ${projected.status}`);
    }
    payloadBytes = Math.max(payloadBytes, projected.payloadBytes);
    payloadSamples.push(projected.payloadBytes);
    const diagnostics = island.diagnostics();
    maxHistoryBytes = Math.max(maxHistoryBytes, diagnostics.historyBytes);
    maxHistoryEntries = Math.max(maxHistoryEntries, diagnostics.historyEntries);
    maxCheckpointBytes = Math.max(maxCheckpointBytes, diagnostics.maxCheckpointBytesObserved);
    replayBudgetOverflows += diagnostics.replayBudgetOverflows;
    checksum += island
      .state()
      .members.reduce(
        (total, member) => total + member.body.position.x + member.body.position.y,
        0
      );
    const hardCorrection = island.hardCorrect(island.state(), definitions);
    if (hardCorrection.status !== "corrected") hardCorrectionFailures += 1;
    island.dispose();
    const disposed = island.diagnostics();
    retainedAfterDispose += disposed.members + disposed.historyEntries + disposed.commands;
  }

  const authorityStats = summarize(authorityStepSamples);
  const replayStats = summarize(replaySamples);
  const payloadStats = summarize(payloadSamples);
  const historyStats = summarize(historyBytesSamples);
  return {
    profile: input.profile.id,
    members: definitions.length,
    actors: input.profile.actors,
    dynamicMembers: input.profile.dynamicMembers,
    kinematicMembers: input.profile.kinematicMembers,
    simulatedTicks: input.simulatedTicks,
    rollbackTicks: input.rollbackTicks,
    rounds: input.rounds,
    authorityStepP50Ms: authorityStats.p50,
    authorityStepP95Ms: authorityStats.p95,
    authorityStepMaxMs: authorityStats.max,
    replayP50Ms: replayStats.p50,
    replayP95Ms: replayStats.p95,
    replayMaxMs: replayStats.max,
    p50MsPerRound: replayStats.p50,
    p95MsPerRound: replayStats.p95,
    maxMsPerRound: replayStats.max,
    snapshotPayloadP50Bytes: payloadStats.p50,
    snapshotPayloadP95Bytes: payloadStats.p95,
    snapshotPayloadMaxBytes: payloadStats.max,
    payloadBytes,
    historyP50Bytes: historyStats.p50,
    historyP95Bytes: historyStats.p95,
    historyMaxBytes: historyStats.max,
    maxHistoryBytes,
    maxHistoryEntries,
    maxCheckpointBytes,
    totalReplayedTicks,
    hardCorrectionFailures,
    replayBudgetOverflows,
    retainedAfterDispose,
    checksum: round(checksum)
  };
}

function queueArenaCommands(
  island: ReturnType<typeof createPhysicsPredictionIsland>,
  definitions: readonly PhysicsPredictionIslandMemberDefinition[],
  tick: number,
  round: number
): void {
  for (const [index, definition] of definitions.entries()) {
    const body = island.body(definition.id);
    if (!body) continue;
    const phase = tick * 0.023 + index * 0.37 + round * 0.11;
    const actor = definition.id.startsWith("player.") || definition.id.startsWith("bot.");
    if (definition.body.kind === "dynamic" && !actor && tick % 30 !== 0) {
      continue;
    }
    const command: PhysicsPredictionIslandCommand =
      definition.body.kind === "kinematic"
        ? {
            type: "patch",
            tick,
            sequence: tick * 128 + index,
            memberId: definition.id,
            patch: {
              position: {
                x: definition.body.position?.x ?? 0,
                y: (definition.body.position?.y ?? 0) + Math.sin(phase) * 0.3,
                z: definition.body.position?.z ?? 0
              }
            }
          }
        : !actor
          ? {
              type: "body-command",
              tick,
              sequence: tick * 128 + index,
              memberId: definition.id,
              command: {
                type: "linear-impulse",
                impulse: { x: Math.sin(phase) * 0.4, y: 0.15, z: Math.cos(phase) * 0.4 },
                wake: "wake"
              }
            }
          : {
              type: "patch",
              tick,
              sequence: tick * 128 + index,
              memberId: definition.id,
              patch: {
                linearVelocity: {
                  x: Math.sin(phase) * 2.8,
                  y: body.linearVelocity.y,
                  z: -2.4 + Math.cos(phase) * 0.5
                }
              }
            };
    island.queue(command);
  }
}

function createStressDefinitions(
  profile: ArenaBenchmarkProfile
): PhysicsPredictionIslandMemberDefinition[] {
  const base = createArenaMemberDefinitions();
  const actors = base.filter(
    (definition) => definition.id.startsWith("player.") || definition.id.startsWith("bot.")
  );
  const dynamicMembers = base.filter(
    (definition) => definition.body.kind === "dynamic" && !actors.includes(definition)
  );
  const kinematicMembers = base.filter((definition) => definition.body.kind === "kinematic");
  if (
    profile.actors > actors.length ||
    dynamicMembers.length === 0 ||
    kinematicMembers.length === 0
  ) {
    throw new Error(`Arena benchmark profile cannot be materialized: ${profile.id}`);
  }
  return [
    ...structuredClone(actors.slice(0, profile.actors)),
    ...createProfileMembers("dynamic", dynamicMembers, profile.dynamicMembers),
    ...createProfileMembers("kinematic", kinematicMembers, profile.kinematicMembers)
  ];
}

function createProfileMembers(
  kind: "dynamic" | "kinematic",
  templates: readonly PhysicsPredictionIslandMemberDefinition[],
  count: number
): PhysicsPredictionIslandMemberDefinition[] {
  const result = structuredClone(templates.slice(0, count));
  for (let index = result.length; index < count; index += 1) {
    const template = templates[index % templates.length]!;
    const id = `benchmark.${kind}.${index}`;
    result.push({
      ...structuredClone(template),
      id,
      body: {
        ...structuredClone(template.body),
        id,
        position: benchmarkMemberPosition(kind, index)
      },
      colliders: template.colliders?.map((collider, colliderIndex) => ({
        ...structuredClone(collider),
        id: `${id}.collider.${colliderIndex}`
      }))
    });
  }
  return result;
}

function benchmarkMemberPosition(
  kind: "dynamic" | "kinematic",
  index: number
): { x: number; y: number; z: number } {
  const column = index % 8;
  const row = Math.floor(index / 8);
  return {
    x: (column - 3.5) * 2.2,
    y: kind === "dynamic" ? 1.4 + (row % 2) * 1.1 : 0.8 + (row % 2) * 0.35,
    z: 3.5 - row * 3
  };
}

function summarize(samples: readonly number[]): { p50: number; p95: number; max: number } {
  const sorted = [...samples].sort((left, right) => left - right);
  return {
    p50: round(percentile(sorted, 0.5)),
    p95: round(percentile(sorted, 0.95)),
    max: round(sorted.at(-1) ?? 0)
  };
}

function percentile(sorted: readonly number[], ratio: number): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * ratio))] ?? 0;
}

function round(value: number): number {
  return Math.round(value * 1_000) / 1_000;
}

type ArenaBenchmarkProfile = {
  id: string;
  actors: number;
  dynamicMembers: number;
  kinematicMembers: number;
};
