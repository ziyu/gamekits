import type { DataRegistry } from "@gamekits/data";
import { createAiError } from "../contracts/errors";
import { AI_AGENT_TYPE, AI_GOAL_TYPE, AI_SENSOR_TYPE, AI_TASK_TYPE } from "./ai-data-types";
import type { AiAgentDefinition } from "./agent-definition";
import {
  cloneAiAgentDefinition,
  cloneAiGoalDefinition,
  cloneAiSensorDefinition,
  cloneAiTaskDefinition
} from "./clone-definitions";
import type {
  AiDefinitionRuntimeRegistries,
  CompiledAiAgentDefinition
} from "./compiled-agent-definition";
import type { AiGoalDefinition } from "./goal-definition";
import type { AiSensorDefinition } from "./sensor-definition";
import type { AiTaskDefinition } from "./task-definition";

export type AiAgentDefinitionCompiler = {
  compile(definitionId: string): CompiledAiAgentDefinition;
  size(): number;
  clear(): void;
};

export function createAiAgentDefinitionCompiler(options: {
  dataRegistry: DataRegistry;
  registries: AiDefinitionRuntimeRegistries;
}): AiAgentDefinitionCompiler {
  const compiledDefinitions = new Map<string, CompiledAiAgentDefinition>();

  return {
    compile(definitionId) {
      const existing = compiledDefinitions.get(definitionId);
      if (existing !== undefined) {
        return existing;
      }
      const definition = cloneAiAgentDefinition(
        definitionFor<AiAgentDefinition>(AI_AGENT_TYPE, definitionId)
      );
      const sensors = definition.sensors.map((sensorRef) =>
        cloneAiSensorDefinition(definitionFor<AiSensorDefinition>(AI_SENSOR_TYPE, sensorRef.id))
      );
      for (const sensor of sensors) {
        if (!options.registries.sensors.has(sensor.sampler)) {
          throw createAiError(
            "ai.definition_missing",
            `AI sensor sampler is not registered: ${sensor.sampler}`
          );
        }
      }
      const goals = definition.goals.map((goalRef) =>
        cloneAiGoalDefinition(definitionFor<AiGoalDefinition>(AI_GOAL_TYPE, goalRef.id))
      );
      const goalsById = new Map(goals.map((goal) => [goal.id, goal]));
      if (goalsById.size !== goals.length) {
        throw createAiError(
          "ai.duplicate_registry_entry",
          `AI agent contains duplicate goals: ${definition.id}`
        );
      }
      const tasksById = new Map<string, AiTaskDefinition>();
      for (const goal of goals) {
        for (const consideration of goal.considerations) {
          if (!options.registries.inputs.has(consideration.input)) {
            throw createAiError(
              "ai.definition_missing",
              `AI utility input is not registered: ${consideration.input}`
            );
          }
        }
        let task = tasksById.get(goal.task.id);
        if (task === undefined) {
          task = cloneAiTaskDefinition(definitionFor<AiTaskDefinition>(AI_TASK_TYPE, goal.task.id));
          tasksById.set(task.id, task);
        }
        if (!options.registries.tasks.has(task.executor)) {
          throw createAiError(
            "ai.definition_missing",
            `AI task executor is not registered: ${task.executor}`
          );
        }
      }
      const schedulerClassId = definition.schedulerClass ?? "default";
      const schedulerClass = options.registries.schedulerClasses.get(schedulerClassId);
      if (schedulerClass === undefined) {
        throw createAiError(
          "ai.definition_missing",
          `AI scheduler class is not registered: ${schedulerClassId}`
        );
      }
      const compiled: CompiledAiAgentDefinition = {
        definition,
        sensors,
        goals,
        goalsById,
        tasksById,
        schedulerClass
      };
      compiledDefinitions.set(definitionId, compiled);
      return compiled;
    },
    size() {
      return compiledDefinitions.size;
    },
    clear() {
      compiledDefinitions.clear();
    }
  };

  function definitionFor<TValue>(type: string, definitionId: string): TValue {
    if (!options.dataRegistry.has(type, definitionId)) {
      throw createAiError(
        "ai.definition_missing",
        `AI definition is missing: ${type}/${definitionId}`
      );
    }
    return options.dataRegistry.getValue<TValue>(type, definitionId);
  }
}
