import type { NavigationPoint } from "@gamekits/navigation-core";

export type NavigationNavMeshBuildProfile = {
  /** Horizontal raster cell size in world units. */
  cellSize: number;
  /** Elevation raster cell size in world units. */
  cellHeight: number;
  /** Agent radius in world units. */
  walkableRadius: number;
  /** Required floor-to-ceiling clearance in world units. */
  walkableHeight: number;
  /** Maximum traversable ledge height in world units. */
  walkableClimb: number;
  /** Maximum traversable surface angle in degrees. */
  walkableSlopeAngle: number;
  /** Minimum isolated region area in square world units. */
  minRegionArea?: number | undefined;
  /** Region merge threshold in square world units. */
  mergeRegionArea?: number | undefined;
  /** Maximum contour deviation in world units. */
  maxSimplificationError?: number | undefined;
  /** Maximum contour edge length in world units. */
  maxEdgeLength?: number | undefined;
  maxVerticesPerPolygon?: number | undefined;
  /** Detail-mesh sampling distance in world units. */
  detailSampleDistance?: number | undefined;
  /** Maximum detail-mesh height error in world units. */
  detailSampleMaxError?: number | undefined;
};

export type NavigationNavMeshTriangle = {
  a: number;
  b: number;
  c: number;
  area?: string | undefined;
  tags?: string[] | undefined;
};

/**
 * Serializable, implementation-neutral geometry used to bake a navigation mesh.
 * Navigation coordinates use x/y as the gameplay plane and optional z as elevation.
 * Triangle indices use counter-clockwise winding when viewed from positive elevation.
 */
export type NavigationNavMeshSource = {
  id: string;
  vertices: NavigationPoint[];
  triangles: NavigationNavMeshTriangle[];
  build: NavigationNavMeshBuildProfile;
  tags?: string[] | undefined;
  version?: string | undefined;
};
