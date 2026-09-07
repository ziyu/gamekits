import { useEffect, useMemo, useState, type ReactNode } from "react";
import type {
  DevToolsPanelDefinition,
  DevToolsPinsOptions,
  DevToolsRuntime,
  DevToolsSnapshot
} from "@gamekits/devtools";
import type { UiRuntime } from "@gamekits/ui-core";
import { renderStandardPinnedDevToolsPanel, type DevToolsPinnedPanelRenderer } from "../panels";

export type DevToolsPinDockProps = {
  runtime: DevToolsRuntime;
  uiRuntime?: UiRuntime | undefined;
  pins?: DevToolsPinsOptions | undefined;
  onOpenPanel?: ((panelId: string) => void) | undefined;
  refreshIntervalMs?: number | undefined;
  renderPinnedPanel?: DevToolsPinnedPanelRenderer | undefined;
};

type PinnedPanelState = {
  collapsed: boolean;
  order: number;
  pinned: boolean;
};

export function DevToolsPinDock({
  runtime,
  uiRuntime,
  pins,
  onOpenPanel,
  refreshIntervalMs,
  renderPinnedPanel = renderStandardPinnedDevToolsPanel
}: DevToolsPinDockProps) {
  const [snapshot, setSnapshot] = useState<DevToolsSnapshot>(() => runtime.snapshot());
  const [stateByPanel, setStateByPanel] = useState<Record<string, PinnedPanelState>>(() =>
    createInitialPinnedPanelState(runtime.snapshot(), pins)
  );
  const enabled = pins?.enabled !== false;
  const intervalMs = refreshIntervalMs ?? pins?.refreshIntervalMs ?? 500;
  const area = pins?.area ?? "floating";

  useEffect(() => {
    const update = () => {
      setSnapshot(runtime.snapshot());
    };
    update();
    const interval = window.setInterval(update, intervalMs);
    return () => {
      window.clearInterval(interval);
    };
  }, [intervalMs, runtime]);

  useEffect(() => {
    setStateByPanel((current) => mergePinnedPanelState(current, snapshot, pins));
  }, [pins, snapshot]);

  const pinnedPanels = useMemo(() => {
    return snapshot.panels
      .filter((panel) => stateByPanel[panel.id]?.pinned)
      .sort(
        (left, right) =>
          (stateByPanel[left.id]?.order ?? left.pin?.order ?? left.order ?? 0) -
          (stateByPanel[right.id]?.order ?? right.pin?.order ?? right.order ?? 0)
      );
  }, [snapshot.panels, stateByPanel]);

  if (!enabled || pinnedPanels.length === 0) {
    return null;
  }

  const focusDevTools = () => {
    uiRuntime?.setFocus({ scope: "devtools", reason: "devtools.pin_focus" });
  };

  const toggleCollapsed = (panelId: string) => {
    focusDevTools();
    setStateByPanel((current) => ({
      ...current,
      [panelId]: {
        ...requirePinnedPanelState(current, panelId),
        collapsed: !current[panelId]?.collapsed
      }
    }));
  };

  const openPanel = (panelId: string) => {
    focusDevTools();
    onOpenPanel?.(panelId);
  };

  return (
    <aside
      className={`gamekits-devtools-pin-dock gamekits-devtools-pin-dock--${area}`}
      data-devtools-pin-dock={area}
      onPointerDown={focusDevTools}
    >
      {pinnedPanels.map((panel) => {
        const panelState = requirePinnedPanelState(stateByPanel, panel.id);
        return (
          <PinnedPanel
            collapsed={panelState.collapsed}
            key={panel.id}
            onOpen={() => openPanel(panel.id)}
            onToggle={() => toggleCollapsed(panel.id)}
            panel={panel}
          >
            {renderPinnedPanel({ collapsed: panelState.collapsed, panel, snapshot })}
          </PinnedPanel>
        );
      })}
    </aside>
  );
}

function PinnedPanel({
  children,
  collapsed,
  onOpen,
  onToggle,
  panel
}: {
  children: ReactNode;
  collapsed: boolean;
  onOpen(): void;
  onToggle(): void;
  panel: DevToolsPanelDefinition;
}) {
  const label = panel.pin?.label ?? panel.label;

  if (collapsed) {
    return (
      <section
        className="gamekits-devtools-pinned-panel gamekits-devtools-pinned-panel--collapsed"
        data-devtools-pinned-panel={panel.id}
        onClick={onToggle}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onToggle();
          }
        }}
        role="button"
        tabIndex={0}
        title={`Expand ${label}`}
      >
        <div className="gamekits-devtools-pinned-panel__body">{children}</div>
      </section>
    );
  }

  return (
    <section className="gamekits-devtools-pinned-panel" data-devtools-pinned-panel={panel.id}>
      <header className="gamekits-devtools-pinned-panel__header">
        <button
          aria-label={`Collapse ${label}`}
          onClick={onToggle}
          title={`Collapse ${label}`}
          type="button"
        >
          -
        </button>
        <button aria-label={`Open ${label}`} onClick={onOpen} title={`Open ${label}`} type="button">
          &gt;
        </button>
      </header>
      <div className="gamekits-devtools-pinned-panel__body">{children}</div>
    </section>
  );
}

function createInitialPinnedPanelState(
  snapshot: DevToolsSnapshot,
  pins: DevToolsPinsOptions | undefined
): Record<string, PinnedPanelState> {
  return mergePinnedPanelState({}, snapshot, pins);
}

function mergePinnedPanelState(
  current: Record<string, PinnedPanelState>,
  snapshot: DevToolsSnapshot,
  pins: DevToolsPinsOptions | undefined
): Record<string, PinnedPanelState> {
  const next = { ...current };
  const defaultPinned = new Set(pins?.defaultPinned ?? ["devtools.performance"]);
  const defaultCollapsed = new Set(pins?.defaultCollapsed ?? []);

  for (const panel of snapshot.panels) {
    if (panel.pin?.enabled === false) {
      continue;
    }
    if (!panel.pin && !defaultPinned.has(panel.id)) {
      continue;
    }
    if (next[panel.id]) {
      continue;
    }

    const pinned = panel.pin?.defaultPinned === true || defaultPinned.has(panel.id);
    next[panel.id] = {
      collapsed: panel.pin?.defaultCollapsed === true || defaultCollapsed.has(panel.id),
      order: panel.pin?.order ?? panel.order ?? 0,
      pinned
    };
  }

  return next;
}

function requirePinnedPanelState(
  stateByPanel: Record<string, PinnedPanelState>,
  panelId: string
): PinnedPanelState {
  return (
    stateByPanel[panelId] ?? {
      collapsed: false,
      order: 0,
      pinned: true
    }
  );
}
