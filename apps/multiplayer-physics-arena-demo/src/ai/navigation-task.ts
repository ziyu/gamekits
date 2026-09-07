import type { AiPerceptionFact, AiTaskContext, AiTaskStep } from "@gamekits/ai-core";
import type { NavigationPoint } from "@gamekits/navigation-core";

import { ARENA_BOT_NAVIGATION_PROFILE_ID } from "./navigation";
import type { ArenaBotPerceptionSource, ArenaBotVisibleHazard } from "./perception";

const STUCK_DISTANCE = 0.55;
const STUCK_TIMEOUT_MS = 1_250;
const MAX_STUCK_ATTEMPTS = 2;

export function navigateArenaBotToFact(
  context: AiTaskContext,
  source: ArenaBotPerceptionSource,
  fact: AiPerceptionFact | undefined,
  routeKind: "path" | "field"
): AiTaskStep {
  if (fact?.position === undefined) {
    releaseArenaBotNavigation(context);
    return { status: "failed", reason: "target-lost", safeToInterrupt: true };
  }
  const self = source
    .frame(context.agent)
    .actors.find(({ memberId }) => memberId === context.agent.actorId);
  if (self === undefined) {
    releaseArenaBotNavigation(context);
    return { status: "failed", reason: "actor-unavailable", safeToInterrupt: true };
  }
  const origin = toNavigationPoint(self.position);
  const targetKey = `${fact.key}:${fact.subjectId ?? "target"}`;
  if (stringState(context, "targetKey") !== targetKey) {
    releaseArenaBotNavigation(context);
  }
  const progress = updateProgress(context, origin);
  if (progress.status === "failed") {
    releaseArenaBotNavigation(context);
    return progress;
  }
  if (progress.status === "recovering") {
    context.emit({ type: "movement", desiredVelocity: progress.direction });
    return runningState(context, {
      targetKey,
      phase: "stuck-recovery",
      stuckAttempts: progress.stuckAttempts,
      progressX: origin.x,
      progressY: origin.y,
      progressAt: context.elapsed,
      backoffUntil: progress.backoffUntil
    });
  }

  const navigation = context.navigation;
  if (navigation === undefined) {
    emitSteering(context, source, directDirection(origin, fact.position));
    return runningState(context, progressState(context, origin, targetKey, { phase: "direct" }));
  }
  const routeId = stringState(context, "routeId");
  if (routeId !== undefined) {
    const sample = navigation.sampleRoute(routeId, origin);
    if (sample.status === "valid") {
      if (sample.remainingDistance <= 1.2) {
        navigation.releaseRoute(routeId);
        emitSteering(context, source, directDirection(origin, fact.position));
        return runningState(
          context,
          progressState(context, origin, targetKey, { phase: "arriving", routeComplete: true })
        );
      }
      emitSteering(context, source, sample.direction);
      return runningState(
        context,
        progressState(context, origin, targetKey, {
          phase: "following",
          routeId,
          routeRevision: sample.revision,
          remainingDistance: sample.remainingDistance,
          crossTrackDistance: sample.distanceToRoute
        })
      );
    }
    navigation.releaseRoute(routeId);
    return runningState(
      context,
      progressState(context, origin, targetKey, {
        phase: sample.status === "stale" ? "path-stale" : "path-missing",
        routeRetryAt: context.elapsed + retryDelay(context.agent.agentId)
      })
    );
  }

  const requestId = stringState(context, "requestId");
  if (requestId !== undefined) {
    const result = navigation.poll(requestId);
    if (result.status === "pending") {
      context.emit({ type: "movement", desiredVelocity: { x: 0, y: 0 } });
      return runningState(
        context,
        progressState(context, origin, targetKey, { phase: "path-pending", requestId })
      );
    }
    if (result.status === "complete") {
      const sample = navigation.sampleRoute(result.route.routeId, origin);
      if (sample.status !== "valid") {
        navigation.releaseRoute(result.route.routeId);
        return runningState(
          context,
          progressState(context, origin, targetKey, {
            phase: "path-resample",
            routeRetryAt: context.elapsed + retryDelay(context.agent.agentId)
          })
        );
      }
      emitSteering(context, source, sample.direction);
      return runningState(
        context,
        progressState(context, origin, targetKey, {
          phase: "following",
          routeId: result.route.routeId,
          routeRevision: sample.revision,
          remainingDistance: sample.remainingDistance,
          crossTrackDistance: sample.distanceToRoute
        })
      );
    }
    if (
      result.status === "missing" ||
      result.status === "cancelled" ||
      (result.status === "rejected" && result.reason === "queue-full")
    ) {
      return runningState(
        context,
        progressState(context, origin, targetKey, {
          phase: "path-deferred",
          routeRetryAt: context.elapsed + retryDelay(context.agent.agentId)
        })
      );
    }
    releaseArenaBotNavigation(context);
    return {
      status: "failed",
      reason:
        result.status === "failed"
          ? `path-${result.reason}`
          : result.status === "rejected"
            ? `path-${result.reason}`
            : "path-unavailable",
      safeToInterrupt: true
    };
  }

  if (numberState(context, "routeRetryAt") > context.elapsed) {
    emitSteering(context, source, directDirection(origin, fact.position), 0.35);
    return runningState(
      context,
      progressState(context, origin, targetKey, {
        phase: "path-backoff",
        routeRetryAt: numberState(context, "routeRetryAt")
      })
    );
  }
  const nextRequestId = navigation.requestPath({
    requesterId: context.agent.agentId,
    profileId: ARENA_BOT_NAVIGATION_PROFILE_ID,
    start: origin,
    goal: fact.position,
    goalKey: targetKey,
    routeKind
  });
  context.emit({ type: "movement", desiredVelocity: { x: 0, y: 0 } });
  return runningState(
    context,
    progressState(context, origin, targetKey, {
      phase: "path-requested",
      requestId: nextRequestId
    })
  );
}

export function releaseArenaBotNavigation(context: AiTaskContext): void {
  const requestId = stringState(context, "requestId");
  if (requestId !== undefined) context.navigation?.cancel(requestId);
  const routeId = stringState(context, "routeId");
  if (routeId !== undefined) context.navigation?.releaseRoute(routeId);
}

function updateProgress(
  context: AiTaskContext,
  origin: NavigationPoint
):
  | { status: "progressing" }
  | {
      status: "recovering";
      direction: NavigationPoint;
      stuckAttempts: number;
      backoffUntil: number;
    }
  | { status: "failed"; reason: string; safeToInterrupt: true } {
  const progressX = finiteState(context, "progressX", origin.x);
  const progressY = finiteState(context, "progressY", origin.y);
  const progressAt = finiteState(context, "progressAt", context.elapsed);
  if (Math.hypot(origin.x - progressX, origin.y - progressY) >= STUCK_DISTANCE) {
    return { status: "progressing" };
  }
  const backoffUntil = numberState(context, "backoffUntil");
  if (backoffUntil > context.elapsed) {
    const direction = recoveryDirection(
      context.agent.agentId,
      numberState(context, "stuckAttempts")
    );
    return {
      status: "recovering",
      direction,
      stuckAttempts: numberState(context, "stuckAttempts"),
      backoffUntil
    };
  }
  if (context.elapsed - progressAt < STUCK_TIMEOUT_MS) return { status: "progressing" };
  const stuckAttempts = numberState(context, "stuckAttempts") + 1;
  if (stuckAttempts > MAX_STUCK_ATTEMPTS) {
    return { status: "failed", reason: "stuck", safeToInterrupt: true };
  }
  releaseArenaBotNavigation(context);
  return {
    status: "recovering",
    direction: recoveryDirection(context.agent.agentId, stuckAttempts),
    stuckAttempts,
    backoffUntil: context.elapsed + 180 + (stableHash(context.agent.agentId) % 180)
  };
}

function emitSteering(
  context: AiTaskContext,
  source: ArenaBotPerceptionSource,
  preferred: NavigationPoint,
  preferredWeight = 1
): void {
  const frame = source.frame(context.agent);
  const self = frame.actors.find(({ memberId }) => memberId === context.agent.actorId);
  if (self === undefined) return;
  let x = preferred.x * preferredWeight;
  let y = preferred.y * preferredWeight;
  for (const actor of frame.actors) {
    if (actor.memberId === self.memberId || actor.status !== "active") continue;
    const dx = self.position.x - actor.position.x;
    const dy = (self.position.z ?? 0) - (actor.position.z ?? 0);
    const distance = Math.hypot(dx, dy);
    if (distance <= 0.001 || distance >= 2.4) continue;
    const strength = (1 - distance / 2.4) * 0.8;
    x += (dx / distance) * strength;
    y += (dy / distance) * strength;
  }
  for (const hazard of frame.hazards) {
    const avoidance = hazardAvoidance(self.position.x, self.position.z ?? 0, hazard, preferred);
    x += avoidance.x;
    y += avoidance.y;
    if (avoidance.jump) context.emit({ type: "action", actionId: "jump" });
  }
  const magnitude = Math.hypot(x, y);
  context.emit({
    type: "movement",
    desiredVelocity: magnitude <= 0.001 ? { x: 0, y: 0 } : { x: x / magnitude, y: y / magnitude }
  });
}

function hazardAvoidance(
  x: number,
  y: number,
  hazard: ArenaBotVisibleHazard,
  preferred: NavigationPoint
): { x: number; y: number; jump: boolean } {
  if (isArenaTraversalHazard(hazard.kind)) {
    return { x: 0, y: 0, jump: false };
  }
  if (hazard.phase === "idle" || hazard.phase === "recovery") {
    return { x: 0, y: 0, jump: false };
  }
  const dx = x - hazard.position.x;
  const dy = y - (hazard.position.z ?? 0);
  const radius = Math.max(hazard.size.width, hazard.size.depth) * 0.5;
  const distance = Math.hypot(dx, dy);
  const influence = radius + (hazard.active ? 2.2 : 1.2);
  if (distance >= influence || distance <= 0.001) return { x: 0, y: 0, jump: false };
  const strength = (1 - distance / influence) * (hazard.active ? 1.25 : 0.5);
  const preferredLength = Math.hypot(preferred.x, preferred.y);
  const forward =
    preferredLength <= 0.001
      ? { x: -dy / distance, y: dx / distance }
      : { x: preferred.x / preferredLength, y: preferred.y / preferredLength };
  const lateral = { x: -forward.y, y: forward.x };
  const side = dx * lateral.x + dy * lateral.y < 0 ? -1 : 1;
  return {
    x: lateral.x * side * strength,
    y: lateral.y * side * strength,
    jump: hazard.active && distance <= radius + 0.9
  };
}

export function isArenaTraversalHazard(kind: string): boolean {
  return (
    kind === "conveyor" ||
    kind === "moving-platform" ||
    kind === "bounce-pad" ||
    kind === "wind-zone"
  );
}

function progressState(
  context: AiTaskContext,
  origin: NavigationPoint,
  targetKey: string,
  patch: Record<string, unknown>
): Record<string, unknown> {
  const {
    requestId: _requestId,
    routeId: _routeId,
    routeRetryAt: _routeRetryAt,
    ...persistentState
  } = context.state;
  const progressX = finiteState(context, "progressX", origin.x);
  const progressY = finiteState(context, "progressY", origin.y);
  const progressed = Math.hypot(origin.x - progressX, origin.y - progressY) >= STUCK_DISTANCE;
  return {
    ...persistentState,
    ...patch,
    targetKey,
    progressX: progressed ? origin.x : progressX,
    progressY: progressed ? origin.y : progressY,
    progressAt: progressed ? context.elapsed : finiteState(context, "progressAt", context.elapsed),
    stuckAttempts: progressed ? 0 : numberState(context, "stuckAttempts")
  };
}

function runningState(context: AiTaskContext, state: Record<string, unknown>): AiTaskStep {
  return { status: "running", safeToInterrupt: context.task.interruptPolicy !== "never", state };
}

function directDirection(origin: NavigationPoint, target: NavigationPoint): NavigationPoint {
  const x = target.x - origin.x;
  const y = target.y - origin.y;
  const length = Math.hypot(x, y);
  return length <= 0.001 ? { x: 0, y: 0 } : { x: x / length, y: y / length };
}

function recoveryDirection(agentId: string, attempt: number): NavigationPoint {
  const angle = ((stableHash(`${agentId}:${attempt}`) % 360) * Math.PI) / 180;
  return { x: Math.cos(angle), y: Math.sin(angle) };
}

function retryDelay(agentId: string): number {
  return 80 + (stableHash(agentId) % 180);
}

function stableHash(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function toNavigationPoint(point: { x: number; y: number; z?: number | undefined }) {
  return { x: point.x, y: point.z ?? 0, z: point.y };
}

function stringState(context: AiTaskContext, key: string): string | undefined {
  const value = context.state[key];
  return typeof value === "string" ? value : undefined;
}

function numberState(context: AiTaskContext, key: string): number {
  const value = context.state[key];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function finiteState(context: AiTaskContext, key: string, fallback: number): number {
  const value = context.state[key];
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}
