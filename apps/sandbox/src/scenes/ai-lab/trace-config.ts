import type { AiTraceProductionOptions, AiTraceRetentionOptions } from "@gamekits/ai-core";

export const AI_LAB_TRACE_PRODUCTION = {
  maxEntriesPerUpdate: 96,
  goalScoreDetail: "all",
  emitDropSummary: true
} as const satisfies AiTraceProductionOptions;

export const AI_LAB_TRACE_RETENTION = {
  limit: 640,
  kinds: ["lifecycle", "decision", "goal", "task", "budget"],
  kindLimits: {
    decision: 160,
    budget: 64
  }
} as const satisfies AiTraceRetentionOptions;
