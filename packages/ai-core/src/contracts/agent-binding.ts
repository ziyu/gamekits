import type { EntityId } from "@gamekits/world";

export type AiAgentId = string;

export type AiAgentBinding = {
  agentId: AiAgentId;
  definitionId: string;
  entityId?: EntityId | undefined;
  actorId?: string | undefined;
};
