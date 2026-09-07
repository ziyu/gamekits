import type {
  DataDiagnostic,
  DataDocument,
  DataReferenceTarget,
  DataTypeDefinition
} from "@gamekits/data";
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

export function createArenaDataTypes(): Array<DataTypeDefinition<any>> {
  return [
    matchRuleDataType(),
    stageDataType(),
    courseDataType(),
    hazardDataType(),
    itemDataType(),
    motorProfileDataType(),
    botProfileDataType(),
    botArchetypeDataType(),
    spawnSetDataType()
  ];
}

function matchRuleDataType(): DataTypeDefinition<ArenaMatchRuleDefinition> {
  return {
    type: ARENA_MATCH_RULE_TYPE,
    getTags: () => ["arena", "match"],
    references: (document) =>
      document.data.stages.map((stage, index) => ref(stage, `stages[${index}]`)),
    validate(document) {
      return [
        ...matchingId(document),
        ...positiveInteger(document, document.data.participantCount, "participantCount"),
        ...nonEmpty(document, document.data.stages, "stages"),
        ...uniqueRefs(document, document.data.stages, "stages")
      ];
    }
  };
}

function stageDataType(): DataTypeDefinition<ArenaStageDefinition> {
  return {
    type: ARENA_STAGE_TYPE,
    getTags: (stage) => ["arena", "stage", stage.kind],
    references(document) {
      return [
        ref(document.data.course, "course"),
        ...document.data.itemPool.map((item, index) => ref(item, `itemPool[${index}]`)),
        ...document.data.botArchetypes.map((bot, index) => ref(bot, `botArchetypes[${index}]`))
      ];
    },
    validate(document) {
      return [
        ...matchingId(document),
        ...positiveInteger(document, document.data.qualificationCount, "qualificationCount"),
        ...positiveInteger(document, document.data.durationTicks, "durationTicks"),
        ...uniqueRefs(document, document.data.itemPool, "itemPool"),
        ...uniqueRefs(document, document.data.botArchetypes, "botArchetypes")
      ];
    }
  };
}

function courseDataType(): DataTypeDefinition<ArenaCourseDefinition> {
  return {
    type: ARENA_COURSE_TYPE,
    getTags: () => ["arena", "course"],
    references(document) {
      return [
        ref(document.data.spawnSet, "spawnSet"),
        ...document.data.hazards.map((hazard, index) =>
          ref(hazard.definition, `hazards[${index}].definition`)
        )
      ];
    },
    validate(document) {
      const course = document.data;
      return [
        ...matchingId(document),
        ...nonBlank(document, course.definitionVersion, "definitionVersion"),
        ...nonBlank(document, course.presentation.themeId, "presentation.themeId"),
        ...nonBlank(document, course.presentation.accent, "presentation.accent"),
        ...nonBlank(document, course.presentation.skyline, "presentation.skyline"),
        ...positive(document, course.navigation.agentRadius, "navigation.agentRadius"),
        ...positive(document, course.navigation.agentHeight, "navigation.agentHeight"),
        ...nonNegative(document, course.navigation.maxClimb, "navigation.maxClimb"),
        ...positive(document, course.navigation.maxSlopeDegrees, "navigation.maxSlopeDegrees"),
        ...nonEmpty(document, course.staticLayout, "staticLayout"),
        ...nonEmpty(document, course.volumes, "volumes"),
        ...uniqueRefs(
          document,
          course.hazards.map(({ definition }) => definition),
          "hazards"
        ),
        ...uniqueCoursePlacementIds(document)
      ];
    }
  };
}

function hazardDataType(): DataTypeDefinition<ArenaHazardDefinition> {
  return {
    type: ARENA_HAZARD_TYPE,
    getTags: (hazard) => ["arena", "hazard", hazard.kind],
    validate(document) {
      const schedule = document.data.schedule;
      return [
        ...matchingId(document),
        ...positiveInteger(document, schedule.periodTicks, "schedule.periodTicks"),
        ...nonNegativeInteger(document, schedule.phaseTicks, "schedule.phaseTicks"),
        ...positiveInteger(document, schedule.activeTicks, "schedule.activeTicks"),
        ...ratio(document, schedule.activationProgress ?? 0, "schedule.activationProgress"),
        ...(schedule.activeTicks <= schedule.periodTicks
          ? []
          : [
              diagnostic(
                document,
                "arena.hazard_active_window",
                "schedule.activeTicks must not exceed schedule.periodTicks",
                "schedule.activeTicks"
              )
            ])
      ];
    }
  };
}

function itemDataType(): DataTypeDefinition<ArenaItemDefinition> {
  return {
    type: ARENA_ITEM_TYPE,
    getTags: (item) => ["arena", "item", item.kind],
    validate(document) {
      const item = document.data;
      const expectedMode =
        item.kind === "melee" ? "melee" : item.kind === "area" ? "throw-area" : "throw-contact";
      return [
        ...matchingId(document),
        ...(item.physics.shape.type === "sphere"
          ? positive(document, item.physics.shape.radius, "physics.shape.radius")
          : [
              ...positive(document, item.physics.shape.width, "physics.shape.width"),
              ...positive(document, item.physics.shape.height, "physics.shape.height"),
              ...positive(document, item.physics.shape.depth, "physics.shape.depth")
            ]),
        ...positive(document, item.physics.mass, "physics.mass"),
        ...ratio(document, item.physics.friction, "physics.friction"),
        ...ratio(document, item.physics.restitution, "physics.restitution"),
        ...(typeof item.physics.continuousCollisionDetection === "boolean"
          ? []
          : [
              diagnostic(
                document,
                "arena.item_ccd_boolean",
                "physics.continuousCollisionDetection must be boolean",
                "physics.continuousCollisionDetection"
              )
            ]),
        ...positive(document, item.physics.maxLinearSpeed, "physics.maxLinearSpeed"),
        ...positiveInteger(document, item.physics.lifetimeTicks, "physics.lifetimeTicks"),
        ...nonNegativeInteger(document, item.physics.maxBounces, "physics.maxBounces"),
        ...nonBlank(document, item.carry.socket, "carry.socket"),
        ...ratio(document, item.carry.speedMultiplier, "carry.speedMultiplier"),
        ...ratio(document, item.carry.jumpMultiplier, "carry.jumpMultiplier"),
        ...(item.carry.dropPolicy === "drop" || item.carry.dropPolicy === "spend"
          ? []
          : [
              diagnostic(
                document,
                "arena.item_drop_policy",
                "carry.dropPolicy must be drop or spend",
                "carry.dropPolicy"
              )
            ]),
        ...nonNegativeInteger(document, item.action.windupTicks, "action.windupTicks"),
        ...nonNegativeInteger(document, item.action.maxChargeTicks, "action.maxChargeTicks"),
        ...positiveInteger(document, item.action.activeTicks, "action.activeTicks"),
        ...nonNegativeInteger(document, item.action.cooldownTicks, "action.cooldownTicks"),
        ...nonNegative(document, item.action.launchSpeed, "action.launchSpeed"),
        ...positive(document, item.action.baseImpulse, "action.baseImpulse"),
        ...nonNegative(document, item.action.areaRadius, "action.areaRadius"),
        ...(item.effect.impulseMode === "directional" ||
        item.effect.impulseMode === "radial" ||
        item.effect.impulseMode === "pull" ||
        item.effect.impulseMode === "launch"
          ? []
          : [
              diagnostic(
                document,
                "arena.item_impulse_mode",
                "effect.impulseMode must be directional, radial, pull, or launch",
                "effect.impulseMode"
              )
            ]),
        ...ratio(document, item.effect.instabilityDelta, "effect.instabilityDelta"),
        ...positive(document, item.effect.staggerMultiplier, "effect.staggerMultiplier"),
        ...((item.effect.impulseMode === "radial" || item.effect.impulseMode === "pull") &&
        item.action.mode !== "throw-area"
          ? [
              diagnostic(
                document,
                "arena.item_area_effect_mode",
                "Radial and pull effects require a throw-area action",
                "effect.impulseMode"
              )
            ]
          : []),
        ...(item.effect.impulseMode === "launch" && item.action.mode !== "melee"
          ? [
              diagnostic(
                document,
                "arena.item_launch_effect_mode",
                "Launch effects require a melee action",
                "effect.impulseMode"
              )
            ]
          : []),
        ...nonNegativeInteger(document, item.respawn.ticks, "respawn.ticks"),
        ...nonBlank(document, item.presentationId, "presentationId"),
        ...(item.networkStrategy === "predicted-entity" || item.networkStrategy === "authority-only"
          ? []
          : [
              diagnostic(
                document,
                "arena.item_network_strategy",
                "networkStrategy must be predicted-entity or authority-only",
                "networkStrategy"
              )
            ]),
        ...(item.action.mode === expectedMode
          ? []
          : [
              diagnostic(
                document,
                "arena.item_action_kind_mismatch",
                `${item.kind} requires ${expectedMode} action mode`,
                "action.mode"
              )
            ]),
        ...(item.action.mode === "melee"
          ? item.action.launchSpeed === 0 && item.action.areaRadius > 0
            ? []
            : [
                diagnostic(
                  document,
                  "arena.item_melee_profile",
                  "Melee action requires zero launch speed and positive reach",
                  "action"
                )
              ]
          : item.action.launchSpeed > 0
            ? []
            : [
                diagnostic(
                  document,
                  "arena.item_throw_profile",
                  "Throw action requires positive launch speed",
                  "action.launchSpeed"
                )
              ]),
        ...(item.action.mode === "throw-area" && item.action.areaRadius <= 0
          ? [
              diagnostic(
                document,
                "arena.item_area_radius",
                "Area action requires a positive radius",
                "action.areaRadius"
              )
            ]
          : []),
        ...(item.respawn.mode === "none" && item.respawn.ticks !== 0
          ? [
              diagnostic(
                document,
                "arena.item_respawn_none_ticks",
                "Non-respawning items require zero respawn ticks",
                "respawn.ticks"
              )
            ]
          : []),
        ...(item.respawn.mode === "timed" && item.respawn.ticks === 0
          ? [
              diagnostic(
                document,
                "arena.item_respawn_timed_ticks",
                "Timed respawn requires positive respawn ticks",
                "respawn.ticks"
              )
            ]
          : [])
      ];
    }
  };
}

function motorProfileDataType(): DataTypeDefinition<ArenaMotorProfileDefinition> {
  return {
    type: ARENA_MOTOR_PROFILE_TYPE,
    getTags: () => ["arena", "motor"],
    validate(document) {
      return [
        ...matchingId(document),
        ...positive(document, document.data.maxGroundSpeed, "maxGroundSpeed"),
        ...positive(document, document.data.groundAcceleration, "groundAcceleration"),
        ...positive(document, document.data.groundBraking, "groundBraking"),
        ...positive(document, document.data.airAcceleration, "airAcceleration"),
        ...positive(document, document.data.jumpSpeed, "jumpSpeed"),
        ...positive(document, document.data.diveSpeed, "diveSpeed"),
        ...nonNegativeInteger(document, document.data.coyoteTicks, "coyoteTicks"),
        ...nonNegativeInteger(document, document.data.jumpBufferTicks, "jumpBufferTicks")
      ];
    }
  };
}

function botArchetypeDataType(): DataTypeDefinition<ArenaBotArchetypeDefinition> {
  return {
    type: ARENA_BOT_ARCHETYPE_TYPE,
    getTags: () => ["arena", "bot"],
    references(document) {
      return [
        ref(document.data.motor, "motor"),
        ref(document.data.profile, "profile"),
        ...document.data.preferredItems.map((item, index) => ref(item, `preferredItems[${index}]`))
      ];
    },
    validate(document) {
      return [
        ...matchingId(document),
        ...uniqueRefs(document, document.data.preferredItems, "preferredItems"),
        ...nonNegative(document, document.data.goalWeights.advance, "goalWeights.advance"),
        ...nonNegative(document, document.data.goalWeights.survive, "goalWeights.survive"),
        ...nonNegative(document, document.data.goalWeights.acquireItem, "goalWeights.acquireItem"),
        ...nonNegative(document, document.data.goalWeights.attack, "goalWeights.attack"),
        ...nonNegative(document, document.data.goalWeights.objective, "goalWeights.objective")
      ];
    }
  };
}

function botProfileDataType(): DataTypeDefinition<ArenaBotSkillProfileDefinition> {
  return {
    type: ARENA_BOT_PROFILE_TYPE,
    getTags: () => ["arena", "bot", "skill-profile"],
    validate(document) {
      return [
        ...matchingId(document),
        ...positiveInteger(document, document.data.reactionTicks, "reactionTicks"),
        ...positiveInteger(
          document,
          document.data.perceptionIntervalTicks,
          "perceptionIntervalTicks"
        ),
        ...positiveInteger(document, document.data.decisionIntervalTicks, "decisionIntervalTicks"),
        ...positiveInteger(document, document.data.memoryTicks, "memoryTicks"),
        ...positiveInteger(document, document.data.memoryLimit, "memoryLimit"),
        ...positive(document, document.data.perceptionRadius, "perceptionRadius"),
        ...positiveInteger(document, document.data.maxOpponents, "maxOpponents"),
        ...positiveInteger(document, document.data.maxItems, "maxItems"),
        ...nonNegativeInteger(document, document.data.hazardLookaheadTicks, "hazardLookaheadTicks"),
        ...nonNegative(document, document.data.aimErrorRadians, "aimErrorRadians"),
        ...ratio(document, document.data.aggression, "aggression"),
        ...ratio(document, document.data.riskTolerance, "riskTolerance"),
        ...positiveInteger(document, document.data.commitmentTicks, "commitmentTicks"),
        ...positiveInteger(document, document.data.recoveryTicks, "recoveryTicks")
      ];
    }
  };
}

function spawnSetDataType(): DataTypeDefinition<ArenaSpawnSetDefinition> {
  return {
    type: ARENA_SPAWN_SET_TYPE,
    getTags: () => ["arena", "spawn-set"],
    references(document) {
      return document.data.points.flatMap((point, index) =>
        point.definition === undefined ? [] : [ref(point.definition, `points[${index}].definition`)]
      );
    },
    validate(document) {
      const pointIds = new Set<string>();
      const diagnostics = [
        ...matchingId(document),
        ...nonEmpty(document, document.data.points, "points")
      ];
      for (const [index, point] of document.data.points.entries()) {
        const path = `points[${index}]`;
        if (pointIds.has(point.id)) {
          diagnostics.push(
            diagnostic(
              document,
              "arena.spawn_duplicate_id",
              `Duplicate spawn id: ${point.id}`,
              path
            )
          );
        }
        pointIds.add(point.id);
        diagnostics.push(...nonBlank(document, point.id, `${path}.id`));
        for (const axis of ["x", "y", "z"] as const) {
          const value = point.position[axis] ?? (axis === "z" ? 0 : undefined);
          if (value === undefined || !Number.isFinite(value)) {
            diagnostics.push(
              diagnostic(
                document,
                "arena.spawn_non_finite_position",
                `${path}.position.${axis} must be finite`,
                `${path}.position.${axis}`
              )
            );
          }
        }
        if (point.kind === "participant" && point.definition !== undefined) {
          diagnostics.push(
            diagnostic(
              document,
              "arena.spawn_participant_definition",
              "Participant spawns must not bind a content definition",
              `${path}.definition`
            )
          );
        }
        if (point.kind !== "participant" && point.definition === undefined) {
          diagnostics.push(
            diagnostic(
              document,
              "arena.spawn_missing_definition",
              `${point.kind} spawns require a content definition`,
              `${path}.definition`
            )
          );
        }
      }
      return diagnostics;
    }
  };
}

function matchingId<T extends { id: string }>(document: DataDocument<T>): DataDiagnostic[] {
  return document.data.id === document.id
    ? []
    : [
        diagnostic(
          document,
          "arena.data_id_mismatch",
          `Data id ${document.data.id} must match document id ${document.id}`,
          "id"
        )
      ];
}

function ref(reference: { type: string; id: string }, path: string): DataReferenceTarget {
  return { type: reference.type, id: reference.id, path };
}

function uniqueRefs(
  document: DataDocument<unknown>,
  references: ReadonlyArray<{ type: string; id: string }>,
  path: string
): DataDiagnostic[] {
  const seen = new Set<string>();
  const diagnostics: DataDiagnostic[] = [];
  for (const [index, reference] of references.entries()) {
    const key = `${reference.type}:${reference.id}`;
    if (seen.has(key)) {
      diagnostics.push(
        diagnostic(
          document,
          "arena.data_duplicate_reference",
          `Duplicate reference: ${key}`,
          `${path}[${index}]`
        )
      );
    }
    seen.add(key);
  }
  return diagnostics;
}

function uniqueCoursePlacementIds(document: DataDocument<ArenaCourseDefinition>): DataDiagnostic[] {
  const placements = [
    ...document.data.staticLayout.map(({ id }) => ({ id, path: "staticLayout" })),
    ...document.data.hazards.map(({ id }) => ({ id, path: "hazards" })),
    ...document.data.props.map(({ id }) => ({ id, path: "props" })),
    ...document.data.volumes.map(({ id }) => ({ id, path: "volumes" }))
  ];
  const seen = new Set<string>();
  const diagnostics: DataDiagnostic[] = [];
  for (const [index, placement] of placements.entries()) {
    if (seen.has(placement.id)) {
      diagnostics.push(
        diagnostic(
          document,
          "arena.course_duplicate_placement",
          `Duplicate course placement id: ${placement.id}`,
          `${placement.path}[${index}]`
        )
      );
    }
    seen.add(placement.id);
  }
  return diagnostics;
}

function nonEmpty(
  document: DataDocument<unknown>,
  values: readonly unknown[],
  path: string
): DataDiagnostic[] {
  return values.length > 0
    ? []
    : [diagnostic(document, "arena.data_empty_collection", `${path} must not be empty`, path)];
}

function nonBlank(document: DataDocument<unknown>, value: string, path: string): DataDiagnostic[] {
  return value.trim().length > 0
    ? []
    : [diagnostic(document, "arena.data_blank_string", `${path} must not be blank`, path)];
}

function positive(document: DataDocument<unknown>, value: number, path: string): DataDiagnostic[] {
  return Number.isFinite(value) && value > 0
    ? []
    : [diagnostic(document, "arena.data_positive_number", `${path} must be positive`, path)];
}

function nonNegative(
  document: DataDocument<unknown>,
  value: number,
  path: string
): DataDiagnostic[] {
  return Number.isFinite(value) && value >= 0
    ? []
    : [
        diagnostic(document, "arena.data_non_negative_number", `${path} must be non-negative`, path)
      ];
}

function ratio(document: DataDocument<unknown>, value: number, path: string): DataDiagnostic[] {
  return Number.isFinite(value) && value >= 0 && value <= 1
    ? []
    : [diagnostic(document, "arena.data_ratio", `${path} must be between 0 and 1`, path)];
}

function positiveInteger(
  document: DataDocument<unknown>,
  value: number,
  path: string
): DataDiagnostic[] {
  return Number.isSafeInteger(value) && value > 0
    ? []
    : [
        diagnostic(
          document,
          "arena.data_positive_integer",
          `${path} must be a positive integer`,
          path
        )
      ];
}

function nonNegativeInteger(
  document: DataDocument<unknown>,
  value: number,
  path: string
): DataDiagnostic[] {
  return Number.isSafeInteger(value) && value >= 0
    ? []
    : [
        diagnostic(
          document,
          "arena.data_non_negative_integer",
          `${path} must be a non-negative integer`,
          path
        )
      ];
}

function diagnostic(
  document: DataDocument<unknown>,
  code: string,
  message: string,
  path: string
): DataDiagnostic {
  return {
    code,
    message,
    severity: "error",
    key: { type: document.type, id: document.id },
    path,
    ...(document.sourcePackId === undefined ? {} : { sourcePackId: document.sourcePackId })
  };
}
