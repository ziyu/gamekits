import { createNavigationError } from "@gamekits/navigation-core";
import type { NavigationBackendFactory } from "@gamekits/navigation-core/backend";
import type {
  CreateGridNavigationBackendFactoryOptions,
  NavigationGridDefinition
} from "../contracts/grid-definition";
import { NAVIGATION_GRID_TYPE } from "../data";
import { createGridNavigationBackend } from "./create-grid-navigation-backend";

export function createGridNavigationBackendFactory(
  options: CreateGridNavigationBackendFactoryOptions = {}
): NavigationBackendFactory {
  const id = options.id ?? "grid";
  return {
    id,
    create({ layout, dataRegistry }) {
      if (
        layout.source.type !== NAVIGATION_GRID_TYPE ||
        !dataRegistry.hasType(NAVIGATION_GRID_TYPE) ||
        !dataRegistry.has(NAVIGATION_GRID_TYPE, layout.source.id)
      ) {
        throw createNavigationError(
          "navigation.grid_source_missing",
          `Navigation grid source is not registered: ${layout.source.type}:${layout.source.id}`,
          { layoutId: layout.id, source: { ...layout.source } }
        );
      }
      return createGridNavigationBackend({
        id: `navigation.grid.${layout.id}`,
        grid: dataRegistry.getValue<NavigationGridDefinition>(
          NAVIGATION_GRID_TYPE,
          layout.source.id
        ),
        layout,
        ...(options.maxRouteFields === undefined ? {} : { maxRouteFields: options.maxRouteFields })
      });
    }
  };
}
