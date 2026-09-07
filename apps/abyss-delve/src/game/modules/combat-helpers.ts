import type { GasAbilityActivation } from "@gamekits/gas";
import type { EntityId, GameWorld } from "@gamekits/world";
import { Actor, Combat, FloatingText, Lifetime, Position, Presentation } from "../components";
import { distance } from "../math";
import type { AbyssRuntimeState } from "../runtime-state";

export function livingEnemies(world: GameWorld): EntityId[] {
  return world
    .query([Actor, Combat])
    .filter((entity) => world.get(entity, Actor)?.faction === "enemy")
    .filter((entity) => world.get(entity, Actor)?.alive === true);
}

export function nearestLivingEnemy(
  world: GameWorld,
  from: { x: number; y: number },
  range: number
) {
  let nearest: EntityId | undefined;
  let nearestDistance = range;
  for (const enemy of livingEnemies(world)) {
    const position = world.get(enemy, Position);
    if (!position) {
      continue;
    }
    const current = distance(from, position);
    if (current <= nearestDistance) {
      nearest = enemy;
      nearestDistance = current;
    }
  }
  return nearest === undefined ? undefined : { entity: nearest, distance: nearestDistance };
}

export function applyGasDamage(
  state: AbyssRuntimeState,
  target: EntityId,
  effectId: string,
  sourceActorId: string,
  elapsed: number
): boolean {
  const actor = state.world.get(target, Actor);
  const combat = state.world.get(target, Combat);
  const position = state.world.get(target, Position);
  if (!actor || !combat || !position || !actor.alive) {
    return false;
  }

  state.gasRuntime()?.applyEffect({
    effectId,
    targetActorId: actor.actorId,
    sourceActorId
  });
  return syncDamageAfterGas(state, target, elapsed);
}

export function activateAbyssAbility(
  state: AbyssRuntimeState,
  input: GasAbilityActivation
): boolean {
  const gas = state.gasRuntime();
  if (!gas?.hasActor(input.actorId)) {
    return false;
  }

  return gas.activateAbility(input).status === "activated";
}

export function syncAllCombatFromGas(state: AbyssRuntimeState, elapsed: number): void {
  for (const entity of state.world.query([Actor, Combat])) {
    syncCombatFromGas(state, entity, elapsed, false);
  }
}

export function syncDamageAfterGas(
  state: AbyssRuntimeState,
  target: EntityId,
  elapsed: number
): boolean {
  return syncCombatFromGas(state, target, elapsed, true);
}

function syncCombatFromGas(
  state: AbyssRuntimeState,
  target: EntityId,
  elapsed: number,
  showNoDamageText: boolean
): boolean {
  const actor = state.world.get(target, Actor);
  const combat = state.world.get(target, Combat);
  const position = state.world.get(target, Position);
  if (!actor || !combat || !position || !actor.alive) {
    return false;
  }
  const gasActor = state.gasRuntime()?.getActor(actor.actorId);
  const nextHealth = gasActor?.attributes.current.health ?? combat.health;
  const damage = Math.max(0, combat.health - nextHealth);
  const healed = Math.max(0, nextHealth - combat.health);
  combat.health = nextHealth;
  if (damage > 0) {
    combat.hitFlashUntil = elapsed + 120;
  }
  state.world.set(target, Combat, combat);
  if (damage > 0 || showNoDamageText) {
    spawnFloatingText(
      state,
      position.x,
      position.y - 36,
      damage > 0 ? String(Math.round(damage)) : "hit",
      "damage"
    );
  }
  if (healed > 0) {
    spawnFloatingText(state, position.x, position.y - 36, `+${Math.round(healed)}`, "reward");
  }

  if (combat.health <= 0 && actor.alive) {
    actor.alive = false;
    state.world.set(target, Actor, actor);
    state.eventBus.emit(
      actor.faction === "enemy" ? "abyss.enemy_died" : "abyss.player_died",
      {
        actorId: actor.actorId,
        entityId: target,
        x: position.x,
        y: position.y,
        archetypeId: actor.archetypeId
      },
      "abyss.combat"
    );
    state.trace({
      kind: "combat",
      label: `${actor.label} defeated`,
      actorId: actor.actorId,
      entityId: target
    });
    return true;
  }
  return false;
}

export function spawnFloatingText(
  state: AbyssRuntimeState,
  x: number,
  y: number,
  text: string,
  tone: "damage" | "loot" | "reward"
): void {
  const entity = state.world.spawn();
  state.world.add(entity, Position, { x, y });
  state.world.add(entity, Lifetime, { lifetimeMs: 650 });
  state.world.add(entity, FloatingText, { text, tone });
  state.world.add(entity, Presentation, {
    renderKey: tone === "damage" ? "abyss.render.floating.damage" : "abyss.render.floating.loot",
    layer: 30
  });
}
