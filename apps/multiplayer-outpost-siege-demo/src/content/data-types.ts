import type {
  DataDiagnostic,
  DataDocument,
  DataReferenceTarget,
  DataTypeDefinition
} from "@gamekits/data";
import {
  OUTPOST_ARENA_TYPE,
  OUTPOST_BUILDABLE_TYPE,
  OUTPOST_ENEMY_TYPE,
  OUTPOST_MOVEMENT_PROFILE_TYPE,
  OUTPOST_OBJECTIVE_TYPE,
  OUTPOST_PLAYER_TYPE,
  OUTPOST_RENDER_OBJECT_TYPE,
  OUTPOST_WAVE_TYPE,
  OUTPOST_WEAPON_TYPE,
  type OutpostBuildableDefinition,
  type OutpostArenaDefinition,
  type OutpostEnemyDefinition,
  type OutpostMovementProfileDefinition,
  type OutpostObjectiveDefinition,
  type OutpostPlayerDefinition,
  type OutpostRenderObjectDefinition,
  type OutpostWaveDefinition,
  type OutpostWeaponDefinition
} from "../domain";

export function createOutpostDataTypes(): Array<DataTypeDefinition<any>> {
  return [
    createOutpostMovementProfileDataType(),
    createOutpostPlayerDataType(),
    createOutpostEnemyDataType(),
    createOutpostWeaponDataType(),
    createOutpostBuildableDataType(),
    createOutpostWaveDataType(),
    createOutpostObjectiveDataType(),
    createOutpostRenderObjectDataType(),
    createOutpostArenaDataType()
  ];
}

export function createOutpostMovementProfileDataType(): DataTypeDefinition<OutpostMovementProfileDefinition> {
  return {
    type: OUTPOST_MOVEMENT_PROFILE_TYPE,
    getTags: () => ["outpost", "player", "movement"],
    validate(document) {
      return [
        ...matchingId(document),
        ...positive(document, document.data.maxSpeed, "maxSpeed"),
        ...positive(document, document.data.acceleration, "acceleration"),
        ...positive(document, document.data.deceleration, "deceleration"),
        ...positive(document, document.data.staminaRecoveryPerSecond, "staminaRecoveryPerSecond"),
        ...positive(document, document.data.dashSpeed, "dashSpeed"),
        ...positive(document, document.data.dashDurationMs, "dashDurationMs"),
        ...nonNegative(
          document,
          document.data.dashCollisionVelocityRatio,
          "dashCollisionVelocityRatio"
        ),
        ...(document.data.dashCollisionVelocityRatio > 1
          ? [
              diagnostic(
                document,
                "outpost.movement_invalid_dash_collision_ratio",
                "dashCollisionVelocityRatio must not exceed 1",
                "dashCollisionVelocityRatio"
              )
            ]
          : []),
        ...nonNegative(document, document.data.cameraLookaheadDistance, "cameraLookaheadDistance"),
        ...positive(document, document.data.cameraLookaheadResponse, "cameraLookaheadResponse"),
        ...nonNegative(document, document.data.cameraDashImpulse, "cameraDashImpulse")
      ];
    }
  };
}

export function createOutpostPlayerDataType(): DataTypeDefinition<OutpostPlayerDefinition> {
  return {
    type: OUTPOST_PLAYER_TYPE,
    getTags: () => ["outpost", "player"],
    references(document) {
      return [
        dataRef(document.data.actor, "actor"),
        dataRef(document.data.weapon, "weapon"),
        dataRef(document.data.physicsBody, "physicsBody"),
        dataRef(document.data.renderObject, "renderObject"),
        dataRef(document.data.movementProfile, "movementProfile")
      ];
    },
    indexes: [index("outpost.player.weapon", (document) => document.data.weapon.id)],
    validate(document) {
      return matchingId(document);
    }
  };
}

export function createOutpostEnemyDataType(): DataTypeDefinition<OutpostEnemyDefinition> {
  return {
    type: OUTPOST_ENEMY_TYPE,
    getTags: (enemy) => ["outpost", "enemy", enemy.role],
    references(document) {
      return [
        dataRef(document.data.actor, "actor"),
        dataRef(document.data.attackAbility, "attackAbility"),
        dataRef(document.data.aiAgent, "aiAgent"),
        dataRef(document.data.physicsBody, "physicsBody"),
        dataRef(document.data.renderObject, "renderObject")
      ];
    },
    indexes: [index("outpost.enemy.role", (document) => document.data.role)],
    validate(document) {
      return [
        ...matchingId(document),
        ...positive(document, document.data.moveSpeed, "moveSpeed"),
        ...positive(document, document.data.attackRange, "attackRange"),
        ...positive(document, document.data.attackDamage, "attackDamage")
      ];
    }
  };
}

export function createOutpostWeaponDataType(): DataTypeDefinition<OutpostWeaponDefinition> {
  return {
    type: OUTPOST_WEAPON_TYPE,
    getTags: () => ["outpost", "weapon"],
    references(document) {
      return [
        dataRef(document.data.ability, "ability"),
        dataRef(document.data.projectileBody, "projectileBody"),
        dataRef(document.data.projectileRenderObject, "projectileRenderObject")
      ];
    },
    validate(document) {
      return [
        ...matchingId(document),
        ...positive(document, document.data.fireIntervalMs, "fireIntervalMs"),
        ...positive(document, document.data.damage, "damage"),
        ...positive(document, document.data.projectileSpeed, "projectileSpeed"),
        ...positive(document, document.data.projectileLifetimeMs, "projectileLifetimeMs")
      ];
    }
  };
}

export function createOutpostBuildableDataType(): DataTypeDefinition<OutpostBuildableDefinition> {
  return {
    type: OUTPOST_BUILDABLE_TYPE,
    getTags: () => ["outpost", "buildable"],
    references(document) {
      return [
        dataRef(document.data.actor, "actor"),
        dataRef(document.data.deployAbility, "deployAbility"),
        dataRef(document.data.physicsBody, "physicsBody"),
        dataRef(document.data.renderObject, "renderObject")
      ];
    },
    validate(document) {
      return [
        ...matchingId(document),
        ...nonNegative(document, document.data.resourceCost, "resourceCost"),
        ...positive(document, document.data.placementRange, "placementRange")
      ];
    }
  };
}

export function createOutpostWaveDataType(): DataTypeDefinition<OutpostWaveDefinition> {
  return {
    type: OUTPOST_WAVE_TYPE,
    getTags: (wave) => ["outpost", "wave", wave.boss === undefined ? "standard" : "boss"],
    references(document) {
      return [
        dataRef(document.data.objective, "objective"),
        ...document.data.spawns.map((spawn, spawnIndex) =>
          dataRef(spawn.enemy, `spawns[${spawnIndex}].enemy`)
        ),
        ...(document.data.boss === undefined ? [] : [dataRef(document.data.boss, "boss")])
      ];
    },
    indexes: [index("outpost.wave.index", (document) => String(document.data.index))],
    validate(document) {
      return [
        ...matchingId(document),
        ...nonNegativeInteger(document, document.data.index, "index"),
        ...(document.data.spawns.length === 0 && document.data.boss === undefined
          ? [diagnostic(document, "outpost.wave_empty", "Wave requires a spawn or boss", "spawns")]
          : []),
        ...document.data.spawns.flatMap((spawn, spawnIndex) =>
          positiveInteger(document, spawn.count, `spawns[${spawnIndex}].count`)
        )
      ];
    }
  };
}

export function createOutpostObjectiveDataType(): DataTypeDefinition<OutpostObjectiveDefinition> {
  return {
    type: OUTPOST_OBJECTIVE_TYPE,
    getTags: (objective) => ["outpost", "objective", objective.kind],
    indexes: [index("outpost.objective.kind", (document) => document.data.kind)],
    validate(document) {
      const diagnostics = matchingId(document);
      if (document.data.kind === "eliminate") {
        diagnostics.push(...positiveInteger(document, document.data.targetCount, "targetCount"));
      }
      if (document.data.kind === "defend" || document.data.kind === "extract") {
        diagnostics.push(...positive(document, document.data.durationMs, "durationMs"));
      }
      return diagnostics;
    }
  };
}

export function createOutpostRenderObjectDataType(): DataTypeDefinition<OutpostRenderObjectDefinition> {
  return {
    type: OUTPOST_RENDER_OBJECT_TYPE,
    getTags: (renderObject) => ["outpost", "render", ...(renderObject.tags ?? [])],
    references(document) {
      return Object.entries(document.data.assetRefs).map(([slot, asset]) => ({
        type: "asset.definition",
        id: asset.assetId,
        path: `assetRefs.${slot}`
      }));
    },
    validate(document) {
      return [
        ...matchingId(document),
        ...(document.data.type.length === 0
          ? [
              diagnostic(
                document,
                "outpost.render_missing_type",
                "Render object requires type",
                "type"
              )
            ]
          : []),
        ...(Object.keys(document.data.assetRefs).length === 0
          ? [
              diagnostic(
                document,
                "outpost.render_missing_assets",
                "Render object requires at least one AssetRef",
                "assetRefs"
              )
            ]
          : []),
        ...(document.data.facingOffsetRadians === undefined
          ? []
          : finite(document, document.data.facingOffsetRadians, "facingOffsetRadians"))
      ];
    }
  };
}

export function createOutpostArenaDataType(): DataTypeDefinition<OutpostArenaDefinition> {
  return {
    type: OUTPOST_ARENA_TYPE,
    getTags: () => ["outpost", "arena", "scene"],
    references(document) {
      return [
        dataRef(document.data.floor, "floor"),
        ...document.data.staticObjects.flatMap((object, objectIndex) => [
          dataRef(object.renderObject, `staticObjects[${objectIndex}].renderObject`),
          dataRef(object.collider, `staticObjects[${objectIndex}].collider`)
        ])
      ];
    },
    validate(document) {
      const diagnostics = [
        ...matchingId(document),
        ...positive(document, document.data.width, "width"),
        ...positive(document, document.data.height, "height")
      ];
      const ids = new Set<string>();
      for (const [objectIndex, object] of document.data.staticObjects.entries()) {
        const path = `staticObjects[${objectIndex}]`;
        if (ids.has(object.id)) {
          diagnostics.push(
            diagnostic(
              document,
              "outpost.arena_duplicate_object",
              `Arena static object id must be unique: ${object.id}`,
              `${path}.id`
            )
          );
        }
        ids.add(object.id);
        diagnostics.push(
          ...finite(document, object.position.x, `${path}.position.x`),
          ...finite(document, object.position.y, `${path}.position.y`),
          ...positive(document, object.size.width, `${path}.size.width`),
          ...positive(document, object.size.height, `${path}.size.height`),
          ...(object.rotation === undefined
            ? []
            : finite(document, object.rotation, `${path}.rotation`))
        );
      }
      return diagnostics;
    }
  };
}

function matchingId<TData extends { id: string }>(document: DataDocument<TData>): DataDiagnostic[] {
  return document.data.id === document.id
    ? []
    : [
        diagnostic(
          document,
          "outpost.data_id_mismatch",
          `Data id ${document.data.id} must match document id ${document.id}`,
          "id"
        )
      ];
}

function dataRef(reference: { type: string; id: string }, path: string): DataReferenceTarget {
  return { type: reference.type, id: reference.id, path };
}

function index<TData>(
  id: string,
  value: (document: DataDocument<TData>) => string
): { id: string; values(document: DataDocument<TData>): string[] } {
  return { id, values: (document) => [value(document)] };
}

function positive(
  document: DataDocument<unknown>,
  value: number | undefined,
  path: string
): DataDiagnostic[] {
  return value !== undefined && Number.isFinite(value) && value > 0
    ? []
    : [diagnostic(document, "outpost.data_positive_number", `${path} must be positive`, path)];
}

function finite(document: DataDocument<unknown>, value: number, path: string): DataDiagnostic[] {
  return Number.isFinite(value)
    ? []
    : [diagnostic(document, "outpost.data_finite_number", `${path} must be finite`, path)];
}

function nonNegative(
  document: DataDocument<unknown>,
  value: number,
  path: string
): DataDiagnostic[] {
  return Number.isFinite(value) && value >= 0
    ? []
    : [
        diagnostic(
          document,
          "outpost.data_non_negative_number",
          `${path} must be non-negative`,
          path
        )
      ];
}

function positiveInteger(
  document: DataDocument<unknown>,
  value: number | undefined,
  path: string
): DataDiagnostic[] {
  return value !== undefined && Number.isInteger(value) && value > 0
    ? []
    : [
        diagnostic(
          document,
          "outpost.data_positive_integer",
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
  return Number.isInteger(value) && value >= 0
    ? []
    : [
        diagnostic(
          document,
          "outpost.data_non_negative_integer",
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
