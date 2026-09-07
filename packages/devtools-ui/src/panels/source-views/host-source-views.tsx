import { ChipList, KeyValueGrid, Metric } from "../panel-layout";
import { formatScalar, readArray, readString } from "../value-format";
import { recordId, records, StatusPill } from "./source-view-utils";

export function HostSourceView({ value }: { value: unknown }) {
  const record = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const services = records(record.services);
  const config =
    record.config && typeof record.config === "object"
      ? (record.config as Record<string, unknown>)
      : {};
  const diagnostics = readArray(record.diagnostics);

  return (
    <div className="gamekits-devtools-view">
      <div className="gamekits-devtools-snapshot__summary">
        <Metric label="Phase" value={readString(record.phase)} />
        <Metric label="Services" value={services.length} />
        <Metric label="Config" value={readArray(config.entries).length} />
        <Metric label="Diagnostics" value={diagnostics.length} />
      </div>
      <table className="gamekits-devtools-table">
        <thead>
          <tr>
            <th>Service</th>
            <th>Phase</th>
            <th>Deps</th>
            <th>Standard</th>
          </tr>
        </thead>
        <tbody>
          {services.map((service) => (
            <tr key={recordId(service)}>
              <td>
                <strong>{recordId(service)}</strong>
              </td>
              <td>
                <StatusPill value={readString(service.phase)} />
              </td>
              <td>{readArray(service.dependencies).join(", ") || "none"}</td>
              <td>{formatScalar(service.standard)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function PlatformSourceView({ value }: { value: unknown }) {
  const record = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const services = records(record.services).map(recordId);
  const capabilities = records(record.capabilities).map(recordId);
  return (
    <div className="gamekits-devtools-view">
      <KeyValueGrid
        entries={[
          ["Platform", readString(record.id)],
          ["Services", services.length],
          ["Capabilities", capabilities.length]
        ]}
      />
      <ChipList items={services} />
      <ChipList items={capabilities} />
    </div>
  );
}

export function DriverSourceView({ value }: { value: unknown }) {
  const source = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const drivers = records(source.drivers);
  return (
    <div className="gamekits-devtools-view">
      <div className="gamekits-devtools-card-grid">
        {drivers.map((driver) => (
          <article className="gamekits-devtools-mini-card" key={recordId(driver)}>
            <strong>{recordId(driver)}</strong>
            <span>
              {readString(driver.kind)} · {readString(driver.phase)}
            </span>
            <ChipList items={readArray(driver.adapters).map((adapter) => readString(adapter))} />
          </article>
        ))}
      </div>
    </div>
  );
}
