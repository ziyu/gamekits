import type { SaveContributor, SaveSection, SaveValidationIssue } from "@gamekits/save";
import type { TcaHandle, TcaRuntimeCheckpoint } from "./types";

export type CreateTcaSaveContributorOptions = {
  handle: TcaHandle;
  id?: string;
  version?: string;
  order?: number;
  required?: boolean;
};

export function createTcaSaveContributor(
  options: CreateTcaSaveContributorOptions
): SaveContributor<TcaRuntimeCheckpoint> {
  const id = options.id ?? "tca";
  const version = options.version ?? "1";
  return {
    id,
    version,
    order: options.order ?? 400,
    scope: "gameplay",
    tags: ["gameplay", "rules", "checkpoint"],
    saveByDefault: true,
    required: options.required ?? true,
    capture() {
      return {
        id,
        version,
        data: options.handle.captureCheckpoint()
      };
    },
    restore(_ctx, section) {
      options.handle.restoreCheckpoint(section.data);
    },
    validate(section) {
      return { issues: validateTcaSection(section) };
    }
  };
}

function validateTcaSection(section: SaveSection<TcaRuntimeCheckpoint>): SaveValidationIssue[] {
  const issues: SaveValidationIssue[] = [];
  if (!Number.isInteger(section.data.runSequence) || section.data.runSequence < 0) {
    issues.push({
      code: "tca.save_invalid_run_sequence",
      message: "TCA save runSequence must be a non-negative integer",
      severity: "error",
      path: "data.runSequence"
    });
  }
  if (
    !Array.isArray(section.data.executedOnceRuleIds) ||
    section.data.executedOnceRuleIds.some((ruleId) => typeof ruleId !== "string")
  ) {
    issues.push({
      code: "tca.save_invalid_once_rules",
      message: "TCA save executedOnceRuleIds must be a string array",
      severity: "error",
      path: "data.executedOnceRuleIds"
    });
  }
  return issues;
}
