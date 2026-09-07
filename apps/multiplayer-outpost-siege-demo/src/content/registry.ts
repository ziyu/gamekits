import { createAssetDataType } from "@gamekits/asset";
import { createAiDataTypes } from "@gamekits/ai-core";
import { createAnimatorDataTypes } from "@gamekits/animator-core";
import { createCombatDataTypes } from "@gamekits/combat";
import {
  createDataRegistry,
  type DataPack,
  type DataRegistry,
  type DataTypeDefinition
} from "@gamekits/data";
import { createGasDataTypes } from "@gamekits/gas";
import { createNavigationDataTypes } from "@gamekits/navigation-core";
import { createNavigationGraphDataType } from "@gamekits/navigation-graph";
import { createPhysicsDataTypes } from "@gamekits/physics-core";
import { createTcaRuleDataType } from "@gamekits/tca";
import { createOutpostDataTypes } from "./data-types";
import { outpostContentPack } from "./pack";

export type CreateOutpostDataRegistryOptions = {
  packs?: DataPack[] | undefined;
};

export function createOutpostDataRegistry(
  options: CreateOutpostDataRegistryOptions = {}
): DataRegistry {
  const registry = createDataRegistry();
  registerOutpostDataTypes(registry);
  for (const pack of options.packs ?? [outpostContentPack]) {
    registry.registerPack(pack);
  }
  return registry;
}

export function createAllOutpostDataTypes(): Array<DataTypeDefinition<any>> {
  return [
    createAssetDataType({
      supportedTypes: ["image", "spritesheet", "audio"],
      supportedSources: ["url"]
    }),
    ...createGasDataTypes(),
    ...createPhysicsDataTypes(),
    ...createCombatDataTypes(),
    ...createNavigationDataTypes(),
    createNavigationGraphDataType(),
    ...createAiDataTypes(),
    ...createAnimatorDataTypes(),
    createTcaRuleDataType(),
    ...createOutpostDataTypes()
  ];
}

export function registerOutpostDataTypes(registry: DataRegistry): void {
  for (const definition of createAllOutpostDataTypes()) {
    registry.registerType(definition);
  }
}
