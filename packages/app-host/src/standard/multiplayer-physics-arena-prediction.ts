import type {
  MultiplayerBridgeInstallContext,
  MultiplayerClientPredictionDomainDescriptor,
  MultiplayerClientPredictionDomainInputContext,
  MultiplayerClientReplicationSnapshotContext
} from "@gamekits/multiplayer-core";
import {
  createPhysicsPredictionIsland,
  type CreatePhysicsPredictionIslandOptions,
  type PhysicsBodyCommandPayload,
  type PhysicsBodyPatch,
  type PhysicsBodyState,
  type PhysicsPredictionIsland,
  type PhysicsPredictionIslandAuxiliaryContributor,
  type PhysicsPredictionIslandAuxiliaryState,
  type PhysicsPredictionIslandCommand,
  type PhysicsPredictionIslandContact,
  type PhysicsPredictionIslandHardCorrectResult,
  type PhysicsPredictionIslandMemberDefinition,
  type PhysicsPredictionIslandMemberState,
  type PhysicsPredictionIslandStateSnapshot
} from "@gamekits/physics-core";
import {
  createStandardMultiplayerPhysicsPredictionDomain,
  type StandardMultiplayerPhysicsAuthoritySpawn,
  type StandardMultiplayerPhysicsPredictionDomain,
  type StandardMultiplayerPhysicsPredictionReconcileResult
} from "./multiplayer-physics-prediction";

export type MultiplayerPhysicsArenaFrame = PhysicsPredictionIslandStateSnapshot & {
  islandId: string;
  membershipRevision: number;
  definitionVersion: string;
};

export type StandardMultiplayerPhysicsArenaClientFrame = MultiplayerPhysicsArenaFrame & {
  acknowledgedInputSequence?: number | undefined;
};

export type StandardMultiplayerPhysicsArenaInputCommand =
  | {
      type: "spawn";
      member: PhysicsPredictionIslandMemberDefinition;
    }
  | {
      type: "patch";
      memberId: string;
      patch: PhysicsBodyPatch;
    }
  | {
      type: "body-command";
      memberId: string;
      command: PhysicsBodyCommandPayload;
    }
  | {
      type: "auxiliary";
      contributorId: string;
      payload: unknown;
    }
  | {
      type: "despawn";
      memberId: string;
    };

export type StandardMultiplayerPhysicsArenaPredictionDiagnostics = {
  status:
    | "awaiting-authority"
    | "active"
    | "invalid-frame"
    | "member-definition-missing"
    | "baseline-rejected"
    | "disposed";
  bindingSessionId?: string | undefined;
  islandId?: string | undefined;
  generation?: string | number | undefined;
  membershipRevision?: number | undefined;
  definitionVersion?: string | undefined;
  authorityTick: number;
  acknowledgedInputSequence: number;
  authorityFrames: number;
  baselineInstalls: number;
  reconciliations: number;
  rejectedFrames: number;
  mappedInputs: number;
  queuedCommands: number;
  rejectedCommands: number;
  advancedTicks: number;
  contacts: number;
  predictedMemberRegistrations: number;
  predictedMemberRegistrationFailures: number;
  lastBaselineResult?: PhysicsPredictionIslandHardCorrectResult | undefined;
  lastReconciliation?: StandardMultiplayerPhysicsPredictionReconcileResult | undefined;
  island?: ReturnType<PhysicsPredictionIsland["diagnostics"]> | undefined;
};

export type StandardMultiplayerPhysicsArenaPredictionOptions<
  TInstallContext extends MultiplayerBridgeInstallContext,
  TSnapshot,
  TInput,
  _TManagedState
> = {
  id: string;
  kind?: string | undefined;
  island: Omit<
    CreatePhysicsPredictionIslandOptions,
    "generation" | "initialMembers" | "initialTick" | "auxiliaryContributors"
  >;
  createAuxiliaryContributors?(): readonly PhysicsPredictionIslandAuxiliaryContributor[];
  maxCommandsPerInput?: number | undefined;
  selectFrame(
    context: MultiplayerClientReplicationSnapshotContext<TSnapshot, TInstallContext>
  ): StandardMultiplayerPhysicsArenaClientFrame | undefined;
  resolveMemberDefinition(
    member: PhysicsPredictionIslandMemberState,
    frame: StandardMultiplayerPhysicsArenaClientFrame,
    snapshot: TSnapshot
  ): PhysicsPredictionIslandMemberDefinition | undefined;
  resolveAuthoritySpawn?(
    member: PhysicsPredictionIslandMemberState,
    frame: StandardMultiplayerPhysicsArenaClientFrame,
    snapshot: TSnapshot
  ): StandardMultiplayerPhysicsAuthoritySpawn | undefined;
  mapInput(
    context: MultiplayerClientPredictionDomainInputContext<TSnapshot, TInput, TInstallContext> & {
      authorityFrame: StandardMultiplayerPhysicsArenaClientFrame;
      predictionTick: number;
    }
  ): readonly StandardMultiplayerPhysicsArenaInputCommand[];
  onContacts?(contacts: readonly PhysicsPredictionIslandContact[]): void;
  onReconcile?(result: StandardMultiplayerPhysicsPredictionReconcileResult): void;
};

export type StandardMultiplayerPhysicsArenaPrediction<
  TInstallContext extends MultiplayerBridgeInstallContext,
  TSnapshot,
  TInput,
  TManagedState
> = {
  descriptor: MultiplayerClientPredictionDomainDescriptor<
    TInstallContext,
    TSnapshot,
    TInput,
    TManagedState
  >;
  frame(): StandardMultiplayerPhysicsArenaClientFrame | undefined;
  state(): PhysicsPredictionIslandStateSnapshot | undefined;
  body(memberId: string): PhysicsBodyState | undefined;
  registerPredictedMember(input: {
    correlationId: string;
    tick: number;
    member: PhysicsPredictionIslandMemberDefinition;
  }):
    | { status: "registered" | "duplicate"; memberId: string }
    | { status: "unavailable" | "rejected"; memberId: string; reason: string };
  diagnostics(): StandardMultiplayerPhysicsArenaPredictionDiagnostics;
};

export type StandardMultiplayerPhysicsArenaAuthorityProjectionOptions = {
  maxMembers?: number | undefined;
  maxPayloadBytes?: number | undefined;
};

export type StandardMultiplayerPhysicsArenaAuthorityProjectionInput = {
  islandId: string;
  generation: string | number;
  tick: number;
  membershipRevision: number;
  definitionVersion: string;
  members: readonly PhysicsPredictionIslandMemberState[];
  auxiliary?: readonly PhysicsPredictionIslandAuxiliaryState[] | undefined;
};

export type StandardMultiplayerPhysicsArenaAuthorityProjectionResult =
  | {
      status: "captured";
      frame: MultiplayerPhysicsArenaFrame;
      payloadBytes: number;
    }
  | {
      status: "invalid" | "member-capacity" | "payload-budget";
      payloadBytes: number;
    };

export type StandardMultiplayerPhysicsArenaAuthorityProjection = {
  capture(
    input: StandardMultiplayerPhysicsArenaAuthorityProjectionInput
  ): StandardMultiplayerPhysicsArenaAuthorityProjectionResult;
};

const DEFAULT_MAX_COMMANDS_PER_INPUT = 8;
const DEFAULT_MAX_AUTHORITY_MEMBERS = 64;
const DEFAULT_MAX_AUTHORITY_PAYLOAD_BYTES = 64 * 1024;

export function createStandardMultiplayerPhysicsArenaPrediction<
  TInstallContext extends MultiplayerBridgeInstallContext,
  TSnapshot,
  TInput,
  TManagedState = never
>(
  options: StandardMultiplayerPhysicsArenaPredictionOptions<
    TInstallContext,
    TSnapshot,
    TInput,
    TManagedState
  >
): StandardMultiplayerPhysicsArenaPrediction<TInstallContext, TSnapshot, TInput, TManagedState> {
  const id = nonEmpty(options.id, "Physics Arena prediction id");
  const maxCommandsPerInput = positiveInteger(
    options.maxCommandsPerInput,
    DEFAULT_MAX_COMMANDS_PER_INPUT
  );
  let active: ArenaRuntime<TInstallContext, TSnapshot, TInput, TManagedState> | undefined;

  const descriptor: MultiplayerClientPredictionDomainDescriptor<
    TInstallContext,
    TSnapshot,
    TInput,
    TManagedState
  > = {
    id,
    create(context) {
      const runtime = createArenaRuntime(options, context.binding.sessionId, maxCommandsPerInput);
      active = runtime;
      return runtime;
    }
  };

  return {
    descriptor,
    frame() {
      return active?.frame();
    },
    state() {
      return active?.state();
    },
    body(memberId) {
      return active?.body(memberId);
    },
    registerPredictedMember(input) {
      return (
        active?.registerPredictedMember(input) ?? {
          status: "unavailable",
          memberId: input.member.id,
          reason: "prediction-domain-unavailable"
        }
      );
    },
    diagnostics() {
      return active?.diagnostics() ?? emptyArenaDiagnostics();
    }
  };
}

type ArenaRuntime<
  TInstallContext extends MultiplayerBridgeInstallContext,
  TSnapshot,
  TInput,
  TManagedState
> = ReturnType<typeof createArenaRuntime<TInstallContext, TSnapshot, TInput, TManagedState>>;

function createArenaRuntime<
  TInstallContext extends MultiplayerBridgeInstallContext,
  TSnapshot,
  TInput,
  TManagedState
>(
  options: StandardMultiplayerPhysicsArenaPredictionOptions<
    TInstallContext,
    TSnapshot,
    TInput,
    TManagedState
  >,
  bindingSessionId: string,
  maxCommandsPerInput: number
) {
  let island: PhysicsPredictionIsland | undefined;
  let domain: StandardMultiplayerPhysicsPredictionDomain | undefined;
  let authorityFrame: StandardMultiplayerPhysicsArenaClientFrame | undefined;
  let disposed = false;
  let status: StandardMultiplayerPhysicsArenaPredictionDiagnostics["status"] = "awaiting-authority";
  let authorityFrames = 0;
  let baselineInstalls = 0;
  let reconciliations = 0;
  let rejectedFrames = 0;
  let mappedInputs = 0;
  let queuedCommands = 0;
  let rejectedCommands = 0;
  let advancedTicks = 0;
  let contacts = 0;
  let predictedMemberRegistrations = 0;
  let predictedMemberRegistrationFailures = 0;
  let predictedMemberCommandSequence = Number.MAX_SAFE_INTEGER;
  let latestAppSnapshot: TSnapshot | undefined;
  let lastBaselineResult: PhysicsPredictionIslandHardCorrectResult | undefined;
  let lastReconciliation: StandardMultiplayerPhysicsPredictionReconcileResult | undefined;

  return {
    applyAuthoritative(
      context: MultiplayerClientReplicationSnapshotContext<TSnapshot, TInstallContext>
    ) {
      assertActive();
      const next = options.selectFrame(context);
      if (next === undefined || !validClientFrame(next)) {
        status = "invalid-frame";
        rejectedFrames += 1;
        return;
      }
      latestAppSnapshot = context.snapshot;
      authorityFrames += 1;
      if (requiresBaseline(authorityFrame, next) || island === undefined || domain === undefined) {
        installBaseline(next, context.snapshot);
        return;
      }
      authorityFrame = cloneClientFrame(next);
      const result = domain.reconcile(next);
      reconciliations += 1;
      lastReconciliation = result;
      status = result.hardCorrection?.status === "corrected" ? "active" : statusForResult(result);
      options.onReconcile?.(result);
    },
    applyInput(
      context: MultiplayerClientPredictionDomainInputContext<TSnapshot, TInput, TInstallContext>
    ) {
      assertActive();
      if (authorityFrame === undefined || island === undefined || status !== "active") {
        return;
      }
      const acknowledged = authorityFrame.acknowledgedInputSequence ?? 0;
      const predictionTick = Math.max(
        island.tick() + 1,
        authorityFrame.tick + Math.max(1, context.predictionFrame.sequence - acknowledged)
      );
      const commands = options.mapInput({
        ...context,
        authorityFrame: cloneClientFrame(authorityFrame),
        predictionTick
      });
      if (commands.length > maxCommandsPerInput) {
        rejectedCommands += commands.length;
        return;
      }
      mappedInputs += 1;
      for (const [index, command] of commands.entries()) {
        const sequence = context.predictionFrame.sequence * maxCommandsPerInput + index;
        if (!Number.isSafeInteger(sequence)) {
          rejectedCommands += 1;
          continue;
        }
        const result = island.queue(materializeCommand(command, predictionTick, sequence));
        if (result.status === "queued" || result.status === "replayed") {
          queuedCommands += 1;
        } else if (result.status !== "duplicate") {
          rejectedCommands += 1;
        }
        if (result.contacts.length > 0) {
          contacts += result.contacts.length;
          options.onContacts?.(result.contacts);
        }
      }
      const advanced = island.advanceTo(predictionTick);
      advancedTicks += advanced.steps;
      if (advanced.contacts.length > 0) {
        contacts += advanced.contacts.length;
        options.onContacts?.(advanced.contacts);
      }
    },
    diagnostics() {
      return snapshotDiagnostics();
    },
    dispose() {
      if (disposed) {
        return;
      }
      disposed = true;
      status = "disposed";
      domain?.dispose();
      domain = undefined;
      island = undefined;
      authorityFrame = undefined;
    },
    frame() {
      return authorityFrame === undefined ? undefined : cloneClientFrame(authorityFrame);
    },
    state() {
      return island?.state();
    },
    body(memberId: string) {
      return island?.body(memberId);
    },
    registerPredictedMember(input: {
      correlationId: string;
      tick: number;
      member: PhysicsPredictionIslandMemberDefinition;
    }) {
      if (island === undefined || domain === undefined || status !== "active") {
        predictedMemberRegistrationFailures += 1;
        return {
          status: "unavailable" as const,
          memberId: input.member.id,
          reason: "prediction-domain-unavailable"
        };
      }
      if (island.body(input.member.id) !== undefined) {
        return { status: "duplicate" as const, memberId: input.member.id };
      }
      const registration = domain.registerPredicted(input);
      if (registration.status === "duplicate") {
        return { status: "duplicate" as const, memberId: input.member.id };
      }
      if (registration.status !== "registered") {
        predictedMemberRegistrationFailures += 1;
        return {
          status: "rejected" as const,
          memberId: input.member.id,
          reason: registration.status
        };
      }
      const result = island.queue({
        type: "spawn",
        tick: Math.max(input.tick, island.tick() + 1),
        sequence: predictedMemberCommandSequence,
        member: input.member
      });
      predictedMemberCommandSequence -= 1;
      if (
        result.status !== "queued" &&
        result.status !== "replayed" &&
        result.status !== "duplicate"
      ) {
        domain.rejectPredicted(input.correlationId, input.tick, result.status);
        predictedMemberRegistrationFailures += 1;
        return {
          status: "rejected" as const,
          memberId: input.member.id,
          reason: result.status
        };
      }
      predictedMemberRegistrations += result.status === "duplicate" ? 0 : 1;
      return {
        status: result.status === "duplicate" ? ("duplicate" as const) : ("registered" as const),
        memberId: input.member.id
      };
    }
  };

  function installBaseline(
    frame: StandardMultiplayerPhysicsArenaClientFrame,
    snapshot: TSnapshot
  ): void {
    const definitions = resolveDefinitions(options, frame, snapshot);
    if (definitions === undefined) {
      status = "member-definition-missing";
      rejectedFrames += 1;
      return;
    }
    let nextIsland: PhysicsPredictionIsland | undefined;
    try {
      nextIsland = createPhysicsPredictionIsland({
        ...options.island,
        generation: frame.generation,
        initialTick: frame.tick,
        initialMembers: definitions,
        ...(options.createAuxiliaryContributors === undefined
          ? {}
          : { auxiliaryContributors: options.createAuxiliaryContributors() })
      });
      const baseline = nextIsland.hardCorrect(frame, definitions);
      lastBaselineResult = baseline;
      if (baseline.status !== "corrected") {
        nextIsland.dispose();
        status = "baseline-rejected";
        rejectedFrames += 1;
        return;
      }
      const nextDomain = createStandardMultiplayerPhysicsPredictionDomain({
        kind: options.kind ?? `${options.id}.member`,
        generation: frame.generation,
        stepMs: options.island.fixedDeltaMs ?? 1000 / 60,
        island: nextIsland,
        resolveAuthoritySpawn(member) {
          return (
            options.resolveAuthoritySpawn?.(member, frame, latestAppSnapshot ?? snapshot) ?? {
              correlationId: member.id,
              tick: frame.tick
            }
          );
        },
        resolveMemberDefinition(member, physicsSnapshot) {
          return options.resolveMemberDefinition(
            member,
            {
              ...frame,
              generation: physicsSnapshot.generation,
              tick: physicsSnapshot.tick
            },
            latestAppSnapshot ?? snapshot
          );
        }
      });
      domain?.dispose();
      island = nextIsland;
      domain = nextDomain;
      authorityFrame = cloneClientFrame(frame);
      baselineInstalls += 1;
      status = "active";
      nextIsland = undefined;
    } finally {
      nextIsland?.dispose();
    }
  }

  function snapshotDiagnostics(): StandardMultiplayerPhysicsArenaPredictionDiagnostics {
    return {
      status,
      bindingSessionId,
      ...(authorityFrame === undefined
        ? {}
        : {
            islandId: authorityFrame.islandId,
            generation: authorityFrame.generation,
            membershipRevision: authorityFrame.membershipRevision,
            definitionVersion: authorityFrame.definitionVersion
          }),
      authorityTick: authorityFrame?.tick ?? 0,
      acknowledgedInputSequence: authorityFrame?.acknowledgedInputSequence ?? 0,
      authorityFrames,
      baselineInstalls,
      reconciliations,
      rejectedFrames,
      mappedInputs,
      queuedCommands,
      rejectedCommands,
      advancedTicks,
      contacts,
      predictedMemberRegistrations,
      predictedMemberRegistrationFailures,
      ...(lastBaselineResult === undefined ? {} : { lastBaselineResult }),
      ...(lastReconciliation === undefined ? {} : { lastReconciliation }),
      ...(island === undefined ? {} : { island: island.diagnostics() })
    };
  }

  function assertActive(): void {
    if (disposed) {
      throw new Error("Standard multiplayer Physics Arena prediction is disposed.");
    }
  }
}

export function createStandardMultiplayerPhysicsArenaAuthorityProjection(
  options: StandardMultiplayerPhysicsArenaAuthorityProjectionOptions = {}
): StandardMultiplayerPhysicsArenaAuthorityProjection {
  const maxMembers = positiveInteger(options.maxMembers, DEFAULT_MAX_AUTHORITY_MEMBERS);
  const maxPayloadBytes = positiveInteger(
    options.maxPayloadBytes,
    DEFAULT_MAX_AUTHORITY_PAYLOAD_BYTES
  );
  const encoder = new TextEncoder();
  return {
    capture(input) {
      if (!validAuthorityInput(input)) {
        return { status: "invalid", payloadBytes: 0 };
      }
      if (input.members.length > maxMembers) {
        return { status: "member-capacity", payloadBytes: 0 };
      }
      const frame: MultiplayerPhysicsArenaFrame = {
        islandId: input.islandId,
        generation: input.generation,
        tick: input.tick,
        membershipRevision: input.membershipRevision,
        definitionVersion: input.definitionVersion,
        members: input.members
          .map(cloneAuthorityMember)
          .sort((left, right) => left.id.localeCompare(right.id)),
        ...(input.auxiliary === undefined
          ? {}
          : {
              auxiliary: input.auxiliary
                .map(cloneAuxiliaryState)
                .sort((left, right) => left.id.localeCompare(right.id))
            })
      };
      const payloadBytes = encoder.encode(JSON.stringify(frame)).byteLength;
      return payloadBytes > maxPayloadBytes
        ? { status: "payload-budget", payloadBytes }
        : { status: "captured", frame, payloadBytes };
    }
  };
}

function resolveDefinitions<
  TInstallContext extends MultiplayerBridgeInstallContext,
  TSnapshot,
  TInput,
  TManagedState
>(
  options: StandardMultiplayerPhysicsArenaPredictionOptions<
    TInstallContext,
    TSnapshot,
    TInput,
    TManagedState
  >,
  frame: StandardMultiplayerPhysicsArenaClientFrame,
  snapshot: TSnapshot
): PhysicsPredictionIslandMemberDefinition[] | undefined {
  const definitions: PhysicsPredictionIslandMemberDefinition[] = [];
  for (const member of frame.members) {
    const definition = options.resolveMemberDefinition(member, frame, snapshot);
    if (definition === undefined || definition.id !== member.id) {
      return undefined;
    }
    definitions.push(structuredClone(definition));
  }
  return definitions;
}

function materializeCommand(
  command: StandardMultiplayerPhysicsArenaInputCommand,
  tick: number,
  sequence: number
): PhysicsPredictionIslandCommand {
  switch (command.type) {
    case "spawn":
      return { type: "spawn", tick, sequence, member: structuredClone(command.member) };
    case "patch":
      return {
        type: "patch",
        tick,
        sequence,
        memberId: command.memberId,
        patch: structuredClone(command.patch)
      };
    case "body-command":
      return {
        type: "body-command",
        tick,
        sequence,
        memberId: command.memberId,
        command: structuredClone(command.command)
      };
    case "auxiliary":
      return {
        type: "auxiliary",
        tick,
        sequence,
        contributorId: command.contributorId,
        payload: structuredClone(command.payload)
      };
    case "despawn":
      return { type: "despawn", tick, sequence, memberId: command.memberId };
  }
}

function requiresBaseline(
  current: StandardMultiplayerPhysicsArenaClientFrame | undefined,
  next: StandardMultiplayerPhysicsArenaClientFrame
): boolean {
  return (
    current === undefined ||
    current.islandId !== next.islandId ||
    current.generation !== next.generation ||
    current.membershipRevision !== next.membershipRevision ||
    current.definitionVersion !== next.definitionVersion
  );
}

function statusForResult(
  result: StandardMultiplayerPhysicsPredictionReconcileResult
): StandardMultiplayerPhysicsArenaPredictionDiagnostics["status"] {
  return result.reconciliation.status === "confirmed" ||
    result.reconciliation.status === "corrected"
    ? "active"
    : "baseline-rejected";
}

function validClientFrame(frame: StandardMultiplayerPhysicsArenaClientFrame): boolean {
  return (
    nonEmptyValue(frame.islandId) &&
    validGeneration(frame.generation) &&
    nonNegativeSafeInteger(frame.tick) &&
    nonNegativeSafeInteger(frame.membershipRevision) &&
    nonEmptyValue(frame.definitionVersion) &&
    (frame.acknowledgedInputSequence === undefined ||
      nonNegativeSafeInteger(frame.acknowledgedInputSequence)) &&
    validMembers(frame.members) &&
    validAuxiliary(frame.auxiliary)
  );
}

function validAuthorityInput(
  input: StandardMultiplayerPhysicsArenaAuthorityProjectionInput
): boolean {
  return (
    nonEmptyValue(input.islandId) &&
    validGeneration(input.generation) &&
    nonNegativeSafeInteger(input.tick) &&
    nonNegativeSafeInteger(input.membershipRevision) &&
    nonEmptyValue(input.definitionVersion) &&
    validMembers(input.members) &&
    validAuxiliary(input.auxiliary)
  );
}

function validMembers(members: readonly PhysicsPredictionIslandMemberState[]): boolean {
  const ids = new Set<string>();
  for (const member of members) {
    if (!nonEmptyValue(member.id) || ids.has(member.id) || !validBodyState(member.body)) {
      return false;
    }
    ids.add(member.id);
  }
  return true;
}

function validAuxiliary(
  auxiliary: readonly PhysicsPredictionIslandAuxiliaryState[] | undefined
): boolean {
  const ids = new Set<string>();
  for (const state of auxiliary ?? []) {
    if (!nonEmptyValue(state.id) || !nonEmptyValue(state.version) || ids.has(state.id)) {
      return false;
    }
    ids.add(state.id);
  }
  return true;
}

function validBodyState(body: PhysicsBodyState): boolean {
  return (
    nonEmptyValue(body.id) &&
    finiteVector(body.position) &&
    finiteVector(body.linearVelocity) &&
    finiteRotation(body.rotation) &&
    finiteRotation(body.angularVelocity)
  );
}

function finiteVector(value: { x: number; y: number; z?: number | undefined }): boolean {
  return (
    Number.isFinite(value.x) &&
    Number.isFinite(value.y) &&
    (value.z === undefined || Number.isFinite(value.z))
  );
}

function finiteRotation(value: PhysicsBodyState["rotation"]): boolean {
  if (value === undefined) {
    return true;
  }
  if (typeof value === "number") {
    return Number.isFinite(value);
  }
  return finiteVector(value) && (!("w" in value) || Number.isFinite((value as { w: number }).w));
}

function cloneAuthorityMember(
  member: PhysicsPredictionIslandMemberState
): PhysicsPredictionIslandMemberState {
  const body = member.body;
  return {
    id: member.id,
    body: {
      id: body.id,
      kind: body.kind,
      position: { ...body.position },
      linearVelocity: { ...body.linearVelocity },
      sleeping: body.sleeping,
      ...(body.rotation === undefined
        ? {}
        : { rotation: typeof body.rotation === "number" ? body.rotation : { ...body.rotation } }),
      ...(body.angularVelocity === undefined
        ? {}
        : {
            angularVelocity:
              typeof body.angularVelocity === "number"
                ? body.angularVelocity
                : { ...body.angularVelocity }
          })
    }
  };
}

function cloneAuxiliaryState(
  state: PhysicsPredictionIslandAuxiliaryState
): PhysicsPredictionIslandAuxiliaryState {
  return {
    id: state.id,
    version: state.version,
    state: structuredClone(state.state)
  };
}

function cloneClientFrame(
  frame: StandardMultiplayerPhysicsArenaClientFrame
): StandardMultiplayerPhysicsArenaClientFrame {
  return {
    islandId: frame.islandId,
    generation: frame.generation,
    tick: frame.tick,
    membershipRevision: frame.membershipRevision,
    definitionVersion: frame.definitionVersion,
    members: frame.members.map((member) => ({
      id: member.id,
      body: structuredClone(member.body)
    })),
    ...(frame.auxiliary === undefined
      ? {}
      : { auxiliary: frame.auxiliary.map(cloneAuxiliaryState) }),
    ...(frame.acknowledgedInputSequence === undefined
      ? {}
      : { acknowledgedInputSequence: frame.acknowledgedInputSequence })
  };
}

function emptyArenaDiagnostics(): StandardMultiplayerPhysicsArenaPredictionDiagnostics {
  return {
    status: "awaiting-authority",
    authorityTick: 0,
    acknowledgedInputSequence: 0,
    authorityFrames: 0,
    baselineInstalls: 0,
    reconciliations: 0,
    rejectedFrames: 0,
    mappedInputs: 0,
    queuedCommands: 0,
    rejectedCommands: 0,
    advancedTicks: 0,
    contacts: 0,
    predictedMemberRegistrations: 0,
    predictedMemberRegistrationFailures: 0
  };
}

function validGeneration(value: string | number): boolean {
  return typeof value === "string" ? nonEmptyValue(value) : Number.isSafeInteger(value);
}

function nonNegativeSafeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

function nonEmpty(value: string, label: string): string {
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new Error(`${label} must not be empty.`);
  }
  return normalized;
}

function nonEmptyValue(value: string): boolean {
  return value.trim().length > 0;
}

function positiveInteger(value: number | undefined, fallback: number): number {
  return value === undefined || !Number.isFinite(value) || value <= 0
    ? fallback
    : Math.floor(value);
}
