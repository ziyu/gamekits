import type { DevToolsPanelDefinition } from "@gamekits/devtools";
import type { ReactNode } from "react";

export function PanelSummary({
  diagnostics,
  panel,
  sources,
  traces
}: {
  diagnostics: number;
  panel: DevToolsPanelDefinition;
  sources: number;
  traces: number;
}) {
  return (
    <header className="gamekits-devtools-panel__summary">
      <div>
        <span>Panel</span>
        <strong>{panel.label}</strong>
      </div>
      <Metric label="Sources" value={sources} />
      <Metric label="Traces" value={traces} />
      <Metric label="Diagnostics" value={diagnostics} />
    </header>
  );
}

export function Metric({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="gamekits-devtools-metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

export function EmptyState({ detail, title }: { detail: string; title: string }) {
  return (
    <div className="gamekits-devtools-empty-state">
      <strong>{title}</strong>
      <p>{detail}</p>
    </div>
  );
}

export function KeyValueGrid({ entries }: { entries: Array<[string, ReactNode]> }) {
  return (
    <dl className="gamekits-devtools-kv-grid">
      {entries.map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function ChipList({ items }: { items: Array<number | string> }) {
  if (items.length === 0) {
    return <span className="gamekits-devtools-muted">none</span>;
  }

  return (
    <div className="gamekits-devtools-chip-list">
      {items.map((item, index) => (
        <span className="gamekits-devtools-chip" key={`${String(item)}:${index}`}>
          {item}
        </span>
      ))}
    </div>
  );
}
