import { performance } from "node:perf_hooks";
import { createDataRegistry, type DataPack } from "../packages/data/src";
import { createEventBus, type GameEvent } from "../packages/event-bus/src";
import {
  createGasDataTypes,
  createGasRuntime,
  createGasTraceStore,
  type GasEffectDefinition,
  type GasRuntime
} from "../packages/gas/src";
import { createTcaRuntime, createTcaTraceStore, type TcaRule } from "../packages/tca/src";
import { createKootaWorld } from "../packages/world-koota/src";
import {
  checkGameplayFrameworkBenchmarkBudgets,
  gameplayFrameworkBenchmarkBudgetCount,
  type GameplayFrameworkBenchmarkSuite
} from "./gameplay-framework-benchmark-budget";

const TRACE_LIMIT = 64;

function main(): void {
  const suites: GameplayFrameworkBenchmarkSuite[] = [
    runEventBusBenchmark(),
    runTcaDispatchBenchmark(),
    runGasAbilityBenchmark(),
    runGasStackingBenchmark(),
    runGasEntityUpdateBenchmark(),
    runGasExecutionUpdateBenchmark(),
    runGasEntityCleanupBenchmark()
  ];
  const budgetCheckEnabled = process.argv.includes("--check");
  const budgetFailures = budgetCheckEnabled ? checkGameplayFrameworkBenchmarkBudgets(suites) : [];

  console.log(
    JSON.stringify(
      {
        benchmark: "gameplay-framework",
        packages: ["@gamekits/event-bus", "@gamekits/tca", "@gamekits/gas"],
        suites,
        ...(budgetCheckEnabled
          ? {
              budgetCheck: {
                budgets: gameplayFrameworkBenchmarkBudgetCount(),
                passed: budgetFailures.length === 0,
                failures: budgetFailures
              }
            }
          : {})
      },
      null,
      2
    )
  );

  if (budgetFailures.length > 0) {
    process.exitCode = 1;
  }
}

function runEventBusBenchmark(): GameplayFrameworkBenchmarkSuite {
  const events = 200_000;
  const eventBus = createEventBus({ clock: () => 42 });
  let checksum = 0;
  eventBus.on<number>("combat.hit", (event) => {
    checksum += event.payload;
  });
  eventBus.on<number>("combat.hit", (event) => {
    checksum += event.correlationId === "combat-chain" ? 1 : 0;
  });
  eventBus.onAny((event) => {
    checksum += event.parentId === "network-command" ? 1 : 0;
  });

  for (let index = 0; index < 1_000; index += 1) {
    eventBus.emit("combat.hit", index & 1, "benchmark", {
      correlationId: "combat-chain",
      parentId: "network-command"
    });
  }
  checksum = 0;

  const start = performance.now();
  for (let index = 0; index < events; index += 1) {
    eventBus.emit("combat.hit", index & 1, "benchmark", {
      correlationId: "combat-chain",
      parentId: "network-command"
    });
  }
  const durationMs = performance.now() - start;

  return {
    suite: "event-bus-correlated-fanout",
    cases: [
      {
        events,
        listeners: 3,
        durationMs: round(durationMs),
        microsecondsPerEvent: round((durationMs * 1_000) / events),
        checksum
      }
    ]
  };
}

function runTcaDispatchBenchmark(): GameplayFrameworkBenchmarkSuite {
  const events = 25_000;
  const candidateRules = 4;
  const unrelatedRules = 1_000;
  const eventBus = createEventBus({ clock: () => 7 });
  let executions = 0;
  const rules: TcaRule[] = [];

  for (let index = 0; index < unrelatedRules; index += 1) {
    rules.push(createTcaRule(`unrelated-${index}`, `unrelated.event.${index}`));
  }
  for (let index = 0; index < candidateRules; index += 1) {
    rules.push(createTcaRule(`combat-${index}`, "combat.hit"));
  }

  const runtime = createTcaRuntime({
    rules,
    eventBus,
    definitions: {
      conditions: [
        {
          type: "benchmark.accept",
          evaluate: () => true
        }
      ],
      actions: [
        {
          type: "benchmark.count",
          execute: () => {
            executions += 1;
          }
        }
      ]
    },
    traceStore: createTcaTraceStore({ limit: TRACE_LIMIT })
  });
  const event: GameEvent<number> = {
    type: "combat.hit",
    payload: 1,
    timestamp: 7,
    correlationId: "combat-chain",
    parentId: "physics-hit"
  };

  for (let index = 0; index < 500; index += 1) {
    runtime.handleEvent(event);
  }
  executions = 0;

  const start = performance.now();
  for (let index = 0; index < events; index += 1) {
    runtime.handleEvent(event);
  }
  const durationMs = performance.now() - start;
  const retainedTraces = runtime.traceStore.list().length;
  runtime.dispose();

  return {
    suite: "tca-indexed-dispatch",
    cases: [
      {
        events,
        totalRules: rules.length,
        candidateRules,
        executions,
        retainedTraces,
        durationMs: round(durationMs),
        microsecondsPerEvent: round((durationMs * 1_000) / events)
      }
    ]
  };
}

function runGasAbilityBenchmark(): GameplayFrameworkBenchmarkSuite {
  const activations = 20_000;
  const targetActors = 128;
  const { runtime, eventBus, world } = createGasBenchmarkRuntime();
  let emittedFacts = 0;
  eventBus.onAny(() => {
    emittedFacts += 1;
  });
  createEntityActor(runtime, world, "source");
  for (let index = 0; index < targetActors; index += 1) {
    createEntityActor(runtime, world, `target-${index}`);
  }

  for (let index = 0; index < 500; index += 1) {
    activateBenchmarkAbility(runtime, index % targetActors);
  }
  emittedFacts = 0;

  const start = performance.now();
  for (let index = 0; index < activations; index += 1) {
    const result = activateBenchmarkAbility(runtime, index % targetActors);
    if (result !== "activated") {
      throw new Error(`Unexpected benchmark ability result: ${result}`);
    }
  }
  const durationMs = performance.now() - start;
  const retainedTraces = runtime.traceStore.list().length;
  runtime.dispose();

  return {
    suite: "gas-ability-effect-chain",
    cases: [
      {
        activations,
        targetActors,
        emittedFacts,
        retainedTraces,
        durationMs: round(durationMs),
        microsecondsPerActivation: round((durationMs * 1_000) / activations)
      }
    ]
  };
}

function runGasStackingBenchmark(): GameplayFrameworkBenchmarkSuite {
  const cases = [
    runGasStackingCase("effect.refresh", 1, "refresh-oldest"),
    runGasStackingCase("effect.reject", 4, "reject-newest")
  ];

  return {
    suite: "gas-bounded-effect-stacking",
    cases
  };
}

function runGasStackingCase(
  effectId: string,
  stackLimit: number,
  overflow: "refresh-oldest" | "reject-newest"
) {
  const applications = 20_000;
  const { runtime, world } = createGasBenchmarkRuntime();
  createEntityActor(runtime, world, "target");

  for (let index = 0; index < 100; index += 1) {
    runtime.applyEffect({
      effectId,
      sourceActorId: "source",
      targetActorId: "target",
      correlationId: "combat-chain"
    });
  }

  const start = performance.now();
  for (let index = 0; index < applications; index += 1) {
    runtime.applyEffect({
      effectId,
      sourceActorId: "source",
      targetActorId: "target",
      correlationId: "combat-chain"
    });
  }
  const durationMs = performance.now() - start;
  const retainedEffects = runtime.getActor("target").effects.active.length;
  const retainedTraces = runtime.traceStore.list().length;
  runtime.dispose();

  return {
    applications,
    stackLimit,
    overflow,
    retainedEffects,
    retainedTraces,
    durationMs: round(durationMs),
    microsecondsPerApplication: round((durationMs * 1_000) / applications)
  };
}

function runGasEntityUpdateBenchmark(): GameplayFrameworkBenchmarkSuite {
  return {
    suite: "gas-entity-effect-update",
    cases: [
      runGasEntityUpdateCase(500),
      runGasEntityUpdateCase(500, "effect.sparse"),
      runGasEntityUpdateCase(500, "effect.periodic")
    ]
  };
}

function runGasEntityUpdateCase(actors: number, effectId?: "effect.sparse" | "effect.periodic") {
  const ticks = 120;
  const { runtime, world } = createGasBenchmarkRuntime();
  for (let index = 0; index < actors; index += 1) {
    const actorId = `actor-${index}`;
    createEntityActor(runtime, world, actorId);
    if (effectId !== undefined) {
      runtime.applyEffect({
        effectId,
        targetActorId: actorId,
        correlationId: "periodic-chain"
      });
    }
  }

  runtime.update(50, 50);
  const start = performance.now();
  for (let tick = 1; tick <= ticks; tick += 1) {
    runtime.update(50, (tick + 1) * 50);
  }
  const durationMs = performance.now() - start;
  const sampleHealth = runtime.getActor("actor-0").attributes.current.health;
  const retainedTraces = runtime.traceStore.list().length;
  runtime.dispose();

  return {
    actors,
    activeEffects: effectId === undefined ? 0 : actors,
    periodMs: effectId === undefined ? "none" : effectId === "effect.sparse" ? 1_000 : 50,
    ticks,
    sampleHealth,
    retainedTraces,
    durationMs: round(durationMs),
    msPerTick: round(durationMs / ticks),
    microsecondsPerActorTick: round((durationMs * 1_000) / (ticks * actors))
  };
}

function runGasEntityCleanupBenchmark(): GameplayFrameworkBenchmarkSuite {
  const actors = 4_000;
  const removedActors = actors / 2;
  const { runtime, world } = createGasBenchmarkRuntime();
  const entities: Array<string | number> = [];
  for (let index = 0; index < actors; index += 1) {
    entities.push(createEntityActor(runtime, world, `actor-${index}`));
  }
  for (let index = 0; index < removedActors; index += 1) {
    const entity = entities[index];
    if (entity !== undefined) {
      world.despawn(entity);
    }
  }

  const start = performance.now();
  runtime.update(50, 50);
  const durationMs = performance.now() - start;
  let staleActors = 0;
  for (let index = 0; index < removedActors; index += 1) {
    staleActors += runtime.hasActor(`actor-${index}`) ? 1 : 0;
  }
  const retainedActors = runtime.snapshot().actors.length;
  runtime.dispose();

  return {
    suite: "gas-missing-entity-cleanup",
    cases: [
      {
        actors,
        removedActors,
        retainedActors,
        staleActors,
        durationMs: round(durationMs),
        microsecondsPerActor: round((durationMs * 1_000) / actors)
      }
    ]
  };
}

function runGasExecutionUpdateBenchmark(): GameplayFrameworkBenchmarkSuite {
  return {
    suite: "gas-ability-execution-update",
    cases: [
      runGasExecutionUpdateCase("idle", false),
      runGasExecutionUpdateCase("active", false),
      runGasExecutionUpdateCase("active", true)
    ]
  };
}

function runGasExecutionUpdateCase(mode: "idle" | "active", traceEnabled: boolean) {
  const actors = 1_000;
  const ticks = mode === "idle" ? 120 : 16;
  const tickMs = 25;
  const { runtime, world } = createGasBenchmarkRuntime(traceEnabled);
  for (let index = 0; index < actors; index += 1) {
    const actorId = `execution-${index}`;
    createEntityActor(runtime, world, actorId);
    if (mode === "active") {
      const result = runtime.requestAbilityExecution({
        actorId,
        abilityId: "ability.execution",
        requestId: `execution-command-${index}`
      });
      if (result.status !== "accepted") {
        throw new Error(`Unexpected benchmark execution rejection: ${result.reason}`);
      }
    }
  }

  const start = performance.now();
  for (let tick = 1; tick <= ticks; tick += 1) {
    runtime.update(tickMs, tick * tickMs);
  }
  const durationMs = performance.now() - start;
  const snapshot = runtime.snapshot();
  const retainedExecutions = snapshot.activeExecutions.length + snapshot.recentExecutions.length;
  const retainedTraces = runtime.traceStore.list().length;
  runtime.dispose();
  const retainedAfterDispose =
    runtime.snapshot().actors.length +
    runtime.snapshot().activeExecutions.length +
    runtime.snapshot().recentExecutions.length;

  return {
    actors,
    mode,
    trace: traceEnabled ? "enabled" : "disabled",
    ticks,
    retainedExecutions,
    retainedTraces,
    retainedAfterDispose,
    durationMs: round(durationMs),
    msPerTick: round(durationMs / ticks),
    microsecondsPerActorTick: round((durationMs * 1_000) / (ticks * actors))
  };
}

function createTcaRule(id: string, eventType: string): TcaRule {
  return {
    id,
    trigger: { type: "event.type", args: { eventType } },
    conditions: [{ type: "benchmark.accept" }],
    actions: [{ type: "benchmark.count" }]
  };
}

function createGasBenchmarkRuntime(traceEnabled = true) {
  const world = createKootaWorld();
  const eventBus = createEventBus({ clock: () => 11 });
  const registry = createDataRegistry();
  for (const type of createGasDataTypes()) {
    registry.registerType(type);
  }
  registry.registerPack(GAS_BENCHMARK_PACK);
  const runtime = createGasRuntime({
    world,
    dataRegistry: registry,
    eventBus,
    traceStore: createGasTraceStore({ enabled: traceEnabled, limit: TRACE_LIMIT })
  });
  return { runtime, world, eventBus };
}

function createEntityActor(
  runtime: GasRuntime,
  world: ReturnType<typeof createKootaWorld>,
  actorId: string
): string | number {
  const entityId = world.spawn();
  runtime.createActor({
    actorId,
    definitionId: "actor.benchmark",
    entityId
  });
  return entityId;
}

function activateBenchmarkAbility(runtime: GasRuntime, targetIndex: number) {
  return runtime.activateAbility({
    actorId: "source",
    abilityId: "ability.hit",
    targetActorId: `target-${targetIndex}`,
    correlationId: "combat-chain",
    parentId: "physics-hit"
  }).status;
}

const GAS_BENCHMARK_PACK: DataPack = {
  id: "gas.benchmark",
  version: "1.0.0",
  entries: [
    {
      type: "gas.attribute",
      id: "health",
      data: { id: "health", min: 0, max: 1_000_000, defaultValue: 100_000 }
    },
    {
      type: "gas.cue",
      id: "cue.hit",
      data: { id: "cue.hit", type: "combat.hit" }
    },
    {
      type: "gas.effect",
      id: "effect.hit",
      data: {
        id: "effect.hit",
        attributeModifiers: [{ attribute: "health", operation: "add", value: -1 }],
        cues: ["cue.hit"]
      }
    },
    createEffectEntry("effect.refresh", {
      id: "effect.refresh",
      durationMs: 60_000,
      stacking: { limit: 1, overflow: "refresh-oldest" }
    }),
    createEffectEntry("effect.reject", {
      id: "effect.reject",
      durationMs: 60_000,
      stacking: { limit: 4, overflow: "reject-newest" }
    }),
    createEffectEntry("effect.periodic", {
      id: "effect.periodic",
      durationMs: 60_000,
      periodMs: 50,
      periodicModifiers: [{ attribute: "health", operation: "add", value: 1 }]
    }),
    createEffectEntry("effect.sparse", {
      id: "effect.sparse",
      durationMs: 60_000,
      periodMs: 1_000,
      periodicModifiers: [{ attribute: "health", operation: "add", value: 1 }]
    }),
    {
      type: "gas.ability",
      id: "ability.hit",
      data: {
        id: "ability.hit",
        effects: [{ effectId: "effect.hit", target: "target" }]
      }
    },
    {
      type: "gas.ability",
      id: "ability.execution",
      data: {
        id: "ability.execution",
        execution: {
          preparingMs: 100,
          activeMs: 100,
          recoveringMs: 100
        }
      }
    },
    {
      type: "gas.actor",
      id: "actor.benchmark",
      data: {
        id: "actor.benchmark",
        attributes: { health: 100_000 },
        abilities: ["ability.hit", "ability.execution"]
      }
    }
  ]
};

function createEffectEntry(id: string, data: GasEffectDefinition) {
  return {
    type: "gas.effect",
    id,
    data
  };
}

function round(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

main();
