import type { NavigationQueries } from "@gamekits/navigation-core";
import type { PhysicsQueries } from "@gamekits/physics-core";
import type { AiAgentReadContext } from "../contracts/agent-context";
import type { AiBlackboardValue } from "../contracts/blackboard-value";
import { cloneAiAgentBinding } from "../contracts/clone-binding";
import { cloneAiRecord } from "../contracts/clone-runtime-value";
import type { AiIntentInput } from "../contracts/intent";
import type { AiSharedFactQueries } from "../contracts/shared-fact-queries";
import type { AiWorldReadModel } from "../contracts/world-read-model";
import {
  cloneAiAgentDefinition,
  cloneAiGoalDefinition,
  cloneAiTaskDefinition
} from "../definition/clone-definitions";
import type { AiGoalDefinition } from "../definition/goal-definition";
import type { AiTaskDefinition } from "../definition/task-definition";
import { listAiPerceptionFacts, readAiPerceptionFact } from "../perception/perception-memory";
import type { AiTaskContext, AiTaskState } from "../task/task-executor";
import type { AiAgentState } from "./agent-state";

export type AiAgentContextFactory = {
  read(state: AiAgentState): AiAgentReadContext;
  task(
    state: AiAgentState,
    goal: AiGoalDefinition,
    task: AiTaskDefinition,
    taskState: AiTaskState
  ): AiTaskContext;
};

export function createAiAgentContextFactory(options: {
  elapsed(): number;
  world: AiWorldReadModel;
  navigationFor(state: AiAgentState): NavigationQueries | undefined;
  physics: PhysicsQueries | undefined;
  sharedFacts: AiSharedFactQueries | undefined;
  onIntent(state: AiAgentState, task: AiTaskDefinition, intent: AiIntentInput): void;
}): AiAgentContextFactory {
  function read(state: AiAgentState): AiAgentReadContext {
    const navigation = options.navigationFor(state);
    return {
      elapsed: options.elapsed(),
      agent: cloneAiAgentBinding(state.binding),
      definition: cloneAiAgentDefinition(state.definition),
      world: options.world,
      ...(navigation === undefined ? {} : { navigation }),
      ...(options.physics === undefined ? {} : { physics: options.physics }),
      ...(options.sharedFacts === undefined ? {} : { sharedFacts: options.sharedFacts }),
      facts: () => listAiPerceptionFacts(state.memory),
      fact: (key, subjectId) => readAiPerceptionFact(state.memory, key, subjectId),
      blackboard: <TValue extends AiBlackboardValue>(key: string) =>
        state.blackboard.read<TValue>(key)
    };
  }

  return {
    read,
    task(state, goal, task, taskState) {
      return {
        ...read(state),
        goal: cloneAiGoalDefinition(goal),
        task: cloneAiTaskDefinition(task),
        state: cloneAiRecord(taskState.state),
        emit(intent) {
          options.onIntent(state, task, intent);
        },
        setBlackboard(key, value) {
          state.blackboard.set(key, value);
        },
        deleteBlackboard(key) {
          state.blackboard.delete(key);
        }
      };
    }
  };
}
