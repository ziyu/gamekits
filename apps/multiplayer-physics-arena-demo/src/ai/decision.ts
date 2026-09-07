import {
  createAiDataTypes,
  createAiRuntime,
  type AiAgentBinding,
  type AiAgentReadContext,
  type AiIntent,
  type AiPerceptionFact,
  type AiRuntime,
  type AiTaskContext,
  type AiTaskExecutor,
  type AiTaskStep,
  type AiUtilityInputResolver
} from "@gamekits/ai-core";
import { createDataRegistry, type DataPack, type DataTypeDefinition } from "@gamekits/data";
import type { NavigationQueries } from "@gamekits/navigation-core";
import type { PhysicsQueries } from "@gamekits/physics-core";

import type { CompiledArenaContent } from "../content/registry";
import type { ArenaBotArchetypeDefinition } from "../content/types";
import type { ArenaMoveInput } from "../shared/config";
import {
  ARENA_HAZARD_FACT,
  ARENA_IMPACT_FACT,
  ARENA_ITEM_FACT,
  ARENA_OBJECTIVE_FACT,
  ARENA_OPPONENT_FACT,
  createArenaBotSensorSamplers,
  type ArenaBotPerceptionSource
} from "./perception";
import {
  isArenaTraversalHazard,
  navigateArenaBotToFact,
  releaseArenaBotNavigation
} from "./navigation-task";

const ARENA_BOT_ACTION_QUEUE_LIMIT = 32;

export type ArenaBotBinding = {
  memberId: string;
  participantId: string;
  archetypeId: string;
};

export type ArenaBotDecisionAction = Extract<AiIntent, { type: "action" | "interaction" }>;

export type ArenaBotDecisionSnapshot = {
  agents: number;
  agentDetails: ArenaBotDecisionAgentSnapshot[];
  activeTasks: number;
  memoryFacts: number;
  delayedDecisions: number;
  delayedSensorSamples: number;
  traceEntries: number;
  pendingActions: number;
  behavior: {
    movementIntents: number;
    jumpIntents: number;
    actionIntents: number;
    interactionIntents: number;
    goalSelections: number;
    taskFailures: number;
    goalSelectionsByGoal: Record<string, number>;
    taskFailuresByReason: Record<string, number>;
  };
  disposed: boolean;
};

export type ArenaBotDecisionAgentSnapshot = {
  memberId: string;
  participantId: string;
  archetypeId: string;
  schedulerClassId: string;
  memoryFacts: number;
  delayedDecisions: number;
  goalId?: string | undefined;
  taskId?: string | undefined;
  taskPhase?: string | undefined;
  targetId?: string | undefined;
  routeId?: string | undefined;
};

export type ArenaBotDecisionRuntime = {
  bind(binding: ArenaBotBinding): void;
  unbind(memberId: string, reason?: string | undefined): void;
  has(memberId: string): boolean;
  update(deltaMs: number, elapsedMs: number): void;
  inputFor(memberId: string, tick: number): ArenaMoveInput;
  drainActions(): ArenaBotDecisionAction[];
  scoreGoals(memberId: string): ReturnType<AiRuntime["scoreGoals"]>;
  agent(memberId: string): ReturnType<AiRuntime["getAgent"]>;
  traces(): ReturnType<AiRuntime["traces"]>;
  snapshot(): ArenaBotDecisionSnapshot;
  dispose(): void;
};

export function createArenaBotDecisionRuntime(options: {
  content: Readonly<CompiledArenaContent>;
  perception: ArenaBotPerceptionSource;
  physics?: PhysicsQueries | undefined;
  navigation?: NavigationQueries | undefined;
}): ArenaBotDecisionRuntime {
  const dataRegistry = createArenaAiDataRegistry(options.content);
  const intents: AiIntent[] = [];
  const controlsByMemberId = new Map<string, { moveX: number; moveZ: number; jump: boolean }>();
  const actions: ArenaBotDecisionAction[] = [];
  const bindingsByMemberId = new Map<string, ArenaBotBinding>();
  const memberIdByAgentId = new Map<string, string>();
  const currentGoalByMemberId = new Map<string, string>();
  const goalSelectionsByGoal = new Map<string, number>();
  const taskFailuresByReason = new Map<string, number>();
  let movementIntents = 0;
  let jumpIntents = 0;
  let actionIntents = 0;
  let interactionIntents = 0;
  let goalSelections = 0;
  let taskFailures = 0;
  let disposed = false;
  const runtime = createAiRuntime({
    id: "arena.authority.ai",
    dataRegistry,
    world: emptyWorld(),
    ...(options.physics === undefined ? {} : { physics: options.physics }),
    ...(options.navigation === undefined ? {} : { navigation: options.navigation }),
    sensors: createArenaBotSensorSamplers(options.perception),
    inputs: createArenaUtilityInputs(),
    tasks: createArenaTaskExecutors(options.perception),
    schedulerClasses: [
      { id: "arena.foreground", priority: 20 },
      {
        id: "arena.background",
        priority: 4,
        sensorIntervalMultiplier: 1.75,
        decisionIntervalMultiplier: 1.5
      }
    ],
    maxSensorSamplesPerTick: 24,
    maxDecisionsPerTick: 8,
    maxPathRequestsPerTick: 8,
    failureBackoffMs: 150,
    traceRetention: { limit: 256, kindLimits: { goal: 72, task: 96, intent: 96 } },
    traceProduction: { maxEntriesPerUpdate: 64, goalScoreDetail: "winner" },
    onTrace(trace) {
      if (trace.label !== "ai.task_failed") return;
      const reason = typeof trace.payload?.reason === "string" ? trace.payload.reason : "unknown";
      taskFailures += 1;
      taskFailuresByReason.set(reason, (taskFailuresByReason.get(reason) ?? 0) + 1);
    },
    intentSink: {
      emit(intent) {
        intents.push(intent);
      }
    }
  });

  return {
    bind(binding) {
      assertActive();
      const existing = bindingsByMemberId.get(binding.memberId);
      if (existing !== undefined) {
        if (
          existing.participantId !== binding.participantId ||
          existing.archetypeId !== binding.archetypeId
        ) {
          throw new Error(`Arena bot binding conflicts for member: ${binding.memberId}`);
        }
        return;
      }
      const archetype = requireArchetype(options.content, binding.archetypeId);
      const agentId = arenaBotAgentId(binding.memberId);
      runtime.bind({
        agentId,
        actorId: binding.memberId,
        definitionId: arenaBotAgentDefinitionId(archetype.id)
      });
      bindingsByMemberId.set(binding.memberId, structuredClone(binding));
      memberIdByAgentId.set(agentId, binding.memberId);
      controlsByMemberId.set(binding.memberId, neutralControl());
    },
    unbind(memberId, reason = "arena-bot-removed") {
      const binding = bindingsByMemberId.get(memberId);
      if (binding === undefined) return;
      const agentId = arenaBotAgentId(memberId);
      runtime.unbind(agentId, reason);
      bindingsByMemberId.delete(memberId);
      memberIdByAgentId.delete(agentId);
      currentGoalByMemberId.delete(memberId);
      controlsByMemberId.delete(memberId);
    },
    has(memberId) {
      return bindingsByMemberId.has(memberId);
    },
    update(deltaMs, elapsedMs) {
      if (disposed) return;
      intents.length = 0;
      runtime.update(deltaMs, elapsedMs);
      for (const intent of intents) {
        const memberId = memberIdByAgentId.get(intent.agentId);
        if (memberId === undefined) continue;
        if (intent.type === "movement") {
          movementIntents += 1;
          const length = Math.hypot(intent.desiredVelocity.x, intent.desiredVelocity.y);
          controlsByMemberId.set(memberId, {
            moveX: length <= 0.001 ? 0 : intent.desiredVelocity.x / length,
            moveZ: length <= 0.001 ? 0 : intent.desiredVelocity.y / length,
            jump: controlsByMemberId.get(memberId)?.jump ?? false
          });
        } else if (intent.type === "action") {
          if (intent.actionId === "jump") {
            jumpIntents += 1;
            const control = controlsByMemberId.get(memberId) ?? neutralControl();
            controlsByMemberId.set(memberId, { ...control, jump: true });
          } else {
            actionIntents += 1;
            enqueueAction(intent);
          }
        } else if (intent.type === "interaction") {
          interactionIntents += 1;
          enqueueAction(intent);
        }
      }
      captureBehaviorTransitions();
    },
    inputFor(memberId, tick) {
      const control = controlsByMemberId.get(memberId) ?? neutralControl();
      controlsByMemberId.set(memberId, { ...control, jump: false });
      return { sequence: tick, ...control };
    },
    drainActions() {
      const drained = actions.map((action) => structuredClone(action));
      actions.length = 0;
      return drained;
    },
    scoreGoals(memberId) {
      return runtime.scoreGoals(arenaBotAgentId(memberId));
    },
    agent(memberId) {
      return runtime.getAgent(arenaBotAgentId(memberId));
    },
    traces() {
      return runtime.traces();
    },
    snapshot() {
      const snapshot = runtime.snapshot();
      return {
        agents: snapshot.agents.length,
        agentDetails: [...bindingsByMemberId.values()]
          .sort((left, right) => left.memberId.localeCompare(right.memberId))
          .map((binding) => projectAgent(binding)),
        activeTasks: snapshot.activeTasks,
        memoryFacts: snapshot.memoryFacts,
        delayedDecisions: snapshot.delayedDecisions,
        delayedSensorSamples: snapshot.delayedSensorSamples,
        traceEntries: snapshot.traceEntries,
        pendingActions: actions.length,
        behavior: {
          movementIntents,
          jumpIntents,
          actionIntents,
          interactionIntents,
          goalSelections,
          taskFailures,
          goalSelectionsByGoal: orderedRecord(goalSelectionsByGoal),
          taskFailuresByReason: orderedRecord(taskFailuresByReason)
        },
        disposed
      };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      runtime.dispose();
      intents.length = 0;
      actions.length = 0;
      bindingsByMemberId.clear();
      memberIdByAgentId.clear();
      currentGoalByMemberId.clear();
      controlsByMemberId.clear();
    }
  };

  function assertActive(): void {
    if (disposed) throw new Error("Arena bot decision runtime is disposed");
  }

  function enqueueAction(action: ArenaBotDecisionAction): void {
    if (actions.length === ARENA_BOT_ACTION_QUEUE_LIMIT) actions.shift();
    actions.push(structuredClone(action));
  }

  function captureBehaviorTransitions(): void {
    for (const binding of bindingsByMemberId.values()) {
      const goalId = runtime.getAgent(arenaBotAgentId(binding.memberId))?.goalId;
      if (goalId === undefined || currentGoalByMemberId.get(binding.memberId) === goalId) continue;
      currentGoalByMemberId.set(binding.memberId, goalId);
      goalSelections += 1;
      goalSelectionsByGoal.set(goalId, (goalSelectionsByGoal.get(goalId) ?? 0) + 1);
    }
  }

  function projectAgent(binding: ArenaBotBinding): ArenaBotDecisionAgentSnapshot {
    const agent = runtime.getAgent(arenaBotAgentId(binding.memberId));
    const taskState = agent?.task?.state;
    return {
      ...structuredClone(binding),
      schedulerClassId: agent?.schedulerClassId ?? "unbound",
      memoryFacts: agent?.memorySize ?? 0,
      delayedDecisions: agent?.delayedDecisions ?? 0,
      ...(agent?.goalId === undefined ? {} : { goalId: agent.goalId }),
      ...(agent?.task?.taskId === undefined ? {} : { taskId: agent.task.taskId }),
      ...(typeof taskState?.phase !== "string" ? {} : { taskPhase: taskState.phase }),
      ...(typeof taskState?.targetId !== "string" ? {} : { targetId: taskState.targetId }),
      ...(typeof taskState?.routeId !== "string" ? {} : { routeId: taskState.routeId })
    };
  }
}

export function createArenaAiDataRegistry(content: Readonly<CompiledArenaContent>) {
  const registry = createDataRegistry();
  for (const definition of createAiDataTypes()) {
    registry.registerType(definition as DataTypeDefinition<any>);
  }
  registry.registerPack(createArenaAiDataPack(content));
  return registry;
}

export function createArenaAiDataPack(content: Readonly<CompiledArenaContent>): DataPack {
  const entries: DataPack["entries"] = [];
  const profilesById = new Map(content.botProfiles.map((profile) => [profile.id, profile]));
  const archetypes = uniqueArchetypes(content);
  for (const archetype of archetypes) {
    const profile = profilesById.get(archetype.profile.id);
    if (profile === undefined) {
      throw new Error(`Arena bot profile is missing: ${archetype.profile.id}`);
    }
    const role = archetype.role;
    const sensorIds = ["opponents", "items", "hazards", "objective", "impacts"].map(
      (kind) => `ai.sensor.arena.${role}.${kind}`
    );
    for (const [index, sampler] of [
      "arena.opponents",
      "arena.items",
      "arena.hazards",
      "arena.objective",
      "arena.impacts"
    ].entries()) {
      entries.push({
        type: "ai.sensor",
        id: sensorIds[index]!,
        data: {
          id: sensorIds[index]!,
          sampler,
          intervalMs: ticksToMs(profile.perceptionIntervalTicks),
          tags: ["arena", role]
        }
      });
    }
    const goalIds = ["advance", "survive", "acquire-item", "attack", "contest", "recover"].map(
      (goal) => `ai.goal.arena.${role}.${goal}`
    );
    for (const goal of createGoalDefinitions(archetype, profile)) {
      entries.push({ type: "ai.goal", id: goal.id, data: goal });
    }
    entries.push({
      type: "ai.agent",
      id: arenaBotAgentDefinitionId(archetype.id),
      data: {
        id: arenaBotAgentDefinitionId(archetype.id),
        sensors: sensorIds.map((id) => ({ type: "ai.sensor", id })),
        goals: goalIds.map((id) => ({ type: "ai.goal", id })),
        decisionIntervalMs: ticksToMs(profile.decisionIntervalTicks),
        memoryLimit: profile.memoryLimit,
        blackboardLimit: 16,
        schedulerClass: "arena.foreground",
        tags: ["arena", role]
      }
    });
  }
  for (const task of createTaskDefinitions()) {
    entries.push({ type: "ai.task", id: task.id, data: task });
  }
  return { id: "knockout-arena.ai", version: content.definitionVersion, entries };
}

function createGoalDefinitions(
  archetype: ArenaBotArchetypeDefinition,
  profile: Readonly<CompiledArenaContent["botProfiles"][number]>
) {
  const role = archetype.role;
  const weights = archetype.goalWeights;
  return [
    goal(role, "advance", "arena.advance", weights.advance, profile, "arena.advance-need"),
    goal(role, "survive", "arena.survive", weights.survive, profile, "arena.risk"),
    goal(
      role,
      "acquire-item",
      "arena.acquire-item",
      weights.acquireItem,
      profile,
      "arena.item-opportunity"
    ),
    goal(role, "attack", "arena.attack", weights.attack, profile, "arena.attack-opportunity"),
    goal(
      role,
      "contest",
      "arena.contest-objective",
      weights.objective,
      profile,
      "arena.contest-need"
    ),
    goal(role, "recover", "arena.recover-position", 1.5, profile, "arena.recovery-need")
  ];
}

function goal(
  role: ArenaBotArchetypeDefinition["role"],
  id: string,
  taskId: string,
  weight: number,
  profile: Readonly<CompiledArenaContent["botProfiles"][number]>,
  input: string
) {
  return {
    id: `ai.goal.arena.${role}.${id}`,
    task: { type: "ai.task" as const, id: `ai.task.${taskId}` },
    considerations: [{ input, curve: { type: "linear" as const, min: 0, max: 1 } }],
    weight: Math.min(1, weight / 1.5),
    minScore: 0.08,
    commitmentMs: ticksToMs(profile.commitmentTicks),
    switchThreshold: 0.12,
    cooldownMs: ticksToMs(Math.max(4, Math.floor(profile.recoveryTicks / 2))),
    tags: ["arena", role]
  };
}

function createTaskDefinitions() {
  return [
    task("arena.advance", "always"),
    task("arena.survive", "always"),
    task("arena.acquire-item", "safe-point"),
    task("arena.attack", "safe-point"),
    task("arena.contest-objective", "always"),
    task("arena.recover-position", "never")
  ];
}

function task(id: string, interruptPolicy: "always" | "safe-point" | "never") {
  return {
    id: `ai.task.${id}`,
    executor: id,
    interruptPolicy,
    timeoutMs: 8_000,
    tags: ["arena"]
  };
}

function createArenaUtilityInputs(): AiUtilityInputResolver[] {
  return [
    utility("arena.advance-need", (context) => {
      if (objectiveStageKind(context) !== "qualifier") return 0;
      const urgency = 0.75 + deadlinePressure(context) * 0.25;
      return urgency * (1 - hazardRisk(context) * 0.85);
    }),
    utility("arena.risk", (context) => Math.max(hazardRisk(context), impactRisk(context))),
    utility("arena.item-opportunity", (context) => {
      const item = bestFact(context, ARENA_ITEM_FACT, (fact) => numeric(fact.value));
      return item === undefined
        ? 0
        : clamp01(numeric(item.value) / (1 + numeric(item.metadata?.distance) * 0.12));
    }),
    utility("arena.attack-opportunity", (context) => {
      const opponent = bestFact(
        context,
        ARENA_OPPONENT_FACT,
        (fact) => numeric(fact.metadata?.instability) - numeric(fact.value) * 0.02
      );
      return opponent === undefined
        ? 0
        : clamp01(
            0.25 +
              numeric(opponent.metadata?.instability) * 0.6 +
              Math.max(0, 1 - numeric(opponent.value) / 10) * 0.3
          );
    }),
    utility("arena.contest-need", (context) => {
      const kind = objectiveStageKind(context);
      return kind === "brawl" ? 0.8 : kind === "final" ? 0.65 : 0.1;
    }),
    utility("arena.recovery-need", (context) => impactRisk(context))
  ];
}

function createArenaTaskExecutors(source: ArenaBotPerceptionSource): AiTaskExecutor[] {
  return [
    movementExecutor(
      "arena.advance",
      source,
      (context) => latestFact(context, ARENA_OBJECTIVE_FACT),
      "field"
    ),
    surviveExecutor(source),
    interactionExecutor(source),
    attackExecutor(source),
    movementExecutor(
      "arena.contest-objective",
      source,
      (context) => latestFact(context, ARENA_OBJECTIVE_FACT),
      "field"
    ),
    recoverExecutor(source)
  ];
}

function movementExecutor(
  id: string,
  source: ArenaBotPerceptionSource,
  target: (context: AiAgentReadContext) => AiPerceptionFact | undefined,
  routeKind: "path" | "field"
): AiTaskExecutor {
  return {
    id,
    start(context) {
      return navigateArenaBotToFact(context, source, target(context), routeKind);
    },
    update(context) {
      return navigateArenaBotToFact(context, source, target(context), routeKind);
    },
    cancel(context) {
      releaseArenaBotNavigation(context);
    }
  };
}

function surviveExecutor(source: ArenaBotPerceptionSource): AiTaskExecutor {
  return {
    id: "arena.survive",
    start(context) {
      return moveAwayFromHazard(context, source);
    },
    update(context) {
      return moveAwayFromHazard(context, source);
    },
    cancel(context) {
      releaseArenaBotNavigation(context);
    }
  };
}

function interactionExecutor(source: ArenaBotPerceptionSource): AiTaskExecutor {
  return {
    id: "arena.acquire-item",
    start(context) {
      const profile = source.profileFor(context.agent);
      return {
        status: "running",
        safeToInterrupt: true,
        state: { readyAt: context.elapsed + ticksToMs(profile.reactionTicks), phase: "approach" }
      };
    },
    update(context) {
      if (context.state.phase === "committed") {
        const profile = source.profileFor(context.agent);
        return context.elapsed - numeric(context.state.committedAt) >=
          ticksToMs(profile.recoveryTicks)
          ? { status: "succeeded", safeToInterrupt: true }
          : { status: "running", safeToInterrupt: false, state: { ...context.state } };
      }
      const item = nearestFact(context, ARENA_ITEM_FACT);
      if (item?.position === undefined || item.subjectId === undefined) {
        releaseArenaBotNavigation(context);
        return { status: "failed", reason: "item-stale", safeToInterrupt: true };
      }
      const self = readSelf(source, context.agent);
      if (self === undefined) {
        releaseArenaBotNavigation(context);
        return { status: "failed", reason: "actor-unavailable", safeToInterrupt: true };
      }
      const distance = distance2(
        self.position.x,
        self.position.z ?? 0,
        item.position.x,
        item.position.y
      );
      if (distance > 1.6) return navigateArenaBotToFact(context, source, item, "path");
      if (context.elapsed < numeric(context.state.readyAt)) {
        return { status: "running", safeToInterrupt: true, state: { ...context.state } };
      }
      context.emit({ type: "interaction", interactionId: "pickup", targetId: item.subjectId });
      releaseArenaBotNavigation(context);
      return {
        status: "running",
        safeToInterrupt: false,
        state: { phase: "committed", targetId: item.subjectId, committedAt: context.elapsed }
      };
    },
    cancel(context) {
      releaseArenaBotNavigation(context);
    }
  };
}

function attackExecutor(source: ArenaBotPerceptionSource): AiTaskExecutor {
  return {
    id: "arena.attack",
    start(context) {
      const profile = source.profileFor(context.agent);
      return {
        status: "running",
        safeToInterrupt: true,
        state: { readyAt: context.elapsed + ticksToMs(profile.reactionTicks), phase: "approach" }
      };
    },
    update(context) {
      if (context.state.phase === "committed") {
        const profile = source.profileFor(context.agent);
        return context.elapsed - numeric(context.state.committedAt) >=
          ticksToMs(profile.recoveryTicks)
          ? { status: "succeeded", safeToInterrupt: true }
          : { status: "running", safeToInterrupt: false, state: { ...context.state } };
      }
      const opponent = nearestFact(context, ARENA_OPPONENT_FACT);
      if (opponent?.position === undefined || opponent.subjectId === undefined) {
        releaseArenaBotNavigation(context);
        return { status: "failed", reason: "target-lost", safeToInterrupt: true };
      }
      const self = readSelf(source, context.agent);
      if (self === undefined) {
        releaseArenaBotNavigation(context);
        return { status: "failed", reason: "actor-unavailable", safeToInterrupt: true };
      }
      const distance = distance2(
        self.position.x,
        self.position.z ?? 0,
        opponent.position.x,
        opponent.position.y
      );
      if (distance > 2.8) return navigateArenaBotToFact(context, source, opponent, "path");
      if (context.elapsed < numeric(context.state.readyAt)) {
        return { status: "running", safeToInterrupt: true, state: { ...context.state } };
      }
      context.emit({ type: "action", actionId: "use", targetId: opponent.subjectId });
      releaseArenaBotNavigation(context);
      return {
        status: "running",
        safeToInterrupt: false,
        state: { phase: "committed", targetId: opponent.subjectId, committedAt: context.elapsed }
      };
    },
    cancel(context) {
      releaseArenaBotNavigation(context);
    }
  };
}

function recoverExecutor(source: ArenaBotPerceptionSource): AiTaskExecutor {
  return {
    id: "arena.recover-position",
    start(context) {
      return recover(context);
    },
    update(context) {
      return recover(context);
    },
    cancel(context) {
      releaseArenaBotNavigation(context);
    }
  };

  function recover(context: AiTaskContext): AiTaskStep {
    const impact = latestFact(context, ARENA_IMPACT_FACT);
    const direction = vector(impact?.metadata?.direction);
    if (direction === undefined) {
      return navigateArenaBotToFact(
        context,
        source,
        latestFact(context, ARENA_OBJECTIVE_FACT),
        "field"
      );
    }
    releaseArenaBotNavigation(context);
    context.emit({ type: "movement", desiredVelocity: { x: -direction.x, y: -direction.z } });
    return { status: "running", safeToInterrupt: false, state: { phase: "recover" } };
  }
}

function moveAwayFromHazard(context: AiTaskContext, source: ArenaBotPerceptionSource): AiTaskStep {
  const hazard = nearestHazardThreat(context);
  if (hazard?.position === undefined) {
    return navigateArenaBotToFact(
      context,
      source,
      latestFact(context, ARENA_OBJECTIVE_FACT),
      "field"
    );
  }
  if (objectiveStageKind(context) === "qualifier") {
    return navigateArenaBotToFact(
      context,
      source,
      latestFact(context, ARENA_OBJECTIVE_FACT),
      "field"
    );
  }
  releaseArenaBotNavigation(context);
  const self = readSelf(source, context.agent);
  if (self === undefined) {
    return { status: "failed", reason: "actor-unavailable", safeToInterrupt: true };
  }
  const direction = normalize2(
    self.position.x - hazard.position.x,
    (self.position.z ?? 0) - hazard.position.y
  );
  context.emit({ type: "movement", desiredVelocity: { x: direction.x, y: direction.y } });
  if (numeric(hazard.metadata?.distance) < 1.4 && hazard.value === true) {
    context.emit({ type: "action", actionId: "jump" });
  }
  return { status: "running", safeToInterrupt: true, state: { phase: "escape" } };
}

function utility(id: string, read: AiUtilityInputResolver["read"]): AiUtilityInputResolver {
  return { id, read };
}

function bestFact(
  context: AiAgentReadContext,
  key: string,
  score: (fact: AiPerceptionFact) => number
): AiPerceptionFact | undefined {
  return context
    .facts()
    .filter((fact) => fact.key === key)
    .sort(
      (left, right) =>
        score(right) - score(left) || (left.subjectId ?? "").localeCompare(right.subjectId ?? "")
    )[0];
}

function nearestFact(context: AiAgentReadContext, key: string): AiPerceptionFact | undefined {
  return context
    .facts()
    .filter((fact) => fact.key === key)
    .sort(
      (left, right) =>
        factDistance(left) - factDistance(right) ||
        (left.subjectId ?? "").localeCompare(right.subjectId ?? "")
    )[0];
}

function latestFact(context: AiAgentReadContext, key: string): AiPerceptionFact | undefined {
  return bestFact(context, key, (fact) => fact.observedAt);
}

function factDistance(fact: AiPerceptionFact): number {
  const metadataDistance = fact.metadata?.distance;
  if (typeof metadataDistance === "number" && Number.isFinite(metadataDistance)) {
    return metadataDistance;
  }
  return typeof fact.value === "number" && Number.isFinite(fact.value)
    ? fact.value
    : Number.POSITIVE_INFINITY;
}

function objectiveStageKind(context: AiAgentReadContext): string {
  return String(latestFact(context, ARENA_OBJECTIVE_FACT)?.metadata?.stageKind ?? "");
}

function deadlinePressure(context: AiAgentReadContext): number {
  return clamp01(numeric(latestFact(context, ARENA_OBJECTIVE_FACT)?.value));
}

function hazardRisk(context: AiAgentReadContext): number {
  const hazard = nearestHazardThreat(context);
  if (hazard === undefined) return 0;
  const distance = numeric(hazard.metadata?.distance);
  const proximity = Math.max(0, 1 - distance / 8);
  return clamp01(proximity * (hazard.value === true ? 1 : 0.45));
}

function nearestHazardThreat(context: AiAgentReadContext): AiPerceptionFact | undefined {
  return context
    .facts()
    .filter(
      (fact) =>
        fact.key === ARENA_HAZARD_FACT && !isArenaTraversalHazard(String(fact.metadata?.kind ?? ""))
    )
    .sort(
      (left, right) =>
        factDistance(left) - factDistance(right) ||
        (left.subjectId ?? "").localeCompare(right.subjectId ?? "")
    )[0];
}

function impactRisk(context: AiAgentReadContext): number {
  return clamp01(
    numeric(bestFact(context, ARENA_IMPACT_FACT, (fact) => numeric(fact.value))?.value)
  );
}

function readSelf(source: ArenaBotPerceptionSource, binding: AiAgentBinding) {
  const actorId = binding.actorId;
  return source.frame(binding).actors.find(({ memberId }) => memberId === actorId);
}

function uniqueArchetypes(content: Readonly<CompiledArenaContent>): ArenaBotArchetypeDefinition[] {
  const byId = new Map<string, ArenaBotArchetypeDefinition>();
  for (const stage of content.stages) {
    for (const archetype of stage.bots) byId.set(archetype.id, archetype);
  }
  return [...byId.values()].sort((left, right) => left.id.localeCompare(right.id));
}

function requireArchetype(
  content: Readonly<CompiledArenaContent>,
  archetypeId: string
): ArenaBotArchetypeDefinition {
  const archetype = uniqueArchetypes(content).find(({ id }) => id === archetypeId);
  if (archetype === undefined) throw new Error(`Arena bot archetype is missing: ${archetypeId}`);
  return archetype;
}

function arenaBotAgentId(memberId: string): string {
  return `ai.${memberId}`;
}

function arenaBotAgentDefinitionId(archetypeId: string): string {
  return `ai.agent.${archetypeId}`;
}

function emptyWorld() {
  return { has: () => false, get: () => undefined, query: () => [], count: () => 0 };
}

function neutralControl() {
  return { moveX: 0, moveZ: 0, jump: false };
}

function ticksToMs(ticks: number): number {
  return (ticks * 1000) / 60;
}

function numeric(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function normalize2(x: number, y: number) {
  const length = Math.hypot(x, y);
  return length <= 0.001 ? { x: 0, y: 0 } : { x: x / length, y: y / length };
}

function distance2(ax: number, ay: number, bx: number, by: number): number {
  return Math.hypot(bx - ax, by - ay);
}

function vector(value: unknown): { x: number; y: number; z: number } | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const record = value as Record<string, unknown>;
  if (![record.x, record.y, record.z].every((item) => typeof item === "number")) return undefined;
  return { x: Number(record.x), y: Number(record.y), z: Number(record.z) };
}

function orderedRecord(values: ReadonlyMap<string, number>): Record<string, number> {
  return Object.fromEntries([...values].sort(([left], [right]) => left.localeCompare(right)));
}
