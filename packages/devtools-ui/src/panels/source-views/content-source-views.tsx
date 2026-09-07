import { ChipList, Metric } from "../panel-layout";
import { formatScalar, readArray, readString } from "../value-format";
import { countBy, records, StatusPill } from "./source-view-utils";

export function DataSourceView({ value }: { value: unknown }) {
  const record = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const documents = records(record.documents);
  const typeCounts = countBy(documents, (document) => readString(document.type));

  return (
    <div className="gamekits-devtools-view">
      <div className="gamekits-devtools-snapshot__summary">
        <Metric label="Types" value={readArray(record.types).length} />
        <Metric label="Packs" value={readArray(record.packs).length} />
        <Metric label="Documents" value={documents.length} />
        <Metric label="References" value={readArray(record.references).length} />
      </div>
      <table className="gamekits-devtools-table">
        <thead>
          <tr>
            <th>Type</th>
            <th>Documents</th>
          </tr>
        </thead>
        <tbody>
          {Object.entries(typeCounts)
            .sort(([left], [right]) => left.localeCompare(right))
            .slice(0, 12)
            .map(([type, count]) => (
              <tr key={type}>
                <td>
                  <code>{type}</code>
                </td>
                <td>{count}</td>
              </tr>
            ))}
        </tbody>
      </table>
      <ChipList items={readArray(record.packs).map(String)} />
    </div>
  );
}

export function AssetSourceView({ value }: { value: unknown }) {
  const record = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const assets = records(record.assets);
  const states = records(record.states);
  const stateById = new Map(states.map((state) => [readString(state.id), state]));
  const statusCounts = countBy(states, (state) => readString(state.status));

  return (
    <div className="gamekits-devtools-view">
      <div className="gamekits-devtools-snapshot__summary">
        <Metric label="Assets" value={assets.length} />
        <Metric label="Loaded" value={statusCounts.loaded ?? 0} />
        <Metric label="Loading" value={statusCounts.loading ?? 0} />
        <Metric label="Failed" value={statusCounts.failed ?? 0} />
      </div>
      <table className="gamekits-devtools-table">
        <thead>
          <tr>
            <th>Asset</th>
            <th>Type</th>
            <th>Group</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {assets.slice(0, 12).map((asset) => {
            const id = readString(asset.id);
            const state = stateById.get(id);
            return (
              <tr key={id}>
                <td>
                  <strong>{id}</strong>
                </td>
                <td>{readString(asset.type)}</td>
                <td>{formatScalar(asset.group)}</td>
                <td>
                  <StatusPill value={readString(state?.status, "registered")} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
