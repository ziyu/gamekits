import { KeyValueGrid } from "../panel-layout";
import { asRecord, formatScalar, RawSnapshotDisclosure } from "../value-format";

export function GenericSourceView({ value }: { value: unknown }) {
  const record = asRecord(value);
  const entries = record
    ? Object.entries(record)
        .slice(0, 6)
        .map(([key, entry]) => [key, formatScalar(entry)] as [string, string])
    : [["Value", formatScalar(value)] as [string, string]];
  return (
    <div className="gamekits-devtools-view">
      <KeyValueGrid entries={entries} />
      <RawSnapshotDisclosure value={value} />
    </div>
  );
}
