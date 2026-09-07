import type {
  DevToolsDataSourceKind,
  DevToolsSnapshot,
  DevToolsTraceEntry
} from "@gamekits/devtools";

export function TraceList({ traces }: { traces: DevToolsTraceEntry[] }) {
  return (
    <section className="gamekits-devtools-side-section">
      <h3>Recent Trace</h3>
      {traces.length === 0 ? (
        <p className="gamekits-devtools-empty">No trace entries for this panel.</p>
      ) : (
        <ol className="gamekits-devtools-trace-list">
          {traces.slice(-12).map((trace) => (
            <li
              className={`gamekits-devtools-trace gamekits-devtools-trace--${trace.severity ?? "info"}`}
              key={trace.id}
            >
              <span>{trace.kind}</span>
              <strong>{trace.label}</strong>
              <code>{trace.source}</code>
              {trace.status ? <em>{trace.status}</em> : null}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

export function DiagnosticList({ diagnostics }: { diagnostics: DevToolsSnapshot["diagnostics"] }) {
  return (
    <section className="gamekits-devtools-side-section">
      <h3>Diagnostics</h3>
      {diagnostics.length === 0 ? (
        <p className="gamekits-devtools-empty">No diagnostics for this panel.</p>
      ) : (
        <div className="gamekits-devtools-list">
          {diagnostics.slice(-6).map((diagnostic) => (
            <article className="gamekits-devtools-diagnostic" key={diagnostic.id}>
              <span>{diagnostic.severity}</span>
              <strong>{diagnostic.type}</strong>
              <p>{diagnostic.message}</p>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

export function ProfilerList({
  snapshot,
  sourceKinds
}: {
  snapshot: DevToolsSnapshot;
  sourceKinds: Set<DevToolsDataSourceKind>;
}) {
  const profiler =
    sourceKinds.has("runtime") || sourceKinds.has("world") || sourceKinds.has("renderer")
      ? snapshot.profiler
      : [];

  return (
    <section className="gamekits-devtools-side-section">
      <h3>Profiler</h3>
      {profiler.length === 0 ? (
        <p className="gamekits-devtools-empty">No profiler samples for this panel.</p>
      ) : (
        <div className="gamekits-devtools-list">
          {profiler.slice(0, 8).map((sample) => (
            <article
              className={`gamekits-devtools-row${sample.overBudget ? " is-warning" : ""}`}
              key={`${sample.moduleId ?? "runtime"}:${sample.systemId}`}
            >
              <strong>{sample.systemId}</strong>
              <span>
                {sample.lastDurationMs.toFixed(2)}ms · avg {sample.averageDurationMs.toFixed(2)}ms
              </span>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

export function CommandList({
  compact = false,
  snapshot
}: {
  compact?: boolean;
  snapshot: DevToolsSnapshot;
}) {
  if (snapshot.commands.length === 0 && compact) {
    return null;
  }

  return (
    <section className="gamekits-devtools-side-section">
      <h3>Commands</h3>
      {snapshot.commands.length === 0 ? (
        <p className="gamekits-devtools-empty">No commands registered.</p>
      ) : (
        <div className="gamekits-devtools-list">
          {snapshot.commands.map((command) => (
            <article className="gamekits-devtools-row" key={command.id}>
              <strong>{command.label}</strong>
              <span>{command.destructive ? "destructive" : command.scope}</span>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
