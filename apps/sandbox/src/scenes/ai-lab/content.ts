import { createAiDataTypes } from "@gamekits/ai-core";
import {
  createDataRegistry,
  type DataPack,
  type DataRegistry,
  type DataTypeDefinition
} from "@gamekits/data";
import type { AiLabSpecies } from "./types";

export const AI_LAB_AGENT_PREFIX = "ai-lab.animal.";

export const AI_LAB_GOAL_IDS = {
  hide: "ai-lab.goal.hide",
  forage: "ai-lab.goal.forage",
  drink: "ai-lab.goal.drink",
  rest: "ai-lab.goal.rest",
  wander: "ai-lab.goal.wander"
} as const;

export function aiLabAgentDefinitionId(species: AiLabSpecies): string {
  return `ai-lab.agent.${species}`;
}

export function createAiLabDataRegistry(): DataRegistry {
  const registry = createDataRegistry();
  for (const type of createAiDataTypes()) {
    registry.registerType(type as DataTypeDefinition);
  }
  const validation = registry.registerPack(AI_LAB_DATA_PACK);
  const errors = validation.diagnostics.filter((diagnostic) => diagnostic.severity === "error");
  if (errors.length > 0) {
    throw new Error(`AI Lab data pack is invalid: ${JSON.stringify(errors)}`);
  }
  return registry;
}

export const AI_LAB_DATA_PACK: DataPack = {
  id: "sandbox.ai-lab.ecosystem",
  version: "2.0.0",
  entries: [
    {
      type: "ai.sensor",
      id: "ai-lab.sensor.survival",
      data: {
        id: "ai-lab.sensor.survival",
        sampler: "ai-lab.survival",
        intervalMs: 220,
        tags: ["sandbox", "ecosystem", "survival"]
      }
    },
    {
      type: "ai.task",
      id: "ai-lab.task.hide",
      data: {
        id: "ai-lab.task.hide",
        executor: "ai-lab.seek-safety",
        interruptPolicy: "safe-point",
        timeoutMs: 45_000
      }
    },
    {
      type: "ai.task",
      id: "ai-lab.task.forage",
      data: {
        id: "ai-lab.task.forage",
        executor: "ai-lab.seek-food",
        interruptPolicy: "safe-point",
        timeoutMs: 20_000
      }
    },
    {
      type: "ai.task",
      id: "ai-lab.task.drink",
      data: {
        id: "ai-lab.task.drink",
        executor: "ai-lab.seek-water",
        interruptPolicy: "safe-point",
        timeoutMs: 20_000
      }
    },
    {
      type: "ai.task",
      id: "ai-lab.task.rest",
      data: {
        id: "ai-lab.task.rest",
        executor: "ai-lab.seek-shelter",
        interruptPolicy: "safe-point",
        timeoutMs: 24_000
      }
    },
    {
      type: "ai.task",
      id: "ai-lab.task.wander",
      data: {
        id: "ai-lab.task.wander",
        executor: "ai-lab.wander",
        interruptPolicy: "safe-point",
        timeoutMs: 8_500
      }
    },
    {
      type: "ai.goal",
      id: AI_LAB_GOAL_IDS.hide,
      data: {
        id: AI_LAB_GOAL_IDS.hide,
        task: { type: "ai.task", id: "ai-lab.task.hide" },
        considerations: [
          { input: "ai-lab.forest-alert", curve: { type: "linear" } },
          { input: "ai-lab.shelter-access", curve: { type: "linear" }, weight: 0.3 }
        ],
        weight: 2.4,
        minScore: 0.1,
        commitmentMs: 900,
        switchThreshold: 0.01,
        tags: ["sandbox", "survival", "safety", "shared-fact"]
      }
    },
    {
      type: "ai.goal",
      id: AI_LAB_GOAL_IDS.forage,
      data: {
        id: AI_LAB_GOAL_IDS.forage,
        task: { type: "ai.task", id: "ai-lab.task.forage" },
        considerations: [
          { input: "ai-lab.hunger", curve: { type: "power", exponent: 1.35 } },
          { input: "ai-lab.food-access", curve: { type: "linear" }, weight: 0.45 }
        ],
        minScore: 0.05,
        commitmentMs: 420,
        switchThreshold: 0.05,
        tags: ["sandbox", "survival", "food"]
      }
    },
    {
      type: "ai.goal",
      id: AI_LAB_GOAL_IDS.drink,
      data: {
        id: AI_LAB_GOAL_IDS.drink,
        task: { type: "ai.task", id: "ai-lab.task.drink" },
        considerations: [
          { input: "ai-lab.thirst", curve: { type: "power", exponent: 1.25 } },
          { input: "ai-lab.water-access", curve: { type: "linear" }, weight: 0.4 }
        ],
        weight: 1.08,
        minScore: 0.05,
        commitmentMs: 360,
        switchThreshold: 0.04,
        tags: ["sandbox", "survival", "water"]
      }
    },
    {
      type: "ai.goal",
      id: AI_LAB_GOAL_IDS.rest,
      data: {
        id: AI_LAB_GOAL_IDS.rest,
        task: { type: "ai.task", id: "ai-lab.task.rest" },
        considerations: [
          { input: "ai-lab.fatigue", curve: { type: "power", exponent: 1.2 } },
          { input: "ai-lab.shelter-access", curve: { type: "linear" }, weight: 0.35 }
        ],
        minScore: 0.05,
        commitmentMs: 520,
        switchThreshold: 0.05,
        tags: ["sandbox", "survival", "rest"]
      }
    },
    {
      type: "ai.goal",
      id: AI_LAB_GOAL_IDS.wander,
      data: {
        id: AI_LAB_GOAL_IDS.wander,
        task: { type: "ai.task", id: "ai-lab.task.wander" },
        considerations: [
          { input: "ai-lab.contentment", curve: { type: "linear" } },
          { input: "ai-lab.forest-calm", curve: { type: "linear" }, weight: 0.65 }
        ],
        weight: 0.52,
        minScore: 0.06,
        commitmentMs: 700,
        switchThreshold: 0.08,
        tags: ["sandbox", "ecosystem", "wander"]
      }
    },
    ...(["rabbit", "squirrel", "hedgehog", "mouse"] as const).map((species) => ({
      type: "ai.agent",
      id: aiLabAgentDefinitionId(species),
      data: {
        id: aiLabAgentDefinitionId(species),
        sensors: [{ type: "ai.sensor", id: "ai-lab.sensor.survival" }],
        goals: Object.values(AI_LAB_GOAL_IDS).map((id) => ({ type: "ai.goal", id })),
        decisionIntervalMs: species === "hedgehog" ? 280 : species === "rabbit" ? 200 : 230,
        memoryLimit: 10,
        blackboardLimit: 4,
        schedulerClass: species === "hedgehog" ? "steady" : "nimble",
        tags: ["sandbox", "ecosystem", species]
      }
    }))
  ]
};
