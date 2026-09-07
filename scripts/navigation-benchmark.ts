import { performance } from "node:perf_hooks";
import {
  createNavigationRuntime,
  type NavigationAgentProfileDefinition
} from "../packages/navigation-core/src";
import {
  createGraphNavigationBackend,
  type NavigationGraphDefinition
} from "../packages/navigation-graph/src";
import {
  checkNavigationBenchmarkBudgets,
  navigationBenchmarkBudgetCount,
  type NavigationBenchmarkCase,
  type NavigationBenchmarkSuite
} from "./navigation-benchmark-budget";

const profile: NavigationAgentProfileDefinition = {
  id: "profile.benchmark",
  radius: 0.5,
  allowedAreas: ["ground"]
};

function main(): void {
  const suites: NavigationBenchmarkSuite[] = [
    {
      suite: "navigation-route-sampling",
      cases: [runRouteSampling(250), runRouteSampling(1000)]
    },
    { suite: "navigation-request-burst", cases: [runRequestBurst()] },
    { suite: "navigation-blocker-churn", cases: [runBlockerChurn()] }
  ];
  const checkEnabled = process.argv.includes("--check");
  const failures = checkEnabled ? checkNavigationBenchmarkBudgets(suites) : [];
  console.log(
    JSON.stringify(
      {
        benchmark: "navigation",
        packages: ["@gamekits/navigation-core", "@gamekits/navigation-graph"],
        methodology: {
          graph: "32x32 authored grid",
          sharedGoal: true,
          reports: ["request burst", "route sample", "blocker churn", "retained state"]
        },
        suites,
        ...(checkEnabled
          ? {
              budgetCheck: {
                budgets: navigationBenchmarkBudgetCount(),
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

function runRouteSampling(agents: number): NavigationBenchmarkCase {
  const samplesPerAgent = 120;
  const runtime = createNavigationRuntime({
    backend: createGraphNavigationBackend({ graph: gridGraph(32, 32) }),
    profiles: [profile],
    maxRequestsPerTick: agents,
    maxPendingRequests: agents,
    maxPendingPerRequester: agents,
    maxRetainedResults: agents,
    maxRetainedRoutes: agents
  });
  const requestIds = Array.from({ length: agents }, (_, index) => {
    const start = index % 1023;
    return runtime.requestPath({
      id: `sample.${index}`,
      requesterId: `agent.${index}`,
      profileId: profile.id,
      start: { x: start % 32, y: Math.floor(start / 32) },
      goal: { x: 31, y: 31 },
      goalKey: "shared-goal",
      routeKind: "field"
    });
  });
  runtime.update(16, 16);
  const routes = requestIds.map((requestId) => {
    const result = runtime.poll(requestId);
    if (result.status !== "complete") {
      throw new Error("Navigation benchmark route did not complete");
    }
    return result.route.routeId;
  });
  let checksum = 0;
  for (const routeId of routes) {
    runtime.sampleRoute(routeId, { x: 0.25, y: 0.25 });
  }
  const started = performance.now();
  for (let sample = 0; sample < samplesPerAgent; sample += 1) {
    for (const routeId of routes) {
      const result = runtime.sampleRoute(routeId, {
        x: (sample % 32) + 0.25,
        y: Math.floor((sample % 1024) / 32) + 0.25
      });
      if (result.status === "valid") {
        checksum += result.nextPoint.x + result.nextPoint.y;
      }
    }
  }
  const duration = performance.now() - started;
  const retainedRouteFields = Number(runtime.snapshot().backend.details?.routeFields ?? -1);
  runtime.dispose();
  return {
    agents,
    samplesPerAgent,
    microsecondsPerSample: round((duration * 1000) / (agents * samplesPerAgent)),
    retainedRouteFields,
    checksum
  };
}

function runRequestBurst(): NavigationBenchmarkCase {
  const requests = 1000;
  const runtime = createNavigationRuntime({
    backend: createGraphNavigationBackend({ graph: gridGraph(32, 32) }),
    profiles: [profile],
    maxRequestsPerTick: requests,
    maxPendingRequests: requests,
    maxPendingPerRequester: requests,
    maxRetainedResults: requests,
    maxRetainedRoutes: requests
  });
  for (let index = 0; index < requests; index += 1) {
    runtime.requestPath({
      id: `burst.${index}`,
      requesterId: `agent.${index}`,
      profileId: profile.id,
      start: { x: index % 32, y: Math.floor((index % 1024) / 32) },
      goal: { x: 31, y: 31 },
      goalKey: "shared-goal",
      routeKind: "field"
    });
  }
  const started = performance.now();
  runtime.update(16, 16);
  const milliseconds = performance.now() - started;
  const pendingAfterUpdate = runtime.snapshot().pendingRequests;
  runtime.dispose();
  return { requests, milliseconds: round(milliseconds), pendingAfterUpdate };
}

function runBlockerChurn(): NavigationBenchmarkCase {
  const cycles = 200;
  const backend = createGraphNavigationBackend({ graph: gridGraph(32, 32) });
  const started = performance.now();
  for (let cycle = 0; cycle < cycles; cycle += 1) {
    const requestId = `churn.${cycle}`;
    backend.submitPath({
      requestId,
      profile,
      start: { x: 0, y: 0 },
      goal: { x: 31, y: 31 },
      goalKey: "churn-goal",
      routeKind: "field"
    });
    const result = backend.pollPath(requestId);
    if (result.status === "pending" || result.status === "missing") {
      throw new Error(`Navigation blocker benchmark received ${result.status}`);
    }
    backend.releasePath(requestId);
    backend.updateObstacle?.({
      id: `block.${cycle}`,
      target: { kind: "edge", id: `edge.horizontal.${cycle % 31}.0` },
      blocked: true
    });
    backend.updateObstacle?.({
      id: `unblock.${cycle}`,
      target: { kind: "edge", id: `edge.horizontal.${cycle % 31}.0` },
      blocked: false
    });
  }
  const duration = performance.now() - started;
  backend.dispose();
  const snapshot = backend.snapshot();
  return {
    cycles,
    microsecondsPerCycle: round((duration * 1000) / cycles),
    retainedAfterDispose:
      Number(snapshot.details?.nodes ?? 0) +
      Number(snapshot.details?.connections ?? 0) +
      Number(snapshot.details?.routeFields ?? 0)
  };
}

function gridGraph(width: number, height: number): NavigationGraphDefinition {
  const nodes = [];
  const edges = [];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      nodes.push({ id: `node.${x}.${y}`, point: { x, y }, area: "ground" });
      if (x + 1 < width) {
        edges.push({
          id: `edge.horizontal.${x}.${y}`,
          from: `node.${x}.${y}`,
          to: `node.${x + 1}.${y}`,
          area: "ground"
        });
      }
      if (y + 1 < height) {
        edges.push({
          id: `edge.vertical.${x}.${y}`,
          from: `node.${x}.${y}`,
          to: `node.${x}.${y + 1}`,
          area: "ground"
        });
      }
    }
  }
  return { id: `grid.${width}x${height}`, nodes, edges };
}

function round(value: number): number {
  return Number(value.toFixed(4));
}

main();
