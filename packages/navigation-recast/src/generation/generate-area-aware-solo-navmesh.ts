import type { NavigationNavMeshSource } from "@gamekits/navigation-navmesh";
import {
  allocCompactHeightfield,
  allocContourSet,
  allocHeightfield,
  allocPolyMesh,
  allocPolyMeshDetail,
  buildCompactHeightfield,
  buildContours,
  buildDistanceField,
  buildPolyMesh,
  buildPolyMeshDetail,
  buildRegions,
  calcGridSize,
  createHeightfield,
  createNavMeshData,
  createRcConfig,
  erodeWalkableArea,
  filterLedgeSpans,
  filterLowHangingWalkableObstacles,
  filterWalkableLowHeightSpans,
  freeCompactHeightfield,
  freeContourSet,
  freeHeightfield,
  freePolyMesh,
  freePolyMeshDetail,
  markWalkableTriangles,
  NavMesh,
  NavMeshCreateParams,
  rasterizeTriangles,
  Raw,
  Recast,
  RecastBuildContext,
  TriangleAreasArray,
  TrianglesArray,
  VerticesArray,
  type OffMeshConnectionParams,
  type RecastCompactHeightfield,
  type RecastContourSet,
  type RecastHeightfield,
  type RecastPolyMesh,
  type RecastPolyMeshDetail
} from "recast-navigation";
import {
  soloNavMeshGeneratorConfigDefaults,
  type SoloNavMeshGeneratorConfig
} from "recast-navigation/generators";

export function generateAreaAwareSoloNavMesh(options: {
  source: NavigationNavMeshSource;
  positions: readonly number[];
  indices: readonly number[];
  config: Partial<SoloNavMeshGeneratorConfig>;
  areaIndices: Readonly<Record<string, number>>;
  areaFlags: Readonly<Record<string, number>>;
  offMeshConnections: OffMeshConnectionParams[];
}): NavMesh {
  const buildContext = new RecastBuildContext();
  const vertices = new VerticesArray();
  const triangles = new TrianglesArray();
  const triangleAreas = new TriangleAreasArray();
  let heightfield: RecastHeightfield | undefined;
  let compactHeightfield: RecastCompactHeightfield | undefined;
  let contourSet: RecastContourSet | undefined;
  let polyMesh: RecastPolyMesh | undefined;
  let polyMeshDetail: RecastPolyMeshDetail | undefined;
  let createParams: NavMeshCreateParams | undefined;
  let rcConfig: ReturnType<typeof createRcConfig> | undefined;

  try {
    vertices.copy([...options.positions]);
    triangles.copy([...options.indices]);
    const triangleCount = options.indices.length / 3;
    const vertexCount = options.positions.length / 3;
    const bounds = boundingBox(options.positions, options.indices);
    const config = { ...soloNavMeshGeneratorConfigDefaults, ...options.config };
    rcConfig = createRcConfig(config);
    rcConfig.minRegionArea *= rcConfig.minRegionArea;
    rcConfig.mergeRegionArea *= rcConfig.mergeRegionArea;
    rcConfig.detailSampleDist =
      rcConfig.detailSampleDist < 0.9 ? 0 : rcConfig.cs * rcConfig.detailSampleDist;
    rcConfig.detailSampleMaxError = rcConfig.ch * rcConfig.detailSampleMaxError;
    const gridSize = calcGridSize(bounds.minimum, bounds.maximum, rcConfig.cs);
    rcConfig.width = gridSize.width;
    rcConfig.height = gridSize.height;

    heightfield = allocHeightfield();
    if (
      !createHeightfield(
        buildContext,
        heightfield,
        rcConfig.width,
        rcConfig.height,
        bounds.minimum,
        bounds.maximum,
        rcConfig.cs,
        rcConfig.ch
      )
    ) {
      throw new Error("Could not create Recast heightfield");
    }

    triangleAreas.resize(triangleCount);
    markWalkableTriangles(
      buildContext,
      rcConfig.walkableSlopeAngle,
      vertices,
      vertexCount,
      triangles,
      triangleCount,
      triangleAreas
    );
    for (let index = 0; index < triangleCount; index += 1) {
      if (triangleAreas.get(index) === Recast.RC_NULL_AREA) {
        continue;
      }
      const areaId = options.source.triangles[index]?.area ?? "default";
      const areaIndex = options.areaIndices[areaId];
      if (areaIndex === undefined) {
        throw new Error(`Missing Recast area index for ${areaId}`);
      }
      triangleAreas.set(index, areaIndex);
    }
    if (
      !rasterizeTriangles(
        buildContext,
        vertices,
        vertexCount,
        triangles,
        triangleAreas,
        triangleCount,
        heightfield,
        rcConfig.walkableClimb
      )
    ) {
      throw new Error("Could not rasterize Recast triangles");
    }

    filterLowHangingWalkableObstacles(buildContext, rcConfig.walkableClimb, heightfield);
    filterLedgeSpans(buildContext, rcConfig.walkableHeight, rcConfig.walkableClimb, heightfield);
    filterWalkableLowHeightSpans(buildContext, rcConfig.walkableHeight, heightfield);

    compactHeightfield = allocCompactHeightfield();
    if (
      !buildCompactHeightfield(
        buildContext,
        rcConfig.walkableHeight,
        rcConfig.walkableClimb,
        heightfield,
        compactHeightfield
      )
    ) {
      throw new Error("Could not build Recast compact heightfield");
    }
    if (!erodeWalkableArea(buildContext, rcConfig.walkableRadius, compactHeightfield)) {
      throw new Error("Could not erode Recast walkable area");
    }
    if (!buildDistanceField(buildContext, compactHeightfield)) {
      throw new Error("Could not build Recast distance field");
    }
    if (
      !buildRegions(
        buildContext,
        compactHeightfield,
        rcConfig.borderSize,
        rcConfig.minRegionArea,
        rcConfig.mergeRegionArea
      )
    ) {
      throw new Error("Could not build Recast regions");
    }

    contourSet = allocContourSet();
    if (
      !buildContours(
        buildContext,
        compactHeightfield,
        rcConfig.maxSimplificationError,
        rcConfig.maxEdgeLen,
        contourSet,
        Recast.RC_CONTOUR_TESS_WALL_EDGES
      )
    ) {
      throw new Error("Could not build Recast contours");
    }
    polyMesh = allocPolyMesh();
    if (!buildPolyMesh(buildContext, contourSet, rcConfig.maxVertsPerPoly, polyMesh)) {
      throw new Error("Could not build Recast polygon mesh");
    }
    polyMeshDetail = allocPolyMeshDetail();
    if (
      !buildPolyMeshDetail(
        buildContext,
        polyMesh,
        compactHeightfield,
        rcConfig.detailSampleDist,
        rcConfig.detailSampleMaxError,
        polyMeshDetail
      )
    ) {
      throw new Error("Could not build Recast polygon detail mesh");
    }

    for (let index = 0; index < polyMesh.npolys(); index += 1) {
      const areaIndex = polyMesh.areas(index);
      const areaId = areaIdForIndex(options.areaIndices, areaIndex);
      const flag = areaId === undefined ? undefined : options.areaFlags[areaId];
      if (flag === undefined) {
        throw new Error(`Missing Recast traversal flag for polygon area ${areaIndex}`);
      }
      polyMesh.setFlags(index, flag);
    }

    createParams = new NavMeshCreateParams();
    createParams.setPolyMeshCreateParams(polyMesh);
    createParams.setPolyMeshDetailCreateParams(polyMeshDetail);
    createParams.setWalkableHeight(rcConfig.walkableHeight * rcConfig.ch);
    createParams.setWalkableRadius(rcConfig.walkableRadius * rcConfig.cs);
    createParams.setWalkableClimb(rcConfig.walkableClimb * rcConfig.ch);
    createParams.setCellSize(rcConfig.cs);
    createParams.setCellHeight(rcConfig.ch);
    createParams.setBuildBvTree(config.buildBvTree);
    createParams.setOffMeshConnections(options.offMeshConnections);
    const dataResult = createNavMeshData(createParams);
    if (!dataResult.success) {
      throw new Error("Could not create Detour NavMesh data");
    }
    const navMesh = new NavMesh();
    if (!navMesh.initSolo(dataResult.navMeshData)) {
      dataResult.navMeshData.destroy();
      navMesh.destroy();
      throw new Error("Could not initialize Detour NavMesh");
    }
    return navMesh;
  } finally {
    triangleAreas.destroy();
    triangles.destroy();
    vertices.destroy();
    if (heightfield !== undefined) {
      freeHeightfield(heightfield);
    }
    if (compactHeightfield !== undefined) {
      freeCompactHeightfield(compactHeightfield);
    }
    if (contourSet !== undefined) {
      freeContourSet(contourSet);
    }
    if (polyMesh !== undefined) {
      freePolyMesh(polyMesh);
    }
    if (polyMeshDetail !== undefined) {
      freePolyMeshDetail(polyMeshDetail);
    }
    if (createParams !== undefined) {
      Raw.destroy(createParams.raw);
    }
    if (rcConfig !== undefined) {
      Raw.destroy(rcConfig);
    }
    Raw.destroy(buildContext.raw);
  }
}

function boundingBox(
  positions: readonly number[],
  indices: readonly number[]
): { minimum: [number, number, number]; maximum: [number, number, number] } {
  const minimum: [number, number, number] = [Infinity, Infinity, Infinity];
  const maximum: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (const vertexIndex of indices) {
    for (const axis of [0, 1, 2] as const) {
      const value = positions[vertexIndex * 3 + axis] ?? 0;
      minimum[axis] = Math.min(minimum[axis], value);
      maximum[axis] = Math.max(maximum[axis], value);
    }
  }
  return { minimum, maximum };
}

function areaIdForIndex(
  areaIndices: Readonly<Record<string, number>>,
  areaIndex: number
): string | undefined {
  return Object.entries(areaIndices).find(([, candidate]) => candidate === areaIndex)?.[0];
}
