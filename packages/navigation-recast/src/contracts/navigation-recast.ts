import type { NavigationLayoutDefinition, NavigationPoint } from "@gamekits/navigation-core";
import type { NavigationNavMeshSource } from "@gamekits/navigation-navmesh";

export type NavigationRecastDebugMesh = {
  vertices: NavigationPoint[];
  indices: number[];
  /** Area id for each triangle in `indices`, in the same order. */
  triangleAreas: string[];
};

/** Adapter-owned, transferable output from a Recast bake. */
export type NavigationRecastBuildArtifact = {
  sourceId: string;
  sourceVersion?: string | undefined;
  data: Uint8Array;
  debugMesh: NavigationRecastDebugMesh;
  polygonCount: number;
  areaIds: string[];
  areaIndices: Record<string, number>;
  areaFlags: Record<string, number>;
  portalFlags: Record<string, number>;
};

export type CreateRecastNavigationBackendOptions = {
  id?: string | undefined;
  source: NavigationNavMeshSource;
  layout?: NavigationLayoutDefinition | undefined;
  artifact?: NavigationRecastBuildArtifact | undefined;
  queryHalfExtents?: NavigationPoint | undefined;
  maxRouteFields?: number | undefined;
};

export type CreateRecastNavigationBackendFactoryOptions = {
  id?: string | undefined;
  artifact?: NavigationRecastBuildArtifact | undefined;
  queryHalfExtents?: NavigationPoint | undefined;
  maxRouteFields?: number | undefined;
};
