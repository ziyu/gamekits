import type { DevToolsSourceSnapshot } from "@gamekits/devtools";
import { EmptyState } from "./panel-layout";
import { AssetSourceView, DataSourceView } from "./source-views/content-source-views";
import { GenericSourceView } from "./source-views/generic-source-view";
import {
  DriverSourceView,
  HostSourceView,
  PlatformSourceView
} from "./source-views/host-source-views";
import { RendererSourceView, InputSourceView } from "./source-views/presentation-source-views";
import {
  RuntimeSourceView,
  SaveSourceView,
  UiSourceView
} from "./source-views/runtime-source-views";

export function SourceSnapshotList({ sources }: { sources: DevToolsSourceSnapshot[] }) {
  if (sources.length === 0) {
    return (
      <EmptyState
        detail="Boot the related service or register a custom DevTools source."
        title="No matching sources"
      />
    );
  }

  return (
    <div className="gamekits-devtools-source-list">
      {sources.map((source) => (
        <SourceCard key={source.id} source={source} />
      ))}
    </div>
  );
}

function SourceCard({ source }: { source: DevToolsSourceSnapshot }) {
  return (
    <article className="gamekits-devtools-source">
      <header>
        <div>
          <span>{source.kind}</span>
          <strong>{source.label}</strong>
        </div>
        <code>{source.id}</code>
      </header>
      {source.error ? (
        <div className="gamekits-devtools-error">
          <strong>{source.error.code}</strong>
          <p>{source.error.message}</p>
        </div>
      ) : (
        <SourceView source={source} />
      )}
    </article>
  );
}

function SourceView({ source }: { source: DevToolsSourceSnapshot }) {
  switch (source.kind) {
    case "host":
      return <HostSourceView value={source.snapshot} />;
    case "platform":
      return <PlatformSourceView value={source.snapshot} />;
    case "driver":
      return <DriverSourceView value={source.snapshot} />;
    case "data":
      return <DataSourceView value={source.snapshot} />;
    case "asset":
      return <AssetSourceView value={source.snapshot} />;
    case "renderer":
      return <RendererSourceView value={source.snapshot} />;
    case "input":
      return <InputSourceView value={source.snapshot} />;
    case "runtime":
      return <RuntimeSourceView value={source.snapshot} />;
    case "ui":
      return <UiSourceView value={source.snapshot} />;
    case "save":
      return <SaveSourceView value={source.snapshot} />;
    default:
      return <GenericSourceView value={source.snapshot} />;
  }
}
