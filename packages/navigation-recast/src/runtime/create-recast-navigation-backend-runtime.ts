import {
  cloneNavigationPoint,
  createNavigationError,
  navigationDependencyKey,
  type NavigationAgentProfileDefinition,
  type NavigationObstacleTarget,
  type NavigationPathTraversal,
  type NavigationPoint,
  type NavigationProjection
} from "@gamekits/navigation-core";
import {
  cloneBackendPathStatus,
  cloneBackendRouteSample,
  type NavigationBackendAdapter,
  type NavigationBackendPathRequest,
  type NavigationBackendPathResult,
  type NavigationBackendPathStatus
} from "@gamekits/navigation-core/backend";
import {
  Detour,
  importNavMesh,
  NavMeshQuery,
  statusFailed,
  type QueryFilter
} from "recast-navigation";
import type {
  CreateRecastNavigationBackendOptions,
  NavigationRecastBuildArtifact
} from "../contracts";
import { buildRecastNavigationArtifact } from "../generation";
import { requireRecastNavigationInitialized } from "../initialization";
import {
  buildRecastRouteField,
  buildRecastRouteTree,
  recastRouteFieldKey,
  sampleRecastRouteField,
  traceRecastRouteTreeCorridor,
  type RecastRouteField,
  type RecastRouteFieldTraversal
} from "../search/recast-route-field";
import { buildRecastNavigationTopology } from "../search/recast-topology";

const CAPABILITIES = {
  deferredRequests: false,
  routeFields: true,
  radius: false,
  height: false,
  maxSlope: false,
  dynamicObstacles: ["area", "portal"]
} as const;

type TraversalState = {
  blocked: boolean;
  costMultiplier: number;
};

export function createRecastNavigationBackendRuntime(
  options: CreateRecastNavigationBackendOptions
): NavigationBackendAdapter {
  requireRecastNavigationInitialized();
  const id = options.id ?? `navigation.recast.${options.source.id}`;
  const artifact =
    options.artifact ?? buildRecastNavigationArtifact(options.source, options.layout);
  validateArtifact(artifact.sourceId, artifact.sourceVersion, options.source);
  const { navMesh } = importNavMesh(artifact.data);
  const query = new NavMeshQuery(navMesh, {
    maxNodes: Math.min(65_535, Math.max(2_048, artifact.polygonCount * 2))
  });
  const halfExtents = options.queryHalfExtents ?? defaultHalfExtents(options.source.build);
  query.defaultQueryHalfExtents = toRecastPoint(halfExtents);
  const maxRouteFields = positiveInteger(options.maxRouteFields, 128);
  const requests = new Map<
    string,
    { status: NavigationBackendPathStatus; retainedRouteKey?: string | undefined }
  >();
  const routeFields = new Map<string, RecastRouteField>();
  const areaStates = createAreaStates(artifact);
  const portalStates = createPortalStates(options, artifact);
  const baseAreaCosts = new Map(
    (options.layout?.areas ?? []).map((area) => [area.id, area.cost ?? 1])
  );
  const portalCosts = new Map(
    (options.layout?.portals ?? []).map((portal) => [portal.id, portal.cost])
  );
  const topology = buildRecastNavigationTopology(navMesh, artifact, options.layout);
  const fieldTraversal: RecastRouteFieldTraversal = {
    isAreaTraversable(areaId, profile) {
      return (
        (profile.allowedAreas === undefined || profile.allowedAreas.includes(areaId)) &&
        areaStates.get(areaId)?.blocked === false
      );
    },
    isPortalTraversable(portalId) {
      return portalStates.get(portalId)?.blocked === false;
    },
    areaCost: effectiveAreaCost
  };
  let revision = 0;
  let fieldSequence = 0;
  let disposed = false;

  return {
    id,
    capabilities: cloneCapabilities(),
    revision: () => revision,
    projectPoint(point, profile) {
      return disposed ? undefined : projectPoint(point, profile);
    },
    submitPath(request) {
      requireActive();
      if (requests.has(request.requestId)) {
        throw new Error(`Recast navigation request already exists: ${request.requestId}`);
      }
      const status = findPath(request);
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
      return cloneBackendRouteSample(
        sampleRecastRouteField(field, point, revision, topology, fieldTraversal, projectPoint)
      );
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
      if (disposed || (update.target.kind !== "area" && update.target.kind !== "portal")) {
        return { status: "unsupported", revision };
      }
      if (
        update.costMultiplier !== undefined &&
        (!Number.isFinite(update.costMultiplier) || update.costMultiplier <= 0)
      ) {
        return { status: "unsupported", revision };
      }
      if (update.target.kind === "portal" && update.costMultiplier !== undefined) {
        return { status: "unsupported", revision };
      }
      const states = update.target.kind === "area" ? areaStates : portalStates;
      const state = states.get(update.target.id);
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
      const dependencyKey = navigationDependencyKey(update.target);
      const previousFieldCount = routeFields.size;
      if (improvesRoutes) {
        routeFields.clear();
      } else {
        for (const [routeKey, field] of routeFields) {
          if (field.treeDependencyKeys.has(dependencyKey)) {
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
        capabilities: cloneCapabilities(),
        details: {
          sourceId: options.source.id,
          sourceVersion: options.source.version ?? null,
          polygons: artifact.polygonCount,
          areas: artifact.areaIds.length,
          portals: Object.keys(artifact.portalFlags).length,
          blockedAreas: countBlocked(areaStates.values()),
          blockedPortals: countBlocked(portalStates.values()),
          retainedRequests: requests.size,
          routeFields: routeFields.size,
          retainedRouteFields: [...routeFields.values()].filter((field) => field.retainCount > 0)
            .length,
          maxRouteFields,
          navMeshBytes: artifact.data.byteLength,
          buildProfile: { ...options.source.build }
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
      query.destroy();
      navMesh.destroy();
    }
  };

  function projectPoint(
    point: NavigationPoint,
    profile: NavigationAgentProfileDefinition
  ): NavigationProjection | undefined {
    configureFilter(query.defaultFilter, profile);
    const result = query.findClosestPoint(toRecastPoint(point));
    if (!result.success) {
      return undefined;
    }
    const projected = fromRecastPoint(result.point);
    const areaId = areaIdForPoly(result.polyRef);
    return {
      point: projected,
      backendNodeId: `poly:${result.polyRef}`,
      ...(areaId === undefined ? {} : { area: areaId }),
      distance: pointDistance(point, projected),
      revision
    };
  }

  function findPath(request: NavigationBackendPathRequest): NavigationBackendPathResult {
    const resultRevision = revision;
    const startProjection = projectPoint(request.start, request.profile);
    if (startProjection === undefined) {
      return { status: "failed", reason: "start-unprojectable", revision: resultRevision };
    }
    const goalProjection = projectPoint(request.goal, request.profile);
    if (goalProjection === undefined) {
      return { status: "failed", reason: "goal-unprojectable", revision: resultRevision };
    }
    const startRef = projectionPolyRef(startProjection);
    const goalRef = projectionPolyRef(goalProjection);
    if (startRef === undefined || goalRef === undefined) {
      return { status: "failed", reason: "unreachable", revision: resultRevision };
    }

    if (request.routeKind === "field") {
      const field = getRouteField(
        request.profile,
        goalRef,
        goalProjection.point,
        request.goalKey,
        resultRevision
      );
      const fieldDistance = field.distances.get(startRef);
      const startPolygon = topology.polygons.get(startRef);
      const cost =
        startRef === goalRef && startPolygon?.areaId !== undefined
          ? pointDistance(startProjection.point, goalProjection.point) *
            effectiveAreaCost(startPolygon.areaId, request.profile)
          : fieldDistance;
      if (cost === undefined) {
        return { status: "failed", reason: "unreachable", revision: resultRevision };
      }
      if (request.maxCost !== undefined && cost > request.maxCost) {
        return { status: "failed", reason: "cost-limit", revision: resultRevision };
      }
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

    configureFilter(query.defaultFilter, request.profile);
    const corridor = hasEnabledAuthoredPortalCost()
      ? traceRecastRouteTreeCorridor(
          buildRecastRouteTree(goalRef, request.profile, topology, fieldTraversal),
          startRef,
          goalRef
        )
      : findNativeCorridor(startRef, goalRef, startProjection.point, goalProjection.point);
    if (corridor === undefined || corridor.at(-1) !== goalRef) {
      return { status: "failed", reason: "unreachable", revision: resultRevision };
    }

    const straightResult = query.findStraightPath(
      toRecastPoint(startProjection.point),
      toRecastPoint(goalProjection.point),
      corridor,
      { straightPathOptions: Detour.DT_STRAIGHTPATH_AREA_CROSSINGS }
    );
    const points: NavigationPoint[] = [];
    const pointRefs: number[] = [];
    const pointFlags: number[] = [];
    for (let index = 0; index < straightResult.straightPathCount; index += 1) {
      points.push(
        fromRecastPoint({
          x: straightResult.straightPath.get(index * 3),
          y: straightResult.straightPath.get(index * 3 + 1),
          z: straightResult.straightPath.get(index * 3 + 2)
        })
      );
      pointRefs.push(straightResult.straightPathRefs.get(index));
      pointFlags.push(straightResult.straightPathFlags.get(index));
    }
    straightResult.straightPath.destroy();
    straightResult.straightPathFlags.destroy();
    straightResult.straightPathRefs.destroy();
    if (!straightResult.success || points.length === 0) {
      return { status: "failed", reason: "unreachable", revision: resultRevision };
    }

    const traversals: NavigationPathTraversal[] = [];
    for (let index = 0; index < pointFlags.length - 1; index += 1) {
      if ((pointFlags[index]! & Detour.DT_STRAIGHTPATH_OFFMESH_CONNECTION) === 0) {
        continue;
      }
      const portalId = portalIdForPoly(pointRefs[index] ?? 0);
      const entryPoint = points[index];
      const exitPoint = points[index + 1];
      if (portalId === undefined || entryPoint === undefined || exitPoint === undefined) {
        continue;
      }
      traversals.push({
        kind: "portal",
        portalId,
        fromPointIndex: index,
        toPointIndex: index + 1,
        entryPoint: cloneNavigationPoint(entryPoint),
        exitPoint: cloneNavigationPoint(exitPoint)
      });
    }

    const cost = weightedPathDistance(points, pointRefs, traversals, request.profile);
    if (request.maxCost !== undefined && cost > request.maxCost) {
      return { status: "failed", reason: "cost-limit", revision: resultRevision };
    }
    return {
      status: "complete",
      revision: resultRevision,
      route: {
        kind: "path",
        points,
        ...(traversals.length === 0 ? {} : { traversals })
      },
      cost,
      startProjection,
      goalProjection,
      dependencies: collectDependencies(corridor)
    };
  }

  function hasEnabledAuthoredPortalCost(): boolean {
    for (const [portalId, cost] of portalCosts) {
      if (cost !== undefined && portalStates.get(portalId)?.blocked === false) {
        return true;
      }
    }
    return false;
  }

  function findNativeCorridor(
    startRef: number,
    goalRef: number,
    start: NavigationPoint,
    goal: NavigationPoint
  ): number[] | undefined {
    const result = query.findPath(startRef, goalRef, toRecastPoint(start), toRecastPoint(goal));
    const corridor = [...result.polys.toTypedArray()].filter((polyRef) => polyRef !== 0);
    result.polys.destroy();
    return result.success && corridor.at(-1) === goalRef ? corridor : undefined;
  }

  function configureFilter(filter: QueryFilter, profile: NavigationAgentProfileDefinition): void {
    const allowedAreas = new Set(profile.allowedAreas ?? artifact.areaIds);
    let minimumAllowedCost = Number.POSITIVE_INFINITY;
    for (const areaId of artifact.areaIds) {
      const state = areaStates.get(areaId);
      if (allowedAreas.has(areaId) && state?.blocked === false) {
        minimumAllowedCost = Math.min(minimumAllowedCost, effectiveAreaCost(areaId, profile));
      }
    }
    const queryCostScale =
      Number.isFinite(minimumAllowedCost) && minimumAllowedCost > 0 ? minimumAllowedCost : 1;
    let includeFlags = 0;
    for (const areaId of artifact.areaIds) {
      const areaIndex = artifact.areaIndices[areaId];
      const areaFlag = artifact.areaFlags[areaId];
      const state = areaStates.get(areaId);
      if (areaIndex === undefined || areaFlag === undefined || state === undefined) {
        continue;
      }
      // Detour's A* heuristic assumes traversal multipliers are at least one. Scaling all
      // allowed costs by the same positive minimum preserves route ordering while keeping
      // discounted GameKits areas admissible for the native query.
      filter.setAreaCost(
        areaIndex,
        Math.max(1, effectiveAreaCost(areaId, profile) / queryCostScale)
      );
      if (allowedAreas.has(areaId) && !state.blocked) {
        includeFlags |= areaFlag;
      }
    }
    for (const [portalId, portalFlag] of Object.entries(artifact.portalFlags)) {
      if (portalStates.get(portalId)?.blocked === false) {
        includeFlags |= portalFlag;
      }
    }
    filter.includeFlags = includeFlags;
    filter.excludeFlags = 0;
  }

  function areaIdForPoly(polyRef: number): string | undefined {
    const result = navMesh.getPolyArea(polyRef);
    return statusFailed(result.status) ? undefined : artifact.areaIds[result.area - 1];
  }

  function weightedPathDistance(
    points: readonly NavigationPoint[],
    pointRefs: readonly number[],
    traversals: readonly NavigationPathTraversal[],
    profile: NavigationAgentProfileDefinition
  ): number {
    let distance = 0;
    const traversalsByIndex = new Map(
      traversals.map((traversal) => [traversal.fromPointIndex, traversal])
    );
    for (let index = 1; index < points.length; index += 1) {
      const traversal = traversalsByIndex.get(index - 1);
      const portalCost = traversal === undefined ? undefined : portalCosts.get(traversal.portalId);
      if (portalCost !== undefined) {
        distance += portalCost;
        continue;
      }
      const areaId = areaIdForPoly(pointRefs[index - 1] ?? 0);
      const multiplier = areaId === undefined ? 1 : effectiveAreaCost(areaId, profile);
      distance += pointDistance(points[index - 1]!, points[index]!) * multiplier;
    }
    return distance;
  }

  function collectDependencies(corridor: readonly number[]): NavigationObstacleTarget[] {
    const dependencies = new Map<string, NavigationObstacleTarget>();
    for (const polyRef of corridor) {
      const areaId = areaIdForPoly(polyRef);
      if (areaId !== undefined) {
        const target = { kind: "area", id: areaId } as const;
        dependencies.set(navigationDependencyKey(target), target);
      }
      const flagsResult = navMesh.getPolyFlags(polyRef);
      for (const [portalId, portalFlag] of Object.entries(artifact.portalFlags)) {
        if ((flagsResult.flags & portalFlag) !== 0) {
          const target = { kind: "portal", id: portalId } as const;
          dependencies.set(navigationDependencyKey(target), target);
        }
      }
    }
    return [...dependencies.values()];
  }

  function portalIdForPoly(polyRef: number): string | undefined {
    const flagsResult = navMesh.getPolyFlags(polyRef);
    if (statusFailed(flagsResult.status)) {
      return undefined;
    }
    return Object.entries(artifact.portalFlags).find(
      ([, portalFlag]) => (flagsResult.flags & portalFlag) !== 0
    )?.[0];
  }

  function effectiveAreaCost(areaId: string, profile: NavigationAgentProfileDefinition): number {
    const configuredCost = profile.costOverrides?.[areaId] ?? baseAreaCosts.get(areaId) ?? 1;
    return configuredCost * (areaStates.get(areaId)?.costMultiplier ?? 1);
  }

  function getRouteField(
    profile: NavigationAgentProfileDefinition,
    goalPolygonRef: number,
    goal: NavigationPoint,
    goalKey: string | undefined,
    fieldRevision: number
  ): RecastRouteField {
    const cacheKey = recastRouteFieldKey(profile, goalPolygonRef, goal, goalKey);
    const existing = [...routeFields.values()].find(
      (field) => field.cacheKey === cacheKey && field.revision === fieldRevision
    );
    if (existing !== undefined) {
      touchRouteField(existing.key, existing);
      return existing;
    }
    fieldSequence += 1;
    const key = `${cacheKey}|generation:${fieldSequence}`;
    const field = buildRecastRouteField(
      key,
      cacheKey,
      goalPolygonRef,
      goal,
      profile,
      fieldRevision,
      topology,
      fieldTraversal
    );
    routeFields.delete(key);
    routeFields.set(key, field);
    return field;
  }

  function touchRouteField(key: string, field: RecastRouteField): void {
    routeFields.delete(key);
    routeFields.set(key, field);
  }

  function retainField(routeKey: string): void {
    const field = routeFields.get(routeKey);
    if (field === undefined) {
      throw createNavigationError(
        "navigation.recast_route_field_missing",
        `Recast navigation route field is missing: ${routeKey}`,
        { backendId: id, routeKey }
      );
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
    trimRouteFields();
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

  function requireActive(): void {
    if (disposed) {
      throw createNavigationError(
        "navigation.recast_disposed",
        "Recast navigation backend is disposed",
        { backendId: id }
      );
    }
  }
}

function createAreaStates(artifact: NavigationRecastBuildArtifact): Map<string, TraversalState> {
  return new Map(artifact.areaIds.map((areaId) => [areaId, { blocked: false, costMultiplier: 1 }]));
}

function createPortalStates(
  options: CreateRecastNavigationBackendOptions,
  artifact: NavigationRecastBuildArtifact
): Map<string, TraversalState> {
  const definitions = new Map((options.layout?.portals ?? []).map((portal) => [portal.id, portal]));
  return new Map(
    Object.keys(artifact.portalFlags).map((portalId) => [
      portalId,
      {
        blocked: definitions.get(portalId)?.enabled === false,
        costMultiplier: 1
      }
    ])
  );
}

function validateArtifact(
  sourceId: string,
  sourceVersion: string | undefined,
  source: CreateRecastNavigationBackendOptions["source"]
): void {
  if (sourceId !== source.id || sourceVersion !== source.version) {
    throw createNavigationError(
      "navigation.recast_artifact_mismatch",
      `Recast artifact ${sourceId}@${sourceVersion ?? "unversioned"} does not match source ${source.id}@${source.version ?? "unversioned"}`,
      {
        sourceId,
        sourceVersion,
        expectedSourceId: source.id,
        expectedSourceVersion: source.version
      }
    );
  }
}

function defaultHalfExtents(
  profile: CreateRecastNavigationBackendOptions["source"]["build"]
): NavigationPoint {
  return {
    x: Math.max(profile.walkableRadius * 2, profile.cellSize * 4, 1),
    y: Math.max(profile.walkableRadius * 2, profile.cellSize * 4, 1),
    z: Math.max(profile.walkableHeight, 2)
  };
}

function projectionPolyRef(projection: NavigationProjection): number | undefined {
  const value = projection.backendNodeId?.startsWith("poly:")
    ? Number(projection.backendNodeId.slice(5))
    : NaN;
  return Number.isSafeInteger(value) && value > 0 ? value : undefined;
}

function toRecastPoint(point: NavigationPoint): { x: number; y: number; z: number } {
  return { x: point.x, y: point.z ?? 0, z: point.y };
}

function fromRecastPoint(point: { x: number; y: number; z: number }): NavigationPoint {
  return { x: point.x, y: point.z, z: point.y };
}

function pointDistance(left: NavigationPoint, right: NavigationPoint): number {
  return Math.hypot(left.x - right.x, left.y - right.y, (left.z ?? 0) - (right.z ?? 0));
}

function countBlocked(states: Iterable<TraversalState>): number {
  let count = 0;
  for (const state of states) {
    if (state.blocked) {
      count += 1;
    }
  }
  return count;
}

function cloneCapabilities(): NavigationBackendAdapter["capabilities"] {
  return { ...CAPABILITIES, dynamicObstacles: [...CAPABILITIES.dynamicObstacles] };
}

function positiveInteger(value: number | undefined, fallback: number): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved <= 0) {
    throw new Error("Navigation Recast maxRouteFields must be a positive integer");
  }
  return resolved;
}
