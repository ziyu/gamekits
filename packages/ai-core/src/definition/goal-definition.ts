import type { DataRef } from "@gamekits/data";
import type { AiConsiderationDefinition } from "../decision/utility";

export type AiGoalDefinition = {
  id: string;
  task: DataRef<"ai.task">;
  considerations: AiConsiderationDefinition[];
  weight?: number | undefined;
  minScore?: number | undefined;
  commitmentMs?: number | undefined;
  switchThreshold?: number | undefined;
  cooldownMs?: number | undefined;
  tags?: string[] | undefined;
};
