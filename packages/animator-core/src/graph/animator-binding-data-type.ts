import type { DataReferenceTarget, DataTypeDefinition } from "@gamekits/data";
import type { AnimatorBindingDefinition } from "./binding-definition";
import {
  animatorDataDiagnostic,
  isAnimatorNonEmptyString,
  isAnimatorPositiveFinite,
  validateAnimatorDefinitionId
} from "./content-validation";
import {
  ANIMATION_CLIP_TYPE,
  ANIMATOR_BINDING_TYPE,
  ANIMATOR_GRAPH_TYPE
} from "./data-type-contract";

export function createAnimatorBindingDataType(): DataTypeDefinition<AnimatorBindingDefinition> {
  return {
    type: ANIMATOR_BINDING_TYPE,
    getTags: (binding) => binding.tags ?? [],
    validate(document) {
      const diagnostics = validateAnimatorDefinitionId(document, "animator.binding_missing_id");
      if (document.data.graph?.type !== ANIMATOR_GRAPH_TYPE || !document.data.graph.id) {
        diagnostics.push(
          animatorDataDiagnostic(
            "animator.binding_invalid_graph",
            "Animator binding requires an animator.graph reference",
            document,
            "graph"
          )
        );
      }
      if (
        document.data.fallbackClip !== undefined &&
        document.data.clips[document.data.fallbackClip] === undefined
      ) {
        diagnostics.push(
          animatorDataDiagnostic(
            "animator.binding_invalid_fallback",
            "Animator binding fallbackClip must be a declared clip alias",
            document,
            "fallbackClip"
          )
        );
      }
      for (const [alias, reference] of Object.entries(document.data.clips)) {
        if (
          !isAnimatorNonEmptyString(alias) ||
          reference.type !== ANIMATION_CLIP_TYPE ||
          !reference.id
        ) {
          diagnostics.push(
            animatorDataDiagnostic(
              "animator.binding_invalid_clip",
              "Animator binding clips require aliases and animation.clip references",
              document,
              `clips.${alias}`
            )
          );
        }
      }
      for (const [index, mapping] of (document.data.phaseMappings ?? []).entries()) {
        if (
          !isAnimatorNonEmptyString(mapping.phase) ||
          !isAnimatorNonEmptyString(mapping.layer) ||
          document.data.clips[mapping.clip] === undefined
        ) {
          diagnostics.push(
            animatorDataDiagnostic(
              "animator.binding_invalid_phase_mapping",
              "Animator phase mappings require a phase, layer, and declared clip alias",
              document,
              `phaseMappings[${index}]`
            )
          );
        }
        if (mapping.speed !== undefined && !isAnimatorPositiveFinite(mapping.speed)) {
          diagnostics.push(
            animatorDataDiagnostic(
              "animator.binding_invalid_phase_speed",
              "Animator phase mapping speed must be positive and finite",
              document,
              `phaseMappings[${index}].speed`
            )
          );
        }
      }
      return diagnostics;
    },
    references(document) {
      const references: DataReferenceTarget[] = [];
      if (document.data.graph?.id) {
        references.push({
          type: ANIMATOR_GRAPH_TYPE,
          id: document.data.graph.id,
          path: "graph"
        });
      }
      for (const [alias, reference] of Object.entries(document.data.clips ?? {})) {
        if (reference.id) {
          references.push({
            type: ANIMATION_CLIP_TYPE,
            id: reference.id,
            path: `clips.${alias}`
          });
        }
      }
      return references;
    }
  };
}
