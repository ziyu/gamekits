import {
  createNavigationDataTypes,
  createNavigationRuntime,
  type NavigationAgentProfileDefinition
} from "@gamekits/navigation-core";
import type {
  NavigationBackendAdapter,
  NavigationBackendPathRequest,
  NavigationBackendPathResult
} from "@gamekits/navigation-core/backend";
import { createDataRegistry } from "@gamekits/data";
import { describe, expect, it } from "vitest";
import {
  createGraphNavigationBackend,
  createGraphNavigationBackendFactory,
  createNavigationGraphDataType,
  type NavigationGraphDefinition
} from "../src";

const standardProfile: NavigationAgentProfileDefinition = {
  id: "profile.standard",
  radius: 0.5,
  allowedAreas: ["ground", "mud", "road"]
};

describe("Navigation graph data", () => {
  it("rejects invalid nodes, edges, and costs", () => {
    const type = createNavigationGraphDataType();
    const diagnostics = type.validate?.(
      {
        type: "navigation.graph",
        id: "invalid",
        priority: 0,
        tags: [],
        data: {
          id: "graph.invalid",
          nodes: [
            { id: "a", point: { x: 0, y: 0 } },
            { id: "a", point: { x: Number.NaN, y: 0 } }
          ],
          edges: [{ id: "edge", from: "a", to: "missing", cost: 0 }]
        }
      },
      {
        type: "navigation.graph",
        pack: { id: "test", version: "1", entries: [] },
        path: "test"
      }
    );
    expect(diagnostics?.map((entry) => entry.code)).toEqual([
      "navigation.graph_duplicate_node",
      "navigation.graph_invalid_node_point",
      "navigation.graph_invalid_edge_nodes",
      "navigation.graph_invalid_edge_cost"
    ]);
  });
});

describe("Graph navigation backend", () => {
  it("uses deterministic shortest paths and reacts to blockers", () => {
    const backend = createGraphNavigationBackend({ graph: diamondGraph() });
    const first = findPath(backend, pathRequest("first", standardProfile));
    expect(first.status).toBe("complete");
    if (first.status !== "complete") {
      throw new Error("Expected complete graph path");
    }
    expect(first.route.kind).toBe("path");
    if (first.route.kind !== "path") {
      throw new Error("Expected point path");
    }
    expect(first.route.points).toEqual([
      { x: 0, y: 0 },
      { x: 1, y: 1 },
      { x: 2, y: 0 }
    ]);
    expect(backend.snapshot().details?.routeFields).toBe(1);

    const changed = backend.updateObstacle?.({
      id: "block.upper",
      target: { kind: "edge", id: "edge.a-b" },
      blocked: true
    });
    expect(changed).toMatchObject({ status: "changed", revision: 1, invalidatedRouteFields: 1 });
    expect(changed).toMatchObject({
      invalidatedPathDependencies: [{ kind: "edge", id: "edge.a-b" }]
    });
    const alternate = findPath(backend, pathRequest("alternate", standardProfile));
    expect(alternate.status).toBe("complete");
    if (alternate.status === "complete") {
      expect(alternate.route.kind).toBe("path");
      if (alternate.route.kind === "path") {
        expect(alternate.route.points[1]).toEqual({ x: 1, y: -1 });
      }
    }
    backend.dispose();
    expect(backend.snapshot()).toMatchObject({ disposed: true, details: { routeFields: 0 } });
  });

  it("applies profile area filters and cost overrides", () => {
    const backend = createGraphNavigationBackend({ graph: diamondGraph() });
    const costlyMud: NavigationAgentProfileDefinition = {
      ...standardProfile,
      costOverrides: { mud: 10 }
    };
    const result = findPath(backend, pathRequest("cost", costlyMud));
    expect(result.status).toBe("complete");
    if (result.status === "complete") {
      expect(result.route.kind).toBe("path");
      if (result.route.kind === "path") {
        expect(result.route.points[1]).toEqual({ x: 1, y: -1 });
      }
    }

    const roadOnly: NavigationAgentProfileDefinition = {
      id: "profile.road",
      radius: 0.5,
      allowedAreas: ["ground", "road"]
    };
    expect(backend.projectPoint({ x: 1, y: 0.8 }, roadOnly)?.backendNodeId).toBe("a");
    backend.dispose();
  });

  it("shares one goal-keyed reverse route field across many starts", () => {
    const graph = lineGraph(128);
    const backend = createGraphNavigationBackend({ graph, maxRouteFields: 4 });
    let nearestGoalDependencies: NavigationBackendPathResult["dependencies"];
    for (let index = 0; index < 1000; index += 1) {
      const start = index % 127;
      const result = findPath(backend, {
        requestId: `path.${index}`,
        profile: standardProfile,
        start: { x: start, y: 0 },
        goal: { x: 127, y: 0 },
        goalKey: "shared-goal",
        routeKind: "field"
      });
      expect(result.status).toBe("complete");
      if (start === 126) nearestGoalDependencies = result.dependencies;
    }
    expect(nearestGoalDependencies).toEqual([
      { kind: "edge", id: "edge.126" },
      { kind: "area", id: "ground" }
    ]);
    expect(backend.snapshot().details).toMatchObject({
      routeFields: 1,
      nodes: 128,
      connections: 127
    });
    backend.dispose();
  });

  it("does not evict active fields when the inactive field budget is full", () => {
    const runtime = createNavigationRuntime({
      backend: createGraphNavigationBackend({ graph: lineGraph(4), maxRouteFields: 1 }),
      profiles: [standardProfile]
    });
    const firstId = runtime.requestPath({
      id: "field.first",
      requesterId: "first",
      profileId: standardProfile.id,
      start: { x: 0, y: 0 },
      goal: { x: 2, y: 0 },
      goalKey: "first",
      routeKind: "field"
    });
    const secondId = runtime.requestPath({
      id: "field.second",
      requesterId: "second",
      profileId: standardProfile.id,
      start: { x: 0, y: 0 },
      goal: { x: 3, y: 0 },
      goalKey: "second",
      routeKind: "field"
    });
    runtime.update(16, 16);
    const first = runtime.poll(firstId);
    const second = runtime.poll(secondId);
    if (first.status !== "complete" || second.status !== "complete") {
      throw new Error("Expected active graph fields");
    }
    expect(runtime.snapshot().backend.details).toMatchObject({
      routeFields: 2,
      retainedRouteFields: 2
    });
    expect(runtime.sampleRoute(first.route.routeId, { x: 0, y: 0 }).status).toBe("valid");
    runtime.releaseRoute(first.route.routeId);
    expect(runtime.snapshot().backend.details).toMatchObject({
      routeFields: 1,
      retainedRouteFields: 1
    });
    expect(runtime.sampleRoute(second.route.routeId, { x: 0, y: 0 }).status).toBe("valid");
    runtime.dispose();
  });

  it("returns unreachable explicitly and invalidates only dependent route fields", () => {
    const backend = createGraphNavigationBackend({ graph: splitGraph() });
    const left = findPath(backend, {
      requestId: "left",
      profile: standardProfile,
      start: { x: 0, y: 0 },
      goal: { x: 1, y: 0 },
      goalKey: "left",
      routeKind: "path"
    });
    const right = findPath(backend, {
      requestId: "right",
      profile: standardProfile,
      start: { x: 10, y: 0 },
      goal: { x: 11, y: 0 },
      goalKey: "right",
      routeKind: "path"
    });
    expect(left.status).toBe("complete");
    expect(right.status).toBe("complete");
    expect(backend.snapshot().details?.routeFields).toBe(2);
    expect(
      backend.updateObstacle?.({
        id: "block.left",
        target: { kind: "edge", id: "edge.left" },
        blocked: true
      })
    ).toMatchObject({ status: "changed", invalidatedRouteFields: 1 });
    expect(backend.snapshot().details?.routeFields).toBe(1);
    expect(
      findPath(backend, {
        requestId: "left.blocked",
        profile: standardProfile,
        start: { x: 0, y: 0 },
        goal: { x: 1, y: 0 },
        goalKey: "left",
        routeKind: "path"
      })
    ).toMatchObject({ status: "failed", reason: "unreachable" });
    backend.dispose();
  });

  it("integrates with the Core scheduler, cache, and stale route contract", () => {
    const runtime = createNavigationRuntime({
      backend: createGraphNavigationBackend({ graph: diamondGraph() }),
      profiles: [standardProfile],
      maxRequestsPerTick: 4
    });
    const id = runtime.requestPath({
      id: "core.path",
      requesterId: "agent",
      profileId: standardProfile.id,
      start: { x: 0, y: 0 },
      goal: { x: 2, y: 0 },
      goalKey: "core"
    });
    runtime.update(16, 16);
    const result = runtime.poll(id);
    expect(result.status).toBe("complete");
    if (result.status !== "complete") {
      throw new Error("Expected complete Core graph route");
    }
    expect(runtime.sampleRoute(result.route.routeId, { x: 0.5, y: 0.5 })).toMatchObject({
      status: "valid",
      nextPoint: { x: 1, y: 1 }
    });
    runtime.updateObstacle({
      id: "block",
      target: { kind: "edge", id: "edge.a-b" },
      blocked: true
    });
    expect(runtime.sampleRoute(result.route.routeId, { x: 0, y: 0 }).status).toBe("stale");
    runtime.dispose();
  });

  it("keeps independent Core cache entries and routes valid after partial invalidation", () => {
    const runtime = createNavigationRuntime({
      backend: createGraphNavigationBackend({ graph: splitGraph() }),
      profiles: [standardProfile],
      maxRequestsPerTick: 4
    });
    const leftId = runtime.requestPath(splitRequest("left.first", "left"));
    const rightId = runtime.requestPath(splitRequest("right.first", "right"));
    runtime.update(16, 16);
    const left = runtime.poll(leftId);
    const right = runtime.poll(rightId);
    expect(left.status).toBe("complete");
    expect(right.status).toBe("complete");
    if (left.status !== "complete" || right.status !== "complete") {
      throw new Error("Expected both split routes to complete");
    }

    runtime.updateObstacle({
      id: "block.left",
      target: { kind: "edge", id: "edge.left" },
      blocked: true
    });
    expect(runtime.sampleRoute(left.route.routeId, { x: 0, y: 0 }).status).toBe("stale");
    expect(runtime.sampleRoute(right.route.routeId, { x: 10, y: 0 })).toMatchObject({
      status: "valid",
      revision: 1
    });
    expect(runtime.snapshot()).toMatchObject({ cacheEntries: 1, revision: 1 });

    const rightCachedId = runtime.requestPath(splitRequest("right.cached", "right"));
    runtime.update(16, 32);
    expect(runtime.poll(rightCachedId)).toMatchObject({ status: "complete", cache: "hit" });
    runtime.dispose();
  });

  it("enforces agent geometry and supports layout area/portal updates", () => {
    const graph: NavigationGraphDefinition = {
      id: "graph.profile",
      nodes: [
        {
          id: "a",
          point: { x: 0, y: 0 },
          area: "ground",
          clearance: 1,
          heightClearance: 2
        },
        {
          id: "b",
          point: { x: 1, y: 0 },
          area: "ground",
          clearance: 1,
          heightClearance: 2
        },
        {
          id: "c",
          point: { x: 3, y: 0 },
          area: "upper",
          clearance: 1,
          heightClearance: 2
        }
      ],
      edges: [
        {
          id: "narrow",
          from: "a",
          to: "b",
          area: "ground",
          width: 1,
          heightClearance: 1.5,
          slope: 10
        }
      ]
    };
    const backend = createGraphNavigationBackend({
      graph,
      layout: {
        id: "layout.profile",
        backend: "graph",
        source: { type: "navigation.graph", id: graph.id },
        areas: [{ id: "ground" }, { id: "upper", cost: 2 }],
        portals: [
          {
            id: "lift",
            from: { point: { x: 1, y: 0 }, area: "ground" },
            to: { point: { x: 3, y: 0 }, area: "upper" }
          }
        ]
      }
    });
    const large: NavigationAgentProfileDefinition = {
      id: "large",
      radius: 0.6,
      height: 1,
      maxSlope: 20,
      allowedAreas: ["ground", "upper"]
    };
    expect(findPath(backend, pathRequest("large", large))).toMatchObject({
      status: "failed",
      reason: "unreachable"
    });
    const small = { ...large, id: "small", radius: 0.4 };
    const portalPath = findPath(backend, {
      ...pathRequest("portal", small),
      goal: { x: 3, y: 0 },
      goalKey: "upper"
    });
    expect(portalPath).toMatchObject({
      status: "complete",
      route: {
        kind: "path",
        traversals: [
          {
            kind: "portal",
            portalId: "lift",
            entryPoint: { x: 1, y: 0 },
            exitPoint: { x: 3, y: 0 }
          }
        ]
      }
    });
    const portalField = findPath(backend, {
      ...pathRequest("portal.field", small),
      goal: { x: 3, y: 0 },
      goalKey: "upper",
      routeKind: "field"
    });
    if (portalField.status !== "complete" || portalField.route.kind !== "field") {
      throw new Error("Expected a portal field route");
    }
    expect(backend.sampleRoute?.(portalField.route.routeKey, { x: 1, y: 0 }, small)).toMatchObject({
      status: "valid",
      nextPoint: { x: 1, y: 0 },
      traversal: {
        kind: "portal",
        portalId: "lift",
        entryPoint: { x: 1, y: 0 },
        exitPoint: { x: 3, y: 0 }
      }
    });
    expect(
      backend.updateObstacle?.({
        id: "close.lift",
        target: { kind: "portal", id: "lift" },
        blocked: true
      })
    ).toMatchObject({ status: "changed", revision: 1 });
    expect(
      findPath(backend, {
        ...pathRequest("portal.blocked", small),
        goal: { x: 3, y: 0 },
        goalKey: "upper"
      })
    ).toMatchObject({ status: "failed", reason: "unreachable" });
    expect(
      backend.updateObstacle?.({
        id: "close.area",
        target: { kind: "area", id: "ground" },
        blocked: true
      })
    ).toMatchObject({ status: "changed", revision: 2 });
    backend.dispose();
  });

  it("creates the backend from a typed navigation layout", () => {
    const registry = createDataRegistry();
    for (const type of [...createNavigationDataTypes(), createNavigationGraphDataType()]) {
      registry.registerType(type);
    }
    registry.registerPack({
      id: "navigation.test",
      version: "1.0.0",
      entries: [
        {
          type: "navigation.graph",
          id: "graph.layout",
          data: { ...lineGraph(3), id: "graph.layout" }
        },
        {
          type: "navigation.layout",
          id: "layout.main",
          data: {
            id: "layout.main",
            backend: "graph",
            source: { type: "navigation.graph", id: "graph.layout" },
            areas: [{ id: "ground" }]
          }
        }
      ]
    });
    const runtime = createNavigationRuntime({
      layout: { type: "navigation.layout", id: "layout.main" },
      backendFactories: [createGraphNavigationBackendFactory()],
      dataRegistry: registry,
      profiles: [standardProfile]
    });
    const requestId = runtime.requestPath({
      id: "layout.path",
      requesterId: "agent",
      profileId: standardProfile.id,
      start: { x: 0, y: 0 },
      goal: { x: 2, y: 0 }
    });
    runtime.update(16, 16);
    expect(runtime.poll(requestId).status).toBe("complete");
    expect(runtime.snapshot().backend.id).toBe("navigation.graph.layout.main");
    runtime.dispose();

    const factory = createGraphNavigationBackendFactory();
    expect(() =>
      factory.create({
        layout: {
          id: "layout.missing",
          backend: "graph",
          source: { type: "navigation.graph", id: "missing" }
        },
        dataRegistry: registry
      })
    ).toThrowError(expect.objectContaining({ code: "navigation.graph_source_missing" }));
  });
});

function diamondGraph(): NavigationGraphDefinition {
  return {
    id: "graph.diamond",
    nodes: [
      { id: "a", point: { x: 0, y: 0 }, area: "ground" },
      { id: "b", point: { x: 1, y: 1 }, area: "mud" },
      { id: "c", point: { x: 1, y: -1 }, area: "road" },
      { id: "d", point: { x: 2, y: 0 }, area: "ground" }
    ],
    edges: [
      { id: "edge.a-b", from: "a", to: "b", area: "mud" },
      { id: "edge.b-d", from: "b", to: "d", area: "mud" },
      { id: "edge.a-c", from: "a", to: "c", area: "road" },
      { id: "edge.c-d", from: "c", to: "d", area: "road" }
    ]
  };
}

function lineGraph(nodes: number): NavigationGraphDefinition {
  return {
    id: "graph.line",
    nodes: Array.from({ length: nodes }, (_, index) => ({
      id: `node.${index}`,
      point: { x: index, y: 0 },
      area: "ground"
    })),
    edges: Array.from({ length: nodes - 1 }, (_, index) => ({
      id: `edge.${index}`,
      from: `node.${index}`,
      to: `node.${index + 1}`,
      area: "ground"
    }))
  };
}

function splitGraph(): NavigationGraphDefinition {
  return {
    id: "graph.split",
    nodes: [
      { id: "left.start", point: { x: 0, y: 0 }, area: "ground" },
      { id: "left.goal", point: { x: 1, y: 0 }, area: "ground" },
      { id: "right.start", point: { x: 10, y: 0 }, area: "ground" },
      { id: "right.goal", point: { x: 11, y: 0 }, area: "ground" }
    ],
    edges: [
      { id: "edge.left", from: "left.start", to: "left.goal", area: "ground" },
      { id: "edge.right", from: "right.start", to: "right.goal", area: "ground" }
    ]
  };
}

function pathRequest(id: string, profile: NavigationAgentProfileDefinition) {
  return {
    requestId: id,
    profile,
    start: { x: 0, y: 0 },
    goal: { x: 2, y: 0 },
    goalKey: "goal",
    routeKind: "path" as const
  };
}

function findPath(
  backend: NavigationBackendAdapter,
  request: NavigationBackendPathRequest
): NavigationBackendPathResult {
  backend.submitPath(request);
  const result = backend.pollPath(request.requestId);
  backend.releasePath(request.requestId);
  if (result.status === "pending" || result.status === "missing") {
    throw new Error(`Expected terminal backend result, received ${result.status}`);
  }
  return result;
}

function splitRequest(id: string, side: "left" | "right") {
  const offset = side === "left" ? 0 : 10;
  return {
    id,
    requesterId: side,
    profileId: standardProfile.id,
    start: { x: offset, y: 0 },
    goal: { x: offset + 1, y: 0 },
    goalKey: side
  };
}
