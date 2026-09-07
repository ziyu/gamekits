import type { GameInstallContext } from "@gamekits/game-runtime";
import { createDataRegistry } from "@gamekits/data";
import { describe, expect, it } from "vitest";
import {
  createNavigationAgentProfileDataType,
  createNavigationHandle,
  createNavigationLayoutDataType,
  createNavigationModule,
  createNavigationProgressTracker,
  createNavigationRuntime,
  validateNavigationContent,
  type NavigationAgentProfileDefinition,
  type NavigationPathRoute
} from "../src";
import { samplePathRoute } from "../src/routes/sample-path";
import { createMemoryNavigationBackend, runNavigationRuntimeConformance } from "../src/testing";

const profile: NavigationAgentProfileDefinition = {
  id: "profile.standard",
  radius: 0.5,
  allowedAreas: ["memory"]
};

describe("Navigation data", () => {
  it("validates agent profiles and typed layout sources", () => {
    const profileType = createNavigationAgentProfileDataType();
    const layoutType = createNavigationLayoutDataType();
    const invalidProfile = profileType.validate?.(
      document("navigation.agent-profile", "invalid", { id: "", radius: 0 }),
      context("navigation.agent-profile")
    );
    const invalidLayout = layoutType.validate?.(
      document("navigation.layout", "invalid", {
        id: "layout.invalid",
        backend: "",
        source: { type: "", id: "" },
        areas: [{ id: "ground" }, { id: "ground" }],
        portals: [
          {
            id: "portal",
            from: { point: { x: 0, y: 0 }, area: "ground" },
            to: { point: { x: 1, y: 0 }, area: "missing" }
          }
        ]
      }),
      context("navigation.layout")
    );
    expect(invalidProfile?.map((entry) => entry.code)).toEqual([
      "navigation.profile_missing_id",
      "navigation.profile_invalid_radius"
    ]);
    expect(invalidLayout?.map((entry) => entry.code)).toContain(
      "navigation.layout_missing_backend"
    );
    expect(invalidLayout?.map((entry) => entry.code)).toContain("navigation.layout_duplicate_area");
    expect(invalidLayout?.map((entry) => entry.code)).toContain(
      "navigation.layout_portal_unknown_area"
    );
  });
});

describe("Navigation runtime", () => {
  it("advances to the later segment when a point overshoots a shared corner", () => {
    const route: NavigationPathRoute = {
      kind: "path",
      routeId: "route.corner",
      points: [
        { x: 0, y: 0 },
        { x: 0.5, y: 0 },
        { x: 0.5, y: 0.5 }
      ],
      cost: 1,
      revision: 0,
      startProjection: {
        point: { x: 0, y: 0 },
        backendNodeId: "cell:start",
        distance: 0,
        revision: 0
      },
      goalProjection: {
        point: { x: 0.5, y: 0.5 },
        backendNodeId: "cell:goal",
        distance: 0,
        revision: 0
      }
    };

    const sample = samplePathRoute(route, { x: 0.54, y: 0 });
    expect(sample).toMatchObject({
      status: "valid",
      nextPoint: { x: 0.5, y: 0.5 },
      direction: { x: 0, y: 1 },
      remainingDistance: 0.5
    });
    if (sample.status === "valid") {
      expect(sample.distanceToRoute).toBeCloseTo(0.04);
    }
  });

  it("keeps portal traversals discontinuous while steering toward their entry", () => {
    const route: NavigationPathRoute = {
      kind: "path",
      routeId: "route.portal",
      points: [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 10, y: 0 },
        { x: 11, y: 0 }
      ],
      traversals: [
        {
          kind: "portal",
          portalId: "portal.test",
          fromPointIndex: 1,
          toPointIndex: 2,
          entryPoint: { x: 1, y: 0 },
          exitPoint: { x: 10, y: 0 }
        }
      ],
      cost: 3,
      revision: 0,
      startProjection: {
        point: { x: 0, y: 0 },
        backendNodeId: "node:start",
        distance: 0,
        revision: 0
      },
      goalProjection: {
        point: { x: 11, y: 0 },
        backendNodeId: "node:goal",
        distance: 0,
        revision: 0
      }
    };

    expect(samplePathRoute(route, { x: 0.8, y: 0 })).toMatchObject({
      status: "valid",
      nextPoint: { x: 1, y: 0 },
      traversal: {
        kind: "portal",
        portalId: "portal.test",
        entryPoint: { x: 1, y: 0 },
        exitPoint: { x: 10, y: 0 }
      }
    });
    expect(samplePathRoute(route, { x: 5, y: 0 })).toMatchObject({
      status: "valid",
      point: { x: 1, y: 0 },
      nextPoint: { x: 1, y: 0 },
      distanceToRoute: 4,
      traversal: { portalId: "portal.test" }
    });
    const afterTraversal = samplePathRoute(route, { x: 10.2, y: 0 });
    expect(afterTraversal).toMatchObject({
      status: "valid",
      nextPoint: { x: 11, y: 0 }
    });
    if (afterTraversal.status === "valid") {
      expect(afterTraversal.traversal).toBeUndefined();
    }
  });

  it("reports a stable error for unknown layout backends", () => {
    expect(() =>
      createNavigationRuntime({
        layout: {
          id: "layout.unknown",
          backend: "missing",
          source: { type: "navigation.fixture", id: "fixture" }
        },
        backendFactories: [],
        dataRegistry: createDataRegistry(),
        profiles: [profile]
      })
    ).toThrowError(expect.objectContaining({ code: "navigation.backend_factory_missing" }));
  });

  it("queues, completes, samples, caches, and invalidates routes", () => {
    let observerErrors = 0;
    const runtime = createNavigationRuntime({
      id: "navigation.test",
      backend: createMemoryNavigationBackend(),
      profiles: [profile],
      maxRequestsPerTick: 1,
      onTrace() {
        throw new Error("observer failed");
      },
      onTraceError() {
        observerErrors += 1;
      }
    });
    const requestId = runtime.requestPath({
      id: "path.first",
      requesterId: "agent.1",
      profileId: profile.id,
      start: { x: 0, y: 0 },
      goal: { x: 10, y: 0 },
      goalKey: "goal"
    });
    expect(runtime.poll(requestId).status).toBe("pending");
    runtime.update(16, 16);
    const completed = runtime.poll(requestId);
    expect(completed.status).toBe("complete");
    if (completed.status !== "complete") {
      throw new Error("Expected completed path");
    }
    expect(completed.cache).toBe("miss");
    expect(completed.route.cost).toBe(10);
    expect(observerErrors).toBeGreaterThan(0);
    expect(runtime.sampleRoute(completed.route.routeId, { x: 4, y: 2 })).toMatchObject({
      status: "valid",
      distanceToRoute: 2,
      remainingDistance: 6
    });

    const cachedId = runtime.requestPath({
      id: "path.cached",
      requesterId: "agent.2",
      profileId: profile.id,
      start: { x: 0, y: 0 },
      goal: { x: 10, y: 0 },
      goalKey: "goal"
    });
    runtime.update(16, 32);
    expect(runtime.poll(cachedId)).toMatchObject({ status: "complete", cache: "hit" });

    const changed = runtime.updateObstacle({
      id: "block.goal",
      target: { kind: "custom", id: "goal" },
      blocked: true
    });
    expect(changed.status).toBe("changed");
    expect(runtime.sampleRoute(completed.route.routeId, { x: 0, y: 0 }).status).toBe("stale");
    runtime.dispose();
    expect(runtime.snapshot()).toMatchObject({
      disposed: true,
      pendingRequests: 0,
      retainedResults: 0,
      retainedRoutes: 0,
      cacheEntries: 0,
      backend: { disposed: true }
    });
  });

  it("uses bounded negative cache and explicit cancellation", () => {
    const runtime = createNavigationRuntime({
      backend: createMemoryNavigationBackend({ blockedGoalKeys: ["blocked"] }),
      profiles: [profile],
      negativeCacheTtlMs: 1000
    });
    const first = runtime.requestPath(request("negative.first", "blocked"));
    const second = runtime.requestPath(request("negative.second", "blocked"));
    const cancelled = runtime.requestPath(request("cancelled", "open"));
    runtime.cancel(cancelled);
    runtime.update(16, 16);
    expect(runtime.poll(first)).toMatchObject({
      status: "failed",
      reason: "unreachable",
      cache: "miss"
    });
    expect(runtime.poll(second)).toMatchObject({
      status: "failed",
      reason: "unreachable",
      cache: "hit"
    });
    expect(runtime.poll(cancelled).status).toBe("cancelled");
    expect(runtime.snapshot().negativeCacheEntries).toBe(1);
    runtime.dispose();
  });

  it("partially invalidates memory backend goal dependencies", () => {
    const runtime = createNavigationRuntime({
      backend: createMemoryNavigationBackend(),
      profiles: [profile]
    });
    const leftId = runtime.requestPath(request("memory.left", "left"));
    const rightId = runtime.requestPath(request("memory.right", "right"));
    runtime.update(16, 16);
    const left = runtime.poll(leftId);
    const right = runtime.poll(rightId);
    expect(left.status).toBe("complete");
    expect(right.status).toBe("complete");
    if (left.status !== "complete" || right.status !== "complete") {
      throw new Error("Expected both memory routes to complete");
    }

    runtime.updateObstacle({
      id: "block.left",
      target: { kind: "custom", id: "left" },
      blocked: true
    });
    expect(runtime.sampleRoute(left.route.routeId, { x: 0, y: 0 }).status).toBe("stale");
    expect(runtime.sampleRoute(right.route.routeId, { x: 0, y: 0 })).toMatchObject({
      status: "valid",
      revision: 1
    });
    expect(runtime.snapshot().cacheEntries).toBe(1);
    runtime.dispose();
  });

  it("bounds positive cache entries", () => {
    const runtime = createNavigationRuntime({
      backend: createMemoryNavigationBackend(),
      profiles: [profile],
      maxCacheEntries: 2
    });
    for (let index = 0; index < 3; index += 1) {
      runtime.requestPath({
        id: `cache.${index}`,
        requesterId: "cache",
        profileId: profile.id,
        start: { x: index, y: 0 },
        goal: { x: index + 1, y: 0 },
        goalKey: `goal.${index}`
      });
    }
    runtime.update(16, 16);
    expect(runtime.snapshot().cacheEntries).toBe(2);
    runtime.dispose();
  });

  it("schedules requesters in stable round-robin order", () => {
    const runtime = createNavigationRuntime({
      backend: createMemoryNavigationBackend(),
      profiles: [profile],
      maxRequestsPerTick: 1
    });
    const a1 = runtime.requestPath({ ...request("a.1", "goal"), requesterId: "a" });
    const a2 = runtime.requestPath({ ...request("a.2", "goal"), requesterId: "a" });
    const b1 = runtime.requestPath({ ...request("b.1", "goal"), requesterId: "b" });
    runtime.update(16, 16);
    expect(runtime.poll(a1).status).toBe("complete");
    expect(runtime.poll(a2).status).toBe("pending");
    expect(runtime.poll(b1).status).toBe("pending");
    runtime.update(16, 32);
    expect(runtime.poll(b1).status).toBe("complete");
    expect(runtime.poll(a2).status).toBe("pending");
    runtime.update(16, 48);
    expect(runtime.poll(a2).status).toBe("complete");
    runtime.dispose();
  });

  it("binds handles through the GameModule lifecycle", () => {
    const handle = createNavigationHandle();
    const systems: Array<{ update(context: { delta: number; elapsed: number }): void }> = [];
    const module = createNavigationModule({
      backend: createMemoryNavigationBackend(),
      profiles: [profile],
      handle
    });
    const installed = module.install({
      systems: { register: (system) => systems.push(system) }
    } as unknown as GameInstallContext);
    expect(handle.isBound()).toBe(true);
    const id = handle.requestPath(request("module.path", "goal"));
    systems[0]?.update({ delta: 16, elapsed: 16 });
    expect(handle.poll(id).status).toBe("complete");
    if (typeof installed === "function") {
      installed();
    } else {
      installed?.dispose?.();
    }
    expect(handle.isBound()).toBe(false);
  });

  it("exposes a reusable memory conformance fixture", async () => {
    const runtime = createNavigationRuntime({
      backend: createMemoryNavigationBackend({ blockedGoalKeys: ["unreachable"] }),
      profiles: [profile]
    });
    const report = await runNavigationRuntimeConformance(() => ({
      runtime,
      profile,
      reachableStart: { x: 0, y: 0 },
      reachableGoal: { x: 2, y: 0 },
      unreachableGoal: { x: 8, y: 0 },
      blockReachableGoal: {
        id: "block.reachable",
        target: { kind: "custom", id: "reachable" },
        blocked: true
      },
      dispose: () => runtime.dispose()
    }));
    expect(report.firstRoutePoints).toBe(2);
    expect(report.checks).toContain("old route becomes explicitly stale");
  });

  it("keeps submitted work cancellable and retries stale backend results", () => {
    const backend = createMemoryNavigationBackend({ completionDelayTicks: 2 });
    const runtime = createNavigationRuntime({ backend, profiles: [profile] });
    const cancelledId = runtime.requestPath(request("deferred.cancel", "cancel"));
    runtime.update(16, 16);
    expect(runtime.poll(cancelledId)).toMatchObject({ status: "pending", phase: "submitted" });
    runtime.cancel(cancelledId);
    expect(runtime.poll(cancelledId).status).toBe("cancelled");
    expect(backend.snapshot().details?.retainedRequests).toBe(0);

    const staleId = runtime.requestPath(request("deferred.stale", "stale"));
    runtime.update(16, 32);
    runtime.updateObstacle({
      id: "unrelated",
      target: { kind: "custom", id: "other" },
      blocked: true
    });
    runtime.update(16, 48);
    runtime.update(16, 64);
    expect(runtime.poll(staleId).status).toBe("pending");
    runtime.update(16, 80);
    runtime.update(16, 96);
    runtime.update(16, 112);
    expect(runtime.poll(staleId).status).toBe("complete");
    expect(
      runtime.traces().some((entry) => entry.label === "navigation.backend_stale_result_retried")
    ).toBe(true);
    runtime.dispose();
  });

  it("represents shared fields without point arrays and releases retained routes", () => {
    const runtime = createNavigationRuntime({
      backend: createMemoryNavigationBackend({ maxRouteFields: 1 }),
      profiles: [profile]
    });
    const id = runtime.requestPath({ ...request("field", "shared"), routeKind: "field" });
    runtime.update(16, 16);
    const result = runtime.poll(id);
    expect(result.status).toBe("complete");
    if (result.status !== "complete") {
      throw new Error("Expected field route");
    }
    expect(result.route).toMatchObject({ kind: "field", goalKey: "shared" });
    expect("points" in result.route).toBe(false);
    expect(runtime.sampleRoute(result.route.routeId, { x: 1, y: 0 }).status).toBe("valid");

    const secondId = runtime.requestPath({
      ...request("field.second", "second"),
      goal: { x: 4, y: 0 },
      routeKind: "field"
    });
    runtime.update(16, 32);
    const second = runtime.poll(secondId);
    if (second.status !== "complete") {
      throw new Error("Expected second field route");
    }
    expect(runtime.snapshot().backend.details?.routeFields).toBe(2);
    expect(runtime.sampleRoute(result.route.routeId, { x: 1, y: 0 }).status).toBe("valid");
    runtime.releaseRoute(result.route.routeId);
    expect(runtime.sampleRoute(result.route.routeId, { x: 1, y: 0 }).status).toBe("missing");
    expect(runtime.snapshot().backend.details?.routeFields).toBe(1);
    expect(runtime.sampleRoute(second.route.routeId, { x: 3, y: 0 }).status).toBe("valid");
    runtime.releaseRoute(second.route.routeId);
    runtime.dispose();
  });

  it("provides stable progress and asynchronous content validation read models", async () => {
    const runtime = createNavigationRuntime({
      backend: createMemoryNavigationBackend({ completionDelayTicks: 1 }),
      profiles: [profile]
    });
    const id = runtime.requestPath(request("progress", "goal"));
    runtime.update(16, 16);
    runtime.update(16, 32);
    const result = runtime.poll(id);
    if (result.status !== "complete") {
      throw new Error("Expected route for progress tracking");
    }
    const progress = createNavigationProgressTracker(runtime);
    expect(
      progress.update({
        agentId: "agent",
        routeId: result.route.routeId,
        position: { x: 0, y: 0 },
        elapsedMs: 0
      }).status
    ).toBe("moving");
    expect(
      progress.update({
        agentId: "agent",
        routeId: result.route.routeId,
        position: { x: 0, y: 0 },
        elapsedMs: 1000
      }).status
    ).toBe("stuck");
    const diagnostics = await validateNavigationContent({
      runtime,
      projections: [{ id: "far", profileId: profile.id, point: { x: 0, y: 0 }, maxDistance: 0 }],
      requiredPaths: [
        {
          id: "reachable",
          profileId: profile.id,
          start: { x: 0, y: 0 },
          goal: { x: 2, y: 0 }
        }
      ]
    });
    expect(diagnostics).toEqual([]);
    runtime.dispose();
  });

  it("rejects conflicting ids without replacing the original request", () => {
    const runtime = createNavigationRuntime({
      backend: createMemoryNavigationBackend(),
      profiles: [profile]
    });
    const original = runtime.requestPath(request("same", "one"));
    const conflict = runtime.requestPath({ ...request("same", "two"), goal: { x: 3, y: 0 } });
    expect(conflict).not.toBe(original);
    expect(runtime.poll(conflict)).toMatchObject({
      status: "rejected",
      reason: "duplicate-request-conflict"
    });
    expect(runtime.poll(original).status).toBe("pending");
    runtime.dispose();
  });
});

function request(id: string, goalKey: string) {
  return {
    id,
    requesterId: "agent",
    profileId: profile.id,
    start: { x: 0, y: 0 },
    goal: { x: 2, y: 0 },
    goalKey
  };
}

function document(type: string, id: string, data: unknown) {
  return { type, id, data, priority: 0, tags: [] };
}

function context(type: string) {
  return { type, pack: { id: "test", version: "1", entries: [] }, path: "test" };
}
