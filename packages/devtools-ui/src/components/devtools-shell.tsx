import { useEffect, useMemo, useState, type CSSProperties, type PointerEvent } from "react";
import type {
  DevToolsPanelDefinition,
  DevToolsRuntime,
  DevToolsSnapshot
} from "@gamekits/devtools";
import type { UiRuntime } from "@gamekits/ui-core";
import { createDevToolsUiBridge } from "../runtime";
import { renderStandardDevToolsPanel, type DevToolsPanelRenderer } from "../panels";

export type DevToolsShellProps = {
  runtime: DevToolsRuntime;
  uiRuntime?: UiRuntime | undefined;
  shellPanelId?: string | undefined;
  title?: string | undefined;
  refreshIntervalMs?: number | undefined;
  activePanelId?: string | undefined;
  defaultPanelId?: string | undefined;
  onActivePanelChange?: ((panelId: string) => void) | undefined;
  renderPanel?: DevToolsPanelRenderer | undefined;
};

type ShellSize = {
  width: number;
  height: number;
};

type ResizeEdge = "left" | "top" | "top-left";

const DEFAULT_SHELL_SIZE: ShellSize = { width: 980, height: 640 };
const MIN_SHELL_SIZE: ShellSize = { width: 560, height: 360 };

export function DevToolsShell({
  runtime,
  uiRuntime,
  shellPanelId = "gamekits.devtools.shell",
  title = "GameKits DevTools",
  refreshIntervalMs = 250,
  activePanelId,
  defaultPanelId,
  onActivePanelChange,
  renderPanel = renderStandardDevToolsPanel
}: DevToolsShellProps) {
  const [snapshot, setSnapshot] = useState<DevToolsSnapshot>(() =>
    runtime.snapshot({ includeSourceSnapshots: true })
  );
  const [shellSize, setShellSize] = useState<ShellSize>(DEFAULT_SHELL_SIZE);
  const [internalActivePanelId, setInternalActivePanelId] = useState<string | undefined>(
    () => defaultPanelId ?? snapshot.panels[0]?.id
  );
  const resolvedActivePanelId = activePanelId ?? internalActivePanelId;
  const activePanel = useMemo(
    () => readActivePanel(snapshot.panels, resolvedActivePanelId),
    [resolvedActivePanelId, snapshot.panels]
  );

  const setActivePanel = (panelId: string) => {
    setInternalActivePanelId(panelId);
    onActivePanelChange?.(panelId);
  };

  useEffect(() => {
    const update = () => {
      setSnapshot(runtime.snapshot({ includeSourceSnapshots: true }));
    };
    update();
    const interval = window.setInterval(update, refreshIntervalMs);
    return () => {
      window.clearInterval(interval);
    };
  }, [refreshIntervalMs, runtime]);

  const close = () => {
    if (!uiRuntime) {
      return;
    }
    createDevToolsUiBridge({
      devtools: runtime,
      ui: uiRuntime,
      shell: { panelId: shellPanelId, title }
    }).closeShell();
  };

  const focusDevTools = () => {
    if (!uiRuntime) {
      return;
    }
    createDevToolsUiBridge({
      devtools: runtime,
      ui: uiRuntime,
      shell: { panelId: shellPanelId, title }
    }).focusShell();
  };

  const startResize = (edge: ResizeEdge, event: PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    focusDevTools();

    const startX = event.clientX;
    const startY = event.clientY;
    const startSize = shellSize;

    const onPointerMove = (moveEvent: globalThis.PointerEvent) => {
      setShellSize(
        clampShellSize({
          width: edge.includes("left")
            ? startSize.width + startX - moveEvent.clientX
            : startSize.width,
          height: edge.includes("top")
            ? startSize.height + startY - moveEvent.clientY
            : startSize.height
        })
      );
    };

    const onPointerUp = () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
    };

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp, { once: true });
  };

  return (
    <section
      className="gamekits-devtools-shell"
      data-devtools-shell={shellPanelId}
      onPointerDown={focusDevTools}
      style={
        {
          "--gamekits-devtools-shell-width": `${shellSize.width}px`,
          "--gamekits-devtools-shell-height": `${shellSize.height}px`
        } as CSSProperties
      }
    >
      <ResizeHandle edge="left" onResizeStart={startResize} />
      <ResizeHandle edge="top" onResizeStart={startResize} />
      <ResizeHandle edge="top-left" onResizeStart={startResize} />
      <header className="gamekits-devtools-shell__header">
        <div>
          <strong>{title}</strong>
          <span>{snapshot.dataSources.length} sources</span>
        </div>
        {uiRuntime ? (
          <button type="button" onClick={close}>
            Close
          </button>
        ) : null}
      </header>
      <nav className="gamekits-devtools-shell__tabs" aria-label="DevTools panels">
        {snapshot.panels.map((panel) => (
          <button
            key={panel.id}
            type="button"
            className={panel.id === activePanel?.id ? "is-active" : ""}
            onClick={() => setActivePanel(panel.id)}
          >
            {panel.label}
          </button>
        ))}
      </nav>
      <div className="gamekits-devtools-shell__body">
        {activePanel ? renderPanel({ snapshot, panel: activePanel }) : <EmptyPanel />}
      </div>
    </section>
  );
}

function ResizeHandle({
  edge,
  onResizeStart
}: {
  edge: ResizeEdge;
  onResizeStart(edge: ResizeEdge, event: PointerEvent<HTMLDivElement>): void;
}) {
  return (
    <div
      aria-label={`Resize DevTools ${edge}`}
      className={`gamekits-devtools-shell__resize gamekits-devtools-shell__resize--${edge}`}
      onPointerDown={(event) => onResizeStart(edge, event)}
      role="separator"
    />
  );
}

function readActivePanel(
  panels: DevToolsPanelDefinition[],
  activePanelId: string | undefined
): DevToolsPanelDefinition | undefined {
  return panels.find((panel) => panel.id === activePanelId) ?? panels[0];
}

function EmptyPanel() {
  return <p className="gamekits-devtools-empty">No DevTools panels registered.</p>;
}

function clampShellSize(size: ShellSize): ShellSize {
  const maxWidth =
    typeof window === "undefined"
      ? DEFAULT_SHELL_SIZE.width
      : Math.max(320, window.innerWidth - 32);
  const maxHeight =
    typeof window === "undefined"
      ? DEFAULT_SHELL_SIZE.height
      : Math.max(260, window.innerHeight - 96);

  return {
    width: Math.min(maxWidth, Math.max(MIN_SHELL_SIZE.width, size.width)),
    height: Math.min(maxHeight, Math.max(MIN_SHELL_SIZE.height, size.height))
  };
}
