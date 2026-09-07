import type { CombatKinematicProjectileRecord } from "@gamekits/combat";
import type { OutpostReplicatedWeaponState } from "./player/weapon";
import type { OutpostCombatAbility } from "./types";

export type OutpostReplicatedActor = {
  objectId: string;
  networkEntityId: string;
  generation: number;
  kind: "player" | "enemy" | "buildable";
  definitionId: string;
  renderKey: string;
  x: number;
  y: number;
  velocityX: number;
  velocityY: number;
  facing: number;
  health: number;
  shield: number;
  stamina: number;
  resource: number;
  tags: string[];
  cooldowns: Record<string, number>;
  targetActorId?: string | undefined;
  aiGoalId?: string | undefined;
  aiTaskPhase?: string | undefined;
  abilityExecutionId?: string | undefined;
  abilityId?: string | undefined;
  abilityPhase?: string | undefined;
  abilityPhaseStartedAt?: number | undefined;
  abilityPhaseEndsAt?: number | undefined;
  weapon?: OutpostReplicatedWeaponState | undefined;
};

export type OutpostReplicatedProjectile = {
  objectId: string;
  networkEntityId: string;
  generation: number;
  renderKey: string;
  x: number;
  y: number;
  velocityX: number;
  velocityY: number;
  facing: number;
};

export type OutpostReplicatedCombatCueKind =
  | "projectile-spawned"
  | "miss"
  | "world-impact"
  | "shield-hit"
  | "health-hit"
  | "kill-confirmed"
  | "action-rejected";

export type OutpostReplicatedCombatCue = {
  sequence: number;
  kind: OutpostReplicatedCombatCueKind;
  at: number;
  correlationId?: string | undefined;
  parentId?: string | undefined;
  sourceObjectId?: string | undefined;
  targetObjectId?: string | undefined;
  projectileId?: string | undefined;
  position?: { x: number; y: number } | undefined;
  normal?: { x: number; y: number } | undefined;
  direction?: { x: number; y: number } | undefined;
  amount?: number | undefined;
  ability?: OutpostCombatAbility | undefined;
  reason?: string | undefined;
};

export type OutpostReplicatedCombatState = {
  actors: OutpostReplicatedActor[];
  projectiles: OutpostReplicatedProjectile[];
  projectileGeneration: string;
  projectileRecords: CombatKinematicProjectileRecord[];
  cueWatermark: number;
  cues: OutpostReplicatedCombatCue[];
  acceptedCommands: number;
  rejectedCommands: number;
  projectileHits: number;
  enemyAttacks: number;
  kills: number;
  drops: number;
  objectiveProgress: number;
};
