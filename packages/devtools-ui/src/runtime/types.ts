import type {
  DevToolsLauncherOptions,
  DevToolsPinsOptions,
  DevToolsRuntime,
  DevToolsShellOptions,
  DevToolsUiSnapshot
} from "@gamekits/devtools";
import type { UiRuntime } from "@gamekits/ui-core";

export type DevToolsUiBridgeOptions = {
  devtools: DevToolsRuntime;
  ui: UiRuntime;
  launcher?: DevToolsLauncherOptions | undefined;
  shell?: DevToolsShellOptions | undefined;
  pins?: DevToolsPinsOptions | undefined;
};

export type DevToolsUiBridge = {
  launcherPanelId: string;
  shellPanelId: string;
  openShell(panelId?: string): void;
  closeShell(): void;
  toggleShell(): void;
  focusShell(): void;
  snapshot(): DevToolsUiSnapshot;
};
