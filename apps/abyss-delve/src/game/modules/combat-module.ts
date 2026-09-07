import { defineGameModule } from "@gamekits/core";
import type { GameInstallContext } from "@gamekits/game-runtime";
import type { EntityId } from "@gamekits/world";
import {
  Actor,
  Combat,
  FloatingText,
  Hitbox,
  Lifetime,
  Position,
  Presentation,
  Projectile,
  Telegraph,
  Velocity
} from "../components";
import { PLAYER_ACTOR_ID } from "../constants";
import { angleTo, clampToRoom, distance, normalize } from "../math";
import type { AbyssRuntimeState } from "../runtime-state";
import {
  activateAbyssAbility,
  applyGasDamage,
  livingEnemies,
  nearestLivingEnemy,
  syncAllCombatFromGas,
  syncDamageAfterGas
} from "./combat-helpers";

export type CreateAbyssCombatModuleOptions = {
  state: AbyssRuntimeState;
};

const PLAYER_BASIC_RANGE = 112;
const PLAYER_PRIMARY_SPEED = 480;
const PLAYER_CLEAVE_RANGE = 128;
const PLAYER_CLEAVE_ARC_DOT = 0.2;
const ENERGY_REGEN_PER_SECOND = 12;

export function createAbyssCombatModule(options: CreateAbyssCombatModuleOptions) {
  return defineGameModule<GameInstallContext>({
    id: "abyss.combat",
    install(ctx) {
      ctx.systems.register({
        id: "abyss.combat.system",
        update(system) {
          const elapsed = system.elapsed;
          const deltaSeconds = system.delta / 1000;
          options.state.lastElapsed = elapsed;

          syncAllCombatFromGas(options.state, elapsed);
          regeneratePlayerEnergy(ctx, options.state, deltaSeconds);
          handlePlayerAttacks(ctx, options.state, elapsed);
          updateProjectiles(ctx, options.state, system.delta, elapsed);
          updateTemporaryEntities(ctx, system.delta);
        }
      });
    }
  });
}

function regeneratePlayerEnergy(
  ctx: GameInstallContext,
  state: AbyssRuntimeState,
  deltaSeconds: number
): void {
  const gas = state.gasRuntime();
  if (!gas?.hasActor(PLAYER_ACTOR_ID)) {
    return;
  }

  const actor = gas.getActor(PLAYER_ACTOR_ID);
  const maxEnergy = actor.attributes.base.energy ?? 0;
  const currentEnergy = actor.attributes.current.energy ?? 0;
  if (currentEnergy >= maxEnergy) {
    syncPlayerCombatFromGas(ctx, gas);
    return;
  }

  gas.modifyAttribute(
    PLAYER_ACTOR_ID,
    {
      attribute: "energy",
      operation: "add",
      value: Math.min(maxEnergy - currentEnergy, ENERGY_REGEN_PER_SECOND * deltaSeconds)
    },
    "abyss.energy_regen"
  );
  syncPlayerCombatFromGas(ctx, gas);
}

function handlePlayerAttacks(
  ctx: GameInstallContext,
  state: AbyssRuntimeState,
  elapsed: number
): void {
  if (state.input.gameplayBlocked || state.run.paused || state.run.rewardOpen) {
    return;
  }

  const player = findPlayer(ctx);
  if (player === undefined) {
    return;
  }

  const position = ctx.world.get(player, Position);
  const combat = ctx.world.get(player, Combat);
  if (!position || !combat || combat.health <= 0) {
    return;
  }

  if (state.input.attackRequested) {
    useBasicAttack(ctx, state, player, position, elapsed);
  }
  if (state.input.skillPrimaryRequested) {
    usePrimarySkill(ctx, state, player, position, elapsed);
  }
  if (state.input.skillSecondaryRequested) {
    useSecondarySkill(ctx, state, player, position, elapsed);
  }
}

function useBasicAttack(
  ctx: GameInstallContext,
  state: AbyssRuntimeState,
  player: EntityId,
  playerPosition: { x: number; y: number; rotation: number },
  elapsed: number
): void {
  const target = nearestLivingEnemy(ctx.world, playerPosition, PLAYER_BASIC_RANGE);
  if (!target) {
    spawnSlashTelegraph(ctx, player, playerPosition.x, playerPosition.y, 64, 140);
    return;
  }

  const targetActor = ctx.world.get(target.entity, Actor);
  if (!targetActor) {
    return;
  }

  const activated = activateAbyssAbility(state, {
    actorId: PLAYER_ACTOR_ID,
    abilityId: "ability.basic",
    targetActorId: targetActor.actorId
  });
  if (!activated) {
    return;
  }
  syncDamageAfterGas(state, target.entity, elapsed);
  spawnSlashTelegraph(ctx, player, playerPosition.x, playerPosition.y, 72, 140);
  traceCombat(state, "basic attack", targetActor.actorId, target.entity);
}

function usePrimarySkill(
  ctx: GameInstallContext,
  state: AbyssRuntimeState,
  player: EntityId,
  playerPosition: { x: number; y: number; rotation: number },
  elapsed: number
): void {
  const gas = state.gasRuntime();
  const activated = activateAbyssAbility(state, {
    actorId: PLAYER_ACTOR_ID,
    abilityId: "ability.firebolt",
    targetActorId: PLAYER_ACTOR_ID
  });
  syncPlayerCombatFromGas(ctx, gas);
  if (!activated) {
    return;
  }

  const aim = normalize(state.input.aimX - playerPosition.x, state.input.aimY - playerPosition.y);
  const projectile = ctx.world.spawn();
  ctx.world.add(projectile, Position, {
    x: playerPosition.x + aim.x * 32,
    y: playerPosition.y + aim.y * 32,
    rotation: Math.atan2(aim.y, aim.x)
  });
  ctx.world.add(projectile, Velocity, {
    x: aim.x * PLAYER_PRIMARY_SPEED,
    y: aim.y * PLAYER_PRIMARY_SPEED
  });
  ctx.world.add(projectile, Projectile, {
    owner: player,
    faction: "player",
    damage: 34,
    speed: PLAYER_PRIMARY_SPEED,
    lifetimeMs: 1200,
    hitRadius: 18
  });
  ctx.world.add(projectile, Hitbox, { radius: 14 });
  ctx.world.add(projectile, Presentation, {
    renderKey: "abyss.render.projectile",
    layer: 8
  });
  traceCombat(state, "cinder bolt", PLAYER_ACTOR_ID, player, {
    x: playerPosition.x,
    y: playerPosition.y,
    elapsed
  });
}

function useSecondarySkill(
  ctx: GameInstallContext,
  state: AbyssRuntimeState,
  _player: EntityId,
  playerPosition: { x: number; y: number; rotation: number },
  elapsed: number
): void {
  const gas = state.gasRuntime();
  const activated = activateAbyssAbility(state, {
    actorId: PLAYER_ACTOR_ID,
    abilityId: "ability.cleave",
    targetActorId: PLAYER_ACTOR_ID
  });
  syncPlayerCombatFromGas(ctx, gas);
  if (!activated) {
    return;
  }

  const facing = normalize(
    state.input.aimX - playerPosition.x,
    state.input.aimY - playerPosition.y
  );
  for (const enemy of livingEnemies(ctx.world)) {
    const enemyPosition = ctx.world.get(enemy, Position);
    const enemyActor = ctx.world.get(enemy, Actor);
    if (!enemyPosition || !enemyActor) {
      continue;
    }

    const toEnemy = normalize(
      enemyPosition.x - playerPosition.x,
      enemyPosition.y - playerPosition.y
    );
    const dot = facing.x * toEnemy.x + facing.y * toEnemy.y;
    if (
      dot >= PLAYER_CLEAVE_ARC_DOT &&
      distance(playerPosition, enemyPosition) <= PLAYER_CLEAVE_RANGE
    ) {
      applyGasDamage(state, enemy, "effect.cleave_damage", PLAYER_ACTOR_ID, elapsed);
      applyGasDamage(state, enemy, "effect.exposed", PLAYER_ACTOR_ID, elapsed);
    }
  }

  spawnSlashTelegraph(ctx, _player, playerPosition.x, playerPosition.y, PLAYER_CLEAVE_RANGE, 220);
  traceCombat(state, "void cleave", PLAYER_ACTOR_ID, _player);
}

function updateProjectiles(
  ctx: GameInstallContext,
  state: AbyssRuntimeState,
  delta: number,
  elapsed: number
): void {
  const deltaSeconds = delta / 1000;
  for (const entity of ctx.world.query([Projectile, Position, Velocity])) {
    const projectile = ctx.world.get(entity, Projectile);
    const position = ctx.world.get(entity, Position);
    const velocity = ctx.world.get(entity, Velocity);
    if (!projectile || !position || !velocity) {
      continue;
    }

    projectile.ageMs += delta;
    position.x += velocity.x * deltaSeconds;
    position.y += velocity.y * deltaSeconds;
    position.rotation = angleTo({ x: 0, y: 0 }, velocity);
    clampToRoom(position, projectile.hitRadius);

    if (projectile.faction === "player") {
      hitEnemyWithProjectile(ctx, state, entity, position, projectile, elapsed);
    } else {
      hitPlayerWithProjectile(ctx, state, entity, position, projectile, elapsed);
    }

    if (ctx.world.has(entity) && projectile.ageMs >= projectile.lifetimeMs) {
      ctx.world.despawn(entity);
    }
  }
}

function hitEnemyWithProjectile(
  ctx: GameInstallContext,
  state: AbyssRuntimeState,
  projectileEntity: EntityId,
  projectilePosition: { x: number; y: number },
  projectile: { hitRadius: number },
  elapsed: number
): void {
  for (const enemy of livingEnemies(ctx.world)) {
    const enemyPosition = ctx.world.get(enemy, Position);
    const enemyHitbox = ctx.world.get(enemy, Hitbox);
    const enemyActor = ctx.world.get(enemy, Actor);
    if (!enemyPosition || !enemyHitbox || !enemyActor) {
      continue;
    }

    if (distance(projectilePosition, enemyPosition) <= projectile.hitRadius + enemyHitbox.radius) {
      applyGasDamage(state, enemy, "effect.fire_damage", PLAYER_ACTOR_ID, elapsed);
      applyGasDamage(state, enemy, "effect.burning", PLAYER_ACTOR_ID, elapsed);
      ctx.world.despawn(projectileEntity);
      traceCombat(state, "projectile hit", enemyActor.actorId, enemy);
      return;
    }
  }
}

function hitPlayerWithProjectile(
  ctx: GameInstallContext,
  state: AbyssRuntimeState,
  projectileEntity: EntityId,
  projectilePosition: { x: number; y: number },
  projectile: { hitRadius: number },
  elapsed: number
): void {
  const player = findPlayer(ctx);
  if (player === undefined) {
    return;
  }

  const position = ctx.world.get(player, Position);
  const hitbox = ctx.world.get(player, Hitbox);
  const combat = ctx.world.get(player, Combat);
  if (!position || !hitbox || !combat || elapsed < combat.invulnerableUntil) {
    return;
  }

  if (distance(projectilePosition, position) <= projectile.hitRadius + hitbox.radius) {
    applyGasDamage(state, player, "effect.enemy_hit", "enemy.projectile", elapsed);
    ctx.world.despawn(projectileEntity);
  }
}

function updateTemporaryEntities(ctx: GameInstallContext, delta: number): void {
  for (const entity of ctx.world.query([Lifetime])) {
    const lifetime = ctx.world.get(entity, Lifetime);
    const position = ctx.world.get(entity, Position);
    if (!lifetime) {
      continue;
    }

    lifetime.ageMs += delta;
    if (position && ctx.world.get(entity, FloatingText)) {
      position.y -= delta * 0.035;
    }

    if (lifetime.ageMs >= lifetime.lifetimeMs) {
      ctx.world.despawn(entity);
    }
  }
}

function spawnSlashTelegraph(
  ctx: GameInstallContext,
  owner: EntityId,
  x: number,
  y: number,
  radius: number,
  lifetimeMs: number
): void {
  const entity = ctx.world.spawn();
  ctx.world.add(entity, Position, { x, y, rotation: 0 });
  ctx.world.add(entity, Telegraph, { owner, radius });
  ctx.world.add(entity, Lifetime, { lifetimeMs });
  ctx.world.add(entity, Presentation, { renderKey: "abyss.render.telegraph", layer: 4 });
}

function syncPlayerCombatFromGas(
  ctx: GameInstallContext,
  gas: ReturnType<AbyssRuntimeState["gasRuntime"]>
): void {
  if (!gas?.hasActor(PLAYER_ACTOR_ID)) {
    return;
  }

  const player = findPlayer(ctx);
  if (player === undefined) {
    return;
  }

  const combat = ctx.world.get(player, Combat);
  if (!combat) {
    return;
  }

  const actor = gas.getActor(PLAYER_ACTOR_ID);
  combat.health = actor.attributes.current.health ?? combat.health;
  combat.maxHealth = actor.attributes.base.health ?? combat.maxHealth;
  combat.energy = actor.attributes.current.energy ?? combat.energy;
  combat.maxEnergy = actor.attributes.base.energy ?? combat.maxEnergy;
}

function findPlayer(ctx: GameInstallContext): EntityId | undefined {
  return ctx.world
    .query([Actor])
    .find((entity) => ctx.world.get(entity, Actor)?.actorId === PLAYER_ACTOR_ID);
}

function traceCombat(
  state: AbyssRuntimeState,
  label: string,
  actorId: string,
  entityId: EntityId,
  payload?: unknown
): void {
  state.trace({
    kind: "combat",
    label,
    actorId,
    entityId,
    payload
  });
}
