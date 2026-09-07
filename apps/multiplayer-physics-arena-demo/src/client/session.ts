import { createStandardMultiplayerPhysicsArenaPrediction } from "@gamekits/app-host";
import { createEventBus } from "@gamekits/event-bus";
import { createGame, type GameInstallContext, type GameRuntime } from "@gamekits/game-runtime";
import { createColyseusMultiplayerBackend } from "@gamekits/multiplayer-colyseus";
import {
  createMultiplayerAuthorityBindingStore,
  createMultiplayerModule,
  createMultiplayerRuntime,
  defineMultiplayerReplicationSchema,
  type MultiplayerClientReplicationView,
  type MultiplayerRuntime
} from "@gamekits/multiplayer-core";
import type {
  PhysicsBackendAdapter,
  PhysicsBodyState,
  PhysicsPredictionIslandStateSnapshot
} from "@gamekits/physics-core";
import { createKootaWorld } from "@gamekits/world-koota";

import { ARENA_COMPILED_CONTENT } from "../content/default-content";
import { type ArenaItemActionType } from "../items/item-action";
import {
  createArenaItemCarryContributor,
  createArenaItemCarryPredictionCommand
} from "../items/item-carry-contributor";
import { compileArenaItemCatalog } from "../items/item-definition";
import { selectArenaItemTarget } from "../items/item-interaction";
import {
  createArenaItemReleaseMember,
  createArenaItemPhysicsMaterial,
  createArenaItemPhysicsMember
} from "../items/item-physics";
import { ARENA_ENVIRONMENT, createArenaDefinitionMap } from "../shared/arena-definition";
import { arenaParticipantCommandEpoch } from "../shared/arena-identity";
import { createArenaPhysicsMaterialDefinitions } from "../shared/arena-physics-materials";
import {
  ARENA_CHARACTER_MOTOR_CONTRIBUTOR_ID,
  createArenaCharacterControlCommands,
  createArenaCharacterMotorContributor
} from "../shared/arena-control";
import {
  createArenaClientEffectController,
  type ArenaEffectPresentationEvent
} from "./arena-effects";
import { selectArenaPredictionActorControls } from "./arena-prediction-controls";
import {
  createArenaPresentationRuntime,
  type ArenaPresentationSnapshot
} from "./arena-presentation";
import {
  ARENA_BROWSER_CONFIG_PATH,
  ARENA_ACTION_KIND,
  ARENA_DEFINITION_VERSION,
  ARENA_FIXED_STEP_MS,
  ARENA_INPUT_KIND,
  ARENA_SCHEMA_VERSION,
  ARENA_SNAPSHOT_KIND,
  arenaAuthorityPeerId
} from "../shared/config";
import { readArenaSnapshot, type ArenaSnapshot } from "../shared/protocol";
import {
  ARENA_RANDOM_STAGE_SELECTION,
  ARENA_STAGE_SELECTION_METADATA_KEY,
  type ArenaStageSelection
} from "../shared/arena-stage-selection";
import { planArenaHazardBodyCommands, sampleArenaStageHazards } from "../shared/arena-stage-course";

export type ArenaClientInput = {
  moveX: number;
  moveZ: number;
  jump: boolean;
};

type ArenaControlState = { sequence: number };

export type ArenaServerConfig = { endpoint: string; roomName: string };
export type ArenaSessionIntent = "create" | "join";

export type ArenaClientSession = {
  peerId: string;
  runtime: MultiplayerRuntime;
  tick(deltaMs: number): void;
  snapshot(): ArenaSnapshot | undefined;
  predictedState(): PhysicsPredictionIslandStateSnapshot | undefined;
  presentation(): ArenaPresentationSnapshot;
  localMemberId(): string | undefined;
  telemetry(): Record<string, unknown>;
  itemAction(type: ArenaItemActionType): Promise<void>;
  dispose(): Promise<void>;
};

export async function loadArenaServerConfig(
  fetcher: typeof fetch = fetch
): Promise<ArenaServerConfig> {
  const response = await fetcher(ARENA_BROWSER_CONFIG_PATH, {
    headers: { accept: "application/json" }
  });
  if (!response.ok) {
    throw new Error(`Knockout authority is unavailable (${response.status}).`);
  }
  const payload: unknown = await response.json();
  if (
    !isRecord(payload) ||
    typeof payload.endpoint !== "string" ||
    typeof payload.roomName !== "string"
  ) {
    throw new Error("Knockout authority returned invalid browser configuration.");
  }
  return { endpoint: payload.endpoint, roomName: payload.roomName };
}

export async function createArenaClientSession(options: {
  config: ArenaServerConfig;
  sessionId: string;
  displayName: string;
  intent: ArenaSessionIntent;
  stageSelection?: ArenaStageSelection | undefined;
  physicsBackend: PhysicsBackendAdapter;
  readInput(): ArenaClientInput;
  onEffect?(event: ArenaEffectPresentationEvent): void;
}): Promise<ArenaClientSession> {
  const peerId = createPeerId();
  const backend = createColyseusMultiplayerBackend({
    id: `knockout.browser.colyseus.${peerId}`,
    endpoint: options.config.endpoint,
    roomName: options.config.roomName,
    joinByIdFallback: true
  });
  const runtime = createMultiplayerRuntime({
    id: `knockout.browser.${peerId}`,
    backend,
    connectContext: {
      localPeer: {
        id: peerId,
        playerId: `participant.${peerId}`,
        displayName: normalizeName(options.displayName),
        role: "client"
      }
    }
  });
  const localPeer = {
    id: peerId,
    playerId: `participant.${peerId}`,
    displayName: normalizeName(options.displayName),
    role: options.intent === "create" ? "host" : "client"
  };
  if (options.intent === "create") {
    await runtime.createSession({
      id: normalizeSessionId(options.sessionId),
      kind: "private",
      authority: "server-authoritative",
      localPeer,
      metadata: {
        [ARENA_STAGE_SELECTION_METADATA_KEY]: options.stageSelection ?? ARENA_RANDOM_STAGE_SELECTION
      }
    });
  } else {
    await runtime.joinSession({
      sessionId: normalizeSessionId(options.sessionId),
      localPeer
    });
  }

  const sessionId = runtime.session()?.id ?? normalizeSessionId(options.sessionId);
  const authorityPeerId = arenaAuthorityPeerId(sessionId);
  const binding = createMultiplayerAuthorityBindingStore({
    sessionId,
    mode: "server-authoritative",
    authorityPeerId,
    authorityEndpoint: { kind: "server", id: authorityPeerId, peerId: authorityPeerId },
    snapshotVersion: ARENA_SCHEMA_VERSION,
    localPlayerId: peerId
  });
  const definitions = createArenaDefinitionMap();
  const itemCatalog = compileArenaItemCatalog(ARENA_COMPILED_CONTENT.stages);
  const itemDefinitionsById = new Map(
    itemCatalog.definitions.map((definition) => [definition.id, definition])
  );
  let latestSnapshot: ArenaSnapshot | undefined;
  let replication: MultiplayerClientReplicationView<ArenaSnapshot, ArenaControlState> | undefined;
  const presentation = createArenaPresentationRuntime();
  const effects = createArenaClientEffectController(1, (event) => {
    presentation.effect(event);
    options.onEffect?.(event);
  });

  let readPredictedBody: (memberId: string) => PhysicsBodyState | undefined = () => undefined;
  let latestInput: ArenaClientInput = { moveX: 0, moveZ: -1, jump: false };
  let latestInputSequence = 0;
  let itemActionSequence = 0;
  const arena = createStandardMultiplayerPhysicsArenaPrediction<
    GameInstallContext,
    ArenaSnapshot,
    ArenaClientInput,
    ArenaControlState
  >({
    id: "knockout.client.full-arena",
    maxCommandsPerInput: 16,
    island: {
      backend: options.physicsBackend,
      environment: ARENA_ENVIRONMENT,
      fixedDeltaMs: ARENA_FIXED_STEP_MS,
      maxHistoryTicks: 180,
      maxCheckpointBytes: 8 * 1024 * 1024,
      maxHistoryBytes: 96 * 1024 * 1024,
      maxReplayTicksPerOperation: 120,
      maxMembers: 32,
      maxCommands: 4_096,
      scene: {
        dimension: "3d",
        gravity: { x: 0, y: -18, z: 0 },
        materialDefinitions: createArenaPhysicsMaterialDefinitions({
          content: ARENA_COMPILED_CONTENT,
          additional: itemCatalog.definitions.map(createArenaItemPhysicsMaterial)
        })
      }
    },
    createAuxiliaryContributors() {
      return [createArenaCharacterMotorContributor(), createArenaItemCarryContributor()];
    },
    selectFrame({ snapshot }) {
      return {
        ...snapshot.frame,
        acknowledgedInputSequence: snapshot.inputAcksByPeerId[peerId] ?? 0
      };
    },
    resolveMemberDefinition(member, _frame, snapshot) {
      const fixed = definitions.get(member.id);
      if (fixed !== undefined) return fixed;
      const item = snapshot.items.find((candidate) => candidate.bodyMemberId === member.id);
      if (item === undefined) return undefined;
      const definition = itemDefinitionsById.get(item.definitionId);
      if (definition === undefined) return undefined;
      return createArenaItemPhysicsMember({
        definition,
        item: { id: item.id, instanceGeneration: item.instanceGeneration },
        position: member.body.position,
        linearVelocity: member.body.linearVelocity
      });
    },
    resolveAuthoritySpawn(member, _frame, snapshot) {
      const item = snapshot.items.find((candidate) => candidate.bodyMemberId === member.id);
      if (item === undefined) return { correlationId: member.id };
      const action = snapshot.itemActions.find(
        (candidate) =>
          candidate.status === "confirmed" &&
          candidate.itemId === item.id &&
          candidate.itemGeneration === item.instanceGeneration
      );
      return {
        correlationId: action?.executionId ?? action?.id ?? member.id,
        tick: action?.tick ?? snapshot.frame.tick
      };
    },
    mapInput({ input, snapshot, predictionFrame, predictionTick }) {
      const memberId = snapshot.playerIdsByPeerId[peerId];
      const body = memberId === undefined ? undefined : readPredictedBody(memberId);
      const canJump = input.jump && Math.abs(body?.linearVelocity.y ?? 1) < 0.35;
      if (memberId !== undefined && canJump) {
        effects.anticipateJump({
          memberId,
          inputSequence: predictionFrame.sequence,
          predictionTick
        });
      }
      const controlsByMemberId = selectArenaPredictionActorControls({
        authorityControls: snapshot.actorControlsByMemberId,
        liveMemberIds: new Set(snapshot.frame.members.map((candidate) => candidate.id)),
        removedMemberIds: snapshot.removedMemberIds,
        playerIdsByPeerId: snapshot.playerIdsByPeerId,
        peerId,
        localInput: input,
        inputSequence: predictionFrame.sequence
      });
      return [
        ...createArenaCharacterControlCommands(controlsByMemberId).map(({ command }) => ({
          type: "auxiliary" as const,
          contributorId: ARENA_CHARACTER_MOTOR_CONTRIBUTOR_ID,
          payload: command
        })),
        ...snapshot.items.flatMap((item) => {
          if (
            item.ownerParticipantId === undefined ||
            (item.state !== "carried" && item.state !== "windup")
          ) {
            return [];
          }
          const participant = snapshot.participants.find(
            (candidate) => candidate.id === item.ownerParticipantId
          );
          const control =
            participant?.actorMemberId === undefined
              ? undefined
              : controlsByMemberId[participant.actorMemberId];
          const definition = itemDefinitionsById.get(item.definitionId);
          if (
            participant?.actorMemberId === undefined ||
            control === undefined ||
            definition === undefined
          ) {
            return [];
          }
          return [
            createArenaItemCarryPredictionCommand({
              memberId: participant.actorMemberId,
              speedMultiplier: definition.carrySpeedMultiplier,
              jumpMultiplier: definition.carryJumpMultiplier,
              jumpPressed: control.jump
            })
          ];
        }),
        ...sampleArenaStageHazards({
          stageIndex: snapshot.match.stageIndex,
          tick: predictionTick,
          stageStartedAtTick:
            snapshot.match.stageStartedAtTick === undefined
              ? predictionTick
              : snapshot.match.physicsStageStartedAtTick
        }).map((hazard) => ({
          type: "patch" as const,
          memberId: hazard.memberId,
          patch: hazard.patch
        })),
        ...planArenaHazardBodyCommands({
          stageIndex: snapshot.match.stageIndex,
          tick: predictionTick,
          stageStartedAtTick:
            snapshot.match.stageStartedAtTick === undefined
              ? predictionTick
              : snapshot.match.physicsStageStartedAtTick,
          bodies: snapshot.frame.members.map(({ body }) => body)
        }).map((hazard) => ({
          type: "body-command" as const,
          memberId: hazard.memberId,
          command: hazard.command
        }))
      ];
    },
    onContacts(contacts) {
      effects.anticipateItemContacts(contacts, latestSnapshot, peerId);
    }
  });
  readPredictedBody = (memberId) => arena.body(memberId);

  const schema = defineMultiplayerReplicationSchema<ArenaSnapshot, string, ArenaSnapshot>({
    id: "knockout.arena",
    version: ARENA_SCHEMA_VERSION,
    decode: readArenaSnapshot,
    tick: (snapshot) => snapshot.frame.tick,
    time: (snapshot) => snapshot.frame.tick * ARENA_FIXED_STEP_MS,
    serverTime: (snapshot) => snapshot.serverTime,
    snapshotVersion: () => ARENA_DEFINITION_VERSION,
    local: {
      select: (snapshot) => snapshot,
      acknowledgedSequence: (snapshot, identity) => snapshot.inputAcksByPeerId[identity] ?? 0
    }
  }).bindClient<ArenaControlState, GameInstallContext>({
    identity: () => peerId,
    state: (snapshot) => ({ sequence: snapshot.inputAcksByPeerId[peerId] ?? 0 })
  });

  const module = createMultiplayerModule<
    GameInstallContext,
    ArenaSnapshot,
    ArenaClientInput,
    ArenaControlState
  >({
    id: "knockout.client.multiplayer",
    runtime,
    clientPredictionDomains: [arena.descriptor],
    clientReplication: {
      id: "knockout.client.replication",
      snapshotKind: ARENA_SNAPSHOT_KIND,
      authority: { binding },
      schema,
      playback: {
        interpolationDelayMs: 50,
        maxSnapshots: 24,
        timeSource: "tick",
        readTime: (entry) =>
          entry.tick === undefined ? undefined : entry.tick * ARENA_FIXED_STEP_MS,
        shouldReset(previous, next) {
          return (
            previous !== undefined &&
            (next.frame.generation !== previous.frame.generation ||
              next.frame.tick < previous.frame.tick)
          );
        }
      },
      applyAuthoritative({ snapshot }) {
        latestSnapshot = snapshot;
        effects.reconcile(snapshot, peerId);
      },
      prediction: {
        inputKind: ARENA_INPUT_KIND,
        inputRateHz: 60,
        maxCatchUpSteps: 3,
        maxInFlightSends: 6,
        maxPredictionLeadInputs: 12,
        inputDelivery: { mode: "redundant-bundle", maxFramesPerBundle: 6 },
        buffer: {
          cloneState: (state) => ({ ...state }),
          applyInput(state, _input, context) {
            state.sequence = context.sequence;
            return state;
          },
          maxInputs: 24,
          predictionStepMs: ARENA_FIXED_STEP_MS
        },
        readInput() {
          latestInput = options.readInput();
          return latestInput;
        },
        encodeInput({ input, predictionFrame }) {
          latestInputSequence = predictionFrame.sequence;
          const participant = latestSnapshot?.participants.find(
            (candidate) => candidate.peerId === peerId
          );
          const authorityEpoch =
            latestSnapshot === undefined || participant === undefined
              ? undefined
              : arenaParticipantCommandEpoch(latestSnapshot.frame.generation, participant.revision);
          return {
            sequence: predictionFrame.sequence,
            ...input,
            ...(authorityEpoch === undefined ? {} : { authorityEpoch })
          };
        },
        active({ snapshot }) {
          const participant = snapshot.participants.find(
            (candidate) => candidate.peerId === peerId
          );
          return snapshot.phase === "running" && participant?.status === "active";
        }
      },
      applyFrame({ snapshot }) {
        latestSnapshot = snapshot;
      },
      expose(view) {
        replication = view;
      }
    }
  });
  const game: GameRuntime = createGame({
    seed: `knockout.client.${peerId}`,
    world: createKootaWorld(),
    eventBus: createEventBus(),
    modules: [module]
  });
  game.start();

  return {
    peerId,
    runtime,
    tick(deltaMs) {
      game.tick(deltaMs);
      presentation.sync({
        snapshot: latestSnapshot,
        predictedState: arena.state(),
        localMemberId: resolveLocalMemberId(latestSnapshot, peerId),
        deltaMs
      });
    },
    snapshot() {
      return latestSnapshot;
    },
    predictedState() {
      return arena.state();
    },
    presentation() {
      return presentation.snapshot();
    },
    localMemberId() {
      return resolveLocalMemberId(latestSnapshot, peerId);
    },
    telemetry() {
      const replicationDiagnostics = replication?.diagnostics();
      const arenaDiagnostics = arena.diagnostics();
      return {
        peer: peerId,
        authorityTick: latestSnapshot?.frame.tick ?? 0,
        localMember: latestSnapshot?.playerIdsByPeerId[peerId] ?? "spectator",
        phase: latestSnapshot?.phase ?? "awaiting",
        authority: latestSnapshot?.authority,
        replication: replicationDiagnostics
          ? {
              received: replicationDiagnostics.receivedSnapshots,
              applied: replicationDiagnostics.appliedSnapshots,
              bundles: replicationDiagnostics.sentInputBundles,
              redundantFrames: replicationDiagnostics.redundantInputFrames,
              pendingInputs: replicationDiagnostics.pendingEncodedInputs,
              corrections: replicationDiagnostics.prediction?.corrections ?? 0
            }
          : undefined,
        island: {
          status: arenaDiagnostics.status,
          baselineInstalls: arenaDiagnostics.baselineInstalls,
          reconciliations: arenaDiagnostics.reconciliations,
          hardCorrections: arenaDiagnostics.lastReconciliation?.hardCorrection?.status,
          resimulatedTicks: arenaDiagnostics.island?.resimulatedTicks ?? 0,
          historyBytes: arenaDiagnostics.island?.historyBytes ?? 0,
          maxCheckpointBytes: arenaDiagnostics.island?.maxCheckpointBytesObserved ?? 0,
          replayBudgetOverflows: arenaDiagnostics.island?.replayBudgetOverflows ?? 0,
          predictedItemMembers: arenaDiagnostics.predictedMemberRegistrations,
          predictedItemMemberFailures: arenaDiagnostics.predictedMemberRegistrationFailures,
          baseline: arenaDiagnostics.lastBaselineResult
        },
        effects: effects.diagnostics(),
        presentation: presentation.diagnostics()
      };
    },
    async itemAction(type) {
      const snapshot = latestSnapshot;
      if (snapshot === undefined) return;
      const participant = snapshot.participants.find((candidate) => candidate.peerId === peerId);
      if (participant?.status !== "active" || participant.actorMemberId === undefined) return;
      const actor = readPredictedBody(participant.actorMemberId);
      const aim = normalizedAim(latestInput);
      const target =
        type !== "interact" || actor === undefined
          ? undefined
          : selectArenaItemTarget(
              snapshot.items.map((item) => {
                const body =
                  item.bodyMemberId === undefined
                    ? undefined
                    : readPredictedBody(item.bodyMemberId);
                const dx = (body?.position.x ?? actor.position.x) - actor.position.x;
                const dz = (body?.position.z ?? actor.position.z ?? 0) - (actor.position.z ?? 0);
                const distance = Math.hypot(dx, dz);
                return {
                  itemId: item.id,
                  itemGeneration: item.instanceGeneration,
                  distance,
                  viewAlignment: distance <= 0.0001 ? 1 : (dx * aim.x + dz * aim.z) / distance,
                  priority: itemDefinitionsById.get(item.definitionId)?.baseImpulse ?? 0,
                  visible: body !== undefined,
                  inRange: distance <= 2.8,
                  state: item.state === "world" ? ("world" as const) : ("unavailable" as const)
                };
              })
            );
      itemActionSequence += 1;
      const commandId = `${peerId}.item.${itemActionSequence}.${type}`;
      const ownedItem = snapshot.items.find(
        (item) =>
          item.ownerParticipantId === participant.id &&
          (item.state === "carried" || item.state === "windup")
      );
      const predictionTick = (arena.state()?.tick ?? snapshot.frame.tick) + 1;
      effects.anticipateItemAction({
        commandId,
        tick: predictionTick,
        ...(target?.itemId === undefined && ownedItem === undefined
          ? {}
          : { itemId: target?.itemId ?? ownedItem?.id })
      });
      if ((type === "use" || type === "drop") && ownedItem !== undefined && actor !== undefined) {
        const definition = itemDefinitionsById.get(ownedItem.definitionId);
        if (definition !== undefined && (type === "drop" || definition.actionMode !== "melee")) {
          const executionId = type === "use" ? `${commandId}:execution` : undefined;
          const itemGeneration = ownedItem.instanceGeneration + 1;
          const member = createArenaItemReleaseMember({
            definition,
            item: {
              id: ownedItem.id,
              instanceGeneration: itemGeneration,
              ...(executionId === undefined ? {} : { executionId })
            },
            position: {
              x: actor.position.x + aim.x * 0.9,
              y: actor.position.y + 0.65,
              z: (actor.position.z ?? 0) + aim.z * 0.9
            },
            aim: { x: aim.x, y: type === "drop" ? 0.05 : 0.12, z: aim.z },
            inheritedVelocity: actor.linearVelocity,
            charge: type === "use" ? 1 : 0,
            mode: type === "drop" ? "drop" : "throw"
          });
          const activeTick =
            predictionTick + (type === "use" ? Math.max(0, definition.windupTicks - 1) : 0);
          arena.registerPredictedMember({
            correlationId: executionId ?? commandId,
            tick: activeTick,
            member
          });
        }
      }
      await runtime.send({
        id: commandId,
        channel: "reliable",
        kind: ARENA_ACTION_KIND,
        targetPeerIds: [authorityPeerId],
        correlationId: commandId,
        payload: {
          type,
          commandId,
          inputSequence: latestInputSequence,
          aimX: aim.x,
          aimZ: aim.z,
          charge: type === "use" ? 1 : 0,
          authorityEpoch: arenaParticipantCommandEpoch(
            snapshot.frame.generation,
            participant.revision
          ),
          ...(target === undefined
            ? {}
            : {
                targetItemId: target.itemId,
                targetItemGeneration: target.itemGeneration
              })
        }
      });
    },
    async dispose() {
      game.dispose();
      effects.dispose();
      presentation.dispose();
      binding.close("Knockout client disposed");
      await runtime.dispose();
    }
  };
}

function resolveLocalMemberId(
  snapshot: ArenaSnapshot | undefined,
  peerId: string
): string | undefined {
  const participant = snapshot?.participants.find((candidate) => candidate.peerId === peerId);
  return participant?.status === "spectator" ||
    participant?.status === "next-match" ||
    participant?.status === "qualified" ||
    participant?.status === "eliminated" ||
    participant?.status === "finished"
    ? undefined
    : participant?.actorMemberId;
}

function normalizedAim(input: ArenaClientInput): { x: number; z: number } {
  const length = Math.hypot(input.moveX, input.moveZ);
  return length <= 0.0001 ? { x: 0, z: -1 } : { x: input.moveX / length, z: input.moveZ / length };
}

export function normalizeSessionId(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
  if (normalized.length < 4) throw new Error("Session code needs at least four characters.");
  return normalized;
}

function normalizeName(value: string): string {
  return value.trim().replace(/\s+/g, " ").slice(0, 18) || "TURBO BEAN";
}

function createPeerId(): string {
  const source = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
  return `bean-${source
    .replace(/[^a-zA-Z0-9]/g, "")
    .slice(0, 8)
    .toLowerCase()}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
