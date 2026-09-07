import type { DataPackEntry } from "@gamekits/data";
import {
  type GasAbilityDefinition,
  type GasEffectDefinition,
  GAS_ABILITY_TYPE,
  GAS_ACTOR_TYPE,
  GAS_ATTRIBUTE_TYPE,
  GAS_CUE_TYPE,
  GAS_EFFECT_TYPE,
  GAS_TAG_TYPE
} from "@gamekits/gas";
import { TCA_RULE_TYPE } from "@gamekits/tca";
import type {
  AbyssEnemyProfile,
  AbyssHeroClass,
  AbyssItemAffix,
  AbyssItemBase,
  AbyssLootTable,
  AbyssRenderObjectDefinition,
  AbyssRewardDefinition,
  AbyssRewardPool,
  AbyssRoomTemplate,
  AbyssWaveProfile
} from "./types";
import {
  ABYSS_ENEMY_TYPE,
  ABYSS_HERO_TYPE,
  ABYSS_ITEM_AFFIX_TYPE,
  ABYSS_ITEM_BASE_TYPE,
  ABYSS_LOOT_TABLE_TYPE,
  ABYSS_REWARD_POOL_TYPE,
  ABYSS_REWARD_TYPE,
  ABYSS_ROOM_TYPE,
  ABYSS_WAVE_TYPE,
  RENDER_OBJECT_TYPE
} from "./types";

export type AbyssContentEntry = DataPackEntry;

export function renderObject(data: AbyssRenderObjectDefinition): DataPackEntry {
  return { type: RENDER_OBJECT_TYPE, id: data.id, data };
}

export function heroClass(data: AbyssHeroClass): DataPackEntry<AbyssHeroClass> {
  return { type: ABYSS_HERO_TYPE, id: data.id, data };
}

export function enemyProfile(data: AbyssEnemyProfile): DataPackEntry<AbyssEnemyProfile> {
  return { type: ABYSS_ENEMY_TYPE, id: data.id, data };
}

export function waveProfile(data: AbyssWaveProfile): DataPackEntry<AbyssWaveProfile> {
  return { type: ABYSS_WAVE_TYPE, id: data.id, data };
}

export function roomTemplate(data: AbyssRoomTemplate): DataPackEntry<AbyssRoomTemplate> {
  return { type: ABYSS_ROOM_TYPE, id: data.id, data };
}

export function lootTable(data: AbyssLootTable): DataPackEntry<AbyssLootTable> {
  return { type: ABYSS_LOOT_TABLE_TYPE, id: data.id, data };
}

export function itemBase(data: AbyssItemBase): DataPackEntry<AbyssItemBase> {
  return { type: ABYSS_ITEM_BASE_TYPE, id: data.id, data };
}

export function itemAffix(data: AbyssItemAffix): DataPackEntry<AbyssItemAffix> {
  return { type: ABYSS_ITEM_AFFIX_TYPE, id: data.id, data };
}

export function rewardDefinition(
  data: AbyssRewardDefinition
): DataPackEntry<AbyssRewardDefinition> {
  return { type: ABYSS_REWARD_TYPE, id: data.id, data };
}

export function rewardPool(data: AbyssRewardPool): DataPackEntry<AbyssRewardPool> {
  return { type: ABYSS_REWARD_POOL_TYPE, id: data.id, data };
}

export function gasAttribute(
  id: string,
  min: number,
  max: number,
  defaultValue: number
): DataPackEntry {
  return {
    type: GAS_ATTRIBUTE_TYPE,
    id,
    data: { id, min, max, defaultValue }
  };
}

export function gasTag(id: string): DataPackEntry {
  return {
    type: GAS_TAG_TYPE,
    id,
    data: { id }
  };
}

export function gasCue(id: string, type: string): DataPackEntry {
  return {
    type: GAS_CUE_TYPE,
    id,
    data: { id, type }
  };
}

export function gasEffect(
  id: string,
  name: string,
  healthDelta: number,
  cues: string[]
): DataPackEntry {
  return {
    type: GAS_EFFECT_TYPE,
    id,
    data: {
      id,
      name,
      attributeModifiers: [{ attribute: "health", operation: "add", value: healthDelta }],
      cues
    }
  };
}

export function gasEffectDefinition(data: GasEffectDefinition): DataPackEntry<GasEffectDefinition> {
  return {
    type: GAS_EFFECT_TYPE,
    id: data.id,
    data
  };
}

export function gasAbilityDefinition(
  data: GasAbilityDefinition
): DataPackEntry<GasAbilityDefinition> {
  return {
    type: GAS_ABILITY_TYPE,
    id: data.id,
    data
  };
}

export function gasAbility(
  id: string,
  name: string,
  effectId: string,
  cooldownMs: number,
  cues: string[],
  energyCost = 0
): DataPackEntry {
  return {
    type: GAS_ABILITY_TYPE,
    id,
    data: {
      id,
      name,
      cooldownMs,
      costs: energyCost > 0 ? [{ attribute: "energy", amount: energyCost }] : [],
      effects: [{ effectId, target: "target" }],
      cues
    }
  };
}

export function gasActor(
  id: string,
  name: string,
  health: number,
  energy: number,
  tags: string[],
  abilities: string[]
): DataPackEntry {
  return {
    type: GAS_ACTOR_TYPE,
    id,
    data: {
      id,
      name,
      attributes: { health, energy },
      tags,
      abilities
    }
  };
}

export function tcaRule(id: string, eventType: string, action: string): DataPackEntry {
  return {
    type: TCA_RULE_TYPE,
    id,
    data: {
      id,
      trigger: { type: "event.type", args: { eventType } },
      actions: [{ type: action }]
    }
  };
}
