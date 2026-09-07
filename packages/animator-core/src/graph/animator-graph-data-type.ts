import type { DataTypeDefinition } from "@gamekits/data";
import {
  animatorDataDiagnostic,
  isAnimatorNonEmptyString,
  isAnimatorPositiveFinite,
  validateAnimatorDefinitionId
} from "./content-validation";
import { ANIMATOR_GRAPH_TYPE } from "./data-type-contract";
import type { AnimatorGraphDefinition, AnimatorParameterDefinition } from "./graph-definition";

export function createAnimatorGraphDataType(): DataTypeDefinition<AnimatorGraphDefinition> {
  return {
    type: ANIMATOR_GRAPH_TYPE,
    getTags: (graph) => graph.tags ?? [],
    validate(document) {
      const diagnostics = validateAnimatorDefinitionId(document, "animator.graph_missing_id");
      const parameters = new Map<string, AnimatorParameterDefinition>();
      for (const [index, parameter] of document.data.parameters.entries()) {
        if (!isAnimatorNonEmptyString(parameter.id) || parameters.has(parameter.id)) {
          diagnostics.push(
            animatorDataDiagnostic(
              parameters.has(parameter.id)
                ? "animator.graph_duplicate_parameter"
                : "animator.graph_parameter_missing_id",
              "Animator parameters require unique ids",
              document,
              `parameters[${index}].id`
            )
          );
        }
        if (!parameterDefaultMatches(parameter)) {
          diagnostics.push(
            animatorDataDiagnostic(
              "animator.graph_invalid_parameter_default",
              "Animator parameter default does not match its type",
              document,
              `parameters[${index}].default`
            )
          );
        }
        parameters.set(parameter.id, parameter);
      }

      const layerIds = new Set<string>();
      for (const [layerIndex, layer] of document.data.layers.entries()) {
        if (!isAnimatorNonEmptyString(layer.id) || layerIds.has(layer.id)) {
          diagnostics.push(
            animatorDataDiagnostic(
              layerIds.has(layer.id)
                ? "animator.graph_duplicate_layer"
                : "animator.graph_layer_missing_id",
              "Animator layers require unique ids",
              document,
              `layers[${layerIndex}].id`
            )
          );
        }
        layerIds.add(layer.id);
        if (layer.priority !== undefined && !Number.isFinite(layer.priority)) {
          diagnostics.push(
            animatorDataDiagnostic(
              "animator.graph_invalid_layer_priority",
              "Animator layer priority must be finite",
              document,
              `layers[${layerIndex}].priority`
            )
          );
        }
        if (
          layer.weight !== undefined &&
          (!Number.isFinite(layer.weight) || layer.weight < 0 || layer.weight > 1)
        ) {
          diagnostics.push(
            animatorDataDiagnostic(
              "animator.graph_invalid_layer_weight",
              "Animator layer weight must be between zero and one",
              document,
              `layers[${layerIndex}].weight`
            )
          );
        }
        const stateIds = new Set<string>();
        for (const [stateIndex, state] of layer.states.entries()) {
          if (
            !isAnimatorNonEmptyString(state.id) ||
            !isAnimatorNonEmptyString(state.clip) ||
            stateIds.has(state.id)
          ) {
            diagnostics.push(
              animatorDataDiagnostic(
                "animator.graph_invalid_state",
                "Animator states require unique ids and clip aliases",
                document,
                `layers[${layerIndex}].states[${stateIndex}]`
              )
            );
          }
          stateIds.add(state.id);
          if (state.speed !== undefined && !isAnimatorPositiveFinite(state.speed)) {
            diagnostics.push(
              animatorDataDiagnostic(
                "animator.graph_invalid_state_speed",
                "Animator state speed must be positive and finite",
                document,
                `layers[${layerIndex}].states[${stateIndex}].speed`
              )
            );
          }
          if (
            state.speedParameter !== undefined &&
            (!isAnimatorNonEmptyString(state.speedParameter) ||
              parameters.get(state.speedParameter)?.type !== "number")
          ) {
            diagnostics.push(
              animatorDataDiagnostic(
                "animator.graph_invalid_state_speed_parameter",
                "Animator state speedParameter must reference a number parameter",
                document,
                `layers[${layerIndex}].states[${stateIndex}].speedParameter`
              )
            );
          }
        }
        if (!stateIds.has(layer.initialState)) {
          diagnostics.push(
            animatorDataDiagnostic(
              "animator.graph_missing_initial_state",
              "Animator layer initialState must exist",
              document,
              `layers[${layerIndex}].initialState`
            )
          );
        }
        for (const [transitionIndex, transition] of (layer.transitions ?? []).entries()) {
          if (
            (transition.from !== "*" && !stateIds.has(transition.from)) ||
            !stateIds.has(transition.to)
          ) {
            diagnostics.push(
              animatorDataDiagnostic(
                "animator.graph_invalid_transition_state",
                "Animator transitions must reference states in their layer",
                document,
                `layers[${layerIndex}].transitions[${transitionIndex}]`
              )
            );
          }
          if (transition.priority !== undefined && !Number.isFinite(transition.priority)) {
            diagnostics.push(
              animatorDataDiagnostic(
                "animator.graph_invalid_transition_priority",
                "Animator transition priority must be finite",
                document,
                `layers[${layerIndex}].transitions[${transitionIndex}].priority`
              )
            );
          }
          for (const [conditionIndex, condition] of transition.conditions.entries()) {
            if (!parameters.has(condition.parameter)) {
              diagnostics.push(
                animatorDataDiagnostic(
                  "animator.graph_unknown_condition_parameter",
                  "Animator transition condition references an unknown parameter",
                  document,
                  `layers[${layerIndex}].transitions[${transitionIndex}].conditions[${conditionIndex}].parameter`
                )
              );
            }
          }
        }
      }
      const oneShotIds = new Set<string>();
      for (const [index, oneShot] of (document.data.oneShots ?? []).entries()) {
        if (
          !isAnimatorNonEmptyString(oneShot.id) ||
          !isAnimatorNonEmptyString(oneShot.clip) ||
          !layerIds.has(oneShot.layer) ||
          oneShotIds.has(oneShot.id)
        ) {
          diagnostics.push(
            animatorDataDiagnostic(
              "animator.graph_invalid_one_shot",
              "Animator one-shots require a unique id, clip alias, and existing layer",
              document,
              `oneShots[${index}]`
            )
          );
        }
        if (
          oneShot.maxQueue !== undefined &&
          (!Number.isSafeInteger(oneShot.maxQueue) || oneShot.maxQueue < 0)
        ) {
          diagnostics.push(
            animatorDataDiagnostic(
              "animator.graph_invalid_one_shot_queue",
              "Animator one-shot maxQueue must be a non-negative integer",
              document,
              `oneShots[${index}].maxQueue`
            )
          );
        }
        if (oneShot.speed !== undefined && !isAnimatorPositiveFinite(oneShot.speed)) {
          diagnostics.push(
            animatorDataDiagnostic(
              "animator.graph_invalid_one_shot_speed",
              "Animator one-shot speed must be positive and finite",
              document,
              `oneShots[${index}].speed`
            )
          );
        }
        if (oneShot.priority !== undefined && !Number.isFinite(oneShot.priority)) {
          diagnostics.push(
            animatorDataDiagnostic(
              "animator.graph_invalid_one_shot_priority",
              "Animator one-shot priority must be finite",
              document,
              `oneShots[${index}].priority`
            )
          );
        }
        oneShotIds.add(oneShot.id);
      }
      return diagnostics;
    }
  };
}

function parameterDefaultMatches(parameter: AnimatorParameterDefinition): boolean {
  if (parameter.default === undefined) {
    return true;
  }
  switch (parameter.type) {
    case "number":
      return typeof parameter.default === "number" && Number.isFinite(parameter.default);
    case "boolean":
      return typeof parameter.default === "boolean";
    case "string":
      return typeof parameter.default === "string";
    case "trigger":
      return false;
  }
}
