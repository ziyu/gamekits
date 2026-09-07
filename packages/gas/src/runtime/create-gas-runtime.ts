import { GAS_ACTOR_TYPE, GAS_ATTRIBUTE_TYPE, GAS_CUE_TYPE, GAS_EFFECT_TYPE } from "./data-types";
import { createGasError } from "./errors";
import { createGasTraceStore } from "./trace-store";
import {
  GasAbilities,
  GasAbilityExecutions,
  GasActor,
  GasAttributes,
  GasEffects,
  GasTags
} from "./components";
import type { ComponentDef } from "@gamekits/world";
import {
  cloneGasActorState,
  cloneGasAttributes,
  cloneGasTags,
  uniqueGasValues
} from "./actor-state";
import { createGasEffectRuntime } from "./effect-runtime";
import { createGasAbilityExecutionRuntime } from "./ability-execution-runtime";
import { childGasContext } from "./operation-context";
import type {
  CreateGasRuntimeConfig,
  GasAbilityDefinition,
  GasAbilityExecutionState,
  GasActorDefinition,
  GasActorId,
  GasActorRuntimeState,
  GasAttributeDefinition,
  GasAttributeModifier,
  GasCueDefinition,
  GasEffectApplicationResult,
  GasOperationContext,
  GasRuntime,
  GasRuntimeCheckpoint,
  GasTraceEntry
} from "./types";

export function createGasRuntime(config: CreateGasRuntimeConfig): GasRuntime {
  const traceStore = config.traceStore ?? createGasTraceStore();
  const actorEntityById = new Map<GasActorId, string | number>();
  const detachedActors = new Map<GasActorId, GasActorRuntimeState>();
  const detachedExecutions = new Map<GasActorId, { active: GasAbilityExecutionState[] }>();
  let elapsedNow = 0;
  let disposed = false;
  const effectRuntime = createGasEffectRuntime({
    dataRegistry: config.dataRegistry,
    now: () => elapsedNow,
    requireActor: requireMutableActor,
    persistActor: persistState,
    modifyAttribute: modifyAttributeState,
    addTag: addTagState,
    removeTag: removeTagState,
    emitCues,
    trace,
    emit
  });
  const abilityExecutionRuntime = createGasAbilityExecutionRuntime({
    dataRegistry: config.dataRegistry,
    limits: config.abilityExecutions,
    now: () => elapsedNow,
    hasActor: (actorId) => findState(actorId) !== undefined,
    requireActor: requireMutableActor,
    persistActor: persistState,
    readExecutions: readActorExecutions,
    writeExecutions: writeActorExecutions,
    removeExecutions: removeActorExecutions,
    canPayCosts,
    payCosts,
    applyEffects: applyAbilityEffects,
    emitCues,
    trace,
    emit
  });

  const runtime: GasRuntime = {
    traceStore,
    createActor(input) {
      assertActive();
      const definition = config.dataRegistry.getValue<GasActorDefinition>(
        GAS_ACTOR_TYPE,
        input.definitionId
      );
      const actorId = input.actorId ?? String(input.entityId ?? input.definitionId);
      if (actorEntityById.has(actorId) && findState(actorId) === undefined) {
        removeActor(actorId, input, "entity-missing");
      }
      if (findState(actorId) !== undefined || actorEntityById.has(actorId)) {
        throw createGasError("gas.duplicate_actor", `Duplicate GAS actor: ${actorId}`, { actorId });
      }
      if (input.entityId !== undefined && config.world.get(input.entityId, GasActor)) {
        throw createGasError("gas.entity_bound", "World entity already has a GAS actor", {
          actorId,
          entityId: input.entityId
        });
      }

      const attributes = {
        ...definition.attributes,
        ...input.attributes
      };
      const tags = uniqueGasValues([...(definition.tags ?? []), ...(input.tags ?? [])]);
      const abilities = uniqueGasValues([
        ...(definition.abilities ?? []),
        ...(input.abilities ?? [])
      ]);
      const state: GasActorRuntimeState = {
        actor: {
          actorId,
          definitionId: input.definitionId,
          ...(input.entityId === undefined ? {} : { entityId: input.entityId })
        },
        attributes: {
          base: { ...attributes },
          current: { ...attributes }
        },
        tags: {
          values: tags,
          sources: Object.fromEntries(tags.map((tag) => [tag, ["actor"]]))
        },
        abilities: {
          ids: abilities,
          cooldowns: {},
          disabled: []
        },
        effects: {
          active: []
        }
      };

      if (input.entityId === undefined) {
        detachedActors.set(actorId, state);
      } else {
        config.world.add(input.entityId, GasActor, state.actor);
        config.world.add(input.entityId, GasAttributes, state.attributes);
        config.world.add(input.entityId, GasTags, state.tags);
        config.world.add(input.entityId, GasAbilities, state.abilities);
        config.world.add(input.entityId, GasEffects, state.effects);
        actorEntityById.set(actorId, input.entityId);
      }

      const actorTrace = trace(
        "actor.created",
        {
          actorId,
          message: `Created GAS actor: ${actorId}`,
          details: {
            definitionId: input.definitionId,
            entityId: input.entityId
          }
        },
        input
      );
      emit(
        "gas.actor_created",
        {
          actorId,
          definitionId: input.definitionId,
          entityId: input.entityId
        },
        childGasContext(input, actorTrace.id)
      );
      return cloneGasActorState(state);
    },
    removeActor(actorId, context) {
      assertActive();
      return removeActor(actorId, context, "explicit");
    },
    hasActor(actorId) {
      return findState(actorId) !== undefined;
    },
    getActor(actorId) {
      const state = findState(actorId);
      if (!state) {
        throw createGasError("gas.missing_actor", `Missing GAS actor: ${actorId}`, { actorId });
      }
      return cloneGasActorState(state);
    },
    actorForEntity(entityId) {
      if (!config.world.has(entityId)) {
        return undefined;
      }
      const state = readEntityActor(entityId);
      return state ? cloneGasActorState(state) : undefined;
    },
    activateAbility(input) {
      assertActive();
      return abilityExecutionRuntime.activate(input);
    },
    requestAbilityExecution(input) {
      assertActive();
      return abilityExecutionRuntime.request(input);
    },
    cancelAbilityExecution(input) {
      assertActive();
      return abilityExecutionRuntime.cancel(input);
    },
    getAbilityExecution(executionId) {
      return abilityExecutionRuntime.get(executionId);
    },
    listAbilityExecutions(query) {
      return abilityExecutionRuntime.list(query);
    },
    applyEffect(input) {
      assertActive();
      return effectRuntime.apply(input);
    },
    modifyAttribute(actorId, modifier, source, context) {
      assertActive();
      const state = requireMutableActor(actorId);
      modifyAttributeState(state, modifier, source, context);
      persistState(state);
    },
    addTag(actorId, tag, source, context) {
      assertActive();
      const state = requireMutableActor(actorId);
      addTagState(state, tag, source, context);
      persistState(state);
    },
    removeTag(actorId, tag, source, context) {
      assertActive();
      const state = requireMutableActor(actorId);
      removeTagState(state, tag, source, context);
      persistState(state);
    },
    update(_delta, elapsed) {
      if (disposed) {
        return;
      }

      elapsedNow = elapsed;
      cleanupMissingEntityActors();
      abilityExecutionRuntime.update();
      for (const state of mutableStates()) {
        if (effectRuntime.updateActor(state)) {
          persistState(state);
        }
      }
    },
    captureCheckpoint() {
      return {
        elapsed: elapsedNow,
        actors: mutableStates()
          .sort((left, right) => left.actor.actorId.localeCompare(right.actor.actorId))
          .map(cloneGasActorState),
        executions: abilityExecutionRuntime.capture()
      };
    },
    restoreCheckpoint(checkpoint, options) {
      assertActive();
      const states = prepareCheckpoint(checkpoint, options?.resolveEntityId);
      const statesByActorId = new Map(states.map((state) => [state.actor.actorId, state] as const));
      abilityExecutionRuntime.validateRestore(checkpoint.executions ?? [], {
        now: checkpoint.elapsed,
        hasActor: (actorId) => statesByActorId.has(actorId),
        requireActor(actorId) {
          const state = statesByActorId.get(actorId);
          if (state === undefined) {
            throw createGasError(
              "gas.checkpoint_missing_execution_actor",
              `Missing GAS execution actor: ${actorId}`
            );
          }
          return state;
        }
      });
      abilityExecutionRuntime.restore([]);
      for (const entityId of actorEntityById.values()) {
        removeActorComponents(entityId);
      }
      actorEntityById.clear();
      detachedActors.clear();
      for (const state of states) {
        const entityId = state.actor.entityId;
        if (entityId === undefined) {
          detachedActors.set(state.actor.actorId, cloneGasActorState(state));
          continue;
        }
        removeActorComponents(entityId);
        config.world.add(entityId, GasActor, state.actor);
        config.world.add(entityId, GasAttributes, state.attributes);
        config.world.add(entityId, GasTags, state.tags);
        config.world.add(entityId, GasAbilities, state.abilities);
        config.world.add(entityId, GasEffects, state.effects);
        actorEntityById.set(state.actor.actorId, entityId);
      }
      elapsedNow = checkpoint.elapsed;
      effectRuntime.synchronizeSequence(states);
      abilityExecutionRuntime.restore(checkpoint.executions ?? []);
      traceStore.clear();
    },
    snapshot() {
      return {
        actors: mutableStates().map(cloneGasActorState),
        activeExecutions: abilityExecutionRuntime.capture(),
        recentExecutions: abilityExecutionRuntime
          .list({ includeRecent: true })
          .filter(
            (execution) => execution.phase === "completed" || execution.phase === "cancelled"
          ),
        traces: traceStore.list()
      };
    },
    dispose() {
      if (disposed) {
        return;
      }
      disposed = true;
      abilityExecutionRuntime.dispose();
      for (const entityId of actorEntityById.values()) {
        removeActorComponents(entityId);
      }
      actorEntityById.clear();
      detachedActors.clear();
      detachedExecutions.clear();
    }
  };

  return runtime;

  function canPayCosts(state: GasActorRuntimeState, ability: GasAbilityDefinition): boolean {
    return (ability.costs ?? []).every(
      (cost) => (state.attributes.current[cost.attribute] ?? 0) >= cost.amount
    );
  }

  function payCosts(
    state: GasActorRuntimeState,
    ability: GasAbilityDefinition,
    context: GasOperationContext
  ): void {
    for (const cost of ability.costs ?? []) {
      modifyAttributeState(
        state,
        {
          attribute: cost.attribute,
          operation: "add",
          value: -cost.amount
        },
        ability.id,
        context
      );
    }
  }

  function applyAbilityEffects(
    execution: GasAbilityExecutionState,
    ability: GasAbilityDefinition,
    context: GasOperationContext
  ): GasEffectApplicationResult[] {
    const results: GasEffectApplicationResult[] = [];
    for (const effect of ability.effects ?? []) {
      const targetActorId =
        (effect.target ?? "target") === "self" ? execution.actorId : execution.targetActorId;
      if (targetActorId === undefined) {
        throw createGasError(
          "gas.missing_effect_target",
          "GAS effect application requires target",
          { abilityId: ability.id, effectId: effect.effectId, executionId: execution.id }
        );
      }
      results.push(
        effectRuntime.apply({
          sourceActorId: execution.actorId,
          targetActorId,
          effectId: effect.effectId,
          ...context
        })
      );
    }
    return results;
  }

  function modifyAttributeState(
    state: GasActorRuntimeState,
    modifier: GasAttributeModifier,
    source?: string,
    context?: GasOperationContext
  ): void {
    const previous = state.attributes.current[modifier.attribute] ?? 0;
    const rawNext =
      modifier.operation === "set"
        ? modifier.value
        : modifier.operation === "multiply"
          ? previous * modifier.value
          : previous + modifier.value;
    const next = clampAttribute(modifier.attribute, rawNext);
    state.attributes.current[modifier.attribute] = next;
    const attributeTrace = trace(
      "attribute.changed",
      {
        actorId: state.actor.actorId,
        message: `Changed GAS attribute: ${modifier.attribute}`,
        details: {
          attribute: modifier.attribute,
          previous,
          next,
          source
        }
      },
      context
    );
    emit(
      "gas.attribute_changed",
      {
        actorId: state.actor.actorId,
        attribute: modifier.attribute,
        previous,
        next,
        source
      },
      childGasContext(context, attributeTrace.id)
    );
  }

  function addTagState(
    state: GasActorRuntimeState,
    tag: string,
    source?: string,
    context?: GasOperationContext
  ): void {
    const sourceId = source ?? "runtime";
    const sources = (state.tags.sources ??= {});
    sources[tag] = uniqueGasValues([...(sources[tag] ?? []), sourceId]);
    if (state.tags.values.includes(tag)) {
      return;
    }
    state.tags.values.push(tag);
    const tagTrace = trace(
      "tag.added",
      {
        actorId: state.actor.actorId,
        message: `Added GAS tag: ${tag}`,
        details: { tag, source }
      },
      context
    );
    emit(
      "gas.tag_added",
      {
        actorId: state.actor.actorId,
        tag,
        source
      },
      childGasContext(context, tagTrace.id)
    );
  }

  function removeTagState(
    state: GasActorRuntimeState,
    tag: string,
    source?: string,
    context?: GasOperationContext
  ): void {
    if (!state.tags.values.includes(tag)) {
      return;
    }
    if (source !== undefined) {
      const remainingSources = (state.tags.sources?.[tag] ?? []).filter(
        (sourceId) => sourceId !== source
      );
      if (remainingSources.length > 0) {
        (state.tags.sources ??= {})[tag] = remainingSources;
        return;
      }
    }
    if (state.tags.sources) {
      delete state.tags.sources[tag];
    }
    state.tags.values = state.tags.values.filter((value) => value !== tag);
    const tagTrace = trace(
      "tag.removed",
      {
        actorId: state.actor.actorId,
        message: `Removed GAS tag: ${tag}`,
        details: { tag, source }
      },
      context
    );
    emit(
      "gas.tag_removed",
      {
        actorId: state.actor.actorId,
        tag,
        source
      },
      childGasContext(context, tagTrace.id)
    );
  }

  function emitCues(
    cueIds: string[],
    sourceActorId?: string,
    targetActorId?: string,
    context?: GasOperationContext
  ): void {
    for (const cueId of cueIds) {
      const cue = config.dataRegistry.getValue<GasCueDefinition>(GAS_CUE_TYPE, cueId);
      const event = {
        cueId,
        type: cue.type,
        sourceActorId,
        targetActorId,
        payload: cue.payload
      };
      const cueTrace = trace(
        "cue.emitted",
        {
          actorId: targetActorId ?? sourceActorId,
          message: `Emitted GAS cue: ${cueId}`,
          details: event
        },
        context
      );
      emit("gas.cue", event, childGasContext(context, cueTrace.id));
    }
  }

  function removeActor(
    actorId: GasActorId,
    context: GasOperationContext | undefined,
    reason: "explicit" | "entity-missing"
  ): boolean {
    const entityId = actorEntityById.get(actorId);
    const hasDetached = detachedActors.has(actorId);
    if (entityId === undefined && !hasDetached) {
      return false;
    }

    abilityExecutionRuntime.removeActor(actorId, `actor-${reason}`, context);

    if (entityId !== undefined) {
      removeActorComponents(entityId);
      actorEntityById.delete(actorId);
    }
    detachedActors.delete(actorId);
    detachedExecutions.delete(actorId);

    const removedTrace = trace(
      "actor.removed",
      {
        actorId,
        message: `Removed GAS actor: ${actorId}`,
        details: { entityId, reason }
      },
      context
    );
    emit(
      "gas.actor_removed",
      { actorId, entityId, reason },
      childGasContext(context, removedTrace.id)
    );
    return true;
  }

  function cleanupMissingEntityActors(): void {
    for (const [actorId, entityId] of actorEntityById) {
      if (!config.world.has(entityId) || readEntityActor(entityId) === undefined) {
        removeActor(actorId, undefined, "entity-missing");
      }
    }
  }

  function removeActorComponents(entityId: string | number): void {
    if (!config.world.has(entityId)) {
      return;
    }
    removeComponentIfPresent(entityId, GasActor);
    removeComponentIfPresent(entityId, GasAttributes);
    removeComponentIfPresent(entityId, GasTags);
    removeComponentIfPresent(entityId, GasAbilities);
    removeComponentIfPresent(entityId, GasEffects);
    removeComponentIfPresent(entityId, GasAbilityExecutions);
  }

  function removeComponentIfPresent<T extends object>(
    entityId: string | number,
    component: ComponentDef<T>
  ): void {
    if (config.world.get(entityId, component)) {
      config.world.remove(entityId, component);
    }
  }

  function clampAttribute(attribute: string, value: number): number {
    if (!config.dataRegistry.has(GAS_ATTRIBUTE_TYPE, attribute)) {
      return value;
    }

    const definition = config.dataRegistry.getValue<GasAttributeDefinition>(
      GAS_ATTRIBUTE_TYPE,
      attribute
    );
    const min = definition.min ?? Number.NEGATIVE_INFINITY;
    const max = definition.max ?? Number.POSITIVE_INFINITY;
    return Math.min(max, Math.max(min, value));
  }

  function requireMutableActor(actorId: string): GasActorRuntimeState {
    const state = findState(actorId);
    if (!state) {
      throw createGasError("gas.missing_actor", `Missing GAS actor: ${actorId}`, { actorId });
    }
    return state;
  }

  function findState(actorId: string): GasActorRuntimeState | undefined {
    const entityId = actorEntityById.get(actorId);
    if (entityId !== undefined) {
      if (!config.world.has(entityId)) {
        return undefined;
      }
      return readEntityActor(entityId);
    }
    return detachedActors.get(actorId);
  }

  function readEntityActor(entityId: string | number): GasActorRuntimeState | undefined {
    const actor = config.world.get(entityId, GasActor);
    const attributes = config.world.get(entityId, GasAttributes);
    const tags = config.world.get(entityId, GasTags);
    const abilities = config.world.get(entityId, GasAbilities);
    const effects = config.world.get(entityId, GasEffects);

    return actor && attributes && tags && abilities && effects
      ? { actor, attributes, tags, abilities, effects }
      : undefined;
  }

  function mutableStates(): GasActorRuntimeState[] {
    return [
      ...config.world
        .query([GasActor, GasAttributes, GasTags, GasAbilities, GasEffects])
        .map(readEntityActor)
        .filter((state): state is GasActorRuntimeState => state !== undefined),
      ...detachedActors.values()
    ];
  }

  function readActorExecutions(
    actorId: string
  ): { active: GasAbilityExecutionState[] } | undefined {
    const actor = findState(actorId);
    if (actor === undefined) {
      return undefined;
    }
    const entityId = actor.actor.entityId;
    if (entityId === undefined) {
      return detachedExecutions.get(actorId);
    }
    return config.world.get(entityId, GasAbilityExecutions);
  }

  function writeActorExecutions(
    actorId: string,
    state: { active: GasAbilityExecutionState[] }
  ): void {
    const actor = findState(actorId);
    if (actor === undefined) {
      return;
    }
    const entityId = actor.actor.entityId;
    if (entityId === undefined) {
      detachedExecutions.set(actorId, GasAbilityExecutions.create(state));
      return;
    }
    if (config.world.get(entityId, GasAbilityExecutions) === undefined) {
      config.world.add(entityId, GasAbilityExecutions, state);
      return;
    }
    config.world.set(entityId, GasAbilityExecutions, GasAbilityExecutions.create(state));
  }

  function removeActorExecutions(actorId: string): void {
    const actor = findState(actorId);
    const entityId = actor?.actor.entityId;
    if (
      entityId !== undefined &&
      config.world.has(entityId) &&
      config.world.get(entityId, GasAbilityExecutions) !== undefined
    ) {
      config.world.remove(entityId, GasAbilityExecutions);
    }
    detachedExecutions.delete(actorId);
  }

  function persistState(state: GasActorRuntimeState): void {
    const entityId = state.actor.entityId;
    if (entityId === undefined) {
      detachedActors.set(state.actor.actorId, cloneGasActorState(state));
      return;
    }
    if (!config.world.has(entityId)) {
      return;
    }

    config.world.set(entityId, GasAttributes, cloneGasAttributes(state.attributes));
    config.world.set(entityId, GasTags, cloneGasTags(state.tags));
    config.world.set(entityId, GasAbilities, {
      ids: [...state.abilities.ids],
      cooldowns: { ...state.abilities.cooldowns },
      disabled: [...state.abilities.disabled]
    });
    config.world.set(entityId, GasEffects, {
      active: state.effects.active.map((effect) => ({ ...effect }))
    });
  }

  function trace(
    type: Parameters<typeof traceStore.add>[0]["type"],
    entry: Omit<Parameters<typeof traceStore.add>[0], "type" | "timestamp">,
    context?: GasOperationContext
  ): GasTraceEntry {
    return traceStore.add({
      type,
      timestamp: elapsedNow,
      ...(context?.correlationId === undefined ? {} : { correlationId: context.correlationId }),
      ...(context?.parentId === undefined ? {} : { parentId: context.parentId }),
      ...entry
    });
  }

  function emit(type: string, payload: unknown, context?: GasOperationContext): void {
    config.eventBus?.emit(type, payload, "gas", context);
  }

  function prepareCheckpoint(
    checkpoint: GasRuntimeCheckpoint,
    resolveEntityId: ((savedEntityId: string | number) => string | number | undefined) | undefined
  ): GasActorRuntimeState[] {
    if (!Number.isFinite(checkpoint.elapsed) || checkpoint.elapsed < 0) {
      throw createGasError("gas.checkpoint_invalid_elapsed", "Invalid GAS checkpoint elapsed time");
    }
    if (!Array.isArray(checkpoint.actors)) {
      throw createGasError("gas.checkpoint_invalid_actors", "Invalid GAS checkpoint actors");
    }
    if (checkpoint.executions !== undefined && !Array.isArray(checkpoint.executions)) {
      throw createGasError(
        "gas.checkpoint_invalid_executions",
        "Invalid GAS checkpoint executions"
      );
    }
    const actorIds = new Set<string>();
    const entityIds = new Set<string | number>();
    return checkpoint.actors.map((savedState) => {
      const state = cloneGasActorState(savedState);
      const actorId = state.actor.actorId;
      if (actorIds.has(actorId)) {
        throw createGasError("gas.checkpoint_duplicate_actor", `Duplicate GAS actor: ${actorId}`);
      }
      actorIds.add(actorId);
      if (!config.dataRegistry.has(GAS_ACTOR_TYPE, state.actor.definitionId)) {
        throw createGasError(
          "gas.checkpoint_missing_definition",
          `Missing GAS actor definition: ${state.actor.definitionId}`
        );
      }
      for (const active of state.effects.active) {
        if (!config.dataRegistry.has(GAS_EFFECT_TYPE, active.effectId)) {
          throw createGasError(
            "gas.checkpoint_missing_effect",
            `Missing GAS effect definition: ${active.effectId}`
          );
        }
      }
      const savedEntityId = state.actor.entityId;
      if (savedEntityId === undefined) {
        return state;
      }
      const entityId = resolveEntityId?.(savedEntityId) ?? savedEntityId;
      if (!config.world.has(entityId)) {
        throw createGasError(
          "gas.checkpoint_missing_entity",
          `Missing restored GAS entity: ${String(entityId)}`,
          { actorId, savedEntityId, entityId }
        );
      }
      if (entityIds.has(entityId)) {
        throw createGasError(
          "gas.checkpoint_duplicate_entity",
          `Multiple GAS actors target restored entity: ${String(entityId)}`
        );
      }
      entityIds.add(entityId);
      state.actor.entityId = entityId;
      return state;
    });
  }

  function assertActive(): void {
    if (disposed) {
      throw createGasError("gas.disposed", "GAS runtime is disposed");
    }
  }
}
