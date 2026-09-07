import { useEffect } from "react";
import type { UiOpenPanel } from "@gamekits/ui-core";
import { UiRuntimeProvider, useUiRuntime, useUiSnapshot } from "./provider";
import { GameKitsStyleProvider } from "./style-provider";
import type { FocusBridgeProps, GameKitsUiShellProps, UiHostProps, UiTipProps } from "./types";

export function GameKitsUiShell({
  runtime,
  children,
  className,
  density,
  motion,
  style,
  theme
}: GameKitsUiShellProps) {
  return (
    <UiRuntimeProvider runtime={runtime}>
      <GameKitsStyleProvider
        className={className}
        density={density}
        motion={motion}
        style={style}
        theme={theme}
      >
        {children}
      </GameKitsStyleProvider>
    </UiRuntimeProvider>
  );
}

export function UiPanelHost({ renderPanel, className }: UiHostProps) {
  const snapshot = useUiSnapshot();
  const panels = snapshot.openPanels.filter((panel) => panel.kind === "panel");
  return <UiHost className={className} panels={panels} renderPanel={renderPanel} />;
}

export function UiWindowHost({ renderPanel, className }: UiHostProps) {
  const snapshot = useUiSnapshot();
  const panels = snapshot.openPanels.filter(
    (panel) => panel.kind === "window" || panel.kind === "devtools"
  );
  return <UiHost className={className} panels={panels} renderPanel={renderPanel} />;
}

export function UiModalHost({ renderPanel, className }: UiHostProps) {
  const snapshot = useUiSnapshot();
  const panels = snapshot.openPanels.filter((panel) => panel.kind === "modal");
  return <UiHost className={className} panels={panels} renderPanel={renderPanel} />;
}

export function UiTip({ children, className, content, side = "top" }: UiTipProps) {
  return (
    <span className={`gamekits-ui-tip${className ? ` ${className}` : ""}`} data-tip-side={side}>
      <span className="gamekits-ui-tip__anchor">{children}</span>
      <span className="gamekits-ui-tip__bubble" role="tooltip">
        {content}
      </span>
    </span>
  );
}

export function UiFocusBridge({ runtime, gameViewportRef, uiRootRef }: FocusBridgeProps) {
  useEffect(() => {
    const gameViewport = gameViewportRef?.current;
    const uiRoot = uiRootRef?.current;
    const cleanups: Array<() => void> = [];

    if (gameViewport) {
      const focusGame = () => {
        runtime.setFocus({ scope: "game", target: "viewport", reason: "focus.game" });
      };
      gameViewport.addEventListener("focusin", focusGame);
      gameViewport.addEventListener("pointerdown", focusGame);
      cleanups.push(() => {
        gameViewport.removeEventListener("focusin", focusGame);
        gameViewport.removeEventListener("pointerdown", focusGame);
      });
    }

    if (uiRoot) {
      const focusUi = (event: Event) => {
        const target = event.target;
        const scope =
          target instanceof HTMLInputElement ||
          target instanceof HTMLTextAreaElement ||
          target instanceof HTMLSelectElement ||
          (target instanceof HTMLElement && target.isContentEditable)
            ? "text-input"
            : "ui";
        runtime.setFocus({ scope, target: readTargetId(target), reason: "focus.ui" });
      };
      uiRoot.addEventListener("focusin", focusUi);
      uiRoot.addEventListener("pointerdown", focusUi);
      cleanups.push(() => {
        uiRoot.removeEventListener("focusin", focusUi);
        uiRoot.removeEventListener("pointerdown", focusUi);
      });
    }

    return () => {
      for (const cleanup of cleanups) {
        cleanup();
      }
    };
  }, [gameViewportRef, runtime, uiRootRef]);

  return null;
}

function UiHost({ panels, renderPanel, className }: UiHostProps & { panels: UiOpenPanel[] }) {
  const runtime = useUiRuntime();
  return (
    <div className={className}>
      {panels.map((panel) => (
        <section
          key={panel.id}
          className={`gamekits-ui-panel gamekits-ui-panel--${panel.kind}${panel.focused ? " is-focused" : ""}`}
          data-ui-panel={panel.id}
        >
          <header className="gamekits-ui-panel__header">
            <strong>{panel.title}</strong>
            <button
              type="button"
              aria-label={`Close ${panel.title}`}
              onClick={() => runtime.close(panel.id)}
            >
              ×
            </button>
          </header>
          <div className="gamekits-ui-panel__body">{renderPanel?.(panel) ?? null}</div>
        </section>
      ))}
    </div>
  );
}

function readTargetId(target: EventTarget | null): string | undefined {
  if (!(target instanceof HTMLElement)) {
    return undefined;
  }
  return target.dataset.uiPanel ?? (target.id || target.getAttribute("aria-label") || undefined);
}
