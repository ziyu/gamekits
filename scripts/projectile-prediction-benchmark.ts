import { Buffer } from "node:buffer";
import {
  createCombatKinematicProjectileRecordBuffer,
  createCombatKinematicProjectileRuntime,
  sampleCombatKinematicProjectileRecord,
  type CombatKinematicProjectileDefinition,
  type CombatKinematicProjectileRecord
} from "../packages/combat/src";
import { createMultiplayerPredictedLifecycleDomain } from "../packages/multiplayer-core/src";
import {
  createMemoryPhysicsBackend,
  createPhysicsPredictionIsland,
  raycast,
  shapeCast,
  type PhysicsKinematicSweepQueries,
  type PhysicsPredictionIslandMemberDefinition
} from "../packages/physics-core/src";
import {
  checkProjectilePredictionBenchmarkBudgets,
  projectilePredictionBenchmarkBudgetCount,
  type ProjectilePredictionBenchmarkCase,
  type ProjectilePredictionBenchmarkSuite
} from "./projectile-prediction-benchmark-budget";

const WALL_X = 100;
const DEFINITION: CombatKinematicProjectileDefinition = {
  id: "benchmark.projectile",
  version: "v1",
  collisionMode: "ray-sweep",
  lifetimeTicks: 30
};

const suites: ProjectilePredictionBenchmarkSuite[] = [
  { suite: "kinematic-record-churn", cases: [runRecordChurn()] },
  { suite: "owner-kinematic-sweep", cases: [runOwnerSweep()] },
  { suite: "remote-record-reconstruction", cases: [runRemoteReconstruction()] },
  { suite: "predicted-spawn-matching", cases: [runPredictedSpawnMatching()] },
  { suite: "physics-island-rollback", cases: [runPhysicsIslandRollback()] }
];
const checkEnabled = process.argv.includes("--check");
const failures = checkEnabled ? checkProjectilePredictionBenchmarkBudgets(suites) : [];

console.log(
  JSON.stringify(
    {
      benchmark: "projectile-prediction",
      packages: ["@gamekits/physics-core", "@gamekits/combat", "@gamekits/multiplayer-core"],
      methodology: {
        timing: "process CPU time",
        recordFixtureCreation: "included",
        ownerFireFixtureCreation: "excluded",
        ownerSweep: "real memory-physics scene query",
        physicsIsland:
          "full-scene checkpoint capture, late-command restore, whole-island resimulation, and authority hard correction",
        reports: ["p50", "p95", "max", "hard bounds", "dispose retained state"]
      },
      suites,
      ...(checkEnabled
        ? {
            budgetCheck: {
              budgets: projectilePredictionBenchmarkBudgetCount(),
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

if (failures.length > 0) {
  process.exitCode = 1;
}

function runRecordChurn(): ProjectilePredictionBenchmarkCase {
  const recordsPerRound = 5_000;
  const rounds = 20;
  const buffer = createCombatKinematicProjectileRecordBuffer({ generation: 1, capacity: 512 });
  const samples: number[] = [];
  let sampled: CombatKinematicProjectileRecord | undefined;
  for (let roundIndex = 0; roundIndex < rounds; roundIndex += 1) {
    const start = process.cpuUsage();
    for (let index = 0; index < recordsPerRound; index += 1) {
      const record = createRecord(`record-${roundIndex}-${index}`, index);
      buffer.upsert(record);
      buffer.upsert({
        ...record,
        finish: {
          tick: record.fireTick + 3,
          reason: "impact",
          position: { x: WALL_X, y: 0 },
          normal: { x: -1, y: 0 },
          subject: { colliderId: "wall.collider", bodyId: "wall.body" }
        }
      });
      sampled ??= record;
    }
    samples.push(elapsedCpuMs(start));
  }
  const stats = summarize(samples);
  const retainedRecords = buffer.diagnostics().records;
  const recordBytes = Buffer.byteLength(JSON.stringify(sampled), "utf8");
  buffer.dispose();
  return {
    recordsPerRound,
    rounds,
    p50MsPerRound: stats.p50,
    p95MsPerRound: stats.p95,
    maxMsPerRound: stats.max,
    retainedRecords,
    recordBytes
  };
}

function runOwnerSweep(): ProjectilePredictionBenchmarkCase {
  const projectiles = 1_000;
  const rounds = 20;
  const scene = createMemoryPhysicsBackend().createScene({ gravity: { x: 0, y: 0 } });
  scene.createBody({ id: "wall.body", kind: "static", position: { x: WALL_X, y: 0 } });
  scene.createCollider({
    id: "wall.collider",
    bodyId: "wall.body",
    shape: { type: "box", width: 2, height: 4_000 }
  });
  const queries = sceneQueries(scene);
  const samples: number[] = [];
  let unfinishedProjectiles = 0;
  let maxBlockerPenetration = 0;
  let retainedAfterDispose = 0;
  for (let roundIndex = 0; roundIndex < rounds; roundIndex += 1) {
    const runtime = createCombatKinematicProjectileRuntime({
      queries,
      generation: roundIndex,
      fixedDeltaMs: 16,
      maxActiveProjectiles: projectiles,
      maxRecords: projectiles,
      maxCatchUpTicksPerAdvance: 8,
      resolveDefinition: () => DEFINITION
    });
    for (let index = 0; index < projectiles; index += 1) {
      runtime.fire({
        projectileId: `owner-${roundIndex}-${index}`,
        correlationId: `shot-${roundIndex}-${index}`,
        generation: roundIndex,
        definitionId: DEFINITION.id,
        definitionVersion: DEFINITION.version,
        fireTick: 0,
        firePosition: { x: 0, y: index - projectiles / 2 },
        fireVelocity: { x: 2_500, y: 0 }
      });
    }
    const start = process.cpuUsage();
    runtime.advanceTo(4);
    samples.push(elapsedCpuMs(start));
    unfinishedProjectiles += runtime.listActive().length;
    for (const record of runtime.listRecords()) {
      maxBlockerPenetration = Math.max(
        maxBlockerPenetration,
        Math.max(0, (record.finish?.position.x ?? record.firePosition.x) - WALL_X)
      );
    }
    runtime.dispose();
    retainedAfterDispose += runtime.diagnostics().active + runtime.diagnostics().records;
  }
  scene.dispose();
  const stats = summarize(samples);
  return {
    projectiles,
    rounds,
    p50MsPerRound: stats.p50,
    p95MsPerRound: stats.p95,
    maxMsPerRound: stats.max,
    unfinishedProjectiles,
    maxBlockerPenetration: round(maxBlockerPenetration),
    retainedAfterDispose
  };
}

function runRemoteReconstruction(): ProjectilePredictionBenchmarkCase {
  const samples = 250_000;
  const record: CombatKinematicProjectileRecord = {
    ...createRecord("remote", 0),
    fireVelocity: { x: 2_500, y: 0 },
    finish: {
      tick: 3,
      reason: "impact",
      position: { x: WALL_X, y: 0 },
      normal: { x: -1, y: 0 }
    }
  };
  let checksum = 0;
  let maxBlockerPenetration = 0;
  const start = process.cpuUsage();
  for (let index = 0; index < samples; index += 1) {
    const sample = sampleCombatKinematicProjectileRecord(record, index % 8);
    checksum += sample.position.x;
    maxBlockerPenetration = Math.max(
      maxBlockerPenetration,
      Math.max(0, sample.position.x - WALL_X)
    );
  }
  const durationMs = elapsedCpuMs(start);
  return {
    samples,
    durationMs: round(durationMs),
    microsecondsPerSample: round((durationMs * 1_000) / samples),
    maxBlockerPenetration: round(maxBlockerPenetration),
    checksum: round(checksum)
  };
}

function runPredictedSpawnMatching(): ProjectilePredictionBenchmarkCase {
  const spawns = 100_000;
  const domain = createMultiplayerPredictedLifecycleDomain<number, number>({
    kind: "projectile",
    generation: 1,
    maxPending: 2_048,
    maxResolved: 2_048,
    maxAgeTicks: spawns,
    maxBindings: 2_048
  });
  const start = process.cpuUsage();
  for (let index = 0; index < spawns; index += 1) {
    const correlationId = `shot-${index}`;
    domain.register({
      correlationId,
      localId: `local-${index}`,
      tick: index,
      value: index
    });
    domain.sync({
      generation: 1,
      authorityTime: index,
      localTime: index,
      authoritySpawns: [
        {
          correlationId,
          authorityId: `authority-${index}`,
          tick: index + 1,
          value: index
        }
      ]
    });
  }
  const durationMs = elapsedCpuMs(start);
  const diagnostics = domain.diagnostics();
  domain.dispose();
  return {
    spawns,
    durationMs: round(durationMs),
    microsecondsPerSpawn: round((durationMs * 1_000) / spawns),
    pendingAfterMatch: diagnostics.spawns.pending,
    pendingOrderEntries: diagnostics.spawns.pendingOrderEntries,
    resolvedEntries: diagnostics.spawns.resolved,
    matched: diagnostics.spawns.matched,
    bindings: diagnostics.bindings,
    localIdentities: diagnostics.localIdentities
  };
}

function runPhysicsIslandRollback(): ProjectilePredictionBenchmarkCase {
  const rounds = 20;
  const members = 24;
  const simulatedTicks = 120;
  const rollbackTicks = 30;
  const samples: number[] = [];
  let maxHistoryBytes = 0;
  let maxHistoryEntries = 0;
  let resimulatedTicks = 0;
  let hardCorrections = 0;
  let hardCorrectionFailures = 0;
  let retainedAfterDispose = 0;
  for (let roundIndex = 0; roundIndex < rounds; roundIndex += 1) {
    const islandMembers: PhysicsPredictionIslandMemberDefinition[] = Array.from(
      { length: members },
      (_, index) => ({
        id: `member-${index}`,
        body: {
          id: `member-${index}.body`,
          kind: "dynamic",
          position: { x: index * 2, y: index % 4 },
          linearVelocity: { x: 0.25 + index * 0.01, y: 0 },
          gravityScale: 0
        },
        colliders: [
          {
            id: `member-${index}.collider`,
            shape: { type: "circle", radius: 0.45 }
          }
        ]
      })
    );
    const island = createPhysicsPredictionIsland({
      backend: createMemoryPhysicsBackend(),
      generation: roundIndex,
      initialMembers: islandMembers,
      maxHistoryTicks: simulatedTicks + 2,
      maxMembers: members,
      maxCommands: 8
    });
    const start = process.cpuUsage();
    island.advanceTo(simulatedTicks);
    island.queue({
      type: "patch",
      tick: simulatedTicks - rollbackTicks + 1,
      sequence: 1,
      memberId: "member-0",
      patch: { linearVelocity: { x: 2, y: 0 } }
    });
    const authorityBaseline = island.state();
    authorityBaseline.members[0]!.body.position.x += 0.5;
    const hardCorrection = island.hardCorrect(authorityBaseline);
    if (hardCorrection.status !== "corrected") {
      hardCorrectionFailures += 1;
    }
    samples.push(elapsedCpuMs(start));
    const diagnostics = island.diagnostics();
    maxHistoryBytes = Math.max(maxHistoryBytes, diagnostics.historyBytes);
    maxHistoryEntries = Math.max(maxHistoryEntries, diagnostics.historyEntries);
    resimulatedTicks += diagnostics.resimulatedTicks;
    hardCorrections += diagnostics.hardCorrections;
    island.dispose();
    const disposed = island.diagnostics();
    retainedAfterDispose += disposed.members + disposed.historyEntries + disposed.commands;
  }
  const stats = summarize(samples);
  return {
    rounds,
    members,
    simulatedTicks,
    rollbackTicks,
    p50MsPerRound: stats.p50,
    p95MsPerRound: stats.p95,
    maxMsPerRound: stats.max,
    maxHistoryBytes,
    maxHistoryEntries,
    resimulatedTicks,
    hardCorrections,
    hardCorrectionFailures,
    retainedAfterDispose
  };
}

function createRecord(projectileId: string, fireTick: number): CombatKinematicProjectileRecord {
  return {
    projectileId,
    correlationId: projectileId,
    generation: 1,
    definitionId: DEFINITION.id,
    definitionVersion: DEFINITION.version,
    fireTick,
    fixedDeltaMs: 16,
    firePosition: { x: 0, y: 0 },
    fireVelocity: { x: 100, y: 0 },
    expiresTick: fireTick + DEFINITION.lifetimeTicks
  };
}

function sceneQueries(
  scene: ReturnType<ReturnType<typeof createMemoryPhysicsBackend>["createScene"]>
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

function summarize(values: number[]): { p50: number; p95: number; max: number } {
  const sorted = [...values].sort((left, right) => left - right);
  return {
    p50: round(percentile(sorted, 0.5)),
    p95: round(percentile(sorted, 0.95)),
    max: round(sorted.at(-1) ?? 0)
  };
}

function percentile(sorted: number[], value: number): number {
  if (sorted.length === 0) {
    return 0;
  }
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * value) - 1));
  return sorted[index]!;
}

function round(value: number): number {
  return Math.round(value * 1_000) / 1_000;
}

function elapsedCpuMs(start: NodeJS.CpuUsage): number {
  const elapsed = process.cpuUsage(start);
  return (elapsed.user + elapsed.system) / 1_000;
}
