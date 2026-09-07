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
import {
  BLACKGLASS_BLAST_DOOR_AREA_ID,
  BLACKGLASS_COOLANT_AREA_ID,
  BLACKGLASS_GANTRY_AREA_ID,
  BLACKGLASS_TRANSIT_RELAY_PORTAL_ID,
  createBlackglassNavigationLayout
} from "./blackglass-layout";
import { compileBlackglassTerrainGraph } from "./blackglass-terrain-graph";

export function createBlackglassGraphNavigationLabBackendProvider(
  options: { id?: string; label?: string } = {}
): NavigationLabBackendProvider {
  const id = options.id ?? "graph";
  const graphId = `navigation-lab.graph.blackglass-basin.${id}`;
  const layoutId = `navigation-lab.layout.blackglass-basin.${id}`;
  const graph = compileBlackglassTerrainGraph(graphId);
  const layout = createBlackglassNavigationLayout(layoutId, id, {
    type: "navigation.graph",
    id: graphId
  });

  return {
    id,
    label: options.label ?? "Terrain Graph",
    technology: "Authored semantic route graph",
    description: `${graph.nodes.length} intentional route anchors and ${graph.edges.length} designer-authored corridor segments validated against the game terrain.`,
    layoutRef: { type: "navigation.layout", id: layoutId },
    obstacleBindings: {
      bridge: { kind: "area", id: BLACKGLASS_BLAST_DOOR_AREA_ID },
      ridgeTrail: { kind: "area", id: BLACKGLASS_GANTRY_AREA_ID },
      marsh: { kind: "area", id: BLACKGLASS_COOLANT_AREA_ID },
      waystone: { kind: "portal", id: BLACKGLASS_TRANSIT_RELAY_PORTAL_ID }
    },
    debugView: createGraphDebugView(id, graph, layout),
    createDataRegistry() {
      return createGraphDataRegistry(id, graph, layout);
    },
    createBackendFactories() {
      return [createGraphNavigationBackendFactory({ id, maxRouteFields: 12 })];
    }
  };
}

export const BLACKGLASS_GRAPH_NAVIGATION_LAB_BACKEND =
  createBlackglassGraphNavigationLabBackendProvider();

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
    if (from === undefined || to === undefined) {
      continue;
    }
    shapes.push({
      kind: "polyline",
      points: [from.point, to.point],
      lineWidth: 0.05,
      ...(edgeDefinition.area === undefined ? {} : { area: edgeDefinition.area }),
      ...(edgeDefinition.width === undefined ? {} : { width: edgeDefinition.width }),
      ...(edgeDefinition.heightClearance === undefined
        ? {}
        : { heightClearance: edgeDefinition.heightClearance }),
      ...(edgeDefinition.slope === undefined ? {} : { slope: edgeDefinition.slope }),
      ...debugStateBinding(edgeDefinition.area)
    });
  }

  for (const nodeDefinition of graph.nodes) {
    shapes.push({
      kind: "point",
      point: nodeDefinition.point,
      radius: 0.1,
      ...(nodeDefinition.area === undefined ? {} : { area: nodeDefinition.area }),
      ...(nodeDefinition.clearance === undefined ? {} : { clearance: nodeDefinition.clearance }),
      ...(nodeDefinition.heightClearance === undefined
        ? {}
        : { heightClearance: nodeDefinition.heightClearance }),
      ...debugStateBinding(nodeDefinition.area)
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
    summary: `${graph.nodes.length} semantic anchors · ${graph.edges.length} authored route segments · ${layout.portals?.length ?? 0} portal`,
    areaCosts: createNavigationLabDebugAreaCosts(layout),
    shapes
  };
}

function debugStateBinding(area: string | undefined): {
  stateBinding?: NavigationLabDebugStateBinding;
} {
  if (area === BLACKGLASS_BLAST_DOOR_AREA_ID) {
    return { stateBinding: "bridge" };
  }
  if (area === BLACKGLASS_GANTRY_AREA_ID) {
    return { stateBinding: "ridgeTrail" };
  }
  if (area === BLACKGLASS_COOLANT_AREA_ID) {
    return { stateBinding: "marsh" };
  }
  return {};
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
    id: `sandbox.navigation-lab.blackglass-basin.${backendId}`,
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
    throw new Error(`Blackglass Graph ${backendId} data is invalid: ${JSON.stringify(errors)}`);
  }
  return registry;
}
