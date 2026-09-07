import type { NavigationAgentProfileDefinition, NavigationPoint } from "@gamekits/navigation-core";
import type { NavigationRecastBuildArtifact } from "@gamekits/navigation-recast";
import {
  createRecastNavigationBackend,
  prepareRecastNavigationArtifact
} from "@gamekits/navigation-recast";
import type { PhysicsVector } from "@gamekits/physics-core";

import type { CompiledArenaContent, CompiledArenaStage } from "./registry";
import type {
  ArenaBoundsDefinition,
  ArenaBoxSize,
  ArenaGameplayVolumeDefinition,
  ArenaStaticPlacementDefinition
} from "./types";

export type ArenaContentValidationIssue = {
  code:
    | "arena.validation.spawn_bounds"
    | "arena.validation.spawn_clearance"
    | "arena.validation.spawn_capacity"
    | "arena.validation.item_bounds"
    | "arena.validation.item_clearance"
    | "arena.validation.item_pool"
    | "arena.validation.route"
    | "arena.validation.kill_volume"
    | "arena.validation.safe_zone"
    | "arena.validation.hazard_bounds"
    | "arena.validation.hazard_schedule"
    | "arena.validation.hazard_support"
    | "arena.validation.projection"
    | "arena.validation.navigation_source"
    | "arena.validation.navigation_bake"
    | "arena.validation.navigation_route"
    | "arena.validation.convergence";
  severity: "error";
  stageId: string;
  sourceId: string;
  sourcePath: string;
  message: string;
};

export type ArenaContentValidationReport = {
  valid: boolean;
  courseCount: number;
  probeCount: number;
  issues: ArenaContentValidationIssue[];
};

export type ArenaNavigationValidationArtifact = {
  stageId: string;
  sourceId: string;
  sourceVersion?: string | undefined;
  polygonCount: number;
  debugTriangleCount: number;
  byteLength: number;
  checkedRoutes: number;
  artifact: NavigationRecastBuildArtifact;
};

export type ArenaNavigationValidationReport = {
  valid: boolean;
  artifacts: ArenaNavigationValidationArtifact[];
  issues: ArenaContentValidationIssue[];
};

export function validateArenaCompiledContent(
  content: Readonly<CompiledArenaContent>
): ArenaContentValidationReport {
  const issues: ArenaContentValidationIssue[] = [];
  let entrants = content.matchRule.participantCount;
  let probeCount = 0;
  for (const stage of content.stages) {
    probeCount += stage.courseProjection.validationProbes.length;
    validateStage(stage, entrants, issues);
    entrants = stage.definition.qualificationCount;
  }
  return {
    valid: issues.length === 0,
    courseCount: content.stages.length,
    probeCount,
    issues: stableIssues(issues)
  };
}

export function assertValidArenaCompiledContent(content: Readonly<CompiledArenaContent>): void {
  const report = validateArenaCompiledContent(content);
  if (report.valid) return;
  const first = report.issues[0]!;
  throw new Error(`${first.code}: ${first.stageId}.${first.sourceId}: ${first.message}`);
}

export async function validateArenaNavigationArtifacts(
  content: Readonly<CompiledArenaContent>
): Promise<ArenaNavigationValidationReport> {
  const artifacts: ArenaNavigationValidationArtifact[] = [];
  const issues: ArenaContentValidationIssue[] = [];
  for (const stage of content.stages) {
    const source = stage.courseProjection.navigation.source;
    let artifact: NavigationRecastBuildArtifact;
    try {
      artifact = await prepareRecastNavigationArtifact(
        source,
        stage.courseProjection.navigation.layout
      );
    } catch (error) {
      issues.push(
        issue(
          "arena.validation.navigation_bake",
          stage,
          source.id,
          error instanceof Error ? error.message : String(error)
        )
      );
      continue;
    }

    const backend = createRecastNavigationBackend({
      id: `arena.validator.${stage.definition.id}`,
      source,
      layout: stage.courseProjection.navigation.layout,
      artifact
    });
    let checkedRoutes = 0;
    try {
      const profile = navigationProfile(stage);
      for (const route of requiredNavigationRoutes(stage)) {
        const requestId = `arena.validation.${stage.definition.id}.${checkedRoutes}`;
        backend.submitPath({
          requestId,
          profile,
          start: route.start,
          goal: route.goal,
          routeKind: "path"
        });
        const result = backend.pollPath(requestId);
        checkedRoutes += 1;
        if (result.status !== "complete") {
          issues.push(
            issue(
              "arena.validation.navigation_route",
              stage,
              route.sourceId,
              `required route failed with ${result.status === "failed" ? result.reason : result.status}`
            )
          );
        }
        backend.releasePath(requestId);
      }
    } finally {
      backend.dispose();
    }
    artifacts.push({
      stageId: stage.definition.id,
      sourceId: artifact.sourceId,
      ...(artifact.sourceVersion === undefined ? {} : { sourceVersion: artifact.sourceVersion }),
      polygonCount: artifact.polygonCount,
      debugTriangleCount: artifact.debugMesh.indices.length / 3,
      byteLength: artifact.data.byteLength,
      checkedRoutes,
      artifact
    });
  }
  return { valid: issues.length === 0, artifacts, issues: stableIssues(issues) };
}

function validateStage(
  stage: Readonly<CompiledArenaStage>,
  entrants: number,
  issues: ArenaContentValidationIssue[]
): void {
  const { course, courseProjection, spawnSet } = stage;
  const participantSpawns = spawnSet.points.filter(({ kind }) => kind === "participant");
  const itemSpawns = spawnSet.points.filter(({ kind }) => kind === "item");
  if (participantSpawns.length < entrants) {
    issues.push(
      issue(
        "arena.validation.spawn_capacity",
        stage,
        spawnSet.id,
        `provides ${participantSpawns.length} participant spawns for ${entrants} entrants`
      )
    );
  }
  for (const spawn of participantSpawns) {
    if (!insideBounds(spawn.position, course.bounds)) {
      issues.push(
        issue(
          "arena.validation.spawn_bounds",
          stage,
          spawn.id,
          "participant spawn is out of bounds"
        )
      );
    }
    const blocker = findClearanceBlocker(
      spawn.position,
      course.navigation.agentRadius,
      course.navigation.agentHeight,
      course.staticLayout
    );
    if (blocker !== undefined) {
      issues.push(
        issue(
          "arena.validation.spawn_clearance",
          stage,
          spawn.id,
          `participant capsule overlaps ${blocker}`
        )
      );
    }
  }

  const itemPoolIds = new Set(stage.items.map(({ id }) => id));
  for (const spawn of itemSpawns) {
    if (!insideBounds(spawn.position, course.bounds)) {
      issues.push(
        issue("arena.validation.item_bounds", stage, spawn.id, "item spawn is out of bounds")
      );
    }
    if (spawn.definition === undefined || !itemPoolIds.has(spawn.definition.id)) {
      issues.push(
        issue(
          "arena.validation.item_pool",
          stage,
          spawn.id,
          "item spawn does not reference an item in the stage pool"
        )
      );
    }
    const blocker = findClearanceBlocker(spawn.position, 0.55, 1.1, course.staticLayout);
    if (blocker !== undefined) {
      issues.push(
        issue("arena.validation.item_clearance", stage, spawn.id, `item spawn overlaps ${blocker}`)
      );
    }
  }

  validateVolumes(stage, issues);
  validateHazards(stage, issues);
  validateProjection(stage, issues);
  validateNavigationSource(stage, issues);
  validateConvergence(stage, issues);
  if (
    courseProjection.layoutSignature.length === 0 ||
    courseProjection.scheduleSignature.length === 0
  ) {
    issues.push(
      issue(
        "arena.validation.projection",
        stage,
        course.id,
        "compiled layout and schedule signatures must be non-empty"
      )
    );
  }
}

function validateVolumes(
  stage: Readonly<CompiledArenaStage>,
  issues: ArenaContentValidationIssue[]
): void {
  const { course, definition } = stage;
  const killVolumes = course.volumes.filter(({ kind }) => kind === "kill");
  if (killVolumes.length !== 1) {
    issues.push(
      issue(
        "arena.validation.kill_volume",
        stage,
        course.id,
        `requires exactly one kill volume, received ${killVolumes.length}`
      )
    );
  } else {
    const killTop = killVolumes[0]!.position.y + killVolumes[0]!.size.height / 2;
    const lowestSurface = Math.min(
      ...course.staticLayout.map(({ position, size }) => position.y + size.height / 2)
    );
    if (killTop >= lowestSurface) {
      issues.push(
        issue(
          "arena.validation.kill_volume",
          stage,
          killVolumes[0]!.id,
          "kill volume reaches a walkable surface"
        )
      );
    }
  }

  if (definition.kind === "qualifier") {
    const route = course.volumes
      .filter(({ kind }) => kind === "checkpoint" || kind === "finish")
      .sort((left, right) => (left.routeOrder ?? 0) - (right.routeOrder ?? 0));
    const orders = route.map(({ routeOrder }) => routeOrder);
    const expected = Array.from({ length: route.length }, (_, index) => index + 1);
    if (
      route.length < 2 ||
      route.at(-1)?.kind !== "finish" ||
      JSON.stringify(orders) !== JSON.stringify(expected)
    ) {
      issues.push(
        issue(
          "arena.validation.route",
          stage,
          course.id,
          "qualifier requires contiguous checkpoint orders ending in finish"
        )
      );
    }
  } else {
    const safeZones = course.volumes.filter(({ kind }) => kind === "safe-zone");
    if (safeZones.length !== 1) {
      issues.push(
        issue(
          "arena.validation.safe_zone",
          stage,
          course.id,
          `requires exactly one safe zone, received ${safeZones.length}`
        )
      );
    }
    if (definition.kind === "brawl" && !course.volumes.some(({ kind }) => kind === "objective")) {
      issues.push(
        issue("arena.validation.route", stage, course.id, "brawl requires an objective volume")
      );
    }
  }
}

function validateHazards(
  stage: Readonly<CompiledArenaStage>,
  issues: ArenaContentValidationIssue[]
): void {
  for (const schedule of stage.courseProjection.hazardSchedules) {
    if (
      schedule.periodTicks <= 0 ||
      schedule.activeTicks <= 0 ||
      schedule.activeTicks > schedule.periodTicks ||
      schedule.phaseTicks < 0 ||
      schedule.phaseTicks >= schedule.periodTicks ||
      schedule.activationProgress < 0 ||
      schedule.activationProgress > 1
    ) {
      issues.push(
        issue(
          "arena.validation.hazard_schedule",
          stage,
          schedule.placementId,
          "hazard schedule has an invalid phase or active window"
        )
      );
    }
    if (schedule.kind === "moving-platform" || schedule.kind === "crumble-floor") {
      const supportTop = schedule.origin.y + schedule.size.height / 2;
      const overlappingSupport = stage.course.staticLayout.find((placement) => {
        if (Math.abs(placement.position.y + placement.size.height / 2 - supportTop) > 0.55) {
          return false;
        }
        return (
          overlapLength(
            schedule.origin.x - schedule.size.width / 2,
            schedule.origin.x + schedule.size.width / 2,
            placement.position.x - placement.size.width / 2,
            placement.position.x + placement.size.width / 2
          ) >=
            schedule.size.width * 0.85 &&
          overlapLength(
            (schedule.origin.z ?? 0) - schedule.size.depth / 2,
            (schedule.origin.z ?? 0) + schedule.size.depth / 2,
            (placement.position.z ?? 0) - placement.size.depth / 2,
            (placement.position.z ?? 0) + placement.size.depth / 2
          ) >=
            schedule.size.depth * 0.85
        );
      });
      if (overlappingSupport !== undefined) {
        issues.push(
          issue(
            "arena.validation.hazard_support",
            stage,
            schedule.placementId,
            `${schedule.kind} is gameplay-inert because ${overlappingSupport.id} fully supports it`
          )
        );
      }
    }
    const movementAxis = schedule.kind === "crumble-floor" ? "y" : schedule.axis;
    const axisExtent =
      (movementAxis === "x"
        ? schedule.size.width
        : movementAxis === "y"
          ? schedule.size.height
          : schedule.size.depth) / 2;
    const origin = schedule.origin[movementAxis] ?? 0;
    const min = stage.course.bounds.min[movementAxis] ?? 0;
    const max = stage.course.bounds.max[movementAxis] ?? 0;
    const travelRange =
      schedule.kind === "moving-platform"
        ? { min: -Math.abs(schedule.travel), max: Math.abs(schedule.travel) }
        : schedule.kind === "crumble-floor"
          ? { min: -Math.abs(schedule.travel), max: 0 }
          : schedule.kind === "piston" ||
              schedule.kind === "crusher" ||
              schedule.kind === "extending-wall"
            ? { min: Math.min(0, schedule.travel), max: Math.max(0, schedule.travel) }
            : { min: 0, max: 0 };
    if (
      origin - axisExtent + travelRange.min < min ||
      origin + axisExtent + travelRange.max > max
    ) {
      issues.push(
        issue(
          "arena.validation.hazard_bounds",
          stage,
          schedule.placementId,
          "hazard travel leaves the authored course bounds"
        )
      );
    }
  }
}

function overlapLength(
  leftMin: number,
  leftMax: number,
  rightMin: number,
  rightMax: number
): number {
  return Math.max(0, Math.min(leftMax, rightMax) - Math.max(leftMin, rightMin));
}

function validateProjection(
  stage: Readonly<CompiledArenaStage>,
  issues: ArenaContentValidationIssue[]
): void {
  const expectedMembers = [...stage.course.hazards, ...stage.course.props]
    .map(({ id }) => id)
    .sort();
  const actualMembers = stage.courseProjection.memberDefinitions.map(({ id }) => id).sort();
  if (JSON.stringify(expectedMembers) !== JSON.stringify(actualMembers)) {
    issues.push(
      issue(
        "arena.validation.projection",
        stage,
        stage.course.id,
        "compiled prediction members do not match authored hazards and props"
      )
    );
  }
  const expectedPresentationIds = new Set(
    [
      ...stage.course.staticLayout,
      ...stage.course.hazards,
      ...stage.course.props,
      ...stage.course.volumes
    ].map(({ id }) => id)
  );
  for (const placement of stage.courseProjection.presentation.placements) {
    expectedPresentationIds.delete(placement.sourceId);
  }
  if (expectedPresentationIds.size > 0) {
    issues.push(
      issue(
        "arena.validation.projection",
        stage,
        stage.course.id,
        `presentation projection is missing ${[...expectedPresentationIds].sort().join(", ")}`
      )
    );
  }
}

function validateNavigationSource(
  stage: Readonly<CompiledArenaStage>,
  issues: ArenaContentValidationIssue[]
): void {
  const source = stage.courseProjection.navigation.source;
  if (source.vertices.length < 3 || source.triangles.length === 0) {
    issues.push(
      issue(
        "arena.validation.navigation_source",
        stage,
        source.id,
        "navigation source does not contain walkable triangles"
      )
    );
    return;
  }
  for (const triangle of source.triangles) {
    if (
      triangle.a < 0 ||
      triangle.b < 0 ||
      triangle.c < 0 ||
      triangle.a >= source.vertices.length ||
      triangle.b >= source.vertices.length ||
      triangle.c >= source.vertices.length
    ) {
      issues.push(
        issue(
          "arena.validation.navigation_source",
          stage,
          source.id,
          "navigation triangle references a missing vertex"
        )
      );
      break;
    }
  }
  const taggedSources = new Set(
    source.triangles.flatMap(({ tags }) =>
      (tags ?? []).filter((tag) => tag.startsWith("source:")).map((tag) => tag.slice(7))
    )
  );
  for (const placement of stage.course.staticLayout) {
    if (placement.navigationArea !== undefined && !taggedSources.has(placement.id)) {
      issues.push(
        issue(
          "arena.validation.navigation_source",
          stage,
          placement.id,
          "walkable placement is missing from the navigation projection"
        )
      );
    }
  }
}

function validateConvergence(
  stage: Readonly<CompiledArenaStage>,
  issues: ArenaContentValidationIssue[]
): void {
  if (stage.definition.kind === "qualifier") return;
  const safeZone = stage.course.volumes.find(({ kind }) => kind === "safe-zone");
  const shrinkingHazard = stage.hazards.find(({ kind }) => kind === "shrinking-zone");
  if (safeZone === undefined || stage.definition.durationTicks < 120) {
    issues.push(
      issue(
        "arena.validation.convergence",
        stage,
        stage.course.id,
        "elimination stage requires a safe zone and at least two seconds of authority time"
      )
    );
    return;
  }
  const minimumDiameter = Math.min(safeZone.size.width, safeZone.size.depth) * 0.2;
  if (minimumDiameter < stage.course.navigation.agentRadius * 2) {
    issues.push(
      issue(
        "arena.validation.convergence",
        stage,
        safeZone.id,
        "minimum safe zone cannot retain one character capsule"
      )
    );
  }
  if (stage.definition.kind === "final" && shrinkingHazard === undefined) {
    issues.push(
      issue(
        "arena.validation.convergence",
        stage,
        stage.course.id,
        "final requires a shrinking-zone hazard"
      )
    );
  }
}

function requiredNavigationRoutes(stage: Readonly<CompiledArenaStage>) {
  const targets = navigationTargets(stage);
  return stage.courseProjection.participantSpawns.flatMap((spawn) => {
    let start = toNavigationPoint(spawn.position);
    return targets.map((target) => {
      const route = { sourceId: `${spawn.id}->${target.id}`, start, goal: target.point };
      start = target.point;
      return route;
    });
  });
}

function navigationTargets(stage: Readonly<CompiledArenaStage>) {
  const volumes = stage.course.volumes;
  const required =
    stage.definition.kind === "qualifier"
      ? volumes
          .filter(({ kind }) => kind === "checkpoint" || kind === "finish")
          .sort((left, right) => (left.routeOrder ?? 0) - (right.routeOrder ?? 0))
      : [
          volumes.find(({ kind }) => kind === "objective") ??
            volumes.find(({ kind }) => kind === "safe-zone")
        ].filter((volume): volume is ArenaGameplayVolumeDefinition => volume !== undefined);
  return required.map((volume) => ({ id: volume.id, point: toNavigationPoint(volume.position) }));
}

function navigationProfile(stage: Readonly<CompiledArenaStage>): NavigationAgentProfileDefinition {
  return {
    id: `arena.validator.${stage.definition.id}`,
    radius: stage.course.navigation.agentRadius,
    height: stage.course.navigation.agentHeight,
    maxSlope: (stage.course.navigation.maxSlopeDegrees * Math.PI) / 180
  };
}

function toNavigationPoint(point: PhysicsVector): NavigationPoint {
  return { x: point.x, y: point.z ?? 0, z: point.y };
}

function findClearanceBlocker(
  position: PhysicsVector,
  radius: number,
  height: number,
  placements: readonly ArenaStaticPlacementDefinition[]
): string | undefined {
  const capsule = {
    minX: position.x - radius,
    maxX: position.x + radius,
    minY: position.y - height / 2,
    maxY: position.y + height / 2,
    minZ: (position.z ?? 0) - radius,
    maxZ: (position.z ?? 0) + radius
  };
  return placements.find((placement) =>
    overlaps(capsule, boxBounds(placement.position, placement.size))
  )?.id;
}

function boxBounds(position: PhysicsVector, size: ArenaBoxSize) {
  return {
    minX: position.x - size.width / 2,
    maxX: position.x + size.width / 2,
    minY: position.y - size.height / 2,
    maxY: position.y + size.height / 2,
    minZ: (position.z ?? 0) - size.depth / 2,
    maxZ: (position.z ?? 0) + size.depth / 2
  };
}

function overlaps(
  left: ReturnType<typeof boxBounds>,
  right: ReturnType<typeof boxBounds>
): boolean {
  const epsilon = 0.001;
  return (
    left.maxX > right.minX + epsilon &&
    left.minX < right.maxX - epsilon &&
    left.maxY > right.minY + epsilon &&
    left.minY < right.maxY - epsilon &&
    left.maxZ > right.minZ + epsilon &&
    left.minZ < right.maxZ - epsilon
  );
}

function insideBounds(point: PhysicsVector, bounds: ArenaBoundsDefinition): boolean {
  return (
    point.x >= bounds.min.x &&
    point.x <= bounds.max.x &&
    point.y >= bounds.min.y &&
    point.y <= bounds.max.y &&
    (point.z ?? 0) >= (bounds.min.z ?? 0) &&
    (point.z ?? 0) <= (bounds.max.z ?? 0)
  );
}

function issue(
  code: ArenaContentValidationIssue["code"],
  stage: Readonly<CompiledArenaStage>,
  sourceId: string,
  message: string
): ArenaContentValidationIssue {
  return {
    code,
    severity: "error",
    stageId: stage.definition.id,
    sourceId,
    sourcePath: `stage:${stage.definition.id}/course:${stage.course.id}/source:${sourceId}`,
    message
  };
}

function stableIssues(issues: ArenaContentValidationIssue[]): ArenaContentValidationIssue[] {
  return issues.sort((left, right) =>
    `${left.stageId}:${left.code}:${left.sourceId}`.localeCompare(
      `${right.stageId}:${right.code}:${right.sourceId}`
    )
  );
}
