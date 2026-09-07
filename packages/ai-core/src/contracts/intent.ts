import type { NavigationPoint } from "@gamekits/navigation-core";
import type { AiAgentId } from "./agent-binding";

export type AiIntent =
  | {
      type: "movement";
      agentId: AiAgentId;
      desiredVelocity: NavigationPoint;
      source: string;
    }
  | {
      type: "aim";
      agentId: AiAgentId;
      targetId?: string | undefined;
      direction?: NavigationPoint | undefined;
      source: string;
    }
  | {
      type: "action";
      agentId: AiAgentId;
      actionId: string;
      targetId?: string | undefined;
      position?: NavigationPoint | undefined;
      source: string;
    }
  | {
      type: "interaction";
      agentId: AiAgentId;
      interactionId: string;
      targetId?: string | undefined;
      source: string;
    }
  | {
      type: "navigation-request";
      agentId: AiAgentId;
      requestId: string;
      source: string;
    }
  | {
      type: "navigation-cancel";
      agentId: AiAgentId;
      requestId: string;
      source: string;
    };

export type AiIntentInput = AiIntent extends infer TIntent
  ? TIntent extends AiIntent
    ? Omit<TIntent, "agentId" | "source">
    : never
  : never;

export type AiIntentSink = {
  emit(intent: AiIntent): void;
};
