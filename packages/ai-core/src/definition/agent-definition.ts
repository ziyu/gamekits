import type { DataRef } from "@gamekits/data";

export type AiAgentDefinition = {
  id: string;
  sensors: Array<DataRef<"ai.sensor">>;
  goals: Array<DataRef<"ai.goal">>;
  decisionIntervalMs: number;
  memoryLimit: number;
  blackboardLimit?: number | undefined;
  schedulerClass?: string | undefined;
  tags?: string[] | undefined;
};
