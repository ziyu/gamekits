import type {
  NavigationNavMeshSource,
  NavigationNavMeshTriangle
} from "@gamekits/navigation-navmesh";
import {
  BLACKGLASS_BASIN_TERRAIN,
  type BlackglassTerrainCell
} from "../scenarios/blackglass-basin-terrain";

export function compileBlackglassTerrainNavMeshSource(id: string): NavigationNavMeshSource {
  const vertices: NavigationNavMeshSource["vertices"] = [];
  const vertexIndices = new Map<string, number>();
  const triangles: NavigationNavMeshTriangle[] = [];
  const halfTile = BLACKGLASS_BASIN_TERRAIN.tileSize / 2;

  for (const cell of BLACKGLASS_BASIN_TERRAIN.cells) {
    const bottomLeft = vertexIndex(cell.point.x - halfTile, cell.point.y - halfTile);
    const bottomRight = vertexIndex(cell.point.x + halfTile, cell.point.y - halfTile);
    const topRight = vertexIndex(cell.point.x + halfTile, cell.point.y + halfTile);
    const topLeft = vertexIndex(cell.point.x - halfTile, cell.point.y + halfTile);
    triangles.push(
      terrainTriangle(bottomLeft, bottomRight, topRight, cell),
      terrainTriangle(bottomLeft, topRight, topLeft, cell)
    );
  }

  return {
    id,
    version: "blackglass-terrain-v1",
    vertices,
    triangles,
    build: {
      cellSize: 0.2,
      cellHeight: 0.1,
      walkableRadius: 0.15,
      walkableHeight: 1.8,
      walkableClimb: 0.3,
      walkableSlopeAngle: 50,
      minRegionArea: 0.16,
      mergeRegionArea: 0.64,
      maxSimplificationError: 0.2,
      maxEdgeLength: 8,
      maxVerticesPerPolygon: 6,
      detailSampleDistance: 1.2,
      detailSampleMaxError: 0.2
    },
    tags: ["navigation-lab", "blackglass-basin", "terrain-triangle-source"]
  };

  function vertexIndex(x: number, y: number): number {
    const key = `${x}:${y}`;
    const existing = vertexIndices.get(key);
    if (existing !== undefined) {
      return existing;
    }
    const index = vertices.length;
    vertices.push({ x, y, z: terrainElevation(x, y) });
    vertexIndices.set(key, index);
    return index;
  }
}

function terrainTriangle(
  a: number,
  b: number,
  c: number,
  cell: BlackglassTerrainCell
): NavigationNavMeshTriangle {
  return {
    a,
    b,
    c,
    area: cell.area,
    tags: [`tile:${cell.column}:${cell.row}`, `area:${cell.area}`]
  };
}

function terrainElevation(_x: number, _y: number): number {
  return 0;
}
