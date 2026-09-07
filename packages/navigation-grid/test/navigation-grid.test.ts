import { createDataRegistry } from "@gamekits/data";
import {
  createNavigationDataTypes,
  createNavigationRuntime,
  type NavigationAgentProfileDefinition,
  type NavigationLayoutDefinition
} from "@gamekits/navigation-core";
import type {
  NavigationBackendAdapter,
  NavigationBackendPathRequest,
  NavigationBackendPathResult
} from "@gamekits/navigation-core/backend";
import { runNavigationRuntimeConformance } from "@gamekits/navigation-core/testing";
import { describe, expect, it } from "vitest";
import {
  createGridNavigationBackend,
  createGridNavigationBackendFactory,
  createNavigationGridDataType,
  type NavigationGridDefinition
} from "../src";

const profile: NavigationAgentProfileDefinition = {
  id: "profile.standard",
  radius: 0.4,
  allowedAreas: ["road", "swamp"],
  costOverrides: { swamp: 3 }
};

describe("Navigation grid data", () => {
  it("rejects invalid dimensions, duplicate cells, and unknown obstacle references", () => {
    const diagnostics = createNavigationGridDataType().validate?.(
      {
        type: "navigation.grid",
        id: "invalid",
        priority: 0,
        tags: [],
        data: {
          id: "grid.invalid",
          width: 0,
          height: 2,
          cellSize: -1,
          origin: { x: 0, y: 0 },
          cells: [
            { column: 0, row: 0 },
            { column: 0, row: 0, obstacleIds: ["missing"] }
          ]
        }
      },
      {
        type: "navigation.grid",
        pack: { id: "test", version: "1", entries: [] },
        path: "test"
      }
    );
    expect(diagnostics?.map((entry) => entry.code)).toEqual([
      "navigation.grid_invalid_width",
      "navigation.grid_invalid_cell_size",
      "navigation.grid_cell_out_of_bounds",
      "navigation.grid_cell_out_of_bounds",
      "navigation.grid_duplicate_cell",
      "navigation.grid_unknown_cell_obstacle"
    ]);
  });
});

describe("Grid navigation backend", () => {
  it("projects to the true nearest compatible cell across sparse rings", () => {
    const backend = createGridNavigationBackend({
      grid: {
        id: "grid.sparse-projection",
        width: 11,
        height: 11,
        cellSize: 1,
        origin: { x: 0, y: 0 },
        cells: [
          { column: 1, row: 1, area: "road" },
          { column: 10, row: 5, area: "road" }
        ]
      }
    });
    expect(backend.projectPoint({ x: 5.49, y: 5.49 }, profile)?.backendNodeId).toBe("10:5");
    expect(backend.projectPoint({ x: 100, y: 5 }, profile)?.backendNodeId).toBe("10:5");
    backend.dispose();
  });

  it("uses raster connectivity, area costs, and dynamic cell obstacles", () => {
    const backend = createGridNavigationBackend({ grid: createTestGrid() });
    const direct = findPath(backend, request("direct"));
    expect(direct.status).toBe("complete");
    if (direct.status !== "complete" || direct.route.kind !== "path") {
      throw new Error("Expected a complete point path");
    }
    expect(direct.route.points).toContainEqual({ x: 2, y: 1 });

    expect(
      backend.updateObstacle?.({
        id: "close.gate",
        target: { kind: "custom", id: "gate" },
        blocked: true
      })
    ).toMatchObject({
      status: "changed",
      revision: 1,
      invalidatedPathDependencies: [{ kind: "custom", id: "gate" }]
    });
    const detour = findPath(backend, request("detour"));
    expect(detour.status).toBe("complete");
    if (detour.status === "complete" && detour.route.kind === "path") {
      expect(detour.route.points).not.toContainEqual({ x: 2, y: 1 });
      expect(detour.route.points).toContainEqual({ x: 2, y: 2 });
    }
    backend.dispose();
  });

  it("shares retained goal fields and samples backend-owned directions", () => {
    const runtime = createNavigationRuntime({
      backend: createGridNavigationBackend({ grid: createTestGrid(), maxRouteFields: 2 }),
      profiles: [profile]
    });
    const requestIds = [0, 1, 2].map((row) =>
      runtime.requestPath({
        id: `field.${row}`,
        requesterId: `agent.${row}`,
        profileId: profile.id,
        start: { x: 0, y: row },
        goal: { x: 4, y: 1 },
        goalKey: "shared-goal",
        routeKind: "field"
      })
    );
    runtime.update(16, 16);
    const results = requestIds.map((id) => runtime.poll(id));
    expect(results.every((result) => result.status === "complete")).toBe(true);
    expect(runtime.snapshot().backend.details).toMatchObject({
      width: 5,
      height: 3,
      walkableCells: 15,
      routeFields: 1,
      retainedRouteFields: 1
    });
    const first = results[0];
    if (first?.status !== "complete") {
      throw new Error("Expected a complete field route");
    }
    expect(runtime.sampleRoute(first.route.routeId, { x: 0, y: 1 })).toMatchObject({
      status: "valid",
      nextPoint: { x: 1, y: 1 }
    });
    runtime.dispose();
  });

  it("exposes portal traversal metadata for point paths and shared fields", () => {
    const grid: NavigationGridDefinition = {
      id: "grid.portal",
      width: 11,
      height: 1,
      cellSize: 1,
      origin: { x: 0, y: 0 },
      cells: [
        { column: 0, row: 0, area: "road" },
        { column: 10, row: 0, area: "road" }
      ]
    };
    const layout: NavigationLayoutDefinition = {
      id: "layout.grid-portal",
      backend: "grid",
      source: { type: "navigation.grid", id: grid.id },
      areas: [{ id: "road" }],
      portals: [
        {
          id: "relay",
          from: { point: { x: 0, y: 0 }, area: "road" },
          to: { point: { x: 10, y: 0 }, area: "road" },
          cost: 1
        }
      ]
    };
    const backend = createGridNavigationBackend({ grid, layout });
    const path = findPath(backend, {
      requestId: "portal.path",
      profile,
      start: { x: 0, y: 0 },
      goal: { x: 10, y: 0 },
      routeKind: "path"
    });
    expect(path).toMatchObject({
      status: "complete",
      route: {
        kind: "path",
        traversals: [{ portalId: "relay", entryPoint: { x: 0 }, exitPoint: { x: 10 } }]
      }
    });

    const field = findPath(backend, {
      requestId: "portal.field",
      profile,
      start: { x: 0, y: 0 },
      goal: { x: 10, y: 0 },
      goalKey: "relay-goal",
      routeKind: "field"
    });
    if (field.status !== "complete" || field.route.kind !== "field") {
      throw new Error("Expected a portal field route");
    }
    expect(backend.sampleRoute?.(field.route.routeKey, { x: 0, y: 0 }, profile)).toMatchObject({
      status: "valid",
      nextPoint: { x: 0, y: 0 },
      traversal: { portalId: "relay", entryPoint: { x: 0 }, exitPoint: { x: 10 } }
    });
    backend.dispose();
  });

  it("creates from a typed layout and passes the Core runtime contract", async () => {
    const grid = createTestGrid();
    const layout: NavigationLayoutDefinition = {
      id: "layout.grid-test",
      backend: "grid",
      source: { type: "navigation.grid", id: grid.id },
      areas: [
        { id: "road", cost: 1 },
        { id: "swamp", cost: 2 }
      ]
    };
    const registry = createDataRegistry();
    for (const type of [...createNavigationDataTypes(), createNavigationGridDataType()]) {
      registry.registerType(type);
    }
    registry.registerPack({
      id: "navigation.grid-test",
      version: "1",
      entries: [
        { type: "navigation.grid", id: grid.id, data: grid },
        { type: "navigation.layout", id: layout.id, data: layout },
        { type: "navigation.agent-profile", id: profile.id, data: profile }
      ]
    });

    const report = await runNavigationRuntimeConformance(() => {
      const runtime = createNavigationRuntime({
        layout: { type: "navigation.layout", id: layout.id },
        dataRegistry: registry,
        backendFactories: [createGridNavigationBackendFactory()],
        profiles: [profile]
      });
      return {
        runtime,
        profile,
        reachableStart: { x: 0, y: 1 },
        reachableGoal: { x: 4, y: 1 },
        unreachableGoal: { x: 40, y: 40 },
        blockReachableGoal: {
          id: "conformance.gate",
          target: { kind: "custom", id: "gate" },
          blocked: true
        },
        dispose: () => runtime.dispose()
      };
    });
    expect(report.checks).toContain("field route can be sampled");
    expect(report.revision).toBe(1);
  });
});

function createTestGrid(): NavigationGridDefinition {
  return {
    id: "grid.test",
    width: 5,
    height: 3,
    cellSize: 1,
    origin: { x: 0, y: 0 },
    connectivity: 4,
    dynamicObstacles: [{ id: "gate" }],
    cells: Array.from({ length: 15 }, (_, index) => {
      const column = index % 5;
      const row = Math.floor(index / 5);
      return {
        column,
        row,
        area: row === 0 ? "swamp" : "road",
        clearance: 1,
        ...(column === 2 && row === 1 ? { obstacleIds: ["gate"] } : {})
      };
    })
  };
}

function request(requestId: string): NavigationBackendPathRequest {
  return {
    requestId,
    profile,
    start: { x: 0, y: 1 },
    goal: { x: 4, y: 1 },
    goalKey: "goal",
    routeKind: "path"
  };
}

function findPath(
  backend: NavigationBackendAdapter,
  pathRequest: NavigationBackendPathRequest
): NavigationBackendPathResult {
  backend.submitPath(pathRequest);
  const result = backend.pollPath(pathRequest.requestId);
  if (result.status === "pending" || result.status === "missing") {
    throw new Error(`Expected terminal grid result, received ${result.status}`);
  }
  return result;
}
