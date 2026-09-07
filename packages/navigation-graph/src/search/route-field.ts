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
import type { CompiledNavigationArc, CompiledNavigationGraph, GraphRouteField } from "../compiler";
import { createMinHeap } from "./min-heap";
import { nodeSupportsProfile, pointDistance, projectGraphPoint } from "./project-graph-point";

export function buildGraphRouteField(
  key: string,
  goalNodeId: string,
  profile: NavigationAgentProfileDefinition,
  revision: number,
  graph: CompiledNavigationGraph
): GraphRouteField {
  const distances = new Map<string, number>([[goalNodeId, 0]]);
  const nextByNode = new Map<
    string,
    {
      nextNodeId: string;
      dependencies: NavigationObstacleTarget[];
      portalId?: string | undefined;
    }
  >();
  const treeDependencyKeys = new Set<string>();
  const treeDependencies = new Map<string, NavigationObstacleTarget>();
  const heap = createMinHeap();
  heap.push({ nodeId: goalNodeId, distance: 0 });

  while (true) {
    const current = heap.pop();
    if (current === undefined) {
      break;
    }
    if (current.distance !== distances.get(current.nodeId)) {
      continue;
    }
    for (const arc of graph.reverseAdjacency.get(current.nodeId) ?? []) {
      const traversal = evaluateTraversal(arc, profile, graph);
      if (traversal === undefined) {
        continue;
      }
      const distance = current.distance + traversal.cost;
      const previous = distances.get(arc.from);
      const previousStep = nextByNode.get(arc.from);
      if (
        previous !== undefined &&
        (distance > previous ||
          (distance === previous &&
            previousStep !== undefined &&
            current.nodeId.localeCompare(previousStep.nextNodeId) >= 0))
      ) {
        continue;
      }
      distances.set(arc.from, distance);
      nextByNode.set(arc.from, {
        nextNodeId: current.nodeId,
        dependencies: traversal.dependencies,
        ...(arc.dependency.kind === "portal" ? { portalId: arc.dependency.id } : {})
      });
      for (const dependency of traversal.dependencies) {
        const dependencyKey = navigationDependencyKey(dependency);
        treeDependencyKeys.add(dependencyKey);
        treeDependencies.set(dependencyKey, { ...dependency });
      }
      heap.push({ nodeId: arc.from, distance });
    }
  }
  return {
    key,
    retainCount: 0,
    goalNodeId,
    revision,
    profile: cloneNavigationProfile(profile),
    distances,
    nextByNode,
    treeDependencyKeys,
    treeDependencies
  };
}

export function extractGraphPath(
  field: GraphRouteField,
  startNodeId: string,
  graph: CompiledNavigationGraph
):
  | {
      points: NavigationPoint[];
      traversals: NavigationPathTraversal[];
      dependencies: NavigationObstacleTarget[];
    }
  | undefined {
  if (!field.distances.has(startNodeId)) {
    return undefined;
  }
  const points: NavigationPoint[] = [];
  const traversals: NavigationPathTraversal[] = [];
  const dependencies = new Map<string, NavigationObstacleTarget>();
  let current = startNodeId;
  let guard = 0;
  while (guard <= graph.nodes.size) {
    const node = graph.nodes.get(current);
    if (node === undefined) {
      return undefined;
    }
    points.push(cloneNavigationPoint(node.point));
    if (current === field.goalNodeId) {
      return { points, traversals, dependencies: [...dependencies.values()] };
    }
    const step = field.nextByNode.get(current);
    const nextNode = graph.nodes.get(step?.nextNodeId ?? "");
    if (step === undefined || nextNode === undefined) {
      return undefined;
    }
    if (step.portalId !== undefined) {
      traversals.push({
        kind: "portal",
        portalId: step.portalId,
        fromPointIndex: points.length - 1,
        toPointIndex: points.length,
        entryPoint: cloneNavigationPoint(node.point),
        exitPoint: cloneNavigationPoint(nextNode.point)
      });
    }
    for (const dependency of step.dependencies) {
      dependencies.set(navigationDependencyKey(dependency), { ...dependency });
    }
    current = step.nextNodeId;
    guard += 1;
  }
  return undefined;
}

export function sampleGraphRouteField(
  field: GraphRouteField,
  point: NavigationPoint,
  graph: CompiledNavigationGraph,
  revision: number
): NavigationBackendRouteSample {
  if (field.revision !== revision) {
    return { status: "stale", routeRevision: field.revision, revision };
  }
  const projection = projectGraphPoint(point, field.profile, graph, revision);
  const nodeId = projection?.backendNodeId;
  if (projection === undefined || nodeId === undefined || !field.distances.has(nodeId)) {
    return { status: "missing", revision };
  }
  const step = field.nextByNode.get(nodeId);
  const nextNode = graph.nodes.get(step?.nextNodeId ?? nodeId);
  const currentNode = graph.nodes.get(nodeId);
  if (currentNode === undefined || nextNode === undefined) {
    return { status: "missing", revision };
  }
  const traversal =
    step?.portalId === undefined
      ? undefined
      : {
          kind: "portal" as const,
          portalId: step.portalId,
          entryPoint: cloneNavigationPoint(currentNode.point),
          exitPoint: cloneNavigationPoint(nextNode.point)
        };
  const steeringPoint = traversal?.entryPoint ?? nextNode.point;
  const segmentDistance = pointDistance(projection.point, steeringPoint);
  const direction =
    segmentDistance === 0
      ? { x: 0, y: 0, ...(point.z === undefined && steeringPoint.z === undefined ? {} : { z: 0 }) }
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
    remainingDistance: field.distances.get(nodeId) ?? 0,
    ...(traversal === undefined ? {} : { traversal })
  };
}

export function routeFieldDependencies(
  field: GraphRouteField,
  startNodeId: string,
  graph: CompiledNavigationGraph
): NavigationObstacleTarget[] | undefined {
  return cloneNavigationDependencies(extractGraphPath(field, startNodeId, graph)?.dependencies);
}

function evaluateTraversal(
  arc: CompiledNavigationArc,
  profile: NavigationAgentProfileDefinition,
  graph: CompiledNavigationGraph
): { cost: number; dependencies: NavigationObstacleTarget[] } | undefined {
  const from = graph.nodes.get(arc.from);
  const to = graph.nodes.get(arc.to);
  const connection = graph.connectionStates.get(arc.stateKey);
  if (
    from === undefined ||
    to === undefined ||
    connection === undefined ||
    connection.blocked ||
    !nodeSupportsProfile(from, profile) ||
    !nodeSupportsProfile(to, profile) ||
    (arc.width !== undefined && arc.width < profile.radius * 2) ||
    (profile.height !== undefined &&
      arc.heightClearance !== undefined &&
      arc.heightClearance < profile.height) ||
    (profile.maxSlope !== undefined && arc.slope !== undefined && arc.slope > profile.maxSlope)
  ) {
    return undefined;
  }
  const areaId = arc.area ?? to.area;
  if (
    areaId !== undefined &&
    profile.allowedAreas !== undefined &&
    !profile.allowedAreas.includes(areaId)
  ) {
    return undefined;
  }
  const area = areaId === undefined ? undefined : graph.areaStates.get(areaId);
  if (area?.blocked === true) {
    return undefined;
  }
  const areaCost =
    areaId === undefined
      ? 1
      : (profile.costOverrides?.[areaId] ?? area?.baseCost ?? 1) * (area?.costMultiplier ?? 1);
  const dependencies = [{ ...connection.target }];
  if (area !== undefined) {
    dependencies.push({ ...area.target });
  }
  return {
    cost: arc.baseCost * connection.costMultiplier * areaCost,
    dependencies
  };
}
