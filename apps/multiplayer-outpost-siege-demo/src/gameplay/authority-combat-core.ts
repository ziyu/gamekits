import {
  createCombatModule,
  sampleCombatKinematicProjectileRecord,
  type CombatDeliveryRejection,
  type CombatHitResult,
  type CombatProjectileDespawnFact,
  type CombatProjectileSpawnFact
} from "@gamekits/combat";
import { PhysicsTransformComponent, type PhysicsVector } from "@gamekits/physics-core";

import { OUTPOST_ARENA } from "../content";
import { combatObjectIdForActor, type CombatState } from "./authority-combat-state";
import {
  OUTPOST_PROJECTILE_FIXED_DELTA_MS,
  OUTPOST_RIFLE_PROJECTILE_DEFINITION_VERSION,
  outpostProjectileTick,
  outpostRifleProjectileFirePosition
} from "./rifle-projectile-network";

export type OutpostCombatCoreIntegration = {
  module: ReturnType<typeof createCombatModule>;
  rememberAim(actorId: string, point: PhysicsVector): void;
  dispose(): void;
};

export function createOutpostCombatCoreIntegration(
  state: CombatState,
  onHit: (
    hit: CombatHitResult,
    context: { correlationId?: string | undefined; parentId?: string | undefined }
  ) => void
): OutpostCombatCoreIntegration {
  const aimByActorId = new Map<string, PhysicsVector>();
  const offHit = state.options.eventBus.on<CombatHitResult>("combat.hit_resolved", (event) => {
    onHit(event.payload, {
      ...(event.correlationId === undefined ? {} : { correlationId: event.correlationId }),
      ...(event.parentId === undefined ? {} : { parentId: event.parentId })
    });
  });
  const offProjectileSpawned = state.options.eventBus.on<CombatProjectileSpawnFact>(
    "combat.projectile_spawned",
    (event) => {
      const fact = event.payload;
      const fireTick = outpostProjectileTick(fact.spawnedAt);
      const projectileRecordId = authorityProjectileRecordId(state, fact);
      state.projectileRecordIdsByAuthorityId.set(fact.projectileId, projectileRecordId);
      state.projectileRecords.upsert({
        projectileId: projectileRecordId,
        correlationId: fact.correlationId ?? fact.projectileId,
        generation: state.projectileGeneration,
        definitionId: fact.definitionId,
        definitionVersion: OUTPOST_RIFLE_PROJECTILE_DEFINITION_VERSION,
        fireTick,
        fixedDeltaMs: OUTPOST_PROJECTILE_FIXED_DELTA_MS,
        firePosition: { ...fact.position },
        fireVelocity: { ...fact.velocity },
        expiresTick:
          fireTick +
          Math.max(
            1,
            Math.ceil((fact.expiresAt - fact.spawnedAt) / OUTPOST_PROJECTILE_FIXED_DELTA_MS)
          )
      });
      state.cueStream.append({
        kind: "projectile-spawned",
        at: state.elapsedMs,
        projectileId: fact.projectileId,
        sourceObjectId: combatObjectIdForActor(state, fact.sourceActorId),
        position: fact.position,
        direction: normalizeDirection(fact.velocity),
        correlationId: event.correlationId ?? fact.correlationId,
        parentId: event.parentId ?? fact.parentId
      });
    }
  );
  const offProjectileDespawned = state.options.eventBus.on<CombatProjectileDespawnFact>(
    "combat.projectile_despawned",
    (event) => {
      const fact = event.payload;
      const recordId = state.projectileRecordIdsByAuthorityId.get(fact.projectileId);
      const record = recordId === undefined ? undefined : state.projectileRecords.get(recordId);
      if (record !== undefined) {
        const elapsedFinishTick = Math.max(
          record.fireTick,
          Math.min(record.expiresTick, outpostProjectileTick(state.elapsedMs))
        );
        const sampled = sampleCombatKinematicProjectileRecord(record, elapsedFinishTick);
        const finishPosition = fact.impact?.point ?? fact.finalPosition ?? sampled.position;
        const finishTick = resolveProjectileFinishTick(
          record,
          fact.reason,
          finishPosition,
          elapsedFinishTick
        );
        state.projectileRecords.upsert({
          ...record,
          finish: {
            tick: finishTick,
            reason: fact.impact === undefined ? fact.reason : "impact",
            position: { ...finishPosition },
            ...(fact.impact?.normal === undefined ? {} : { normal: { ...fact.impact.normal } }),
            ...(fact.impact === undefined
              ? {}
              : {
                  subject: {
                    ...(fact.impact.subject.actorId === undefined
                      ? {}
                      : { actorId: fact.impact.subject.actorId }),
                    ...(fact.impact.subject.entityId === undefined
                      ? {}
                      : { entityId: fact.impact.subject.entityId }),
                    ...(fact.impact.subject.bodyId === undefined
                      ? {}
                      : { bodyId: fact.impact.subject.bodyId }),
                    ...(fact.impact.subject.colliderId === undefined
                      ? {}
                      : { colliderId: fact.impact.subject.colliderId })
                  }
                })
          }
        });
      }
      state.projectileRecordIdsByAuthorityId.delete(fact.projectileId);
      const worldImpact = fact.impact?.disposition === "blocker";
      const miss = fact.reason === "expired" || fact.reason === "out-of-bounds";
      if (!worldImpact && !miss) {
        return;
      }
      const targetActorId = fact.impact?.subject.actorId;
      const targetObjectId =
        targetActorId === undefined
          ? fact.impact?.subject.entityId === undefined
            ? undefined
            : state.objectsByEntityId.get(fact.impact.subject.entityId)?.id
          : combatObjectIdForActor(state, targetActorId);
      state.cueStream.append({
        kind: worldImpact ? "world-impact" : "miss",
        at: state.elapsedMs,
        projectileId: fact.projectileId,
        sourceObjectId:
          fact.sourceActorId === undefined
            ? undefined
            : combatObjectIdForActor(state, fact.sourceActorId),
        targetObjectId,
        position: fact.impact?.point ?? fact.finalPosition,
        normal: fact.impact?.normal,
        correlationId: event.correlationId ?? fact.correlationId,
        parentId: event.parentId ?? fact.parentId,
        reason: fact.reason
      });
    }
  );
  const offDeliveryRejected = state.options.eventBus.on<CombatDeliveryRejection>(
    "combat.delivery_rejected",
    (event) => {
      state.cueStream.append({
        kind: "action-rejected",
        at: state.elapsedMs,
        correlationId: event.correlationId ?? event.payload.correlationId,
        parentId: event.parentId,
        reason: event.payload.reason
      });
    }
  );
  const module = createCombatModule({
    id: "outpost.authority.combat-core",
    dataRegistry: state.options.dataRegistry,
    gas: state.options.gas,
    physics: state.options.physics,
    handle: state.options.combat,
    traceStore: state.options.combatTrace,
    relationshipResolver: {
      resolve(source, target) {
        if (source.actorId !== undefined && source.actorId === target.actorId) {
          return "self";
        }
        const sourceTeam = teamTag(source.tags);
        const targetTeam = teamTag(target.tags);
        return sourceTeam !== undefined && sourceTeam === targetTeam ? "ally" : "hostile";
      },
      allows(policyId, relationship) {
        return policyId === "combat.outpost.relationship.hostile" && relationship === "hostile";
      }
    },
    projectileBounds: {
      min: { x: 0, y: 0 },
      max: { x: OUTPOST_ARENA.width, y: OUTPOST_ARENA.height }
    },
    limits: {
      maxActiveProjectiles: 256,
      maxCandidatesPerRequest: 96,
      maxTargetsPerRequest: 64,
      maxProjectileLifetimeMs: 4_000,
      recentDeliveryLimit: 192,
      resolvedTicketLimit: 2_048
    },
    abilityDelivery: {
      resolveRequest({ binding, execution }) {
        const origin = actorPosition(state, execution.actorId);
        if (origin === undefined) {
          return false;
        }
        if (binding.id === "combat.outpost.binding.rifle") {
          const aim =
            aimByActorId.get(execution.actorId) ??
            (execution.targetActorId === undefined
              ? undefined
              : actorPosition(state, execution.targetActorId));
          if (aim === undefined) {
            return false;
          }
          const direction = normalizedDelta(origin, aim);
          return {
            origin,
            position: outpostRifleProjectileFirePosition(origin, direction),
            direction
          };
        }
        return { origin, position: origin };
      },
      onResult({ execution }) {
        aimByActorId.delete(execution.actorId);
      },
      onError({ execution }) {
        aimByActorId.delete(execution.actorId);
      }
    }
  });

  return {
    module,
    rememberAim(actorId, point) {
      aimByActorId.set(actorId, { ...point });
    },
    dispose() {
      offDeliveryRejected();
      offProjectileDespawned();
      offProjectileSpawned();
      offHit();
      aimByActorId.clear();
      state.projectileRecordIdsByAuthorityId.clear();
      state.projectileRecords.dispose();
    }
  };
}

function authorityProjectileRecordId(state: CombatState, fact: CombatProjectileSpawnFact): string {
  const player = [...state.options.players().values()].find(
    (candidate) => candidate.actorId === fact.sourceActorId
  );
  return player === undefined
    ? fact.projectileId
    : `${fact.projectileId}:owner-generation:${player.generation}`;
}

function resolveProjectileFinishTick(
  record: Parameters<typeof sampleCombatKinematicProjectileRecord>[0],
  reason: string,
  position: PhysicsVector,
  elapsedFinishTick: number
): number {
  if (reason === "expired") {
    return record.expiresTick;
  }
  const speed = Math.hypot(record.fireVelocity.x, record.fireVelocity.y);
  if (speed <= Number.EPSILON) {
    return elapsedFinishTick;
  }
  const distance = Math.hypot(
    position.x - record.firePosition.x,
    position.y - record.firePosition.y
  );
  const distancePerTick = speed * (record.fixedDeltaMs / 1000);
  const travelTicks = Math.max(1, Math.ceil(distance / distancePerTick));
  return Math.max(record.fireTick, Math.min(record.expiresTick, record.fireTick + travelTicks));
}

function normalizeDirection(vector: PhysicsVector): PhysicsVector {
  const length = Math.hypot(vector.x, vector.y);
  return length <= 0.0001 ? { x: 1, y: 0 } : { x: vector.x / length, y: vector.y / length };
}

function actorPosition(state: CombatState, actorId: string): PhysicsVector | undefined {
  if (!state.options.gas.hasActor(actorId)) {
    return undefined;
  }
  const entityId = state.options.gas.getActor(actorId).actor.entityId;
  if (entityId === undefined) {
    return undefined;
  }
  return state.options.world.get(entityId, PhysicsTransformComponent)?.position;
}

function normalizedDelta(from: PhysicsVector, to: PhysicsVector): PhysicsVector {
  const x = to.x - from.x;
  const y = to.y - from.y;
  const length = Math.hypot(x, y);
  return length <= 0.0001 ? { x: 1, y: 0 } : { x: x / length, y: y / length };
}

function teamTag(tags: string[] | undefined): string | undefined {
  return tags?.find((tag) => tag.startsWith("team."));
}
