import type { DataDiagnostic, DataDocument, DataTypeDefinition } from "@gamekits/data";
import type { NavigationGridDefinition } from "../contracts/grid-definition";

export const NAVIGATION_GRID_TYPE = "navigation.grid";

export function createNavigationGridDataType(): DataTypeDefinition<NavigationGridDefinition> {
  return {
    type: NAVIGATION_GRID_TYPE,
    getTags: (grid) => grid.tags ?? [],
    validate(document) {
      const diagnostics: DataDiagnostic[] = [];
      const grid = document.data;
      if (!nonEmptyString(grid.id)) {
        diagnostics.push(
          diagnostic("navigation.grid_missing_id", "Navigation grid requires an id", document, "id")
        );
      }
      validatePositiveInteger(diagnostics, grid.width, "width", document);
      validatePositiveInteger(diagnostics, grid.height, "height", document);
      if (!Number.isFinite(grid.cellSize) || grid.cellSize <= 0) {
        diagnostics.push(
          diagnostic(
            "navigation.grid_invalid_cell_size",
            "Navigation grid cellSize must be positive and finite",
            document,
            "cellSize"
          )
        );
      }
      if (!validPoint(grid.origin)) {
        diagnostics.push(
          diagnostic(
            "navigation.grid_invalid_origin",
            "Navigation grid origin must be finite",
            document,
            "origin"
          )
        );
      }
      if (grid.connectivity !== undefined && grid.connectivity !== 4 && grid.connectivity !== 8) {
        diagnostics.push(
          diagnostic(
            "navigation.grid_invalid_connectivity",
            "Navigation grid connectivity must be 4 or 8",
            document,
            "connectivity"
          )
        );
      }
      if (!Array.isArray(grid.cells) || grid.cells.length === 0) {
        diagnostics.push(
          diagnostic(
            "navigation.grid_missing_cells",
            "Navigation grid requires at least one walkable cell",
            document,
            "cells"
          )
        );
      }

      const obstacleIds = new Set<string>();
      for (const [index, obstacle] of (grid.dynamicObstacles ?? []).entries()) {
        if (!nonEmptyString(obstacle.id) || obstacleIds.has(obstacle.id)) {
          diagnostics.push(
            diagnostic(
              obstacleIds.has(obstacle.id)
                ? "navigation.grid_duplicate_obstacle"
                : "navigation.grid_obstacle_missing_id",
              "Navigation grid dynamic obstacles require unique ids",
              document,
              `dynamicObstacles[${index}].id`
            )
          );
        }
        obstacleIds.add(obstacle.id);
        validatePositiveOptional(
          diagnostics,
          obstacle.costMultiplier,
          "navigation.grid_invalid_obstacle_cost",
          "Navigation grid obstacle costMultiplier must be positive and finite",
          document,
          `dynamicObstacles[${index}].costMultiplier`
        );
      }

      const cellIds = new Set<string>();
      for (const [index, cell] of (grid.cells ?? []).entries()) {
        const key = `${cell.column}:${cell.row}`;
        if (
          !Number.isSafeInteger(cell.column) ||
          !Number.isSafeInteger(cell.row) ||
          cell.column < 0 ||
          cell.row < 0 ||
          cell.column >= grid.width ||
          cell.row >= grid.height
        ) {
          diagnostics.push(
            diagnostic(
              "navigation.grid_cell_out_of_bounds",
              "Navigation grid cell coordinates must be integer coordinates inside the grid",
              document,
              `cells[${index}]`
            )
          );
        }
        if (cellIds.has(key)) {
          diagnostics.push(
            diagnostic(
              "navigation.grid_duplicate_cell",
              "Navigation grid walkable cells must use unique coordinates",
              document,
              `cells[${index}]`
            )
          );
        }
        cellIds.add(key);
        validatePositiveOptional(
          diagnostics,
          cell.clearance,
          "navigation.grid_invalid_cell_clearance",
          "Navigation grid cell clearance must be positive and finite",
          document,
          `cells[${index}].clearance`
        );
        validatePositiveOptional(
          diagnostics,
          cell.heightClearance,
          "navigation.grid_invalid_cell_height_clearance",
          "Navigation grid cell heightClearance must be positive and finite",
          document,
          `cells[${index}].heightClearance`
        );
        validatePositiveOptional(
          diagnostics,
          cell.costMultiplier,
          "navigation.grid_invalid_cell_cost",
          "Navigation grid cell costMultiplier must be positive and finite",
          document,
          `cells[${index}].costMultiplier`
        );
        if (cell.slope !== undefined && (!Number.isFinite(cell.slope) || cell.slope < 0)) {
          diagnostics.push(
            diagnostic(
              "navigation.grid_invalid_cell_slope",
              "Navigation grid cell slope must be non-negative and finite",
              document,
              `cells[${index}].slope`
            )
          );
        }
        for (const obstacleId of cell.obstacleIds ?? []) {
          if (!obstacleIds.has(obstacleId)) {
            diagnostics.push(
              diagnostic(
                "navigation.grid_unknown_cell_obstacle",
                `Navigation grid cell references unknown obstacle ${obstacleId}`,
                document,
                `cells[${index}].obstacleIds`
              )
            );
          }
        }
      }
      return diagnostics;
    }
  };
}

function validatePositiveInteger(
  diagnostics: DataDiagnostic[],
  value: number,
  path: string,
  document: DataDocument
): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    diagnostics.push(
      diagnostic(
        `navigation.grid_invalid_${path}`,
        `Navigation grid ${path} must be a positive integer`,
        document,
        path
      )
    );
  }
}

function validatePositiveOptional(
  diagnostics: DataDiagnostic[],
  value: number | undefined,
  code: string,
  message: string,
  document: DataDocument,
  path: string
): void {
  if (value !== undefined && (!Number.isFinite(value) || value <= 0)) {
    diagnostics.push(diagnostic(code, message, document, path));
  }
}

function diagnostic(
  code: string,
  message: string,
  document: DataDocument,
  path: string
): DataDiagnostic {
  return {
    code,
    message,
    severity: "error",
    key: { type: document.type, id: document.id },
    path,
    ...(document.sourcePackId === undefined ? {} : { sourcePackId: document.sourcePackId })
  };
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function validPoint(point: NavigationGridDefinition["origin"]): boolean {
  return (
    Number.isFinite(point?.x) &&
    Number.isFinite(point?.y) &&
    (point?.z === undefined || Number.isFinite(point.z))
  );
}
