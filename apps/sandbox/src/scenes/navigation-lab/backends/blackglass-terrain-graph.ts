import type {
  NavigationGraphDefinition,
  NavigationGraphEdgeDefinition,
  NavigationGraphNodeDefinition
} from "@gamekits/navigation-graph";
import {
  blackglassTerrainCellAt,
  blackglassTerrainCellsAlongSegment,
  type BlackglassTerrainArea,
  type BlackglassTerrainCell
} from "../scenarios/blackglass-basin-terrain";

type AuthoredTerrainCoordinate = readonly [column: number, row: number];

type AuthoredRoute = {
  id: string;
  label: string;
  coordinates: readonly AuthoredTerrainCoordinate[];
};

/**
 * Designer-authored strategic routes. These are intentional movement choices, not
 * automatically generated visibility links. Every segment is still validated
 * against the authoritative terrain during compilation.
 */
const AUTHORED_ROUTES: readonly AuthoredRoute[] = [
  {
    id: "coolant-sink",
    label: "Coolant Sink freight route",
    coordinates: [
      [2, 17],
      [5, 15],
      [19, 14],
      [19, 10],
      [25, 7],
      [25, 4],
      [26, 4]
    ]
  },
  {
    id: "blast-gate",
    label: "Blast Gate transit road",
    coordinates: [
      [2, 17],
      [15, 9],
      [25, 7],
      [25, 4],
      [26, 4]
    ]
  },
  {
    id: "north-gantry",
    label: "North Gantry maintenance route",
    coordinates: [
      [2, 17],
      [12, 10],
      [12, 3],
      [26, 2],
      [26, 4]
    ]
  },
  {
    id: "relay-entry",
    label: "Transit Relay western spur",
    coordinates: [
      [2, 17],
      [2, 16]
    ]
  },
  {
    id: "relay-exit",
    label: "Transit Relay eastern spur",
    coordinates: [
      [18, 5],
      [19, 6],
      [25, 7],
      [25, 4],
      [26, 4]
    ]
  }
] as const;

export function compileBlackglassTerrainGraph(id: string): NavigationGraphDefinition {
  const nodeRoutes = new Map<string, Set<string>>();
  const nodes = new Map<string, NavigationGraphNodeDefinition>();
  const edges = new Map<string, NavigationGraphEdgeDefinition>();

  for (const route of AUTHORED_ROUTES) {
    const cells = route.coordinates.map(([column, row]) => requireTerrainCell(column, row, route));
    for (const cell of cells) {
      const nodeId = blackglassTerrainGraphNodeId(cell.column, cell.row);
      const routes = nodeRoutes.get(nodeId) ?? new Set<string>();
      routes.add(route.id);
      nodeRoutes.set(nodeId, routes);
      nodes.set(nodeId, compileTerrainNode(cell, routes));
    }
    for (let index = 1; index < cells.length; index += 1) {
      const from = cells[index - 1]!;
      const to = cells[index]!;
      const edge = compileAuthoredEdge(route, from, to, index - 1);
      edges.set(edge.id, edge);
    }
  }

  return {
    id,
    nodes: [...nodes.values()].sort((left, right) => left.id.localeCompare(right.id)),
    edges: [...edges.values()].sort((left, right) => left.id.localeCompare(right.id)),
    tags: ["navigation-lab", "blackglass-basin", "authored-semantic-route-graph"]
  };
}

export function blackglassTerrainGraphNodeId(column: number, row: number): string {
  return `terrain.blackglass.c${column}.r${row}`;
}

function requireTerrainCell(
  column: number,
  row: number,
  route: AuthoredRoute
): BlackglassTerrainCell {
  const cell = blackglassTerrainCellAt(column, row);
  if (cell === undefined) {
    throw new Error(
      `Blackglass authored route ${route.id} references blocked terrain ${column}:${row}`
    );
  }
  return cell;
}

function compileTerrainNode(
  cell: BlackglassTerrainCell,
  routeIds: ReadonlySet<string>
): NavigationGraphNodeDefinition {
  return {
    id: blackglassTerrainGraphNodeId(cell.column, cell.row),
    point: { ...cell.point },
    area: cell.area,
    clearance: cell.clearance,
    heightClearance: cell.heightClearance,
    tags: [
      "designer-authored",
      "semantic-route-anchor",
      `tile:${cell.column}:${cell.row}`,
      ...[...routeIds].sort().map((routeId) => `route:${routeId}`),
      ...(cell.marker === undefined ? [] : [`marker:${cell.marker}`])
    ]
  };
}

function compileAuthoredEdge(
  route: AuthoredRoute,
  from: BlackglassTerrainCell,
  to: BlackglassTerrainCell,
  segmentIndex: number
): NavigationGraphEdgeDefinition {
  const traversedCells = blackglassTerrainCellsAlongSegment(from.point, to.point);
  if (traversedCells === undefined) {
    throw new Error(
      `Blackglass authored route ${route.id} segment ${segmentIndex} crosses blocked terrain`
    );
  }
  const area = connectionArea(traversedCells.map((cell) => cell.area));
  return {
    id: `edge.blackglass.${route.id}.${segmentIndex}`,
    from: blackglassTerrainGraphNodeId(from.column, from.row),
    to: blackglassTerrainGraphNodeId(to.column, to.row),
    area,
    width: Math.min(...traversedCells.map((cell) => cell.clearance)) * 2,
    heightClearance: Math.min(...traversedCells.map((cell) => cell.heightClearance)),
    slope: Math.max(...traversedCells.map((cell) => cell.slope)),
    tags: [
      "designer-authored",
      "semantic-route-segment",
      `route:${route.id}`,
      `route-label:${route.label}`,
      `area:${area}`
    ]
  };
}

function connectionArea(areas: readonly BlackglassTerrainArea[]): BlackglassTerrainArea {
  for (const area of ["blast-door", "gantry", "swamp", "ridge", "road"] as const) {
    if (areas.includes(area)) {
      return area;
    }
  }
  return "ground";
}
