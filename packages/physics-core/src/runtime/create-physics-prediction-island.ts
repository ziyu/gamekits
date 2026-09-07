import { GameError } from "@gamekits/core";
import type {
  PhysicsBackendAdapter,
  PhysicsBodyCommand,
  PhysicsBodyCommandPayload,
  PhysicsBodyCommandResult,
  PhysicsBodyDefinition,
  PhysicsBodyPatch,
  PhysicsBodyState,
  PhysicsColliderDefinition,
  PhysicsContactEvent,
  PhysicsQuery,
  PhysicsQueryOptions,
  PhysicsQueryResult,
  PhysicsRotation,
  PhysicsScene,
  PhysicsSceneCheckpoint,
  PhysicsSceneConfig,
  PhysicsShapeDefinition,
  PhysicsVector
} from "./types";

export type PhysicsPredictionIslandGeneration = string | number;
export type PhysicsPredictionIslandHistoryMode = "rollback" | "initial-only";

export type PhysicsPredictionIslandMemberDefinition = {
  id: string;
  body: PhysicsBodyDefinition & { id: string };
  colliders?: readonly PhysicsColliderDefinition[];
};

export type PhysicsPredictionIslandEnvironment = {
  bodies?: readonly PhysicsBodyDefinition[];
  colliders?: readonly PhysicsColliderDefinition[];
};

export type PhysicsPredictionIslandAuxiliarySimulation = {
  memberIds(): string[];
  body(memberId: string): PhysicsBodyState | undefined;
  query(query: PhysicsQuery): PhysicsQueryResult[];
  updateBody(memberId: string, patch: PhysicsBodyPatch): void;
  applyBodyCommand(memberId: string, command: PhysicsBodyCommandPayload): PhysicsBodyCommandResult;
};

export type PhysicsPredictionIslandAuxiliaryContext = {
  generation: PhysicsPredictionIslandGeneration;
  tick: number;
  fixedDeltaMs: number;
  replay: boolean;
  simulation: PhysicsPredictionIslandAuxiliarySimulation;
};

export type PhysicsPredictionIslandAuxiliaryApplyContext =
  PhysicsPredictionIslandAuxiliaryContext & {
    sequence: number;
  };

export type PhysicsPredictionIslandAuxiliaryState = {
  id: string;
  version: string;
  state: unknown;
};

export type PhysicsPredictionIslandAuxiliaryContributor<
  TCommand = unknown,
  TCheckpoint = unknown,
  TAuthorityState = TCheckpoint
> = {
  id: string;
  version?: string | undefined;
  order?: number | undefined;
  maxCheckpointBytes: number;
  cloneCommand?(command: TCommand): TCommand;
  apply(command: TCommand, context: PhysicsPredictionIslandAuxiliaryApplyContext): void;
  capture(context: PhysicsPredictionIslandAuxiliaryContext): TCheckpoint;
  validate?(checkpoint: TCheckpoint, context: PhysicsPredictionIslandAuxiliaryContext): boolean;
  restore(checkpoint: TCheckpoint, context: PhysicsPredictionIslandAuxiliaryContext): void;
  reconcile?(
    authorityState: TAuthorityState,
    context: PhysicsPredictionIslandAuxiliaryContext
  ): void;
  reset?(context: PhysicsPredictionIslandAuxiliaryContext): void;
  measureBytes(checkpoint: TCheckpoint): number;
  hash(checkpoint: TCheckpoint): string;
  dispose?(): void;
};

export type PhysicsPredictionIslandCommand =
  | {
      type: "spawn";
      tick: number;
      sequence: number;
      member: PhysicsPredictionIslandMemberDefinition;
    }
  | {
      type: "patch";
      tick: number;
      sequence: number;
      memberId: string;
      patch: PhysicsBodyPatch;
    }
  | {
      type: "body-command";
      tick: number;
      sequence: number;
      memberId: string;
      command: PhysicsBodyCommandPayload;
    }
  | {
      type: "auxiliary";
      tick: number;
      sequence: number;
      contributorId: string;
      payload: unknown;
    }
  | {
      type: "despawn";
      tick: number;
      sequence: number;
      memberId: string;
    };

export type PhysicsPredictionIslandMemberState = {
  id: string;
  body: PhysicsBodyState;
};

export type PhysicsPredictionIslandStateSnapshot = {
  generation: PhysicsPredictionIslandGeneration;
  tick: number;
  members: PhysicsPredictionIslandMemberState[];
  auxiliary?: PhysicsPredictionIslandAuxiliaryState[] | undefined;
};

export type PhysicsPredictionIslandContact = PhysicsContactEvent & {
  tick: number;
};

export type PhysicsPredictionIslandAdvanceResult = {
  tick: number;
  steps: number;
  appliedCommands: number;
  contacts: PhysicsPredictionIslandContact[];
};

export type PhysicsPredictionIslandQueueResult = {
  status:
    | "queued"
    | "replayed"
    | "duplicate"
    | "conflict"
    | "history-overflow"
    | "replay-budget"
    | "capacity";
  replayedTicks: number;
  contacts: PhysicsPredictionIslandContact[];
};

export type PhysicsPredictionIslandReconcileResult = {
  status:
    | "confirmed"
    | "corrected"
    | "membership-mismatch"
    | "auxiliary-mismatch"
    | "history-overflow"
    | "replay-budget"
    | "stale-generation";
  correctionMagnitude: number;
  replayedTicks: number;
};

export type PhysicsPredictionIslandHardCorrectResult = {
  status:
    | "corrected"
    | "member-definition-missing"
    | "member-capacity"
    | "checkpoint-budget"
    | "auxiliary-mismatch"
    | "invalid-snapshot";
  correctedMembers: number;
  missingMemberIds: string[];
};

export type PhysicsPredictionIslandDiagnostics = {
  backend: string;
  historyMode: PhysicsPredictionIslandHistoryMode;
  generation: PhysicsPredictionIslandGeneration;
  tick: number;
  members: number;
  historyEntries: number;
  historyBytes: number;
  commands: number;
  spawned: number;
  patched: number;
  bodyCommandsApplied: number;
  bodyCommandsRejected: number;
  auxiliaryCommandsApplied: number;
  auxiliaryCommandsRejected: number;
  despawned: number;
  steps: number;
  checkpointCaptures: number;
  checkpointRestores: number;
  auxiliaryCaptures: number;
  auxiliaryRestores: number;
  auxiliaryReconciliations: number;
  auxiliaryResets: number;
  auxiliaryFailures: number;
  auxiliaryHashMismatches: number;
  auxiliaryContributors: number;
  maxAuxiliaryCheckpointBytesObserved: number;
  resimulations: number;
  resimulatedTicks: number;
  reconciliations: number;
  corrections: number;
  membershipMismatches: number;
  historyOverflows: number;
  duplicateCommands: number;
  conflictingCommands: number;
  rejectedCommands: number;
  maxCorrectionMagnitude: number;
  hardCorrections: number;
  hardCorrectionFailures: number;
  checkpointByteOverflows: number;
  historyByteEvictions: number;
  replayBudgetOverflows: number;
  maxCheckpointBytesObserved: number;
  disposed: boolean;
};

export type CreatePhysicsPredictionIslandOptions = {
  backend: PhysicsBackendAdapter;
  generation: PhysicsPredictionIslandGeneration;
  scene?: PhysicsSceneConfig;
  environment?: PhysicsPredictionIslandEnvironment;
  initialMembers?: readonly PhysicsPredictionIslandMemberDefinition[];
  initialTick?: number;
  fixedDeltaMs?: number;
  maxHistoryTicks?: number;
  historyMode?: PhysicsPredictionIslandHistoryMode;
  maxCheckpointBytes?: number;
  maxHistoryBytes?: number;
  maxReplayTicksPerOperation?: number;
  maxMembers?: number;
  maxCommands?: number;
  auxiliaryContributors?: readonly PhysicsPredictionIslandAuxiliaryContributor[];
  maxAuxiliaryContributors?: number;
};

export type PhysicsPredictionIsland = {
  queue(command: PhysicsPredictionIslandCommand): PhysicsPredictionIslandQueueResult;
  advanceTo(targetTick: number): PhysicsPredictionIslandAdvanceResult;
  reconcile(snapshot: PhysicsPredictionIslandStateSnapshot): PhysicsPredictionIslandReconcileResult;
  hardCorrect(
    snapshot: PhysicsPredictionIslandStateSnapshot,
    definitions?: readonly PhysicsPredictionIslandMemberDefinition[]
  ): PhysicsPredictionIslandHardCorrectResult;
  state(): PhysicsPredictionIslandStateSnapshot;
  body(memberId: string): PhysicsBodyState | undefined;
  tick(): number;
  reset(generation: PhysicsPredictionIslandGeneration, tick?: number): void;
  diagnostics(): PhysicsPredictionIslandDiagnostics;
  dispose(): void;
};

type StoredIslandCheckpoint = {
  tick: number;
  scene: PhysicsSceneCheckpoint;
  members: PhysicsPredictionIslandMemberDefinition[];
  auxiliary: StoredAuxiliaryCheckpoint[];
  byteLength: number;
};

type StoredAuxiliaryCheckpoint = {
  id: string;
  version: string;
  state: unknown;
  byteLength: number;
  hash: string;
};

const DEFAULT_FIXED_DELTA_MS = 1000 / 60;
const DEFAULT_MAX_HISTORY_TICKS = 128;
const DEFAULT_MAX_CHECKPOINT_BYTES = 8 * 1024 * 1024;
const DEFAULT_MAX_HISTORY_BYTES = 64 * 1024 * 1024;
const DEFAULT_MAX_REPLAY_TICKS_PER_OPERATION = 128;
const DEFAULT_MAX_MEMBERS = 64;
const DEFAULT_MAX_COMMANDS = 256;
const DEFAULT_MAX_AUXILIARY_CONTRIBUTORS = 16;

export function createPhysicsPredictionIsland(
  options: CreatePhysicsPredictionIslandOptions
): PhysicsPredictionIsland {
  const capabilities = options.backend.capabilities().checkpoints;
  if (
    capabilities?.captureRestore !== true ||
    capabilities.fullScene !== true ||
    capabilities.deterministicReplay !== true
  ) {
    throw new GameError(
      "physics.prediction_island_checkpoint_unsupported",
      `Physics backend does not support deterministic full-scene checkpoints: ${options.backend.kind}`,
      { backend: options.backend.kind, capabilities }
    );
  }
  const fixedDeltaMs = positiveNumber(options.fixedDeltaMs, DEFAULT_FIXED_DELTA_MS);
  const maxHistoryTicks = positiveInteger(options.maxHistoryTicks, DEFAULT_MAX_HISTORY_TICKS);
  const historyMode = options.historyMode ?? "rollback";
  if (historyMode !== "rollback" && historyMode !== "initial-only") {
    throw new GameError(
      "physics.prediction_island_history_mode_invalid",
      "Physics prediction island history mode is not supported",
      { historyMode }
    );
  }
  const maxCheckpointBytes = positiveInteger(
    options.maxCheckpointBytes,
    DEFAULT_MAX_CHECKPOINT_BYTES
  );
  const maxHistoryBytes = positiveInteger(options.maxHistoryBytes, DEFAULT_MAX_HISTORY_BYTES);
  const maxReplayTicksPerOperation = positiveInteger(
    options.maxReplayTicksPerOperation,
    DEFAULT_MAX_REPLAY_TICKS_PER_OPERATION
  );
  const maxMembers = positiveInteger(options.maxMembers, DEFAULT_MAX_MEMBERS);
  const maxCommands = positiveInteger(options.maxCommands, DEFAULT_MAX_COMMANDS);
  const maxAuxiliaryContributors = positiveInteger(
    options.maxAuxiliaryContributors,
    DEFAULT_MAX_AUXILIARY_CONTRIBUTORS
  );
  const contributors = normalizeAuxiliaryContributors(
    options.auxiliaryContributors,
    maxAuxiliaryContributors
  );
  const contributorById = new Map(contributors.map((contributor) => [contributor.id, contributor]));
  const initialTick = nonNegativeInteger(options.initialTick, 0);
  const scene = options.backend.createScene({
    ...options.scene,
    fixedDeltaMs
  });
  if (scene.captureCheckpoint === undefined || scene.restoreCheckpoint === undefined) {
    scene.dispose();
    throw new GameError(
      "physics.prediction_island_checkpoint_missing",
      `Physics backend advertised checkpoints without scene methods: ${options.backend.kind}`,
      { backend: options.backend.kind }
    );
  }
  const captureScene = scene.captureCheckpoint.bind(scene);
  const restoreScene = scene.restoreCheckpoint.bind(scene);

  const members = new Map<string, PhysicsPredictionIslandMemberDefinition>();
  const history = new Map<number, StoredIslandCheckpoint>();
  const historyOrder: number[] = [];
  const commandsByTick = new Map<number, PhysicsPredictionIslandCommand[]>();
  const commandBySequence = new Map<
    number,
    { command: PhysicsPredictionIslandCommand; signature: string }
  >();
  let generation = options.generation;
  let currentTick = initialTick;
  let commandCount = 0;
  let trimmedCommandsThrough = initialTick - 1;
  let historyBytes = 0;
  let disposed = false;
  let checkpointMembers: PhysicsPredictionIslandMemberDefinition[] | undefined;
  const metrics: Omit<
    PhysicsPredictionIslandDiagnostics,
    | "backend"
    | "historyMode"
    | "generation"
    | "tick"
    | "members"
    | "historyEntries"
    | "historyBytes"
    | "commands"
    | "auxiliaryContributors"
    | "disposed"
  > = {
    spawned: 0,
    patched: 0,
    bodyCommandsApplied: 0,
    bodyCommandsRejected: 0,
    auxiliaryCommandsApplied: 0,
    auxiliaryCommandsRejected: 0,
    despawned: 0,
    steps: 0,
    checkpointCaptures: 0,
    checkpointRestores: 0,
    auxiliaryCaptures: 0,
    auxiliaryRestores: 0,
    auxiliaryReconciliations: 0,
    auxiliaryResets: 0,
    auxiliaryFailures: 0,
    auxiliaryHashMismatches: 0,
    maxAuxiliaryCheckpointBytesObserved: 0,
    resimulations: 0,
    resimulatedTicks: 0,
    reconciliations: 0,
    corrections: 0,
    membershipMismatches: 0,
    historyOverflows: 0,
    duplicateCommands: 0,
    conflictingCommands: 0,
    rejectedCommands: 0,
    maxCorrectionMagnitude: 0,
    hardCorrections: 0,
    hardCorrectionFailures: 0,
    checkpointByteOverflows: 0,
    historyByteEvictions: 0,
    replayBudgetOverflows: 0,
    maxCheckpointBytesObserved: 0
  };

  const simulation: PhysicsPredictionIslandAuxiliarySimulation = {
    memberIds() {
      return [...members.keys()].sort();
    },
    body(memberId) {
      const member = members.get(memberId);
      if (member === undefined) return undefined;
      const body = scene.getBodyState(member.body.id);
      return body === undefined ? undefined : cloneBodyState(body);
    },
    query(query) {
      return scene.query(clonePhysicsQuery(query)).map(clonePhysicsQueryResult);
    },
    updateBody(memberId, patch) {
      const member = requireSimulationMember(memberId);
      scene.updateBody(member.body.id, cloneBodyPatch(patch));
    },
    applyBodyCommand(memberId, command) {
      const member = members.get(memberId);
      if (member === undefined) {
        return {
          status: "body-missing",
          bodyId: memberId,
          commandType: command.type,
          reason: `Missing prediction island member: ${memberId}`
        };
      }
      if (scene.applyBodyCommand === undefined) {
        return {
          status: "unsupported",
          bodyId: member.body.id,
          commandType: command.type,
          reason: `Physics backend does not support body commands: ${options.backend.kind}`
        };
      }
      return scene.applyBodyCommand(materializeBodyCommand(member.body.id, command));
    }
  };

  let initialCheckpoint: StoredIslandCheckpoint;
  try {
    materializeEnvironment(scene, options.environment);
    for (const member of options.initialMembers ?? []) {
      spawnMember(member, false);
    }
    initialCheckpoint = captureCheckpoint(initialTick);
    if (!storeCheckpoint(initialCheckpoint)) {
      throw new GameError(
        "physics.prediction_island_initial_checkpoint_budget",
        "Physics prediction island initial checkpoint exceeds the configured byte budget",
        {
          checkpointBytes: initialCheckpoint.byteLength,
          maxCheckpointBytes,
          maxHistoryBytes
        }
      );
    }
  } catch (error) {
    disposeContributors();
    scene.dispose();
    throw error;
  }

  return {
    queue(command) {
      assertActive();
      validateCommand(command);
      const existing = commandBySequence.get(command.sequence);
      const signature = commandSignature(command);
      if (existing !== undefined) {
        if (existing.signature === signature) {
          metrics.duplicateCommands += 1;
          return { status: "duplicate", replayedTicks: 0, contacts: [] };
        }
        metrics.conflictingCommands += 1;
        return { status: "conflict", replayedTicks: 0, contacts: [] };
      }
      if (commandCount >= maxCommands) {
        metrics.rejectedCommands += 1;
        return { status: "capacity", replayedTicks: 0, contacts: [] };
      }
      if (command.tick <= currentTick && !history.has(command.tick - 1)) {
        metrics.historyOverflows += 1;
        metrics.rejectedCommands += 1;
        return { status: "history-overflow", replayedTicks: 0, contacts: [] };
      }
      const replayTicks = currentTick - command.tick + 1;
      if (command.tick <= currentTick && replayTicks > maxReplayTicksPerOperation) {
        metrics.replayBudgetOverflows += 1;
        metrics.rejectedCommands += 1;
        return { status: "replay-budget", replayedTicks: 0, contacts: [] };
      }
      const stored = cloneCommand(command, contributorById);
      const commands = commandsByTick.get(command.tick) ?? [];
      commands.push(stored);
      commands.sort(compareCommands);
      commandsByTick.set(command.tick, commands);
      commandBySequence.set(command.sequence, { command: stored, signature });
      commandCount += 1;
      if (command.tick > currentTick) {
        return { status: "queued", replayedTicks: 0, contacts: [] };
      }
      const replayed = replayFrom(command.tick);
      return {
        status: "replayed",
        replayedTicks: replayed.steps,
        contacts: replayed.contacts
      };
    },
    advanceTo(targetTick) {
      assertActive();
      return advance(targetTick, false);
    },
    reconcile(snapshot) {
      assertActive();
      if (snapshot.generation !== generation) {
        return { status: "stale-generation", correctionMagnitude: 0, replayedTicks: 0 };
      }
      const checkpoint = history.get(snapshot.tick);
      if (checkpoint === undefined || snapshot.tick > currentTick) {
        metrics.historyOverflows += 1;
        return { status: "history-overflow", correctionMagnitude: 0, replayedTicks: 0 };
      }
      const localMemberIds = checkpoint.members.map((member) => member.id).sort();
      const authorityMemberIds = snapshot.members.map((member) => member.id).sort();
      if (!sameStrings(localMemberIds, authorityMemberIds)) {
        metrics.membershipMismatches += 1;
        return { status: "membership-mismatch", correctionMagnitude: 0, replayedTicks: 0 };
      }
      const authorityAuxiliary = resolveAuthorityAuxiliary(snapshot);
      if (authorityAuxiliary === undefined) {
        metrics.auxiliaryFailures += 1;
        return { status: "auxiliary-mismatch", correctionMagnitude: 0, replayedTicks: 0 };
      }
      const targetTick = currentTick;
      const replayTicks = targetTick - snapshot.tick;
      if (replayTicks > maxReplayTicksPerOperation) {
        metrics.replayBudgetOverflows += 1;
        return { status: "replay-budget", correctionMagnitude: 0, replayedTicks: 0 };
      }
      const currentCheckpoint = history.get(targetTick);
      restoreCheckpoint(checkpoint);
      let correctionMagnitude = 0;
      for (const authorityMember of snapshot.members) {
        const definition = members.get(authorityMember.id);
        if (definition === undefined) {
          metrics.membershipMismatches += 1;
          return { status: "membership-mismatch", correctionMagnitude: 0, replayedTicks: 0 };
        }
        const localBody = scene.getBodyState(definition.body.id);
        if (localBody === undefined) {
          throw missingMemberBody(authorityMember.id, definition.body.id);
        }
        correctionMagnitude = Math.max(
          correctionMagnitude,
          vectorDistance(localBody.position, authorityMember.body.position)
        );
        if (bodyStateRequiresPatch(localBody, authorityMember.body)) {
          scene.updateBody(definition.body.id, bodyStatePatch(authorityMember.body), {
            kinematicTransformMode: "teleport"
          });
        }
      }
      let auxiliaryCorrection = false;
      try {
        auxiliaryCorrection = reconcileAuxiliary(
          authorityAuxiliary,
          checkpoint,
          snapshot.tick,
          false
        );
      } catch {
        metrics.auxiliaryFailures += 1;
        if (currentCheckpoint !== undefined) restoreCheckpoint(currentCheckpoint);
        return { status: "auxiliary-mismatch", correctionMagnitude: 0, replayedTicks: 0 };
      }
      const correctedCheckpoint = captureCheckpoint(snapshot.tick);
      if (!checkpointWithinBudget(correctedCheckpoint)) {
        if (currentCheckpoint !== undefined) {
          restoreCheckpoint(currentCheckpoint);
        }
        metrics.historyOverflows += 1;
        return { status: "history-overflow", correctionMagnitude: 0, replayedTicks: 0 };
      }
      dropHistoryAfter(snapshot.tick - 1);
      storeCheckpoint(correctedCheckpoint);
      metrics.resimulations += 1;
      const replayed = advance(targetTick, true, false);
      metrics.resimulatedTicks += replayed.steps;
      metrics.reconciliations += 1;
      metrics.maxCorrectionMagnitude = Math.max(
        metrics.maxCorrectionMagnitude,
        correctionMagnitude
      );
      if (correctionMagnitude > 0.000_001 || auxiliaryCorrection) {
        metrics.corrections += 1;
      }
      return {
        status: correctionMagnitude > 0.000_001 || auxiliaryCorrection ? "corrected" : "confirmed",
        correctionMagnitude,
        replayedTicks: replayed.steps
      };
    },
    hardCorrect(snapshot, definitions = []) {
      assertActive();
      if (!validStateSnapshot(snapshot)) {
        metrics.hardCorrectionFailures += 1;
        return {
          status: "invalid-snapshot",
          correctedMembers: 0,
          missingMemberIds: []
        };
      }
      if (snapshot.members.length > maxMembers) {
        metrics.hardCorrectionFailures += 1;
        return {
          status: "member-capacity",
          correctedMembers: 0,
          missingMemberIds: []
        };
      }
      const authorityAuxiliary = resolveAuthorityAuxiliary(snapshot);
      if (authorityAuxiliary === undefined) {
        metrics.hardCorrectionFailures += 1;
        metrics.auxiliaryFailures += 1;
        return {
          status: "auxiliary-mismatch",
          correctedMembers: 0,
          missingMemberIds: []
        };
      }
      const availableDefinitions = new Map<string, PhysicsPredictionIslandMemberDefinition>();
      for (const member of initialCheckpoint.members) {
        availableDefinitions.set(member.id, cloneMember(member));
      }
      for (const member of members.values()) {
        availableDefinitions.set(member.id, cloneMember(member));
      }
      for (const member of definitions) {
        const normalized = normalizeMember(member);
        availableDefinitions.set(normalized.id, normalized);
      }
      const missingMemberIds = snapshot.members
        .filter((member) => !availableDefinitions.has(member.id))
        .map((member) => member.id)
        .sort();
      if (missingMemberIds.length > 0) {
        metrics.hardCorrectionFailures += 1;
        return {
          status: "member-definition-missing",
          correctedMembers: 0,
          missingMemberIds
        };
      }

      const previousGeneration = generation;
      const previousCheckpoint = captureCheckpoint(currentTick);
      let nextCheckpoint: StoredIslandCheckpoint;
      try {
        restoreCheckpoint(initialCheckpoint);
        const desiredIds = new Set(snapshot.members.map((member) => member.id));
        for (const [memberId, definition] of members) {
          if (desiredIds.has(memberId)) {
            continue;
          }
          scene.destroyBody(definition.body.id);
          members.delete(memberId);
          checkpointMembers = undefined;
        }
        for (const authorityMember of snapshot.members) {
          let definition = members.get(authorityMember.id);
          if (definition === undefined) {
            definition = availableDefinitions.get(authorityMember.id)!;
            spawnMember(definition, false);
          }
          scene.updateBody(definition.body.id, bodyStatePatch(authorityMember.body), {
            kinematicTransformMode: "teleport"
          });
        }
        generation = snapshot.generation;
        currentTick = snapshot.tick;
        resetAuxiliary(snapshot.tick);
        reconcileAuxiliary(authorityAuxiliary, initialCheckpoint, snapshot.tick, false);
        nextCheckpoint = captureCheckpoint(snapshot.tick);
      } catch {
        generation = previousGeneration;
        restoreCheckpoint(previousCheckpoint);
        metrics.hardCorrectionFailures += 1;
        metrics.auxiliaryFailures += 1;
        return {
          status: "auxiliary-mismatch",
          correctedMembers: 0,
          missingMemberIds: []
        };
      }
      if (!checkpointWithinBudget(nextCheckpoint)) {
        generation = previousGeneration;
        restoreCheckpoint(previousCheckpoint);
        metrics.hardCorrectionFailures += 1;
        return {
          status: "checkpoint-budget",
          correctedMembers: 0,
          missingMemberIds: []
        };
      }
      commandsByTick.clear();
      commandBySequence.clear();
      commandCount = 0;
      trimmedCommandsThrough = snapshot.tick - 1;
      history.clear();
      historyOrder.length = 0;
      historyBytes = 0;
      storeCheckpoint(nextCheckpoint);
      metrics.hardCorrections += 1;
      return {
        status: "corrected",
        correctedMembers: snapshot.members.length,
        missingMemberIds: []
      };
    },
    state() {
      assertActive();
      return capturePublicState();
    },
    body(memberId) {
      assertActive();
      const member = members.get(memberId);
      if (member === undefined) {
        return undefined;
      }
      const body = scene.getBodyState(member.body.id);
      return body === undefined ? undefined : cloneBodyState(body);
    },
    tick() {
      return currentTick;
    },
    reset(nextGeneration, nextTick = initialTick) {
      assertActive();
      if (!Number.isSafeInteger(nextTick) || nextTick < 0) {
        throw new GameError(
          "physics.prediction_island_reset_tick_invalid",
          "Physics prediction island reset tick must be a non-negative safe integer",
          { nextTick }
        );
      }
      generation = nextGeneration;
      restoreCheckpoint(initialCheckpoint);
      currentTick = nextTick;
      resetAuxiliary(nextTick);
      commandsByTick.clear();
      commandBySequence.clear();
      commandCount = 0;
      trimmedCommandsThrough = nextTick - 1;
      history.clear();
      historyOrder.length = 0;
      historyBytes = 0;
      if (!storeCheckpoint(captureCheckpoint(nextTick))) {
        throw new GameError(
          "physics.prediction_island_reset_checkpoint_budget",
          "Physics prediction island reset checkpoint exceeds the configured byte budget",
          { nextTick, maxCheckpointBytes, maxHistoryBytes }
        );
      }
    },
    diagnostics() {
      return {
        backend: options.backend.kind,
        historyMode,
        generation,
        tick: currentTick,
        members: members.size,
        historyEntries: history.size,
        historyBytes,
        commands: commandCount,
        auxiliaryContributors: contributors.length,
        ...metrics,
        disposed
      };
    },
    dispose() {
      if (disposed) {
        return;
      }
      disposed = true;
      members.clear();
      checkpointMembers = undefined;
      history.clear();
      historyOrder.length = 0;
      historyBytes = 0;
      commandsByTick.clear();
      commandBySequence.clear();
      commandCount = 0;
      disposeContributors();
      scene.dispose();
    }
  };

  function advance(
    targetTick: number,
    replay: boolean,
    collectContacts = true
  ): PhysicsPredictionIslandAdvanceResult {
    if (!Number.isSafeInteger(targetTick) || targetTick < currentTick) {
      throw new GameError(
        "physics.prediction_island_invalid_target_tick",
        `Prediction island target tick must be an integer at or after ${currentTick}`,
        { currentTick, targetTick }
      );
    }
    const contacts: PhysicsPredictionIslandContact[] = [];
    let appliedCommands = 0;
    const startedAt = currentTick;
    while (currentTick < targetTick) {
      const nextTick = currentTick + 1;
      for (const command of commandsByTick.get(nextTick) ?? []) {
        applyCommand(command, replay);
        appliedCommands += 1;
      }
      const step = scene.step(fixedDeltaMs, { tick: nextTick });
      if (collectContacts) {
        for (const contact of step.contacts) {
          contacts.push({ ...contact, tick: nextTick });
        }
      }
      currentTick = nextTick;
      metrics.steps += 1;
      if (historyMode === "rollback") {
        storeCheckpoint(captureCheckpoint(currentTick));
      } else {
        trimCommandsThrough(currentTick);
        trimmedCommandsThrough = currentTick;
      }
    }
    return {
      tick: currentTick,
      steps: currentTick - startedAt,
      appliedCommands,
      contacts
    };
  }

  function replayFrom(fromTick: number): PhysicsPredictionIslandAdvanceResult {
    const checkpoint = history.get(fromTick - 1);
    if (checkpoint === undefined) {
      throw new GameError(
        "physics.prediction_island_history_overflow",
        `Missing prediction island checkpoint before tick ${fromTick}`,
        { fromTick, currentTick }
      );
    }
    const targetTick = currentTick;
    if (targetTick - fromTick + 1 > maxReplayTicksPerOperation) {
      throw new GameError(
        "physics.prediction_island_replay_budget",
        "Physics prediction island replay exceeds the configured tick budget",
        { fromTick, targetTick, maxReplayTicksPerOperation }
      );
    }
    restoreCheckpoint(checkpoint);
    dropHistoryAfter(fromTick - 1);
    metrics.resimulations += 1;
    const replayed = advance(targetTick, true);
    metrics.resimulatedTicks += replayed.steps;
    return replayed;
  }

  function applyCommand(command: PhysicsPredictionIslandCommand, replay: boolean): void {
    switch (command.type) {
      case "spawn":
        spawnMember(command.member, true);
        return;
      case "patch": {
        const member = members.get(command.memberId);
        if (member === undefined) {
          throw new GameError(
            "physics.prediction_island_member_missing",
            `Prediction island member is missing: ${command.memberId}`,
            { command, replay }
          );
        }
        scene.updateBody(member.body.id, command.patch);
        metrics.patched += 1;
        return;
      }
      case "body-command": {
        const member = members.get(command.memberId);
        if (member === undefined) {
          metrics.bodyCommandsRejected += 1;
          throw new GameError(
            "physics.prediction_island_member_missing",
            `Prediction island member is missing: ${command.memberId}`,
            { command, replay }
          );
        }
        if (scene.applyBodyCommand === undefined) {
          metrics.bodyCommandsRejected += 1;
          throw new GameError(
            "physics.prediction_island_body_command_unsupported",
            `Physics backend does not support body commands: ${options.backend.kind}`,
            { command, replay, backend: options.backend.kind }
          );
        }
        const result = scene.applyBodyCommand(
          materializeBodyCommand(member.body.id, command.command)
        );
        if (result.status !== "applied") {
          metrics.bodyCommandsRejected += 1;
          throw new GameError(
            "physics.prediction_island_body_command_rejected",
            `Physics prediction island body command was rejected: ${result.status}`,
            { command, replay, result }
          );
        }
        metrics.bodyCommandsApplied += 1;
        return;
      }
      case "auxiliary": {
        const contributor = contributorById.get(command.contributorId);
        if (contributor === undefined) {
          metrics.auxiliaryCommandsRejected += 1;
          metrics.auxiliaryFailures += 1;
          throw new GameError(
            "physics.prediction_island_auxiliary_missing",
            `Prediction island auxiliary contributor is missing: ${command.contributorId}`,
            { command, replay }
          );
        }
        try {
          contributor.apply(
            cloneAuxiliaryCommand(contributor, command.payload),
            auxiliaryContext(command.tick, replay, command.sequence)
          );
        } catch (error) {
          metrics.auxiliaryCommandsRejected += 1;
          metrics.auxiliaryFailures += 1;
          throw new GameError(
            "physics.prediction_island_auxiliary_apply_failed",
            `Prediction island auxiliary contributor failed: ${command.contributorId}`,
            { command, replay, cause: errorMessage(error) }
          );
        }
        metrics.auxiliaryCommandsApplied += 1;
        return;
      }
      case "despawn": {
        const member = members.get(command.memberId);
        if (member === undefined) {
          return;
        }
        scene.destroyBody(member.body.id);
        members.delete(command.memberId);
        checkpointMembers = undefined;
        metrics.despawned += 1;
      }
    }
  }

  function spawnMember(
    member: PhysicsPredictionIslandMemberDefinition,
    countMetric: boolean
  ): void {
    const normalized = normalizeMember(member);
    if (members.has(normalized.id)) {
      throw new GameError(
        "physics.prediction_island_member_duplicate",
        `Duplicate prediction island member: ${normalized.id}`,
        { memberId: normalized.id }
      );
    }
    if (members.size >= maxMembers) {
      throw new GameError(
        "physics.prediction_island_member_capacity",
        `Prediction island member capacity exceeded: ${maxMembers}`,
        { maxMembers, memberId: normalized.id }
      );
    }
    scene.createBody(normalized.body);
    for (const collider of normalized.colliders ?? []) {
      scene.createCollider({ ...collider, bodyId: collider.bodyId ?? normalized.body.id });
    }
    members.set(normalized.id, normalized);
    checkpointMembers = undefined;
    if (countMetric) {
      metrics.spawned += 1;
    }
  }

  function captureCheckpoint(tick: number): StoredIslandCheckpoint {
    const checkpoint = captureScene();
    const auxiliary = captureAuxiliary(tick, false);
    metrics.checkpointCaptures += 1;
    return {
      tick,
      scene: checkpoint,
      members: captureCheckpointMembers(),
      auxiliary,
      byteLength:
        checkpoint.byteLength + auxiliary.reduce((total, entry) => total + entry.byteLength, 0)
    };
  }

  function storeCheckpoint(checkpoint: StoredIslandCheckpoint): boolean {
    if (!checkpointWithinBudget(checkpoint)) {
      return false;
    }
    const previous = history.get(checkpoint.tick);
    if (previous !== undefined) {
      historyBytes -= previous.byteLength;
    }
    if (!history.has(checkpoint.tick)) {
      historyOrder.push(checkpoint.tick);
    }
    history.set(checkpoint.tick, checkpoint);
    historyBytes += checkpoint.byteLength;
    while (historyOrder.length > maxHistoryTicks + 1 || historyBytes > maxHistoryBytes) {
      const evictedForBytes = historyBytes > maxHistoryBytes;
      const expiredTick = historyOrder.shift();
      if (expiredTick !== undefined) {
        const expired = history.get(expiredTick);
        if (expired !== undefined) {
          historyBytes -= expired.byteLength;
          history.delete(expiredTick);
          if (evictedForBytes) {
            metrics.historyByteEvictions += 1;
          }
        }
      }
    }
    const earliestTick = historyOrder[0];
    if (earliestTick !== undefined && earliestTick > trimmedCommandsThrough) {
      trimCommandsThrough(earliestTick);
      trimmedCommandsThrough = earliestTick;
    }
    return history.has(checkpoint.tick);
  }

  function checkpointWithinBudget(checkpoint: StoredIslandCheckpoint): boolean {
    const bytes = checkpoint.byteLength;
    metrics.maxCheckpointBytesObserved = Math.max(metrics.maxCheckpointBytesObserved, bytes);
    if (bytes <= maxCheckpointBytes && bytes <= maxHistoryBytes) {
      return true;
    }
    metrics.checkpointByteOverflows += 1;
    return false;
  }

  function restoreCheckpoint(checkpoint: StoredIslandCheckpoint): void {
    validateAuxiliaryCheckpoint(checkpoint.auxiliary, checkpoint.tick);
    restoreScene(checkpoint.scene);
    metrics.checkpointRestores += 1;
    currentTick = checkpoint.tick;
    members.clear();
    for (const member of checkpoint.members) {
      members.set(member.id, member);
    }
    checkpointMembers = checkpoint.members;
    restoreAuxiliary(checkpoint.auxiliary, checkpoint.tick, false);
  }

  function captureCheckpointMembers(): PhysicsPredictionIslandMemberDefinition[] {
    checkpointMembers ??= [...members.values()]
      .sort((left, right) => left.id.localeCompare(right.id))
      .map(cloneMember);
    return checkpointMembers;
  }

  function dropHistoryAfter(tick: number): void {
    while ((historyOrder.at(-1) ?? tick) > tick) {
      const historyTick = historyOrder.pop()!;
      const checkpoint = history.get(historyTick);
      if (checkpoint !== undefined) {
        historyBytes -= checkpoint.byteLength;
        history.delete(historyTick);
      }
    }
  }

  function trimCommandsThrough(tick: number): void {
    for (const [commandTick, commands] of commandsByTick) {
      if (commandTick > tick) {
        continue;
      }
      commandsByTick.delete(commandTick);
      commandCount -= commands.length;
      for (const command of commands) {
        commandBySequence.delete(command.sequence);
      }
    }
  }

  function capturePublicState(): PhysicsPredictionIslandStateSnapshot {
    const snapshot: PhysicsPredictionIslandStateSnapshot = {
      generation,
      tick: currentTick,
      members: [...members.values()]
        .sort((left, right) => left.id.localeCompare(right.id))
        .map((member) => {
          const body = scene.getBodyState(member.body.id);
          if (body === undefined) {
            throw missingMemberBody(member.id, member.body.id);
          }
          return { id: member.id, body: cloneBodyState(body) };
        })
    };
    if (contributors.length > 0) {
      const auxiliary = history.get(currentTick)?.auxiliary ?? captureAuxiliary(currentTick, false);
      snapshot.auxiliary = auxiliary.map((entry) => ({
        id: entry.id,
        version: entry.version,
        state: structuredClone(entry.state)
      }));
    }
    return snapshot;
  }

  function requireSimulationMember(memberId: string): PhysicsPredictionIslandMemberDefinition {
    const member = members.get(memberId);
    if (member === undefined) {
      throw new GameError(
        "physics.prediction_island_member_missing",
        `Prediction island member is missing: ${memberId}`,
        { memberId }
      );
    }
    return member;
  }

  function auxiliaryContext(tick: number, replay: boolean): PhysicsPredictionIslandAuxiliaryContext;
  function auxiliaryContext(
    tick: number,
    replay: boolean,
    sequence: number
  ): PhysicsPredictionIslandAuxiliaryApplyContext;
  function auxiliaryContext(
    tick: number,
    replay: boolean,
    sequence?: number
  ): PhysicsPredictionIslandAuxiliaryContext | PhysicsPredictionIslandAuxiliaryApplyContext {
    return {
      generation,
      tick,
      fixedDeltaMs,
      replay,
      simulation,
      ...(sequence === undefined ? {} : { sequence })
    };
  }

  function captureAuxiliary(tick: number, replay: boolean): StoredAuxiliaryCheckpoint[] {
    const checkpoints: StoredAuxiliaryCheckpoint[] = [];
    let totalBytes = 0;
    for (const contributor of contributors) {
      try {
        const state = structuredClone(contributor.capture(auxiliaryContext(tick, replay)));
        const byteLength = measuredAuxiliaryBytes(contributor, state);
        const hash = auxiliaryHash(contributor, state);
        if (byteLength > contributor.maxCheckpointBytes) {
          throw new GameError(
            "physics.prediction_island_auxiliary_checkpoint_budget",
            `Auxiliary checkpoint exceeds contributor budget: ${contributor.id}`,
            { contributorId: contributor.id, byteLength, maxBytes: contributor.maxCheckpointBytes }
          );
        }
        checkpoints.push({
          id: contributor.id,
          version: contributor.version ?? "1",
          state,
          byteLength,
          hash
        });
        totalBytes += byteLength;
        metrics.auxiliaryCaptures += 1;
      } catch (error) {
        metrics.auxiliaryFailures += 1;
        throw new GameError(
          "physics.prediction_island_auxiliary_capture_failed",
          `Failed to capture auxiliary contributor: ${contributor.id}`,
          { contributorId: contributor.id, cause: errorMessage(error) }
        );
      }
    }
    metrics.maxAuxiliaryCheckpointBytesObserved = Math.max(
      metrics.maxAuxiliaryCheckpointBytesObserved,
      totalBytes
    );
    return checkpoints;
  }

  function validateAuxiliaryCheckpoint(
    checkpoints: readonly StoredAuxiliaryCheckpoint[],
    tick: number
  ): void {
    if (checkpoints.length !== contributors.length) {
      throw new GameError(
        "physics.prediction_island_auxiliary_checkpoint_mismatch",
        "Auxiliary checkpoint contributor count does not match the island",
        { checkpointContributors: checkpoints.length, contributors: contributors.length }
      );
    }
    for (const [index, contributor] of contributors.entries()) {
      const checkpoint = checkpoints[index];
      if (
        checkpoint === undefined ||
        checkpoint.id !== contributor.id ||
        checkpoint.version !== (contributor.version ?? "1")
      ) {
        throw new GameError(
          "physics.prediction_island_auxiliary_checkpoint_mismatch",
          `Auxiliary checkpoint identity does not match contributor: ${contributor.id}`,
          { contributorId: contributor.id, checkpoint }
        );
      }
      const state = structuredClone(checkpoint.state);
      const byteLength = measuredAuxiliaryBytes(contributor, state);
      if (byteLength !== checkpoint.byteLength || byteLength > contributor.maxCheckpointBytes) {
        throw new GameError(
          "physics.prediction_island_auxiliary_checkpoint_invalid",
          `Auxiliary checkpoint size is invalid: ${contributor.id}`,
          { contributorId: contributor.id, byteLength, checkpointBytes: checkpoint.byteLength }
        );
      }
      const hash = auxiliaryHash(contributor, state);
      if (hash !== checkpoint.hash) {
        metrics.auxiliaryHashMismatches += 1;
        throw new GameError(
          "physics.prediction_island_auxiliary_hash_mismatch",
          `Auxiliary checkpoint hash does not match: ${contributor.id}`,
          { contributorId: contributor.id, expected: checkpoint.hash, actual: hash }
        );
      }
      if (contributor.validate?.(state, auxiliaryContext(tick, false)) === false) {
        throw new GameError(
          "physics.prediction_island_auxiliary_checkpoint_invalid",
          `Auxiliary checkpoint validation failed: ${contributor.id}`,
          { contributorId: contributor.id }
        );
      }
    }
  }

  function restoreAuxiliary(
    checkpoints: readonly StoredAuxiliaryCheckpoint[],
    tick: number,
    replay: boolean
  ): void {
    for (const [index, contributor] of contributors.entries()) {
      const checkpoint = checkpoints[index]!;
      contributor.restore(structuredClone(checkpoint.state), auxiliaryContext(tick, replay));
      metrics.auxiliaryRestores += 1;
    }
  }

  function resolveAuthorityAuxiliary(
    snapshot: PhysicsPredictionIslandStateSnapshot
  ): Map<string, unknown> | undefined {
    const states = snapshot.auxiliary ?? [];
    if (states.length !== contributors.length) return undefined;
    const resolved = new Map<string, unknown>();
    for (const state of states) {
      if (resolved.has(state.id)) return undefined;
      const contributor = contributorById.get(state.id);
      if (contributor === undefined || state.version !== (contributor.version ?? "1")) {
        return undefined;
      }
      try {
        const cloned = structuredClone(state.state);
        if (measuredAuxiliaryBytes(contributor, cloned) > contributor.maxCheckpointBytes) {
          return undefined;
        }
        auxiliaryHash(contributor, cloned);
        if (contributor.validate?.(cloned, auxiliaryContext(snapshot.tick, false)) === false) {
          return undefined;
        }
        resolved.set(state.id, cloned);
      } catch {
        return undefined;
      }
    }
    return resolved.size === contributors.length ? resolved : undefined;
  }

  function reconcileAuxiliary(
    authority: ReadonlyMap<string, unknown>,
    localCheckpoint: StoredIslandCheckpoint,
    tick: number,
    replay: boolean
  ): boolean {
    let corrected = false;
    const localById = new Map(localCheckpoint.auxiliary.map((entry) => [entry.id, entry]));
    for (const contributor of contributors) {
      const state = authority.get(contributor.id);
      if (state === undefined) {
        throw new GameError(
          "physics.prediction_island_auxiliary_authority_missing",
          `Authority auxiliary state is missing: ${contributor.id}`
        );
      }
      const authorityHash = auxiliaryHash(contributor, state);
      corrected ||= localById.get(contributor.id)?.hash !== authorityHash;
      if (contributor.reconcile === undefined) {
        contributor.restore(structuredClone(state), auxiliaryContext(tick, replay));
      } else {
        contributor.reconcile(structuredClone(state), auxiliaryContext(tick, replay));
      }
      metrics.auxiliaryReconciliations += 1;
    }
    return corrected;
  }

  function resetAuxiliary(tick: number): void {
    for (const contributor of contributors) {
      contributor.reset?.(auxiliaryContext(tick, false));
      metrics.auxiliaryResets += 1;
    }
  }

  function disposeContributors(): void {
    for (let index = contributors.length - 1; index >= 0; index -= 1) {
      const contributor = contributors[index];
      try {
        contributor?.dispose?.();
      } catch {
        metrics.auxiliaryFailures += 1;
      }
    }
    contributors.length = 0;
    contributorById.clear();
  }

  function assertActive(): void {
    if (disposed) {
      throw new GameError(
        "physics.prediction_island_disposed",
        "Physics prediction island has been disposed"
      );
    }
  }
}

function materializeEnvironment(
  scene: PhysicsScene,
  environment: PhysicsPredictionIslandEnvironment | undefined
): void {
  for (const body of environment?.bodies ?? []) {
    scene.createBody(structuredClone(body));
  }
  for (const collider of environment?.colliders ?? []) {
    scene.createCollider(structuredClone(collider));
  }
}

function normalizeAuxiliaryContributors(
  values: readonly PhysicsPredictionIslandAuxiliaryContributor[] | undefined,
  maximum: number
): PhysicsPredictionIslandAuxiliaryContributor[] {
  if ((values?.length ?? 0) > maximum) {
    throw new GameError(
      "physics.prediction_island_auxiliary_capacity",
      `Prediction island auxiliary contributor capacity exceeded: ${maximum}`,
      { contributors: values?.length ?? 0, maximum }
    );
  }
  const ids = new Set<string>();
  const contributors = [...(values ?? [])];
  for (const contributor of contributors) {
    if (!contributor.id.trim() || ids.has(contributor.id)) {
      throw new GameError(
        ids.has(contributor.id)
          ? "physics.prediction_island_auxiliary_duplicate"
          : "physics.prediction_island_auxiliary_id_invalid",
        "Prediction island auxiliary contributors require unique non-empty ids",
        { contributorId: contributor.id }
      );
    }
    if (contributor.version !== undefined && !contributor.version.trim()) {
      throw new GameError(
        "physics.prediction_island_auxiliary_version_invalid",
        `Prediction island auxiliary contributor version is invalid: ${contributor.id}`
      );
    }
    if (
      !Number.isSafeInteger(contributor.maxCheckpointBytes) ||
      contributor.maxCheckpointBytes <= 0
    ) {
      throw new GameError(
        "physics.prediction_island_auxiliary_budget_invalid",
        `Prediction island auxiliary contributor budget is invalid: ${contributor.id}`
      );
    }
    if (contributor.order !== undefined && !Number.isSafeInteger(contributor.order)) {
      throw new GameError(
        "physics.prediction_island_auxiliary_order_invalid",
        `Prediction island auxiliary contributor order is invalid: ${contributor.id}`
      );
    }
    ids.add(contributor.id);
  }
  return contributors.sort(
    (left, right) => (left.order ?? 0) - (right.order ?? 0) || left.id.localeCompare(right.id)
  );
}

function measuredAuxiliaryBytes(
  contributor: PhysicsPredictionIslandAuxiliaryContributor,
  checkpoint: unknown
): number {
  const bytes = contributor.measureBytes(checkpoint);
  if (!Number.isSafeInteger(bytes) || bytes < 0) {
    throw new GameError(
      "physics.prediction_island_auxiliary_bytes_invalid",
      `Auxiliary contributor returned invalid checkpoint bytes: ${contributor.id}`,
      { contributorId: contributor.id, bytes }
    );
  }
  return bytes;
}

function auxiliaryHash(
  contributor: PhysicsPredictionIslandAuxiliaryContributor,
  checkpoint: unknown
): string {
  const hash = contributor.hash(checkpoint);
  if (typeof hash !== "string" || hash.length === 0) {
    throw new GameError(
      "physics.prediction_island_auxiliary_hash_invalid",
      `Auxiliary contributor returned an invalid checkpoint hash: ${contributor.id}`,
      { contributorId: contributor.id }
    );
  }
  return hash;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function normalizeMember(
  member: PhysicsPredictionIslandMemberDefinition
): PhysicsPredictionIslandMemberDefinition {
  if (member.id.length === 0 || member.body.id.length === 0) {
    throw new GameError(
      "physics.prediction_island_member_invalid",
      "Prediction island member and body ids must be non-empty"
    );
  }
  const colliderIds = new Set<string>();
  for (const collider of member.colliders ?? []) {
    if (collider.id === undefined || collider.id.length === 0) {
      throw new GameError(
        "physics.prediction_island_collider_id_required",
        `Prediction island member collider requires a stable id: ${member.id}`,
        { memberId: member.id }
      );
    }
    if (colliderIds.has(collider.id)) {
      throw new GameError(
        "physics.prediction_island_collider_duplicate",
        `Duplicate prediction island collider: ${collider.id}`,
        { memberId: member.id, colliderId: collider.id }
      );
    }
    if (collider.bodyId !== undefined && collider.bodyId !== member.body.id) {
      throw new GameError(
        "physics.prediction_island_collider_owner_invalid",
        `Prediction island collider belongs to another body: ${collider.id}`,
        { memberId: member.id, colliderId: collider.id, bodyId: collider.bodyId }
      );
    }
    colliderIds.add(collider.id);
  }
  return cloneMember(member);
}

function cloneMember(
  member: PhysicsPredictionIslandMemberDefinition
): PhysicsPredictionIslandMemberDefinition {
  return {
    id: member.id,
    body: structuredClone(member.body),
    ...(member.colliders === undefined
      ? {}
      : { colliders: member.colliders.map((collider) => structuredClone(collider)) })
  };
}

function validateCommand(command: PhysicsPredictionIslandCommand): void {
  if (!Number.isSafeInteger(command.tick) || command.tick < 1) {
    throw new GameError(
      "physics.prediction_island_command_tick_invalid",
      "Prediction island command tick must be a positive safe integer",
      { command }
    );
  }
  if (!Number.isSafeInteger(command.sequence) || command.sequence < 1) {
    throw new GameError(
      "physics.prediction_island_command_sequence_invalid",
      "Prediction island command sequence must be a positive safe integer",
      { command }
    );
  }
}

function validStateSnapshot(snapshot: PhysicsPredictionIslandStateSnapshot): boolean {
  if (
    !Number.isSafeInteger(snapshot.tick) ||
    snapshot.tick < 0 ||
    (typeof snapshot.generation === "string" && snapshot.generation.length === 0) ||
    (typeof snapshot.generation === "number" && !Number.isSafeInteger(snapshot.generation))
  ) {
    return false;
  }
  const memberIds = new Set<string>();
  for (const member of snapshot.members) {
    if (member.id.length === 0 || member.body.id.length === 0 || memberIds.has(member.id)) {
      return false;
    }
    memberIds.add(member.id);
  }
  const auxiliaryIds = new Set<string>();
  for (const state of snapshot.auxiliary ?? []) {
    if (
      typeof state.id !== "string" ||
      state.id.length === 0 ||
      typeof state.version !== "string" ||
      state.version.length === 0 ||
      auxiliaryIds.has(state.id)
    ) {
      return false;
    }
    auxiliaryIds.add(state.id);
  }
  return true;
}

function commandSignature(command: PhysicsPredictionIslandCommand): string {
  return JSON.stringify(command);
}

function cloneCommand(
  command: PhysicsPredictionIslandCommand,
  contributorById: ReadonlyMap<string, PhysicsPredictionIslandAuxiliaryContributor>
): PhysicsPredictionIslandCommand {
  switch (command.type) {
    case "spawn":
      return { ...command, member: cloneMember(command.member) };
    case "patch":
      return { ...command, patch: cloneBodyPatch(command.patch) };
    case "body-command":
      return { ...command, command: cloneBodyCommandPayload(command.command) };
    case "auxiliary": {
      const contributor = contributorById.get(command.contributorId);
      return {
        ...command,
        payload:
          contributor === undefined
            ? structuredClone(command.payload)
            : cloneAuxiliaryCommand(contributor, command.payload)
      };
    }
    case "despawn":
      return { ...command };
  }
}

function cloneAuxiliaryCommand(
  contributor: PhysicsPredictionIslandAuxiliaryContributor,
  command: unknown
): unknown {
  return contributor.cloneCommand === undefined
    ? structuredClone(command)
    : contributor.cloneCommand(command);
}

function materializeBodyCommand(
  bodyId: string,
  payload: PhysicsBodyCommandPayload
): PhysicsBodyCommand {
  switch (payload.type) {
    case "linear-impulse":
      return { ...cloneBodyCommandPayload(payload), bodyId };
    case "angular-impulse":
      return { ...cloneBodyCommandPayload(payload), bodyId };
  }
}

function compareCommands(
  left: PhysicsPredictionIslandCommand,
  right: PhysicsPredictionIslandCommand
): number {
  return left.sequence - right.sequence || left.type.localeCompare(right.type);
}

function bodyStatePatch(state: PhysicsBodyState): PhysicsBodyPatch {
  return {
    position: cloneVector(state.position),
    linearVelocity: cloneVector(state.linearVelocity),
    sleeping: state.sleeping,
    ...(state.rotation === undefined ? {} : { rotation: cloneRotation(state.rotation) }),
    ...(state.angularVelocity === undefined
      ? {}
      : { angularVelocity: cloneRotation(state.angularVelocity) }),
    ...(state.userData === undefined ? {} : { userData: structuredClone(state.userData) })
  };
}

function bodyStateRequiresPatch(local: PhysicsBodyState, authority: PhysicsBodyState): boolean {
  return (
    !sameVector(local.position, authority.position) ||
    !sameVector(local.linearVelocity, authority.linearVelocity) ||
    local.sleeping !== authority.sleeping ||
    !sameRotation(local.rotation, authority.rotation) ||
    !sameRotation(local.angularVelocity, authority.angularVelocity) ||
    authority.userData !== undefined
  );
}

function sameVector(left: PhysicsVector, right: PhysicsVector): boolean {
  return left.x === right.x && left.y === right.y && left.z === right.z;
}

function sameRotation(
  left: PhysicsBodyState["rotation"] | PhysicsBodyState["angularVelocity"],
  right: PhysicsBodyState["rotation"] | PhysicsBodyState["angularVelocity"]
): boolean {
  if (left === undefined || right === undefined) return left === right;
  if (typeof left === "number" || typeof right === "number") return left === right;
  return (
    left.x === right.x &&
    left.y === right.y &&
    left.z === right.z &&
    "w" in left === "w" in right &&
    (!("w" in left) || !("w" in right) || left.w === right.w)
  );
}

function cloneBodyState(state: PhysicsBodyState): PhysicsBodyState {
  return {
    ...state,
    position: cloneVector(state.position),
    linearVelocity: cloneVector(state.linearVelocity),
    ...(state.rotation === undefined ? {} : { rotation: cloneRotation(state.rotation) }),
    ...(state.angularVelocity === undefined
      ? {}
      : { angularVelocity: cloneRotation(state.angularVelocity) }),
    ...(state.userData === undefined ? {} : { userData: structuredClone(state.userData) })
  };
}

function cloneBodyPatch(patch: PhysicsBodyPatch): PhysicsBodyPatch {
  return {
    ...patch,
    ...(patch.position === undefined ? {} : { position: cloneVector(patch.position) }),
    ...(patch.rotation === undefined ? {} : { rotation: cloneRotation(patch.rotation) }),
    ...(patch.linearVelocity === undefined
      ? {}
      : { linearVelocity: cloneVector(patch.linearVelocity) }),
    ...(patch.angularVelocity === undefined
      ? {}
      : { angularVelocity: cloneRotation(patch.angularVelocity) }),
    ...(patch.userData === undefined ? {} : { userData: structuredClone(patch.userData) })
  };
}

function cloneBodyCommandPayload(payload: PhysicsBodyCommandPayload): PhysicsBodyCommandPayload {
  switch (payload.type) {
    case "linear-impulse":
      return {
        ...payload,
        impulse: cloneVector(payload.impulse),
        ...(payload.point === undefined ? {} : { point: cloneVector(payload.point) })
      };
    case "angular-impulse":
      return { ...payload, impulse: cloneRotation(payload.impulse) };
  }
}

function cloneVector(vector: PhysicsVector): PhysicsVector {
  return { x: vector.x, y: vector.y, ...(vector.z === undefined ? {} : { z: vector.z }) };
}

function cloneRotation(rotation: PhysicsRotation): PhysicsRotation {
  return typeof rotation === "number" ? rotation : { ...rotation };
}

function clonePhysicsQuery(query: PhysicsQuery): PhysicsQuery {
  const legacy = clonePhysicsLegacyQueryOptions(query);
  switch (query.type) {
    case "point":
      return { ...query, ...legacy, point: cloneVector(query.point) };
    case "raycast":
      return {
        ...query,
        ...legacy,
        origin: cloneVector(query.origin),
        direction: cloneVector(query.direction)
      };
    case "shape-cast":
      return {
        ...query,
        ...legacy,
        shape: clonePhysicsShape(query.shape),
        ...(query.position === undefined ? {} : { position: cloneVector(query.position) }),
        ...(query.rotation === undefined ? {} : { rotation: cloneRotation(query.rotation) }),
        direction: cloneVector(query.direction)
      };
    case "overlap":
    case "check":
      return {
        ...query,
        ...legacy,
        shape: clonePhysicsShape(query.shape),
        ...(query.position === undefined ? {} : { position: cloneVector(query.position) }),
        ...(query.rotation === undefined ? {} : { rotation: cloneRotation(query.rotation) })
      };
    case "bounds":
      return {
        ...query,
        ...legacy,
        bounds: { min: cloneVector(query.bounds.min), max: cloneVector(query.bounds.max) }
      };
  }
}

function clonePhysicsLegacyQueryOptions(query: PhysicsQuery) {
  return {
    ...(query.filter === undefined ? {} : { filter: clonePhysicsFilter(query.filter) }),
    ...(query.options === undefined ? {} : { options: clonePhysicsQueryOptions(query.options) })
  };
}

function clonePhysicsQueryOptions(options: PhysicsQueryOptions): PhysicsQueryOptions {
  return {
    ...options,
    ...(options.filter === undefined ? {} : { filter: clonePhysicsFilter(options.filter) }),
    ...(options.ignoreBodies === undefined ? {} : { ignoreBodies: [...options.ignoreBodies] }),
    ...(options.ignoreColliders === undefined
      ? {}
      : { ignoreColliders: [...options.ignoreColliders] }),
    ...(options.includeBodies === undefined ? {} : { includeBodies: [...options.includeBodies] }),
    ...(options.includeColliders === undefined
      ? {}
      : { includeColliders: [...options.includeColliders] })
  };
}

function clonePhysicsFilter(filter: NonNullable<PhysicsQueryOptions["filter"]>) {
  return {
    ...filter,
    ...(filter.groups === undefined ? {} : { groups: [...filter.groups] }),
    ...(filter.collidesWith === undefined ? {} : { collidesWith: [...filter.collidesWith] })
  };
}

function clonePhysicsShape(shape: PhysicsShapeDefinition): PhysicsShapeDefinition {
  switch (shape.type) {
    case "polygon":
    case "polyline":
      return { ...shape, points: shape.points.map(cloneVector) };
    case "custom":
      return { ...shape, props: structuredClone(shape.props) };
    default:
      return { ...shape };
  }
}

function clonePhysicsQueryResult(result: PhysicsQueryResult): PhysicsQueryResult {
  return {
    ...result,
    ...(result.point === undefined ? {} : { point: cloneVector(result.point) }),
    ...(result.normal === undefined ? {} : { normal: cloneVector(result.normal) })
  };
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function vectorDistance(
  left: { x: number; y: number; z?: number },
  right: { x: number; y: number; z?: number }
): number {
  return Math.hypot(left.x - right.x, left.y - right.y, (left.z ?? 0) - (right.z ?? 0));
}

function missingMemberBody(memberId: string, bodyId: string): GameError {
  return new GameError(
    "physics.prediction_island_member_body_missing",
    `Prediction island member body is missing: ${memberId}`,
    { memberId, bodyId }
  );
}

function positiveNumber(value: number | undefined, fallback: number): number {
  return value === undefined || !Number.isFinite(value) || value <= 0 ? fallback : value;
}

function positiveInteger(value: number | undefined, fallback: number): number {
  return value === undefined || !Number.isSafeInteger(value) || value <= 0 ? fallback : value;
}

function nonNegativeInteger(value: number | undefined, fallback: number): number {
  return value === undefined || !Number.isSafeInteger(value) || value < 0 ? fallback : value;
}
