import { createNavigationError } from "@gamekits/navigation-core";
import type { NavigationBackendFactory } from "@gamekits/navigation-core/backend";
import {
  NAVIGATION_NAVMESH_SOURCE_TYPE,
  type NavigationNavMeshSource
} from "@gamekits/navigation-navmesh";
import type { CreateRecastNavigationBackendFactoryOptions } from "../contracts";
import { createRecastNavigationBackend } from "./create-recast-navigation-backend";

export function createRecastNavigationBackendFactory(
  options: CreateRecastNavigationBackendFactoryOptions = {}
): NavigationBackendFactory {
  const id = options.id ?? "recast";
  return {
    id,
    create({ layout, dataRegistry }) {
      if (
        layout.source.type !== NAVIGATION_NAVMESH_SOURCE_TYPE ||
        !dataRegistry.hasType(NAVIGATION_NAVMESH_SOURCE_TYPE) ||
        !dataRegistry.has(NAVIGATION_NAVMESH_SOURCE_TYPE, layout.source.id)
      ) {
        throw createNavigationError(
          "navigation.recast_source_missing",
          `Navigation NavMesh source is not registered: ${layout.source.type}:${layout.source.id}`,
          { layoutId: layout.id, source: { ...layout.source } }
        );
      }
      return createRecastNavigationBackend({
        id: `navigation.recast.${layout.id}`,
        source: dataRegistry.getValue<NavigationNavMeshSource>(
          NAVIGATION_NAVMESH_SOURCE_TYPE,
          layout.source.id
        ),
        layout,
        ...(options.artifact === undefined ? {} : { artifact: options.artifact }),
        ...(options.queryHalfExtents === undefined
          ? {}
          : { queryHalfExtents: options.queryHalfExtents }),
        ...(options.maxRouteFields === undefined ? {} : { maxRouteFields: options.maxRouteFields })
      });
    }
  };
}
