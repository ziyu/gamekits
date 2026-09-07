import type { DataRegistry } from "@gamekits/data";
import { GAS_ABILITY_TYPE, GAS_EFFECT_TYPE } from "./data-types";
import { createGasError } from "./errors";
import { assertGasEffectPeriod } from "./effect-validation";
import { childGasContext } from "./operation-context";
import type {
  GasAbilityActivation,
  GasAbilityActivationResult,
  GasAbilityDefinition,
  GasAbilityExecutionCancellation,
  GasAbilityExecutionCancellationResult,
  GasAbilityExecutionId,
  GasAbilityExecutionPhase,
  GasAbilityExecutionQuery,
  GasAbilityExecutionRejectionReason,
  GasAbilityExecutionRequest,
  GasAbilityExecutionRequestResult,
  GasAbilityExecutionRuntimeOptions,
  GasAbilityExecutionState,
  GasAbilityExecutionsComponentState,
  GasActorRuntimeState,
  GasEffectApplicationResult,
  GasEffectDefinition,
  GasOperationContext,
  GasTraceEntry
} from "./types";

const DEFAULT_MAX_ACTIVE_PER_ACTOR = 16;
const DEFAULT_RECENT_HISTORY_LIMIT = 256;

export type GasAbilityExecutionRuntimeOptionsInternal = {
  dataRegistry: DataRegistry;
  limits?: GasAbilityExecutionRuntimeOptions | undefined;
  now(): number;
  hasActor(actorId: string): boolean;
  requireActor(actorId: string): GasActorRuntimeState;
  persistActor(state: GasActorRuntimeState): void;
  readExecutions(actorId: string): GasAbilityExecutionsComponentState | undefined;
  writeExecutions(actorId: string, state: GasAbilityExecutionsComponentState): void;
  removeExecutions(actorId: string): void;
  canPayCosts(state: GasActorRuntimeState, ability: GasAbilityDefinition): boolean;
  payCosts(
    state: GasActorRuntimeState,
    ability: GasAbilityDefinition,
    context: GasOperationContext
  ): void;
  applyEffects(
    execution: GasAbilityExecutionState,
    ability: GasAbilityDefinition,
    context: GasOperationContext
  ): GasEffectApplicationResult[];
  emitCues(
    cueIds: string[],
    sourceActorId?: string,
    targetActorId?: string,
    context?: GasOperationContext
  ): void;
  trace(
    type: GasTraceEntry["type"],
    entry: Omit<GasTraceEntry, "id" | "type" | "timestamp">,
    context?: GasOperationContext
  ): GasTraceEntry;
  emit(type: string, payload: unknown, context?: GasOperationContext): void;
};

export type GasAbilityExecutionRuntime = {
  activate(input: GasAbilityActivation): GasAbilityActivationResult;
  request(input: GasAbilityExecutionRequest): GasAbilityExecutionRequestResult;
  cancel(input: GasAbilityExecutionCancellation): GasAbilityExecutionCancellationResult;
  get(executionId: GasAbilityExecutionId): GasAbilityExecutionState | undefined;
  list(query?: GasAbilityExecutionQuery): GasAbilityExecutionState[];
  update(): void;
  removeActor(actorId: string, reason: string, context?: GasOperationContext): void;
  capture(): GasAbilityExecutionState[];
  validateRestore(
    executions: GasAbilityExecutionState[],
    context: GasAbilityExecutionRestoreContext
  ): void;
  restore(executions: GasAbilityExecutionState[]): void;
  dispose(): void;
};

export type GasAbilityExecutionRestoreContext = {
  now: number;
  hasActor(actorId: string): boolean;
  requireActor(actorId: string): GasActorRuntimeState;
};

export function createGasAbilityExecutionRuntime(
  options: GasAbilityExecutionRuntimeOptionsInternal
): GasAbilityExecutionRuntime {
  const maxActivePerActor = readPositiveInteger(
    options.limits?.maxActivePerActor,
    DEFAULT_MAX_ACTIVE_PER_ACTOR,
    "gas.invalid_execution_actor_limit"
  );
  const recentHistoryLimit = readNonNegativeInteger(
    options.limits?.recentHistoryLimit,
    DEFAULT_RECENT_HISTORY_LIMIT,
    "gas.invalid_execution_history_limit"
  );
  const activeById = new Map<GasAbilityExecutionId, GasAbilityExecutionState>();
  const activeActorIds = new Set<string>();
  const recentById = new Map<GasAbilityExecutionId, GasAbilityExecutionState>();
  const recentOrder: GasAbilityExecutionId[] = [];
  const requestExecutionByKey = new Map<string, GasAbilityExecutionId>();
  let executionSequence = 0;
  let disposed = false;

  return {
    activate,
    request,
    cancel,
    get,
    list,
    update,
    removeActor,
    capture: () => list({ phases: activePhases() }),
    validateRestore(executions, context) {
      prepareRestore(executions, context);
    },
    restore,
    dispose
  };

  function activate(input: GasAbilityActivation): GasAbilityActivationResult {
    const result = request(input);
    if (result.status === "rejected") {
      return {
        status: "rejected",
        actorId: result.actorId,
        abilityId: result.abilityId,
        targetActorId: result.targetActorId,
        reason: result.message,
        ...(result.correlationId === undefined ? {} : { correlationId: result.correlationId })
      };
    }

    const execution = result.execution;
    return {
      status: "activated",
      executionId: execution.id,
      phase: execution.phase,
      actorId: execution.actorId,
      abilityId: execution.abilityId,
      targetActorId: execution.targetActorId,
      cooldownUntil: execution.cooldownUntil,
      paidCosts: execution.paidCosts.map((cost) => ({ ...cost })),
      appliedEffects: execution.appliedEffects.map((effect) => ({ ...effect })),
      ...(execution.correlationId === undefined ? {} : { correlationId: execution.correlationId })
    };
  }

  function request(input: GasAbilityExecutionRequest): GasAbilityExecutionRequestResult {
    assertActive();
    const actor = options.requireActor(input.actorId);
    const ability = options.dataRegistry.getValue<GasAbilityDefinition>(
      GAS_ABILITY_TYPE,
      input.abilityId
    );
    const duplicate = findDuplicate(input);
    if (duplicate !== undefined) {
      return duplicate;
    }

    const rejection = validateRequest(input, actor, ability);
    if (rejection !== undefined) {
      return reject(input, rejection.reason, rejection.message);
    }
    validateEffects(ability);

    let current = currentExecutions(input.actorId);
    const maxConcurrent = ability.execution?.maxConcurrent ?? 1;
    const sameAbility = current
      .filter((execution) => execution.abilityId === input.abilityId)
      .sort(compareExecutions);
    if (sameAbility.length >= maxConcurrent) {
      if (ability.execution?.overflow === "cancel-oldest") {
        const oldest = sameAbility[0];
        if (oldest !== undefined) {
          cancelInternal(oldest, "ability-overflow", true, input);
          current = currentExecutions(input.actorId);
        }
      } else {
        return reject(input, "ability-concurrency-limit", "ability concurrency limit reached");
      }
    }
    if (current.length >= maxActivePerActor) {
      return reject(input, "actor-execution-limit", "actor execution limit reached");
    }

    executionSequence += 1;
    const now = options.now();
    const executionId = createExecutionId(input, executionSequence);
    const abilityTrace = options.trace(
      "ability.activated",
      {
        actorId: input.actorId,
        abilityId: input.abilityId,
        message: `Activated GAS ability: ${input.abilityId}`,
        details: {
          executionId,
          requestId: input.requestId,
          targetActorId: input.targetActorId
        }
      },
      input
    );
    let execution: GasAbilityExecutionState = {
      id: executionId,
      requestId: input.requestId,
      actorId: input.actorId,
      abilityId: input.abilityId,
      targetActorId: input.targetActorId,
      phase: "requested",
      requestedAt: now,
      phaseStartedAt: now,
      costCommitted: false,
      cooldownCommitted: false,
      paidCosts: [],
      appliedEffects: [],
      correlationId: input.correlationId,
      parentTraceId: abilityTrace.id
    };

    storeActive(execution);
    if (input.requestId !== undefined) {
      requestExecutionByKey.set(requestKey(input.actorId, input.requestId), execution.id);
    }
    options.emit(
      "gas.ability_activated",
      {
        actorId: input.actorId,
        abilityId: input.abilityId,
        executionId,
        requestId: input.requestId,
        targetActorId: input.targetActorId
      },
      executionContext(execution)
    );
    emitPhase(execution, ability);

    execution = commitRequestedPolicies(execution, ability);
    if (isTerminal(execution.phase)) {
      return {
        status: "accepted",
        duplicate: false,
        execution: cloneGasAbilityExecution(execution)
      };
    }
    execution = progress(execution, ability);

    return {
      status: "accepted",
      duplicate: false,
      execution: cloneGasAbilityExecution(execution)
    };
  }

  function cancel(input: GasAbilityExecutionCancellation): GasAbilityExecutionCancellationResult {
    assertActive();
    const execution = get(input.executionId);
    if (execution === undefined) {
      return { status: "rejected", executionId: input.executionId, reason: "missing-execution" };
    }
    if (isTerminal(execution.phase)) {
      return { status: "rejected", executionId: input.executionId, reason: "already-terminal" };
    }
    const ability = options.dataRegistry.getValue<GasAbilityDefinition>(
      GAS_ABILITY_TYPE,
      execution.abilityId
    );
    const beforeCommit = execution.committedAt === undefined;
    const cancellation = ability.execution?.cancellation;
    const allowed = beforeCommit
      ? (cancellation?.beforeCommit ?? "allow") === "allow"
      : (cancellation?.afterCommit ?? "deny") === "allow";
    if (!allowed) {
      return {
        status: "rejected",
        executionId: input.executionId,
        reason: "cancellation-blocked"
      };
    }

    return {
      status: "cancelled",
      execution: cancelInternal(execution, input.reason ?? "requested", false, input)
    };
  }

  function get(executionId: GasAbilityExecutionId): GasAbilityExecutionState | undefined {
    const active = activeById.get(executionId);
    if (active !== undefined) {
      return cloneGasAbilityExecution(active);
    }
    const recent = recentById.get(executionId);
    return recent === undefined ? undefined : cloneGasAbilityExecution(recent);
  }

  function list(query: GasAbilityExecutionQuery = {}): GasAbilityExecutionState[] {
    const phases = query.phases === undefined ? undefined : new Set(query.phases);
    const values = [
      ...activeById.values(),
      ...(query.includeRecent === true ? recentById.values() : [])
    ];
    return values
      .filter((execution) => query.actorId === undefined || execution.actorId === query.actorId)
      .filter(
        (execution) => query.abilityId === undefined || execution.abilityId === query.abilityId
      )
      .filter((execution) => phases === undefined || phases.has(execution.phase))
      .sort(compareExecutions)
      .map(cloneGasAbilityExecution);
  }

  function update(): void {
    if (disposed || activeById.size === 0) {
      return;
    }

    for (const actorId of [...activeActorIds].sort()) {
      if (!options.hasActor(actorId)) {
        removeActor(actorId, "actor-missing");
        continue;
      }
      const actor = options.requireActor(actorId);
      const executions = currentExecutions(actorId).sort(compareExecutions);
      for (const execution of executions) {
        const ability = options.dataRegistry.getValue<GasAbilityDefinition>(
          GAS_ABILITY_TYPE,
          execution.abilityId
        );
        const interruptTag = ability.execution?.interruptTags?.find((tag) =>
          actor.tags.values.includes(tag)
        );
        if (interruptTag !== undefined) {
          cancelInternal(execution, `interrupt-tag:${interruptTag}`, true);
          continue;
        }
        progress(execution, ability);
      }
    }
  }

  function removeActor(actorId: string, reason: string, context?: GasOperationContext): void {
    for (const execution of currentExecutions(actorId).sort(compareExecutions)) {
      cancelInternal(execution, reason, true, context);
    }
    activeActorIds.delete(actorId);
    options.removeExecutions(actorId);
  }

  function restore(executions: GasAbilityExecutionState[]): void {
    assertActive();
    const prepared = prepareRestore(executions, {
      now: options.now(),
      hasActor: options.hasActor,
      requireActor: options.requireActor
    });
    clearRuntimeState();
    for (const execution of prepared) {
      if (execution.requestId !== undefined) {
        requestExecutionByKey.set(requestKey(execution.actorId, execution.requestId), execution.id);
      }
      storeActive(execution);
      executionSequence = Math.max(executionSequence, executionSequenceOf(execution.id));
    }
  }

  function prepareRestore(
    executions: GasAbilityExecutionState[],
    context: GasAbilityExecutionRestoreContext
  ): GasAbilityExecutionState[] {
    const ids = new Set<string>();
    const requestKeys = new Set<string>();
    const actorCounts = new Map<string, number>();
    const abilityCounts = new Map<string, number>();
    const prepared: GasAbilityExecutionState[] = [];
    for (const saved of executions) {
      const execution = cloneGasAbilityExecution(saved);
      validateCheckpointExecution(execution, context.now);
      if (ids.has(execution.id)) {
        throw createGasError(
          "gas.checkpoint_duplicate_execution",
          `Duplicate GAS ability execution: ${execution.id}`
        );
      }
      ids.add(execution.id);
      if (isTerminal(execution.phase)) {
        throw createGasError(
          "gas.checkpoint_terminal_execution",
          `Terminal GAS execution cannot be restored as active: ${execution.id}`
        );
      }
      if (!context.hasActor(execution.actorId)) {
        throw createGasError(
          "gas.checkpoint_missing_execution_actor",
          `Missing GAS execution actor: ${execution.actorId}`
        );
      }
      if (!options.dataRegistry.has(GAS_ABILITY_TYPE, execution.abilityId)) {
        throw createGasError(
          "gas.checkpoint_missing_ability",
          `Missing GAS ability definition: ${execution.abilityId}`
        );
      }
      const actor = context.requireActor(execution.actorId);
      if (!actor.abilities.ids.includes(execution.abilityId)) {
        throw createGasError(
          "gas.checkpoint_unknown_actor_ability",
          `GAS execution actor does not know ability: ${execution.abilityId}`
        );
      }
      if (execution.targetActorId !== undefined && !context.hasActor(execution.targetActorId)) {
        throw createGasError(
          "gas.checkpoint_missing_execution_target",
          `Missing GAS execution target: ${execution.targetActorId}`
        );
      }
      const actorCount = (actorCounts.get(execution.actorId) ?? 0) + 1;
      if (actorCount > maxActivePerActor) {
        throw createGasError(
          "gas.checkpoint_execution_actor_limit",
          `GAS checkpoint exceeds actor execution limit: ${execution.actorId}`
        );
      }
      actorCounts.set(execution.actorId, actorCount);
      const abilityKey = `${execution.actorId}\u0000${execution.abilityId}`;
      const abilityCount = (abilityCounts.get(abilityKey) ?? 0) + 1;
      const ability = options.dataRegistry.getValue<GasAbilityDefinition>(
        GAS_ABILITY_TYPE,
        execution.abilityId
      );
      if (requiresTarget(ability) && execution.targetActorId === undefined) {
        throw createGasError(
          "gas.checkpoint_missing_execution_target",
          `Missing required GAS execution target: ${execution.id}`
        );
      }
      if (abilityCount > (ability.execution?.maxConcurrent ?? 1)) {
        throw createGasError(
          "gas.checkpoint_execution_concurrency",
          `GAS checkpoint exceeds ability concurrency: ${execution.abilityId}`
        );
      }
      abilityCounts.set(abilityKey, abilityCount);
      if (execution.requestId !== undefined) {
        const key = requestKey(execution.actorId, execution.requestId);
        if (requestKeys.has(key)) {
          throw createGasError(
            "gas.checkpoint_duplicate_execution_request",
            `Duplicate GAS execution request: ${execution.requestId}`
          );
        }
        requestKeys.add(key);
      }
      prepared.push(execution);
    }
    return prepared;
  }

  function validateCheckpointExecution(
    execution: GasAbilityExecutionState,
    checkpointNow: number
  ): void {
    if (
      !execution.id ||
      !execution.actorId ||
      !execution.abilityId ||
      !activePhases().includes(execution.phase)
    ) {
      throw createGasError(
        "gas.checkpoint_invalid_execution",
        "Invalid active GAS ability execution"
      );
    }
    if (
      !Number.isFinite(execution.requestedAt) ||
      execution.requestedAt < 0 ||
      !Number.isFinite(execution.phaseStartedAt) ||
      execution.phaseStartedAt < execution.requestedAt ||
      execution.phaseStartedAt > checkpointNow ||
      (execution.phaseEndsAt !== undefined &&
        (!Number.isFinite(execution.phaseEndsAt) ||
          execution.phaseEndsAt < execution.phaseStartedAt))
    ) {
      throw createGasError(
        "gas.checkpoint_invalid_execution_time",
        `Invalid GAS execution timestamps: ${execution.id}`
      );
    }
    if (
      !Array.isArray(execution.paidCosts) ||
      !Array.isArray(execution.appliedEffects) ||
      typeof execution.costCommitted !== "boolean" ||
      typeof execution.cooldownCommitted !== "boolean"
    ) {
      throw createGasError(
        "gas.checkpoint_invalid_execution_state",
        `Invalid GAS execution state: ${execution.id}`
      );
    }
  }

  function dispose(): void {
    if (disposed) {
      return;
    }
    disposed = true;
    clearRuntimeState();
  }

  function validateRequest(
    input: GasAbilityExecutionRequest,
    actor: GasActorRuntimeState,
    ability: GasAbilityDefinition
  ): { reason: GasAbilityExecutionRejectionReason; message: string } | undefined {
    if (!actor.abilities.ids.includes(input.abilityId)) {
      return {
        reason: "actor-does-not-know-ability",
        message: "actor does not know ability"
      };
    }
    if (actor.abilities.disabled.includes(input.abilityId)) {
      return { reason: "ability-disabled", message: "ability is disabled" };
    }
    if ((actor.abilities.cooldowns[input.abilityId] ?? 0) > options.now()) {
      return { reason: "ability-on-cooldown", message: "ability is on cooldown" };
    }
    if (!(ability.requiredTags ?? []).every((tag) => actor.tags.values.includes(tag))) {
      return { reason: "required-tags-missing", message: "required tags are missing" };
    }
    if ((ability.blockedTags ?? []).some((tag) => actor.tags.values.includes(tag))) {
      return { reason: "blocked-tags-present", message: "blocked tags are present" };
    }
    if (!options.canPayCosts(actor, ability)) {
      return { reason: "costs-unavailable", message: "ability costs cannot be paid" };
    }
    if (requiresTarget(ability) && input.targetActorId === undefined) {
      return { reason: "target-required", message: "ability target is required" };
    }
    if (input.targetActorId !== undefined && !options.hasActor(input.targetActorId)) {
      return { reason: "target-missing", message: "ability target is missing" };
    }
    return undefined;
  }

  function findDuplicate(
    input: GasAbilityExecutionRequest
  ): GasAbilityExecutionRequestResult | undefined {
    if (input.requestId === undefined) {
      return undefined;
    }
    const key = requestKey(input.actorId, input.requestId);
    const executionId = requestExecutionByKey.get(key);
    if (executionId === undefined) {
      return undefined;
    }
    const execution = get(executionId);
    if (execution === undefined) {
      requestExecutionByKey.delete(key);
      return undefined;
    }
    if (
      execution.abilityId !== input.abilityId ||
      execution.targetActorId !== input.targetActorId
    ) {
      return reject(
        input,
        "duplicate-request-conflict",
        "duplicate request does not match original ability execution"
      );
    }
    return { status: "accepted", duplicate: true, execution };
  }

  function reject(
    input: GasAbilityExecutionRequest,
    reason: GasAbilityExecutionRejectionReason,
    message: string
  ): GasAbilityExecutionRequestResult {
    const rejectedTrace = options.trace(
      "ability.rejected",
      {
        actorId: input.actorId,
        abilityId: input.abilityId,
        message,
        details: {
          reason,
          requestId: input.requestId,
          targetActorId: input.targetActorId
        }
      },
      input
    );
    options.emit(
      "gas.ability_rejected",
      {
        actorId: input.actorId,
        abilityId: input.abilityId,
        requestId: input.requestId,
        targetActorId: input.targetActorId,
        reason,
        message
      },
      childGasContext(input, rejectedTrace.id)
    );
    return {
      status: "rejected",
      actorId: input.actorId,
      abilityId: input.abilityId,
      targetActorId: input.targetActorId,
      requestId: input.requestId,
      reason,
      message,
      ...(input.correlationId === undefined ? {} : { correlationId: input.correlationId })
    };
  }

  function progress(
    executionInput: GasAbilityExecutionState,
    ability: GasAbilityDefinition
  ): GasAbilityExecutionState {
    let execution = requireActiveExecution(executionInput.id);
    for (let step = 0; step < 6 && !isTerminal(execution.phase); step += 1) {
      const now = options.now();
      if (execution.phaseEndsAt !== undefined && execution.phaseEndsAt > now) {
        return execution;
      }
      const transitionAt = execution.phaseEndsAt ?? now;
      if (execution.phase === "requested") {
        execution = enterPhase(execution, ability, "preparing", transitionAt);
        continue;
      }
      if (execution.phase === "preparing") {
        execution = commitExecution(execution, ability, transitionAt);
        if (isTerminal(execution.phase)) {
          return execution;
        }
        continue;
      }
      if (execution.phase === "committed") {
        execution = enterActive(execution, ability, transitionAt);
        continue;
      }
      if (execution.phase === "active") {
        execution = enterPhase(execution, ability, "recovering", transitionAt);
        continue;
      }
      if (execution.phase === "recovering") {
        return completeExecution(execution, ability, transitionAt);
      }
    }
    return execution;
  }

  function commitRequestedPolicies(
    execution: GasAbilityExecutionState,
    ability: GasAbilityDefinition
  ): GasAbilityExecutionState {
    const actor = options.requireActor(execution.actorId);
    if (ability.execution?.costCommit === "requested") {
      if (!options.canPayCosts(actor, ability)) {
        return cancelInternal(execution, "costs-unavailable-at-request", true);
      }
      options.payCosts(actor, ability, executionContext(execution));
      execution.costCommitted = true;
      execution.paidCosts = (ability.costs ?? []).map((cost) => ({ ...cost }));
    }
    if (ability.execution?.cooldownCommit === "requested") {
      commitCooldown(actor, ability, execution, options.now());
    }
    options.persistActor(actor);
    storeActive(execution);
    return execution;
  }

  function commitExecution(
    execution: GasAbilityExecutionState,
    ability: GasAbilityDefinition,
    transitionAt: number
  ): GasAbilityExecutionState {
    if (requiresTarget(ability)) {
      if (execution.targetActorId === undefined) {
        return cancelInternal(execution, "target-required-at-commit", true);
      }
      if (!options.hasActor(execution.targetActorId)) {
        return cancelInternal(execution, "target-missing-at-commit", true);
      }
    }
    try {
      validateEffects(ability);
    } catch {
      return cancelInternal(execution, "effects-invalid-at-commit", true);
    }
    const actor = options.requireActor(execution.actorId);
    if (!execution.costCommitted) {
      if (!options.canPayCosts(actor, ability)) {
        return cancelInternal(execution, "costs-unavailable-at-commit", true);
      }
      options.payCosts(actor, ability, executionContext(execution));
      execution.costCommitted = true;
      execution.paidCosts = (ability.costs ?? []).map((cost) => ({ ...cost }));
    }
    if (!execution.cooldownCommitted) {
      commitCooldown(actor, ability, execution, transitionAt);
    }
    execution.committedAt = transitionAt;
    options.persistActor(actor);
    return enterPhase(execution, ability, "committed", transitionAt);
  }

  function validateEffects(ability: GasAbilityDefinition): void {
    for (const effect of ability.effects ?? []) {
      assertGasEffectPeriod(
        options.dataRegistry.getValue<GasEffectDefinition>(GAS_EFFECT_TYPE, effect.effectId)
      );
    }
  }

  function enterActive(
    execution: GasAbilityExecutionState,
    ability: GasAbilityDefinition,
    transitionAt: number
  ): GasAbilityExecutionState {
    const active = enterPhase(execution, ability, "active", transitionAt);
    const effects = options.applyEffects(active, ability, executionContext(active));
    active.appliedEffects = effects.map((effect) => ({ ...effect }));
    storeActive(active);
    options.emitCues(
      ability.cues ?? [],
      active.actorId,
      active.targetActorId,
      executionContext(active)
    );
    return active;
  }

  function enterPhase(
    executionInput: GasAbilityExecutionState,
    ability: GasAbilityDefinition,
    phase: Exclude<GasAbilityExecutionPhase, "requested" | "completed" | "cancelled">,
    startedAt: number
  ): GasAbilityExecutionState {
    const execution = cloneGasAbilityExecution(executionInput);
    execution.phase = phase;
    execution.phaseStartedAt = startedAt;
    const duration = phaseDuration(ability, phase);
    execution.phaseEndsAt = duration === undefined ? undefined : startedAt + duration;
    storeActive(execution);
    emitPhase(execution, ability);
    return execution;
  }

  function completeExecution(
    executionInput: GasAbilityExecutionState,
    ability: GasAbilityDefinition,
    completedAt: number
  ): GasAbilityExecutionState {
    const execution = cloneGasAbilityExecution(executionInput);
    execution.phase = "completed";
    execution.phaseStartedAt = completedAt;
    execution.phaseEndsAt = undefined;
    execution.completedAt = completedAt;
    finalize(execution);
    emitPhase(execution, ability);
    if (ability.execution === undefined) {
      return execution;
    }
    const completedTrace = options.trace(
      "ability.completed",
      {
        actorId: execution.actorId,
        abilityId: execution.abilityId,
        message: `Completed GAS ability execution: ${execution.id}`,
        details: { executionId: execution.id, targetActorId: execution.targetActorId }
      },
      executionContext(execution)
    );
    options.emit(
      "gas.ability_execution_completed",
      cloneGasAbilityExecution(execution),
      childGasContext(executionContext(execution), completedTrace.id)
    );
    return execution;
  }

  function cancelInternal(
    executionInput: GasAbilityExecutionState,
    reason: string,
    forced: boolean,
    context?: GasOperationContext
  ): GasAbilityExecutionState {
    const known = get(executionInput.id) ?? executionInput;
    if (isTerminal(known.phase)) {
      return known;
    }
    const execution = cloneGasAbilityExecution(known);
    const cancelledAt = options.now();
    execution.phase = "cancelled";
    execution.phaseStartedAt = cancelledAt;
    execution.phaseEndsAt = undefined;
    execution.cancelledAt = cancelledAt;
    execution.cancellationReason = reason;
    finalize(execution);
    const ability = options.dataRegistry.getValue<GasAbilityDefinition>(
      GAS_ABILITY_TYPE,
      execution.abilityId
    );
    emitPhase(execution, ability, context);
    const cancelledTrace = options.trace(
      "ability.cancelled",
      {
        actorId: execution.actorId,
        abilityId: execution.abilityId,
        message: `Cancelled GAS ability execution: ${execution.id}`,
        details: { executionId: execution.id, reason, phase: known.phase, forced }
      },
      context ?? executionContext(execution)
    );
    options.emit(
      "gas.ability_execution_cancelled",
      cloneGasAbilityExecution(execution),
      childGasContext(context ?? executionContext(execution), cancelledTrace.id)
    );
    return execution;
  }

  function emitPhase(
    execution: GasAbilityExecutionState,
    ability: GasAbilityDefinition,
    context?: GasOperationContext
  ): void {
    const parentContext = context ?? executionContext(execution);
    if (ability.execution === undefined) {
      return;
    }
    const phaseTrace = options.trace(
      "ability.phase_changed",
      {
        actorId: execution.actorId,
        abilityId: execution.abilityId,
        message: `GAS ability execution phase: ${execution.phase}`,
        details: {
          executionId: execution.id,
          phase: execution.phase,
          phaseStartedAt: execution.phaseStartedAt,
          phaseEndsAt: execution.phaseEndsAt,
          targetActorId: execution.targetActorId
        }
      },
      parentContext
    );
    options.emit(
      "gas.ability_execution_phase",
      cloneGasAbilityExecution(execution),
      childGasContext(parentContext, phaseTrace.id)
    );
    options.emitCues(
      ability.execution?.phaseCues?.[execution.phase] ?? [],
      execution.actorId,
      execution.targetActorId,
      childGasContext(parentContext, phaseTrace.id)
    );
  }

  function commitCooldown(
    actor: GasActorRuntimeState,
    ability: GasAbilityDefinition,
    execution: GasAbilityExecutionState,
    committedAt: number
  ): void {
    execution.cooldownCommitted = true;
    if ((ability.cooldownMs ?? 0) <= 0) {
      return;
    }
    execution.cooldownUntil = committedAt + (ability.cooldownMs ?? 0);
    actor.abilities.cooldowns[ability.id] = execution.cooldownUntil;
  }

  function storeActive(executionInput: GasAbilityExecutionState): void {
    const execution = cloneGasAbilityExecution(executionInput);
    activeById.set(execution.id, execution);
    activeActorIds.add(execution.actorId);
    const container = options.readExecutions(execution.actorId) ?? { active: [] };
    const index = container.active.findIndex((candidate) => candidate.id === execution.id);
    const active = container.active.map(cloneGasAbilityExecution);
    if (index >= 0) {
      active[index] = cloneGasAbilityExecution(execution);
    } else {
      active.push(cloneGasAbilityExecution(execution));
    }
    active.sort(compareExecutions);
    options.writeExecutions(execution.actorId, { active });
  }

  function finalize(executionInput: GasAbilityExecutionState): void {
    const execution = cloneGasAbilityExecution(executionInput);
    activeById.delete(execution.id);
    const container = options.readExecutions(execution.actorId);
    if (container !== undefined) {
      const active = container.active
        .filter((candidate) => candidate.id !== execution.id)
        .map(cloneGasAbilityExecution);
      if (active.length === 0) {
        activeActorIds.delete(execution.actorId);
        options.removeExecutions(execution.actorId);
      } else {
        options.writeExecutions(execution.actorId, { active });
      }
    } else if (!hasActiveActorExecution(execution.actorId)) {
      activeActorIds.delete(execution.actorId);
    }
    rememberRecent(execution);
  }

  function rememberRecent(execution: GasAbilityExecutionState): void {
    if (recentHistoryLimit === 0) {
      removeRequestDedupe(execution);
      return;
    }
    recentById.set(execution.id, cloneGasAbilityExecution(execution));
    recentOrder.push(execution.id);
    while (recentOrder.length > recentHistoryLimit) {
      const oldestId = recentOrder.shift();
      if (oldestId === undefined) {
        break;
      }
      const oldest = recentById.get(oldestId);
      recentById.delete(oldestId);
      if (oldest !== undefined) {
        removeRequestDedupe(oldest);
      }
    }
  }

  function currentExecutions(actorId: string): GasAbilityExecutionState[] {
    const container = options.readExecutions(actorId);
    if (container !== undefined) {
      return container.active.map(cloneGasAbilityExecution);
    }
    return [...activeById.values()]
      .filter((execution) => execution.actorId === actorId)
      .map(cloneGasAbilityExecution);
  }

  function requireActiveExecution(executionId: string): GasAbilityExecutionState {
    const execution = activeById.get(executionId);
    if (execution === undefined) {
      throw createGasError(
        "gas.missing_ability_execution",
        `Missing active GAS ability execution: ${executionId}`
      );
    }
    return cloneGasAbilityExecution(execution);
  }

  function clearRuntimeState(): void {
    for (const actorId of activeActorIds) {
      options.removeExecutions(actorId);
    }
    activeById.clear();
    activeActorIds.clear();
    recentById.clear();
    recentOrder.length = 0;
    requestExecutionByKey.clear();
    executionSequence = 0;
  }

  function removeRequestDedupe(execution: GasAbilityExecutionState): void {
    if (execution.requestId === undefined) {
      return;
    }
    const key = requestKey(execution.actorId, execution.requestId);
    if (requestExecutionByKey.get(key) === execution.id) {
      requestExecutionByKey.delete(key);
    }
  }

  function hasActiveActorExecution(actorId: string): boolean {
    for (const execution of activeById.values()) {
      if (execution.actorId === actorId) {
        return true;
      }
    }
    return false;
  }

  function assertActive(): void {
    if (disposed) {
      throw createGasError("gas.disposed", "GAS runtime is disposed");
    }
  }
}

export function cloneGasAbilityExecution(
  execution: GasAbilityExecutionState
): GasAbilityExecutionState {
  return {
    ...execution,
    paidCosts: execution.paidCosts.map((cost) => ({ ...cost })),
    appliedEffects: execution.appliedEffects.map((effect) => ({ ...effect }))
  };
}

function phaseDuration(
  ability: GasAbilityDefinition,
  phase: Exclude<GasAbilityExecutionPhase, "requested" | "completed" | "cancelled">
): number | undefined {
  if (phase === "preparing") {
    return ability.execution?.preparingMs ?? 0;
  }
  if (phase === "active") {
    return ability.execution?.activeMs ?? 0;
  }
  if (phase === "recovering") {
    return ability.execution?.recoveringMs ?? 0;
  }
  return undefined;
}

function requiresTarget(ability: GasAbilityDefinition): boolean {
  return (ability.effects ?? []).some((effect) => (effect.target ?? "target") === "target");
}

function executionContext(execution: GasAbilityExecutionState): GasOperationContext {
  return {
    ...(execution.correlationId === undefined ? {} : { correlationId: execution.correlationId }),
    ...(execution.parentTraceId === undefined ? {} : { parentId: execution.parentTraceId })
  };
}

function requestKey(actorId: string, requestId: string): string {
  return `${actorId}\u0000${requestId}`;
}

function createExecutionId(input: GasAbilityExecutionRequest, sequence: number): string {
  return `${input.actorId}:${input.abilityId}:${sequence}`;
}

function executionSequenceOf(executionId: string): number {
  const separator = executionId.lastIndexOf(":");
  const sequence = separator < 0 ? Number.NaN : Number(executionId.slice(separator + 1));
  return Number.isSafeInteger(sequence) && sequence > 0 ? sequence : 0;
}

function isTerminal(phase: GasAbilityExecutionPhase): boolean {
  return phase === "completed" || phase === "cancelled";
}

function activePhases(): GasAbilityExecutionPhase[] {
  return ["requested", "preparing", "committed", "active", "recovering"];
}

function compareExecutions(
  left: GasAbilityExecutionState,
  right: GasAbilityExecutionState
): number {
  return left.requestedAt - right.requestedAt || left.id.localeCompare(right.id);
}

function readPositiveInteger(value: number | undefined, fallback: number, code: string): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved <= 0) {
    throw createGasError(code, "GAS ability execution limit must be a positive integer", {
      value: resolved
    });
  }
  return resolved;
}

function readNonNegativeInteger(value: number | undefined, fallback: number, code: string): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved < 0) {
    throw createGasError(code, "GAS ability execution limit must be a non-negative integer", {
      value: resolved
    });
  }
  return resolved;
}
