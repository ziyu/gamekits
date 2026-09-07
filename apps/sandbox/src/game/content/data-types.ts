import type { DataTypeDefinition } from "@gamekits/data";
import type {
  RenderNodeDefinition,
  RenderObjectDefinition,
  RenderObjectType
} from "@gamekits/renderer-core";
import type {
  SandboxAbilityDefinition,
  SandboxActorDefinition,
  SandboxBiomeDefinition,
  SandboxBuildingDefinition,
  SandboxObjectivePhaseDefinition,
  SandboxRecipeDefinition,
  SandboxRenderRigDefinition,
  SandboxRouteDefinition,
  SandboxSceneLayoutDefinition,
  SandboxSceneObjectDefinition,
  SandboxSpawnProfileDefinition,
  SandboxWaveDefinition
} from "./types";

export function createRenderObjectDataType(
  supportedTypes: RenderObjectType[]
): DataTypeDefinition<RenderObjectDefinition> {
  const supported = new Set(supportedTypes);

  return {
    type: "render.object",
    getTags: (definition) => definition.tags ?? [],
    references(document) {
      return collectRenderObjectAssetReferences(document.data);
    },
    validate(document) {
      return collectUnsupportedRenderTypes(document.data, supported).map((entry) => ({
        code: "sandbox.unknown_render_type",
        message: `Unsupported sandbox render object type: ${entry.type}`,
        severity: "error" as const,
        key: document,
        path: entry.path
      }));
    }
  };
}

export function createRenderRigDataType(): DataTypeDefinition<SandboxRenderRigDefinition> {
  return {
    type: "sandbox.renderRig",
    getTags: (definition) => definition.tags ?? [],
    references(document) {
      return [{ type: "render.object", id: document.data.renderObjectId, path: "renderObjectId" }];
    },
    validate(document) {
      return document.data.nodeAnimations.length === 0
        ? [
            {
              code: "sandbox.render_rig_missing_animation",
              message: "Sandbox render rig should contain at least one node animation",
              severity: "warning" as const,
              key: document
            }
          ]
        : [];
    }
  };
}

export function createActorDataType(): DataTypeDefinition<SandboxActorDefinition> {
  return {
    type: "sandbox.actor",
    getTags: (definition) => definition.tags ?? [],
    references(document) {
      return [
        { type: "sandbox.renderRig", id: document.data.renderRigId, path: "renderRigId" },
        ...document.data.abilityIds.map((id, index) => ({
          type: "sandbox.ability",
          id,
          path: `abilityIds[${index}]`
        }))
      ];
    },
    validate(document) {
      const diagnostics = [];

      if (document.data.entityCount < 1) {
        diagnostics.push({
          code: "sandbox.actor_invalid_entity_count",
          message: "Sandbox actor entityCount must be at least 1",
          severity: "error" as const,
          key: document
        });
      }

      if (document.data.baseSpeed <= 0) {
        diagnostics.push({
          code: "sandbox.actor_invalid_base_speed",
          message: "Sandbox actor baseSpeed must be positive",
          severity: "error" as const,
          key: document
        });
      }

      return diagnostics;
    }
  };
}

export function createAbilityDataType(): DataTypeDefinition<SandboxAbilityDefinition> {
  return {
    type: "sandbox.ability",
    getTags: (definition) => definition.tags ?? [],
    validate(document) {
      return document.data.cooldownMs < 0
        ? [
            {
              code: "sandbox.ability_invalid_cooldown",
              message: "Sandbox ability cooldownMs cannot be negative",
              severity: "error" as const,
              key: document
            }
          ]
        : [];
    }
  };
}

export function createSceneObjectDataType(): DataTypeDefinition<SandboxSceneObjectDefinition> {
  return {
    type: "sandbox.sceneObject",
    getTags: (definition) => definition.tags ?? [],
    references(document) {
      const references = [
        { type: "render.object", id: document.data.renderObjectId, path: "renderObjectId" }
      ];
      if (document.data.renderRigId) {
        references.push({
          type: "sandbox.renderRig",
          id: document.data.renderRigId,
          path: "renderRigId"
        });
      }
      if (document.data.gasActorDefinitionId) {
        references.push({
          type: "gas.actor",
          id: document.data.gasActorDefinitionId,
          path: "gasActorDefinitionId"
        });
      }
      if (document.data.buildingDefinitionId) {
        references.push({
          type: "sandbox.building",
          id: document.data.buildingDefinitionId,
          path: "buildingDefinitionId"
        });
      }
      if (document.data.recipeId) {
        references.push({
          type: "sandbox.recipe",
          id: document.data.recipeId,
          path: "recipeId"
        });
      }
      return references;
    },
    validate(document) {
      const diagnostics = [];
      if (
        document.data.x < 0 ||
        document.data.x > 100 ||
        document.data.y < 0 ||
        document.data.y > 100
      ) {
        diagnostics.push({
          code: "sandbox.scene_object_invalid_position",
          message: "Sandbox scene object position must be expressed as 0-100 percent",
          severity: "error" as const,
          key: document
        });
      }
      return diagnostics;
    }
  };
}

export function createBuildingDataType(): DataTypeDefinition<SandboxBuildingDefinition> {
  return {
    type: "sandbox.building",
    getTags: (definition) => definition.tags ?? [],
    indexes: [
      {
        id: "zone",
        values(document) {
          return [document.data.zone];
        }
      }
    ],
    validate(document) {
      const diagnostics = [];
      if (document.data.priority < 1) {
        diagnostics.push({
          code: "sandbox.building_invalid_priority",
          message: "Sandbox building priority must be at least 1",
          severity: "error" as const,
          key: document
        });
      }
      if (document.data.supportedTasks.length === 0) {
        diagnostics.push({
          code: "sandbox.building_missing_tasks",
          message: "Sandbox building must support at least one work task",
          severity: "error" as const,
          key: document
        });
      }
      return diagnostics;
    }
  };
}

export function createRecipeDataType(): DataTypeDefinition<SandboxRecipeDefinition> {
  return {
    type: "sandbox.recipe",
    getTags: (definition) => definition.tags ?? [],
    indexes: [
      {
        id: "buildingRole",
        values(document) {
          return [document.data.buildingRole];
        }
      }
    ],
    validate(document) {
      return document.data.durationMs <= 0
        ? [
            {
              code: "sandbox.recipe_invalid_duration",
              message: "Sandbox production recipe duration must be positive",
              severity: "error" as const,
              key: document
            }
          ]
        : [];
    }
  };
}

export function createObjectivePhaseDataType(): DataTypeDefinition<SandboxObjectivePhaseDefinition> {
  return {
    type: "sandbox.objectivePhase",
    getTags: (definition) => definition.tags ?? [],
    references(document) {
      return document.data.unlocks
        .filter((id) => id.startsWith("recipe."))
        .map((id, index) => ({ type: "sandbox.recipe", id, path: `unlocks[${index}]` }));
    },
    validate(document) {
      return document.data.targetResources <= 0
        ? [
            {
              code: "sandbox.objective_invalid_target",
              message: "Sandbox objective phase targetResources must be positive",
              severity: "error" as const,
              key: document
            }
          ]
        : [];
    }
  };
}

export function createWaveDataType(): DataTypeDefinition<SandboxWaveDefinition> {
  return {
    type: "sandbox.wave",
    getTags: (definition) => definition.tags ?? [],
    references(document) {
      return [{ type: "gas.effect", id: document.data.effectId, path: "effectId" }];
    },
    validate(document) {
      return document.data.cadenceTicks < 1
        ? [
            {
              code: "sandbox.threat_invalid_cadence",
              message: "Sandbox threat cadenceTicks must be at least 1",
              severity: "error" as const,
              key: document
            }
          ]
        : [];
    }
  };
}

export function createRouteDataType(): DataTypeDefinition<SandboxRouteDefinition> {
  return {
    type: "sandbox.route",
    getTags: (definition) => definition.tags ?? [],
    references(document) {
      return [
        { type: "sandbox.sceneObject", id: document.data.fromObjectId, path: "fromObjectId" },
        { type: "sandbox.sceneObject", id: document.data.toObjectId, path: "toObjectId" }
      ];
    },
    validate(document) {
      return document.data.capacity <= 0
        ? [
            {
              code: "sandbox.route_invalid_capacity",
              message: "Sandbox route capacity must be positive",
              severity: "error" as const,
              key: document
            }
          ]
        : [];
    }
  };
}

export function createSceneLayoutDataType(): DataTypeDefinition<SandboxSceneLayoutDefinition> {
  return {
    type: "sandbox.sceneLayout",
    getTags: (definition) => definition.tags ?? [],
    references(document) {
      return [
        ...document.data.objectIds.map((id, index) => ({
          type: "sandbox.sceneObject",
          id,
          path: `objectIds[${index}]`
        })),
        ...document.data.links.flatMap((link, index) => [
          {
            type: "sandbox.sceneObject",
            id: link.fromObjectId,
            path: `links[${index}].fromObjectId`
          },
          {
            type: "sandbox.sceneObject",
            id: link.toObjectId,
            path: `links[${index}].toObjectId`
          }
        ]),
        ...document.data.links
          .filter((link) => link.routeId)
          .map((link, index) => ({
            type: "sandbox.route",
            id: link.routeId!,
            path: `links[${index}].routeId`
          }))
      ];
    },
    validate(document) {
      return document.data.workerCount < 1
        ? [
            {
              code: "sandbox.scene_layout_missing_worker",
              message: "Sandbox scene layout must include at least one worker",
              severity: "error" as const,
              key: document
            }
          ]
        : [];
    }
  };
}

export function createBiomeDataType(): DataTypeDefinition<SandboxBiomeDefinition> {
  return {
    type: "sandbox.biome",
    getTags: (definition) => definition.tags ?? [],
    indexes: [
      {
        id: "hazard",
        values(document) {
          return document.data.navigation.hazards.map((hazard) => hazard.id);
        }
      }
    ],
    validate(document) {
      return document.data.navigation.friction < 0
        ? [
            {
              code: "sandbox.biome_invalid_friction",
              message: "Sandbox biome friction cannot be negative",
              severity: "error" as const,
              key: document
            }
          ]
        : [];
    }
  };
}

export function createSpawnProfileDataType(): DataTypeDefinition<SandboxSpawnProfileDefinition> {
  return {
    type: "sandbox.spawnProfile",
    getTags: (definition) => definition.tags ?? [],
    references(document) {
      return [
        { type: "sandbox.actor", id: document.data.actorId, path: "actorId" },
        { type: "sandbox.biome", id: document.data.biomeId, path: "biomeId" }
      ];
    },
    validate(document) {
      return document.data.waves.some((wave) => wave.count < 1)
        ? [
            {
              code: "sandbox.spawn_profile_invalid_wave",
              message: "Sandbox spawn profile waves must spawn at least one actor",
              severity: "error" as const,
              key: document
            }
          ]
        : [];
    }
  };
}

function collectRenderObjectAssetReferences(
  definition: RenderObjectDefinition
): Array<{ type: string; id: string; path: string }> {
  const references = collectNodeAssetReferences(definition, "props.textureId");
  for (const child of definition.children ?? []) {
    references.push(...collectNodeAssetReferences(child, `children.${child.id ?? child.type}`));
  }

  return references;
}

function collectNodeAssetReferences(
  definition: RenderObjectDefinition | RenderNodeDefinition,
  path: string
): Array<{ type: string; id: string; path: string }> {
  const textureId =
    typeof definition.props?.textureId === "string" ? definition.props.textureId : undefined;
  const references = textureId ? [{ type: "asset.definition", id: textureId, path }] : [];

  for (const child of definition.children ?? []) {
    const childPath = `${path}.children.${child.id ?? child.type}`;
    references.push(...collectNodeAssetReferences(child, childPath));
  }

  return references;
}

function collectUnsupportedRenderTypes(
  definition: RenderObjectDefinition | RenderNodeDefinition,
  supported: Set<RenderObjectType>,
  path = "type"
): Array<{ type: string; path: string }> {
  const unsupported = supported.has(definition.type) ? [] : [{ type: definition.type, path }];

  for (const child of definition.children ?? []) {
    unsupported.push(
      ...collectUnsupportedRenderTypes(
        child,
        supported,
        `${path}.children.${child.id ?? child.type}`
      )
    );
  }

  return unsupported;
}
