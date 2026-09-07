import type {
  NavigationGridCellDefinition,
  NavigationGridDefinition
} from "@gamekits/navigation-grid";
import { BLACKGLASS_BASIN_TERRAIN } from "../scenarios/blackglass-basin-terrain";

const GRID_SUBDIVISIONS = 2;
const GRID_CELL_SIZE = BLACKGLASS_BASIN_TERRAIN.tileSize / GRID_SUBDIVISIONS;

export function compileBlackglassTerrainGrid(id: string): NavigationGridDefinition {
  const cells: NavigationGridCellDefinition[] = [];

  for (const terrainCell of BLACKGLASS_BASIN_TERRAIN.cells) {
    for (let localRow = 0; localRow < GRID_SUBDIVISIONS; localRow += 1) {
      for (let localColumn = 0; localColumn < GRID_SUBDIVISIONS; localColumn += 1) {
        cells.push({
          column: terrainCell.column * GRID_SUBDIVISIONS + localColumn,
          row: terrainCell.row * GRID_SUBDIVISIONS + localRow,
          area: terrainCell.area,
          clearance: terrainCell.clearance,
          heightClearance: terrainCell.heightClearance,
          slope: terrainCell.slope,
          tags: [
            "terrain-derived",
            `tile:${terrainCell.column}:${terrainCell.row}`,
            ...(terrainCell.marker === undefined ? [] : [`marker:${terrainCell.marker}`])
          ]
        });
      }
    }
  }

  return {
    id,
    width: BLACKGLASS_BASIN_TERRAIN.width * GRID_SUBDIVISIONS,
    height: BLACKGLASS_BASIN_TERRAIN.height * GRID_SUBDIVISIONS,
    cellSize: GRID_CELL_SIZE,
    origin: {
      x: BLACKGLASS_BASIN_TERRAIN.bounds.minX + GRID_CELL_SIZE / 2,
      y: BLACKGLASS_BASIN_TERRAIN.bounds.minY + GRID_CELL_SIZE / 2
    },
    connectivity: 8,
    cells,
    tags: ["navigation-lab", "blackglass-basin", "terrain-derived-grid"]
  };
}
