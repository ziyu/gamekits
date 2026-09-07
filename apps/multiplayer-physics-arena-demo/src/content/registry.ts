import { createDataRegistry, type DataPack, type DataRegistry } from "@gamekits/data";
import type { PhysicsPredictionIslandEnvironment } from "@gamekits/physics-core";
import {
  compileArenaCourse,
  mergeArenaCourseEnvironments,
  stableArenaContentSignature,
  type CompiledArenaCourse
} from "./course-compiler";
import { createArenaDataTypes } from "./data-types";
import { ARENA_DEFAULT_MATCH_RULE_ID, arenaContentPack } from "./pack";
import {
  ARENA_BOT_ARCHETYPE_TYPE,
  ARENA_BOT_PROFILE_TYPE,
  ARENA_COURSE_TYPE,
  ARENA_HAZARD_TYPE,
  ARENA_ITEM_TYPE,
  ARENA_MATCH_RULE_TYPE,
  ARENA_MOTOR_PROFILE_TYPE,
  ARENA_SPAWN_SET_TYPE,
  ARENA_STAGE_TYPE,
  type ArenaBotArchetypeDefinition,
  type ArenaBotSkillProfileDefinition,
  type ArenaCourseDefinition,
  type ArenaHazardDefinition,
  type ArenaItemDefinition,
  type ArenaMatchRuleDefinition,
  type ArenaMotorProfileDefinition,
  type ArenaSpawnSetDefinition,
  type ArenaStageDefinition
} from "./types";
import { assertValidArenaCompiledContent } from "./course-validator";

export type CreateArenaDataRegistryOptions = {
  packs?: DataPack[] | undefined;
};

export type CompiledArenaStage = {
  definition: ArenaStageDefinition;
  course: ArenaCourseDefinition;
  spawnSet: ArenaSpawnSetDefinition;
  hazards: ArenaHazardDefinition[];
  items: ArenaItemDefinition[];
  bots: ArenaBotArchetypeDefinition[];
  courseProjection: CompiledArenaCourse;
};

export type CompiledArenaContent = {
  matchRule: ArenaMatchRuleDefinition;
  stages: CompiledArenaStage[];
  botProfiles: ArenaBotSkillProfileDefinition[];
  motorProfiles: ArenaMotorProfileDefinition[];
  definitionVersion: string;
  physicsEnvironment: PhysicsPredictionIslandEnvironment;
};

export function createArenaDataRegistry(
  options: CreateArenaDataRegistryOptions = {}
): DataRegistry {
  const registry = createDataRegistry();
  for (const definition of createArenaDataTypes()) registry.registerType(definition);
  for (const pack of options.packs ?? [arenaContentPack]) registry.registerPack(pack);
  return registry;
}

export function compileArenaContent(
  registry: DataRegistry,
  matchRuleId = ARENA_DEFAULT_MATCH_RULE_ID
): CompiledArenaContent {
  const matchRule = registry.getValue<ArenaMatchRuleDefinition>(ARENA_MATCH_RULE_TYPE, matchRuleId);
  const stages = matchRule.stages.map(({ id }) => {
    const definition = registry.getValue<ArenaStageDefinition>(ARENA_STAGE_TYPE, id);
    const course = registry.getValue<ArenaCourseDefinition>(
      ARENA_COURSE_TYPE,
      definition.course.id
    );
    const spawnSet = registry.getValue<ArenaSpawnSetDefinition>(
      ARENA_SPAWN_SET_TYPE,
      course.spawnSet.id
    );
    const hazards = course.hazards.map((placement) =>
      registry.getValue<ArenaHazardDefinition>(ARENA_HAZARD_TYPE, placement.definition.id)
    );
    return {
      definition,
      course,
      spawnSet,
      hazards,
      items: definition.itemPool.map((item) =>
        registry.getValue<ArenaItemDefinition>(ARENA_ITEM_TYPE, item.id)
      ),
      bots: definition.botArchetypes.map((bot) =>
        registry.getValue<ArenaBotArchetypeDefinition>(ARENA_BOT_ARCHETYPE_TYPE, bot.id)
      ),
      courseProjection: compileArenaCourse({ course, spawnSet, hazards })
    };
  });
  validateMatchTopology(matchRule, stages);
  const botProfiles = registry
    .list<ArenaBotSkillProfileDefinition>(ARENA_BOT_PROFILE_TYPE)
    .map(({ data }) => data)
    .sort((left, right) => left.id.localeCompare(right.id));
  const definitionVersion = stableArenaContentSignature({
    stages: stages.map(({ definition, bots, courseProjection }) => ({
      stageId: definition.id,
      definition,
      bots,
      courseVersion: courseProjection.definitionVersion,
      layoutSignature: courseProjection.layoutSignature,
      scheduleSignature: courseProjection.scheduleSignature
    })),
    botProfiles
  });
  const content: CompiledArenaContent = {
    matchRule: structuredClone(matchRule),
    stages: structuredClone(stages),
    botProfiles: structuredClone(botProfiles),
    definitionVersion,
    physicsEnvironment: mergeArenaCourseEnvironments(
      stages.map(({ courseProjection }) => courseProjection)
    ),
    motorProfiles: structuredClone(
      registry.list<ArenaMotorProfileDefinition>(ARENA_MOTOR_PROFILE_TYPE).map(({ data }) => data)
    )
  };
  assertValidArenaCompiledContent(content);
  return content;
}

function validateMatchTopology(
  matchRule: ArenaMatchRuleDefinition,
  stages: readonly CompiledArenaStage[]
): void {
  const expectedKinds: ArenaStageDefinition["kind"][] = ["qualifier", "brawl", "final"];
  if (stages.length !== expectedKinds.length) {
    throw new Error("arena.content_stage_count: standard match requires exactly three stages");
  }
  let entrants = matchRule.participantCount;
  for (const [index, stage] of stages.entries()) {
    if (stage.definition.kind !== expectedKinds[index]) {
      throw new Error(`arena.content_stage_order: unexpected stage kind at index ${index}`);
    }
    if (stage.definition.qualificationCount >= entrants) {
      throw new Error(`arena.content_qualification: ${stage.definition.id} must reduce entrants`);
    }
    const participantSpawns = stage.spawnSet.points.filter(
      (point) => point.kind === "participant"
    ).length;
    if (participantSpawns < entrants) {
      throw new Error(
        `arena.content_spawn_capacity: ${stage.spawnSet.id} has ${participantSpawns}, requires ${entrants}`
      );
    }
    entrants = stage.definition.qualificationCount;
  }
  if (entrants !== 1) {
    throw new Error("arena.content_final_winner: final stage must qualify exactly one winner");
  }
}
