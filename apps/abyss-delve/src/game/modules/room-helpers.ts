import {
  GasAbilities,
  GasActor,
  GasAttributes,
  GasEffects,
  GasTags,
  type GasActorRuntimeState
} from "@gamekits/gas";
import { PLAYER_ACTOR_ID } from "../constants";
import {
  Actor,
  Combat,
  EnemyAi,
  Hitbox,
  Loot,
  PlayerControl,
  Position,
  Presentation,
  Room,
  Velocity,
  type ActorRole,
  type CombatState
} from "../components";
import type {
  AbyssEnemyProfile,
  AbyssHeroClass,
  AbyssRewardDefinition,
  AbyssRewardPool,
  AbyssRoomTemplate,
  AbyssWaveProfile
} from "../content";
import {
  ABYSS_ENEMY_TYPE,
  ABYSS_HERO_TYPE,
  ABYSS_REWARD_POOL_TYPE,
  ABYSS_REWARD_TYPE,
  ABYSS_ROOM_TYPE,
  ABYSS_WAVE_TYPE
} from "../content";
import type { AbyssRuntimeState } from "../runtime-state";
import type {
  AbyssCheckpointActorGasState,
  AbyssCheckpointData,
  AbyssCheckpointEnemy,
  AbyssCheckpointLoot,
  AbyssCheckpointPhase,
  AbyssCheckpointPlayer
} from "../save/checkpoint-types";

export const ABYSS_ROOM_SEQUENCE = ["room.bootstrap", "room.elite-preview", "room.reward-shrine"];

export type EnterAbyssRoomOptions = {
  roomIndex?: number | undefined;
  phase?: AbyssCheckpointPhase | undefined;
  player?: AbyssCheckpointPlayer | undefined;
  enemies?: AbyssCheckpointEnemy[] | undefined;
  loot?: AbyssCheckpointLoot[] | undefined;
};

export type AbyssPlayerCarryState = {
  combat?: CombatState | undefined;
  gas?: AbyssCheckpointActorGasState | undefined;
};

export function enterAbyssRoom(
  state: AbyssRuntimeState,
  roomId: string,
  options: EnterAbyssRoomOptions = {}
): void {
  clearAbyssWorld(state);

  const room = state.dataRegistry.getValue<AbyssRoomTemplate>(ABYSS_ROOM_TYPE, roomId);
  const hero = state.dataRegistry.getValue<AbyssHeroClass>(ABYSS_HERO_TYPE, room.heroClassId);
  const wave =
    room.waveProfileId === undefined
      ? undefined
      : state.dataRegistry.getValue<AbyssWaveProfile>(ABYSS_WAVE_TYPE, room.waveProfileId);
  const roomEntity = state.world.spawn();
  const phase = options.phase ?? "combat";

  state.activeRoomId = room.id;
  state.activeWaveId = wave?.id;
  state.activeRewardPoolId = room.rewardPoolId;
  state.roomEntity = roomEntity;
  state.run.roomIndex = options.roomIndex ?? roomIndexFor(room.id);
  state.run.rewardChoices = createRewardChoices(state, room.rewardPoolId ?? "rewardPool.bootstrap");
  state.run.completed = phase !== "combat";
  state.run.rewardOpen = phase === "reward";
  state.run.inventoryOpen = false;
  state.run.paused = false;

  state.world.add(roomEntity, Room, {
    roomId: room.id,
    completed: phase !== "combat",
    rewardOpen: phase === "reward",
    ...(state.run.selectedReward === undefined ? {} : { rewardSelected: state.run.selectedReward })
  });
  state.world.add(roomEntity, Position, {
    x: room.bounds.x + room.bounds.width / 2,
    y: room.bounds.y + room.bounds.height / 2,
    rotation: 0
  });
  state.world.add(roomEntity, Presentation, {
    renderKey: "abyss.render.room.floor",
    layer: 0
  });

  spawnPlayer(state, hero, options.player);

  const enemies =
    options.enemies ??
    createSpawnList(wave).map((spawn, index) => {
      const profile = state.dataRegistry.getValue<AbyssEnemyProfile>(
        ABYSS_ENEMY_TYPE,
        spawn.profileId
      );
      return createEnemyCheckpoint(profile, index, spawn.x, spawn.y);
    });
  for (const enemy of enemies) {
    if (enemy.combat.health > 0) {
      spawnEnemy(state, enemy);
    }
  }

  for (const loot of options.loot ?? []) {
    spawnLoot(state, loot);
  }

  state.eventBus.emit(
    "abyss.room_entered",
    { roomId: room.id, waveId: wave?.id, enemies: enemies.length },
    "abyss.room"
  );
  state.trace({ kind: "runtime", label: `Entered ${room.label}` });
}

export function enterNextAbyssRoom(
  state: AbyssRuntimeState,
  carry: AbyssPlayerCarryState = {}
): void {
  const nextIndex = Math.min(state.run.roomIndex + 1, ABYSS_ROOM_SEQUENCE.length - 1);
  enterAbyssRoom(state, ABYSS_ROOM_SEQUENCE[nextIndex] ?? ABYSS_ROOM_SEQUENCE[0]!, {
    roomIndex: nextIndex,
    phase: nextIndex >= ABYSS_ROOM_SEQUENCE.length - 1 ? "complete" : "combat",
    player: createCarriedPlayer(state, carry)
  });
}

export function restoreAbyssCheckpoint(
  state: AbyssRuntimeState,
  checkpoint: AbyssCheckpointData
): void {
  state.run.runId = checkpoint.runId;
  state.run.checkpointVersion = checkpoint.checkpointVersion;
  state.run.roomIndex = checkpoint.roomIndex;
  state.run.completedRoomIds = [...checkpoint.completedRoomIds];
  state.run.selectedRewardIds = [...checkpoint.selectedRewardIds];
  state.run.selectedReward = checkpoint.selectedReward;
  state.run.gold = checkpoint.gold;
  state.run.recentLoot = [...checkpoint.recentLoot];
  state.run.rewardChoices = state.run.rewardChoices.map((choice) => ({
    ...choice,
    selected: checkpoint.rewardChoices.some((saved) => saved.id === choice.id && saved.selected)
  }));
  state.input.gameplayBlocked = false;
  state.input.rewardChoiceRequested = undefined;

  enterAbyssRoom(state, checkpoint.currentRoomId, {
    roomIndex: checkpoint.roomIndex,
    phase: checkpoint.phase,
    player: checkpoint.player,
    enemies: checkpoint.enemies,
    loot: checkpoint.loot
  });
}

export function capturePlayerCarryState(state: AbyssRuntimeState): AbyssPlayerCarryState {
  const player = state.playerEntity;
  const combat = player === undefined ? undefined : state.world.get(player, Combat);
  const gas = state.gasRuntime()?.hasActor(PLAYER_ACTOR_ID)
    ? toGasCheckpoint(state.gasRuntime()?.getActor(PLAYER_ACTOR_ID))
    : undefined;
  return {
    combat: combat ? cloneCombat(combat) : undefined,
    gas
  };
}

function clearAbyssWorld(state: AbyssRuntimeState): void {
  for (const entity of state.world.query()) {
    state.world.despawn(entity);
  }
  state.playerEntity = undefined;
  state.roomEntity = undefined;
}

function spawnPlayer(
  state: AbyssRuntimeState,
  hero: AbyssHeroClass,
  checkpoint: AbyssCheckpointPlayer | undefined
): void {
  const player = state.world.spawn();
  state.playerEntity = player;
  state.world.add(player, Position, checkpoint?.position ?? { ...hero.spawn, rotation: 0 });
  state.world.add(player, Velocity);
  state.world.add(player, Hitbox, { radius: 18 });
  state.world.add(player, Actor, {
    actorId: checkpoint?.actorId ?? PLAYER_ACTOR_ID,
    definitionId: checkpoint?.definitionId ?? hero.actorDefinitionId,
    archetypeId: checkpoint?.archetypeId ?? hero.id,
    label: checkpoint?.label ?? hero.label,
    faction: "player",
    role: "player"
  });
  state.world.add(player, Combat, checkpoint?.combat ?? createPlayerCombat());
  state.world.add(player, PlayerControl);
  state.world.add(player, Presentation, { renderKey: hero.renderObjectId, layer: 10 });
  state.gasRuntime()?.createActor({
    actorId: checkpoint?.actorId ?? PLAYER_ACTOR_ID,
    definitionId: checkpoint?.definitionId ?? hero.actorDefinitionId,
    entityId: player
  });
  if (checkpoint?.gas) {
    restoreGasActorState(state, player, checkpoint.gas);
  }
}

function spawnEnemy(state: AbyssRuntimeState, checkpoint: AbyssCheckpointEnemy): void {
  const profile = state.dataRegistry.getValue<AbyssEnemyProfile>(
    ABYSS_ENEMY_TYPE,
    checkpoint.archetypeId
  );
  const entity = state.world.spawn();
  state.world.add(entity, Position, checkpoint.position);
  state.world.add(entity, Velocity);
  state.world.add(entity, Hitbox, { radius: profile.radius });
  state.world.add(entity, Actor, {
    actorId: checkpoint.actorId,
    definitionId: checkpoint.definitionId,
    archetypeId: checkpoint.archetypeId,
    label: checkpoint.label,
    faction: "enemy",
    role: checkpoint.role
  });
  state.world.add(entity, Combat, checkpoint.combat);
  state.world.add(entity, EnemyAi, checkpoint.ai);
  state.world.add(entity, Presentation, { renderKey: profile.renderObjectId, layer: 8 });
  state.gasRuntime()?.createActor({
    actorId: checkpoint.actorId,
    definitionId: checkpoint.definitionId,
    entityId: entity
  });
  if (checkpoint.gas) {
    restoreGasActorState(state, entity, checkpoint.gas);
  }
}

function spawnLoot(state: AbyssRuntimeState, checkpoint: AbyssCheckpointLoot): void {
  const loot = state.world.spawn();
  state.world.add(loot, Position, checkpoint.position);
  state.world.add(loot, Loot, {
    lootId: checkpoint.lootId,
    label: checkpoint.label,
    kind: checkpoint.kind,
    amount: checkpoint.amount,
    ...(checkpoint.sourceActorId === undefined ? {} : { sourceActorId: checkpoint.sourceActorId })
  });
  state.world.add(loot, Presentation, {
    renderKey: checkpoint.renderKey,
    layer: checkpoint.layer
  });
}

function createEnemyCheckpoint(
  profile: AbyssEnemyProfile,
  index: number,
  x: number,
  y: number
): AbyssCheckpointEnemy {
  return {
    actorId: `abyss.enemy.${index}.${profile.role}`,
    definitionId: profile.actorDefinitionId,
    archetypeId: profile.id,
    label: profile.label,
    role: profile.role as ActorRole,
    position: { x, y, rotation: 0 },
    combat: {
      health: profile.maxHealth,
      maxHealth: profile.maxHealth,
      energy: 0,
      maxEnergy: 0,
      damage: profile.damage,
      attackRange: profile.attackRange,
      attackCooldownMs: profile.attackCooldownMs,
      nextAttackAt: 0,
      invulnerableUntil: 0,
      hitFlashUntil: 0
    },
    ai: {
      behavior: profile.role === "ranged" ? "kite" : profile.role === "heavy" ? "brute" : "chase",
      aggroRange: 520,
      preferredRange: profile.role === "ranged" ? 240 : profile.attackRange,
      windupUntil: 0,
      windupStartedAt: 0
    }
  };
}

function createCarriedPlayer(
  state: AbyssRuntimeState,
  carry: AbyssPlayerCarryState
): AbyssCheckpointPlayer | undefined {
  const room = state.dataRegistry.getValue<AbyssRoomTemplate>(
    ABYSS_ROOM_TYPE,
    ABYSS_ROOM_SEQUENCE[Math.min(state.run.roomIndex + 1, ABYSS_ROOM_SEQUENCE.length - 1)]!
  );
  const hero = state.dataRegistry.getValue<AbyssHeroClass>(ABYSS_HERO_TYPE, room.heroClassId);
  return {
    actorId: PLAYER_ACTOR_ID,
    definitionId: hero.actorDefinitionId,
    archetypeId: hero.id,
    label: hero.label,
    position: { ...hero.spawn, rotation: 0 },
    combat: carry.combat ?? createPlayerCombat(),
    gas: carry.gas
  };
}

function createPlayerCombat(): CombatState {
  return {
    health: 160,
    maxHealth: 160,
    energy: 100,
    maxEnergy: 100,
    damage: 18,
    attackRange: 82,
    attackCooldownMs: 340,
    nextAttackAt: 0,
    invulnerableUntil: 0,
    hitFlashUntil: 0
  };
}

function createSpawnList(wave: AbyssWaveProfile | undefined): Array<{
  profileId: string;
  x: number;
  y: number;
}> {
  if (!wave) {
    return [];
  }

  return wave.spawns.flatMap((spawn) =>
    Array.from({ length: spawn.count ?? 1 }, (_, index) => ({
      profileId: spawn.profileId,
      x: spawn.x + index * 28,
      y: spawn.y + index * 22
    }))
  );
}

function roomIndexFor(roomId: string): number {
  return Math.max(0, ABYSS_ROOM_SEQUENCE.indexOf(roomId));
}

function createRewardChoices(state: AbyssRuntimeState, poolId: string) {
  const pool = state.dataRegistry.getValue<AbyssRewardPool>(ABYSS_REWARD_POOL_TYPE, poolId);
  return pool.rewardIds.map((rewardId) => {
    const reward = state.dataRegistry.getValue<AbyssRewardDefinition>(ABYSS_REWARD_TYPE, rewardId);
    return {
      ...reward,
      selected: state.run.selectedRewardIds.includes(reward.id)
    };
  });
}

function restoreGasActorState(
  state: AbyssRuntimeState,
  entity: string | number,
  gas: AbyssCheckpointActorGasState
): void {
  state.world.set(entity, GasActor, { ...gas.actor, entityId: entity });
  state.world.set(entity, GasAttributes, {
    base: { ...gas.attributes.base },
    current: { ...gas.attributes.current }
  });
  state.world.set(entity, GasTags, { values: [...gas.tags.values] });
  state.world.set(entity, GasAbilities, {
    ids: [...gas.abilities.ids],
    cooldowns: { ...gas.abilities.cooldowns },
    disabled: [...gas.abilities.disabled]
  });
  state.world.set(entity, GasEffects, {
    active: gas.effects.active.map((effect) => ({ ...effect, targetActorId: gas.actor.actorId }))
  });
}

function toGasCheckpoint(
  state: GasActorRuntimeState | undefined
): AbyssCheckpointActorGasState | undefined {
  if (!state) {
    return undefined;
  }
  return {
    actor: { ...state.actor },
    attributes: {
      base: { ...state.attributes.base },
      current: { ...state.attributes.current }
    },
    tags: { values: [...state.tags.values] },
    abilities: {
      ids: [...state.abilities.ids],
      cooldowns: { ...state.abilities.cooldowns },
      disabled: [...state.abilities.disabled]
    },
    effects: {
      active: state.effects.active.map((effect) => ({ ...effect }))
    }
  };
}

function cloneCombat(combat: CombatState): CombatState {
  return { ...combat };
}
