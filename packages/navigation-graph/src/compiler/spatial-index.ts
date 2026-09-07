import type { NavigationPoint } from "@gamekits/navigation-core";
import type { CompiledNavigationNode } from "./types";

type Axis = 0 | 1 | 2;

type SpatialNode = {
  value: CompiledNavigationNode;
  axis: Axis;
  left?: SpatialNode | undefined;
  right?: SpatialNode | undefined;
};

export type NavigationGraphSpatialIndex = {
  nearest(
    point: NavigationPoint,
    accepts: (node: CompiledNavigationNode) => boolean
  ): { node: CompiledNavigationNode; distance: number } | undefined;
};

export function createNavigationGraphSpatialIndex(
  nodes: Iterable<CompiledNavigationNode>
): NavigationGraphSpatialIndex {
  const root = build([...nodes], 0);
  return {
    nearest(point, accepts) {
      let best: { node: CompiledNavigationNode; distanceSquared: number } | undefined;
      visit(root);
      return best === undefined
        ? undefined
        : { node: best.node, distance: Math.sqrt(best.distanceSquared) };

      function visit(current: SpatialNode | undefined): void {
        if (current === undefined) {
          return;
        }
        const delta =
          coordinate(point, current.axis) - coordinate(current.value.point, current.axis);
        const near = delta <= 0 ? current.left : current.right;
        const far = delta <= 0 ? current.right : current.left;
        visit(near);

        if (accepts(current.value)) {
          const distanceSquared = squaredDistance(point, current.value.point);
          if (
            best === undefined ||
            distanceSquared < best.distanceSquared ||
            (distanceSquared === best.distanceSquared &&
              current.value.id.localeCompare(best.node.id) < 0)
          ) {
            best = { node: current.value, distanceSquared };
          }
        }
        if (best === undefined || delta * delta <= best.distanceSquared) {
          visit(far);
        }
      }
    }
  };
}

function build(nodes: CompiledNavigationNode[], depth: number): SpatialNode | undefined {
  if (nodes.length === 0) {
    return undefined;
  }
  const axis = (depth % 3) as Axis;
  nodes.sort(
    (left, right) =>
      coordinate(left.point, axis) - coordinate(right.point, axis) ||
      left.id.localeCompare(right.id)
  );
  const middle = Math.floor(nodes.length / 2);
  return {
    value: nodes[middle]!,
    axis,
    left: build(nodes.slice(0, middle), depth + 1),
    right: build(nodes.slice(middle + 1), depth + 1)
  };
}

function coordinate(point: NavigationPoint, axis: Axis): number {
  return axis === 0 ? point.x : axis === 1 ? point.y : (point.z ?? 0);
}

function squaredDistance(left: NavigationPoint, right: NavigationPoint): number {
  const x = left.x - right.x;
  const y = left.y - right.y;
  const z = (left.z ?? 0) - (right.z ?? 0);
  return x * x + y * y + z * z;
}
