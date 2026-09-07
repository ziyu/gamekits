import { performance } from "node:perf_hooks";
import { createGameplayDevToolsCorrelation } from "../packages/app-host/src";
import { createDevToolsRuntime } from "../packages/devtools/src";
import {
  checkDiagnosticsBudgets,
  diagnosticsBudgetCount,
  type DiagnosticsBenchmarkResult
} from "./diagnostics-benchmark-budget";

const TRACE_COUNT = 50_000;
const SNAPSHOT_COUNT = 500;
const TRACE_LIMIT = 512;
const CORRELATION_LIMIT = 64;
const DOMAIN_TRACE_LIMIT = 64;

function main(): void {
  let now = 0;
  const runtime = createDevToolsRuntime({ traceLimit: TRACE_LIMIT, clock: () => now++ });
  const correlation = createGameplayDevToolsCorrelation({
    devtools: runtime,
    correlationLimit: CORRELATION_LIMIT,
    rootLimitPerCorrelation: 4,
    tcaTraceLimit: DOMAIN_TRACE_LIMIT,
    gasTraceLimit: DOMAIN_TRACE_LIMIT,
    physicsTraceLimit: DOMAIN_TRACE_LIMIT,
    combatTraceLimit: DOMAIN_TRACE_LIMIT
  });

  for (let index = 0; index < 1_000; index += 1) {
    pushTrace(correlation, index);
  }
  runtime.clear({ traces: true });
  correlation.source.clear();

  const ingestStartedAt = performance.now();
  for (let index = 0; index < TRACE_COUNT; index += 1) {
    pushTrace(correlation, index);
  }
  const ingestMs = performance.now() - ingestStartedAt;

  let checksum = 0;
  const snapshotStartedAt = performance.now();
  for (let index = 0; index < SNAPSHOT_COUNT; index += 1) {
    const snapshot = runtime.snapshot({ includeSourceSnapshots: true });
    checksum += snapshot.traces.length + (snapshot.sourceSnapshots?.length ?? 0);
  }
  const snapshotMs = performance.now() - snapshotStartedAt;
  const sourceSnapshot = correlation.source.snapshot();
  const runtimeSnapshot = runtime.snapshot();
  const result: DiagnosticsBenchmarkResult = {
    traces: TRACE_COUNT,
    runtimeSnapshots: SNAPSHOT_COUNT,
    microsecondsPerTrace: round((ingestMs * 1_000) / TRACE_COUNT),
    millisecondsPerRuntimeSnapshot: round(snapshotMs / SNAPSHOT_COUNT),
    retainedTraces: runtimeSnapshot.traces.length,
    retainedCorrelations: sourceSnapshot.retainedCorrelationCount,
    retainedDomainTraces:
      correlation.tcaTraceStore.list().length +
      correlation.gasTraceStore.list().length +
      correlation.physicsTraceStore.list().length +
      correlation.combatTraceStore.list().length
  };
  const checkEnabled = process.argv.includes("--check");
  const failures = checkEnabled ? checkDiagnosticsBudgets(result) : [];

  console.log(
    JSON.stringify(
      {
        benchmark: "gameplay-trace-bridge",
        packages: [
          "@gamekits/app-host",
          "@gamekits/devtools",
          "@gamekits/tca",
          "@gamekits/gas",
          "@gamekits/physics-core",
          "@gamekits/combat",
          "@gamekits/navigation-core",
          "@gamekits/ai-core",
          "@gamekits/animator-core",
          "@gamekits/audio-core"
        ],
        profile: {
          traceLimit: TRACE_LIMIT,
          correlationLimit: CORRELATION_LIMIT,
          domainTraceLimit: DOMAIN_TRACE_LIMIT,
          checksum
        },
        result,
        ...(checkEnabled
          ? {
              budgetCheck: {
                budgets: diagnosticsBudgetCount(),
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
  correlation.dispose();
}

function pushTrace(
  correlation: ReturnType<typeof createGameplayDevToolsCorrelation>,
  index: number
): void {
  const chainIndex = index % 256;
  const correlationId = `combat-${chainIndex}`;
  const step = index % 8;
  if (step === 0) {
    correlation.physicsTraceStore.push({
      kind: "step",
      label: "physics.step",
      tick: index,
      correlationId
    });
    return;
  }
  if (step === 1) {
    correlation.gasTraceStore.add({
      type: "ability.activated",
      timestamp: index,
      actorId: "benchmark.actor",
      abilityId: "benchmark.ability",
      correlationId,
      parentId: `physics-trace-${index}`
    });
    return;
  }
  if (step === 2) {
    correlation.combatTraceStore.add({
      type: "delivery.accepted",
      timestamp: index,
      requestId: correlationId,
      correlationId,
      parentId: `gas-trace-${index}`
    });
    return;
  }
  if (step === 3) {
    correlation.observeNavigationTrace({
      sequence: index,
      kind: "result",
      label: "navigation.path_completed",
      timestamp: index,
      revision: index,
      requestId: correlationId,
      payload: { cache: "miss" }
    });
    return;
  }
  if (step === 4) {
    correlation.observeAiTrace({
      sequence: index,
      kind: "goal",
      label: "ai.goal_selected",
      timestamp: index,
      agentId: `agent-${chainIndex}`,
      payload: { goalId: "goal.attack" }
    });
    return;
  }
  if (step === 5) {
    correlation.observeAnimatorTrace({
      sequence: index,
      kind: "phase",
      label: "animator.phase_synced",
      timestamp: index,
      controllerId: `controller-${chainIndex}`,
      payload: { executionId: correlationId, phase: "active" }
    });
    return;
  }
  if (step === 6) {
    correlation.observeAudioDiagnostic({
      sequence: index,
      type: "audio.voice_started",
      timestamp: index,
      payload: { instanceId: correlationId, eventId: "event.attack" }
    });
    return;
  }
  correlation.tcaTraceStore.add({
    ruleId: "benchmark.rule",
    eventType: "benchmark.event",
    timestamp: index,
    correlationId,
    parentId: `gas-trace-${index}`,
    status: "passed",
    conditions: [],
    actions: []
  });
}

function round(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

main();
