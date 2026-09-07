import type { DataDiagnostic, DataReferenceTarget, DataTypeDefinition } from "@gamekits/data";
import { GAS_ACTOR_TYPE } from "@gamekits/gas";
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

export function createAbyssDataTypes(): Array<DataTypeDefinition<any>> {
  return [
    createHeroClassDataType(),
    createEnemyProfileDataType(),
    createWaveProfileDataType(),
    createRoomTemplateDataType(),
    createLootTableDataType(),
    createItemBaseDataType(),
    createItemAffixDataType(),
    createRewardDataType(),
    createRewardPoolDataType(),
    createRenderObjectDataType()
  ];
}

export function createHeroClassDataType(): DataTypeDefinition<AbyssHeroClass> {
  return {
    type: ABYSS_HERO_TYPE,
    getTags: () => ["hero"],
    references(document) {
      return [
        ref(GAS_ACTOR_TYPE, document.data.actorDefinitionId, "actorDefinitionId"),
        ref(RENDER_OBJECT_TYPE, document.data.renderObjectId, "renderObjectId")
      ];
    },
    validate(document) {
      return [
        ...requiredId(document, ABYSS_HERO_TYPE),
        ...positive(document.data.speed, document, "speed")
      ];
    },
    indexes: [
      {
        id: "hero.role",
        values(document) {
          return [document.data.role];
        }
      }
    ]
  };
}

export function createEnemyProfileDataType(): DataTypeDefinition<AbyssEnemyProfile> {
  return {
    type: ABYSS_ENEMY_TYPE,
    getTags: (enemy) => ["enemy", enemy.role],
    references(document) {
      return [
        ref(GAS_ACTOR_TYPE, document.data.actorDefinitionId, "actorDefinitionId"),
        ref(RENDER_OBJECT_TYPE, document.data.renderObjectId, "renderObjectId"),
        ref(ABYSS_LOOT_TABLE_TYPE, document.data.lootTableId, "lootTableId")
      ];
    },
    indexes: [
      {
        id: "enemy.role",
        values(document) {
          return [document.data.role];
        }
      },
      {
        id: "enemy.tier",
        values(document) {
          return [document.data.tier];
        }
      }
    ],
    validate(document) {
      return [
        ...requiredId(document, ABYSS_ENEMY_TYPE),
        ...positive(document.data.speed, document, "speed"),
        ...positive(document.data.maxHealth, document, "maxHealth"),
        ...positive(document.data.radius, document, "radius")
      ];
    }
  };
}

export function createWaveProfileDataType(): DataTypeDefinition<AbyssWaveProfile> {
  return {
    type: ABYSS_WAVE_TYPE,
    getTags: () => ["wave"],
    references(document) {
      return document.data.spawns.map((spawn, index) =>
        ref(ABYSS_ENEMY_TYPE, spawn.profileId, `spawns[${index}].profileId`)
      );
    },
    validate(document) {
      return [
        ...requiredId(document, ABYSS_WAVE_TYPE),
        ...(document.data.spawns.length > 0
          ? []
          : [error(document, "abyss.wave_empty", "Wave profile requires at least one spawn")])
      ];
    },
    indexes: [
      {
        id: "wave.tier",
        values(document) {
          return [document.data.tier];
        }
      },
      {
        id: "wave.room_kind",
        values(document) {
          return [document.data.roomKind];
        }
      }
    ]
  };
}

export function createRoomTemplateDataType(): DataTypeDefinition<AbyssRoomTemplate> {
  return {
    type: ABYSS_ROOM_TYPE,
    getTags: (room) => ["room", room.kind],
    references(document) {
      const references = [ref(ABYSS_HERO_TYPE, document.data.heroClassId, "heroClassId")];
      if (document.data.waveProfileId) {
        references.push(ref(ABYSS_WAVE_TYPE, document.data.waveProfileId, "waveProfileId"));
      }
      if (document.data.rewardPoolId) {
        references.push(ref(ABYSS_REWARD_POOL_TYPE, document.data.rewardPoolId, "rewardPoolId"));
      }
      return references;
    },
    indexes: [
      {
        id: "room.kind",
        values(document) {
          return [document.data.kind];
        }
      }
    ],
    validate(document) {
      const diagnostics = requiredId(document, ABYSS_ROOM_TYPE);
      if (document.data.kind === "combat" && !document.data.waveProfileId) {
        diagnostics.push(
          error(document, "abyss.room_missing_wave", "Combat room requires waveProfileId")
        );
      }
      return diagnostics;
    }
  };
}

export function createLootTableDataType(): DataTypeDefinition<AbyssLootTable> {
  return {
    type: ABYSS_LOOT_TABLE_TYPE,
    getTags: () => ["loot"],
    references(document) {
      return document.data.drops.flatMap((drop, index) => {
        const references: DataReferenceTarget[] = [
          ref(RENDER_OBJECT_TYPE, drop.renderObjectId, `drops[${index}].renderObjectId`)
        ];
        if (drop.itemBaseId) {
          references.push(ref(ABYSS_ITEM_BASE_TYPE, drop.itemBaseId, `drops[${index}].itemBaseId`));
        }
        if (drop.rewardId) {
          references.push(ref(ABYSS_REWARD_TYPE, drop.rewardId, `drops[${index}].rewardId`));
        }
        for (const [affixIndex, affixId] of (drop.affixIds ?? []).entries()) {
          references.push(
            ref(ABYSS_ITEM_AFFIX_TYPE, affixId, `drops[${index}].affixIds[${affixIndex}]`)
          );
        }
        return references;
      });
    },
    validate(document) {
      return [
        ...requiredId(document, ABYSS_LOOT_TABLE_TYPE),
        ...(document.data.drops.length > 0
          ? []
          : [error(document, "abyss.loot_empty", "Loot table requires at least one drop")])
      ];
    },
    indexes: [
      {
        id: "loot.source",
        values(document) {
          return [document.data.source];
        }
      }
    ]
  };
}

export function createItemBaseDataType(): DataTypeDefinition<AbyssItemBase> {
  return {
    type: ABYSS_ITEM_BASE_TYPE,
    getTags: (item) => ["item", item.slot, item.rarity],
    references(document) {
      return [ref(RENDER_OBJECT_TYPE, document.data.renderObjectId, "renderObjectId")];
    },
    indexes: [
      {
        id: "item.slot",
        values(document) {
          return [document.data.slot];
        }
      },
      {
        id: "item.rarity",
        values(document) {
          return [document.data.rarity];
        }
      }
    ],
    validate(document) {
      return requiredId(document, ABYSS_ITEM_BASE_TYPE);
    }
  };
}

export function createItemAffixDataType(): DataTypeDefinition<AbyssItemAffix> {
  return {
    type: ABYSS_ITEM_AFFIX_TYPE,
    getTags: (affix) => ["affix", affix.attribute],
    validate(document) {
      const diagnostics = requiredId(document, ABYSS_ITEM_AFFIX_TYPE);
      if (document.data.min > document.data.max) {
        diagnostics.push(
          error(document, "abyss.affix_invalid_range", "Affix min cannot exceed max")
        );
      }
      return diagnostics;
    }
  };
}

export function createRewardDataType(): DataTypeDefinition<AbyssRewardDefinition> {
  return {
    type: ABYSS_REWARD_TYPE,
    getTags: (reward) => ["reward", reward.effect],
    validate(document) {
      return requiredId(document, ABYSS_REWARD_TYPE);
    },
    indexes: [
      {
        id: "reward.effect",
        values(document) {
          return [document.data.effect];
        }
      }
    ]
  };
}

export function createRewardPoolDataType(): DataTypeDefinition<AbyssRewardPool> {
  return {
    type: ABYSS_REWARD_POOL_TYPE,
    getTags: () => ["reward-pool"],
    references(document) {
      return document.data.rewardIds.map((rewardId, index) =>
        ref(ABYSS_REWARD_TYPE, rewardId, `rewardIds[${index}]`)
      );
    },
    validate(document) {
      return [
        ...requiredId(document, ABYSS_REWARD_POOL_TYPE),
        ...(document.data.rewardIds.length > 0
          ? []
          : [error(document, "abyss.reward_pool_empty", "Reward pool requires rewards")])
      ];
    },
    indexes: [
      {
        id: "reward_pool.kind",
        values(document) {
          return [document.data.kind];
        }
      }
    ]
  };
}

export function createRenderObjectDataType(): DataTypeDefinition<AbyssRenderObjectDefinition> {
  return {
    type: RENDER_OBJECT_TYPE,
    getTags: (render) => render.tags ?? [],
    validate(document) {
      return requiredId(document, RENDER_OBJECT_TYPE);
    }
  };
}

function ref(type: string, id: string, path: string): DataReferenceTarget {
  return { type, id, path };
}

function requiredId(
  document: { id: string; type: string; data: { id: string } },
  type: string
): DataDiagnostic[] {
  return document.data.id ? [] : [error(document, "abyss.data_missing_id", `${type} requires id`)];
}

function positive(
  value: number,
  document: { id: string; type: string },
  path: string
): DataDiagnostic[] {
  return value > 0
    ? []
    : [error(document, "abyss.data_positive_number", `${path} must be positive`, path)];
}

function error(
  document: { id: string; type: string },
  code: string,
  message: string,
  path?: string
): DataDiagnostic {
  return {
    code,
    message,
    severity: "error",
    key: {
      type: document.type,
      id: document.id
    },
    ...(path === undefined ? {} : { path })
  };
}
