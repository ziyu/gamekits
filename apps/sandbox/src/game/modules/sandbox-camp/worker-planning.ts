import type { GameInstallContext } from "@gamekits/game-runtime";
import type { EntityId } from "@gamekits/world";
import {
  BuildingState,
  ResourceStorage,
  SceneObject,
  ThreatState,
  WorkAssignment
} from "../../components";
import { CAMPFIRE_OBJECT_ID } from "./constants";
import { clamp } from "./math";

export function assignNextWorkerWork(
  world: GameInstallContext["world"],
  entitiesByObjectId: Map<string, EntityId>,
  resourceObjectIds: string[],
  previous: ReturnType<typeof WorkAssignment.create>,
  workerObjectId?: string | undefined
): ReturnType<typeof WorkAssignment.create> {
  const priorityLane = readWorkerIndex(workerObjectId) % 5;
  const repairTarget = chooseRepairTarget(world, entitiesByObjectId);
  if (repairTarget && priorityLane <= 1) {
    return {
      ...previous,
      task: "repair",
      status: "routing",
      sourceObjectId: previous.targetObjectId,
      targetObjectId: repairTarget,
      cargo: 0,
      progress: 0,
      routeProgress: 0
    };
  }

  const defendTarget = chooseDefendTarget(world, entitiesByObjectId);
  if (defendTarget && priorityLane >= 3) {
    return {
      ...previous,
      task: "defend",
      status: "routing",
      sourceObjectId: previous.targetObjectId,
      targetObjectId: defendTarget,
      cargo: 0,
      progress: 0,
      routeProgress: 0
    };
  }

  if (previous.battery < 22 || previous.fatigue > 72) {
    return {
      ...previous,
      task: "build",
      status: "routing",
      sourceObjectId: previous.targetObjectId,
      targetObjectId: chooseBuildTarget(world, entitiesByObjectId),
      cargo: 0,
      battery: clamp(previous.battery + 18, 0, 100),
      fatigue: clamp(previous.fatigue - 20, 0, 100),
      progress: 0,
      routeProgress: 0
    };
  }

  return {
    ...previous,
    task: "gather",
    status: "routing",
    sourceObjectId: previous.targetObjectId,
    targetObjectId: chooseResourceTarget(
      world,
      entitiesByObjectId,
      resourceObjectIds,
      workerObjectId,
      previous.targetObjectId
    ),
    cargo: 0,
    progress: 0,
    routeProgress: 0
  };
}

export function chooseDeliveryTarget(
  world: GameInstallContext["world"],
  entitiesByObjectId: Map<string, EntityId>,
  campfireObjectId: string
): string {
  let bestId = campfireObjectId;
  let bestScore = 0;
  for (const [objectId, entity] of entitiesByObjectId) {
    const object = world.get(entity, SceneObject);
    const storage = world.get(entity, ResourceStorage);
    const building = world.get(entity, BuildingState);
    if (
      !object ||
      !storage ||
      !building ||
      !["campfire", "storage", "workshop"].includes(object.role)
    ) {
      continue;
    }
    const need = Math.max(0, storage.capacity - storage.resource);
    const score = need * building.priority * (object.role === "campfire" ? 1.25 : 0.8);
    if (score > bestScore) {
      bestScore = score;
      bestId = objectId;
    }
  }
  return bestId;
}

export function chooseMonsterTarget(
  tick: number,
  entitiesByObjectId: Map<string, EntityId>
): string {
  const targets = ["scene.sandbox.watchtower", "scene.sandbox.storage", CAMPFIRE_OBJECT_ID].filter(
    (id) => entitiesByObjectId.has(id)
  );
  return targets[((tick / 150) | 0) % targets.length] ?? CAMPFIRE_OBJECT_ID;
}

function chooseResourceTarget(
  world: GameInstallContext["world"],
  entitiesByObjectId: Map<string, EntityId>,
  resourceObjectIds: string[],
  workerObjectId: string | undefined,
  previousTargetObjectId: string | undefined
): string {
  let bestId = resourceObjectIds[0] ?? "scene.sandbox.forest";
  let bestResource = Number.NEGATIVE_INFINITY;
  const preferredIndex = readWorkerIndex(workerObjectId) % Math.max(1, resourceObjectIds.length);
  for (let index = 0; index < resourceObjectIds.length; index += 1) {
    const resourceId = resourceObjectIds[index]!;
    const entity = entitiesByObjectId.get(resourceId);
    const storage = entity === undefined ? undefined : world.get(entity, ResourceStorage);
    const resource = storage?.resource ?? 0;
    const laneAffinity =
      index === preferredIndex
        ? 10
        : index === nextLane(preferredIndex, resourceObjectIds.length)
          ? 4
          : 0;
    const repeatPenalty = resourceId === previousTargetObjectId ? 7 : 0;
    const score = resource + laneAffinity - repeatPenalty;
    if (score > bestResource) {
      bestResource = score;
      bestId = resourceId;
    }
  }
  return bestId;
}

function readWorkerIndex(workerObjectId: string | undefined): number {
  const match = workerObjectId?.match(/\.(\d+)$/u);
  return match ? Number(match[1]) : 0;
}

function nextLane(index: number, laneCount: number): number {
  if (laneCount <= 0) {
    return 0;
  }
  return (index + 1) % laneCount;
}

function chooseRepairTarget(
  world: GameInstallContext["world"],
  entitiesByObjectId: Map<string, EntityId>
): string | undefined {
  let best: { objectId: string; urgency: number } | undefined;
  for (const [objectId, entity] of entitiesByObjectId) {
    const building = world.get(entity, BuildingState);
    if (!building || building.zone === "wilds") {
      continue;
    }
    const urgency = (100 - building.health) * building.priority + building.heat * 0.25;
    if (urgency > 36 && (!best || urgency > best.urgency)) {
      best = { objectId, urgency };
    }
  }
  return best?.objectId;
}

function chooseDefendTarget(
  world: GameInstallContext["world"],
  entitiesByObjectId: Map<string, EntityId>
): string | undefined {
  for (const [objectId, entity] of entitiesByObjectId) {
    const threat = world.get(entity, ThreatState);
    if (threat && threat.intensity > 0.42) {
      return objectId;
    }
  }
  return undefined;
}

function chooseBuildTarget(
  world: GameInstallContext["world"],
  entitiesByObjectId: Map<string, EntityId>
): string {
  let bestId = "scene.sandbox.workshop";
  let bestPriority = Number.NEGATIVE_INFINITY;
  for (const [objectId, entity] of entitiesByObjectId) {
    const object = world.get(entity, SceneObject);
    const building = world.get(entity, BuildingState);
    if (!object || !building || (object.role !== "workshop" && object.role !== "tower")) {
      continue;
    }
    if (building.priority > bestPriority) {
      bestPriority = building.priority;
      bestId = objectId;
    }
  }
  return bestId;
}
