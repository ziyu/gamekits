import { Buffer } from "node:buffer";
import { performance } from "node:perf_hooks";
import { createDataRegistry, type DataRegistry } from "../packages/data/src";
import { createEventBus } from "../packages/event-bus/src";
import {
  CombatProjectileComponent,
  createCombatAbilityDeliveryBridge,
  createCombatDataTypes,
  createCombatRuntime,
  createCombatTraceStore,
  type CombatGasFacade,
  type CombatProjectileDespawnFact,
  type CombatProjectileSpawnFact
} from "../packages/combat/src";
import {
  createPhysicsDataTypes,
  type PhysicsQueries,
  type PhysicsQueryResult
} from "../packages/physics-core/src";
import { PhysicsTransformComponent } from "../packages/physics-core/src";
import { createKootaWorld } from "../packages/world-koota/src";
import {
  checkCombatBenchmarkBudgets,
  combatBenchmarkBudgetCount,
  type CombatBenchmarkCase,
  type CombatBenchmarkSuite
} from "./combat-benchmark-budget";

function main(): void {
  const suites: CombatBenchmarkSuite[] = [
    {
      suite: "combat-projectile-update",
      cases: [runProjectileUpdate(300), runProjectileUpdate(1_500)]
    },
    { suite: "combat-mass-hit", cases: [runMassHit()] },
    { suite: "combat-ability-delivery-bridge", cases: [runAbilityDeliveryBridge()] },
    { suite: "combat-entity-churn", cases: [runEntityChurn()] }
  ];
  const checkEnabled = process.argv.includes("--check");
  const failures = checkEnabled ? checkCombatBenchmarkBudgets(suites) : [];
  console.log(
    JSON.stringify(
      {
        benchmark: "combat",
        package: "@gamekits/combat",
        methodology: {
          warmupTicks: 10,
          reports: [
            "mean",
            "p50",
            "p95",
            "max",
            "per-unit",
            "lifecycle-event-count",
            "serialized-fact-bytes",
            "retained-after-dispose"
          ]
        },
        suites,
        ...(checkEnabled
          ? {
              budgetCheck: {
                budgets: combatBenchmarkBudgetCount(),
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
}

function runAbilityDeliveryBridge(): CombatBenchmarkCase {
  const dispatchesPerRound = 1_000;
  const rounds = 30;
  const registry = createBenchmarkRegistry();
  const eventBus = createEventBus({ clock: () => 0 });
  const sourceActor = actorState("source", "source-entity", "team.source");
  let deliveries = 0;
  const bridge = createCombatAbilityDeliveryBridge({
    dataRegistry: registry,
    eventBus,
    gas: {
      hasActor: (actorId) => actorId === "source",
      getActor: () => sourceActor,
      actorForEntity: () => undefined,
      getAbilityExecution: () => undefined,
      applyEffect: () => {
        throw new Error("Bridge benchmark does not apply effects");
      }
    },
    combat: {
      deliver(request) {
        deliveries += 1;
        return {
          status: "resolved",
          duplicate: false,
          requestId: request.id,
          deliveryType: "direct",
          hits: [],
          ignoredCandidates: 0,
          queriedCandidates: 0,
          correlationId: request.correlationId
        };
      }
    }
  });
  const emitRound = (round: number): void => {
    for (let index = 0; index < dispatchesPerRound; index += 1) {
      const sequence = round * dispatchesPerRound + index;
      eventBus.emit("gas.ability_execution_phase", {
        id: `execution-${sequence}`,
        actorId: "source",
        abilityId: "ability.benchmark",
        targetActorId: "target",
        phase: "committed",
        requestedAt: sequence,
        phaseStartedAt: sequence,
        committedAt: sequence,
        costCommitted: true,
        cooldownCommitted: true,
        paidCosts: [],
        appliedEffects: []
      });
    }
  };
  emitRound(-1);
  const samples: number[] = [];
  for (let round = 0; round < rounds; round += 1) {
    const start = performance.now();
    emitRound(round);
    samples.push(performance.now() - start);
  }
  bridge.dispose();
  const beforeDisposedEmit = deliveries;
  emitRound(rounds + 1);
  const stats = summarize(samples);
  return {
    dispatchesPerRound,
    rounds,
    deliveries: beforeDisposedEmit,
    deliveredAfterDispose: deliveries - beforeDisposedEmit,
    meanMsPerRound: stats.mean,
    p50MsPerRound: stats.p50,
    p95MsPerRound: stats.p95,
    maxMsPerRound: stats.max,
    microsecondsPerDispatch: round((stats.mean * 1_000) / dispatchesPerRound)
  };
}

function runProjectileUpdate(projectiles: number): CombatBenchmarkCase {
  const ticks = 120;
  const harness = createBenchmarkHarness();
  const projectileEntities: Array<string | number> = [];
  for (let index = 0; index < projectiles; index += 1) {
    const result = harness.runtime.deliver(projectileRequest(`idle-${index}`));
    if (result.status !== "resolved" || result.projectile === undefined) {
      throw new Error(
        `Projectile benchmark spawn failed: ${result.status === "rejected" ? result.reason : "missing-state"}`
      );
    }
    projectileEntities.push(result.projectile.entityId);
  }
  for (let tick = 0; tick < 10; tick += 1) {
    advanceProjectileTransforms(harness.world, projectileEntities, tick + 1);
    harness.runtime.update(16, tick * 16);
  }
  const samples: number[] = [];
  for (let tick = 0; tick < ticks; tick += 1) {
    advanceProjectileTransforms(harness.world, projectileEntities, tick + 11);
    const start = performance.now();
    harness.runtime.update(16, (tick + 10) * 16);
    samples.push(performance.now() - start);
  }
  const activeBeforeDispose = harness.runtime.listProjectiles().length;
  harness.runtime.dispose();
  const retainedAfterDispose = harness.world.query([CombatProjectileComponent]).length;
  const stats = summarize(samples);
  return {
    projectiles,
    ticks,
    activeBeforeDispose,
    sweepQueries: harness.queryCount(),
    retainedAfterDispose,
    transformAdvance: "excluded",
    meanMsPerTick: stats.mean,
    p50MsPerTick: stats.p50,
    p95MsPerTick: stats.p95,
    maxMsPerTick: stats.max,
    microsecondsPerProjectileTick: round((stats.mean * 1_000) / projectiles)
  };
}

function runMassHit(): CombatBenchmarkCase {
  const candidates = 1_000;
  const deliveries = 30;
  const harness = createBenchmarkHarness(candidates);
  harness.setCandidates(
    harness.targetEntities.map((entityId, index) => ({
      entityId,
      colliderId: `target-${index}.collider`,
      bodyId: `target-${index}.body`,
      distance: index + 1
    }))
  );
  const samples: number[] = [];
  for (let delivery = 0; delivery < deliveries; delivery += 1) {
    const start = performance.now();
    const result = harness.runtime.deliver({
      id: `mass-hit-${delivery}`,
      sourceActorId: "source",
      delivery: {
        type: "area",
        shape: { type: "circle", radius: 10_000 },
        position: { x: 0, y: 0 },
        selection: { mode: "all", maxTargets: candidates }
      },
      payloads: [{ effectId: "effect.benchmark", target: "hit-actor" }],
      relationshipPolicy: "policy.hostile"
    });
    samples.push(performance.now() - start);
    if (result.status !== "resolved" || result.hits.length !== candidates) {
      throw new Error("Mass-hit benchmark did not resolve every candidate");
    }
  }
  const applications = harness.effectApplications();
  harness.runtime.dispose();
  const stats = summarize(samples);
  return {
    candidates,
    deliveries,
    applications,
    retainedAfterDispose: harness.world.query([CombatProjectileComponent]).length,
    meanMsPerDelivery: stats.mean,
    p50MsPerDelivery: stats.p50,
    p95MsPerDelivery: stats.p95,
    maxMsPerDelivery: stats.max,
    microsecondsPerHit: round((stats.mean * 1_000) / candidates)
  };
}

function runEntityChurn(): CombatBenchmarkCase {
  const projectilesPerCycle = 300;
  const cycles = 20;
  const harness = createBenchmarkHarness(0, true);
  let lifecycleEvents = 0;
  let sampledSpawnFact: CombatProjectileSpawnFact | undefined;
  let sampledDespawnFact: CombatProjectileDespawnFact | undefined;
  const unsubscribeSpawn = harness.eventBus.on<CombatProjectileSpawnFact>(
    "combat.projectile_spawned",
    (event) => {
      lifecycleEvents += 1;
      sampledSpawnFact ??= event.payload;
    }
  );
  const unsubscribeDespawn = harness.eventBus.on<CombatProjectileDespawnFact>(
    "combat.projectile_despawned",
    (event) => {
      lifecycleEvents += 1;
      sampledDespawnFact ??= event.payload;
    }
  );
  const samples: number[] = [];
  for (let cycle = 0; cycle < cycles; cycle += 1) {
    const start = performance.now();
    for (let index = 0; index < projectilesPerCycle; index += 1) {
      const requestId = `churn-${cycle}-${index}`;
      const result = harness.runtime.deliver(projectileRequest(requestId));
      if (result.status !== "resolved" || result.projectile === undefined) {
        throw new Error("Projectile churn spawn failed");
      }
      harness.runtime.cancelProjectile({ projectileId: result.projectile.projectileId });
    }
    samples.push(performance.now() - start);
  }
  const expectedLifecycleEvents = projectilesPerCycle * cycles * 2;
  if (
    lifecycleEvents !== expectedLifecycleEvents ||
    sampledSpawnFact === undefined ||
    sampledDespawnFact === undefined
  ) {
    throw new Error(
      `Projectile lifecycle benchmark expected ${expectedLifecycleEvents} lifecycle facts, received ${lifecycleEvents}`
    );
  }
  const lifecycleFactBytes = Math.max(
    Buffer.byteLength(JSON.stringify(sampledSpawnFact), "utf8"),
    Buffer.byteLength(JSON.stringify(sampledDespawnFact), "utf8")
  );
  unsubscribeSpawn();
  unsubscribeDespawn();
  const lifecycleEventsBeforeProbe = lifecycleEvents;
  const probe = harness.runtime.deliver(projectileRequest("churn-unsubscribe-probe"));
  if (probe.status !== "resolved" || probe.projectile === undefined) {
    throw new Error("Projectile lifecycle unsubscribe probe failed to spawn");
  }
  harness.runtime.cancelProjectile({ projectileId: probe.projectile.projectileId });
  const lifecycleEventsAfterUnsubscribe = lifecycleEvents - lifecycleEventsBeforeProbe;
  harness.runtime.dispose();
  const stats = summarize(samples);
  return {
    projectilesPerCycle,
    cycles,
    totalProjectiles: projectilesPerCycle * cycles,
    lifecycleEvents,
    lifecycleFactBytes,
    lifecycleEventsAfterUnsubscribe,
    retainedAfterDispose: harness.world.query([CombatProjectileComponent]).length,
    meanMsPerCycle: stats.mean,
    p50MsPerCycle: stats.p50,
    p95MsPerCycle: stats.p95,
    maxMsPerCycle: stats.max,
    microsecondsPerSpawnCancel: round((stats.mean * 1_000) / projectilesPerCycle)
  };
}

function createBenchmarkHarness(targetCount = 0, emitProjectileEvents = false) {
  const registry = createBenchmarkRegistry();
  const world = createKootaWorld();
  const eventBus = createEventBus({ clock: () => 0 });
  const sourceEntity = world.spawn();
  world.add(sourceEntity, PhysicsTransformComponent, { position: { x: 0, y: 0 } });
  const targetEntities = Array.from({ length: targetCount }, () => world.spawn());
  const actors = new Map<string, ReturnType<typeof actorState>>([
    ["source", actorState("source", sourceEntity, "team.source")]
  ]);
  const actorIdByEntity = new Map<string | number, string>([[sourceEntity, "source"]]);
  for (const [index, entityId] of targetEntities.entries()) {
    const actorId = `target-${index}`;
    actors.set(actorId, actorState(actorId, entityId, "team.target"));
    actorIdByEntity.set(entityId, actorId);
  }
  let applications = 0;
  let queries = 0;
  const gas: CombatGasFacade = {
    hasActor: (actorId) => actors.has(actorId),
    getActor(actorId) {
      const actor = actors.get(actorId);
      if (actor === undefined) {
        throw new Error(`Missing benchmark actor: ${actorId}`);
      }
      return actor;
    },
    actorForEntity(entityId) {
      const actorId = actorIdByEntity.get(entityId);
      return actorId === undefined ? undefined : actors.get(actorId);
    },
    getAbilityExecution: () => undefined,
    applyEffect(input) {
      applications += 1;
      return { ...input, status: "applied" };
    }
  };
  let candidates: PhysicsQueryResult[] = [];
  const physics = emptyPhysics(
    () => candidates,
    () => {
      queries += 1;
    }
  );
  const runtime = createCombatRuntime({
    world,
    gas,
    physics,
    eventBus,
    dataRegistry: registry,
    relationshipResolver: {
      resolve: () => "hostile",
      allows: () => true
    },
    traceStore: createCombatTraceStore({ enabled: false }),
    eventPolicy: {
      emitDeliveries: false,
      emitHits: false,
      emitProjectiles: emitProjectileEvents
    },
    limits: {
      maxCandidatesPerRequest: 2_000,
      maxTargetsPerRequest: 2_000,
      maxActiveProjectiles: 2_000,
      recentDeliveryLimit: 1,
      resolvedTicketLimit: 1
    }
  });
  return {
    world,
    eventBus,
    runtime,
    targetEntities,
    setCandidates(next: PhysicsQueryResult[]) {
      candidates = next;
    },
    effectApplications: () => applications,
    queryCount: () => queries
  };
}

function createBenchmarkRegistry(): DataRegistry {
  const registry = createDataRegistry();
  registry.registerType({ type: "gas.ability" });
  registry.registerType({ type: "gas.effect" });
  for (const type of [...createPhysicsDataTypes(), ...createCombatDataTypes()]) {
    registry.registerType(type);
  }
  const result = registry.registerPack({
    id: "combat.benchmark",
    version: "1",
    entries: [
      { type: "gas.ability", id: "ability.benchmark", data: { id: "ability.benchmark" } },
      { type: "gas.effect", id: "effect.benchmark", data: { id: "effect.benchmark" } },
      {
        type: "physics.collider",
        id: "collider.benchmark",
        data: { id: "collider.benchmark", shape: { type: "circle", radius: 0.1 }, sensor: true }
      },
      {
        type: "physics.body",
        id: "body.benchmark",
        data: {
          id: "body.benchmark",
          kind: "dynamic",
          gravityScale: 0,
          colliders: [{ type: "physics.collider", id: "collider.benchmark" }]
        }
      },
      {
        type: "combat.relationship-policy",
        id: "policy.hostile",
        data: { id: "policy.hostile" }
      },
      {
        type: "combat.delivery",
        id: "delivery.benchmark",
        data: {
          id: "delivery.benchmark",
          delivery: { type: "direct", targetActorId: "target" },
          payloads: [{ effectId: "effect.benchmark", target: "hit-actor" }],
          relationshipPolicy: "policy.hostile"
        }
      },
      {
        type: "combat.ability-delivery",
        id: "binding.benchmark",
        data: {
          id: "binding.benchmark",
          ability: { type: "gas.ability", id: "ability.benchmark" },
          delivery: { type: "combat.delivery", id: "delivery.benchmark" }
        }
      },
      {
        type: "combat.projectile",
        id: "projectile.benchmark",
        data: {
          id: "projectile.benchmark",
          body: { type: "physics.body", id: "body.benchmark" },
          lifetimeMs: 1_000_000,
          speed: 0,
          collisionMode: "ray-sweep",
          hitPolicy: "stop",
          payloads: [{ effectId: "effect.benchmark", target: "hit-actor" }]
        }
      }
    ]
  });
  if (result.diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
    throw new Error(JSON.stringify(result.diagnostics));
  }
  return registry;
}

function emptyPhysics(
  candidates: () => PhysicsQueryResult[],
  countQuery: () => void
): PhysicsQueries {
  const empty = () => [] as PhysicsQueryResult[];
  const emptySweep = () => {
    countQuery();
    return [] as PhysicsQueryResult[];
  };
  return {
    query: empty,
    queryPoint: empty,
    raycast: emptySweep,
    shapeCast: emptySweep,
    overlapShape: () => {
      countQuery();
      return candidates().map((candidate) => ({ ...candidate }));
    },
    checkOverlap: () => false,
    checkCollision: () => false,
    queryBounds: empty,
    snapshot: () => ({
      id: "combat-benchmark",
      backend: "benchmark",
      dimension: "2d",
      gravity: { x: 0, y: 0 },
      bodyCount: 0,
      colliderCount: 0,
      activeContactCount: 0,
      disposed: false
    })
  };
}

function advanceProjectileTransforms(
  world: ReturnType<typeof createKootaWorld>,
  projectileEntities: Array<string | number>,
  tick: number
): void {
  for (const entityId of projectileEntities) {
    world.set(entityId, PhysicsTransformComponent, { position: { x: tick, y: 0 } });
  }
}

function actorState(actorId: string, entityId: string | number, team: string) {
  return {
    actor: { actorId, definitionId: "benchmark", entityId },
    attributes: { base: {}, current: {} },
    tags: { values: [team] },
    abilities: { ids: [], cooldowns: {}, disabled: [] },
    effects: { active: [] }
  };
}

function projectileRequest(id: string) {
  return {
    id,
    sourceActorId: "source",
    delivery: {
      type: "projectile" as const,
      projectile: { type: "combat.projectile" as const, id: "projectile.benchmark" },
      position: { x: 0, y: 0 },
      direction: { x: 1, y: 0 }
    },
    payloads: [],
    relationshipPolicy: "policy.hostile"
  };
}

function summarize(samples: number[]) {
  const sorted = [...samples].sort((left, right) => left - right);
  const mean = sorted.reduce((sum, value) => sum + value, 0) / sorted.length;
  return {
    mean: round(mean),
    p50: round(percentile(sorted, 0.5)),
    p95: round(percentile(sorted, 0.95)),
    max: round(sorted.at(-1) ?? 0)
  };
}

function percentile(sorted: number[], quantile: number): number {
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * quantile) - 1));
  return sorted[index] ?? 0;
}

function round(value: number): number {
  return Number(value.toFixed(4));
}

main();
