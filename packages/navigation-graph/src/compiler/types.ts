import type {
  NavigationAgentProfileDefinition,
  NavigationObstacleTarget,
  NavigationPoint
} from "@gamekits/navigation-core";
import type { NavigationGraphNodeDefinition } from "../contracts/graph-definition";
import type { NavigationGraphSpatialIndex } from "./spatial-index";

export type CompiledNavigationNode = Omit<NavigationGraphNodeDefinition, "point"> & {
  point: NavigationPoint;
};

export type TraversalState = {
  target: NavigationObstacleTarget;
  blocked: boolean;
  costMultiplier: number;
};

export type AreaTraversalState = TraversalState & {
  target: Extract<NavigationObstacleTarget, { kind: "area" }>;
  baseCost: number;
};

export type CompiledNavigationArc = {
  stateKey: string;
  dependency: NavigationObstacleTarget;
  from: string;
  to: string;
  baseCost: number;
  area?: string | undefined;
  width?: number | undefined;
  heightClearance?: number | undefined;
  slope?: number | undefined;
};

export type CompiledNavigationGraph = {
  id: string;
  nodes: Map<string, CompiledNavigationNode>;
  connectionStates: Map<string, TraversalState>;
  areaStates: Map<string, AreaTraversalState>;
  reverseAdjacency: Map<string, CompiledNavigationArc[]>;
  spatialIndex: NavigationGraphSpatialIndex;
  dispose(): void;
};

export type GraphRouteFieldStep = {
  nextNodeId: string;
  dependencies: NavigationObstacleTarget[];
  portalId?: string | undefined;
};

export type GraphRouteField = {
  key: string;
  retainCount: number;
  goalNodeId: string;
  revision: number;
  profile: NavigationAgentProfileDefinition;
  distances: Map<string, number>;
  nextByNode: Map<string, GraphRouteFieldStep>;
  treeDependencyKeys: Set<string>;
  treeDependencies: Map<string, NavigationObstacleTarget>;
};
