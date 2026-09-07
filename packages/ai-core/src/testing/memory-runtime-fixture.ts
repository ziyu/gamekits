import type { ComponentDef, EntityId, GameWorld } from "@gamekits/world";
import { createAiRuntime } from "../composition/create-ai-runtime";
import type { CreateAiRuntimeOptions } from "../composition/options";
import type { AiIntent } from "../contracts/intent";
import type { AiRuntime } from "../controller/runtime";

export type CreateMemoryAiRuntimeFixtureOptions = Omit<
  CreateAiRuntimeOptions,
  "world" | "intentSink"
> & {
  world?: GameWorld | undefined;
  onIntent?: ((intent: AiIntent) => void) | undefined;
};

export type MemoryAiRuntimeFixture = {
  runtime: AiRuntime;
  world: GameWorld;
  intents: AiIntent[];
  dispose(): void;
};

export function createMemoryAiRuntimeFixture(
  options: CreateMemoryAiRuntimeFixtureOptions
): MemoryAiRuntimeFixture {
  const { world = createMemoryAiWorld(), onIntent, ...runtimeOptions } = options;
  const intents: AiIntent[] = [];
  const runtime = createAiRuntime({
    ...runtimeOptions,
    world,
    intentSink: {
      emit(intent) {
        intents.push(intent);
        onIntent?.(intent);
      }
    }
  });
  return {
    runtime,
    world,
    intents,
    dispose() {
      runtime.dispose();
    }
  };
}

export function createMemoryAiWorld(): GameWorld {
  const componentData = new Map<EntityId, Map<string, unknown>>();
  let nextId = 0;
  const requireEntity = (entity: EntityId) => {
    const components = componentData.get(entity);
    if (components === undefined) {
      throw new Error(`Missing entity: ${String(entity)}`);
    }
    return components;
  };
  return {
    spawn() {
      const entity = `ai-memory-entity-${nextId}`;
      nextId += 1;
      componentData.set(entity, new Map());
      return entity;
    },
    despawn(entity) {
      componentData.delete(entity);
    },
    has(entity) {
      return componentData.has(entity);
    },
    add(entity, component, data) {
      requireEntity(entity).set(component.id, component.create(data));
    },
    get(entity, component) {
      return requireEntity(entity).get(component.id) as ReturnType<typeof component.create>;
    },
    set(entity, component, data) {
      const components = requireEntity(entity);
      const current = components.get(component.id) ?? component.create();
      components.set(component.id, { ...(current as object), ...data });
    },
    remove(entity, component) {
      requireEntity(entity).delete(component.id);
    },
    query(components: Array<ComponentDef<any>> = []) {
      return [...componentData.entries()]
        .filter(([, values]) => components.every((component) => values.has(component.id)))
        .map(([entity]) => entity);
    },
    count() {
      return componentData.size;
    }
  };
}
