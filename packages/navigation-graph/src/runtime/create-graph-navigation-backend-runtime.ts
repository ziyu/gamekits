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
import { compileNavigationGraph, type GraphRouteField } from "../compiler";
import type { CreateGraphNavigationBackendOptions } from "../contracts/graph-definition";
import {
  buildGraphRouteField,
  extractGraphPath,
  projectGraphPoint,
  routeFieldDependencies,
  sampleGraphRouteField
} from "../search";

const CAPABILITIES = {
  deferredRequests: false,
  routeFields: true,
  radius: true,
  height: true,
  maxSlope: true,
  dynamicObstacles: ["edge", "area", "portal"]
} as const;

export function createGraphNavigationBackendRuntime(
  options: CreateGraphNavigationBackendOptions
): NavigationBackendAdapter {
  const id = options.id ?? `navigation.graph.${options.graph.id}`;
  const maxRouteFields = positiveInteger(options.maxRouteFields, 128);
  const graph = compileNavigationGraph(options.graph, options.layout);
  const requests = new Map<
    string,
    { status: NavigationBackendPathStatus; retainedRouteKey?: string | undefined }
  >();
  const routeFields = new Map<string, GraphRouteField>();
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
      return disposed ? undefined : projectGraphPoint(point, profile, graph, revision);
    },
    submitPath(request) {
      requireActive();
      if (requests.has(request.requestId)) {
        throw new Error(`Graph navigation request already exists: ${request.requestId}`);
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
      return cloneBackendRouteSample(sampleGraphRouteField(field, point, graph, revision));
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
      if (disposed || update.target.kind === "custom") {
        return { status: "unsupported", revision };
      }
      if (
        update.costMultiplier !== undefined &&
        (!Number.isFinite(update.costMultiplier) || update.costMultiplier <= 0)
      ) {
        return { status: "unsupported", revision };
      }
      const state =
        update.target.kind === "area"
          ? graph.areaStates.get(update.target.id)
          : graph.connectionStates.get(navigationDependencyKey(update.target));
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
        const key = navigationDependencyKey(update.target);
        for (const [routeKey, field] of routeFields) {
          if (field.treeDependencyKeys.has(key)) {
            routeFields.delete(routeKey);
          } else {
            promoteField(field, revision);
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
      let blockedConnections = 0;
      let blockedAreas = 0;
      for (const state of graph.connectionStates.values()) {
        if (state.blocked) {
          blockedConnections += 1;
        }
      }
      for (const state of graph.areaStates.values()) {
        if (state.blocked) {
          blockedAreas += 1;
        }
      }
      return {
        id,
        revision,
        disposed,
        capabilities: {
          ...CAPABILITIES,
          dynamicObstacles: [...CAPABILITIES.dynamicObstacles]
        },
        details: {
          graphId: graph.id,
          nodes: graph.nodes.size,
          connections: graph.connectionStates.size,
          areas: graph.areaStates.size,
          blockedConnections,
          blockedAreas,
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
      graph.dispose();
    }
  };

  function findPath(
    request: NavigationBackendPathRequest,
    resultRevision: number
  ): NavigationBackendPathResult {
    const startProjection = projectGraphPoint(
      request.start,
      request.profile,
      graph,
      resultRevision
    );
    if (startProjection === undefined) {
      return { status: "failed", reason: "start-unprojectable", revision: resultRevision };
    }
    const goalProjection = projectGraphPoint(request.goal, request.profile, graph, resultRevision);
    if (goalProjection === undefined) {
      return { status: "failed", reason: "goal-unprojectable", revision: resultRevision };
    }
    const startNodeId = startProjection.backendNodeId;
    const goalNodeId = goalProjection.backendNodeId;
    if (startNodeId === undefined || goalNodeId === undefined) {
      return { status: "failed", reason: "unreachable", revision: resultRevision };
    }
    const field = getRouteField(request.profile, goalNodeId, request.goalKey, resultRevision);
    const cost = field.distances.get(startNodeId);
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
        dependencies: routeFieldDependencies(field, startNodeId, graph)
      };
    }
    const path = extractGraphPath(field, startNodeId, graph);
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
    goalNodeId: string,
    goalKey: string | undefined,
    fieldRevision: number
  ): GraphRouteField {
    const key = routeFieldKey(profile, goalNodeId, goalKey);
    const existing = routeFields.get(key);
    if (existing !== undefined && existing.revision === fieldRevision) {
      touchRouteField(key, existing);
      return existing;
    }
    const field = buildGraphRouteField(key, goalNodeId, profile, fieldRevision, graph);
    routeFields.delete(key);
    routeFields.set(key, field);
    return field;
  }

  function touchRouteField(key: string, field: GraphRouteField): void {
    routeFields.delete(key);
    routeFields.set(key, field);
  }

  function requireActive(): void {
    if (disposed) {
      throw new Error("Graph navigation backend is disposed");
    }
  }

  function retainField(routeKey: string): void {
    const field = routeFields.get(routeKey);
    if (field === undefined) {
      throw new Error(`Graph navigation route field is missing: ${routeKey}`);
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

function promoteField(field: GraphRouteField, revision: number): void {
  field.revision = revision;
}

function routeFieldKey(
  profile: NavigationAgentProfileDefinition,
  goalNodeId: string,
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
    goalNodeId
  ].join("|");
}

function positiveInteger(value: number | undefined, fallback: number): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved <= 0) {
    throw new Error("Navigation graph maxRouteFields must be a positive integer");
  }
  return resolved;
}
