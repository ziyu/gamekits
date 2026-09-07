import {
  createHeadlessRenderer,
  createMemoryAssetAdapter,
  createStandardAppProfile,
  type AppProfile
} from "@gamekits/app-host";
import type { AssetDiagnosticEvent, AssetLoaderAdapter, AssetManager } from "@gamekits/asset";
import type { GameAudio } from "@gamekits/audio-core";
import { createMemoryAudioBackend } from "@gamekits/audio-core/testing";
import type { DataRegistry } from "@gamekits/data";
import type { DevToolsDataSource, DevToolsRuntime } from "@gamekits/devtools";
import { createEventBus, type EventBus } from "@gamekits/event-bus";
import type { GameRuntime } from "@gamekits/game-runtime";
import { createInputRouter, type InputRouter } from "@gamekits/input-core";
import { createMultiplayerRuntime, type MultiplayerRuntime } from "@gamekits/multiplayer-core";
import { createMemoryMultiplayerBackend } from "@gamekits/multiplayer-memory";
import { createMemoryPhysicsBackend, type PhysicsBackendAdapter } from "@gamekits/physics-core";
import type { PlatformRuntime } from "@gamekits/platform-core";
import { createMemoryPlatform } from "@gamekits/platform-web";
import type { RendererAdapter } from "@gamekits/renderer-core";
import { createMemorySaveStore, type SaveManager, type SaveStore } from "@gamekits/save";
import { createUiRuntime, type UiRuntime } from "@gamekits/ui-core";
import type { GameWorld } from "@gamekits/world";
import { createKootaWorld } from "@gamekits/world-koota";
import { createOutpostDataRegistry } from "../content";
import {
  createOutpostPreviewRuntime,
  type OutpostAuthorityGameplayRuntime,
  type OutpostPreviewRuntime
} from "../gameplay";
import { OUTPOST_AUDIO_CONFIG } from "../presentation";
import { outpostProfileDefinition, type OutpostProfileId } from "./definitions";

type OutpostNonVisualProfileId = Extract<
  OutpostProfileId,
  "headless-server" | "deterministic-test"
>;

export type OutpostNonVisualContext = {
  assetDiagnostics: AssetDiagnosticEvent[];
  platform?: PlatformRuntime | undefined;
  dataRegistry?: DataRegistry | undefined;
  assets?: AssetManager | undefined;
  audio?: GameAudio | undefined;
  renderer?: RendererAdapter | undefined;
  inputRouter?: InputRouter | undefined;
  multiplayer?: MultiplayerRuntime | undefined;
  uiRuntime?: UiRuntime | undefined;
  saveManager?: SaveManager | undefined;
  devtools?: DevToolsRuntime | undefined;
  game?: GameRuntime | undefined;
  preview?: OutpostPreviewRuntime | undefined;
  authority?: OutpostAuthorityGameplayRuntime | undefined;
};

export type CreateOutpostNonVisualRuntimeContext = {
  dataRegistry: DataRegistry;
  world: GameWorld;
  physicsBackend: PhysicsBackendAdapter;
  eventBus: EventBus;
  seed?: string | undefined;
};

export type CreateOutpostNonVisualProfileOptions = {
  profileId: OutpostNonVisualProfileId;
  platform?: PlatformRuntime | undefined;
  renderer?: RendererAdapter | undefined;
  assetAdapter?: AssetLoaderAdapter | undefined;
  physicsBackend?: PhysicsBackendAdapter | undefined;
  multiplayer?: MultiplayerRuntime | undefined;
  uiRuntime?: UiRuntime | undefined;
  saveStore?: SaveStore | undefined;
  eventBus?: EventBus | undefined;
  clock?: (() => number) | undefined;
  seed?: string | undefined;
  createWorld?: (() => GameWorld) | undefined;
  createRuntime?: ((context: CreateOutpostNonVisualRuntimeContext) => GameRuntime) | undefined;
};

export function createOutpostNonVisualProfile(
  context: OutpostNonVisualContext,
  options: CreateOutpostNonVisualProfileOptions
): AppProfile<OutpostNonVisualContext> {
  const profileDefinition = outpostProfileDefinition(options.profileId);
  const platform =
    options.platform ??
    createMemoryPlatform({
      id: profileDefinition.platform,
      appName: `Outpost Siege ${profileDefinition.runtime}`
    });
  const dataRegistry = createOutpostDataRegistry();
  const renderer = options.renderer ?? createHeadlessRenderer();
  const inputRouter = createInputRouter();
  const multiplayer =
    options.multiplayer ??
    createMultiplayerRuntime({
      id: `outpost.${options.profileId}.runtime`,
      backend: createMemoryMultiplayerBackend({ id: `outpost.${options.profileId}.memory` }),
      connectContext: {
        localPeer: {
          id: `outpost.${options.profileId}.peer.local`,
          displayName: options.profileId === "headless-server" ? "Authority Server" : "Test Host",
          role: options.profileId === "headless-server" ? "server" : "host",
          playerId: "outpost.preview.player"
        }
      }
    });
  const uiRuntime = options.uiRuntime ?? createUiRuntime();
  const physicsBackend = options.physicsBackend ?? createMemoryPhysicsBackend();
  const eventBus =
    options.eventBus ?? createEventBus({ clock: options.clock ?? (() => Date.now()) });

  return createStandardAppProfile({
    id: profileDefinition.id,
    adapters: { platform, renderer },
    expose({ context: exposed, state }) {
      exposed.platform = state.platform;
      exposed.dataRegistry = state.data;
      exposed.assets = state.assets;
      exposed.audio = state.audio;
      exposed.renderer = state.renderer;
      exposed.inputRouter = state.input;
      exposed.multiplayer = state.multiplayer;
      exposed.uiRuntime = state.ui;
      exposed.saveManager = state.save;
      exposed.devtools = state.devtools;
      exposed.game = state.game;
    },
    services: {
      platform: { adapter: "platform" },
      drivers: { drivers: [] },
      data: { registry: dataRegistry },
      renderer: { adapter: "renderer" },
      assets: {
        adapter: options.assetAdapter ?? createMemoryAssetAdapter(),
        preloadGroups: () => [...profileDefinition.preloadGroups],
        onDiagnostic(event) {
          context.assetDiagnostics.unshift(event);
          if (context.assetDiagnostics.length > 16) {
            context.assetDiagnostics.pop();
          }
        }
      },
      audio: {
        backend: createMemoryAudioBackend({ id: `outpost.${options.profileId}.audio` }),
        config: OUTPOST_AUDIO_CONFIG,
        disposeBackend: true
      },
      input: { router: inputRouter },
      multiplayer: { runtime: multiplayer },
      ui: { runtime: uiRuntime },
      game: {
        createRuntime({ context: activeContext, state }) {
          const runtimeContext: CreateOutpostNonVisualRuntimeContext = {
            dataRegistry: requireState(state.data, "data"),
            world: options.createWorld?.() ?? createKootaWorld(),
            physicsBackend,
            eventBus,
            ...(options.seed === undefined ? {} : { seed: options.seed })
          };
          if (options.createRuntime) {
            const runtime = options.createRuntime(runtimeContext);
            activeContext.game = runtime;
            return runtime;
          }

          const preview = createOutpostPreviewRuntime(runtimeContext);
          activeContext.preview = preview;
          activeContext.game = preview.runtime;
          return preview.runtime;
        }
      },
      save: {
        store: options.saveStore ?? createMemorySaveStore(),
        formatVersion: "1.0.0",
        gameVersion: "0.1.0",
        contributorPolicy: {
          excludeScopes: ["presentation", "debug", "cache", "ui"]
        }
      },
      devtools: {
        preset: "minimal",
        ui: false,
        options: {
          traceLimit: 300,
          diagnosticLimit: 120,
          profilerBudgetMs: 8
        },
        dataSources({ context: activeContext }) {
          const sources: DevToolsDataSource[] = [
            {
              id: `outpost.${options.profileId}.runtime`,
              label: `Outpost ${profileDefinition.runtime} Runtime`,
              kind: "world",
              snapshot() {
                return (
                  activeContext.preview?.snapshot() ?? {
                    running: activeContext.game?.isRunning() ?? false,
                    profileId: options.profileId
                  }
                );
              }
            }
          ];
          sources.push(
            authoritySource(activeContext, "combat"),
            authoritySource(activeContext, "gas"),
            authoritySource(activeContext, "tca"),
            authoritySource(activeContext, "navigation"),
            authoritySource(activeContext, "ai"),
            {
              id: "outpost.authority-correlation",
              label: "Outpost Authority Correlation",
              kind: "custom",
              snapshot() {
                return authorityCorrelationSnapshot(activeContext.authority);
              }
            }
          );
          return sources;
        }
      }
    }
  });
}

function authoritySource(
  context: OutpostNonVisualContext,
  kind: "combat" | "gas" | "tca" | "navigation" | "ai"
): DevToolsDataSource {
  return {
    id: `outpost.authority-${kind}`,
    label: `Outpost Authority ${kind.toUpperCase()}`,
    kind,
    snapshot() {
      const authority = context.authority;
      if (!authority) {
        return { status: "not-authority-runtime" };
      }
      switch (kind) {
        case "combat":
          return {
            runtime: authority.combatCore.snapshot(),
            traces: authority.combatTrace.list().slice(-80)
          };
        case "gas":
          return {
            runtime: authority.gas.snapshot(),
            traces: authority.gasTrace.list().slice(-80)
          };
        case "tca":
          return {
            runtime: { bound: authority.tca.isBound() },
            traces: authority.tcaTrace.list().slice(-80)
          };
        case "navigation":
          return {
            runtime: authority.navigation.snapshot(),
            blockers: authority.snapshot().navigationBlockers,
            traces: authority.navigation.traces().slice(-80)
          };
        case "ai":
          return {
            runtime: authority.ai.snapshot(),
            traces: authority.ai.traces().slice(-80)
          };
      }
    }
  };
}

function authorityCorrelationSnapshot(authority: OutpostAuthorityGameplayRuntime | undefined) {
  if (!authority) {
    return { status: "not-authority-runtime", correlations: [] };
  }
  const correlations = new Map<string, { combat: number; gas: number; tca: number }>();
  const retain = (kind: "combat" | "gas" | "tca", correlationId: string | undefined) => {
    if (!correlationId) {
      return;
    }
    const current = correlations.get(correlationId) ?? { combat: 0, gas: 0, tca: 0 };
    current[kind] += 1;
    correlations.set(correlationId, current);
  };
  for (const trace of authority.combatTrace.list()) retain("combat", trace.correlationId);
  for (const trace of authority.gasTrace.list()) retain("gas", trace.correlationId);
  for (const trace of authority.tcaTrace.list()) retain("tca", trace.correlationId);
  return {
    correlations: [...correlations.entries()]
      .map(([correlationId, counts]) => ({ correlationId, ...counts }))
      .slice(-120)
  };
}

function requireState<T>(value: T | undefined, name: string): T {
  if (value === undefined) {
    throw new Error(`Missing Outpost app service state: ${name}`);
  }
  return value;
}
