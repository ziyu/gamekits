import { defineGameModule } from "@gamekits/core";
import type { GameInstallContext } from "@gamekits/game-runtime";
import {
  Actor,
  Combat,
  EnemyAi,
  Hitbox,
  Position,
  Projectile,
  Telegraph,
  Velocity,
  Presentation,
  Lifetime
} from "../components";
import { angleTo, distance, normalize } from "../math";
import type { AbyssRuntimeState } from "../runtime-state";
import { applyGasDamage } from "./combat-helpers";

export function createAbyssEnemyAiModule(state: AbyssRuntimeState) {
  return defineGameModule<GameInstallContext>({
    id: "abyss.enemy_ai",
    install({ systems }) {
      systems.register({
        id: "abyss.enemy_ai.system",
        update({ world, delta, elapsed }) {
          const player = state.playerEntity;
          const playerPosition = player === undefined ? undefined : world.get(player, Position);
          const playerCombat = player === undefined ? undefined : world.get(player, Combat);
          if (
            !player ||
            !playerPosition ||
            !playerCombat ||
            playerCombat.health <= 0 ||
            state.run.paused ||
            state.run.rewardOpen
          ) {
            return;
          }

          for (const enemy of world.query([Actor, EnemyAi, Position, Velocity, Combat, Hitbox])) {
            const actor = world.get(enemy, Actor);
            const ai = world.get(enemy, EnemyAi);
            const position = world.get(enemy, Position);
            const velocity = world.get(enemy, Velocity);
            const combat = world.get(enemy, Combat);
            const hitbox = world.get(enemy, Hitbox);
            if (
              !actor ||
              !ai ||
              !position ||
              !velocity ||
              !combat ||
              !hitbox ||
              actor.faction !== "enemy" ||
              !actor.alive
            ) {
              continue;
            }

            const toPlayer = normalize(
              playerPosition.x - position.x,
              playerPosition.y - position.y
            );
            const range = distance(position, playerPosition);
            const profileSpeed = ai.behavior === "brute" ? 74 : ai.behavior === "kite" ? 96 : 128;
            const tooClose = ai.behavior === "kite" && range < ai.preferredRange - 36;
            const shouldMove = range > combat.attackRange * 0.85 || tooClose;
            velocity.x = shouldMove ? toPlayer.x * profileSpeed * (tooClose ? -1 : 1) : 0;
            velocity.y = shouldMove ? toPlayer.y * profileSpeed * (tooClose ? -1 : 1) : 0;
            position.x += velocity.x * (delta / 1000);
            position.y += velocity.y * (delta / 1000);
            position.rotation = angleTo(position, playerPosition);

            if (range <= combat.attackRange && elapsed >= combat.nextAttackAt) {
              combat.nextAttackAt = elapsed + combat.attackCooldownMs;
              if (ai.behavior === "kite") {
                spawnEnemyProjectile(
                  state,
                  enemy,
                  position.x,
                  position.y,
                  toPlayer.x,
                  toPlayer.y,
                  combat.damage
                );
              } else {
                spawnTelegraph(
                  state,
                  enemy,
                  playerPosition.x,
                  playerPosition.y,
                  combat.attackRange + hitbox.radius
                );
                if (elapsed >= playerCombat.invulnerableUntil) {
                  applyGasDamage(state, player, "effect.enemy_hit", actor.actorId, elapsed);
                }
              }
            }

            world.set(enemy, Position, position);
            world.set(enemy, Velocity, velocity);
            world.set(enemy, Combat, combat);
          }
        }
      });
    }
  });
}

function spawnEnemyProjectile(
  state: AbyssRuntimeState,
  owner: string | number,
  x: number,
  y: number,
  dx: number,
  dy: number,
  damage: number
): void {
  const projectile = state.world.spawn();
  state.world.add(projectile, Position, { x, y, rotation: Math.atan2(dy, dx) });
  state.world.add(projectile, Velocity, { x: dx * 280, y: dy * 280 });
  state.world.add(projectile, Projectile, {
    owner,
    faction: "enemy",
    damage,
    speed: 280,
    lifetimeMs: 1400,
    hitRadius: 12
  });
  state.world.add(projectile, Presentation, { renderKey: "abyss.render.projectile", layer: 12 });
}

function spawnTelegraph(
  state: AbyssRuntimeState,
  owner: string | number,
  x: number,
  y: number,
  radius: number
): void {
  const telegraph = state.world.spawn();
  state.world.add(telegraph, Position, { x, y });
  state.world.add(telegraph, Telegraph, { owner, radius });
  state.world.add(telegraph, Lifetime, { lifetimeMs: 180 });
  state.world.add(telegraph, Presentation, { renderKey: "abyss.render.telegraph", layer: 6 });
}
