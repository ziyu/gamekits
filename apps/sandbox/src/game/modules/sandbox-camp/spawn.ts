import type { GameInstallContext } from "@gamekits/game-runtime";
import type { EntityId } from "@gamekits/world";
import {
  BuildingState,
  LinkState,
  ObjectiveState,
  Position,
  ProductionState,
  RenderObjectPresentation,
  ResourceStorage,
  SceneObject,
  Selectable,
  ThreatState,
  Velocity,
  WorkAssignment
} from "../../components";
import type { SandboxSceneObjectDefinition } from "../../sandbox-data";
import {
  BOOTSTRAP_OBJECTIVE_PHASE_ID,
  CAMPFIRE_OBJECT_ID,
  RESOURCE_LOAD_PER_TRIP
} from "./constants";
import { midpoint } from "./math";
import { createPresentationData, createRenderableDefinition } from "./render-presentation";
import type { SandboxCampModuleOptions, SandboxCampRuntimeState } from "./types";

export function spawnSandboxCamp(
  ctx: GameInstallContext,
  options: SandboxCampModuleOptions
): SandboxCampRuntimeState {
  const entitiesByObjectId = new Map<string, EntityId>();
  const resourceObjectIds = options.sceneObjects
    .filter((object) => object.role === "resource-node")
    .map((object) => object.id);

  let order = 0;
  for (const object of options.sceneObjects) {
    const entity = spawnSceneObject(ctx, options, object, order);
    entitiesByObjectId.set(object.id, entity);
    order += 1;
  }

  for (let i = 0; i < options.layout.workerCount; i += 1) {
    const entity = spawnWorker(
      ctx,
      options,
      i,
      order + i,
      resourceObjectIds[i % resourceObjectIds.length]
    );
    entitiesByObjectId.set(`scene.sandbox.worker.${i}`, entity);
  }

  spawnLinks(ctx, options, entitiesByObjectId);

  ctx.eventBus.emit(
    "sandbox.camp_spawned",
    { layoutId: options.layout.id, objects: entitiesByObjectId.size },
    "sandbox.camp"
  );

  return { entitiesByObjectId, resourceObjectIds };
}

function spawnLinks(
  ctx: GameInstallContext,
  options: SandboxCampModuleOptions,
  entitiesByObjectId: Map<string, EntityId>
): void {
  for (const link of options.layout.links) {
    const from = entitiesByObjectId.get(link.fromObjectId);
    const to = entitiesByObjectId.get(link.toObjectId);
    if (from === undefined || to === undefined) {
      continue;
    }

    const entity = ctx.world.spawn();
    const fromPosition = ctx.world.get(from, Position);
    const toPosition = ctx.world.get(to, Position);
    ctx.world.add(entity, Position, midpoint(fromPosition, toPosition));
    ctx.world.add(entity, SceneObject, {
      objectId: link.id,
      label: link.id.replace("path.", "").replaceAll("_", " "),
      role: "road",
      dataType: "sandbox.sceneLayout",
      dataId: options.layout.id
    });
    ctx.world.add(entity, LinkState, {
      fromObjectId: link.fromObjectId,
      toObjectId: link.toObjectId,
      status: link.corrupted ? "danger" : "idle"
    });
    ctx.world.add(entity, RenderObjectPresentation, {
      definition: createRenderableDefinition(options.renderObject("render.sandbox.road"))
    });
  }
}

function spawnSceneObject(
  ctx: GameInstallContext,
  options: SandboxCampModuleOptions,
  object: SandboxSceneObjectDefinition,
  order: number
): EntityId {
  const entity = ctx.world.spawn();
  const actorId = object.gasActorDefinitionId
    ? `gas.actor.sandbox.${object.id.replace("scene.sandbox.", "").replaceAll("_", ".")}`
    : undefined;

  ctx.world.add(entity, Position, { x: object.x, y: object.y });
  ctx.world.add(entity, SceneObject, {
    objectId: object.id,
    label: object.label,
    role: object.role,
    dataType: "sandbox.sceneObject",
    dataId: object.id,
    actorId
  });
  ctx.world.add(entity, Selectable, { order, selected: order === 0 });
  ctx.world.add(
    entity,
    RenderObjectPresentation,
    createPresentationData(
      createRenderableDefinition(options.renderObject(object.renderObjectId)),
      object.renderRigId ? options.renderRig(object.renderRigId).nodeAnimations : undefined
    )
  );

  if (object.capacity !== undefined) {
    ctx.world.add(entity, ResourceStorage, {
      capacity: object.capacity,
      resource: object.role === "resource-node" ? 18 : 0
    });
  }
  if (object.buildingDefinitionId) {
    const building = options.buildingDefinition(object.buildingDefinitionId);
    ctx.world.add(entity, BuildingState, {
      buildingId: building.id,
      zone: building.zone,
      priority: building.priority,
      health: building.initialHealth,
      heat: building.baseHeat,
      throughput: building.throughput,
      mode: "normal"
    });
  }
  if (object.productionRate !== undefined) {
    ctx.world.add(entity, ProductionState, {
      ratePerSecond: object.productionRate,
      recipeId: object.recipeId,
      status: "producing"
    });
  }
  if (object.role === "campfire") {
    const objective = options.objectivePhase(BOOTSTRAP_OBJECTIVE_PHASE_ID);
    ctx.world.add(entity, ObjectiveState, {
      objectiveId: "objective.sandbox.tiny_camp",
      phaseId: objective.id,
      progressResources: 0,
      targetResources: objective.targetResources,
      unlocked: []
    });
  }
  if (object.role === "monster") {
    ctx.world.add(entity, ThreatState, {
      intensity: 0.18,
      nextStrikeTick: 120,
      status: "charging"
    });
  }
  if (actorId && object.gasActorDefinitionId) {
    options.gasRuntime?.()?.createActor({
      actorId,
      definitionId: object.gasActorDefinitionId,
      entityId: entity
    });
  }
  ctx.eventBus.emit(
    "sandbox.entity_spawned",
    { entity, objectId: object.id, role: object.role },
    "sandbox.camp"
  );
  return entity;
}

function spawnWorker(
  ctx: GameInstallContext,
  options: SandboxCampModuleOptions,
  index: number,
  order: number,
  firstTargetObjectId: string | undefined
): EntityId {
  const entity = ctx.world.spawn();
  const actorId = `gas.actor.sandbox.worker.${index}`;
  const x = 42 + (index % 3) * 6;
  const y = 58 + Math.floor(index / 3) * 7;

  ctx.world.add(entity, Position, { x, y });
  ctx.world.add(entity, Velocity, { x: 0, y: 0 });
  ctx.world.add(entity, SceneObject, {
    objectId: `scene.sandbox.worker.${index}`,
    label: `Worker ${index + 1}`,
    role: "worker",
    dataType: "gas.actor",
    dataId: "gas.actor.sandbox.worker",
    actorId
  });
  ctx.world.add(entity, Selectable, { order, selected: false });
  ctx.world.add(entity, ResourceStorage, { resource: 0, capacity: RESOURCE_LOAD_PER_TRIP });
  ctx.world.add(entity, WorkAssignment, {
    task: "gather",
    status: "routing",
    sourceObjectId: CAMPFIRE_OBJECT_ID,
    targetObjectId: firstTargetObjectId,
    cargo: 0,
    battery: 100,
    fatigue: 0,
    progress: 0,
    routeProgress: 0
  });
  ctx.world.add(entity, RenderObjectPresentation, {
    definition: createRenderableDefinition(options.renderObject("render.sandbox.worker")),
    nodeAnimations: options.renderRig("renderRig.sandbox.worker").nodeAnimations
  });
  options.gasRuntime?.()?.createActor({
    actorId,
    definitionId: "gas.actor.sandbox.worker",
    entityId: entity,
    abilities: [
      "gas.ability.sandbox.spark_strike",
      "gas.ability.sandbox.overcharge",
      "gas.ability.sandbox.field_repair"
    ]
  });
  ctx.eventBus.emit(
    "sandbox.entity_spawned",
    { entity, objectId: `scene.sandbox.worker.${index}`, role: "worker" },
    "sandbox.camp"
  );
  return entity;
}
