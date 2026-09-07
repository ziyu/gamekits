import type { SaveContributor, SaveSection, SaveValidationIssue } from "@gamekits/save";
import type { GasHandle, GasRuntimeCheckpoint } from "./types";

export type CreateGasSaveContributorOptions = {
  handle: GasHandle;
  id?: string;
  version?: string;
  order?: number;
  required?: boolean;
};

export function createGasSaveContributor(
  options: CreateGasSaveContributorOptions
): SaveContributor<GasRuntimeCheckpoint> {
  const id = options.id ?? "gas";
  const version = options.version ?? "1";
  return {
    id,
    version,
    order: options.order ?? 300,
    scope: "gameplay",
    tags: ["gameplay", "actors", "checkpoint"],
    saveByDefault: true,
    required: options.required ?? true,
    capture() {
      return { id, version, data: options.handle.captureCheckpoint() };
    },
    restore(ctx, section) {
      options.handle.restoreCheckpoint(section.data, {
        resolveEntityId(savedEntityId) {
          return ctx.entityMap.get(savedEntityId) ?? savedEntityId;
        }
      });
    },
    validate(section) {
      return { issues: validateGasSection(section) };
    }
  };
}

function validateGasSection(section: SaveSection<GasRuntimeCheckpoint>): SaveValidationIssue[] {
  const issues: SaveValidationIssue[] = [];
  if (!Number.isFinite(section.data.elapsed) || section.data.elapsed < 0) {
    issues.push({
      code: "gas.save_invalid_elapsed",
      message: "GAS save elapsed must be a non-negative finite number",
      severity: "error",
      path: "data.elapsed"
    });
  }
  if (!Array.isArray(section.data.actors)) {
    issues.push({
      code: "gas.save_invalid_actors",
      message: "GAS save actors must be an array",
      severity: "error",
      path: "data.actors"
    });
  }
  if (section.data.executions !== undefined && !Array.isArray(section.data.executions)) {
    issues.push({
      code: "gas.save_invalid_executions",
      message: "GAS save executions must be an array when present",
      severity: "error",
      path: "data.executions"
    });
  } else {
    for (const [index, execution] of (section.data.executions ?? []).entries()) {
      if (
        !execution.id ||
        !execution.actorId ||
        !execution.abilityId ||
        !ACTIVE_EXECUTION_PHASES.has(execution.phase)
      ) {
        issues.push({
          code: "gas.save_invalid_execution",
          message: "GAS save execution requires ids and a non-terminal phase",
          severity: "error",
          path: `data.executions[${index}]`
        });
      }
      if (
        !Number.isFinite(execution.requestedAt) ||
        !Number.isFinite(execution.phaseStartedAt) ||
        (execution.phaseEndsAt !== undefined && !Number.isFinite(execution.phaseEndsAt))
      ) {
        issues.push({
          code: "gas.save_invalid_execution_time",
          message: "GAS save execution timestamps must be finite",
          severity: "error",
          path: `data.executions[${index}]`
        });
      }
    }
  }
  return issues;
}

const ACTIVE_EXECUTION_PHASES = new Set([
  "requested",
  "preparing",
  "committed",
  "active",
  "recovering"
]);
