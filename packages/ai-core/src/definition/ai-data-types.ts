import type {
  DataDiagnostic,
  DataDocument,
  DataReferenceTarget,
  DataTypeDefinition
} from "@gamekits/data";
import type { AiUtilityCurve } from "../decision/utility";
import type { AiAgentDefinition } from "./agent-definition";
import type { AiGoalDefinition } from "./goal-definition";
import type { AiSensorDefinition } from "./sensor-definition";
import type { AiTaskDefinition } from "./task-definition";

export const AI_AGENT_TYPE = "ai.agent";
export const AI_SENSOR_TYPE = "ai.sensor";
export const AI_GOAL_TYPE = "ai.goal";
export const AI_TASK_TYPE = "ai.task";

export type AiDataTypeDefinition =
  | DataTypeDefinition<AiAgentDefinition>
  | DataTypeDefinition<AiSensorDefinition>
  | DataTypeDefinition<AiGoalDefinition>
  | DataTypeDefinition<AiTaskDefinition>;

export function createAiDataTypes(): AiDataTypeDefinition[] {
  return [
    createAiAgentDataType(),
    createAiSensorDataType(),
    createAiGoalDataType(),
    createAiTaskDataType()
  ];
}

export function createAiAgentDataType(): DataTypeDefinition<AiAgentDefinition> {
  return {
    type: AI_AGENT_TYPE,
    getTags: (definition) => definition.tags ?? [],
    validate(document) {
      const diagnostics = validateId(document, "ai.agent_missing_id");
      if (!positiveFinite(document.data.decisionIntervalMs)) {
        diagnostics.push(
          diagnostic(
            "ai.agent_invalid_decision_interval",
            "AI agent decisionIntervalMs must be positive and finite",
            document,
            "decisionIntervalMs"
          )
        );
      }
      if (!Number.isSafeInteger(document.data.memoryLimit) || document.data.memoryLimit <= 0) {
        diagnostics.push(
          diagnostic(
            "ai.agent_invalid_memory_limit",
            "AI agent memoryLimit must be a positive integer",
            document,
            "memoryLimit"
          )
        );
      }
      if (
        document.data.blackboardLimit !== undefined &&
        (!Number.isSafeInteger(document.data.blackboardLimit) || document.data.blackboardLimit <= 0)
      ) {
        diagnostics.push(
          diagnostic(
            "ai.agent_invalid_blackboard_limit",
            "AI agent blackboardLimit must be a positive integer",
            document,
            "blackboardLimit"
          )
        );
      }
      diagnostics.push(...validateRefs(document.data.sensors, AI_SENSOR_TYPE, document, "sensors"));
      diagnostics.push(...validateRefs(document.data.goals, AI_GOAL_TYPE, document, "goals"));
      return diagnostics;
    },
    references(document) {
      return [
        ...references(document.data.sensors, "sensors"),
        ...references(document.data.goals, "goals")
      ];
    }
  };
}

export function createAiSensorDataType(): DataTypeDefinition<AiSensorDefinition> {
  return {
    type: AI_SENSOR_TYPE,
    getTags: (definition) => definition.tags ?? [],
    validate(document) {
      const diagnostics = validateId(document, "ai.sensor_missing_id");
      if (!nonEmptyString(document.data.sampler)) {
        diagnostics.push(
          diagnostic(
            "ai.sensor_missing_sampler",
            "AI sensor requires a sampler id",
            document,
            "sampler"
          )
        );
      }
      if (!positiveFinite(document.data.intervalMs)) {
        diagnostics.push(
          diagnostic(
            "ai.sensor_invalid_interval",
            "AI sensor intervalMs must be positive and finite",
            document,
            "intervalMs"
          )
        );
      }
      return diagnostics;
    }
  };
}

export function createAiGoalDataType(): DataTypeDefinition<AiGoalDefinition> {
  return {
    type: AI_GOAL_TYPE,
    getTags: (definition) => definition.tags ?? [],
    validate(document) {
      const diagnostics = validateId(document, "ai.goal_missing_id");
      diagnostics.push(...validateRefs([document.data.task], AI_TASK_TYPE, document, "task"));
      if (
        !Array.isArray(document.data.considerations) ||
        document.data.considerations.length === 0
      ) {
        diagnostics.push(
          diagnostic(
            "ai.goal_missing_considerations",
            "AI goal requires at least one consideration",
            document,
            "considerations"
          )
        );
      }
      for (const [index, consideration] of (document.data.considerations ?? []).entries()) {
        if (!nonEmptyString(consideration.input)) {
          diagnostics.push(
            diagnostic(
              "ai.goal_missing_input",
              "AI consideration requires an input id",
              document,
              `considerations[${index}].input`
            )
          );
        }
        if (consideration.weight !== undefined && !positiveFinite(consideration.weight)) {
          diagnostics.push(
            diagnostic(
              "ai.goal_invalid_consideration_weight",
              "AI consideration weight must be positive and finite",
              document,
              `considerations[${index}].weight`
            )
          );
        }
        diagnostics.push(
          ...validateCurve(consideration.curve, document, `considerations[${index}].curve`)
        );
      }
      for (const [field, value] of [
        ["weight", document.data.weight],
        ["commitmentMs", document.data.commitmentMs],
        ["switchThreshold", document.data.switchThreshold],
        ["cooldownMs", document.data.cooldownMs]
      ] as const) {
        if (value !== undefined && !nonNegativeFinite(value)) {
          diagnostics.push(
            diagnostic(
              "ai.goal_invalid_number",
              `AI goal ${field} must be non-negative and finite`,
              document,
              field
            )
          );
        }
      }
      if (
        document.data.minScore !== undefined &&
        (!Number.isFinite(document.data.minScore) ||
          document.data.minScore < 0 ||
          document.data.minScore > 1)
      ) {
        diagnostics.push(
          diagnostic(
            "ai.goal_invalid_min_score",
            "AI goal minScore must be between zero and one",
            document,
            "minScore"
          )
        );
      }
      return diagnostics;
    },
    references(document) {
      return references([document.data.task], "task");
    }
  };
}

export function createAiTaskDataType(): DataTypeDefinition<AiTaskDefinition> {
  return {
    type: AI_TASK_TYPE,
    getTags: (definition) => definition.tags ?? [],
    validate(document) {
      const diagnostics = validateId(document, "ai.task_missing_id");
      if (!nonEmptyString(document.data.executor)) {
        diagnostics.push(
          diagnostic(
            "ai.task_missing_executor",
            "AI task requires an executor id",
            document,
            "executor"
          )
        );
      }
      if (
        document.data.interruptPolicy !== undefined &&
        !(["always", "safe-point", "never"] as unknown[]).includes(document.data.interruptPolicy)
      ) {
        diagnostics.push(
          diagnostic(
            "ai.task_invalid_interrupt_policy",
            "AI task interrupt policy is invalid",
            document,
            "interruptPolicy"
          )
        );
      }
      if (document.data.timeoutMs !== undefined && !positiveFinite(document.data.timeoutMs)) {
        diagnostics.push(
          diagnostic(
            "ai.task_invalid_timeout",
            "AI task timeoutMs must be positive and finite",
            document,
            "timeoutMs"
          )
        );
      }
      return diagnostics;
    }
  };
}

function validateCurve(
  curve: AiUtilityCurve,
  document: DataDocument,
  path: string
): DataDiagnostic[] {
  if (
    !curve ||
    !(["linear", "inverse", "step", "power", "points"] as unknown[]).includes(curve.type)
  ) {
    return [
      diagnostic("ai.goal_invalid_curve", "AI utility curve type is invalid", document, path)
    ];
  }
  if (curve.type === "power" && !positiveFinite(curve.exponent)) {
    return [
      diagnostic(
        "ai.goal_invalid_curve_exponent",
        "AI power curve exponent must be positive and finite",
        document,
        `${path}.exponent`
      )
    ];
  }
  if (curve.type === "step" && !Number.isFinite(curve.threshold)) {
    return [
      diagnostic(
        "ai.goal_invalid_curve_threshold",
        "AI step curve threshold must be finite",
        document,
        `${path}.threshold`
      )
    ];
  }
  if (curve.type === "points") {
    if (curve.points.length < 2) {
      return [
        diagnostic(
          "ai.goal_invalid_curve_points",
          "AI points curve requires at least two points",
          document,
          `${path}.points`
        )
      ];
    }
    for (let index = 0; index < curve.points.length; index += 1) {
      const point = curve.points[index];
      const previous = curve.points[index - 1];
      if (
        point === undefined ||
        !Number.isFinite(point.x) ||
        !Number.isFinite(point.y) ||
        (previous !== undefined && point.x <= previous.x)
      ) {
        return [
          diagnostic(
            "ai.goal_invalid_curve_points",
            "AI points curve coordinates must be finite and sorted by ascending x",
            document,
            `${path}.points[${index}]`
          )
        ];
      }
    }
  }
  return [];
}

function validateRefs(
  values: Array<{ type: string; id: string }> | undefined,
  expectedType: string,
  document: DataDocument,
  path: string
): DataDiagnostic[] {
  if (!Array.isArray(values)) {
    return [diagnostic("ai.invalid_references", `AI ${path} must be an array`, document, path)];
  }
  const diagnostics: DataDiagnostic[] = [];
  const ids = new Set<string>();
  for (const [index, reference] of values.entries()) {
    if (
      reference?.type !== expectedType ||
      !nonEmptyString(reference.id) ||
      ids.has(reference.id)
    ) {
      diagnostics.push(
        diagnostic(
          ids.has(reference?.id) ? "ai.duplicate_reference" : "ai.invalid_reference",
          `AI ${path} entries must be unique ${expectedType} references`,
          document,
          `${path}[${index}]`
        )
      );
    }
    if (reference?.id) {
      ids.add(reference.id);
    }
  }
  return diagnostics;
}

function references(
  values: Array<{ type: string; id: string }> | undefined,
  path: string
): DataReferenceTarget[] {
  return (values ?? [])
    .filter((reference) => reference?.type && reference.id)
    .map((reference, index) => ({
      type: reference.type,
      id: reference.id,
      path: `${path}[${index}]`
    }));
}

function validateId<T extends { id: string }>(
  document: DataDocument<T>,
  code: string
): DataDiagnostic[] {
  return nonEmptyString(document.data.id)
    ? []
    : [diagnostic(code, "AI definition requires an id", document, "id")];
}

function diagnostic(
  code: string,
  message: string,
  document: DataDocument,
  path: string
): DataDiagnostic {
  return {
    code,
    message,
    severity: "error",
    key: { type: document.type, id: document.id },
    path,
    ...(document.sourcePackId === undefined ? {} : { sourcePackId: document.sourcePackId })
  };
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function positiveFinite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function nonNegativeFinite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}
