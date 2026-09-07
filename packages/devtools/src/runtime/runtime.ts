import { GameError } from "@gamekits/core";
import type {
  DevToolsClearOptions,
  DevToolsCommandDefinition,
  DevToolsDataSource,
  DevToolsDiagnosticEvent,
  DevToolsPanelDefinition,
  DevToolsProfilerBudget,
  DevToolsProfilerFrameHandle,
  DevToolsProfilerFrameSummary,
  DevToolsProfilerSpanCategory,
  DevToolsProfilerSpanHandle,
  DevToolsProfilerSummary,
  DevToolsRuntime,
  DevToolsRuntimeOptions,
  DevToolsSnapshot,
  DevToolsSnapshotContext,
  DevToolsSourceSnapshot,
  DevToolsTraceEntry
} from "./types";

const DEFAULT_TRACE_LIMIT = 300;
const DEFAULT_DIAGNOSTIC_LIMIT = 100;
const DEFAULT_PROFILER_BUDGET_MS = 4;
const DEFAULT_PROFILER_SPAN_LIMIT = 600;
const DEFAULT_PROFILER_FRAME_LIMIT = 180;

type DataSourceRegistration = {
  source: DevToolsDataSource;
  commandIds: string[];
  unsubscribe?: (() => void) | undefined;
};

type ProfilerAggregate = {
  id: string;
  name: string;
  category: DevToolsProfilerSpanCategory;
  source: string;
  systemId?: string | undefined;
  moduleId?: string | undefined;
  count: number;
  totalDurationMs: number;
  lastDurationMs: number;
  maxDurationMs: number;
  lastTick: number;
  tags: Set<string>;
  durations: number[];
  budget?: DevToolsProfilerBudget | undefined;
};

type CompletedProfilerSpan = {
  id: string;
  name: string;
  category: DevToolsProfilerSpanCategory;
  source: string;
  parentId?: string | undefined;
  frameId?: string | undefined;
  startedAt: number;
  durationMs: number;
  tags: string[];
  metadata?: Record<string, unknown> | undefined;
  tick?: number | undefined;
};

type ActiveProfilerSpan = Omit<CompletedProfilerSpan, "durationMs">;

type ActiveProfilerFrame = {
  id: string;
  tick?: number | undefined;
  timestamp: number;
  deltaMs: number;
  startedAt: number;
  source: string;
  tags: string[];
  metadata?: Record<string, unknown> | undefined;
};

export function createDevToolsRuntime(options: DevToolsRuntimeOptions = {}): DevToolsRuntime {
  const clock = options.clock ?? createDefaultClock();
  const traceLimit = options.traceLimit ?? DEFAULT_TRACE_LIMIT;
  const diagnosticLimit = options.diagnosticLimit ?? DEFAULT_DIAGNOSTIC_LIMIT;
  const profilerBudgetMs = options.profilerBudgetMs ?? DEFAULT_PROFILER_BUDGET_MS;
  const profilerSpanLimit = options.profilerSpanLimit ?? DEFAULT_PROFILER_SPAN_LIMIT;
  const profilerFrameLimit = options.profilerFrameLimit ?? DEFAULT_PROFILER_FRAME_LIMIT;
  const profilerBudgets = options.profilerBudgets ?? [];
  const traces: DevToolsTraceEntry[] = [];
  const diagnostics: DevToolsDiagnosticEvent[] = [];
  const dataSources = new Map<string, DataSourceRegistration>();
  const panels = new Map<string, DevToolsPanelDefinition>();
  const commands = new Map<string, DevToolsCommandDefinition>();
  const profiler = new Map<string, ProfilerAggregate>();
  const activeProfilerSpans = new Map<string, ActiveProfilerSpan>();
  const completedProfilerSpans: CompletedProfilerSpan[] = [];
  const activeProfilerFrames = new Map<string, ActiveProfilerFrame>();
  const profilerFrames: DevToolsProfilerFrameSummary[] = [];
  let traceSequence = 0;
  let diagnosticSequence = 0;
  let profilerSequence = 0;
  let profilerFrameSequence = 0;

  const runtime: DevToolsRuntime = {
    registerDataSource(source) {
      if (dataSources.has(source.id)) {
        throw duplicateError("data_source", source.id);
      }
      const registration: DataSourceRegistration = { source, commandIds: [] };
      if (source.subscribe) {
        registration.unsubscribe = source.subscribe(() => {
          runtime.pushTrace({
            kind: "runtime",
            label: "devtools.source_changed",
            source: source.id,
            severity: "debug"
          });
        });
      }
      dataSources.set(source.id, registration);

      for (const action of source.actions ?? []) {
        if (!commands.has(action.id)) {
          commands.set(action.id, action);
          registration.commandIds.push(action.id);
        }
      }

      return () => {
        registration.unsubscribe?.();
        for (const commandId of registration.commandIds) {
          commands.delete(commandId);
        }
        dataSources.delete(source.id);
      };
    },
    registerPanel(panel) {
      if (panels.has(panel.id)) {
        throw duplicateError("panel", panel.id);
      }
      panels.set(panel.id, panel);
      return () => {
        panels.delete(panel.id);
      };
    },
    registerCommand(command) {
      if (commands.has(command.id)) {
        throw duplicateError("command", command.id);
      }
      commands.set(command.id, command);
      return () => {
        commands.delete(command.id);
      };
    },
    pushTrace(input) {
      const entry: DevToolsTraceEntry = {
        ...input,
        id: input.id ?? `devtools-trace-${traceSequence}`,
        time: input.time ?? clock()
      };
      traceSequence += 1;
      traces.push(entry);
      trim(traces, traceLimit);
      return entry;
    },
    pushDiagnostic(input) {
      const event: DevToolsDiagnosticEvent = {
        ...input,
        id: input.id ?? `devtools-diagnostic-${diagnosticSequence}`,
        time: input.time ?? clock()
      };
      diagnosticSequence += 1;
      diagnostics.push(event);
      trim(diagnostics, diagnosticLimit);
      return event;
    },
    markProfilerSample(sample) {
      recordCompletedProfilerSpan({
        id: `devtools-profiler-sample-${profilerSequence}`,
        name: sample.systemId,
        category: "system",
        source: sample.moduleId ?? "runtime",
        startedAt: sample.startedAt,
        durationMs: sample.durationMs,
        tags: sample.tags ?? [],
        metadata: {
          systemId: sample.systemId,
          ...(sample.moduleId === undefined ? {} : { moduleId: sample.moduleId })
        },
        tick: sample.tick
      });
      profilerSequence += 1;
    },
    beginProfilerSpan(input) {
      const handle: DevToolsProfilerSpanHandle = {
        id: `devtools-profiler-span-${profilerSequence}`
      };
      profilerSequence += 1;
      activeProfilerSpans.set(handle.id, {
        id: handle.id,
        name: input.name,
        category: input.category,
        source: input.source,
        ...(input.parentId === undefined ? {} : { parentId: input.parentId }),
        ...(input.frameId === undefined ? {} : { frameId: input.frameId }),
        startedAt: input.startedAt ?? clock(),
        tags: input.tags ?? [],
        ...(input.metadata === undefined ? {} : { metadata: input.metadata })
      });
      return handle;
    },
    endProfilerSpan(handle, patch = {}) {
      const span = activeProfilerSpans.get(handle.id);
      if (!span) {
        runtime.pushDiagnostic({
          type: "devtools.profiler_span_missing",
          severity: "warning",
          source: "devtools.profiler",
          phase: "profiler",
          code: "devtools.profiler_span_missing",
          message: `Missing profiler span: ${handle.id}`,
          payload: { spanId: handle.id }
        });
        return;
      }
      activeProfilerSpans.delete(handle.id);
      const endedAt = patch.endedAt ?? clock();
      recordCompletedProfilerSpan({
        ...span,
        tags: mergeTags(span.tags, patch.tags),
        metadata: mergeMetadata(span.metadata, patch.metadata),
        durationMs: patch.durationMs ?? Math.max(0, endedAt - span.startedAt)
      });
    },
    measureProfilerSpan(input, fn) {
      const handle = runtime.beginProfilerSpan(input);
      try {
        const result = fn();
        runtime.endProfilerSpan(handle);
        return result;
      } catch (error) {
        runtime.endProfilerSpan(handle, {
          tags: ["error"],
          metadata: { error: readErrorMessage(error) }
        });
        throw error;
      }
    },
    startProfilerFrame(input) {
      const handle: DevToolsProfilerFrameHandle = {
        id: `devtools-profiler-frame-${profilerFrameSequence}`
      };
      profilerFrameSequence += 1;
      activeProfilerFrames.set(handle.id, {
        id: handle.id,
        ...(input.tick === undefined ? {} : { tick: input.tick }),
        timestamp: input.timestamp ?? clock(),
        deltaMs: input.deltaMs,
        startedAt: clock(),
        source: input.source ?? "runtime",
        tags: input.tags ?? [],
        ...(input.metadata === undefined ? {} : { metadata: input.metadata })
      });
      return handle;
    },
    endProfilerFrame(handle) {
      const frame = activeProfilerFrames.get(handle.id);
      if (!frame) {
        runtime.pushDiagnostic({
          type: "devtools.profiler_frame_missing",
          severity: "warning",
          source: "devtools.profiler",
          phase: "profiler",
          code: "devtools.profiler_frame_missing",
          message: `Missing profiler frame: ${handle.id}`,
          payload: { frameId: handle.id }
        });
        return;
      }
      activeProfilerFrames.delete(handle.id);
      const frameSpans = completedProfilerSpans.filter((span) => span.frameId === handle.id);
      const overBudgetCount = frameSpans.filter((span) => isOverBudget(span)).length;
      profilerFrames.push({
        id: frame.id,
        ...(frame.tick === undefined ? {} : { tick: frame.tick }),
        timestamp: frame.timestamp,
        deltaMs: frame.deltaMs,
        durationMs: Math.max(0, clock() - frame.startedAt),
        runtimeMs: sumDuration(frameSpans, "runtime", "system"),
        renderMs: sumDuration(frameSpans, "renderer"),
        uiMs: sumDuration(frameSpans, "ui"),
        devtoolsMs: sumDuration(frameSpans, "devtools"),
        spanCount: frameSpans.length,
        overBudgetCount,
        tags: frame.tags
      });
      trim(profilerFrames, profilerFrameLimit);
    },
    async executeCommand(commandId, input) {
      const command = commands.get(commandId);
      if (!command) {
        throw new GameError("devtools.command_missing", `Missing DevTools command: ${commandId}`);
      }
      try {
        runtime.pushTrace({
          kind: "runtime",
          label: command.id,
          source: "devtools.command",
          status: "started",
          severity: "info"
        });
        await command.execute({ runtime, now: clock() }, input);
        runtime.pushTrace({
          kind: "runtime",
          label: command.id,
          source: "devtools.command",
          status: "completed",
          severity: "info"
        });
      } catch (error) {
        runtime.pushDiagnostic({
          type: "devtools.command_failed",
          severity: "error",
          source: "devtools.command",
          phase: "command",
          code: "devtools.command_failed",
          commandId,
          message: readErrorMessage(error),
          payload: {}
        });
        throw error;
      }
    },
    snapshot(snapshotOptions = {}) {
      const sourceKinds = new Set(snapshotOptions.sourceKinds);
      const traceKinds = new Set(snapshotOptions.traceKinds);
      const includeSourceSnapshots = snapshotOptions.includeSourceSnapshots === true;
      const snapshotContext: DevToolsSnapshotContext = { now: clock() };
      const sourceList = [...dataSources.values()]
        .map((entry) => entry.source)
        .filter((source) => sourceKinds.size === 0 || sourceKinds.has(source.kind));
      const sourceSnapshots = includeSourceSnapshots
        ? sourceList.map((source) => readSourceSnapshot(source, snapshotContext, runtime))
        : undefined;

      const snapshot: DevToolsSnapshot = {
        traces: traces.filter((entry) => traceKinds.size === 0 || traceKinds.has(entry.kind)),
        diagnostics: [...diagnostics],
        dataSources: sourceList.map((source) => ({
          id: source.id,
          label: source.label,
          kind: source.kind
        })),
        panels: [...panels.values()].sort((left, right) => (left.order ?? 0) - (right.order ?? 0)),
        commands: [...commands.values()].map((command) => ({
          id: command.id,
          label: command.label,
          scope: command.scope,
          destructive: command.destructive === true
        })),
        profiler: profilerSummary([...profiler.values()], profilerBudgetMs)
          .map((summary) => summary)
          .sort((left, right) => right.maxDurationMs - left.maxDurationMs),
        profilerFrames: [...profilerFrames]
      };

      if (sourceSnapshots) {
        snapshot.sourceSnapshots = sourceSnapshots;
      }

      return snapshot;
    },
    clear(clearOptions: DevToolsClearOptions = {}) {
      const clearAll =
        clearOptions.traces !== true &&
        clearOptions.diagnostics !== true &&
        clearOptions.profiler !== true;
      if (clearAll || clearOptions.traces === true) {
        traces.length = 0;
      }
      if (clearAll || clearOptions.diagnostics === true) {
        diagnostics.length = 0;
      }
      if (clearAll || clearOptions.profiler === true) {
        profiler.clear();
        activeProfilerSpans.clear();
        completedProfilerSpans.length = 0;
        activeProfilerFrames.clear();
        profilerFrames.length = 0;
      }
    },
    dispose() {
      for (const registration of dataSources.values()) {
        registration.unsubscribe?.();
      }
      dataSources.clear();
      panels.clear();
      commands.clear();
      traces.length = 0;
      diagnostics.length = 0;
      profiler.clear();
      activeProfilerSpans.clear();
      completedProfilerSpans.length = 0;
      activeProfilerFrames.clear();
      profilerFrames.length = 0;
    }
  };

  function recordCompletedProfilerSpan(span: CompletedProfilerSpan): void {
    completedProfilerSpans.push(span);
    trim(completedProfilerSpans, profilerSpanLimit);
    const key = profilerSpanKey(span);
    const aggregate = profiler.get(key) ?? createProfilerAggregate(span, findBudget(span));
    aggregate.count += 1;
    aggregate.totalDurationMs += span.durationMs;
    aggregate.lastDurationMs = span.durationMs;
    aggregate.maxDurationMs = Math.max(aggregate.maxDurationMs, span.durationMs);
    aggregate.lastTick = span.tick ?? aggregate.lastTick;
    aggregate.durations.push(span.durationMs);
    trim(aggregate.durations, 120);
    for (const tag of span.tags) {
      aggregate.tags.add(tag);
    }
    profiler.set(key, aggregate);
  }

  function findBudget(span: CompletedProfilerSpan): DevToolsProfilerBudget | undefined {
    return (
      profilerBudgets.find(
        (budget) =>
          (budget.category === undefined || budget.category === span.category) &&
          (budget.source === undefined || budget.source === span.source) &&
          (budget.name === undefined || budget.name === span.name) &&
          (budget.tags === undefined || budget.tags.every((tag) => span.tags.includes(tag)))
      ) ??
      (span.category === "system"
        ? {
            id: "default.system",
            category: "system",
            warningMs: profilerBudgetMs
          }
        : undefined)
    );
  }

  function isOverBudget(span: CompletedProfilerSpan): boolean {
    const budget = findBudget(span);
    return budget !== undefined && span.durationMs > budget.warningMs;
  }

  return runtime;
}

function createDefaultClock(): () => number {
  const performanceNow = globalThis.performance?.now.bind(globalThis.performance);
  return performanceNow ?? Date.now;
}

function readSourceSnapshot(
  source: DevToolsDataSource,
  ctx: DevToolsSnapshotContext,
  runtime: DevToolsRuntime
): DevToolsSourceSnapshot {
  try {
    return {
      id: source.id,
      label: source.label,
      kind: source.kind,
      snapshot: source.snapshot(ctx)
    };
  } catch (error) {
    runtime.pushDiagnostic({
      type: "devtools.data_source_snapshot_failed",
      severity: "error",
      source: "devtools",
      phase: "snapshot",
      code: "devtools.data_source_snapshot_failed",
      dataSourceId: source.id,
      message: readErrorMessage(error),
      payload: {}
    });
    return {
      id: source.id,
      label: source.label,
      kind: source.kind,
      error: {
        code: "devtools.data_source_snapshot_failed",
        message: readErrorMessage(error)
      }
    };
  }
}

function createProfilerAggregate(
  span: CompletedProfilerSpan,
  budget: DevToolsProfilerBudget | undefined
): ProfilerAggregate {
  const metadata = span.metadata ?? {};
  return {
    id: profilerSpanKey(span),
    name: span.name,
    category: span.category,
    source: span.source,
    ...(typeof metadata.systemId === "string" ? { systemId: metadata.systemId } : {}),
    ...(typeof metadata.moduleId === "string" ? { moduleId: metadata.moduleId } : {}),
    count: 0,
    totalDurationMs: 0,
    lastDurationMs: 0,
    maxDurationMs: 0,
    lastTick: span.tick ?? 0,
    tags: new Set(),
    durations: [],
    budget
  };
}

function profilerSummary(
  aggregates: ProfilerAggregate[],
  budgetMs: number
): DevToolsProfilerSummary[] {
  return aggregates
    .map((aggregate) => {
      const budget = aggregate.budget ?? {
        id: "default",
        warningMs: budgetMs
      };
      return {
        id: aggregate.id,
        name: aggregate.name,
        category: aggregate.category,
        source: aggregate.source,
        ...(aggregate.systemId === undefined ? {} : { systemId: aggregate.systemId }),
        ...(aggregate.moduleId === undefined ? {} : { moduleId: aggregate.moduleId }),
        count: aggregate.count,
        lastDurationMs: aggregate.lastDurationMs,
        averageDurationMs: aggregate.totalDurationMs / aggregate.count,
        p50DurationMs: percentile(aggregate.durations, 0.5),
        p95DurationMs: percentile(aggregate.durations, 0.95),
        maxDurationMs: aggregate.maxDurationMs,
        lastTick: aggregate.lastTick,
        tags: [...aggregate.tags],
        budgetId: budget.id,
        budgetWarningMs: budget.warningMs,
        ...(budget.criticalMs === undefined ? {} : { budgetCriticalMs: budget.criticalMs }),
        overBudget: aggregate.maxDurationMs > budget.warningMs,
        critical:
          budget.criticalMs === undefined ? false : aggregate.maxDurationMs > budget.criticalMs
      };
    })
    .sort((left, right) => right.maxDurationMs - left.maxDurationMs);
}

function profilerSpanKey(span: CompletedProfilerSpan): string {
  return `${span.category}:${span.source}:${span.name}`;
}

function trim<T>(values: T[], limit: number): void {
  while (values.length > limit) {
    values.shift();
  }
}

function duplicateError(kind: string, id: string): GameError {
  return new GameError("devtools.duplicate_id", `Duplicate DevTools ${kind}: ${id}`);
}

function readErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function mergeTags(left: string[], right: string[] | undefined): string[] {
  return right === undefined ? left : [...new Set([...left, ...right])];
}

function mergeMetadata(
  left: Record<string, unknown> | undefined,
  right: Record<string, unknown> | undefined
): Record<string, unknown> | undefined {
  if (left === undefined) {
    return right;
  }
  if (right === undefined) {
    return left;
  }
  return { ...left, ...right };
}

function percentile(values: number[], ratio: number): number {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * ratio) - 1));
  return sorted[index] ?? 0;
}

function sumDuration(
  spans: CompletedProfilerSpan[],
  ...categories: DevToolsProfilerSpanCategory[]
): number {
  const categorySet = new Set(categories);
  return spans.reduce(
    (total, span) => (categorySet.has(span.category) ? total + span.durationMs : total),
    0
  );
}
