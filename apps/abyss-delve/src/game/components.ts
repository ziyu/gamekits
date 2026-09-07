import { defineComponent, type EntityId } from "@gamekits/world";

export type PositionState = {
  x: number;
  y: number;
  rotation: number;
};

export type VelocityState = {
  x: number;
  y: number;
};

export type ActorFaction = "player" | "enemy";
export type ActorRole = "player" | "melee" | "ranged" | "heavy";

export type ActorState = {
  actorId: string;
  definitionId: string;
  archetypeId: string;
  label: string;
  faction: ActorFaction;
  role: ActorRole;
  alive: boolean;
};

export type CombatState = {
  health: number;
  maxHealth: number;
  energy: number;
  maxEnergy: number;
  damage: number;
  attackRange: number;
  attackCooldownMs: number;
  nextAttackAt: number;
  invulnerableUntil: number;
  hitFlashUntil: number;
};

export type PlayerControlState = {
  aimX: number;
  aimY: number;
  facingX: number;
  facingY: number;
  dodgingUntil: number;
  dashCooldownUntil: number;
  inventoryOpen: boolean;
  paused: boolean;
};

export type EnemyAiState = {
  behavior: "chase" | "kite" | "brute";
  aggroRange: number;
  preferredRange: number;
  windupUntil: number;
  windupStartedAt: number;
  attackTarget?: EntityId | undefined;
};

export type HitboxState = {
  radius: number;
};

export type ProjectileState = {
  owner: EntityId;
  faction: ActorFaction;
  damage: number;
  speed: number;
  lifetimeMs: number;
  ageMs: number;
  hitRadius: number;
};

export type LootKind = "gold" | "gear" | "blessing";

export type LootState = {
  lootId: string;
  label: string;
  kind: LootKind;
  amount: number;
  picked: boolean;
  sourceActorId?: string | undefined;
};

export type RoomState = {
  roomId: string;
  objective: "clear";
  completed: boolean;
  rewardOpen: boolean;
  rewardSelected?: string | undefined;
};

export type PresentationState = {
  objectId?: string | undefined;
  renderKey: string;
  layer: number;
};

export type LifetimeState = {
  ageMs: number;
  lifetimeMs: number;
};

export type FloatingTextState = {
  text: string;
  tone: "damage" | "loot" | "reward";
};

export type TelegraphState = {
  owner: EntityId;
  radius: number;
};

export const Position = defineComponent<PositionState>({
  id: "abyss.position",
  create: (data) => ({ x: 0, y: 0, rotation: 0, ...data })
});

export const Velocity = defineComponent<VelocityState>({
  id: "abyss.velocity",
  create: (data) => ({ x: 0, y: 0, ...data })
});

export const Actor = defineComponent<ActorState>({
  id: "abyss.actor",
  create: (data) => ({
    actorId: "",
    definitionId: "",
    archetypeId: "",
    label: "",
    faction: "enemy",
    role: "melee",
    alive: true,
    ...data
  })
});

export const Combat = defineComponent<CombatState>({
  id: "abyss.combat",
  create: (data) => ({
    health: 1,
    maxHealth: 1,
    energy: 0,
    maxEnergy: 0,
    damage: 1,
    attackRange: 42,
    attackCooldownMs: 600,
    nextAttackAt: 0,
    invulnerableUntil: 0,
    hitFlashUntil: 0,
    ...data
  })
});

export const PlayerControl = defineComponent<PlayerControlState>({
  id: "abyss.player_control",
  create: (data) => ({
    aimX: 1,
    aimY: 0,
    facingX: 1,
    facingY: 0,
    dodgingUntil: 0,
    dashCooldownUntil: 0,
    inventoryOpen: false,
    paused: false,
    ...data
  })
});

export const EnemyAi = defineComponent<EnemyAiState>({
  id: "abyss.enemy_ai",
  create: (data) => ({
    behavior: "chase",
    aggroRange: 520,
    preferredRange: 48,
    windupUntil: 0,
    windupStartedAt: 0,
    ...data
  })
});

export const Hitbox = defineComponent<HitboxState>({
  id: "abyss.hitbox",
  create: (data) => ({ radius: 18, ...data })
});

export const Projectile = defineComponent<ProjectileState>({
  id: "abyss.projectile",
  create: (data) => ({
    owner: "",
    faction: "player",
    damage: 1,
    speed: 360,
    lifetimeMs: 900,
    ageMs: 0,
    hitRadius: 12,
    ...data
  })
});

export const Loot = defineComponent<LootState>({
  id: "abyss.loot",
  create: (data) => ({
    lootId: "",
    label: "",
    kind: "gold",
    amount: 1,
    picked: false,
    ...data
  })
});

export const Room = defineComponent<RoomState>({
  id: "abyss.room",
  create: (data) => ({
    roomId: "abyss.room.bootstrap",
    objective: "clear",
    completed: false,
    rewardOpen: false,
    ...data
  })
});

export const Presentation = defineComponent<PresentationState>({
  id: "abyss.presentation",
  create: (data) => ({ renderKey: "abyss.render.loot.gold", layer: 1, ...data })
});

export const Lifetime = defineComponent<LifetimeState>({
  id: "abyss.lifetime",
  create: (data) => ({ ageMs: 0, lifetimeMs: 600, ...data })
});

export const FloatingText = defineComponent<FloatingTextState>({
  id: "abyss.floating_text",
  create: (data) => ({ text: "", tone: "damage", ...data })
});

export const Telegraph = defineComponent<TelegraphState>({
  id: "abyss.telegraph",
  create: (data) => ({ owner: "", radius: 48, ...data })
});
