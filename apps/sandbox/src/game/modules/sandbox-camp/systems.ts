import type { GameInstallContext } from "@gamekits/game-runtime";
import {
  BuildingState,
  LinkState,
  ObjectiveState,
  Position,
  ProductionState,
  ResourceStorage,
  SceneObject,
  ThreatState,
  Velocity,
  WorkAssignment
} from "../../components";
import { CAMPFIRE_OBJECT_ID, RESOURCE_LOAD_PER_TRIP, WORKER_SPEED } from "./constants";
import { clamp, distanceBetween, moveToward } from "./math";
import type { SandboxCampModuleOptions, SandboxCampRuntimeState } from "./types";
import { assignNextWorkerWork, chooseDeliveryTarget, chooseMonsterTarget } from "./worker-planning";

export function registerSandboxCampSystems(
  ctx: GameInstallContext,
  options: SandboxCampModuleOptions,
  state: SandboxCampRuntimeState
): void {
  registerResourceSystem(ctx);
  registerWorkshopSystem(ctx);
  registerWorkerSystem(ctx, state);
  registerMonsterPressureSystem(ctx, options, state);
  registerRoadSystem(ctx, state);
  registerObjectiveSystem(ctx, state);
}

function registerResourceSystem(ctx: GameInstallContext): void {
  ctx.systems.register({
    id: "sandbox.camp_resource_system",
    update({ world, delta, tick }) {
      const seconds = delta / 1000;
      for (const entity of world.query([ProductionState, ResourceStorage, SceneObject])) {
        const production = world.get(entity, ProductionState);
        const storage = world.get(entity, ResourceStorage);
        const object = world.get(entity, SceneObject);
        const building = world.get(entity, BuildingState);
        if (!production || !storage || !object || production.ratePerSecond <= 0) {
          continue;
        }

        const healthRatio = building ? Math.max(0.35, building.health / 100) : 1;
        const heatPenalty = building ? Math.max(0.55, 1 - building.heat / 180) : 1;
        const effectiveRate =
          production.ratePerSecond * (building?.throughput ?? 1) * healthRatio * heatPenalty;
        const nextResource = Math.min(storage.capacity, storage.resource + effectiveRate * seconds);

        world.set(entity, ResourceStorage, {
          ...storage,
          resource: nextResource
        });

        if (building) {
          world.set(entity, BuildingState, {
            ...building,
            heat: clamp(
              building.heat +
                (nextResource >= storage.capacity ? -5 : effectiveRate * 0.18) * seconds,
              0,
              100
            ),
            health: clamp(building.health - building.heat * 0.002 * seconds, 45, 100)
          });
        }

        world.set(entity, ProductionState, {
          ...production,
          status: nextResource >= storage.capacity ? "blocked" : "producing"
        });

        if (tick % 90 === 0) {
          ctx.eventBus.emit(
            "sandbox.resource_produced",
            { objectId: object.objectId, resource: Math.round(nextResource) },
            "sandbox.camp.resource"
          );
        }
      }
    }
  });
}

function registerWorkshopSystem(ctx: GameInstallContext): void {
  ctx.systems.register({
    id: "sandbox.camp_workshop_system",
    update({ world, delta, tick }) {
      const seconds = delta / 1000;
      for (const entity of world.query([SceneObject, ResourceStorage, BuildingState])) {
        const object = world.get(entity, SceneObject);
        const storage = world.get(entity, ResourceStorage);
        const building = world.get(entity, BuildingState);
        if (!object || !storage || !building) {
          continue;
        }

        if (object.role === "workshop" && storage.resource >= 18) {
          const crafted = Math.min(1.4 * seconds, 4 - storage.materials);
          if (crafted > 0) {
            world.set(entity, ResourceStorage, {
              ...storage,
              resource: storage.resource - crafted * 9,
              materials: storage.materials + crafted
            });
          }
        }

        if (tick % 180 === 0 && building.heat > 60) {
          ctx.eventBus.emit(
            "sandbox.building_heat_warning",
            {
              objectId: object.objectId,
              heat: Math.round(building.heat),
              health: Math.round(building.health)
            },
            "sandbox.camp.building"
          );
        }
      }
    }
  });
}

function registerWorkerSystem(ctx: GameInstallContext, state: SandboxCampRuntimeState): void {
  ctx.systems.register({
    id: "sandbox.camp_worker_system",
    update({ world, delta, tick }) {
      const seconds = delta / 1000;
      const campfireEntity = state.entitiesByObjectId.get(CAMPFIRE_OBJECT_ID);
      if (campfireEntity === undefined) {
        return;
      }

      for (const entity of world.query([SceneObject, Position, WorkAssignment])) {
        const object = world.get(entity, SceneObject);
        const position = world.get(entity, Position);
        const work = world.get(entity, WorkAssignment);
        const storage = world.get(entity, ResourceStorage);
        if (!object || object.role !== "worker" || !position || !work || !storage) {
          continue;
        }

        const activeWork =
          work.task === "idle" || !work.targetObjectId
            ? assignNextWorkerWork(
                world,
                state.entitiesByObjectId,
                state.resourceObjectIds,
                work,
                object.objectId
              )
            : work;
        if (activeWork !== work) {
          world.set(entity, WorkAssignment, activeWork);
        }

        const targetObjectId = activeWork.targetObjectId ?? CAMPFIRE_OBJECT_ID;
        const targetEntity = state.entitiesByObjectId.get(targetObjectId);
        const targetPosition =
          targetEntity === undefined ? undefined : world.get(targetEntity, Position);
        if (!targetPosition) {
          continue;
        }

        const fatiguePenalty = Math.max(0.55, 1 - activeWork.fatigue / 160);
        const staminaPenalty = Math.max(0.5, activeWork.battery / 100);
        const nextPosition = moveToward(
          position,
          targetPosition,
          WORKER_SPEED * fatiguePenalty * staminaPenalty * seconds
        );
        world.set(entity, Velocity, {
          x: nextPosition.x - position.x,
          y: nextPosition.y - position.y
        });
        world.set(entity, Position, nextPosition);

        const distance = distanceBetween(nextPosition, targetPosition);
        if (distance > 1.4) {
          world.set(entity, WorkAssignment, {
            ...activeWork,
            status: "routing",
            targetObjectId,
            progress: Math.max(0, 1 - distance / 70),
            routeProgress: Math.max(0, 1 - distance / 84),
            battery: clamp(activeWork.battery - seconds * 1.5, 0, 100),
            fatigue: clamp(activeWork.fatigue + seconds * 0.75, 0, 100)
          });
          continue;
        }

        applyArrivedWorkerTask(ctx, state, entity, object, activeWork, storage, targetObjectId);
      }

      if (tick % 60 === 0) {
        ctx.eventBus.emit("sandbox.motion_tick", { tick }, "sandbox.camp");
        ctx.eventBus.emit("sandbox.camp_tick", { tick }, "sandbox.camp");
      }
    }
  });
}

function applyArrivedWorkerTask(
  ctx: GameInstallContext,
  state: SandboxCampRuntimeState,
  entity: ReturnType<GameInstallContext["world"]["spawn"]>,
  object: ReturnType<typeof SceneObject.create>,
  activeWork: ReturnType<typeof WorkAssignment.create>,
  storage: ReturnType<typeof ResourceStorage.create>,
  targetObjectId: string
): void {
  const targetEntity = state.entitiesByObjectId.get(targetObjectId);
  if (activeWork.task === "gather") {
    const targetStorage =
      targetEntity === undefined ? undefined : ctx.world.get(targetEntity, ResourceStorage);
    const load = Math.min(
      RESOURCE_LOAD_PER_TRIP,
      targetStorage?.resource ?? 0,
      storage.capacity - storage.resource
    );
    if (targetEntity !== undefined && targetStorage && load > 0) {
      ctx.world.set(targetEntity, ResourceStorage, {
        ...targetStorage,
        resource: targetStorage.resource - load
      });
    }
    ctx.world.set(entity, ResourceStorage, {
      ...storage,
      resource: storage.resource + load
    });
    ctx.world.set(entity, WorkAssignment, {
      task: "haul",
      status: "returning",
      sourceObjectId: targetObjectId,
      targetObjectId: chooseDeliveryTarget(ctx.world, state.entitiesByObjectId, CAMPFIRE_OBJECT_ID),
      cargo: storage.resource + load,
      battery: clamp(activeWork.battery - 1, 0, 100),
      fatigue: clamp(activeWork.fatigue + 1.8, 0, 100),
      progress: 0,
      routeProgress: 0
    });
    if (load > 0) {
      ctx.eventBus.emit(
        "sandbox.resource_loaded",
        { worker: object.objectId, from: targetObjectId, amount: Math.round(load) },
        "sandbox.camp.worker"
      );
    }
    return;
  }

  if (activeWork.task === "haul") {
    const targetStorage =
      targetEntity === undefined ? undefined : ctx.world.get(targetEntity, ResourceStorage);
    const delivered = Math.min(
      storage.resource,
      targetStorage ? targetStorage.capacity - targetStorage.resource : 0
    );
    if (targetEntity !== undefined && targetStorage && delivered > 0) {
      ctx.world.set(targetEntity, ResourceStorage, {
        ...targetStorage,
        resource: Math.min(targetStorage.capacity, targetStorage.resource + delivered)
      });
      const objective = ctx.world.get(targetEntity, ObjectiveState);
      if (objective) {
        ctx.world.set(targetEntity, ObjectiveState, {
          ...objective,
          progressResources: Math.min(
            objective.targetResources,
            objective.progressResources + delivered
          )
        });
      }
    }
    ctx.world.set(entity, ResourceStorage, {
      ...storage,
      resource: 0
    });
    ctx.eventBus.emit(
      "sandbox.resource_delivered",
      { worker: object.objectId, to: targetObjectId, amount: Math.round(delivered) },
      "sandbox.camp.worker"
    );
    ctx.world.set(entity, WorkAssignment, {
      ...assignNextWorkerWork(
        ctx.world,
        state.entitiesByObjectId,
        state.resourceObjectIds,
        activeWork,
        object.objectId
      ),
      battery: clamp(activeWork.battery - 2, 0, 100),
      fatigue: clamp(activeWork.fatigue + 2.2, 0, 100)
    });
    return;
  }

  if (activeWork.task === "repair") {
    const building =
      targetEntity === undefined ? undefined : ctx.world.get(targetEntity, BuildingState);
    if (targetEntity !== undefined && building) {
      ctx.world.set(targetEntity, BuildingState, {
        ...building,
        health: clamp(building.health + 14, 0, 100),
        heat: clamp(building.heat - 14, 0, 100),
        mode: "build"
      });
    }
    ctx.eventBus.emit(
      "sandbox.building_repaired",
      { worker: object.objectId, target: targetObjectId },
      "sandbox.camp.worker"
    );
    ctx.world.set(entity, WorkAssignment, {
      ...assignNextWorkerWork(
        ctx.world,
        state.entitiesByObjectId,
        state.resourceObjectIds,
        activeWork,
        object.objectId
      ),
      battery: clamp(activeWork.battery - 5, 0, 100),
      fatigue: clamp(activeWork.fatigue + 5, 0, 100)
    });
    return;
  }

  if (activeWork.task === "defend") {
    const threat =
      targetEntity === undefined ? undefined : ctx.world.get(targetEntity, ThreatState);
    if (targetEntity !== undefined && threat) {
      ctx.world.set(targetEntity, ThreatState, {
        ...threat,
        intensity: clamp(threat.intensity - 0.14, 0, 1),
        status: "cooldown"
      });
    }
    ctx.eventBus.emit(
      "sandbox.monster_pushed_back",
      { worker: object.objectId, target: targetObjectId },
      "sandbox.camp.worker"
    );
    ctx.world.set(entity, WorkAssignment, {
      ...assignNextWorkerWork(
        ctx.world,
        state.entitiesByObjectId,
        state.resourceObjectIds,
        activeWork,
        object.objectId
      ),
      battery: clamp(activeWork.battery - 7, 0, 100),
      fatigue: clamp(activeWork.fatigue + 7, 0, 100)
    });
    return;
  }

  if (activeWork.task === "build") {
    const targetStorage =
      targetEntity === undefined ? undefined : ctx.world.get(targetEntity, ResourceStorage);
    if (targetEntity !== undefined && targetStorage) {
      ctx.world.set(targetEntity, ResourceStorage, {
        ...targetStorage,
        materials: Math.min(8, targetStorage.materials + 0.5)
      });
    }
    ctx.eventBus.emit(
      "sandbox.build_progress",
      { worker: object.objectId, target: targetObjectId },
      "sandbox.camp.worker"
    );
    ctx.world.set(entity, WorkAssignment, {
      ...assignNextWorkerWork(
        ctx.world,
        state.entitiesByObjectId,
        state.resourceObjectIds,
        activeWork,
        object.objectId
      ),
      battery: clamp(activeWork.battery - 3, 0, 100),
      fatigue: clamp(activeWork.fatigue + 3.5, 0, 100)
    });
  }
}

function registerMonsterPressureSystem(
  ctx: GameInstallContext,
  options: SandboxCampModuleOptions,
  state: SandboxCampRuntimeState
): void {
  ctx.systems.register({
    id: "sandbox.camp_monster_pressure_system",
    update({ world, tick }) {
      for (const entity of world.query([ThreatState, SceneObject])) {
        const threat = world.get(entity, ThreatState);
        const object = world.get(entity, SceneObject);
        if (!threat || !object || tick < threat.nextStrikeTick) {
          continue;
        }

        const targetId = chooseMonsterTarget(tick, state.entitiesByObjectId);
        const targetEntity = state.entitiesByObjectId.get(targetId);
        const targetObject =
          targetEntity === undefined ? undefined : world.get(targetEntity, SceneObject);
        const targetStorage =
          targetEntity === undefined ? undefined : world.get(targetEntity, ResourceStorage);
        const targetBuilding =
          targetEntity === undefined ? undefined : world.get(targetEntity, BuildingState);
        if (targetEntity !== undefined && targetStorage) {
          world.set(targetEntity, ResourceStorage, {
            ...targetStorage,
            resource: Math.max(0, targetStorage.resource - 8)
          });
        }
        if (targetEntity !== undefined && targetBuilding) {
          world.set(targetEntity, BuildingState, {
            ...targetBuilding,
            health: clamp(targetBuilding.health - 10, 0, 100),
            heat: clamp(targetBuilding.heat + 10, 0, 100),
            mode: "damaged"
          });
        }

        const gas = options.gasRuntime?.();
        if (targetObject?.actorId && gas?.hasActor(targetObject.actorId)) {
          gas.applyEffect({
            effectId: "gas.effect.sandbox.monster_pressure",
            sourceActorId: object.actorId,
            targetActorId: targetObject.actorId
          });
        }

        world.set(entity, ThreatState, {
          intensity: Math.min(1, threat.intensity + 0.1),
          nextStrikeTick: tick + 150,
          status: "striking"
        });
        ctx.eventBus.emit(
          "sandbox.monster_attack",
          { source: object.objectId, target: targetId },
          "sandbox.camp.monster"
        );
      }
    }
  });
}

function registerRoadSystem(ctx: GameInstallContext, state: SandboxCampRuntimeState): void {
  ctx.systems.register({
    id: "sandbox.camp_road_system",
    update({ world }) {
      for (const entity of world.query([LinkState])) {
        const link = world.get(entity, LinkState);
        if (!link) {
          continue;
        }

        const fromEntity = state.entitiesByObjectId.get(link.fromObjectId);
        const fromStorage =
          fromEntity === undefined ? undefined : world.get(fromEntity, ResourceStorage);
        const flow =
          fromStorage && fromStorage.capacity > 0
            ? Math.min(1, fromStorage.resource / fromStorage.capacity)
            : link.status === "danger"
              ? 0.55
              : 0.18;

        world.set(entity, LinkState, {
          ...link,
          flow,
          status:
            link.status === "danger"
              ? "danger"
              : flow > 0.82
                ? "blocked"
                : flow > 0.08
                  ? "moving"
                  : "idle"
        });
      }
    }
  });
}

function registerObjectiveSystem(ctx: GameInstallContext, state: SandboxCampRuntimeState): void {
  ctx.systems.register({
    id: "sandbox.camp_objective_system",
    update({ world, tick }) {
      const campfireEntity = state.entitiesByObjectId.get(CAMPFIRE_OBJECT_ID);
      const objective =
        campfireEntity === undefined ? undefined : world.get(campfireEntity, ObjectiveState);
      if (!objective) {
        return;
      }

      const progress = Math.min(1, objective.progressResources / objective.targetResources);
      if (tick > 0 && tick % 120 === 0) {
        ctx.eventBus.emit(
          "sandbox.objective_progress",
          {
            phaseId: objective.phaseId,
            progress: Math.round(progress * 100),
            resource: Math.round(objective.progressResources)
          },
          "sandbox.camp.objective"
        );
      }
    }
  });
}
