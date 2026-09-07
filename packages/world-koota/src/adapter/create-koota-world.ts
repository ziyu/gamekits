import { GameError } from "@gamekits/core";
import type { CheckpointGameWorld, ComponentDef, EntityId } from "@gamekits/world";
import { createWorld as createKootaNativeWorld, trait } from "koota";
import type { KootaEntity, KootaNativeWorld, KootaTrait } from "./koota-types";

export function createKootaWorld(): CheckpointGameWorld {
  const nativeWorld = createKootaNativeWorld() as unknown as KootaNativeWorld;
  const traitByComponentId = new Map<string, KootaTrait>();
  const entityById = new Map<EntityId, KootaEntity>();
  const idByEntity = new Map<KootaEntity, EntityId>();
  let nextEntityId = 0;

  const getTrait = <T extends object>(component: ComponentDef<T>): KootaTrait => {
    let kootaTrait = traitByComponentId.get(component.id);
    if (!kootaTrait) {
      kootaTrait = trait(() => component.create());
      traitByComponentId.set(component.id, kootaTrait);
    }

    return kootaTrait;
  };

  const requireEntity = (entityId: EntityId): KootaEntity => {
    const entity = entityById.get(entityId);
    if (!entity || !nativeWorld.has(entity)) {
      throw new GameError("world.missing_entity", `Missing entity: ${String(entityId)}`, {
        entity: entityId
      });
    }

    return entity;
  };

  const spawnEntity = (entityId: EntityId): EntityId => {
    if (entityById.has(entityId)) {
      throw new GameError("world.duplicate_entity", `Duplicate entity: ${String(entityId)}`, {
        entity: entityId
      });
    }
    const entity = nativeWorld.spawn();
    entityById.set(entityId, entity);
    idByEntity.set(entity, entityId);
    reserveGeneratedId(entityId);
    return entityId;
  };

  const nextGeneratedId = (): EntityId => {
    let entityId = `entity-${nextEntityId}`;
    while (entityById.has(entityId)) {
      nextEntityId += 1;
      entityId = `entity-${nextEntityId}`;
    }
    nextEntityId += 1;
    return entityId;
  };

  const reserveGeneratedId = (entityId: EntityId): void => {
    if (typeof entityId !== "string") {
      return;
    }
    const match = /^entity-(\d+)$/.exec(entityId);
    if (match === null) {
      return;
    }
    nextEntityId = Math.max(nextEntityId, Number(match[1]) + 1);
  };

  return {
    spawn() {
      return spawnEntity(nextGeneratedId());
    },
    spawnWithId(entityId) {
      if (
        (typeof entityId === "string" && entityId.trim().length === 0) ||
        (typeof entityId === "number" && !Number.isSafeInteger(entityId))
      ) {
        throw new GameError("world.invalid_entity_id", "Entity id must be stable and non-empty", {
          entity: entityId
        });
      }
      return spawnEntity(entityId);
    },
    despawn(entityId) {
      const entity = requireEntity(entityId);
      entity.destroy();
      entityById.delete(entityId);
      idByEntity.delete(entity);
    },
    has(entityId) {
      const entity = entityById.get(entityId);
      return Boolean(entity && nativeWorld.has(entity));
    },
    add(entityId, component, data) {
      const entity = requireEntity(entityId);
      const kootaTrait = getTrait(component);
      const initialState = component.create(data);
      entity.add((kootaTrait as any)(initialState));
    },
    get(entityId, component) {
      const entity = entityById.get(entityId);
      if (!entity || !nativeWorld.has(entity)) {
        return undefined;
      }

      const kootaTrait = getTrait(component);
      if (!entity.has(kootaTrait)) {
        return undefined;
      }

      return entity.get(kootaTrait) as ReturnType<typeof component.create>;
    },
    set(entityId, component, data) {
      const entity = requireEntity(entityId);
      const kootaTrait = getTrait(component);
      const current = entity.has(kootaTrait)
        ? (entity.get(kootaTrait) as ReturnType<typeof component.create>)
        : component.create();
      entity.set(kootaTrait, { ...current, ...data });
    },
    remove(entityId, component) {
      const entity = requireEntity(entityId);
      const kootaTrait = getTrait(component);
      if (entity.has(kootaTrait)) {
        entity.remove(kootaTrait);
      }
    },
    query(components = []) {
      const traits = components.map((component) => getTrait(component));
      return nativeWorld
        .query(...traits)
        .map((entity) => idByEntity.get(entity))
        .filter((entityId): entityId is EntityId => entityId !== undefined);
    },
    count() {
      return entityById.size;
    }
  };
}
