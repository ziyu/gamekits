import { createMemorySaveStore, createSaveManager, type SaveManager } from "@gamekits/save";
import { describe, expect, it } from "vitest";
import { Loot, createAbyssSaveContributor } from "./game";
import { createAbyssTestHarness, type AbyssTestHarness } from "./test/abyss-test-utils";

const SLOT_ID = "checkpoint";

describe("Abyss Delve save checkpoint", () => {
  it("saves, recreates, loads, and continues from the saved runtime clock", async () => {
    const store = createMemorySaveStore();
    const first = createSavedHarness(store);

    completeRoomAndChooseReward(first.harness);
    first.harness.tick(160);
    const savedClock = first.harness.abyss.runtime.clock.snapshot();
    const savedSnapshot = first.harness.abyss.snapshot();
    first.harness.abyss.run.inventoryOpen = true;
    first.harness.abyss.run.paused = true;
    first.harness.abyss.input.held.up = true;

    const save = await saveCheckpoint(first.manager, first.harness);
    const checkpoint = save.envelope.payload.sections["abyss.run_checkpoint"]?.data;
    expect(checkpoint).toMatchObject({
      currentRoomId: savedSnapshot.objective.roomId,
      roomIndex: savedSnapshot.objective.roomIndex,
      gold: savedSnapshot.player.gold
    });
    expect(JSON.stringify(checkpoint)).not.toContain("objectId");
    expect(JSON.stringify(checkpoint)).not.toContain("inventoryOpen");
    expect(JSON.stringify(checkpoint)).not.toContain("paused");
    expect(JSON.stringify(checkpoint)).not.toContain("held");
    expect(JSON.stringify(checkpoint)).not.toContain("camera");

    const second = createSavedHarness(store);
    const load = await second.manager.load(SLOT_ID);
    second.harness.abyss.runtime.clock.restore({
      elapsed: load.envelope.payload.runtime.clock.elapsed,
      ticks: load.envelope.payload.runtime.clock.ticks,
      running: second.harness.abyss.runtime.isRunning()
    });

    const restored = second.harness.abyss.snapshot();
    expect(restored.clock.ticks).toBe(savedClock.ticks);
    expect(restored.clock.elapsed).toBe(savedClock.elapsed);
    expect(restored.objective.roomId).toBe(savedSnapshot.objective.roomId);
    expect(restored.objective.roomIndex).toBe(savedSnapshot.objective.roomIndex);
    expect(restored.player.gold).toBe(savedSnapshot.player.gold);
    expect(restored.player.inventoryOpen).toBe(false);
    expect(restored.player.paused).toBe(false);
    expect(second.harness.abyss.input.held.up).toBe(false);

    first.harness.tick(80);
    second.harness.tick(80);
    expect(second.harness.abyss.snapshot().clock.ticks).toBe(savedClock.ticks + 1);
    expect(second.harness.abyss.snapshot().objective.roomId).toBe(
      first.harness.abyss.snapshot().objective.roomId
    );
  });

  it("restores pending loot without duplicating bootstrap room entities", async () => {
    const store = createMemorySaveStore();
    const first = createSavedHarness(store);
    const enemy = first.harness.livingEnemies()[0]!;
    first.harness.attack(enemy);
    expect(first.harness.abyss.runtime.world.query([Loot]).length).toBeGreaterThan(0);

    await saveCheckpoint(first.manager, first.harness);
    const second = createSavedHarness(store);
    await second.manager.load(SLOT_ID);

    expect(second.harness.abyss.runtime.world.query([Loot]).length).toBe(
      first.harness.abyss.runtime.world.query([Loot]).length
    );
    expect(second.harness.abyss.snapshot().objective.remainingEnemies).toBe(
      first.harness.abyss.snapshot().objective.remainingEnemies
    );
    second.harness.pickupFirstLoot();
    expect(second.harness.abyss.run.recentLoot.length).toBeGreaterThan(0);
  });
});

function createSavedHarness(store = createMemorySaveStore()): {
  harness: AbyssTestHarness;
  manager: SaveManager;
} {
  const harness = createAbyssTestHarness();
  const manager = createSaveManager({
    appId: "abyss-delve",
    gameId: "abyss-delve",
    gameVersion: "0.1.0",
    formatVersion: "1.0.0",
    store,
    contributorPolicy: {
      excludeScopes: ["presentation", "debug", "cache", "ui"]
    }
  });
  manager.registerContributor(createAbyssSaveContributor(() => harness.abyss));
  return { harness, manager };
}

async function saveCheckpoint(manager: SaveManager, harness: AbyssTestHarness) {
  const clock = harness.abyss.runtime.clock.snapshot();
  return manager.save(SLOT_ID, {
    runtime: {
      seed: harness.abyss.captureCheckpoint().seed,
      clock: {
        ticks: clock.ticks,
        elapsed: clock.elapsed
      }
    }
  });
}

function completeRoomAndChooseReward(harness: AbyssTestHarness): void {
  for (let step = 0; step < 12 && harness.livingEnemies().length > 0; step += 1) {
    harness.attack(harness.livingEnemies()[0]!);
  }
  const reward = harness.abyss.snapshot().rewardChoices[0]!;
  harness.abyss.input.rewardChoiceRequested = reward.id;
  harness.tick(80);
}
