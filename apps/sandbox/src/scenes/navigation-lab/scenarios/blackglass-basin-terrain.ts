import type { NavigationPoint } from "@gamekits/navigation-core";

export type BlackglassTerrainArea = "ground" | "road" | "ridge" | "swamp" | "blast-door" | "gantry";

export type BlackglassTerrainMarker = "start" | "goal" | "relay-entry" | "relay-exit";

export type BlackglassTerrainCell = {
  column: number;
  row: number;
  point: NavigationPoint;
  area: BlackglassTerrainArea;
  clearance: number;
  heightClearance: number;
  slope: number;
  marker?: BlackglassTerrainMarker | undefined;
};

export type BlackglassTerrainLandmark = {
  label: string;
  point: NavigationPoint;
  align?: "left" | "center" | "right" | undefined;
};

export type BlackglassBasinTerrain = {
  bounds: { minX: number; maxX: number; minY: number; maxY: number };
  tileSize: number;
  width: number;
  height: number;
  rows: readonly string[];
  cells: readonly BlackglassTerrainCell[];
  cellsByCoordinate: ReadonlyMap<string, BlackglassTerrainCell>;
  start: NavigationPoint;
  goal: NavigationPoint;
  relay: { from: NavigationPoint; to: NavigationPoint };
  landmarks: readonly BlackglassTerrainLandmark[];
};

const TERRAIN_ROWS = [
  "##############################",
  "#....####....####....##......#",
  "#..^^^^^^^^^^GGGG^^^^^^^^^^..#",
  "#....^^##^^^^GGGG^^^^##^^....#",
  "#..###...##..####..###....V..#",
  "#......##....####.B####...##.#",
  "#.####.......####......##....#",
  "#.....####...####.###.....##.#",
  "#..=====.....####.....=====..#",
  "#..===..=====DDDD=====..===..#",
  "#....====....DDDD....====....#",
  "###....###...####...###....###",
  "#....##......####......##....#",
  "#..####...~~~####~~~...####..#",
  "#......~~~~~~~~~~~~~~~~......#",
  "#...~~~~~~~~~~~~~~~~~~~~~~...#",
  "#.A..##~~~~~~~~~~~~~~~~##....#",
  "#.S....##....####....##......#",
  "#............####............#",
  "##############################"
] as const;

const TERRAIN_TILE_SIZE = 1;
const TERRAIN_BOUNDS = { minX: -15, maxX: 15, minY: -10, maxY: 10 } as const;

export const BLACKGLASS_BASIN_TERRAIN = createBlackglassBasinTerrain();

export const BLACKGLASS_BASIN_FIELD_AGENT_STARTS = terrainPoints([
  [2, 17],
  [3, 17],
  [4, 17],
  [5, 17],
  [6, 17],
  [1, 17],
  [1, 18],
  [2, 18],
  [3, 18],
  [4, 18],
  [5, 18],
  [6, 18],
  [7, 18],
  [8, 18],
  [9, 18],
  [10, 18],
  [11, 18],
  [12, 18]
]);

export const BLACKGLASS_BASIN_FIELD_SAMPLE_POINTS = terrainPoints([
  [2, 17],
  [2, 16],
  [3, 15],
  [8, 14],
  [10, 13],
  [11, 9],
  [14, 9],
  [18, 9],
  [10, 2],
  [14, 2],
  [20, 2],
  [14, 15],
  [20, 15],
  [18, 5],
  [23, 7],
  [26, 4]
]);

export function blackglassTerrainCoordinateKey(column: number, row: number): string {
  return `${column}:${row}`;
}

export function blackglassTerrainCellAt(
  column: number,
  row: number
): BlackglassTerrainCell | undefined {
  return BLACKGLASS_BASIN_TERRAIN.cellsByCoordinate.get(
    blackglassTerrainCoordinateKey(column, row)
  );
}

export function blackglassTerrainCellContaining(
  point: NavigationPoint
): BlackglassTerrainCell | undefined {
  const column = Math.floor((point.x - TERRAIN_BOUNDS.minX) / BLACKGLASS_BASIN_TERRAIN.tileSize);
  const row = Math.floor((point.y - TERRAIN_BOUNDS.minY) / BLACKGLASS_BASIN_TERRAIN.tileSize);
  return blackglassTerrainCellAt(column, row);
}

export function blackglassTerrainCellsAlongSegment(
  start: NavigationPoint,
  end: NavigationPoint
): readonly BlackglassTerrainCell[] | undefined {
  const distance = Math.hypot(end.x - start.x, end.y - start.y);
  const steps = Math.max(1, Math.ceil(distance / (BLACKGLASS_BASIN_TERRAIN.tileSize / 5)));
  const cells: BlackglassTerrainCell[] = [];
  let previousKey: string | undefined;

  for (let index = 0; index <= steps; index += 1) {
    const amount = index / steps;
    const cell = blackglassTerrainCellContaining({
      x: start.x + (end.x - start.x) * amount,
      y: start.y + (end.y - start.y) * amount
    });
    if (cell === undefined) {
      return undefined;
    }
    const key = blackglassTerrainCoordinateKey(cell.column, cell.row);
    if (key !== previousKey) {
      cells.push(cell);
      previousKey = key;
    }
  }
  return cells;
}

export function blackglassTerrainPoint(column: number, row: number): NavigationPoint {
  return {
    x: TERRAIN_BOUNDS.minX + (column + 0.5) * TERRAIN_TILE_SIZE,
    y: TERRAIN_BOUNDS.minY + (row + 0.5) * TERRAIN_TILE_SIZE
  };
}

function createBlackglassBasinTerrain(): BlackglassBasinTerrain {
  const width = TERRAIN_ROWS[0].length;
  const height = TERRAIN_ROWS.length;
  if (
    width !== (TERRAIN_BOUNDS.maxX - TERRAIN_BOUNDS.minX) / TERRAIN_TILE_SIZE ||
    height !== (TERRAIN_BOUNDS.maxY - TERRAIN_BOUNDS.minY) / TERRAIN_TILE_SIZE
  ) {
    throw new Error("Blackglass terrain dimensions do not match its world bounds");
  }
  if (TERRAIN_ROWS.some((row) => row.length !== width)) {
    throw new Error("Blackglass terrain rows must have a consistent width");
  }

  const cells: BlackglassTerrainCell[] = [];
  const cellsByCoordinate = new Map<string, BlackglassTerrainCell>();
  const markers = new Map<BlackglassTerrainMarker, NavigationPoint>();

  for (let row = 0; row < height; row += 1) {
    for (let column = 0; column < width; column += 1) {
      const symbol = TERRAIN_ROWS[row]?.[column];
      if (symbol === undefined) {
        continue;
      }
      const traversal = traversalForSymbol(symbol);
      if (traversal === undefined) {
        continue;
      }
      const point = blackglassTerrainPoint(column, row);
      const marker = markerForSymbol(symbol);
      const cell: BlackglassTerrainCell = {
        column,
        row,
        point,
        ...traversal,
        ...(marker === undefined ? {} : { marker })
      };
      cells.push(cell);
      cellsByCoordinate.set(blackglassTerrainCoordinateKey(column, row), cell);
      if (marker !== undefined) {
        markers.set(marker, point);
      }
    }
  }

  const start = requireMarker(markers, "start");
  const goal = requireMarker(markers, "goal");
  const relayFrom = requireMarker(markers, "relay-entry");
  const relayTo = requireMarker(markers, "relay-exit");

  return {
    bounds: { ...TERRAIN_BOUNDS },
    tileSize: TERRAIN_TILE_SIZE,
    width,
    height,
    rows: TERRAIN_ROWS,
    cells,
    cellsByCoordinate,
    start,
    goal,
    relay: { from: relayFrom, to: relayTo },
    landmarks: [
      { label: "RELAY CAMP", point: { x: start.x, y: start.y - 1.1 }, align: "left" },
      { label: "AEGIS VAULT", point: { x: goal.x, y: goal.y - 1.1 }, align: "right" },
      { label: "NORTH GANTRY", point: { x: 0, y: -8.4 } },
      { label: "BLAST GATE", point: { x: 0, y: -0.2 } },
      { label: "COOLANT SINK", point: { x: 0, y: 6.8 } },
      { label: "FREIGHT MAZE", point: { x: -7.5, y: -2.4 } },
      { label: "TURBINE YARD", point: { x: 8, y: 2.3 } }
    ]
  };
}

function terrainPoints(coordinates: readonly (readonly [number, number])[]): NavigationPoint[] {
  return coordinates.map(([column, row]) => {
    const cell = BLACKGLASS_BASIN_TERRAIN.cellsByCoordinate.get(
      blackglassTerrainCoordinateKey(column, row)
    );
    if (cell === undefined) {
      throw new Error(`Blackglass terrain point ${column}:${row} is not walkable`);
    }
    return { ...cell.point };
  });
}

function traversalForSymbol(
  symbol: string
): Pick<BlackglassTerrainCell, "area" | "clearance" | "heightClearance" | "slope"> | undefined {
  switch (symbol) {
    case ".":
    case "S":
    case "V":
    case "A":
    case "B":
      return { area: "ground", clearance: 1.35, heightClearance: 3.2, slope: 0.08 };
    case "=":
      return { area: "road", clearance: 1.35, heightClearance: 3.2, slope: 0.04 };
    case "~":
      return { area: "swamp", clearance: 1.35, heightClearance: 3.2, slope: 0.02 };
    case "^":
      return { area: "ridge", clearance: 0.55, heightClearance: 1.9, slope: 0.52 };
    case "D":
      return { area: "blast-door", clearance: 1.35, heightClearance: 3.2, slope: 0.03 };
    case "G":
      return { area: "gantry", clearance: 0.55, heightClearance: 1.9, slope: 0.58 };
    default:
      return undefined;
  }
}

function markerForSymbol(symbol: string): BlackglassTerrainMarker | undefined {
  switch (symbol) {
    case "S":
      return "start";
    case "V":
      return "goal";
    case "A":
      return "relay-entry";
    case "B":
      return "relay-exit";
    default:
      return undefined;
  }
}

function requireMarker(
  markers: ReadonlyMap<BlackglassTerrainMarker, NavigationPoint>,
  marker: BlackglassTerrainMarker
): NavigationPoint {
  const point = markers.get(marker);
  if (point === undefined) {
    throw new Error(`Blackglass terrain is missing its ${marker} marker`);
  }
  return { ...point };
}
