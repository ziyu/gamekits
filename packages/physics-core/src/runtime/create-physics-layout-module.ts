import { defineGameModule, type GameModule } from "@gamekits/core";
import type { DataRegistry } from "@gamekits/data";
import type { GameInstallContext } from "@gamekits/game-runtime";
import type { ComponentDef, EntityId, GameWorld } from "@gamekits/world";
import {
  PhysicsBodyComponent,
  PhysicsColliderComponent,
  PhysicsTransformComponent,
  type PhysicsBodyComponentState,
  type PhysicsColliderComponentState,
  type PhysicsTransformComponentState
} from "../components";
import type {
  PhysicsBodyData,
  PhysicsBodyDefinition,
  PhysicsColliderData,
  PhysicsColliderDefinition,
  PhysicsLayoutBodyInstanceData,
  PhysicsLayoutColliderInstanceData,
  PhysicsLayoutData
} from "./types";

export type PhysicsLayoutWorldBindings = {
  body?: ComponentDef<PhysicsBodyComponentState>;
  collider?: ComponentDef<PhysicsColliderComponentState>;
  transform?: ComponentDef<PhysicsTransformComponentState>;
};

export type PhysicsLayoutBodyMaterialization = {
  instanceId: string;
  entityId: EntityId;
  bodyId: string;
};

export type PhysicsLayoutColliderMaterialization = {
  instanceId: string;
  bodyInstanceId: string;
  entityId: EntityId;
  colliderId: string;
};

export type PhysicsLayoutMaterialization = {
  layoutId: string;
  bodyEntities: PhysicsLayoutBodyMaterialization[];
  colliderEntities: PhysicsLayoutColliderMaterialization[];
  dispose(): void;
};

export type PhysicsLayoutBodyDefinition = {
  instanceId: string;
  position: PhysicsTransformComponentState["position"];
  rotation?: PhysicsTransformComponentState["rotation"];
  enabled: boolean;
  definition: PhysicsBodyDefinition;
};

export type PhysicsLayoutColliderDefinition = {
  instanceId: string;
  bodyInstanceId: string;
  enabled: boolean;
  definition: PhysicsColliderDefinition;
};

export type PhysicsLayoutDefinitions = {
  layoutId: string;
  bodies: PhysicsLayoutBodyDefinition[];
  colliders: PhysicsLayoutColliderDefinition[];
};

export type CreatePhysicsLayoutDefinitionsOptions = {
  dataRegistry: DataRegistry;
  layoutId: string;
  idPrefix?: string;
};

export type MaterializePhysicsLayoutOptions = {
  dataRegistry: DataRegistry;
  layoutId: string;
  world: GameWorld;
  idPrefix?: string;
  bindings?: PhysicsLayoutWorldBindings;
};

export type PhysicsLayoutModuleOptions = Omit<MaterializePhysicsLayoutOptions, "world"> & {
  id?: string;
};

type ResolvedBindings = {
  body: ComponentDef<PhysicsBodyComponentState>;
  collider: ComponentDef<PhysicsColliderComponentState>;
  transform: ComponentDef<PhysicsTransformComponentState>;
};

export function createPhysicsLayoutModule(
  options: PhysicsLayoutModuleOptions
): GameModule<GameInstallContext> {
  return defineGameModule<GameInstallContext>({
    id: options.id ?? `physics.layout.${options.layoutId}`,
    install(ctx) {
      return materializePhysicsLayout({ ...options, world: ctx.world }).dispose;
    }
  });
}

export function materializePhysicsLayout(
  options: MaterializePhysicsLayoutOptions
): PhysicsLayoutMaterialization {
  const layout = createPhysicsLayoutDefinitions(options);
  const bindings = resolveBindings(options.bindings);
  const spawnedEntities: EntityId[] = [];
  const bodyEntities: PhysicsLayoutBodyMaterialization[] = [];
  const colliderEntities: PhysicsLayoutColliderMaterialization[] = [];
  const collidersByBodyInstance = groupCollidersByBodyInstance(layout.colliders);

  try {
    for (const body of layout.bodies) {
      const bodyEntity = options.world.spawn();
      spawnedEntities.push(bodyEntity);
      bodyEntities.push({
        instanceId: body.instanceId,
        entityId: bodyEntity,
        bodyId: requireDefinitionId(body.definition.id, "body")
      });
      options.world.add(bodyEntity, bindings.transform, {
        position: body.position,
        ...(body.rotation === undefined ? {} : { rotation: body.rotation })
      });
      options.world.add(bodyEntity, bindings.body, {
        definition: body.definition,
        enabled: body.enabled
      });
      for (const collider of collidersByBodyInstance.get(body.instanceId) ?? []) {
        const colliderEntity = options.world.spawn();
        spawnedEntities.push(colliderEntity);
        colliderEntities.push({
          instanceId: collider.instanceId,
          bodyInstanceId: collider.bodyInstanceId,
          entityId: colliderEntity,
          colliderId: requireDefinitionId(collider.definition.id, "collider")
        });
        options.world.add(colliderEntity, bindings.collider, {
          definition: collider.definition,
          enabled: collider.enabled
        });
      }
    }
  } catch (error) {
    despawnAll(options.world, spawnedEntities);
    throw error;
  }

  let disposed = false;
  return {
    layoutId: layout.layoutId,
    bodyEntities,
    colliderEntities,
    dispose() {
      if (disposed) {
        return;
      }
      disposed = true;
      despawnAll(options.world, spawnedEntities);
    }
  };
}

export function createPhysicsLayoutDefinitions(
  options: CreatePhysicsLayoutDefinitionsOptions
): PhysicsLayoutDefinitions {
  const layout = options.dataRegistry.getValue<PhysicsLayoutData>(
    "physics.layout",
    options.layoutId
  );
  const idPrefix = options.idPrefix ?? layout.id;
  const bodies: PhysicsLayoutBodyDefinition[] = [];
  const colliders: PhysicsLayoutColliderDefinition[] = [];

  for (const bodyInstance of layout.bodies) {
    const bodyData = options.dataRegistry.getValue<PhysicsBodyData>(
      bodyInstance.body.type,
      bodyInstance.body.id
    );
    const bodyId = `${idPrefix}.${bodyInstance.id}.body`;
    bodies.push({
      instanceId: bodyInstance.id,
      position: bodyInstance.position ?? bodyData.position ?? { x: 0, y: 0 },
      ...(bodyInstance.rotation === undefined && bodyData.rotation === undefined
        ? {}
        : { rotation: bodyInstance.rotation ?? bodyData.rotation }),
      enabled: bodyInstance.enabled ?? true,
      definition: createBodyDefinition(layout.id, bodyInstance, bodyData, bodyId)
    });

    for (const colliderInstance of resolveColliderInstances(bodyInstance, bodyData)) {
      const colliderData = options.dataRegistry.getValue<PhysicsColliderData>(
        colliderInstance.collider.type,
        colliderInstance.collider.id
      );
      const colliderId = `${idPrefix}.${bodyInstance.id}.${colliderInstance.id}.collider`;
      colliders.push({
        instanceId: colliderInstance.id,
        bodyInstanceId: bodyInstance.id,
        enabled: colliderInstance.enabled ?? true,
        definition: createColliderDefinition(
          layout.id,
          bodyInstance.id,
          colliderInstance,
          colliderData,
          bodyId,
          colliderId
        )
      });
    }
  }

  return { layoutId: layout.id, bodies, colliders };
}

function createBodyDefinition(
  layoutId: string,
  instance: PhysicsLayoutBodyInstanceData,
  data: PhysicsBodyData,
  bodyId: string
): PhysicsBodyDefinition {
  const {
    id: _id,
    position: _position,
    rotation: _rotation,
    colliders: _colliders,
    tags: _tags,
    ...definition
  } = data;
  const overrides = instance.overrides ?? {};
  return {
    ...definition,
    ...overrides,
    id: bodyId,
    userData: {
      ...definition.userData,
      ...overrides.userData,
      physicsLayoutId: layoutId,
      physicsLayoutBodyInstanceId: instance.id
    }
  };
}

function createColliderDefinition(
  layoutId: string,
  bodyInstanceId: string,
  instance: PhysicsLayoutColliderInstanceData,
  data: PhysicsColliderData,
  bodyId: string,
  colliderId: string
): PhysicsColliderDefinition {
  const { id: _id, bodyId: _bodyId, tags: _tags, ...definition } = data;
  const overrides = instance.overrides ?? {};
  return {
    ...definition,
    ...overrides,
    id: colliderId,
    bodyId,
    userData: {
      ...definition.userData,
      ...overrides.userData,
      physicsLayoutId: layoutId,
      physicsLayoutBodyInstanceId: bodyInstanceId,
      physicsLayoutColliderInstanceId: instance.id
    }
  };
}

function resolveColliderInstances(
  bodyInstance: PhysicsLayoutBodyInstanceData,
  bodyData: PhysicsBodyData
): PhysicsLayoutColliderInstanceData[] {
  if (bodyInstance.colliders !== undefined) {
    return bodyInstance.colliders;
  }
  return (bodyData.colliders ?? []).map((collider, index) => ({
    id: `${index}.${collider.id}`,
    collider
  }));
}

function resolveBindings(bindings: PhysicsLayoutWorldBindings = {}): ResolvedBindings {
  return {
    body: bindings.body ?? PhysicsBodyComponent,
    collider: bindings.collider ?? PhysicsColliderComponent,
    transform: bindings.transform ?? PhysicsTransformComponent
  };
}

function despawnAll(world: GameWorld, entities: EntityId[]): void {
  for (let index = entities.length - 1; index >= 0; index -= 1) {
    const entity = entities[index];
    if (entity !== undefined && world.has(entity)) {
      world.despawn(entity);
    }
  }
}

function groupCollidersByBodyInstance(
  colliders: readonly PhysicsLayoutColliderDefinition[]
): Map<string, PhysicsLayoutColliderDefinition[]> {
  const grouped = new Map<string, PhysicsLayoutColliderDefinition[]>();
  for (const collider of colliders) {
    const bodyColliders = grouped.get(collider.bodyInstanceId) ?? [];
    bodyColliders.push(collider);
    grouped.set(collider.bodyInstanceId, bodyColliders);
  }
  return grouped;
}

function requireDefinitionId(id: string | undefined, kind: "body" | "collider"): string {
  if (id === undefined) {
    throw new Error(`Physics layout ${kind} definition requires an id.`);
  }
  return id;
}
