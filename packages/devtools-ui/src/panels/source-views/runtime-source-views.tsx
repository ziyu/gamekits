import { ChipList, Metric } from "../panel-layout";
import { formatScalar, readArray, readBoolean, readNumber, readString } from "../value-format";
import { records } from "./source-view-utils";

export function RuntimeSourceView({ value }: { value: unknown }) {
  const record = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const clock =
    record.clock && typeof record.clock === "object"
      ? (record.clock as Record<string, unknown>)
      : {};
  const systems = readArray(record.systems);
  return (
    <div className="gamekits-devtools-view">
      <div className="gamekits-devtools-snapshot__summary">
        <Metric label="Running" value={readBoolean(record.running) ? "yes" : "no"} />
        <Metric label="Ticks" value={readNumber(clock.ticks) ?? 0} />
        <Metric label="Modules" value={readArray(record.modules).length} />
        <Metric label="Systems" value={systems.length} />
      </div>
      <ChipList items={readArray(record.modules).map(String)} />
      <table className="gamekits-devtools-table">
        <tbody>
          {systems.slice(0, 14).map((system, index) => (
            <tr key={index}>
              <td>{formatScalar(system)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function UiSourceView({ value }: { value: unknown }) {
  const record = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const focus =
    record.focus && typeof record.focus === "object"
      ? (record.focus as Record<string, unknown>)
      : {};
  const panels = records(record.panels);
  const openPanels = records(record.openPanels);
  return (
    <div className="gamekits-devtools-view">
      <div className="gamekits-devtools-snapshot__summary">
        <Metric label="Panels" value={panels.length} />
        <Metric label="Open" value={openPanels.length} />
        <Metric label="Focus" value={readString(focus.scope, "none")} />
        <Metric label="Diagnostics" value={readArray(record.diagnostics).length} />
      </div>
      <table className="gamekits-devtools-table">
        <thead>
          <tr>
            <th>Panel</th>
            <th>Kind</th>
            <th>State</th>
          </tr>
        </thead>
        <tbody>
          {panels.slice(0, 12).map((panel) => {
            const id = readString(panel.id);
            return (
              <tr key={id}>
                <td>
                  <strong>{id}</strong>
                </td>
                <td>{readString(panel.kind)}</td>
                <td>
                  {openPanels.some((open) => readString(open.id) === id) ? "open" : "registered"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function SaveSourceView({ value }: { value: unknown }) {
  const record = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const lastOperation =
    record.lastOperation && typeof record.lastOperation === "object"
      ? (record.lastOperation as Record<string, unknown>)
      : {};
  const contributors = records(record.contributors);
  return (
    <div className="gamekits-devtools-view">
      <div className="gamekits-devtools-snapshot__summary">
        <Metric label="Format" value={readString(record.formatVersion)} />
        <Metric label="Contributors" value={contributors.length} />
        <Metric label="Last Op" value={readString(lastOperation.type, "none")} />
        <Metric label="Diagnostics" value={readArray(record.diagnostics).length} />
      </div>
      <table className="gamekits-devtools-table">
        <thead>
          <tr>
            <th>Contributor</th>
            <th>Version</th>
            <th>Required</th>
          </tr>
        </thead>
        <tbody>
          {contributors.map((contributor) => (
            <tr key={readString(contributor.id)}>
              <td>
                <strong>{readString(contributor.id)}</strong>
              </td>
              <td>{readString(contributor.version)}</td>
              <td>{readBoolean(contributor.required) ? "yes" : "no"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
