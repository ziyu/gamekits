import type { DataRegistry } from "@gamekits/data";
import { createAnimatorError } from "../contracts/errors";
import type { AnimatorControllerBinding } from "../contracts/controller-binding";
import type { AnimatorControllerState, AnimatorLayerState } from "./controller-state";
import { createAnimatorParameterStore } from "./parameter-store";
import {
  ANIMATION_CLIP_TYPE,
  ANIMATOR_BINDING_TYPE,
  ANIMATOR_GRAPH_TYPE
} from "../graph/animator-data-types";
import type { AnimatorBindingDefinition } from "../graph/binding-definition";
import {
  cloneAnimationClipDefinition,
  cloneAnimatorBindingDefinition,
  cloneAnimatorGraphDefinition
} from "../graph/clone-definitions";
import type { AnimationClipDefinition } from "../graph/clip-definition";
import type { AnimatorGraphDefinition } from "../graph/graph-definition";

export function compileAnimatorController(
  dataRegistry: DataRegistry,
  binding: AnimatorControllerBinding,
  elapsed: number
): AnimatorControllerState {
  const definition = definitionFor<AnimatorBindingDefinition>(
    dataRegistry,
    ANIMATOR_BINDING_TYPE,
    binding.bindingId
  );
  const graph = definitionFor<AnimatorGraphDefinition>(
    dataRegistry,
    ANIMATOR_GRAPH_TYPE,
    definition.graph.id
  );
  const compiledGraph = cloneAnimatorGraphDefinition(graph);
  const compiledBinding = cloneAnimatorBindingDefinition(definition);
  const parameterDefinitions = new Map(
    compiledGraph.parameters.map((parameter) => [parameter.id, parameter])
  );
  const oneShots = new Map((compiledGraph.oneShots ?? []).map((oneShot) => [oneShot.id, oneShot]));
  if (parameterDefinitions.size !== compiledGraph.parameters.length) {
    throw createAnimatorError(
      "animator.invalid_config",
      `Animator graph contains duplicate parameters: ${compiledGraph.id}`
    );
  }
  if (oneShots.size !== (compiledGraph.oneShots?.length ?? 0)) {
    throw createAnimatorError(
      "animator.invalid_config",
      `Animator graph contains duplicate one-shots: ${compiledGraph.id}`
    );
  }
  const clips = new Map<string, AnimationClipDefinition>();
  for (const [alias, reference] of Object.entries(compiledBinding.clips)) {
    clips.set(
      alias,
      cloneAnimationClipDefinition(
        definitionFor<AnimationClipDefinition>(dataRegistry, ANIMATION_CLIP_TYPE, reference.id)
      )
    );
  }
  const state: AnimatorControllerState = {
    binding: { ...binding },
    definition: compiledBinding,
    clips,
    oneShots,
    parameters: createAnimatorParameterStore(parameterDefinitions.values()),
    parameterDefinitions,
    triggers: new Set(),
    layers: new Map<string, AnimatorLayerState>(
      compiledGraph.layers.map((layer): [string, AnimatorLayerState] => {
        const states = new Map(layer.states.map((graphState) => [graphState.id, graphState]));
        if (states.size !== layer.states.length) {
          throw createAnimatorError(
            "animator.invalid_config",
            `Animator layer contains duplicate states: ${compiledGraph.id}/${layer.id}`
          );
        }
        const transitions = (layer.transitions ?? [])
          .map((transition, sourceIndex) => ({ definition: transition, sourceIndex }))
          .sort((left, right) =>
            (right.definition.priority ?? 0) === (left.definition.priority ?? 0)
              ? left.sourceIndex - right.sourceIndex
              : (right.definition.priority ?? 0) - (left.definition.priority ?? 0)
          );
        return [
          layer.id,
          {
            definition: layer,
            states,
            transitions,
            stateId: layer.initialState,
            stateEnteredAt: elapsed,
            lastStateTimeMs: 0,
            lastStateUpdatedAt: elapsed,
            oneShot: undefined,
            queuedOneShots: [],
            gameplayPhase: undefined,
            playbackSerial: 0,
            lastEmittedPlaybackSerial: -1
          }
        ];
      })
    ),
    generation: binding.generation ?? 0,
    dirty: true,
    reasons: new Set(["bind"]),
    markerKeys: new Set(),
    markerOrder: [],
    emittedMarkers: 0
  };
  validateCompiledController(state);
  return state;
}

function validateCompiledController(state: AnimatorControllerState): void {
  for (const layer of state.layers.values()) {
    if (!layer.states.has(layer.definition.initialState)) {
      throw createAnimatorError(
        "animator.definition_missing",
        `Animator initial state is missing: ${layer.definition.id}/${layer.definition.initialState}`
      );
    }
    for (const graphState of layer.states.values()) {
      requireClipAlias(state, graphState.clip);
      if (
        graphState.speedParameter !== undefined &&
        state.parameterDefinitions.get(graphState.speedParameter)?.type !== "number"
      ) {
        throw createAnimatorError(
          "animator.invalid_config",
          `Animator state speedParameter must reference a number parameter: ${layer.definition.id}/${graphState.id}/${graphState.speedParameter}`
        );
      }
    }
  }
  for (const oneShot of state.oneShots.values()) {
    requireClipAlias(state, oneShot.clip);
    if (!state.layers.has(oneShot.layer)) {
      throw createAnimatorError(
        "animator.definition_missing",
        `Animator one-shot layer is missing: ${oneShot.layer}`
      );
    }
  }
  for (const mapping of state.definition.phaseMappings ?? []) {
    requireClipAlias(state, mapping.clip);
    if (!state.layers.has(mapping.layer)) {
      throw createAnimatorError(
        "animator.definition_missing",
        `Animator phase mapping layer is missing: ${mapping.layer}`
      );
    }
  }
}

function requireClipAlias(state: AnimatorControllerState, alias: string): void {
  const resolvedAlias = state.clips.has(alias) ? alias : state.definition.fallbackClip;
  if (resolvedAlias === undefined || !state.clips.has(resolvedAlias)) {
    throw createAnimatorError(
      "animator.definition_missing",
      `Animator clip alias is missing: ${alias}`,
      {
        controllerId: state.binding.controllerId,
        bindingId: state.definition.id
      }
    );
  }
}

function definitionFor<T>(dataRegistry: DataRegistry, type: string, definitionId: string): T {
  if (!dataRegistry.has(type, definitionId)) {
    throw createAnimatorError(
      "animator.definition_missing",
      `Animator definition is missing: ${type}/${definitionId}`
    );
  }
  return dataRegistry.getValue<T>(type, definitionId);
}
