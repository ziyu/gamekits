import {
  cloneNavigationPoint,
  type NavigationAgentProfileDefinition,
  type NavigationPoint,
  type NavigationProjection
} from "@gamekits/navigation-core";
import { gridCellId } from "../compiler/compile-navigation-grid";
import type { CompiledNavigationGrid, CompiledNavigationGridCell } from "../compiler/types";

export function projectGridPoint(
  point: NavigationPoint,
  profile: NavigationAgentProfileDefinition,
  grid: CompiledNavigationGrid,
  revision: number
): NavigationProjection | undefined {
  const centerColumn = clamp(
    Math.round((point.x - grid.origin.x) / grid.cellSize),
    0,
    grid.width - 1
  );
  const centerRow = clamp(
    Math.round((point.y - grid.origin.y) / grid.cellSize),
    0,
    grid.height - 1
  );
  const maxRadius = Math.max(grid.width, grid.height);
  let best: { cell: CompiledNavigationGridCell; distance: number } | undefined;

  for (let radius = 0; radius <= maxRadius; radius += 1) {
    for (let row = centerRow - radius; row <= centerRow + radius; row += 1) {
      for (let column = centerColumn - radius; column <= centerColumn + radius; column += 1) {
        if (
          radius > 0 &&
          column !== centerColumn - radius &&
          column !== centerColumn + radius &&
          row !== centerRow - radius &&
          row !== centerRow + radius
        ) {
          continue;
        }
        const cell = grid.cells.get(gridCellId(column, row));
        if (cell === undefined || !cellSupportsProfile(cell, profile, grid)) {
          continue;
        }
        const distance = pointDistance(point, cell.point);
        if (
          best === undefined ||
          distance < best.distance ||
          (distance === best.distance && cell.id.localeCompare(best.cell.id) < 0)
        ) {
          best = { cell, distance };
        }
      }
    }
    if (best !== undefined && best.distance <= minimumDistanceToUnseenCells(radius)) {
      return {
        point: cloneNavigationPoint(best.cell.point),
        backendNodeId: best.cell.id,
        ...(best.cell.area === undefined ? {} : { area: best.cell.area }),
        distance: best.distance,
        revision
      };
    }
  }
  return undefined;

  function minimumDistanceToUnseenCells(radius: number): number {
    const nextColumns = [centerColumn - radius - 1, centerColumn + radius + 1].filter(
      (column) => column >= 0 && column < grid.width
    );
    const nextRows = [centerRow - radius - 1, centerRow + radius + 1].filter(
      (row) => row >= 0 && row < grid.height
    );
    return Math.min(
      ...nextColumns.map((column) => Math.abs(point.x - (grid.origin.x + column * grid.cellSize))),
      ...nextRows.map((row) => Math.abs(point.y - (grid.origin.y + row * grid.cellSize))),
      Number.POSITIVE_INFINITY
    );
  }
}

export function cellSupportsProfile(
  cell: CompiledNavigationGridCell,
  profile: NavigationAgentProfileDefinition,
  grid: CompiledNavigationGrid
): boolean {
  if (
    (cell.area !== undefined &&
      profile.allowedAreas !== undefined &&
      !profile.allowedAreas.includes(cell.area)) ||
    (cell.clearance !== undefined && cell.clearance < profile.radius) ||
    (profile.height !== undefined &&
      cell.heightClearance !== undefined &&
      cell.heightClearance < profile.height) ||
    (profile.maxSlope !== undefined && cell.slope !== undefined && cell.slope > profile.maxSlope)
  ) {
    return false;
  }
  if (cell.area !== undefined && grid.areaStates.get(cell.area)?.blocked === true) {
    return false;
  }
  return cell.obstacleKeys.every((key) => grid.obstacleStates.get(key)?.blocked !== true);
}

export function pointDistance(left: NavigationPoint, right: NavigationPoint): number {
  return Math.hypot(left.x - right.x, left.y - right.y, (left.z ?? 0) - (right.z ?? 0));
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}
