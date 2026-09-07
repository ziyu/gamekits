import type { ComponentDef, EntityId, GameWorld } from "@gamekits/world";
import type {
  PhysicsBodyComponentState,
  PhysicsColliderComponentState,
  PhysicsContactsComponentState,
  PhysicsTransformComponentState,
  PhysicsVelocityComponentState
} from "../components";
import type {
  PhysicsBodyId,
  PhysicsBodyDefinition,
  PhysicsBodyState,
  PhysicsCheckpointRestoreOptions,
  PhysicsColliderId,
  PhysicsEntityCheckpoint,
  PhysicsCheckpointBodyState,
  PhysicsRuntimeCheckpoint,
  PhysicsScene
} from "./types";
import { GameError } from "@gamekits/core";

export type PhysicsCheckpointBindings = {
  body: ComponentDef<PhysicsBodyComponentState>;
  collider: ComponentDef<PhysicsColliderComponentState>;
  transform: ComponentDef<PhysicsTransformComponentState>;
  velocity: ComponentDef<PhysicsVelocityComponentState>;
  contacts: ComponentDef<PhysicsContactsComponentState>;
};

export type PhysicsCheckpointIndex = {
  bodies: Map<PhysicsBodyId, EntityId>;
  colliders: Map<PhysicsColliderId, EntityId>;
};

export type PhysicsCheckpointController = {
  capture(): PhysicsRuntimeCheckpoint;
  restore(checkpoint: PhysicsRuntimeCheckpoint, options?: PhysicsCheckpointRestoreOptions): void;
};

export function createPhysicsCheckpointController(options: {
  world: GameWorld;
  scene: PhysicsScene;
  bindings: PhysicsCheckpointBindings;
  entityIndex: PhysicsCheckpointIndex;
  pendingSleeping: Map<EntityId, boolean>;
  accumulator(): number;
  setAccumulator(value: number): void;
}): PhysicsCheckpointController {
  return {
    capture() {
      return captureCheckpoint(options);
    },
    restore(checkpoint, restoreOptions) {
      restoreCheckpoint(options, checkpoint, restoreOptions);
    }
  };
}

function captureCheckpoint(options: {
  world: GameWorld;
  scene: PhysicsScene;
  bindings: PhysicsCheckpointBindings;
  pendingSleeping: Map<EntityId, boolean>;
  accumulator(): number;
}): PhysicsRuntimeCheckpoint {
  const entities = new Set<EntityId>([
    ...options.world.query([options.bindings.body]),
    ...options.world.query([options.bindings.collider])
  ]);
  return {
    accumulator: options.accumulator(),
    entities: [...entities]
      .sort((left, right) => String(left).localeCompare(String(right)))
      .map((entityId) => captureEntity(options, entityId))
  };
}

function captureEntity(
  options: {
    world: GameWorld;
    scene: PhysicsScene;
    bindings: PhysicsCheckpointBindings;
    pendingSleeping: Map<EntityId, boolean>;
  },
  entityId: EntityId
): PhysicsEntityCheckpoint {
  const body = options.world.get(entityId, options.bindings.body);
  const collider = options.world.get(entityId, options.bindings.collider);
  const transform = options.world.get(entityId, options.bindings.transform);
  const velocity = options.world.get(entityId, options.bindings.velocity);
  const liveBodyState =
    body?.bodyId === undefined ? undefined : options.scene.getBodyState(body.bodyId);
  const bodyState =
    liveBodyState === undefined
      ? checkpointStateBeforeRebuild(
          body,
          transform,
          velocity,
          options.pendingSleeping.get(entityId)
        )
      : omitBodyId(liveBodyState);
  return {
    entityId,
    ...(body === undefined
      ? {}
      : {
          body: {
            definition:
              bodyState === undefined
                ? structuredClone(body.definition)
                : definitionWithoutState(body.definition),
            enabled: body.enabled,
            syncFromWorld: body.syncFromWorld,
            syncVelocityFromWorld: body.syncVelocityFromWorld,
            syncToWorld: body.syncToWorld,
            ...(bodyState === undefined ? {} : { state: bodyState })
          }
        }),
    ...(collider === undefined
      ? {}
      : {
          collider: {
            definition: structuredClone(collider.definition),
            enabled: collider.enabled
          }
        }),
    ...(transform === undefined ? {} : { transform: structuredClone(transform) }),
    ...(velocity === undefined ? {} : { velocity: structuredClone(velocity) })
  };
}

function restoreCheckpoint(
  options: {
    world: GameWorld;
    scene: PhysicsScene;
    bindings: PhysicsCheckpointBindings;
    entityIndex: PhysicsCheckpointIndex;
    pendingSleeping: Map<EntityId, boolean>;
    setAccumulator(value: number): void;
  },
  checkpoint: PhysicsRuntimeCheckpoint,
  restoreOptions: PhysicsCheckpointRestoreOptions | undefined
): void {
  const restored = validateCheckpoint(options.world, checkpoint, restoreOptions);
  for (const colliderId of options.entityIndex.colliders.keys()) {
    if (options.scene.getColliderState(colliderId)) {
      options.scene.destroyCollider(colliderId);
    }
  }
  for (const bodyId of options.entityIndex.bodies.keys()) {
    if (options.scene.getBodyState(bodyId)) {
      options.scene.destroyBody(bodyId);
    }
  }
  options.entityIndex.colliders.clear();
  options.entityIndex.bodies.clear();
  options.pendingSleeping.clear();

  const currentEntities = new Set<EntityId>([
    ...options.world.query([options.bindings.body]),
    ...options.world.query([options.bindings.collider])
  ]);
  for (const entityId of currentEntities) {
    removeIfPresent(options.world, entityId, options.bindings.contacts);
    removeIfPresent(options.world, entityId, options.bindings.collider);
    removeIfPresent(options.world, entityId, options.bindings.body);
    removeIfPresent(options.world, entityId, options.bindings.velocity);
    removeIfPresent(options.world, entityId, options.bindings.transform);
  }

  for (const entry of restored) {
    restoreEntity(options.world, options.bindings, entry.entityId, entry.checkpoint);
    const sleeping = entry.checkpoint.body?.state?.sleeping;
    if (sleeping !== undefined) {
      options.pendingSleeping.set(entry.entityId, sleeping);
    }
  }
  options.setAccumulator(checkpoint.accumulator);
}

function validateCheckpoint(
  world: GameWorld,
  checkpoint: PhysicsRuntimeCheckpoint,
  options: PhysicsCheckpointRestoreOptions | undefined
): Array<{ entityId: EntityId; checkpoint: PhysicsEntityCheckpoint }> {
  if (!Number.isFinite(checkpoint.accumulator) || checkpoint.accumulator < 0) {
    throw new GameError(
      "physics.checkpoint_invalid_accumulator",
      "Physics checkpoint accumulator must be non-negative"
    );
  }
  if (!Array.isArray(checkpoint.entities)) {
    throw new GameError(
      "physics.checkpoint_invalid_entities",
      "Invalid physics checkpoint entities"
    );
  }
  const entityIds = new Set<EntityId>();
  return checkpoint.entities.map((entry) => {
    const entityId = options?.resolveEntityId?.(entry.entityId) ?? entry.entityId;
    if (!world.has(entityId)) {
      throw new GameError(
        "physics.checkpoint_missing_entity",
        `Missing restored physics entity: ${String(entityId)}`,
        { savedEntityId: entry.entityId, entityId }
      );
    }
    if (entityIds.has(entityId)) {
      throw new GameError(
        "physics.checkpoint_duplicate_entity",
        `Duplicate restored physics entity: ${String(entityId)}`
      );
    }
    entityIds.add(entityId);
    return { entityId, checkpoint: entry };
  });
}

function restoreEntity(
  world: GameWorld,
  bindings: PhysicsCheckpointBindings,
  entityId: EntityId,
  checkpoint: PhysicsEntityCheckpoint
): void {
  if (checkpoint.body !== undefined) {
    const state = checkpoint.body.state;
    const definition = state
      ? definitionWithState(checkpoint.body.definition, state)
      : structuredClone(checkpoint.body.definition);
    world.add(entityId, bindings.body, {
      definition,
      enabled: checkpoint.body.enabled,
      syncFromWorld: checkpoint.body.syncFromWorld,
      syncVelocityFromWorld: checkpoint.body.syncVelocityFromWorld,
      syncToWorld: checkpoint.body.syncToWorld
    });
    const transform = state ?? checkpoint.transform;
    const velocity = state
      ? {
          linear: state.linearVelocity,
          ...(state.angularVelocity === undefined ? {} : { angular: state.angularVelocity })
        }
      : checkpoint.velocity;
    if (transform !== undefined) {
      world.add(entityId, bindings.transform, {
        position: transform.position,
        ...(transform.rotation === undefined ? {} : { rotation: transform.rotation })
      });
    }
    if (velocity !== undefined) {
      world.add(entityId, bindings.velocity, {
        linear: velocity.linear,
        ...(velocity.angular === undefined ? {} : { angular: velocity.angular })
      });
    }
  }
  if (checkpoint.collider !== undefined) {
    world.add(entityId, bindings.collider, {
      definition: structuredClone(checkpoint.collider.definition),
      enabled: checkpoint.collider.enabled
    });
  }
}

function definitionWithState(
  definition: PhysicsBodyDefinition,
  state: PhysicsCheckpointBodyState
): PhysicsBodyDefinition {
  const {
    position: _position,
    rotation: _rotation,
    linearVelocity: _linearVelocity,
    angularVelocity: _angularVelocity,
    ...base
  } = structuredClone(definition);
  return {
    ...base,
    position: state.position,
    linearVelocity: state.linearVelocity,
    ...(state.rotation === undefined ? {} : { rotation: state.rotation }),
    ...(state.angularVelocity === undefined ? {} : { angularVelocity: state.angularVelocity })
  };
}

function definitionWithoutState(definition: PhysicsBodyDefinition): PhysicsBodyDefinition {
  const {
    position: _position,
    rotation: _rotation,
    linearVelocity: _linearVelocity,
    angularVelocity: _angularVelocity,
    ...base
  } = structuredClone(definition);
  return base;
}

function omitBodyId(state: PhysicsBodyState): PhysicsCheckpointBodyState {
  const { id: _id, ...checkpoint } = structuredClone(state);
  return checkpoint;
}

function checkpointStateBeforeRebuild(
  body: PhysicsBodyComponentState | undefined,
  transform: PhysicsTransformComponentState | undefined,
  velocity: PhysicsVelocityComponentState | undefined,
  sleeping: boolean | undefined
): PhysicsCheckpointBodyState | undefined {
  if (body === undefined || sleeping === undefined) {
    return undefined;
  }
  const rotation = transform?.rotation ?? body.definition.rotation;
  const angularVelocity = velocity?.angular ?? body.definition.angularVelocity;
  return {
    kind: body.definition.kind,
    position: structuredClone(transform?.position ?? body.definition.position ?? { x: 0, y: 0 }),
    linearVelocity: structuredClone(
      velocity?.linear ?? body.definition.linearVelocity ?? { x: 0, y: 0 }
    ),
    sleeping,
    ...(rotation === undefined ? {} : { rotation: structuredClone(rotation) }),
    ...(angularVelocity === undefined ? {} : { angularVelocity: structuredClone(angularVelocity) }),
    ...(body.definition.userData === undefined
      ? {}
      : { userData: structuredClone(body.definition.userData) })
  };
}

function removeIfPresent<T extends object>(
  world: GameWorld,
  entityId: EntityId,
  component: ComponentDef<T>
): void {
  if (world.get(entityId, component) !== undefined) {
    world.remove(entityId, component);
  }
}
