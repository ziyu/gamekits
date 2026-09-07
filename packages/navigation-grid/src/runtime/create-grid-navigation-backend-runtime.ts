import {
  cloneNavigationDependencies,
  navigationDependencyKey,
  type NavigationAgentProfileDefinition
} from "@gamekits/navigation-core";
import {
  cloneBackendPathStatus,
  cloneBackendRouteSample,
  type NavigationBackendAdapter,
  type NavigationBackendPathRequest,
  type NavigationBackendPathResult,
  type NavigationBackendPathStatus
} from "@gamekits/navigation-core/backend";
import { compileNavigationGrid, type GridRouteField } from "../compiler";
import type { CreateGridNavigationBackendOptions } from "../contracts/grid-definition";
import {
  buildGridRouteField,
  extractGridPath,
  projectGridPoint,
  sampleGridRouteField
} from "../search";

const CAPABILITIES = {
  deferredRequests: false,
  routeFields: true,
  radius: true,
  height: true,
  maxSlope: true,
  dynamicObstacles: ["area", "portal", "custom"]
} as const;

export function createGridNavigationBackendRuntime(
  options: CreateGridNavigationBackendOptions
): NavigationBackendAdapter {
  const id = options.id ?? `navigation.grid.${options.grid.id}`;
  const maxRouteFields = positiveInteger(options.maxRouteFields, 128);
  const grid = compileNavigationGrid(options.grid, options.layout);
  const requests = new Map<
    string,
    { status: NavigationBackendPathStatus; retainedRouteKey?: string | undefined }
  >();
  const routeFields = new Map<string, GridRouteField>();
  let revision = 0;
  let disposed = false;

  return {
    id,
    capabilities: {
      ...CAPABILITIES,
      dynamicObstacles: [...CAPABILITIES.dynamicObstacles]
    },
    revision: () => revision,
    projectPoint(point, profile) {
      return disposed ? undefined : projectGridPoint(point, profile, grid, revision);
    },
    submitPath(request) {
      requireActive();
      if (requests.has(request.requestId)) {
        throw new Error(`Grid navigation request already exists: ${request.requestId}`);
      }
      const status = findPath(request, revision);
      const retainedRouteKey =
        status.status === "complete" && status.route.kind === "field"
          ? status.route.routeKey
          : undefined;
      if (retainedRouteKey !== undefined) {
        retainField(retainedRouteKey);
      }
      trimRouteFields();
      requests.set(request.requestId, {
        status,
        ...(retainedRouteKey === undefined ? {} : { retainedRouteKey })
      });
    },
    pollPath(requestId) {
      const request = requests.get(requestId);
      return request === undefined
        ? { status: "missing", revision }
        : cloneBackendPathStatus(request.status);
    },
    cancelPath(requestId) {
      releaseRequest(requestId);
    },
    releasePath(requestId) {
      releaseRequest(requestId);
    },
    sampleRoute(routeKey, point) {
      const field = routeFields.get(routeKey);
      if (field === undefined) {
        return { status: "missing", revision };
      }
      touchRouteField(routeKey, field);
      return cloneBackendRouteSample(sampleGridRouteField(field, point, grid, revision));
    },
    retainRoute(routeKey) {
      retainField(routeKey);
    },
    releaseRoute(routeKey) {
      const field = routeFields.get(routeKey);
      if (field !== undefined) {
        field.retainCount = Math.max(0, field.retainCount - 1);
      }
      trimRouteFields();
    },
    updateObstacle(update) {
      if (disposed || update.target.kind === "edge") {
        return { status: "unsupported", revision };
      }
      if (
        update.costMultiplier !== undefined &&
        (!Number.isFinite(update.costMultiplier) || update.costMultiplier <= 0)
      ) {
        return { status: "unsupported", revision };
      }
      const key = navigationDependencyKey(update.target);
      const state =
        update.target.kind === "area"
          ? grid.areaStates.get(update.target.id)
          : update.target.kind === "portal"
            ? grid.portalStates.get(key)
            : grid.obstacleStates.get(key);
      if (state === undefined) {
        return { status: "unsupported", revision };
      }
      const nextBlocked = update.blocked ?? state.blocked;
      const nextMultiplier = update.costMultiplier ?? state.costMultiplier;
      if (nextBlocked === state.blocked && nextMultiplier === state.costMultiplier) {
        return { status: "unchanged", revision, invalidatedRouteFields: 0 };
      }
      const improvesRoutes =
        (state.blocked && !nextBlocked) || nextMultiplier < state.costMultiplier;
      state.blocked = nextBlocked;
      state.costMultiplier = nextMultiplier;
      revision += 1;

      const previousFieldCount = routeFields.size;
      if (improvesRoutes) {
        routeFields.clear();
      } else {
        for (const [routeKey, field] of routeFields) {
          if (field.treeDependencyKeys.has(key)) {
            routeFields.delete(routeKey);
          } else {
            field.revision = revision;
          }
        }
      }
      return {
        status: "changed",
        revision,
        invalidatedRouteFields: previousFieldCount - routeFields.size,
        ...(improvesRoutes
          ? { invalidateAllPaths: true }
          : { invalidatedPathDependencies: [{ ...update.target }] })
      };
    },
    snapshot() {
      return {
        id,
        revision,
        disposed,
        capabilities: {
          ...CAPABILITIES,
          dynamicObstacles: [...CAPABILITIES.dynamicObstacles]
        },
        details: {
          gridId: grid.id,
          width: grid.width,
          height: grid.height,
          cellSize: grid.cellSize,
          walkableCells: grid.cells.size,
          areas: grid.areaStates.size,
          dynamicObstacles: grid.obstacleStates.size,
          portals: grid.portalStates.size,
          blockedAreas: countBlocked(grid.areaStates.values()),
          blockedObstacles: countBlocked(grid.obstacleStates.values()),
          blockedPortals: countBlocked(grid.portalStates.values()),
          retainedRequests: requests.size,
          routeFields: routeFields.size,
          retainedRouteFields: [...routeFields.values()].filter((field) => field.retainCount > 0)
            .length,
          maxRouteFields
        }
      };
    },
    dispose() {
      if (disposed) {
        return;
      }
      disposed = true;
      requests.clear();
      routeFields.clear();
      grid.dispose();
    }
  };

  function findPath(
    request: NavigationBackendPathRequest,
    resultRevision: number
  ): NavigationBackendPathResult {
    const startProjection = projectGridPoint(request.start, request.profile, grid, resultRevision);
    if (startProjection === undefined) {
      return { status: "failed", reason: "start-unprojectable", revision: resultRevision };
    }
    const goalProjection = projectGridPoint(request.goal, request.profile, grid, resultRevision);
    if (goalProjection === undefined) {
      return { status: "failed", reason: "goal-unprojectable", revision: resultRevision };
    }
    const startCellId = startProjection.backendNodeId;
    const goalCellId = goalProjection.backendNodeId;
    if (startCellId === undefined || goalCellId === undefined) {
      return { status: "failed", reason: "unreachable", revision: resultRevision };
    }
    const field = getRouteField(request.profile, goalCellId, request.goalKey, resultRevision);
    const cost = field.distances.get(startCellId);
    if (cost === undefined) {
      return { status: "failed", reason: "unreachable", revision: resultRevision };
    }
    if (request.maxCost !== undefined && cost > request.maxCost) {
      return { status: "failed", reason: "cost-limit", revision: resultRevision };
    }
    if (request.routeKind === "field") {
      return {
        status: "complete",
        revision: resultRevision,
        route: { kind: "field", routeKey: field.key },
        cost,
        startProjection,
        goalProjection,
        dependencies: [...field.treeDependencies.values()].map((dependency) => ({
          ...dependency
        }))
      };
    }
    const path = extractGridPath(field, startCellId, grid);
    if (path === undefined) {
      return { status: "failed", reason: "unreachable", revision: resultRevision };
    }
    return {
      status: "complete",
      revision: resultRevision,
      route: {
        kind: "path",
        points: path.points,
        ...(path.traversals.length === 0 ? {} : { traversals: path.traversals })
      },
      cost,
      startProjection,
      goalProjection,
      dependencies: cloneNavigationDependencies(path.dependencies)
    };
  }

  function getRouteField(
    profile: NavigationAgentProfileDefinition,
    goalCellId: string,
    goalKey: string | undefined,
    fieldRevision: number
  ): GridRouteField {
    const key = routeFieldKey(profile, goalCellId, goalKey);
    const existing = routeFields.get(key);
    if (existing !== undefined && existing.revision === fieldRevision) {
      touchRouteField(key, existing);
      return existing;
    }
    const field = buildGridRouteField(key, goalCellId, profile, fieldRevision, grid);
    routeFields.delete(key);
    routeFields.set(key, field);
    return field;
  }

  function touchRouteField(key: string, field: GridRouteField): void {
    routeFields.delete(key);
    routeFields.set(key, field);
  }

  function requireActive(): void {
    if (disposed) {
      throw new Error("Grid navigation backend is disposed");
    }
  }

  function retainField(routeKey: string): void {
    const field = routeFields.get(routeKey);
    if (field === undefined) {
      throw new Error(`Grid navigation route field is missing: ${routeKey}`);
    }
    field.retainCount += 1;
    touchRouteField(routeKey, field);
  }

  function releaseRequest(requestId: string): void {
    const request = requests.get(requestId);
    requests.delete(requestId);
    if (request?.retainedRouteKey !== undefined) {
      const field = routeFields.get(request.retainedRouteKey);
      if (field !== undefined) {
        field.retainCount = Math.max(0, field.retainCount - 1);
      }
    }
  }

  function trimRouteFields(): void {
    while (routeFields.size > maxRouteFields) {
      const removable = [...routeFields].find(([, field]) => field.retainCount === 0);
      if (removable === undefined) {
        break;
      }
      routeFields.delete(removable[0]);
    }
  }
}

function routeFieldKey(
  profile: NavigationAgentProfileDefinition,
  goalCellId: string,
  goalKey: string | undefined
): string {
  const areas = [...(profile.allowedAreas ?? [])].sort().join(",");
  const costs = Object.entries(profile.costOverrides ?? {})
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([area, cost]) => `${area}:${cost}`)
    .join(",");
  return [
    profile.id,
    profile.radius,
    profile.height ?? "",
    profile.maxSlope ?? "",
    areas,
    costs,
    goalKey ?? "",
    goalCellId
  ].join("|");
}

function countBlocked(states: Iterable<{ blocked: boolean }>): number {
  let count = 0;
  for (const state of states) {
    if (state.blocked) {
      count += 1;
    }
  }
  return count;
}

function positiveInteger(value: number | undefined, fallback: number): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved <= 0) {
    throw new Error("Navigation grid maxRouteFields must be a positive integer");
  }
  return resolved;
}
