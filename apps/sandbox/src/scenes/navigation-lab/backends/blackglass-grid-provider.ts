import { createDataRegistry, type DataPack, type DataRegistry } from "@gamekits/data";
import {
  createNavigationAgentProfileDataType,
  createNavigationLayoutDataType,
  type NavigationLayoutDefinition,
  type NavigationPoint
} from "@gamekits/navigation-core";
import {
  createGridNavigationBackendFactory,
  createNavigationGridDataType,
  type NavigationGridCellDefinition,
  type NavigationGridDefinition
} from "@gamekits/navigation-grid";
import { NAVIGATION_LAB_PROFILES } from "../scenario";
import {
  BLACKGLASS_BLAST_DOOR_AREA_ID,
  BLACKGLASS_COOLANT_AREA_ID,
  BLACKGLASS_GANTRY_AREA_ID,
  BLACKGLASS_TRANSIT_RELAY_PORTAL_ID,
  createBlackglassNavigationLayout
} from "./blackglass-layout";
import { compileBlackglassTerrainGrid } from "./blackglass-terrain-grid";
import type { NavigationLabBackendProvider } from "./contract";
import type {
  NavigationLabBackendDebugView,
  NavigationLabDebugShape,
  NavigationLabDebugStateBinding
} from "./debug-view";
import { createNavigationLabDebugAreaCosts } from "./debug-view";

export function createBlackglassGridNavigationLabBackendProvider(
  options: { id?: string; label?: string } = {}
): NavigationLabBackendProvider {
  const id = options.id ?? "grid";
  const gridId = `navigation-lab.grid.blackglass-basin.${id}`;
  const layoutId = `navigation-lab.layout.blackglass-basin.${id}`;
  const grid = compileBlackglassTerrainGrid(gridId);
  const layout = createBlackglassNavigationLayout(layoutId, id, {
    type: "navigation.grid",
    id: gridId
  });

  return {
    id,
    label: options.label ?? "Traversal Grid",
    technology: "Derived 0.5 m raster",
    description: `${grid.cells.length} fine cells subdivided from the same game terrain used by the Graph backend and canvas.`,
    layoutRef: { type: "navigation.layout", id: layoutId },
    obstacleBindings: {
      bridge: { kind: "area", id: BLACKGLASS_BLAST_DOOR_AREA_ID },
      ridgeTrail: { kind: "area", id: BLACKGLASS_GANTRY_AREA_ID },
      marsh: { kind: "area", id: BLACKGLASS_COOLANT_AREA_ID },
      waystone: { kind: "portal", id: BLACKGLASS_TRANSIT_RELAY_PORTAL_ID }
    },
    debugView: createGridDebugView(id, grid, layout),
    createDataRegistry() {
      return createGridDataRegistry(id, grid, layout);
    },
    createBackendFactories() {
      return [createGridNavigationBackendFactory({ id, maxRouteFields: 12 })];
    }
  };
}

export const BLACKGLASS_GRID_NAVIGATION_LAB_BACKEND =
  createBlackglassGridNavigationLabBackendProvider();

function createGridDebugView(
  backendId: string,
  grid: NavigationGridDefinition,
  layout: NavigationLayoutDefinition
): NavigationLabBackendDebugView {
  const halfCell = grid.cellSize / 2;
  const shapes: NavigationLabDebugShape[] = grid.cells.map((cell) => {
    const center = gridPoint(grid, cell.column, cell.row);
    return {
      kind: "polygon",
      points: [
        { x: center.x - halfCell, y: center.y - halfCell },
        { x: center.x + halfCell, y: center.y - halfCell },
        { x: center.x + halfCell, y: center.y + halfCell },
        { x: center.x - halfCell, y: center.y + halfCell }
      ],
      ...(cell.area === undefined ? {} : { area: cell.area }),
      ...(cell.clearance === undefined ? {} : { clearance: cell.clearance }),
      ...(cell.heightClearance === undefined ? {} : { heightClearance: cell.heightClearance }),
      ...(cell.slope === undefined ? {} : { slope: cell.slope }),
      ...gridStateBinding(cell)
    };
  });

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
    summary: `${grid.cells.length} terrain cells · ${grid.cellSize.toFixed(1)} m · ${grid.connectivity ?? 4}-way`,
    areaCosts: createNavigationLabDebugAreaCosts(layout),
    shapes
  };
}

function gridStateBinding(cell: NavigationGridCellDefinition): {
  stateBinding?: NavigationLabDebugStateBinding;
} {
  if (cell.area === BLACKGLASS_BLAST_DOOR_AREA_ID) {
    return { stateBinding: "bridge" };
  }
  if (cell.area === BLACKGLASS_GANTRY_AREA_ID) {
    return { stateBinding: "ridgeTrail" };
  }
  if (cell.area === BLACKGLASS_COOLANT_AREA_ID) {
    return { stateBinding: "marsh" };
  }
  return {};
}

function createGridDataRegistry(
  backendId: string,
  grid: NavigationGridDefinition,
  layout: NavigationLayoutDefinition
): DataRegistry {
  const registry = createDataRegistry();
  registry.registerType(createNavigationAgentProfileDataType());
  registry.registerType(createNavigationLayoutDataType());
  registry.registerType(createNavigationGridDataType());
  const pack: DataPack = {
    id: `sandbox.navigation-lab.blackglass-basin.${backendId}`,
    version: "1.0.0",
    entries: [
      { type: "navigation.grid", id: grid.id, data: grid },
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
    throw new Error(`Blackglass Grid ${backendId} data is invalid: ${JSON.stringify(errors)}`);
  }
  return registry;
}

function gridPoint(
  grid: Pick<NavigationGridDefinition, "origin" | "cellSize">,
  column: number,
  row: number
): NavigationPoint {
  return {
    x: grid.origin.x + column * grid.cellSize,
    y: grid.origin.y + row * grid.cellSize
  };
}
