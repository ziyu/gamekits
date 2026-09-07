import type { NavigationQueries } from "@gamekits/navigation-core";
import type { PhysicsQueries } from "@gamekits/physics-core";
import type { AiAgentDefinition } from "../definition/agent-definition";
import type { AiPerceptionFact } from "../perception/perception-fact";
import type { AiBlackboardValue } from "./blackboard-value";
import type { AiAgentBinding } from "./agent-binding";
import type { AiSharedFactQueries } from "./shared-fact-queries";
import type { AiWorldReadModel } from "./world-read-model";

export type AiAgentReadContext = {
  elapsed: number;
  agent: AiAgentBinding;
  definition: AiAgentDefinition;
  world: AiWorldReadModel;
  navigation?: NavigationQueries | undefined;
  physics?: PhysicsQueries | undefined;
  sharedFacts?: AiSharedFactQueries | undefined;
  facts(): AiPerceptionFact[];
  fact(key: string, subjectId?: string | undefined): AiPerceptionFact | undefined;
  blackboard<TValue extends AiBlackboardValue = AiBlackboardValue>(key: string): TValue | undefined;
};
