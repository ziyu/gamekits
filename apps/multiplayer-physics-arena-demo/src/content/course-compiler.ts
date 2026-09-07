import type { NavigationLayoutDefinition } from "@gamekits/navigation-core";
import type { NavigationNavMeshSource } from "@gamekits/navigation-navmesh";
import type {
  PhysicsColliderDefinition,
  PhysicsMaterialDefinition,
  PhysicsPredictionIslandEnvironment,
  PhysicsPredictionIslandMemberDefinition,
  PhysicsShapeDefinition,
  PhysicsVector
} from "@gamekits/physics-core";

import type {
  ArenaBoundsDefinition,
  ArenaCourseDefinition,
  ArenaDynamicPropPlacementDefinition,
  ArenaGameplayVolumeDefinition,
  ArenaHazardDefinition,
  ArenaHazardPlacementDefinition,
  ArenaSpawnPointDefinition,
  ArenaSpawnSetDefinition,
  ArenaStaticPlacementDefinition
} from "./types";

export type ArenaCoursePresentationPlacement = {
  id: string;
  sourceId: string;
  role: ArenaStaticPlacementDefinition["role"] | "hazard" | "prop" | "volume";
  position: PhysicsVector;
  size: { width: number; height: number; depth: number };
  rotation?: PhysicsVector | undefined;
  materialId: string;
  presentationId: string;
};

export type ArenaCourseValidationProbe = {
  id: string;
  sourceId: string;
  kind: "participant-spawn" | "item-spawn" | "volume" | "walkable-surface";
  position: PhysicsVector;
  clearance?: { radius: number; height: number } | undefined;
  volume?: ArenaGameplayVolumeDefinition | undefined;
};

export type CompiledArenaHazardSchedule = {
  memberId: string;
  placementId: string;
  definitionId: string;
  kind: ArenaHazardDefinition["kind"];
  periodTicks: number;
  phaseTicks: number;
  activeTicks: number;
  activationProgress: number;
  axis: "x" | "y" | "z";
  origin: PhysicsVector;
  size: { width: number; height: number; depth: number };
  travel: number;
  strength: number;
};

export type CompiledArenaCourse = {
  id: string;
  definitionVersion: string;
  bounds: ArenaBoundsDefinition;
  physicsEnvironment: PhysicsPredictionIslandEnvironment;
  memberDefinitions: PhysicsPredictionIslandMemberDefinition[];
  participantSpawns: ArenaSpawnPointDefinition[];
  itemSpawns: ArenaSpawnPointDefinition[];
  hazardSchedules: CompiledArenaHazardSchedule[];
  navigation: {
    layout: NavigationLayoutDefinition;
    source: NavigationNavMeshSource;
  };
  presentation: {
    themeId: ArenaCourseDefinition["presentation"]["themeId"];
    accent: string;
    skyline: string;
    placements: ArenaCoursePresentationPlacement[];
  };
  validationProbes: ArenaCourseValidationProbe[];
  layoutSignature: string;
  scheduleSignature: string;
};

export function compileArenaCourse(options: {
  course: ArenaCourseDefinition;
  spawnSet: ArenaSpawnSetDefinition;
  hazards: readonly ArenaHazardDefinition[];
}): CompiledArenaCourse {
  const { course, spawnSet } = options;
  const hazardsById = new Map(options.hazards.map((hazard) => [hazard.id, hazard]));
  assertUniqueIds(`${course.id}.staticLayout`, course.staticLayout);
  assertUniqueIds(`${course.id}.hazards`, course.hazards);
  assertUniqueIds(`${course.id}.props`, course.props);
  assertUniqueIds(`${course.id}.volumes`, course.volumes);
  assertUniqueIds(`${spawnSet.id}.points`, spawnSet.points);

  const bodies = course.staticLayout.map((placement) => ({
    id: placement.id,
    kind: "static" as const,
    position: cloneVector(placement.position),
    ...(placement.rotation === undefined ? {} : { rotation: cloneVector(placement.rotation) }),
    userData: { sourceId: placement.id, courseId: course.id }
  }));
  const colliders = course.staticLayout.map(staticCollider);
  const hazardSchedules = course.hazards.map((placement) => {
    const definition = hazardsById.get(placement.definition.id);
    if (definition === undefined) {
      throw new Error(
        `arena.course_hazard_missing: ${course.id}.${placement.id} references ${placement.definition.id}`
      );
    }
    return compileHazardSchedule(placement, definition);
  });
  const memberDefinitions = [
    ...course.hazards.map((placement) =>
      hazardMember(placement, requireHazard(hazardsById, placement.definition.id, course.id))
    ),
    ...course.props.map(propMember)
  ].sort(compareId);
  const navigation = compileNavigation(course, hazardsById);
  const presentationPlacements = [
    ...course.staticLayout.map(staticPresentation),
    ...course.hazards.map((placement) => hazardPresentation(placement, course)),
    ...course.props.map(propPresentation),
    ...course.volumes.map(volumePresentation)
  ].sort(compareId);
  const participantSpawns = spawnSet.points
    .filter((point) => point.kind === "participant")
    .map(cloneSpawn)
    .sort(compareId);
  const itemSpawns = spawnSet.points
    .filter((point) => point.kind === "item")
    .map(cloneSpawn)
    .sort(compareId);
  const validationProbes: ArenaCourseValidationProbe[] = [
    ...participantSpawns.map((spawn) => ({
      id: `probe.${spawn.id}`,
      sourceId: spawn.id,
      kind: "participant-spawn" as const,
      position: cloneVector(spawn.position),
      clearance: { radius: course.navigation.agentRadius, height: course.navigation.agentHeight }
    })),
    ...itemSpawns.map((spawn) => ({
      id: `probe.${spawn.id}`,
      sourceId: spawn.id,
      kind: "item-spawn" as const,
      position: cloneVector(spawn.position)
    })),
    ...course.volumes.map((volume) => ({
      id: `probe.${volume.id}`,
      sourceId: volume.id,
      kind: "volume" as const,
      position: cloneVector(volume.position),
      volume: structuredClone(volume)
    })),
    ...course.staticLayout
      .filter((placement) => placement.navigationArea !== undefined)
      .map((placement) => ({
        id: `probe.${placement.id}`,
        sourceId: placement.id,
        kind: "walkable-surface" as const,
        position: cloneVector(placement.position)
      }))
  ].sort(compareId);
  const layoutFacts = {
    courseId: course.id,
    definitionVersion: course.definitionVersion,
    bounds: course.bounds,
    bodies,
    colliders,
    members: memberDefinitions,
    navigation,
    presentationPlacements,
    spawns: [...participantSpawns, ...itemSpawns],
    volumes: course.volumes
  };

  return structuredClone({
    id: course.id,
    definitionVersion: course.definitionVersion,
    bounds: course.bounds,
    physicsEnvironment: { bodies, colliders },
    memberDefinitions,
    participantSpawns,
    itemSpawns,
    hazardSchedules,
    navigation,
    presentation: {
      ...course.presentation,
      placements: presentationPlacements
    },
    validationProbes,
    layoutSignature: stableSignature(layoutFacts),
    scheduleSignature: stableSignature(hazardSchedules)
  });
}

export function mergeArenaCourseEnvironments(
  courses: readonly CompiledArenaCourse[]
): PhysicsPredictionIslandEnvironment {
  const bodies = courses
    .flatMap((course) => course.physicsEnvironment.bodies ?? [])
    .sort(compareOptionalId);
  const colliders = courses
    .flatMap((course) => course.physicsEnvironment.colliders ?? [])
    .sort(compareOptionalId);
  assertUniqueIds(
    "arena.match.environment.bodies",
    bodies.map((body) => ({ id: body.id ?? "" }))
  );
  assertUniqueIds(
    "arena.match.environment.colliders",
    colliders.map((collider) => ({ id: collider.id ?? "" }))
  );
  return structuredClone({ bodies, colliders });
}

export function stableArenaContentSignature(value: unknown): string {
  return stableSignature(value);
}

function staticCollider(placement: ArenaStaticPlacementDefinition): PhysicsColliderDefinition {
  return {
    id: `${placement.id}.collider`,
    bodyId: placement.id,
    shape: { type: "box", ...placement.size },
    material: placement.material,
    userData: { sourceId: placement.id }
  };
}

function hazardMember(
  placement: ArenaHazardPlacementDefinition,
  definition: ArenaHazardDefinition
): PhysicsPredictionIslandMemberDefinition {
  return {
    id: placement.id,
    body: {
      id: placement.id,
      kind: "kinematic",
      position: cloneVector(placement.position),
      continuousCollisionDetection: definition.bodyKind === "kinematic",
      userData: {
        sourceId: placement.id,
        definitionId: definition.id,
        hazardKind: definition.kind
      }
    },
    colliders: [
      {
        id: `${placement.id}.collider`,
        shape: { type: "box", ...placement.size },
        material: "hazard",
        sensor: definition.bodyKind === "sensor",
        userData: { sourceId: placement.id, definitionId: definition.id }
      }
    ]
  };
}

function propMember(
  placement: ArenaDynamicPropPlacementDefinition
): PhysicsPredictionIslandMemberDefinition {
  return {
    id: placement.id,
    body: {
      id: placement.id,
      kind: "dynamic",
      position: cloneVector(placement.position),
      damping: { linear: 0.65, angular: 0.55 },
      continuousCollisionDetection: true,
      userData: {
        sourceId: placement.id,
        presentationId: placement.presentationId,
        authoredMass: placement.mass
      }
    },
    colliders: [
      {
        id: `${placement.id}.collider`,
        shape: structuredClone(placement.shape) as PhysicsShapeDefinition,
        material: arenaPropMaterialId(placement.id),
        userData: { sourceId: placement.id }
      }
    ]
  };
}

export function compileArenaPropMaterial(
  placement: Readonly<ArenaDynamicPropPlacementDefinition>
): PhysicsMaterialDefinition {
  const volume =
    placement.shape.type === "sphere"
      ? (4 / 3) * Math.PI * placement.shape.radius ** 3
      : placement.shape.width * placement.shape.height * placement.shape.depth;
  return {
    id: arenaPropMaterialId(placement.id),
    friction: 0.65,
    restitution: 0.45,
    density: placement.mass / Math.max(0.001, volume)
  };
}

function arenaPropMaterialId(placementId: string): string {
  return `arena.prop-material.${placementId}`;
}

function compileHazardSchedule(
  placement: ArenaHazardPlacementDefinition,
  definition: ArenaHazardDefinition
): CompiledArenaHazardSchedule {
  return {
    memberId: placement.id,
    placementId: placement.id,
    definitionId: definition.id,
    kind: definition.kind,
    periodTicks: definition.schedule.periodTicks,
    phaseTicks: definition.schedule.phaseTicks,
    activeTicks: definition.schedule.activeTicks,
    activationProgress: definition.schedule.activationProgress ?? 0,
    axis: placement.axis ?? "x",
    origin: cloneVector(placement.position),
    size: { ...placement.size },
    travel: placement.travel ?? 0,
    strength: placement.strength ?? 0
  };
}

function compileNavigation(
  course: ArenaCourseDefinition,
  hazardsById: ReadonlyMap<string, ArenaHazardDefinition>
): CompiledArenaCourse["navigation"] {
  const vertices: NavigationNavMeshSource["vertices"] = [];
  const triangles: NavigationNavMeshSource["triangles"] = [];
  const walkablePlacements = [
    ...course.staticLayout
      .filter((placement) => placement.navigationArea !== undefined)
      .map((placement) => ({
        id: placement.id,
        position: placement.position,
        size: placement.size,
        area: placement.navigationArea!,
        tags: [`source:${placement.id}`, `course:${course.id}`]
      })),
    ...course.hazards.flatMap((placement) => {
      const kind = hazardsById.get(placement.definition.id)?.kind;
      if (kind !== "moving-platform" && kind !== "crumble-floor") return [];
      return [
        {
          id: placement.id,
          position: placement.position,
          size: placement.size,
          area: "walkable" as const,
          tags: [
            `source:${placement.id}`,
            `course:${course.id}`,
            "dynamic-support",
            `hazard:${kind}`
          ]
        }
      ];
    })
  ].sort(compareId);
  for (const placement of walkablePlacements) {
    const base = vertices.length;
    const halfWidth = placement.size.width / 2;
    const halfDepth = placement.size.depth / 2;
    const elevation = placement.position.y + placement.size.height / 2;
    vertices.push(
      {
        x: placement.position.x - halfWidth,
        y: (placement.position.z ?? 0) - halfDepth,
        z: elevation
      },
      {
        x: placement.position.x + halfWidth,
        y: (placement.position.z ?? 0) - halfDepth,
        z: elevation
      },
      {
        x: placement.position.x + halfWidth,
        y: (placement.position.z ?? 0) + halfDepth,
        z: elevation
      },
      {
        x: placement.position.x - halfWidth,
        y: (placement.position.z ?? 0) + halfDepth,
        z: elevation
      }
    );
    triangles.push(
      { a: base, b: base + 1, c: base + 2, area: placement.area, tags: placement.tags },
      { a: base, b: base + 2, c: base + 3, area: placement.area, tags: placement.tags }
    );
  }
  const sourceId = `navigation.source.${course.id}`;
  const layoutId = `navigation.layout.${course.id}`;
  return {
    source: {
      id: sourceId,
      version: course.definitionVersion,
      vertices,
      triangles,
      build: {
        cellSize: 0.24,
        cellHeight: 0.12,
        walkableRadius: course.navigation.agentRadius,
        walkableHeight: course.navigation.agentHeight,
        walkableClimb: course.navigation.maxClimb,
        walkableSlopeAngle: course.navigation.maxSlopeDegrees,
        minRegionArea: 1,
        mergeRegionArea: 4,
        maxSimplificationError: 0.3,
        maxEdgeLength: 4.5,
        maxVerticesPerPolygon: 6,
        detailSampleDistance: 1.2,
        detailSampleMaxError: 0.3
      },
      tags: ["arena", `course:${course.id}`]
    },
    layout: {
      id: layoutId,
      backend: "recast",
      source: { type: "navigation.navmesh-source", id: sourceId },
      areas: [
        { id: "walkable", cost: 1 },
        { id: "slow", cost: 1.7 },
        { id: "slick", cost: 1.25 }
      ],
      tags: ["arena", `course:${course.id}`]
    }
  };
}

function staticPresentation(
  placement: ArenaStaticPlacementDefinition
): ArenaCoursePresentationPlacement {
  return {
    id: `presentation.${placement.id}`,
    sourceId: placement.id,
    role: placement.role,
    position: cloneVector(placement.position),
    size: { ...placement.size },
    ...(placement.rotation === undefined ? {} : { rotation: cloneVector(placement.rotation) }),
    materialId: placement.material,
    presentationId: `course.${placement.role}`
  };
}

function hazardPresentation(
  placement: ArenaHazardPlacementDefinition,
  course: ArenaCourseDefinition
): ArenaCoursePresentationPlacement {
  return {
    id: `presentation.${placement.id}`,
    sourceId: placement.id,
    role: "hazard",
    position: cloneVector(placement.position),
    size: { ...placement.size },
    materialId: "hazard",
    presentationId: `${course.presentation.themeId}.hazard`
  };
}

function propPresentation(
  placement: ArenaDynamicPropPlacementDefinition
): ArenaCoursePresentationPlacement {
  const size =
    placement.shape.type === "sphere"
      ? {
          width: placement.shape.radius * 2,
          height: placement.shape.radius * 2,
          depth: placement.shape.radius * 2
        }
      : {
          width: placement.shape.width,
          height: placement.shape.height,
          depth: placement.shape.depth
        };
  return {
    id: `presentation.${placement.id}`,
    sourceId: placement.id,
    role: "prop",
    position: cloneVector(placement.position),
    size,
    materialId: placement.material,
    presentationId: placement.presentationId
  };
}

function volumePresentation(
  placement: ArenaGameplayVolumeDefinition
): ArenaCoursePresentationPlacement {
  return {
    id: `presentation.${placement.id}`,
    sourceId: placement.id,
    role: "volume",
    position: cloneVector(placement.position),
    size: { ...placement.size },
    materialId: "volume",
    presentationId: `volume.${placement.kind}`
  };
}

function cloneSpawn(spawn: ArenaSpawnPointDefinition): ArenaSpawnPointDefinition {
  return {
    ...spawn,
    position: cloneVector(spawn.position),
    ...(spawn.definition === undefined ? {} : { definition: { ...spawn.definition } })
  };
}

function cloneVector(value: PhysicsVector): PhysicsVector {
  return { x: value.x, y: value.y, ...(value.z === undefined ? {} : { z: value.z }) };
}

function requireHazard(
  hazards: ReadonlyMap<string, ArenaHazardDefinition>,
  id: string,
  courseId: string
): ArenaHazardDefinition {
  const definition = hazards.get(id);
  if (definition === undefined) {
    throw new Error(`arena.course_hazard_missing: ${courseId} references ${id}`);
  }
  return definition;
}

function assertUniqueIds(scope: string, values: readonly { id: string }[]): void {
  const ids = new Set<string>();
  for (const value of values) {
    if (value.id.length === 0) throw new Error(`arena.course_placement_id: ${scope} has blank id`);
    if (ids.has(value.id))
      throw new Error(`arena.course_placement_duplicate: ${scope}.${value.id}`);
    ids.add(value.id);
  }
}

function compareId<T extends { id: string }>(left: T, right: T): number {
  return left.id.localeCompare(right.id);
}

function compareOptionalId<T extends { id?: string | undefined }>(left: T, right: T): number {
  return (left.id ?? "").localeCompare(right.id ?? "");
}

function stableSignature(value: unknown): string {
  const canonical = canonicalStringify(value);
  let hash = 0x811c9dc5;
  for (let index = 0; index < canonical.length; index += 1) {
    hash ^= canonical.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `fnv1a32:${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function canonicalStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalStringify).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalStringify(record[key])}`)
    .join(",")}}`;
}
