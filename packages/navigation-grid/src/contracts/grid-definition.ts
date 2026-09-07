import type { NavigationLayoutDefinition, NavigationPoint } from "@gamekits/navigation-core";

export type NavigationGridCellCoordinate = {
  column: number;
  row: number;
};

export type NavigationGridCellDefinition = NavigationGridCellCoordinate & {
  area?: string | undefined;
  clearance?: number | undefined;
  heightClearance?: number | undefined;
  slope?: number | undefined;
  costMultiplier?: number | undefined;
  obstacleIds?: string[] | undefined;
  tags?: string[] | undefined;
};

export type NavigationGridDynamicObstacleDefinition = {
  id: string;
  blocked?: boolean | undefined;
  costMultiplier?: number | undefined;
  tags?: string[] | undefined;
};

export type NavigationGridDefinition = {
  id: string;
  width: number;
  height: number;
  cellSize: number;
  origin: NavigationPoint;
  connectivity?: 4 | 8 | undefined;
  cells: NavigationGridCellDefinition[];
  dynamicObstacles?: NavigationGridDynamicObstacleDefinition[] | undefined;
  tags?: string[] | undefined;
};

export type CreateGridNavigationBackendOptions = {
  id?: string | undefined;
  grid: NavigationGridDefinition;
  layout?: NavigationLayoutDefinition | undefined;
  maxRouteFields?: number | undefined;
};

export type CreateGridNavigationBackendFactoryOptions = {
  id?: string | undefined;
  maxRouteFields?: number | undefined;
};
