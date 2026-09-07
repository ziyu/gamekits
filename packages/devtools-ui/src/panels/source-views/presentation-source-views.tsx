import { ChipList, KeyValueGrid, Metric } from "../panel-layout";
import { asRecord, readArray, readBoolean, readString } from "../value-format";

export function RendererSourceView({ value }: { value: unknown }) {
  const record = asRecord(value) ?? {};
  const capabilities = asRecord(record.capabilities) ?? {};
  return (
    <div className="gamekits-devtools-view">
      <KeyValueGrid
        entries={[
          ["Renderer", readString(record.id)],
          ["Object tree", readBoolean(capabilities.supportsObjectTree) ? "supported" : "off"],
          ["Node updates", readBoolean(capabilities.supportsNodeUpdates) ? "supported" : "off"],
          ["Native handles", readBoolean(capabilities.supportsNativeHandles) ? "supported" : "off"]
        ]}
      />
      <ChipList items={readArray(capabilities.objectTypes).map(String)} />
      <ChipList items={readArray(capabilities.commandTypes).map(String)} />
    </div>
  );
}

export function InputSourceView({ value }: { value: unknown }) {
  const contexts = readArray(asRecord(value)?.activeContexts).map(String);
  return (
    <div className="gamekits-devtools-view">
      <Metric label="Active Contexts" value={contexts.length} />
      <ChipList items={contexts} />
    </div>
  );
}
