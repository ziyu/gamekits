import type { SaveContributor, SaveSection, SaveValidationIssue } from "@gamekits/save";
import type { PhysicsHandle, PhysicsRuntimeCheckpoint } from "./types";

export type CreatePhysicsSaveContributorOptions = {
  handle: PhysicsHandle;
  id?: string;
  version?: string;
  order?: number;
  required?: boolean;
};

export function createPhysicsSaveContributor(
  options: CreatePhysicsSaveContributorOptions
): SaveContributor<PhysicsRuntimeCheckpoint> {
  const id = options.id ?? "physics";
  const version = options.version ?? "1";
  return {
    id,
    version,
    order: options.order ?? 200,
    scope: "gameplay",
    tags: ["gameplay", "physics", "checkpoint"],
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
      return { issues: validatePhysicsSection(section) };
    }
  };
}

function validatePhysicsSection(
  section: SaveSection<PhysicsRuntimeCheckpoint>
): SaveValidationIssue[] {
  const issues: SaveValidationIssue[] = [];
  if (!Number.isFinite(section.data.accumulator) || section.data.accumulator < 0) {
    issues.push({
      code: "physics.save_invalid_accumulator",
      message: "Physics save accumulator must be a non-negative finite number",
      severity: "error",
      path: "data.accumulator"
    });
  }
  if (!Array.isArray(section.data.entities)) {
    issues.push({
      code: "physics.save_invalid_entities",
      message: "Physics save entities must be an array",
      severity: "error",
      path: "data.entities"
    });
  }
  return issues;
}
