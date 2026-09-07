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
import type { NavigationLabBackendProvider } from "./contract";
import type {
  NavigationLabBackendDebugView,
  NavigationLabDebugShape,
  NavigationLabDebugStateBinding
} from "./debug-view";
import { createNavigationLabDebugAreaCosts } from "./debug-view";

const GRID_ORIGIN = { x: -9, y: -5 } as const;
const GRID_CELL_SIZE = 0.5;
const GRID_WIDTH = 37;
const GRID_HEIGHT = 21;
const BRIDGE_OBSTACLE_ID = "obstacle.ashen-ford.bridge";
const RIDGE_OBSTACLE_ID = "obstacle.ashen-ford.hunter-trail";
const MARSH_AREA_ID = "swamp";
const WAYSTONE_PORTAL_ID = "portal.ashen-ford.waystones";

export function createGridNavigationLabBackendProvider(
  options: { id?: string; label?: string } = {}
): NavigationLabBackendProvider {
  const id = options.id ?? "grid";
  const gridId = `navigation-lab.grid.ashen-ford.${id}`;
  const layoutId = `navigation-lab.layout.ashen-ford.${id}`;
  const grid = createAshenFordGrid(gridId);
  const layout = createAshenFordGridLayout(layoutId, gridId, id);

  return {
    id,
    label: options.label ?? "Traversal Grid",
    technology: "Uniform 0.5 m grid",
    description: "Free-space raster routing with profile clearance and dynamic cell regions.",
    layoutRef: { type: "navigation.layout", id: layoutId },
    obstacleBindings: {
      bridge: { kind: "custom", id: BRIDGE_OBSTACLE_ID },
      ridgeTrail: { kind: "custom", id: RIDGE_OBSTACLE_ID },
      marsh: { kind: "area", id: MARSH_AREA_ID },
      waystone: { kind: "portal", id: WAYSTONE_PORTAL_ID }
    },
    debugView: createGridDebugView(id, grid, layout),
    createDataRegistry() {
      return createGridDataRegistry(id, grid, layout);
    },
    createBackendFactories() {
      return [createGridNavigationBackendFactory({ id, maxRouteFields: 8 })];
    }
  };
}

export const GRID_NAVIGATION_LAB_BACKEND = createGridNavigationLabBackendProvider();

function createGridDebugView(
  backendId: string,
  grid: NavigationGridDefinition,
  layout: NavigationLayoutDefinition
): NavigationLabBackendDebugView {
  const halfCell = grid.cellSize / 2;
  const shapes: NavigationLabDebugShape[] = grid.cells.map((cell) => {
    const center = gridPoint(cell.column, cell.row);
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
    summary: `${grid.cells.length} walkable cells · ${grid.cellSize.toFixed(1)} m · ${grid.connectivity ?? 4}-way`,
    areaCosts: createNavigationLabDebugAreaCosts(layout),
    shapes
  };
}

function gridStateBinding(cell: NavigationGridCellDefinition): {
  stateBinding?: NavigationLabDebugStateBinding;
} {
  if (cell.obstacleIds?.includes(BRIDGE_OBSTACLE_ID)) {
    return { stateBinding: "bridge" };
  }
  if (cell.obstacleIds?.includes(RIDGE_OBSTACLE_ID)) {
    return { stateBinding: "ridgeTrail" };
  }
  if (cell.area === MARSH_AREA_ID) {
    return { stateBinding: "marsh" };
  }
  return {};
}

function createAshenFordGrid(id: string): NavigationGridDefinition {
  const cells: NavigationGridCellDefinition[] = [];
  for (let row = 0; row < GRID_HEIGHT; row += 1) {
    for (let column = 0; column < GRID_WIDTH; column += 1) {
      const point = gridPoint(column, row);
      const crossing = crossingAt(point);
      if (Math.abs(point.x) <= 1.25 && crossing === undefined) {
        continue;
      }
      const terrain = terrainAt(point, crossing);
      cells.push({
        column,
        row,
        area: terrain.area,
        clearance: terrain.clearance,
        heightClearance: terrain.heightClearance,
        slope: terrain.slope,
        ...(crossing === "bridge" ? { obstacleIds: [BRIDGE_OBSTACLE_ID] } : {}),
        ...(crossing === "ridge" ? { obstacleIds: [RIDGE_OBSTACLE_ID] } : {})
      });
    }
  }
  return {
    id,
    width: GRID_WIDTH,
    height: GRID_HEIGHT,
    cellSize: GRID_CELL_SIZE,
    origin: { ...GRID_ORIGIN },
    connectivity: 8,
    cells,
    dynamicObstacles: [{ id: BRIDGE_OBSTACLE_ID }, { id: RIDGE_OBSTACLE_ID }],
    tags: ["navigation-lab", "ashen-ford", "uniform-grid"]
  };
}

function createAshenFordGridLayout(
  id: string,
  gridId: string,
  backendId: string
): NavigationLayoutDefinition {
  return {
    id,
    backend: backendId,
    source: { type: "navigation.grid", id: gridId },
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
    id: `sandbox.navigation-lab.${backendId}`,
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
    throw new Error(`Navigation Lab ${backendId} data is invalid: ${JSON.stringify(errors)}`);
  }
  return registry;
}

function crossingAt(point: NavigationPoint): "bridge" | "ridge" | "marsh" | undefined {
  if (Math.abs(point.x) > 1.25) {
    return undefined;
  }
  if (Math.abs(point.y) <= 0.5) {
    return "bridge";
  }
  if (Math.abs(point.y + 3) <= 0.5) {
    return "ridge";
  }
  if (point.y >= 2.5 && point.y <= 4) {
    return "marsh";
  }
  return undefined;
}

function terrainAt(
  point: NavigationPoint,
  crossing: ReturnType<typeof crossingAt>
): {
  area: "ground" | "road" | "ridge" | "swamp";
  clearance: number;
  heightClearance: number;
  slope: number;
} {
  if (crossing === "ridge" || distanceToHunterTrail(point) <= 0.65) {
    return { area: "ridge", clearance: 0.55, heightClearance: 1.9, slope: 0.52 };
  }
  if (crossing === "marsh" || point.y >= 2.5) {
    return { area: "swamp", clearance: 1.3, heightClearance: 3.2, slope: 0.02 };
  }
  if (crossing === "bridge" || Math.abs(point.y) <= 0.7) {
    return { area: "road", clearance: 1.3, heightClearance: 3.2, slope: 0.05 };
  }
  return { area: "ground", clearance: 1.3, heightClearance: 3.2, slope: 0.08 };
}

function distanceToHunterTrail(point: NavigationPoint): number {
  return Math.min(
    distanceToSegment(point, { x: -6, y: 0 }, { x: -3, y: -3 }),
    distanceToSegment(point, { x: -3, y: -3 }, { x: 3, y: -3 }),
    distanceToSegment(point, { x: 3, y: -3 }, { x: 6, y: 0 })
  );
}

function distanceToSegment(
  point: NavigationPoint,
  start: NavigationPoint,
  end: NavigationPoint
): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  const amount =
    lengthSquared === 0
      ? 0
      : Math.max(
          0,
          Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared)
        );
  return Math.hypot(point.x - (start.x + dx * amount), point.y - (start.y + dy * amount));
}

function gridPoint(column: number, row: number): NavigationPoint {
  return {
    x: GRID_ORIGIN.x + column * GRID_CELL_SIZE,
    y: GRID_ORIGIN.y + row * GRID_CELL_SIZE
  };
}
