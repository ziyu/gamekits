import {
  createNavigationError,
  type NavigationLayoutDefinition,
  type NavigationPoint
} from "@gamekits/navigation-core";
import type {
  NavigationNavMeshBuildProfile,
  NavigationNavMeshSource
} from "@gamekits/navigation-navmesh";
import {
  exportNavMesh,
  getNavMeshPositionsAndIndices,
  type OffMeshConnectionParams
} from "recast-navigation";
import type { SoloNavMeshGeneratorConfig } from "recast-navigation/generators";
import type { NavigationRecastBuildArtifact } from "../contracts";
import { initializeRecastNavigation, requireRecastNavigationInitialized } from "../initialization";
import { generateAreaAwareSoloNavMesh } from "./generate-area-aware-solo-navmesh";

export async function prepareRecastNavigationArtifact(
  source: NavigationNavMeshSource,
  layout?: NavigationLayoutDefinition
): Promise<NavigationRecastBuildArtifact> {
  await initializeRecastNavigation();
  return buildRecastNavigationArtifact(source, layout);
}

export function buildRecastNavigationArtifact(
  source: NavigationNavMeshSource,
  layout?: NavigationLayoutDefinition
): NavigationRecastBuildArtifact {
  requireRecastNavigationInitialized();
  const areaIds = collectAreaIds(source);
  const areaIndices = Object.fromEntries(areaIds.map((areaId, index) => [areaId, index + 1]));
  const { areaFlags, portalFlags } = createTraversalFlags(areaIds, layout);
  const positions = source.vertices.flatMap(toRecastPositionTuple);
  const indices = source.triangles.flatMap((triangle) => [triangle.a, triangle.c, triangle.b]);
  let navMesh: ReturnType<typeof generateAreaAwareSoloNavMesh>;
  try {
    navMesh = generateAreaAwareSoloNavMesh({
      source,
      positions,
      indices,
      config: toRecastConfig(source.build),
      areaIndices,
      areaFlags,
      offMeshConnections: createOffMeshConnections(
        layout,
        source.build.walkableRadius,
        portalFlags,
        areaIds,
        areaIndices
      )
    });
  } catch (error) {
    throw createNavigationError(
      "navigation.recast_bake_failed",
      `Recast failed to bake NavMesh source ${source.id}`,
      { sourceId: source.id, cause: error instanceof Error ? error.message : String(error) }
    );
  }
  try {
    const polygonCount = countSurfacePolygons(navMesh);
    const [debugPositions, debugIndices] = getNavMeshPositionsAndIndices(navMesh);
    const debugTriangleAreas = collectDebugTriangleAreas(navMesh, areaIds);
    if (debugTriangleAreas.length !== debugIndices.length / 3) {
      throw createNavigationError(
        "navigation.recast_debug_mesh_mismatch",
        `Recast debug mesh for ${source.id} lost polygon area assignments`,
        {
          sourceId: source.id,
          debugTriangles: debugIndices.length / 3,
          debugTriangleAreas: debugTriangleAreas.length
        }
      );
    }
    return {
      sourceId: source.id,
      ...(source.version === undefined ? {} : { sourceVersion: source.version }),
      data: exportNavMesh(navMesh),
      debugMesh: {
        vertices: recastPositionsToNavigationPoints(debugPositions),
        indices: [...debugIndices],
        triangleAreas: debugTriangleAreas
      },
      polygonCount,
      areaIds,
      areaIndices,
      areaFlags,
      portalFlags
    };
  } finally {
    navMesh.destroy();
  }
}

function toRecastPositionTuple(point: NavigationPoint): [number, number, number] {
  return [point.x, point.z ?? 0, point.y];
}

function recastPositionsToNavigationPoints(positions: number[]): NavigationPoint[] {
  const points: NavigationPoint[] = [];
  for (let index = 0; index < positions.length; index += 3) {
    points.push({
      x: positions[index] ?? 0,
      y: positions[index + 2] ?? 0,
      z: positions[index + 1] ?? 0
    });
  }
  return points;
}

function toRecastConfig(
  profile: NavigationNavMeshBuildProfile
): Partial<SoloNavMeshGeneratorConfig> {
  return {
    cs: profile.cellSize,
    ch: profile.cellHeight,
    walkableRadius: Math.max(0, Math.ceil(profile.walkableRadius / profile.cellSize)),
    walkableHeight: Math.max(3, Math.ceil(profile.walkableHeight / profile.cellHeight)),
    walkableClimb: Math.max(0, Math.floor(profile.walkableClimb / profile.cellHeight)),
    walkableSlopeAngle: profile.walkableSlopeAngle,
    ...(profile.minRegionArea === undefined
      ? {}
      : { minRegionArea: Math.max(0, Math.sqrt(profile.minRegionArea) / profile.cellSize) }),
    ...(profile.mergeRegionArea === undefined
      ? {}
      : { mergeRegionArea: Math.max(0, Math.sqrt(profile.mergeRegionArea) / profile.cellSize) }),
    ...(profile.maxSimplificationError === undefined
      ? {}
      : {
          maxSimplificationError: Math.max(0, profile.maxSimplificationError / profile.cellSize)
        }),
    ...(profile.maxEdgeLength === undefined
      ? {}
      : { maxEdgeLen: Math.max(0, Math.floor(profile.maxEdgeLength / profile.cellSize)) }),
    ...(profile.maxVerticesPerPolygon === undefined
      ? {}
      : { maxVertsPerPoly: profile.maxVerticesPerPolygon }),
    ...(profile.detailSampleDistance === undefined
      ? {}
      : { detailSampleDist: profile.detailSampleDistance / profile.cellSize }),
    ...(profile.detailSampleMaxError === undefined
      ? {}
      : { detailSampleMaxError: profile.detailSampleMaxError / profile.cellHeight })
  };
}

function createOffMeshConnections(
  layout: NavigationLayoutDefinition | undefined,
  defaultRadius: number,
  portalFlags: Readonly<Record<string, number>>,
  areaIds: readonly string[],
  areaIndices: Readonly<Record<string, number>>
): OffMeshConnectionParams[] {
  return (layout?.portals ?? []).map((portal, index) => ({
    startPosition: toRecastVector(portal.from.point),
    endPosition: toRecastVector(portal.to.point),
    radius: Math.max(defaultRadius, 0.01),
    bidirectional: portal.bidirectional !== false,
    flags: portalFlags[portal.id] ?? 0,
    area: areaIndices[portal.from.area ?? areaIds[0] ?? DEFAULT_AREA_ID] ?? 1,
    userId: index + 1
  }));
}

const DEFAULT_AREA_ID = "default";
const MAX_TRAVERSAL_FLAGS = 16;

function collectAreaIds(source: NavigationNavMeshSource): string[] {
  const ids = new Set<string>();
  for (const triangle of source.triangles) {
    ids.add(triangle.area ?? DEFAULT_AREA_ID);
  }
  return [...ids].sort();
}

function createTraversalFlags(
  areaIds: readonly string[],
  layout: NavigationLayoutDefinition | undefined
): { areaFlags: Record<string, number>; portalFlags: Record<string, number> } {
  const portals = layout?.portals ?? [];
  if (areaIds.length + portals.length > MAX_TRAVERSAL_FLAGS) {
    throw createNavigationError(
      "navigation.recast_traversal_flag_limit",
      `Recast adapter supports at most ${MAX_TRAVERSAL_FLAGS} combined areas and portals per artifact`,
      { areas: areaIds.length, portals: portals.length, maximum: MAX_TRAVERSAL_FLAGS }
    );
  }
  const areaFlags = Object.fromEntries(areaIds.map((areaId, index) => [areaId, 1 << index]));
  const portalFlags = Object.fromEntries(
    portals.map((portal, index) => [portal.id, 1 << (areaIds.length + index)])
  );
  return { areaFlags, portalFlags };
}

function countSurfacePolygons(navMesh: import("recast-navigation").NavMesh): number {
  let polygonCount = 0;
  for (let tileIndex = 0; tileIndex < navMesh.getMaxTiles(); tileIndex += 1) {
    const tile = navMesh.getTile(tileIndex);
    const header = tile.header();
    if (header !== null) {
      polygonCount += header.offMeshBase();
    }
  }
  return polygonCount;
}

const DETOUR_POLYGON_AREA_MASK = 0x3f;

function collectDebugTriangleAreas(
  navMesh: import("recast-navigation").NavMesh,
  areaIds: readonly string[]
): string[] {
  const triangleAreas: string[] = [];
  for (let tileIndex = 0; tileIndex < navMesh.getMaxTiles(); tileIndex += 1) {
    const tile = navMesh.getTile(tileIndex);
    const header = tile.header();
    if (header === null) {
      continue;
    }
    for (let polygonIndex = 0; polygonIndex < header.polyCount(); polygonIndex += 1) {
      const polygon = tile.polys(polygonIndex);
      if (polygon.getType() === 1) {
        continue;
      }
      const areaIndex = polygon.areaAndType() & DETOUR_POLYGON_AREA_MASK;
      const areaId = areaIds[areaIndex - 1];
      if (areaId === undefined) {
        throw createNavigationError(
          "navigation.recast_unknown_debug_area",
          `Recast debug polygon references unknown area index ${areaIndex}`,
          { areaIndex, areaIds }
        );
      }
      const triangleCount = tile.detailMeshes(polygonIndex).triCount();
      for (let triangleIndex = 0; triangleIndex < triangleCount; triangleIndex += 1) {
        triangleAreas.push(areaId);
      }
    }
  }
  return triangleAreas;
}

function toRecastVector(point: NavigationPoint): { x: number; y: number; z: number } {
  return { x: point.x, y: point.z ?? 0, z: point.y };
}
