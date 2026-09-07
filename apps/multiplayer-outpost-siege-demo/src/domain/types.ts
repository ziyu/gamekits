import type { AssetRef } from "@gamekits/asset";
import type { DataRef } from "@gamekits/data";
import type { RenderObjectType } from "@gamekits/renderer-core";
import type { EntityId } from "@gamekits/world";

export type OutpostCombatAbility = "rifle" | "dash" | "shock-field" | "deploy-turret";
export type OutpostDiscreteCombatAbility = Exclude<OutpostCombatAbility, "rifle">;

export const OUTPOST_PLAYER_TYPE = "outpost.player";
export const OUTPOST_MOVEMENT_PROFILE_TYPE = "outpost.movement-profile";
export const OUTPOST_ENEMY_TYPE = "outpost.enemy";
export const OUTPOST_WEAPON_TYPE = "outpost.weapon";
export const OUTPOST_BUILDABLE_TYPE = "outpost.buildable";
export const OUTPOST_WAVE_TYPE = "outpost.wave";
export const OUTPOST_OBJECTIVE_TYPE = "outpost.objective";
export const OUTPOST_RENDER_OBJECT_TYPE = "render.object";
export const OUTPOST_ARENA_TYPE = "outpost.arena";

export type OutpostAssetGroup = "boot" | "match" | "combat" | "boss";

export type OutpostRenderObjectDefinition = {
  id: string;
  type: RenderObjectType;
  assetRefs: Record<string, AssetRef>;
  facingOffsetRadians?: number | undefined;
  layer?: string | undefined;
  tags?: string[] | undefined;
};

export type OutpostArenaStaticObjectDefinition = {
  id: string;
  renderObject: DataRef<typeof OUTPOST_RENDER_OBJECT_TYPE>;
  collider: DataRef<"physics.collider">;
  position: { x: number; y: number };
  size: { width: number; height: number };
  rotation?: number | undefined;
  depth?: number | undefined;
};

export type OutpostArenaDefinition = {
  id: string;
  width: number;
  height: number;
  floor: DataRef<typeof OUTPOST_RENDER_OBJECT_TYPE>;
  staticObjects: OutpostArenaStaticObjectDefinition[];
};

export type OutpostPlayerDefinition = {
  id: string;
  actor: DataRef<"gas.actor">;
  weapon: DataRef<typeof OUTPOST_WEAPON_TYPE>;
  physicsBody: DataRef<"physics.body">;
  renderObject: DataRef<typeof OUTPOST_RENDER_OBJECT_TYPE>;
  movementProfile: DataRef<typeof OUTPOST_MOVEMENT_PROFILE_TYPE>;
};

export type OutpostMovementProfileDefinition = {
  id: string;
  maxSpeed: number;
  acceleration: number;
  deceleration: number;
  staminaRecoveryPerSecond: number;
  dashSpeed: number;
  dashDurationMs: number;
  dashCollisionVelocityRatio: number;
  cameraLookaheadDistance: number;
  cameraLookaheadResponse: number;
  cameraDashImpulse: number;
};

export type OutpostEnemyDefinition = {
  id: string;
  role: "melee" | "ranged" | "boss";
  actor: DataRef<"gas.actor">;
  attackAbility: DataRef<"gas.ability">;
  physicsBody: DataRef<"physics.body">;
  renderObject: DataRef<typeof OUTPOST_RENDER_OBJECT_TYPE>;
  aiAgent: DataRef<"ai.agent">;
  moveSpeed: number;
  attackRange: number;
  attackDamage: number;
};

export type OutpostWeaponDefinition = {
  id: string;
  ability: DataRef<"gas.ability">;
  reloadAbility: DataRef<"gas.ability">;
  projectileBody: DataRef<"physics.body">;
  projectileRenderObject: DataRef<typeof OUTPOST_RENDER_OBJECT_TYPE>;
  fireIntervalMs: number;
  magazineSize: number;
  reserveAmmo: number;
  reloadDurationMs: number;
  damage: number;
  projectileSpeed: number;
  projectileLifetimeMs: number;
};

export type OutpostBuildableDefinition = {
  id: string;
  actor: DataRef<"gas.actor">;
  deployAbility: DataRef<"gas.ability">;
  physicsBody: DataRef<"physics.body">;
  renderObject: DataRef<typeof OUTPOST_RENDER_OBJECT_TYPE>;
  resourceCost: number;
  placementRange: number;
};

export type OutpostWaveSpawn = {
  enemy: DataRef<typeof OUTPOST_ENEMY_TYPE>;
  count: number;
};

export type OutpostWaveDefinition = {
  id: string;
  index: number;
  objective: DataRef<typeof OUTPOST_OBJECTIVE_TYPE>;
  spawns: OutpostWaveSpawn[];
  boss?: DataRef<typeof OUTPOST_ENEMY_TYPE> | undefined;
};

export type OutpostObjectiveDefinition = {
  id: string;
  kind: "defend" | "eliminate" | "extract";
  targetCount?: number | undefined;
  durationMs?: number | undefined;
};

export type OutpostNetworkIdentity = Readonly<{
  entityId: string;
  generation: number;
}>;

export type OutpostGameplayIdentity = Readonly<{
  gameplayObjectId: string;
  entityId: EntityId;
  actorId?: string | undefined;
  physicsBodyId?: string | undefined;
  physicsColliderIds?: readonly string[] | undefined;
  network?: OutpostNetworkIdentity | undefined;
  renderObjectId?: string | undefined;
}>;
