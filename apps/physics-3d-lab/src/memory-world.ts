import type { ComponentDef, EntityId, GameWorld } from "@gamekits/world";

export function createMemoryWorld(): GameWorld {
  let nextEntity = 1;
  const components = new Map<EntityId, Map<string, object>>();

  return {
    spawn() {
      const entity = nextEntity;
      nextEntity += 1;
      components.set(entity, new Map());
      return entity;
    },
    despawn(entity) {
      components.delete(entity);
    },
    has(entity) {
      return components.has(entity);
    },
    add<T extends object>(entity: EntityId, component: ComponentDef<T>, data?: Partial<T>) {
      requireEntity(components, entity).set(component.id, component.create(data));
    },
    get<T extends object>(entity: EntityId, component: ComponentDef<T>) {
      return requireEntity(components, entity).get(component.id) as T | undefined;
    },
    set<T extends object>(entity: EntityId, component: ComponentDef<T>, data: Partial<T>) {
      const entityComponents = requireEntity(components, entity);
      const current = entityComponents.get(component.id) as T | undefined;
      entityComponents.set(component.id, { ...(current ?? component.create()), ...data });
    },
    remove<T extends object>(entity: EntityId, component: ComponentDef<T>) {
      requireEntity(components, entity).delete(component.id);
    },
    query(required = []) {
      const result: EntityId[] = [];
      for (const [entity, entityComponents] of components.entries()) {
        if (required.every((component) => entityComponents.has(component.id))) {
          result.push(entity);
        }
      }

      return result;
    },
    count() {
      return components.size;
    }
  };
}

function requireEntity(
  components: Map<EntityId, Map<string, object>>,
  entity: EntityId
): Map<string, object> {
  const entityComponents = components.get(entity);
  if (!entityComponents) {
    throw new Error(`Missing entity: ${String(entity)}`);
  }

  return entityComponents;
}
