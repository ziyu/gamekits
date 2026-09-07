import { performance } from "node:perf_hooks";
import { createDataRegistry, type DataPack } from "../packages/data/src";
import {
  createAiDataTypes,
  createAiRuntime,
  createAiWorldReadModel,
  type AiRuntime
} from "../packages/ai-core/src";
import type { ComponentDef, EntityId, GameWorld } from "../packages/world/src";
import {
  aiBenchmarkBudgetCount,
  checkAiBenchmarkBudgets,
  type AiBenchmarkCase,
  type AiBenchmarkSuite
} from "./ai-benchmark-budget";

function main(): void {
  const suites: AiBenchmarkSuite[] = [
    {
      suite: "ai-agent-update",
      cases: [runAgentUpdate(250, "uniform", 0), runAgentUpdate(1000, "mixed-lod", 0)]
    },
    {
      suite: "ai-trace-overhead",
      cases: [runTraceOverhead(0), runTraceOverhead(256)]
    },
    {
      suite: "ai-agent-churn",
      cases: [runTargetAndLodChurn(1000), runBulkUnbind(1000, 500)]
    }
  ];
  const checkEnabled = process.argv.includes("--check");
  const failures = checkEnabled ? checkAiBenchmarkBudgets(suites) : [];
  console.log(
    JSON.stringify(
      {
        benchmark: "ai",
        package: "@gamekits/ai-core",
        methodology: {
          warmupTicks: 10,
          measuredTicks: 120,
          profiles: ["uniform", "mixed-lod"],
          churn: ["target", "dynamic-lod", "bulk-unbind"],
          reports: ["mean", "p50", "p95", "max", "per-agent", "retained-after-dispose"]
        },
        suites,
        ...(checkEnabled
          ? {
              budgetCheck: {
                budgets: aiBenchmarkBudgetCount(),
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

function runAgentUpdate(
  agents: number,
  profile: "uniform" | "mixed-lod",
  traceLimit: number
): AiBenchmarkCase {
  const ticks = 120;
  const runtime = createBenchmarkRuntime(traceLimit);
  bindAgents(runtime, agents, profile);
  warmup(runtime);
  const samples = measure(runtime, ticks, 10);
  const snapshot = runtime.snapshot();
  runtime.dispose();
  const disposed = runtime.snapshot();
  const stats = summarize(samples);
  return {
    agents,
    profile,
    ticks,
    activeTasks: snapshot.activeTasks,
    memoryFacts: snapshot.memoryFacts,
    delayedDecisions: snapshot.delayedDecisions,
    retainedAfterDispose: disposed.agents.length + disposed.memoryFacts + disposed.activeTasks,
    meanMsPerTick: stats.mean,
    p50MsPerTick: stats.p50,
    p95MsPerTick: stats.p95,
    maxMsPerTick: stats.max,
    microsecondsPerAgentTick: round((stats.mean * 1000) / agents)
  };
}

function runTraceOverhead(traceLimit: number): AiBenchmarkCase {
  const agents = 250;
  const ticks = 120;
  const runtime = createBenchmarkRuntime(traceLimit);
  bindAgents(runtime, agents, "uniform");
  warmup(runtime);
  const samples = measure(runtime, ticks, 10);
  const retainedTraceEntries = runtime.traces().length;
  runtime.dispose();
  const stats = summarize(samples);
  return {
    agents,
    traceLimit,
    ticks,
    retainedTraceEntries,
    meanMsPerTick: stats.mean,
    p50MsPerTick: stats.p50,
    p95MsPerTick: stats.p95,
    maxMsPerTick: stats.max,
    microsecondsPerAgentTick: round((stats.mean * 1000) / agents)
  };
}

function runTargetAndLodChurn(agents: number): AiBenchmarkCase {
  const ticks = 120;
  const runtime = createBenchmarkRuntime(0);
  bindAgents(runtime, agents, "mixed-lod");
  warmup(runtime);
  const samples: number[] = [];
  for (let tick = 0; tick < ticks; tick += 1) {
    const started = performance.now();
    if (tick % 12 === 0) {
      const epoch = tick / 12 + 1;
      for (let index = 0; index < agents; index += 1) {
        const agentId = benchmarkAgentId(index);
        runtime.setBlackboard(agentId, "targetEpoch", epoch);
        runtime.setSchedulerClass(agentId, (index + epoch) % 4 === 0 ? "near" : "far");
      }
    }
    runtime.update(16, (tick + 11) * 16);
    samples.push(performance.now() - started);
  }
  const snapshot = runtime.snapshot();
  runtime.dispose();
  const disposed = runtime.snapshot();
  const stats = summarize(samples);
  return {
    operation: "target-and-lod-churn",
    agents,
    ticks,
    reclassificationRequests: Math.ceil(ticks / 12) * agents,
    delayedDecisions: snapshot.delayedDecisions,
    retainedAfterDispose: disposed.agents.length + disposed.memoryFacts + disposed.activeTasks,
    meanMsPerTick: stats.mean,
    p50MsPerTick: stats.p50,
    p95MsPerTick: stats.p95,
    maxMsPerTick: stats.max
  };
}

function runBulkUnbind(agents: number, removed: number): AiBenchmarkCase {
  const runtime = createBenchmarkRuntime(0);
  bindAgents(runtime, agents, "mixed-lod");
  warmup(runtime);
  const started = performance.now();
  for (let index = 0; index < removed; index += 1) {
    runtime.unbind(benchmarkAgentId(index), "benchmark-bulk-unbind");
  }
  runtime.update(16, 176);
  const elapsedMs = performance.now() - started;
  const remaining = runtime.snapshot().agents.length;
  runtime.dispose();
  const disposed = runtime.snapshot();
  return {
    operation: "bulk-unbind",
    agents,
    removed,
    remaining,
    elapsedMs: round(elapsedMs),
    retainedAfterDispose: disposed.agents.length + disposed.memoryFacts + disposed.activeTasks
  };
}

function createBenchmarkRuntime(traceLimit: number): AiRuntime {
  const registry = createDataRegistry();
  for (const type of createAiDataTypes()) {
    registry.registerType(type);
  }
  const validation = registry.registerPack(BENCHMARK_PACK);
  if (validation.diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
    throw new Error(JSON.stringify(validation.diagnostics));
  }
  return createAiRuntime({
    dataRegistry: registry,
    world: createAiWorldReadModel(createMemoryWorld()),
    intentSink: { emit() {} },
    sensors: [
      {
        id: "sensor.benchmark",
        sample(context) {
          return [
            {
              key: "target.visible",
              subjectId: `target.${context.agent.agentId}`,
              observedAt: context.elapsed,
              expiresAt: context.elapsed + 1_000,
              value: true
            }
          ];
        }
      }
    ],
    inputs: [
      {
        id: "aggression",
        read(context) {
          const epoch = context.blackboard<number>("targetEpoch") ?? 0;
          return stableValue(`${context.agent.agentId}:${epoch}`);
        }
      },
      {
        id: "danger",
        read(context) {
          const epoch = context.blackboard<number>("targetEpoch") ?? 0;
          return 1 - stableValue(`${context.agent.agentId}:${epoch}`);
        }
      }
    ],
    tasks: [
      {
        id: "task.hold",
        start() {
          return { status: "running", safeToInterrupt: true };
        },
        update() {
          return { status: "running", safeToInterrupt: true };
        }
      }
    ],
    schedulerClasses: [
      { id: "near", decisionIntervalMultiplier: 1, sensorIntervalMultiplier: 1, priority: 1 },
      { id: "far", decisionIntervalMultiplier: 5, sensorIntervalMultiplier: 5 }
    ],
    maxSensorSamplesPerTick: 1_000,
    maxDecisionsPerTick: 1_000,
    traceLimit
  });
}

function bindAgents(runtime: AiRuntime, count: number, profile: "uniform" | "mixed-lod"): void {
  for (let index = 0; index < count; index += 1) {
    runtime.bind({
      agentId: benchmarkAgentId(index),
      definitionId: profile === "mixed-lod" && index % 4 !== 0 ? "agent.far" : "agent.near"
    });
  }
}

function benchmarkAgentId(index: number): string {
  return `agent.${index.toString().padStart(4, "0")}`;
}

function warmup(runtime: AiRuntime): void {
  for (let tick = 0; tick < 10; tick += 1) {
    runtime.update(16, (tick + 1) * 16);
  }
}

function measure(runtime: AiRuntime, ticks: number, elapsedTicks: number): number[] {
  const samples: number[] = [];
  for (let tick = 0; tick < ticks; tick += 1) {
    const started = performance.now();
    runtime.update(16, (elapsedTicks + tick + 1) * 16);
    samples.push(performance.now() - started);
  }
  return samples;
}

function stableValue(id: string): number {
  let hash = 0;
  for (let index = 0; index < id.length; index += 1) {
    hash = (Math.imul(hash, 31) + id.charCodeAt(index)) | 0;
  }
  return ((hash >>> 0) % 1000) / 999;
}

const BENCHMARK_PACK: DataPack = {
  id: "ai.benchmark",
  version: "1.0.0",
  entries: [
    {
      type: "ai.sensor",
      id: "sensor.benchmark",
      data: { id: "sensor.benchmark", sampler: "sensor.benchmark", intervalMs: 100 }
    },
    {
      type: "ai.task",
      id: "task.hold",
      data: { id: "task.hold", executor: "task.hold", interruptPolicy: "always" }
    },
    {
      type: "ai.goal",
      id: "goal.attack",
      data: {
        id: "goal.attack",
        task: { type: "ai.task", id: "task.hold" },
        considerations: [{ input: "aggression", curve: { type: "linear" } }],
        switchThreshold: 0.1
      }
    },
    {
      type: "ai.goal",
      id: "goal.evade",
      data: {
        id: "goal.evade",
        task: { type: "ai.task", id: "task.hold" },
        considerations: [{ input: "danger", curve: { type: "linear" } }],
        switchThreshold: 0.1
      }
    },
    agentDefinition("agent.near", "near"),
    agentDefinition("agent.far", "far")
  ]
};

function agentDefinition(id: string, schedulerClass: string): DataPack["entries"][number] {
  return {
    type: "ai.agent",
    id,
    data: {
      id,
      sensors: [{ type: "ai.sensor", id: "sensor.benchmark" }],
      goals: [
        { type: "ai.goal", id: "goal.attack" },
        { type: "ai.goal", id: "goal.evade" }
      ],
      decisionIntervalMs: 100,
      memoryLimit: 8,
      schedulerClass
    }
  };
}

function summarize(values: number[]): { mean: number; p50: number; p95: number; max: number } {
  const sorted = [...values].sort((left, right) => left - right);
  return {
    mean: round(values.reduce((total, value) => total + value, 0) / values.length),
    p50: round(percentile(sorted, 0.5)),
    p95: round(percentile(sorted, 0.95)),
    max: round(sorted.at(-1) ?? 0)
  };
}

function percentile(sorted: number[], quantile: number): number {
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * quantile))] ?? 0;
}

function round(value: number): number {
  return Number(value.toFixed(4));
}

function createMemoryWorld(): GameWorld {
  const componentData = new Map<EntityId, Map<string, unknown>>();
  let nextId = 0;
  const requireEntity = (entity: EntityId): Map<string, unknown> => {
    const components = componentData.get(entity);
    if (components === undefined) {
      throw new Error(`Missing entity: ${String(entity)}`);
    }
    return components;
  };
  return {
    spawn() {
      const entity = `entity-${nextId}`;
      nextId += 1;
      componentData.set(entity, new Map());
      return entity;
    },
    despawn(entity) {
      componentData.delete(entity);
    },
    has(entity) {
      return componentData.has(entity);
    },
    add(entity, component, data) {
      requireEntity(entity).set(component.id, component.create(data));
    },
    get(entity, component) {
      return requireEntity(entity).get(component.id) as ReturnType<typeof component.create>;
    },
    set(entity, component, data) {
      const components = requireEntity(entity);
      const current = components.get(component.id) ?? component.create();
      components.set(component.id, { ...(current as object), ...data });
    },
    remove(entity, component) {
      requireEntity(entity).delete(component.id);
    },
    query(components: Array<ComponentDef<any>> = []) {
      return [...componentData.entries()]
        .filter(([, values]) => components.every((component) => values.has(component.id)))
        .map(([entity]) => entity);
    },
    count() {
      return componentData.size;
    }
  };
}

main();
