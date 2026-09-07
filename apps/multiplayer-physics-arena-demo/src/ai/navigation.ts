import {
  createNavigationRuntime,
  type NavigationQueries,
  type NavigationRequestResult,
  type NavigationRuntime
} from "@gamekits/navigation-core";
import {
  createRecastNavigationBackend,
  prepareRecastNavigationArtifact
} from "@gamekits/navigation-recast";

import type { CompiledArenaContent } from "../content/registry";

export const ARENA_BOT_NAVIGATION_PROFILE_ID = "arena.bot.navigation";

export type ArenaBotNavigationSnapshot = {
  activeStageIndex: number;
  stageChanges: number;
  artifacts: number;
  artifactBytes: number;
  polygonCount: number;
  pendingRequests: number;
  retainedRoutes: number;
  cacheEntries: number;
  traceEntries: number;
  disposed: boolean;
};

export type ArenaBotNavigationRuntime = {
  queries: NavigationQueries;
  activateStage(stageIndex: number): void;
  update(deltaMs: number, elapsedMs: number): void;
  snapshot(): ArenaBotNavigationSnapshot;
  dispose(): void;
};

export async function prepareArenaBotNavigationRuntime(
  content: Readonly<CompiledArenaContent>
): Promise<ArenaBotNavigationRuntime> {
  const prepared = await Promise.all(
    content.stages.map(async (stage, stageIndex) => {
      const navigation = stage.courseProjection.navigation;
      const artifact = await prepareRecastNavigationArtifact(navigation.source, navigation.layout);
      const backend = createRecastNavigationBackend({
        id: `arena.ai.recast.${stage.definition.id}`,
        source: navigation.source,
        layout: navigation.layout,
        artifact,
        maxRouteFields: 16
      });
      const runtime = createNavigationRuntime({
        id: `arena.ai.navigation.${stage.definition.id}`,
        backend,
        profiles: [
          {
            id: ARENA_BOT_NAVIGATION_PROFILE_ID,
            radius: stage.course.navigation.agentRadius,
            height: stage.course.navigation.agentHeight,
            maxSlope: (stage.course.navigation.maxSlopeDegrees * Math.PI) / 180,
            tags: ["arena", stage.definition.kind]
          }
        ],
        maxRequestsPerTick: 2,
        maxBackendPollsPerTick: 8,
        maxPendingRequests: 24,
        maxPendingPerRequester: 2,
        maxRetainedResults: 32,
        maxRetainedRoutes: 16,
        maxCacheEntries: 64,
        maxStaleRetries: 1,
        cacheTtlMs: 2_000,
        negativeCacheTtlMs: 400,
        pointQuantization: 0.2,
        traceLimit: 96
      });
      return {
        stageIndex,
        runtime,
        artifactBytes: artifact.data.byteLength,
        polygonCount: artifact.polygonCount
      };
    })
  );
  const runtimes = new Map(prepared.map((entry) => [entry.stageIndex, entry.runtime]));
  const requestStageById = new Map<string, number>();
  const routeStageById = new Map<string, number>();
  let activeStageIndex = 0;
  let stageChanges = 0;
  let disposed = false;

  const queries: NavigationQueries = {
    projectPoint(point, profileId) {
      return activeRuntime().projectPoint(point, profileId);
    },
    requestPath(request) {
      const requestId = activeRuntime().requestPath(request);
      requestStageById.set(requestId, activeStageIndex);
      return requestId;
    },
    poll(requestId) {
      const stageIndex = requestStageById.get(requestId);
      if (stageIndex === undefined) return missingRequest(requestId);
      const result = requireRuntime(stageIndex).poll(requestId);
      if (result.status === "complete") {
        routeStageById.set(result.route.routeId, stageIndex);
      }
      if (result.status !== "pending" && result.status !== "missing") {
        requestStageById.delete(requestId);
      }
      return result;
    },
    cancel(requestId) {
      const stageIndex = requestStageById.get(requestId);
      if (stageIndex === undefined) return;
      requireRuntime(stageIndex).cancel(requestId);
      requestStageById.delete(requestId);
    },
    sampleRoute(routeId, point) {
      const stageIndex = routeStageById.get(routeId);
      return (stageIndex === undefined ? activeRuntime() : requireRuntime(stageIndex)).sampleRoute(
        routeId,
        point
      );
    },
    releaseRoute(routeId) {
      const stageIndex = routeStageById.get(routeId);
      if (stageIndex === undefined) return;
      requireRuntime(stageIndex).releaseRoute(routeId);
      routeStageById.delete(routeId);
    },
    revision: () => activeRuntime().revision(),
    snapshot: () => activeRuntime().snapshot()
  };

  return {
    queries,
    activateStage(stageIndex) {
      assertActive();
      if (stageIndex === activeStageIndex) return;
      requireRuntime(stageIndex);
      clearRoutedState();
      activeStageIndex = stageIndex;
      stageChanges += 1;
    },
    update(deltaMs, elapsedMs) {
      if (disposed) return;
      activeRuntime().update(deltaMs, elapsedMs);
    },
    snapshot() {
      if (disposed) {
        return {
          activeStageIndex,
          stageChanges,
          artifacts: prepared.length,
          artifactBytes: prepared.reduce((total, entry) => total + entry.artifactBytes, 0),
          polygonCount: prepared.reduce((total, entry) => total + entry.polygonCount, 0),
          pendingRequests: 0,
          retainedRoutes: 0,
          cacheEntries: 0,
          traceEntries: 0,
          disposed: true
        };
      }
      const active = activeRuntime().snapshot();
      return {
        activeStageIndex,
        stageChanges,
        artifacts: prepared.length,
        artifactBytes: prepared.reduce((total, entry) => total + entry.artifactBytes, 0),
        polygonCount: prepared.reduce((total, entry) => total + entry.polygonCount, 0),
        pendingRequests: active.pendingRequests,
        retainedRoutes: active.retainedRoutes,
        cacheEntries: active.cacheEntries,
        traceEntries: active.traceEntries,
        disposed
      };
    },
    dispose() {
      if (disposed) return;
      clearRoutedState();
      for (const runtime of runtimes.values()) runtime.dispose();
      runtimes.clear();
      disposed = true;
    }
  };

  function activeRuntime(): NavigationRuntime {
    return requireRuntime(activeStageIndex);
  }

  function requireRuntime(stageIndex: number): NavigationRuntime {
    const runtime = runtimes.get(stageIndex);
    if (runtime === undefined)
      throw new Error(`Arena AI navigation stage is missing: ${stageIndex}`);
    return runtime;
  }

  function clearRoutedState(): void {
    for (const [requestId, stageIndex] of requestStageById) {
      requireRuntime(stageIndex).cancel(requestId);
    }
    for (const [routeId, stageIndex] of routeStageById) {
      requireRuntime(stageIndex).releaseRoute(routeId);
    }
    requestStageById.clear();
    routeStageById.clear();
  }

  function assertActive(): void {
    if (disposed) throw new Error("Arena bot navigation runtime is disposed");
  }
}

function missingRequest(requestId: string): NavigationRequestResult {
  return { status: "missing", requestId };
}
