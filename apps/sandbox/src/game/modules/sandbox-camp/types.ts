import type { GasRuntime } from "@gamekits/gas";
import type { RenderObjectDefinition } from "@gamekits/renderer-core";
import type { EntityId } from "@gamekits/world";
import type {
  SandboxBuildingDefinition,
  SandboxObjectivePhaseDefinition,
  SandboxRenderRigDefinition,
  SandboxSceneLayoutDefinition,
  SandboxSceneObjectDefinition
} from "../../sandbox-data";

export type SandboxCampModuleOptions = {
  layout: SandboxSceneLayoutDefinition;
  sceneObjects: SandboxSceneObjectDefinition[];
  renderObject: (id: string) => RenderObjectDefinition;
  renderRig: (id: string) => SandboxRenderRigDefinition;
  buildingDefinition: (id: string) => SandboxBuildingDefinition;
  objectivePhase: (id: string) => SandboxObjectivePhaseDefinition;
  gasRuntime?: (() => GasRuntime | undefined) | undefined;
};

export type SandboxCampRuntimeState = {
  entitiesByObjectId: Map<string, EntityId>;
  resourceObjectIds: string[];
};
