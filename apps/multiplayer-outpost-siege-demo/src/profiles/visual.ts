import { createStandardAppProfile, type AppProfile } from "@gamekits/app-host";
import type { AssetDiagnosticEvent, AssetManager } from "@gamekits/asset";
import type { GameAudio } from "@gamekits/audio-core";
import { createCameraController, type CameraController } from "@gamekits/camera-core";
import type { DataRegistry } from "@gamekits/data";
import type { DevToolsDataSource, DevToolsRuntime } from "@gamekits/devtools";
import { createPhaserDriver } from "@gamekits/driver-phaser";
import { createInputRouter, type InputRouter } from "@gamekits/input-core";
import {
  createDomInputAdapter,
  createWebGamepadInputAdapter,
  type WebGamepadInputDiagnostic
} from "@gamekits/input-dom";
import {
  createMultiplayerRuntime,
  type MultiplayerClientReplicationSnapshotSource,
  type MultiplayerRuntime
} from "@gamekits/multiplayer-core";
import { createMemoryMultiplayerBackend } from "@gamekits/multiplayer-memory";
import type { PhysicsBackendAdapter } from "@gamekits/physics-core";
import type { PlatformRuntime } from "@gamekits/platform-core";
import { measureElementViewport } from "@gamekits/platform-web";
import type { RendererAdapter, RendererBootContext } from "@gamekits/renderer-core";
import { applyPhaserRenderTargetState } from "@gamekits/renderer-phaser";
import { createPlatformStorageSaveStore, type SaveManager } from "@gamekits/save";
import type { UiFocusScope, UiRuntime } from "@gamekits/ui-core";
import { createKootaWorld } from "@gamekits/world-koota";
import { createOutpostDataRegistry } from "../content";
import {
  configureOutpostInputRouter,
  createOutpostClientShadowRuntime,
  createOutpostPreviewRuntime,
  OUTPOST_VIEWPORT,
  type OutpostClientShadowRuntime,
  type OutpostPreviewRuntime
} from "../gameplay";
import { outpostProfileDefinition, type OutpostProfileId } from "./definitions";
import { OUTPOST_AUDIO_CONFIG } from "../presentation";

const PHASER_DRIVER_ID = "outpost.phaser";

type OutpostVisualProfileId = Extract<OutpostProfileId, "browser-web" | "tauri-smoke">;

export type OutpostVisualUiHandles = {
  rendererRoot: HTMLElement;
};

export type OutpostVisualContext = {
  ui: OutpostVisualUiHandles;
  uiRuntime: UiRuntime;
  physicsBackend?: PhysicsBackendAdapter | undefined;
  inputBlocked: boolean;
  assetDiagnostics: AssetDiagnosticEvent[];
  inputDiagnostics?: WebGamepadInputDiagnostic[];
  platform?: PlatformRuntime | undefined;
  dataRegistry?: DataRegistry | undefined;
  assets?: AssetManager | undefined;
  audio?: GameAudio | undefined;
  renderer?: RendererAdapter | undefined;
  inputRouter?: InputRouter | undefined;
  camera?: CameraController | undefined;
  multiplayer?: MultiplayerRuntime | undefined;
  saveManager?: SaveManager | undefined;
  devtools?: DevToolsRuntime | undefined;
  client?: OutpostClientShadowRuntime | undefined;
  preview?: OutpostPreviewRuntime | undefined;
};

export type CreateOutpostVisualProfileOptions = {
  profileId: OutpostVisualProfileId;
  platform: PlatformRuntime;
  multiplayer?: MultiplayerRuntime | undefined;
  client?:
    | {
        localPlayerId: string;
        snapshotSource: MultiplayerClientReplicationSnapshotSource;
      }
    | undefined;
  savePrefix?: string | undefined;
};

export function createOutpostVisualProfile(
  context: OutpostVisualContext,
  options: CreateOutpostVisualProfileOptions
): AppProfile<OutpostVisualContext> {
  const profileDefinition = outpostProfileDefinition(options.profileId);
  const dataRegistry = createOutpostDataRegistry();
  const phaserDriver = createPhaserDriver({
    id: PHASER_DRIVER_ID,
    backgroundColor: "#07110f",
    render: {
      pixelRatio: resolveOutpostPixelRatio(),
      antialias: true,
      antialiasGL: true,
      roundPixels: true
    }
  });
  const inputRouter = createInputRouter();
  const camera = createCameraController({
    viewport: OUTPOST_VIEWPORT,
    state: {
      x: 900,
      y: 500,
      zoom: 1,
      minZoom: 0.72,
      maxZoom: 1.35
    }
  });
  const multiplayer =
    options.multiplayer ??
    createMultiplayerRuntime({
      id: `outpost.${options.profileId}.preview`,
      backend: createMemoryMultiplayerBackend({
        id: `outpost.${options.profileId}.memory-preview`
      }),
      connectContext: {
        localPeer: {
          id: `outpost.${options.profileId}.peer.local`,
          displayName: "Ranger 01",
          role: "host",
          playerId: "outpost.preview.player"
        }
      }
    });

  return createStandardAppProfile({
    id: profileDefinition.id,
    adapters: { platform: options.platform },
    expose({ context: exposed, state }) {
      exposed.platform = state.platform;
      exposed.dataRegistry = state.data;
      exposed.assets = state.assets;
      exposed.audio = state.audio;
      exposed.renderer = state.renderer;
      exposed.inputRouter = state.input;
      exposed.camera = camera;
      exposed.multiplayer = state.multiplayer;
      exposed.saveManager = state.save;
      exposed.devtools = state.devtools;
      if (state.ui) {
        exposed.uiRuntime = state.ui;
      }
    },
    services: {
      platform: { adapter: "platform" },
      drivers: {
        drivers: [phaserDriver],
        boot({ context: activeContext }, _driver) {
          const bootContext = createRendererBootContext(activeContext);
          camera.setState({
            viewport: { width: bootContext.width, height: bootContext.height }
          });
          return bootContext;
        }
      },
      data: { registry: dataRegistry },
      renderer: { driver: PHASER_DRIVER_ID },
      assets: {
        driver: PHASER_DRIVER_ID,
        preloadGroups: () => [...profileDefinition.preloadGroups],
        onDiagnostic(event) {
          contextAssetDiagnostic(context, event);
        }
      },
      audio: {
        driver: PHASER_DRIVER_ID,
        config: OUTPOST_AUDIO_CONFIG
      },
      input: {
        router: inputRouter,
        configure(_ctx, router) {
          configureOutpostInputRouter(router);
        },
        adapters({ context: activeContext }, router) {
          return [
            createDomInputAdapter({
              target: window,
              capture: true,
              source: `outpost.${options.profileId}.dom.keyboard`,
              scope: () => resolveKeyboardScope(activeContext),
              eventFilter: (event) => event.type === "keydown" || event.type === "keyup",
              onInput(event) {
                router.handle(event);
              }
            }),
            createWebGamepadInputAdapter({
              source: `outpost.${options.profileId}.web.gamepad`,
              scope: () => resolveKeyboardScope(activeContext),
              onInput(event) {
                router.handle(event);
              },
              onDiagnostic(event) {
                contextInputDiagnostic(activeContext, event);
              }
            })
          ];
        },
        driverSources: [
          {
            driver: PHASER_DRIVER_ID,
            source: `outpost.${options.profileId}.phaser.pointer`,
            devices: ["mouse", "touch", "pen"],
            scope: "game"
          }
        ]
      },
      multiplayer: { runtime: multiplayer },
      ui: {
        runtime({ context: activeContext }) {
          return activeContext.uiRuntime;
        },
        panels() {
          return [{ id: "outpost.hud", title: "Field HUD", kind: "hud", tags: ["outpost"] }];
        },
        openPanels: () => ["outpost.hud"]
      },
      game: {
        createRuntime({ context: activeContext, state }) {
          if (options.client) {
            const client = createOutpostClientShadowRuntime({
              dataRegistry: requireState(state.data, "data"),
              world: createKootaWorld(),
              multiplayer: requireState(state.multiplayer, "multiplayer"),
              physicsBackend: requireState(activeContext.physicsBackend, "physics backend"),
              localPlayerId: options.client.localPlayerId,
              snapshotSource: options.client.snapshotSource,
              renderer: requireState(state.renderer, "renderer"),
              applyRenderTargetState: applyPhaserRenderTargetState,
              animationAdapter: phaserDriver.adapters().animation,
              audio: requireState(state.audio, "audio"),
              camera,
              cameraAdapter: phaserDriver.adapters().camera
            });
            activeContext.client = client;
            return client.runtime;
          }
          const preview = createOutpostPreviewRuntime({
            dataRegistry: requireState(state.data, "data"),
            world: createKootaWorld(),
            physicsBackend: requireState(activeContext.physicsBackend, "physics backend"),
            renderer: requireState(state.renderer, "renderer"),
            applyRenderTargetState: applyPhaserRenderTargetState,
            camera,
            cameraAdapter: phaserDriver.adapters().camera
          });
          activeContext.preview = preview;
          return preview.runtime;
        }
      },
      save: {
        store: createPlatformStorageSaveStore({
          storage: options.platform.services.storage,
          prefix: options.savePrefix ?? `outpost-siege.${options.profileId}.save`
        }),
        formatVersion: "1.0.0",
        gameVersion: "0.1.0",
        contributorPolicy: {
          excludeScopes: ["presentation", "debug", "cache", "ui"]
        }
      },
      devtools: {
        preset: "standard",
        options: {
          traceLimit: 500,
          diagnosticLimit: 200,
          profilerBudgetMs: 8
        },
        ui: { pins: false },
        dataSources({ context: activeContext }) {
          const sources: DevToolsDataSource[] = [
            {
              id: "outpost.input",
              label: "Outpost Input",
              kind: "custom",
              snapshot() {
                return {
                  gamepadDiagnostics: activeContext.inputDiagnostics ?? []
                };
              }
            },
            {
              id: activeContext.client ? "outpost.client-shadow" : "outpost.preview",
              label: activeContext.client ? "Outpost Authority Shadow" : "Outpost Local Preview",
              kind: "world",
              snapshot() {
                return (
                  activeContext.client?.snapshot() ??
                  activeContext.preview?.snapshot() ?? { status: "booting" }
                );
              }
            },
            {
              id: "outpost.camera",
              label: "Outpost Camera",
              kind: "camera",
              snapshot() {
                return {
                  state: camera.getDisplayState(),
                  driver: phaserDriver.snapshot()
                };
              }
            },
            {
              id: "outpost.physics",
              label: "Outpost Physics Presentation",
              kind: "physics",
              snapshot() {
                if (activeContext.client) {
                  return {
                    mode: "remote-authority-shadow",
                    owner: "room-authority-with-local-prediction",
                    localPhysics: true,
                    backend: activeContext.physicsBackend?.kind ?? "booting"
                  };
                }
                return {
                  scene: activeContext.preview?.physics.snapshot() ?? { status: "booting" },
                  interpolation: activeContext.preview?.physicsInterpolation.snapshot() ?? {
                    status: "booting"
                  }
                };
              }
            }
          ];
          sources.push(
            {
              id: "outpost.client-animator",
              label: "Outpost Client Animator",
              kind: "animator",
              snapshot() {
                const animator = activeContext.client?.animator;
                return animator?.isBound()
                  ? { runtime: animator.snapshot(), traces: animator.traces().slice(-120) }
                  : { status: "not-client-runtime" };
              }
            },
            {
              id: "outpost.replicated-combat",
              label: "Outpost Replicated Combat",
              kind: "combat",
              snapshot() {
                const match = activeContext.client?.view();
                return match
                  ? {
                      tick: match.tick,
                      elapsedMs: match.elapsedMs,
                      combat: match.combat
                    }
                  : { status: "awaiting-authority" };
              }
            },
            {
              id: "outpost.replicated-ai",
              label: "Outpost Replicated AI Semantics",
              kind: "ai",
              snapshot() {
                const match = activeContext.client?.view();
                return {
                  serverOnlyDetailsReplicated: false,
                  actors:
                    match?.combat.actors
                      .filter((actor) => actor.kind === "enemy")
                      .map((actor) => ({
                        objectId: actor.objectId,
                        targetActorId: actor.targetActorId,
                        goalId: actor.aiGoalId,
                        taskPhase: actor.aiTaskPhase,
                        executionId: actor.abilityExecutionId,
                        abilityId: actor.abilityId,
                        abilityPhase: actor.abilityPhase
                      })) ?? []
                };
              }
            }
          );
          return sources;
        },
        panels() {
          return [
            {
              id: "outpost.session",
              label: "Outpost Session",
              area: "dock",
              order: 7,
              sourceKinds: [
                "custom",
                "world",
                "camera",
                "physics",
                "combat",
                "ai",
                "animator",
                "audio"
              ]
            }
          ];
        }
      }
    }
  });
}

function createRendererBootContext(context: OutpostVisualContext): RendererBootContext {
  const viewport = measureElementViewport(context.ui.rendererRoot, OUTPOST_VIEWPORT);
  return {
    container: context.ui.rendererRoot,
    width: viewport.width,
    height: viewport.height,
    debug: false,
    onDiagnostic(event) {
      context.preview?.runtime.eventBus.emit(event.type, event.payload, event.source);
    }
  };
}

function contextAssetDiagnostic(
  context: Pick<OutpostVisualContext, "assetDiagnostics">,
  event: AssetDiagnosticEvent
): void {
  context.assetDiagnostics.unshift(event);
  if (context.assetDiagnostics.length > 16) {
    context.assetDiagnostics.pop();
  }
}

function contextInputDiagnostic(
  context: OutpostVisualContext,
  event: WebGamepadInputDiagnostic
): void {
  const diagnostics = (context.inputDiagnostics ??= []);
  diagnostics.unshift(event);
  if (diagnostics.length > 16) {
    diagnostics.pop();
  }
}

function resolveKeyboardScope(context: OutpostVisualContext): UiFocusScope {
  const scope = context.uiRuntime.focus().scope;
  const devtoolsOpen = context.uiRuntime
    .openPanels()
    .some((panel) => panel.id === "gamekits.devtools.shell");
  return resolveOutpostKeyboardScope(scope, context.inputBlocked, devtoolsOpen);
}

export function resolveOutpostKeyboardScope(
  focusScope: UiFocusScope,
  inputBlocked: boolean,
  devtoolsOpen: boolean
): UiFocusScope {
  if (devtoolsOpen || focusScope === "devtools") {
    return "devtools";
  }
  if (focusScope === "modal" || focusScope === "text-input" || focusScope === "ui") {
    return focusScope;
  }
  return inputBlocked ? "ui" : "game";
}

function resolveOutpostPixelRatio(): number {
  const devicePixelRatio = typeof window === "undefined" ? 1 : window.devicePixelRatio;
  return Math.min(1.5, Math.max(1, devicePixelRatio));
}

function requireState<T>(value: T | undefined, name: string): T {
  if (value === undefined) {
    throw new Error(`Missing Outpost app service state: ${name}`);
  }
  return value;
}
