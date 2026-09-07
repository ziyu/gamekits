import { performance } from "node:perf_hooks";
import {
  createNavigationRuntime,
  type NavigationAgentProfileDefinition
} from "../packages/navigation-core/src";
import {
  createGridNavigationBackend,
  type NavigationGridDefinition
} from "../packages/navigation-grid/src";

const profile: NavigationAgentProfileDefinition = {
  id: "profile.grid-benchmark",
  radius: 0.5,
  allowedAreas: ["ground"]
};

function main(): void {
  const agents = 1000;
  const samplesPerAgent = 120;
  const runtime = createNavigationRuntime({
    backend: createGridNavigationBackend({ grid: createBenchmarkGrid(32, 32) }),
    profiles: [profile],
    maxRequestsPerTick: agents,
    maxPendingRequests: agents,
    maxPendingPerRequester: agents,
    maxRetainedResults: agents,
    maxRetainedRoutes: agents
  });
  const requestIds = Array.from({ length: agents }, (_, index) =>
    runtime.requestPath({
      id: `grid-benchmark.${index}`,
      requesterId: `agent.${index}`,
      profileId: profile.id,
      start: { x: index % 32, y: Math.floor((index % 1024) / 32) },
      goal: { x: 31, y: 31 },
      goalKey: "shared-goal",
      routeKind: "field"
    })
  );

  const requestStarted = performance.now();
  runtime.update(16, 16);
  const requestMilliseconds = performance.now() - requestStarted;
  const routeIds = requestIds.map((requestId) => {
    const result = runtime.poll(requestId);
    if (result.status !== "complete") {
      throw new Error(`Grid benchmark request did not complete: ${result.status}`);
    }
    return result.route.routeId;
  });

  let checksum = 0;
  const sampleStarted = performance.now();
  for (let sample = 0; sample < samplesPerAgent; sample += 1) {
    for (const routeId of routeIds) {
      const result = runtime.sampleRoute(routeId, {
        x: sample % 32,
        y: Math.floor((sample % 1024) / 32)
      });
      if (result.status === "valid") {
        checksum += result.nextPoint.x + result.nextPoint.y;
      }
    }
  }
  const sampleMilliseconds = performance.now() - sampleStarted;
  const beforeDispose = runtime.snapshot();
  runtime.dispose();
  const afterDispose = runtime.snapshot();

  console.log(
    JSON.stringify(
      {
        benchmark: "navigation-grid",
        package: "@gamekits/navigation-grid",
        methodology: {
          grid: "32x32 walkable raster",
          connectivity: 8,
          sharedGoal: true,
          agents,
          samplesPerAgent
        },
        results: {
          requestMilliseconds: round(requestMilliseconds),
          microsecondsPerSample: round((sampleMilliseconds * 1000) / (agents * samplesPerAgent)),
          retainedRouteFields: beforeDispose.backend.details?.routeFields,
          retainedAfterDispose:
            Number(afterDispose.backend.details?.walkableCells ?? 0) +
            Number(afterDispose.backend.details?.routeFields ?? 0),
          checksum
        }
      },
      null,
      2
    )
  );
}

function createBenchmarkGrid(width: number, height: number): NavigationGridDefinition {
  return {
    id: `grid.benchmark.${width}x${height}`,
    width,
    height,
    cellSize: 1,
    origin: { x: 0, y: 0 },
    connectivity: 8,
    cells: Array.from({ length: width * height }, (_, index) => ({
      column: index % width,
      row: Math.floor(index / width),
      area: "ground",
      clearance: 1
    }))
  };
}

function round(value: number): number {
  return Number(value.toFixed(4));
}

main();
