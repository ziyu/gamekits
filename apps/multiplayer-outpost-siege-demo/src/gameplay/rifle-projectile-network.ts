import type {
  CombatKinematicProjectileDefinition,
  CombatQueryOptions,
  CombatProjectileDefinition
} from "@gamekits/combat";
import type { DataRegistry } from "@gamekits/data";
import type {
  PhysicsBodyData,
  PhysicsColliderData,
  PhysicsQueryOptions
} from "@gamekits/physics-core";

export const OUTPOST_RIFLE_PROJECTILE_DEFINITION_ID = "combat.outpost.projectile.rifle";
export const OUTPOST_RIFLE_PROJECTILE_DEFINITION_VERSION = "outpost.rifle-projectile.v1";
export const OUTPOST_PROJECTILE_FIXED_DELTA_MS = 1000 / 60;
export const OUTPOST_PROJECTILE_RECORD_LIMIT = 128;
export const OUTPOST_RIFLE_PROJECTILE_MUZZLE_OFFSET = 34;

export function resolveOutpostRifleKinematicProjectileDefinition(
  dataRegistry: DataRegistry,
  definitionId: string,
  definitionVersion: string
): CombatKinematicProjectileDefinition | undefined {
  if (
    definitionId !== OUTPOST_RIFLE_PROJECTILE_DEFINITION_ID ||
    definitionVersion !== OUTPOST_RIFLE_PROJECTILE_DEFINITION_VERSION
  ) {
    return undefined;
  }
  const projectile = dataRegistry.getValue<CombatProjectileDefinition>(
    "combat.projectile",
    definitionId
  );
  const lifetimeTicks = Math.max(
    1,
    Math.ceil(projectile.lifetimeMs / OUTPOST_PROJECTILE_FIXED_DELTA_MS)
  );
  if (projectile.collisionMode === "shape-sweep") {
    const body = dataRegistry.getValue<PhysicsBodyData>(projectile.body.type, projectile.body.id);
    const colliderRef = body.colliders?.[0];
    if (colliderRef === undefined) {
      throw new Error(`Outpost Rifle projectile body requires a collider: ${body.id}`);
    }
    const collider = dataRegistry.getValue<PhysicsColliderData>(colliderRef.type, colliderRef.id);
    return {
      id: definitionId,
      version: definitionVersion,
      collisionMode: "shape-sweep",
      lifetimeTicks,
      sweepShape: collider.shape,
      query: toPhysicsQueryOptions(projectile.query)
    };
  }
  return {
    id: definitionId,
    version: definitionVersion,
    collisionMode: "ray-sweep",
    lifetimeTicks,
    query: toPhysicsQueryOptions(projectile.query)
  };
}

export function outpostProjectileTick(elapsedMs: number): number {
  return Math.max(0, Math.round(elapsedMs / OUTPOST_PROJECTILE_FIXED_DELTA_MS));
}

export function outpostRifleProjectileFirePosition(
  origin: { x: number; y: number },
  direction: { x: number; y: number }
): { x: number; y: number } {
  return {
    x: origin.x + direction.x * OUTPOST_RIFLE_PROJECTILE_MUZZLE_OFFSET,
    y: origin.y + direction.y * OUTPOST_RIFLE_PROJECTILE_MUZZLE_OFFSET
  };
}

function toPhysicsQueryOptions(
  query: CombatQueryOptions | undefined
): PhysicsQueryOptions | undefined {
  return query === undefined
    ? undefined
    : {
        ...(query.filter === undefined ? {} : { filter: { ...query.filter } }),
        ...(query.triggerInteraction === undefined
          ? {}
          : { triggerInteraction: query.triggerInteraction }),
        ...(query.ignoreBodies === undefined ? {} : { ignoreBodies: [...query.ignoreBodies] }),
        ...(query.ignoreColliders === undefined
          ? {}
          : { ignoreColliders: [...query.ignoreColliders] }),
        ...(query.includeBodies === undefined ? {} : { includeBodies: [...query.includeBodies] }),
        ...(query.includeColliders === undefined
          ? {}
          : { includeColliders: [...query.includeColliders] })
      };
}
