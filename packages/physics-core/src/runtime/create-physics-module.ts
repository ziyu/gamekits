import { defineGameModule, type GameModule } from "@gamekits/core";
import type { GameInstallContext } from "@gamekits/game-runtime";
import type { ComponentDef, EntityId, GameWorld, WorldSystemContext } from "@gamekits/world";
import {
  PhysicsBodyComponent,
  PhysicsColliderComponent,
  PhysicsContactsComponent,
  PhysicsTransformComponent,
  PhysicsVelocityComponent,
  type PhysicsBodyComponentState,
  type PhysicsColliderComponentState,
  type PhysicsContactsComponentState,
  type PhysicsTransformComponentState,
  type PhysicsVelocityComponentState
} from "../components";
import type {
  PhysicsBackendAdapter,
  PhysicsBodyId,
  PhysicsColliderId,
  PhysicsContactEvent,
  PhysicsHandle,
  PhysicsInterpolationStore,
  PhysicsScene,
  PhysicsSceneConfig,
  PhysicsTraceStore
} from "./types";
import { bindPhysicsHandle, unbindPhysicsHandle } from "./create-physics-handle";
import { createPhysicsCheckpointController } from "./checkpoint";
import {
  bindPhysicsInterpolationStore,
  clearPhysicsInterpolationStore,
  recordPhysicsInterpolationBody,
  removePhysicsInterpolationBody,
  resetPhysicsInterpolationBody,
  setPhysicsInterpolationAccumulator,
  unbindPhysicsInterpolationStore
} from "./interpolation-store";

export type PhysicsWorldBindings = {
  body?: ComponentDef<PhysicsBodyComponentState>;
  collider?: ComponentDef<PhysicsColliderComponentState>;
  transform?: ComponentDef<PhysicsTransformComponentState>;
  velocity?: ComponentDef<PhysicsVelocityComponentState>;
  contacts?: ComponentDef<PhysicsContactsComponentState>;
};

export type PhysicsEventPolicy = {
  emitContacts?: boolean;
};

export type PhysicsModuleOptions = {
  id?: string;
  backend: PhysicsBackendAdapter;
  scene?: PhysicsSceneConfig;
  fixedDeltaMs?: number;
  maxSubSteps?: number;
  bindings?: PhysicsWorldBindings;
  eventPolicy?: PhysicsEventPolicy;
  traceStore?: PhysicsTraceStore;
  handle?: PhysicsHandle;
  interpolationStore?: PhysicsInterpolationStore;
};

type ResolvedPhysicsBindings = {
  body: ComponentDef<PhysicsBodyComponentState>;
  collider: ComponentDef<PhysicsColliderComponentState>;
  transform: ComponentDef<PhysicsTransformComponentState>;
  velocity: ComponentDef<PhysicsVelocityComponentState>;
  contacts: ComponentDef<PhysicsContactsComponentState>;
};

type PhysicsEntityIndex = {
  bodies: Map<PhysicsBodyId, EntityId>;
  colliders: Map<PhysicsColliderId, EntityId>;
};

export function createPhysicsModule(options: PhysicsModuleOptions): GameModule<GameInstallContext> {
  const moduleId = options.id ?? "physics";
  const fixedDeltaMs = options.fixedDeltaMs ?? options.scene?.fixedDeltaMs ?? 1000 / 60;
  const stepEpsilonMs = fixedDeltaMs * 1e-9;
  const maxSubSteps = options.maxSubSteps ?? 5;
  const bindings = resolveBindings(options.bindings);
  const emitContacts = options.eventPolicy?.emitContacts ?? true;
  const entityIndex: PhysicsEntityIndex = {
    bodies: new Map(),
    colliders: new Map()
  };
  let scene: PhysicsScene | undefined;
  let accumulator = 0;
  const pendingSleeping = new Map<EntityId, boolean>();

  return defineGameModule<GameInstallContext>({
    id: moduleId,
    install(ctx: GameInstallContext) {
      const nextScene = options.backend.createScene(options.scene);
      let handleBound = false;
      let interpolationStoreBound = false;
      try {
        if (options.handle !== undefined) {
          bindPhysicsHandle(
            options.handle,
            nextScene,
            moduleId,
            createPhysicsCheckpointController({
              world: ctx.world,
              scene: nextScene,
              bindings,
              entityIndex,
              pendingSleeping,
              accumulator: () => accumulator,
              setAccumulator(value) {
                accumulator = value;
                if (options.interpolationStore) {
                  clearPhysicsInterpolationStore(options.interpolationStore);
                  setPhysicsInterpolationAccumulator(options.interpolationStore, accumulator);
                }
              }
            })
          );
          handleBound = true;
        }
        if (options.interpolationStore !== undefined) {
          bindPhysicsInterpolationStore(options.interpolationStore, moduleId, fixedDeltaMs);
          interpolationStoreBound = true;
        }
      } catch (error) {
        if (interpolationStoreBound && options.interpolationStore) {
          unbindPhysicsInterpolationStore(options.interpolationStore, moduleId);
        }
        if (handleBound && options.handle) {
          unbindPhysicsHandle(options.handle, moduleId);
        }
        nextScene.dispose();
        throw error;
      }
      scene = nextScene;
      ctx.systems.register({
        id: `${moduleId}.step`,
        update(systemCtx: WorldSystemContext) {
          if (!scene) {
            return;
          }

          syncWorldToScene(
            systemCtx.world,
            scene,
            bindings,
            entityIndex,
            pendingSleeping,
            options.interpolationStore
          );
          accumulator += systemCtx.delta;
          let subSteps = 0;
          while (accumulator + stepEpsilonMs >= fixedDeltaMs && subSteps < maxSubSteps) {
            const result = scene.step(fixedDeltaMs, {
              tick: systemCtx.tick,
              elapsed: systemCtx.elapsed
            });
            syncSceneToWorld(systemCtx.world, scene, bindings, options.interpolationStore);
            const contacts = withContactEntities(result.contacts, entityIndex);
            writeContacts(systemCtx.world, contacts, bindings);
            if (emitContacts) {
              emitContactEvents(ctx, contacts);
            }
            for (const contact of contacts) {
              options.traceStore?.push({
                kind: "contact",
                tick: systemCtx.tick,
                elapsed: systemCtx.elapsed,
                label: `physics.${contact.kind}.${contact.phase}`,
                colliderId: contact.colliderA,
                ...(contact.entityA === undefined ? {} : { entityId: contact.entityA }),
                payload: {
                  colliderA: contact.colliderA,
                  colliderB: contact.colliderB,
                  bodyA: contact.bodyA,
                  bodyB: contact.bodyB,
                  entityA: contact.entityA,
                  entityB: contact.entityB,
                  sensor: contact.sensor
                }
              });
            }
            options.traceStore?.push({
              kind: "step",
              tick: systemCtx.tick,
              elapsed: systemCtx.elapsed,
              label: "physics.step",
              payload: {
                deltaMs: result.deltaMs,
                contactCount: contacts.length,
                diagnostics: result.diagnostics.length
              }
            });
            accumulator = Math.max(0, accumulator - fixedDeltaMs);
            subSteps += 1;
          }

          if (subSteps === maxSubSteps && accumulator + stepEpsilonMs >= fixedDeltaMs) {
            accumulator = 0;
            options.traceStore?.push({
              kind: "diagnostic",
              tick: systemCtx.tick,
              elapsed: systemCtx.elapsed,
              label: "physics.max_sub_steps_exceeded",
              payload: { fixedDeltaMs, maxSubSteps }
            });
          }
          if (options.interpolationStore) {
            setPhysicsInterpolationAccumulator(options.interpolationStore, accumulator);
          }
        }
      });

      return {
        dispose() {
          if (options.handle !== undefined) {
            unbindPhysicsHandle(options.handle, moduleId);
          }
          if (options.interpolationStore !== undefined) {
            unbindPhysicsInterpolationStore(options.interpolationStore, moduleId);
          }
          scene?.dispose();
          scene = undefined;
          accumulator = 0;
          entityIndex.bodies.clear();
          entityIndex.colliders.clear();
          pendingSleeping.clear();
        }
      };
    }
  });
}

function resolveBindings(bindings: PhysicsWorldBindings = {}): ResolvedPhysicsBindings {
  return {
    body: bindings.body ?? PhysicsBodyComponent,
    collider: bindings.collider ?? PhysicsColliderComponent,
    transform: bindings.transform ?? PhysicsTransformComponent,
    velocity: bindings.velocity ?? PhysicsVelocityComponent,
    contacts: bindings.contacts ?? PhysicsContactsComponent
  };
}

function syncWorldToScene(
  world: GameWorld,
  scene: PhysicsScene,
  bindings: ResolvedPhysicsBindings,
  entityIndex: PhysicsEntityIndex,
  pendingSleeping: Map<EntityId, boolean>,
  interpolationStore: PhysicsInterpolationStore | undefined
): void {
  const nextBodies = new Map<PhysicsBodyId, EntityId>();
  const nextColliders = new Map<PhysicsColliderId, EntityId>();

  for (const entity of world.query([bindings.body])) {
    const body = world.get(entity, bindings.body);
    if (!body?.enabled) {
      if (body?.bodyId && scene.getBodyState(body.bodyId)) {
        scene.destroyBody(body.bodyId);
      }
      if (body?.bodyId && interpolationStore) {
        removePhysicsInterpolationBody(interpolationStore, body.bodyId);
      }
      continue;
    }

    const transform = world.get(entity, bindings.transform);
    const velocity = world.get(entity, bindings.velocity);
    let bodyId = body.bodyId;
    if (!bodyId || !scene.getBodyState(bodyId)) {
      bodyId = scene.createBody({
        ...body.definition,
        ...(body.definition.position !== undefined || transform === undefined
          ? {}
          : { position: transform.position }),
        ...(body.definition.rotation !== undefined || transform?.rotation === undefined
          ? {}
          : { rotation: transform.rotation }),
        ...(body.definition.linearVelocity !== undefined || velocity === undefined
          ? {}
          : { linearVelocity: velocity.linear }),
        ...(body.definition.angularVelocity !== undefined || velocity?.angular === undefined
          ? {}
          : { angularVelocity: velocity.angular })
      });
      world.set(entity, bindings.body, { bodyId });
      const initialState = scene.getBodyState(bodyId);
      if (initialState && shouldTrackInterpolation(body) && interpolationStore) {
        resetPhysicsInterpolationBody(interpolationStore, bodyId, initialState);
      }
    }
    nextBodies.set(bodyId, entity);

    const patch =
      body.syncFromWorld && transform
        ? {
            position: transform.position,
            ...(transform.rotation === undefined ? {} : { rotation: transform.rotation })
          }
        : {};
    const velocityPatch =
      body.syncVelocityFromWorld && velocity
        ? {
            linearVelocity: velocity.linear,
            ...(velocity.angular === undefined ? {} : { angularVelocity: velocity.angular })
          }
        : {};
    const restoredSleeping = pendingSleeping.get(entity);
    if (!shouldTrackInterpolation(body) && interpolationStore) {
      removePhysicsInterpolationBody(interpolationStore, bodyId);
    }
    scene.updateBody(bodyId, {
      ...patch,
      ...velocityPatch,
      ...(restoredSleeping === undefined ? {} : { sleeping: restoredSleeping })
    });
    pendingSleeping.delete(entity);
  }

  destroyStaleBodies(scene, entityIndex.bodies, nextBodies, interpolationStore);

  for (const entity of world.query([bindings.collider])) {
    const collider = world.get(entity, bindings.collider);
    const body = world.get(entity, bindings.body);
    if (!collider?.enabled || body?.enabled === false) {
      if (collider?.colliderId && scene.getColliderState(collider.colliderId)) {
        scene.destroyCollider(collider.colliderId);
      }
      continue;
    }
    if (collider.colliderId && scene.getColliderState(collider.colliderId)) {
      scene.updateCollider(collider.colliderId, { enabled: true });
      nextColliders.set(collider.colliderId, entity);
      continue;
    }

    const bodyId = collider.definition.bodyId ?? body?.bodyId;
    const colliderId = scene.createCollider({
      ...collider.definition,
      ...(bodyId === undefined ? {} : { bodyId })
    });
    world.set(entity, bindings.collider, { colliderId });
    nextColliders.set(colliderId, entity);
  }

  destroyStaleColliders(scene, entityIndex.colliders, nextColliders);
  entityIndex.bodies = nextBodies;
  entityIndex.colliders = nextColliders;
}

function destroyStaleBodies(
  scene: PhysicsScene,
  previousBodies: Map<PhysicsBodyId, EntityId>,
  nextBodies: Map<PhysicsBodyId, EntityId>,
  interpolationStore: PhysicsInterpolationStore | undefined
): void {
  for (const bodyId of previousBodies.keys()) {
    if (!nextBodies.has(bodyId) && scene.getBodyState(bodyId)) {
      scene.destroyBody(bodyId);
    }
    if (!nextBodies.has(bodyId) && interpolationStore) {
      removePhysicsInterpolationBody(interpolationStore, bodyId);
    }
  }
}

function destroyStaleColliders(
  scene: PhysicsScene,
  previousColliders: Map<PhysicsColliderId, EntityId>,
  nextColliders: Map<PhysicsColliderId, EntityId>
): void {
  for (const colliderId of previousColliders.keys()) {
    if (!nextColliders.has(colliderId) && scene.getColliderState(colliderId)) {
      scene.destroyCollider(colliderId);
    }
  }
}

function syncSceneToWorld(
  world: GameWorld,
  scene: PhysicsScene,
  bindings: ResolvedPhysicsBindings,
  interpolationStore: PhysicsInterpolationStore | undefined
): void {
  for (const entity of world.query([bindings.body])) {
    const body = world.get(entity, bindings.body);
    if (!body?.bodyId || !body.syncToWorld) {
      continue;
    }

    const state = scene.getBodyState(body.bodyId);
    if (!state) {
      continue;
    }

    if (interpolationStore && shouldTrackInterpolation(body)) {
      recordPhysicsInterpolationBody(interpolationStore, body.bodyId, state);
    }

    if (world.get(entity, bindings.transform)) {
      world.set(entity, bindings.transform, {
        position: state.position,
        ...(state.rotation === undefined ? {} : { rotation: state.rotation })
      });
    } else {
      world.add(entity, bindings.transform, {
        position: state.position,
        ...(state.rotation === undefined ? {} : { rotation: state.rotation })
      });
    }

    if (world.get(entity, bindings.velocity)) {
      world.set(entity, bindings.velocity, {
        linear: state.linearVelocity,
        ...(state.angularVelocity === undefined ? {} : { angular: state.angularVelocity })
      });
    } else {
      world.add(entity, bindings.velocity, {
        linear: state.linearVelocity,
        ...(state.angularVelocity === undefined ? {} : { angular: state.angularVelocity })
      });
    }
  }
}

function shouldTrackInterpolation(body: PhysicsBodyComponentState): boolean {
  return body.syncToWorld && !body.syncFromWorld && body.definition.kind !== "static";
}

function withContactEntities(
  contacts: PhysicsContactEvent[],
  entityIndex: PhysicsEntityIndex
): PhysicsContactEvent[] {
  return contacts.map((contact) => ({
    ...contact,
    ...entityPatch("entityA", contact.bodyA, contact.colliderA, entityIndex),
    ...entityPatch("entityB", contact.bodyB, contact.colliderB, entityIndex)
  }));
}

function entityPatch(
  key: "entityA" | "entityB",
  bodyId: PhysicsBodyId | undefined,
  colliderId: PhysicsColliderId,
  entityIndex: PhysicsEntityIndex
): { entityA?: EntityId; entityB?: EntityId } {
  const entity =
    entityIndex.colliders.get(colliderId) ??
    (bodyId === undefined ? undefined : entityIndex.bodies.get(bodyId));
  if (entity === undefined) {
    return {};
  }

  return key === "entityA" ? { entityA: entity } : { entityB: entity };
}

function writeContacts(
  world: GameWorld,
  contacts: PhysicsContactEvent[],
  bindings: ResolvedPhysicsBindings
): void {
  const contactsByEntity = new Map<EntityId, PhysicsContactEvent[]>();
  for (const contact of contacts) {
    if (contact.entityA !== undefined) {
      const entityContacts = contactsByEntity.get(contact.entityA);
      if (entityContacts) {
        entityContacts.push(contact);
      } else {
        contactsByEntity.set(contact.entityA, [contact]);
      }
    }
    if (contact.entityB !== undefined) {
      const entityContacts = contactsByEntity.get(contact.entityB);
      if (entityContacts) {
        entityContacts.push(contact);
      } else {
        contactsByEntity.set(contact.entityB, [contact]);
      }
    }
  }

  for (const entity of world.query([bindings.contacts])) {
    if (!contactsByEntity.has(entity)) {
      world.set(entity, bindings.contacts, { contacts: [] });
    }
  }

  for (const [entity, entityContacts] of contactsByEntity.entries()) {
    if (world.get(entity, bindings.contacts)) {
      world.set(entity, bindings.contacts, { contacts: entityContacts });
    } else {
      world.add(entity, bindings.contacts, { contacts: entityContacts });
    }
  }
}

function emitContactEvents(ctx: GameInstallContext, contacts: PhysicsContactEvent[]): void {
  for (const contact of contacts) {
    ctx.eventBus.emit(`physics.${contact.kind}.${contact.phase}`, contact, "physics");
  }
}
