import { defineComponent } from "@gamekits/world";
import type { CombatProjectileState } from "../runtime/types";

export type CombatProjectileComponentState = CombatProjectileState;

export const CombatProjectileComponent = defineComponent<CombatProjectileComponentState>({
  id: "combat.projectile",
  create(data) {
    return {
      runtimeId: data?.runtimeId ?? "combat",
      projectileId: data?.projectileId ?? "projectile",
      definitionId: data?.definitionId ?? "combat.projectile",
      entityId: data?.entityId ?? "projectile",
      sourceActorId: data?.sourceActorId ?? "source",
      sourceSubject: cloneSubject(
        data?.sourceSubject ?? { actorId: data?.sourceActorId ?? "source" }
      ),
      relationshipPolicy: data?.relationshipPolicy ?? "combat.default",
      payloads: (data?.payloads ?? []).map((payload) => ({ ...payload })),
      collisionMode: data?.collisionMode ?? "ray-sweep",
      hitPolicy: data?.hitPolicy ?? "stop",
      spawnedAt: data?.spawnedAt ?? 0,
      expiresAt: data?.expiresAt ?? 1,
      previousPosition: cloneVector(data?.previousPosition ?? { x: 0, y: 0 }),
      ...(data?.sweepShape === undefined ? {} : { sweepShape: cloneShape(data.sweepShape) }),
      hitCount: data?.hitCount ?? 0,
      bounceCount: data?.bounceCount ?? 0,
      maxHits: data?.maxHits ?? 1,
      maxBounces: data?.maxBounces ?? 0,
      hitMemory: (data?.hitMemory ?? []).map((entry) => ({ ...entry })),
      executionOwnership: data?.executionOwnership ?? "independent",
      ...(data?.sourceEntityId === undefined ? {} : { sourceEntityId: data.sourceEntityId }),
      ...(data?.executionId === undefined ? {} : { executionId: data.executionId }),
      ...(data?.repeatHitCooldownMs === undefined
        ? {}
        : { repeatHitCooldownMs: data.repeatHitCooldownMs }),
      ...(data?.query === undefined ? {} : { query: cloneQuery(data.query) }),
      ...(data?.correlationId === undefined ? {} : { correlationId: data.correlationId }),
      ...(data?.parentId === undefined ? {} : { parentId: data.parentId })
    };
  }
});

function cloneSubject(subject: CombatProjectileState["sourceSubject"]) {
  return {
    ...(subject.actorId === undefined ? {} : { actorId: subject.actorId }),
    ...(subject.entityId === undefined ? {} : { entityId: subject.entityId }),
    ...(subject.bodyId === undefined ? {} : { bodyId: subject.bodyId }),
    ...(subject.colliderId === undefined ? {} : { colliderId: subject.colliderId }),
    ...(subject.position === undefined ? {} : { position: cloneVector(subject.position) }),
    ...(subject.tags === undefined ? {} : { tags: [...subject.tags] }),
    ...(subject.metadata === undefined ? {} : { metadata: { ...subject.metadata } })
  };
}

function cloneQuery(query: NonNullable<CombatProjectileState["query"]>) {
  return {
    ...(query.filter === undefined
      ? {}
      : {
          filter: {
            ...query.filter,
            ...(query.filter.groups === undefined ? {} : { groups: [...query.filter.groups] }),
            ...(query.filter.collidesWith === undefined
              ? {}
              : { collidesWith: [...query.filter.collidesWith] })
          }
        }),
    ...(query.triggerInteraction === undefined
      ? {}
      : { triggerInteraction: query.triggerInteraction }),
    ...(query.ignoreBodies === undefined ? {} : { ignoreBodies: [...query.ignoreBodies] }),
    ...(query.ignoreColliders === undefined ? {} : { ignoreColliders: [...query.ignoreColliders] }),
    ...(query.includeBodies === undefined ? {} : { includeBodies: [...query.includeBodies] }),
    ...(query.includeColliders === undefined
      ? {}
      : { includeColliders: [...query.includeColliders] })
  };
}

function cloneVector(vector: { x: number; y: number; z?: number }) {
  return {
    x: vector.x,
    y: vector.y,
    ...(vector.z === undefined ? {} : { z: vector.z })
  };
}

function cloneShape(shape: NonNullable<CombatProjectileState["sweepShape"]>) {
  if (shape.type === "polygon" || shape.type === "polyline") {
    return { ...shape, points: shape.points.map(cloneVector) };
  }
  if (shape.type === "custom") {
    return { ...shape, props: { ...shape.props } };
  }
  return { ...shape };
}
