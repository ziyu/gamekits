import {
  cloneNavigationPoint,
  type NavigationAgentProfileDefinition,
  type NavigationPoint,
  type NavigationProjection
} from "@gamekits/navigation-core";
import type { CompiledNavigationGraph, CompiledNavigationNode } from "../compiler";

export function projectGraphPoint(
  point: NavigationPoint,
  profile: NavigationAgentProfileDefinition,
  graph: CompiledNavigationGraph,
  revision: number
): NavigationProjection | undefined {
  const best = graph.spatialIndex.nearest(point, (node) => nodeSupportsProfile(node, profile));
  if (best === undefined) {
    return undefined;
  }
  return {
    point: cloneNavigationPoint(best.node.point),
    backendNodeId: best.node.id,
    ...(best.node.area === undefined ? {} : { area: best.node.area }),
    distance: best.distance,
    revision
  };
}

export function nodeSupportsProfile(
  node: CompiledNavigationNode,
  profile: NavigationAgentProfileDefinition
): boolean {
  return (
    (node.area === undefined ||
      profile.allowedAreas === undefined ||
      profile.allowedAreas.includes(node.area)) &&
    (node.clearance === undefined || node.clearance >= profile.radius) &&
    (profile.height === undefined ||
      node.heightClearance === undefined ||
      node.heightClearance >= profile.height)
  );
}

export function pointDistance(left: NavigationPoint, right: NavigationPoint): number {
  return Math.hypot(left.x - right.x, left.y - right.y, (left.z ?? 0) - (right.z ?? 0));
}
