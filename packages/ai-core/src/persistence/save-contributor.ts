import type {
  SaveContributor,
  SaveRestoreContext,
  SaveSection,
  SaveValidationIssue
} from "@gamekits/save";
import type { AiAgentBinding } from "../contracts/agent-binding";
import type { AiHandle } from "../controller/runtime";
import type { AiRuntimeCheckpoint } from "./checkpoint";

export type CreateAiSaveContributorOptions = {
  handle: AiHandle;
  id?: string | undefined;
  version?: string | undefined;
  order?: number | undefined;
  required?: boolean | undefined;
  resolveActorId?:
    | ((savedActorId: string, context: SaveRestoreContext) => string | undefined)
    | undefined;
  resolveTaskState?:
    | ((
        savedState: Readonly<Record<string, unknown>>,
        binding: Readonly<AiAgentBinding>,
        context: SaveRestoreContext
      ) => Record<string, unknown> | undefined)
    | undefined;
};

export function createAiSaveContributor(
  options: CreateAiSaveContributorOptions
): SaveContributor<AiRuntimeCheckpoint> {
  const id = options.id ?? "ai";
  const version = options.version ?? "1";
  return {
    id,
    version,
    order: options.order ?? 375,
    scope: "gameplay",
    tags: ["gameplay", "ai", "checkpoint"],
    saveByDefault: true,
    required: options.required ?? true,
    capture() {
      return { id, version, data: options.handle.captureCheckpoint() };
    },
    restore(context, section) {
      options.handle.restoreCheckpoint(section.data, {
        resolveEntityId(savedEntityId) {
          return context.entityMap.get(savedEntityId) ?? savedEntityId;
        },
        ...(options.resolveActorId === undefined
          ? {}
          : {
              resolveActorId(savedActorId: string) {
                return options.resolveActorId?.(savedActorId, context);
              }
            }),
        ...(options.resolveTaskState === undefined
          ? {}
          : {
              resolveTaskState(
                savedState: Readonly<Record<string, unknown>>,
                binding: Readonly<AiAgentBinding>
              ) {
                return options.resolveTaskState?.(savedState, binding, context);
              }
            })
      });
    },
    validate(section) {
      return { issues: validateAiSection(section) };
    }
  };
}

function validateAiSection(section: SaveSection<AiRuntimeCheckpoint>): SaveValidationIssue[] {
  const issues: SaveValidationIssue[] = [];
  if (section.data.version !== 1) {
    issues.push(issue("ai.save_invalid_version", "AI save version must be 1", "data.version"));
  }
  if (!Number.isFinite(section.data.elapsed) || section.data.elapsed < 0) {
    issues.push(
      issue(
        "ai.save_invalid_elapsed",
        "AI save elapsed must be a non-negative finite number",
        "data.elapsed"
      )
    );
  }
  if (!Array.isArray(section.data.agents)) {
    issues.push(issue("ai.save_invalid_agents", "AI save agents must be an array", "data.agents"));
    return issues;
  }
  const agentIds = new Set<string>();
  for (const [index, agent] of section.data.agents.entries()) {
    const path = `data.agents[${index}]`;
    if (
      typeof agent.binding?.agentId !== "string" ||
      agent.binding.agentId.length === 0 ||
      agentIds.has(agent.binding.agentId)
    ) {
      issues.push(
        issue(
          "ai.save_invalid_agent_id",
          "AI save agent ids must be non-empty and unique",
          `${path}.binding.agentId`
        )
      );
    }
    if (
      typeof agent.binding?.definitionId !== "string" ||
      agent.binding.definitionId.length === 0
    ) {
      issues.push(
        issue(
          "ai.save_invalid_definition_id",
          "AI save agents require a definition id",
          `${path}.binding.definitionId`
        )
      );
    }
    if (
      !Array.isArray(agent.memory) ||
      !Array.isArray(agent.cooldowns) ||
      !Array.isArray(agent.nextSensorAt)
    ) {
      issues.push(
        issue("ai.save_invalid_agent_state", "AI save memory and schedules must be arrays", path)
      );
    }
    if (!Number.isFinite(agent.nextDecisionAt) || agent.nextDecisionAt < 0) {
      issues.push(
        issue(
          "ai.save_invalid_decision_time",
          "AI save next decision time must be non-negative and finite",
          `${path}.nextDecisionAt`
        )
      );
    }
    if (
      agent.task !== undefined &&
      (!Number.isFinite(agent.task.startedAt) ||
        !Number.isFinite(agent.task.updatedAt) ||
        agent.task.updatedAt < agent.task.startedAt)
    ) {
      issues.push(
        issue(
          "ai.save_invalid_task_time",
          "AI save task timestamps are invalid",
          `${path}.task.updatedAt`
        )
      );
    }
    agentIds.add(agent.binding?.agentId ?? "");
  }
  return issues;
}

function issue(code: string, message: string, path: string): SaveValidationIssue {
  return { code, message, severity: "error", path };
}
