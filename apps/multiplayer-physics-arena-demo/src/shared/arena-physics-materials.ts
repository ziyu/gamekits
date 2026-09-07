import type { PhysicsMaterialDefinition } from "@gamekits/physics-core";

import { compileArenaPropMaterial } from "../content/course-compiler";
import type { CompiledArenaContent } from "../content/registry";

const ARENA_BASE_PHYSICS_MATERIALS = [
  { id: "course", friction: 0.85, restitution: 0.05 },
  { id: "ice", friction: 0.08, restitution: 0.04 },
  { id: "mud", friction: 0.98, restitution: 0.01 },
  { id: "actor", friction: 0.55, restitution: 0.08, density: 1 },
  { id: "hazard", friction: 0.45, restitution: 0.3 }
] satisfies readonly PhysicsMaterialDefinition[];

export function createArenaPhysicsMaterialDefinitions(options: {
  content: Readonly<Pick<CompiledArenaContent, "stages">>;
  additional?: readonly Readonly<PhysicsMaterialDefinition>[] | undefined;
}): PhysicsMaterialDefinition[] {
  const definitions = [
    ...ARENA_BASE_PHYSICS_MATERIALS,
    ...options.content.stages.flatMap((stage) => stage.course.props.map(compileArenaPropMaterial)),
    ...(options.additional ?? [])
  ].map((definition) => structuredClone(definition));
  const ids = new Set<string>();
  for (const definition of definitions) {
    if (ids.has(definition.id)) {
      throw new Error(`Arena physics material requires a unique id: ${definition.id}`);
    }
    ids.add(definition.id);
  }
  return definitions;
}
