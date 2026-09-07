import { createConfiguredAppHost } from "@gamekits/app-host";
import { createEventBus } from "@gamekits/event-bus";
import { createGame } from "@gamekits/game-runtime";
import {
  bindNavigationHandle,
  createNavigationHandle,
  createNavigationModule,
  createNavigationRuntime,
  unbindNavigationHandle,
  type NavigationAgentProfileDefinition,
  type NavigationPoint,
  type NavigationRequestResult
} from "@gamekits/navigation-core";
import { createUiRuntime } from "@gamekits/ui-core";
import { createKootaWorld } from "@gamekits/world-koota";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { navigationLabAppDefinition } from "./app-definition";
import { createNavigationLabWebProfile, type NavigationLabAppContext } from "./app-profile";
import { createNavigationLabAppSession } from "./app-session";
import {
  GRAPH_NAVIGATION_LAB_BACKEND,
  GRID_NAVIGATION_LAB_BACKEND,
  NAVIGATION_LAB_DEBUG_LAYERS,
  listNavigationLabBackendPresentations,
  listNavigationLabBackendProviders,
  requireNavigationLabBackendProvider,
  type NavigationLabBackendProvider
} from "./backends";
import { compileBlackglassTerrainGraph } from "./backends/blackglass-terrain-graph";
import { compileBlackglassTerrainGrid } from "./backends/blackglass-terrain-grid";
import { BLACKGLASS_TRANSIT_RELAY_PORTAL_ID } from "./backends/blackglass-layout";
import {
  advanceNavigationLabState,
  createNavigationLabController,
  createNavigationLabSimulationModule,
  createNavigationLabState
} from "./runtime";
import {
  NAVIGATION_LAB_PROFILES,
  NAVIGATION_LAB_SCENARIO,
  type NavigationLabScenarioDefinition
} from "./scenario";
import {
  BLACKGLASS_BASIN_SCENARIO,
  BLACKGLASS_GRAPH_NAVIGATION_LAB_BACKEND,
  BLACKGLASS_GRID_NAVIGATION_LAB_BACKEND,
  BLACKGLASS_RECAST_NAVIGATION_LAB_BACKEND,
  listNavigationLabScenarioPresentations,
  listNavigationLabScenarioProviders,
  requireNavigationLabScenarioBackend,
  requireNavigationLabScenarioProvider
} from "./scenarios";
import {
  BLACKGLASS_BASIN_TERRAIN,
  blackglassTerrainCellAt,
  blackglassTerrainCellsAlongSegment
} from "./scenarios/blackglass-basin-terrain";

const disposers: Array<() => void> = [];

beforeAll(async () => {
  await BLACKGLASS_RECAST_NAVIGATION_LAB_BACKEND.prepare?.();
});

afterEach(() => {
  for (const dispose of disposers.splice(0)) {
    dispose();
  }
});

describe("Navigation Lab backend-neutral game scene", () => {
  it("boots through App Host with provider identity and distinct DevTools sources", async () => {
    const uiRuntime = createUiRuntime();
    const context: NavigationLabAppContext = { uiRuntime };
    const configured = createConfiguredAppHost({
      app: navigationLabAppDefinition,
      profile: createNavigationLabWebProfile({
        uiRuntime,
        backend: GRAPH_NAVIGATION_LAB_BACKEND
      }),
      context
    });

    try {
      await configured.host.boot();
      await configured.host.start();
      configured.host.tick(16, 16);

      expect(context.scene?.snapshot()).toMatchObject({
        running: true,
        scenario: { id: "ashen-ford" },
        backend: { id: "graph", label: "Authored Graph" }
      });
      expect(context.scenarioId).toBe("ashen-ford");
      expect(context.backendId).toBe("graph");
      expect(context.devtools?.snapshot().dataSources.map((source) => source.id)).toEqual(
        expect.arrayContaining(["navigation", "navigation-lab"])
      );
      expect(uiRuntime.panel("gamekits.devtools.launcher")?.defaultProps).toMatchObject({
        pins: { defaultCollapsed: ["devtools.performance"] }
      });
    } finally {
      await configured.host.dispose();
    }
  });

  it("keeps the provider registry explicit and replaceable", () => {
    expect(listNavigationLabBackendProviders().map((provider) => provider.id)).toEqual([
      "graph",
      "grid"
    ]);
    expect(requireNavigationLabBackendProvider("graph")).toBe(GRAPH_NAVIGATION_LAB_BACKEND);
    expect(requireNavigationLabBackendProvider("grid")).toBe(GRID_NAVIGATION_LAB_BACKEND);
    expect(() => requireNavigationLabBackendProvider("navmesh")).toThrow(
      "Unknown Navigation Lab backend: navmesh"
    );
  });

  it("keeps every scenario/backend combination explicit in one composition registry", () => {
    const scenarios = listNavigationLabScenarioProviders();
    expect(scenarios.map((scenario) => scenario.definition.id)).toEqual([
      "ashen-ford",
      "blackglass-basin"
    ]);
    expect(
      scenarios.map((scenario) => ({
        id: scenario.definition.id,
        backends: scenario.backends.map((backend) => backend.id)
      }))
    ).toEqual([
      { id: "ashen-ford", backends: ["graph", "grid"] },
      { id: "blackglass-basin", backends: ["graph", "grid", "recast"] }
    ]);
    expect(requireNavigationLabScenarioProvider("blackglass-basin").definition).toBe(
      BLACKGLASS_BASIN_SCENARIO
    );
    expect(requireNavigationLabScenarioBackend("blackglass-basin", "graph")).toBe(
      BLACKGLASS_GRAPH_NAVIGATION_LAB_BACKEND
    );
    expect(requireNavigationLabScenarioBackend("blackglass-basin", "recast")).toBe(
      BLACKGLASS_RECAST_NAVIGATION_LAB_BACKEND
    );
  });

  it("projects backend-owned navigation data into shared debug drawing layers", () => {
    const presentations = listNavigationLabBackendPresentations();
    expect(NAVIGATION_LAB_DEBUG_LAYERS.map((layer) => layer.id)).toEqual([
      "topology",
      "areas",
      "constraints"
    ]);
    expect(presentations.map((presentation) => presentation.id)).toEqual(["graph", "grid"]);

    const graphView = GRAPH_NAVIGATION_LAB_BACKEND.debugView;
    expect(graphView).toMatchObject({ backendId: "graph" });
    expect(graphView.areaCosts).toMatchObject({ ground: 1, swamp: 1.7 });
    expect(graphView.shapes.filter((shape) => shape.kind === "point")).toHaveLength(11);
    expect(graphView.shapes.filter((shape) => shape.kind === "polyline")).toHaveLength(13);
    expect(graphView.shapes.some((shape) => shape.stateBinding === "bridge")).toBe(true);
    expect(graphView.shapes.some((shape) => shape.stateBinding === "waystone")).toBe(true);

    const gridView = GRID_NAVIGATION_LAB_BACKEND.debugView;
    expect(gridView).toMatchObject({ backendId: "grid" });
    expect(gridView.areaCosts).toMatchObject({ ground: 1, swamp: 1.7 });
    expect(gridView.shapes.filter((shape) => shape.kind === "polygon").length).toBeGreaterThan(500);
    expect(gridView.shapes.some((shape) => shape.stateBinding === "ridgeTrail")).toBe(true);
    expect(gridView.shapes.some((shape) => shape.stateBinding === "marsh")).toBe(true);
    expect(presentations.find((presentation) => presentation.id === "grid")?.debugView).toBe(
      gridView
    );

    const blackglass = listNavigationLabScenarioPresentations().find(
      (scenario) => scenario.definition.id === "blackglass-basin"
    );
    const blackglassGraph = blackglass?.backends.find((backend) => backend.id === "graph");
    const blackglassGrid = blackglass?.backends.find((backend) => backend.id === "grid");
    const blackglassRecast = blackglass?.backends.find((backend) => backend.id === "recast");
    const compiledGraph = compileBlackglassTerrainGraph("test.blackglass.graph");
    const compiledGrid = compileBlackglassTerrainGrid("test.blackglass.grid");
    expect(
      blackglassGraph?.debugView.shapes.filter((shape) => shape.kind === "point")
    ).toHaveLength(compiledGraph.nodes.length);
    expect(
      blackglassGraph?.debugView.shapes.filter((shape) => shape.kind === "polyline")
    ).toHaveLength(compiledGraph.edges.length + 1);
    expect(
      blackglassGrid?.debugView.shapes.filter((shape) => shape.kind === "polygon").length
    ).toBe(compiledGrid.cells.length);
    expect(
      blackglassRecast?.debugView.shapes.filter((shape) => shape.kind === "polygon").length
    ).toBeGreaterThan(0);
    expect(blackglassRecast?.debugView.areaCosts).toMatchObject({
      ground: 1,
      road: 0.95,
      swamp: 1.65
    });
    expect(
      blackglassRecast?.debugView.shapes
        .filter((shape) => shape.kind === "polygon")
        .every((shape) => shape.area !== undefined)
    ).toBe(true);
    expect(
      new Set(
        blackglassRecast?.debugView.shapes
          .filter((shape) => shape.kind === "polygon")
          .map((shape) => shape.area)
      )
    ).toEqual(new Set(["blast-door", "gantry", "ground", "ridge", "road", "swamp"]));
    expect(blackglassRecast?.debugView.summary).toContain("generated polygons");
    expect(blackglassRecast?.debugView.shapes.some((shape) => shape.stateBinding === "marsh")).toBe(
      true
    );
    expect(
      blackglassRecast?.debugView.shapes.some((shape) => shape.stateBinding === "waystone")
    ).toBe(true);
  });

  it("keeps Blackglass Graph sparse and validates its authored routes against terrain", () => {
    const graph = compileBlackglassTerrainGraph("test.blackglass.graph");
    const grid = compileBlackglassTerrainGrid("test.blackglass.grid");
    const terrainByPoint = new Map(
      BLACKGLASS_BASIN_TERRAIN.cells.map((cell) => [`${cell.point.x}:${cell.point.y}`, cell])
    );
    const graphNodes = new Map(graph.nodes.map((node) => [node.id, node]));

    expect(BLACKGLASS_BASIN_TERRAIN.cells.length).toBeGreaterThan(250);
    expect(
      BLACKGLASS_BASIN_TERRAIN.width * BLACKGLASS_BASIN_TERRAIN.height -
        BLACKGLASS_BASIN_TERRAIN.cells.length
    ).toBeGreaterThan(150);
    expect(new Set(BLACKGLASS_BASIN_TERRAIN.cells.map((cell) => cell.area))).toEqual(
      new Set(["ground", "road", "ridge", "swamp", "blast-door", "gantry"])
    );
    expect(graph.nodes.length).toBeGreaterThan(8);
    expect(graph.nodes.length).toBeLessThan(24);
    expect(graph.edges.length).toBeGreaterThan(graph.nodes.length);
    expect(graph.tags).toContain("authored-semantic-route-graph");
    expect(graph.nodes.every((node) => node.tags?.includes("designer-authored"))).toBe(true);
    expect(graph.edges.every((edge) => edge.tags?.includes("semantic-route-segment"))).toBe(true);
    expect(grid.cells).toHaveLength(BLACKGLASS_BASIN_TERRAIN.cells.length * 4);

    for (const node of graph.nodes) {
      expect(terrainByPoint.has(`${node.point.x}:${node.point.y}`)).toBe(true);
    }
    for (const edge of graph.edges) {
      const from = graphNodes.get(edge.from);
      const to = graphNodes.get(edge.to);
      expect(from).toBeDefined();
      expect(to).toBeDefined();
      expect(
        from === undefined || to === undefined
          ? undefined
          : blackglassTerrainCellsAlongSegment(from.point, to.point)
      ).toBeDefined();
    }
    for (const cell of grid.cells) {
      expect(
        blackglassTerrainCellAt(Math.floor(cell.column / 2), Math.floor(cell.row / 2))
      ).toBeDefined();
    }
  });

  it("registers provider-owned layout/source data and shared unit profiles", () => {
    for (const provider of [GRAPH_NAVIGATION_LAB_BACKEND, GRID_NAVIGATION_LAB_BACKEND]) {
      const registry = provider.createDataRegistry();
      const layout = registry.getValue("navigation.layout", provider.layoutRef.id);

      expect(layout).toMatchObject({
        id: provider.layoutRef.id,
        backend: provider.id
      });
      const source = (layout as { source: { type: string; id: string } }).source;
      expect(source.type).toBe(`navigation.${provider.id}`);
      expect(registry.getValue(source.type, source.id)).toMatchObject({
        tags: expect.arrayContaining(["ashen-ford"])
      });
      expect(registry.list("navigation.agent-profile")).toHaveLength(3);
      expect(registry.references()).toContainEqual(
        expect.objectContaining({
          from: { type: "navigation.layout", id: provider.layoutRef.id },
          to: source
        })
      );
    }
  });

  it("runs the same scene/controller contract through the Grid backend", () => {
    const harness = createHarness(GRID_NAVIGATION_LAB_BACKEND);

    expect(harness.scene.snapshot()).toMatchObject({
      backend: { id: "grid", label: "Traversal Grid" },
      start: NAVIGATION_LAB_SCENARIO.start,
      goal: NAVIGATION_LAB_SCENARIO.goal
    });
    harness.scene.requestPath();
    harness.tick();
    expect(harness.scene.snapshot().lastResult).toMatchObject({
      status: "complete",
      route: { kind: "path" }
    });
  });

  it("runs one controller and query contract across the scenario/backend matrix", () => {
    for (const scenario of listNavigationLabScenarioProviders()) {
      for (const backend of scenario.backends) {
        const harness = createHarness(backend, scenario.definition);
        expect(harness.scene.snapshot()).toMatchObject({
          scenario: { id: scenario.definition.id },
          backend: { id: backend.id },
          start: scenario.definition.start,
          goal: scenario.definition.goal
        });

        harness.scene.requestPath();
        harness.tick();
        const pathResult = harness.scene.snapshot().lastResult;
        expect(pathResult).toMatchObject({
          status: "complete",
          route: { kind: "path" }
        });
        if (
          scenario.definition.id === "blackglass-basin" &&
          (backend.id === "grid" || backend.id === "recast") &&
          pathResult?.status === "complete" &&
          pathResult.route.kind === "path"
        ) {
          expect(Math.min(...pathResult.route.points.map((point) => point.y))).toBeLessThan(-6);
        }
        if (scenario.definition.id === "blackglass-basin" && backend.id === "grid") {
          if (pathResult?.status !== "complete" || pathResult.route.kind !== "path") {
            throw new Error("Expected a complete Grid path before simulating the agent");
          }
          harness.tick(16, 900);
          const agent = harness.scene.snapshot().agents[0];
          if (agent === undefined) {
            throw new Error("Expected the Grid path agent to remain active");
          }
          expect(agent.progress).toBe("arrived");
          expect(agent.remainingDistance).toBeLessThanOrEqual(0.12);
          expect(
            Math.hypot(
              agent.position.x - pathResult.route.goalProjection.point.x,
              agent.position.y - pathResult.route.goalProjection.point.y
            )
          ).toBeLessThanOrEqual(0.12);
        }

        harness.scene.requestField();
        harness.tick(16, 1);
        if (backend.id === "recast") {
          let rallySnapshot = harness.scene.snapshot();
          expect(rallySnapshot).toMatchObject({
            lastResult: { status: "complete", route: { kind: "field" } },
            agents: expect.any(Array),
            navigation: {
              backend: {
                capabilities: { routeFields: true, dynamicObstacles: ["area", "portal"] },
                details: {
                  polygons: expect.any(Number),
                  navMeshBytes: expect.any(Number),
                  routeFields: 1,
                  retainedRouteFields: 1
                }
              }
            }
          });
          expect(rallySnapshot.agents).toHaveLength(scenario.definition.fieldAgentStarts.length);
          expect(rallySnapshot.activeRoutes).toHaveLength(1);
          expect(new Set(rallySnapshot.agents.map((agent) => agent.routeId))).toEqual(
            new Set([rallySnapshot.activeRoutes[0]?.routeId])
          );
          const initialPartyPosition = rallySnapshot.agents[0]?.position;
          harness.tick(16, 20);
          rallySnapshot = harness.scene.snapshot();
          expect(rallySnapshot.agents[0]?.position).not.toEqual(initialPartyPosition);
          harness.scene.toggleGate();
          expect(harness.scene.snapshot().lastObstacleResult).toMatchObject({
            status: "changed",
            revision: 1
          });
          harness.scene.releaseRoute();
          expect(harness.scene.snapshot()).toMatchObject({
            activeRoutes: [],
            agents: [],
            navigation: { retainedRoutes: 0 }
          });
        } else {
          expect(harness.scene.snapshot()).toMatchObject({
            lastResult: { status: "complete", route: { kind: "field" } },
            agents: expect.any(Array)
          });
          expect(harness.scene.snapshot().agents).toHaveLength(
            scenario.definition.fieldAgentStarts.length
          );
        }
        if (scenario.definition.id === "blackglass-basin") {
          harness.scene.reset();
          harness.scene.togglePortal();
          harness.scene.requestField();
          harness.tick();
          let relaySnapshot = harness.scene.snapshot();
          const relaySample = relaySnapshot.fieldVectors.find(
            ({ point }) =>
              point.x === BLACKGLASS_BASIN_TERRAIN.relay.from.x &&
              point.y === BLACKGLASS_BASIN_TERRAIN.relay.from.y
          )?.sample;
          expect(relaySample).toMatchObject({
            status: "valid",
            traversal: {
              kind: "portal",
              portalId: BLACKGLASS_TRANSIT_RELAY_PORTAL_ID
            }
          });
          if (relaySample?.status === "valid" && relaySample.traversal !== undefined) {
            expect(relaySample.nextPoint).toEqual(relaySample.traversal.entryPoint);
            expect(
              Math.hypot(
                relaySample.traversal.entryPoint.x - BLACKGLASS_BASIN_TERRAIN.relay.from.x,
                relaySample.traversal.entryPoint.y - BLACKGLASS_BASIN_TERRAIN.relay.from.y
              )
            ).toBeLessThan(0.5);
            expect(
              Math.hypot(
                relaySample.traversal.exitPoint.x - BLACKGLASS_BASIN_TERRAIN.relay.to.x,
                relaySample.traversal.exitPoint.y - BLACKGLASS_BASIN_TERRAIN.relay.to.y
              )
            ).toBeLessThan(0.5);
          }
          for (let tick = 0; tick < 1_000; tick += 1) {
            harness.tick();
            const firstAgent = harness.scene.snapshot().agents[0];
            if (
              firstAgent !== undefined &&
              firstAgent.position.x >= BLACKGLASS_BASIN_TERRAIN.relay.to.x - 0.12
            ) {
              break;
            }
          }
          relaySnapshot = harness.scene.snapshot();
          expect(relaySnapshot.agents[0]?.position.x).toBeGreaterThanOrEqual(
            BLACKGLASS_BASIN_TERRAIN.relay.to.x - 0.12
          );
          expect(relaySnapshot.agents[0]?.progress).not.toMatch(/route-(missing|stale)/);

          if (backend.id === "recast") {
            harness.scene.reset();
            harness.scene.setProfile("profile.heavy");
            harness.scene.togglePortal();
            harness.scene.requestPath();
            harness.tick();
            expect(harness.scene.snapshot().lastResult).toMatchObject({
              status: "complete",
              route: {
                kind: "path",
                traversals: [
                  {
                    kind: "portal",
                    portalId: BLACKGLASS_TRANSIT_RELAY_PORTAL_ID
                  }
                ]
              }
            });
          }
        }
      }
    }
  });

  it("rebuilds an App Host session for a new provider without changing the scene API", async () => {
    const uiRuntime = createUiRuntime();
    const first = await createNavigationLabAppSession({
      uiRuntime,
      backend: GRAPH_NAVIGATION_LAB_BACKEND
    });
    let controllerApi: string[];
    try {
      controllerApi = Object.keys(first.scene).sort();
      first.scene.requestPath();
      first.tick(16, 16);
      expect(first.scene.snapshot().lastResult?.status).toBe("complete");
    } finally {
      await first.dispose();
    }

    const second = await createNavigationLabAppSession({
      uiRuntime,
      scenario: BLACKGLASS_BASIN_SCENARIO,
      backend: BLACKGLASS_GRID_NAVIGATION_LAB_BACKEND
    });
    try {
      expect(Object.keys(second.scene).sort()).toEqual(controllerApi);
      expect(second.scene.snapshot()).toMatchObject({
        scenario: { id: "blackglass-basin" },
        backend: { id: "grid" }
      });
      second.scene.requestPath();
      second.tick(16, 16);
      expect(second.scene.snapshot().lastResult?.status).toBe("complete");
    } finally {
      await second.dispose();
    }
  });

  it("runs path projection and demonstrates positive path caching", () => {
    const harness = createHarness();
    harness.scene.setPointMode("probe");
    harness.scene.placePoint({ x: -2.8, y: -2.7 });
    expect(harness.scene.snapshot().projection).toMatchObject({
      backendNodeId: "hunter-trail-west",
      area: "ridge"
    });

    harness.scene.requestPath();
    harness.tick();
    expect(harness.scene.snapshot().lastResult).toMatchObject({
      status: "complete",
      cache: "miss",
      route: { kind: "path" }
    });

    harness.scene.repeatLastRequest();
    harness.tick();
    expect(harness.scene.snapshot().lastResult).toMatchObject({
      status: "complete",
      cache: "hit",
      route: { kind: "path" }
    });

    harness.scene.setProfile("profile.heavy");
    harness.scene.placePoint({ x: -3, y: -3 });
    expect(harness.scene.snapshot().projection?.area).not.toBe("ridge");
  });

  it("shares one retained field, samples a party, reports stuck, and releases symmetrically", () => {
    const harness = createHarness();
    harness.scene.requestField();
    harness.tick();
    let snapshot = harness.scene.snapshot();
    expect(snapshot.activeRoute?.kind).toBe("field");
    expect(snapshot.agents).toHaveLength(NAVIGATION_LAB_SCENARIO.fieldAgentStarts.length);
    expect(snapshot.fieldVectors.some((vector) => vector.sample.status === "valid")).toBe(true);
    expect(snapshot.navigation).toMatchObject({ retainedRoutes: 1 });
    expect(snapshot.navigation.backend.details).toMatchObject({
      routeFields: 1,
      retainedRouteFields: 1
    });

    const initialX = snapshot.agents[0]?.position.x;
    harness.tick(16, 20);
    snapshot = harness.scene.snapshot();
    expect(snapshot.agents[0]?.position.x).toBeGreaterThan(initialX ?? -Infinity);

    harness.scene.toggleAgentsFrozen();
    harness.tick(100, 14);
    snapshot = harness.scene.snapshot();
    expect(snapshot.agents.some((agent) => agent.progress === "stuck")).toBe(true);

    harness.scene.releaseRoute();
    snapshot = harness.scene.snapshot();
    expect(snapshot.navigation.retainedRoutes).toBe(0);
    expect(snapshot.navigation.backend.details).toMatchObject({ retainedRouteFields: 0 });
    expect(snapshot.releasedSample?.status).toBe("missing");
  });

  it("maps game-world bridge, marsh, and waystone actions into backend obstacle targets", () => {
    for (const backend of [GRAPH_NAVIGATION_LAB_BACKEND, GRID_NAVIGATION_LAB_BACKEND]) {
      const harness = createHarness(backend);
      harness.scene.setProfile("profile.hauler");
      harness.scene.requestPath();
      harness.tick();
      expect(harness.scene.snapshot().activeRoute?.kind).toBe("path");

      harness.scene.toggleGate();
      expect(harness.scene.snapshot().lastObstacleResult).toMatchObject({
        status: "changed",
        revision: 1
      });
      harness.tick();
      expect(harness.scene.snapshot().agents[0]?.progress).toBe("route-stale");

      harness.scene.requestPath();
      harness.tick();
      expect(harness.scene.snapshot().lastResult?.status).toBe("complete");

      harness.scene.cycleSwamp();
      expect(harness.scene.snapshot()).toMatchObject({ swampMode: "costly" });
      harness.scene.cycleSwamp();
      expect(harness.scene.snapshot()).toMatchObject({ swampMode: "blocked" });
      harness.scene.togglePortal();
      expect(harness.scene.snapshot()).toMatchObject({ portalEnabled: true });
      harness.scene.probeUnsupportedObstacle();
      expect(harness.scene.snapshot().lastObstacleResult?.status).toBe("unsupported");
    }
  });

  it("exercises layered rerouting, unreachable state, and relay recovery in Blackglass Basin", () => {
    for (const backend of [
      BLACKGLASS_GRAPH_NAVIGATION_LAB_BACKEND,
      BLACKGLASS_GRID_NAVIGATION_LAB_BACKEND
    ]) {
      const harness = createHarness(backend, BLACKGLASS_BASIN_SCENARIO);
      harness.scene.setProfile("profile.hauler");
      harness.scene.requestPath();
      harness.tick();
      const initialResult = harness.scene.snapshot().lastResult;
      expect(initialResult).toMatchObject({ status: "complete" });
      expectBlackglassTerrainRoute(initialResult);

      harness.scene.toggleGate();
      harness.scene.requestPath();
      harness.tick();
      const gatedSnapshot = harness.scene.snapshot();
      const gatedResult = gatedSnapshot.lastResult;
      expect(gatedSnapshot).toMatchObject({
        gateBlocked: true,
        lastResult: { status: "complete" }
      });
      expectBlackglassTerrainRoute(gatedResult);
      if (
        initialResult?.status === "complete" &&
        initialResult.route.kind === "path" &&
        gatedResult?.status === "complete" &&
        gatedResult.route.kind === "path"
      ) {
        expect(gatedResult.route.points).not.toEqual(initialResult.route.points);
        expect(gatedResult.route.cost).toBeGreaterThan(initialResult.route.cost);
      }

      harness.scene.cycleSwamp();
      harness.scene.cycleSwamp();
      harness.scene.requestPath();
      harness.tick();
      expect(harness.scene.snapshot()).toMatchObject({
        swampMode: "blocked",
        lastResult: { status: "failed", reason: "unreachable" }
      });

      harness.scene.togglePortal();
      harness.scene.requestPath();
      harness.tick();
      expect(harness.scene.snapshot()).toMatchObject({
        portalEnabled: true,
        lastResult: { status: "complete" }
      });

      harness.scene.runLockdown();
      harness.tick();
      expect(harness.scene.snapshot()).toMatchObject({
        lockdown: true,
        ridgeBlocked: true,
        portalEnabled: false,
        lastResult: { status: "failed", reason: "unreachable" }
      });
    }
  });

  it("covers cancellation, cost failure, unreachable lockdown, and budgeted queue drain", () => {
    const harness = createHarness();
    harness.scene.cancelProbe();
    harness.tick();
    expect(harness.scene.snapshot().lastResult?.status).toBe("cancelled");

    harness.scene.requestCostCappedPath();
    harness.tick();
    expect(harness.scene.snapshot().lastResult).toMatchObject({
      status: "failed",
      reason: "cost-limit"
    });

    harness.scene.runLockdown();
    harness.tick();
    expect(harness.scene.snapshot().lastResult).toMatchObject({
      status: "failed",
      reason: "unreachable"
    });

    harness.scene.reset();
    harness.scene.runBurst(18);
    expect(harness.scene.snapshot().navigation.queuedRequests).toBe(18);
    harness.tick(16, 12);
    const snapshot = harness.scene.snapshot();
    expect(snapshot.burst).toMatchObject({
      total: 18,
      pending: 0,
      completed: 18,
      failed: 0
    });
    expect(snapshot.navigation).toMatchObject({ pendingRequests: 0, retainedRoutes: 0 });
  });

  it("runs a backend-neutral live unit stress test on one shared route field", () => {
    for (const backend of [
      BLACKGLASS_GRAPH_NAVIGATION_LAB_BACKEND,
      BLACKGLASS_GRID_NAVIGATION_LAB_BACKEND,
      BLACKGLASS_RECAST_NAVIGATION_LAB_BACKEND
    ]) {
      const harness = createDirectNavigationHarness(backend, BLACKGLASS_BASIN_SCENARIO);
      try {
        expect(harness.scene.runStress(250)).toBeDefined();
        harness.tick(16, 40);

        const running = harness.scene.snapshot();
        expect(running.stress).toMatchObject({
          status: "running",
          targetAgents: 250,
          activeAgents: 250,
          samplesPerTick: 250,
          budgetMs: 4
        });
        expect(running.stress?.sampledTicks).toBeGreaterThanOrEqual(30);
        expect(typeof running.stress?.withinBudget).toBe("boolean");
        expect(running.agents).toHaveLength(250);
        expect(running.activeRoute?.kind).toBe("field");
        expect(running.navigation.retainedRoutes).toBe(1);

        harness.scene.stopStress();
        expect(harness.scene.snapshot()).toMatchObject({
          stress: { status: "stopped", activeAgents: 0, samplesPerTick: 0 },
          agents: [],
          navigation: { retainedRoutes: 0 }
        });
      } finally {
        harness.dispose();
      }
    }
  });
});

function createHarness(
  backend: NavigationLabBackendProvider = GRAPH_NAVIGATION_LAB_BACKEND,
  scenario: NavigationLabScenarioDefinition = NAVIGATION_LAB_SCENARIO
) {
  const registry = backend.createDataRegistry();
  const navigation = createNavigationHandle({
    id: `navigation-lab.test.${scenario.id}.${backend.id}`
  });
  const state = createNavigationLabState(navigation, backend, scenario);
  const runtime = createGame({
    world: createKootaWorld(),
    eventBus: createEventBus(),
    seed: `navigation-lab-test-${scenario.id}-${backend.id}`,
    modules: [
      createNavigationModule({
        id: `navigation-lab.test.${scenario.id}.${backend.id}`,
        layout: backend.layoutRef,
        backendFactories: backend.createBackendFactories(),
        dataRegistry: registry,
        profiles: cloneProfiles(),
        handle: navigation,
        maxRequestsPerTick: 2,
        maxBackendPollsPerTick: 4,
        maxPendingRequests: 48,
        maxPendingPerRequester: 8,
        maxRetainedRoutes: 32,
        maxCacheEntries: 48,
        cacheTtlMs: 60_000,
        negativeCacheTtlMs: 5_000
      }),
      createNavigationLabSimulationModule(state, navigation)
    ]
  });
  const scene = createNavigationLabController({ navigation, state });
  runtime.start();
  let disposed = false;
  const dispose = () => {
    if (disposed) {
      return;
    }
    disposed = true;
    runtime.dispose();
  };
  disposers.push(dispose);
  return {
    scene,
    dispose,
    tick(delta = 16, count = 1) {
      for (let index = 0; index < count; index += 1) {
        runtime.tick(delta);
      }
    }
  };
}

function createDirectNavigationHarness(
  backend: NavigationLabBackendProvider,
  scenario: NavigationLabScenarioDefinition
) {
  const ownerId = `navigation-lab.stress-test.${scenario.id}.${backend.id}`;
  const navigation = createNavigationRuntime({
    id: ownerId,
    layout: backend.layoutRef,
    backendFactories: backend.createBackendFactories(),
    dataRegistry: backend.createDataRegistry(),
    profiles: cloneProfiles(),
    maxRequestsPerTick: 2,
    maxBackendPollsPerTick: 4,
    maxPendingRequests: 48,
    maxPendingPerRequester: 8,
    maxRetainedRoutes: 32,
    maxCacheEntries: 48
  });
  const handle = createNavigationHandle({ id: `${ownerId}.handle` });
  bindNavigationHandle(handle, navigation, ownerId);
  const state = createNavigationLabState(handle, backend, scenario);
  const scene = createNavigationLabController({ navigation: handle, state });
  state.running = true;
  let elapsed = 0;
  let disposed = false;
  const dispose = () => {
    if (disposed) {
      return;
    }
    disposed = true;
    unbindNavigationHandle(handle, ownerId);
    navigation.dispose();
  };
  disposers.push(dispose);
  return {
    scene,
    dispose,
    tick(delta = 16, count = 1) {
      for (let index = 0; index < count; index += 1) {
        elapsed += delta;
        navigation.update(delta, elapsed);
        advanceNavigationLabState(state, handle, delta, elapsed);
      }
    }
  };
}

function expectBlackglassTerrainRoute(result: NavigationRequestResult | undefined): void {
  expect(result?.status).toBe("complete");
  if (result?.status !== "complete" || result.route.kind !== "path") {
    return;
  }
  expect(result.route.points.length).toBeGreaterThan(3);
  expect(countRouteTurns(result.route.points)).toBeGreaterThanOrEqual(2);
  for (const point of result.route.points) {
    const column = Math.floor(
      (point.x - BLACKGLASS_BASIN_TERRAIN.bounds.minX) / BLACKGLASS_BASIN_TERRAIN.tileSize
    );
    const row = Math.floor(
      (point.y - BLACKGLASS_BASIN_TERRAIN.bounds.minY) / BLACKGLASS_BASIN_TERRAIN.tileSize
    );
    expect(blackglassTerrainCellAt(column, row)).toBeDefined();
  }
}

function countRouteTurns(points: readonly NavigationPoint[]): number {
  let turns = 0;
  let previousDirection: string | undefined;
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const current = points[index];
    if (previous === undefined || current === undefined) {
      continue;
    }
    const direction = `${Math.sign(current.x - previous.x)}:${Math.sign(current.y - previous.y)}`;
    if (previousDirection !== undefined && direction !== previousDirection) {
      turns += 1;
    }
    previousDirection = direction;
  }
  return turns;
}

function cloneProfiles(): NavigationAgentProfileDefinition[] {
  return NAVIGATION_LAB_PROFILES.map((profile) => ({
    ...profile,
    allowedAreas: [...profile.allowedAreas],
    costOverrides: { ...profile.costOverrides },
    tags: [...profile.tags]
  }));
}
