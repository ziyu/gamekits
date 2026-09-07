import type {
  PhysicsBodyState,
  PhysicsPredictionIslandEnvironment,
  PhysicsPredictionIslandMemberDefinition,
  PhysicsVector
} from "@gamekits/physics-core";

import { ARENA_COMPILED_CONTENT } from "../content/default-content";

import { ARENA_BOT_COUNT, ARENA_MAX_HUMANS, arenaBotMemberId, arenaPlayerMemberId } from "./config";

export type ArenaMemberRole = "player" | "bot" | "prop" | "sweeper" | "platform" | "hazard";

const ARENA_CONTENT = ARENA_COMPILED_CONTENT;
const ACTOR_IDS = [
  ...Array.from({ length: ARENA_MAX_HUMANS }, (_, slot) => arenaPlayerMemberId(slot)),
  ...Array.from({ length: ARENA_BOT_COUNT }, (_, slot) => arenaBotMemberId(slot))
] as const;
const CONTENT_MEMBER_ROLES = new Map<string, ArenaMemberRole>();
for (const stage of ARENA_CONTENT.stages) {
  const hazardsById = new Map(stage.hazards.map((hazard) => [hazard.id, hazard]));
  for (const placement of stage.course.hazards) {
    const kind = hazardsById.get(placement.definition.id)?.kind;
    CONTENT_MEMBER_ROLES.set(
      placement.id,
      kind === "rotating-sweeper" ? "sweeper" : kind === "moving-platform" ? "platform" : "hazard"
    );
  }
  for (const prop of stage.course.props) CONTENT_MEMBER_ROLES.set(prop.id, "prop");
}

export const ARENA_ENVIRONMENT: PhysicsPredictionIslandEnvironment = structuredClone(
  ARENA_CONTENT.physicsEnvironment
);

export const ARENA_CONTENT_DEFINITION_VERSION = ARENA_CONTENT.definitionVersion;

export function createArenaMemberDefinitions(
  stageIndex = 0
): PhysicsPredictionIslandMemberDefinition[] {
  const stage = requireStage(stageIndex);
  const actors = stage.courseProjection.participantSpawns.map((spawn, slot) =>
    createActorDefinition(ACTOR_IDS[slot]!, spawn.position)
  );
  return structuredClone([...actors, ...stage.courseProjection.memberDefinitions]);
}

export function createArenaDefinitionMap(): ReadonlyMap<
  string,
  PhysicsPredictionIslandMemberDefinition
> {
  const definitions = new Map(
    createArenaMemberDefinitions(0).map((member) => [member.id, structuredClone(member)])
  );
  for (const stage of ARENA_CONTENT.stages) {
    for (const member of stage.courseProjection.memberDefinitions) {
      definitions.set(member.id, structuredClone(member));
    }
  }
  return definitions;
}

export function arenaMemberRole(id: string): ArenaMemberRole {
  if (id.startsWith("player.")) return "player";
  if (id.startsWith("bot.")) return "bot";
  return CONTENT_MEMBER_ROLES.get(id) ?? "prop";
}

export function arenaActorSpawn(id: string, stageIndex = 0): PhysicsVector {
  const slot = id.startsWith("player.")
    ? Number(id.slice("player.".length))
    : id.startsWith("bot.")
      ? Number(id.slice("bot.".length)) + ARENA_MAX_HUMANS
      : -1;
  const spawns = requireStage(stageIndex).courseProjection.participantSpawns;
  return structuredClone(spawns[slot]?.position ?? spawns[0]?.position ?? { x: 0, y: 2, z: 5 });
}

export function arenaCourseProjection(stageIndex: number) {
  return structuredClone(requireStage(stageIndex).courseProjection);
}

export function isArenaActor(id: string): boolean {
  return id.startsWith("player.") || id.startsWith("bot.");
}

export function cloneArenaBodyState(body: PhysicsBodyState): PhysicsBodyState {
  return structuredClone(body);
}

function createActorDefinition(
  id: string,
  position: PhysicsVector
): PhysicsPredictionIslandMemberDefinition {
  return {
    id,
    body: {
      id,
      kind: "dynamic",
      position,
      damping: { linear: 3.5, angular: 8 },
      lockedAxes: ["rotation-x", "rotation-z"],
      continuousCollisionDetection: true
    },
    colliders: [
      {
        id: `${id}.collider`,
        shape: { type: "capsule", radius: 0.52, height: 0.85 },
        material: "actor"
      }
    ]
  };
}

function requireStage(stageIndex: number) {
  const stage = ARENA_CONTENT.stages[stageIndex];
  if (stage === undefined) {
    throw new Error(`arena.course_stage_index: ${stageIndex} is outside compiled content`);
  }
  return stage;
}
