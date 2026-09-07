import type { DataRegistry } from "@gamekits/data";
import { mergeTcaDefinitionSets, type TcaDefinitionSet } from "@gamekits/tca";
import { Actor, Combat, Loot, Position, Presentation, Room } from "../components";
import {
  ABYSS_ENEMY_TYPE,
  ABYSS_LOOT_TABLE_TYPE,
  ABYSS_REWARD_TYPE,
  type AbyssEnemyProfile,
  type AbyssLootTable,
  type AbyssRewardDefinition
} from "../content";
import type { AbyssRuntimeState } from "../runtime-state";
import { livingEnemies, spawnFloatingText } from "./combat-helpers";
import { capturePlayerCarryState, enterNextAbyssRoom } from "./room-helpers";

export type CreateAbyssTcaDefinitionsOptions = {
  state: AbyssRuntimeState;
  dataRegistry: DataRegistry;
};

export function createAbyssTcaDefinitions(
  options: CreateAbyssTcaDefinitionsOptions
): TcaDefinitionSet {
  return mergeTcaDefinitionSets({
    actions: [
      createRollLootAction(options),
      createCheckRoomClearAction(options),
      createApplyRewardAction(options)
    ]
  });
}

function createRollLootAction(options: CreateAbyssTcaDefinitionsOptions) {
  return {
    type: "abyss.roll_loot",
    execute(ctx) {
      const enemyId = readString(ctx.event.payload, "actorId");
      const x = readNumber(ctx.event.payload, "x") ?? 0;
      const y = readNumber(ctx.event.payload, "y") ?? 0;
      const profileId = readString(ctx.event.payload, "archetypeId");
      const tableId =
        profileId === undefined
          ? "loot.enemy.basic"
          : options.dataRegistry.getValue<AbyssEnemyProfile>(ABYSS_ENEMY_TYPE, profileId)
              .lootTableId;
      const table = options.dataRegistry.getValue<AbyssLootTable>(ABYSS_LOOT_TABLE_TYPE, tableId);
      const drop = weightedDrop(table, enemyId ?? profileId ?? `${x}:${y}`);
      const loot = ctx.game?.world.spawn();
      if (loot === undefined || !ctx.game) {
        return;
      }

      ctx.game.world.add(loot, Position, { x, y, rotation: 0 });
      ctx.game.world.add(loot, Loot, {
        lootId: drop.id,
        label: drop.label,
        kind: drop.kind,
        amount: drop.amount,
        sourceActorId: enemyId
      });
      ctx.game.world.add(loot, Presentation, {
        renderKey: drop.renderObjectId,
        layer: 5
      });
      ctx.eventBus.emit(
        "abyss.loot_dropped",
        { lootId: drop.id, label: drop.label, kind: drop.kind, amount: drop.amount, x, y },
        "abyss.tca"
      );
      options.state.trace({
        kind: "loot",
        label: `dropped ${drop.label}`,
        actorId: enemyId,
        entityId: loot,
        payload: drop
      });
    }
  } satisfies NonNullable<TcaDefinitionSet["actions"]>[number];
}

function createCheckRoomClearAction(options: CreateAbyssTcaDefinitionsOptions) {
  return {
    type: "abyss.check_room_clear",
    execute(ctx) {
      const game = ctx.game;
      if (!game || livingEnemies(game.world).length > 0) {
        return;
      }

      const roomEntity = game.world.query([Room])[0];
      const roomId = options.state.activeRoomId ?? "room.bootstrap";
      if (roomEntity !== undefined) {
        const room = game.world.get(roomEntity, Room);
        if (room) {
          room.completed = true;
          room.rewardOpen = true;
        }
      }
      if (!options.state.run.completedRoomIds.includes(roomId)) {
        options.state.run.completedRoomIds.push(roomId);
      }
      options.state.run.completed = true;
      options.state.run.rewardOpen = true;
      ctx.eventBus.emit("abyss.room_cleared", { roomId }, "abyss.tca");
      options.state.trace({
        kind: "tca",
        label: "room cleared",
        payload: { remainingEnemies: 0 }
      });
    }
  } satisfies NonNullable<TcaDefinitionSet["actions"]>[number];
}

function createApplyRewardAction(options: CreateAbyssTcaDefinitionsOptions) {
  return {
    type: "abyss.apply_reward",
    execute(ctx) {
      const rewardId = readString(ctx.event.payload, "rewardId");
      if (!rewardId || !ctx.game) {
        return;
      }

      const reward = options.dataRegistry.getValue<AbyssRewardDefinition>(
        ABYSS_REWARD_TYPE,
        rewardId
      );
      const player = ctx.game.world
        .query([Actor])
        .find((entity) => ctx.game?.world.get(entity, Actor)?.faction === "player");
      if (player === undefined) {
        return;
      }

      const combat = ctx.game.world.get(player, Combat);
      if (combat) {
        if (reward.effect === "damage") {
          combat.damage += reward.amount;
        }
        if (reward.effect === "health") {
          combat.maxHealth += reward.amount;
          combat.health = Math.min(combat.maxHealth, combat.health + reward.amount);
        }
        if (reward.effect === "energy") {
          combat.maxEnergy += reward.amount;
          combat.energy = Math.min(combat.maxEnergy, combat.energy + reward.amount);
        }
      }

      const gas = options.state.gasRuntime();
      if (gas?.hasActor("player")) {
        if (reward.effect === "health") {
          gas.modifyAttribute(
            "player",
            { attribute: "health", operation: "add", value: reward.amount },
            "abyss.reward"
          );
        }
        if (reward.effect === "energy") {
          gas.modifyAttribute(
            "player",
            { attribute: "energy", operation: "add", value: reward.amount },
            "abyss.reward"
          );
        }
      }

      const carry = capturePlayerCarryState(options.state);

      const roomEntity = ctx.game.world.query([Room])[0];
      if (roomEntity !== undefined) {
        const room = ctx.game.world.get(roomEntity, Room);
        if (room) {
          room.rewardOpen = false;
          room.rewardSelected = reward.id;
        }
      }

      options.state.run.selectedReward = reward.id;
      if (!options.state.run.selectedRewardIds.includes(reward.id)) {
        options.state.run.selectedRewardIds.push(reward.id);
      }
      options.state.run.rewardOpen = false;
      options.state.run.rewardChoices = options.state.run.rewardChoices.map((choice) => ({
        ...choice,
        selected: choice.id === reward.id
      }));
      const position = ctx.game.world.get(player, Position);
      if (position) {
        spawnFloatingText(options.state, position.x, position.y - 44, reward.label, "reward");
      }
      ctx.eventBus.emit("abyss.reward_applied", { rewardId: reward.id }, "abyss.tca");
      options.state.trace({
        kind: "reward",
        label: `selected ${reward.label}`,
        actorId: "player",
        entityId: player,
        payload: reward
      });
      enterNextAbyssRoom(options.state, carry);
    }
  } satisfies NonNullable<TcaDefinitionSet["actions"]>[number];
}

function weightedDrop(table: AbyssLootTable, seed: string): AbyssLootTable["drops"][number] {
  const total = table.drops.reduce((sum, drop) => sum + drop.weight, 0);
  let roll = hash(seed) % Math.max(1, total);
  for (const drop of table.drops) {
    roll -= drop.weight;
    if (roll < 0) {
      return drop;
    }
  }

  return table.drops[0]!;
}

function hash(value: string): number {
  let next = 0;
  for (const char of value) {
    next = (next * 31 + char.charCodeAt(0)) >>> 0;
  }
  return next;
}

function readString(payload: unknown, key: string): string | undefined {
  return isRecord(payload) && typeof payload[key] === "string" ? payload[key] : undefined;
}

function readNumber(payload: unknown, key: string): number | undefined {
  return isRecord(payload) && typeof payload[key] === "number" ? payload[key] : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
