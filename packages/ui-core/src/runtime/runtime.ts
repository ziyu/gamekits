import { GameError } from "@gamekits/core";
import type {
  UiCommand,
  UiDiagnosticEvent,
  UiFocusState,
  UiOpenPanel,
  UiPanelDefinition,
  UiPanelId,
  UiRuntime,
  UiRuntimeSnapshot,
  UiRuntimeSubscriber
} from "./types";

export type CreateUiRuntimeOptions = {
  commandHistoryLimit?: number | undefined;
  diagnosticLimit?: number | undefined;
};

export function createUiRuntime(options: CreateUiRuntimeOptions = {}): UiRuntime {
  const panels = new Map<UiPanelId, UiPanelDefinition>();
  const openPanels = new Map<UiPanelId, UiOpenPanel>();
  const commands: UiCommand[] = [];
  const diagnostics: UiDiagnosticEvent[] = [];
  const subscribers = new Set<UiRuntimeSubscriber>();
  const commandHistoryLimit = options.commandHistoryLimit ?? 100;
  const diagnosticLimit = options.diagnosticLimit ?? 100;
  let focus: UiFocusState = { scope: "none" };
  let cachedSnapshot: UiRuntimeSnapshot | undefined;

  const notify = (): void => {
    for (const subscriber of subscribers) {
      subscriber();
    }
  };

  const commit = (): void => {
    cachedSnapshot = undefined;
    notify();
  };

  const pushCommand = (command: UiCommand): void => {
    commands.push(command);
    trim(commands, commandHistoryLimit);
  };

  const requirePanel = (id: UiPanelId): UiPanelDefinition => {
    const panel = panels.get(id);
    if (!panel) {
      throw new GameError("ui.panel_missing", `Missing UI panel: ${id}`, { id });
    }
    return panel;
  };

  return {
    registerPanel(definition) {
      if (panels.has(definition.id)) {
        throw new GameError("ui.duplicate_panel", `Duplicate UI panel: ${definition.id}`, {
          id: definition.id
        });
      }
      panels.set(definition.id, definition as UiPanelDefinition);
      commit();
    },
    unregisterPanel(id) {
      panels.delete(id);
      openPanels.delete(id);
      commit();
    },
    panel<TProps = unknown>(id: UiPanelId) {
      return panels.get(id) as UiPanelDefinition<TProps> | undefined;
    },
    panels() {
      return [...panels.values()];
    },
    open(id, props) {
      const panel = requirePanel(id);
      for (const entry of openPanels.values()) {
        entry.focused = false;
      }
      openPanels.set(id, {
        id,
        title: panel.title,
        kind: panel.kind,
        layer: readLayer(panel),
        props: props ?? panel.defaultProps,
        focused: true
      });
      focus = {
        scope: panel.kind === "modal" ? "modal" : panel.kind === "devtools" ? "devtools" : "ui",
        target: id,
        reason: "ui.open"
      };
      pushCommand({ type: "ui.open", target: id, payload: props, source: "ui-runtime" });
      commit();
    },
    close(id) {
      openPanels.delete(id);
      if (focus.target === id) {
        focus = { scope: "none", reason: "ui.close" };
      }
      pushCommand({ type: "ui.close", target: id, source: "ui-runtime" });
      commit();
    },
    toggle(id, props) {
      if (openPanels.has(id)) {
        this.close(id);
        return;
      }
      this.open(id, props);
    },
    openPanels() {
      return [...openPanels.values()];
    },
    dispatch(command) {
      if (command.type === "ui.open" && command.target) {
        this.open(command.target, command.payload);
        return;
      }
      if (command.type === "ui.close" && command.target) {
        this.close(command.target);
        return;
      }
      if (command.type === "ui.toggle" && command.target) {
        this.toggle(command.target, command.payload);
        return;
      }
      pushCommand(command);
      commit();
    },
    commands() {
      return [...commands];
    },
    focus() {
      return focus;
    },
    setFocus(nextFocus) {
      focus = nextFocus;
      for (const entry of openPanels.values()) {
        entry.focused = entry.id === nextFocus.target;
      }
      commit();
    },
    emitDiagnostic(event) {
      diagnostics.push(event);
      trim(diagnostics, diagnosticLimit);
      commit();
    },
    diagnostics() {
      return [...diagnostics];
    },
    snapshot(): UiRuntimeSnapshot {
      cachedSnapshot ??= {
        panels: [...panels.values()],
        openPanels: [...openPanels.values()].map((panel) => ({ ...panel })),
        focus: { ...focus },
        commands: [...commands],
        diagnostics: [...diagnostics]
      };
      return cachedSnapshot;
    },
    subscribe(subscriber) {
      subscribers.add(subscriber);
      return () => {
        subscribers.delete(subscriber);
      };
    },
    clear() {
      panels.clear();
      openPanels.clear();
      commands.length = 0;
      diagnostics.length = 0;
      focus = { scope: "none" };
      commit();
    }
  };
}

function readLayer(panel: UiPanelDefinition): UiOpenPanel["layer"] {
  const layer = (panel as { layer?: UiOpenPanel["layer"] }).layer;
  if (layer) {
    return layer;
  }
  if (panel.kind === "modal") {
    return "modal";
  }
  if (panel.kind === "overlay") {
    return "overlay";
  }
  if (panel.kind === "hud") {
    return "hud";
  }
  if (panel.kind === "devtools") {
    return "devtools";
  }
  return "panel";
}

function trim<T>(values: T[], limit: number): void {
  if (values.length > limit) {
    values.splice(0, values.length - limit);
  }
}
