import { describe, expect, it } from "vitest";
import { createDevToolsCorrelationSource, createDevToolsRuntime } from "@gamekits/devtools";

describe("devtools runtime", () => {
  it("registers data sources, panels, commands and snapshots them", () => {
    const runtime = createDevToolsRuntime({ clock: () => 10 });

    runtime.registerDataSource({
      id: "host",
      label: "Host",
      kind: "host",
      snapshot() {
        return { phase: "started" };
      }
    });
    runtime.registerPanel({ id: "events", label: "Events", order: 2 });
    runtime.registerPanel({ id: "host", label: "Host", order: 1 });
    runtime.registerCommand({
      id: "debug.clear",
      label: "Clear",
      scope: "debug",
      execute() {
        runtime.clear({ traces: true });
      }
    });

    const snapshot = runtime.snapshot({ includeSourceSnapshots: true });

    expect(snapshot.dataSources).toEqual([{ id: "host", label: "Host", kind: "host" }]);
    expect(snapshot.sourceSnapshots?.[0]?.snapshot).toEqual({ phase: "started" });
    expect(snapshot.panels.map((panel) => panel.id)).toEqual(["host", "events"]);
    expect(snapshot.commands.map((command) => command.id)).toEqual(["debug.clear"]);
  });

  it("keeps bounded trace and diagnostic buffers", () => {
    const runtime = createDevToolsRuntime({
      traceLimit: 2,
      diagnosticLimit: 1,
      clock: () => 1
    });

    runtime.pushTrace({ kind: "event", label: "a", source: "test" });
    runtime.pushTrace({ kind: "event", label: "b", source: "test" });
    runtime.pushTrace({ kind: "event", label: "c", source: "test" });
    runtime.pushDiagnostic({
      type: "first",
      severity: "warning",
      source: "test",
      message: "first",
      payload: {}
    });
    runtime.pushDiagnostic({
      type: "second",
      severity: "error",
      source: "test",
      message: "second",
      payload: {}
    });

    expect(runtime.snapshot().traces.map((trace) => trace.label)).toEqual(["b", "c"]);
    expect(runtime.snapshot().diagnostics.map((diagnostic) => diagnostic.type)).toEqual(["second"]);
  });

  it("indexes explicit correlations incrementally with bounded summaries", () => {
    let now = 0;
    const runtime = createDevToolsRuntime({ traceLimit: 3, clock: () => now++ });
    const correlation = createDevToolsCorrelationSource(runtime, {
      correlationLimit: 2,
      rootLimitPerCorrelation: 1
    });
    runtime.registerDataSource(correlation.dataSource);

    correlation.push({
      id: "network-1",
      kind: "multiplayer",
      label: "command.accepted",
      source: "multiplayer",
      correlationId: "combat-1"
    });
    correlation.push({
      id: "physics-1",
      kind: "physics",
      label: "physics.query.hit",
      source: "physics",
      correlationId: "combat-1",
      parentId: "network-1"
    });
    correlation.push({
      id: "gas-1",
      kind: "gas",
      label: "gas.effect.applied",
      source: "gas",
      correlationId: "combat-1",
      parentId: "physics-1"
    });
    correlation.push({
      id: "tca-1",
      kind: "tca",
      label: "tca.rule.passed",
      source: "tca",
      correlationId: "combat-2"
    });
    correlation.push({
      id: "world-1",
      kind: "world",
      label: "world.entity.removed",
      source: "world",
      correlationId: "combat-3"
    });

    expect(runtime.snapshot().traces.map((entry) => entry.id)).toEqual([
      "gas-1",
      "tca-1",
      "world-1"
    ]);
    expect(correlation.snapshot()).toMatchObject({
      totalTraceCount: 5,
      uncorrelatedTraceCount: 0,
      retainedCorrelationCount: 2,
      correlations: [
        { correlationId: "combat-2", traceCount: 1, rootTraceIds: ["tca-1"] },
        { correlationId: "combat-3", traceCount: 1, rootTraceIds: ["world-1"] }
      ]
    });
    expect(
      runtime.snapshot({ includeSourceSnapshots: true }).sourceSnapshots?.[0]?.snapshot
    ).toEqual(correlation.snapshot());

    correlation.dispose();
    expect(correlation.push({ kind: "event", label: "ignored", source: "test" })).toBeUndefined();
  });

  it("records source snapshot failures as diagnostics without failing whole snapshot", () => {
    const runtime = createDevToolsRuntime({ clock: () => 2 });
    runtime.registerDataSource({
      id: "broken",
      label: "Broken",
      kind: "custom",
      snapshot() {
        throw new Error("boom");
      }
    });

    const snapshot = runtime.snapshot({ includeSourceSnapshots: true });

    expect(snapshot.sourceSnapshots?.[0]?.error?.code).toBe("devtools.data_source_snapshot_failed");
    expect(snapshot.diagnostics.map((diagnostic) => diagnostic.type)).toContain(
      "devtools.data_source_snapshot_failed"
    );
  });

  it("aggregates profiler samples", () => {
    const runtime = createDevToolsRuntime({ profilerBudgetMs: 4 });

    runtime.markProfilerSample({ systemId: "move", tick: 1, startedAt: 0, durationMs: 2 });
    runtime.markProfilerSample({
      systemId: "move",
      moduleId: "game",
      tick: 2,
      startedAt: 10,
      durationMs: 6,
      tags: ["hot"]
    });

    const profiler = runtime.snapshot().profiler;

    expect(profiler).toHaveLength(2);
    expect(profiler[0]).toMatchObject({
      name: "move",
      category: "system",
      systemId: "move",
      moduleId: "game",
      count: 1,
      maxDurationMs: 6,
      p50DurationMs: 6,
      p95DurationMs: 6,
      overBudget: true,
      tags: ["hot"]
    });
  });

  it("records profiler spans, frames and budgets", () => {
    let now = 100;
    const runtime = createDevToolsRuntime({
      clock: () => now,
      profilerBudgets: [
        {
          id: "runtime.system",
          category: "system",
          warningMs: 3,
          criticalMs: 8
        }
      ]
    });

    const frame = runtime.startProfilerFrame({ tick: 7, deltaMs: 16, timestamp: 112 });
    const span = runtime.beginProfilerSpan({
      name: "movement",
      category: "system",
      source: "game-runtime",
      frameId: frame.id,
      metadata: { systemId: "movement", moduleId: "sandbox.motion" }
    });
    now = 106;
    runtime.endProfilerSpan(span);
    now = 110;
    runtime.endProfilerFrame(frame);

    const snapshot = runtime.snapshot();

    expect(snapshot.profiler[0]).toMatchObject({
      name: "movement",
      category: "system",
      source: "game-runtime",
      systemId: "movement",
      moduleId: "sandbox.motion",
      maxDurationMs: 6,
      budgetId: "runtime.system",
      overBudget: true,
      critical: false
    });
    expect(snapshot.profilerFrames[0]).toMatchObject({
      tick: 7,
      deltaMs: 16,
      durationMs: 10,
      runtimeMs: 6,
      spanCount: 1,
      overBudgetCount: 1
    });
  });

  it("executes commands with trace and diagnostics on failure", async () => {
    const runtime = createDevToolsRuntime({ clock: () => 3 });
    runtime.registerCommand({
      id: "debug.fail",
      label: "Fail",
      scope: "debug",
      execute() {
        throw new Error("nope");
      }
    });

    await expect(runtime.executeCommand("debug.fail")).rejects.toThrow("nope");

    expect(runtime.snapshot().traces.map((trace) => trace.status)).toContain("started");
    expect(runtime.snapshot().diagnostics.map((diagnostic) => diagnostic.commandId)).toContain(
      "debug.fail"
    );
  });

  it("unregisters commands owned by a data source", () => {
    const runtime = createDevToolsRuntime();
    const unregister = runtime.registerDataSource({
      id: "data",
      label: "Data",
      kind: "data",
      snapshot() {
        return {};
      },
      actions: [
        {
          id: "data.reload",
          label: "Reload",
          scope: "debug",
          execute() {}
        }
      ]
    });

    expect(runtime.snapshot().commands.map((command) => command.id)).toEqual(["data.reload"]);

    unregister();

    expect(runtime.snapshot().commands).toEqual([]);
  });
});
