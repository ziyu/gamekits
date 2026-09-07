import { defineGameModule } from "@gamekits/core";
import { createAiHandle, type AiHandle } from "@gamekits/ai-core";
import {
  createCombatHandle,
  createCombatTraceStore,
  type CombatHandle,
  type CombatTraceStore
} from "@gamekits/combat";
import type { DataRegistry } from "@gamekits/data";
import { createGame, type GameInstallContext, type GameRuntime } from "@gamekits/game-runtime";
import type { EventBus } from "@gamekits/event-bus";
import {
  createNavigationHandle,
  createNavigationModule,
  type NavigationAgentProfileDefinition,
  type NavigationHandle
} from "@gamekits/navigation-core";
import { createGraphNavigationBackendFactory } from "@gamekits/navigation-graph";
import {
  createGasHandle,
  createGasModule,
  createGasTraceStore,
  type GasHandle,
  type GasTraceStore
} from "@gamekits/gas";
import {
  createPhysicsHandle,
  createPhysicsLayoutModule,
  createPhysicsModule,
  createPhysicsTraceStore,
  PhysicsBodyComponent,
  PhysicsColliderComponent,
  PhysicsTransformComponent,
  PhysicsVelocityComponent,
  type PhysicsBackendAdapter,
  type PhysicsBodyData,
  type PhysicsColliderData,
  type PhysicsHandle,
  type PhysicsTraceStore
} from "@gamekits/physics-core";
import type { EntityId, GameWorld } from "@gamekits/world";
import {
  createTcaHandle,
  createTcaModule,
  createTcaTraceStore,
  type TcaHandle,
  type TcaTraceStore
} from "@gamekits/tca";

import {
  createOutpostArenaPhysicsSceneConfig,
  OUTPOST_PLAYER_STAMINA_MAX,
  OUTPOST_ARENA_PHYSICS_LAYOUT_ID,
  OUTPOST_NAVIGATION_BACKEND_ID,
  OUTPOST_NAVIGATION_LAYOUT_ID
} from "../content";
import {
  OUTPOST_PLAYER_TYPE,
  OUTPOST_MOVEMENT_PROFILE_TYPE,
  OUTPOST_WEAPON_TYPE,
  type OutpostMovementProfileDefinition,
  type OutpostPlayerDefinition,
  type OutpostWeaponDefinition
} from "../domain";
import {
  createOutpostAuthorityAi,
  type OutpostAuthorityAiIntegration,
  type OutpostAuthorityAiSnapshot
} from "./authority-ai";
import {
  createOutpostAuthorityNavigationIntegration,
  type OutpostAuthorityNavigationBlockerSnapshot
} from "./authority-navigation";
import {
  createOutpostIdentityRegistry,
  type OutpostIdentityRegistry
} from "../domain/identity-registry";
import { OutpostGameplayObject } from "./components";
import {
  createOutpostAuthorityCombat,
  type OutpostAuthorityCombatCommand,
  type OutpostAuthorityCombatPlayer,
  type OutpostAuthorityCombatSnapshot,
  type OutpostAuthorityEnemySpawn
} from "./authority-combat";
import {
  captureOutpostPlayerWeaponSnapshot,
  createOutpostAuthorityPlayerWeapon,
  type OutpostAuthorityPlayerWeapon
} from "./player/weapon-runtime";
import type { OutpostAuthorityPlayerActionCommand } from "./player/action-types";
import { createOutpostAuthorityPlayerActionModule } from "./player/action-runtime";
import {
  acknowledgeOutpostDashSequence,
  advanceOutpostMovement,
  createOutpostMovementState,
  startOutpostDash,
  type OutpostMovementState
} from "./player/movement-policy";

const PLAYER_DEFINITION_ID = "player.outpost.ranger";
const STAMINA_RECOVERY_STEP_MS = 100;

export type OutpostAuthorityPlayerInput = {
  sequence: number;
  moveX: number;
  moveY: number;
  aimX: number;
  aimY: number;
  fireHeld: boolean;
  fireSequence: number;
  dashSequence: number;
};

export type OutpostAuthorityPlayerState = {
  playerId: string;
  slot: number;
  spawn: { x: number; y: number };
  input: OutpostAuthorityPlayerInput;
};

export type OutpostAuthorityPlayerSnapshot = {
  playerId: string;
  slot: number;
  entityId: EntityId;
  networkEntityId: string;
  generation: number;
  archetypeId: string;
  x: number;
  y: number;
  velocityX: number;
  velocityY: number;
  facing: number;
  dashSequence: number;
  dashRemainingMs: number;
  dashDirectionX: number;
  dashDirectionY: number;
};

export type OutpostAuthorityGameplaySnapshot = {
  running: boolean;
  tick: number;
  elapsedMs: number;
  entityCount: number;
  players: OutpostAuthorityPlayerSnapshot[];
  physics: {
    bound: boolean;
    recentTraceCount: number;
  };
  combat: OutpostAuthorityCombatSnapshot;
  ai: OutpostAuthorityAiSnapshot;
  navigationBlockers: OutpostAuthorityNavigationBlockerSnapshot[];
};

export type OutpostAuthorityGameplayRuntime = {
  runtime: GameRuntime;
  identity: OutpostIdentityRegistry;
  physics: PhysicsHandle;
  physicsTrace: PhysicsTraceStore;
  gas: GasHandle;
  gasTrace: GasTraceStore;
  combatCore: CombatHandle;
  combatTrace: CombatTraceStore;
  navigation: NavigationHandle;
  ai: AiHandle;
  tca: TcaHandle;
  tcaTrace: TcaTraceStore;
  setNavigationArenaObjectBlocked(objectId: string, blocked: boolean): boolean;
  snapshot(): OutpostAuthorityGameplaySnapshot;
};

export type CreateOutpostAuthorityGameplayRuntimeOptions = {
  dataRegistry: DataRegistry;
  world: GameWorld;
  physicsBackend: PhysicsBackendAdapter;
  eventBus: EventBus;
  players(): readonly OutpostAuthorityPlayerState[];
  playerActions?(): readonly OutpostAuthorityPlayerActionCommand[];
  combatCommands?(): readonly OutpostAuthorityCombatCommand[];
  initialEnemies?: readonly OutpostAuthorityEnemySpawn[] | undefined;
  projectileGeneration?: string | undefined;
  seed?: string | undefined;
};

type MaterializedPlayer = OutpostAuthorityCombatPlayer & {
  playerId: string;
  slot: number;
  networkEntityId: string;
  generation: number;
  input: OutpostAuthorityPlayerInput;
  weapon: OutpostAuthorityPlayerWeapon;
  movement: OutpostMovementState;
  staminaRecoveryAccumulatorMs: number;
  dashSource?: string | undefined;
};

type AuthorityGameplayState = {
  dataRegistry: DataRegistry;
  world: GameWorld;
  identity: OutpostIdentityRegistry;
  players: Map<string, MaterializedPlayer>;
  generationsByNetworkEntityId: Map<string, number>;
  playerSource(): readonly OutpostAuthorityPlayerState[];
  playerActionSource(): readonly OutpostAuthorityPlayerActionCommand[];
  gas: GasHandle;
};

export function createOutpostAuthorityGameplayRuntime(
  options: CreateOutpostAuthorityGameplayRuntimeOptions
): OutpostAuthorityGameplayRuntime {
  const physics = createPhysicsHandle({ id: "outpost.authority.physics" });
  const physicsTrace = createPhysicsTraceStore({ limit: 180 });
  const gas = createGasHandle({ id: "outpost.authority.gas" });
  const gasTrace = createGasTraceStore({ limit: 240 });
  const combatCore = createCombatHandle({ id: "outpost.authority.combat-core" });
  const combatTrace = createCombatTraceStore({ limit: 320 });
  const navigation = createNavigationHandle({ id: "outpost.authority.navigation" });
  const ai = createAiHandle({ id: "outpost.authority.ai" });
  const tca = createTcaHandle({ id: "outpost.authority.tca" });
  const tcaTrace = createTcaTraceStore({ limit: 180 });
  const playerDefinition = options.dataRegistry.getValue<OutpostPlayerDefinition>(
    OUTPOST_PLAYER_TYPE,
    PLAYER_DEFINITION_ID
  );
  const movementProfile = options.dataRegistry.getValue<OutpostMovementProfileDefinition>(
    OUTPOST_MOVEMENT_PROFILE_TYPE,
    playerDefinition.movementProfile.id
  );
  const state: AuthorityGameplayState = {
    dataRegistry: options.dataRegistry,
    world: options.world,
    identity: createOutpostIdentityRegistry(),
    players: new Map(),
    generationsByNetworkEntityId: new Map(),
    playerSource: options.players,
    playerActionSource: options.playerActions ?? (() => []),
    gas
  };
  let authorityAi: OutpostAuthorityAiIntegration | undefined;
  const combat = createOutpostAuthorityCombat({
    dataRegistry: options.dataRegistry,
    world: options.world,
    identity: state.identity,
    physics,
    physicsTrace,
    gas,
    combat: combatCore,
    combatTrace,
    eventBus: options.eventBus,
    ...(options.projectileGeneration === undefined
      ? {}
      : { projectileGeneration: options.projectileGeneration }),
    players: () => state.players,
    commands: options.combatCommands ?? (() => []),
    resolvePlayerDash(player, command, accepted) {
      const materialized = state.players.get(player.playerId);
      const transform = state.world.get(player.entityId, PhysicsTransformComponent);
      if (materialized === undefined || transform === undefined) {
        return;
      }
      const dashSequence = command.dashSequence ?? (materialized.movement.dashSequence + 1) >>> 0;
      acknowledgeOutpostDashSequence(materialized.movement, dashSequence);
      if (!accepted) {
        return;
      }
      startOutpostDash(
        materialized.movement,
        {
          moveX: materialized.input.moveX,
          moveY: materialized.input.moveY,
          aimX: command.aimX,
          aimY: command.aimY
        },
        movementProfile,
        transform.position,
        dashSequence
      );
      materialized.movement.dashRemainingMs = Math.max(
        0,
        materialized.movement.dashRemainingMs - Math.max(0, command.simulationStepMs ?? 0)
      );
      materialized.dashSource = command.id;
      state.world.set(player.entityId, PhysicsVelocityComponent, {
        linear: {
          x: materialized.movement.velocityX,
          y: materialized.movement.velocityY
        }
      });
    },
    playerWeapon(playerId) {
      const weapon = state.players.get(playerId)?.weapon;
      return weapon === undefined ? undefined : captureOutpostPlayerWeaponSnapshot(weapon);
    },
    aiState(actorId) {
      return authorityAi?.actorState(actorId);
    },
    ...(options.initialEnemies === undefined ? {} : { initialEnemies: options.initialEnemies })
  });
  authorityAi = createOutpostAuthorityAi({
    dataRegistry: options.dataRegistry,
    world: options.world,
    physics,
    navigation,
    ai,
    gas,
    enemies: combat.aiEnemies,
    players: () => state.players,
    activateAction: combat.activateAiAction
  });
  const authorityNavigation = createOutpostAuthorityNavigationIntegration(navigation);
  const runtime = createGame({
    seed: options.seed ?? "outpost-siege.authority.v1",
    world: options.world,
    eventBus: options.eventBus,
    modules: [
      createPhysicsLayoutModule({
        id: "outpost.authority.arena-layout",
        dataRegistry: options.dataRegistry,
        layoutId: OUTPOST_ARENA_PHYSICS_LAYOUT_ID
      }),
      createAuthorityPlayerModule(state, movementProfile),
      combat.enemyLifecycleModule,
      createNavigationModule({
        id: "outpost.authority.navigation",
        dataRegistry: options.dataRegistry,
        layout: { type: "navigation.layout", id: OUTPOST_NAVIGATION_LAYOUT_ID },
        backendFactories: [
          createGraphNavigationBackendFactory({
            id: OUTPOST_NAVIGATION_BACKEND_ID,
            maxRouteFields: 16
          })
        ],
        profiles: [
          options.dataRegistry.getValue<NavigationAgentProfileDefinition>(
            "navigation.agent-profile",
            "navigation.outpost.raider"
          )
        ],
        handle: navigation,
        maxRequestsPerTick: 24,
        maxBackendPollsPerTick: 48,
        maxPendingRequests: 256,
        maxPendingPerRequester: 2,
        maxRetainedResults: 256,
        maxRetainedRoutes: 256,
        maxCacheEntries: 64,
        traceLimit: 320
      }),
      authorityNavigation.module,
      authorityAi.bindingModule,
      authorityAi.module,
      authorityAi.intentModule,
      combat.prePhysicsModule,
      createGasModule({
        id: "outpost.authority.gas",
        dataRegistry: options.dataRegistry,
        traceStore: gasTrace,
        handle: gas
      }),
      createOutpostAuthorityPlayerActionModule({
        gas: state.gas,
        players: () => state.players.values(),
        actions: state.playerActionSource,
        combat
      }),
      createPhysicsModule({
        id: "outpost.authority.physics",
        backend: options.physicsBackend,
        fixedDeltaMs: 1000 / 60,
        maxSubSteps: 4,
        scene: authorityPhysicsScene(options.dataRegistry),
        traceStore: physicsTrace,
        handle: physics
      }),
      combat.coreModule,
      combat.postPhysicsModule,
      createTcaModule({
        id: "outpost.authority.tca",
        dataRegistry: options.dataRegistry,
        definitions: combat.tcaDefinitions,
        traceStore: tcaTrace,
        handle: tca
      })
    ]
  });

  return {
    runtime,
    identity: state.identity,
    physics,
    physicsTrace,
    gas,
    gasTrace,
    combatCore,
    combatTrace,
    navigation,
    ai,
    tca,
    tcaTrace,
    setNavigationArenaObjectBlocked(objectId, blocked) {
      return authorityNavigation.setArenaObjectBlocked(objectId, blocked);
    },
    snapshot() {
      const clock = runtime.clock.snapshot();
      return {
        running: runtime.isRunning(),
        tick: clock.ticks,
        elapsedMs: clock.elapsed,
        entityCount: state.world.count(),
        players: Array.from(state.players.values(), (player) =>
          capturePlayerSnapshot(state.world, player)
        ).sort((left, right) => left.slot - right.slot),
        physics: {
          bound: physics.isBound(),
          recentTraceCount: physicsTrace.list().length
        },
        combat: combat.snapshot(),
        ai: authorityAi.snapshot(),
        navigationBlockers: authorityNavigation.blockers()
      };
    }
  };
}

function createAuthorityPlayerModule(
  state: AuthorityGameplayState,
  movementProfile: OutpostMovementProfileDefinition
) {
  const definition = state.dataRegistry.getValue<OutpostPlayerDefinition>(
    OUTPOST_PLAYER_TYPE,
    PLAYER_DEFINITION_ID
  );
  const bodyData = state.dataRegistry.getValue<PhysicsBodyData>(
    "physics.body",
    definition.physicsBody.id
  );
  const colliderRef = bodyData.colliders?.[0];
  if (!colliderRef) {
    throw new Error(`Outpost player body requires a collider: ${bodyData.id}`);
  }
  const colliderData = state.dataRegistry.getValue<PhysicsColliderData>(
    colliderRef.type,
    colliderRef.id
  );
  const weaponDefinition = state.dataRegistry.getValue<OutpostWeaponDefinition>(
    OUTPOST_WEAPON_TYPE,
    definition.weapon.id
  );

  return defineGameModule<GameInstallContext>({
    id: "outpost.authority.players",
    install(ctx) {
      ctx.systems.register({
        id: "outpost.authority.players.sync",
        update({ delta }) {
          const desiredPlayers = normalizeDesiredPlayers(state.playerSource());
          removeMissingPlayers(state, desiredPlayers);
          for (const desired of desiredPlayers.values()) {
            const player =
              state.players.get(desired.playerId) ??
              materializePlayer(state, desired, bodyData, colliderData, weaponDefinition);
            applyPlayerInput(state, player, desired, movementProfile, delta);
          }
        }
      });

      return () => {
        for (const player of state.players.values()) {
          state.identity.remove(player.playerId);
          if (state.gas.isBound() && state.gas.hasActor(player.actorId)) {
            state.gas.removeActor(player.actorId);
          }
          if (ctx.world.has(player.entityId)) {
            ctx.world.despawn(player.entityId);
          }
        }
        state.players.clear();
        state.generationsByNetworkEntityId.clear();
        state.identity.clear();
      };
    }
  });
}

function normalizeDesiredPlayers(
  players: readonly OutpostAuthorityPlayerState[]
): Map<string, OutpostAuthorityPlayerState> {
  const desired = new Map<string, OutpostAuthorityPlayerState>();
  for (const player of players) {
    if (!desired.has(player.playerId)) {
      desired.set(player.playerId, player);
    }
  }
  return desired;
}

function removeMissingPlayers(
  state: AuthorityGameplayState,
  desired: ReadonlyMap<string, OutpostAuthorityPlayerState>
): void {
  for (const [playerId, player] of state.players) {
    if (desired.has(playerId)) {
      continue;
    }
    state.identity.remove(playerId);
    if (state.gas.isBound() && state.gas.hasActor(player.actorId)) {
      state.gas.removeActor(player.actorId);
    }
    if (state.world.has(player.entityId)) {
      state.world.despawn(player.entityId);
    }
    state.players.delete(playerId);
  }
}

function materializePlayer(
  state: AuthorityGameplayState,
  player: OutpostAuthorityPlayerState,
  bodyData: PhysicsBodyData,
  colliderData: PhysicsColliderData,
  weaponDefinition: OutpostWeaponDefinition
): MaterializedPlayer {
  const entityId = state.world.spawn();
  const bodyId = `${player.playerId}.body`;
  const colliderId = `${player.playerId}.collider`;
  const actorId = player.playerId;
  const networkEntityId = player.playerId;
  const generation = (state.generationsByNetworkEntityId.get(networkEntityId) ?? -1) + 1;
  const materialized = {
    playerId: player.playerId,
    slot: player.slot,
    entityId,
    networkEntityId,
    generation,
    actorId,
    bodyId,
    colliderId,
    input: { ...player.input },
    weapon: createOutpostAuthorityPlayerWeapon(weaponDefinition),
    movement: createOutpostMovementState(),
    staminaRecoveryAccumulatorMs: 0
  };

  try {
    state.world.add(entityId, OutpostGameplayObject, {
      id: player.playerId,
      kind: "player"
    });
    state.world.add(entityId, PhysicsTransformComponent, { position: player.spawn });
    state.world.add(entityId, PhysicsVelocityComponent, { linear: { x: 0, y: 0 } });
    state.world.add(entityId, PhysicsBodyComponent, {
      definition: toBodyDefinition(bodyData, bodyId),
      syncVelocityFromWorld: true
    });
    state.world.add(entityId, PhysicsColliderComponent, {
      definition: toColliderDefinition(colliderData, colliderId)
    });
    state.gas.createActor({
      actorId,
      definitionId: definitionActorId(state.dataRegistry),
      entityId
    });
    state.identity.register({
      gameplayObjectId: player.playerId,
      entityId,
      actorId,
      physicsBodyId: bodyId,
      physicsColliderIds: [colliderId],
      network: { entityId: networkEntityId, generation }
    });
    state.generationsByNetworkEntityId.set(networkEntityId, generation);
    state.players.set(player.playerId, materialized);
    return materialized;
  } catch (error) {
    state.identity.remove(player.playerId);
    if (state.gas.isBound() && state.gas.hasActor(actorId)) {
      state.gas.removeActor(actorId);
    }
    if (state.world.has(entityId)) {
      state.world.despawn(entityId);
    }
    throw error;
  }
}

function applyPlayerInput(
  state: AuthorityGameplayState,
  player: MaterializedPlayer,
  desired: OutpostAuthorityPlayerState,
  movementProfile: OutpostMovementProfileDefinition,
  deltaMs: number
): void {
  const world = state.world;
  player.input = { ...desired.input };
  if (
    !state.gas.hasActor(player.actorId) ||
    (state.gas.getActor(player.actorId).attributes.current.health ?? 0) <= 0
  ) {
    player.movement.dashRemainingMs = 0;
    player.staminaRecoveryAccumulatorMs = 0;
    world.set(player.entityId, PhysicsVelocityComponent, { linear: { x: 0, y: 0 } });
    return;
  }
  const transform = world.get(player.entityId, PhysicsTransformComponent);
  const velocity = world.get(player.entityId, PhysicsVelocityComponent);
  if (!transform || !velocity) {
    return;
  }
  player.movement.velocityX = velocity.linear.x;
  player.movement.velocityY = velocity.linear.y;
  const wasDashing = player.movement.dashRemainingMs > 0;
  advanceOutpostMovement(player.movement, desired.input, movementProfile, {
    deltaMs,
    position: transform.position,
    acceptDashInput: false
  });
  world.set(player.entityId, PhysicsVelocityComponent, {
    linear: {
      x: player.movement.velocityX,
      y: player.movement.velocityY
    }
  });
  world.set(player.entityId, OutpostGameplayObject, { facing: player.movement.facing });
  if (wasDashing && player.movement.dashRemainingMs === 0 && player.dashSource !== undefined) {
    if (state.gas.hasActor(player.actorId)) {
      state.gas.removeTag(player.actorId, "state.dashing", player.dashSource);
    }
    delete player.dashSource;
  }
  recoverPlayerStamina(state, player, movementProfile, deltaMs, wasDashing);
}

function recoverPlayerStamina(
  state: AuthorityGameplayState,
  player: MaterializedPlayer,
  movementProfile: OutpostMovementProfileDefinition,
  deltaMs: number,
  wasDashing: boolean
): void {
  if (wasDashing || player.movement.dashRemainingMs > 0) {
    player.staminaRecoveryAccumulatorMs = 0;
    return;
  }
  const stamina = state.gas.getActor(player.actorId).attributes.current.stamina ?? 0;
  if (stamina >= OUTPOST_PLAYER_STAMINA_MAX) {
    player.staminaRecoveryAccumulatorMs = 0;
    return;
  }
  player.staminaRecoveryAccumulatorMs += Math.max(0, deltaMs);
  const recoverySteps = Math.floor(player.staminaRecoveryAccumulatorMs / STAMINA_RECOVERY_STEP_MS);
  if (recoverySteps === 0) {
    return;
  }
  const recoveredDurationMs = recoverySteps * STAMINA_RECOVERY_STEP_MS;
  player.staminaRecoveryAccumulatorMs -= recoveredDurationMs;
  state.gas.modifyAttribute(
    player.actorId,
    {
      attribute: "stamina",
      operation: "add",
      value: (movementProfile.staminaRecoveryPerSecond * recoveredDurationMs) / 1000
    },
    "outpost.authority.stamina-recovery"
  );
}

function capturePlayerSnapshot(
  world: GameWorld,
  player: MaterializedPlayer
): OutpostAuthorityPlayerSnapshot {
  const transform = requireComponent(
    world.get(player.entityId, PhysicsTransformComponent),
    `${player.playerId} transform`
  );
  const velocity = requireComponent(
    world.get(player.entityId, PhysicsVelocityComponent),
    `${player.playerId} velocity`
  );
  const gameplay = requireComponent(
    world.get(player.entityId, OutpostGameplayObject),
    `${player.playerId} gameplay object`
  );
  return {
    playerId: player.playerId,
    slot: player.slot,
    entityId: player.entityId,
    networkEntityId: player.networkEntityId,
    generation: player.generation,
    archetypeId: PLAYER_DEFINITION_ID,
    x: transform.position.x,
    y: transform.position.y,
    velocityX: velocity.linear.x,
    velocityY: velocity.linear.y,
    facing: gameplay.facing,
    dashSequence: player.movement.dashSequence,
    dashRemainingMs: player.movement.dashRemainingMs,
    dashDirectionX: player.movement.dashDirectionX,
    dashDirectionY: player.movement.dashDirectionY
  };
}

function toBodyDefinition(data: PhysicsBodyData, id: string) {
  const { colliders: _colliders, tags: _tags, ...definition } = data;
  return { ...definition, id };
}

function toColliderDefinition(data: PhysicsColliderData, id: string) {
  const { tags: _tags, ...definition } = data;
  return { ...definition, id };
}

function authorityPhysicsScene(dataRegistry: DataRegistry) {
  return createOutpostArenaPhysicsSceneConfig(dataRegistry);
}

function definitionActorId(dataRegistry: DataRegistry): string {
  return dataRegistry.getValue<OutpostPlayerDefinition>(OUTPOST_PLAYER_TYPE, PLAYER_DEFINITION_ID)
    .actor.id;
}

function requireComponent<T>(value: T | undefined, label: string): T {
  if (value === undefined) {
    throw new Error(`Missing Outpost authority ${label}`);
  }
  return value;
}
