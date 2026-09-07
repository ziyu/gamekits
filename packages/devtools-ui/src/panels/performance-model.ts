import type { DevToolsProfilerSummary, DevToolsSnapshot } from "@gamekits/devtools";

export type PerformancePanelModel = {
  latestFrame: DevToolsSnapshot["profilerFrames"][number] | undefined;
  lifecycleSpans: DevToolsProfilerSummary[];
  lifecycleWarnings: DevToolsProfilerSummary[];
  liveHotSpots: DevToolsProfilerSummary[];
  liveSpans: DevToolsProfilerSummary[];
  liveWarnings: DevToolsProfilerSummary[];
  maxFrameTime: number;
  overBudgetSpans: DevToolsProfilerSummary[];
};

export function createPerformancePanelModel(snapshot: DevToolsSnapshot): PerformancePanelModel {
  const latestFrame = snapshot.profilerFrames.at(-1);
  const overBudgetSpans = snapshot.profiler.filter((sample) => sample.overBudget);
  const lifecycleSpans = snapshot.profiler
    .filter(isLifecycleSpan)
    .sort((left, right) => lifecycleOrder(left.name) - lifecycleOrder(right.name));
  const liveSpans = snapshot.profiler.filter((sample) => !isLifecycleSpan(sample));
  const liveHotSpots = [...liveSpans].sort(
    (left, right) => right.p95DurationMs - left.p95DurationMs
  );
  const lifecycleWarnings = overBudgetSpans.filter(isLifecycleSpan);
  const liveWarnings = overBudgetSpans.filter((sample) => !isLifecycleSpan(sample));
  const maxFrameTime = Math.max(20, ...snapshot.profilerFrames.map((frame) => frame.deltaMs));

  return {
    latestFrame,
    lifecycleSpans,
    lifecycleWarnings,
    liveHotSpots,
    liveSpans,
    liveWarnings,
    maxFrameTime,
    overBudgetSpans
  };
}

export function calculateFrameBarHeight(
  deltaMs: number | undefined,
  frames: Array<DevToolsSnapshot["profilerFrames"][number] | undefined>,
  maxFrameTime: number
): number {
  if (deltaMs === undefined) {
    return 8;
  }

  const frameTimes = frames.map((frame) => frame?.deltaMs).filter((value) => value !== undefined);
  const minFrameTime = Math.min(12, ...frameTimes);
  const maxObservedFrameTime = Math.max(20, maxFrameTime, ...frameTimes);
  const adaptiveRange = Math.max(4, maxObservedFrameTime - minFrameTime);
  const normalized = (deltaMs - minFrameTime) / adaptiveRange;
  return Math.max(10, Math.min(100, 18 + normalized * 82));
}

export function isLifecycleSpan(sample: DevToolsProfilerSummary): boolean {
  return /\.(boot|start|stop|dispose)$/.test(sample.name);
}

export function readLifecycleStage(name: string): string {
  return name.split(".").at(-1) ?? name;
}

function lifecycleOrder(name: string): number {
  const stage = readLifecycleStage(name);
  if (stage === "boot") {
    return 0;
  }
  if (stage === "start") {
    return 1;
  }
  if (stage === "stop") {
    return 2;
  }
  if (stage === "dispose") {
    return 3;
  }
  return 4;
}
