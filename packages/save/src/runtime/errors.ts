import { GameError } from "@gamekits/core";
import type { SavePhase, SaveSlotId, SaveVersion } from "./types";

export function createSaveError(
  code: string,
  message: string,
  details?: Record<string, unknown>
): GameError {
  return new GameError(code, message, details);
}

export function createMissingSlotError(slotId: SaveSlotId): GameError {
  return createSaveError("save.slot_missing", `Save slot does not exist: ${slotId}`, { slotId });
}

export function createDuplicateContributorError(contributorId: string): GameError {
  return createSaveError(
    "save.contributor_duplicate",
    `Save contributor is already registered: ${contributorId}`,
    { contributorId }
  );
}

export function createDuplicateMigrationError(from: SaveVersion, to: SaveVersion): GameError {
  return createSaveError(
    "save.migration_duplicate",
    `Save migration path is already registered: ${from} -> ${to}`,
    { from, to }
  );
}

export function createMissingContributorError(contributorId: string): GameError {
  return createSaveError(
    "save.contributor_missing",
    `Save contributor is required but missing: ${contributorId}`,
    { contributorId }
  );
}

export function createContributorError(
  phase: SavePhase,
  contributorId: string,
  cause: unknown
): GameError {
  return createSaveError(
    "save.contributor_failed",
    `Save contributor failed during ${phase}: ${contributorId}`,
    {
      phase,
      contributorId,
      cause: cause instanceof Error ? cause.message : String(cause)
    }
  );
}

export function createCorruptedSaveError(reason: string): GameError {
  return createSaveError("save.corrupted", `Save data is corrupted: ${reason}`, { reason });
}

export function createUnsupportedVersionError(version: SaveVersion): GameError {
  return createSaveError("save.unsupported_version", `Unsupported save version: ${version}`, {
    version
  });
}

export function createMissingMigrationError(from: SaveVersion, to: SaveVersion): GameError {
  return createSaveError(
    "save.migration_missing",
    `Missing save migration path from ${from} to ${to}`,
    { from, to }
  );
}

export function createMigrationError(migrationId: string, cause: unknown): GameError {
  return createSaveError("save.migration_failed", `Save migration failed: ${migrationId}`, {
    migrationId,
    cause: cause instanceof Error ? cause.message : String(cause)
  });
}

export function createCodecError(phase: "encode" | "decode", cause: unknown): GameError {
  return createSaveError(
    phase === "encode" ? "save.encode_failed" : "save.decode_failed",
    `Save ${phase} failed`,
    { cause: cause instanceof Error ? cause.message : String(cause) }
  );
}
