import type {
  AiAgentBinding,
  AiAgentReadContext,
  AiPerceptionFact,
  AiSensorSampler
} from "@gamekits/ai-core";
import type { NavigationPoint } from "@gamekits/navigation-core";
import type { PhysicsVector } from "@gamekits/physics-core";

import type {
  ArenaBotSkillProfileDefinition,
  ArenaBoxSize,
  ArenaHazardKind,
  ArenaItemKind,
  ArenaStageKind
} from "../content/types";
import type { ArenaHazardPhase } from "../shared/arena-stage-course";

export const ARENA_OPPONENT_FACT = "arena.opponent";
export const ARENA_ITEM_FACT = "arena.item";
export const ARENA_HAZARD_FACT = "arena.hazard";
export const ARENA_OBJECTIVE_FACT = "arena.objective";
export const ARENA_IMPACT_FACT = "arena.impact";

export type ArenaBotVisibleActor = {
  participantId: string;
  memberId: string;
  position: PhysicsVector;
  linearVelocity: PhysicsVector;
  status: "active" | "qualified" | "eliminated" | "spectator" | "disconnected";
  instability: number;
  motorMode?: string | undefined;
  carriedItemId?: string | undefined;
};

export type ArenaBotVisibleItem = {
  instanceId: string;
  generation: number;
  definitionId: string;
  kind: ArenaItemKind;
  position: PhysicsVector;
  value: number;
  contestedBy: number;
};

export type ArenaBotVisibleHazard = {
  id: string;
  kind: ArenaHazardKind;
  phase: ArenaHazardPhase;
  active: boolean;
  position: PhysicsVector;
  size: ArenaBoxSize;
  nextTransitionTick: number;
  safeScale?: number | undefined;
};

export type ArenaBotVisibleImpact = {
  targetMemberId: string;
  sourceMemberId?: string | undefined;
  tick: number;
  direction: PhysicsVector;
  severity: number;
};

export type ArenaBotObjectiveFact = {
  id: string;
  position: PhysicsVector;
  routeOrder?: number | undefined;
  checkpointCount: number;
  qualificationCount: number;
  activeParticipants: number;
  completedParticipants: number;
  stageProgress: number;
};

export type ArenaBotPerceptionFrame = {
  tick: number;
  elapsedMs: number;
  stageId: string;
  stageKind: ArenaStageKind;
  actors: readonly ArenaBotVisibleActor[];
  items: readonly ArenaBotVisibleItem[];
  hazards: readonly ArenaBotVisibleHazard[];
  impacts: readonly ArenaBotVisibleImpact[];
  objective: ArenaBotObjectiveFact;
};

/** Authority-only read model. Implementations must not expose client input or future schedule facts. */
export type ArenaBotPerceptionSource = {
  frame(agent?: AiAgentBinding | undefined): ArenaBotPerceptionFrame;
  profileFor(agent: AiAgentBinding): ArenaBotSkillProfileDefinition;
};

export function createArenaBotSensorSamplers(source: ArenaBotPerceptionSource): AiSensorSampler[] {
  return [
    opponentSampler(source),
    itemSampler(source),
    hazardSampler(source),
    objectiveSampler(source),
    impactSampler(source)
  ];
}

function opponentSampler(source: ArenaBotPerceptionSource): AiSensorSampler {
  return {
    id: "arena.opponents",
    sample(context) {
      const frame = source.frame(context.agent);
      const profile = source.profileFor(context.agent);
      const self = selfActor(frame, context.agent);
      if (self === undefined || self.status !== "active") return [];
      return frame.actors
        .filter(
          (actor) =>
            actor.memberId !== self.memberId &&
            actor.status === "active" &&
            distance3(self.position, actor.position) <= profile.perceptionRadius
        )
        .map((actor) => ({ actor, distance: distance3(self.position, actor.position) }))
        .sort(
          (left, right) =>
            left.distance - right.distance ||
            left.actor.participantId.localeCompare(right.actor.participantId)
        )
        .filter(({ actor, distance }) => hasLineOfSight(context, self, actor, distance))
        .slice(0, profile.maxOpponents)
        .map(({ actor, distance }) =>
          perceptionFact({
            key: ARENA_OPPONENT_FACT,
            subjectId: actor.participantId,
            position: toNavigationPoint(actor.position),
            observedAt: context.elapsed,
            profile,
            confidence: confidence(distance, profile.perceptionRadius),
            value: distance,
            metadata: {
              memberId: actor.memberId,
              relativeVelocity: subtract(actor.linearVelocity, self.linearVelocity),
              instability: actor.instability,
              motorMode: actor.motorMode ?? "unknown",
              carriedItemId: actor.carriedItemId ?? "",
              lineOfSight: true
            }
          })
        );
    }
  };
}

function itemSampler(source: ArenaBotPerceptionSource): AiSensorSampler {
  return {
    id: "arena.items",
    sample(context) {
      const frame = source.frame(context.agent);
      const profile = source.profileFor(context.agent);
      const self = selfActor(frame, context.agent);
      if (self === undefined || self.status !== "active" || self.carriedItemId !== undefined) {
        return [];
      }
      return frame.items
        .map((item) => ({ item, distance: distance3(self.position, item.position) }))
        .filter(({ distance }) => distance <= profile.perceptionRadius)
        .sort(
          (left, right) =>
            left.distance - right.distance ||
            left.item.instanceId.localeCompare(right.item.instanceId)
        )
        .slice(0, profile.maxItems)
        .map(({ item, distance }) =>
          perceptionFact({
            key: ARENA_ITEM_FACT,
            subjectId: item.instanceId,
            position: toNavigationPoint(item.position),
            observedAt: context.elapsed,
            profile,
            confidence: confidence(distance, profile.perceptionRadius),
            value: item.value,
            metadata: {
              generation: item.generation,
              definitionId: item.definitionId,
              kind: item.kind,
              distance,
              contestedBy: item.contestedBy
            }
          })
        );
    }
  };
}

function hazardSampler(source: ArenaBotPerceptionSource): AiSensorSampler {
  return {
    id: "arena.hazards",
    sample(context) {
      const frame = source.frame(context.agent);
      const profile = source.profileFor(context.agent);
      const self = selfActor(frame, context.agent);
      if (self === undefined || self.status !== "active") return [];
      return frame.hazards
        .map((hazard) => ({ hazard, distance: distanceToBox(self.position, hazard) }))
        .filter(({ hazard, distance }) => {
          const transitionDelay = hazard.nextTransitionTick - frame.tick;
          return (
            distance <= profile.perceptionRadius &&
            (hazard.active || transitionDelay <= profile.hazardLookaheadTicks)
          );
        })
        .sort(
          (left, right) =>
            left.distance - right.distance || left.hazard.id.localeCompare(right.hazard.id)
        )
        .map(({ hazard, distance }) =>
          perceptionFact({
            key: ARENA_HAZARD_FACT,
            subjectId: hazard.id,
            position: toNavigationPoint(hazard.position),
            observedAt: context.elapsed,
            profile,
            confidence: confidence(distance, profile.perceptionRadius),
            value: hazard.active,
            metadata: {
              kind: hazard.kind,
              phase: hazard.phase,
              distance,
              nextTransitionTick: hazard.nextTransitionTick,
              safeScale: hazard.safeScale ?? 1,
              size: { ...hazard.size }
            }
          })
        );
    }
  };
}

function objectiveSampler(source: ArenaBotPerceptionSource): AiSensorSampler {
  return {
    id: "arena.objective",
    sample(context) {
      const frame = source.frame(context.agent);
      const profile = source.profileFor(context.agent);
      const self = selfActor(frame, context.agent);
      if (self === undefined || self.status !== "active") return [];
      return [
        perceptionFact({
          key: ARENA_OBJECTIVE_FACT,
          subjectId: frame.objective.id,
          position: toNavigationPoint(frame.objective.position),
          observedAt: context.elapsed,
          profile,
          confidence: 1,
          value: frame.objective.stageProgress,
          metadata: {
            stageId: frame.stageId,
            stageKind: frame.stageKind,
            routeOrder: frame.objective.routeOrder ?? 0,
            checkpointCount: frame.objective.checkpointCount,
            qualificationCount: frame.objective.qualificationCount,
            activeParticipants: frame.objective.activeParticipants,
            completedParticipants: frame.objective.completedParticipants
          }
        })
      ];
    }
  };
}

function impactSampler(source: ArenaBotPerceptionSource): AiSensorSampler {
  return {
    id: "arena.impacts",
    sample(context) {
      const frame = source.frame(context.agent);
      const profile = source.profileFor(context.agent);
      const self = selfActor(frame, context.agent);
      if (self === undefined) return [];
      return frame.impacts
        .filter(
          (impact) =>
            impact.targetMemberId === self.memberId &&
            frame.tick - impact.tick <= profile.memoryTicks
        )
        .sort(
          (left, right) =>
            right.tick - left.tick ||
            (left.sourceMemberId ?? "").localeCompare(right.sourceMemberId ?? "")
        )
        .slice(0, 2)
        .map((impact) =>
          perceptionFact({
            key: ARENA_IMPACT_FACT,
            subjectId: impact.sourceMemberId,
            observedAt: context.elapsed,
            profile,
            confidence: 1,
            value: impact.severity,
            metadata: { tick: impact.tick, direction: { ...impact.direction } }
          })
        );
    }
  };
}

function perceptionFact(options: {
  key: string;
  subjectId?: string | undefined;
  position?: NavigationPoint | undefined;
  observedAt: number;
  profile: ArenaBotSkillProfileDefinition;
  confidence: number;
  value?: AiPerceptionFact["value"];
  metadata?: Record<string, unknown> | undefined;
}): AiPerceptionFact {
  return {
    key: options.key,
    ...(options.subjectId === undefined ? {} : { subjectId: options.subjectId }),
    ...(options.position === undefined ? {} : { position: options.position }),
    ...(options.value === undefined ? {} : { value: options.value }),
    observedAt: options.observedAt,
    expiresAt: options.observedAt + ticksToMs(options.profile.memoryTicks),
    confidence: options.confidence,
    ...(options.metadata === undefined ? {} : { metadata: options.metadata })
  };
}

function selfActor(
  frame: ArenaBotPerceptionFrame,
  agent: AiAgentBinding
): ArenaBotVisibleActor | undefined {
  if (agent.actorId === undefined) return undefined;
  return frame.actors.find(({ memberId }) => memberId === agent.actorId);
}

function hasLineOfSight(
  context: AiAgentReadContext,
  self: ArenaBotVisibleActor,
  target: ArenaBotVisibleActor,
  distance: number
): boolean {
  if (context.physics === undefined || distance <= 0.001) return true;
  const direction = normalize(subtract(target.position, self.position));
  const hit = context.physics.raycast(self.position, direction, {
    maxDistance: distance,
    mode: "closest",
    sort: "distance",
    maxResults: 1,
    triggerInteraction: "exclude",
    ignoreBodies: [self.memberId]
  })[0];
  return hit === undefined || hit.bodyId === target.memberId;
}

function distanceToBox(position: PhysicsVector, hazard: ArenaBotVisibleHazard): number {
  const dx = Math.max(0, Math.abs(position.x - hazard.position.x) - hazard.size.width / 2);
  const dy = Math.max(0, Math.abs(position.y - hazard.position.y) - hazard.size.height / 2);
  const dz = Math.max(
    0,
    Math.abs((position.z ?? 0) - (hazard.position.z ?? 0)) - hazard.size.depth / 2
  );
  return Math.hypot(dx, dy, dz);
}

function distance3(left: PhysicsVector, right: PhysicsVector): number {
  return Math.hypot(right.x - left.x, right.y - left.y, (right.z ?? 0) - (left.z ?? 0));
}

function subtract(left: PhysicsVector, right: PhysicsVector): PhysicsVector {
  return {
    x: left.x - right.x,
    y: left.y - right.y,
    z: (left.z ?? 0) - (right.z ?? 0)
  };
}

function normalize(vector: PhysicsVector): PhysicsVector {
  const length = Math.hypot(vector.x, vector.y, vector.z ?? 0);
  return length <= 0.001
    ? { x: 0, y: 0, z: 0 }
    : { x: vector.x / length, y: vector.y / length, z: (vector.z ?? 0) / length };
}

function toNavigationPoint(point: PhysicsVector): NavigationPoint {
  return { x: point.x, y: point.z ?? 0, z: point.y };
}

function confidence(distance: number, radius: number): number {
  return Math.max(0.05, Math.min(1, 1 - distance / Math.max(radius, 0.001)));
}

function ticksToMs(ticks: number): number {
  return (ticks * 1000) / 60;
}
