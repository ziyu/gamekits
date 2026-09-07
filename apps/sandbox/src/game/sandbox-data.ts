import { createAssetDataType } from "@gamekits/asset";
import { createDataRegistry, type DataPack, type DataRegistry } from "@gamekits/data";
import { createGasDataTypes } from "@gamekits/gas";
import type { RenderObjectDefinition } from "@gamekits/renderer-core";
import { createTcaRuleDataType } from "@gamekits/tca";
import { sandboxCoreEntries } from "./content/core";
import { sandboxObjectiveEntries } from "./content/objectives";
import { sandboxWorkerEntries } from "./content/workers";
import {
  SANDBOX_ACTOR_ID,
  SANDBOX_ENTITY_RENDER_OBJECT_ID,
  SANDBOX_ENTITY_RENDER_RIG_ID,
  SANDBOX_TINY_CAMP_LAYOUT_ID,
  createAbilityDataType,
  createActorDataType,
  createBiomeDataType,
  createObjectivePhaseDataType,
  createRouteDataType,
  createRecipeDataType,
  createRenderObjectDataType,
  createRenderRigDataType,
  createSceneLayoutDataType,
  createSceneObjectDataType,
  createSpawnProfileDataType,
  createBuildingDataType,
  createWaveDataType,
  type SandboxActorDefinition,
  type SandboxObjectivePhaseDefinition,
  type SandboxRenderRigDefinition,
  type SandboxSceneLayoutDefinition,
  type SandboxSceneObjectDefinition,
  type SandboxBuildingDefinition
} from "./content/source";
import { sandboxBuildingEntries } from "./content/buildings";
import { sandboxMonsterEntries } from "./content/monsters";
import { sandboxVisualEntries } from "./content/visuals";

export * from "./content/source";

export const sandboxDataPack: DataPack = {
  id: "sandbox.base",
  version: "1.0.0",
  namespace: "sandbox",
  entries: [
    ...sandboxCoreEntries,
    ...sandboxBuildingEntries,
    ...sandboxWorkerEntries,
    ...sandboxMonsterEntries,
    ...sandboxObjectiveEntries,
    ...sandboxVisualEntries
  ]
};

export function createSandboxDataRegistry(): DataRegistry {
  const registry = createDataRegistry();
  registry.registerType(createAssetDataType({ supportedTypes: ["image", "spritesheet"] }));
  registry.registerType(createRenderObjectDataType(["debug.square", "sprite", "container"]));
  registry.registerType(createRenderRigDataType());
  registry.registerType(createSceneObjectDataType());
  registry.registerType(createBuildingDataType());
  registry.registerType(createRecipeDataType());
  registry.registerType(createObjectivePhaseDataType());
  registry.registerType(createWaveDataType());
  registry.registerType(createRouteDataType());
  registry.registerType(createSceneLayoutDataType());
  registry.registerType(createActorDataType());
  registry.registerType(createAbilityDataType());
  for (const type of createGasDataTypes()) {
    registry.registerType(type);
  }
  registry.registerType(createBiomeDataType());
  registry.registerType(createSpawnProfileDataType());
  registry.registerType(createTcaRuleDataType());
  registry.registerPack(sandboxDataPack);
  return registry;
}

export function getSandboxActorDefinition(registry: DataRegistry): SandboxActorDefinition {
  return registry.getValue<SandboxActorDefinition>("sandbox.actor", SANDBOX_ACTOR_ID);
}

export function getSandboxRenderRigDefinition(registry: DataRegistry): SandboxRenderRigDefinition {
  return registry.getValue<SandboxRenderRigDefinition>(
    "sandbox.renderRig",
    SANDBOX_ENTITY_RENDER_RIG_ID
  );
}

export function getSandboxEntityRenderObject(registry: DataRegistry): RenderObjectDefinition {
  return registry.getValue<RenderObjectDefinition>(
    "render.object",
    SANDBOX_ENTITY_RENDER_OBJECT_ID
  );
}

export function getSandboxTinyCampLayout(registry: DataRegistry): SandboxSceneLayoutDefinition {
  return registry.getValue<SandboxSceneLayoutDefinition>(
    "sandbox.sceneLayout",
    SANDBOX_TINY_CAMP_LAYOUT_ID
  );
}

export function getSandboxSceneObjects(
  registry: DataRegistry,
  layout: SandboxSceneLayoutDefinition
): SandboxSceneObjectDefinition[] {
  return layout.objectIds.map((id) =>
    registry.getValue<SandboxSceneObjectDefinition>("sandbox.sceneObject", id)
  );
}

export function getSandboxRenderObject(registry: DataRegistry, id: string): RenderObjectDefinition {
  return registry.getValue<RenderObjectDefinition>("render.object", id);
}

export function getSandboxRenderRig(
  registry: DataRegistry,
  id: string
): SandboxRenderRigDefinition {
  return registry.getValue<SandboxRenderRigDefinition>("sandbox.renderRig", id);
}

export function getSandboxBuildingDefinition(
  registry: DataRegistry,
  id: string
): SandboxBuildingDefinition {
  return registry.getValue<SandboxBuildingDefinition>("sandbox.building", id);
}

export function getSandboxObjectivePhase(
  registry: DataRegistry,
  id: string
): SandboxObjectivePhaseDefinition {
  return registry.getValue<SandboxObjectivePhaseDefinition>("sandbox.objectivePhase", id);
}
