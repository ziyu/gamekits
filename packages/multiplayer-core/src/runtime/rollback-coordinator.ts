import type { Rng, RngState } from "@gamekits/core";
import type { MultiplayerPredictionGeneration } from "./predicted-spawn";

export type MultiplayerRollbackContributorContext = {
  generation: MultiplayerPredictionGeneration;
  tick: number;
  phase: "capture" | "validate" | "restore";
};

export type MultiplayerRollbackContributor<TCheckpoint = unknown> = {
  id: string;
  order?: number | undefined;
  capture(context: MultiplayerRollbackContributorContext): TCheckpoint;
  validate?(
    checkpoint: TCheckpoint,
    context: MultiplayerRollbackContributorContext
  ): boolean | undefined;
  restore(checkpoint: TCheckpoint, context: MultiplayerRollbackContributorContext): void;
  measureBytes(checkpoint: TCheckpoint): number;
  hash(checkpoint: TCheckpoint): string;
};

export type MultiplayerRollbackCheckpointSummary = {
  generation: MultiplayerPredictionGeneration;
  tick: number;
  bytes: number;
  hash: string;
  contributors: string[];
};

export type MultiplayerRollbackCaptureResult =
  | ({ status: "captured"; evictedTicks: number[] } & MultiplayerRollbackCheckpointSummary)
  | {
      status: "capture-failed" | "checkpoint-capacity";
      tick: number;
      contributorId?: string | undefined;
      bytes?: number | undefined;
      error?: unknown;
    };

export type MultiplayerRollbackRestoreResult =
  | ({ status: "restored" } & MultiplayerRollbackCheckpointSummary)
  | {
      status: "missing" | "validation-failed" | "restore-failed";
      tick: number;
      contributorId?: string | undefined;
      error?: unknown;
    };

export type MultiplayerRollbackCoordinatorDiagnostics = {
  generation: MultiplayerPredictionGeneration;
  captures: number;
  captureFailures: number;
  capacityRejections: number;
  restores: number;
  validationFailures: number;
  restoreFailures: number;
  missingRestores: number;
  evictedCheckpoints: number;
  resets: number;
  checkpoints: number;
  historyBytes: number;
  earliestTick?: number | undefined;
  latestTick?: number | undefined;
  disposed: boolean;
};

export type MultiplayerRollbackCoordinatorOptions = {
  generation: MultiplayerPredictionGeneration;
  contributors: readonly MultiplayerRollbackContributor[];
  maxHistoryTicks?: number | undefined;
  maxCheckpointBytes?: number | undefined;
  maxHistoryBytes?: number | undefined;
};

export type MultiplayerRollbackCoordinator = {
  generation(): MultiplayerPredictionGeneration;
  capture(tick: number): MultiplayerRollbackCaptureResult;
  restore(tick: number): MultiplayerRollbackRestoreResult;
  checkpoint(tick: number): MultiplayerRollbackCheckpointSummary | undefined;
  dropAfter(tick: number): number[];
  reset(generation: MultiplayerPredictionGeneration): void;
  diagnostics(): MultiplayerRollbackCoordinatorDiagnostics;
  dispose(): void;
};

type StoredRollbackCheckpoint = MultiplayerRollbackCheckpointSummary & {
  values: Map<string, unknown>;
};

export type CreateMultiplayerRngRollbackContributorOptions = {
  id?: string | undefined;
  order?: number | undefined;
};

const DEFAULT_MAX_HISTORY_TICKS = 128;
const DEFAULT_MAX_CHECKPOINT_BYTES = 1024 * 1024;
const DEFAULT_MAX_HISTORY_BYTES = 16 * 1024 * 1024;

/**
 * Coordinates bounded, same-tick checkpoints across independently owned simulation domains.
 * Contributors remain responsible for isolated checkpoint values and deterministic restore.
 */
export function createMultiplayerRollbackCoordinator(
  options: MultiplayerRollbackCoordinatorOptions
): MultiplayerRollbackCoordinator {
  validateGeneration(options.generation);
  const contributors = normalizeContributors(options.contributors);
  const maxHistoryTicks = nonNegativeInteger(
    options.maxHistoryTicks,
    DEFAULT_MAX_HISTORY_TICKS,
    "maxHistoryTicks"
  );
  const maxCheckpointBytes = positiveInteger(
    options.maxCheckpointBytes,
    DEFAULT_MAX_CHECKPOINT_BYTES,
    "maxCheckpointBytes"
  );
  const maxHistoryBytes = positiveInteger(
    options.maxHistoryBytes,
    DEFAULT_MAX_HISTORY_BYTES,
    "maxHistoryBytes"
  );
  const checkpoints = new Map<number, StoredRollbackCheckpoint>();
  let generation = options.generation;
  let historyBytes = 0;
  let disposed = false;
  const metrics = {
    captures: 0,
    captureFailures: 0,
    capacityRejections: 0,
    restores: 0,
    validationFailures: 0,
    restoreFailures: 0,
    missingRestores: 0,
    evictedCheckpoints: 0,
    resets: 0
  };

  return {
    generation() {
      return generation;
    },
    capture(tick) {
      assertActive();
      validateTick(tick);
      const values = new Map<string, unknown>();
      const hashes: string[] = [];
      let bytes = 0;
      for (const contributor of contributors) {
        try {
          const context = { generation, tick, phase: "capture" as const };
          const checkpoint = contributor.capture(context);
          const checkpointBytes = contributor.measureBytes(checkpoint);
          if (!Number.isSafeInteger(checkpointBytes) || checkpointBytes < 0) {
            throw new Error(
              `Rollback contributor ${contributor.id} returned an invalid byte measurement.`
            );
          }
          const checkpointHash = contributor.hash(checkpoint);
          if (checkpointHash.length === 0) {
            throw new Error(`Rollback contributor ${contributor.id} returned an empty hash.`);
          }
          values.set(contributor.id, checkpoint);
          hashes.push(`${contributor.id}:${checkpointHash}`);
          bytes += checkpointBytes;
        } catch (error) {
          metrics.captureFailures += 1;
          return {
            status: "capture-failed",
            tick,
            contributorId: contributor.id,
            error
          };
        }
      }
      if (bytes > maxCheckpointBytes || bytes > maxHistoryBytes) {
        metrics.capacityRejections += 1;
        return { status: "checkpoint-capacity", tick, bytes };
      }

      const previous = checkpoints.get(tick);
      if (previous !== undefined) {
        historyBytes -= previous.bytes;
      }
      const checkpoint: StoredRollbackCheckpoint = {
        generation,
        tick,
        bytes,
        hash: hashStrings(hashes),
        contributors: contributors.map((contributor) => contributor.id),
        values
      };
      checkpoints.set(tick, checkpoint);
      historyBytes += bytes;
      const evictedTicks = trimHistory();
      metrics.captures += 1;
      return { status: "captured", ...summary(checkpoint), evictedTicks };
    },
    restore(tick) {
      assertActive();
      validateTick(tick);
      const checkpoint = checkpoints.get(tick);
      if (checkpoint === undefined || checkpoint.generation !== generation) {
        metrics.missingRestores += 1;
        return { status: "missing", tick };
      }

      for (const contributor of contributors) {
        const value = checkpoint.values.get(contributor.id);
        try {
          if (
            contributor.validate?.(value, {
              generation,
              tick,
              phase: "validate"
            }) === false
          ) {
            metrics.validationFailures += 1;
            return { status: "validation-failed", tick, contributorId: contributor.id };
          }
        } catch (error) {
          metrics.validationFailures += 1;
          return {
            status: "validation-failed",
            tick,
            contributorId: contributor.id,
            error
          };
        }
      }

      for (const contributor of contributors) {
        try {
          contributor.restore(checkpoint.values.get(contributor.id), {
            generation,
            tick,
            phase: "restore"
          });
        } catch (error) {
          metrics.restoreFailures += 1;
          return {
            status: "restore-failed",
            tick,
            contributorId: contributor.id,
            error
          };
        }
      }
      dropAfterInternal(tick);
      metrics.restores += 1;
      return { status: "restored", ...summary(checkpoint) };
    },
    checkpoint(tick) {
      assertActive();
      validateTick(tick);
      const checkpoint = checkpoints.get(tick);
      return checkpoint === undefined ? undefined : summary(checkpoint);
    },
    dropAfter(tick) {
      assertActive();
      validateTick(tick);
      return dropAfterInternal(tick);
    },
    reset(nextGeneration) {
      assertActive();
      validateGeneration(nextGeneration);
      generation = nextGeneration;
      clearCheckpoints();
      metrics.resets += 1;
    },
    diagnostics() {
      const ticks = sortedTicks();
      return {
        generation,
        ...metrics,
        checkpoints: checkpoints.size,
        historyBytes,
        ...(ticks[0] === undefined ? {} : { earliestTick: ticks[0] }),
        ...(ticks.at(-1) === undefined ? {} : { latestTick: ticks.at(-1) }),
        disposed
      };
    },
    dispose() {
      if (disposed) {
        return;
      }
      disposed = true;
      clearCheckpoints();
    }
  };

  function trimHistory(): number[] {
    const evicted: number[] = [];
    while (checkpoints.size > maxHistoryTicks + 1 || historyBytes > maxHistoryBytes) {
      const earliest = sortedTicks()[0];
      if (earliest === undefined) {
        break;
      }
      removeCheckpoint(earliest);
      evicted.push(earliest);
      metrics.evictedCheckpoints += 1;
    }
    return evicted;
  }

  function dropAfterInternal(tick: number): number[] {
    const removed: number[] = [];
    for (const checkpointTick of sortedTicks()) {
      if (checkpointTick <= tick) {
        continue;
      }
      removeCheckpoint(checkpointTick);
      removed.push(checkpointTick);
    }
    return removed;
  }

  function removeCheckpoint(tick: number): void {
    const checkpoint = checkpoints.get(tick);
    if (checkpoint === undefined) {
      return;
    }
    checkpoints.delete(tick);
    historyBytes -= checkpoint.bytes;
  }

  function clearCheckpoints(): void {
    checkpoints.clear();
    historyBytes = 0;
  }

  function sortedTicks(): number[] {
    return [...checkpoints.keys()].sort((left, right) => left - right);
  }

  function assertActive(): void {
    if (disposed) {
      throw new Error("Multiplayer rollback coordinator is disposed.");
    }
  }
}

export function createMultiplayerRngRollbackContributor(
  rng: Rng,
  options: CreateMultiplayerRngRollbackContributorOptions = {}
): MultiplayerRollbackContributor<RngState> {
  return {
    id: options.id ?? "rng",
    order: options.order ?? 150,
    capture() {
      return rng.captureState();
    },
    validate(checkpoint) {
      return (
        checkpoint !== null &&
        typeof checkpoint === "object" &&
        checkpoint.algorithm === "mulberry32" &&
        checkpoint.seed === rng.seed &&
        Number.isSafeInteger(checkpoint.state) &&
        checkpoint.state >= 0 &&
        checkpoint.state <= 0xffff_ffff
      );
    },
    restore(checkpoint) {
      rng.restoreState(checkpoint);
    },
    measureBytes(checkpoint) {
      return 16 + checkpoint.seed.length * 2;
    },
    hash(checkpoint) {
      return `${checkpoint.algorithm}:${checkpoint.seed}:${checkpoint.state}`;
    }
  };
}

export function serializeMultiplayerRollbackValue(value: unknown): string {
  const ancestors = new Set<object>();
  const serialized = serializeRollbackValue(value, ancestors, false);
  if (serialized === undefined) {
    throw new Error("Rollback checkpoint root value must be serializable.");
  }
  return serialized;
}

export function measureMultiplayerRollbackValue(value: unknown): number {
  return new TextEncoder().encode(serializeMultiplayerRollbackValue(value)).byteLength;
}

export function hashMultiplayerRollbackValue(value: unknown): string {
  return hashStrings([serializeMultiplayerRollbackValue(value)]);
}

function normalizeContributors(
  contributors: readonly MultiplayerRollbackContributor[]
): MultiplayerRollbackContributor[] {
  if (contributors.length === 0) {
    throw new Error("Multiplayer rollback coordinator requires at least one contributor.");
  }
  const ids = new Set<string>();
  for (const contributor of contributors) {
    if (contributor.id.trim().length === 0) {
      throw new Error("Multiplayer rollback contributor id must not be empty.");
    }
    if (ids.has(contributor.id)) {
      throw new Error(`Duplicate multiplayer rollback contributor: ${contributor.id}`);
    }
    ids.add(contributor.id);
  }
  return [...contributors].sort(
    (left, right) => (left.order ?? 0) - (right.order ?? 0) || left.id.localeCompare(right.id)
  );
}

function summary(checkpoint: StoredRollbackCheckpoint): MultiplayerRollbackCheckpointSummary {
  return {
    generation: checkpoint.generation,
    tick: checkpoint.tick,
    bytes: checkpoint.bytes,
    hash: checkpoint.hash,
    contributors: [...checkpoint.contributors]
  };
}

function hashStrings(values: readonly string[]): string {
  let first = 2166136261;
  let second = 0x9e3779b9;
  for (const value of values) {
    const framedValue = `${value.length}:${value}`;
    for (let index = 0; index < framedValue.length; index += 1) {
      const code = framedValue.charCodeAt(index);
      first ^= code;
      first = Math.imul(first, 16777619);
      second ^= code;
      second = Math.imul(second, 0x5bd1e995);
      second ^= second >>> 15;
    }
  }
  return `${(first >>> 0).toString(16).padStart(8, "0")}${(second >>> 0)
    .toString(16)
    .padStart(8, "0")}`;
}

function serializeRollbackValue(
  value: unknown,
  ancestors: Set<object>,
  arrayEntry: boolean
): string | undefined {
  if (value === null) {
    return "null";
  }
  switch (typeof value) {
    case "boolean":
      return value ? "true" : "false";
    case "number":
      if (!Number.isFinite(value)) {
        throw new Error("Rollback checkpoint numbers must be finite.");
      }
      return Object.is(value, -0) ? "0" : String(value);
    case "string":
      return JSON.stringify(value);
    case "undefined":
      return arrayEntry ? "null" : undefined;
    case "bigint":
    case "function":
    case "symbol":
      throw new Error(`Rollback checkpoint contains unsupported ${typeof value} data.`);
    case "object":
      break;
  }

  if (ancestors.has(value)) {
    throw new Error("Rollback checkpoint must not contain cyclic data.");
  }
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      return `[${value
        .map((entry) => serializeRollbackValue(entry, ancestors, true) ?? "null")
        .join(",")}]`;
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new Error("Rollback checkpoint objects must use a plain object prototype.");
    }
    const entries: string[] = [];
    for (const key of Object.keys(value).sort()) {
      const serialized = serializeRollbackValue(
        (value as Record<string, unknown>)[key],
        ancestors,
        false
      );
      if (serialized !== undefined) {
        entries.push(`${JSON.stringify(key)}:${serialized}`);
      }
    }
    return `{${entries.join(",")}}`;
  } finally {
    ancestors.delete(value);
  }
}

function validateGeneration(generation: MultiplayerPredictionGeneration): void {
  if (
    (typeof generation === "string" && generation.trim().length === 0) ||
    (typeof generation === "number" && !Number.isSafeInteger(generation))
  ) {
    throw new Error("Rollback generation must be a non-empty string or safe integer.");
  }
}

function validateTick(tick: number): void {
  if (!Number.isSafeInteger(tick) || tick < 0) {
    throw new Error("Rollback tick must be a non-negative safe integer.");
  }
}

function positiveInteger(value: number | undefined, fallback: number, label: string): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved <= 0) {
    throw new Error(`Rollback ${label} must be a positive safe integer.`);
  }
  return resolved;
}

function nonNegativeInteger(value: number | undefined, fallback: number, label: string): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved < 0) {
    throw new Error(`Rollback ${label} must be a non-negative safe integer.`);
  }
  return resolved;
}
