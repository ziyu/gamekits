import type {
  DevToolsDataSourceKind,
  DevToolsSnapshot,
  DevToolsSourceSnapshot
} from "@gamekits/devtools";
import type { PanelModel } from "./panel-types";

export function createPanelModel(
  snapshot: DevToolsSnapshot,
  panel: PanelModel["panel"]
): PanelModel {
  const sourceKinds = new Set(
    panel.sourceKinds ?? snapshot.dataSources.map((source) => source.kind)
  );
  const sources = readPanelSources(snapshot, sourceKinds);
  return {
    panel,
    sourceKinds,
    sources,
    traces: readPanelTraces(snapshot, sourceKinds, sources),
    diagnostics: readPanelDiagnostics(snapshot, sourceKinds, sources)
  };
}

function readPanelSources(
  snapshot: DevToolsSnapshot,
  sourceKinds: Set<DevToolsDataSourceKind>
): DevToolsSourceSnapshot[] {
  const snapshots = snapshot.sourceSnapshots ?? [];
  return snapshots.filter((source) => sourceKinds.has(source.kind));
}

function readPanelTraces(
  snapshot: DevToolsSnapshot,
  sourceKinds: Set<DevToolsDataSourceKind>,
  sources: DevToolsSourceSnapshot[]
) {
  const sourceIds = new Set(sources.map((source) => source.id));
  return snapshot.traces.filter(
    (trace) =>
      sourceKinds.has(trace.kind as DevToolsDataSourceKind) ||
      sourceIds.has(trace.source) ||
      trace.source.startsWith("devtools")
  );
}

function readPanelDiagnostics(
  snapshot: DevToolsSnapshot,
  sourceKinds: Set<DevToolsDataSourceKind>,
  sources: DevToolsSourceSnapshot[]
): DevToolsSnapshot["diagnostics"] {
  const sourceIds = new Set(sources.map((source) => source.id));
  return snapshot.diagnostics.filter(
    (diagnostic) =>
      diagnostic.dataSourceId === undefined ||
      sourceIds.has(diagnostic.dataSourceId) ||
      sourceKinds.has(diagnostic.source as DevToolsDataSourceKind)
  );
}
