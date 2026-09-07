import type { GameEvent } from "@gamekits/event-bus";
import type { EntityId } from "@gamekits/world";
import { Actor, Combat, Loot, Position, Room } from "./components";
import { PLAYER_ACTOR_ID } from "./constants";
import type { AbyssRuntimeState } from "./runtime-state";
import type {
  AbyssActorInspectorSnapshot,
  AbyssContentSummary,
  AbyssEntitySnapshot,
  AbyssSnapshot
} from "./types";

const SKILLS = [
  { id: "ability.basic", key: "LMB", label: "Blade Cut" },
  { id: "ability.firebolt", key: "RMB", label: "Cinder Bolt" },
  { id: "ability.cleave", key: "1", label: "Void Cleave" },
  { id: "abyss.dodge", key: "Space", label: "Dodge" }
];

export function createAbyssSnapshot(state: AbyssRuntimeState): AbyssSnapshot {
  const player = state.playerEntity;
  const playerCombat = player === undefined ? undefined : state.world.get(player, Combat);
  const room = state.roomEntity === undefined ? undefined : state.world.get(state.roomEntity, Room);
  const enemies = state.world
    .query([Actor, Combat])
    .filter((entity) => state.world.get(entity, Actor)?.faction === "enemy");
  const remainingEnemies = enemies.filter(
    (entity) => state.world.get(entity, Actor)?.alive === true
  ).length;

  const camera = createCameraSnapshot(state);
  const snapshot: AbyssSnapshot = {
    running: false,
    clock: emptyClock(),
    objective: {
      label: room?.completed ? "Claim your reward" : "Clear the chamber",
      remainingEnemies,
      completed: room?.completed === true,
      roomId: state.activeRoomId,
      roomIndex: state.run.roomIndex
    },
    player: {
      health: playerCombat?.health ?? 0,
      maxHealth: playerCombat?.maxHealth ?? 1,
      energy: playerCombat?.energy ?? 0,
      maxEnergy: playerCombat?.maxEnergy ?? 1,
      gold: state.run.gold,
      inventoryOpen: state.run.inventoryOpen,
      paused: state.run.paused
    },
    skills: createSkillSnapshots(state),
    rewardOpen: state.run.rewardOpen,
    rewardChoices: state.run.rewardChoices,
    entities: state.world.query().map((entity) => createEntitySnapshot(state, entity)),
    recentLoot: state.run.recentLoot,
    contentSummary: createContentSummary(state),
    actorInspectors: createActorInspectors(state),
    checkpoint: {
      runId: state.run.runId,
      version: state.run.checkpointVersion,
      roomIndex: state.run.roomIndex,
      completedRooms: state.run.completedRoomIds.length,
      selectedRewards: state.run.selectedRewardIds.length
    },
    timeline: [...state.timeline],
    events: [...state.events],
    gasTraces: state.gasTraceStore.list(),
    tcaTraces: state.tcaTraceStore.list()
  };
  if (camera) {
    snapshot.camera = camera;
  }
  const pickupPrompt = createPickupPrompt(state);
  if (pickupPrompt) {
    snapshot.pickupPrompt = pickupPrompt;
  }
  return snapshot;
}

function createCameraSnapshot(state: AbyssRuntimeState): AbyssSnapshot["camera"] {
  const camera = state.camera;
  if (!camera) {
    return undefined;
  }
  const target = camera.getState();
  const display = camera.getDisplayState();
  return {
    x: target.x,
    y: target.y,
    zoom: display.zoom,
    displayX: display.x,
    displayY: display.y,
    mode: target.mode
  };
}

function createContentSummary(state: AbyssRuntimeState): AbyssContentSummary {
  const snapshot = state.dataRegistry.snapshot();
  const documentsByType = new Map<string, number>();
  for (const document of snapshot.documents) {
    documentsByType.set(document.type, (documentsByType.get(document.type) ?? 0) + 1);
  }

  return {
    types: snapshot.types.length,
    documents: snapshot.documents.length,
    references: snapshot.references.length,
    activeRoomId: state.activeRoomId,
    activeWaveId: state.activeWaveId,
    activeRewardPoolId: state.activeRewardPoolId,
    documentsByType: [...documentsByType.entries()]
      .map(([type, count]) => ({ type, count }))
      .sort((left, right) => left.type.localeCompare(right.type))
  };
}

export function attachRuntimeSnapshot(
  snapshot: AbyssSnapshot,
  runtimeClock: AbyssSnapshot["clock"],
  running: boolean
): AbyssSnapshot {
  return {
    ...snapshot,
    running,
    clock: runtimeClock
  };
}

function createSkillSnapshots(state: AbyssRuntimeState): AbyssSnapshot["skills"] {
  const gas = state.gasRuntime();
  const actor = gas?.hasActor(PLAYER_ACTOR_ID) ? gas.getActor(PLAYER_ACTOR_ID) : undefined;
  const now = state.lastElapsed;
  return SKILLS.map((skill) => {
    const cooldownUntil = actor?.abilities.cooldowns[skill.id] ?? 0;
    const cooldownRemainingMs = Math.max(0, cooldownUntil - now);
    return {
      ...skill,
      cooldownRemainingMs,
      ready: cooldownRemainingMs <= 0
    };
  });
}

function createActorInspectors(state: AbyssRuntimeState): AbyssActorInspectorSnapshot[] {
  const gas = state.gasRuntime();
  if (!gas) {
    return [];
  }

  return gas.snapshot().actors.map((actor) => ({
    actorId: actor.actor.actorId,
    entityId: actor.actor.entityId,
    definitionId: actor.actor.definitionId,
    attributes: Object.fromEntries(
      Object.entries(actor.attributes.base).map(([attribute, base]) => [
        attribute,
        { base, current: actor.attributes.current[attribute] ?? base }
      ])
    ),
    tags: [...actor.tags.values],
    activeEffects: actor.effects.active.map((effect) => ({
      id: effect.id,
      effectId: effect.effectId,
      expiresAt: effect.expiresAt,
      nextTickAt: effect.nextTickAt
    })),
    abilities: actor.abilities.ids.map((id) => ({
      id,
      cooldownUntil: actor.abilities.cooldowns[id] ?? 0
    }))
  }));
}

function createPickupPrompt(state: AbyssRuntimeState): AbyssSnapshot["pickupPrompt"] | undefined {
  const player = state.playerEntity;
  const playerPosition = player === undefined ? undefined : state.world.get(player, Position);
  if (!playerPosition) {
    return undefined;
  }

  let best:
    | {
        label: string;
        distance: number;
      }
    | undefined;
  for (const entity of state.world.query([Loot, Position])) {
    const loot = state.world.get(entity, Loot);
    const position = state.world.get(entity, Position);
    if (!loot || !position || loot.picked) {
      continue;
    }

    const distance = Math.hypot(position.x - playerPosition.x, position.y - playerPosition.y);
    if (distance <= 70 && (!best || distance < best.distance)) {
      best = { label: loot.label, distance };
    }
  }

  return best;
}

function createEntitySnapshot(state: AbyssRuntimeState, entity: EntityId): AbyssEntitySnapshot {
  const position = state.world.get(entity, Position);
  const actor = state.world.get(entity, Actor);
  const combat = state.world.get(entity, Combat);
  const loot = state.world.get(entity, Loot);
  const snapshot: AbyssEntitySnapshot = {
    id: entity,
    label: actor?.label ?? loot?.label ?? String(entity),
    role: actor?.role ?? loot?.kind ?? "effect",
    x: position?.x ?? 0,
    y: position?.y ?? 0
  };
  if (actor) {
    snapshot.actorId = actor.actorId;
    snapshot.faction = actor.faction;
  }
  if (combat) {
    snapshot.health = combat.health;
    snapshot.maxHealth = combat.maxHealth;
  }
  if (loot) {
    snapshot.lootKind = loot.kind;
    snapshot.lootLabel = loot.label;
  }
  return snapshot;
}

function emptyClock(): AbyssSnapshot["clock"] {
  return {
    elapsed: 0,
    delta: 0,
    ticks: 0,
    running: false
  };
}

export function appendEvent(buffer: GameEvent[], event: GameEvent, limit = 30): void {
  buffer.unshift(event);
  if (buffer.length > limit) {
    buffer.pop();
  }
}
