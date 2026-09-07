import type { PhysicsVector } from "@gamekits/physics-core";
import type { ArenaGameplayVolumeDefinition, ArenaStageKind } from "../content/types";

export type ArenaConvergenceCandidate = {
  participantId: string;
  memberId: string;
  position: PhysicsVector;
};

export type ArenaStageConvergencePlan = {
  active: boolean;
  safeScale: number;
  minimumSurvivors: number;
  eliminatedParticipantIds: string[];
};

export function planArenaStageConvergence(options: {
  stageKind: ArenaStageKind;
  elapsedTicks: number;
  durationTicks: number;
  qualificationCount: number;
  safeVolume?: ArenaGameplayVolumeDefinition | undefined;
  candidates: readonly ArenaConvergenceCandidate[];
}): ArenaStageConvergencePlan {
  const progress = Math.max(0, Math.min(1, options.elapsedTicks / options.durationTicks));
  const startsAt = options.stageKind === "brawl" ? 0.55 : options.stageKind === "final" ? 0.25 : 1;
  const active = options.safeVolume !== undefined && progress >= startsAt;
  const minimumSurvivors =
    options.stageKind === "final"
      ? 1
      : options.stageKind === "brawl"
        ? options.qualificationCount
        : 0;
  const safeScale = active
    ? Math.max(0.2, 1 - ((progress - startsAt) / Math.max(0.001, 1 - startsAt)) * 0.8)
    : 1;
  if (!active || options.safeVolume === undefined) {
    return { active, safeScale, minimumSurvivors, eliminatedParticipantIds: [] };
  }

  const center = options.safeVolume.position;
  const halfWidth = (options.safeVolume.size.width * safeScale) / 2;
  const halfDepth = (options.safeVolume.size.depth * safeScale) / 2;
  const ranked = options.candidates
    .map((candidate) => {
      const dx = candidate.position.x - center.x;
      const dz = (candidate.position.z ?? 0) - (center.z ?? 0);
      return {
        ...candidate,
        outside: Math.abs(dx) > halfWidth || Math.abs(dz) > halfDepth,
        distance: Math.hypot(dx, dz)
      };
    })
    .sort(
      (left, right) => right.distance - left.distance || left.memberId.localeCompare(right.memberId)
    );
  const maximumEliminations = Math.max(0, ranked.length - minimumSurvivors);
  const forced = progress >= 0.82;
  return {
    active,
    safeScale,
    minimumSurvivors,
    eliminatedParticipantIds: ranked
      .filter((candidate) => candidate.outside || forced)
      .slice(0, maximumEliminations)
      .map((candidate) => candidate.participantId)
  };
}
