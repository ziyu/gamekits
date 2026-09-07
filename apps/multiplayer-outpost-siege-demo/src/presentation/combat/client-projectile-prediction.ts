import {
  cloneCombatKinematicProjectileRecord,
  createCombatKinematicProjectileRecordBuffer,
  createCombatKinematicProjectileRuntime,
  type CombatKinematicProjectileRecord,
  type CombatKinematicProjectileSample,
  type CombatProjectileDefinition
} from "@gamekits/combat";
import { createStandardCombatKinematicProjectilePresentationTransition } from "@gamekits/app-host";
import type { DataRegistry } from "@gamekits/data";
import { createMultiplayerPredictedLifecycleDomain } from "@gamekits/multiplayer-core";
import {
  createPhysicsLayoutDefinitions,
  raycast as raycastPhysicsScene,
  shapeCast as shapeCastPhysicsScene,
  type PhysicsBackendAdapter,
  type PhysicsBodyData,
  type PhysicsColliderData,
  type PhysicsKinematicSweepQueries,
  type PhysicsScene
} from "@gamekits/physics-core";

import {
  createOutpostArenaPhysicsSceneConfig,
  OUTPOST_ARENA_PHYSICS_LAYOUT_ID
} from "../../content";
import {
  OUTPOST_BUILDABLE_TYPE,
  OUTPOST_ENEMY_TYPE,
  OUTPOST_PLAYER_TYPE,
  type OutpostBuildableDefinition,
  type OutpostEnemyDefinition,
  type OutpostPlayerDefinition,
  type OutpostReplicatedActor
} from "../../domain";
import {
  OUTPOST_PROJECTILE_FIXED_DELTA_MS,
  OUTPOST_PROJECTILE_RECORD_LIMIT,
  OUTPOST_RIFLE_PROJECTILE_DEFINITION_ID,
  OUTPOST_RIFLE_PROJECTILE_DEFINITION_VERSION,
  outpostRifleProjectileFirePosition,
  resolveOutpostRifleKinematicProjectileDefinition
} from "../../gameplay/rifle-projectile-network";

export type OutpostProjectilePredictionFrame = {
  generation: string;
  authorityElapsedMs: number;
  actors: readonly OutpostReplicatedActor[];
  records: readonly CombatKinematicProjectileRecord[];
};

export type OutpostClientProjectilePrediction = {
  sync(frame: OutpostProjectilePredictionFrame | undefined, elapsed: number): void;
  anticipate(input: {
    correlationId: string;
    position: { x: number; y: number };
    aim: { x: number; y: number };
    elapsed: number;
  }): CombatKinematicProjectileRecord | undefined;
  cancel(correlationId: string, elapsed: number, reason?: string): void;
  sample(projectileId: string, elapsed: number): CombatKinematicProjectileSample | undefined;
  listAuthoritySamples(elapsed: number): Array<{
    record: CombatKinematicProjectileRecord;
    sample: CombatKinematicProjectileSample;
  }>;
  correlationId(projectileId: string): string | undefined;
  hasLocalPrediction(projectileId: string): boolean;
  diagnostics(): OutpostClientProjectilePredictionDiagnostics;
  dispose(): void;
};

export type OutpostClientProjectilePredictionDiagnostics = {
  authorityTick: number;
  preventedTimelineRewinds: number;
  acceptedAuthorityTimelines: number;
  correctedTrajectories: number;
  activeCorrections: number;
  lastAuthorityFireTickOffset?: number | undefined;
};

type ActorProxy = {
  signature: string;
  bodyId: string;
  colliderIds: string[];
};

const UNBOUND_GENERATION = "outpost.unbound";
const OUTPOST_PROJECTILE_SPAWN_KIND = "combat.kinematic-projectile";
const LOCAL_FIRE_POSITION_TOLERANCE = 32;
const LOCAL_FIRE_SPEED_TOLERANCE = 1;
const LOCAL_FIRE_DIRECTION_TOLERANCE_RADIANS = (4 * Math.PI) / 180;
const MIN_TRAJECTORY_CORRECTION_MS = 100;
const MAX_TRAJECTORY_CORRECTION_MS = 260;
const REMOTE_PROJECTILE_PRESENTATION_DELAY_MS = 100;

export function createOutpostClientProjectilePrediction(options: {
  dataRegistry: DataRegistry;
  physicsBackend: PhysicsBackendAdapter;
  id: string;
}): OutpostClientProjectilePrediction {
  const scene = createPredictionScene(options);
  const queries: PhysicsKinematicSweepQueries = {
    raycast(origin, direction, query) {
      return raycastPhysicsScene(scene, origin, direction, query);
    },
    shapeCast(shape, position, direction, query) {
      return shapeCastPhysicsScene(scene, shape, position, direction, query);
    }
  };
  const actorProxies = new Map<string, ActorProxy>();
  const actorIdByColliderId = new Map<string, string>();
  const presentationTransition = createStandardCombatKinematicProjectilePresentationTransition({
    reconciliation: {
      timeline: "shot-relative",
      firePositionTolerance: LOCAL_FIRE_POSITION_TOLERANCE,
      fireSpeedTolerance: LOCAL_FIRE_SPEED_TOLERANCE,
      fireDirectionToleranceRadians: LOCAL_FIRE_DIRECTION_TOLERANCE_RADIANS,
      finishPositionTolerance: LOCAL_FIRE_POSITION_TOLERANCE,
      finishTickTolerance: 2
    },
    minCorrectionMs: MIN_TRAJECTORY_CORRECTION_MS,
    maxCorrectionMs: MAX_TRAJECTORY_CORRECTION_MS,
    maxEntries: OUTPOST_PROJECTILE_RECORD_LIMIT
  });
  const authorityRecords = createCombatKinematicProjectileRecordBuffer({
    generation: UNBOUND_GENERATION,
    capacity: OUTPOST_PROJECTILE_RECORD_LIMIT
  });
  const localRuntime = createCombatKinematicProjectileRuntime({
    queries,
    generation: UNBOUND_GENERATION,
    fixedDeltaMs: OUTPOST_PROJECTILE_FIXED_DELTA_MS,
    maxActiveProjectiles: 16,
    maxRecords: OUTPOST_PROJECTILE_RECORD_LIMIT,
    maxCatchUpTicksPerAdvance: 12,
    resolveDefinition(definitionId, definitionVersion) {
      return resolveOutpostRifleKinematicProjectileDefinition(
        options.dataRegistry,
        definitionId,
        definitionVersion
      );
    },
    resolveSubject(hit) {
      const actorId = actorIdByColliderId.get(hit.colliderId);
      return actorId === undefined
        ? {
            ...(hit.bodyId === undefined ? {} : { bodyId: hit.bodyId }),
            colliderId: hit.colliderId
          }
        : {
            actorId,
            ...(hit.bodyId === undefined ? {} : { bodyId: hit.bodyId }),
            colliderId: hit.colliderId
          };
    }
  });
  const lifecycle = createMultiplayerPredictedLifecycleDomain<
    CombatKinematicProjectileRecord,
    CombatKinematicProjectileRecord
  >({
    kind: OUTPOST_PROJECTILE_SPAWN_KIND,
    generation: UNBOUND_GENERATION,
    stepMs: OUTPOST_PROJECTILE_FIXED_DELTA_MS,
    maxPending: 16,
    maxResolved: OUTPOST_PROJECTILE_RECORD_LIMIT,
    maxAgeTicks: Math.ceil(1_000 / OUTPOST_PROJECTILE_FIXED_DELTA_MS),
    maxBindings: OUTPOST_PROJECTILE_RECORD_LIMIT,
    clonePredicted: cloneCombatKinematicProjectileRecord,
    cloneAuthority: cloneCombatKinematicProjectileRecord,
    hooks: {
      onPredictionRemoved({ prediction, reason, atTick, detail }) {
        localRuntime.cancel(
          prediction.localId,
          atTick,
          reason === "expired" ? "prediction-timeout" : (detail ?? reason)
        );
        presentationTransition.remove(prediction.generation, prediction.correlationId);
      },
      onBindingRemoved({ binding }) {
        presentationTransition.remove(binding.generation, binding.correlationId);
      },
      onReset({ generation }) {
        const nextGeneration = String(generation);
        localRuntime.reset(nextGeneration);
        authorityRecords.reset(nextGeneration);
        presentationTransition.reset();
      }
    }
  });
  let disposed = false;

  return {
    sync(frame, elapsed) {
      assertActive();
      if (frame === undefined) {
        return;
      }
      const records = frame.records.filter(
        (record) => String(record.generation) === frame.generation
      );
      lifecycle.sync({
        generation: frame.generation,
        authorityTime: frame.authorityElapsedMs,
        localTime: elapsed,
        authoritySpawns: records.map((record) => ({
          correlationId: record.correlationId,
          authorityId: record.projectileId,
          tick: record.fireTick,
          value: record
        }))
      });
      syncActorProxies(frame.actors);
      scene.step(0);
      authorityRecords.reset(frame.generation);
      for (const record of records) {
        authorityRecords.upsert(record);
      }
      localRuntime.advanceTo(lifecycle.authorityTick(elapsed));
    },
    anticipate(input) {
      assertActive();
      const generation = String(lifecycle.generation());
      if (generation === UNBOUND_GENERATION) {
        return undefined;
      }
      const direction = normalizedDirection({
        x: input.aim.x - input.position.x,
        y: input.aim.y - input.position.y
      });
      if (direction === undefined) {
        return undefined;
      }
      const projectile = options.dataRegistry.getValue<CombatProjectileDefinition>(
        "combat.projectile",
        OUTPOST_RIFLE_PROJECTILE_DEFINITION_ID
      );
      const origin = outpostRifleProjectileFirePosition(input.position, direction);
      const projectileId = `${input.correlationId}.projectile`;
      const result = localRuntime.fire({
        projectileId,
        correlationId: input.correlationId,
        generation,
        definitionId: OUTPOST_RIFLE_PROJECTILE_DEFINITION_ID,
        definitionVersion: OUTPOST_RIFLE_PROJECTILE_DEFINITION_VERSION,
        fireTick: lifecycle.authorityTick(input.elapsed),
        firePosition: origin,
        fireVelocity: {
          x: direction.x * (projectile.speed ?? 0),
          y: direction.y * (projectile.speed ?? 0)
        }
      });
      if (result.record !== undefined) {
        lifecycle.register({
          correlationId: input.correlationId,
          localId: projectileId,
          tick: result.record.fireTick,
          value: result.record
        });
      }
      return result.record;
    },
    cancel(correlationId, elapsed, reason = "rejected") {
      assertActive();
      lifecycle.reject(correlationId, lifecycle.authorityTick(elapsed), reason);
    },
    sample(projectileId, elapsed) {
      assertActive();
      return sampleProjectile(projectileId, elapsed);
    },
    listAuthoritySamples(elapsed) {
      assertActive();
      return authorityRecords.list().flatMap((record) => {
        const sample = sampleProjectile(record.projectileId, elapsed);
        return sample === undefined ? [] : [{ record, sample }];
      });
    },
    correlationId(projectileId) {
      assertActive();
      const direct =
        localRuntime.getRecord(projectileId)?.correlationId ??
        authorityRecords.get(projectileId)?.correlationId;
      if (direct !== undefined) {
        return direct;
      }
      return lifecycle.correlationId(projectileId);
    },
    hasLocalPrediction(projectileId) {
      assertActive();
      if (localRuntime.getRecord(projectileId) !== undefined) {
        return true;
      }
      const local = lifecycle.localIdentity(projectileId);
      return local !== undefined && localRuntime.getRecord(local.localId) !== undefined;
    },
    diagnostics() {
      assertActive();
      const lifecycleDiagnostics = lifecycle.diagnostics();
      const transitionDiagnostics = presentationTransition.diagnostics();
      return {
        authorityTick: lifecycleDiagnostics.timeline.authorityTick,
        preventedTimelineRewinds: lifecycleDiagnostics.timeline.preventedRewinds,
        acceptedAuthorityTimelines: transitionDiagnostics.confirmedTrajectories,
        correctedTrajectories: transitionDiagnostics.correctedTrajectories,
        activeCorrections: transitionDiagnostics.activeCorrections,
        ...(transitionDiagnostics.lastFireTickOffset === undefined
          ? {}
          : { lastAuthorityFireTickOffset: transitionDiagnostics.lastFireTickOffset })
      };
    },
    dispose() {
      if (disposed) {
        return;
      }
      disposed = true;
      for (const objectId of actorProxies.keys()) {
        removeActorProxy(objectId);
      }
      localRuntime.dispose();
      authorityRecords.dispose();
      lifecycle.dispose();
      presentationTransition.dispose();
      scene.dispose();
    }
  };

  function sampleProjectile(
    projectileId: string,
    elapsed: number
  ): CombatKinematicProjectileSample | undefined {
    let predicted = localRuntime.getRecord(projectileId);
    let authoritative = authorityRecords.get(projectileId);
    const correlationId =
      predicted?.correlationId ??
      authoritative?.correlationId ??
      lifecycle.correlationId(projectileId);
    if (correlationId !== undefined) {
      const binding = lifecycle.binding(correlationId);
      const local = lifecycle.localIdentity(correlationId);
      predicted ??= localRuntime.getRecord(binding?.localId ?? local?.localId ?? projectileId);
      authoritative ??= authorityRecords.get(binding?.authorityId ?? projectileId);
    }
    const presentationTick = Math.max(
      0,
      lifecycle.authoritySampleTick(elapsed) -
        (predicted === undefined
          ? REMOTE_PROJECTILE_PRESENTATION_DELAY_MS / OUTPOST_PROJECTILE_FIXED_DELTA_MS
          : 0)
    );
    return presentationTransition.sample({
      ...(predicted === undefined ? {} : { predicted }),
      ...(authoritative === undefined ? {} : { authoritative }),
      authorityTick: presentationTick,
      elapsedMs: elapsed
    });
  }

  function syncActorProxies(actors: readonly OutpostReplicatedActor[]): void {
    const desired = new Set<string>();
    for (const actor of actors) {
      if (actor.kind !== "enemy" || actor.health <= 0) {
        continue;
      }
      desired.add(actor.objectId);
      const signature = `${actor.networkEntityId}:${actor.generation}:${actor.definitionId}`;
      const current = actorProxies.get(actor.objectId);
      if (current?.signature !== signature) {
        if (current !== undefined) {
          removeActorProxy(actor.objectId);
        }
        createActorProxy(actor, signature);
      } else {
        scene.updateBody(current.bodyId, {
          position: { x: actor.x, y: actor.y },
          rotation: actor.facing
        });
      }
    }
    for (const objectId of actorProxies.keys()) {
      if (!desired.has(objectId)) {
        removeActorProxy(objectId);
      }
    }
  }

  function createActorProxy(actor: OutpostReplicatedActor, signature: string): void {
    const bodyData = resolveActorBody(options.dataRegistry, actor);
    const bodyId = `outpost.client-projectile.actor.${safeId(actor.objectId)}.body`;
    const { id: _id, colliders: _colliders, tags: _tags, ...body } = bodyData;
    scene.createBody({
      ...body,
      id: bodyId,
      kind: "kinematic",
      position: { x: actor.x, y: actor.y },
      rotation: actor.facing,
      linearVelocity: { x: 0, y: 0 },
      userData: { ...body.userData, outpostObjectId: actor.objectId }
    });
    const colliderIds: string[] = [];
    try {
      for (const [index, colliderRef] of (bodyData.colliders ?? []).entries()) {
        const colliderData = options.dataRegistry.getValue<PhysicsColliderData>(
          colliderRef.type,
          colliderRef.id
        );
        const colliderId = `outpost.client-projectile.actor.${safeId(actor.objectId)}.${index}.collider`;
        const { id: _colliderId, bodyId: _bodyId, tags: _colliderTags, ...collider } = colliderData;
        scene.createCollider({
          ...collider,
          id: colliderId,
          bodyId,
          userData: { ...collider.userData, outpostObjectId: actor.objectId }
        });
        colliderIds.push(colliderId);
        actorIdByColliderId.set(colliderId, actor.objectId);
      }
      actorProxies.set(actor.objectId, { signature, bodyId, colliderIds });
    } catch (error) {
      for (const colliderId of colliderIds) {
        actorIdByColliderId.delete(colliderId);
        scene.destroyCollider(colliderId);
      }
      scene.destroyBody(bodyId);
      throw error;
    }
  }

  function removeActorProxy(objectId: string): void {
    const proxy = actorProxies.get(objectId);
    if (proxy === undefined) {
      return;
    }
    actorProxies.delete(objectId);
    for (const colliderId of proxy.colliderIds) {
      actorIdByColliderId.delete(colliderId);
      scene.destroyCollider(colliderId);
    }
    scene.destroyBody(proxy.bodyId);
  }

  function assertActive(): void {
    if (disposed) {
      throw new Error("Outpost client projectile prediction is disposed.");
    }
  }
}

function createPredictionScene(options: {
  dataRegistry: DataRegistry;
  physicsBackend: PhysicsBackendAdapter;
  id: string;
}): PhysicsScene {
  const sceneConfig = createOutpostArenaPhysicsSceneConfig(options.dataRegistry);
  const scene = options.physicsBackend.createScene({
    ...sceneConfig,
    id: `outpost.client-projectile.${safeId(options.id)}`,
    fixedDeltaMs: OUTPOST_PROJECTILE_FIXED_DELTA_MS
  });
  const layout = createPhysicsLayoutDefinitions({
    dataRegistry: options.dataRegistry,
    layoutId: OUTPOST_ARENA_PHYSICS_LAYOUT_ID,
    idPrefix: `outpost.client-projectile.${safeId(options.id)}.arena`
  });
  try {
    for (const body of layout.bodies) {
      if (body.enabled) {
        scene.createBody({
          ...body.definition,
          position: body.position,
          ...(body.rotation === undefined ? {} : { rotation: body.rotation })
        });
      }
    }
    for (const collider of layout.colliders) {
      if (collider.enabled) {
        scene.createCollider(collider.definition);
      }
    }
    scene.step(0);
    return scene;
  } catch (error) {
    scene.dispose();
    throw error;
  }
}

function resolveActorBody(
  dataRegistry: DataRegistry,
  actor: OutpostReplicatedActor
): PhysicsBodyData {
  const ref =
    actor.kind === "player"
      ? dataRegistry.getValue<OutpostPlayerDefinition>(OUTPOST_PLAYER_TYPE, actor.definitionId)
          .physicsBody
      : actor.kind === "enemy"
        ? dataRegistry.getValue<OutpostEnemyDefinition>(OUTPOST_ENEMY_TYPE, actor.definitionId)
            .physicsBody
        : dataRegistry.getValue<OutpostBuildableDefinition>(
            OUTPOST_BUILDABLE_TYPE,
            actor.definitionId
          ).physicsBody;
  return dataRegistry.getValue<PhysicsBodyData>(ref.type, ref.id);
}

function normalizedDirection(vector: {
  x: number;
  y: number;
}): { x: number; y: number } | undefined {
  const length = Math.hypot(vector.x, vector.y);
  return length <= Number.EPSILON ? undefined : { x: vector.x / length, y: vector.y / length };
}

function safeId(value: string): string {
  return value.replace(/[^a-zA-Z0-9_.-]/g, "_");
}
