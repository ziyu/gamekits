import type {
  NavigationAgentProfileDefinition,
  NavigationObstacleTarget,
  NavigationPoint
} from "@gamekits/navigation-core";
import type { NavigationGridCellDefinition } from "../contracts/grid-definition";

export type CompiledNavigationGridCell = Omit<
  NavigationGridCellDefinition,
  "tags" | "obstacleIds"
> & {
  id: string;
  point: NavigationPoint;
  obstacleKeys: string[];
};

export type GridTraversalState = {
  target: NavigationObstacleTarget;
  blocked: boolean;
  costMultiplier: number;
};

export type GridAreaTraversalState = GridTraversalState & {
  target: Extract<NavigationObstacleTarget, { kind: "area" }>;
  baseCost: number;
};

export type CompiledNavigationGridArc = {
  from: string;
  to: string;
  baseCost: number;
  portalStateKey?: string | undefined;
  cornerCellIds?: [string, string] | undefined;
};

export type CompiledNavigationGrid = {
  id: string;
  width: number;
  height: number;
  cellSize: number;
  origin: NavigationPoint;
  cells: Map<string, CompiledNavigationGridCell>;
  areaStates: Map<string, GridAreaTraversalState>;
  obstacleStates: Map<string, GridTraversalState>;
  portalStates: Map<string, GridTraversalState>;
  reverseAdjacency: Map<string, CompiledNavigationGridArc[]>;
  dispose(): void;
};

export type GridRouteFieldStep = {
  nextCellId: string;
  dependencies: NavigationObstacleTarget[];
  portalId?: string | undefined;
};

export type GridRouteField = {
  key: string;
  retainCount: number;
  goalCellId: string;
  revision: number;
  profile: NavigationAgentProfileDefinition;
  distances: Map<string, number>;
  nextByCell: Map<string, GridRouteFieldStep>;
  treeDependencyKeys: Set<string>;
  treeDependencies: Map<string, NavigationObstacleTarget>;
};
