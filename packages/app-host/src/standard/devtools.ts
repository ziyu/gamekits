import type {
  DevToolsDataSource,
  DevToolsLauncherOptions,
  DevToolsPanelDefinition,
  DevToolsPinsOptions,
  DevToolsRuntime,
  DevToolsShellOptions,
  DevToolsUiOptions
} from "@gamekits/devtools";
import type { GameRuntimeProfiler } from "@gamekits/game-runtime";
import type { AppHostContext } from "../runtime/types";
import type {
  StandardDevToolsOptions,
  StandardDevToolsProfileOptions,
  StandardDevToolsSourceId,
  StandardServiceBuildContext
} from "./types";

export const STANDARD_DEVTOOLS_LAUNCHER_PANEL_ID = "gamekits.devtools.launcher";
export const STANDARD_DEVTOOLS_SHELL_PANEL_ID = "gamekits.devtools.shell";

export type NormalizedStandardDevToolsOptions<TContext> = StandardDevToolsOptions<TContext>;

const STANDARD_DEVTOOLS_SOURCES: StandardDevToolsSourceId[] = [
  "host",
  "platform",
  "drivers",
  "data",
  "assets",
  "audio",
  "renderer",
  "input",
  "multiplayer",
  "game",
  "combat",
  "navigation",
  "ai",
  "animator",
  "ui",
  "save"
];

const MINIMAL_DEVTOOLS_SOURCES: StandardDevToolsSourceId[] = ["host", "data", "assets", "game"];

export function normalizeStandardDevToolsOptions<TContext>(
  options: StandardDevToolsProfileOptions<TContext> | undefined
): NormalizedStandardDevToolsOptions<TContext> | undefined {
  if (options === undefined || options === false) {
    return undefined;
  }

  if (options === true) {
    return {};
  }

  if (options.enabled === false) {
    return undefined;
  }

  return options;
}

export function createStandardDevToolsDataSources<TContext>(
  ctx: StandardServiceBuildContext<TContext>,
  hostCtx: AppHostContext,
  options: StandardDevToolsOptions<TContext>
): DevToolsDataSource[] {
  if (options.standardSources === false) {
    return [];
  }

  const sourceIds = selectSourceIds(options);
  const sources: DevToolsDataSource[] = [];

  if (sourceIds.has("host") && options.includeHostSource !== false) {
    sources.push({
      id: "host",
      label: "App Host",
      kind: "host",
      snapshot() {
        return hostCtx.host.snapshot();
      }
    });
  }

  if (sourceIds.has("platform") && ctx.state.platform) {
    const platform = ctx.state.platform;
    sources.push({
      id: "platform",
      label: "Platform",
      kind: "platform",
      snapshot() {
        return {
          id: platform.id,
          services: platform.services.list(),
          capabilities: platform.capabilities.list()
        };
      }
    });
  }

  if (sourceIds.has("drivers") && ctx.state.drivers) {
    const drivers = ctx.state.drivers;
    sources.push({
      id: "drivers",
      label: "Drivers",
      kind: "driver",
      snapshot() {
        return drivers.snapshot();
      }
    });
  }

  if (sourceIds.has("data") && ctx.state.data) {
    const data = ctx.state.data;
    sources.push({
      id: "data",
      label: "Data Registry",
      kind: "data",
      snapshot() {
        return data.snapshot();
      }
    });
  }

  if (sourceIds.has("assets") && ctx.state.assets) {
    const assets = ctx.state.assets;
    sources.push({
      id: "assets",
      label: "Assets",
      kind: "asset",
      snapshot() {
        return {
          assets: assets.assets(),
          states: assets.states()
        };
      }
    });
  }

  if (sourceIds.has("audio") && ctx.state.audio) {
    const audio = ctx.state.audio;
    sources.push({
      id: "audio",
      label: "Audio",
      kind: "audio",
      snapshot() {
        return audio.snapshot();
      }
    });
  }

  if (sourceIds.has("renderer") && ctx.state.renderer) {
    const renderer = ctx.state.renderer;
    sources.push({
      id: "renderer",
      label: "Renderer",
      kind: "renderer",
      snapshot() {
        return {
          id: renderer.id,
          kind: renderer.kind,
          nativeHandles: renderer.getObjectHandle !== undefined
        };
      }
    });
  }

  if (sourceIds.has("input") && ctx.state.input) {
    const input = ctx.state.input;
    sources.push({
      id: "input",
      label: "Input",
      kind: "input",
      snapshot() {
        return {
          activeContexts: input.activeContexts()
        };
      }
    });
  }

  if (sourceIds.has("game") && ctx.state.game) {
    const game = ctx.state.game;
    sources.push({
      id: "game",
      label: "Game Runtime",
      kind: "runtime",
      snapshot() {
        return {
          running: game.isRunning(),
          clock: game.clock.snapshot(),
          modules: game.modules.map((module) => module.id),
          systems: game.systems.values().map((system) => system.id)
        };
      }
    });
  }

  if (sourceIds.has("combat") && ctx.state.combat) {
    const combat = ctx.state.combat;
    sources.push(createGameModuleHandleSource("combat", "Combat", "combat", combat));
  }

  if (sourceIds.has("navigation") && ctx.state.navigation) {
    const navigation = ctx.state.navigation;
    sources.push(
      createGameModuleHandleSource("navigation", "Navigation", "navigation", navigation)
    );
  }

  if (sourceIds.has("ai") && ctx.state.ai) {
    const ai = ctx.state.ai;
    sources.push(createGameModuleHandleSource("ai", "AI", "ai", ai));
  }

  if (sourceIds.has("animator") && ctx.state.animator) {
    const animator = ctx.state.animator;
    sources.push(createGameModuleHandleSource("animator", "Animator", "animator", animator));
  }

  if (sourceIds.has("multiplayer") && ctx.state.multiplayer) {
    const multiplayer = ctx.state.multiplayer;
    sources.push({
      id: "multiplayer",
      label: "Multiplayer",
      kind: "multiplayer",
      snapshot() {
        return multiplayer.snapshot();
      }
    });
  }

  if (sourceIds.has("ui") && ctx.state.ui) {
    const ui = ctx.state.ui;
    sources.push({
      id: "ui",
      label: "UI Runtime",
      kind: "ui",
      snapshot() {
        return ui.snapshot();
      }
    });
  }

  if (sourceIds.has("save") && ctx.state.save) {
    const save = ctx.state.save;
    sources.push({
      id: "save",
      label: "Save Manager",
      kind: "save",
      snapshot() {
        return save.snapshot();
      }
    });
  }

  return sources;
}

export function createStandardDevToolsPanels<TContext>(
  options: StandardDevToolsOptions<TContext>
): DevToolsPanelDefinition[] {
  if (options.standardPanels === false) {
    return [];
  }

  return [
    {
      id: "devtools.host",
      label: "Host Services",
      area: "dock",
      order: 1,
      sourceKinds: ["host", "platform", "driver"]
    },
    {
      id: "devtools.runtime",
      label: "Runtime Flow",
      area: "dock",
      order: 2,
      sourceKinds: ["runtime", "event-bus", "tca", "gas", "combat", "navigation", "ai"]
    },
    {
      id: "devtools.multiplayer",
      label: "Multiplayer",
      area: "dock",
      order: 3,
      sourceKinds: ["multiplayer"]
    },
    {
      id: "devtools.content",
      label: "Content",
      area: "dock",
      order: 4,
      sourceKinds: ["data", "asset"]
    },
    {
      id: "devtools.presentation",
      label: "Presentation",
      area: "dock",
      order: 5,
      sourceKinds: ["renderer", "input", "camera", "animator", "audio", "ui"]
    },
    {
      id: "devtools.performance",
      label: "Performance",
      area: "dock",
      order: 6,
      sourceKinds: [
        "host",
        "runtime",
        "combat",
        "navigation",
        "ai",
        "animator",
        "audio",
        "renderer",
        "asset",
        "ui"
      ],
      pin: {
        enabled: true,
        defaultPinned: true,
        defaultCollapsed: false,
        icon: "perf",
        label: "Performance",
        order: 1,
        area: "floating",
        refreshIntervalMs: 500
      }
    },
    {
      id: "devtools.save",
      label: "Save",
      area: "dock",
      order: 7,
      sourceKinds: ["save"]
    }
  ];
}

function createGameModuleHandleSource(
  id: string,
  label: string,
  kind: "combat" | "navigation" | "ai" | "animator",
  handle: { isBound(): boolean; snapshot(): unknown }
): DevToolsDataSource {
  return {
    id,
    label,
    kind,
    snapshot() {
      return handle.isBound() ? handle.snapshot() : { bound: false };
    }
  };
}

export function createStandardGameRuntimeProfiler(
  runtime: Pick<
    DevToolsRuntime,
    "startProfilerFrame" | "endProfilerFrame" | "beginProfilerSpan" | "endProfilerSpan"
  >
): GameRuntimeProfiler {
  return {
    startFrame(input) {
      return runtime.startProfilerFrame({
        tick: input.tick,
        deltaMs: input.deltaMs,
        timestamp: input.timestamp,
        source: "game-runtime"
      });
    },
    endFrame(handle) {
      runtime.endProfilerFrame(handle);
    },
    beginSystem(input) {
      return runtime.beginProfilerSpan({
        name: input.systemId,
        category: "system",
        source: input.moduleId ?? "game-runtime",
        frameId: input.frameId,
        startedAt: input.startedAt,
        metadata: {
          systemId: input.systemId,
          ...(input.moduleId === undefined ? {} : { moduleId: input.moduleId }),
          tick: input.tick
        }
      });
    },
    endSystem(handle, input) {
      runtime.endProfilerSpan(handle, {
        durationMs: input.durationMs,
        ...(input.error === undefined
          ? {}
          : {
              tags: ["error"],
              metadata: {
                error: input.error instanceof Error ? input.error.message : String(input.error)
              }
            })
      });
    }
  };
}

export function registerStandardDevToolsUiPanels<TContext>(
  ctx: StandardServiceBuildContext<TContext>,
  options: StandardDevToolsOptions<TContext>
): Array<() => void> {
  const ui = ctx.state.ui;
  const uiOptions = normalizeDevToolsUiOptions(options.ui);
  if (!ui || !uiOptions) {
    return [];
  }

  const cleanups: Array<() => void> = [];
  const shell = normalizeShellOptions(uiOptions);
  const launcher = normalizeLauncherOptions(uiOptions, shell);
  const pins = normalizePinsOptions(uiOptions);

  if (launcher.enabled && !ui.panel(launcher.panelId)) {
    ui.registerPanel({
      id: launcher.panelId,
      title: launcher.label,
      kind: "overlay",
      tags: ["gamekits", "devtools", "launcher"],
      defaultProps: { launcher, pins }
    });
    cleanups.push(() => ui.unregisterPanel(launcher.panelId));
  }

  if (shell.enabled && !ui.panel(shell.panelId)) {
    ui.registerPanel({
      id: shell.panelId,
      title: shell.title,
      kind: "devtools",
      tags: ["gamekits", "devtools", "shell"],
      defaultProps: { shell, pins }
    });
    cleanups.push(() => ui.unregisterPanel(shell.panelId));
  }

  if (shell.enabled && shell.defaultOpen) {
    ui.open(shell.panelId, shell);
  }

  return cleanups;
}

function normalizePinsOptions(options: DevToolsUiOptions): RequiredDevToolsPinsOptions {
  const pins = options.pins;
  if (pins === false) {
    return {
      enabled: false,
      defaultPinned: [],
      defaultCollapsed: [],
      collapseToTray: true,
      area: "floating"
    };
  }

  const pinOptions: DevToolsPinsOptions = pins === true || pins === undefined ? {} : pins;
  return {
    enabled: pinOptions.enabled !== false,
    defaultPinned: pinOptions.defaultPinned ?? ["devtools.performance"],
    defaultCollapsed: pinOptions.defaultCollapsed ?? [],
    collapseToTray: pinOptions.collapseToTray !== false,
    area: pinOptions.area ?? "floating",
    ...(pinOptions.refreshIntervalMs === undefined
      ? {}
      : { refreshIntervalMs: pinOptions.refreshIntervalMs })
  };
}

function selectSourceIds<TContext>(
  options: StandardDevToolsOptions<TContext>
): Set<StandardDevToolsSourceId> {
  const preset = options.preset ?? "standard";
  const base = preset === "minimal" ? MINIMAL_DEVTOOLS_SOURCES : STANDARD_DEVTOOLS_SOURCES;
  const include = options.includeSources ?? base;
  const exclude = new Set(options.excludeSources ?? []);
  return new Set(include.filter((sourceId) => !exclude.has(sourceId)));
}

function normalizeDevToolsUiOptions(
  options: boolean | DevToolsUiOptions | undefined
): DevToolsUiOptions | undefined {
  if (options === false) {
    return undefined;
  }

  if (options === undefined || options === true) {
    return {};
  }

  if (options.enabled === false) {
    return undefined;
  }

  return options;
}

function normalizeShellOptions(options: DevToolsUiOptions): RequiredDevToolsShellOptions {
  const shell = options.shell;
  if (shell === false) {
    return {
      enabled: false,
      panelId: STANDARD_DEVTOOLS_SHELL_PANEL_ID,
      title: "GameKits DevTools",
      defaultOpen: false
    };
  }

  const shellOptions: DevToolsShellOptions = shell === true || shell === undefined ? {} : shell;
  return {
    enabled: shellOptions.enabled !== false,
    panelId: shellOptions.panelId ?? STANDARD_DEVTOOLS_SHELL_PANEL_ID,
    title: shellOptions.title ?? "GameKits DevTools",
    defaultOpen: shellOptions.defaultOpen === true,
    ...(shellOptions.defaultPanelId === undefined
      ? {}
      : { defaultPanelId: shellOptions.defaultPanelId }),
    ...(shellOptions.refreshIntervalMs === undefined
      ? {}
      : { refreshIntervalMs: shellOptions.refreshIntervalMs })
  };
}

function normalizeLauncherOptions(
  options: DevToolsUiOptions,
  shell: RequiredDevToolsShellOptions
): RequiredDevToolsLauncherOptions {
  const launcher = options.launcher;
  if (launcher === false) {
    return {
      enabled: false,
      panelId: STANDARD_DEVTOOLS_LAUNCHER_PANEL_ID,
      shellPanelId: shell.panelId,
      label: "DevTools",
      position: "bottom-right",
      hotkeys: []
    };
  }

  const launcherOptions: DevToolsLauncherOptions =
    launcher === true || launcher === undefined ? {} : launcher;
  return {
    enabled: launcherOptions.enabled !== false,
    panelId: launcherOptions.panelId ?? STANDARD_DEVTOOLS_LAUNCHER_PANEL_ID,
    shellPanelId: launcherOptions.shellPanelId ?? shell.panelId,
    label: launcherOptions.label ?? "DevTools",
    position: launcherOptions.position ?? "bottom-right",
    hotkeys: launcherOptions.hotkeys ?? []
  };
}

type RequiredDevToolsShellOptions = DevToolsShellOptions & {
  enabled: boolean;
  panelId: string;
  title: string;
  defaultOpen: boolean;
};

type RequiredDevToolsLauncherOptions = DevToolsLauncherOptions & {
  enabled: boolean;
  panelId: string;
  shellPanelId: string;
  label: string;
  position: NonNullable<DevToolsLauncherOptions["position"]>;
  hotkeys: string[];
};

type RequiredDevToolsPinsOptions = DevToolsPinsOptions & {
  enabled: boolean;
  defaultPinned: string[];
  defaultCollapsed: string[];
  collapseToTray: boolean;
  area: NonNullable<DevToolsPinsOptions["area"]>;
};
