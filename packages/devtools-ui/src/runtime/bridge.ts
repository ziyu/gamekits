import type { DevToolsUiSnapshot } from "@gamekits/devtools";
import type { DevToolsUiBridge, DevToolsUiBridgeOptions } from "./types";

const DEFAULT_LAUNCHER_PANEL_ID = "gamekits.devtools.launcher";
const DEFAULT_SHELL_PANEL_ID = "gamekits.devtools.shell";

export function createDevToolsUiBridge(options: DevToolsUiBridgeOptions): DevToolsUiBridge {
  const launcherPanelId = options.launcher?.panelId ?? DEFAULT_LAUNCHER_PANEL_ID;
  const shellPanelId =
    options.shell?.panelId ?? options.launcher?.shellPanelId ?? DEFAULT_SHELL_PANEL_ID;
  const shellTitle = options.shell?.title ?? "GameKits DevTools";
  const launcherLabel = options.launcher?.label ?? "DevTools";
  const pins = options.pins;

  return {
    launcherPanelId,
    shellPanelId,
    openShell(panelId) {
      ensureShellPanel(options, shellPanelId, shellTitle);
      options.ui.open(
        shellPanelId,
        panelId === undefined ? options.shell : { activePanelId: panelId }
      );
    },
    closeShell() {
      options.ui.close(shellPanelId);
    },
    toggleShell() {
      ensureShellPanel(options, shellPanelId, shellTitle);
      options.ui.toggle(shellPanelId);
    },
    focusShell() {
      options.ui.setFocus({
        scope: "devtools",
        target: shellPanelId,
        reason: "devtools.focus"
      });
    },
    snapshot(): DevToolsUiSnapshot {
      const uiSnapshot = options.ui.snapshot();
      const shellPanel = uiSnapshot.openPanels.find((panel) => panel.id === shellPanelId);
      return {
        launcher: {
          enabled: options.launcher?.enabled !== false,
          panelId: launcherPanelId,
          shellPanelId,
          label: launcherLabel,
          position: options.launcher?.position ?? "bottom-right",
          hotkeys: options.launcher?.hotkeys ?? ["F12"]
        },
        shell: {
          enabled: options.shell?.enabled !== false,
          panelId: shellPanelId,
          title: shellTitle,
          open: shellPanel !== undefined,
          activePanelId: readActivePanelId(shellPanel?.props) ?? options.shell?.defaultPanelId,
          refreshIntervalMs: options.shell?.refreshIntervalMs
        },
        pins: {
          enabled: pins?.enabled !== false,
          defaultPinned: pins?.defaultPinned ?? ["devtools.performance"],
          defaultCollapsed: pins?.defaultCollapsed ?? [],
          collapseToTray: pins?.collapseToTray !== false,
          area: pins?.area ?? "floating",
          refreshIntervalMs: pins?.refreshIntervalMs
        }
      };
    }
  };
}

function readActivePanelId(props: unknown): string | undefined {
  if (!props || typeof props !== "object" || !("activePanelId" in props)) {
    return undefined;
  }

  const value = (props as { activePanelId?: unknown }).activePanelId;
  return typeof value === "string" ? value : undefined;
}

function ensureShellPanel(
  options: DevToolsUiBridgeOptions,
  shellPanelId: string,
  shellTitle: string
): void {
  if (options.ui.panel(shellPanelId)) {
    return;
  }

  options.ui.registerPanel({
    id: shellPanelId,
    title: shellTitle,
    kind: "devtools",
    tags: ["gamekits", "devtools", "shell"],
    defaultProps: options.shell
  });
}
