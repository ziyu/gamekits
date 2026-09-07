import { assertSaveEnvelope, createJsonSaveCodec } from "./codec";
import { createSaveEntityMap } from "./entity-map";
import {
  createContributorError,
  createDuplicateContributorError,
  createMissingContributorError,
  createMissingSlotError,
  createSaveError,
  createUnsupportedVersionError
} from "./errors";
import { createSaveMigrationRegistry } from "./migration";
import type {
  CreateSaveManagerOptions,
  LoadOptions,
  SaveContributor,
  SaveContributorPolicy,
  SaveContributorSelection,
  SaveDiagnosticEvent,
  SaveEnvelope,
  SaveInspection,
  SaveManager,
  SaveManagerSnapshot,
  SavePhase,
  SavePayload,
  SaveSection,
  SaveSlotId,
  SaveSlotMetadata,
  SaveSlotSummary
} from "./types";

export function createSaveManager(options: CreateSaveManagerOptions): SaveManager {
  const codec = options.codec ?? createJsonSaveCodec();
  const migrations = options.migrations ?? createSaveMigrationRegistry();
  const contributors = new Map<string, SaveContributor>();
  const diagnostics: SaveDiagnosticEvent[] = [];
  const clock = options.clock ?? (() => Date.now());
  const diagnosticLimit = options.diagnosticLimit ?? 200;
  if (!Number.isSafeInteger(diagnosticLimit) || diagnosticLimit < 0)
    throw new RangeError("diagnosticLimit must be a nonnegative safe integer");
  let lastOperation: SaveManagerSnapshot["lastOperation"];

  const emit = (
    event: Omit<SaveDiagnosticEvent, "timestamp" | "payload"> & {
      timestamp?: number;
      payload?: Record<string, unknown>;
    }
  ): void => {
    const diagnostic: SaveDiagnosticEvent = {
      ...event,
      timestamp: event.timestamp ?? clock(),
      payload: event.payload ?? {}
    };
    diagnostics.push(diagnostic);
    if (diagnostics.length > diagnosticLimit) diagnostics.shift();
    try {
      options.onDiagnostic?.(structuredClone(diagnostic));
    } catch (error) {
      try {
        options.onDiagnosticError?.(error, structuredClone(diagnostic));
      } catch {
        /* Diagnostic failures cannot change save results. */
      }
    }
  };

  const markOperation = (
    type: NonNullable<SaveManagerSnapshot["lastOperation"]>["type"],
    slotId: SaveSlotId,
    status: "completed" | "failed"
  ): void => {
    lastOperation = { type, slotId, status, timestamp: clock() };
  };

  function validateIdentity(envelope: SaveEnvelope): void {
    assertSaveEnvelope(envelope);
    if (envelope.appId !== options.appId || envelope.gameId !== options.gameId) {
      throw createSaveError("save.incompatible_app", "Save belongs to a different app or game", {
        expectedAppId: options.appId,
        expectedGameId: options.gameId,
        appId: envelope.appId,
        gameId: envelope.gameId
      });
    }
  }

  async function applyEnvelope(
    input: SaveEnvelope,
    selection?: SaveContributorSelection,
    onPhase?: (phase: SavePhase) => void
  ): Promise<void> {
    const envelope = structuredClone(input);
    onPhase?.("validate");
    validateIdentity(envelope);
    if (envelope.formatVersion !== options.formatVersion)
      throw createUnsupportedVersionError(envelope.formatVersion);
    const selected = selectContributors(
      sortedContributors(contributors),
      options.contributorPolicy,
      selection
    );
    const services = options.services?.();
    validateContributors(envelope, selected, services);
    onPhase?.("restore");
    await restoreContributors(envelope, selected, services, clock());
  }

  return {
    registerContributor(contributor) {
      if (contributors.has(contributor.id)) {
        throw createDuplicateContributorError(contributor.id);
      }
      contributors.set(contributor.id, contributor);
    },
    unregisterContributor(id) {
      contributors.delete(id);
    },
    listContributors() {
      return sortedContributors(contributors);
    },
    list() {
      return options.store.list();
    },
    async save(slotId, saveOptions) {
      let phase: SavePhase = "capture";
      emit({ type: "save.started", severity: "info", phase: "capture", slotId });
      try {
        const now = clock();
        const sections: Record<string, SaveSection> = {};
        const services = options.services?.();
        const selectedContributors = selectContributors(
          sortedContributors(contributors),
          options.contributorPolicy,
          saveOptions.contributors
        );
        for (const contributor of selectedContributors) {
          try {
            const captureContext = services === undefined ? { now } : { now, services };
            const section = await contributor.capture(captureContext);
            if (section) {
              sections[section.id] = section;
            } else if (contributor.required === true) {
              throw createMissingContributorError(contributor.id);
            }
          } catch (error) {
            throw createContributorError("capture", contributor.id, error);
          }
        }

        const metadata = createSlotMetadata(slotId, saveOptions.metadata);
        const payload: SavePayload = {
          runtime: saveOptions.runtime,
          sections
        };
        if (saveOptions.custom) {
          payload.custom = saveOptions.custom;
        }

        const envelope: SaveEnvelope = {
          format: "gamekits.save",
          formatVersion: options.formatVersion,
          appId: options.appId,
          gameId: options.gameId,
          gameVersion: options.gameVersion,
          createdAt: now,
          updatedAt: now,
          slot: metadata,
          compatibility: saveOptions.compatibility ?? options.compatibility ?? {},
          payload
        };

        phase = "encode";
        emit({ type: "save.encoding", severity: "info", phase: "encode", slotId });
        const data = await codec.encode(envelope);
        phase = "write";
        emit({ type: "save.writing", severity: "info", phase: "write", slotId });
        await options.store.write(slotId, data, createSlotSummary(envelope));
        emit({
          type: "save.completed",
          severity: "info",
          phase: "write",
          slotId,
          payload: { bytes: data.byteLength }
        });
        markOperation("save", slotId, "completed");
        return { slotId, envelope: await codec.decode(data), bytes: data.byteLength };
      } catch (error) {
        markOperation("save", slotId, "failed");
        emitError("save.failed", phase, slotId, error, emit);
        throw error;
      }
    },
    async load(slotId, loadOptions: LoadOptions = {}) {
      let phase: SavePhase = "read";
      emit({ type: "load.started", severity: "info", phase: "read", slotId });
      try {
        if (!(await options.store.exists(slotId))) {
          throw createMissingSlotError(slotId);
        }

        if (loadOptions.backup && !options.store.readBackup)
          throw createSaveError("save.backup_unsupported", "This store does not support backups");
        const data = loadOptions.backup
          ? await options.store.readBackup!(slotId)
          : await options.store.read(slotId);
        phase = "decode";
        let envelope = await codec.decode(data);
        phase = "validate";
        validateIdentity(envelope);
        let migrated = false;
        const shouldMigrate = loadOptions.migrate !== false;
        if (envelope.formatVersion !== options.formatVersion) {
          if (!shouldMigrate) {
            throw createUnsupportedVersionError(envelope.formatVersion);
          }
          phase = "migrate";
          emit({ type: "save.migrating", severity: "info", phase: "migrate", slotId });
          envelope = await migrations.migrate(envelope, options.formatVersion);
          validateIdentity(envelope);
          if (envelope.formatVersion !== options.formatVersion)
            throw createUnsupportedVersionError(envelope.formatVersion);
          migrated = true;
          emit({
            type: "save.migration_applied",
            severity: "info",
            phase: "migrate",
            slotId,
            payload: { formatVersion: envelope.formatVersion }
          });
        }

        const restored = loadOptions.restore !== false;
        if (restored) {
          await applyEnvelope(envelope, loadOptions.contributors, (nextPhase) => {
            phase = nextPhase;
          });
        }

        emit({ type: "load.completed", severity: "info", phase: "restore", slotId });
        markOperation("load", slotId, "completed");
        return { slotId, envelope, restored, migrated };
      } catch (error) {
        markOperation("load", slotId, "failed");
        emitError("load.failed", phase, slotId, error, emit);
        throw error;
      }
    },
    async restore(envelope, restoreOptions = {}) {
      let phase: SavePhase = "validate";
      try {
        await applyEnvelope(envelope, restoreOptions.contributors, (nextPhase) => {
          phase = nextPhase;
        });
        emit({
          type: "restore.completed",
          severity: "info",
          phase: "restore",
          slotId: envelope.slot.id
        });
      } catch (error) {
        emitError("restore.failed", phase, envelope?.slot?.id, error, emit);
        throw error;
      }
    },
    async delete(slotId) {
      try {
        await options.store.delete(slotId);
        emit({ type: "save.deleted", severity: "info", phase: "delete", slotId });
        markOperation("delete", slotId, "completed");
      } catch (error) {
        markOperation("delete", slotId, "failed");
        emitError("save.delete_failed", "delete", slotId, error, emit);
        throw error;
      }
    },
    async inspect(slotId) {
      try {
        const envelope = await codec.decode(await options.store.read(slotId));
        const inspection: SaveInspection = {
          slotId,
          envelope: omitPayload(envelope),
          sections: Object.values(envelope.payload.sections).map((section) => ({
            id: section.id,
            version: section.version
          }))
        };
        markOperation("inspect", slotId, "completed");
        return inspection;
      } catch (error) {
        markOperation("inspect", slotId, "failed");
        emitError("save.inspect_failed", "inspect", slotId, error, emit);
        throw error;
      }
    },
    snapshot() {
      const snapshot: SaveManagerSnapshot = {
        formatVersion: options.formatVersion,
        contributors: sortedContributors(contributors).map((contributor) => ({
          id: contributor.id,
          version: contributor.version,
          required: contributor.required === true
        })),
        diagnostics: [...diagnostics]
      };
      if (lastOperation) {
        snapshot.lastOperation = { ...lastOperation };
      }
      return snapshot;
    }
  };
}

async function restoreContributors(
  envelope: SaveEnvelope,
  contributors: SaveContributor[],
  services: Record<string, unknown> | undefined,
  now: number
): Promise<void> {
  const entityMap = createSaveEntityMap();
  for (const contributor of contributors) {
    const section = envelope.payload.sections[contributor.id];
    if (!section) {
      if (contributor.required === true) {
        throw createMissingContributorError(contributor.id);
      }
      continue;
    }
    if (contributor.restore) {
      try {
        const restoreContext =
          services === undefined ? { now, entityMap } : { now, services, entityMap };
        await contributor.restore(restoreContext, section);
      } catch (error) {
        throw createContributorError("restore", contributor.id, error);
      }
    }
  }
}

function validateContributors(
  envelope: SaveEnvelope,
  contributors: SaveContributor[],
  services: Record<string, unknown> | undefined
): void {
  for (const contributor of contributors) {
    const section = envelope.payload.sections[contributor.id];
    if (!section) {
      if (contributor.required === true) throw createMissingContributorError(contributor.id);
      continue;
    }
    if (section.id !== contributor.id || section.version !== contributor.version) {
      throw createSaveError(
        "save.section_version_mismatch",
        `Incompatible save section: ${contributor.id}`,
        {
          contributorId: contributor.id,
          expectedVersion: contributor.version,
          actualVersion: section.version
        }
      );
    }
    if (contributor.validate) {
      const result = contributor.validate(section, services === undefined ? {} : { services });
      const error = result.issues.find((issue) => issue.severity === "error");
      if (error)
        throw createSaveError(error.code, error.message, { contributorId: contributor.id });
    }
  }
}

function sortedContributors(contributors: Map<string, SaveContributor>): SaveContributor[] {
  return [...contributors.values()].sort(
    (left, right) => (left.order ?? 0) - (right.order ?? 0) || left.id.localeCompare(right.id)
  );
}

function selectContributors(
  contributors: SaveContributor[],
  policy: SaveContributorPolicy | undefined,
  selection: SaveContributorSelection | undefined
): SaveContributor[] {
  return contributors.filter((contributor) => {
    const defaultIncluded =
      (policy?.defaultIncluded ?? true) && contributor.saveByDefault !== false;
    return (
      matchesContributorSelection(contributor, policy, defaultIncluded) &&
      matchesContributorSelection(contributor, selection, true)
    );
  });
}

function matchesContributorSelection(
  contributor: SaveContributor,
  selection: SaveContributorSelection | undefined,
  defaultIncluded: boolean
): boolean {
  if (!selection) {
    return defaultIncluded;
  }

  const hasIncludes =
    selection.includeIds !== undefined ||
    selection.includeTags !== undefined ||
    selection.includeScopes !== undefined;
  let included = hasIncludes ? false : defaultIncluded;

  if (selection.includeIds?.includes(contributor.id)) {
    included = true;
  }
  if (intersects(selection.includeTags, contributor.tags)) {
    included = true;
  }
  if (contributor.scope && selection.includeScopes?.includes(contributor.scope)) {
    included = true;
  }

  if (selection.excludeIds?.includes(contributor.id)) {
    return false;
  }
  if (intersects(selection.excludeTags, contributor.tags)) {
    return false;
  }
  if (contributor.scope && selection.excludeScopes?.includes(contributor.scope)) {
    return false;
  }

  return included;
}

function intersects(left: string[] | undefined, right: string[] | undefined): boolean {
  if (!left || !right) {
    return false;
  }

  return left.some((value) => right.includes(value));
}

function createSlotMetadata(
  slotId: SaveSlotId,
  metadata: Partial<Omit<SaveSlotMetadata, "id">> | undefined
): SaveSlotMetadata {
  return {
    id: slotId,
    ...metadata
  };
}

function createSlotSummary(envelope: SaveEnvelope): SaveSlotSummary {
  return {
    ...envelope.slot,
    updatedAt: envelope.updatedAt,
    formatVersion: envelope.formatVersion,
    gameVersion: envelope.gameVersion
  };
}

function omitPayload(envelope: SaveEnvelope): Omit<SaveEnvelope, "payload"> {
  const { payload: _payload, ...rest } = envelope;
  return rest;
}

function emitError(
  type: string,
  phase: SavePhase,
  slotId: SaveSlotId,
  error: unknown,
  emit: (
    event: Omit<SaveDiagnosticEvent, "timestamp" | "payload"> & {
      timestamp?: number;
      payload?: Record<string, unknown>;
    }
  ) => void
): void {
  const event: Omit<SaveDiagnosticEvent, "timestamp" | "payload"> & {
    timestamp?: number;
    payload?: Record<string, unknown>;
  } = {
    type,
    severity: "error",
    phase,
    slotId,
    payload: {
      error: error instanceof Error ? error.message : String(error)
    }
  };
  if (isGameErrorLike(error)) {
    event.code = error.code;
  }
  emit(event);
}

function isGameErrorLike(error: unknown): error is { code: string } {
  return typeof error === "object" && error !== null && "code" in error;
}
