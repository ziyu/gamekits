import { createStandardMultiplayerPhysicsArenaAuthorityProjection } from "@gamekits/app-host";
import type { CharacterMotorPredictionCommand } from "@gamekits/character-controller";
import {
  createMultiplayerAuthorityBindingStore,
  createMultiplayerAuthorityHostLoop,
  type MultiplayerAuthorityHostLoop,
  type MultiplayerAuthorityLoopDiagnostics,
  type MultiplayerRuntime
} from "@gamekits/multiplayer-core";
import {
  createPhysicsPredictionIsland,
  type PhysicsBackendAdapter,
  type PhysicsPredictionIsland,
  type PhysicsPredictionIslandCommand,
  type PhysicsPredictionIslandContact,
  type PhysicsPredictionIslandMemberDefinition,
  type PhysicsVector
} from "@gamekits/physics-core";

import {
  arenaBotArchetypeForMember,
  createArenaAuthorityPerceptionSource,
  type ArenaAuthorityPerceptionState
} from "../ai/authority-perception";
import { createArenaBotDecisionRuntime, type ArenaBotDecisionSnapshot } from "../ai/decision";
import type { ArenaBotNavigationRuntime, ArenaBotNavigationSnapshot } from "../ai/navigation";
import { ARENA_COMPILED_CONTENT } from "../content/default-content";
import { createArenaMatchDirector, type ArenaMatchDirectorSnapshot } from "../match/match-director";
import { createArenaImpactLedger, type ArenaImpactLedgerDiagnostics } from "../match/impact-ledger";
import {
  createArenaParticipantRegistry,
  type ArenaParticipantRegistry,
  type ArenaParticipantRegistryDiagnostics
} from "../match/participant-registry";
import { createArenaStageRule } from "../match/stage-rule";
import { advanceArenaQualifierProgress } from "../match/qualifier-progress";
import {
  settleArenaStageRanking,
  type ArenaStageRankingFact,
  type ArenaStageSettlement
} from "../match/ranking-policy";
import { resolveArenaQualificationCount } from "../match/qualification-policy";
import { planArenaStageConvergence } from "../match/stage-convergence";
import { readArenaItemAction, type ArenaItemAction } from "../items/item-action";
import {
  ARENA_CHARACTER_MOTOR_CONTRIBUTOR_ID,
  createArenaCharacterIntent,
  createArenaCharacterMotorContributor
} from "../shared/arena-control";
import { arenaGenerationKey, arenaParticipantCommandEpoch } from "../shared/arena-identity";
import { createArenaPhysicsMaterialDefinitions } from "../shared/arena-physics-materials";
import {
  planArenaHazardBodyCommands,
  planArenaStageInstallation,
  sampleArenaStageHazards
} from "../shared/arena-stage-course";
import {
  ARENA_ENVIRONMENT,
  createArenaMemberDefinitions,
  isArenaActor
} from "../shared/arena-definition";
import { resetArenaRoundPhysics, resolveArenaActorAuthorityStep } from "./arena-actor-lifecycle";
import {
  ARENA_DEFINITION_VERSION,
  ARENA_FIXED_STEP_MS,
  ARENA_ACTION_KIND,
  ARENA_INPUT_KIND,
  ARENA_ISLAND_ID,
  ARENA_MAX_HUMANS,
  ARENA_SCHEMA_VERSION,
  ARENA_SNAPSHOT_INTERVAL_TICKS,
  ARENA_SNAPSHOT_KIND,
  arenaPlayerMemberId,
  type ArenaActorControlFrame,
  type ArenaMatchPhase,
  type ArenaMoveInput
} from "../shared/config";
import { readArenaMoveInput, type ArenaSnapshot } from "../shared/protocol";
import {
  createArenaItemAuthorityCoordinator,
  type ArenaCommittedItemCombatAction,
  type ArenaItemAuthorityCoordinatorDiagnostics
} from "./arena-item-authority";
import {
  createArenaCombatAuthorityCoordinator,
  type ArenaCombatAuthorityDiagnostics
} from "./arena-combat-authority";

export type ArenaAuthorityRuntimeSnapshot = {
  phase: ArenaMatchPhase;
  round: number;
  tick: number;
  activePeers: number;
  frameMembers: number;
  input: MultiplayerAuthorityLoopDiagnostics;
  physics: ReturnType<PhysicsPredictionIsland["diagnostics"]>;
  match: ArenaMatchDirectorSnapshot;
  participants: ArenaParticipantRegistryDiagnostics;
  impacts: ArenaImpactLedgerDiagnostics;
  items: ArenaItemAuthorityCoordinatorDiagnostics["runtime"];
  combat: ArenaCombatAuthorityDiagnostics;
  ai: ArenaBotDecisionSnapshot;
  navigation?: ArenaBotNavigationSnapshot | undefined;
  settlement?: ArenaStageSettlement | undefined;
};

export type ArenaAuthorityRuntime = {
  tick(deltaMs?: number): void;
  snapshot(): ArenaAuthorityRuntimeSnapshot;
  latestSnapshot(): ArenaSnapshot;
  retainedState(): ArenaAuthorityRetainedState;
  dispose(): void;
};

export type ArenaAuthorityRetainedState = {
  disposed: boolean;
  participants: number;
  physicsMembers: number;
  physicsHistoryEntries: number;
  physicsCommands: number;
  impactEntries: number;
  impactAttributions: number;
  inputs: number;
  inputAcks: number;
  actorControls: number;
  rankingFacts: number;
  stageEntrants: number;
  stageResults: number;
  latestSnapshots: number;
  itemInstances: number;
  itemCommands: number;
  itemActions: number;
  itemExecutions: number;
  combatHits: number;
  combatKnockbacks: number;
  aiAgents: number;
  aiActiveTasks: number;
  aiMemoryFacts: number;
  aiPendingActions: number;
  navigationPendingRequests: number;
  navigationRetainedRoutes: number;
};

export type CreateArenaAuthorityRuntimeOptions = {
  runtime: MultiplayerRuntime;
  backend: PhysicsBackendAdapter;
  sessionId: string;
  authorityPeerId: string;
  initialStageIndex?: number | undefined;
  navigation?: ArenaBotNavigationRuntime | undefined;
  now?: () => number;
};

const COUNTDOWN_MS = 3_000;
const RESULTS_DURATION_MS = 5_000;

export function createArenaAuthorityRuntime(
  options: CreateArenaAuthorityRuntimeOptions
): ArenaAuthorityRuntime {
  const now = options.now ?? (() => Date.now());
  const content = ARENA_COMPILED_CONTENT;
  const initialStageIndex = options.initialStageIndex ?? 0;
  const definitions = createArenaMemberDefinitions(initialStageIndex);
  const participants = createArenaParticipantRegistry({
    capacity: 64,
    traceCapacity: 256
  });
  installInitialParticipants(participants, definitions);
  const director = createArenaMatchDirector({
    stageRules: content.stages.map((stage) => createArenaStageRule(stage.definition)),
    countdownTicks: Math.ceil(COUNTDOWN_MS / ARENA_FIXED_STEP_MS),
    resultsTicks: Math.ceil(RESULTS_DURATION_MS / ARENA_FIXED_STEP_MS),
    initialStageIndex,
    traceCapacity: 128
  });
  const impactLedger = createArenaImpactLedger({
    entryCapacity: 256,
    attributionCapacity: 64,
    retentionTicks: 600,
    knockoutWindowTicks: 240,
    assistWindowTicks: 360,
    impulseThreshold: 1,
    maxAssists: 3
  });
  const characterMotor = createArenaCharacterMotorContributor();
  const initialGeneration = { match: 1, stage: initialStageIndex + 1, membershipRevision: 1 };
  const itemAuthority = createArenaItemAuthorityCoordinator({
    stages: content.stages,
    participants,
    initialStageInstanceId: director.snapshot().stageInstanceId,
    initialStageIndex,
    initialGeneration,
    initialTick: 0
  });
  const combatAuthority = createArenaCombatAuthorityCoordinator({
    participants,
    impactLedger,
    definitions: itemAuthority.combatDefinitions(),
    fixedDeltaMs: ARENA_FIXED_STEP_MS
  });
  const island = createPhysicsPredictionIsland({
    backend: options.backend,
    generation: arenaGenerationKey(initialGeneration),
    initialMembers: [...definitions, ...itemAuthority.initialMembers()],
    environment: ARENA_ENVIRONMENT,
    fixedDeltaMs: ARENA_FIXED_STEP_MS,
    historyMode: "initial-only",
    maxHistoryTicks: 180,
    maxCheckpointBytes: 8 * 1024 * 1024,
    maxHistoryBytes: 96 * 1024 * 1024,
    maxReplayTicksPerOperation: 120,
    maxMembers: 32,
    maxCommands: 2_048,
    auxiliaryContributors: [characterMotor, itemAuthority.auxiliaryContributor],
    scene: {
      dimension: "3d",
      gravity: { x: 0, y: -18, z: 0 },
      materialDefinitions: createArenaPhysicsMaterialDefinitions({
        content,
        additional: itemAuthority.materialDefinitions()
      })
    }
  });
  const projection = createStandardMultiplayerPhysicsArenaAuthorityProjection({
    maxMembers: 32,
    maxPayloadBytes: 128 * 1024
  });
  const inputsByPeerId = new Map<string, ArenaMoveInput>();
  const inputAcksByPeerId = new Map<string, number>();
  const actorControlsByMemberId = new Map<string, ArenaActorControlFrame>();
  const rankingSpatialFacts = new Map<
    string,
    {
      progress: number;
      progressTick: number;
      centerDistance: number;
      checkpointCount: number;
      checkpointTotal: number;
      normalizedProgress: number;
      finished: boolean;
      objectiveScore: number;
    }
  >();
  let stageEntrantParticipantIds = new Set(
    participants
      .list()
      .filter((participant) => participant.actorMemberId !== undefined)
      .map((participant) => participant.id)
  );
  let membershipRevision = 1;
  let latestSettlement: ArenaStageSettlement | undefined;
  const stageResults: ArenaStageSettlement[] = [];
  let latestPayloadBytes = 0;
  let stageInstallationPending = false;
  let physicsStageStartedAtTick = 0;
  let disposed = false;
  let cachedIslandState: ReturnType<PhysicsPredictionIsland["state"]> | undefined;
  let botPerceptionState = captureBotPerceptionState(0);
  const botPerception = createArenaAuthorityPerceptionSource({
    content,
    state: () => botPerceptionState
  });
  const botDecisions = createArenaBotDecisionRuntime({
    content,
    perception: botPerception,
    ...(options.navigation === undefined ? {} : { navigation: options.navigation.queries })
  });
  const boundBotMemberIds = new Set<string>();
  let botBindingStageInstanceId = "";
  syncBotBindings();
  const binding = createMultiplayerAuthorityBindingStore({
    sessionId: options.sessionId,
    mode: "server-authoritative",
    authorityPeerId: options.authorityPeerId,
    authorityEndpoint: {
      kind: "server",
      id: options.authorityPeerId,
      peerId: options.authorityPeerId
    },
    snapshotVersion: ARENA_SCHEMA_VERSION
  });
  let latest: ArenaSnapshot | undefined;

  const authorityLoop: MultiplayerAuthorityHostLoop = createMultiplayerAuthorityHostLoop<
    ArenaItemAction,
    ArenaMoveInput,
    ArenaSnapshot
  >({
    runtime: options.runtime,
    binding,
    actionKind: ARENA_ACTION_KIND,
    inputKind: ARENA_INPUT_KIND,
    snapshotKind: ARENA_SNAPSHOT_KIND,
    snapshotVersion: ARENA_SCHEMA_VERSION,
    snapshotIntervalTicks: ARENA_SNAPSHOT_INTERVAL_TICKS,
    readAction: readArenaItemAction,
    readInput: readArenaMoveInput,
    inputSequence: (input) => input.sequence,
    inputDelivery: {
      mode: "redundant-bundle",
      maxSources: ARENA_MAX_HUMANS,
      maxBufferedFramesPerSource: 48,
      maxGapTicks: 2,
      gapPolicy: "hold-last"
    },
    maxInputsPerSourcePerTick: 1,
    maxQueuedInputsPerSource: 24,
    maxQueuedInputs: ARENA_MAX_HUMANS * 24,
    maxActionsPerSourcePerTick: 4,
    maxQueuedActionsPerSource: 16,
    maxQueuedActions: ARENA_MAX_HUMANS * 16,
    handleAction({ message, payload }) {
      const participant = participants.byPeerId(message.sourcePeerId);
      if (
        participant === undefined ||
        !participant.connected ||
        participant.actorMemberId === undefined ||
        participant.status !== "active" ||
        payload.authorityEpoch !==
          arenaParticipantCommandEpoch(island.diagnostics().generation, participant.revision) ||
        director.snapshot().phase !== "running"
      ) {
        return {
          allowed: false,
          code: "arena-item-action-unbound",
          reason: "Arena item actions require an active running participant."
        };
      }
      if (itemAuthority.hasAction(payload.commandId)) return { allowed: true };
      if (itemAuthority.pendingActionCount() >= ARENA_MAX_HUMANS * 4) {
        return {
          allowed: false,
          code: "arena-item-action-queue-full",
          reason: "Arena item action queue is full for this tick."
        };
      }
      itemAuthority.queueAction(participant.id, payload);
      return { allowed: true };
    },
    handleInput({ message, payload }) {
      const participant = participants.byPeerId(message.sourcePeerId);
      if (
        participant === undefined ||
        !participant.connected ||
        participant.actorMemberId === undefined ||
        participant.status === "spectator" ||
        participant.status === "next-match" ||
        participant.status === "eliminated" ||
        participant.status === "finished" ||
        participant.status === "qualified" ||
        payload.authorityEpoch !==
          arenaParticipantCommandEpoch(island.diagnostics().generation, participant.revision)
      ) {
        return {
          allowed: false,
          code: "arena-participant-unbound",
          reason: "Arena input requires an active player slot."
        };
      }
      inputsByPeerId.set(message.sourcePeerId, payload);
      inputAcksByPeerId.set(message.sourcePeerId, message.sequence ?? payload.sequence);
      return { allowed: true };
    },
    tick({ tick }) {
      reconcilePeers(tick);
      advanceMatch(tick);
      advancePhysics(tick);
    },
    captureSnapshot() {
      const snapshot = captureSnapshot();
      latest = snapshot;
      return snapshot;
    },
    async publishSnapshot(snapshot, context) {
      await options.runtime.send({
        channel: "reliable",
        kind: ARENA_SNAPSHOT_KIND,
        tick: context.tick,
        schemaVersion: ARENA_SCHEMA_VERSION,
        payload: snapshot
      });
    }
  });

  latest = captureSnapshot();

  return {
    tick(deltaMs = ARENA_FIXED_STEP_MS) {
      if (disposed) return;
      authorityLoop.tick(deltaMs);
    },
    snapshot() {
      const diagnostics = authorityLoop.diagnostics();
      const match = director.snapshot();
      return {
        phase: match.phase,
        round: match.round,
        tick: diagnostics.tick,
        activePeers: participants.connectedBindings().length,
        frameMembers: island.diagnostics().members,
        input: diagnostics,
        physics: island.diagnostics(),
        match,
        participants: participants.diagnostics(),
        impacts: impactLedger.diagnostics(),
        items: itemAuthority.diagnostics().runtime,
        combat: combatAuthority.diagnostics(),
        ai: botDecisions.snapshot(),
        ...(options.navigation === undefined ? {} : { navigation: options.navigation.snapshot() }),
        ...(latestSettlement === undefined ? {} : { settlement: structuredClone(latestSettlement) })
      };
    },
    latestSnapshot() {
      if (latest === undefined) throw new Error("Knockout arena authority is disposed");
      return captureSnapshot();
    },
    retainedState() {
      const physics = island.diagnostics();
      const participantDiagnostics = participants.diagnostics();
      const impacts = impactLedger.diagnostics();
      const ai = botDecisions.snapshot();
      const navigation = options.navigation?.snapshot();
      return {
        disposed,
        participants: participantDiagnostics.participants,
        physicsMembers: physics.members,
        physicsHistoryEntries: physics.historyEntries,
        physicsCommands: physics.commands,
        impactEntries: impacts.entries,
        impactAttributions: impacts.attributions,
        inputs: inputsByPeerId.size,
        inputAcks: inputAcksByPeerId.size,
        actorControls: actorControlsByMemberId.size,
        rankingFacts: rankingSpatialFacts.size,
        stageEntrants: stageEntrantParticipantIds.size,
        stageResults: stageResults.length,
        latestSnapshots: latest === undefined ? 0 : 1,
        itemInstances: itemAuthority.diagnostics().runtime.instances,
        itemCommands: itemAuthority.diagnostics().runtime.commands,
        itemActions:
          itemAuthority.diagnostics().publicActions + itemAuthority.diagnostics().pendingActions,
        itemExecutions: itemAuthority.diagnostics().pendingExecutions,
        combatHits: combatAuthority.diagnostics().hits,
        combatKnockbacks: combatAuthority.diagnostics().pendingKnockbacks,
        aiAgents: ai.agents,
        aiActiveTasks: ai.activeTasks,
        aiMemoryFacts: ai.memoryFacts,
        aiPendingActions: ai.pendingActions,
        navigationPendingRequests: navigation?.pendingRequests ?? 0,
        navigationRetainedRoutes: navigation?.retainedRoutes ?? 0
      };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      authorityLoop.dispose();
      binding.close("Knockout arena authority disposed");
      island.dispose();
      director.dispose();
      participants.dispose();
      impactLedger.dispose();
      itemAuthority.dispose();
      combatAuthority.dispose();
      botDecisions.dispose();
      options.navigation?.dispose();
      boundBotMemberIds.clear();
      inputsByPeerId.clear();
      inputAcksByPeerId.clear();
      actorControlsByMemberId.clear();
      cachedIslandState = undefined;
      rankingSpatialFacts.clear();
      stageEntrantParticipantIds.clear();
      stageResults.length = 0;
      latestSettlement = undefined;
      latest = undefined;
    }
  };

  function reconcilePeers(authorityTick: number): void {
    const peers = options.runtime
      .peers()
      .filter(
        (peer) =>
          peer.id !== options.authorityPeerId &&
          peer.role !== "server" &&
          peer.status === "connected"
      );
    const activeIds = new Set(peers.map((peer) => peer.id));
    for (const binding of participants.connectedBindings()) {
      if (!activeIds.has(binding.peerId)) {
        authorityLoop.releasePeer(binding.peerId);
        participants.disconnectPeer(binding.peerId, authorityTick);
        inputsByPeerId.delete(binding.peerId);
        inputAcksByPeerId.delete(binding.peerId);
      }
    }
    for (const peer of peers) {
      const existing = participants.byPeerId(peer.id);
      if (existing !== undefined) {
        if (!existing.connected) participants.reconnectPeer(peer.id, authorityTick);
        if (existing.actorMemberId !== undefined) {
          if (!inputsByPeerId.has(peer.id)) inputsByPeerId.set(peer.id, neutralInput());
          if (!inputAcksByPeerId.has(peer.id)) inputAcksByPeerId.set(peer.id, 0);
        }
        continue;
      }
      const match = director.snapshot();
      const canClaimInitialSeat =
        match.stageIndex === initialStageIndex &&
        (match.phase === "lobby" || match.phase === "countdown");
      const slot = canClaimInitialSeat
        ? participants
            .list()
            .filter((participant) => participant.kind === "human-slot")
            .find((participant) => participant.peerId === undefined)
        : undefined;
      if (slot !== undefined) {
        const bound = participants.bindPeer(slot.id, peer.id, authorityTick);
        if (bound.status !== "applied" && bound.status !== "unchanged") continue;
        inputsByPeerId.set(peer.id, neutralInput());
        inputAcksByPeerId.set(peer.id, 0);
      } else {
        registerLateSpectator(peer.id, authorityTick);
      }
    }
  }

  function registerLateSpectator(peerId: string, authorityTick: number): void {
    const records = participants.list();
    const participantId = `spectator.${peerId}`;
    const registered = participants.register({
      id: participantId,
      kind: "spectator",
      slot: records.reduce((highest, participant) => Math.max(highest, participant.slot), -1) + 1,
      status: "next-match",
      tick: authorityTick
    });
    if (registered.status !== "applied" && registered.status !== "conflict") return;
    participants.bindPeer(participantId, peerId, authorityTick);
  }

  function advanceMatch(authorityTick: number): void {
    if (director.snapshot().phase === "running") {
      updateRankingSpatialFacts(authorityTick);
      lockFinishedQualifierParticipants(authorityTick);
      detectEliminations(authorityTick);
    }
    const entrantParticipantIds = participants
      .list()
      .filter((participant) => stageEntrantParticipantIds.has(participant.id))
      .map((participant) => participant.id);
    const activeParticipantIds = participants
      .list()
      .filter(
        (participant) =>
          stageEntrantParticipantIds.has(participant.id) &&
          (participant.status === "active" ||
            (participant.status === "disconnected" && participant.resumeStatus === "active"))
      )
      .map((participant) => participant.id);
    const result = director.advance({
      tick: authorityTick,
      connectedHumans: participants
        .list()
        .filter((participant) => participant.kind === "human-slot" && participant.connected).length,
      entrantParticipantIds,
      activeParticipantIds,
      completedParticipantIds: [...rankingSpatialFacts]
        .filter(([, fact]) => fact.finished)
        .map(([participantId]) => participantId)
    });
    for (const action of result.actions) {
      if (action.type === "stage-started") {
        physicsStageStartedAtTick = island.tick();
        activateStageParticipants(authorityTick, action.stageInstanceId);
      } else if (action.type === "stage-completed") {
        settleStageParticipants(authorityTick, action.reason, action.winnerParticipantId);
      } else if (action.type === "stage-prepared") {
        prepareStageParticipants(authorityTick, action.stageInstanceId, action.stageIndex);
      } else {
        participants.resetForMatch(authorityTick);
        membershipRevision += 1;
        stageEntrantParticipantIds = new Set(
          participants
            .list()
            .filter((participant) => participant.actorMemberId !== undefined)
            .map((participant) => participant.id)
        );
        const generation = {
          match: action.round,
          stage: action.stageIndex + 1,
          membershipRevision
        };
        resetArenaRoundPhysics(island, arenaGenerationKey(generation));
        stageInstallationPending = true;
        installStageItems(action.stageIndex, action.stageInstanceId, authorityTick, generation);
        rankingSpatialFacts.clear();
        impactLedger.reset();
        combatAuthority.reset(authorityTick);
        latestSettlement = undefined;
        stageResults.length = 0;
      }
    }
  }

  function lockFinishedQualifierParticipants(authorityTick: number): void {
    const match = director.snapshot();
    if (match.stageKind !== "qualifier") return;
    let membershipChanged = false;
    for (const [participantId, fact] of rankingSpatialFacts) {
      if (!fact.finished) continue;
      const participant = participants.participant(participantId);
      if (participant?.status !== "active") continue;
      const result = participants.transition(participant.id, "qualified", {
        reason: "stage-qualified",
        tick: authorityTick,
        stageInstanceId: match.stageInstanceId
      });
      if (result.status === "applied") membershipChanged = true;
    }
    if (membershipChanged) membershipRevision += 1;
  }

  function activateStageParticipants(authorityTick: number, stageInstanceId: string): void {
    for (const participant of participants.list()) {
      if (participant.actorMemberId === undefined) continue;
      if (participant.status === "lobby") {
        participants.transition(participant.id, "active", {
          reason: "match-started",
          tick: authorityTick,
          stageInstanceId
        });
      } else if (participant.status === "qualified") {
        participants.transition(participant.id, "active", {
          reason: "next-stage",
          tick: authorityTick,
          stageInstanceId
        });
      } else if (
        participant.status === "disconnected" &&
        (participant.resumeStatus === "lobby" || participant.resumeStatus === "qualified")
      ) {
        participants.transition(participant.id, "active", {
          reason: participant.resumeStatus === "qualified" ? "next-stage" : "match-started",
          tick: authorityTick,
          stageInstanceId
        });
        if (participant.peerId !== undefined) {
          participants.disconnectPeer(participant.peerId, authorityTick);
        }
      }
    }
  }

  function prepareStageParticipants(
    authorityTick: number,
    stageInstanceId: string,
    stageIndex: number
  ): void {
    const nextEntrants = new Set<string>();
    for (const participant of participants.list()) {
      if (participant.actorMemberId === undefined) continue;
      const qualified =
        participant.status === "qualified" ||
        (participant.status === "disconnected" && participant.resumeStatus === "qualified");
      if (qualified) {
        nextEntrants.add(participant.id);
        continue;
      }
      if (
        participant.status === "eliminated" ||
        participant.status === "finished" ||
        participant.status === "disconnected"
      ) {
        const wasDisconnected = participant.status === "disconnected";
        participants.transition(participant.id, "spectator", {
          reason: "spectating",
          tick: authorityTick,
          stageInstanceId
        });
        if (wasDisconnected && participant.peerId !== undefined) {
          participants.disconnectPeer(participant.peerId, authorityTick);
        }
      }
    }
    stageEntrantParticipantIds = nextEntrants;
    membershipRevision += 1;
    const generation = {
      match: director.snapshot().round,
      stage: stageIndex + 1,
      membershipRevision
    };
    resetArenaRoundPhysics(island, arenaGenerationKey(generation));
    stageInstallationPending = true;
    installStageItems(stageIndex, stageInstanceId, authorityTick, generation);
    rankingSpatialFacts.clear();
    impactLedger.reset();
    combatAuthority.reset(authorityTick);
    latestSettlement = undefined;
  }

  function installStageItems(
    stageIndex: number,
    stageInstanceId: string,
    authorityTick: number,
    generation: { match: number; stage: number; membershipRevision: number }
  ): void {
    itemAuthority.installStage({
      stageIndex,
      stageInstanceId,
      generation,
      tick: authorityTick
    });
  }

  function settleStageParticipants(
    authorityTick: number,
    completionReason: string,
    winnerParticipantId: string | undefined
  ): void {
    const match = director.snapshot();
    const stage = content.stages[match.stageIndex]!.definition;
    const stageInstanceId = match.stageInstanceId;
    const facts = createRankingFacts(authorityTick);
    const settlement = settleArenaStageRanking({
      stageInstanceId,
      stageKind: stage.kind,
      qualificationCount: resolveArenaQualificationCount(stage.qualificationCount, facts.length),
      completionReason,
      facts
    });
    if (
      winnerParticipantId !== undefined &&
      settlement.winnerParticipantId !== winnerParticipantId
    ) {
      throw new Error("Arena director winner disagrees with deterministic ranking");
    }
    let membershipChanged = false;
    for (const placement of settlement.placements) {
      const participant = participants.participant(placement.participantId);
      if (participant === undefined) continue;
      const to = placement.outcome === "winner" ? "finished" : placement.outcome;
      const result = participants.transition(participant.id, to, {
        reason:
          placement.outcome === "winner"
            ? "stage-finished"
            : placement.outcome === "qualified"
              ? "stage-qualified"
              : "stage-eliminated",
        tick: authorityTick,
        stageInstanceId
      });
      if (result.status === "applied") membershipChanged = true;
    }
    if (membershipChanged) membershipRevision += 1;
    latestSettlement = settlement;
    stageResults.push(settlement);
    while (stageResults.length > content.stages.length) stageResults.shift();
  }

  function createRankingFacts(authorityTick: number): ArenaStageRankingFact[] {
    const attributions = impactLedger.attributions();
    const activeIds = new Set(
      participants
        .list()
        .filter(
          (participant) =>
            participant.status === "active" ||
            (participant.status === "disconnected" && participant.resumeStatus === "active")
        )
        .map((participant) => participant.id)
    );
    return participants
      .list()
      .filter((participant) => stageEntrantParticipantIds.has(participant.id))
      .map((participant) => {
        const spatial = rankingSpatialFacts.get(participant.id) ?? {
          progress: -1_000_000,
          progressTick: authorityTick,
          centerDistance: 1_000_000,
          checkpointCount: 0,
          checkpointTotal: 0,
          normalizedProgress: 0,
          finished: false,
          objectiveScore: 0
        };
        return {
          participantId: participant.id,
          eligible: participant.status !== "eliminated",
          active: activeIds.has(participant.id),
          finished: spatial.finished || participant.status === "finished",
          checkpointCount: spatial.checkpointCount,
          progress: spatial.progress,
          progressTick: spatial.progressTick,
          objectiveScore: spatial.objectiveScore,
          knockoutCredits: attributions.filter(
            (entry) => entry.knockoutParticipantId === participant.id
          ).length,
          assistCredits: attributions.filter((entry) =>
            entry.assistParticipantIds.includes(participant.id)
          ).length,
          instability: 0,
          centerDistance: spatial.centerDistance,
          ...(participant.status === "eliminated"
            ? { eliminationTick: participant.statusChangedAtTick }
            : {})
        };
      });
  }

  function updateRankingSpatialFacts(authorityTick: number): void {
    const match = director.snapshot();
    const course = content.stages[match.stageIndex]!.courseProjection;
    const checkpointVolumes = course.validationProbes
      .flatMap((probe) => (probe.volume?.kind === "checkpoint" ? [probe.volume] : []))
      .sort((left, right) => (left.routeOrder ?? 0) - (right.routeOrder ?? 0));
    const finishVolume = course.validationProbes.find(
      (probe) => probe.volume?.kind === "finish"
    )?.volume;
    const objectiveVolume = course.validationProbes.find(
      (probe) => probe.volume?.kind === "objective"
    )?.volume;
    const boundsCenterX = (course.bounds.min.x + course.bounds.max.x) / 2;
    const boundsCenterZ = ((course.bounds.min.z ?? 0) + (course.bounds.max.z ?? 0)) / 2;
    const startZ = average(course.participantSpawns.map((spawn) => spawn.position.z ?? 0));
    for (const member of readIslandState().members) {
      if (!isArenaActor(member.id)) continue;
      const participant = participants.byActorMemberId(member.id);
      if (participant === undefined) continue;
      const previous = rankingSpatialFacts.get(participant.id);
      const qualifierProgress = advanceArenaQualifierProgress({
        previous:
          previous === undefined
            ? undefined
            : {
                checkpointCount: previous.checkpointCount,
                checkpointTotal: previous.checkpointTotal,
                normalizedProgress: previous.normalizedProgress,
                finished: previous.finished
              },
        position: member.body.position,
        startZ,
        checkpoints: checkpointVolumes,
        finish: finishVolume
      });
      const objectiveScore =
        (previous?.objectiveScore ?? 0) +
        (objectiveVolume !== undefined &&
        pointInside(member.body.position, objectiveVolume) &&
        authorityTick % 30 === 0
          ? 1
          : 0);
      rankingSpatialFacts.set(participant.id, {
        progress: qualifierProgress.checkpointCount * 10 + qualifierProgress.normalizedProgress,
        progressTick: authorityTick,
        centerDistance: Math.hypot(
          member.body.position.x - boundsCenterX,
          (member.body.position.z ?? 0) - boundsCenterZ
        ),
        checkpointCount: qualifierProgress.checkpointCount,
        checkpointTotal: qualifierProgress.checkpointTotal,
        normalizedProgress: qualifierProgress.normalizedProgress,
        finished: qualifierProgress.finished,
        objectiveScore
      });
    }
  }

  function detectEliminations(authorityTick: number): void {
    const match = director.snapshot();
    const stage = content.stages[match.stageIndex]!;
    const killVolumes = stage.course.volumes.filter((volume) => volume.kind === "kill");
    const safeVolume = stage.course.volumes.find((volume) => volume.kind === "safe-zone");
    const actors = readIslandState().members.flatMap((member) => {
      if (!isArenaActor(member.id)) return [];
      const participant = participants.byActorMemberId(member.id);
      if (
        participant === undefined ||
        !stageEntrantParticipantIds.has(participant.id) ||
        participant.status === "eliminated" ||
        participant.status === "spectator" ||
        participant.status === "finished" ||
        participant.status === "qualified"
      ) {
        return [];
      }
      return [{ member, participant }];
    });
    const convergence = planArenaStageConvergence({
      stageKind: stage.definition.kind,
      elapsedTicks: Math.max(0, authorityTick - (match.stageStartedAtTick ?? authorityTick)),
      durationTicks: stage.definition.durationTicks,
      qualificationCount: stage.definition.qualificationCount,
      safeVolume,
      candidates: actors.map(({ member, participant }) => ({
        participantId: participant.id,
        memberId: member.id,
        position: member.body.position
      }))
    });
    const natural = actors
      .filter(({ member }) =>
        killVolumes.some((volume) => pointInside(member.body.position, volume))
      )
      .map(({ participant }) => participant.id);
    const candidateIds = [...new Set([...natural, ...convergence.eliminatedParticipantIds])];
    const minimumSurvivors =
      stage.definition.kind === "final"
        ? 1
        : stage.definition.kind === "brawl"
          ? stage.definition.qualificationCount
          : 0;
    const maximumEliminations = Math.max(0, actors.length - minimumSurvivors);
    let membershipChanged = false;
    for (const participantId of candidateIds.slice(0, maximumEliminations)) {
      const participant = participants.participant(participantId);
      if (participant === undefined) continue;
      const result = participants.transition(participant.id, "eliminated", {
        reason: "stage-eliminated",
        tick: authorityTick,
        stageInstanceId: director.snapshot().stageInstanceId
      });
      if (result.status === "applied") {
        membershipChanged = true;
        impactLedger.attribute({
          eliminationId: `${match.stageInstanceId}:elimination:${participant.id}`,
          targetParticipantId: participant.id,
          tick: authorityTick
        });
      }
    }
    if (membershipChanged) membershipRevision += 1;
  }

  function advancePhysics(authorityTick: number): void {
    combatAuthority.advance(authorityTick);
    syncBotBindings();
    botPerceptionState = captureBotPerceptionState(authorityTick);
    options.navigation?.update(ARENA_FIXED_STEP_MS, authorityTick * ARENA_FIXED_STEP_MS);
    botDecisions.update(ARENA_FIXED_STEP_MS, authorityTick * ARENA_FIXED_STEP_MS);
    queueBotDecisionActions(authorityTick);
    const targetTick = island.tick() + 1;
    const commands: PhysicsPredictionIslandCommand[] = [];
    let commandIndex = 0;
    const nextSequence = () => authorityTick * 64 + commandIndex++;
    const queuePatch = (
      memberId: string,
      patch: Extract<PhysicsPredictionIslandCommand, { type: "patch" }>["patch"]
    ) => {
      commands.push({
        type: "patch",
        tick: targetTick,
        sequence: nextSequence(),
        memberId,
        patch
      });
    };
    const queueDespawn = (memberId: string) => {
      commands.push({
        type: "despawn",
        tick: targetTick,
        sequence: nextSequence(),
        memberId
      });
    };
    const queueCharacterControl = (command: CharacterMotorPredictionCommand) => {
      commands.push({
        type: "auxiliary",
        tick: targetTick,
        sequence: nextSequence(),
        contributorId: ARENA_CHARACTER_MOTOR_CONTRIBUTOR_ID,
        payload: command
      });
    };

    if (stageInstallationPending) {
      const entrantActorIds = participants
        .list()
        .filter(
          (participant) =>
            stageEntrantParticipantIds.has(participant.id) &&
            participant.actorMemberId !== undefined
        )
        .map((participant) => participant.actorMemberId!);
      const installation = planArenaStageInstallation({
        stageIndex: director.snapshot().stageIndex,
        tick: targetTick,
        currentMemberIds: readIslandState().members.map(({ id }) => id),
        entrantActorIds,
        nextSequence
      });
      commands.push(...installation.commands);
      stageInstallationPending = false;
    }

    itemAuthority.advancePhysics({
      authorityTick,
      targetTick,
      island,
      controlsByMemberId: actorControlsByMemberId,
      nextSequence,
      commands
    });
    resolveCommittedItemCombat(itemAuthority.drainCommittedCombatActions(), authorityTick);
    combatAuthority.queuePhysicsCommands({ tick: targetTick, nextSequence, commands });

    actorControlsByMemberId.clear();
    for (let slot = 0; slot < ARENA_MAX_HUMANS; slot += 1) {
      const memberId = arenaPlayerMemberId(slot);
      const participant = participants.byActorMemberId(memberId);
      const peerId = participant?.connected ? participant.peerId : undefined;
      const input = peerId === undefined ? neutralInput() : inputsByPeerId.get(peerId);
      const control = queueActorMotion(
        queueCharacterControl,
        queueDespawn,
        memberId,
        input ?? neutralInput()
      );
      actorControlsByMemberId.set(memberId, control);
      itemAuthority.queueCarryModifier({
        memberId,
        control,
        tick: targetTick,
        nextSequence,
        commands
      });
    }
    for (let slot = 0; slot < 6; slot += 1) {
      const memberId = `bot.${slot}`;
      const control = queueActorMotion(
        queueCharacterControl,
        queueDespawn,
        memberId,
        botDecisions.inputFor(memberId, authorityTick)
      );
      actorControlsByMemberId.set(memberId, control);
      itemAuthority.queueCarryModifier({
        memberId,
        control,
        tick: targetTick,
        nextSequence,
        commands
      });
    }

    const match = director.snapshot();
    const hazardStageStartedAtTick =
      match.stageStartedAtTick === undefined ? targetTick : physicsStageStartedAtTick;
    for (const hazard of sampleArenaStageHazards({
      stageIndex: match.stageIndex,
      tick: targetTick,
      stageStartedAtTick: hazardStageStartedAtTick
    })) {
      queuePatch(hazard.memberId, hazard.patch);
    }
    const pendingDespawnMemberIds = new Set(
      commands.flatMap((command) => (command.type === "despawn" ? [command.memberId] : []))
    );
    for (const hazard of planArenaHazardBodyCommands({
      stageIndex: match.stageIndex,
      tick: targetTick,
      stageStartedAtTick: hazardStageStartedAtTick,
      bodies: readIslandState().members.flatMap(({ id, body }) =>
        pendingDespawnMemberIds.has(id) ? [] : [body]
      )
    })) {
      commands.push({
        type: "body-command",
        tick: targetTick,
        sequence: nextSequence(),
        memberId: hazard.memberId,
        command: hazard.command
      });
    }

    for (const command of commands) island.queue(command);
    const advanced = island.advanceTo(targetTick);
    cachedIslandState = undefined;
    recordAuthorityContacts(advanced.contacts, targetTick);
  }

  function syncBotBindings(): void {
    const match = director.snapshot();
    if (botBindingStageInstanceId === match.stageInstanceId) return;
    options.navigation?.activateStage(match.stageIndex);
    for (const memberId of boundBotMemberIds) {
      botDecisions.unbind(memberId, "arena-stage-changed");
    }
    boundBotMemberIds.clear();
    for (const participant of participants.list()) {
      if (
        participant.kind !== "bot" ||
        participant.actorMemberId === undefined ||
        !stageEntrantParticipantIds.has(participant.id)
      ) {
        continue;
      }
      const archetype = arenaBotArchetypeForMember(
        content,
        match.stageIndex,
        participant.actorMemberId
      );
      botDecisions.bind({
        memberId: participant.actorMemberId,
        participantId: participant.id,
        archetypeId: archetype.id
      });
      boundBotMemberIds.add(participant.actorMemberId);
    }
    botBindingStageInstanceId = match.stageInstanceId;
  }

  function captureBotPerceptionState(authorityTick: number): ArenaAuthorityPerceptionState {
    const match = director.snapshot();
    const state = readIslandState();
    return {
      tick: authorityTick,
      elapsedMs: authorityTick * ARENA_FIXED_STEP_MS,
      stageIndex: match.stageIndex,
      stageStartedAtTick: match.stageStartedAtTick ?? match.startedAtTick,
      participants: participants.list(),
      members: state.members,
      items: itemAuthority.publicItems(state.members),
      combat: combatAuthority.publicActors(),
      impacts: impactLedger.entries(),
      ranking: [...rankingSpatialFacts].map(([participantId, fact]) => ({
        participantId,
        checkpointCount: fact.checkpointCount,
        finished: fact.finished,
        objectiveScore: fact.objectiveScore
      }))
    };
  }

  function queueBotDecisionActions(authorityTick: number): void {
    const actions = botDecisions.drainActions();
    const publicItems = itemAuthority.publicItems(readIslandState().members);
    for (const [index, action] of actions.entries()) {
      const memberId = action.agentId.startsWith("ai.") ? action.agentId.slice(3) : action.agentId;
      const participant = participants.byActorMemberId(memberId);
      if (participant?.status !== "active") continue;
      if (action.type === "interaction" && action.interactionId === "pickup") {
        const item = publicItems.find(({ id }) => id === action.targetId);
        if (item === undefined) continue;
        itemAuthority.queueAction(participant.id, {
          type: "interact",
          commandId: `${director.snapshot().stageInstanceId}:ai:${memberId}:${authorityTick}:${index}`,
          inputSequence: authorityTick,
          aimX: 0,
          aimZ: -1,
          charge: 0,
          targetItemId: item.id,
          targetItemGeneration: item.instanceGeneration
        });
        continue;
      }
      if (action.type !== "action" || action.actionId !== "use") continue;
      const aim = botActionAim(participant.id, action.targetId);
      itemAuthority.queueAction(participant.id, {
        type: "use",
        commandId: `${director.snapshot().stageInstanceId}:ai:${memberId}:${authorityTick}:${index}`,
        inputSequence: authorityTick,
        aimX: aim.x,
        aimZ: aim.z,
        charge: 1
      });
    }
  }

  function botActionAim(sourceParticipantId: string, targetParticipantId?: string | undefined) {
    const source = participants.participant(sourceParticipantId);
    const target =
      targetParticipantId === undefined ? undefined : participants.participant(targetParticipantId);
    const sourceBody =
      source?.actorMemberId === undefined ? undefined : island.body(source.actorMemberId);
    const targetBody =
      target?.actorMemberId === undefined ? undefined : island.body(target.actorMemberId);
    if (sourceBody === undefined || targetBody === undefined) return { x: 0, z: -1 };
    const x = targetBody.position.x - sourceBody.position.x;
    const z = (targetBody.position.z ?? 0) - (sourceBody.position.z ?? 0);
    const length = Math.hypot(x, z);
    return length <= 0.001 ? { x: 0, z: -1 } : { x: x / length, z: z / length };
  }

  function recordAuthorityContacts(
    contacts: readonly PhysicsPredictionIslandContact[],
    currentTick: number
  ): void {
    for (const contact of contacts) {
      if (contact.phase !== "enter") continue;
      resolveItemContactCombat(contact, currentTick);
    }
  }

  function resolveCommittedItemCombat(
    actions: readonly ArenaCommittedItemCombatAction[],
    currentTick: number
  ): void {
    for (const action of actions) {
      if (action.actionMode !== "melee") continue;
      const sourceParticipant = participants.participant(action.sourceParticipantId);
      const sourceBody =
        sourceParticipant?.actorMemberId === undefined
          ? undefined
          : island.body(sourceParticipant.actorMemberId);
      if (sourceBody === undefined) continue;
      const aimLength = Math.hypot(action.aim.x, action.aim.z ?? 0);
      const aimX = aimLength <= 0.0001 ? 0 : action.aim.x / aimLength;
      const aimZ = aimLength <= 0.0001 ? -1 : (action.aim.z ?? 0) / aimLength;
      for (const member of readIslandState().members) {
        if (!isArenaActor(member.id) || member.id === sourceParticipant?.actorMemberId) continue;
        const targetParticipant = participants.byActorMemberId(member.id);
        if (targetParticipant === undefined) continue;
        const dx = member.body.position.x - sourceBody.position.x;
        const dz = (member.body.position.z ?? 0) - (sourceBody.position.z ?? 0);
        const distance = Math.hypot(dx, dz);
        if (distance > action.areaRadius + 0.65) continue;
        if (distance > 0.0001 && (dx * aimX + dz * aimZ) / distance < 0.05) continue;
        combatAuthority.resolve({
          id: `${action.executionId}:hit:${targetParticipant.id}`,
          executionId: action.executionId,
          itemId: action.itemId,
          itemGeneration: action.itemGeneration,
          definitionId: action.definitionId,
          sourceParticipantId: action.sourceParticipantId,
          targetParticipantId: targetParticipant.id,
          tick: currentTick,
          charge: action.charge,
          direction: action.aim
        });
      }
    }
  }

  function resolveItemContactCombat(
    contact: PhysicsPredictionIslandContact,
    currentTick: number
  ): void {
    const pairs = [
      [contact.bodyA, contact.bodyB],
      [contact.bodyB, contact.bodyA]
    ] as const;
    for (const [itemMemberId, targetMemberId] of pairs) {
      if (
        itemMemberId === undefined ||
        targetMemberId === undefined ||
        !isArenaActor(targetMemberId)
      ) {
        continue;
      }
      const profile = itemAuthority.combatProfileForMember(itemMemberId);
      const targetParticipant = participants.byActorMemberId(targetMemberId);
      const itemBody = island.body(itemMemberId);
      if (profile === undefined || targetParticipant === undefined || itemBody === undefined)
        continue;
      const targets =
        profile.actionMode === "throw-area" && profile.areaRadius > 0
          ? readIslandState().members.filter((member) => {
              if (!isArenaActor(member.id)) return false;
              const dx = member.body.position.x - itemBody.position.x;
              const dz = (member.body.position.z ?? 0) - (itemBody.position.z ?? 0);
              return Math.hypot(dx, dz) <= profile.areaRadius;
            })
          : readIslandState().members.filter((member) => member.id === targetMemberId);
      for (const target of targets) {
        const participant = participants.byActorMemberId(target.id);
        if (participant === undefined) continue;
        const dx = target.body.position.x - itemBody.position.x;
        const dz = (target.body.position.z ?? 0) - (itemBody.position.z ?? 0);
        const direction =
          Math.hypot(itemBody.linearVelocity.x, itemBody.linearVelocity.z ?? 0) > 0.1
            ? itemBody.linearVelocity
            : Math.hypot(dx, dz) > 0.0001
              ? { x: dx, y: 0, z: dz }
              : profile.aim;
        combatAuthority.resolve({
          id: `${profile.executionId}:hit:${participant.id}`,
          executionId: profile.executionId,
          itemId: profile.itemId,
          itemGeneration: profile.itemGeneration,
          definitionId: profile.definitionId,
          sourceParticipantId: profile.sourceParticipantId,
          targetParticipantId: participant.id,
          tick: currentTick,
          charge: profile.charge,
          direction
        });
      }
      return;
    }
  }

  function queueActorMotion(
    queueControl: (command: CharacterMotorPredictionCommand) => void,
    queueDespawn: (memberId: string) => void,
    memberId: string,
    input: ArenaMoveInput
  ): ArenaActorControlFrame {
    const body = island.body(memberId);
    const participant = participants.byActorMemberId(memberId);
    const step = resolveArenaActorAuthorityStep({
      phase: director.snapshot().phase,
      removed:
        participant === undefined ||
        !stageEntrantParticipantIds.has(participant.id) ||
        participant.status === "eliminated" ||
        (participant.status === "qualified" &&
          participant.stageInstanceId === director.snapshot().stageInstanceId) ||
        participant.status === "spectator" ||
        participant.status === "next-match",
      input,
      memberAvailable: body !== undefined
    });
    if (step.action.type === "control") {
      const staggerDurationMs =
        participant === undefined
          ? undefined
          : combatAuthority.takeStaggerDurationMs(participant.id);
      queueControl({
        type: "control",
        memberId,
        intent: createArenaCharacterIntent(step.control, step.control.sequence),
        ...(staggerDurationMs === undefined ? {} : { staggerDurationMs })
      });
    } else if (step.action.type === "despawn") {
      queueDespawn(memberId);
      queueControl({ type: "remove", memberId });
    }
    return step.control;
  }

  function captureSnapshot(): ArenaSnapshot {
    const state = readIslandState();
    const match = director.snapshot();
    const winnerId =
      match.winnerParticipantId ??
      (match.phase === "results" && match.stageKind === "final"
        ? latestSettlement?.winnerParticipantId
        : undefined);
    const result = projection.capture({
      islandId: ARENA_ISLAND_ID,
      generation: state.generation,
      tick: state.tick,
      membershipRevision,
      definitionVersion: ARENA_DEFINITION_VERSION,
      members: state.members,
      auxiliary: state.auxiliary
    });
    if (result.status !== "captured") {
      throw new Error(`Arena authority frame projection failed: ${result.status}`);
    }
    latestPayloadBytes = result.payloadBytes;
    const diagnostics = authorityLoop?.diagnostics();
    const qualifierCheckpointTotal =
      match.stageKind === "qualifier"
        ? content.stages[match.stageIndex]!.course.volumes.filter(
            ({ kind }) => kind === "checkpoint"
          ).length
        : 0;
    return {
      schemaVersion: ARENA_SCHEMA_VERSION,
      phase: match.phase,
      round: match.round,
      countdownMs: director.countdownMs(
        ARENA_FIXED_STEP_MS,
        authorityLoop?.diagnostics().tick ?? 0
      ),
      roundTimeMs: director.runningTimeMs(
        ARENA_FIXED_STEP_MS,
        authorityLoop?.diagnostics().tick ?? 0
      ),
      ...(winnerId === undefined ? {} : { winnerId }),
      match: {
        matchId: match.matchId,
        phaseInstanceId: match.phaseInstanceId,
        stageIndex: match.stageIndex,
        stageCount: match.stageCount,
        stageId: match.stageId,
        stageKind: match.stageKind,
        qualificationCount: match.qualificationCount,
        durationTicks: match.durationTicks,
        stageInstanceId: match.stageInstanceId,
        startedAtTick: match.startedAtTick,
        physicsStageStartedAtTick,
        ...(match.stageStartedAtTick === undefined
          ? {}
          : { stageStartedAtTick: match.stageStartedAtTick }),
        ...(match.deadlineTick === undefined ? {} : { deadlineTick: match.deadlineTick }),
        membershipRevision
      },
      participants: participants.list().map((participant) => ({
        id: participant.id,
        kind: participant.kind,
        slot: participant.slot,
        ...(participant.actorMemberId === undefined
          ? {}
          : { actorMemberId: participant.actorMemberId }),
        ...(participant.peerId === undefined ? {} : { peerId: participant.peerId }),
        connected: participant.connected,
        status: participant.status,
        ...(participant.resumeStatus === undefined
          ? {}
          : { resumeStatus: participant.resumeStatus }),
        ...(participant.stageInstanceId === undefined
          ? {}
          : { stageInstanceId: participant.stageInstanceId }),
        revision: participant.revision
      })),
      qualifierProgress:
        match.stageKind === "qualifier"
          ? participants
              .list()
              .filter(
                ({ id, actorMemberId }) =>
                  actorMemberId !== undefined && stageEntrantParticipantIds.has(id)
              )
              .map((participant) => {
                const fact = rankingSpatialFacts.get(participant.id);
                return {
                  participantId: participant.id,
                  checkpointCount: fact?.checkpointCount ?? 0,
                  checkpointTotal: fact?.checkpointTotal ?? qualifierCheckpointTotal,
                  finished: fact?.finished ?? false,
                  normalizedProgress: fact?.normalizedProgress ?? 0,
                  progressTick: fact?.progressTick ?? state.tick
                };
              })
              .sort((left, right) => left.participantId.localeCompare(right.participantId))
          : [],
      stageResults: structuredClone(stageResults),
      items: itemAuthority.publicItems(state.members),
      itemActions: itemAuthority.publicActions(),
      combat: {
        actors: combatAuthority.publicActors(),
        hits: combatAuthority.publicHits()
      },
      frame: result.frame,
      playerIdsByPeerId: Object.fromEntries(
        participants
          .connectedBindings()
          .flatMap((binding) =>
            binding.actorMemberId === undefined ? [] : [[binding.peerId, binding.actorMemberId]]
          )
      ),
      inputAcksByPeerId: Object.fromEntries(inputAcksByPeerId),
      actorControlsByMemberId: Object.fromEntries(
        [...actorControlsByMemberId.entries()].sort(([left], [right]) => left.localeCompare(right))
      ),
      removedMemberIds: definitions.flatMap((definition) => {
        if (!isArenaActor(definition.id)) return [];
        const participant = participants.byActorMemberId(definition.id);
        return participant === undefined ||
          !stageEntrantParticipantIds.has(participant.id) ||
          participant.status === "eliminated" ||
          (participant.status === "qualified" &&
            participant.stageInstanceId === match.stageInstanceId) ||
          participant.status === "spectator"
          ? [definition.id]
          : [];
      }),
      serverTime: now(),
      authority: {
        receivedInputBundles: diagnostics?.receivedInputs ?? 0,
        acceptedInputs: diagnostics?.acceptedInputs ?? 0,
        rejectedInputs: diagnostics?.rejectedInputs ?? 0,
        queuedInputs: diagnostics?.queuedInputs ?? 0,
        payloadBytes: latestPayloadBytes,
        activePeers: participants.connectedBindings().length
      }
    };
  }

  function readIslandState(): ReturnType<PhysicsPredictionIsland["state"]> {
    const diagnostics = island.diagnostics();
    if (
      cachedIslandState === undefined ||
      cachedIslandState.tick !== diagnostics.tick ||
      cachedIslandState.generation !== diagnostics.generation
    ) {
      cachedIslandState = island.state();
    }
    return cachedIslandState;
  }
}

function installInitialParticipants(
  registry: ArenaParticipantRegistry,
  definitions: readonly PhysicsPredictionIslandMemberDefinition[]
): void {
  const actors = definitions.filter((definition) => isArenaActor(definition.id));
  for (const [slot, actor] of actors.entries()) {
    const result = registry.register({
      id: actor.id,
      kind: actor.id.startsWith("player.") ? "human-slot" : "bot",
      slot,
      actorMemberId: actor.id,
      tick: 0
    });
    if (result.status !== "applied") {
      throw new Error(`Arena participant registration failed: ${actor.id}:${result.status}`);
    }
  }
}

function neutralInput(): ArenaMoveInput {
  return { sequence: 0, moveX: 0, moveZ: 0, jump: false };
}

export function arenaMemberDefinitionsById(
  definitions: readonly PhysicsPredictionIslandMemberDefinition[] = createArenaMemberDefinitions()
): ReadonlyMap<string, PhysicsPredictionIslandMemberDefinition> {
  return new Map(definitions.map((definition) => [definition.id, definition]));
}

export function arenaVector(x: number, y: number, z: number): PhysicsVector {
  return { x, y, z };
}

function pointInside(
  point: PhysicsVector,
  volume: {
    position: PhysicsVector;
    size: { width: number; height: number; depth: number };
  }
): boolean {
  return (
    Math.abs(point.x - volume.position.x) <= volume.size.width / 2 &&
    Math.abs(point.y - volume.position.y) <= volume.size.height / 2 &&
    Math.abs((point.z ?? 0) - (volume.position.z ?? 0)) <= volume.size.depth / 2
  );
}

function average(values: readonly number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
}
