import type { ReactNode } from "react";
import { CommandList, DiagnosticList, ProfilerList, TraceList } from "./activity-panels";
import { createPanelModel } from "./panel-filters";
import { PanelSummary } from "./panel-layout";
import { PerformancePanel } from "./performance-panel";
import { PerformancePin } from "./performance-pin";
import { SourceSnapshotList } from "./source-views";
import type { DevToolsPanelRendererProps } from "./panel-types";

export type { DevToolsPanelRenderer, DevToolsPanelRendererProps } from "./panel-types";

export function renderStandardDevToolsPanel({ snapshot, panel }: DevToolsPanelRendererProps) {
  if (panel.id === "gamekits.devtools.commands") {
    return <CommandList snapshot={snapshot} />;
  }
  if (panel.id === "devtools.performance") {
    return <PerformancePanel snapshot={snapshot} />;
  }

  const model = createPanelModel(snapshot, panel);
  return (
    <section className="gamekits-devtools-panel">
      <PanelSummary
        diagnostics={model.diagnostics.length}
        panel={panel}
        sources={model.sources.length}
        traces={model.traces.length}
      />
      <div className="gamekits-devtools-panel__grid">
        <section className="gamekits-devtools-panel__main">
          <SourceSnapshotList sources={model.sources} />
        </section>
        <aside className="gamekits-devtools-panel__side">
          <TraceList traces={model.traces} />
          <DiagnosticList diagnostics={model.diagnostics} />
          <ProfilerList snapshot={snapshot} sourceKinds={model.sourceKinds} />
          <CommandList snapshot={snapshot} compact />
        </aside>
      </div>
    </section>
  );
}

export type DevToolsPinnedPanelRendererProps = DevToolsPanelRendererProps & {
  collapsed?: boolean | undefined;
};

export type DevToolsPinnedPanelRenderer = (props: DevToolsPinnedPanelRendererProps) => ReactNode;

export function renderStandardPinnedDevToolsPanel({
  collapsed,
  panel,
  snapshot
}: DevToolsPinnedPanelRendererProps) {
  if (panel.id === "devtools.performance") {
    return <PerformancePin collapsed={collapsed} snapshot={snapshot} />;
  }

  return (
    <div className="gamekits-devtools-generic-pin">
      <strong>{panel.pin?.label ?? panel.label}</strong>
      <span>{panel.sourceKinds?.join(", ") || "custom"}</span>
    </div>
  );
}
