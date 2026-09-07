import type { DataRef, DataRegistry } from "@gamekits/data";
import type { NavigationBackendAdapter, NavigationBackendFactory } from "../backend/port";
import { createNavigationError } from "../contracts/errors";
import type { NavigationLayoutDefinition } from "../contracts/layout";
import { NAVIGATION_LAYOUT_TYPE } from "./navigation-data-types";

export type ResolveNavigationBackendOptions = {
  layout: NavigationLayoutDefinition | DataRef;
  dataRegistry: DataRegistry;
  backendFactories: readonly NavigationBackendFactory[];
};

export type ResolvedNavigationBackend = {
  layout: NavigationLayoutDefinition;
  backend: NavigationBackendAdapter;
};

export function resolveNavigationBackend(
  options: ResolveNavigationBackendOptions
): ResolvedNavigationBackend {
  const layout = isLayoutDefinition(options.layout)
    ? cloneLayout(options.layout)
    : resolveLayoutRef(options.layout, options.dataRegistry);
  const factories = new Map(options.backendFactories.map((factory) => [factory.id, factory]));
  const factory = factories.get(layout.backend);
  if (factory === undefined) {
    throw createNavigationError(
      "navigation.backend_factory_missing",
      `Navigation backend factory is not registered: ${layout.backend}`,
      { layoutId: layout.id, backendId: layout.backend }
    );
  }
  return { layout, backend: factory.create({ layout, dataRegistry: options.dataRegistry }) };
}

function resolveLayoutRef(ref: DataRef, registry: DataRegistry): NavigationLayoutDefinition {
  if (
    ref.type !== NAVIGATION_LAYOUT_TYPE ||
    !registry.hasType(NAVIGATION_LAYOUT_TYPE) ||
    !registry.has(ref.type, ref.id)
  ) {
    throw createNavigationError(
      "navigation.layout_missing",
      `Navigation layout is not registered: ${ref.type}:${ref.id}`,
      { type: ref.type, id: ref.id }
    );
  }
  return cloneLayout(registry.getValue<NavigationLayoutDefinition>(ref.type, ref.id));
}

function isLayoutDefinition(
  value: NavigationLayoutDefinition | DataRef
): value is NavigationLayoutDefinition {
  return "backend" in value && "source" in value;
}

function cloneLayout(layout: NavigationLayoutDefinition): NavigationLayoutDefinition {
  return {
    ...layout,
    source: { ...layout.source },
    ...(layout.areas === undefined
      ? {}
      : { areas: layout.areas.map((area) => ({ ...area, tags: area.tags && [...area.tags] })) }),
    ...(layout.portals === undefined
      ? {}
      : {
          portals: layout.portals.map((portal) => ({
            ...portal,
            from: { ...portal.from, point: { ...portal.from.point } },
            to: { ...portal.to, point: { ...portal.to.point } }
          }))
        }),
    ...(layout.tags === undefined ? {} : { tags: [...layout.tags] })
  };
}
