import type {
  AiAgentReadContext,
  AiSchedulerClass,
  AiSensorSampler,
  AiTaskContext,
  AiTaskExecutor,
  AiUtilityInputResolver
} from "@gamekits/ai-core";
import type { NavigationPoint } from "@gamekits/navigation-core";
import { AI_LAB_NAVIGATION_PROFILE } from "./capabilities";
import { AI_LAB_AGENT_PREFIX } from "./content";
import { AiLabCreature, AiLabPosition, AiLabResource } from "./ecosystem";
import type { AiLabActivity, AiLabResourceKind } from "./types";

export const AI_LAB_SCHEDULER_CLASSES: AiSchedulerClass[] = [
  {
    id: "nimble",
    priority: 20,
    decisionIntervalMultiplier: 0.9,
    sensorIntervalMultiplier: 0.9
  },
  {
    id: "steady",
    priority: 5,
    decisionIntervalMultiplier: 1.15,
    sensorIntervalMultiplier: 1.1
  },
  {
    id: "background",
    priority: 1,
    decisionIntervalMultiplier: 4,
    sensorIntervalMultiplier: 4
  }
];

export function createAiLabSensors(): AiSensorSampler[] {
  return [
    {
      id: "ai-lab.survival",
      sample(context) {
        const entity = context.agent.entityId;
        if (entity === undefined) {
          return [];
        }
        const creature = context.world.get(entity, AiLabCreature);
        const position = context.world.get(entity, AiLabPosition);
        if (!creature || !position) {
          return [];
        }
        const expiresAt = context.elapsed + 760;
        const resourceFacts = (["food", "water", "shelter"] as const)
          .map((kind) => nearestResourceFact(context, position.x, position.y, kind, expiresAt))
          .filter((fact) => fact !== undefined);
        return [
          survivalFact("need.hunger", creature.hunger, context.elapsed, expiresAt),
          survivalFact("need.thirst", creature.thirst, context.elapsed, expiresAt),
          survivalFact("need.fatigue", 1 - creature.energy, context.elapsed, expiresAt),
          survivalFact("survival.health", creature.health, context.elapsed, expiresAt),
          ...resourceFacts,
          sharedAlertFact(context, expiresAt),
          physicsRouteFact(context, position.x, position.y, resourceFacts, expiresAt)
        ];
      }
    }
  ];
}

export function createAiLabInputs(): AiUtilityInputResolver[] {
  return [
    factInput("ai-lab.hunger", "need.hunger"),
    factInput("ai-lab.thirst", "need.thirst"),
    factInput("ai-lab.fatigue", "need.fatigue"),
    factInput("ai-lab.food-access", "resource.food.nearest"),
    factInput("ai-lab.water-access", "resource.water.nearest"),
    factInput("ai-lab.shelter-access", "resource.shelter.nearest"),
    {
      id: "ai-lab.forest-alert",
      read(context) {
        return context.sharedFacts?.fact("forest.alert", "forest")?.value === true ? 1 : 0;
      }
    },
    {
      id: "ai-lab.forest-calm",
      read(context) {
        return context.sharedFacts?.fact("forest.alert", "forest")?.value === true ? 0 : 1;
      }
    },
    {
      id: "ai-lab.contentment",
      read(context) {
        const largestNeed = Math.max(
          factNumber(context, "need.hunger"),
          factNumber(context, "need.thirst"),
          factNumber(context, "need.fatigue")
        );
        return clamp01(1 - largestNeed);
      }
    }
  ];
}

export function createAiLabTasks(): AiTaskExecutor[] {
  return [
    createSeekResourceTask({
      id: "ai-lab.seek-safety",
      kind: "shelter",
      activity: "hide",
      interactionId: "hide",
      prepareDurationMs: 460,
      actionDurationMs: 900,
      holdWhile(context) {
        return context.sharedFacts?.fact("forest.alert", "forest")?.value === true;
      }
    }),
    createSeekResourceTask({
      id: "ai-lab.seek-food",
      kind: "food",
      activity: "forage",
      interactionId: "eat",
      needFact: "need.hunger",
      satisfiedBelow: 0.24,
      prepareDurationMs: 520,
      actionDurationMs: 2_200
    }),
    createSeekResourceTask({
      id: "ai-lab.seek-water",
      kind: "water",
      activity: "drink",
      interactionId: "drink",
      needFact: "need.thirst",
      satisfiedBelow: 0.2,
      prepareDurationMs: 420,
      actionDurationMs: 1_700
    }),
    createSeekResourceTask({
      id: "ai-lab.seek-shelter",
      kind: "shelter",
      activity: "rest",
      interactionId: "rest",
      needFact: "need.fatigue",
      satisfiedBelow: 0.2,
      prepareDurationMs: 680,
      actionDurationMs: 3_000
    }),
    createWanderTask()
  ];
}

type SeekResourceTaskConfig = {
  id: string;
  kind: AiLabResourceKind;
  activity: AiLabActivity;
  interactionId: "eat" | "drink" | "rest" | "hide";
  needFact?: string | undefined;
  satisfiedBelow?: number | undefined;
  prepareDurationMs: number;
  actionDurationMs: number;
  holdWhile?(context: AiTaskContext): boolean;
};

type SeekResourcePhase = "orient" | "route" | "travel" | "prepare" | "interact" | "settle";

const SEEK_ORIENT_DURATION_MS = 520;
const SEEK_SETTLE_DURATION_MS = 480;
const MIN_RESOURCE_STOCK_RATIO = 0.1;
const RESOURCE_RETRY_BLOCK_MS = 6_000;
const RESOURCE_RETRY_BLOCK_KEY = "resourceRetryBlock";
const WANDER_ORIENT_DURATION_MS = 620;
const WANDER_MIN_EXPLORE_DURATION_MS = 1_800;
const WANDER_MAX_EXPLORE_DURATION_MS = 4_800;
const WANDER_OBSERVE_DURATION_MS = 920;
const PATH_RETRY_BASE_MS = 160;
const MAX_PATH_BUDGET_PROBE_REQUESTS = 512;
const STRESS_WANDER_POINTS = [
  { x: 12, y: 12 },
  { x: 34, y: 16 },
  { x: 66, y: 14 },
  { x: 88, y: 30 },
  { x: 82, y: 68 },
  { x: 64, y: 88 },
  { x: 36, y: 84 },
  { x: 10, y: 66 }
] as const;

function createSeekResourceTask(config: SeekResourceTaskConfig): AiTaskExecutor {
  return {
    id: config.id,
    start(context) {
      const targetId = stringMetadata(
        context.fact(`resource.${config.kind}.nearest`)?.metadata,
        "targetId"
      );
      if (!targetId) {
        return { status: "failed", reason: `no-${config.kind}` };
      }
      context.setBlackboard("activity", config.activity);
      return seekResourceStep(context, config, targetId, 0, 0);
    },
    update(context, deltaMs) {
      const targetId = stringState(context, "targetId");
      if (!targetId) {
        return { status: "failed", reason: `lost-${config.kind}` };
      }
      const stepDelta = Math.max(0, deltaMs);
      return seekResourceStep(
        context,
        config,
        targetId,
        numberState(context, "elapsedMs") + stepDelta,
        stepDelta
      );
    },
    cancel(context) {
      releaseNavigationState(context);
      context.deleteBlackboard("activity");
    }
  };
}

function seekResourceStep(
  context: AiTaskContext,
  config: SeekResourceTaskConfig,
  targetId: string,
  elapsedMs: number,
  deltaMs: number
) {
  const entity = context.agent.entityId;
  if (entity === undefined) {
    releaseNavigationState(context);
    context.deleteBlackboard("activity");
    return { status: "failed" as const, reason: "missing-agent-entity" };
  }
  const origin = context.world.get(entity, AiLabPosition);
  const target = findResource(context, targetId, config.kind);
  if (!origin || !target) {
    releaseNavigationState(context);
    context.deleteBlackboard("activity");
    return { status: "failed" as const, reason: `lost-${config.kind}` };
  }
  if (!hasUsableResourceStock(config.kind, target.amount, target.capacity)) {
    releaseNavigationState(context);
    context.setBlackboard(RESOURCE_RETRY_BLOCK_KEY, {
      targetId,
      until: context.elapsed + RESOURCE_RETRY_BLOCK_MS
    });
    context.deleteBlackboard("activity");
    return { status: "failed" as const, reason: `depleted-${config.kind}` };
  }

  runPathBudgetProbe(context, origin, { x: target.x, y: target.y });

  const deltaX = target.x - origin.x;
  const deltaY = target.y - origin.y;
  const distance = Math.hypot(deltaX, deltaY);
  const arrivalRadius = config.kind === "shelter" ? 4.2 : 3.4;
  const arrived = distance <= arrivalRadius;
  const phase = seekResourcePhase(context);
  const phaseElapsedMs = numberState(context, "phaseElapsedMs") + deltaMs;
  const initialDistance = Math.max(distance, numberState(context, "initialDistance"));
  const baseState = {
    elapsedMs,
    targetId,
    targetX: target.x,
    targetY: target.y,
    initialDistance
  };

  if (consumeRouteRefresh(context) && (phase === "route" || phase === "travel")) {
    stopMovement(context);
    return runningSeekStep({
      ...baseState,
      phase: "route",
      phaseElapsedMs: 0,
      progress: 0.12,
      routeMode: "planning",
      routePoints: []
    });
  }

  if (phase === "orient") {
    stopMovement(context);
    if (phaseElapsedMs < SEEK_ORIENT_DURATION_MS) {
      return runningSeekStep({
        ...baseState,
        phase,
        phaseElapsedMs,
        progress: 0.12 * clamp01(phaseElapsedMs / SEEK_ORIENT_DURATION_MS)
      });
    }
    return runningSeekStep({
      ...baseState,
      phase: "route",
      phaseElapsedMs: 0,
      progress: 0.12
    });
  }

  if ((phase === "route" || phase === "travel") && arrived) {
    releaseNavigationState(context);
    stopMovement(context);
    return runningSeekStep({
      ...baseState,
      phase: "prepare",
      phaseElapsedMs: 0,
      progress: 0.62
    });
  }

  if (phase === "route") {
    stopMovement(context);
    const navigation = resolveNavigationStep(context, origin, {
      x: target.x,
      y: target.y,
      goalKey: targetId,
      routeKind: navigationRouteKind(context)
    });
    if (navigation.status === "failed") {
      releaseNavigationState(context);
      context.deleteBlackboard("activity");
      return { status: "failed" as const, reason: navigation.reason };
    }
    if (navigation.status === "waiting") {
      return runningSeekStep({
        ...baseState,
        phase,
        phaseElapsedMs,
        progress: 0.12,
        routeMode: "planning",
        routePoints: [],
        ...waitingNavigationState(navigation)
      });
    }
    return runningSeekStep({
      ...baseState,
      phase: "travel",
      phaseElapsedMs: 0,
      progress: 0.14,
      routeMode: navigation.routeMode,
      routePoints: navigation.routePoints,
      ...(navigation.routeId === undefined ? {} : { routeId: navigation.routeId }),
      ...(navigation.routeComplete === true ? { routeComplete: true } : {})
    });
  }

  if (phase === "travel") {
    const navigation = resolveNavigationStep(context, origin, {
      x: target.x,
      y: target.y,
      goalKey: targetId,
      routeKind: navigationRouteKind(context)
    });
    if (navigation.status === "failed") {
      releaseNavigationState(context);
      context.deleteBlackboard("activity");
      return { status: "failed" as const, reason: navigation.reason };
    }
    if (navigation.status === "waiting") {
      stopMovement(context);
      return runningSeekStep({
        ...baseState,
        phase: "route",
        phaseElapsedMs: 0,
        progress: 0.12,
        routeMode: "planning",
        routePoints: [],
        ...waitingNavigationState(navigation)
      });
    }
    context.emit({
      type: "movement",
      desiredVelocity: navigation.direction
    });
    const travelProgress = clamp01(
      (initialDistance - distance) / Math.max(initialDistance - arrivalRadius, 0.001)
    );
    return runningSeekStep({
      ...baseState,
      phase,
      phaseElapsedMs,
      progress: 0.14 + travelProgress * 0.48,
      routeMode: navigation.routeMode,
      routePoints: navigation.routePoints,
      ...(navigation.routeId === undefined ? {} : { routeId: navigation.routeId }),
      ...(navigation.routeComplete === true ? { routeComplete: true } : {})
    });
  }

  stopMovement(context);

  if (phase === "prepare") {
    if (phaseElapsedMs < config.prepareDurationMs) {
      return runningSeekStep({
        ...baseState,
        phase,
        phaseElapsedMs,
        progress: 0.62 + 0.12 * clamp01(phaseElapsedMs / config.prepareDurationMs)
      });
    }
    return runningSeekStep({
      ...baseState,
      phase: "interact",
      phaseElapsedMs: 0,
      progress: 0.74
    });
  }

  if (phase === "interact") {
    context.emit({
      type: "interaction",
      interactionId: config.interactionId,
      targetId
    });
    const actionComplete = phaseElapsedMs >= config.actionDurationMs;
    const needSatisfied =
      config.needFact === undefined || config.satisfiedBelow === undefined
        ? true
        : factNumber(context, config.needFact) <= config.satisfiedBelow;
    if (!actionComplete || !needSatisfied || config.holdWhile?.(context) === true) {
      return runningSeekStep({
        ...baseState,
        phase,
        phaseElapsedMs,
        progress: 0.74 + 0.2 * clamp01(phaseElapsedMs / config.actionDurationMs)
      });
    }
    return runningSeekStep({
      ...baseState,
      phase: "settle",
      phaseElapsedMs: 0,
      progress: 0.94
    });
  }

  if (phaseElapsedMs < SEEK_SETTLE_DURATION_MS) {
    return runningSeekStep({
      ...baseState,
      phase: "settle",
      phaseElapsedMs,
      progress: 0.94 + 0.06 * clamp01(phaseElapsedMs / SEEK_SETTLE_DURATION_MS)
    });
  }

  context.deleteBlackboard("activity");
  releaseNavigationState(context);
  return {
    status: "succeeded" as const,
    state: { ...baseState, phase: "complete", phaseElapsedMs: 0, progress: 1 },
    safeToInterrupt: true
  };
}

function createWanderTask(): AiTaskExecutor {
  return {
    id: "ai-lab.wander",
    start(context) {
      const target = wanderPoint(context.agent.agentId, context.elapsed);
      context.setBlackboard("activity", "wander");
      return wanderStep(context, target.x, target.y, 0, 0);
    },
    update(context, deltaMs) {
      const stepDelta = Math.max(0, deltaMs);
      return wanderStep(
        context,
        numberState(context, "targetX"),
        numberState(context, "targetY"),
        numberState(context, "elapsedMs") + stepDelta,
        stepDelta
      );
    },
    cancel(context) {
      releaseNavigationState(context);
      context.deleteBlackboard("activity");
    }
  };
}

function wanderStep(
  context: AiTaskContext,
  targetX: number,
  targetY: number,
  elapsedMs: number,
  deltaMs: number
) {
  const entity = context.agent.entityId;
  const origin = entity === undefined ? undefined : context.world.get(entity, AiLabPosition);
  if (!origin) {
    releaseNavigationState(context);
    return { status: "failed" as const, reason: "missing-agent-position" };
  }
  runPathBudgetProbe(context, origin, { x: targetX, y: targetY });
  const deltaX = targetX - origin.x;
  const deltaY = targetY - origin.y;
  const distance = Math.hypot(deltaX, deltaY);
  const phase = wanderPhase(context);
  const phaseElapsedMs = numberState(context, "phaseElapsedMs") + deltaMs;
  const initialDistance = Math.max(distance, numberState(context, "initialDistance"));
  const baseState = { elapsedMs, targetX, targetY, initialDistance };

  if (consumeRouteRefresh(context) && (phase === "route" || phase === "explore")) {
    stopMovement(context);
    return {
      status: "running" as const,
      state: {
        ...baseState,
        phase: "route",
        phaseElapsedMs: 0,
        progress: 0.15,
        routeMode: "planning",
        routePoints: []
      },
      safeToInterrupt: true
    };
  }

  if (phase === "orient") {
    stopMovement(context);
    if (phaseElapsedMs < WANDER_ORIENT_DURATION_MS) {
      return {
        status: "running" as const,
        state: {
          ...baseState,
          phase,
          phaseElapsedMs,
          progress: 0.15 * clamp01(phaseElapsedMs / WANDER_ORIENT_DURATION_MS)
        },
        safeToInterrupt: true
      };
    }
    return {
      status: "running" as const,
      state: { ...baseState, phase: "route", phaseElapsedMs: 0, progress: 0.15 },
      safeToInterrupt: true
    };
  }

  if (phase === "route") {
    stopMovement(context);
    const navigation = resolveNavigationStep(context, origin, {
      x: targetX,
      y: targetY,
      goalKey: wanderGoalKey(context.agent.agentId, targetX, targetY),
      routeKind: navigationRouteKind(context)
    });
    if (navigation.status === "failed") {
      releaseNavigationState(context);
      context.deleteBlackboard("activity");
      return { status: "failed" as const, reason: navigation.reason };
    }
    if (navigation.status === "waiting") {
      return {
        status: "running" as const,
        state: {
          ...baseState,
          phase,
          phaseElapsedMs,
          progress: 0.15,
          routeMode: "planning",
          routePoints: [],
          ...waitingNavigationState(navigation)
        },
        safeToInterrupt: true
      };
    }
    return {
      status: "running" as const,
      state: {
        ...baseState,
        phase: "explore",
        phaseElapsedMs: 0,
        progress: 0.17,
        routeMode: navigation.routeMode,
        routePoints: navigation.routePoints,
        ...(navigation.routeId === undefined ? {} : { routeId: navigation.routeId }),
        ...(navigation.routeComplete === true ? { routeComplete: true } : {})
      },
      safeToInterrupt: true
    };
  }

  if (phase === "explore") {
    const finishedExploring =
      phaseElapsedMs >= WANDER_MAX_EXPLORE_DURATION_MS ||
      (distance <= 2.2 && phaseElapsedMs >= WANDER_MIN_EXPLORE_DURATION_MS);
    if (!finishedExploring) {
      const navigation = resolveNavigationStep(context, origin, {
        x: targetX,
        y: targetY,
        goalKey: wanderGoalKey(context.agent.agentId, targetX, targetY),
        routeKind: navigationRouteKind(context)
      });
      if (navigation.status === "failed") {
        releaseNavigationState(context);
        context.deleteBlackboard("activity");
        return { status: "failed" as const, reason: navigation.reason };
      }
      if (navigation.status === "waiting") {
        stopMovement(context);
        return {
          status: "running" as const,
          state: {
            ...baseState,
            phase: "route",
            phaseElapsedMs: 0,
            progress: 0.15,
            routeMode: "planning",
            routePoints: [],
            ...waitingNavigationState(navigation)
          },
          safeToInterrupt: true
        };
      }
      context.emit({
        type: "movement",
        desiredVelocity: navigation.direction
      });
      const distanceProgress = clamp01(
        (initialDistance - distance) / Math.max(initialDistance - 2.2, 0.001)
      );
      const timeProgress = clamp01(phaseElapsedMs / WANDER_MAX_EXPLORE_DURATION_MS);
      return {
        status: "running" as const,
        state: {
          ...baseState,
          phase,
          phaseElapsedMs,
          progress: 0.17 + Math.max(distanceProgress, timeProgress) * 0.66,
          routeMode: navigation.routeMode,
          routePoints: navigation.routePoints,
          ...(navigation.routeId === undefined ? {} : { routeId: navigation.routeId }),
          ...(navigation.routeComplete === true ? { routeComplete: true } : {})
        },
        safeToInterrupt: true
      };
    }
    releaseNavigationState(context);
    stopMovement(context);
    return {
      status: "running" as const,
      state: { ...baseState, phase: "observe", phaseElapsedMs: 0, progress: 0.83 },
      safeToInterrupt: false
    };
  }

  stopMovement(context);
  if (phaseElapsedMs >= WANDER_OBSERVE_DURATION_MS) {
    releaseNavigationState(context);
    return {
      status: "succeeded" as const,
      state: { ...baseState, phase: "complete", phaseElapsedMs: 0, progress: 1 },
      safeToInterrupt: true
    };
  }
  return {
    status: "running" as const,
    state: {
      ...baseState,
      phase: "observe",
      phaseElapsedMs,
      progress: 0.83 + 0.17 * clamp01(phaseElapsedMs / WANDER_OBSERVE_DURATION_MS)
    },
    safeToInterrupt: false
  };
}

function runningSeekStep(state: Record<string, unknown>) {
  const phase = state.phase;
  return {
    status: "running" as const,
    state,
    safeToInterrupt: phase === "orient" || phase === "route" || phase === "travel"
  };
}

function seekResourcePhase(context: AiTaskContext): SeekResourcePhase {
  const phase = stringState(context, "phase");
  return phase === "route" ||
    phase === "travel" ||
    phase === "prepare" ||
    phase === "interact" ||
    phase === "settle"
    ? phase
    : "orient";
}

function wanderPhase(context: AiTaskContext): "orient" | "route" | "explore" | "observe" {
  const phase = stringState(context, "phase");
  return phase === "route" || phase === "explore" || phase === "observe" ? phase : "orient";
}

function stopMovement(context: AiTaskContext): void {
  context.emit({ type: "movement", desiredVelocity: { x: 0, y: 0 } });
}

type AiLabNavigationStep =
  | {
      status: "ready";
      direction: { x: number; y: number };
      routeMode: "direct" | "detour";
      routePoints: NavigationPoint[];
      routeId?: string | undefined;
      routeComplete?: boolean | undefined;
    }
  | {
      status: "waiting";
      requestId?: string | undefined;
      retryAt?: number | undefined;
    }
  | { status: "failed"; reason: string };

type AiLabReadyNavigationStep = Extract<AiLabNavigationStep, { status: "ready" }>;

function resolveNavigationStep(
  context: AiTaskContext,
  origin: NavigationPoint,
  target: NavigationPoint & { goalKey: string; routeKind: "path" | "field" }
): AiLabNavigationStep {
  const navigation = context.navigation;
  if (navigation === undefined) {
    return directNavigationStep(origin, target);
  }
  if (booleanState(context, "routeComplete")) {
    return { ...directNavigationStep(origin, target), routeComplete: true };
  }
  const routeMode = physicsPathClear(context, origin, target) === false ? "detour" : "direct";

  const routeId = stringState(context, "routeId");
  if (routeId !== undefined) {
    const sample = navigation.sampleRoute(routeId, origin);
    if (sample.status === "valid") {
      if (sample.remainingDistance <= 1.5) {
        navigation.releaseRoute(routeId);
        return { ...directNavigationStep(origin, target), routeComplete: true };
      }
      return {
        status: "ready",
        routeId,
        routeMode,
        routePoints: routePointsState(context),
        direction: normalizeDirection(sample.direction, origin, target)
      };
    }
    navigation.releaseRoute(routeId);
  }

  const requestId = stringState(context, "requestId");
  if (requestId !== undefined) {
    return resolveNavigationRequest(context, requestId, origin, target);
  }

  const retryAt = numberState(context, "routeRetryAt");
  if (retryAt > context.elapsed) {
    return { status: "waiting", retryAt };
  }

  const nextRequestId = navigation.requestPath({
    requesterId: context.agent.agentId,
    profileId: AI_LAB_NAVIGATION_PROFILE.id,
    start: { x: origin.x, y: origin.y },
    goal: { x: target.x, y: target.y },
    goalKey: target.goalKey,
    routeKind: target.routeKind
  });
  return resolveNavigationRequest(context, nextRequestId, origin, target);
}

function resolveNavigationRequest(
  context: AiTaskContext,
  requestId: string,
  origin: NavigationPoint,
  target: NavigationPoint & { goalKey: string; routeKind: "path" | "field" }
): AiLabNavigationStep {
  const navigation = context.navigation;
  if (navigation === undefined) {
    return directNavigationStep(origin, target);
  }
  const result = navigation.poll(requestId);
  if (result.status === "pending") {
    return { status: "waiting", requestId };
  }
  if (result.status === "complete") {
    const sample = navigation.sampleRoute(result.route.routeId, origin);
    if (sample.status !== "valid") {
      navigation.releaseRoute(result.route.routeId);
      return { status: "waiting" };
    }
    if (sample.remainingDistance <= 1.5) {
      navigation.releaseRoute(result.route.routeId);
      return { ...directNavigationStep(origin, target), routeComplete: true };
    }
    return {
      status: "ready",
      routeId: result.route.routeId,
      routeMode: physicsPathClear(context, origin, target) === false ? "detour" : "direct",
      routePoints:
        result.route.kind === "path"
          ? [
              { x: origin.x, y: origin.y },
              ...result.route.points.map((point) => ({ x: point.x, y: point.y })),
              { x: target.x, y: target.y }
            ]
          : [
              { x: origin.x, y: origin.y },
              { x: target.x, y: target.y }
            ],
      direction: normalizeDirection(sample.direction, origin, target)
    };
  }
  if (
    result.status === "missing" ||
    (result.status === "rejected" && result.reason === "queue-full")
  ) {
    return { status: "waiting", retryAt: context.elapsed + pathRetryDelay(context.agent.agentId) };
  }
  if (result.status === "cancelled") {
    return { status: "waiting", retryAt: context.elapsed + pathRetryDelay(context.agent.agentId) };
  }
  return {
    status: "failed",
    reason:
      result.status === "failed"
        ? `path-${result.reason}`
        : result.status === "rejected"
          ? `path-${result.reason}`
          : "path-unavailable"
  };
}

function directNavigationStep(
  origin: NavigationPoint,
  target: NavigationPoint
): AiLabReadyNavigationStep {
  return {
    status: "ready",
    direction: directDirection(origin, target),
    routeMode: "direct",
    routePoints: [
      { x: origin.x, y: origin.y },
      { x: target.x, y: target.y }
    ]
  };
}

function directDirection(
  origin: NavigationPoint,
  target: NavigationPoint
): { x: number; y: number } {
  const deltaX = target.x - origin.x;
  const deltaY = target.y - origin.y;
  const distance = Math.hypot(deltaX, deltaY);
  return { x: deltaX / Math.max(distance, 0.001), y: deltaY / Math.max(distance, 0.001) };
}

function waitingNavigationState(navigation: Extract<AiLabNavigationStep, { status: "waiting" }>): {
  requestId?: string;
  routeRetryAt?: number;
} {
  return {
    ...(navigation.requestId === undefined ? {} : { requestId: navigation.requestId }),
    ...(navigation.retryAt === undefined ? {} : { routeRetryAt: navigation.retryAt })
  };
}

function navigationRouteKind(context: AiTaskContext): "path" | "field" {
  return isStressAgent(context.agent.agentId) ? "field" : "path";
}

function pathRetryDelay(agentId: string): number {
  return PATH_RETRY_BASE_MS + (stableHash(agentId) % 240);
}

function normalizeDirection(
  direction: NavigationPoint,
  origin: NavigationPoint,
  target: NavigationPoint
): { x: number; y: number } {
  const magnitude = Math.hypot(direction.x, direction.y);
  return magnitude <= 0.001
    ? directDirection(origin, target)
    : { x: direction.x / magnitude, y: direction.y / magnitude };
}

function releaseNavigationState(context: AiTaskContext): void {
  if (context.navigation === undefined) {
    return;
  }
  const requestId = stringState(context, "requestId");
  if (requestId !== undefined) {
    context.navigation.cancel(requestId);
  }
  const routeId = stringState(context, "routeId");
  if (routeId !== undefined) {
    context.navigation.releaseRoute(routeId);
  }
}

function physicsPathClear(
  context: AiTaskContext,
  origin: NavigationPoint,
  target: NavigationPoint
): boolean | undefined {
  if (context.physics === undefined) {
    return undefined;
  }
  const deltaX = target.x - origin.x;
  const deltaY = target.y - origin.y;
  const distance = Math.hypot(deltaX, deltaY);
  if (distance <= 0.001) {
    return true;
  }
  return (
    context.physics.shapeCast(
      { type: "circle", radius: AI_LAB_NAVIGATION_PROFILE.radius },
      { x: origin.x, y: origin.y },
      { x: deltaX / distance, y: deltaY / distance },
      { maxDistance: distance, mode: "closest", maxResults: 1, sort: "distance" }
    ).length === 0
  );
}

function routePointsState(context: AiTaskContext): NavigationPoint[] {
  const value = context.state.routePoints;
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((point) => {
    if (point === null || typeof point !== "object" || Array.isArray(point)) {
      return [];
    }
    const x = point.x;
    const y = point.y;
    return typeof x === "number" &&
      typeof y === "number" &&
      Number.isFinite(x) &&
      Number.isFinite(y)
      ? [{ x, y }]
      : [];
  });
}

function consumeRouteRefresh(context: AiTaskContext): boolean {
  const requested = context.blackboard("forceRouteRefresh") !== undefined;
  if (requested) {
    releaseNavigationState(context);
    context.deleteBlackboard("forceRouteRefresh");
  }
  return requested;
}

function runPathBudgetProbe(
  context: AiTaskContext,
  origin: NavigationPoint,
  target: NavigationPoint
): void {
  const probe = context.blackboard("pathBudgetProbe");
  if (probe === null || typeof probe !== "object" || Array.isArray(probe)) {
    return;
  }
  const requestedCount = probe.requests;
  const count =
    typeof requestedCount === "number" && Number.isFinite(requestedCount)
      ? Math.max(0, Math.min(MAX_PATH_BUDGET_PROBE_REQUESTS, Math.floor(requestedCount)))
      : 0;
  const navigation = context.navigation;
  if (navigation !== undefined) {
    for (let index = 0; index < count; index += 1) {
      const requestId = navigation.requestPath({
        requesterId: `${context.agent.agentId}.budget-probe`,
        profileId: AI_LAB_NAVIGATION_PROFILE.id,
        start: { x: origin.x, y: origin.y },
        goal: { x: target.x, y: target.y },
        goalKey: `budget-probe.${index}`,
        routeKind: "path"
      });
      const result = navigation.poll(requestId);
      if (result.status === "complete") {
        navigation.releaseRoute(result.route.routeId);
      } else {
        navigation.cancel(requestId);
      }
    }
  }
  context.deleteBlackboard("pathBudgetProbe");
}

function sharedAlertFact(context: AiAgentReadContext, expiresAt: number) {
  const shared = context.sharedFacts?.fact("forest.alert", "forest");
  return {
    key: "shared.forest-alert",
    subjectId: "forest",
    value: shared?.value === true,
    observedAt: context.elapsed,
    expiresAt,
    confidence: shared?.confidence ?? 0
  };
}

function physicsRouteFact(
  context: AiAgentReadContext,
  x: number,
  y: number,
  resourceFacts: ResourceFact[],
  expiresAt: number
) {
  const target = [...resourceFacts].sort(
    (left, right) =>
      metadataNumber(left.metadata, "distance") - metadataNumber(right.metadata, "distance")
  )[0];
  const targetId = stringMetadata(target?.metadata, "targetId");
  if (context.physics === undefined || target?.position === undefined || targetId === undefined) {
    return {
      key: "physics.route-clear",
      value: "unavailable",
      observedAt: context.elapsed,
      expiresAt,
      confidence: 0
    };
  }
  const deltaX = target.position.x - x;
  const deltaY = target.position.y - y;
  const distance = Math.hypot(deltaX, deltaY);
  const hits = context.physics.raycast(
    { x, y },
    { x: deltaX / Math.max(distance, 0.001), y: deltaY / Math.max(distance, 0.001) },
    { maxDistance: distance, mode: "closest", maxResults: 1, sort: "distance" }
  );
  const blocker = hits[0];
  return {
    key: "physics.route-clear",
    subjectId: targetId,
    value: blocker === undefined,
    observedAt: context.elapsed,
    expiresAt,
    confidence: 1,
    metadata: {
      targetId,
      distance,
      ...(blocker === undefined ? {} : { blockerId: blocker.colliderId })
    }
  };
}

function nearestResourceFact(
  context: AiAgentReadContext,
  x: number,
  y: number,
  kind: AiLabResourceKind,
  expiresAt: number
) {
  const blockedTargetId = resourceRetryBlockTarget(context);
  let nearest:
    | { id: string; x: number; y: number; distance: number; amount: number; capacity: number }
    | undefined;
  for (const entity of context.world.query([AiLabResource, AiLabPosition])) {
    const resource = context.world.get(entity, AiLabResource);
    const position = context.world.get(entity, AiLabPosition);
    if (!resource || !position || resource.kind !== kind) {
      continue;
    }
    if (
      resource.id === blockedTargetId ||
      !hasUsableResourceStock(kind, resource.amount, resource.capacity)
    ) {
      continue;
    }
    const distance = Math.hypot(position.x - x, position.y - y);
    if (!nearest || distance < nearest.distance) {
      nearest = {
        id: resource.id,
        x: position.x,
        y: position.y,
        distance,
        amount: resource.amount,
        capacity: resource.capacity
      };
    }
  }
  if (!nearest) {
    return undefined;
  }
  const distanceScore = 1 - Math.min(1, nearest.distance / 105);
  const stockScore = kind === "shelter" ? 1 : nearest.amount / Math.max(1, nearest.capacity);
  return {
    key: `resource.${kind}.nearest`,
    position: { x: nearest.x, y: nearest.y },
    value: clamp01(distanceScore * 0.72 + stockScore * 0.28),
    observedAt: context.elapsed,
    expiresAt,
    confidence: 0.94,
    metadata: { targetId: nearest.id, distance: nearest.distance, stock: stockScore }
  };
}

type ResourceFact = NonNullable<ReturnType<typeof nearestResourceFact>>;

function hasUsableResourceStock(
  kind: AiLabResourceKind,
  amount: number,
  capacity: number
): boolean {
  return kind === "shelter" || amount / Math.max(1, capacity) >= MIN_RESOURCE_STOCK_RATIO;
}

function resourceRetryBlockTarget(context: AiAgentReadContext): string | undefined {
  const block = context.blackboard(RESOURCE_RETRY_BLOCK_KEY);
  if (block === null || typeof block !== "object" || Array.isArray(block)) {
    return undefined;
  }
  const targetId = block.targetId;
  const until = block.until;
  return typeof targetId === "string" && typeof until === "number" && until > context.elapsed
    ? targetId
    : undefined;
}

function findResource(context: AiAgentReadContext, id: string, kind: AiLabResourceKind) {
  for (const entity of context.world.query([AiLabResource, AiLabPosition])) {
    const resource = context.world.get(entity, AiLabResource);
    const position = context.world.get(entity, AiLabPosition);
    if (resource?.id === id && resource.kind === kind && position) {
      return { ...resource, x: position.x, y: position.y, entity };
    }
  }
  return undefined;
}

function survivalFact(key: string, value: number, observedAt: number, expiresAt: number) {
  return { key, value: clamp01(value), observedAt, expiresAt, confidence: 1 };
}

function factInput(id: string, key: string): AiUtilityInputResolver {
  return { id, read: (context) => factNumber(context, key) };
}

function factNumber(context: AiAgentReadContext, key: string): number {
  const value = context.fact(key)?.value;
  return typeof value === "number" && Number.isFinite(value) ? clamp01(value) : 0;
}

function numberState(context: AiTaskContext, key: string): number {
  const value = context.state[key];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function stringState(context: AiTaskContext, key: string): string | undefined {
  const value = context.state[key];
  return typeof value === "string" ? value : undefined;
}

function booleanState(context: AiTaskContext, key: string): boolean {
  return context.state[key] === true;
}

function stringMetadata(metadata: Record<string, unknown> | undefined, key: string) {
  const value = metadata?.[key];
  return typeof value === "string" ? value : undefined;
}

function metadataNumber(metadata: Record<string, unknown> | undefined, key: string): number {
  const value = metadata?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : Number.POSITIVE_INFINITY;
}

function wanderPoint(agentId: string, elapsed: number): { x: number; y: number } {
  if (isStressAgent(agentId)) {
    const epoch = Math.floor(elapsed / 8_000);
    const point =
      STRESS_WANDER_POINTS[(stableHash(agentId) + epoch) % STRESS_WANDER_POINTS.length]!;
    return { ...point };
  }
  const seed = stableHash(`${agentId}:${Math.floor(elapsed / 4_000)}`);
  return {
    x: 9 + (seed % 83),
    y: 10 + (Math.floor(seed / 97) % 79)
  };
}

function wanderGoalKey(agentId: string, targetX: number, targetY: number): string {
  return isStressAgent(agentId)
    ? `wander.pool.${Math.round(targetX)}.${Math.round(targetY)}`
    : `wander.${Math.round(targetX)}.${Math.round(targetY)}`;
}

function isStressAgent(agentId: string): boolean {
  return agentId.startsWith(`${AI_LAB_AGENT_PREFIX}stress-`);
}

function stableHash(value: string): number {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return hash >>> 0;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}
