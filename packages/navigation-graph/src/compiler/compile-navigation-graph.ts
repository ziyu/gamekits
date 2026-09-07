import {
  cloneNavigationPoint,
  navigationDependencyKey,
  type NavigationLayoutDefinition,
  type NavigationObstacleTarget,
  type NavigationPoint
} from "@gamekits/navigation-core";
import type {
  NavigationGraphDefinition,
  NavigationGraphEdgeDefinition
} from "../contracts/graph-definition";
import type {
  AreaTraversalState,
  CompiledNavigationArc,
  CompiledNavigationGraph,
  TraversalState
} from "./types";
import { createNavigationGraphSpatialIndex } from "./spatial-index";

export function compileNavigationGraph(
  graph: NavigationGraphDefinition,
  layout?: NavigationLayoutDefinition
): CompiledNavigationGraph {
  const nodes = new Map(
    graph.nodes.map((node) => [
      node.id,
      {
        ...node,
        point: cloneNavigationPoint(node.point),
        ...(node.tags === undefined ? {} : { tags: [...node.tags] })
      }
    ])
  );
  const connectionStates = new Map<string, TraversalState>();
  const areaStates = createAreaStates(graph, layout);
  const reverseAdjacency = new Map<string, CompiledNavigationArc[]>();
  const spatialIndex = createNavigationGraphSpatialIndex(nodes.values());

  for (const nodeId of nodes.keys()) {
    reverseAdjacency.set(nodeId, []);
  }
  for (const edge of graph.edges) {
    requireNode(nodes, edge.from, `edge ${edge.id} from`);
    requireNode(nodes, edge.to, `edge ${edge.id} to`);
    addEdge(edge);
  }
  for (const portal of layout?.portals ?? []) {
    const from = nearestNodeId(nodes, portal.from.point, portal.from.area);
    const to = nearestNodeId(nodes, portal.to.point, portal.to.area);
    if (from === undefined || to === undefined) {
      throw new Error(`Navigation portal ${portal.id} cannot be projected onto graph nodes`);
    }
    const target: NavigationObstacleTarget = { kind: "portal", id: portal.id };
    const stateKey = navigationDependencyKey(target);
    connectionStates.set(stateKey, {
      target,
      blocked: portal.enabled === false,
      costMultiplier: 1
    });
    const baseCost = portal.cost ?? pointDistance(nodes.get(from)!.point, nodes.get(to)!.point);
    addArc({ stateKey, dependency: target, from, to, baseCost });
    if (portal.bidirectional !== false) {
      addArc({ stateKey, dependency: target, from: to, to: from, baseCost });
    }
  }
  for (const arcs of reverseAdjacency.values()) {
    arcs.sort(
      (left, right) =>
        left.from.localeCompare(right.from) || left.stateKey.localeCompare(right.stateKey)
    );
  }

  return {
    id: graph.id,
    nodes,
    connectionStates,
    areaStates,
    reverseAdjacency,
    spatialIndex,
    dispose() {
      nodes.clear();
      connectionStates.clear();
      areaStates.clear();
      reverseAdjacency.clear();
    }
  };

  function addEdge(edge: NavigationGraphEdgeDefinition): void {
    const target: NavigationObstacleTarget = { kind: "edge", id: edge.id };
    const stateKey = navigationDependencyKey(target);
    connectionStates.set(stateKey, {
      target,
      blocked: edge.enabled === false,
      costMultiplier: 1
    });
    const fromPoint = nodes.get(edge.from)!.point;
    const toPoint = nodes.get(edge.to)!.point;
    const arc = {
      stateKey,
      dependency: target,
      from: edge.from,
      to: edge.to,
      baseCost: edge.cost ?? pointDistance(fromPoint, toPoint),
      ...(edge.area === undefined ? {} : { area: edge.area }),
      ...(edge.width === undefined ? {} : { width: edge.width }),
      ...(edge.heightClearance === undefined ? {} : { heightClearance: edge.heightClearance }),
      ...(edge.slope === undefined ? {} : { slope: edge.slope })
    } satisfies CompiledNavigationArc;
    addArc(arc);
    if (edge.bidirectional !== false) {
      addArc({ ...arc, from: edge.to, to: edge.from });
    }
  }

  function addArc(arc: CompiledNavigationArc): void {
    const reverse = reverseAdjacency.get(arc.to);
    if (reverse === undefined) {
      throw new Error(`Navigation arc points to an unknown node: ${arc.to}`);
    }
    reverse.push(arc);
  }
}

function createAreaStates(
  graph: NavigationGraphDefinition,
  layout: NavigationLayoutDefinition | undefined
): Map<string, AreaTraversalState> {
  const costs = new Map((layout?.areas ?? []).map((area) => [area.id, area.cost ?? 1]));
  for (const node of graph.nodes) {
    if (node.area !== undefined && !costs.has(node.area)) {
      costs.set(node.area, 1);
    }
  }
  for (const edge of graph.edges) {
    if (edge.area !== undefined && !costs.has(edge.area)) {
      costs.set(edge.area, 1);
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

function nearestNodeId(
  nodes: CompiledNavigationGraph["nodes"],
  point: NavigationPoint,
  area: string | undefined
): string | undefined {
  let best: { id: string; distance: number } | undefined;
  for (const node of nodes.values()) {
    if (area !== undefined && node.area !== area) {
      continue;
    }
    const distance = pointDistance(node.point, point);
    if (
      best === undefined ||
      distance < best.distance ||
      (distance === best.distance && node.id.localeCompare(best.id) < 0)
    ) {
      best = { id: node.id, distance };
    }
  }
  return best?.id;
}

function requireNode(
  nodes: CompiledNavigationGraph["nodes"],
  nodeId: string,
  context: string
): void {
  if (!nodes.has(nodeId)) {
    throw new Error(`Navigation ${context} references unknown node ${nodeId}`);
  }
}

function pointDistance(left: NavigationPoint, right: NavigationPoint): number {
  return Math.hypot(left.x - right.x, left.y - right.y, (left.z ?? 0) - (right.z ?? 0));
}
