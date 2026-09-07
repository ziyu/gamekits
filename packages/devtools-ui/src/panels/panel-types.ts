import type {
  DevToolsDataSourceKind,
  DevToolsPanelDefinition,
  DevToolsSnapshot,
  DevToolsSourceSnapshot,
  DevToolsTraceEntry
} from "@gamekits/devtools";
import type { ReactNode } from "react";

export type DevToolsPanelRendererProps = {
  snapshot: DevToolsSnapshot;
  panel: DevToolsPanelDefinition;
};

export type DevToolsPanelRenderer = (props: DevToolsPanelRendererProps) => ReactNode;

export type PanelModel = {
  panel: DevToolsPanelDefinition;
  sourceKinds: Set<DevToolsDataSourceKind>;
  sources: DevToolsSourceSnapshot[];
  traces: DevToolsTraceEntry[];
  diagnostics: DevToolsSnapshot["diagnostics"];
};
