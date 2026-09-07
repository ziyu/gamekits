import type { EntityId } from "@gamekits/world";
import type { CombatKinematicProjectileRecord } from "@gamekits/combat";

import type {
  OutpostCombatAbility,
  OutpostReplicatedCombatCue,
  OutpostReplicatedWeaponState
} from "../domain";

export type OutpostAuthorityCombatCommand = {
  id: string;
  playerId: string;
  ability: OutpostCombatAbility;
  aimX: number;
  aimY: number;
  dashSequence?: number | undefined;
  simulationStepMs?: number | undefined;
  correlationId?: string | undefined;
  parentId?: string | undefined;
};

export type OutpostAuthorityCombatCommandResult =
  | { status: "accepted" }
  | { status: "rejected"; reason: string };

export type OutpostAuthorityEnemySpawn = {
  id: string;
  definitionId: string;
  x: number;
  y: number;
  activationDelayMs?: number | undefined;
};

export type OutpostAuthorityCombatPlayer = {
  playerId: string;
  entityId: EntityId;
  networkEntityId: string;
  generation: number;
  actorId: string;
  bodyId: string;
  colliderId: string;
};

export type OutpostAuthorityAiEnemy = {
  id: string;
  agentId: string;
  entityId: EntityId;
  actorId: string;
  definitionId: string;
  active: boolean;
};

export type OutpostAuthorityAiActionResult =
  | { status: "accepted"; executionId: string }
  | { status: "rejected"; reason: string };

export type OutpostAuthorityCombatActorSnapshot = {
  id: string;
  kind: "player" | "enemy" | "buildable";
  definitionId: string;
  renderKey: string;
  networkEntityId: string;
  generation: number;
  entityId: EntityId;
  actorId: string;
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

export type OutpostAuthorityCombatProjectileSnapshot = {
  id: string;
  renderKey: string;
  networkEntityId: string;
  generation: number;
  entityId: EntityId;
  x: number;
  y: number;
  velocityX: number;
  velocityY: number;
  facing: number;
};

export type OutpostAuthorityCombatSnapshot = {
  actors: OutpostAuthorityCombatActorSnapshot[];
  projectiles: OutpostAuthorityCombatProjectileSnapshot[];
  projectileGeneration: string;
  projectileRecords: CombatKinematicProjectileRecord[];
  cueWatermark: number;
  cues: OutpostReplicatedCombatCue[];
  projectileCount: number;
  acceptedCommands: number;
  rejectedCommands: number;
  projectileHits: number;
  enemyAttacks: number;
  kills: number;
  drops: number;
  objectiveProgress: number;
};
