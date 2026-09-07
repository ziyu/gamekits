import type { NavigationLayoutDefinition, NavigationPoint } from "@gamekits/navigation-core";

export type NavigationLabDebugLayerId = "topology" | "areas" | "constraints";

export type NavigationLabDebugStateBinding = "bridge" | "ridgeTrail" | "marsh" | "waystone";

export type NavigationLabDebugTraversal = {
  area?: string | undefined;
  clearance?: number | undefined;
  width?: number | undefined;
  heightClearance?: number | undefined;
  slope?: number | undefined;
  stateBinding?: NavigationLabDebugStateBinding | undefined;
};

export type NavigationLabDebugShape =
  | (NavigationLabDebugTraversal & {
      kind: "point";
      point: NavigationPoint;
      radius: number;
    })
  | (NavigationLabDebugTraversal & {
      kind: "polyline";
      points: readonly NavigationPoint[];
      lineWidth: number;
      dashed?: boolean | undefined;
    })
  | (NavigationLabDebugTraversal & {
      kind: "polygon";
      points: readonly NavigationPoint[];
    });

export type NavigationLabBackendDebugView = {
  backendId: string;
  summary: string;
  areaCosts: Readonly<Record<string, number>>;
  shapes: readonly NavigationLabDebugShape[];
};

export function createNavigationLabDebugAreaCosts(
  layout: NavigationLayoutDefinition
): Record<string, number> {
  return Object.fromEntries((layout.areas ?? []).map((area) => [area.id, area.cost ?? 1]));
}

export const NAVIGATION_LAB_DEBUG_LAYERS = [
  {
    id: "topology",
    label: "Topology",
    description: "Walkable cells, graph links, and projection anchors"
  },
  {
    id: "areas",
    label: "Area cost",
    description: "Backend area assignment and traversal-cost regions"
  },
  {
    id: "constraints",
    label: "Constraints",
    description: "Current profile clearance, slope, blockers, and portals"
  }
] as const satisfies ReadonlyArray<{
  id: NavigationLabDebugLayerId;
  label: string;
  description: string;
}>;
