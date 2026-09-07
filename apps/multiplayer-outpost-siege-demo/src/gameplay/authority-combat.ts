import { defineGameModule } from "@gamekits/core";
import type { CombatHitResult } from "@gamekits/combat";
import type { GasOperationContext } from "@gamekits/gas";
import type { GameInstallContext } from "@gamekits/game-runtime";
import {
  PhysicsTransformComponent,
  PhysicsVelocityComponent,
  type PhysicsBodyData,
  type PhysicsVector
} from "@gamekits/physics-core";
import type { TcaDefinitionSet } from "@gamekits/tca";

import {
  OUTPOST_BUILDABLE_TYPE,
  OUTPOST_ENEMY_TYPE,
  OUTPOST_PLAYER_TYPE,
  OUTPOST_WEAPON_TYPE,
  type OutpostBuildableDefinition,
  type OutpostEnemyDefinition,
  type OutpostPlayerDefinition,
  type OutpostWeaponDefinition
} from "../domain";
import { OutpostGameplayObject } from "./components";
import { createOutpostCombatTcaDefinitions, readPayloadString } from "./authority-combat-tca";
import {
  actorHealth,
  actorKind,
  captureCombatSnapshot,
  combatObjectIdForActor,
  combatObjects,
  createCombatState,
  firstCollider,
  insideArena,
  materializeActorObject,
  nearestObject,
  normalizeVector,
  operationContext,
  OUTPOST_COMBAT_PLAYER_DEFINITION_ID,
  rejectCommand,
  removeCombatObject,
  requireTransform,
  type CombatObject,
  type CombatState,
  type CreateOutpostAuthorityCombatOptions
} from "./authority-combat-state";
import {
  createOutpostCombatCoreIntegration,
  type OutpostCombatCoreIntegration
} from "./authority-combat-core";
import type {
  OutpostAuthorityAiActionResult,
  OutpostAuthorityAiEnemy,
  OutpostAuthorityCombatCommand,
  OutpostAuthorityCombatCommandResult,
  OutpostAuthorityCombatPlayer,
  OutpostAuthorityCombatSnapshot,
  OutpostAuthorityEnemySpawn
} from "./authority-combat-types";

export type {
  OutpostAuthorityAiActionResult,
  OutpostAuthorityAiEnemy,
  OutpostAuthorityCombatActorSnapshot,
  OutpostAuthorityCombatCommand,
  OutpostAuthorityCombatCommandResult,
  OutpostAuthorityCombatPlayer,
  OutpostAuthorityCombatProjectileSnapshot,
  OutpostAuthorityCombatSnapshot,
  OutpostAuthorityEnemySpawn
} from "./authority-combat-types";
export type { CreateOutpostAuthorityCombatOptions } from "./authority-combat-state";

const RIFLE_DEFINITION_ID = "weapon.outpost.rifle";
const RAIDER_DEFINITION_ID = "enemy.outpost.raider";
const TURRET_DEFINITION_ID = "buildable.outpost.turret";
const TURRET_RANGE = 360;
const KNOCKBACK_DURATION_MS = 120;

export type OutpostAuthorityCombat = {
  enemyLifecycleModule: ReturnType<typeof defineGameModule<GameInstallContext>>;
  prePhysicsModule: ReturnType<typeof defineGameModule<GameInstallContext>>;
  postPhysicsModule: ReturnType<typeof defineGameModule<GameInstallContext>>;
  coreModule: OutpostCombatCoreIntegration["module"];
  tcaDefinitions: TcaDefinitionSet;
  aiEnemies(): OutpostAuthorityAiEnemy[];
  activatePlayerAction(command: OutpostAuthorityCombatCommand): OutpostAuthorityCombatCommandResult;
  rejectPlayerAction(
    command: OutpostAuthorityCombatCommand,
    reason: string
  ): OutpostAuthorityCombatCommandResult;
  activateAiAction(enemyId: string, targetActorId: string): OutpostAuthorityAiActionResult;
  snapshot(): OutpostAuthorityCombatSnapshot;
};

const DEFAULT_ENEMY_SPAWNS: readonly OutpostAuthorityEnemySpawn[] = Object.freeze([
  {
    id: "enemy.opening.1",
    definitionId: RAIDER_DEFINITION_ID,
    x: 680,
    y: 500,
    activationDelayMs: 4_000
  },
  {
    id: "enemy.opening.2",
    definitionId: RAIDER_DEFINITION_ID,
    x: 1120,
    y: 500,
    activationDelayMs: 4_000
  },
  {
    id: "enemy.opening.3",
    definitionId: RAIDER_DEFINITION_ID,
    x: 900,
    y: 720,
    activationDelayMs: 4_000
  }
]);

export function createOutpostAuthorityCombat(
  options: CreateOutpostAuthorityCombatOptions
): OutpostAuthorityCombat {
  const state = createCombatState(options);
  const core = createOutpostCombatCoreIntegration(state, (hit, context) =>
    resolveCombatCoreHit(state, hit, context)
  );
  state.rememberCombatAim = core.rememberAim;

  return {
    enemyLifecycleModule: createEnemyLifecycleModule(state),
    prePhysicsModule: createCombatPrePhysicsModule(state, core),
    postPhysicsModule: createCombatPostPhysicsModule(state),
    coreModule: core.module,
    tcaDefinitions: createOutpostCombatTcaDefinitions({
      gas: state.options.gas,
      actorKind: (actorId) => actorKind(state, actorId)
    }),
    aiEnemies() {
      return captureAiEnemies(state);
    },
    activatePlayerAction(command) {
      return executeCombatCommand(state, command);
    },
    rejectPlayerAction(command, reason) {
      const player = state.options.players().get(command.playerId);
      if (command.ability === "dash" && player !== undefined) {
        state.options.resolvePlayerDash(player, command, false);
      }
      rejectCommand(state, command, reason);
      return { status: "rejected", reason };
    },
    activateAiAction(enemyId, targetActorId) {
      return activateEnemyAction(state, enemyId, targetActorId);
    },
    snapshot() {
      return captureCombatSnapshot(state);
    }
  };
}

function createEnemyLifecycleModule(state: CombatState) {
  return defineGameModule<GameInstallContext>({
    id: "outpost.authority.enemies.lifecycle",
    install(ctx) {
      ctx.systems.register({
        id: "outpost.authority.enemies.materialize",
        update({ delta, elapsed }) {
          state.elapsedMs = elapsed;
          ensureInitialEnemies(state);
          updateEnemyActivationDelays(state, delta);
        }
      });
    }
  });
}

function createCombatPrePhysicsModule(state: CombatState, core: OutpostCombatCoreIntegration) {
  return defineGameModule<GameInstallContext>({
    id: "outpost.authority.combat.pre-physics",
    install(ctx) {
      ctx.systems.register({
        id: "outpost.authority.combat.intent",
        update({ delta }) {
          for (const command of state.options.commands()) {
            executeCombatCommand(state, command);
          }
          updateKnockbacks(state, delta);
          updateTurrets(state);
        }
      });

      return () => {
        core.dispose();
        for (const object of state.objectsById.values()) {
          removeCombatObject(state, object, false);
        }
        state.knockbacksByObjectId.clear();
        state.pendingDeaths.clear();
        state.cueStream.clear();
      };
    }
  });
}

function createCombatPostPhysicsModule(state: CombatState) {
  return defineGameModule<GameInstallContext>({
    id: "outpost.authority.combat.post-physics",
    install(ctx) {
      const offKilled = ctx.eventBus.on("outpost.actor_killed", (event) => {
        const actorId = readPayloadString(event, "actorId");
        if (actorId) {
          state.pendingDeaths.set(actorId, {
            actorId,
            ...(event.correlationId === undefined ? {} : { correlationId: event.correlationId }),
            ...(event.parentId === undefined ? {} : { parentId: event.parentId })
          });
        }
      });
      const offDrop = ctx.eventBus.on("outpost.drop.created", () => {
        state.drops += 1;
      });
      const offObjective = ctx.eventBus.on("outpost.objective.progressed", () => {
        state.objectiveProgress += 1;
      });

      ctx.systems.register({
        id: "outpost.authority.combat.resolve",
        update() {
          flushDeaths(state);
        }
      });

      return () => {
        offObjective();
        offDrop();
        offKilled();
      };
    }
  });
}

function executeCombatCommand(
  state: CombatState,
  command: OutpostAuthorityCombatCommand
): OutpostAuthorityCombatCommandResult {
  const player = state.options.players().get(command.playerId);
  if (
    !player ||
    !state.options.gas.hasActor(player.actorId) ||
    actorHealth(state, player.actorId) <= 0
  ) {
    if (command.ability === "dash" && player !== undefined) {
      state.options.resolvePlayerDash(player, command, false);
    }
    rejectCommand(state, command, "player-unavailable");
    return { status: "rejected", reason: "player-unavailable" };
  }

  switch (command.ability) {
    case "rifle":
      return executeRifle(state, player, command);
    case "dash":
      return executeDash(state, player, command);
    case "shock-field":
      return executeShockField(state, player, command);
    case "deploy-turret":
      return executeTurretPlacement(state, player, command);
  }
}

function executeRifle(
  state: CombatState,
  player: OutpostAuthorityCombatPlayer,
  command: OutpostAuthorityCombatCommand
): OutpostAuthorityCombatCommandResult {
  const definition = state.options.dataRegistry.getValue<OutpostPlayerDefinition>(
    OUTPOST_PLAYER_TYPE,
    OUTPOST_COMBAT_PLAYER_DEFINITION_ID
  );
  const weapon = state.options.dataRegistry.getValue<OutpostWeaponDefinition>(
    OUTPOST_WEAPON_TYPE,
    definition.weapon.id
  );
  const aim = { x: command.aimX, y: command.aimY };
  state.rememberCombatAim(player.actorId, aim);
  const activation = state.options.gas.activateAbility({
    actorId: player.actorId,
    abilityId: weapon.ability.id,
    ...operationContext(command)
  });
  if (activation.status !== "activated") {
    rejectCommand(state, command, activation.reason);
    return { status: "rejected", reason: activation.reason };
  }
  state.acceptedCommands += 1;
  return { status: "accepted" };
}

function executeDash(
  state: CombatState,
  player: OutpostAuthorityCombatPlayer,
  command: OutpostAuthorityCombatCommand
): OutpostAuthorityCombatCommandResult {
  const activation = state.options.gas.activateAbility({
    actorId: player.actorId,
    abilityId: "ability.outpost.dash",
    ...operationContext(command)
  });
  if (activation.status !== "activated") {
    const reason =
      activation.reason === "ability costs cannot be paid"
        ? "costs-unavailable"
        : activation.reason;
    state.options.resolvePlayerDash(player, command, false);
    rejectCommand(state, command, reason);
    return { status: "rejected", reason };
  }
  state.options.resolvePlayerDash(player, command, true);
  state.options.gas.addTag(player.actorId, "state.dashing", command.id, operationContext(command));
  state.acceptedCommands += 1;
  return { status: "accepted" };
}

function executeShockField(
  state: CombatState,
  player: OutpostAuthorityCombatPlayer,
  command: OutpostAuthorityCombatCommand
): OutpostAuthorityCombatCommandResult {
  const activation = state.options.gas.activateAbility({
    actorId: player.actorId,
    abilityId: "ability.outpost.shock_field",
    ...operationContext(command)
  });
  if (activation.status !== "activated") {
    rejectCommand(state, command, activation.reason);
    return { status: "rejected", reason: activation.reason };
  }
  state.acceptedCommands += 1;
  return { status: "accepted" };
}

function executeTurretPlacement(
  state: CombatState,
  player: OutpostAuthorityCombatPlayer,
  command: OutpostAuthorityCombatCommand
): OutpostAuthorityCombatCommandResult {
  const definition = state.options.dataRegistry.getValue<OutpostBuildableDefinition>(
    OUTPOST_BUILDABLE_TYPE,
    TURRET_DEFINITION_ID
  );
  const origin = requireTransform(state.options.world, player.entityId).position;
  const distance = Math.hypot(command.aimX - origin.x, command.aimY - origin.y);
  if (distance > definition.placementRange || !insideArena(command.aimX, command.aimY, 20)) {
    rejectCommand(state, command, "placement-out-of-range");
    return { status: "rejected", reason: "placement-out-of-range" };
  }
  const bodyData = state.options.dataRegistry.getValue<PhysicsBodyData>(
    "physics.body",
    definition.physicsBody.id
  );
  const colliderData = firstCollider(state.options.dataRegistry, bodyData);
  if (
    state.options.physics.checkOverlap(
      colliderData.shape,
      { x: command.aimX, y: command.aimY },
      {
        triggerInteraction: "exclude"
      }
    )
  ) {
    rejectCommand(state, command, "placement-obstructed");
    return { status: "rejected", reason: "placement-obstructed" };
  }
  const activation = state.options.gas.activateAbility({
    actorId: player.actorId,
    abilityId: definition.deployAbility.id,
    ...operationContext(command)
  });
  if (activation.status !== "activated") {
    rejectCommand(state, command, activation.reason);
    return { status: "rejected", reason: activation.reason };
  }
  materializeActorObject(state, {
    id: `turret.${state.nextTurretId}`,
    kind: "buildable",
    definitionId: definition.id,
    renderKey: definition.renderObject.id,
    actorDefinitionId: definition.actor.id,
    bodyData,
    colliderData,
    position: { x: command.aimX, y: command.aimY },
    sourceActorId: player.actorId,
    context: operationContext(command)
  });
  state.nextTurretId += 1;
  state.acceptedCommands += 1;
  return { status: "accepted" };
}

function ensureInitialEnemies(state: CombatState): void {
  if (state.initialWaveSpawned || state.options.players().size === 0) {
    return;
  }
  state.initialWaveSpawned = true;
  for (const spawn of state.options.initialEnemies ?? DEFAULT_ENEMY_SPAWNS) {
    const definition = state.options.dataRegistry.getValue<OutpostEnemyDefinition>(
      OUTPOST_ENEMY_TYPE,
      spawn.definitionId
    );
    const bodyData = state.options.dataRegistry.getValue<PhysicsBodyData>(
      "physics.body",
      definition.physicsBody.id
    );
    materializeActorObject(state, {
      id: spawn.id,
      kind: "enemy",
      definitionId: definition.id,
      renderKey: definition.renderObject.id,
      actorDefinitionId: definition.actor.id,
      bodyData,
      colliderData: firstCollider(state.options.dataRegistry, bodyData),
      position: { x: spawn.x, y: spawn.y },
      activationDelayMs: normalizeEnemyActivationDelay(spawn)
    });
  }
}

function updateEnemyActivationDelays(state: CombatState, deltaMs: number): void {
  for (const enemy of combatObjects(state, "enemy")) {
    if ((enemy.activationDelayMs ?? 0) <= 0) {
      continue;
    }
    enemy.activationDelayMs = Math.max(0, (enemy.activationDelayMs ?? 0) - Math.max(0, deltaMs));
    state.options.world.set(enemy.entityId, PhysicsVelocityComponent, {
      linear: { x: 0, y: 0 }
    });
  }
}

function captureAiEnemies(state: CombatState): OutpostAuthorityAiEnemy[] {
  return combatObjects(state, "enemy")
    .flatMap((enemy) =>
      enemy.actorId === undefined || !state.options.gas.hasActor(enemy.actorId)
        ? []
        : [
            {
              id: enemy.id,
              agentId: `outpost.ai.${enemy.id}`,
              entityId: enemy.entityId,
              actorId: enemy.actorId,
              definitionId: enemy.definitionId,
              active: (enemy.activationDelayMs ?? 0) <= 0 && actorHealth(state, enemy.actorId) > 0
            }
          ]
    )
    .sort((left, right) => left.id.localeCompare(right.id));
}

function activateEnemyAction(
  state: CombatState,
  enemyId: string,
  targetActorId: string
): OutpostAuthorityAiActionResult {
  const enemy = state.objectsById.get(enemyId);
  if (
    enemy?.kind !== "enemy" ||
    enemy.actorId === undefined ||
    (enemy.activationDelayMs ?? 0) > 0 ||
    !state.options.gas.hasActor(enemy.actorId) ||
    actorHealth(state, enemy.actorId) <= 0
  ) {
    return { status: "rejected", reason: "owner-unavailable" };
  }
  const target = [...state.options.players().values()].find(
    (player) => player.actorId === targetActorId
  );
  if (
    target === undefined ||
    !state.options.gas.hasActor(target.actorId) ||
    actorHealth(state, target.actorId) <= 0
  ) {
    return { status: "rejected", reason: "target-unavailable" };
  }
  const definition = state.options.dataRegistry.getValue<OutpostEnemyDefinition>(
    OUTPOST_ENEMY_TYPE,
    enemy.definitionId
  );
  const origin = requireTransform(state.options.world, enemy.entityId).position;
  const targetPosition = requireTransform(state.options.world, target.entityId).position;
  const distance = Math.hypot(targetPosition.x - origin.x, targetPosition.y - origin.y);
  if (distance > definition.attackRange) {
    return { status: "rejected", reason: "target-out-of-range" };
  }
  if (
    state.options.physics.overlapShape({ type: "circle", radius: definition.attackRange }, origin, {
      includeBodies: [target.bodyId],
      triggerInteraction: "include",
      mode: "any"
    }).length === 0
  ) {
    return { status: "rejected", reason: "target-not-overlapping" };
  }
  state.options.world.set(enemy.entityId, OutpostGameplayObject, {
    facing: Math.atan2(targetPosition.y - origin.y, targetPosition.x - origin.x)
  });
  const correlationId = `outpost.ai.${enemy.id}`;
  const activation = state.options.gas.activateAbility({
    actorId: enemy.actorId,
    abilityId: definition.attackAbility.id,
    targetActorId: target.actorId,
    correlationId,
    parentId: enemy.id
  });
  if (activation.status !== "activated") {
    return { status: "rejected", reason: activation.reason };
  }
  state.enemyAttacks += 1;
  return { status: "accepted", executionId: activation.executionId };
}

function normalizeEnemyActivationDelay(spawn: OutpostAuthorityEnemySpawn): number {
  const delayMs = spawn.activationDelayMs ?? 0;
  if (!Number.isFinite(delayMs) || delayMs < 0) {
    throw new Error(`Outpost enemy activation delay must be non-negative: ${spawn.id}`);
  }
  return delayMs;
}

function updateTurrets(state: CombatState): void {
  const enemies = combatObjects(state, "enemy").filter(
    (enemy) =>
      enemy.actorId &&
      state.options.gas.hasActor(enemy.actorId) &&
      actorHealth(state, enemy.actorId) > 0
  );
  for (const turret of combatObjects(state, "buildable")) {
    if (!turret.actorId || !state.options.gas.hasActor(turret.actorId) || enemies.length === 0) {
      continue;
    }
    const transform = requireTransform(state.options.world, turret.entityId);
    const target = nearestObject(state.options.world, transform.position, enemies);
    const targetTransform = requireTransform(state.options.world, target.entityId);
    const distance = Math.hypot(
      targetTransform.position.x - transform.position.x,
      targetTransform.position.y - transform.position.y
    );
    if (distance > TURRET_RANGE) {
      continue;
    }
    state.options.world.set(turret.entityId, OutpostGameplayObject, {
      facing: Math.atan2(
        targetTransform.position.y - transform.position.y,
        targetTransform.position.x - transform.position.x
      )
    });
    const correlationId = `outpost.turret.${turret.id}`;
    const activation = state.options.gas.activateAbility({
      actorId: turret.actorId,
      abilityId: "ability.outpost.rifle_fire",
      targetActorId: target.actorId,
      correlationId,
      parentId: turret.id
    });
    if (activation.status !== "activated") {
      continue;
    }
    state.rememberCombatAim(turret.actorId, targetTransform.position);
  }
}

function resolveCombatCoreHit(
  state: CombatState,
  hit: CombatHitResult,
  context: GasOperationContext
): void {
  if (hit.status !== "applied" || !state.options.gas.hasActor(hit.targetActorId)) {
    return;
  }
  let damage = 0;
  if (hit.projectileId !== undefined) {
    damage = state.options.dataRegistry.getValue<OutpostWeaponDefinition>(
      OUTPOST_WEAPON_TYPE,
      RIFLE_DEFINITION_ID
    ).damage;
    state.projectileHits += 1;
  } else {
    const source = state.objectsByActorId.get(hit.sourceActorId);
    if (source?.kind === "enemy") {
      damage = state.options.dataRegistry.getValue<OutpostEnemyDefinition>(
        OUTPOST_ENEMY_TYPE,
        source.definitionId
      ).attackDamage;
    }
  }
  if (damage <= 0) {
    return;
  }
  const damageResult = applyDamage(state, hit.targetActorId, damage, hit.sourceActorId, {
    correlationId: context.correlationId ?? hit.ticketId,
    parentId: context.parentId ?? hit.ticketId
  });
  const position = hit.point ?? actorPosition(state, hit.targetActorId);
  const sourcePosition = actorPosition(state, hit.sourceActorId);
  const target = state.objectsByActorId.get(hit.targetActorId);
  const targetPosition =
    target === undefined
      ? position
      : requireTransform(state.options.world, target.entityId).position;
  const direction = normalizedCueDirection(sourcePosition, targetPosition);
  const cueContext = {
    at: state.elapsedMs,
    sourceObjectId: combatObjectIdForActor(state, hit.sourceActorId),
    targetObjectId: combatObjectIdForActor(state, hit.targetActorId),
    ...(hit.projectileId === undefined ? {} : { projectileId: hit.projectileId }),
    ...(position === undefined ? {} : { position }),
    ...(hit.normal === undefined ? {} : { normal: hit.normal }),
    ...(direction === undefined ? {} : { direction }),
    correlationId: context.correlationId ?? hit.ticketId,
    parentId: context.parentId ?? hit.ticketId
  };
  if (damageResult.shieldDamage > 0) {
    state.cueStream.append({
      kind: "shield-hit",
      ...cueContext,
      amount: damageResult.shieldDamage
    });
  }
  if (damageResult.healthDamage > 0) {
    state.cueStream.append({
      kind: "health-hit",
      ...cueContext,
      amount: damageResult.healthDamage
    });
  }
  if (damageResult.killed) {
    state.cueStream.append({ kind: "kill-confirmed", ...cueContext });
  }
  if (target !== undefined && targetPosition !== undefined) {
    if (sourcePosition !== undefined) {
      applyKnockback(
        state,
        target,
        {
          x: targetPosition.x - sourcePosition.x,
          y: targetPosition.y - sourcePosition.y
        },
        damage * 12
      );
    }
  }
}

function normalizedCueDirection(
  source: { x: number; y: number } | undefined,
  target: { x: number; y: number } | undefined
): { x: number; y: number } | undefined {
  if (source === undefined || target === undefined) {
    return undefined;
  }
  const x = target.x - source.x;
  const y = target.y - source.y;
  const length = Math.hypot(x, y);
  return length <= Number.EPSILON ? undefined : { x: x / length, y: y / length };
}

function actorPosition(state: CombatState, actorId: string): PhysicsVector | undefined {
  if (!state.options.gas.hasActor(actorId)) {
    return undefined;
  }
  const entityId = state.options.gas.getActor(actorId).actor.entityId;
  return entityId === undefined
    ? undefined
    : state.options.world.get(entityId, PhysicsTransformComponent)?.position;
}

function flushDeaths(state: CombatState): void {
  for (const death of state.pendingDeaths.values()) {
    const object = state.objectsByActorId.get(death.actorId);
    if (object) {
      state.kills += object.kind === "enemy" ? 1 : 0;
      state.options.eventBus.emit(
        "outpost.entity.despawned",
        { actorId: death.actorId, entityId: object.entityId, kind: object.kind },
        "outpost.authority.combat",
        {
          correlationId: death.correlationId,
          parentId: death.parentId
        }
      );
      removeCombatObject(state, object);
      continue;
    }
    const player = [...state.options.players().values()].find(
      (candidate) => candidate.actorId === death.actorId
    );
    if (player) {
      state.options.world.set(player.entityId, PhysicsVelocityComponent, {
        linear: { x: 0, y: 0 }
      });
      state.options.gas.addTag(player.actorId, "state.dead", "outpost.actor-killed", {
        correlationId: death.correlationId,
        parentId: death.parentId
      });
    }
  }
  state.pendingDeaths.clear();
}

function applyDamage(
  state: CombatState,
  targetActorId: string,
  damage: number,
  sourceActorId: string,
  context: GasOperationContext
): { shieldDamage: number; healthDamage: number; killed: boolean } {
  if (!state.options.gas.hasActor(targetActorId)) {
    return { shieldDamage: 0, healthDamage: 0, killed: false };
  }
  const actor = state.options.gas.getActor(targetActorId);
  const health = actor.attributes.current.health ?? 0;
  if (health <= 0) {
    return { shieldDamage: 0, healthDamage: 0, killed: false };
  }
  const shield = actor.attributes.current.shield ?? 0;
  const shieldDamage = Math.min(shield, damage);
  if (shieldDamage > 0) {
    state.options.gas.modifyAttribute(
      targetActorId,
      { attribute: "shield", operation: "add", value: -shieldDamage },
      sourceActorId,
      context
    );
  }
  const healthDamage = Math.min(health, damage - shieldDamage);
  if (healthDamage > 0) {
    state.options.gas.modifyAttribute(
      targetActorId,
      { attribute: "health", operation: "add", value: -healthDamage },
      sourceActorId,
      context
    );
  }
  return {
    shieldDamage,
    healthDamage,
    killed: healthDamage >= health
  };
}

function applyKnockback(
  state: CombatState,
  target: CombatObject,
  direction: PhysicsVector,
  magnitude: number
): void {
  const normalized = normalizeVector(direction);
  state.knockbacksByObjectId.set(target.id, {
    velocity: { x: normalized.x * magnitude, y: normalized.y * magnitude },
    remainingMs: KNOCKBACK_DURATION_MS
  });
}

function updateKnockbacks(state: CombatState, deltaMs: number): void {
  for (const [objectId, knockback] of state.knockbacksByObjectId) {
    const object = state.objectsById.get(objectId);
    if (!object || !state.options.world.has(object.entityId)) {
      state.knockbacksByObjectId.delete(objectId);
      continue;
    }
    knockback.remainingMs -= Math.max(0, deltaMs);
    if (knockback.remainingMs <= 0) {
      state.knockbacksByObjectId.delete(objectId);
      continue;
    }
    state.options.world.set(object.entityId, PhysicsVelocityComponent, {
      linear: knockback.velocity
    });
  }
}
