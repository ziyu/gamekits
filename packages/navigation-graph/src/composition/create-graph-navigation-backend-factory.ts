import { createNavigationError } from "@gamekits/navigation-core";
import type { NavigationBackendFactory } from "@gamekits/navigation-core/backend";
import type {
  CreateGraphNavigationBackendFactoryOptions,
  NavigationGraphDefinition
} from "../contracts/graph-definition";
import { NAVIGATION_GRAPH_TYPE } from "../data";
import { createGraphNavigationBackend } from "./create-graph-navigation-backend";

export function createGraphNavigationBackendFactory(
  options: CreateGraphNavigationBackendFactoryOptions = {}
): NavigationBackendFactory {
  const id = options.id ?? "graph";
  return {
    id,
    create({ layout, dataRegistry }) {
      if (
        layout.source.type !== NAVIGATION_GRAPH_TYPE ||
        !dataRegistry.hasType(NAVIGATION_GRAPH_TYPE) ||
        !dataRegistry.has(NAVIGATION_GRAPH_TYPE, layout.source.id)
      ) {
        throw createNavigationError(
          "navigation.graph_source_missing",
          `Navigation graph source is not registered: ${layout.source.type}:${layout.source.id}`,
          { layoutId: layout.id, source: { ...layout.source } }
        );
      }
      return createGraphNavigationBackend({
        id: `navigation.graph.${layout.id}`,
        graph: dataRegistry.getValue<NavigationGraphDefinition>(
          NAVIGATION_GRAPH_TYPE,
          layout.source.id
        ),
        layout,
        ...(options.maxRouteFields === undefined ? {} : { maxRouteFields: options.maxRouteFields })
      });
    }
  };
}
