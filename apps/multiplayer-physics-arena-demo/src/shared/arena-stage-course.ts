import type {
  PhysicsBodyCommandPayload,
  PhysicsBodyPatch,
  PhysicsBodyState,
  PhysicsPredictionIslandCommand,
  PhysicsPredictionIslandMemberDefinition,
  PhysicsVector
} from "@gamekits/physics-core";

import { ARENA_COMPILED_CONTENT } from "../content/default-content";
import type { CompiledArenaHazardSchedule } from "../content/course-compiler";

export type ArenaHazardPhase = "idle" | "warning" | "active" | "recovery";

export type ArenaHazardSample = {
  memberId: string;
  kind: CompiledArenaHazardSchedule["kind"];
  phase: ArenaHazardPhase;
  active: boolean;
  nextTransitionTick: number;
  patch: PhysicsBodyPatch;
};

export type ArenaStageInstallationPlan = {
  commands: PhysicsPredictionIslandCommand[];
  memberIds: string[];
  actorSpawns: Readonly<Record<string, PhysicsVector>>;
};

export type ArenaHazardBodyCommand = {
  memberId: string;
  command: PhysicsBodyCommandPayload;
};

const ALL_COURSE_MEMBER_IDS = new Set(
  ARENA_COMPILED_CONTENT.stages.flatMap((stage) =>
    stage.courseProjection.memberDefinitions.map(({ id }) => id)
  )
);
const CONVEYOR_IMPULSE_PER_STRENGTH = 0.012;
const WIND_IMPULSE_PER_STRENGTH = 0.055;
const BOUNCE_IMPULSE_PER_STRENGTH = 0.34;

export function planArenaStageInstallation(options: {
  stageIndex: number;
  tick: number;
  currentMemberIds: readonly string[];
  entrantActorIds: readonly string[];
  nextSequence: () => number;
}): ArenaStageInstallationPlan {
  const stage = requireStage(options.stageIndex);
  const currentIds = new Set(options.currentMemberIds);
  const desiredIds = new Set(
    stage.courseProjection.memberDefinitions.map((definition) => definition.id)
  );
  const commands: PhysicsPredictionIslandCommand[] = [];

  for (const memberId of [...currentIds].sort()) {
    if (!ALL_COURSE_MEMBER_IDS.has(memberId) || desiredIds.has(memberId)) continue;
    commands.push({
      type: "despawn",
      tick: options.tick,
      sequence: options.nextSequence(),
      memberId
    });
  }
  for (const member of stage.courseProjection.memberDefinitions) {
    if (currentIds.has(member.id)) continue;
    commands.push({
      type: "spawn",
      tick: options.tick,
      sequence: options.nextSequence(),
      member: structuredClone(member)
    });
  }

  const actorSpawns: Record<string, PhysicsVector> = {};
  const entrantIds = [...options.entrantActorIds].sort();
  for (const [index, memberId] of entrantIds.entries()) {
    const spawn = stage.courseProjection.participantSpawns[index];
    if (spawn === undefined) {
      throw new Error(
        `arena.stage_spawn_capacity: ${stage.definition.id} cannot place entrant ${memberId}`
      );
    }
    actorSpawns[memberId] = structuredClone(spawn.position);
    commands.push({
      type: "patch",
      tick: options.tick,
      sequence: options.nextSequence(),
      memberId,
      patch: {
        position: structuredClone(spawn.position),
        linearVelocity: { x: 0, y: 0, z: 0 },
        angularVelocity: { x: 0, y: 0, z: 0 }
      }
    });
  }

  return {
    commands,
    memberIds: [...desiredIds].sort(),
    actorSpawns
  };
}

export function sampleArenaStageHazards(options: {
  stageIndex: number;
  tick: number;
  stageStartedAtTick: number;
}): ArenaHazardSample[] {
  const stage = requireStage(options.stageIndex);
  const schedules = stage.courseProjection.hazardSchedules;
  const elapsedTicks = Math.max(0, options.tick - options.stageStartedAtTick);
  const stageProgress = Math.min(1, elapsedTicks / stage.definition.durationTicks);
  return schedules.map((schedule) =>
    sampleHazard(
      schedule,
      elapsedTicks,
      options.tick,
      stageProgress,
      stage.definition.durationTicks
    )
  );
}

export function planArenaHazardBodyCommands(options: {
  stageIndex: number;
  tick: number;
  stageStartedAtTick: number;
  bodies: readonly PhysicsBodyState[];
}): ArenaHazardBodyCommand[] {
  const stage = requireStage(options.stageIndex);
  const schedulesByMemberId = new Map(
    stage.courseProjection.hazardSchedules.map((schedule) => [schedule.memberId, schedule])
  );
  const samples = sampleArenaStageHazards(options);
  const commands: ArenaHazardBodyCommand[] = [];
  for (const sample of samples) {
    if (!sample.active) continue;
    const schedule = schedulesByMemberId.get(sample.memberId)!;
    for (const body of options.bodies) {
      if (body.kind !== "dynamic" || !insideHazard(body.position, schedule, sample)) continue;
      const command = hazardBodyCommand(schedule, sample, body, options.tick);
      if (command !== undefined) commands.push({ memberId: body.id, command });
    }
  }
  return commands;
}

export function arenaStageCourseMemberDefinitions(
  stageIndex: number
): PhysicsPredictionIslandMemberDefinition[] {
  return structuredClone(requireStage(stageIndex).courseProjection.memberDefinitions);
}

function sampleHazard(
  schedule: CompiledArenaHazardSchedule,
  elapsedTicks: number,
  absoluteTick: number,
  stageProgress: number,
  stageDurationTicks: number
): ArenaHazardSample {
  const cycleTick = positiveModulo(elapsedTicks + schedule.phaseTicks, schedule.periodTicks);
  const warningTicks = Math.min(30, Math.max(6, Math.floor(schedule.periodTicks * 0.12)));
  const recoveryTicks = Math.min(24, Math.max(6, Math.floor(schedule.periodTicks * 0.08)));
  const progress = cycleTick / schedule.periodTicks;
  const activeProgress = Math.min(1, cycleTick / Math.max(1, schedule.activeTicks));
  const activationTick = Math.ceil(schedule.activationProgress * stageDurationTicks);
  const enabled = stageProgress >= schedule.activationProgress;
  const active = enabled && (schedule.kind === "crumble-floor" || cycleTick < schedule.activeTicks);
  if (!enabled) {
    const ticksUntilActivation = Math.max(1, activationTick - elapsedTicks);
    const phase: ArenaHazardPhase = ticksUntilActivation <= warningTicks ? "warning" : "idle";
    return {
      memberId: schedule.memberId,
      kind: schedule.kind,
      phase,
      active: false,
      nextTransitionTick: absoluteTick + ticksUntilActivation,
      patch: hazardPatch(schedule, progress, activeProgress, false, stageProgress)
    };
  }
  if (schedule.kind === "crumble-floor") {
    return {
      memberId: schedule.memberId,
      kind: schedule.kind,
      phase: "active",
      active: true,
      nextTransitionTick: absoluteTick + Math.max(1, stageDurationTicks - elapsedTicks),
      patch: hazardPatch(schedule, progress, activeProgress, true, stageProgress)
    };
  }
  const phase: ArenaHazardPhase = active
    ? "active"
    : cycleTick >= schedule.periodTicks - warningTicks
      ? "warning"
      : cycleTick < schedule.activeTicks + recoveryTicks
        ? "recovery"
        : "idle";
  const nextBoundary =
    phase === "active"
      ? schedule.activeTicks
      : phase === "recovery"
        ? schedule.activeTicks + recoveryTicks
        : phase === "warning"
          ? schedule.periodTicks
          : schedule.periodTicks - warningTicks;
  const nextTransitionTick = absoluteTick + Math.max(1, nextBoundary - cycleTick);
  const patch = hazardPatch(schedule, progress, activeProgress, active, stageProgress);
  return {
    memberId: schedule.memberId,
    kind: schedule.kind,
    phase,
    active,
    nextTransitionTick,
    patch
  };
}

function hazardPatch(
  schedule: CompiledArenaHazardSchedule,
  cycleProgress: number,
  activeProgress: number,
  active: boolean,
  stageProgress: number
): PhysicsBodyPatch {
  if (schedule.kind === "rotating-sweeper") {
    const angle = cycleProgress * Math.PI * 2;
    return { rotation: { x: 0, y: Math.sin(angle / 2), z: 0, w: Math.cos(angle / 2) } };
  }
  if (schedule.kind === "moving-platform") {
    return {
      position: offsetAlongAxis(
        schedule.origin,
        schedule.axis,
        Math.sin(cycleProgress * Math.PI * 2) * schedule.travel
      )
    };
  }
  if (schedule.kind === "piston") {
    const extension = active ? Math.sin(activeProgress * Math.PI) * schedule.travel : 0;
    return { position: offsetAlongAxis(schedule.origin, schedule.axis, extension) };
  }
  if (schedule.kind === "crusher" || schedule.kind === "extending-wall") {
    const extension = active ? Math.sin(activeProgress * Math.PI) * schedule.travel : 0;
    return {
      position: offsetAlongAxis(schedule.origin, schedule.axis, extension),
      userData: { hazardStrength: active ? schedule.strength : 0 }
    };
  }
  if (schedule.kind === "crumble-floor") {
    const collapsed = stageProgress >= schedule.activationProgress;
    const collapseProgress = Math.min(
      1,
      stageProgress / Math.max(0.001, schedule.activationProgress)
    );
    return {
      position: offsetAlongAxis(
        schedule.origin,
        "y",
        collapsed ? -Math.max(2, schedule.travel) : 0
      ),
      userData: { collapseProgress, collapsed }
    };
  }
  if (schedule.kind === "shrinking-zone") {
    const localProgress = Math.max(
      0,
      (stageProgress - schedule.activationProgress) /
        Math.max(0.001, 1 - schedule.activationProgress)
    );
    const safeScale = Math.max(0.2, 1 - localProgress * 0.8);
    return {
      userData: {
        hazardStrength: active ? schedule.strength : 0,
        safeScale,
        convergenceActive: active
      }
    };
  }
  return {
    position: structuredClone(schedule.origin),
    userData: { hazardStrength: active ? schedule.strength : 0 }
  };
}

function hazardBodyCommand(
  schedule: CompiledArenaHazardSchedule,
  sample: ArenaHazardSample,
  body: PhysicsBodyState,
  tick: number
): PhysicsBodyCommandPayload | undefined {
  if (schedule.kind === "conveyor") {
    return {
      type: "linear-impulse",
      impulse: axisVector(schedule.axis, schedule.strength * CONVEYOR_IMPULSE_PER_STRENGTH),
      wake: "wake"
    };
  }
  if (schedule.kind === "wind-zone" && tick % 6 === 0) {
    return {
      type: "linear-impulse",
      impulse: axisVector(schedule.axis, schedule.strength * WIND_IMPULSE_PER_STRENGTH),
      wake: "wake"
    };
  }
  if (schedule.kind === "bounce-pad" && tick % 6 === 0 && body.linearVelocity.y < 1.2) {
    return {
      type: "linear-impulse",
      impulse: { x: 0, y: schedule.strength * BOUNCE_IMPULSE_PER_STRENGTH, z: 0 },
      wake: "wake"
    };
  }
  if (schedule.kind === "shrinking-zone" && tick % 6 === 0) {
    const safeScale = Number(sample.patch.userData?.safeScale ?? 1);
    const dx = body.position.x - schedule.origin.x;
    const dz = (body.position.z ?? 0) - (schedule.origin.z ?? 0);
    const radius = Math.min(schedule.size.width, schedule.size.depth) * 0.5 * safeScale;
    const distance = Math.hypot(dx, dz);
    if (distance <= radius || distance <= 0.001) return undefined;
    return {
      type: "linear-impulse",
      impulse: {
        x: (-dx / distance) * schedule.strength * 0.04,
        y: 0.02,
        z: (-dz / distance) * schedule.strength * 0.04
      },
      wake: "wake"
    };
  }
  return undefined;
}

function insideHazard(
  position: PhysicsVector,
  schedule: CompiledArenaHazardSchedule,
  sample: ArenaHazardSample
): boolean {
  const center = sample.patch.position ?? schedule.origin;
  return (
    Math.abs(position.x - center.x) <= schedule.size.width / 2 + 0.8 &&
    Math.abs(position.y - center.y) <= schedule.size.height / 2 + 1.2 &&
    Math.abs((position.z ?? 0) - (center.z ?? 0)) <= schedule.size.depth / 2 + 0.8
  );
}

function axisVector(axis: "x" | "y" | "z", value: number): PhysicsVector {
  return {
    x: axis === "x" ? value : 0,
    y: axis === "y" ? value : 0,
    z: axis === "z" ? value : 0
  };
}

function offsetAlongAxis(
  origin: PhysicsVector,
  axis: "x" | "y" | "z",
  distance: number
): PhysicsVector {
  return {
    x: origin.x + (axis === "x" ? distance : 0),
    y: origin.y + (axis === "y" ? distance : 0),
    z: (origin.z ?? 0) + (axis === "z" ? distance : 0)
  };
}

function positiveModulo(value: number, modulus: number): number {
  return ((value % modulus) + modulus) % modulus;
}

function requireStage(stageIndex: number) {
  const stage = ARENA_COMPILED_CONTENT.stages[stageIndex];
  if (stage === undefined) throw new Error(`arena.stage_index: ${stageIndex} is not compiled`);
  return stage;
}
