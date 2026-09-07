import { useMemo, useState, useSyncExternalStore } from "react";
import type { DevToolsPinsOptions, DevToolsRuntime } from "@gamekits/devtools";
import type { UiRuntime } from "@gamekits/ui-core";
import { createDevToolsUiBridge } from "../runtime/bridge";
import { DevToolsLauncher } from "./devtools-launcher";
import { DevToolsPinDock } from "./devtools-pin-dock";
import { DevToolsShell } from "./devtools-shell";
import type { DevToolsPanelRenderer, DevToolsPinnedPanelRenderer } from "../panels";

export type DevToolsOverlayProps = {
  runtime: DevToolsRuntime;
  uiRuntime: UiRuntime;
  pins?: DevToolsPinsOptions | undefined;
  renderPanel?: DevToolsPanelRenderer | undefined;
  renderPinnedPanel?: DevToolsPinnedPanelRenderer | undefined;
};

export function DevToolsOverlay({
  pins,
  renderPanel,
  renderPinnedPanel,
  runtime,
  uiRuntime
}: DevToolsOverlayProps) {
  const [activePanelId, setActivePanelId] = useState<string | undefined>();
  const resolvedPins = pins ?? readDefaultPins(uiRuntime);
  const uiSnapshot = useSyncExternalStore(
    uiRuntime.subscribe,
    uiRuntime.snapshot,
    uiRuntime.snapshot
  );
  const shellPanel = useMemo(
    () => uiSnapshot.openPanels.find((panel) => panel.id === "gamekits.devtools.shell"),
    [uiSnapshot.openPanels]
  );
  const bridge = useMemo(
    () => createDevToolsUiBridge({ devtools: runtime, pins: resolvedPins, ui: uiRuntime }),
    [resolvedPins, runtime, uiRuntime]
  );

  const openPanel = (panelId: string) => {
    setActivePanelId(panelId);
    bridge.openShell(panelId);
  };

  return (
    <div className="gamekits-devtools-overlay">
      <DevToolsLauncher runtime={runtime} uiRuntime={uiRuntime} />
      <DevToolsPinDock
        onOpenPanel={openPanel}
        pins={resolvedPins}
        renderPinnedPanel={renderPinnedPanel}
        runtime={runtime}
        uiRuntime={uiRuntime}
      />
      {shellPanel ? (
        <DevToolsShell
          activePanelId={activePanelId ?? readActivePanelId(shellPanel.props)}
          onActivePanelChange={setActivePanelId}
          renderPanel={renderPanel}
          runtime={runtime}
          uiRuntime={uiRuntime}
        />
      ) : null}
    </div>
  );
}

function readDefaultPins(uiRuntime: UiRuntime): DevToolsPinsOptions | undefined {
  const launcher = uiRuntime.panel("gamekits.devtools.launcher");
  const props = launcher?.defaultProps;
  if (!props || typeof props !== "object" || !("pins" in props)) {
    return undefined;
  }

  const value = (props as { pins?: unknown }).pins;
  return value && typeof value === "object" ? (value as DevToolsPinsOptions) : undefined;
}

function readActivePanelId(props: unknown): string | undefined {
  if (!props || typeof props !== "object" || !("activePanelId" in props)) {
    return undefined;
  }

  const value = (props as { activePanelId?: unknown }).activePanelId;
  return typeof value === "string" ? value : undefined;
}
