import type { NavigationLayoutDefinition, NavigationPoint } from "@gamekits/navigation-core";

export type NavigationGraphNodeDefinition = {
  id: string;
  point: NavigationPoint;
  area?: string | undefined;
  clearance?: number | undefined;
  heightClearance?: number | undefined;
  tags?: string[] | undefined;
};

export type NavigationGraphEdgeDefinition = {
  id: string;
  from: string;
  to: string;
  cost?: number | undefined;
  area?: string | undefined;
  bidirectional?: boolean | undefined;
  enabled?: boolean | undefined;
  width?: number | undefined;
  heightClearance?: number | undefined;
  slope?: number | undefined;
  tags?: string[] | undefined;
};

export type NavigationGraphDefinition = {
  id: string;
  nodes: NavigationGraphNodeDefinition[];
  edges: NavigationGraphEdgeDefinition[];
  tags?: string[] | undefined;
};

export type CreateGraphNavigationBackendOptions = {
  id?: string | undefined;
  graph: NavigationGraphDefinition;
  layout?: NavigationLayoutDefinition | undefined;
  maxRouteFields?: number | undefined;
};

export type CreateGraphNavigationBackendFactoryOptions = {
  id?: string | undefined;
  maxRouteFields?: number | undefined;
};
