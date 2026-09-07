import { GameError } from "@gamekits/core";
import type {
  PhysicsBodyCommandPayload,
  PhysicsPredictionIslandAuxiliaryApplyContext,
  PhysicsPredictionIslandAuxiliaryContributor
} from "@gamekits/physics-core";
import type {
  CharacterControlIntent,
  CharacterMotorDefinition,
  CharacterMotorDiagnostics,
  CharacterMotorObservation,
  CharacterMotorState,
  CharacterMotorTraceEntry,
  CompiledCharacterMotorDefinition
} from "../contracts";
import { characterMotorStateSignature } from "../diagnostics";
import { cloneCharacterMotorState, createCharacterMotorState, stepCharacterMotor } from "../motor";

export type CharacterMotorPredictionCommand =
  | {
      type: "control";
      memberId: string;
      intent: CharacterControlIntent;
      staggerDurationMs?: number | undefined;
    }
  | {
      type: "remove";
      memberId: string;
    };

export type CharacterMotorPredictionCheckpoint = {
  version: 1;
  members: Array<{
    memberId: string;
    state: CharacterMotorState;
  }>;
};

export type CharacterMotorObservationContext = {
  memberId: string;
  intent: Readonly<CharacterControlIntent>;
  state: Readonly<CharacterMotorState>;
  context: PhysicsPredictionIslandAuxiliaryApplyContext;
};

export type CreateCharacterMotorPredictionContributorOptions = {
  id?: string | undefined;
  version?: string | undefined;
  order?: number | undefined;
  maxCheckpointBytes?: number | undefined;
  initialStates?: Readonly<Record<string, Readonly<CharacterMotorState>>> | undefined;
  resolveDefinition(
    memberId: string
  ): CompiledCharacterMotorDefinition | Readonly<CharacterMotorDefinition> | undefined;
  observe?(context: CharacterMotorObservationContext): CharacterMotorObservation | undefined;
};

export type CharacterMotorPredictionContributorDiagnostics = {
  id: string;
  members: number;
  appliedControls: number;
  removedMembers: number;
  replayedControls: number;
  captures: number;
  restores: number;
  reconciliations: number;
  resets: number;
  rejectedCommands: number;
  emittedBodyCommands: number;
  traceEntries: number;
  disposed: boolean;
};

export type CharacterMotorPredictionContributor = PhysicsPredictionIslandAuxiliaryContributor<
  CharacterMotorPredictionCommand,
  CharacterMotorPredictionCheckpoint,
  CharacterMotorPredictionCheckpoint
> & {
  state(memberId: string): CharacterMotorState | undefined;
  lastDiagnostics(memberId: string): CharacterMotorDiagnostics | undefined;
  lastTrace(memberId: string): CharacterMotorTraceEntry[];
  diagnostics(): CharacterMotorPredictionContributorDiagnostics;
};

const DEFAULT_ID = "character.motor";
const DEFAULT_VERSION = "1";
const DEFAULT_ORDER = 100;
const DEFAULT_MAX_CHECKPOINT_BYTES = 256 * 1024;
const encoder = new TextEncoder();

export function createCharacterMotorPredictionContributor(
  options: CreateCharacterMotorPredictionContributorOptions
): CharacterMotorPredictionContributor {
  const id = nonEmpty(options.id ?? DEFAULT_ID, "Character motor contributor id");
  const version = nonEmpty(
    options.version ?? DEFAULT_VERSION,
    "Character motor contributor version"
  );
  const order = safeInteger(options.order, DEFAULT_ORDER);
  const maxCheckpointBytes = positiveSafeInteger(
    options.maxCheckpointBytes,
    DEFAULT_MAX_CHECKPOINT_BYTES
  );
  const states = new Map<string, CharacterMotorState>();
  const lastDiagnostics = new Map<string, CharacterMotorDiagnostics>();
  const lastTraces = new Map<string, CharacterMotorTraceEntry[]>();
  let appliedControls = 0;
  let removedMembers = 0;
  let replayedControls = 0;
  let captures = 0;
  let restores = 0;
  let reconciliations = 0;
  let resets = 0;
  let rejectedCommands = 0;
  let emittedBodyCommands = 0;
  let traceEntries = 0;
  let disposed = false;

  installInitialStates();

  return {
    id,
    version,
    order,
    maxCheckpointBytes,
    cloneCommand,
    apply(command, context) {
      assertActive();
      if (!nonEmptyValue(command.memberId)) {
        rejectedCommands += 1;
        throw new GameError(
          "character.motor_prediction_member_invalid",
          "Character motor prediction command requires a member id"
        );
      }
      if (command.type === "remove") {
        states.delete(command.memberId);
        lastDiagnostics.delete(command.memberId);
        lastTraces.delete(command.memberId);
        removedMembers += 1;
        return;
      }
      const body = context.simulation.body(command.memberId);
      const definition = options.resolveDefinition(command.memberId);
      if (body === undefined || definition === undefined) {
        rejectedCommands += 1;
        throw new GameError(
          "character.motor_prediction_member_unavailable",
          `Character motor prediction member is unavailable: ${command.memberId}`,
          { memberId: command.memberId, hasBody: body !== undefined }
        );
      }
      const previous = states.get(command.memberId) ?? createCharacterMotorState();
      const observed = options.observe?.({
        memberId: command.memberId,
        intent: command.intent,
        state: previous,
        context
      });
      const observation = mergeStaggerObservation(observed, command.staggerDurationMs);
      const result = stepCharacterMotor({
        tick: context.tick,
        deltaMs: context.fixedDeltaMs,
        definition,
        state: previous,
        intent: command.intent,
        body,
        observation
      });
      context.simulation.updateBody(command.memberId, result.bodyPatch);
      for (const bodyCommand of result.bodyCommands) {
        const applied = context.simulation.applyBodyCommand(
          command.memberId,
          bodyCommandPayload(bodyCommand)
        );
        if (applied.status !== "applied") {
          rejectedCommands += 1;
          throw new GameError(
            "character.motor_prediction_body_command_rejected",
            `Character motor body command was rejected: ${applied.status}`,
            { memberId: command.memberId, applied }
          );
        }
        emittedBodyCommands += 1;
      }
      states.set(command.memberId, cloneCharacterMotorState(result.state));
      lastDiagnostics.set(command.memberId, result.diagnostics);
      lastTraces.set(command.memberId, result.trace);
      traceEntries += result.trace.length;
      appliedControls += 1;
      if (context.replay) replayedControls += 1;
    },
    capture() {
      assertActive();
      captures += 1;
      return captureCheckpoint(states);
    },
    validate(checkpoint) {
      return validCheckpoint(checkpoint);
    },
    restore(checkpoint) {
      assertActive();
      restoreCheckpoint(states, checkpoint);
      clearTransientDiagnostics();
      restores += 1;
    },
    reconcile(checkpoint) {
      assertActive();
      restoreCheckpoint(states, checkpoint);
      clearTransientDiagnostics();
      reconciliations += 1;
    },
    reset() {
      assertActive();
      states.clear();
      installInitialStates();
      clearTransientDiagnostics();
      resets += 1;
    },
    measureBytes(checkpoint) {
      return encoder.encode(JSON.stringify(checkpoint)).byteLength;
    },
    hash(checkpoint) {
      if (!validCheckpoint(checkpoint)) return "invalid";
      return JSON.stringify([
        checkpoint.version,
        checkpoint.members.map((member) => [
          member.memberId,
          characterMotorStateSignature(member.state)
        ])
      ]);
    },
    state(memberId) {
      assertActive();
      const state = states.get(memberId);
      return state === undefined ? undefined : cloneCharacterMotorState(state);
    },
    lastDiagnostics(memberId) {
      assertActive();
      const value = lastDiagnostics.get(memberId);
      return value === undefined ? undefined : structuredClone(value);
    },
    lastTrace(memberId) {
      assertActive();
      return structuredClone(lastTraces.get(memberId) ?? []);
    },
    diagnostics() {
      return {
        id,
        members: states.size,
        appliedControls,
        removedMembers,
        replayedControls,
        captures,
        restores,
        reconciliations,
        resets,
        rejectedCommands,
        emittedBodyCommands,
        traceEntries,
        disposed
      };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      states.clear();
      clearTransientDiagnostics();
    }
  };

  function installInitialStates(): void {
    for (const [memberId, state] of Object.entries(options.initialStates ?? {}).sort(
      ([left], [right]) => left.localeCompare(right)
    )) {
      if (!nonEmptyValue(memberId) || !validMotorState(state)) {
        throw new GameError(
          "character.motor_prediction_initial_state_invalid",
          `Character motor initial state is invalid: ${memberId}`,
          { memberId }
        );
      }
      states.set(memberId, cloneCharacterMotorState(state));
    }
  }

  function clearTransientDiagnostics(): void {
    lastDiagnostics.clear();
    lastTraces.clear();
  }

  function assertActive(): void {
    if (disposed) {
      throw new GameError(
        "character.motor_prediction_disposed",
        "Character motor prediction contributor is disposed"
      );
    }
  }
}

function cloneCommand(command: CharacterMotorPredictionCommand): CharacterMotorPredictionCommand {
  if (command.type === "remove") return { ...command };
  return {
    ...command,
    intent: {
      ...command.intent,
      move: { ...command.intent.move },
      ...(command.intent.facing === undefined ? {} : { facing: { ...command.intent.facing } })
    }
  };
}

function captureCheckpoint(
  states: ReadonlyMap<string, CharacterMotorState>
): CharacterMotorPredictionCheckpoint {
  return {
    version: 1,
    members: [...states]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([memberId, state]) => ({ memberId, state: cloneCharacterMotorState(state) }))
  };
}

function restoreCheckpoint(
  states: Map<string, CharacterMotorState>,
  checkpoint: CharacterMotorPredictionCheckpoint
): void {
  if (!validCheckpoint(checkpoint)) {
    throw new GameError(
      "character.motor_prediction_checkpoint_invalid",
      "Character motor prediction checkpoint is invalid"
    );
  }
  states.clear();
  for (const member of checkpoint.members) {
    states.set(member.memberId, cloneCharacterMotorState(member.state));
  }
}

function validCheckpoint(checkpoint: CharacterMotorPredictionCheckpoint): boolean {
  if (checkpoint?.version !== 1 || !Array.isArray(checkpoint.members)) return false;
  const ids = new Set<string>();
  for (const member of checkpoint.members) {
    if (
      !nonEmptyValue(member?.memberId) ||
      ids.has(member.memberId) ||
      !validMotorState(member.state)
    ) {
      return false;
    }
    ids.add(member.memberId);
  }
  return true;
}

function validMotorState(state: Readonly<CharacterMotorState>): boolean {
  if (state === undefined || state === null || typeof state !== "object") return false;
  const numbers = [
    state.facingYaw,
    state.coyoteRemainingMs,
    state.jumpBufferRemainingMs,
    state.jumpHoldRemainingMs,
    state.diveRemainingMs,
    state.diveCooldownRemainingMs,
    state.recoveryRemainingMs,
    state.staggerRemainingMs,
    state.airborneTimeMs,
    state.lastConsumedJumpSequence,
    state.lastConsumedDiveSequence,
    state.lastStableTick,
    state.groundNormal?.x,
    state.groundNormal?.y,
    state.groundNormal?.z ?? 0,
    state.inheritedPlatformVelocity?.x,
    state.inheritedPlatformVelocity?.y,
    state.inheritedPlatformVelocity?.z ?? 0
  ];
  return (
    typeof state.mode === "string" &&
    typeof state.grounded === "boolean" &&
    numbers.every((value) => Number.isFinite(value))
  );
}

function mergeStaggerObservation(
  observation: CharacterMotorObservation | undefined,
  staggerDurationMs: number | undefined
): CharacterMotorObservation | undefined {
  if (staggerDurationMs === undefined) return observation;
  return {
    ...observation,
    staggerDurationMs: Math.max(observation?.staggerDurationMs ?? 0, staggerDurationMs)
  };
}

function bodyCommandPayload(
  command: {
    type: PhysicsBodyCommandPayload["type"];
    bodyId: string;
  } & Record<string, unknown>
): PhysicsBodyCommandPayload {
  const { bodyId: _bodyId, ...payload } = command;
  return payload as PhysicsBodyCommandPayload;
}

function nonEmpty(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized)
    throw new GameError("character.motor_prediction_id_invalid", `${label} is empty`);
  return normalized;
}

function nonEmptyValue(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function safeInteger(value: number | undefined, fallback: number): number {
  return value === undefined || !Number.isSafeInteger(value) ? fallback : value;
}

function positiveSafeInteger(value: number | undefined, fallback: number): number {
  return value === undefined || !Number.isSafeInteger(value) || value <= 0 ? fallback : value;
}
