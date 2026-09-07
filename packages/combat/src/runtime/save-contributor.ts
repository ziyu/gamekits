import type { SaveContributor, SaveSection, SaveValidationIssue } from "@gamekits/save";
import type { CombatHandle, CombatRuntimeCheckpoint } from "./types";

export type CreateCombatSaveContributorOptions = {
  handle: CombatHandle;
  id?: string | undefined;
  version?: string | undefined;
  order?: number | undefined;
  required?: boolean | undefined;
};

export function createCombatSaveContributor(
  options: CreateCombatSaveContributorOptions
): SaveContributor<CombatRuntimeCheckpoint> {
  const id = options.id ?? "combat";
  const version = options.version ?? "1";
  return {
    id,
    version,
    order: options.order ?? 350,
    scope: "gameplay",
    tags: ["gameplay", "combat", "checkpoint"],
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
      return { issues: validateCombatSection(section) };
    }
  };
}

function validateCombatSection(
  section: SaveSection<CombatRuntimeCheckpoint>
): SaveValidationIssue[] {
  const issues: SaveValidationIssue[] = [];
  if (!Number.isFinite(section.data.elapsed) || section.data.elapsed < 0) {
    issues.push({
      code: "combat.save_invalid_elapsed",
      message: "Combat save elapsed must be a non-negative finite number",
      severity: "error",
      path: "data.elapsed"
    });
  }
  if (!Array.isArray(section.data.projectiles)) {
    issues.push({
      code: "combat.save_invalid_projectiles",
      message: "Combat save projectiles must be an array",
      severity: "error",
      path: "data.projectiles"
    });
    return issues;
  }
  const projectileIds = new Set<string>();
  const entityIds = new Set<string>();
  for (const [index, projectile] of section.data.projectiles.entries()) {
    const entityKey = `${typeof projectile.entityId}:${String(projectile.entityId)}`;
    if (
      typeof projectile.state?.projectileId !== "string" ||
      projectile.state.projectileId.length === 0 ||
      projectileIds.has(projectile.state.projectileId)
    ) {
      issues.push({
        code: "combat.save_invalid_projectile_id",
        message: "Combat save projectile ids must be non-empty and unique",
        severity: "error",
        path: `data.projectiles[${index}].state.projectileId`
      });
    }
    if (entityIds.has(entityKey)) {
      issues.push({
        code: "combat.save_duplicate_entity",
        message: "Combat save projectile entities must be unique",
        severity: "error",
        path: `data.projectiles[${index}].entityId`
      });
    }
    if (
      !Number.isFinite(projectile.state?.spawnedAt) ||
      !Number.isFinite(projectile.state?.expiresAt) ||
      projectile.state.expiresAt < projectile.state.spawnedAt
    ) {
      issues.push({
        code: "combat.save_invalid_projectile_lifetime",
        message: "Combat save projectile lifetime is invalid",
        severity: "error",
        path: `data.projectiles[${index}].state.expiresAt`
      });
    }
    projectileIds.add(projectile.state?.projectileId ?? "");
    entityIds.add(entityKey);
  }
  return issues;
}
