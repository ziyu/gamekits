import type { DataRegistry } from "@gamekits/data";
import {
  createCombatKinematicProjectileRecordBuffer,
  type CombatHandle,
  type CombatKinematicProjectileRecordBuffer,
  type CombatTraceStore
} from "@gamekits/combat";
import type { EventBus } from "@gamekits/event-bus";
import type { GasHandle, GasOperationContext } from "@gamekits/gas";
import {
  PhysicsBodyComponent,
  PhysicsColliderComponent,
  PhysicsTransformComponent,
  PhysicsVelocityComponent,
  type PhysicsBodyData,
  type PhysicsColliderData,
  type PhysicsHandle,
  type PhysicsQueryResult,
  type PhysicsTraceStore,
  type PhysicsVector
} from "@gamekits/physics-core";
import type { EntityId, GameWorld } from "@gamekits/world";

import { OUTPOST_ARENA } from "../content";
import type { OutpostIdentityRegistry, OutpostReplicatedWeaponState } from "../domain";
import { OutpostGameplayObject } from "./components";
import type {
  OutpostAuthorityCombatActorSnapshot,
  OutpostAuthorityCombatCommand,
  OutpostAuthorityCombatPlayer,
  OutpostAuthorityCombatProjectileSnapshot,
  OutpostAuthorityCombatSnapshot,
  OutpostAuthorityEnemySpawn
} from "./authority-combat-types";
import { createOutpostCombatCueStream, type OutpostCombatCueStream } from "./combat-cue-stream";
import { OUTPOST_PROJECTILE_RECORD_LIMIT } from "./rifle-projectile-network";

export const OUTPOST_COMBAT_PLAYER_DEFINITION_ID = "player.outpost.ranger";

export type CreateOutpostAuthorityCombatOptions = {
  dataRegistry: DataRegistry;
  world: GameWorld;
  identity: OutpostIdentityRegistry;
  physics: PhysicsHandle;
  physicsTrace: PhysicsTraceStore;
  gas: GasHandle;
  combat: CombatHandle;
  combatTrace: CombatTraceStore;
  eventBus: EventBus;
  projectileGeneration?: string | undefined;
  players(): ReadonlyMap<string, OutpostAuthorityCombatPlayer>;
  commands(): readonly OutpostAuthorityCombatCommand[];
  resolvePlayerDash(
    player: OutpostAuthorityCombatPlayer,
    command: OutpostAuthorityCombatCommand,
    accepted: boolean
  ): void;
  playerWeapon?(playerId: string): OutpostReplicatedWeaponState | undefined;
  aiState?(actorId: string):
    | {
        targetActorId?: string | undefined;
        goalId?: string | undefined;
        taskPhase?: string | undefined;
      }
    | undefined;
  initialEnemies?: readonly OutpostAuthorityEnemySpawn[] | undefined;
};

export type CombatObject = {
  id: string;
  kind: "enemy" | "buildable" | "projectile";
  definitionId: string;
  renderKey: string;
  entityId: EntityId;
  actorId?: string | undefined;
  bodyId: string;
  colliderId: string;
  sourceActorId?: string | undefined;
  sourceBodyId?: string | undefined;
  activationDelayMs?: number | undefined;
  damage?: number | undefined;
  remainingMs?: number | undefined;
  previousPosition?: PhysicsVector | undefined;
  correlationId?: string | undefined;
  parentId?: string | undefined;
};

export type CombatState = {
  options: CreateOutpostAuthorityCombatOptions;
  objectsById: Map<string, CombatObject>;
  objectsByActorId: Map<string, CombatObject>;
  objectsByEntityId: Map<EntityId, CombatObject>;
  knockbacksByObjectId: Map<string, { velocity: PhysicsVector; remainingMs: number }>;
  pendingDeaths: Map<
    string,
    { actorId: string; correlationId?: string | undefined; parentId?: string | undefined }
  >;
  cueStream: OutpostCombatCueStream;
  projectileGeneration: string;
  projectileRecords: CombatKinematicProjectileRecordBuffer;
  projectileRecordIdsByAuthorityId: Map<string, string>;
  elapsedMs: number;
  rememberCombatAim(actorId: string, point: PhysicsVector): void;
  initialWaveSpawned: boolean;
  nextTurretId: number;
  acceptedCommands: number;
  rejectedCommands: number;
  projectileHits: number;
  enemyAttacks: number;
  kills: number;
  drops: number;
  objectiveProgress: number;
};

export function createCombatState(options: CreateOutpostAuthorityCombatOptions): CombatState {
  const projectileGeneration = options.projectileGeneration ?? "outpost.authority";
  return {
    options,
    objectsById: new Map(),
    objectsByActorId: new Map(),
    objectsByEntityId: new Map(),
    knockbacksByObjectId: new Map(),
    pendingDeaths: new Map(),
    cueStream: createOutpostCombatCueStream(),
    projectileGeneration,
    projectileRecords: createCombatKinematicProjectileRecordBuffer({
      generation: projectileGeneration,
      capacity: OUTPOST_PROJECTILE_RECORD_LIMIT
    }),
    projectileRecordIdsByAuthorityId: new Map(),
    elapsedMs: 0,
    rememberCombatAim() {},
    initialWaveSpawned: false,
    nextTurretId: 1,
    acceptedCommands: 0,
    rejectedCommands: 0,
    projectileHits: 0,
    enemyAttacks: 0,
    kills: 0,
    drops: 0,
    objectiveProgress: 0
  };
}

export function materializeActorObject(
  state: CombatState,
  input: {
    id: string;
    kind: "enemy" | "buildable";
    definitionId: string;
    renderKey: string;
    actorDefinitionId: string;
    bodyData: PhysicsBodyData;
    colliderData: PhysicsColliderData;
    position: PhysicsVector;
    activationDelayMs?: number | undefined;
    sourceActorId?: string | undefined;
    context?: GasOperationContext | undefined;
  }
): CombatObject {
  const entityId = state.options.world.spawn();
  const bodyId = `${input.id}.body`;
  const colliderId = `${input.id}.collider`;
  const actorId = `${input.id}.actor`;
  const object: CombatObject = {
    id: input.id,
    kind: input.kind,
    definitionId: input.definitionId,
    renderKey: input.renderKey,
    entityId,
    actorId,
    bodyId,
    colliderId,
    activationDelayMs: input.activationDelayMs,
    sourceActorId: input.sourceActorId
  };
  try {
    state.options.world.add(entityId, OutpostGameplayObject, { id: input.id, kind: input.kind });
    state.options.world.add(entityId, PhysicsTransformComponent, { position: input.position });
    state.options.world.add(entityId, PhysicsVelocityComponent, { linear: { x: 0, y: 0 } });
    state.options.world.add(entityId, PhysicsBodyComponent, {
      definition: toBodyDefinition(input.bodyData, bodyId),
      syncVelocityFromWorld: input.kind === "enemy"
    });
    state.options.world.add(entityId, PhysicsColliderComponent, {
      definition: toColliderDefinition(input.colliderData, colliderId)
    });
    state.options.gas.createActor({
      actorId,
      definitionId: input.actorDefinitionId,
      entityId,
      ...input.context
    });
    state.options.identity.register({
      gameplayObjectId: input.id,
      entityId,
      actorId,
      physicsBodyId: bodyId,
      physicsColliderIds: [colliderId],
      network: { entityId: input.id, generation: 0 }
    });
    registerCombatObject(state, object);
    return object;
  } catch (error) {
    state.options.identity.remove(input.id);
    if (state.options.gas.isBound() && state.options.gas.hasActor(actorId)) {
      state.options.gas.removeActor(actorId, input.context);
    }
    if (state.options.world.has(entityId)) {
      state.options.world.despawn(entityId);
    }
    throw error;
  }
}

export function removeCombatObject(
  state: CombatState,
  object: CombatObject,
  removeActor = true
): void {
  state.objectsById.delete(object.id);
  state.knockbacksByObjectId.delete(object.id);
  state.objectsByEntityId.delete(object.entityId);
  if (object.actorId) {
    state.objectsByActorId.delete(object.actorId);
    if (removeActor && state.options.gas.isBound() && state.options.gas.hasActor(object.actorId)) {
      state.options.gas.removeActor(object.actorId);
    }
  }
  state.options.identity.remove(object.id);
  if (state.options.world.has(object.entityId)) {
    state.options.world.despawn(object.entityId);
  }
}

export function captureCombatSnapshot(state: CombatState): OutpostAuthorityCombatSnapshot {
  const actors: OutpostAuthorityCombatActorSnapshot[] = [];
  for (const player of state.options.players().values()) {
    pushActorSnapshot(state, actors, {
      id: player.playerId,
      kind: "player",
      definitionId: OUTPOST_COMBAT_PLAYER_DEFINITION_ID,
      renderKey: "render.outpost.player",
      entityId: player.entityId,
      actorId: player.actorId,
      weapon: state.options.playerWeapon?.(player.playerId)
    });
  }
  for (const object of state.objectsById.values()) {
    if (!object.actorId || object.kind === "projectile") {
      continue;
    }
    pushActorSnapshot(state, actors, {
      id: object.id,
      kind: object.kind,
      definitionId: object.definitionId,
      renderKey: object.renderKey,
      entityId: object.entityId,
      actorId: object.actorId
    });
  }
  actors.sort((left, right) => left.id.localeCompare(right.id));
  const projectiles = captureProjectileSnapshots(state);
  const cueStream = state.cueStream.snapshot();
  return {
    actors,
    projectiles,
    projectileGeneration: state.projectileGeneration,
    projectileRecords: state.projectileRecords.list(),
    cueWatermark: cueStream.cueWatermark,
    cues: cueStream.cues,
    projectileCount: projectiles.length,
    acceptedCommands: state.acceptedCommands,
    rejectedCommands: state.rejectedCommands,
    projectileHits: state.projectileHits,
    enemyAttacks: state.enemyAttacks,
    kills: state.kills,
    drops: state.drops,
    objectiveProgress: state.objectiveProgress
  };
}

export function rejectCommand(
  state: CombatState,
  command: OutpostAuthorityCombatCommand,
  reason: string
): void {
  state.rejectedCommands += 1;
  state.cueStream.append({
    kind: "action-rejected",
    at: state.elapsedMs,
    sourceObjectId: command.playerId,
    correlationId: command.correlationId ?? command.id,
    parentId: command.parentId ?? command.id,
    ability: command.ability,
    reason
  });
  state.options.eventBus.emit(
    "outpost.combat.command_rejected",
    { commandId: command.id, playerId: command.playerId, ability: command.ability, reason },
    "outpost.authority.combat",
    operationContext(command)
  );
}

export function actorKind(state: CombatState, actorId: string): string | undefined {
  if ([...state.options.players().values()].some((player) => player.actorId === actorId)) {
    return "player";
  }
  return state.objectsByActorId.get(actorId)?.kind;
}

export function combatObjectIdForActor(state: CombatState, actorId: string): string | undefined {
  for (const player of state.options.players().values()) {
    if (player.actorId === actorId) {
      return player.playerId;
    }
  }
  return state.objectsByActorId.get(actorId)?.id;
}

export function actorHealth(state: CombatState, actorId: string): number {
  return state.options.gas.getActor(actorId).attributes.current.health ?? 0;
}

export function combatObjects<TKind extends CombatObject["kind"]>(
  state: CombatState,
  kind: TKind
): Array<CombatObject & { kind: TKind }> {
  return [...state.objectsById.values()].filter(
    (object): object is CombatObject & { kind: TKind } => object.kind === kind
  );
}

export function combatObjectForQueryResult(
  state: CombatState,
  hit: PhysicsQueryResult
): CombatObject | undefined {
  const identity =
    (hit.entityId === undefined ? undefined : state.options.identity.byEntityId(hit.entityId)) ??
    state.options.identity.byPhysicsColliderId(hit.colliderId) ??
    (hit.bodyId === undefined ? undefined : state.options.identity.byPhysicsBodyId(hit.bodyId));
  return identity === undefined ? undefined : state.objectsByEntityId.get(identity.entityId);
}

export function firstCollider(registry: DataRegistry, body: PhysicsBodyData): PhysicsColliderData {
  const collider = body.colliders?.[0];
  if (!collider) {
    throw new Error(`Outpost combat body requires a collider: ${body.id}`);
  }
  return registry.getValue<PhysicsColliderData>(collider.type, collider.id);
}

export function nearestPlayer(
  world: GameWorld,
  origin: PhysicsVector,
  players: readonly OutpostAuthorityCombatPlayer[]
): OutpostAuthorityCombatPlayer {
  let nearest = players[0];
  let nearestDistance = Number.POSITIVE_INFINITY;
  for (const player of players) {
    const position = requireTransform(world, player.entityId).position;
    const distance = squaredDistance(origin, position);
    if (distance < nearestDistance) {
      nearest = player;
      nearestDistance = distance;
    }
  }
  if (!nearest) {
    throw new Error("Outpost combat requires at least one player target");
  }
  return nearest;
}

export function nearestObject(
  world: GameWorld,
  origin: PhysicsVector,
  objects: readonly CombatObject[]
): CombatObject {
  let nearest = objects[0];
  let nearestDistance = Number.POSITIVE_INFINITY;
  for (const object of objects) {
    const position = requireTransform(world, object.entityId).position;
    const distance = squaredDistance(origin, position);
    if (distance < nearestDistance) {
      nearest = object;
      nearestDistance = distance;
    }
  }
  if (!nearest) {
    throw new Error("Outpost combat requires at least one object target");
  }
  return nearest;
}

export function normalizedAim(
  world: GameWorld,
  entityId: EntityId,
  aimX: number,
  aimY: number
): PhysicsVector {
  const transform = requireTransform(world, entityId);
  const gameplay = world.get(entityId, OutpostGameplayObject);
  const direction = { x: aimX - transform.position.x, y: aimY - transform.position.y };
  if (direction.x !== 0 || direction.y !== 0) {
    return normalizeVector(direction);
  }
  const facing = gameplay?.facing ?? 0;
  return { x: Math.cos(facing), y: Math.sin(facing) };
}

export function normalizeVector(vector: PhysicsVector): PhysicsVector {
  const length = Math.hypot(vector.x, vector.y);
  return length === 0 ? { x: 1, y: 0 } : { x: vector.x / length, y: vector.y / length };
}

export function insideArena(x: number, y: number, padding: number): boolean {
  return (
    Number.isFinite(x) &&
    Number.isFinite(y) &&
    x >= padding &&
    y >= padding &&
    x <= OUTPOST_ARENA.width - padding &&
    y <= OUTPOST_ARENA.height - padding
  );
}

export function requireTransform(world: GameWorld, entityId: EntityId) {
  const transform = world.get(entityId, PhysicsTransformComponent);
  if (!transform) {
    throw new Error(`Missing Outpost combat transform for entity: ${String(entityId)}`);
  }
  return transform;
}

export function operationContext(command: OutpostAuthorityCombatCommand): GasOperationContext {
  return {
    ...(command.correlationId === undefined ? {} : { correlationId: command.correlationId }),
    parentId: command.parentId ?? command.id
  };
}

function registerCombatObject(state: CombatState, object: CombatObject): void {
  state.objectsById.set(object.id, object);
  state.objectsByEntityId.set(object.entityId, object);
  if (object.actorId) {
    state.objectsByActorId.set(object.actorId, object);
  }
}

function pushActorSnapshot(
  state: CombatState,
  target: OutpostAuthorityCombatActorSnapshot[],
  actor: Pick<
    OutpostAuthorityCombatActorSnapshot,
    "id" | "kind" | "definitionId" | "renderKey" | "entityId" | "actorId"
  > & { weapon?: OutpostReplicatedWeaponState | undefined }
): void {
  if (!state.options.gas.hasActor(actor.actorId) || !state.options.world.has(actor.entityId)) {
    return;
  }
  const gas = state.options.gas.getActor(actor.actorId);
  const transform = requireTransform(state.options.world, actor.entityId);
  const velocity = state.options.world.get(actor.entityId, PhysicsVelocityComponent);
  const gameplay = state.options.world.get(actor.entityId, OutpostGameplayObject);
  const identity = state.options.identity.byGameplayObjectId(actor.id);
  const execution = state.options.gas
    .listAbilityExecutions({ actorId: actor.actorId })
    .filter((candidate) => candidate.phase !== "completed" && candidate.phase !== "cancelled")
    .sort(
      (left, right) => right.requestedAt - left.requestedAt || right.id.localeCompare(left.id)
    )[0];
  const ai = state.options.aiState?.(actor.actorId);
  target.push({
    ...actor,
    networkEntityId: identity?.network?.entityId ?? actor.id,
    generation: identity?.network?.generation ?? 0,
    x: transform.position.x,
    y: transform.position.y,
    velocityX: velocity?.linear.x ?? 0,
    velocityY: velocity?.linear.y ?? 0,
    facing: gameplay?.facing ?? 0,
    health: gas.attributes.current.health ?? 0,
    shield: gas.attributes.current.shield ?? 0,
    stamina: gas.attributes.current.stamina ?? 0,
    resource: gas.attributes.current["shared-resource"] ?? 0,
    tags: [...gas.tags.values].sort(),
    cooldowns: { ...gas.abilities.cooldowns },
    ...(actor.weapon === undefined ? {} : { weapon: { ...actor.weapon } }),
    ...((execution?.targetActorId ?? ai?.targetActorId) === undefined
      ? {}
      : { targetActorId: execution?.targetActorId ?? ai?.targetActorId }),
    ...(ai?.goalId === undefined ? {} : { aiGoalId: ai.goalId }),
    ...(ai?.taskPhase === undefined ? {} : { aiTaskPhase: ai.taskPhase }),
    ...(execution === undefined
      ? {}
      : {
          abilityExecutionId: execution.id,
          abilityId: execution.abilityId,
          abilityPhase: execution.phase,
          abilityPhaseStartedAt: execution.phaseStartedAt,
          ...(execution.phaseEndsAt === undefined
            ? {}
            : { abilityPhaseEndsAt: execution.phaseEndsAt })
        })
  });
}

function captureProjectileSnapshots(
  state: CombatState
): OutpostAuthorityCombatProjectileSnapshot[] {
  const projectiles: OutpostAuthorityCombatProjectileSnapshot[] = [];
  for (const projectile of state.options.combat.isBound()
    ? state.options.combat.listProjectiles()
    : []) {
    if (!state.options.world.has(projectile.entityId)) {
      continue;
    }
    const transform = requireTransform(state.options.world, projectile.entityId);
    const velocity = state.options.world.get(projectile.entityId, PhysicsVelocityComponent);
    const velocityX = velocity?.linear.x ?? 0;
    const velocityY = velocity?.linear.y ?? 0;
    projectiles.push({
      id: projectile.projectileId,
      renderKey: "render.outpost.projectile",
      networkEntityId: projectile.projectileId,
      generation: 0,
      entityId: projectile.entityId,
      x: transform.position.x,
      y: transform.position.y,
      velocityX,
      velocityY,
      facing: velocityX === 0 && velocityY === 0 ? 0 : Math.atan2(velocityY, velocityX)
    });
  }
  return projectiles.sort((left, right) => left.id.localeCompare(right.id));
}

function squaredDistance(left: PhysicsVector, right: PhysicsVector): number {
  const x = left.x - right.x;
  const y = left.y - right.y;
  return x * x + y * y;
}

function toBodyDefinition(data: PhysicsBodyData, id: string) {
  const { colliders: _colliders, tags: _tags, ...definition } = data;
  return { ...definition, id };
}

function toColliderDefinition(data: PhysicsColliderData, id: string) {
  const { tags: _tags, ...definition } = data;
  return { ...definition, id };
}
