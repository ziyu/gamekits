import type { AiRuntimeSnapshot } from "@gamekits/ai-core";
import type { AiLabStressSnapshot, AiLabStressStatus } from "./types";

export const AI_LAB_STRESS_MAX_OPTIONS = [128, 256, 512, 1024, 2048, 4096] as const;

const DEFAULT_MAX_ANIMALS = 1024;
const MIN_WARMUP_DURATION_MS = 800;
const MAX_WARMUP_DURATION_MS = 5_000;
const BACKLOG_QUIET_DURATION_MS = 250;
const SETTLED_PENDING_REQUEST_RATIO = 0.02;
const MIN_SETTLED_PENDING_REQUESTS = 4;
const SAMPLE_DURATION_MS = 1_600;
const MIN_SAMPLE_FRAMES = 30;
const FRAME_P95_BUDGET_MS = 36;
const SIMULATION_P95_BUDGET_MS = 28;
const MIN_AVERAGE_FPS = 30;

export type AiLabStressSample = {
  frameMs: number;
  simulationMs: number;
  runtime(): Pick<
    AiRuntimeSnapshot,
    "delayedDecisions" | "delayedSensorSamples" | "rejectedPathRequests"
  >;
  navigation: {
    pendingRequests: number;
  };
};

export type AiLabStressTest = {
  isRunning(): boolean;
  configureMaxAnimals(value: number): void;
  start(): void;
  stop(): void;
  sample(value: AiLabStressSample): void;
  snapshot(activeAnimals: number, renderedAnimals: number): AiLabStressSnapshot;
  dispose(): void;
};

export function createAiLabStressTest(options: {
  baseAnimals: number;
  resizePopulation(totalAnimals: number): void;
  onStatus?(message: string): void;
}): AiLabStressTest {
  let status: AiLabStressStatus = "idle";
  let configuredMaxAnimals = DEFAULT_MAX_ANIMALS;
  let testingAnimals = options.baseAnimals;
  let lastTestedAnimals = options.baseAnimals;
  let stableAnimals = options.baseAnimals;
  let phaseElapsedMs = 0;
  let backlogQuietMs = 0;
  let coldStartMs = 0;
  let pendingNavigationRequests = 0;
  let backlogSettled = false;
  let warmupTimedOut = false;
  let frameSamples: number[] = [];
  let simulationSamples: number[] = [];
  let countersAtSampleStart = zeroCounters();
  let delayedDecisionsPerSecond = 0;
  let delayedSensorSamplesPerSecond = 0;
  let rejectedPathRequests = 0;
  let withinBudget: boolean | undefined;
  let reachedConfiguredLimit = false;
  let failureReason: string | undefined;

  return {
    isRunning() {
      return isActive(status);
    },
    configureMaxAnimals(value) {
      if (isActive(status)) {
        return;
      }
      configuredMaxAnimals = clampMaxAnimals(value, options.baseAnimals);
    },
    start() {
      if (isActive(status)) {
        return;
      }
      stableAnimals = options.baseAnimals;
      lastTestedAnimals = options.baseAnimals;
      withinBudget = undefined;
      reachedConfiguredLimit = false;
      failureReason = undefined;
      beginLevel(nextPopulation(options.baseAnimals, configuredMaxAnimals));
    },
    stop() {
      if (!isActive(status)) {
        return;
      }
      status = "stopped";
      failureReason = "已手动停止";
      options.resizePopulation(options.baseAnimals);
      options.onStatus?.(`压力测试已停止，林地恢复为 ${options.baseAnimals} 只常驻动物。`);
    },
    sample(value) {
      if (!isActive(status) || value.frameMs <= 0) {
        return;
      }
      phaseElapsedMs += value.frameMs;
      if (status === "warming") {
        pendingNavigationRequests = value.navigation.pendingRequests;
        const navigationBacklogSettled =
          pendingNavigationRequests <= settledPendingRequestThreshold(testingAnimals);
        if (navigationBacklogSettled) {
          backlogQuietMs += value.frameMs;
        } else {
          backlogQuietMs = 0;
        }
        const minimumWarmupComplete = phaseElapsedMs >= MIN_WARMUP_DURATION_MS;
        if (minimumWarmupComplete && backlogQuietMs >= BACKLOG_QUIET_DURATION_MS) {
          beginSampling(value.runtime(), true);
        } else if (phaseElapsedMs >= MAX_WARMUP_DURATION_MS) {
          beginSampling(value.runtime(), false);
        }
        return;
      }

      frameSamples.push(value.frameMs);
      simulationSamples.push(Math.max(0, value.simulationMs));
      if (phaseElapsedMs < SAMPLE_DURATION_MS || frameSamples.length < MIN_SAMPLE_FRAMES) {
        return;
      }

      lastTestedAnimals = testingAnimals;
      const runtime = value.runtime();
      const seconds = Math.max(phaseElapsedMs / 1_000, 0.001);
      delayedDecisionsPerSecond =
        Math.max(0, runtime.delayedDecisions - countersAtSampleStart.delayedDecisions) / seconds;
      delayedSensorSamplesPerSecond =
        Math.max(0, runtime.delayedSensorSamples - countersAtSampleStart.delayedSensorSamples) /
        seconds;
      rejectedPathRequests = Math.max(
        0,
        runtime.rejectedPathRequests - countersAtSampleStart.rejectedPathRequests
      );
      const frameP95 = percentile(frameSamples, 0.95);
      const simulationP95 = percentile(simulationSamples, 0.95);
      const fps = averageFps(frameSamples);
      withinBudget =
        backlogSettled &&
        frameP95 <= FRAME_P95_BUDGET_MS &&
        simulationP95 <= SIMULATION_P95_BUDGET_MS &&
        fps >= MIN_AVERAGE_FPS &&
        delayedDecisionsPerSecond <= testingAnimals * 2 &&
        delayedSensorSamplesPerSecond <= testingAnimals * 2 &&
        rejectedPathRequests === 0;

      if (!withinBudget) {
        failureReason = stressFailureReason({
          frameP95,
          simulationP95,
          fps,
          testingAnimals,
          backlogSettled,
          delayedDecisionsPerSecond,
          delayedSensorSamplesPerSecond,
          rejectedPathRequests
        });
        finish(false);
        return;
      }

      stableAnimals = testingAnimals;
      if (testingAnimals >= configuredMaxAnimals) {
        reachedConfiguredLimit = true;
        finish(true);
        return;
      }
      beginLevel(nextPopulation(testingAnimals, configuredMaxAnimals));
    },
    snapshot(activeAnimals, renderedAnimals) {
      return {
        status,
        configuredMaxAnimals,
        activeAnimals,
        testingAnimals,
        lastTestedAnimals,
        stableAnimals,
        renderedAnimals,
        coldStartMs,
        pendingNavigationRequests,
        backlogSettled,
        warmupTimedOut,
        phaseProgress: phaseProgress(status, phaseElapsedMs),
        sampleFrames: frameSamples.length,
        averageFps: averageFps(frameSamples),
        averageFrameMs: average(frameSamples),
        p95FrameMs: percentile(frameSamples, 0.95),
        peakFrameMs: maximum(frameSamples),
        averageSimulationMs: average(simulationSamples),
        p95SimulationMs: percentile(simulationSamples, 0.95),
        peakSimulationMs: maximum(simulationSamples),
        delayedDecisionsPerSecond,
        delayedSensorSamplesPerSecond,
        rejectedPathRequests,
        withinBudget,
        reachedConfiguredLimit,
        failureReason
      };
    },
    dispose() {
      options.resizePopulation(options.baseAnimals);
      status = "idle";
    }
  };

  function beginLevel(totalAnimals: number): void {
    testingAnimals = totalAnimals;
    status = "warming";
    phaseElapsedMs = 0;
    backlogQuietMs = 0;
    coldStartMs = 0;
    pendingNavigationRequests = 0;
    backlogSettled = false;
    warmupTimedOut = false;
    frameSamples = [];
    simulationSamples = [];
    delayedDecisionsPerSecond = 0;
    delayedSensorSamplesPerSecond = 0;
    rejectedPathRequests = 0;
    withinBudget = undefined;
    options.resizePopulation(totalAnimals);
    options.onStatus?.(`正在用 ${totalAnimals.toLocaleString()} 只真实 AI 动物预热。`);
  }

  function beginSampling(
    runtime: ReturnType<AiLabStressSample["runtime"]>,
    settled: boolean
  ): void {
    coldStartMs = phaseElapsedMs;
    backlogSettled = settled;
    warmupTimedOut = !settled;
    status = "sampling";
    phaseElapsedMs = 0;
    frameSamples = [];
    simulationSamples = [];
    countersAtSampleStart = runtimeCounters(runtime);
  }

  function finish(passed: boolean): void {
    status = "complete";
    options.resizePopulation(options.baseAnimals);
    options.onStatus?.(
      passed
        ? `已稳定跑到所选上限 ${stableAnimals.toLocaleString()} 只；可以提高上限继续测试。`
        : `${lastTestedAnimals.toLocaleString()} 只未通过实时预算，当前稳定上限为 ${stableAnimals.toLocaleString()} 只。`
    );
  }
}

function isActive(status: AiLabStressStatus): boolean {
  return status === "warming" || status === "sampling";
}

function clampMaxAnimals(value: number, baseAnimals: number): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_MAX_ANIMALS;
  }
  return Math.max(baseAnimals, Math.min(4096, Math.round(value)));
}

function nextPopulation(current: number, maximum: number): number {
  return Math.min(maximum, Math.max(current + 16, current * 2));
}

function settledPendingRequestThreshold(totalAnimals: number): number {
  return Math.max(
    MIN_SETTLED_PENDING_REQUESTS,
    Math.ceil(totalAnimals * SETTLED_PENDING_REQUEST_RATIO)
  );
}

function phaseProgress(status: AiLabStressStatus, elapsedMs: number): number {
  if (status === "warming") {
    return Math.min(0.9, elapsedMs / MAX_WARMUP_DURATION_MS);
  }
  if (status === "sampling") {
    return clamp01(elapsedMs / SAMPLE_DURATION_MS);
  }
  return status === "complete" ? 1 : 0;
}

function average(values: readonly number[]): number {
  if (values.length === 0) {
    return 0;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function averageFps(frameSamples: readonly number[]): number {
  const averageFrameMs = average(frameSamples);
  return averageFrameMs <= 0 ? 0 : 1_000 / averageFrameMs;
}

function maximum(values: readonly number[]): number {
  return values.length === 0 ? 0 : Math.max(...values);
}

function percentile(values: readonly number[], quantile: number): number {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * quantile) - 1);
  return sorted[Math.max(0, index)] ?? 0;
}

function runtimeCounters(runtime: ReturnType<AiLabStressSample["runtime"]>) {
  return {
    delayedDecisions: runtime.delayedDecisions,
    delayedSensorSamples: runtime.delayedSensorSamples,
    rejectedPathRequests: runtime.rejectedPathRequests
  };
}

function zeroCounters() {
  return {
    delayedDecisions: 0,
    delayedSensorSamples: 0,
    rejectedPathRequests: 0
  };
}

function stressFailureReason(options: {
  frameP95: number;
  simulationP95: number;
  fps: number;
  testingAnimals: number;
  backlogSettled: boolean;
  delayedDecisionsPerSecond: number;
  delayedSensorSamplesPerSecond: number;
  rejectedPathRequests: number;
}): string {
  if (!options.backlogSettled) {
    return `导航启动积压在 ${MAX_WARMUP_DURATION_MS / 1_000} 秒内未收敛`;
  }
  if (options.simulationP95 > SIMULATION_P95_BUDGET_MS) {
    return `模拟 p95 ${options.simulationP95.toFixed(1)}ms 超过 ${SIMULATION_P95_BUDGET_MS}ms 预算`;
  }
  if (options.frameP95 > FRAME_P95_BUDGET_MS) {
    return `帧间隔 p95 ${options.frameP95.toFixed(1)}ms 超过 ${FRAME_P95_BUDGET_MS}ms 预算`;
  }
  if (options.fps < MIN_AVERAGE_FPS) {
    return `平均帧率 ${options.fps.toFixed(0)} FPS 低于 ${MIN_AVERAGE_FPS} FPS`;
  }
  if (options.rejectedPathRequests > 0) {
    return `稳态仍有 ${options.rejectedPathRequests} 次路径请求被拒绝`;
  }
  if (options.delayedDecisionsPerSecond > options.testingAnimals * 2) {
    return `决策延后 ${options.delayedDecisionsPerSecond.toFixed(0)}/s，单位已无法按 LOD 频率更新`;
  }
  return `感知延后 ${options.delayedSensorSamplesPerSecond.toFixed(0)}/s，单位已无法按 LOD 频率更新`;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}
