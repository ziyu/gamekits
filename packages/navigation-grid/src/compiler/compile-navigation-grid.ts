import {
  cloneNavigationPoint,
  navigationDependencyKey,
  type NavigationLayoutDefinition,
  type NavigationObstacleTarget,
  type NavigationPoint
} from "@gamekits/navigation-core";
import type { NavigationGridDefinition } from "../contracts/grid-definition";
import type {
  CompiledNavigationGrid,
  CompiledNavigationGridArc,
  CompiledNavigationGridCell,
  GridAreaTraversalState,
  GridTraversalState
} from "./types";

const CARDINAL_DIRECTIONS = [
  [-1, 0],
  [0, -1],
  [0, 1],
  [1, 0]
] as const;

const DIAGONAL_DIRECTIONS = [
  [-1, -1],
  [-1, 1],
  [1, -1],
  [1, 1]
] as const;

export function compileNavigationGrid(
  definition: NavigationGridDefinition,
  layout?: NavigationLayoutDefinition
): CompiledNavigationGrid {
  requirePositiveInteger(definition.width, "width");
  requirePositiveInteger(definition.height, "height");
  if (!Number.isFinite(definition.cellSize) || definition.cellSize <= 0) {
    throw new Error("Navigation grid cellSize must be positive and finite");
  }

  const obstacleStates = createObstacleStates(definition);
  const areaStates = createAreaStates(definition, layout);
  const portalStates = new Map<string, GridTraversalState>();
  const cells = new Map<string, CompiledNavigationGridCell>();
  const reverseAdjacency = new Map<string, CompiledNavigationGridArc[]>();

  for (const cell of definition.cells) {
    requireCellCoordinate(cell.column, cell.row, definition);
    const id = gridCellId(cell.column, cell.row);
    if (cells.has(id)) {
      throw new Error(`Navigation grid contains duplicate cell ${id}`);
    }
    const obstacleKeys = (cell.obstacleIds ?? []).map((obstacleId) => {
      const key = navigationDependencyKey({ kind: "custom", id: obstacleId });
      if (!obstacleStates.has(key)) {
        throw new Error(`Navigation grid cell ${id} references unknown obstacle ${obstacleId}`);
      }
      return key;
    });
    cells.set(id, {
      ...cell,
      id,
      point: gridCellPoint(definition, cell.column, cell.row),
      obstacleKeys
    });
    reverseAdjacency.set(id, []);
  }

  const directions =
    definition.connectivity === 4
      ? CARDINAL_DIRECTIONS
      : ([...CARDINAL_DIRECTIONS, ...DIAGONAL_DIRECTIONS] as const);
  for (const cell of cells.values()) {
    for (const [columnOffset, rowOffset] of directions) {
      const to = gridCellId(cell.column + columnOffset, cell.row + rowOffset);
      if (!cells.has(to)) {
        continue;
      }
      const diagonal = columnOffset !== 0 && rowOffset !== 0;
      addArc({
        from: cell.id,
        to,
        baseCost: definition.cellSize * (diagonal ? Math.SQRT2 : 1),
        ...(diagonal
          ? {
              cornerCellIds: [
                gridCellId(cell.column + columnOffset, cell.row),
                gridCellId(cell.column, cell.row + rowOffset)
              ] as [string, string]
            }
          : {})
      });
    }
  }

  for (const portal of layout?.portals ?? []) {
    const from = nearestCellId(cells, portal.from.point, portal.from.area);
    const to = nearestCellId(cells, portal.to.point, portal.to.area);
    if (from === undefined || to === undefined) {
      throw new Error(`Navigation portal ${portal.id} cannot be projected onto grid cells`);
    }
    const target: NavigationObstacleTarget = { kind: "portal", id: portal.id };
    const portalStateKey = navigationDependencyKey(target);
    portalStates.set(portalStateKey, {
      target,
      blocked: portal.enabled === false,
      costMultiplier: 1
    });
    const baseCost = portal.cost ?? pointDistance(cells.get(from)!.point, cells.get(to)!.point);
    addArc({ from, to, baseCost, portalStateKey });
    if (portal.bidirectional !== false) {
      addArc({ from: to, to: from, baseCost, portalStateKey });
    }
  }

  for (const arcs of reverseAdjacency.values()) {
    arcs.sort(
      (left, right) => left.from.localeCompare(right.from) || left.to.localeCompare(right.to)
    );
  }

  return {
    id: definition.id,
    width: definition.width,
    height: definition.height,
    cellSize: definition.cellSize,
    origin: cloneNavigationPoint(definition.origin),
    cells,
    areaStates,
    obstacleStates,
    portalStates,
    reverseAdjacency,
    dispose() {
      cells.clear();
      areaStates.clear();
      obstacleStates.clear();
      portalStates.clear();
      reverseAdjacency.clear();
    }
  };

  function addArc(arc: CompiledNavigationGridArc): void {
    const reverse = reverseAdjacency.get(arc.to);
    if (reverse === undefined) {
      throw new Error(`Navigation grid arc points to unknown cell ${arc.to}`);
    }
    reverse.push(arc);
  }
}

export function gridCellId(column: number, row: number): string {
  return `${column}:${row}`;
}

function gridCellPoint(
  definition: NavigationGridDefinition,
  column: number,
  row: number
): NavigationPoint {
  return {
    x: definition.origin.x + column * definition.cellSize,
    y: definition.origin.y + row * definition.cellSize,
    ...(definition.origin.z === undefined ? {} : { z: definition.origin.z })
  };
}

function createObstacleStates(
  definition: NavigationGridDefinition
): Map<string, GridTraversalState> {
  const states = new Map<string, GridTraversalState>();
  for (const obstacle of definition.dynamicObstacles ?? []) {
    const target: NavigationObstacleTarget = { kind: "custom", id: obstacle.id };
    const key = navigationDependencyKey(target);
    if (states.has(key)) {
      throw new Error(`Navigation grid contains duplicate dynamic obstacle ${obstacle.id}`);
    }
    states.set(key, {
      target,
      blocked: obstacle.blocked ?? false,
      costMultiplier: obstacle.costMultiplier ?? 1
    });
  }
  return states;
}

function createAreaStates(
  definition: NavigationGridDefinition,
  layout: NavigationLayoutDefinition | undefined
): Map<string, GridAreaTraversalState> {
  const costs = new Map((layout?.areas ?? []).map((area) => [area.id, area.cost ?? 1]));
  for (const cell of definition.cells) {
    if (cell.area !== undefined && !costs.has(cell.area)) {
      costs.set(cell.area, 1);
    }
  }
  return new Map(
    [...costs.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([area, cost]) => {
        const target = { kind: "area" as const, id: area };
        return [area, { target, baseCost: cost, blocked: false, costMultiplier: 1 }] as const;
      })
  );
}

function nearestCellId(
  cells: Map<string, CompiledNavigationGridCell>,
  point: NavigationPoint,
  area: string | undefined
): string | undefined {
  let best: { id: string; distance: number } | undefined;
  for (const cell of cells.values()) {
    if (area !== undefined && cell.area !== area) {
      continue;
    }
    const distance = pointDistance(cell.point, point);
    if (
      best === undefined ||
      distance < best.distance ||
      (distance === best.distance && cell.id.localeCompare(best.id) < 0)
    ) {
      best = { id: cell.id, distance };
    }
  }
  return best?.id;
}

function requirePositiveInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`Navigation grid ${name} must be a positive integer`);
  }
}

function requireCellCoordinate(
  column: number,
  row: number,
  definition: NavigationGridDefinition
): void {
  if (
    !Number.isSafeInteger(column) ||
    !Number.isSafeInteger(row) ||
    column < 0 ||
    row < 0 ||
    column >= definition.width ||
    row >= definition.height
  ) {
    throw new Error(
      `Navigation grid cell ${column}:${row} is outside ${definition.width}x${definition.height}`
    );
  }
}

function pointDistance(left: NavigationPoint, right: NavigationPoint): number {
  return Math.hypot(left.x - right.x, left.y - right.y, (left.z ?? 0) - (right.z ?? 0));
}
