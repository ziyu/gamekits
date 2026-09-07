import type { CameraController, CameraState2D, PointLike } from "@gamekits/camera-core";
import {
  createAnimatorHandle,
  createAnimatorModule,
  type AnimatorHandle
} from "@gamekits/animator-core";
import type { AnimationPlaybackAdapter } from "@gamekits/animator-core/playback";
import type { GameAudio } from "@gamekits/audio-core";
import type { CombatKinematicProjectileRecord } from "@gamekits/combat";
import { defineGameModule } from "@gamekits/core";
import type { DataRegistry } from "@gamekits/data";
import { createEventBus, type EventBus } from "@gamekits/event-bus";
import { createGame, type GameInstallContext, type GameRuntime } from "@gamekits/game-runtime";
import { GAS_ABILITY_TYPE, type GasAbilityDefinition } from "@gamekits/gas";
import {
  createMultiplayerModule,
  defineMultiplayerReplicationEntityPresentation,
  defineMultiplayerReplicationSchema,
  definePredictionAngleStateField,
  definePredictionStatePresentation,
  definePredictionVector2StateField,
  type MultiplayerClientReplicationDiagnostics,
  type MultiplayerClientReplicationSnapshotSource,
  type MultiplayerClientReplicationView,
  type MultiplayerRuntime,
  type NetworkVector2,
  type PresentedSnapshotTracks
} from "@gamekits/multiplayer-core";
import {
  createPhysicsBodyPredictionTransition,
  createPhysicsLayoutDefinitions,
  PhysicsTransformComponent,
  PhysicsVelocityComponent,
  type PhysicsBackendAdapter,
  type PhysicsBodyData,
  type PhysicsColliderData
} from "@gamekits/physics-core";
import type { RendererAdapter } from "@gamekits/renderer-core";
import type { EntityId, GameWorld } from "@gamekits/world";

import {
  OUTPOST_PLAYER_TYPE,
  OUTPOST_MOVEMENT_PROFILE_TYPE,
  OUTPOST_WEAPON_TYPE,
  type OutpostMovementProfileDefinition,
  type OutpostPlayerDefinition,
  type OutpostReplicatedCombatState,
  type OutpostReplicatedActor,
  type OutpostReplicatedCombatCue,
  type OutpostReplicatedProjectile,
  type OutpostReplicatedWeaponFeedback,
  type OutpostWeaponDefinition
} from "../domain";
import { createOutpostArenaPhysicsSceneConfig, OUTPOST_ARENA_PHYSICS_LAYOUT_ID } from "../content";
import {
  createOutpostIdentityRegistry,
  type OutpostIdentityRegistry
} from "../domain/identity-registry";
import {
  createOutpostClientPlayerPresentation,
  createOutpostClientPlayerPresentationModule,
  createOutpostClientCombatPresentation,
  createOutpostClientCombatPresentationModule,
  createOutpostClientPresentationModule,
  type OutpostClientCombatPresentation,
  type OutpostClientPlayerPresentation,
  type OutpostRenderTargetWriter
} from "../presentation";
import { OutpostGameplayObject, OutpostPresentation } from "./components";
import {
  OUTPOST_ARENA,
  OUTPOST_COLYSEUS_SCHEMA_VERSION,
  OUTPOST_NETWORK_TIMING
} from "./constants";
import {
  clearOutpostTransientInput,
  createOutpostInputState,
  type OutpostInputState
} from "./input";
import { advanceOutpostMovement } from "./player/movement-policy";

const PLAYER_DEFINITION_ID = "player.outpost.ranger";
const MAX_PARTICIPANTS = 8;
const MAX_PLAYERS = 4;
const MAX_COMBAT_ACTORS = 1_024;
const MAX_PROJECTILES = 2_048;
const MAX_PROJECTILE_RECORDS = 128;
const MAX_COMBAT_CUES = 64;
const DASH_ABILITY_ID = "ability.outpost.dash";

export type OutpostClientMatchPhase = "lobby" | "countdown" | "running";

export type OutpostClientParticipantSnapshot = {
  peerId: string;
  playerId: string;
  status: "active" | "next-round" | "spectator";
  ready: boolean;
  slot?: number;
  displayName?: string;
};

export type OutpostClientPlayerSnapshot = {
  networkEntityId: string;
  generation: number;
  archetypeId: string;
  playerId: string;
  slot: number;
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

export type OutpostClientAuthoritySnapshot = {
  phase: OutpostClientMatchPhase;
  tick: number;
  elapsedMs: number;
  countdownMsRemaining: number;
  participants: OutpostClientParticipantSnapshot[];
  players: OutpostClientPlayerSnapshot[];
  combat: OutpostReplicatedCombatState;
  inputAcksByPeerId: Record<string, number>;
};

const outpostPlayerPresentation = defineMultiplayerReplicationEntityPresentation<
  OutpostClientAuthoritySnapshot,
  OutpostClientPlayerSnapshot
>({
  id: "outpost.players",
  select: (snapshot) => snapshot.players,
  identity: (player) => player.networkEntityId,
  generation: (player) => player.generation,
  fields: [
    {
      id: "position",
      kind: "vector2",
      snapDistance: 160,
      read: (player) => ({ x: player.x, y: player.y })
    },
    { id: "facing", kind: "angle-radians", read: (player) => player.facing }
  ]
});

const outpostActorPresentation = defineMultiplayerReplicationEntityPresentation<
  OutpostClientAuthoritySnapshot,
  OutpostReplicatedActor
>({
  id: "outpost.actors",
  select: nonPlayerActors,
  identity: (actor) => actor.networkEntityId,
  generation: (actor) => actor.generation,
  fields: [
    {
      id: "position",
      kind: "vector2",
      snapDistance: 160,
      read: (actor) => ({ x: actor.x, y: actor.y })
    },
    { id: "facing", kind: "angle-radians", read: (actor) => actor.facing }
  ]
});

const outpostProjectilePresentation = defineMultiplayerReplicationEntityPresentation<
  OutpostClientAuthoritySnapshot,
  OutpostReplicatedProjectile
>({
  id: "outpost.projectiles",
  select: (snapshot) => snapshot.combat.projectiles,
  identity: (projectile) => projectile.networkEntityId,
  generation: (projectile) => projectile.generation,
  fields: [
    {
      id: "position",
      kind: "vector2",
      snapDistance: 160,
      read: (projectile) => ({ x: projectile.x, y: projectile.y })
    },
    { id: "facing", kind: "angle-radians", read: (projectile) => projectile.facing }
  ]
});

export type OutpostClientShadowSnapshot = {
  mode: "remote-authority-shadow";
  running: boolean;
  authorityPeerId?: string;
  receivedSnapshots: number;
  rejectedSnapshots: number;
  lastReceivedTick: number;
  lastAppliedTick: number;
  entityCount: number;
  match?: OutpostClientAuthoritySnapshot;
  combatPresentation: ReturnType<OutpostClientCombatPresentation["snapshot"]>;
  replication?: MultiplayerClientReplicationDiagnostics;
};

export type OutpostClientShadowRuntime = {
  runtime: GameRuntime;
  input: OutpostInputState;
  identity: OutpostIdentityRegistry;
  animator: AnimatorHandle;
  playerPresentation: OutpostClientPlayerPresentation;
  combatPresentation: OutpostClientCombatPresentation;
  requestInputSample(): void;
  screenToWorld(point: PointLike): PointLike;
  view(): OutpostClientAuthoritySnapshot | undefined;
  snapshot(): OutpostClientShadowSnapshot;
};

export type OutpostClientCameraAdapter = {
  applyCameraState(state: CameraState2D): void;
};

export type CreateOutpostClientShadowRuntimeOptions = {
  dataRegistry: DataRegistry;
  world: GameWorld;
  multiplayer: MultiplayerRuntime;
  physicsBackend: PhysicsBackendAdapter;
  localPlayerId: string;
  snapshotSource?: MultiplayerClientReplicationSnapshotSource | undefined;
  renderer?: RendererAdapter | undefined;
  animationAdapter?: AnimationPlaybackAdapter | undefined;
  audio?: GameAudio | undefined;
  applyRenderTargetState?: OutpostRenderTargetWriter | undefined;
  camera?: CameraController | undefined;
  cameraAdapter?: OutpostClientCameraAdapter | undefined;
  eventBus?: EventBus | undefined;
  seed?: string | undefined;
};

type MaterializedClientPlayer = {
  playerId: string;
  networkEntityId: string;
  generation: number;
  slot: number;
  entityId: EntityId;
  renderObjectId: string;
};

type MaterializedClientCombatObject = {
  objectId: string;
  networkEntityId: string;
  generation: number;
  kind: "enemy" | "buildable" | "projectile";
  entityId: EntityId;
  renderObjectId: string;
};

type ClientShadowState = {
  dataRegistry: DataRegistry;
  world: GameWorld;
  localPlayerId: string;
  physicsBackend: PhysicsBackendAdapter;
  input: OutpostInputState;
  identity: OutpostIdentityRegistry;
  players: Map<string, MaterializedClientPlayer>;
  combatObjects: Map<string, MaterializedClientCombatObject>;
  presentedPlayers: Map<string, OutpostPresentedPlayerState>;
  presentedCombatObjects: Map<string, OutpostPresentedCombatObjectState>;
  replication?: MultiplayerClientReplicationView<
    OutpostClientAuthoritySnapshot,
    OutpostPredictedPlayerState
  >;
  received?: OutpostClientAuthoritySnapshot;
  lastAppliedTick: number;
  lastDashInputSequence: number;
  predictedDashSequence: number;
  nextDashPredictionAtMs: number;
};

type OutpostPredictionInput = {
  moveX: number;
  moveY: number;
  aimX: number;
  aimY: number;
  fireHeld: boolean;
  fireSequence: number;
  dashSequence: number;
};

type OutpostPredictedPlayerState = {
  playerId: string;
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

type OutpostPresentedPlayerState = {
  position: NetworkVector2;
  velocityX: number;
  velocityY: number;
  facing: number;
  tags: readonly string[];
  dashSequence: number;
  dashRemainingMs: number;
  dashDirectionX: number;
  dashDirectionY: number;
  generation?: number | undefined;
  authorityElapsedMs?: number | undefined;
  targetActorId?: string | undefined;
  aiGoalId?: string | undefined;
  aiTaskPhase?: string | undefined;
  abilityExecutionId?: string | undefined;
  abilityId?: string | undefined;
  abilityPhase?: string | undefined;
  abilityPhaseStartedAt?: number | undefined;
  abilityPhaseEndsAt?: number | undefined;
  weaponShotSequence?: number | undefined;
  weaponLastShotCorrelationId?: string | undefined;
};

type OutpostPresentedCombatObjectState = OutpostPresentedPlayerState;

export function createOutpostClientShadowRuntime(
  options: CreateOutpostClientShadowRuntimeOptions
): OutpostClientShadowRuntime {
  const eventBus = options.eventBus ?? createEventBus({ clock: () => Date.now() });
  const playerDefinition = options.dataRegistry.getValue<OutpostPlayerDefinition>(
    OUTPOST_PLAYER_TYPE,
    PLAYER_DEFINITION_ID
  );
  const weaponDefinition = options.dataRegistry.getValue<OutpostWeaponDefinition>(
    OUTPOST_WEAPON_TYPE,
    playerDefinition.weapon.id
  );
  const playerPresentation = createOutpostClientPlayerPresentation({
    playerId: options.localPlayerId,
    fireIntervalMs: weaponDefinition.fireIntervalMs
  });
  const combatPresentation = createOutpostClientCombatPresentation();
  const state: ClientShadowState = {
    dataRegistry: options.dataRegistry,
    world: options.world,
    localPlayerId: options.localPlayerId,
    physicsBackend: options.physicsBackend,
    input: createOutpostInputState(),
    identity: createOutpostIdentityRegistry(),
    players: new Map(),
    combatObjects: new Map(),
    presentedPlayers: new Map(),
    presentedCombatObjects: new Map(),
    lastAppliedTick: -1,
    lastDashInputSequence: 0,
    predictedDashSequence: 0,
    nextDashPredictionAtMs: 0
  };
  const animator = createAnimatorHandle({ id: "outpost.client.animator" });
  const runtime = createGame({
    seed: options.seed ?? `outpost.client.${options.localPlayerId}`,
    world: options.world,
    eventBus,
    modules: [
      createClientReplicationModule(state, options.multiplayer, options.snapshotSource),
      createOutpostClientPlayerPresentationModule({
        presentation: playerPresentation,
        readFrame() {
          const match = state.received;
          const actor = match?.combat.actors.find(
            (candidate) => candidate.objectId === options.localPlayerId
          );
          return {
            active: match?.phase === "running",
            health: actor?.health ?? 0,
            fireHeld: state.input.fireHeld,
            fireSequence: state.input.fireSequence,
            aimX: state.input.aimX,
            aimY: state.input.aimY,
            ...(actor?.weapon === undefined ? {} : { weapon: actor.weapon })
          };
        }
      }),
      createOutpostClientCombatPresentationModule({
        presentation: combatPresentation,
        readCombat() {
          const match = state.received;
          return match === undefined
            ? undefined
            : { active: match.phase === "running", combat: match.combat };
        }
      }),
      createClientShadowCameraModule(state, options.camera, options.cameraAdapter),
      ...(options.renderer
        ? [
            createOutpostClientPresentationModule({
              dataRegistry: options.dataRegistry,
              renderer: options.renderer,
              animator: options.animationAdapter === undefined ? undefined : animator,
              audio: options.audio,
              camera: options.camera,
              physicsBackend: options.physicsBackend,
              playerPresentation,
              combatPresentation,
              listenerObjectId: options.localPlayerId,
              applyRenderTargetState: options.applyRenderTargetState,
              readProjectilePredictionFrame() {
                const match = state.received;
                return match === undefined
                  ? undefined
                  : {
                      generation: match.combat.projectileGeneration,
                      authorityElapsedMs: match.elapsedMs,
                      actors: match.combat.actors,
                      records: match.combat.projectileRecords
                    };
              },
              readObjectState(objectId) {
                return (
                  state.presentedPlayers.get(objectId) ?? state.presentedCombatObjects.get(objectId)
                );
              }
            })
          ]
        : []),
      ...(options.animationAdapter === undefined
        ? []
        : [
            createAnimatorModule({
              id: "outpost.client.animator",
              dataRegistry: options.dataRegistry,
              adapter: options.animationAdapter,
              handle: animator,
              maxControllers: 1_024,
              maxQueuedOneShotsPerController: 2,
              markerHistoryLimit: 64,
              maxMarkerEventsPerControllerUpdate: 12,
              traceLimit: 320
            })
          ]),
      createClientShadowInputResetModule(state),
      createClientShadowLifecycleModule(state)
    ]
  });

  return {
    runtime,
    input: state.input,
    identity: state.identity,
    animator,
    playerPresentation,
    combatPresentation,
    requestInputSample() {
      state.replication?.requestInputSample();
    },
    screenToWorld(point) {
      return options.camera?.screenToWorld(point) ?? point;
    },
    view() {
      return state.received ? cloneAuthoritySnapshot(state.received) : undefined;
    },
    snapshot() {
      const replication = state.replication?.diagnostics();
      const binding = state.replication?.binding();
      return {
        mode: "remote-authority-shadow",
        running: runtime.isRunning(),
        ...(binding?.authorityPeerId === undefined
          ? {}
          : { authorityPeerId: binding.authorityPeerId }),
        receivedSnapshots: replication?.receivedSnapshots ?? 0,
        rejectedSnapshots: replication?.rejectedSnapshots ?? 0,
        lastReceivedTick: state.received?.tick ?? -1,
        lastAppliedTick: state.lastAppliedTick,
        entityCount: state.world.count(),
        combatPresentation: combatPresentation.snapshot(),
        ...(state.received === undefined ? {} : { match: cloneAuthoritySnapshot(state.received) }),
        ...(replication === undefined ? {} : { replication })
      };
    }
  };
}

function createClientReplicationModule(
  state: ClientShadowState,
  multiplayer: MultiplayerRuntime,
  snapshotSource: MultiplayerClientReplicationSnapshotSource | undefined
) {
  const playerDefinition = state.dataRegistry.getValue<OutpostPlayerDefinition>(
    OUTPOST_PLAYER_TYPE,
    PLAYER_DEFINITION_ID
  );
  const dashAbility = state.dataRegistry.getValue<GasAbilityDefinition>(
    GAS_ABILITY_TYPE,
    DASH_ABILITY_ID
  );
  const predictedPosition = definePredictionVector2StateField<OutpostPredictedPlayerState>({
    readX: (predicted) => predicted.x,
    readY: (predicted) => predicted.y,
    write(predicted, x, y) {
      predicted.x = x;
      predicted.y = y;
    }
  });
  const predictedFacing = definePredictionAngleStateField<OutpostPredictedPlayerState>({
    read: (predicted) => predicted.facing,
    write(predicted, facing) {
      predicted.facing = facing;
    }
  });
  const physicsTransition = createOutpostPredictionTransitionFactory(state, playerDefinition);
  const fallbackPosition = { x: 0, y: 0 };
  const replicationSchema = defineMultiplayerReplicationSchema<
    OutpostClientAuthoritySnapshot,
    { playerId: string; peerId?: string | undefined },
    OutpostClientPlayerSnapshot
  >({
    id: "outpost.client-authority",
    version: OUTPOST_COLYSEUS_SCHEMA_VERSION,
    decode: readOutpostClientAuthoritySnapshot,
    tick: (snapshot) => snapshot.tick,
    time: (snapshot) => snapshot.tick * OUTPOST_NETWORK_TIMING.tickMs,
    presentation: [
      outpostPlayerPresentation,
      outpostActorPresentation,
      outpostProjectilePresentation
    ],
    local: {
      select: (snapshot, identity) =>
        snapshot.players.find((player) => player.playerId === identity.playerId),
      acknowledgedSequence: (snapshot, identity) =>
        identity.peerId === undefined ? undefined : snapshot.inputAcksByPeerId[identity.peerId]
    }
  }).bindClient<OutpostPredictedPlayerState, GameInstallContext>({
    identity({ runtime }) {
      const peerId = runtime.localPeer()?.id;
      return {
        playerId: state.localPlayerId,
        ...(peerId === undefined ? {} : { peerId })
      };
    },
    state: (player) => predictedStateFromSnapshot(player)
  });
  return createMultiplayerModule<
    GameInstallContext,
    OutpostClientAuthoritySnapshot,
    OutpostPredictionInput,
    OutpostPredictedPlayerState
  >({
    id: "outpost.client.multiplayer",
    runtime: multiplayer,
    clientReplication: {
      id: "outpost.client.replication",
      schema: replicationSchema,
      ...(snapshotSource === undefined ? {} : { snapshotSource }),
      playback: {
        interpolationDelayMs: 50,
        adaptiveDelay: {
          minDelayMs: 50,
          maxDelayMs: 150,
          jitterMultiplier: 2
        },
        maxSnapshots: 24,
        timeSource: "tick",
        readTime(entry) {
          return entry.tick === undefined ? undefined : entry.tick * OUTPOST_NETWORK_TIMING.tickMs;
        },
        shouldReset(previous, next) {
          return (
            previous !== undefined &&
            (next.tick < previous.tick ||
              previous.phase !== next.phase ||
              playerGenerationChanged(previous, next))
          );
        }
      },
      applyAuthoritative({ installContext, snapshot }) {
        applyAuthoritativeSnapshot(
          state,
          installContext.world,
          snapshot,
          playerDefinition.renderObject.id
        );
      },
      prediction: {
        inputRateHz: OUTPOST_NETWORK_TIMING.tickRateHz,
        maxCatchUpSteps: 2,
        maxInFlightSends: 4,
        maxPredictionLeadInputs: 2,
        buffer: {
          cloneState: clonePredictedPlayerState,
          transition: physicsTransition,
          presentation: definePredictionStatePresentation({
            fields: [predictedPosition, predictedFacing],
            correction: {
              measure: predictedPosition,
              smooth: [predictedPosition],
              durationMs: 100,
              maxMagnitude: 48
            }
          })
        },
        readInput({ snapshot, frame }) {
          return {
            moveX: state.input.moveX,
            moveY: state.input.moveY,
            aimX: state.input.aimX,
            aimY: state.input.aimY,
            fireHeld: state.input.fireHeld,
            fireSequence: state.input.fireSequence,
            dashSequence: resolvePredictedDashSequence(
              state,
              state.received ?? snapshot,
              frame.elapsed ?? snapshot.elapsedMs,
              dashAbility
            )
          };
        },
        encodeInput({ input, predictionFrame }) {
          return { sequence: predictionFrame.sequence, ...input };
        },
        active({ snapshot }) {
          return snapshot.phase === "running";
        }
      },
      applyFrame({ snapshot, presented, predictedState }) {
        applyPresentedSnapshot(state, snapshot, presented, predictedState, fallbackPosition);
      },
      expose(view) {
        if (view === undefined) {
          delete state.replication;
        } else {
          state.replication = view;
        }
      }
    }
  });
}

function applyAuthoritativeSnapshot(
  state: ClientShadowState,
  world: GameWorld,
  snapshot: OutpostClientAuthoritySnapshot,
  renderKey: string
): void {
  const desired = new Map(snapshot.players.map((player) => [player.playerId, player]));
  for (const [playerId, materialized] of state.players) {
    if (desired.has(playerId)) {
      continue;
    }
    state.identity.remove(playerId);
    state.presentedPlayers.delete(playerId);
    if (world.has(materialized.entityId)) {
      world.despawn(materialized.entityId);
    }
    state.players.delete(playerId);
  }
  for (const player of snapshot.players) {
    let materialized = state.players.get(player.playerId);
    if (
      materialized !== undefined &&
      (materialized.networkEntityId !== player.networkEntityId ||
        materialized.generation !== player.generation)
    ) {
      removeMaterializedClientPlayer(state, world, materialized);
      materialized = undefined;
    }
    materialized ??= materializeClientPlayer(state, world, player, renderKey);
    world.set(materialized.entityId, PhysicsTransformComponent, {
      position: { x: player.x, y: player.y }
    });
    world.set(materialized.entityId, PhysicsVelocityComponent, {
      linear: { x: player.velocityX, y: player.velocityY }
    });
    world.set(materialized.entityId, OutpostGameplayObject, { facing: player.facing });
  }
  applyAuthoritativeCombatObjects(state, world, snapshot);
  state.received = snapshot;
  state.lastAppliedTick = snapshot.tick;
}

function applyAuthoritativeCombatObjects(
  state: ClientShadowState,
  world: GameWorld,
  snapshot: OutpostClientAuthoritySnapshot
): void {
  const desired = new Set<string>();
  for (const actor of snapshot.combat.actors) {
    if (actor.kind === "player") {
      continue;
    }
    desired.add(actor.objectId);
    upsertClientCombatObject(state, world, actor, actor.kind);
  }
  for (const projectile of snapshot.combat.projectiles) {
    desired.add(projectile.objectId);
    upsertClientCombatObject(state, world, projectile, "projectile");
  }
  for (const materialized of state.combatObjects.values()) {
    if (!desired.has(materialized.objectId)) {
      removeMaterializedClientCombatObject(state, world, materialized);
    }
  }
}

function upsertClientCombatObject(
  state: ClientShadowState,
  world: GameWorld,
  snapshot: OutpostReplicatedActor | OutpostReplicatedProjectile,
  kind: MaterializedClientCombatObject["kind"]
): void {
  let materialized = state.combatObjects.get(snapshot.objectId);
  if (
    materialized !== undefined &&
    (materialized.networkEntityId !== snapshot.networkEntityId ||
      materialized.generation !== snapshot.generation)
  ) {
    removeMaterializedClientCombatObject(state, world, materialized);
    materialized = undefined;
  }
  materialized ??= materializeClientCombatObject(state, world, snapshot, kind);
  world.set(materialized.entityId, PhysicsTransformComponent, {
    position: { x: snapshot.x, y: snapshot.y }
  });
  world.set(materialized.entityId, PhysicsVelocityComponent, {
    linear: { x: snapshot.velocityX, y: snapshot.velocityY }
  });
  world.set(materialized.entityId, OutpostGameplayObject, {
    id: snapshot.objectId,
    kind,
    facing: snapshot.facing
  });
}

function materializeClientCombatObject(
  state: ClientShadowState,
  world: GameWorld,
  snapshot: OutpostReplicatedActor | OutpostReplicatedProjectile,
  kind: MaterializedClientCombatObject["kind"]
): MaterializedClientCombatObject {
  const entityId = world.spawn();
  const renderObjectId = `outpost.client.${kind}.${snapshot.networkEntityId}.${snapshot.generation}`;
  const materialized: MaterializedClientCombatObject = {
    objectId: snapshot.objectId,
    networkEntityId: snapshot.networkEntityId,
    generation: snapshot.generation,
    kind,
    entityId,
    renderObjectId
  };
  try {
    world.add(entityId, OutpostGameplayObject, {
      id: snapshot.objectId,
      kind,
      facing: snapshot.facing
    });
    world.add(entityId, PhysicsTransformComponent, {
      position: { x: snapshot.x, y: snapshot.y }
    });
    world.add(entityId, PhysicsVelocityComponent, {
      linear: { x: snapshot.velocityX, y: snapshot.velocityY }
    });
    world.add(entityId, OutpostPresentation, {
      renderKey: snapshot.renderKey,
      renderObjectId
    });
    state.identity.register({
      gameplayObjectId: snapshot.objectId,
      entityId,
      network: { entityId: snapshot.networkEntityId, generation: snapshot.generation },
      renderObjectId
    });
    state.combatObjects.set(snapshot.objectId, materialized);
    return materialized;
  } catch (error) {
    state.identity.remove(snapshot.objectId);
    if (world.has(entityId)) {
      world.despawn(entityId);
    }
    throw error;
  }
}

function removeMaterializedClientCombatObject(
  state: ClientShadowState,
  world: GameWorld,
  object: MaterializedClientCombatObject
): void {
  state.identity.remove(object.objectId);
  state.presentedCombatObjects.delete(object.objectId);
  if (world.has(object.entityId)) {
    world.despawn(object.entityId);
  }
  state.combatObjects.delete(object.objectId);
}

function applyPresentedSnapshot(
  state: ClientShadowState,
  snapshot: OutpostClientAuthoritySnapshot,
  presented: PresentedSnapshotTracks,
  predictedState: OutpostPredictedPlayerState | undefined,
  fallbackPosition: NetworkVector2
): void {
  for (const player of snapshot.players) {
    let target = state.presentedPlayers.get(player.playerId);
    if (target === undefined) {
      target = {
        position: { x: player.x, y: player.y },
        velocityX: player.velocityX,
        velocityY: player.velocityY,
        facing: player.facing,
        tags: [],
        dashSequence: player.dashSequence,
        dashRemainingMs: player.dashRemainingMs,
        dashDirectionX: player.dashDirectionX,
        dashDirectionY: player.dashDirectionY
      };
      state.presentedPlayers.set(player.playerId, target);
    }
    if (predictedState?.playerId === player.playerId) {
      target.position.x = predictedState.x;
      target.position.y = predictedState.y;
      target.velocityX = predictedState.velocityX;
      target.velocityY = predictedState.velocityY;
      target.facing = predictedState.facing;
      target.dashSequence = predictedState.dashSequence;
      target.dashRemainingMs = predictedState.dashRemainingMs;
      target.dashDirectionX = predictedState.dashDirectionX;
      target.dashDirectionY = predictedState.dashDirectionY;
      applyPresentedActorSemantics(
        target,
        snapshot.combat.actors.find(
          (actor) => actor.kind === "player" && actor.objectId === player.playerId
        ),
        snapshot.elapsedMs
      );
      continue;
    }
    fallbackPosition.x = player.x;
    fallbackPosition.y = player.y;
    presented.vector2Into(playerPositionKey(player), target.position, fallbackPosition);
    target.velocityX = player.velocityX;
    target.velocityY = player.velocityY;
    target.facing = presented.angleRadians(playerFacingKey(player), player.facing);
    target.dashSequence = player.dashSequence;
    target.dashRemainingMs = player.dashRemainingMs;
    target.dashDirectionX = player.dashDirectionX;
    target.dashDirectionY = player.dashDirectionY;
    applyPresentedActorSemantics(
      target,
      snapshot.combat.actors.find(
        (actor) => actor.kind === "player" && actor.objectId === player.playerId
      ),
      snapshot.elapsedMs
    );
  }
  for (const playerId of state.presentedPlayers.keys()) {
    if (!snapshot.players.some((player) => player.playerId === playerId)) {
      state.presentedPlayers.delete(playerId);
    }
  }
  const presentedCombatIds = new Set<string>();
  for (const actor of snapshot.combat.actors) {
    if (actor.kind === "player") {
      continue;
    }
    presentedCombatIds.add(actor.objectId);
    applyPresentedCombatObject(
      state,
      actor,
      actor.tags,
      presented,
      fallbackPosition,
      snapshot.elapsedMs
    );
  }
  for (const projectile of snapshot.combat.projectiles) {
    presentedCombatIds.add(projectile.objectId);
    applyPresentedCombatObject(
      state,
      projectile,
      [],
      presented,
      fallbackPosition,
      snapshot.elapsedMs
    );
  }
  for (const objectId of state.presentedCombatObjects.keys()) {
    if (!presentedCombatIds.has(objectId)) {
      state.presentedCombatObjects.delete(objectId);
    }
  }
}

function applyPresentedCombatObject(
  state: ClientShadowState,
  object: OutpostReplicatedActor | OutpostReplicatedProjectile,
  tags: readonly string[],
  presented: PresentedSnapshotTracks,
  fallbackPosition: NetworkVector2,
  authorityElapsedMs: number
): void {
  let target = state.presentedCombatObjects.get(object.objectId);
  if (target === undefined) {
    target = {
      position: { x: object.x, y: object.y },
      velocityX: object.velocityX,
      velocityY: object.velocityY,
      facing: object.facing,
      tags,
      dashSequence: 0,
      dashRemainingMs: 0,
      dashDirectionX: 0,
      dashDirectionY: 0
    };
    state.presentedCombatObjects.set(object.objectId, target);
  }
  fallbackPosition.x = object.x;
  fallbackPosition.y = object.y;
  presented.vector2Into(combatObjectPositionKey(object), target.position, fallbackPosition);
  target.velocityX = object.velocityX;
  target.velocityY = object.velocityY;
  target.facing = presented.angleRadians(combatObjectFacingKey(object), object.facing);
  target.tags = tags;
  if ("kind" in object) {
    applyPresentedActorSemantics(target, object, authorityElapsedMs);
  } else {
    clearPresentedActorSemantics(target);
  }
}

function applyPresentedActorSemantics(
  target: OutpostPresentedPlayerState,
  actor: OutpostReplicatedActor | undefined,
  authorityElapsedMs: number
): void {
  target.tags = actor?.tags ?? [];
  assignOptional(target, "generation", actor?.generation);
  target.authorityElapsedMs = authorityElapsedMs;
  assignOptional(target, "targetActorId", actor?.targetActorId);
  assignOptional(target, "aiGoalId", actor?.aiGoalId);
  assignOptional(target, "aiTaskPhase", actor?.aiTaskPhase);
  assignOptional(target, "abilityExecutionId", actor?.abilityExecutionId);
  assignOptional(target, "abilityId", actor?.abilityId);
  assignOptional(target, "abilityPhase", actor?.abilityPhase);
  assignOptional(target, "abilityPhaseStartedAt", actor?.abilityPhaseStartedAt);
  assignOptional(target, "abilityPhaseEndsAt", actor?.abilityPhaseEndsAt);
  assignOptional(target, "weaponShotSequence", actor?.weapon?.shotSequence);
  assignOptional(target, "weaponLastShotCorrelationId", actor?.weapon?.lastShotCorrelationId);
}

function clearPresentedActorSemantics(target: OutpostPresentedPlayerState): void {
  target.tags = [];
  delete target.generation;
  delete target.authorityElapsedMs;
  delete target.targetActorId;
  delete target.aiGoalId;
  delete target.aiTaskPhase;
  delete target.abilityExecutionId;
  delete target.abilityId;
  delete target.abilityPhase;
  delete target.abilityPhaseStartedAt;
  delete target.abilityPhaseEndsAt;
  delete target.weaponShotSequence;
  delete target.weaponLastShotCorrelationId;
}

function assignOptional<
  TKey extends Exclude<keyof OutpostPresentedPlayerState, "position" | "tags">
>(
  target: OutpostPresentedPlayerState,
  key: TKey,
  value: OutpostPresentedPlayerState[TKey] | undefined
): void {
  if (value === undefined) {
    delete target[key];
  } else {
    target[key] = value;
  }
}

function predictedStateFromSnapshot(
  player: OutpostClientPlayerSnapshot
): OutpostPredictedPlayerState {
  return {
    playerId: player.playerId,
    x: player.x,
    y: player.y,
    velocityX: player.velocityX,
    velocityY: player.velocityY,
    facing: player.facing,
    dashSequence: player.dashSequence,
    dashRemainingMs: player.dashRemainingMs,
    dashDirectionX: player.dashDirectionX,
    dashDirectionY: player.dashDirectionY
  };
}

function clonePredictedPlayerState(
  state: OutpostPredictedPlayerState
): OutpostPredictedPlayerState {
  return { ...state };
}

function resolvePredictedDashSequence(
  state: ClientShadowState,
  snapshot: OutpostClientAuthoritySnapshot,
  clientElapsedMs: number,
  ability: GasAbilityDefinition
): number {
  const requestedSequence = state.input.dashSequence >>> 0;
  if (requestedSequence === state.lastDashInputSequence) {
    return state.predictedDashSequence;
  }
  state.lastDashInputSequence = requestedSequence;

  const player = snapshot.players.find((candidate) => candidate.playerId === state.localPlayerId);
  const actor = snapshot.combat.actors.find(
    (candidate) => candidate.kind === "player" && candidate.objectId === state.localPlayerId
  );
  const costsAvailable = ability.costs?.every((cost) => {
    switch (cost.attribute) {
      case "health":
        return actor !== undefined && actor.health >= cost.amount;
      case "shield":
        return actor !== undefined && actor.shield >= cost.amount;
      case "stamina":
        return actor !== undefined && actor.stamina >= cost.amount;
      case "shared-resource":
        return actor !== undefined && actor.resource >= cost.amount;
      default:
        return false;
    }
  });
  const authorityCooldownEndsAt = actor?.cooldowns[ability.id] ?? 0;
  const canPredict =
    snapshot.phase === "running" &&
    player !== undefined &&
    actor !== undefined &&
    actor.health > 0 &&
    player.dashRemainingMs <= 0 &&
    !actor.tags.includes("state.dashing") &&
    authorityCooldownEndsAt <= snapshot.elapsedMs &&
    costsAvailable !== false &&
    clientElapsedMs >= state.nextDashPredictionAtMs;
  if (!canPredict) {
    return state.predictedDashSequence;
  }

  state.predictedDashSequence = requestedSequence;
  state.nextDashPredictionAtMs = clientElapsedMs + Math.max(0, ability.cooldownMs ?? 0);
  return state.predictedDashSequence;
}

function createOutpostPredictionTransitionFactory(
  state: ClientShadowState,
  player: OutpostPlayerDefinition
) {
  const movementProfile = state.dataRegistry.getValue<OutpostMovementProfileDefinition>(
    OUTPOST_MOVEMENT_PROFILE_TYPE,
    player.movementProfile.id
  );
  const bodyData = state.dataRegistry.getValue<PhysicsBodyData>(
    "physics.body",
    player.physicsBody.id
  );
  const colliderRef = bodyData.colliders?.[0];
  if (colliderRef === undefined) {
    throw new Error(`Outpost predicted player body requires a collider: ${bodyData.id}`);
  }
  const colliderData = state.dataRegistry.getValue<PhysicsColliderData>(
    colliderRef.type,
    colliderRef.id
  );
  const layout = createPhysicsLayoutDefinitions({
    dataRegistry: state.dataRegistry,
    layoutId: OUTPOST_ARENA_PHYSICS_LAYOUT_ID,
    idPrefix: "outpost.client-prediction.arena"
  });
  const environment = {
    bodies: layout.bodies
      .filter((body) => body.enabled)
      .map((body) => ({
        ...body.definition,
        position: body.position,
        ...(body.rotation === undefined ? {} : { rotation: body.rotation })
      })),
    colliders: layout.colliders
      .filter((collider) => collider.enabled)
      .map((collider) => collider.definition)
  };
  const scene = createOutpostArenaPhysicsSceneConfig(state.dataRegistry);
  const subjectBodyId = "outpost.client-prediction.player.body";
  const subjectColliderId = "outpost.client-prediction.player.collider";
  const subjectBody = toPredictionBodyDefinition(bodyData, subjectBodyId);
  const subjectCollider = toPredictionColliderDefinition(
    colliderData,
    subjectBodyId,
    subjectColliderId
  );

  return () =>
    createPhysicsBodyPredictionTransition<OutpostPredictedPlayerState, OutpostPredictionInput>({
      backend: state.physicsBackend,
      scene,
      environment,
      fixedDeltaMs: 1000 / 60,
      maxSubSteps: 4,
      subject: {
        body: subjectBody,
        colliders: [subjectCollider],
        readState(predicted) {
          return {
            position: { x: predicted.x, y: predicted.y },
            linearVelocity: { x: predicted.velocityX, y: predicted.velocityY }
          };
        },
        applyInput(predicted, input, context) {
          advanceOutpostMovement(predicted, input, movementProfile, {
            deltaMs: context.stepMs,
            position: { x: predicted.x, y: predicted.y }
          });
          return {
            linearVelocity: {
              x: predicted.velocityX,
              y: predicted.velocityY
            }
          };
        },
        writeState(predicted, body) {
          predicted.x = body.position.x;
          predicted.y = body.position.y;
          predicted.velocityX = body.linearVelocity.x;
          predicted.velocityY = body.linearVelocity.y;
          return predicted;
        }
      }
    });
}

function toPredictionBodyDefinition(data: PhysicsBodyData, id: string) {
  const { colliders: _colliders, tags: _tags, id: _id, ...definition } = data;
  return { ...definition, id };
}

function toPredictionColliderDefinition(data: PhysicsColliderData, bodyId: string, id: string) {
  const { tags: _tags, id: _id, bodyId: _bodyId, ...definition } = data;
  return { ...definition, id, bodyId };
}

function playerPositionKey(player: OutpostClientPlayerSnapshot): string {
  return String(outpostPlayerPresentation.key("position", player));
}

function playerFacingKey(player: OutpostClientPlayerSnapshot): string {
  return String(outpostPlayerPresentation.key("facing", player));
}

function combatObjectPositionKey(
  object: OutpostReplicatedActor | OutpostReplicatedProjectile
): string {
  return String(
    "kind" in object
      ? outpostActorPresentation.key("position", object)
      : outpostProjectilePresentation.key("position", object)
  );
}

function combatObjectFacingKey(
  object: OutpostReplicatedActor | OutpostReplicatedProjectile
): string {
  return String(
    "kind" in object
      ? outpostActorPresentation.key("facing", object)
      : outpostProjectilePresentation.key("facing", object)
  );
}

function* nonPlayerActors(
  snapshot: OutpostClientAuthoritySnapshot
): Iterable<OutpostReplicatedActor> {
  for (const actor of snapshot.combat.actors) {
    if (actor.kind !== "player") {
      yield actor;
    }
  }
}

function materializeClientPlayer(
  state: ClientShadowState,
  world: GameWorld,
  player: OutpostClientPlayerSnapshot,
  renderKey: string
): MaterializedClientPlayer {
  const entityId = world.spawn();
  const renderObjectId = `outpost.client.player.${player.slot}.${player.generation}`;
  const materialized = {
    playerId: player.playerId,
    networkEntityId: player.networkEntityId,
    generation: player.generation,
    slot: player.slot,
    entityId,
    renderObjectId
  };
  try {
    world.add(entityId, OutpostGameplayObject, {
      id: player.playerId,
      kind: "player",
      facing: player.facing
    });
    world.add(entityId, PhysicsTransformComponent, { position: { x: player.x, y: player.y } });
    world.add(entityId, PhysicsVelocityComponent, {
      linear: { x: player.velocityX, y: player.velocityY }
    });
    world.add(entityId, OutpostPresentation, { renderKey, renderObjectId });
    state.identity.register({
      gameplayObjectId: player.playerId,
      entityId,
      network: { entityId: player.networkEntityId, generation: player.generation },
      renderObjectId
    });
    state.players.set(player.playerId, materialized);
    return materialized;
  } catch (error) {
    state.identity.remove(player.playerId);
    if (world.has(entityId)) {
      world.despawn(entityId);
    }
    throw error;
  }
}

function removeMaterializedClientPlayer(
  state: ClientShadowState,
  world: GameWorld,
  player: MaterializedClientPlayer
): void {
  state.identity.remove(player.playerId);
  state.presentedPlayers.delete(player.playerId);
  if (world.has(player.entityId)) {
    world.despawn(player.entityId);
  }
  state.players.delete(player.playerId);
}

function playerGenerationChanged(
  previous: OutpostClientAuthoritySnapshot,
  next: OutpostClientAuthoritySnapshot
): boolean {
  const previousGeneration = new Map(
    previous.players.map((player) => [
      player.playerId,
      `${player.networkEntityId}:${player.generation}`
    ])
  );
  return next.players.some(
    (player) =>
      previousGeneration.has(player.playerId) &&
      previousGeneration.get(player.playerId) !== `${player.networkEntityId}:${player.generation}`
  );
}

function createClientShadowCameraModule(
  state: ClientShadowState,
  camera: CameraController | undefined,
  cameraAdapter: OutpostClientCameraAdapter | undefined
) {
  const playerDefinition = state.dataRegistry.getValue<OutpostPlayerDefinition>(
    OUTPOST_PLAYER_TYPE,
    PLAYER_DEFINITION_ID
  );
  const movementProfile = state.dataRegistry.getValue<OutpostMovementProfileDefinition>(
    OUTPOST_MOVEMENT_PROFILE_TYPE,
    playerDefinition.movementProfile.id
  );
  let lookaheadX = 0;
  let lookaheadY = 0;
  let impulseX = 0;
  let impulseY = 0;
  let lastDashSequence = 0;
  return defineGameModule<GameInstallContext>({
    id: "outpost.client.camera",
    install(ctx) {
      if (!camera) {
        return;
      }
      ctx.systems.register({
        id: "outpost.client.camera.follow",
        update({ delta }) {
          if (state.input.cameraZoomDelta !== 0) {
            const viewport = camera.getState().viewport;
            camera.zoom(state.input.cameraZoomDelta < 0 ? 1 : -1, {
              x: state.input.cameraZoomX ?? viewport.width / 2,
              y: state.input.cameraZoomY ?? viewport.height / 2
            });
          }
          const local = state.players.get(state.localPlayerId);
          const transform = local
            ? ctx.world.get(local.entityId, PhysicsTransformComponent)
            : undefined;
          const presented = state.presentedPlayers.get(state.localPlayerId);
          const position = presented?.position ?? transform?.position;
          if (position) {
            const targetLookahead = resolveCameraLookaheadTarget(
              state.input,
              position,
              camera.getState().viewport,
              movementProfile.cameraLookaheadDistance,
              presented?.facing ?? 0
            );
            const response =
              1 - Math.exp(-movementProfile.cameraLookaheadResponse * (delta / 1_000));
            lookaheadX += (targetLookahead.x - lookaheadX) * response;
            lookaheadY += (targetLookahead.y - lookaheadY) * response;
            if (
              presented !== undefined &&
              presented.dashRemainingMs > 0 &&
              presented.dashSequence !== lastDashSequence
            ) {
              impulseX += presented.dashDirectionX * movementProfile.cameraDashImpulse;
              impulseY += presented.dashDirectionY * movementProfile.cameraDashImpulse;
            }
            if (presented !== undefined) {
              lastDashSequence = presented.dashSequence;
            }
          }
          const impulseDecay = Math.exp(-12 * (delta / 1_000));
          impulseX *= impulseDecay;
          impulseY *= impulseDecay;
          camera.setState({
            mode: transform ? "follow" : "free",
            ...(local ? { targetEntity: local.entityId } : {}),
            x: (position?.x ?? OUTPOST_ARENA.width / 2) + lookaheadX + impulseX,
            y: (position?.y ?? OUTPOST_ARENA.height / 2) + lookaheadY + impulseY,
            bounds: { x: 0, y: 0, width: OUTPOST_ARENA.width, height: OUTPOST_ARENA.height }
          });
          cameraAdapter?.applyCameraState(camera.update(delta));
        }
      });
    }
  });
}

function resolveCameraLookaheadTarget(
  input: OutpostInputState,
  position: PointLike,
  viewport: { width: number; height: number },
  maximumDistance: number,
  fallbackFacing: number
): PointLike {
  if (input.aimMode === "pointer") {
    if (input.pointerViewportX === undefined || input.pointerViewportY === undefined) {
      return { x: 0, y: 0 };
    }
    const halfWidth = Math.max(1, viewport.width / 2);
    const halfHeight = Math.max(1, viewport.height / 2);
    const normalizedX = (input.pointerViewportX - halfWidth) / halfWidth;
    const normalizedY = (input.pointerViewportY - halfHeight) / halfHeight;
    const length = Math.hypot(normalizedX, normalizedY);
    const scale = length > 1 ? 1 / length : 1;
    return {
      x: normalizedX * scale * maximumDistance,
      y: normalizedY * scale * maximumDistance
    };
  }

  const rawAimX = input.aimX - position.x;
  const rawAimY = input.aimY - position.y;
  const aimLength = Math.hypot(rawAimX, rawAimY);
  return aimLength > 0
    ? { x: (rawAimX / aimLength) * maximumDistance, y: (rawAimY / aimLength) * maximumDistance }
    : {
        x: Math.cos(fallbackFacing) * maximumDistance,
        y: Math.sin(fallbackFacing) * maximumDistance
      };
}

function createClientShadowInputResetModule(state: ClientShadowState) {
  return defineGameModule<GameInstallContext>({
    id: "outpost.client.input-reset",
    install(ctx) {
      ctx.systems.register({
        id: "outpost.client.input-reset.clear",
        update() {
          clearOutpostTransientInput(state.input);
        }
      });
    }
  });
}

function createClientShadowLifecycleModule(state: ClientShadowState) {
  return defineGameModule<GameInstallContext>({
    id: "outpost.client.lifecycle",
    install(ctx) {
      return () => {
        for (const player of state.players.values()) {
          if (ctx.world.has(player.entityId)) {
            ctx.world.despawn(player.entityId);
          }
        }
        for (const object of state.combatObjects.values()) {
          if (ctx.world.has(object.entityId)) {
            ctx.world.despawn(object.entityId);
          }
        }
        state.players.clear();
        state.combatObjects.clear();
        state.presentedPlayers.clear();
        state.presentedCombatObjects.clear();
        state.identity.clear();
        delete state.replication;
        delete state.received;
      };
    }
  });
}

export function readOutpostClientAuthoritySnapshot(
  value: unknown
): OutpostClientAuthoritySnapshot | undefined {
  if (
    !isRecord(value) ||
    !isMatchPhase(value.phase) ||
    !nonNegativeInteger(value.tick) ||
    !nonNegativeFinite(value.elapsedMs) ||
    !nonNegativeFinite(value.countdownMsRemaining) ||
    !Array.isArray(value.participants) ||
    value.participants.length > MAX_PARTICIPANTS ||
    !Array.isArray(value.players) ||
    value.players.length > MAX_PLAYERS ||
    !isRecord(value.combat) ||
    !isRecord(value.inputAcksByPeerId)
  ) {
    return undefined;
  }
  const participants = value.participants.map(readParticipant);
  const players = value.players.map(readPlayer);
  const combat = readCombatState(value.combat);
  if (
    participants.some((participant) => !participant) ||
    players.some((player) => !player) ||
    combat === undefined
  ) {
    return undefined;
  }
  const inputAcksByPeerId: Record<string, number> = {};
  for (const [peerId, sequence] of Object.entries(value.inputAcksByPeerId)) {
    if (!nonEmptyString(peerId) || !nonNegativeInteger(sequence)) {
      return undefined;
    }
    inputAcksByPeerId[peerId] = sequence;
  }
  return {
    phase: value.phase,
    tick: value.tick,
    elapsedMs: value.elapsedMs,
    countdownMsRemaining: value.countdownMsRemaining,
    participants: participants as OutpostClientParticipantSnapshot[],
    players: players as OutpostClientPlayerSnapshot[],
    combat,
    inputAcksByPeerId
  };
}

function readParticipant(value: unknown): OutpostClientParticipantSnapshot | undefined {
  if (
    !isRecord(value) ||
    !nonEmptyString(value.peerId) ||
    !nonEmptyString(value.playerId) ||
    (value.status !== "active" && value.status !== "next-round" && value.status !== "spectator") ||
    typeof value.ready !== "boolean" ||
    (value.slot !== undefined && !nonNegativeInteger(value.slot)) ||
    (value.displayName !== undefined && typeof value.displayName !== "string")
  ) {
    return undefined;
  }
  return {
    peerId: value.peerId,
    playerId: value.playerId,
    status: value.status,
    ready: value.ready,
    ...(value.slot === undefined ? {} : { slot: value.slot }),
    ...(value.displayName === undefined ? {} : { displayName: value.displayName.slice(0, 24) })
  };
}

function readPlayer(value: unknown): OutpostClientPlayerSnapshot | undefined {
  if (
    !isRecord(value) ||
    !nonEmptyString(value.playerId) ||
    !nonNegativeInteger(value.slot) ||
    !finite(value.x) ||
    !finite(value.y) ||
    !finite(value.velocityX) ||
    !finite(value.velocityY) ||
    !finite(value.facing)
  ) {
    return undefined;
  }
  return {
    networkEntityId: nonEmptyString(value.networkEntityId) ? value.networkEntityId : value.playerId,
    generation: nonNegativeInteger(value.generation) ? value.generation : 0,
    archetypeId: nonEmptyString(value.archetypeId) ? value.archetypeId : PLAYER_DEFINITION_ID,
    playerId: value.playerId,
    slot: value.slot,
    x: value.x,
    y: value.y,
    velocityX: value.velocityX,
    velocityY: value.velocityY,
    facing: value.facing,
    dashSequence: nonNegativeInteger(value.dashSequence) ? value.dashSequence : 0,
    dashRemainingMs: nonNegativeFinite(value.dashRemainingMs) ? value.dashRemainingMs : 0,
    dashDirectionX: finite(value.dashDirectionX) ? value.dashDirectionX : 0,
    dashDirectionY: finite(value.dashDirectionY) ? value.dashDirectionY : 0
  };
}

function readCombatState(value: unknown): OutpostReplicatedCombatState | undefined {
  if (
    !isRecord(value) ||
    !Array.isArray(value.actors) ||
    value.actors.length > MAX_COMBAT_ACTORS ||
    !Array.isArray(value.projectiles) ||
    value.projectiles.length > MAX_PROJECTILES ||
    !nonEmptyString(value.projectileGeneration) ||
    !Array.isArray(value.projectileRecords) ||
    value.projectileRecords.length > MAX_PROJECTILE_RECORDS ||
    !nonNegativeInteger(value.cueWatermark) ||
    !Array.isArray(value.cues) ||
    value.cues.length > MAX_COMBAT_CUES ||
    !nonNegativeInteger(value.acceptedCommands) ||
    !nonNegativeInteger(value.rejectedCommands) ||
    !nonNegativeInteger(value.projectileHits) ||
    !nonNegativeInteger(value.enemyAttacks) ||
    !nonNegativeInteger(value.kills) ||
    !nonNegativeInteger(value.drops) ||
    !nonNegativeInteger(value.objectiveProgress)
  ) {
    return undefined;
  }
  const actors = value.actors.map(readCombatActor);
  const projectiles = value.projectiles.map(readCombatProjectile);
  const projectileRecords = value.projectileRecords.map(readKinematicProjectileRecord);
  const cues = value.cues.map(readCombatCue).sort((left, right) => {
    if (left === undefined) {
      return 1;
    }
    if (right === undefined) {
      return -1;
    }
    return left.sequence - right.sequence;
  });
  if (
    actors.some((actor) => !actor) ||
    projectiles.some((projectile) => !projectile) ||
    projectileRecords.some((record) => !record) ||
    projectileRecords.some(
      (record) => record !== undefined && String(record.generation) !== value.projectileGeneration
    ) ||
    cues.some((cue) => !cue) ||
    cues.some((cue, index) => index > 0 && cue!.sequence <= cues[index - 1]!.sequence) ||
    (cues.at(-1)?.sequence ?? 0) > value.cueWatermark
  ) {
    return undefined;
  }
  return {
    actors: actors as OutpostReplicatedActor[],
    projectiles: projectiles as OutpostReplicatedProjectile[],
    projectileGeneration: value.projectileGeneration,
    projectileRecords: projectileRecords as CombatKinematicProjectileRecord[],
    cueWatermark: value.cueWatermark,
    cues: cues as OutpostReplicatedCombatCue[],
    acceptedCommands: value.acceptedCommands,
    rejectedCommands: value.rejectedCommands,
    projectileHits: value.projectileHits,
    enemyAttacks: value.enemyAttacks,
    kills: value.kills,
    drops: value.drops,
    objectiveProgress: value.objectiveProgress
  };
}

function readCombatActor(value: unknown): OutpostReplicatedActor | undefined {
  if (
    !isRecord(value) ||
    !nonEmptyString(value.objectId) ||
    !nonEmptyString(value.networkEntityId) ||
    !nonNegativeInteger(value.generation) ||
    (value.kind !== "player" && value.kind !== "enemy" && value.kind !== "buildable") ||
    !nonEmptyString(value.definitionId) ||
    !nonEmptyString(value.renderKey) ||
    !finite(value.x) ||
    !finite(value.y) ||
    !finite(value.velocityX) ||
    !finite(value.velocityY) ||
    !finite(value.facing) ||
    !finite(value.health) ||
    !finite(value.shield) ||
    !finite(value.stamina) ||
    !finite(value.resource) ||
    !Array.isArray(value.tags) ||
    value.tags.length > 64 ||
    !value.tags.every(nonEmptyString) ||
    !isRecord(value.cooldowns) ||
    !optionalNonEmptyString(value.targetActorId) ||
    !optionalNonEmptyString(value.aiGoalId) ||
    !optionalNonEmptyString(value.aiTaskPhase) ||
    !optionalNonEmptyString(value.abilityExecutionId) ||
    !optionalNonEmptyString(value.abilityId) ||
    !optionalNonEmptyString(value.abilityPhase) ||
    !optionalNonNegativeFinite(value.abilityPhaseStartedAt) ||
    !optionalNonNegativeFinite(value.abilityPhaseEndsAt) ||
    (value.abilityPhaseStartedAt !== undefined &&
      value.abilityPhaseEndsAt !== undefined &&
      value.abilityPhaseEndsAt < value.abilityPhaseStartedAt)
  ) {
    return undefined;
  }
  const cooldowns: Record<string, number> = {};
  for (const [abilityId, until] of Object.entries(value.cooldowns)) {
    if (!nonEmptyString(abilityId) || !nonNegativeFinite(until)) {
      return undefined;
    }
    cooldowns[abilityId] = until;
  }
  const weapon = value.weapon === undefined ? undefined : readWeaponState(value.weapon);
  if (value.weapon !== undefined && weapon === undefined) {
    return undefined;
  }
  return {
    objectId: value.objectId,
    networkEntityId: value.networkEntityId,
    generation: value.generation,
    kind: value.kind,
    definitionId: value.definitionId,
    renderKey: value.renderKey,
    x: value.x,
    y: value.y,
    velocityX: value.velocityX,
    velocityY: value.velocityY,
    facing: value.facing,
    health: value.health,
    shield: value.shield,
    stamina: value.stamina,
    resource: value.resource,
    tags: [...value.tags],
    cooldowns,
    ...(value.targetActorId === undefined ? {} : { targetActorId: value.targetActorId }),
    ...(value.aiGoalId === undefined ? {} : { aiGoalId: value.aiGoalId }),
    ...(value.aiTaskPhase === undefined ? {} : { aiTaskPhase: value.aiTaskPhase }),
    ...(value.abilityExecutionId === undefined
      ? {}
      : { abilityExecutionId: value.abilityExecutionId }),
    ...(value.abilityId === undefined ? {} : { abilityId: value.abilityId }),
    ...(value.abilityPhase === undefined ? {} : { abilityPhase: value.abilityPhase }),
    ...(value.abilityPhaseStartedAt === undefined
      ? {}
      : { abilityPhaseStartedAt: value.abilityPhaseStartedAt }),
    ...(value.abilityPhaseEndsAt === undefined
      ? {}
      : { abilityPhaseEndsAt: value.abilityPhaseEndsAt }),
    ...(weapon === undefined ? {} : { weapon })
  };
}

function readWeaponState(value: unknown): OutpostReplicatedActor["weapon"] | undefined {
  if (
    !isRecord(value) ||
    !nonEmptyString(value.weaponId) ||
    !nonNegativeInteger(value.magazine) ||
    !nonNegativeInteger(value.magazineSize) ||
    value.magazine > value.magazineSize ||
    !nonNegativeInteger(value.reserveAmmo) ||
    (value.phase !== "ready" && value.phase !== "reloading" && value.phase !== "empty") ||
    !nonNegativeInteger(value.shotSequence) ||
    !optionalNonEmptyString(value.lastShotCorrelationId) ||
    !optionalNonNegativeFinite(value.reloadStartedAt) ||
    !optionalNonNegativeFinite(value.reloadEndsAt) ||
    !optionalNonEmptyString(value.reloadRequestId) ||
    !optionalNonEmptyString(value.reloadCorrelationId)
  ) {
    return undefined;
  }
  const lastFeedback =
    value.lastFeedback === undefined ? undefined : readWeaponFeedback(value.lastFeedback);
  if (value.lastFeedback !== undefined && lastFeedback === undefined) {
    return undefined;
  }
  return {
    weaponId: value.weaponId,
    magazine: value.magazine,
    magazineSize: value.magazineSize,
    reserveAmmo: value.reserveAmmo,
    phase: value.phase,
    shotSequence: value.shotSequence,
    ...(value.lastShotCorrelationId === undefined
      ? {}
      : { lastShotCorrelationId: value.lastShotCorrelationId }),
    ...(value.reloadStartedAt === undefined ? {} : { reloadStartedAt: value.reloadStartedAt }),
    ...(value.reloadEndsAt === undefined ? {} : { reloadEndsAt: value.reloadEndsAt }),
    ...(value.reloadRequestId === undefined ? {} : { reloadRequestId: value.reloadRequestId }),
    ...(value.reloadCorrelationId === undefined
      ? {}
      : { reloadCorrelationId: value.reloadCorrelationId }),
    ...(lastFeedback === undefined ? {} : { lastFeedback })
  };
}

function readWeaponFeedback(value: unknown): OutpostReplicatedWeaponFeedback | undefined {
  if (
    !isRecord(value) ||
    !nonNegativeInteger(value.sequence) ||
    (value.kind !== "rejected" && value.kind !== "cancelled") ||
    (value.action !== "rifle" && value.action !== "reload") ||
    !nonEmptyString(value.reason) ||
    !nonNegativeFinite(value.at) ||
    !optionalNonEmptyString(value.correlationId)
  ) {
    return undefined;
  }
  return {
    sequence: value.sequence,
    kind: value.kind,
    action: value.action,
    reason: value.reason,
    at: value.at,
    ...(value.correlationId === undefined ? {} : { correlationId: value.correlationId })
  };
}

function readCombatProjectile(value: unknown): OutpostReplicatedProjectile | undefined {
  if (
    !isRecord(value) ||
    !nonEmptyString(value.objectId) ||
    !nonEmptyString(value.networkEntityId) ||
    !nonNegativeInteger(value.generation) ||
    !nonEmptyString(value.renderKey) ||
    !finite(value.x) ||
    !finite(value.y) ||
    !finite(value.velocityX) ||
    !finite(value.velocityY) ||
    !finite(value.facing)
  ) {
    return undefined;
  }
  return {
    objectId: value.objectId,
    networkEntityId: value.networkEntityId,
    generation: value.generation,
    renderKey: value.renderKey,
    x: value.x,
    y: value.y,
    velocityX: value.velocityX,
    velocityY: value.velocityY,
    facing: value.facing
  };
}

function readKinematicProjectileRecord(
  value: unknown
): CombatKinematicProjectileRecord | undefined {
  if (
    !isRecord(value) ||
    !nonEmptyString(value.projectileId) ||
    !nonEmptyString(value.correlationId) ||
    (!nonEmptyString(value.generation) && !nonNegativeInteger(value.generation)) ||
    !nonEmptyString(value.definitionId) ||
    !nonEmptyString(value.definitionVersion) ||
    !nonNegativeInteger(value.fireTick) ||
    !finite(value.fixedDeltaMs) ||
    value.fixedDeltaMs <= 0 ||
    !requiredVector(value.firePosition) ||
    !requiredVector(value.fireVelocity) ||
    !nonNegativeInteger(value.expiresTick) ||
    value.expiresTick < value.fireTick
  ) {
    return undefined;
  }
  const finish =
    value.finish === undefined ? undefined : readKinematicProjectileFinish(value.finish);
  if (value.finish !== undefined && finish === undefined) {
    return undefined;
  }
  return {
    projectileId: value.projectileId,
    correlationId: value.correlationId,
    generation: value.generation,
    definitionId: value.definitionId,
    definitionVersion: value.definitionVersion,
    fireTick: value.fireTick,
    fixedDeltaMs: value.fixedDeltaMs,
    firePosition: { ...value.firePosition },
    fireVelocity: { ...value.fireVelocity },
    expiresTick: value.expiresTick,
    ...(finish === undefined ? {} : { finish })
  };
}

function readKinematicProjectileFinish(
  value: unknown
): NonNullable<CombatKinematicProjectileRecord["finish"]> | undefined {
  if (
    !isRecord(value) ||
    !nonNegativeInteger(value.tick) ||
    !nonEmptyString(value.reason) ||
    !requiredVector(value.position) ||
    !optionalVector(value.normal)
  ) {
    return undefined;
  }
  const subject = value.subject;
  if (
    subject !== undefined &&
    (!isRecord(subject) ||
      !optionalNonEmptyString(subject.actorId) ||
      (!optionalNonEmptyString(subject.entityId) &&
        !(subject.entityId === undefined || nonNegativeInteger(subject.entityId))) ||
      !optionalNonEmptyString(subject.bodyId) ||
      !optionalNonEmptyString(subject.colliderId))
  ) {
    return undefined;
  }
  return {
    tick: value.tick,
    reason: value.reason,
    position: { ...value.position },
    ...(value.normal === undefined ? {} : { normal: { ...value.normal } }),
    ...(subject === undefined ? {} : { subject: { ...subject } })
  };
}

function readCombatCue(value: unknown): OutpostReplicatedCombatCue | undefined {
  if (
    !isRecord(value) ||
    !positiveInteger(value.sequence) ||
    !isCombatCueKind(value.kind) ||
    !nonNegativeFinite(value.at) ||
    !optionalNonEmptyString(value.correlationId) ||
    !optionalNonEmptyString(value.parentId) ||
    !optionalNonEmptyString(value.sourceObjectId) ||
    !optionalNonEmptyString(value.targetObjectId) ||
    !optionalNonEmptyString(value.projectileId) ||
    !optionalVector(value.position) ||
    !optionalVector(value.normal) ||
    !optionalVector(value.direction) ||
    !optionalNonNegativeFinite(value.amount) ||
    !optionalCombatAbility(value.ability) ||
    !optionalNonEmptyString(value.reason)
  ) {
    return undefined;
  }
  return {
    sequence: value.sequence,
    kind: value.kind,
    at: value.at,
    ...(value.correlationId === undefined ? {} : { correlationId: value.correlationId }),
    ...(value.parentId === undefined ? {} : { parentId: value.parentId }),
    ...(value.sourceObjectId === undefined ? {} : { sourceObjectId: value.sourceObjectId }),
    ...(value.targetObjectId === undefined ? {} : { targetObjectId: value.targetObjectId }),
    ...(value.projectileId === undefined ? {} : { projectileId: value.projectileId }),
    ...(value.position === undefined ? {} : { position: { ...value.position } }),
    ...(value.normal === undefined ? {} : { normal: { ...value.normal } }),
    ...(value.direction === undefined ? {} : { direction: { ...value.direction } }),
    ...(value.amount === undefined ? {} : { amount: value.amount }),
    ...(value.ability === undefined ? {} : { ability: value.ability }),
    ...(value.reason === undefined ? {} : { reason: value.reason })
  };
}

function optionalCombatAbility(value: unknown): value is OutpostReplicatedCombatCue["ability"] {
  return (
    value === undefined ||
    value === "rifle" ||
    value === "dash" ||
    value === "shock-field" ||
    value === "deploy-turret"
  );
}

function cloneAuthoritySnapshot(
  snapshot: OutpostClientAuthoritySnapshot
): OutpostClientAuthoritySnapshot {
  return {
    ...snapshot,
    participants: snapshot.participants.map((participant) => ({ ...participant })),
    players: snapshot.players.map((player) => ({ ...player })),
    combat: {
      ...snapshot.combat,
      actors: snapshot.combat.actors.map((actor) => ({
        ...actor,
        tags: [...actor.tags],
        cooldowns: { ...actor.cooldowns },
        ...(actor.weapon === undefined
          ? {}
          : {
              weapon: {
                ...actor.weapon,
                ...(actor.weapon.lastFeedback === undefined
                  ? {}
                  : { lastFeedback: { ...actor.weapon.lastFeedback } })
              }
            })
      })),
      projectiles: snapshot.combat.projectiles.map((projectile) => ({ ...projectile })),
      projectileRecords: snapshot.combat.projectileRecords.map((record) => ({
        ...record,
        firePosition: { ...record.firePosition },
        fireVelocity: { ...record.fireVelocity },
        ...(record.finish === undefined
          ? {}
          : {
              finish: {
                ...record.finish,
                position: { ...record.finish.position },
                ...(record.finish.normal === undefined
                  ? {}
                  : { normal: { ...record.finish.normal } }),
                ...(record.finish.subject === undefined
                  ? {}
                  : { subject: { ...record.finish.subject } })
              }
            })
      })),
      cues: snapshot.combat.cues.map((cue) => ({
        ...cue,
        ...(cue.position === undefined ? {} : { position: { ...cue.position } }),
        ...(cue.normal === undefined ? {} : { normal: { ...cue.normal } }),
        ...(cue.direction === undefined ? {} : { direction: { ...cue.direction } })
      }))
    },
    inputAcksByPeerId: { ...snapshot.inputAcksByPeerId }
  };
}

function isMatchPhase(value: unknown): value is OutpostClientMatchPhase {
  return value === "lobby" || value === "countdown" || value === "running";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 128;
}

function optionalNonEmptyString(value: unknown): value is string | undefined {
  return value === undefined || nonEmptyString(value);
}

function nonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function positiveInteger(value: unknown): value is number {
  return nonNegativeInteger(value) && value > 0;
}

function nonNegativeFinite(value: unknown): value is number {
  return finite(value) && value >= 0;
}

function optionalNonNegativeFinite(value: unknown): value is number | undefined {
  return value === undefined || nonNegativeFinite(value);
}

function optionalVector(value: unknown): value is { x: number; y: number } | undefined {
  return value === undefined || (isRecord(value) && finite(value.x) && finite(value.y));
}

function requiredVector(value: unknown): value is { x: number; y: number } {
  return isRecord(value) && finite(value.x) && finite(value.y);
}

function isCombatCueKind(value: unknown): value is OutpostReplicatedCombatCue["kind"] {
  return (
    value === "projectile-spawned" ||
    value === "miss" ||
    value === "world-impact" ||
    value === "shield-hit" ||
    value === "health-hit" ||
    value === "kill-confirmed" ||
    value === "action-rejected"
  );
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}
