import type { AiAgentBinding } from "@gamekits/ai-core";
import type { PhysicsPredictionIslandMemberState, PhysicsVector } from "@gamekits/physics-core";

import type { CompiledArenaContent } from "../content/registry";
import type {
  ArenaBotArchetypeDefinition,
  ArenaBotSkillProfileDefinition,
  ArenaGameplayVolumeDefinition
} from "../content/types";
import type { ArenaImpactLedgerEntry } from "../match/impact-ledger";
import type { ArenaParticipantRecord } from "../match/participant-registry";
import { sampleArenaStageHazards } from "../shared/arena-stage-course";
import type { ArenaPublicCombatState, ArenaPublicItemState } from "../shared/protocol";
import type {
  ArenaBotObjectiveFact,
  ArenaBotPerceptionFrame,
  ArenaBotPerceptionSource,
  ArenaBotVisibleActor,
  ArenaBotVisibleImpact
} from "./perception";

export type ArenaAuthorityRankingFact = {
  participantId: string;
  checkpointCount: number;
  finished: boolean;
  objectiveScore: number;
};

export type ArenaAuthorityPerceptionState = {
  tick: number;
  elapsedMs: number;
  stageIndex: number;
  stageStartedAtTick: number;
  participants: readonly ArenaParticipantRecord[];
  members: readonly PhysicsPredictionIslandMemberState[];
  items: readonly ArenaPublicItemState[];
  combat: readonly ArenaPublicCombatState[];
  impacts: readonly ArenaImpactLedgerEntry[];
  ranking: readonly ArenaAuthorityRankingFact[];
};

export function createArenaAuthorityPerceptionSource(options: {
  content: Readonly<CompiledArenaContent>;
  state(): ArenaAuthorityPerceptionState;
}): ArenaBotPerceptionSource {
  let cachedState: ArenaAuthorityPerceptionState | undefined;
  const framesByActorId = new Map<string, ArenaBotPerceptionFrame>();
  return {
    frame(agent) {
      const state = options.state();
      if (cachedState !== state) {
        cachedState = state;
        framesByActorId.clear();
      }
      const actorId = agent?.actorId ?? "__global__";
      const cached = framesByActorId.get(actorId);
      if (cached !== undefined) return cached;
      const frame = projectArenaAuthorityPerceptionFrame(options.content, state, agent);
      framesByActorId.set(actorId, frame);
      return frame;
    },
    profileFor(agent) {
      return arenaBotProfileForMember(
        options.content,
        options.state().stageIndex,
        requireActorId(agent)
      );
    }
  };
}

export function projectArenaAuthorityPerceptionFrame(
  content: Readonly<CompiledArenaContent>,
  state: Readonly<ArenaAuthorityPerceptionState>,
  agent?: AiAgentBinding | undefined
): ArenaBotPerceptionFrame {
  const stage = content.stages[state.stageIndex];
  if (stage === undefined) throw new Error(`Arena AI stage is missing: ${state.stageIndex}`);
  const membersById = new Map(state.members.map((member) => [member.id, member]));
  const participantsById = new Map(
    state.participants.map((participant) => [participant.id, participant])
  );
  const combatByParticipantId = new Map(state.combat.map((actor) => [actor.participantId, actor]));
  const carriedItemByParticipantId = new Map(
    state.items.flatMap((item) =>
      item.ownerParticipantId === undefined ? [] : [[item.ownerParticipantId, item.id] as const]
    )
  );
  const actors = state.participants.flatMap((participant) => {
    const member =
      participant.actorMemberId === undefined
        ? undefined
        : membersById.get(participant.actorMemberId);
    if (member === undefined || participant.actorMemberId === undefined) return [];
    const combat = combatByParticipantId.get(participant.id);
    const actor: ArenaBotVisibleActor = {
      participantId: participant.id,
      memberId: participant.actorMemberId,
      position: { ...member.body.position },
      linearVelocity: { ...member.body.linearVelocity },
      status: visibleStatus(participant),
      instability: combat?.instability ?? 0,
      motorMode: "authority",
      ...(carriedItemByParticipantId.get(participant.id) === undefined
        ? {}
        : { carriedItemId: carriedItemByParticipantId.get(participant.id) })
    };
    return [actor];
  });
  const activeActors = actors.filter(({ status }) => status === "active");
  const itemDefinitions = new Map(
    content.stages.flatMap(({ items }) => items).map((definition) => [definition.id, definition])
  );
  const items = state.items.flatMap((item) => {
    if (item.bodyMemberId === undefined || item.state !== "world") return [];
    const member = membersById.get(item.bodyMemberId);
    const definition = itemDefinitions.get(item.definitionId);
    if (member === undefined || definition === undefined) return [];
    return [
      {
        instanceId: item.id,
        generation: item.instanceGeneration,
        definitionId: item.definitionId,
        kind: definition.kind,
        position: { ...member.body.position },
        value: itemValue(definition.kind),
        contestedBy: activeActors.filter(
          (actor) => distance3(actor.position, member.body.position) <= 3.5
        ).length
      }
    ];
  });
  const hazardSamples = sampleArenaStageHazards({
    stageIndex: state.stageIndex,
    tick: state.tick,
    stageStartedAtTick: state.stageStartedAtTick
  });
  const hazardSamplesByMemberId = new Map(hazardSamples.map((sample) => [sample.memberId, sample]));
  const hazards = stage.courseProjection.hazardSchedules.map((schedule) => {
    const sample = hazardSamplesByMemberId.get(schedule.memberId)!;
    const position = sample.patch.position ?? schedule.origin;
    return {
      id: schedule.memberId,
      kind: schedule.kind,
      phase: sample.phase,
      active: sample.active,
      position: { ...position },
      size: { ...schedule.size },
      nextTransitionTick: sample.nextTransitionTick,
      safeScale: finiteNumber(sample.patch.userData?.safeScale, 1)
    };
  });
  const impacts = projectImpacts(state.impacts, participantsById, membersById);
  const objective = projectObjective(stage, state, agent, participantsById);
  return {
    tick: state.tick,
    elapsedMs: state.elapsedMs,
    stageId: stage.definition.id,
    stageKind: stage.definition.kind,
    actors,
    items,
    hazards,
    impacts,
    objective
  };
}

export function arenaBotArchetypeForMember(
  content: Readonly<CompiledArenaContent>,
  stageIndex: number,
  memberId: string
): ArenaBotArchetypeDefinition {
  const stage = content.stages[stageIndex];
  if (stage === undefined || stage.bots.length === 0) {
    throw new Error(`Arena bot archetypes are missing for stage: ${stageIndex}`);
  }
  const slot = Number(memberId.split(".").at(-1));
  const index = Number.isSafeInteger(slot) && slot >= 0 ? slot % stage.bots.length : 0;
  return stage.bots[index]!;
}

function arenaBotProfileForMember(
  content: Readonly<CompiledArenaContent>,
  stageIndex: number,
  memberId: string
): ArenaBotSkillProfileDefinition {
  const archetype = arenaBotArchetypeForMember(content, stageIndex, memberId);
  const profile = content.botProfiles.find(({ id }) => id === archetype.profile.id);
  if (profile === undefined)
    throw new Error(`Arena bot profile is missing: ${archetype.profile.id}`);
  return profile;
}

function projectObjective(
  stage: Readonly<CompiledArenaContent["stages"][number]>,
  state: Readonly<ArenaAuthorityPerceptionState>,
  agent: AiAgentBinding | undefined,
  participantsById: ReadonlyMap<string, ArenaParticipantRecord>
): ArenaBotObjectiveFact {
  const rankingByParticipantId = new Map(
    state.ranking.map((ranking) => [ranking.participantId, ranking])
  );
  const participant = [...participantsById.values()].find(
    ({ actorMemberId }) => actorMemberId === agent?.actorId
  );
  const ranking =
    participant === undefined ? undefined : rankingByParticipantId.get(participant.id);
  const probes = stage.courseProjection.validationProbes;
  const checkpoints = probes
    .flatMap((probe) => (probe.volume?.kind === "checkpoint" ? [probe.volume] : []))
    .sort((left, right) => (left.routeOrder ?? 0) - (right.routeOrder ?? 0));
  const finish = probes.find((probe) => probe.volume?.kind === "finish")?.volume;
  const objectiveVolume = probes.find((probe) => probe.volume?.kind === "objective")?.volume;
  const safeVolume = stage.course.volumes.find((volume) => volume.kind === "safe-zone");
  const target =
    stage.definition.kind === "qualifier"
      ? (checkpoints[ranking?.checkpointCount ?? 0] ?? finish)
      : stage.definition.kind === "brawl"
        ? (objectiveVolume ?? safeVolume)
        : (safeVolume ?? objectiveVolume);
  const fallback: ArenaGameplayVolumeDefinition = {
    id: `${stage.definition.id}.center`,
    kind: "objective",
    position: {
      x: (stage.courseProjection.bounds.min.x + stage.courseProjection.bounds.max.x) / 2,
      y: 1,
      z:
        ((stage.courseProjection.bounds.min.z ?? 0) + (stage.courseProjection.bounds.max.z ?? 0)) /
        2
    },
    size: { width: 1, height: 1, depth: 1 }
  };
  const selected = target ?? fallback;
  const elapsedTicks = Math.max(0, state.tick - state.stageStartedAtTick);
  return {
    id: selected.id,
    position: { ...selected.position },
    ...(selected.routeOrder === undefined ? {} : { routeOrder: selected.routeOrder }),
    checkpointCount: ranking?.checkpointCount ?? 0,
    qualificationCount: stage.definition.qualificationCount,
    activeParticipants: state.participants.filter(({ status }) => status === "active").length,
    completedParticipants: state.ranking.filter(({ finished }) => finished).length,
    stageProgress: Math.min(1, elapsedTicks / stage.definition.durationTicks)
  };
}

function projectImpacts(
  entries: readonly ArenaImpactLedgerEntry[],
  participantsById: ReadonlyMap<string, ArenaParticipantRecord>,
  membersById: ReadonlyMap<string, PhysicsPredictionIslandMemberState>
): ArenaBotVisibleImpact[] {
  return entries.map((entry) => {
    const target = participantsById.get(entry.targetParticipantId);
    const source =
      entry.sourceParticipantId === undefined
        ? undefined
        : participantsById.get(entry.sourceParticipantId);
    const targetPosition =
      target?.actorMemberId === undefined
        ? undefined
        : membersById.get(target.actorMemberId)?.body.position;
    const sourcePosition =
      source?.actorMemberId === undefined
        ? undefined
        : membersById.get(source.actorMemberId)?.body.position;
    return {
      targetMemberId: target?.actorMemberId ?? entry.targetParticipantId,
      ...(source?.actorMemberId === undefined ? {} : { sourceMemberId: source.actorMemberId }),
      tick: entry.tick,
      direction: impactDirection(sourcePosition, targetPosition),
      severity: Math.min(1, entry.impulseMagnitude / 12)
    };
  });
}

function visibleStatus(
  participant: Readonly<ArenaParticipantRecord>
): ArenaBotVisibleActor["status"] {
  if (participant.status === "active") return "active";
  if (participant.status === "qualified" || participant.status === "finished") return "qualified";
  if (participant.status === "eliminated") return "eliminated";
  if (participant.status === "disconnected") return "disconnected";
  return "spectator";
}

function requireActorId(agent: AiAgentBinding): string {
  if (agent.actorId === undefined) throw new Error(`Arena bot actor is unbound: ${agent.agentId}`);
  return agent.actorId;
}

function itemValue(kind: "throwable" | "impact" | "area" | "melee"): number {
  return kind === "area" ? 1 : kind === "impact" ? 0.9 : kind === "melee" ? 0.85 : 0.75;
}

function impactDirection(
  source: PhysicsVector | undefined,
  target: PhysicsVector | undefined
): PhysicsVector {
  if (source === undefined || target === undefined) return { x: 0, y: 0, z: 0 };
  const x = target.x - source.x;
  const z = (target.z ?? 0) - (source.z ?? 0);
  const length = Math.hypot(x, z);
  return length <= 0.001 ? { x: 0, y: 0, z: 0 } : { x: x / length, y: 0, z: z / length };
}

function distance3(left: PhysicsVector, right: PhysicsVector): number {
  return Math.hypot(right.x - left.x, right.y - left.y, (right.z ?? 0) - (left.z ?? 0));
}

function finiteNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}
