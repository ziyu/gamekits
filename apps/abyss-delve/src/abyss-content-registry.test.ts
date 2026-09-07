import { createDataRegistry, DataRegistryError, type DataPack } from "@gamekits/data";
import { createGasDataTypes } from "@gamekits/gas";
import { createTcaRuleDataType } from "@gamekits/tca";
import { describe, expect, it } from "vitest";
import {
  ABYSS_ENEMY_TYPE,
  ABYSS_HERO_TYPE,
  ABYSS_ITEM_AFFIX_TYPE,
  ABYSS_ITEM_BASE_TYPE,
  ABYSS_LOOT_TABLE_TYPE,
  ABYSS_REWARD_POOL_TYPE,
  ABYSS_ROOM_TYPE,
  ABYSS_WAVE_TYPE,
  abyssDataPack,
  createAbyssDataRegistry,
  createAbyssDataTypes
} from "./game";

describe("Abyss Delve content registry", () => {
  it("registers rich business DataTypes and mixed DataPack entries", () => {
    const registry = createAbyssDataRegistry();

    expect(registry.list(ABYSS_HERO_TYPE)).toHaveLength(2);
    expect(registry.list(ABYSS_ENEMY_TYPE)).toHaveLength(4);
    expect(registry.list(ABYSS_ROOM_TYPE).length).toBeGreaterThanOrEqual(2);
    expect(registry.list(ABYSS_WAVE_TYPE).length).toBeGreaterThanOrEqual(1);
    expect(registry.list(ABYSS_ITEM_BASE_TYPE)).toHaveLength(3);
    expect(registry.list(ABYSS_ITEM_AFFIX_TYPE)).toHaveLength(3);
    expect(registry.list(ABYSS_REWARD_POOL_TYPE).length).toBeGreaterThanOrEqual(1);

    expect(
      registry.query({ type: ABYSS_ENEMY_TYPE, index: { id: "enemy.role", value: "heavy" } })
    ).toHaveLength(2);
    expect(
      registry.query({ type: ABYSS_ENEMY_TYPE, index: { id: "enemy.tier", value: "elite" } })
    ).toHaveLength(1);
    expect(
      registry.query({ type: ABYSS_ITEM_BASE_TYPE, index: { id: "item.slot", value: "weapon" } })
    ).toHaveLength(1);
    expect(
      registry.query({ type: ABYSS_ROOM_TYPE, index: { id: "room.kind", value: "combat" } })
    ).toHaveLength(2);
  });

  it("connects room, wave, enemy, loot, item, and reward references", () => {
    const registry = createAbyssDataRegistry();

    expect(
      registry
        .referencesFrom({ type: ABYSS_ROOM_TYPE, id: "room.bootstrap" })
        .map((reference) => reference.to)
    ).toEqual(
      expect.arrayContaining([
        { type: ABYSS_HERO_TYPE, id: "hero.delver" },
        { type: ABYSS_WAVE_TYPE, id: "wave.bootstrap" },
        { type: ABYSS_REWARD_POOL_TYPE, id: "rewardPool.bootstrap" }
      ])
    );

    expect(
      registry
        .referencesFrom({ type: ABYSS_WAVE_TYPE, id: "wave.bootstrap" })
        .map((reference) => reference.to)
    ).toEqual(
      expect.arrayContaining([
        { type: ABYSS_ENEMY_TYPE, id: "enemy.melee" },
        { type: ABYSS_ENEMY_TYPE, id: "enemy.ranged" },
        { type: ABYSS_ENEMY_TYPE, id: "enemy.heavy" }
      ])
    );

    expect(
      registry
        .referencesFrom({ type: ABYSS_LOOT_TABLE_TYPE, id: "loot.enemy.basic" })
        .map((reference) => reference.to)
    ).toEqual(
      expect.arrayContaining([
        { type: ABYSS_ITEM_BASE_TYPE, id: "item.blade.worn" },
        { type: ABYSS_ITEM_AFFIX_TYPE, id: "affix.searing" }
      ])
    );
  });

  it("reports missing content references with source pack, type, id, and path", () => {
    const registry = createRegistryWithoutPack();
    const brokenPack = clonePack(abyssDataPack);
    const brokenRoom = brokenPack.entries.find(
      (entry) => entry.type === ABYSS_ROOM_TYPE && entry.id === "room.bootstrap"
    );
    if (!brokenRoom || !isRecord(brokenRoom.data)) {
      throw new Error("Broken test pack is missing room.bootstrap");
    }
    brokenRoom.data.waveProfileId = "wave.missing";

    let error: unknown;
    try {
      registry.registerPack(brokenPack);
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(DataRegistryError);
    const diagnostics = error instanceof DataRegistryError ? error.diagnostics : [];
    expect(diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "data.missing_reference",
          sourcePackId: "abyss.base",
          key: { type: ABYSS_ROOM_TYPE, id: "room.bootstrap" },
          path: "waveProfileId"
        })
      ])
    );
  });
});

function createRegistryWithoutPack() {
  const registry = createDataRegistry();
  for (const type of createAbyssDataTypes()) {
    registry.registerType(type);
  }
  for (const type of createGasDataTypes()) {
    registry.registerType(type);
  }
  registry.registerType(createTcaRuleDataType());
  return registry;
}

function clonePack(pack: DataPack): DataPack {
  return JSON.parse(JSON.stringify(pack)) as DataPack;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
