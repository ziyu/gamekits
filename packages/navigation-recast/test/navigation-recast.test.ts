import type {
  NavigationAgentProfileDefinition,
  NavigationLayoutDefinition
} from "@gamekits/navigation-core";
import { createNavigationRuntime } from "@gamekits/navigation-core";
import type {
  NavigationBackendPathRequest,
  NavigationBackendPathStatus
} from "@gamekits/navigation-core/backend";
import { runNavigationRuntimeConformance } from "@gamekits/navigation-core/testing";
import type { NavigationNavMeshSource } from "@gamekits/navigation-navmesh";
import { beforeAll, describe, expect, it } from "vitest";
import {
  createRecastNavigationBackend,
  initializeRecastNavigation,
  prepareRecastNavigationArtifact
} from "../src";

const PROFILE = {
  id: "test-agent",
  radius: 0.2,
  height: 1.8,
  maxSlope: 0.5
};

describe("Recast navigation backend", () => {
  beforeAll(async () => {
    await initializeRecastNavigation();
  });

  it("bakes real NavMesh polygons and computes a path around missing terrain", async () => {
    const source = createLShapedSource();
    const artifact = await prepareRecastNavigationArtifact(source);
    const backend = createRecastNavigationBackend({ source, artifact });

    expect(artifact.polygonCount).toBeGreaterThan(0);
    expect(artifact.debugMesh.indices.length).toBeGreaterThan(0);
    expect(backend.capabilities.routeFields).toBe(true);

    backend.submitPath(request("path", { x: 0.5, y: 0.5 }, { x: 3.5, y: 3.5 }));
    const result = backend.pollPath("request-path");

    expect(result.status).toBe("complete");
    if (result.status === "complete" && result.route.kind === "path") {
      expect(result.route.points.length).toBeGreaterThanOrEqual(3);
      expect(result.cost).toBeGreaterThan(Math.hypot(3, 3));
    }
    backend.dispose();
  });

  it("projects points, enforces max cost, and samples retained route fields", async () => {
    const source = createLShapedSource();
    const artifact = await prepareRecastNavigationArtifact(source);
    const backend = createRecastNavigationBackend({ source, artifact });

    const projection = backend.projectPoint({ x: 3.5, y: 0.5 }, PROFILE);
    expect(projection).toBeDefined();
    expect(projection?.point.y).toBeCloseTo(0.5, 1);

    backend.submitPath(request("limited", { x: 0.5, y: 0.5 }, { x: 3.5, y: 3.5 }, "path", 1));
    expect(backend.pollPath("request-limited")).toMatchObject({
      status: "failed",
      reason: "cost-limit"
    });
    backend.submitPath(
      request("field-limited", { x: 0.5, y: 0.5 }, { x: 3.5, y: 3.5 }, "field", 1)
    );
    expect(backend.pollPath("request-field-limited")).toMatchObject({
      status: "failed",
      reason: "cost-limit"
    });
    backend.submitPath(
      request("field-local-limited", { x: 0.2, y: 0.2 }, { x: 0.8, y: 0.2 }, "field", 0.1)
    );
    expect(backend.pollPath("request-field-local-limited")).toMatchObject({
      status: "failed",
      reason: "cost-limit"
    });

    backend.submitPath(request("field", { x: 0.5, y: 0.5 }, { x: 3.5, y: 3.5 }, "field"));
    const field = backend.pollPath("request-field");
    expect(field).toMatchObject({ status: "complete", route: { kind: "field" } });
    if (field.status === "complete" && field.route.kind === "field") {
      expect(
        backend.sampleRoute?.(field.route.routeKey, { x: 0.5, y: 0.5 }, PROFILE)
      ).toMatchObject({
        status: "valid",
        revision: 0
      });
      backend.retainRoute?.(field.route.routeKey);
      backend.releasePath("request-field");
      expect(backend.snapshot().details).toMatchObject({
        routeFields: 2,
        retainedRouteFields: 1
      });
      backend.releaseRoute?.(field.route.routeKey);
    }
    backend.dispose();
  });

  it("shares a goal field and preserves directed off-mesh traversal", async () => {
    const source = createSplitSource();
    const layout: NavigationLayoutDefinition = {
      id: "directed-field-layout",
      backend: "recast",
      source: { type: "navigation.navmesh-source", id: source.id },
      areas: [{ id: "ground", cost: 1 }],
      portals: [
        {
          id: "one-way-link",
          from: { point: { x: 1.5, y: 1 } },
          to: { point: { x: 4.5, y: 1 } },
          bidirectional: false
        }
      ]
    };
    const artifact = await prepareRecastNavigationArtifact(source, layout);
    const backend = createRecastNavigationBackend({ source, layout, artifact });

    backend.submitPath({
      ...request("field-left-a", { x: 0.5, y: 1 }, { x: 5.5, y: 1 }, "field"),
      goalKey: "east-rally"
    });
    backend.submitPath({
      ...request("field-left-b", { x: 1.5, y: 1 }, { x: 5.5, y: 1 }, "field"),
      goalKey: "east-rally"
    });
    const first = backend.pollPath("request-field-left-a");
    const second = backend.pollPath("request-field-left-b");

    expect(first).toMatchObject({
      status: "complete",
      route: { kind: "field" },
      dependencies: expect.arrayContaining([{ kind: "portal", id: "one-way-link" }])
    });
    expect(second).toMatchObject({ status: "complete", route: { kind: "field" } });
    if (
      first.status === "complete" &&
      first.route.kind === "field" &&
      second.status === "complete" &&
      second.route.kind === "field"
    ) {
      expect(second.route.routeKey).toBe(first.route.routeKey);
      expect(backend.sampleRoute?.(first.route.routeKey, { x: 1.5, y: 1 }, PROFILE)).toMatchObject({
        status: "valid",
        traversal: {
          kind: "portal",
          portalId: "one-way-link",
          entryPoint: { x: expect.any(Number), y: expect.any(Number) },
          exitPoint: { x: expect.any(Number), y: expect.any(Number) }
        }
      });
    }

    backend.submitPath(request("field-wrong-way", { x: 5.5, y: 1 }, { x: 0.5, y: 1 }, "field"));
    expect(backend.pollPath("request-field-wrong-way")).toMatchObject({
      status: "failed",
      reason: "unreachable"
    });
    backend.dispose();
  });

  it("uses authored portal cost consistently for point paths and route fields", async () => {
    const source = createAuthoredPortalCostSource();
    const layout: NavigationLayoutDefinition = {
      id: "authored-portal-cost-layout",
      backend: "recast",
      source: { type: "navigation.navmesh-source", id: source.id },
      areas: [
        { id: "ground", cost: 1 },
        { id: "road", cost: 1 }
      ],
      portals: [
        {
          id: "relay",
          from: { point: { x: 1, y: 5 } },
          to: { point: { x: 11, y: 5 } },
          bidirectional: true,
          cost: 0.1
        }
      ]
    };
    const artifact = await prepareRecastNavigationArtifact(source, layout);
    const backend = createRecastNavigationBackend({ source, layout, artifact });

    backend.submitPath(request("portal-cost-path", { x: 1, y: 1 }, { x: 11, y: 1 }));
    const path = backend.pollPath("request-portal-cost-path");
    expect(path).toMatchObject({
      status: "complete",
      route: {
        kind: "path",
        traversals: [{ kind: "portal", portalId: "relay" }]
      },
      dependencies: expect.arrayContaining([{ kind: "portal", id: "relay" }])
    });
    if (path.status === "complete") {
      expect(path.cost).toBeLessThan(10);
    }

    backend.submitPath(request("portal-cost-field", { x: 1, y: 1 }, { x: 11, y: 1 }, "field"));
    const field = backend.pollPath("request-portal-cost-field");
    expect(field).toMatchObject({ status: "complete", route: { kind: "field" } });
    if (field.status !== "complete" || field.route.kind !== "field") {
      throw new Error("Expected an authored-cost Recast route field");
    }
    expect(backend.sampleRoute?.(field.route.routeKey, { x: 1, y: 5 }, PROFILE)).toMatchObject({
      status: "valid",
      traversal: { kind: "portal", portalId: "relay" }
    });
    backend.dispose();
  });

  it("bounds inactive fields without evicting retained fields", async () => {
    const source = createLShapedSource();
    const artifact = await prepareRecastNavigationArtifact(source);
    const backend = createRecastNavigationBackend({ source, artifact, maxRouteFields: 1 });

    backend.submitPath({
      ...request("field-retained-a", { x: 0.5, y: 0.5 }, { x: 3.5, y: 3.5 }, "field"),
      goalKey: "goal-a"
    });
    backend.submitPath({
      ...request("field-retained-b", { x: 0.5, y: 0.5 }, { x: 3.5, y: 3.5 }, "field"),
      goalKey: "goal-b"
    });
    expect(backend.snapshot().details).toMatchObject({
      routeFields: 2,
      retainedRouteFields: 2,
      maxRouteFields: 1
    });

    backend.releasePath("request-field-retained-a");
    expect(backend.snapshot().details).toMatchObject({
      routeFields: 1,
      retainedRouteFields: 1
    });
    backend.releasePath("request-field-retained-b");
    backend.dispose();
  });

  it("keeps one backend field for a thousand requests to the same goal", async () => {
    const source = createLShapedSource();
    const artifact = await prepareRecastNavigationArtifact(source);
    const backend = createRecastNavigationBackend({ source, artifact });
    const routeKeys = new Set<string>();

    for (let index = 0; index < 1000; index += 1) {
      const requestId = `request-shared-field-${index}`;
      backend.submitPath({
        ...request(`shared-field-${index}`, { x: 0.5, y: 0.5 }, { x: 3.5, y: 3.5 }, "field"),
        requestId,
        goalKey: "shared-goal"
      });
      const result = backend.pollPath(requestId);
      if (result.status !== "complete" || result.route.kind !== "field") {
        throw new Error(`Expected shared field request ${index} to complete`);
      }
      routeKeys.add(result.route.routeKey);
    }

    expect(routeKeys.size).toBe(1);
    expect(backend.snapshot().details).toMatchObject({
      routeFields: 1,
      retainedRouteFields: 1,
      retainedRequests: 1000
    });
    for (let index = 0; index < 1000; index += 1) {
      backend.releasePath(`request-shared-field-${index}`);
    }
    expect(backend.snapshot().details).toMatchObject({
      routeFields: 1,
      retainedRouteFields: 0,
      retainedRequests: 0
    });
    backend.dispose();
  });

  it("passes the shared Navigation runtime conformance contract", async () => {
    const source = createLShapedSource();
    const artifact = await prepareRecastNavigationArtifact(source);
    const report = await runNavigationRuntimeConformance(() => {
      const runtime = createNavigationRuntime({
        backend: createRecastNavigationBackend({ source, artifact }),
        profiles: [PROFILE]
      });
      return {
        runtime,
        profile: PROFILE,
        reachableStart: { x: 0.5, y: 0.5 },
        reachableGoal: { x: 3.5, y: 3.5 },
        unreachableGoal: { x: 40, y: 40 },
        blockReachableGoal: {
          id: "block-default-area",
          target: { kind: "area", id: "default" },
          blocked: true
        },
        dispose: () => runtime.dispose()
      };
    });

    expect(report.checks).toContain("field route can be sampled");
    expect(report.revision).toBe(1);
  });

  it("updates area filters and disabled off-mesh portals with revision-safe invalidation", async () => {
    const source = createSplitSource();
    const layout = {
      id: "split-layout",
      backend: "recast",
      source: { type: "navigation.navmesh-source", id: source.id },
      areas: [{ id: "ground", cost: 1 }],
      portals: [
        {
          id: "jump-link",
          from: { point: { x: 1.5, y: 1 } },
          to: { point: { x: 4.5, y: 1 } },
          bidirectional: true,
          enabled: false
        }
      ]
    };
    const artifact = await prepareRecastNavigationArtifact(source, layout);
    const backend = createRecastNavigationBackend({ source, layout, artifact });

    expect(backend.capabilities.dynamicObstacles).toEqual(["area", "portal"]);
    backend.submitPath(request("disconnected", { x: 0.5, y: 1 }, { x: 5.5, y: 1 }));
    expect(backend.pollPath("request-disconnected")).toMatchObject({
      status: "failed",
      reason: "unreachable"
    });

    expect(
      backend.updateObstacle?.({
        id: "enable-link",
        target: { kind: "portal", id: "jump-link" },
        blocked: false
      })
    ).toMatchObject({ status: "changed", revision: 1, invalidateAllPaths: true });
    backend.submitPath(request("connected", { x: 0.5, y: 1 }, { x: 5.5, y: 1 }));
    expect(backend.pollPath("request-connected")).toMatchObject({
      status: "complete",
      revision: 1,
      route: {
        kind: "path",
        traversals: [{ kind: "portal", portalId: "jump-link" }]
      },
      dependencies: expect.arrayContaining([{ kind: "portal", id: "jump-link" }])
    });

    expect(
      backend.updateObstacle?.({
        id: "block-ground",
        target: { kind: "area", id: "ground" },
        blocked: true
      })
    ).toMatchObject({
      status: "changed",
      revision: 2,
      invalidatedPathDependencies: [{ kind: "area", id: "ground" }]
    });
    expect(backend.projectPoint({ x: 0.5, y: 1 }, PROFILE)).toBeUndefined();
    backend.dispose();
  });

  it("preserves authored area boundaries during the Recast bake", async () => {
    const source = createAreaSplitSource();
    const artifact = await prepareRecastNavigationArtifact(source);
    const backend = createRecastNavigationBackend({
      source,
      artifact,
      queryHalfExtents: { x: 0.25, y: 0.25, z: 1 }
    });

    expect(artifact.areaIds).toEqual(["ground", "mud"]);
    expect(artifact.debugMesh.triangleAreas).toHaveLength(artifact.debugMesh.indices.length / 3);
    expect(new Set(artifact.debugMesh.triangleAreas)).toEqual(new Set(["ground", "mud"]));
    expect(backend.projectPoint({ x: 1, y: 1 }, PROFILE)?.area).toBe("ground");
    expect(backend.projectPoint({ x: 3, y: 1 }, PROFILE)?.area).toBe("mud");

    backend.updateObstacle?.({
      id: "block-mud",
      target: { kind: "area", id: "mud" },
      blocked: true
    });
    expect(backend.projectPoint({ x: 3, y: 1 }, PROFILE)).toBeUndefined();
    expect(backend.projectPoint({ x: 1, y: 1 }, PROFILE)?.area).toBe("ground");
    backend.dispose();
  });

  it("uses profile area overrides as replacement costs and reroutes after a dynamic multiplier", async () => {
    const source = createTwoCorridorSource();
    const layout: NavigationLayoutDefinition = {
      id: "two-corridor-layout",
      backend: "recast",
      source: { type: "navigation.navmesh-source", id: source.id },
      areas: [
        { id: "ground", cost: 1 },
        { id: "mud", cost: 5 }
      ]
    };
    const artifact = await prepareRecastNavigationArtifact(source, layout);
    const backend = createRecastNavigationBackend({ source, layout, artifact });
    const profile: NavigationAgentProfileDefinition = {
      ...PROFILE,
      costOverrides: { mud: 0.5 }
    };

    backend.submitPath(
      request("prefer-mud", { x: 1, y: 3 }, { x: 9, y: 3 }, "path", undefined, profile)
    );
    const preferred = backend.pollPath("request-prefer-mud");
    expect(pathPoints(preferred).some((point) => point.y > 3.5)).toBe(true);
    backend.submitPath(
      request("prefer-mud-field", { x: 1, y: 3 }, { x: 9, y: 3 }, "field", undefined, profile)
    );
    const preferredField = backend.pollPath("request-prefer-mud-field");
    expect(preferredField).toMatchObject({ status: "complete", route: { kind: "field" } });
    if (preferredField.status !== "complete" || preferredField.route.kind !== "field") {
      throw new Error("Expected a discounted Recast route field");
    }
    const preferredFieldSample = backend.sampleRoute?.(
      preferredField.route.routeKey,
      { x: 1, y: 3 },
      profile
    );
    expect(preferredFieldSample).toMatchObject({
      status: "valid",
      direction: { y: expect.any(Number) }
    });

    expect(
      backend.updateObstacle?.({
        id: "raise-mud-cost",
        target: { kind: "area", id: "mud" },
        costMultiplier: 10
      })
    ).toMatchObject({ status: "changed", revision: 1, invalidatedRouteFields: 1 });
    backend.submitPath(
      request("avoid-mud", { x: 1, y: 3 }, { x: 9, y: 3 }, "path", undefined, profile)
    );
    const avoided = backend.pollPath("request-avoid-mud");
    expect(pathPoints(avoided).some((point) => point.y < 2.5)).toBe(true);
    backend.submitPath(
      request("avoid-mud-field", { x: 1, y: 3 }, { x: 9, y: 3 }, "field", undefined, profile)
    );
    const avoidedField = backend.pollPath("request-avoid-mud-field");
    expect(avoidedField).toMatchObject({ status: "complete", route: { kind: "field" } });
    if (avoidedField.status !== "complete" || avoidedField.route.kind !== "field") {
      throw new Error("Expected a rerouted Recast route field");
    }
    const preferredSample = backend.sampleRoute?.(
      preferredField.route.routeKey,
      { x: 1, y: 3 },
      profile
    );
    const avoidedSample = backend.sampleRoute?.(
      avoidedField.route.routeKey,
      { x: 1, y: 3 },
      profile
    );
    expect(preferredSample?.status).toBe("missing");
    expect(avoidedSample).toMatchObject({ status: "valid" });
    backend.releasePath("request-prefer-mud-field");
    expect(backend.snapshot().details).toMatchObject({ retainedRouteFields: 1 });
    if (preferredFieldSample?.status === "valid" && avoidedSample?.status === "valid") {
      expect(preferredFieldSample.direction.y).toBeGreaterThan(0);
      expect(avoidedSample.direction.y).toBeLessThan(0);
    }
    if (preferred.status === "complete" && avoided.status === "complete") {
      expect(avoided.cost).toBeGreaterThan(preferred.cost);
    }
    backend.dispose();
  });

  it("preserves discounted-area route ordering when Detour query costs would fall below one", async () => {
    const source = createDiscountedDetourSource();
    const layout: NavigationLayoutDefinition = {
      id: "discounted-detour-layout",
      backend: "recast",
      source: { type: "navigation.navmesh-source", id: source.id },
      areas: [
        { id: "ground", cost: 1 },
        { id: "discount", cost: 0.01 }
      ]
    };
    const artifact = await prepareRecastNavigationArtifact(source, layout);
    const backend = createRecastNavigationBackend({ source, layout, artifact });

    backend.submitPath(request("discounted-detour", { x: 1, y: 1 }, { x: 11, y: 1 }));
    const result = backend.pollPath("request-discounted-detour");

    expect(pathPoints(result).some((point) => point.y > 9)).toBe(true);
    if (result.status === "complete") {
      expect(result.cost).toBeLessThan(1);
    }
    backend.dispose();
  });
});

function request(
  suffix: string,
  start: { x: number; y: number },
  goal: { x: number; y: number },
  routeKind: "path" | "field" = "path",
  maxCost?: number,
  profile: NavigationAgentProfileDefinition = PROFILE
): NavigationBackendPathRequest {
  return {
    requestId: `request-${suffix}`,
    profile,
    start,
    goal,
    routeKind,
    ...(maxCost === undefined ? {} : { maxCost })
  };
}

function pathPoints(status: NavigationBackendPathStatus): readonly { x: number; y: number }[] {
  expect(status.status).toBe("complete");
  if (status.status !== "complete" || status.route.kind !== "path") {
    return [];
  }
  return status.route.points;
}

function createLShapedSource(): NavigationNavMeshSource {
  const vertices = [
    { x: 0, y: 0 },
    { x: 4, y: 0 },
    { x: 4, y: 1 },
    { x: 1, y: 1 },
    { x: 1, y: 4 },
    { x: 4, y: 4 }
  ];
  return {
    id: "l-shaped",
    vertices,
    triangles: [
      { a: 0, b: 1, c: 2 },
      { a: 0, b: 2, c: 3 },
      { a: 0, b: 3, c: 4 },
      { a: 3, b: 5, c: 4 }
    ],
    build: {
      cellSize: 0.1,
      cellHeight: 0.1,
      walkableRadius: 0.1,
      walkableHeight: 1.8,
      walkableClimb: 0.3,
      walkableSlopeAngle: 45,
      minRegionArea: 0.01,
      mergeRegionArea: 0.01
    }
  };
}

function createSplitSource(): NavigationNavMeshSource {
  return {
    id: "split",
    vertices: [
      { x: 0, y: 0 },
      { x: 2, y: 0 },
      { x: 2, y: 2 },
      { x: 0, y: 2 },
      { x: 4, y: 0 },
      { x: 6, y: 0 },
      { x: 6, y: 2 },
      { x: 4, y: 2 }
    ],
    triangles: [
      { a: 0, b: 1, c: 2, area: "ground" },
      { a: 0, b: 2, c: 3, area: "ground" },
      { a: 4, b: 5, c: 6, area: "ground" },
      { a: 4, b: 6, c: 7, area: "ground" }
    ],
    build: {
      cellSize: 0.1,
      cellHeight: 0.1,
      walkableRadius: 0.1,
      walkableHeight: 1.8,
      walkableClimb: 0.3,
      walkableSlopeAngle: 45,
      minRegionArea: 0.01,
      mergeRegionArea: 0.01
    }
  };
}

function createAreaSplitSource(): NavigationNavMeshSource {
  return {
    id: "area-split",
    vertices: [
      { x: 0, y: 0 },
      { x: 2, y: 0 },
      { x: 2, y: 2 },
      { x: 0, y: 2 },
      { x: 4, y: 0 },
      { x: 4, y: 2 }
    ],
    triangles: [
      { a: 0, b: 1, c: 2, area: "ground" },
      { a: 0, b: 2, c: 3, area: "ground" },
      { a: 1, b: 4, c: 5, area: "mud" },
      { a: 1, b: 5, c: 2, area: "mud" }
    ],
    build: {
      cellSize: 0.1,
      cellHeight: 0.1,
      walkableRadius: 0.1,
      walkableHeight: 1.8,
      walkableClimb: 0.3,
      walkableSlopeAngle: 45,
      minRegionArea: 0.01,
      mergeRegionArea: 0.01,
      maxSimplificationError: 0.05
    }
  };
}

function createTwoCorridorSource(): NavigationNavMeshSource {
  const vertices: NavigationNavMeshSource["vertices"] = [];
  const triangles: NavigationNavMeshSource["triangles"] = [];
  appendRectangle(vertices, triangles, 0, 0, 2, 6, "ground");
  appendRectangle(vertices, triangles, 2, 4, 8, 6, "mud");
  appendRectangle(vertices, triangles, 2, 0, 8, 2, "ground");
  appendRectangle(vertices, triangles, 8, 0, 10, 6, "ground");
  return {
    id: "two-corridor",
    vertices,
    triangles,
    build: {
      cellSize: 0.1,
      cellHeight: 0.1,
      walkableRadius: 0.1,
      walkableHeight: 1.8,
      walkableClimb: 0.3,
      walkableSlopeAngle: 45,
      minRegionArea: 0.01,
      mergeRegionArea: 0.01,
      maxSimplificationError: 0.05
    }
  };
}

function createDiscountedDetourSource(): NavigationNavMeshSource {
  const vertices: NavigationNavMeshSource["vertices"] = [];
  const triangles: NavigationNavMeshSource["triangles"] = [];
  appendRectangle(vertices, triangles, 0, 0, 2, 12, "discount");
  appendRectangle(vertices, triangles, 2, 0, 10, 2, "ground");
  appendRectangle(vertices, triangles, 2, 10, 10, 12, "discount");
  appendRectangle(vertices, triangles, 10, 0, 12, 12, "discount");
  return {
    id: "discounted-detour",
    vertices,
    triangles,
    build: {
      cellSize: 0.1,
      cellHeight: 0.1,
      walkableRadius: 0.1,
      walkableHeight: 1.8,
      walkableClimb: 0.3,
      walkableSlopeAngle: 45,
      minRegionArea: 0.01,
      mergeRegionArea: 0.01,
      maxSimplificationError: 0.05
    }
  };
}

function createAuthoredPortalCostSource(): NavigationNavMeshSource {
  const vertices: NavigationNavMeshSource["vertices"] = [];
  const triangles: NavigationNavMeshSource["triangles"] = [];
  appendRectangle(vertices, triangles, 0, 0, 4, 6, "ground");
  appendRectangle(vertices, triangles, 4, 0, 8, 6, "road");
  appendRectangle(vertices, triangles, 8, 0, 12, 6, "ground");
  return {
    id: "authored-portal-cost",
    vertices,
    triangles,
    build: {
      cellSize: 0.1,
      cellHeight: 0.1,
      walkableRadius: 0.1,
      walkableHeight: 1.8,
      walkableClimb: 0.3,
      walkableSlopeAngle: 45,
      minRegionArea: 0.01,
      mergeRegionArea: 0.01,
      maxSimplificationError: 0.05
    }
  };
}

function appendRectangle(
  vertices: NavigationNavMeshSource["vertices"],
  triangles: NavigationNavMeshSource["triangles"],
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
  area: string
): void {
  const base = vertices.length;
  vertices.push(
    { x: minX, y: minY },
    { x: maxX, y: minY },
    { x: maxX, y: maxY },
    { x: minX, y: maxY }
  );
  triangles.push(
    { a: base, b: base + 1, c: base + 2, area },
    { a: base, b: base + 2, c: base + 3, area }
  );
}
