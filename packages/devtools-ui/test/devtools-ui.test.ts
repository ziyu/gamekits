import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { createDevToolsRuntime, type DevToolsPanelDefinition } from "@gamekits/devtools";
import { createUiRuntime } from "@gamekits/ui-core";
import {
  createDevToolsUiBridge,
  DevToolsLauncher,
  DevToolsOverlay,
  DevToolsPinDock,
  DevToolsShell,
  renderStandardPinnedDevToolsPanel,
  renderStandardDevToolsPanel
} from "../src";

describe("@gamekits/devtools-ui", () => {
  it("toggles the registered DevTools shell through the bridge", () => {
    const devtools = createDevToolsRuntime();
    const ui = createUiRuntime();

    const bridge = createDevToolsUiBridge({ devtools, ui });
    bridge.openShell();

    expect(bridge.snapshot().shell.open).toBe(true);
    expect(bridge.snapshot().pins.defaultPinned).toEqual(["devtools.performance"]);
    expect(ui.panel("gamekits.devtools.shell")).toMatchObject({ kind: "devtools" });
    expect(ui.snapshot().focus.scope).toBe("devtools");

    bridge.closeShell();

    expect(bridge.snapshot().shell.open).toBe(false);
  });

  it("renders a launcher button without owning DevTools state", () => {
    const devtools = createDevToolsRuntime();
    const ui = createUiRuntime();

    const html = renderToStaticMarkup(
      createElement(DevToolsLauncher, { runtime: devtools, uiRuntime: ui, label: "Inspect" })
    );

    expect(html).toContain("Inspect");
    expect(html).toContain("gamekits-devtools-launcher");
  });

  it("renders registered sources, traces, profiler samples, and commands in the shell", () => {
    const devtools = createDevToolsRuntime({ clock: () => 100 });
    devtools.registerPanel({ id: "gamekits.devtools.sources", label: "Sources" });
    devtools.registerPanel({ id: "gamekits.devtools.traces", label: "Trace" });
    devtools.registerDataSource({
      id: "data",
      label: "Data Registry",
      kind: "data",
      snapshot: () => ({ documents: 4 })
    });
    devtools.registerCommand({
      id: "devtools.clear",
      label: "Clear",
      scope: "debug",
      execute: () => undefined
    });
    devtools.pushTrace({
      kind: "tca",
      label: "rule.fired",
      source: "tca",
      severity: "info"
    });
    devtools.markProfilerSample({
      systemId: "movement",
      moduleId: "sandbox.motion",
      tick: 3,
      startedAt: 90,
      durationMs: 1.5
    });

    const html = renderToStaticMarkup(createElement(DevToolsShell, { runtime: devtools }));

    expect(html).toContain("Data Registry");
    expect(html).toContain("1 sources");
    expect(html).toContain("Sources");
    expect(html).toContain("Resize DevTools left");
    expect(html).toContain("Resize DevTools top");
    expect(html).toContain("Resize DevTools top-left");
  });

  it("lets apps provide custom panel rendering through the overlay", () => {
    const devtools = createDevToolsRuntime();
    const ui = createUiRuntime();
    devtools.registerPanel({ id: "app.chain", label: "App Chain" });
    createDevToolsUiBridge({ devtools, ui }).openShell("app.chain");

    const html = renderToStaticMarkup(
      createElement(DevToolsOverlay, {
        runtime: devtools,
        uiRuntime: ui,
        renderPanel: () => createElement("section", null, "Custom Chain Panel")
      })
    );

    expect(html).toContain("Custom Chain Panel");
  });

  it("renders App Host standard panels with matching source snapshots and traces", () => {
    const devtools = createDevToolsRuntime({ clock: () => 100 });
    const runtimePanel: DevToolsPanelDefinition = {
      id: "devtools.runtime",
      label: "Runtime Flow",
      sourceKinds: ["runtime", "tca", "gas"]
    };
    devtools.registerPanel(runtimePanel);
    devtools.registerDataSource({
      id: "game",
      label: "Game Runtime",
      kind: "runtime",
      snapshot: () => ({
        running: true,
        clock: { ticks: 12 },
        systems: ["movement", "render"]
      })
    });
    devtools.registerDataSource({
      id: "data",
      label: "Data Registry",
      kind: "data",
      snapshot: () => ({ documents: 7 })
    });
    devtools.pushTrace({
      kind: "tca",
      label: "rule.sandbox.motion_heartbeat",
      source: "tca",
      severity: "info",
      status: "passed"
    });
    devtools.markProfilerSample({
      systemId: "movement",
      moduleId: "sandbox.motion",
      tick: 12,
      startedAt: 90,
      durationMs: 2.25
    });

    const snapshot = devtools.snapshot({ includeSourceSnapshots: true });
    const html = renderToStaticMarkup(
      createElement(() => renderStandardDevToolsPanel({ snapshot, panel: runtimePanel }))
    );

    expect(html).toContain("Runtime Flow");
    expect(html).toContain("Game Runtime");
    expect(html).toContain("rule.sandbox.motion_heartbeat");
    expect(html).toContain("movement");
    expect(html).not.toContain("Data Registry");
  });

  it("renders a structured performance panel", () => {
    const devtools = createDevToolsRuntime({ clock: () => 100, profilerBudgetMs: 1 });
    const panel: DevToolsPanelDefinition = {
      id: "devtools.performance",
      label: "Performance",
      sourceKinds: ["runtime", "host"]
    };
    const bootSpan = devtools.beginProfilerSpan({
      name: "drivers.boot",
      category: "service",
      source: "drivers",
      startedAt: 20
    });
    devtools.endProfilerSpan(bootSpan, { durationMs: 12 });
    const frame = devtools.startProfilerFrame({ tick: 3, deltaMs: 16, timestamp: 48 });
    const span = devtools.beginProfilerSpan({
      name: "movement",
      category: "system",
      source: "game-runtime",
      frameId: frame.id,
      startedAt: 90,
      metadata: { systemId: "movement" }
    });
    devtools.endProfilerSpan(span, { durationMs: 2 });
    devtools.endProfilerFrame(frame);
    const slowFrame = devtools.startProfilerFrame({ tick: 4, deltaMs: 32, timestamp: 80 });
    devtools.endProfilerFrame(slowFrame);

    const snapshot = devtools.snapshot({ includeSourceSnapshots: true });
    const html = renderToStaticMarkup(
      createElement(() => renderStandardDevToolsPanel({ snapshot, panel }))
    );

    expect(html).toContain("Performance");
    expect(html).toContain("Frame Time");
    expect(html).toContain("Frame Window");
    expect(html).toContain("32.00ms frame time");
    expect(html).toContain("measured work");
    expect(html).toContain("Live Loop Hot Spots");
    expect(html).toContain("Live Budget Warnings");
    expect(html).toContain("Lifecycle Waterfall");
    expect(html).toContain("movement");
    expect(html).toContain("drivers");

    const hotSpotsSection = html.slice(
      html.indexOf("Live Loop Hot Spots"),
      html.indexOf("Live Budget Warnings")
    );
    expect(hotSpotsSection).not.toContain("drivers.boot");
  });

  it("renders a pinned performance widget without full panel tables", () => {
    const devtools = createDevToolsRuntime({ clock: () => 100, profilerBudgetMs: 1 });
    const panel: DevToolsPanelDefinition = {
      id: "devtools.performance",
      label: "Performance",
      pin: { enabled: true, defaultPinned: true, icon: "perf" },
      sourceKinds: ["runtime", "host"]
    };
    devtools.registerPanel(panel);
    const frame = devtools.startProfilerFrame({ tick: 3, deltaMs: 16, timestamp: 48 });
    const span = devtools.beginProfilerSpan({
      name: "movement",
      category: "system",
      source: "game-runtime",
      frameId: frame.id,
      startedAt: 90,
      metadata: { systemId: "movement" }
    });
    devtools.endProfilerSpan(span, { durationMs: 2 });
    devtools.endProfilerFrame(frame);
    const slowFrame = devtools.startProfilerFrame({ tick: 4, deltaMs: 32, timestamp: 80 });
    devtools.endProfilerFrame(slowFrame);

    const snapshot = devtools.snapshot();
    const html = renderToStaticMarkup(
      createElement(() => renderStandardPinnedDevToolsPanel({ snapshot, panel }))
    );

    expect(html).toContain("frame history");
    expect(html).toContain("Spans");
    expect(html).toContain("fps");
    expect(html).toContain("frame");
    expect(html).toContain("render");
    expect(html).not.toContain("movement");
    expect(html).not.toContain("Lifecycle Waterfall");
  });

  it("renders default pinned panels in the pin dock", () => {
    const devtools = createDevToolsRuntime({ clock: () => 100 });
    const ui = createUiRuntime();
    devtools.registerPanel({
      id: "devtools.performance",
      label: "Performance",
      pin: { enabled: true, defaultPinned: true, icon: "perf" },
      sourceKinds: ["runtime"]
    });

    const html = renderToStaticMarkup(
      createElement(DevToolsPinDock, { runtime: devtools, uiRuntime: ui })
    );

    expect(html).toContain("gamekits-devtools-pin-dock");
    expect(html).toContain("fps");
    expect(html).toContain("Collapse Performance");
  });
});
