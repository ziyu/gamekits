export const MULTIPLAYER_FIXED_STEP_INPUT_BUNDLE_PROTOCOL = "gamekits.fixed-step-input.v1";

export type MultiplayerFixedStepInputGeneration = string | number;

export type MultiplayerFixedStepInputFrame<TPayload = unknown> = {
  sequence: number;
  payload: TPayload;
  tick?: number | undefined;
  timestamp?: number | undefined;
};

export type MultiplayerFixedStepInputBundle<TPayload = unknown> = {
  protocol: typeof MULTIPLAYER_FIXED_STEP_INPUT_BUNDLE_PROTOCOL;
  frames: MultiplayerFixedStepInputFrame<TPayload>[];
};

export type MultiplayerFixedStepInputGapPolicy = "wait" | "hold-last" | "neutral";

export type MultiplayerFixedStepInputInboxOptions<TInput> = {
  maxSources?: number | undefined;
  maxBufferedFramesPerSource?: number | undefined;
  maxGapTicks?: number | undefined;
  gapPolicy?: MultiplayerFixedStepInputGapPolicy | undefined;
  cloneInput?(input: TInput): TInput;
  neutralInput?(context: {
    sourceId: string;
    generation: MultiplayerFixedStepInputGeneration;
    sequence: number;
  }): TInput;
};

export type MultiplayerFixedStepInputInboxIngestResult = {
  status: "accepted" | "source-capacity" | "invalid-bundle";
  accepted: number;
  duplicates: number;
  stale: number;
  rejected: number;
};

export type MultiplayerFixedStepInputInboxConsumeResult<TInput> =
  | { status: "empty" | "gap"; acknowledgedSequence: number }
  | {
      status: "input" | "gap-filled";
      acknowledgedSequence: number;
      frame: MultiplayerFixedStepInputFrame<TInput>;
    };

export type MultiplayerFixedStepInputInboxDiagnostics = {
  sources: number;
  queuedFrames: number;
  acceptedFrames: number;
  consumedFrames: number;
  duplicateFrames: number;
  staleFrames: number;
  rejectedFrames: number;
  sourceCapacityRejections: number;
  frameCapacityRejections: number;
  gaps: number;
  gapFills: number;
  generationResets: number;
  releasedSources: number;
  disposed: boolean;
};

export type MultiplayerFixedStepInputInbox<TInput> = {
  ingest(input: {
    sourceId: string;
    generation: MultiplayerFixedStepInputGeneration;
    bundle: MultiplayerFixedStepInputBundle | unknown;
    decode(payload: unknown, frame: MultiplayerFixedStepInputFrame): TInput | undefined;
  }): MultiplayerFixedStepInputInboxIngestResult;
  consume(input: {
    sourceId: string;
    generation: MultiplayerFixedStepInputGeneration;
  }): MultiplayerFixedStepInputInboxConsumeResult<TInput>;
  acknowledgedSequence(sourceId: string): number | undefined;
  release(sourceId: string): void;
  reset(): void;
  diagnostics(): MultiplayerFixedStepInputInboxDiagnostics;
  dispose(): void;
};

type SourceState<TInput> = {
  generation: MultiplayerFixedStepInputGeneration;
  acknowledgedSequence: number;
  nextSequence: number;
  gapTicks: number;
  buffered: Map<number, MultiplayerFixedStepInputFrame<TInput>>;
  lastInput?: TInput | undefined;
};

const DEFAULT_MAX_SOURCES = 64;
const DEFAULT_MAX_BUFFERED_FRAMES_PER_SOURCE = 32;
const DEFAULT_MAX_GAP_TICKS = 8;

export function createMultiplayerFixedStepInputBundle<TPayload>(
  frames: readonly MultiplayerFixedStepInputFrame<TPayload>[]
): MultiplayerFixedStepInputBundle<TPayload> {
  const normalized = normalizeFrames<TPayload>(frames);
  if (normalized === undefined || normalized.length === 0) {
    throw new Error("Fixed-step input bundle requires valid non-empty frames.");
  }
  return {
    protocol: MULTIPLAYER_FIXED_STEP_INPUT_BUNDLE_PROTOCOL,
    frames: normalized
  };
}

export function readMultiplayerFixedStepInputBundle<TPayload = unknown>(
  value: unknown,
  maxFrames?: number
): MultiplayerFixedStepInputBundle<TPayload> | undefined {
  if (
    !isRecord(value) ||
    value.protocol !== MULTIPLAYER_FIXED_STEP_INPUT_BUNDLE_PROTOCOL ||
    !Array.isArray(value.frames)
  ) {
    return undefined;
  }
  const limit = positiveInteger(maxFrames, Number.MAX_SAFE_INTEGER);
  if (value.frames.length === 0 || value.frames.length > limit) {
    return undefined;
  }
  const frames = normalizeFrames<TPayload>(value.frames);
  return frames === undefined
    ? undefined
    : { protocol: MULTIPLAYER_FIXED_STEP_INPUT_BUNDLE_PROTOCOL, frames };
}

export function createMultiplayerFixedStepInputInbox<TInput>(
  options: MultiplayerFixedStepInputInboxOptions<TInput> = {}
): MultiplayerFixedStepInputInbox<TInput> {
  const maxSources = positiveInteger(options.maxSources, DEFAULT_MAX_SOURCES);
  const maxBufferedFramesPerSource = positiveInteger(
    options.maxBufferedFramesPerSource,
    DEFAULT_MAX_BUFFERED_FRAMES_PER_SOURCE
  );
  const maxGapTicks = nonNegativeInteger(options.maxGapTicks, DEFAULT_MAX_GAP_TICKS);
  const gapPolicy = options.gapPolicy ?? "wait";
  if (gapPolicy === "neutral" && options.neutralInput === undefined) {
    throw new Error("Neutral fixed-step input gap policy requires neutralInput.");
  }
  const cloneInput = options.cloneInput ?? ((input: TInput) => structuredClone(input));
  const sources = new Map<string, SourceState<TInput>>();
  let disposed = false;
  const metrics: Omit<
    MultiplayerFixedStepInputInboxDiagnostics,
    "sources" | "queuedFrames" | "disposed"
  > = {
    acceptedFrames: 0,
    consumedFrames: 0,
    duplicateFrames: 0,
    staleFrames: 0,
    rejectedFrames: 0,
    sourceCapacityRejections: 0,
    frameCapacityRejections: 0,
    gaps: 0,
    gapFills: 0,
    generationResets: 0,
    releasedSources: 0
  };

  return {
    ingest(input) {
      assertActive();
      const sourceId = normalizeSourceId(input.sourceId);
      const bundle = readMultiplayerFixedStepInputBundle(input.bundle);
      if (sourceId === undefined || bundle === undefined || !validGeneration(input.generation)) {
        metrics.rejectedFrames += 1;
        return emptyIngestResult("invalid-bundle", 1);
      }
      let source = sources.get(sourceId);
      if (source === undefined) {
        if (sources.size >= maxSources) {
          metrics.sourceCapacityRejections += 1;
          metrics.rejectedFrames += bundle.frames.length;
          return emptyIngestResult("source-capacity", bundle.frames.length);
        }
        source = createSource(input.generation);
        sources.set(sourceId, source);
      } else if (source.generation !== input.generation) {
        source = createSource(input.generation);
        sources.set(sourceId, source);
        metrics.generationResets += 1;
      }

      let accepted = 0;
      let duplicates = 0;
      let stale = 0;
      let rejected = 0;
      for (const encoded of bundle.frames) {
        if (encoded.sequence <= source.acknowledgedSequence) {
          stale += 1;
          metrics.staleFrames += 1;
          continue;
        }
        if (source.buffered.has(encoded.sequence)) {
          duplicates += 1;
          metrics.duplicateFrames += 1;
          continue;
        }
        if (source.buffered.size >= maxBufferedFramesPerSource) {
          rejected += 1;
          metrics.rejectedFrames += 1;
          metrics.frameCapacityRejections += 1;
          continue;
        }
        const decoded = input.decode(encoded.payload, encoded);
        if (decoded === undefined) {
          rejected += 1;
          metrics.rejectedFrames += 1;
          continue;
        }
        source.buffered.set(encoded.sequence, {
          sequence: encoded.sequence,
          payload: cloneInput(decoded),
          ...(encoded.tick === undefined ? {} : { tick: encoded.tick }),
          ...(encoded.timestamp === undefined ? {} : { timestamp: encoded.timestamp })
        });
        accepted += 1;
        metrics.acceptedFrames += 1;
      }
      return { status: "accepted", accepted, duplicates, stale, rejected };
    },
    consume(input) {
      assertActive();
      const source = sources.get(input.sourceId);
      if (source === undefined || source.generation !== input.generation) {
        return { status: "empty", acknowledgedSequence: 0 };
      }
      const frame = source.buffered.get(source.nextSequence);
      if (frame !== undefined) {
        source.buffered.delete(source.nextSequence);
        source.nextSequence += 1;
        source.acknowledgedSequence = frame.sequence;
        source.gapTicks = 0;
        source.lastInput = cloneInput(frame.payload);
        metrics.consumedFrames += 1;
        return {
          status: "input",
          acknowledgedSequence: source.acknowledgedSequence,
          frame: cloneFrame(frame, cloneInput)
        };
      }
      if (!hasFutureFrame(source)) {
        source.gapTicks = 0;
        return { status: "empty", acknowledgedSequence: source.acknowledgedSequence };
      }
      source.gapTicks += 1;
      metrics.gaps += 1;
      if (source.gapTicks <= maxGapTicks || gapPolicy === "wait") {
        return { status: "gap", acknowledgedSequence: source.acknowledgedSequence };
      }
      const synthetic = resolveGapInput(sourceId(input.sourceId), source);
      if (synthetic === undefined) {
        return { status: "gap", acknowledgedSequence: source.acknowledgedSequence };
      }
      const syntheticSequence = source.nextSequence;
      source.nextSequence += 1;
      source.acknowledgedSequence = syntheticSequence;
      source.gapTicks = 0;
      source.lastInput = cloneInput(synthetic);
      metrics.consumedFrames += 1;
      metrics.gapFills += 1;
      return {
        status: "gap-filled",
        acknowledgedSequence: source.acknowledgedSequence,
        frame: { sequence: syntheticSequence, payload: cloneInput(synthetic) }
      };
    },
    acknowledgedSequence(sourceId) {
      assertActive();
      return sources.get(sourceId)?.acknowledgedSequence;
    },
    release(sourceId) {
      assertActive();
      if (sources.delete(sourceId)) {
        metrics.releasedSources += 1;
      }
    },
    reset() {
      assertActive();
      sources.clear();
    },
    diagnostics() {
      return {
        sources: sources.size,
        queuedFrames: [...sources.values()].reduce(
          (total, source) => total + source.buffered.size,
          0
        ),
        ...metrics,
        disposed
      };
    },
    dispose() {
      if (disposed) {
        return;
      }
      disposed = true;
      sources.clear();
    }
  };

  function assertActive(): void {
    if (disposed) {
      throw new Error("Fixed-step input inbox is disposed.");
    }
  }

  function resolveGapInput(sourceId: string, source: SourceState<TInput>): TInput | undefined {
    if (gapPolicy === "hold-last") {
      return source.lastInput === undefined ? undefined : cloneInput(source.lastInput);
    }
    if (gapPolicy === "neutral") {
      return options.neutralInput?.({
        sourceId,
        generation: source.generation,
        sequence: source.nextSequence
      });
    }
    return undefined;
  }
}

function createSource<TInput>(
  generation: MultiplayerFixedStepInputGeneration
): SourceState<TInput> {
  return {
    generation,
    acknowledgedSequence: 0,
    nextSequence: 1,
    gapTicks: 0,
    buffered: new Map()
  };
}

function normalizeFrames<TPayload>(
  frames: readonly unknown[]
): MultiplayerFixedStepInputFrame<TPayload>[] | undefined {
  const normalized: MultiplayerFixedStepInputFrame<TPayload>[] = [];
  const sequences = new Set<number>();
  for (const value of frames) {
    if (
      !isRecord(value) ||
      !Number.isSafeInteger(value.sequence) ||
      (value.sequence as number) <= 0 ||
      (value.tick !== undefined &&
        (!Number.isSafeInteger(value.tick) || (value.tick as number) < 0)) ||
      (value.timestamp !== undefined && !Number.isFinite(value.timestamp))
    ) {
      return undefined;
    }
    const sequence = value.sequence as number;
    if (sequences.has(sequence)) {
      return undefined;
    }
    sequences.add(sequence);
    normalized.push({
      sequence,
      payload: value.payload as TPayload,
      ...(value.tick === undefined ? {} : { tick: value.tick as number }),
      ...(value.timestamp === undefined ? {} : { timestamp: value.timestamp as number })
    });
  }
  normalized.sort((left, right) => left.sequence - right.sequence);
  return normalized;
}

function cloneFrame<TInput>(
  frame: MultiplayerFixedStepInputFrame<TInput>,
  cloneInput: (input: TInput) => TInput
): MultiplayerFixedStepInputFrame<TInput> {
  return {
    sequence: frame.sequence,
    payload: cloneInput(frame.payload),
    ...(frame.tick === undefined ? {} : { tick: frame.tick }),
    ...(frame.timestamp === undefined ? {} : { timestamp: frame.timestamp })
  };
}

function hasFutureFrame<TInput>(source: SourceState<TInput>): boolean {
  for (const sequence of source.buffered.keys()) {
    if (sequence > source.nextSequence) {
      return true;
    }
  }
  return false;
}

function emptyIngestResult(
  status: "source-capacity" | "invalid-bundle",
  rejected: number
): MultiplayerFixedStepInputInboxIngestResult {
  return { status, accepted: 0, duplicates: 0, stale: 0, rejected };
}

function sourceId(value: string): string {
  return value;
}

function normalizeSourceId(value: string): string | undefined {
  const normalized = value.trim();
  return normalized.length === 0 ? undefined : normalized;
}

function validGeneration(value: MultiplayerFixedStepInputGeneration): boolean {
  return typeof value === "string"
    ? value.length > 0
    : Number.isSafeInteger(value) && Number.isFinite(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

function positiveInteger(value: number | undefined, fallback: number): number {
  return value === undefined || !Number.isFinite(value) || value <= 0
    ? fallback
    : Math.floor(value);
}

function nonNegativeInteger(value: number | undefined, fallback: number): number {
  return value === undefined || !Number.isFinite(value) || value < 0 ? fallback : Math.floor(value);
}
