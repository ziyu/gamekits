import type { NavigationLayoutDefinition, NavigationPoint } from "@gamekits/navigation-core";
import { Detour, statusFailed, type NavMesh } from "recast-navigation";
import type { NavigationRecastBuildArtifact } from "../contracts";

const DETOUR_GROUND_POLYGON = 0;
const DETOUR_INTERNAL_LINK_SIDE = 0xff;

export type RecastNavigationPolygon = {
  ref: number;
  areaId: string | undefined;
  center: NavigationPoint;
  vertices: NavigationPoint[];
  type: number;
};

export type RecastNavigationCostSegment = {
  distance: number;
  areaId: string | undefined;
};

export type RecastNavigationArc = {
  fromRef: number;
  toRef: number;
  nativeCorridorRefs: number[];
  steeringPoint: NavigationPoint;
  costSegments: RecastNavigationCostSegment[];
  portalId: string | undefined;
  entryPoint: NavigationPoint | undefined;
  exitPoint: NavigationPoint | undefined;
};

export type RecastNavigationTopology = {
  polygons: Map<number, RecastNavigationPolygon>;
  reverseAdjacency: Map<number, RecastNavigationArc[]>;
};

type RawRecastLink = {
  toRef: number;
  edge: number;
  side: number;
  minimum: number;
  maximum: number;
};

export function buildRecastNavigationTopology(
  navMesh: NavMesh,
  artifact: NavigationRecastBuildArtifact,
  layout: NavigationLayoutDefinition | undefined
): RecastNavigationTopology {
  const polygons = new Map<number, RecastNavigationPolygon>();
  const outgoingLinks = new Map<number, RawRecastLink[]>();
  const portalDefinitions = new Map((layout?.portals ?? []).map((portal) => [portal.id, portal]));

  for (let tileIndex = 0; tileIndex < navMesh.getMaxTiles(); tileIndex += 1) {
    const tile = navMesh.getTile(tileIndex);
    const header = tile.header();
    if (header === null) {
      continue;
    }
    for (let polygonIndex = 0; polygonIndex < header.polyCount(); polygonIndex += 1) {
      const polygon = tile.polys(polygonIndex);
      const ref = navMesh.encodePolyId(tile.salt(), tileIndex, polygonIndex);
      const vertices: NavigationPoint[] = [];
      for (let vertexIndex = 0; vertexIndex < polygon.vertCount(); vertexIndex += 1) {
        const tileVertexIndex = polygon.verts(vertexIndex) * 3;
        vertices.push(
          fromRecastPoint({
            x: tile.verts(tileVertexIndex),
            y: tile.verts(tileVertexIndex + 1),
            z: tile.verts(tileVertexIndex + 2)
          })
        );
      }
      polygons.set(ref, {
        ref,
        areaId: areaIdForPolygon(navMesh, artifact, ref),
        center: averagePoint(vertices),
        vertices,
        type: polygon.getType()
      });

      const links: RawRecastLink[] = [];
      let linkIndex = polygon.firstLink();
      let linkGuard = 0;
      while (linkIndex !== Detour.DT_NULL_LINK && linkGuard <= header.maxLinkCount()) {
        const link = tile.links(linkIndex);
        if (link.ref() !== 0) {
          links.push({
            toRef: link.ref(),
            edge: link.edge(),
            side: link.side(),
            minimum: link.bmin(),
            maximum: link.bmax()
          });
        }
        linkIndex = link.next();
        linkGuard += 1;
      }
      outgoingLinks.set(ref, links);
    }
  }

  const reverseAdjacency = new Map<number, RecastNavigationArc[]>();
  const uniqueArcs = new Map<string, RecastNavigationArc>();
  for (const from of polygons.values()) {
    if (from.type !== DETOUR_GROUND_POLYGON) {
      continue;
    }
    for (const link of outgoingLinks.get(from.ref) ?? []) {
      const neighbour = polygons.get(link.toRef);
      if (neighbour === undefined) {
        continue;
      }
      if (neighbour.type === DETOUR_GROUND_POLYGON) {
        rememberArc(createGroundArc(from, neighbour, link));
        continue;
      }
      const endpoints = navMesh.getOffMeshConnectionPolyEndPoints(from.ref, neighbour.ref);
      if (!endpoints.success) {
        continue;
      }
      const portalId = portalIdForPolygon(navMesh, artifact, neighbour.ref);
      const portalDefinition = portalId === undefined ? undefined : portalDefinitions.get(portalId);
      for (const exitLink of outgoingLinks.get(neighbour.ref) ?? []) {
        if (exitLink.toRef === from.ref) {
          continue;
        }
        const to = polygons.get(exitLink.toRef);
        if (to === undefined || to.type !== DETOUR_GROUND_POLYGON) {
          continue;
        }
        const entryPoint = fromRecastPoint(endpoints.start);
        const exitPoint = fromRecastPoint(endpoints.end);
        rememberArc({
          fromRef: from.ref,
          toRef: to.ref,
          nativeCorridorRefs: [neighbour.ref, to.ref],
          steeringPoint: exitPoint,
          costSegments: [
            { distance: pointDistance(from.center, entryPoint), areaId: from.areaId },
            portalDefinition?.cost === undefined
              ? { distance: pointDistance(entryPoint, exitPoint), areaId: neighbour.areaId }
              : { distance: portalDefinition.cost, areaId: undefined },
            { distance: pointDistance(exitPoint, to.center), areaId: to.areaId }
          ],
          portalId,
          entryPoint,
          exitPoint
        });
      }
    }
  }

  for (const arc of uniqueArcs.values()) {
    const incoming = reverseAdjacency.get(arc.toRef) ?? [];
    incoming.push(arc);
    reverseAdjacency.set(arc.toRef, incoming);
  }
  for (const incoming of reverseAdjacency.values()) {
    incoming.sort((left, right) => left.fromRef - right.fromRef || left.toRef - right.toRef);
  }
  return { polygons, reverseAdjacency };

  function rememberArc(arc: RecastNavigationArc): void {
    const key = `${arc.fromRef}:${arc.toRef}:${arc.portalId ?? "ground"}`;
    const existing = uniqueArcs.get(key);
    if (existing === undefined || arcLength(arc) < arcLength(existing)) {
      uniqueArcs.set(key, arc);
    }
  }
}

function createGroundArc(
  from: RecastNavigationPolygon,
  to: RecastNavigationPolygon,
  link: RawRecastLink
): RecastNavigationArc {
  const edgeStart = from.vertices[link.edge] ?? from.center;
  const edgeEnd = from.vertices[(link.edge + 1) % from.vertices.length] ?? from.center;
  const minimum = link.side === DETOUR_INTERNAL_LINK_SIDE ? 0 : link.minimum / 255;
  const maximum = link.side === DETOUR_INTERNAL_LINK_SIDE ? 1 : link.maximum / 255;
  const portalStart = lerpPoint(edgeStart, edgeEnd, minimum);
  const portalEnd = lerpPoint(edgeStart, edgeEnd, maximum);
  const portalMidpoint = lerpPoint(portalStart, portalEnd, 0.5);
  return {
    fromRef: from.ref,
    toRef: to.ref,
    nativeCorridorRefs: [to.ref],
    steeringPoint: lerpPoint(portalMidpoint, to.center, 0.2),
    costSegments: [
      { distance: pointDistance(from.center, portalMidpoint), areaId: from.areaId },
      { distance: pointDistance(portalMidpoint, to.center), areaId: to.areaId }
    ],
    portalId: undefined,
    entryPoint: undefined,
    exitPoint: undefined
  };
}

function portalIdForPolygon(
  navMesh: NavMesh,
  artifact: NavigationRecastBuildArtifact,
  polygonRef: number
): string | undefined {
  const result = navMesh.getPolyFlags(polygonRef);
  if (statusFailed(result.status)) {
    return undefined;
  }
  return Object.entries(artifact.portalFlags).find(([, flag]) => (result.flags & flag) !== 0)?.[0];
}

function areaIdForPolygon(
  navMesh: NavMesh,
  artifact: NavigationRecastBuildArtifact,
  polygonRef: number
): string | undefined {
  const result = navMesh.getPolyArea(polygonRef);
  return statusFailed(result.status) ? undefined : artifact.areaIds[result.area - 1];
}

function averagePoint(points: readonly NavigationPoint[]): NavigationPoint {
  if (points.length === 0) {
    return { x: 0, y: 0, z: 0 };
  }
  const total = points.reduce<{ x: number; y: number; z: number }>(
    (sum, point) => ({
      x: sum.x + point.x,
      y: sum.y + point.y,
      z: sum.z + (point.z ?? 0)
    }),
    { x: 0, y: 0, z: 0 }
  );
  return {
    x: total.x / points.length,
    y: total.y / points.length,
    z: total.z / points.length
  };
}

function lerpPoint(left: NavigationPoint, right: NavigationPoint, alpha: number): NavigationPoint {
  return {
    x: left.x + (right.x - left.x) * alpha,
    y: left.y + (right.y - left.y) * alpha,
    z: (left.z ?? 0) + ((right.z ?? 0) - (left.z ?? 0)) * alpha
  };
}

function arcLength(arc: RecastNavigationArc): number {
  return arc.costSegments.reduce((total, segment) => total + segment.distance, 0);
}

function pointDistance(left: NavigationPoint, right: NavigationPoint): number {
  return Math.hypot(left.x - right.x, left.y - right.y, (left.z ?? 0) - (right.z ?? 0));
}

function fromRecastPoint(point: { x: number; y: number; z: number }): NavigationPoint {
  return { x: point.x, y: point.z, z: point.y };
}
