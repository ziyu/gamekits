import {
  createAiModule,
  type AiAgentReadContext,
  type AiHandle,
  type AiIntent,
  type AiSchedulerClass,
  type AiSensorSampler,
  type AiTaskContext,
  type AiTaskExecutor,
  type AiTaskStep,
  type AiUtilityInputResolver
} from "@gamekits/ai-core";
import { defineGameModule } from "@gamekits/core";
import type { DataRegistry } from "@gamekits/data";
import type { GameInstallContext } from "@gamekits/game-runtime";
import type { GasHandle } from "@gamekits/gas";
import type { NavigationHandle, NavigationPoint } from "@gamekits/navigation-core";
import {
  PhysicsTransformComponent,
  PhysicsVelocityComponent,
  type PhysicsQueries
} from "@gamekits/physics-core";
import type { GameWorld } from "@gamekits/world";

import { OUTPOST_NAVIGATION_PROFILE_ID } from "../content/foundation-definitions";
import { OUTPOST_ENEMY_TYPE, type OutpostEnemyDefinition } from "../domain";
import { OutpostGameplayObject } from "./components";
import type {
  OutpostAuthorityAiActionResult,
  OutpostAuthorityAiEnemy,
  OutpostAuthorityCombatPlayer
} from "./authority-combat-types";

const TARGET_FACT = "outpost.target.nearest";
const ACTION_RESULT_KEY = "actionResult";
const ROUTE_REPLAN_DISTANCE = 96;

export type OutpostAuthorityAiActorState = {
  targetActorId?: string | undefined;
  goalId?: string | undefined;
  taskPhase?: string | undefined;
};

export type OutpostAuthorityAiSnapshot = {
  bound: boolean;
  agents: number;
  activeTasks: number;
  delayedDecisions: number;
  rejectedPathRequests: number;
  traceEntries: number;
  navigationRevision: number;
  pendingNavigationRequests: number;
  retainedRoutes: number;
};

export type CreateOutpostAuthorityAiOptions = {
  dataRegistry: DataRegistry;
  world: GameWorld;
  physics: PhysicsQueries;
  navigation: NavigationHandle;
  ai: AiHandle;
  gas: GasHandle;
  enemies(): readonly OutpostAuthorityAiEnemy[];
  players(): ReadonlyMap<string, OutpostAuthorityCombatPlayer>;
  activateAction(enemyId: string, targetActorId: string): OutpostAuthorityAiActionResult;
};

export type OutpostAuthorityAiIntegration = {
  bindingModule: ReturnType<typeof defineGameModule<GameInstallContext>>;
  module: ReturnType<typeof createAiModule>;
  intentModule: ReturnType<typeof defineGameModule<GameInstallContext>>;
  actorState(actorId: string): OutpostAuthorityAiActorState | undefined;
  snapshot(): OutpostAuthorityAiSnapshot;
};

export function createOutpostAuthorityAi(
  options: CreateOutpostAuthorityAiOptions
): OutpostAuthorityAiIntegration {
  const intents: AiIntent[] = [];
  const boundAgentIds = new Set<string>();
  const sensors = createOutpostSensors(options);
  const tasks = createOutpostTasks(options);
  const inputs = createOutpostInputs();
  const schedulerClasses: AiSchedulerClass[] = [
    {
      id: "frontline",
      priority: 20,
      decisionIntervalMultiplier: 1,
      sensorIntervalMultiplier: 1
    },
    {
      id: "boss",
      priority: 40,
      decisionIntervalMultiplier: 0.75,
      sensorIntervalMultiplier: 0.75
    },
    {
      id: "background",
      priority: 1,
      decisionIntervalMultiplier: 3,
      sensorIntervalMultiplier: 3
    }
  ];
  const bindingModule = createBindingModule(options, boundAgentIds);
  const module = createAiModule({
    id: "outpost.authority.ai",
    dataRegistry: options.dataRegistry,
    navigation: options.navigation,
    physics: options.physics,
    handle: options.ai,
    sensors,
    inputs,
    tasks,
    schedulerClasses,
    intentSink: {
      emit(intent) {
        intents.push(intent);
      }
    },
    maxSensorSamplesPerTick: 32,
    maxDecisionsPerTick: 24,
    maxPathRequestsPerTick: 16,
    failureBackoffMs: 180,
    traceRetention: {
      limit: 512,
      kindLimits: { goal: 96, intent: 160 }
    },
    traceProduction: {
      maxEntriesPerUpdate: 96,
      goalScoreDetail: "winner"
    }
  });
  const intentModule = createIntentModule(options, intents);

  return {
    bindingModule,
    module,
    intentModule,
    actorState(actorId) {
      if (!options.ai.isBound()) {
        return undefined;
      }
      const enemy = options.enemies().find((candidate) => candidate.actorId === actorId);
      if (enemy === undefined || !options.ai.hasAgent(enemy.agentId)) {
        return undefined;
      }
      const agent = options.ai.getAgent(enemy.agentId);
      if (agent === undefined) {
        return undefined;
      }
      const targetActorId = stringValue(agent.task?.state.targetActorId);
      const taskPhase = stringValue(agent.task?.state.phase);
      return {
        ...(targetActorId === undefined ? {} : { targetActorId }),
        ...(agent.goalId === undefined ? {} : { goalId: agent.goalId }),
        ...(taskPhase === undefined ? {} : { taskPhase })
      };
    },
    snapshot() {
      const ai = options.ai.isBound() ? options.ai.snapshot() : undefined;
      const navigation = options.navigation.isBound() ? options.navigation.snapshot() : undefined;
      return {
        bound: ai !== undefined,
        agents: ai?.agents.length ?? 0,
        activeTasks: ai?.activeTasks ?? 0,
        delayedDecisions: ai?.delayedDecisions ?? 0,
        rejectedPathRequests: ai?.rejectedPathRequests ?? 0,
        traceEntries: ai?.traceEntries ?? 0,
        navigationRevision: navigation?.revision ?? 0,
        pendingNavigationRequests: navigation?.pendingRequests ?? 0,
        retainedRoutes: navigation?.retainedRoutes ?? 0
      };
    }
  };
}

function createBindingModule(options: CreateOutpostAuthorityAiOptions, boundAgentIds: Set<string>) {
  return defineGameModule<GameInstallContext>({
    id: "outpost.authority.ai-bindings",
    install(ctx) {
      ctx.systems.register({
        id: "outpost.authority.ai-bindings.sync",
        update() {
          const desired = new Set<string>();
          for (const enemy of options.enemies()) {
            if (!enemy.active) {
              continue;
            }
            desired.add(enemy.agentId);
            if (options.ai.hasAgent(enemy.agentId)) {
              continue;
            }
            const definition = options.dataRegistry.getValue<OutpostEnemyDefinition>(
              OUTPOST_ENEMY_TYPE,
              enemy.definitionId
            );
            options.ai.bind({
              agentId: enemy.agentId,
              entityId: enemy.entityId,
              actorId: enemy.actorId,
              definitionId: definition.aiAgent.id
            });
            boundAgentIds.add(enemy.agentId);
          }
          for (const agentId of boundAgentIds) {
            if (desired.has(agentId)) {
              continue;
            }
            if (options.ai.hasAgent(agentId)) {
              options.ai.unbind(agentId, "outpost-enemy-removed");
            }
            boundAgentIds.delete(agentId);
          }
        }
      });
      return () => {
        if (options.ai.isBound()) {
          for (const agentId of boundAgentIds) {
            if (options.ai.hasAgent(agentId)) {
              options.ai.unbind(agentId, "outpost-session-disposed");
            }
          }
        }
        boundAgentIds.clear();
      };
    }
  });
}

function createIntentModule(options: CreateOutpostAuthorityAiOptions, intents: AiIntent[]) {
  return defineGameModule<GameInstallContext>({
    id: "outpost.authority.ai-intents",
    install(ctx) {
      ctx.systems.register({
        id: "outpost.authority.ai-intents.apply",
        update({ elapsed }) {
          const movementByAgentId = new Map<string, NavigationPoint>();
          const actions: Array<Extract<AiIntent, { type: "action" }>> = [];
          for (const intent of intents) {
            if (intent.type === "movement") {
              movementByAgentId.set(intent.agentId, intent.desiredVelocity);
            } else if (intent.type === "action") {
              actions.push(intent);
            }
          }
          intents.length = 0;
          const enemies = options.enemies().filter((enemy) => enemy.active);
          for (const enemy of enemies) {
            const definition = options.dataRegistry.getValue<OutpostEnemyDefinition>(
              OUTPOST_ENEMY_TYPE,
              enemy.definitionId
            );
            const desired = movementByAgentId.get(enemy.agentId) ?? { x: 0, y: 0 };
            const direction = normalize(desired);
            options.world.set(enemy.entityId, PhysicsVelocityComponent, {
              linear: {
                x: direction.x * definition.moveSpeed,
                y: direction.y * definition.moveSpeed
              }
            });
            if (direction.x !== 0 || direction.y !== 0) {
              options.world.set(enemy.entityId, OutpostGameplayObject, {
                facing: Math.atan2(direction.y, direction.x)
              });
            }
          }
          for (const intent of actions) {
            const enemy = enemies.find((candidate) => candidate.agentId === intent.agentId);
            const result =
              enemy === undefined || intent.targetId === undefined
                ? ({ status: "rejected", reason: "target-unavailable" } as const)
                : options.activateAction(enemy.id, intent.targetId);
            if (options.ai.hasAgent(intent.agentId)) {
              options.ai.setBlackboard(intent.agentId, ACTION_RESULT_KEY, {
                actionId: intent.actionId,
                status: result.status,
                ...(result.status === "accepted"
                  ? { executionId: result.executionId }
                  : { reason: result.reason }),
                elapsed
              });
            }
          }
        }
      });
      return () => {
        intents.length = 0;
      };
    }
  });
}

function createOutpostSensors(options: CreateOutpostAuthorityAiOptions): AiSensorSampler[] {
  return [
    {
      id: "outpost.nearest-player",
      sample(context) {
        const entityId = context.agent.entityId;
        const origin =
          entityId === undefined
            ? undefined
            : context.world.get(entityId, PhysicsTransformComponent)?.position;
        if (origin === undefined) {
          return [];
        }
        let nearest:
          | { actorId: string; playerId: string; position: NavigationPoint; distance: number }
          | undefined;
        for (const player of options.players().values()) {
          if (!options.gas.hasActor(player.actorId)) {
            continue;
          }
          const actor = options.gas.getActor(player.actorId);
          if ((actor.attributes.current.health ?? 0) <= 0) {
            continue;
          }
          const position = context.world.get(player.entityId, PhysicsTransformComponent)?.position;
          if (position === undefined) {
            continue;
          }
          const distance = Math.hypot(position.x - origin.x, position.y - origin.y);
          if (nearest === undefined || distance < nearest.distance) {
            nearest = { actorId: player.actorId, playerId: player.playerId, position, distance };
          }
        }
        return nearest === undefined
          ? []
          : [
              {
                key: TARGET_FACT,
                subjectId: nearest.actorId,
                position: { ...nearest.position },
                value: nearest.distance,
                observedAt: context.elapsed,
                expiresAt: context.elapsed + 420,
                confidence: 1,
                metadata: { playerId: nearest.playerId }
              }
            ];
      }
    }
  ];
}

function createOutpostInputs(): AiUtilityInputResolver[] {
  return [
    {
      id: "outpost.target-available",
      read(context) {
        return targetFact(context) === undefined ? 0 : 1;
      }
    }
  ];
}

function createOutpostTasks(options: CreateOutpostAuthorityAiOptions): AiTaskExecutor[] {
  return [
    {
      id: "outpost.assault-target",
      start(context) {
        context.deleteBlackboard(ACTION_RESULT_KEY);
        const target = targetFact(context);
        if (target?.subjectId === undefined || target.position === undefined) {
          return { status: "failed", reason: "target-lost" };
        }
        return assaultStep(options, context, 0, {
          phase: "route",
          phaseElapsedMs: 0,
          targetActorId: target.subjectId,
          targetX: target.position.x,
          targetY: target.position.y,
          routeAttempt: 0,
          routeSeed: Math.round(context.elapsed)
        });
      },
      update(context, deltaMs) {
        return assaultStep(options, context, Math.max(0, deltaMs), context.state);
      },
      cancel(context) {
        releaseRoute(context);
        context.deleteBlackboard(ACTION_RESULT_KEY);
        context.emit({ type: "movement", desiredVelocity: { x: 0, y: 0 } });
      }
    }
  ];
}

function assaultStep(
  options: CreateOutpostAuthorityAiOptions,
  context: AiTaskContext,
  deltaMs: number,
  previous: Record<string, unknown>
): AiTaskStep {
  const enemy = options.enemies().find((candidate) => candidate.agentId === context.agent.agentId);
  const entityId = context.agent.entityId;
  if (enemy === undefined || entityId === undefined || !enemy.active) {
    releaseRoute(context, previous);
    return { status: "failed", reason: "owner-unavailable" };
  }
  const target = targetFact(context);
  const targetActorId = target?.subjectId ?? stringValue(previous.targetActorId);
  const targetPosition = target?.position ?? previousTarget(previous);
  const origin = context.world.get(entityId, PhysicsTransformComponent)?.position;
  if (targetActorId === undefined || targetPosition === undefined || origin === undefined) {
    releaseRoute(context, previous);
    return { status: "failed", reason: "target-lost" };
  }
  const definition = options.dataRegistry.getValue<OutpostEnemyDefinition>(
    OUTPOST_ENEMY_TYPE,
    enemy.definitionId
  );
  const distance = Math.hypot(targetPosition.x - origin.x, targetPosition.y - origin.y);
  const phase = stringValue(previous.phase) ?? "route";
  const phaseElapsedMs = nonNegativeNumber(previous.phaseElapsedMs) + deltaMs;
  const baseState = {
    ...previous,
    targetActorId,
    targetX: targetPosition.x,
    targetY: targetPosition.y
  };

  if (distance <= definition.attackRange * 0.92) {
    releaseRoute(context, previous);
    context.emit({ type: "movement", desiredVelocity: { x: 0, y: 0 } });
    context.emit({ type: "aim", targetId: targetActorId });
    if (phase !== "telegraph" && phase !== "commit" && phase !== "recover") {
      return running({ ...baseState, phase: "telegraph", phaseElapsedMs: 0 }, false);
    }
    if (phase === "telegraph") {
      if (phaseElapsedMs < 120) {
        return running({ ...baseState, phase, phaseElapsedMs }, false);
      }
      return running(
        { ...baseState, phase: "commit", phaseElapsedMs: 0, actionRequested: false },
        false
      );
    }
    if (phase === "commit") {
      const requested = previous.actionRequested === true;
      if (!requested) {
        context.emit({
          type: "action",
          actionId: "enemy-attack",
          targetId: targetActorId
        });
        return running({ ...baseState, phase, phaseElapsedMs, actionRequested: true }, false);
      }
      const result = readActionResult(context);
      if (result === undefined) {
        return running({ ...baseState, phase, phaseElapsedMs, actionRequested: true }, false);
      }
      context.deleteBlackboard(ACTION_RESULT_KEY);
      if (result.status === "rejected") {
        return { status: "failed", reason: `ability-rejected:${result.reason}` };
      }
      return running(
        {
          ...baseState,
          phase: "recover",
          phaseElapsedMs: 0,
          actionRequested: true,
          executionId: result.executionId
        },
        true
      );
    }
    if (phaseElapsedMs < 920) {
      return running({ ...baseState, phase: "recover", phaseElapsedMs }, true);
    }
    return {
      status: "succeeded",
      state: { ...baseState, phase: "complete", phaseElapsedMs: 0 },
      safeToInterrupt: true
    };
  }

  if (phase === "telegraph" || phase === "commit" || phase === "recover") {
    context.deleteBlackboard(ACTION_RESULT_KEY);
    return running(
      {
        ...baseState,
        phase: "route",
        phaseElapsedMs: 0,
        actionRequested: false
      },
      true
    );
  }

  return routeStep(context, origin, targetPosition, deltaMs, baseState);
}

function routeStep(
  context: AiTaskContext,
  origin: NavigationPoint,
  target: NavigationPoint,
  deltaMs: number,
  state: Record<string, unknown>
): AiTaskStep {
  const navigation = context.navigation;
  if (navigation === undefined) {
    return { status: "failed", reason: "navigation-unavailable" };
  }
  const routeId = stringValue(state.routeId);
  const routeGoal = previousRouteGoal(state);
  if (
    routeId !== undefined &&
    routeGoal !== undefined &&
    Math.hypot(routeGoal.x - target.x, routeGoal.y - target.y) > ROUTE_REPLAN_DISTANCE
  ) {
    navigation.releaseRoute(routeId);
    return running(nextRouteState(state, target), true);
  }
  const requestId = stringValue(state.routeRequestId);
  if (routeId === undefined && requestId === undefined) {
    const attempt = nonNegativeInteger(state.routeAttempt);
    const id = `${context.agent.agentId}.route.${nonNegativeInteger(state.routeSeed)}.${attempt}`;
    const acceptedId = navigation.requestPath({
      id,
      requesterId: context.agent.agentId,
      profileId: OUTPOST_NAVIGATION_PROFILE_ID,
      start: origin,
      goal: target,
      goalKey: stringValue(state.targetActorId),
      routeKind: "field"
    });
    context.emit({ type: "navigation-request", requestId: acceptedId });
    context.emit({ type: "movement", desiredVelocity: { x: 0, y: 0 } });
    return running(
      {
        ...state,
        phase: "route",
        phaseElapsedMs: nonNegativeNumber(state.phaseElapsedMs) + deltaMs,
        routeRequestId: acceptedId,
        routeGoalX: target.x,
        routeGoalY: target.y
      },
      true
    );
  }
  if (routeId === undefined && requestId !== undefined) {
    const result = navigation.poll(requestId);
    if (result.status === "pending") {
      context.emit({ type: "movement", desiredVelocity: { x: 0, y: 0 } });
      return running({ ...state, phase: "route" }, true);
    }
    if (result.status !== "complete") {
      return {
        status: "failed",
        reason:
          result.status === "failed" || result.status === "rejected"
            ? `path-${result.reason}`
            : `path-${result.status}`
      };
    }
    return running(
      {
        ...state,
        phase: "move",
        phaseElapsedMs: 0,
        routeId: result.route.routeId,
        routeRequestId: ""
      },
      true
    );
  }
  const sample = navigation.sampleRoute(routeId!, origin);
  if (sample.status !== "valid") {
    if (sample.status !== "missing") {
      navigation.releaseRoute(routeId!);
    }
    return running(nextRouteState(state, target), true);
  }
  const direct = normalize({ x: target.x - origin.x, y: target.y - origin.y });
  const preferred =
    sample.remainingDistance <= 8 || Math.hypot(sample.direction.x, sample.direction.y) <= 0.001
      ? direct
      : sample.direction;
  context.emit({ type: "movement", desiredVelocity: preferred });
  return running(
    {
      ...state,
      phase: "move",
      phaseElapsedMs: nonNegativeNumber(state.phaseElapsedMs) + deltaMs
    },
    true
  );
}

function nextRouteState(state: Record<string, unknown>, target: NavigationPoint) {
  return {
    ...state,
    phase: "route",
    phaseElapsedMs: 0,
    routeId: "",
    routeRequestId: "",
    routeAttempt: nonNegativeInteger(state.routeAttempt) + 1,
    routeGoalX: target.x,
    routeGoalY: target.y
  };
}

function releaseRoute(context: AiTaskContext, state = context.state): void {
  const routeId = stringValue(state.routeId);
  if (routeId !== undefined) {
    context.navigation?.releaseRoute(routeId);
  }
  const requestId = stringValue(state.routeRequestId);
  if (requestId !== undefined) {
    context.navigation?.cancel(requestId);
    context.emit({ type: "navigation-cancel", requestId });
  }
}

function readActionResult(
  context: AiTaskContext
):
  | { status: "accepted"; executionId: string }
  | { status: "rejected"; reason: string }
  | undefined {
  const value = context.blackboard(ACTION_RESULT_KEY);
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  if (value.status === "accepted" && typeof value.executionId === "string") {
    return { status: "accepted", executionId: value.executionId };
  }
  if (value.status === "rejected" && typeof value.reason === "string") {
    return { status: "rejected", reason: value.reason };
  }
  return undefined;
}

function running(state: Record<string, unknown>, safeToInterrupt: boolean): AiTaskStep {
  return { status: "running", state, safeToInterrupt };
}

function previousTarget(state: Record<string, unknown>): NavigationPoint | undefined {
  const x = finiteNumber(state.targetX);
  const y = finiteNumber(state.targetY);
  return x === undefined || y === undefined ? undefined : { x, y };
}

function previousRouteGoal(state: Record<string, unknown>): NavigationPoint | undefined {
  const x = finiteNumber(state.routeGoalX);
  const y = finiteNumber(state.routeGoalY);
  return x === undefined || y === undefined ? undefined : { x, y };
}

function normalize(point: NavigationPoint): NavigationPoint {
  const length = Math.hypot(point.x, point.y);
  return length <= 0.0001 ? { x: 0, y: 0 } : { x: point.x / length, y: point.y / length };
}

function targetFact(context: AiAgentReadContext) {
  return context.facts().find((fact) => fact.key === TARGET_FACT);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function nonNegativeNumber(value: unknown): number {
  const number = finiteNumber(value);
  return number === undefined ? 0 : Math.max(0, number);
}

function nonNegativeInteger(value: unknown): number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : 0;
}
