import type { DataRef } from "@gamekits/data";
import type { PhysicsVector } from "@gamekits/physics-core";

export const ARENA_MATCH_RULE_TYPE = "arena.match-rule";
export const ARENA_STAGE_TYPE = "arena.stage";
export const ARENA_COURSE_TYPE = "arena.course";
export const ARENA_HAZARD_TYPE = "arena.hazard";
export const ARENA_ITEM_TYPE = "arena.item";
export const ARENA_MOTOR_PROFILE_TYPE = "arena.character-motor";
export const ARENA_BOT_PROFILE_TYPE = "arena.bot-profile";
export const ARENA_BOT_ARCHETYPE_TYPE = "arena.bot-archetype";
export const ARENA_SPAWN_SET_TYPE = "arena.spawn-set";

export type ArenaMatchRuleDefinition = {
  id: string;
  participantCount: number;
  stages: Array<DataRef<typeof ARENA_STAGE_TYPE>>;
};

export type ArenaStageKind = "qualifier" | "brawl" | "final";

export type ArenaStageDefinition = {
  id: string;
  kind: ArenaStageKind;
  course: DataRef<typeof ARENA_COURSE_TYPE>;
  qualificationCount: number;
  durationTicks: number;
  itemPool: Array<DataRef<typeof ARENA_ITEM_TYPE>>;
  botArchetypes: Array<DataRef<typeof ARENA_BOT_ARCHETYPE_TYPE>>;
};

export type ArenaCourseDefinition = {
  id: string;
  definitionVersion: string;
  bounds: ArenaBoundsDefinition;
  spawnSet: DataRef<typeof ARENA_SPAWN_SET_TYPE>;
  staticLayout: ArenaStaticPlacementDefinition[];
  hazards: ArenaHazardPlacementDefinition[];
  props: ArenaDynamicPropPlacementDefinition[];
  volumes: ArenaGameplayVolumeDefinition[];
  navigation: ArenaCourseNavigationDefinition;
  presentation: ArenaCoursePresentationDefinition;
};

export type ArenaBoundsDefinition = {
  min: PhysicsVector;
  max: PhysicsVector;
};

export type ArenaBoxSize = {
  width: number;
  height: number;
  depth: number;
};

export type ArenaStaticPlacementDefinition = {
  id: string;
  role: "floor" | "ramp" | "wall" | "platform" | "finish-deck";
  position: PhysicsVector;
  size: ArenaBoxSize;
  rotation?: PhysicsVector | undefined;
  material: "course" | "ice" | "mud";
  navigationArea?: "walkable" | "slow" | "slick" | undefined;
};

export type ArenaHazardPlacementDefinition = {
  id: string;
  definition: DataRef<typeof ARENA_HAZARD_TYPE>;
  position: PhysicsVector;
  size: ArenaBoxSize;
  axis?: "x" | "y" | "z" | undefined;
  travel?: number | undefined;
  strength?: number | undefined;
};

export type ArenaDynamicPropPlacementDefinition = {
  id: string;
  shape:
    | { type: "sphere"; radius: number }
    | { type: "box"; width: number; height: number; depth: number };
  position: PhysicsVector;
  mass: number;
  material: "prop";
  presentationId: string;
};

export type ArenaGameplayVolumeKind = "kill" | "checkpoint" | "finish" | "objective" | "safe-zone";

export type ArenaGameplayVolumeDefinition = {
  id: string;
  kind: ArenaGameplayVolumeKind;
  position: PhysicsVector;
  size: ArenaBoxSize;
  routeOrder?: number | undefined;
};

export type ArenaCourseNavigationDefinition = {
  agentRadius: number;
  agentHeight: number;
  maxClimb: number;
  maxSlopeDegrees: number;
};

export type ArenaCoursePresentationDefinition = {
  themeId: "circuit-forge" | "scrap-yard" | "crown-collapse";
  accent: string;
  skyline: string;
};

export type ArenaHazardKind =
  | "rotating-sweeper"
  | "moving-platform"
  | "piston"
  | "crusher"
  | "extending-wall"
  | "conveyor"
  | "wind-zone"
  | "bounce-pad"
  | "crumble-floor"
  | "shrinking-zone";

export type ArenaHazardDefinition = {
  id: string;
  kind: ArenaHazardKind;
  bodyKind: "kinematic" | "sensor";
  schedule: {
    periodTicks: number;
    phaseTicks: number;
    activeTicks: number;
    activationProgress?: number | undefined;
  };
};

export type ArenaItemKind = "throwable" | "impact" | "area" | "melee";

export type ArenaItemShapeDefinition =
  | { type: "sphere"; radius: number }
  | { type: "box"; width: number; height: number; depth: number };

export type ArenaItemDefinition = {
  id: string;
  kind: ArenaItemKind;
  physics: {
    shape: ArenaItemShapeDefinition;
    mass: number;
    friction: number;
    restitution: number;
    continuousCollisionDetection: boolean;
    maxLinearSpeed: number;
    lifetimeTicks: number;
    maxBounces: number;
  };
  carry: {
    socket: string;
    speedMultiplier: number;
    jumpMultiplier: number;
    dropPolicy: "drop" | "spend";
  };
  action: {
    mode: "throw-contact" | "throw-area" | "melee";
    windupTicks: number;
    maxChargeTicks: number;
    activeTicks: number;
    cooldownTicks: number;
    launchSpeed: number;
    baseImpulse: number;
    areaRadius: number;
  };
  effect: {
    impulseMode: "directional" | "radial" | "pull" | "launch";
    instabilityDelta: number;
    staggerMultiplier: number;
  };
  respawn: {
    mode: "timed" | "none";
    ticks: number;
  };
  presentationId: string;
  networkStrategy: "predicted-entity" | "authority-only";
};

export type ArenaMotorProfileDefinition = {
  id: string;
  maxGroundSpeed: number;
  groundAcceleration: number;
  groundBraking: number;
  airAcceleration: number;
  jumpSpeed: number;
  diveSpeed: number;
  coyoteTicks: number;
  jumpBufferTicks: number;
};

export type ArenaBotSkillProfileDefinition = {
  id: string;
  reactionTicks: number;
  perceptionIntervalTicks: number;
  decisionIntervalTicks: number;
  memoryTicks: number;
  memoryLimit: number;
  perceptionRadius: number;
  maxOpponents: number;
  maxItems: number;
  hazardLookaheadTicks: number;
  aimErrorRadians: number;
  aggression: number;
  riskTolerance: number;
  commitmentTicks: number;
  recoveryTicks: number;
};

export type ArenaBotArchetypeDefinition = {
  id: string;
  role: "sprinter" | "brawler" | "opportunist";
  profile: DataRef<typeof ARENA_BOT_PROFILE_TYPE>;
  motor: DataRef<typeof ARENA_MOTOR_PROFILE_TYPE>;
  preferredItems: Array<DataRef<typeof ARENA_ITEM_TYPE>>;
  goalWeights: {
    advance: number;
    survive: number;
    acquireItem: number;
    attack: number;
    objective: number;
  };
};

export type ArenaSpawnKind = "participant" | "item" | "hazard";

export type ArenaSpawnPointDefinition = {
  id: string;
  kind: ArenaSpawnKind;
  position: PhysicsVector;
  definition?: DataRef | undefined;
};

export type ArenaSpawnSetDefinition = {
  id: string;
  points: ArenaSpawnPointDefinition[];
};

export type ArenaContentDefinition =
  | ArenaMatchRuleDefinition
  | ArenaStageDefinition
  | ArenaCourseDefinition
  | ArenaHazardDefinition
  | ArenaItemDefinition
  | ArenaMotorProfileDefinition
  | ArenaBotSkillProfileDefinition
  | ArenaBotArchetypeDefinition
  | ArenaSpawnSetDefinition;
