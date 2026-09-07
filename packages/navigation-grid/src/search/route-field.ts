import {
  cloneNavigationDependencies,
  cloneNavigationPoint,
  cloneNavigationProfile,
  navigationDependencyKey,
  type NavigationAgentProfileDefinition,
  type NavigationObstacleTarget,
  type NavigationPathTraversal,
  type NavigationPoint
} from "@gamekits/navigation-core";
import type { NavigationBackendRouteSample } from "@gamekits/navigation-core/backend";
import type {
  CompiledNavigationGrid,
  CompiledNavigationGridArc,
  CompiledNavigationGridCell,
  GridRouteField
} from "../compiler";
import { createMinHeap } from "./min-heap";
import { cellSupportsProfile, pointDistance, projectGridPoint } from "./project-grid-point";

export function buildGridRouteField(
  key: string,
  goalCellId: string,
  profile: NavigationAgentProfileDefinition,
  revision: number,
  grid: CompiledNavigationGrid
): GridRouteField {
  const distances = new Map<string, number>([[goalCellId, 0]]);
  const nextByCell = new Map<
    string,
    {
      nextCellId: string;
      dependencies: NavigationObstacleTarget[];
      portalId?: string | undefined;
    }
  >();
  const treeDependencyKeys = new Set<string>();
  const treeDependencies = new Map<string, NavigationObstacleTarget>();
  const heap = createMinHeap();
  heap.push({ cellId: goalCellId, distance: 0 });

  while (true) {
    const current = heap.pop();
    if (current === undefined) {
      break;
    }
    if (current.distance !== distances.get(current.cellId)) {
      continue;
    }
    for (const arc of grid.reverseAdjacency.get(current.cellId) ?? []) {
      const traversal = evaluateTraversal(arc, profile, grid);
      if (traversal === undefined) {
        continue;
      }
      const distance = current.distance + traversal.cost;
      const previous = distances.get(arc.from);
      const previousStep = nextByCell.get(arc.from);
      if (
        previous !== undefined &&
        (distance > previous ||
          (distance === previous &&
            previousStep !== undefined &&
            current.cellId.localeCompare(previousStep.nextCellId) >= 0))
      ) {
        continue;
      }
      distances.set(arc.from, distance);
      nextByCell.set(arc.from, {
        nextCellId: current.cellId,
        dependencies: traversal.dependencies,
        ...(arc.portalStateKey === undefined
          ? {}
          : { portalId: grid.portalStates.get(arc.portalStateKey)?.target.id })
      });
      for (const dependency of traversal.dependencies) {
        const dependencyKey = navigationDependencyKey(dependency);
        treeDependencyKeys.add(dependencyKey);
        treeDependencies.set(dependencyKey, { ...dependency });
      }
      heap.push({ cellId: arc.from, distance });
    }
  }

  return {
    key,
    retainCount: 0,
    goalCellId,
    revision,
    profile: cloneNavigationProfile(profile),
    distances,
    nextByCell,
    treeDependencyKeys,
    treeDependencies
  };
}

export function extractGridPath(
  field: GridRouteField,
  startCellId: string,
  grid: CompiledNavigationGrid
):
  | {
      points: NavigationPoint[];
      traversals: NavigationPathTraversal[];
      dependencies: NavigationObstacleTarget[];
    }
  | undefined {
  if (!field.distances.has(startCellId)) {
    return undefined;
  }
  const points: NavigationPoint[] = [];
  const traversals: NavigationPathTraversal[] = [];
  const dependencies = new Map<string, NavigationObstacleTarget>();
  let current = startCellId;
  let guard = 0;
  while (guard <= grid.cells.size) {
    const cell = grid.cells.get(current);
    if (cell === undefined) {
      return undefined;
    }
    points.push(cloneNavigationPoint(cell.point));
    if (current === field.goalCellId) {
      return { points, traversals, dependencies: [...dependencies.values()] };
    }
    const step = field.nextByCell.get(current);
    const nextCell = grid.cells.get(step?.nextCellId ?? "");
    if (step === undefined || nextCell === undefined) {
      return undefined;
    }
    if (step.portalId !== undefined) {
      traversals.push({
        kind: "portal",
        portalId: step.portalId,
        fromPointIndex: points.length - 1,
        toPointIndex: points.length,
        entryPoint: cloneNavigationPoint(cell.point),
        exitPoint: cloneNavigationPoint(nextCell.point)
      });
    }
    for (const dependency of step.dependencies) {
      dependencies.set(navigationDependencyKey(dependency), { ...dependency });
    }
    current = step.nextCellId;
    guard += 1;
  }
  return undefined;
}

export function sampleGridRouteField(
  field: GridRouteField,
  point: NavigationPoint,
  grid: CompiledNavigationGrid,
  revision: number
): NavigationBackendRouteSample {
  if (field.revision !== revision) {
    return { status: "stale", routeRevision: field.revision, revision };
  }
  const projection = projectGridPoint(point, field.profile, grid, revision);
  const cellId = projection?.backendNodeId;
  if (projection === undefined || cellId === undefined || !field.distances.has(cellId)) {
    return { status: "missing", revision };
  }
  const step = field.nextByCell.get(cellId);
  const nextCell = grid.cells.get(step?.nextCellId ?? cellId);
  const currentCell = grid.cells.get(cellId);
  if (currentCell === undefined || nextCell === undefined) {
    return { status: "missing", revision };
  }
  const traversal =
    step?.portalId === undefined
      ? undefined
      : {
          kind: "portal" as const,
          portalId: step.portalId,
          entryPoint: cloneNavigationPoint(currentCell.point),
          exitPoint: cloneNavigationPoint(nextCell.point)
        };
  const steeringPoint = traversal?.entryPoint ?? nextCell.point;
  const segmentDistance = pointDistance(projection.point, steeringPoint);
  const direction =
    segmentDistance === 0
      ? {
          x: 0,
          y: 0,
          ...(point.z === undefined && steeringPoint.z === undefined ? {} : { z: 0 })
        }
      : {
          x: (steeringPoint.x - projection.point.x) / segmentDistance,
          y: (steeringPoint.y - projection.point.y) / segmentDistance,
          ...(point.z === undefined && steeringPoint.z === undefined
            ? {}
            : { z: ((steeringPoint.z ?? 0) - (projection.point.z ?? 0)) / segmentDistance })
        };
  return {
    status: "valid",
    revision,
    point: cloneNavigationPoint(projection.point),
    nextPoint: cloneNavigationPoint(steeringPoint),
    direction,
    distanceToRoute: projection.distance,
    remainingDistance: field.distances.get(cellId) ?? 0,
    ...(traversal === undefined ? {} : { traversal })
  };
}

export function routeFieldDependencies(
  field: GridRouteField,
  startCellId: string,
  grid: CompiledNavigationGrid
): NavigationObstacleTarget[] | undefined {
  return cloneNavigationDependencies(extractGridPath(field, startCellId, grid)?.dependencies);
}

function evaluateTraversal(
  arc: CompiledNavigationGridArc,
  profile: NavigationAgentProfileDefinition,
  grid: CompiledNavigationGrid
): { cost: number; dependencies: NavigationObstacleTarget[] } | undefined {
  const from = grid.cells.get(arc.from);
  const to = grid.cells.get(arc.to);
  if (
    from === undefined ||
    to === undefined ||
    !cellSupportsProfile(from, profile, grid) ||
    !cellSupportsProfile(to, profile, grid)
  ) {
    return undefined;
  }
  if (
    arc.cornerCellIds !== undefined &&
    arc.cornerCellIds.some((cellId) => {
      const corner = grid.cells.get(cellId);
      return corner === undefined || !cellSupportsProfile(corner, profile, grid);
    })
  ) {
    return undefined;
  }

  const dependencies = new Map<string, NavigationObstacleTarget>();
  if (arc.portalStateKey !== undefined) {
    const portal = grid.portalStates.get(arc.portalStateKey);
    if (portal === undefined || portal.blocked) {
      return undefined;
    }
    dependencies.set(arc.portalStateKey, { ...portal.target });
  }
  addCellDependencies(from);
  addCellDependencies(to);

  const area = to.area === undefined ? undefined : grid.areaStates.get(to.area);
  const areaCost =
    to.area === undefined
      ? 1
      : (profile.costOverrides?.[to.area] ?? area?.baseCost ?? 1) * (area?.costMultiplier ?? 1);
  const obstacleCost = to.obstacleKeys.reduce(
    (cost, key) => cost * (grid.obstacleStates.get(key)?.costMultiplier ?? 1),
    1
  );
  const portalCost =
    arc.portalStateKey === undefined
      ? 1
      : (grid.portalStates.get(arc.portalStateKey)?.costMultiplier ?? 1);
  return {
    cost: arc.baseCost * (to.costMultiplier ?? 1) * areaCost * obstacleCost * portalCost,
    dependencies: [...dependencies.values()]
  };

  function addCellDependencies(cell: CompiledNavigationGridCell): void {
    if (cell.area !== undefined) {
      const areaState = grid.areaStates.get(cell.area);
      if (areaState !== undefined) {
        dependencies.set(navigationDependencyKey(areaState.target), { ...areaState.target });
      }
    }
    for (const key of cell.obstacleKeys) {
      const obstacle = grid.obstacleStates.get(key);
      if (obstacle !== undefined) {
        dependencies.set(key, { ...obstacle.target });
      }
    }
  }
}
