import { createDataRegistry, type DataPack, type DataRegistry } from "@gamekits/data";
import {
  createNavigationAgentProfileDataType,
  createNavigationLayoutDataType,
  type NavigationLayoutDefinition
} from "@gamekits/navigation-core";
import {
  createGraphNavigationBackendFactory,
  createNavigationGraphDataType,
  type NavigationGraphDefinition
} from "@gamekits/navigation-graph";
import { NAVIGATION_LAB_PROFILES } from "../scenario";
import type { NavigationLabBackendProvider } from "./contract";
import type {
  NavigationLabBackendDebugView,
  NavigationLabDebugShape,
  NavigationLabDebugStateBinding
} from "./debug-view";
import { createNavigationLabDebugAreaCosts } from "./debug-view";

const BRIDGE_EDGE_ID = "edge.ashen-ford.bridge";
const RIDGE_EDGE_ID = "edge.ashen-ford.hunter-trail";
const MARSH_AREA_ID = "swamp";
const WAYSTONE_PORTAL_ID = "portal.ashen-ford.waystones";

export function createGraphNavigationLabBackendProvider(
  options: { id?: string; label?: string } = {}
): NavigationLabBackendProvider {
  const id = options.id ?? "graph";
  const graphId = `navigation-lab.graph.ashen-ford.${id}`;
  const layoutId = `navigation-lab.layout.ashen-ford.${id}`;
  const graph = createAshenFordGraph(graphId);
  const layout = createAshenFordLayout(layoutId, graphId, id);

  return {
    id,
    label: options.label ?? "Authored Graph",
    technology: "Sparse route graph",
    description: "Deterministic authored crossings with shared reverse route fields.",
    layoutRef: { type: "navigation.layout", id: layoutId },
    obstacleBindings: {
      bridge: { kind: "edge", id: BRIDGE_EDGE_ID },
      ridgeTrail: { kind: "edge", id: RIDGE_EDGE_ID },
      marsh: { kind: "area", id: MARSH_AREA_ID },
      waystone: { kind: "portal", id: WAYSTONE_PORTAL_ID }
    },
    debugView: createGraphDebugView(id, graph, layout),
    createDataRegistry() {
      return createGraphDataRegistry(id, graph, layout);
    },
    createBackendFactories() {
      return [createGraphNavigationBackendFactory({ id, maxRouteFields: 8 })];
    }
  };
}

export const GRAPH_NAVIGATION_LAB_BACKEND = createGraphNavigationLabBackendProvider();

function createGraphDebugView(
  backendId: string,
  graph: NavigationGraphDefinition,
  layout: NavigationLayoutDefinition
): NavigationLabBackendDebugView {
  const nodes = new Map(graph.nodes.map((definition) => [definition.id, definition]));
  const shapes: NavigationLabDebugShape[] = [];

  for (const edgeDefinition of graph.edges) {
    const from = nodes.get(edgeDefinition.from);
    const to = nodes.get(edgeDefinition.to);
    if (!from || !to) {
      continue;
    }
    shapes.push({
      kind: "polyline",
      points: [from.point, to.point],
      lineWidth: 0.08,
      ...(edgeDefinition.area === undefined ? {} : { area: edgeDefinition.area }),
      ...(edgeDefinition.width === undefined ? {} : { width: edgeDefinition.width }),
      ...(edgeDefinition.heightClearance === undefined
        ? {}
        : { heightClearance: edgeDefinition.heightClearance }),
      ...(edgeDefinition.slope === undefined ? {} : { slope: edgeDefinition.slope }),
      ...debugStateBinding(edgeDefinition.id, edgeDefinition.area)
    });
  }

  for (const nodeDefinition of graph.nodes) {
    shapes.push({
      kind: "point",
      point: nodeDefinition.point,
      radius: 0.13,
      ...(nodeDefinition.area === undefined ? {} : { area: nodeDefinition.area }),
      ...(nodeDefinition.clearance === undefined ? {} : { clearance: nodeDefinition.clearance }),
      ...(nodeDefinition.heightClearance === undefined
        ? {}
        : { heightClearance: nodeDefinition.heightClearance }),
      ...debugStateBinding(nodeDefinition.id, nodeDefinition.area)
    });
  }

  for (const portal of layout.portals ?? []) {
    shapes.push({
      kind: "polyline",
      points: [portal.from.point, portal.to.point],
      lineWidth: 0.06,
      dashed: true,
      stateBinding: "waystone"
    });
  }

  return {
    backendId,
    summary: `${graph.nodes.length} nodes · ${graph.edges.length} edges · ${layout.portals?.length ?? 0} portal`,
    areaCosts: createNavigationLabDebugAreaCosts(layout),
    shapes
  };
}

function debugStateBinding(
  id: string,
  area: string | undefined
): { stateBinding?: NavigationLabDebugStateBinding } {
  if (id === BRIDGE_EDGE_ID) {
    return { stateBinding: "bridge" };
  }
  if (id === RIDGE_EDGE_ID) {
    return { stateBinding: "ridgeTrail" };
  }
  if (area === MARSH_AREA_ID) {
    return { stateBinding: "marsh" };
  }
  return {};
}

function createAshenFordGraph(id: string): NavigationGraphDefinition {
  return {
    id,
    nodes: [
      node("ember-camp", -8, 0, "ground", 1.3, 3.2),
      node("pine-fork", -6, 0, "road", 1.3, 3.2),
      node("hunter-trail-west", -3, -3, "ridge", 0.55, 1.9),
      node("hunter-trail-east", 3, -3, "ridge", 0.55, 1.9),
      node("bridge-west", -2, 0, "road", 1.3, 3.2),
      node("bridge-east", 2, 0, "road", 1.3, 3.2),
      node("reed-marsh-west", -3, 3, "swamp", 1.3, 3.2),
      node("floodplain", 0, 3.5, "swamp", 1.3, 3.2),
      node("reed-marsh-east", 3, 3, "swamp", 1.3, 3.2),
      node("watch-fork", 6, 0, "road", 1.3, 3.2),
      node("northwatch", 8, 0, "ground", 1.3, 3.2)
    ],
    edges: [
      edge("edge.ember-pine", "ember-camp", "pine-fork", "ground", 3.2, 0.02),
      edge("edge.pine-hunter", "pine-fork", "hunter-trail-west", "ridge", 1.1, 0.42, 1.9),
      edge(RIDGE_EDGE_ID, "hunter-trail-west", "hunter-trail-east", "ridge", 1.1, 0.52, 1.9),
      edge("edge.hunter-watch", "hunter-trail-east", "watch-fork", "ridge", 1.1, 0.42, 1.9),
      edge("edge.pine-bridge", "pine-fork", "bridge-west", "road", 2.4, 0.05, 3),
      edge(BRIDGE_EDGE_ID, "bridge-west", "bridge-east", "road", 2.4, 0.08, 3),
      edge("edge.bridge-watch", "bridge-east", "watch-fork", "road", 2.4, 0.05, 3),
      edge("edge.pine-marsh", "pine-fork", "reed-marsh-west", "swamp", 3.2, 0.02),
      edge("edge.marsh-west", "reed-marsh-west", "floodplain", "swamp", 3.2, 0.01),
      edge("edge.marsh-east", "floodplain", "reed-marsh-east", "swamp", 3.2, 0.01),
      edge("edge.marsh-watch", "reed-marsh-east", "watch-fork", "swamp", 3.2, 0.02),
      edge("edge.watch-northwatch", "watch-fork", "northwatch", "ground", 3.2, 0.02)
    ],
    tags: ["navigation-lab", "ashen-ford", "authored-graph"]
  };
}

function createAshenFordLayout(
  id: string,
  graphId: string,
  backendId: string
): NavigationLayoutDefinition {
  return {
    id,
    backend: backendId,
    source: { type: "navigation.graph", id: graphId },
    areas: [
      { id: "ground", cost: 1 },
      { id: "road", cost: 1 },
      { id: "ridge", cost: 1 },
      { id: MARSH_AREA_ID, cost: 1.7 }
    ],
    portals: [
      {
        id: WAYSTONE_PORTAL_ID,
        from: { point: { x: -6, y: 0 }, area: "road" },
        to: { point: { x: 6, y: 0 }, area: "road" },
        cost: 2,
        bidirectional: true,
        enabled: false
      }
    ],
    tags: ["navigation-lab", "ashen-ford", backendId]
  };
}

function createGraphDataRegistry(
  backendId: string,
  graph: NavigationGraphDefinition,
  layout: NavigationLayoutDefinition
): DataRegistry {
  const registry = createDataRegistry();
  registry.registerType(createNavigationAgentProfileDataType());
  registry.registerType(createNavigationLayoutDataType());
  registry.registerType(createNavigationGraphDataType());
  const pack: DataPack = {
    id: `sandbox.navigation-lab.${backendId}`,
    version: "1.0.0",
    entries: [
      { type: "navigation.graph", id: graph.id, data: graph },
      { type: "navigation.layout", id: layout.id, data: layout },
      ...NAVIGATION_LAB_PROFILES.map((profile) => ({
        type: "navigation.agent-profile",
        id: profile.id,
        data: profile
      }))
    ]
  };
  const validation = registry.registerPack(pack);
  const errors = validation.diagnostics.filter((diagnostic) => diagnostic.severity === "error");
  if (errors.length > 0) {
    throw new Error(`Navigation Lab ${backendId} data is invalid: ${JSON.stringify(errors)}`);
  }
  return registry;
}

function node(
  id: string,
  x: number,
  y: number,
  area: string,
  clearance: number,
  heightClearance: number
) {
  return { id, point: { x, y }, area, clearance, heightClearance };
}

function edge(
  id: string,
  from: string,
  to: string,
  area: string,
  width: number,
  slope: number,
  heightClearance = 3.2
) {
  return { id, from, to, area, width, slope, heightClearance };
}
