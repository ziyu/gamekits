import type { EntityId } from "@gamekits/world";
import type { AiAgentBinding } from "../contracts/agent-binding";
import type { AiBlackboardValue } from "../contracts/blackboard-value";
import type { AiPerceptionFact } from "../perception/perception-fact";
import type { AiTaskState } from "../task/task-executor";

export type AiAgentCheckpoint = {
  binding: AiAgentBinding;
  schedulerClassId?: string | undefined;
  memory: AiPerceptionFact[];
  blackboard: Record<string, AiBlackboardValue>;
  currentGoalId?: string | undefined;
  currentGoalScore?: number | undefined;
  committedUntil?: number | undefined;
  task?: AiTaskState | undefined;
  cooldowns: Array<[string, number]>;
  nextDecisionAt: number;
  nextSensorAt: Array<[string, number]>;
  delayedDecisions: number;
};

export type AiRuntimeCheckpoint = {
  version: 1;
  elapsed: number;
  agents: AiAgentCheckpoint[];
};

export type AiRestoreOptions = {
  resolveEntityId?: ((savedEntityId: EntityId) => EntityId | undefined) | undefined;
  resolveActorId?: ((savedActorId: string) => string | undefined) | undefined;
  resolveTaskState?:
    | ((
        savedState: Readonly<Record<string, unknown>>,
        binding: Readonly<AiAgentBinding>
      ) => Record<string, unknown> | undefined)
    | undefined;
};
