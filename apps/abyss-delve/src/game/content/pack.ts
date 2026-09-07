import type { DataPack } from "@gamekits/data";
import { abyssAbilityEntries } from "./abilities/core";
import { abyssEnemyEntries } from "./enemies/profiles";
import { renderObject } from "./factories";
import { abyssHeroEntries } from "./heroes/classes";
import { abyssItemEntries } from "./loot/items";
import { abyssLootEntries } from "./loot/tables";
import { abyssRewardEntries } from "./rewards/rewards";
import { abyssRoomEntries } from "./rooms/rooms";
import { abyssWaveEntries } from "./rooms/waves";
import { abyssRuleEntries } from "./rules/tca-rules";
import { abyssRenderObjects } from "./visuals/render-objects";

export const abyssDataPack: DataPack = {
  id: "abyss.base",
  version: "1.0.0",
  entries: [
    ...abyssRenderObjects.map(renderObject),
    ...abyssAbilityEntries,
    ...abyssHeroEntries,
    ...abyssItemEntries,
    ...abyssRewardEntries,
    ...abyssLootEntries,
    ...abyssEnemyEntries,
    ...abyssWaveEntries,
    ...abyssRoomEntries,
    ...abyssRuleEntries
  ]
};
