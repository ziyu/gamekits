import type { ComponentDef, EntityId } from "@gamekits/world";

export type AiWorldReadModel = {
  has(entity: EntityId): boolean;
  get<T extends object>(entity: EntityId, component: ComponentDef<T>): Readonly<T> | undefined;
  query(components?: ReadonlyArray<ComponentDef<any>>): EntityId[];
  count(): number;
};

export function createAiWorldReadModel(world: AiWorldReadModel): AiWorldReadModel {
  return Object.freeze({
    has(entity: EntityId) {
      return world.has(entity);
    },
    get<T extends object>(entity: EntityId, component: ComponentDef<T>) {
      return world.get(entity, component);
    },
    query(components?: ReadonlyArray<ComponentDef<any>>) {
      return world.query(components === undefined ? undefined : [...components]);
    },
    count() {
      return world.count();
    }
  });
}
