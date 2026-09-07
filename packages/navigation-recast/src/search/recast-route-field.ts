import {
  cloneNavigationPoint,
  cloneNavigationProfile,
  navigationDependencyKey,
  type NavigationAgentProfileDefinition,
  type NavigationObstacleTarget,
  type NavigationPoint,
  type NavigationProjection
} from "@gamekits/navigation-core";
import type { NavigationBackendRouteSample } from "@gamekits/navigation-core/backend";
import { createRecastFieldMinHeap } from "./min-heap";
import type {
  RecastNavigationArc,
  RecastNavigationPolygon,
  RecastNavigationTopology
} from "./recast-topology";

export type RecastRouteFieldTraversal = {
  isAreaTraversable(areaId: string, profile: NavigationAgentProfileDefinition): boolean;
  isPortalTraversable(portalId: string): boolean;
  areaCost(areaId: string, profile: NavigationAgentProfileDefinition): number;
};

export type RecastRouteField = {
  key: string;
  cacheKey: string;
  retainCount: number;
  goalPolygonRef: number;
  goal: NavigationPoint;
  revision: number;
  profile: NavigationAgentProfileDefinition;
  distances: Map<number, number>;
  nextByPolygon: Map<number, RecastNavigationArc>;
  treeDependencyKeys: Set<string>;
  treeDependencies: Map<string, NavigationObstacleTarget>;
};

export type RecastRouteTree = Pick<RecastRouteField, "distances" | "nextByPolygon">;

export function buildRecastRouteField(
  key: string,
  cacheKey: string,
  goalPolygonRef: number,
  goal: NavigationPoint,
  profile: NavigationAgentProfileDefinition,
  revision: number,
  topology: RecastNavigationTopology,
  traversal: RecastRouteFieldTraversal
): RecastRouteField {
  const { distances, nextByPolygon } = buildRecastRouteTree(
    goalPolygonRef,
    profile,
    topology,
    traversal
  );

  const treeDependencies = new Map<string, NavigationObstacleTarget>();
  const goalPolygon = topology.polygons.get(goalPolygonRef);
  if (goalPolygon?.areaId !== undefined) {
    addDependency(treeDependencies, { kind: "area", id: goalPolygon.areaId });
  }
  for (const arc of nextByPolygon.values()) {
    const from = topology.polygons.get(arc.fromRef);
    const to = topology.polygons.get(arc.toRef);
    if (from?.areaId !== undefined) {
      addDependency(treeDependencies, { kind: "area", id: from.areaId });
    }
    if (to?.areaId !== undefined) {
      addDependency(treeDependencies, { kind: "area", id: to.areaId });
    }
    for (const segment of arc.costSegments) {
      if (segment.areaId !== undefined) {
        addDependency(treeDependencies, { kind: "area", id: segment.areaId });
      }
    }
    if (arc.portalId !== undefined) {
      addDependency(treeDependencies, { kind: "portal", id: arc.portalId });
    }
  }
  return {
    key,
    cacheKey,
    retainCount: 0,
    goalPolygonRef,
    goal: cloneNavigationPoint(goal),
    revision,
    profile: cloneNavigationProfile(profile),
    distances,
    nextByPolygon,
    treeDependencyKeys: new Set(treeDependencies.keys()),
    treeDependencies
  };
}

export function buildRecastRouteTree(
  goalPolygonRef: number,
  profile: NavigationAgentProfileDefinition,
  topology: RecastNavigationTopology,
  traversal: RecastRouteFieldTraversal
): RecastRouteTree {
  const distances = new Map<number, number>([[goalPolygonRef, 0]]);
  const nextByPolygon = new Map<number, RecastNavigationArc>();
  const heap = createRecastFieldMinHeap();
  heap.push({ polygonRef: goalPolygonRef, distance: 0 });

  while (true) {
    const current = heap.pop();
    if (current === undefined) {
      break;
    }
    if (current.distance !== distances.get(current.polygonRef)) {
      continue;
    }
    for (const arc of topology.reverseAdjacency.get(current.polygonRef) ?? []) {
      const cost = recastTraversalCost(arc, profile, topology, traversal);
      if (cost === undefined) {
        continue;
      }
      const distance = current.distance + cost;
      const previous = distances.get(arc.fromRef);
      const previousArc = nextByPolygon.get(arc.fromRef);
      if (
        previous !== undefined &&
        (distance > previous ||
          (distance === previous && previousArc !== undefined && compareArc(arc, previousArc) >= 0))
      ) {
        continue;
      }
      distances.set(arc.fromRef, distance);
      nextByPolygon.set(arc.fromRef, arc);
      heap.push({ polygonRef: arc.fromRef, distance });
    }
  }
  return { distances, nextByPolygon };
}

export function traceRecastRouteTreeCorridor(
  tree: RecastRouteTree,
  startPolygonRef: number,
  goalPolygonRef: number
): number[] | undefined {
  if (!tree.distances.has(startPolygonRef)) {
    return undefined;
  }
  const corridor = [startPolygonRef];
  const visited = new Set<number>();
  let currentRef = startPolygonRef;
  while (currentRef !== goalPolygonRef) {
    if (visited.has(currentRef)) {
      return undefined;
    }
    visited.add(currentRef);
    const arc = tree.nextByPolygon.get(currentRef);
    if (
      arc === undefined ||
      arc.fromRef !== currentRef ||
      arc.nativeCorridorRefs.at(-1) !== arc.toRef
    ) {
      return undefined;
    }
    corridor.push(...arc.nativeCorridorRefs);
    currentRef = arc.toRef;
  }
  return corridor;
}

export function sampleRecastRouteField(
  field: RecastRouteField,
  point: NavigationPoint,
  revision: number,
  topology: RecastNavigationTopology,
  traversal: RecastRouteFieldTraversal,
  projectPoint: (
    point: NavigationPoint,
    profile: NavigationAgentProfileDefinition
  ) => NavigationProjection | undefined
): NavigationBackendRouteSample {
  if (field.revision !== revision) {
    return { status: "stale", routeRevision: field.revision, revision };
  }
  const projection = projectPoint(point, field.profile);
  const polygonRef = projectionPolyRef(projection);
  if (projection === undefined || polygonRef === undefined || !field.distances.has(polygonRef)) {
    return { status: "missing", revision };
  }
  const polygon = topology.polygons.get(polygonRef);
  const arc = field.nextByPolygon.get(polygonRef);
  const routeTraversal =
    arc?.portalId === undefined || arc.entryPoint === undefined || arc.exitPoint === undefined
      ? undefined
      : {
          kind: "portal" as const,
          portalId: arc.portalId,
          entryPoint: cloneNavigationPoint(arc.entryPoint),
          exitPoint: cloneNavigationPoint(arc.exitPoint)
        };
  const nextPoint =
    polygonRef === field.goalPolygonRef
      ? field.goal
      : (routeTraversal?.entryPoint ?? arc?.steeringPoint);
  if (polygon === undefined || nextPoint === undefined) {
    return { status: "missing", revision };
  }
  const segmentDistance = pointDistance(projection.point, nextPoint);
  const direction =
    segmentDistance === 0
      ? { x: 0, y: 0, ...(hasZ(projection.point, nextPoint) ? { z: 0 } : {}) }
      : {
          x: (nextPoint.x - projection.point.x) / segmentDistance,
          y: (nextPoint.y - projection.point.y) / segmentDistance,
          ...(hasZ(projection.point, nextPoint)
            ? { z: ((nextPoint.z ?? 0) - (projection.point.z ?? 0)) / segmentDistance }
            : {})
        };
  const localCost =
    polygonRef === field.goalPolygonRef && polygon.areaId !== undefined
      ? segmentDistance * traversal.areaCost(polygon.areaId, field.profile)
      : 0;
  return {
    status: "valid",
    revision,
    point: cloneNavigationPoint(projection.point),
    nextPoint: cloneNavigationPoint(nextPoint),
    direction,
    distanceToRoute: projection.distance,
    remainingDistance: (field.distances.get(polygonRef) ?? 0) + localCost,
    ...(routeTraversal === undefined ? {} : { traversal: routeTraversal })
  };
}

export function recastRouteFieldKey(
  profile: NavigationAgentProfileDefinition,
  goalPolygonRef: number,
  goal: NavigationPoint,
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
    goalPolygonRef,
    goal.x,
    goal.y,
    goal.z ?? ""
  ].join("|");
}

export function recastTraversalCost(
  arc: RecastNavigationArc,
  profile: NavigationAgentProfileDefinition,
  topology: RecastNavigationTopology,
  traversal: RecastRouteFieldTraversal
): number | undefined {
  const from = topology.polygons.get(arc.fromRef);
  const to = topology.polygons.get(arc.toRef);
  if (
    from === undefined ||
    to === undefined ||
    !polygonSupportsProfile(from, profile, traversal) ||
    !polygonSupportsProfile(to, profile, traversal) ||
    (arc.portalId !== undefined && !traversal.isPortalTraversable(arc.portalId))
  ) {
    return undefined;
  }
  let cost = 0;
  for (const segment of arc.costSegments) {
    if (segment.areaId !== undefined && !traversal.isAreaTraversable(segment.areaId, profile)) {
      return undefined;
    }
    cost +=
      segment.distance *
      (segment.areaId === undefined ? 1 : traversal.areaCost(segment.areaId, profile));
  }
  return cost;
}

function polygonSupportsProfile(
  polygon: RecastNavigationPolygon,
  profile: NavigationAgentProfileDefinition,
  traversal: RecastRouteFieldTraversal
): boolean {
  return polygon.areaId === undefined || traversal.isAreaTraversable(polygon.areaId, profile);
}

function projectionPolyRef(projection: NavigationProjection | undefined): number | undefined {
  const value = projection?.backendNodeId?.startsWith("poly:")
    ? Number(projection.backendNodeId.slice(5))
    : NaN;
  return Number.isSafeInteger(value) && value > 0 ? value : undefined;
}

function addDependency(
  dependencies: Map<string, NavigationObstacleTarget>,
  dependency: NavigationObstacleTarget
): void {
  dependencies.set(navigationDependencyKey(dependency), dependency);
}

function compareArc(left: RecastNavigationArc, right: RecastNavigationArc): number {
  return left.toRef - right.toRef || (left.portalId ?? "").localeCompare(right.portalId ?? "");
}

function pointDistance(left: NavigationPoint, right: NavigationPoint): number {
  return Math.hypot(left.x - right.x, left.y - right.y, (left.z ?? 0) - (right.z ?? 0));
}

function hasZ(left: NavigationPoint, right: NavigationPoint): boolean {
  return left.z !== undefined || right.z !== undefined;
}
