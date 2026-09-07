import { performance } from "node:perf_hooks";
import { createAssetDataType } from "../packages/asset/src";
import { createAnimatorDataTypes, createAnimatorRuntime } from "../packages/animator-core/src";
import { createMemoryAnimationPlaybackAdapter } from "../packages/animator-core/src/testing";
import { createDataRegistry, type DataPack } from "../packages/data/src";
import {
  animatorBenchmarkBudgetCount,
  checkAnimatorBenchmarkBudgets,
  type AnimatorBenchmarkCase,
  type AnimatorBenchmarkSuite
} from "./animator-benchmark-budget";

function main(): void {
  const suites: AnimatorBenchmarkSuite[] = [
    {
      suite: "animator-controller-update",
      cases: [runControllerUpdate(500, "active-phase"), runControllerUpdate(1000, "mostly-idle")]
    },
    { suite: "animator-state-churn", cases: [runStateChurn()] },
    { suite: "animator-late-join", cases: [runLateJoin()] }
  ];
  const checkEnabled = process.argv.includes("--check");
  const failures = checkEnabled ? checkAnimatorBenchmarkBudgets(suites) : [];
  console.log(
    JSON.stringify(
      {
        benchmark: "animator",
        package: "@gamekits/animator-core",
        methodology: {
          warmupTicks: 10,
          measuredTicks: 120,
          reports: ["mean", "p50", "p95", "max", "batch writes", "retained-after-dispose"]
        },
        suites,
        ...(checkEnabled
          ? {
              budgetCheck: {
                budgets: animatorBenchmarkBudgetCount(),
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

function runControllerUpdate(
  controllers: number,
  profile: "active-phase" | "mostly-idle"
): AnimatorBenchmarkCase {
  const ticks = 120;
  const harness = createHarness(controllers);
  bindControllers(harness.runtime, controllers);
  harness.runtime.update(0, 0);
  if (profile === "active-phase") {
    for (let index = 0; index < controllers; index += 1) {
      harness.runtime.syncGameplayPhase(`controller.${index}`, {
        executionId: `execution.${index}`,
        abilityId: "ability.benchmark",
        phase: "active",
        startedAt: 0,
        durationMs: 10_000
      });
    }
  }
  for (let tick = 0; tick < 10; tick += 1) {
    harness.runtime.update(16, (tick + 1) * 16);
  }
  const framesBefore = harness.adapter.snapshot().appliedFrames;
  const batchesBefore = Number(harness.adapter.snapshot().details?.appliedBatches ?? 0);
  const samples = measure(harness.runtime.update, ticks, 10);
  const snapshot = harness.runtime.snapshot();
  const framesDuringMeasurement = harness.adapter.snapshot().appliedFrames - framesBefore;
  const batchesDuringMeasurement =
    Number(harness.adapter.snapshot().details?.appliedBatches ?? 0) - batchesBefore;
  harness.runtime.dispose();
  const disposed = harness.runtime.snapshot();
  const stats = summarize(samples);
  return {
    controllers,
    profile,
    ticks,
    framesDuringMeasurement,
    batchesDuringMeasurement,
    activeGameplayPhases: snapshot.activeGameplayPhases,
    retainedAfterDispose:
      disposed.controllers.length +
      disposed.adapter.boundControllers +
      disposed.adapter.retainedFrames,
    meanMsPerTick: stats.mean,
    p50MsPerTick: stats.p50,
    p95MsPerTick: stats.p95,
    maxMsPerTick: stats.max,
    microsecondsPerControllerTick: round((stats.mean * 1_000) / controllers)
  };
}

function runStateChurn(): AnimatorBenchmarkCase {
  const controllers = 500;
  const ticks = 120;
  const harness = createHarness(controllers);
  bindControllers(harness.runtime, controllers);
  harness.runtime.update(0, 0);
  const samples: number[] = [];
  for (let tick = 0; tick < ticks; tick += 1) {
    const moving = tick % 2 === 0;
    const started = performance.now();
    for (let index = 0; index < controllers; index += 1) {
      harness.runtime.setParameter(`controller.${index}`, "moving", moving);
    }
    harness.runtime.update(16, (tick + 1) * 16);
    samples.push(performance.now() - started);
  }
  const stats = summarize(samples);
  harness.runtime.dispose();
  return {
    controllers,
    ticks,
    meanMsPerTick: stats.mean,
    p50MsPerTick: stats.p50,
    p95MsPerTick: stats.p95,
    maxMsPerTick: stats.max,
    microsecondsPerControllerTick: round((stats.mean * 1_000) / controllers)
  };
}

function runLateJoin(): AnimatorBenchmarkCase {
  const controllers = 1000;
  const harness = createHarness(controllers);
  bindControllers(harness.runtime, controllers);
  harness.runtime.update(5_000, 5_000);
  const started = performance.now();
  for (let index = 0; index < controllers; index += 1) {
    harness.runtime.syncGameplayPhase(`controller.${index}`, {
      executionId: `late.${index}`,
      abilityId: "ability.benchmark",
      phase: "active",
      startedAt: 4_500,
      durationMs: 1_000
    });
  }
  harness.runtime.update(0, 5_000);
  const milliseconds = performance.now() - started;
  const seekFrames = harness.adapter
    .frames()
    .slice(-controllers)
    .filter((frame) =>
      frame.layers.some((layer) => layer.kind === "gameplay-phase" && layer.seek)
    ).length;
  harness.runtime.dispose();
  return { controllers, milliseconds: round(milliseconds), seekFrames };
}

function createHarness(maxControllers: number) {
  const registry = createDataRegistry();
  registry.registerType(createAssetDataType());
  for (const type of createAnimatorDataTypes()) {
    registry.registerType(type);
  }
  const validation = registry.registerPack(BENCHMARK_PACK);
  if (validation.diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
    throw new Error(JSON.stringify(validation.diagnostics));
  }
  const adapter = createMemoryAnimationPlaybackAdapter({ maxRetainedFrames: maxControllers });
  const runtime = createAnimatorRuntime({
    dataRegistry: registry,
    adapter,
    maxControllers,
    traceLimit: 0,
    markerHistoryLimit: 0
  });
  return { runtime, adapter };
}

function bindControllers(
  runtime: ReturnType<typeof createAnimatorRuntime>,
  controllers: number
): void {
  for (let index = 0; index < controllers; index += 1) {
    runtime.bind({
      controllerId: `controller.${index}`,
      bindingId: "binding.benchmark",
      renderObjectId: `render.${index}`
    });
  }
}

function measure(
  update: (deltaMs: number, elapsedMs: number) => void,
  ticks: number,
  elapsedTicks: number
): number[] {
  const samples: number[] = [];
  for (let tick = 0; tick < ticks; tick += 1) {
    const started = performance.now();
    update(16, (elapsedTicks + tick + 1) * 16);
    samples.push(performance.now() - started);
  }
  return samples;
}

const BENCHMARK_PACK: DataPack = {
  id: "animator.benchmark",
  version: "1.0.0",
  entries: [
    {
      type: "asset.definition",
      id: "asset.benchmark",
      data: {
        id: "asset.benchmark",
        type: "spritesheet",
        source: { type: "url", url: "/benchmark.png" },
        frame: { width: 32, height: 32 }
      }
    },
    clip("clip.idle", 1_000, true),
    clip("clip.run", 800, true),
    clip("clip.action", 1_000, true),
    {
      type: "animator.graph",
      id: "graph.benchmark",
      data: {
        id: "graph.benchmark",
        parameters: [{ id: "moving", type: "boolean", default: false }],
        layers: [
          {
            id: "base",
            initialState: "idle",
            states: [
              { id: "idle", clip: "idle", loop: true },
              { id: "run", clip: "run", loop: true }
            ],
            transitions: [
              {
                from: "idle",
                to: "run",
                conditions: [{ parameter: "moving", operator: "truthy" }]
              },
              { from: "run", to: "idle", conditions: [{ parameter: "moving", operator: "falsy" }] }
            ]
          }
        ]
      }
    },
    {
      type: "animator.binding",
      id: "binding.benchmark",
      data: {
        id: "binding.benchmark",
        graph: { type: "animator.graph", id: "graph.benchmark" },
        clips: {
          idle: { type: "animation.clip", id: "clip.idle" },
          run: { type: "animation.clip", id: "clip.run" },
          action: { type: "animation.clip", id: "clip.action" }
        },
        phaseMappings: [
          {
            abilityId: "ability.benchmark",
            phase: "active",
            layer: "base",
            clip: "action",
            loop: true
          }
        ]
      }
    }
  ]
};

function clip(id: string, durationMs: number, loop: boolean): DataPack["entries"][number] {
  return {
    type: "animation.clip",
    id,
    data: {
      id,
      asset: { assetId: "asset.benchmark", type: "spritesheet" },
      durationMs,
      loop
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

main();
