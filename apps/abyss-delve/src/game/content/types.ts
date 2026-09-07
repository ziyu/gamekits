import type { RenderObjectDefinition } from "@gamekits/renderer-core";

export const ABYSS_HERO_TYPE = "abyss.heroClass";
export const ABYSS_ENEMY_TYPE = "abyss.enemyProfile";
export const ABYSS_ROOM_TYPE = "abyss.roomTemplate";
export const ABYSS_WAVE_TYPE = "abyss.waveProfile";
export const ABYSS_LOOT_TABLE_TYPE = "abyss.lootTable";
export const ABYSS_ITEM_BASE_TYPE = "abyss.itemBase";
export const ABYSS_ITEM_AFFIX_TYPE = "abyss.itemAffix";
export const ABYSS_REWARD_TYPE = "abyss.reward";
export const ABYSS_REWARD_POOL_TYPE = "abyss.rewardPool";
export const RENDER_OBJECT_TYPE = "render.object";

export type AbyssHeroClass = {
  id: string;
  label: string;
  role: "starter" | "alternate";
  actorDefinitionId: string;
  renderObjectId: string;
  spawn: { x: number; y: number };
  speed: number;
};

export type AbyssEnemyProfile = {
  id: string;
  label: string;
  role: "melee" | "ranged" | "heavy";
  tier: "minion" | "elite" | "boss";
  actorDefinitionId: string;
  renderObjectId: string;
  speed: number;
  damage: number;
  attackRange: number;
  attackCooldownMs: number;
  maxHealth: number;
  radius: number;
  lootTableId: string;
};

export type AbyssWaveProfile = {
  id: string;
  label: string;
  tier: "starter" | "elite" | "boss";
  roomKind: "combat" | "reward" | "exit";
  spawns: Array<{
    profileId: string;
    x: number;
    y: number;
    count?: number | undefined;
  }>;
};

export type AbyssRoomTemplate = {
  id: string;
  label: string;
  kind: "combat" | "reward" | "exit";
  heroClassId: string;
  waveProfileId?: string | undefined;
  rewardPoolId?: string | undefined;
  bounds: { x: number; y: number; width: number; height: number };
};

export type AbyssItemBase = {
  id: string;
  label: string;
  slot: "weapon" | "armor" | "charm";
  rarity: "common" | "rare" | "relic";
  renderObjectId: string;
  attributeModifiers: Array<{
    attribute: "damage" | "health" | "energy";
    amount: number;
  }>;
};

export type AbyssItemAffix = {
  id: string;
  label: string;
  attribute: "damage" | "health" | "energy";
  min: number;
  max: number;
};

export type AbyssLootTable = {
  id: string;
  source: "enemy.basic" | "enemy.elite" | "chest" | "room";
  drops: Array<{
    id: string;
    label: string;
    kind: "gold" | "gear" | "blessing";
    amount: number;
    weight: number;
    renderObjectId: string;
    itemBaseId?: string | undefined;
    affixIds?: string[] | undefined;
    rewardId?: string | undefined;
  }>;
};

export type AbyssRewardDefinition = {
  id: string;
  label: string;
  detail: string;
  effect: "damage" | "health" | "energy";
  category: "offense" | "defense" | "utility";
  amount: number;
};

export type AbyssRewardPool = {
  id: string;
  label: string;
  kind: "room_clear" | "elite_clear" | "boss_clear";
  rewardIds: string[];
};

export type AbyssRenderObjectDefinition = RenderObjectDefinition & {
  id: string;
};
