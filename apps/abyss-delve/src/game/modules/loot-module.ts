import { defineGameModule } from "@gamekits/core";
import type { GameInstallContext } from "@gamekits/game-runtime";
import { Actor, Combat, Loot, Position } from "../components";
import type { AbyssRuntimeState } from "../runtime-state";
import { addRecentLoot } from "../runtime-state";
import { spawnFloatingText } from "./combat-helpers";

export type CreateAbyssLootModuleOptions = {
  state: AbyssRuntimeState;
};

const PICKUP_RADIUS = 54;

export function createAbyssLootModule(options: CreateAbyssLootModuleOptions) {
  return defineGameModule<GameInstallContext>({
    id: "abyss.loot",
    install(ctx) {
      ctx.systems.register({
        id: "abyss.loot.system",
        update() {
          if (options.state.input.rewardChoiceRequested) {
            ctx.eventBus.emit(
              "abyss.reward_selected",
              { rewardId: options.state.input.rewardChoiceRequested },
              "abyss.ui"
            );
          }
          if (options.state.input.gameplayBlocked) {
            return;
          }
          if (options.state.input.interactRequested) {
            pickupNearestLoot(ctx, options.state);
          }
        }
      });
    }
  });
}

function pickupNearestLoot(ctx: GameInstallContext, state: AbyssRuntimeState): void {
  const player = ctx.world
    .query([Actor])
    .find((entity) => ctx.world.get(entity, Actor)?.faction === "player");
  if (player === undefined) {
    return;
  }

  const playerPosition = ctx.world.get(player, Position);
  if (!playerPosition) {
    return;
  }

  let best:
    | {
        entity: string | number;
        distance: number;
      }
    | undefined;
  for (const entity of ctx.world.query([Loot, Position])) {
    const loot = ctx.world.get(entity, Loot);
    const position = ctx.world.get(entity, Position);
    if (!loot || !position || loot.picked) {
      continue;
    }

    const distance = Math.hypot(position.x - playerPosition.x, position.y - playerPosition.y);
    if (distance <= PICKUP_RADIUS && (!best || distance < best.distance)) {
      best = { entity, distance };
    }
  }

  if (!best) {
    return;
  }

  const loot = ctx.world.get(best.entity, Loot);
  if (!loot) {
    return;
  }

  loot.picked = true;
  if (loot.kind === "gold") {
    state.run.gold += loot.amount;
  }
  if (loot.kind === "gear") {
    const combat = ctx.world.get(player, Combat);
    if (combat) {
      combat.damage += 4;
    }
  }
  if (loot.kind === "blessing") {
    const combat = ctx.world.get(player, Combat);
    if (combat) {
      combat.maxEnergy += 8;
      combat.energy += 8;
    }
  }

  addRecentLoot(state.run, loot.label);
  spawnFloatingText(
    state,
    playerPosition.x,
    playerPosition.y - 42,
    loot.kind === "gold" ? `+${loot.amount}g` : loot.label,
    "loot"
  );
  ctx.eventBus.emit(
    "abyss.loot_picked",
    {
      lootId: loot.lootId,
      label: loot.label,
      kind: loot.kind,
      amount: loot.amount,
      gold: state.run.gold
    },
    "abyss.loot"
  );
  state.trace({
    kind: "loot",
    label: `picked ${loot.label}`,
    entityId: best.entity,
    payload: loot
  });
  ctx.world.despawn(best.entity);
}
