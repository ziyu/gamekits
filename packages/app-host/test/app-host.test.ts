import { describe, expect, it } from "vitest";
import { createAssetManager } from "@gamekits/asset";
import {
  createAppHost,
  createConfiguredAppHost,
  createHeadlessHost,
  createStandardAppProfile,
  defineGameApp,
  type AppProfile,
  type AppServiceBinding
} from "@gamekits/app-host";
import { createMemoryAnimationPlaybackAdapter } from "@gamekits/animator-core/testing";
import { createMemoryAudioBackend } from "@gamekits/audio-core/testing";
import { createCameraController, screenToWorld } from "@gamekits/camera-core";
import { createDataRegistry } from "@gamekits/data";
import type { GameDriver } from "@gamekits/driver-core";
import { createEventBus } from "@gamekits/event-bus";
import {
  createGasDataTypes,
  createGasHandle,
  createGasTraceStore,
  type GasRuntime
} from "@gamekits/gas";
import { createGame } from "@gamekits/game-runtime";
import { createInputRouter } from "@gamekits/input-core";
import {
  createMultiplayerRuntime,
  defineSnapshotVector2Track,
  type NetworkVector2
} from "@gamekits/multiplayer-core";
import { createMemoryMultiplayerBackend } from "@gamekits/multiplayer-memory";
import { createMemoryNavigationBackend } from "@gamekits/navigation-core/testing";
import {
  createMemoryPhysicsBackend,
  createPhysicsHandle,
  createPhysicsInterpolationStore
} from "@gamekits/physics-core";
import { createMemorySaveStore } from "@gamekits/save";
import { type GameWorld } from "@gamekits/world";
import { createTcaHandle, createTcaRuleDataType } from "@gamekits/tca";
import { createUiRuntime } from "@gamekits/ui-core";

describe("app host service registry", () => {
  it("registers and exposes services through the registry", () => {
    const service = { value: 1 };
    const binding: AppServiceBinding<typeof service> = {
      key: { id: "custom.service" },
      service,
      lifecycle: { id: "custom.service" }
    };
    const host = createAppHost({ id: "test-host", services: [binding] });

    expect(host.services.has(binding.key)).toBe(true);
    expect(host.services.require(binding.key)).toBe(service);
    expect(host.snapshot().services.map((entry) => entry.id)).toContain("custom.service");
  });

  it("runs lifecycle in dependency order and disposes in reverse order", async () => {
    const calls: string[] = [];
    const host = createAppHost({
      id: "lifecycle-host",
      services: [
        createLifecycleBinding("a", calls),
        createLifecycleBinding("b", calls, ["a"]),
        createLifecycleBinding("c", calls, ["b"])
      ]
    });

    await host.boot();
    await host.start();
    await host.stop();
    await host.dispose();

    expect(calls).toEqual([
      "a.boot",
      "b.boot",
      "c.boot",
      "a.start",
      "b.start",
      "c.start",
      "c.stop",
      "b.stop",
      "a.stop",
      "c.dispose",
      "b.dispose",
      "a.dispose"
    ]);
  });

  it("ticks started services in dependency order and ignores ticks while stopped", async () => {
    const calls: string[] = [];
    const host = createAppHost({
      id: "tick-host",
      clock: () => 100,
      services: [
        createLifecycleBinding("input", calls),
        createLifecycleBinding("game", calls, ["input"])
      ]
    });

    host.tick(16, 100);
    await host.start();
    host.tick(16, 116);
    await host.stop();
    host.tick(16, 132);

    expect(calls).toEqual([
      "input.start",
      "game.start",
      "input.tick:16:116",
      "game.tick:16:116",
      "game.stop",
      "input.stop"
    ]);
  });

  it("reports lifecycle failures with service context", async () => {
    const host = createAppHost({
      id: "failure-host",
      services: [
        {
          key: { id: "broken" },
          service: {},
          lifecycle: {
            id: "broken",
            boot() {
              throw new Error("boom");
            }
          }
        }
      ]
    });

    await expect(host.boot()).rejects.toMatchObject({
      code: "app_host.service_lifecycle_failed"
    });
    expect(host.snapshot().services[0]?.phase).toBe("failed");
    expect(host.snapshot().diagnostics.map((event) => event.type)).toContain(
      "app_host.service_failed"
    );
  });

  it("awaits asynchronous driver lifecycle hooks and makes boot idempotent", async () => {
    const calls: string[] = [];
    const driver = createFakeDriver("async", calls);
    const originalStart = driver.start;
    driver.start = async () => {
      await Promise.resolve();
      calls.push("async.start.done");
      await originalStart?.();
    };
    const app = defineGameApp({ id: "async-driver", services: [{ id: "drivers" }] });
    const profile = createStandardAppProfile({
      id: "standard",
      services: { drivers: { drivers: [driver], boot: () => ({ width: 320, height: 180 }) } }
    });
    const host = createConfiguredAppHost({ app, profile, context: {} }).host;
    await host.boot();
    await host.boot();
    await host.start();
    expect(calls).toContain("async.start.done");
    expect(calls.filter((call) => call === "async.boot:320x180")).toHaveLength(1);
  });
});

describe("app host config runtime", () => {
  it("merges config sources and records final value source", () => {
    const host = createAppHost({
      id: "config-host",
      configSources: [
        { id: "framework", priority: 0, values: { renderer: { width: 320 } } },
        { id: "app", priority: 10, values: { renderer: { width: 640, height: 360 } } }
      ]
    });

    expect(host.config.require<number>("renderer.width")).toBe(640);
    expect(host.config.require<number>("renderer.height")).toBe(360);
    expect(
      host.config.snapshot().entries.find((entry) => entry.path === "renderer.width")?.source
    ).toBe("app");
  });
});

describe("headless host", () => {
  it("boots data, renderer and assets with standard service shortcuts", async () => {
    const host = createHeadlessHost({ id: "headless" });

    await host.boot();

    expect(host.services.data).toBeDefined();
    expect(host.services.assets).toBeDefined();
    expect(host.services.renderer).toBeDefined();
    expect(host.snapshot().services.map((service) => service.id)).toEqual([
      "data",
      "renderer",
      "assets"
    ]);
  });

  it("can expose an optional standard save service", async () => {
    const host = createHeadlessHost({
      id: "headless-save",
      saveStore: createMemorySaveStore()
    });

    await host.boot();

    expect(host.services.save).toBeDefined();
    expect(host.snapshot().services.map((service) => service.id)).toEqual([
      "data",
      "renderer",
      "assets",
      "save"
    ]);
  });

  it("can expose and dispose an optional standard multiplayer service", async () => {
    const runtime = createMultiplayerRuntime({
      id: "headless-multiplayer",
      backend: createMemoryMultiplayerBackend()
    });
    const host = createHeadlessHost({
      id: "headless-multiplayer",
      multiplayer: runtime
    });

    await runtime.createSession({
      id: "headless-room",
      localPeer: { id: "host" }
    });
    await host.boot();

    expect(host.services.multiplayer).toBe(runtime);
    expect(host.snapshot().services.map((service) => service.id)).toEqual([
      "data",
      "renderer",
      "assets",
      "multiplayer"
    ]);
    expect(host.snapshot().services.find((service) => service.id === "multiplayer")).toMatchObject({
      snapshot: {
        phase: "in-session",
        session: { id: "headless-room" }
      }
    });

    await host.dispose();

    expect(runtime.phase()).toBe("disposed");
  });

  it("can expose an optional standard devtools service", async () => {
    const host = createHeadlessHost({
      id: "headless-devtools",
      devtools: true
    });

    await host.boot();

    expect(host.services.devtools).toBeDefined();
    const snapshot = host.services.devtools?.snapshot({ includeSourceSnapshots: true });
    expect(host.snapshot().services.map((service) => service.id)).toEqual([
      "data",
      "renderer",
      "assets",
      "devtools"
    ]);
    expect(snapshot?.dataSources.map((source) => source.id)).toEqual([
      "host",
      "data",
      "assets",
      "renderer"
    ]);
    expect(snapshot?.sourceSnapshots?.map((source) => source.kind)).toEqual([
      "host",
      "data",
      "asset",
      "renderer"
    ]);
  });
});

describe("configured app host", () => {
  it("builds host services from an app definition and profile extensions", async () => {
    const calls: string[] = [];
    const app = defineGameApp({
      id: "configured",
      configSources: [{ id: "app", priority: 10, values: { renderer: { width: 640 } } }],
      services: [
        { id: "data", config: { packCount: 1 } },
        { id: "game", dependencies: ["data"] }
      ]
    });
    const profile: AppProfile<{ calls: string[] }> = {
      id: "test",
      configSources: [{ id: "profile", priority: 0, values: { platform: { id: "test" } } }],
      extensions: {
        data(ctx) {
          expect(ctx.requireConfig<{ packCount: number }>().packCount).toBe(1);
          return createLifecycleBinding("data", ctx.context.calls);
        },
        game(ctx) {
          return createLifecycleBinding("game", ctx.context.calls, ctx.service.dependencies);
        }
      }
    };

    const configured = createConfiguredAppHost({
      app,
      profile,
      context: { calls }
    });

    await configured.host.boot();

    expect(configured.host.config.require<number>("renderer.width")).toBe(640);
    expect(configured.host.config.require<string>("platform.id")).toBe("test");
    expect(calls).toEqual(["data.boot", "game.boot"]);
  });

  it("profiles host lifecycle and standard game runtime systems through devtools", async () => {
    const calls: string[] = [];
    const app = defineGameApp({
      id: "profiled",
      services: [{ id: "game" }, { id: "devtools", dependencies: ["game"] }]
    });
    const profile = createStandardAppProfile({
      id: "standard",
      services: {
        game: {
          createRuntime(_ctx, modules) {
            return createGame({
              modules: [
                ...modules,
                {
                  id: "test.module",
                  install(ctx) {
                    ctx.systems.register({
                      id: "test.system",
                      update() {
                        calls.push("system.update");
                      }
                    });
                  }
                }
              ],
              world: createMemoryWorld(),
              eventBus: createEventBus({ clock: () => 1 }),
              seed: "profiled"
            });
          }
        },
        devtools: true
      }
    });

    const configured = createConfiguredAppHost({ app, profile, context: {} });

    await configured.host.boot();
    await configured.host.start();
    configured.host.tick(16, 32);

    const snapshot = configured.host.services.devtools?.snapshot();

    expect(calls).toEqual(["system.update"]);
    expect(snapshot?.profiler.map((sample) => sample.name)).toContain("test.system");
    expect(snapshot?.profiler.map((sample) => sample.name)).toContain("game.tick");
    expect(snapshot?.profilerFrames.at(-1)).toMatchObject({
      tick: 1,
      deltaMs: 16,
      spanCount: 1
    });
  });

  it("throws clearly when a profile is missing a service provider", () => {
    const app = defineGameApp({
      id: "missing-factory",
      services: [{ id: "renderer" }]
    });

    expect(() =>
      createConfiguredAppHost({
        app,
        profile: { id: "test" },
        context: {}
      })
    ).toThrowError(/Missing app service provider/);
  });

  it("uses the standard app profile helper for built-in service bindings", async () => {
    const app = defineGameApp({
      id: "standard-configured",
      services: [{ id: "data" }]
    });
    const profile = createStandardAppProfile({
      id: "standard",
      services: {
        data: {
          registry: createDataRegistry()
        }
      }
    });

    const configured = createConfiguredAppHost({
      app,
      profile,
      context: {}
    });

    await configured.host.boot();

    expect(configured.host.services.data).toBeDefined();
    expect(configured.host.snapshot().services.map((service) => service.id)).toEqual(["data"]);
  });

  it("builds a standard save service from a store", async () => {
    const app = defineGameApp({
      id: "standard-save",
      services: [{ id: "save" }]
    });
    const profile = createStandardAppProfile({
      id: "standard",
      services: {
        save: {
          store: createMemorySaveStore(),
          formatVersion: "1.0.0",
          gameVersion: "0.1.0"
        }
      }
    });

    const configured = createConfiguredAppHost({
      app,
      profile,
      context: {}
    });

    await configured.host.boot();

    expect(configured.host.services.save).toBeDefined();
    expect(configured.host.services.require({ id: "save" })).toBe(configured.host.services.save);
    expect(configured.host.snapshot().services[0]).toMatchObject({
      id: "save",
      standard: "save"
    });
  });

  it("exposes a configurable service context to save contributors", async () => {
    const dataRegistry = createDataRegistry();
    const capturedServices: Array<Record<string, unknown> | undefined> = [];
    const app = defineGameApp({
      id: "standard-save-context",
      services: [{ id: "data" }, { id: "save", dependencies: ["data"] }]
    });
    const profile = createStandardAppProfile({
      id: "standard",
      services: {
        data: {
          registry: dataRegistry
        },
        save: {
          store: createMemorySaveStore(),
          formatVersion: "1.0.0",
          gameVersion: "0.1.0",
          serviceContext: {
            include: ["data"],
            extra: {
              campaignId: "test-campaign"
            }
          }
        }
      }
    });

    const configured = createConfiguredAppHost({
      app,
      profile,
      context: {}
    });
    await configured.host.boot();
    configured.host.services.save?.registerContributor({
      id: "game.progress",
      version: "1.0.0",
      capture(ctx) {
        capturedServices.push(ctx.services);
        return { id: "game.progress", version: "1.0.0", data: { day: 2 } };
      }
    });

    await configured.host.services.save?.save("slot-1", {
      runtime: {
        seed: "standard-save-context",
        clock: { ticks: 1, elapsed: 16 }
      }
    });

    expect(capturedServices[0]?.data).toBe(dataRegistry);
    expect(capturedServices[0]?.campaignId).toBe("test-campaign");
    expect(capturedServices[0]).not.toHaveProperty("save");
  });

  it("ticks standard input and game services from the app host frame", async () => {
    const router = createInputRouter();
    const emitted: string[] = [];
    const inputLifecycle: string[] = [];
    const runtimeTicks: number[] = [];
    let polled = false;
    const app = defineGameApp({
      id: "standard-frame",
      services: [{ id: "input" }, { id: "game", dependencies: ["input"] }]
    });
    const profile = createStandardAppProfile({
      id: "standard",
      services: {
        input: {
          router,
          configure(_ctx, input) {
            input.registerAction({
              id: "camera.pan_right",
              name: "Pan Right",
              defaultBindings: [
                { device: "keyboard", code: "KeyD", phase: "pressed" },
                { device: "keyboard", code: "KeyD", phase: "held" },
                { device: "keyboard", code: "KeyD", phase: "released" }
              ]
            });
            input.onAction((event) => {
              emitted.push(`${event.actionId}:${event.phase}:${event.timestamp}`);
            });
          },
          adapters(_ctx, input) {
            return [
              {
                start() {
                  inputLifecycle.push("start");
                },
                stop() {
                  inputLifecycle.push("stop");
                },
                poll(frame) {
                  inputLifecycle.push(`poll:${frame.timestamp}`);
                  if (polled) {
                    return;
                  }
                  polled = true;
                  input.handle({
                    id: "polled-key-down",
                    device: "keyboard",
                    code: "KeyD",
                    phase: "pressed",
                    timestamp: frame.timestamp
                  });
                },
                destroy() {
                  inputLifecycle.push("destroy");
                }
              }
            ];
          }
        },
        game: {
          createRuntime(_ctx, modules) {
            return createGame({
              modules,
              world: createMemoryWorld(),
              eventBus: createEventBus(),
              seed: "standard-frame"
            });
          }
        }
      }
    });

    const configured = createConfiguredAppHost({ app, profile, context: {} });
    const runtime = configured.host.services.game;
    if (!runtime) {
      throw new Error("Missing game runtime");
    }
    runtime.systems.register({
      id: "test.tick",
      update({ delta }) {
        runtimeTicks.push(delta);
      }
    });

    await configured.host.start();
    configured.host.tick(16, 17);

    expect(emitted).toEqual(["camera.pan_right:pressed:17", "camera.pan_right:held:17"]);
    expect(inputLifecycle).toEqual(["start", "poll:17"]);
    expect(runtimeTicks).toEqual([16]);

    await configured.host.stop();
    configured.host.tick(16, 33);
    expect(inputLifecycle).toEqual(["start", "poll:17", "stop"]);
    expect(runtimeTicks).toEqual([16]);

    await configured.host.dispose();
    expect(inputLifecycle).toEqual(["start", "poll:17", "stop", "destroy"]);
  });

  it("boots the standard UI service with panels and snapshot access", async () => {
    const ui = createUiRuntime();
    const app = defineGameApp({
      id: "standard-ui",
      services: [{ id: "ui" }]
    });
    const profile = createStandardAppProfile({
      id: "standard",
      services: {
        ui: {
          runtime: ui,
          panels: () => [{ id: "inspector", title: "Inspector", kind: "panel" }],
          openPanels: () => ["inspector"]
        }
      }
    });

    const configured = createConfiguredAppHost({ app, profile, context: {} });

    await configured.host.boot();

    expect(configured.host.services.ui).toBe(ui);
    expect(ui.snapshot().openPanels).toMatchObject([{ id: "inspector" }]);
    expect(configured.host.snapshot().services[0]?.snapshot).toMatchObject({
      focus: { scope: "ui", target: "inspector" }
    });
  });

  it("registers standard DevTools UI metadata when a UI service is available", async () => {
    const ui = createUiRuntime();
    const app = defineGameApp({
      id: "standard-devtools-ui",
      services: [{ id: "ui" }, { id: "devtools", dependencies: ["ui"] }]
    });
    const profile = createStandardAppProfile({
      id: "standard",
      services: {
        ui: {
          runtime: ui
        },
        devtools: true
      }
    });

    const configured = createConfiguredAppHost({ app, profile, context: {} });

    await configured.host.boot();

    expect(ui.panels().map((panel) => panel.id)).toEqual([
      "gamekits.devtools.launcher",
      "gamekits.devtools.shell"
    ]);
    expect(ui.panel("gamekits.devtools.shell")).toMatchObject({
      kind: "devtools",
      title: "GameKits DevTools"
    });
    expect(configured.host.services.devtools?.snapshot().panels).toContainEqual(
      expect.objectContaining({
        id: "devtools.performance",
        pin: expect.objectContaining({ defaultPinned: true })
      })
    );
    expect(
      configured.host.services.devtools?.snapshot().dataSources.map((source) => source.id)
    ).toContain("ui");
  });

  it("exposes standard multiplayer services and DevTools source snapshots", async () => {
    const runtime = createMultiplayerRuntime({
      id: "standard-multiplayer",
      backend: createMemoryMultiplayerBackend()
    });
    const app = defineGameApp({
      id: "standard-multiplayer",
      services: [{ id: "multiplayer" }, { id: "devtools", dependencies: ["multiplayer"] }]
    });
    const profile = createStandardAppProfile({
      id: "standard",
      services: {
        multiplayer: {
          runtime
        },
        devtools: true
      }
    });

    const configured = createConfiguredAppHost({ app, profile, context: {} });

    await configured.host.boot();
    await runtime.createSession({
      id: "devtools-room",
      localPeer: { id: "host" }
    });

    const snapshot = configured.host.services.devtools?.snapshot({ includeSourceSnapshots: true });

    expect(configured.host.services.multiplayer).toBe(runtime);
    expect(snapshot?.dataSources.map((source) => source.id)).toContain("multiplayer");
    expect(snapshot?.sourceSnapshots).toContainEqual(
      expect.objectContaining({
        id: "multiplayer",
        kind: "multiplayer",
        snapshot: expect.objectContaining({
          phase: "in-session",
          session: expect.objectContaining({ id: "devtools-room" })
        })
      })
    );

    await configured.host.dispose();
  });

  it("resolves standard renderer service from a driver capability", async () => {
    const calls: string[] = [];
    const driver = createFakeDriver("phaser", calls);
    const app = defineGameApp({
      id: "standard-drivers",
      services: [{ id: "renderer", dependencies: ["drivers"] }, { id: "drivers" }]
    });
    const profile = createStandardAppProfile({
      id: "standard",
      services: {
        drivers: {
          drivers: [driver],
          boot() {
            return { width: 320, height: 180 };
          }
        },
        renderer: {
          driver: "phaser"
        }
      }
    });

    const configured = createConfiguredAppHost({ app, profile, context: {} });

    await configured.host.boot();
    await configured.host.start();
    await configured.host.stop();
    await configured.host.dispose();

    expect(calls).toEqual(["phaser.boot:320x180", "phaser.start", "phaser.stop", "phaser.dispose"]);
    expect(configured.host.services.drivers?.require("phaser")).toBe(driver);
    expect(configured.host.services.renderer?.id).toBe("phaser.renderer");
  });

  it("injects standard camera, TCA, and GAS game modules into the runtime factory", async () => {
    const registry = createDataRegistry();
    registry.registerType(createTcaRuleDataType());
    for (const type of createGasDataTypes()) {
      registry.registerType(type);
    }
    registry.registerPack({
      id: "rules",
      version: "1.0.0",
      entries: [
        {
          type: "tca.rule",
          id: "rule.standard.tca",
          data: {
            id: "rule.standard.tca",
            trigger: { type: "event.type", args: { eventType: "test.trigger" } },
            actions: [{ type: "event.emit", args: { eventType: "test.derived" } }]
          }
        }
      ]
    });
    const camera = createCameraController({ viewport: { width: 320, height: 180 } });
    const initialCameraX = camera.getState().x;
    const eventBus = createEventBus({ clock: () => 1 });
    const gasHandle = createGasHandle({ id: "standard.gas" });
    const tcaHandle = createTcaHandle({ id: "standard.tca" });
    const derived: string[] = [];
    let gasRuntime: GasRuntime | undefined;
    eventBus.on("test.derived", (event) => {
      derived.push(event.type);
    });

    const app = defineGameApp({
      id: "standard-game-modules",
      services: [{ id: "data" }, { id: "game", dependencies: ["data"] }]
    });
    const profile = createStandardAppProfile({
      id: "standard",
      services: {
        data: { registry },
        game: {
          standardModules: {
            tca: { handle: tcaHandle },
            gas: {
              traceStore: createGasTraceStore(),
              handle: gasHandle,
              onRuntime(_ctx, runtime) {
                gasRuntime = runtime;
              }
            },
            camera: {
              controller: camera,
              actions: [{ actionId: "camera.pan_right", phases: ["pressed"], pan: { x: 12 } }]
            }
          },
          createRuntime(_ctx, modules) {
            expect(modules.map((module) => module.id)).toEqual([
              "gamekits.tca",
              "gamekits.gas",
              "gamekits.camera"
            ]);
            return createGame({
              modules,
              world: createMemoryWorld(),
              eventBus,
              seed: "standard"
            });
          }
        }
      }
    });

    const configured = createConfiguredAppHost({ app, profile, context: {} });

    eventBus.emit("test.trigger", {}, "test");
    eventBus.emit("input.action", { actionId: "camera.pan_right", phase: "pressed" }, "test");

    expect(derived).toEqual(["test.derived"]);
    expect(camera.getState().x).toBe(initialCameraX + 12);
    expect(gasRuntime).toBeDefined();
    expect(tcaHandle.isBound()).toBe(true);
    expect(gasHandle.isBound()).toBe(true);
    expect(configured.host.services.game?.modules.map((module) => module.id)).toEqual([
      "gamekits.tca",
      "gamekits.gas",
      "gamekits.camera"
    ]);

    await configured.host.dispose();
    expect(tcaHandle.isBound()).toBe(false);
    expect(gasHandle.isBound()).toBe(false);
  });

  it("injects and disposes the standard physics game module", async () => {
    const physics = createPhysicsHandle({ id: "standard.physics" });
    const interpolation = createPhysicsInterpolationStore({ id: "standard.interpolation" });
    const app = defineGameApp({
      id: "standard-physics-module",
      services: [{ id: "game" }]
    });
    const profile = createStandardAppProfile({
      id: "standard",
      services: {
        game: {
          standardModules: {
            physics: {
              backend: createMemoryPhysicsBackend(),
              handle: physics,
              interpolationStore: interpolation,
              fixedDeltaMs: 20,
              scene: { gravity: { x: 0, y: 0 } }
            }
          },
          createRuntime(_ctx, modules) {
            expect(modules.map((module) => module.id)).toEqual(["gamekits.physics"]);
            return createGame({
              modules,
              world: createMemoryWorld(),
              eventBus: createEventBus({ clock: () => 1 }),
              seed: "standard-physics"
            });
          }
        }
      }
    });

    const configured = createConfiguredAppHost({ app, profile, context: {} });

    expect(physics.isBound()).toBe(true);
    expect(interpolation.isBound()).toBe(true);
    await configured.host.start();
    configured.host.tick(20, 20);
    expect(physics.snapshot()).toMatchObject({ backend: "memory-physics" });

    await configured.host.dispose();
    expect(physics.isBound()).toBe(false);
    expect(interpolation.isBound()).toBe(false);
  });

  it("processes memory multiplayer commands through the standard bridge on runtime ticks", async () => {
    const backend = createMemoryMultiplayerBackend();
    const hostMultiplayer = createMultiplayerRuntime({
      id: "bridge-host",
      backend
    });
    const clientMultiplayer = createMultiplayerRuntime({
      id: "bridge-client",
      backend
    });
    const eventBus = createEventBus({ clock: () => 1 });
    const accepted: string[] = [];
    const handled: string[] = [];
    eventBus.on("multiplayer.command.accepted", (event) => {
      if (isRecord(event.payload) && typeof event.payload.messageId === "string") {
        accepted.push(event.payload.messageId);
      }
    });

    await hostMultiplayer.createSession({
      id: "bridge-room",
      localPeer: { id: "host" }
    });
    await clientMultiplayer.joinSession({
      sessionId: "bridge-room",
      localPeer: { id: "client" }
    });

    const app = defineGameApp({
      id: "standard-multiplayer-bridge",
      services: [{ id: "multiplayer" }, { id: "game", dependencies: ["multiplayer"] }]
    });
    const profile = createStandardAppProfile({
      id: "standard",
      services: {
        multiplayer: {
          runtime: hostMultiplayer
        },
        game: {
          standardModules: {
            multiplayer: {
              handleCommand({ message }) {
                handled.push(`${message.id}:${message.sourcePeerId}`);
              }
            }
          },
          createRuntime(_ctx, modules) {
            expect(modules.map((module) => module.id)).toEqual(["gamekits.multiplayer.bridge"]);
            return createGame({
              modules,
              world: createMemoryWorld(),
              eventBus,
              seed: "standard-multiplayer"
            });
          }
        }
      }
    });

    const configured = createConfiguredAppHost({ app, profile, context: {} });

    await configured.host.start();
    await clientMultiplayer.send({
      id: "move-1",
      channel: "reliable",
      kind: "game.command",
      payload: { action: "move", x: 1, y: 0 }
    });
    expect(handled).toEqual([]);

    configured.host.tick(16, 16);
    expect(accepted).toEqual(["move-1"]);
    expect(handled).toEqual(["move-1:client"]);

    await configured.host.stop();
    await clientMultiplayer.send({
      id: "move-2",
      channel: "reliable",
      kind: "game.command",
      payload: { action: "move", x: 0, y: 1 }
    });
    configured.host.tick(16, 32);
    expect(handled).toEqual(["move-1:client"]);

    await configured.host.start();
    configured.host.tick(16, 48);
    expect(handled).toEqual(["move-1:client", "move-2:client"]);

    await configured.host.dispose();
    await clientMultiplayer.send({
      id: "move-3",
      channel: "reliable",
      kind: "game.command",
      payload: { action: "move", x: -1, y: 0 }
    });
    expect(handled).toEqual(["move-1:client", "move-2:client"]);

    await clientMultiplayer.dispose();
  });

  it("runs standard multiplayer presentation playback on host game ticks", async () => {
    const backend = createMemoryMultiplayerBackend();
    const multiplayer = createMultiplayerRuntime({
      id: "presentation-runtime",
      backend
    });
    const eventBus = createEventBus({ clock: () => 1 });
    let latestSnapshot = { tick: 0, position: { x: 0, y: 0 } };
    const presented: Array<{
      status: string;
      tick: number | undefined;
      position: NetworkVector2;
    }> = [];

    const app = defineGameApp({
      id: "standard-multiplayer-presentation",
      services: [{ id: "multiplayer" }, { id: "game", dependencies: ["multiplayer"] }]
    });
    const profile = createStandardAppProfile({
      id: "standard",
      services: {
        multiplayer: {
          runtime: multiplayer
        },
        game: {
          standardModules: {
            multiplayer: {
              presentation: {
                interpolationDelayMs: 50,
                readTime(entry) {
                  return entry.snapshot.tick * 50;
                },
                tracks: [
                  defineSnapshotVector2Track<typeof latestSnapshot>({
                    selectInto(snapshot, writer) {
                      writer.add("avatar:position", snapshot.position);
                    }
                  })
                ],
                readSnapshot() {
                  return {
                    snapshot: latestSnapshot,
                    tick: latestSnapshot.tick
                  };
                },
                applySample({ sample, presented: values }) {
                  presented.push({
                    status: sample.status,
                    tick: sample.next?.snapshot.tick,
                    position: values.vector2("avatar:position", { x: -1, y: -1 })
                  });
                }
              }
            }
          },
          createRuntime(_ctx, modules) {
            expect(modules.map((module) => module.id)).toEqual(["gamekits.multiplayer.bridge"]);
            return createGame({
              modules,
              world: createMemoryWorld(),
              eventBus,
              seed: "standard-multiplayer-presentation"
            });
          }
        }
      }
    });

    const configured = createConfiguredAppHost({ app, profile, context: {} });
    expect(configured.host.services.game?.systems.values().map((system) => system.id)).toEqual([
      "gamekits.multiplayer.bridge.presentation"
    ]);

    await configured.host.start();
    configured.host.tick(0, 0);
    latestSnapshot = { tick: 1, position: { x: 50, y: 0 } };
    configured.host.tick(50, 50);
    latestSnapshot = { tick: 2, position: { x: 100, y: 0 } };
    configured.host.tick(50, 100);

    expect(presented).toEqual([
      { status: "before-first", tick: 0, position: { x: 0, y: 0 } },
      { status: "exact", tick: 0, position: { x: 0, y: 0 } },
      { status: "exact", tick: 1, position: { x: 50, y: 0 } }
    ]);

    await configured.host.dispose();
  });

  it("installs managed client replication through the standard multiplayer module", async () => {
    type Snapshot = { tick: number; position: NetworkVector2 };
    const backend = createMemoryMultiplayerBackend();
    const server = createMultiplayerRuntime({ id: "managed-server", backend });
    const client = createMultiplayerRuntime({ id: "managed-client", backend });
    await server.createSession({
      id: "managed-room",
      authority: "server-authoritative",
      localPeer: { id: "server", role: "server" }
    });
    await client.joinSession({
      sessionId: "managed-room",
      localPeer: { id: "client", role: "client", playerId: "player.client" }
    });
    const applied: number[] = [];
    const app = defineGameApp({
      id: "standard-managed-client-replication",
      services: [{ id: "multiplayer" }, { id: "game", dependencies: ["multiplayer"] }]
    });
    const profile = createStandardAppProfile({
      id: "standard",
      services: {
        multiplayer: { runtime: client },
        game: {
          standardModules: {
            multiplayer: {
              clientReplication: {
                playback: { interpolationDelayMs: 50, timeSource: "tick" },
                readSnapshot(payload) {
                  return isRecord(payload) &&
                    typeof payload.tick === "number" &&
                    isRecord(payload.position) &&
                    typeof payload.position.x === "number" &&
                    typeof payload.position.y === "number"
                    ? {
                        tick: payload.tick,
                        position: { x: payload.position.x, y: payload.position.y }
                      }
                    : undefined;
                },
                toBufferEntry({ snapshot }) {
                  return { snapshot, tick: snapshot.tick };
                },
                applyFrame({ snapshot }) {
                  applied.push(snapshot.tick);
                }
              }
            }
          },
          createRuntime(_ctx, modules) {
            return createGame({
              modules,
              world: createMemoryWorld(),
              eventBus: createEventBus(),
              seed: "managed-client-replication"
            });
          }
        }
      }
    });
    const configured = createConfiguredAppHost({ app, profile, context: {} });

    await configured.host.boot();
    await configured.host.start();
    await server.send<Snapshot>({
      channel: "reliable",
      kind: "game.snapshot",
      tick: 1,
      payload: { tick: 1, position: { x: 10, y: 20 } }
    });
    configured.host.tick(16, 16);

    expect(configured.host.services.game?.systems.values().map((system) => system.id)).toEqual([
      "gamekits.multiplayer.bridge.client-replication"
    ]);
    expect(applied).toEqual([1]);

    await configured.host.dispose();
    await server.dispose();
  });

  it("smooths standard camera module renderer sync over runtime ticks", async () => {
    const camera = createCameraController({ viewport: { width: 320, height: 180 } });
    const initialCameraX = camera.getState().x;
    const eventBus = createEventBus({ clock: () => 1 });
    const syncedX: number[] = [];
    const app = defineGameApp({
      id: "smooth-camera",
      services: [{ id: "game" }]
    });
    const profile = createStandardAppProfile({
      id: "standard",
      services: {
        game: {
          standardModules: {
            camera: {
              controller: camera,
              actions: [{ actionId: "camera.pan_right", phases: ["pressed"], pan: { x: 48 } }],
              smoothing: { enabled: true, stiffness: 8 },
              sync(_ctx, _camera, _action, state) {
                syncedX.push(state.x);
              }
            }
          },
          createRuntime(_ctx, modules) {
            return createGame({
              modules,
              world: createMemoryWorld(),
              eventBus,
              seed: "standard"
            });
          }
        }
      }
    });

    const configured = createConfiguredAppHost({ app, profile, context: {} });
    const runtime = configured.host.services.game;
    if (!runtime) {
      throw new Error("Missing game runtime");
    }

    runtime.start();
    eventBus.emit("input.action", { actionId: "camera.pan_right", phase: "pressed" }, "test");
    runtime.tick(16);

    const targetX = initialCameraX + 48;
    expect(camera.getState().x).toBe(targetX);
    expect(syncedX.at(-1)).toBeGreaterThan(initialCameraX);
    expect(syncedX.at(-1)).toBeLessThan(targetX);

    for (let i = 0; i < 60; i += 1) {
      runtime.tick(16);
    }

    expect(syncedX.at(-1)).toBeCloseTo(targetX, 1);
  });

  it("keeps anchored zoom stable while smoothing standard camera sync", async () => {
    const camera = createCameraController({
      viewport: { width: 320, height: 180 },
      state: { x: 160, y: 90, minZoom: 0.5, maxZoom: 4 }
    });
    const eventBus = createEventBus({ clock: () => 1 });
    const anchor = { x: 240, y: 120 };
    const synced: Array<{ x: number; y: number; zoom: number }> = [];
    const app = defineGameApp({
      id: "smooth-anchored-zoom",
      services: [{ id: "game" }]
    });
    const profile = createStandardAppProfile({
      id: "standard",
      services: {
        game: {
          standardModules: {
            camera: {
              controller: camera,
              actions: [
                {
                  actionId: "camera.zoom_in",
                  phases: ["scrolled"],
                  zoom: { delta: 1, wheel: true, anchorFromInput: true }
                }
              ],
              smoothing: { enabled: true, stiffness: 8 },
              sync(_ctx, _camera, _action, state) {
                synced.push({ x: state.x, y: state.y, zoom: state.zoom });
              }
            }
          },
          createRuntime(_ctx, modules) {
            return createGame({
              modules,
              world: createMemoryWorld(),
              eventBus,
              seed: "standard"
            });
          }
        }
      }
    });
    const runtime = createConfiguredAppHost({ app, profile, context: {} }).host.services.game;
    if (!runtime) {
      throw new Error("Missing game runtime");
    }

    runtime.start();
    const beforeWorld = camera.screenToWorld(anchor);
    eventBus.emit(
      "input.action",
      {
        actionId: "camera.zoom_in",
        phase: "scrolled",
        input: { x: anchor.x, y: anchor.y, wheelDelta: -100 }
      },
      "test"
    );
    runtime.tick(16);

    const displayState = {
      ...camera.getState(),
      ...synced.at(-1)!
    };
    expect(synced.at(-1)?.zoom).toBeGreaterThan(1);
    expect(camera.screenToWorld(anchor)).toEqual(beforeWorld);
    expect(screenToWorld(displayState, anchor).x).toBeCloseTo(beforeWorld.x);
    expect(screenToWorld(displayState, anchor).y).toBeCloseTo(beforeWorld.y);
  });

  it("tracks standard camera follow targets through a resolver", async () => {
    const camera = createCameraController({ viewport: { width: 320, height: 180 } });
    const eventBus = createEventBus({ clock: () => 1 });
    const synced: Array<{ x: number; y: number; mode: string }> = [];
    const targets = new Map<string | number, { x: number; y: number }>([
      ["hero", { x: 80, y: 48 }]
    ]);
    const app = defineGameApp({
      id: "follow-camera",
      services: [{ id: "game" }]
    });
    const profile = createStandardAppProfile({
      id: "standard",
      services: {
        game: {
          standardModules: {
            camera: {
              controller: camera,
              actions: [],
              follow: {
                resolveTarget(_ctx, targetEntity) {
                  return targets.get(targetEntity);
                }
              },
              sync(_ctx, _camera, _action, state) {
                synced.push({ x: state.x, y: state.y, mode: state.mode });
              }
            }
          },
          createRuntime(_ctx, modules) {
            return createGame({
              modules,
              world: createMemoryWorld(),
              eventBus,
              seed: "standard"
            });
          }
        }
      }
    });

    const configured = createConfiguredAppHost({ app, profile, context: {} });
    const runtime = configured.host.services.game;
    if (!runtime) {
      throw new Error("Missing game runtime");
    }

    runtime.start();
    eventBus.emit("camera.follow_entity", { entityId: "hero" }, "test");
    runtime.tick(16);

    expect(camera.getState()).toMatchObject({ mode: "follow", targetEntity: "hero", x: 80, y: 48 });
    expect(synced.at(-1)).toMatchObject({ mode: "follow", x: 80, y: 48 });

    targets.set("hero", { x: 96, y: 64 });
    runtime.tick(16);
    expect(camera.getState()).toMatchObject({ x: 96, y: 64 });

    eventBus.emit("camera.stop_follow", {}, "test");
    expect(camera.getState().mode).toBe("free");
  });
});

describe("gameplay foundation standard composition", () => {
  it("owns Audio Core as a standard service and exposes its DevTools source", async () => {
    const backend = createMemoryAudioBackend();
    const app = defineGameApp({
      id: "standard-audio",
      services: [{ id: "audio" }, { id: "devtools", dependencies: ["audio"] }]
    });
    const profile = createStandardAppProfile({
      id: "standard",
      services: {
        audio: {
          backend,
          config: {
            sfx: [
              {
                id: "sfx.test",
                layers: [
                  {
                    id: "main",
                    clips: [
                      {
                        id: "clip.test",
                        asset: { assetId: "audio.test", type: "audio" }
                      }
                    ]
                  }
                ]
              }
            ]
          }
        },
        devtools: true
      }
    });
    const configured = createConfiguredAppHost({ app, profile, context: {} });

    await configured.host.boot();
    await configured.host.start();
    await configured.host.services.audio?.unlock();
    expect(configured.host.services.audio?.sfx.play("sfx.test")).toMatchObject({
      status: "playing"
    });
    configured.host.tick(16, 16);

    expect(configured.host.services.audio?.snapshot()).toMatchObject({
      elapsed: 16,
      activePlaybackInstances: 1,
      unlock: "unlocked"
    });
    const devtoolsSnapshot = configured.host.services.devtools?.snapshot({
      includeSourceSnapshots: true
    });
    expect(devtoolsSnapshot?.dataSources.map((source) => source.id)).toContain("audio");
    expect(
      devtoolsSnapshot?.sourceSnapshots?.find((source) => source.id === "audio")
    ).toMatchObject({ kind: "audio", snapshot: { activePlaybackInstances: 1 } });

    await configured.host.dispose();
    expect(backend.snapshot().disposed).toBe(true);
  });

  it("resolves Combat, Navigation, AI and Animator through core-owned module factories", () => {
    const dataRegistry = createDataRegistry();
    let moduleIds: string[] = [];
    let exposed:
      | {
          combatBound: boolean;
          navigationBound: boolean;
          aiBound: boolean;
          animatorBound: boolean;
        }
      | undefined;
    const app = defineGameApp({ id: "standard-gameplay-modules", services: [{ id: "game" }] });
    const profile = createStandardAppProfile({
      id: "standard",
      services: {
        game: {
          standardModules: {
            combat: {
              physics: createPhysicsHandle(),
              gas: createGasHandle(),
              dataRegistry,
              relationshipResolver: {
                resolve: () => "neutral",
                allows: () => true
              }
            },
            navigation: { backend: createMemoryNavigationBackend() },
            ai: {
              dataRegistry,
              intentSink: { emit() {} }
            },
            animator: {
              dataRegistry,
              adapter: createMemoryAnimationPlaybackAdapter()
            }
          },
          createRuntime(_ctx, modules) {
            moduleIds = modules.map((module) => module.id);
            return createGame({
              modules: [],
              world: createMemoryWorld(),
              eventBus: createEventBus(),
              seed: "standard-gameplay-modules"
            });
          }
        }
      },
      expose(ctx) {
        if (!ctx.state.combat || !ctx.state.navigation || !ctx.state.ai || !ctx.state.animator) {
          return;
        }
        exposed = {
          combatBound: ctx.state.combat.isBound(),
          navigationBound: ctx.state.navigation.isBound(),
          aiBound: ctx.state.ai.isBound(),
          animatorBound: ctx.state.animator.isBound()
        };
      }
    });

    createConfiguredAppHost({ app, profile, context: {} });

    expect(moduleIds).toEqual(["combat", "navigation", "ai", "animator"]);
    expect(exposed).toEqual({
      combatBound: false,
      navigationBound: false,
      aiBound: false,
      animatorBound: false
    });
  });
});

function createLifecycleBinding(
  id: string,
  calls: string[],
  dependencies: string[] = []
): AppServiceBinding<object> {
  return {
    key: { id },
    service: {},
    lifecycle: {
      id,
      dependencies,
      boot() {
        calls.push(`${id}.boot`);
      },
      start() {
        calls.push(`${id}.start`);
      },
      tick(_ctx, frame) {
        calls.push(`${id}.tick:${frame.delta}:${frame.timestamp}`);
      },
      stop() {
        calls.push(`${id}.stop`);
      },
      dispose() {
        calls.push(`${id}.dispose`);
      }
    }
  };
}

function createFakeDriver(id: string, calls: string[]): GameDriver {
  let phase: ReturnType<GameDriver["snapshot"]>["phase"] = "registered";

  return {
    id,
    kind: "fake",
    boot(ctx) {
      calls.push(`${id}.boot:${ctx.width}x${ctx.height}`);
      phase = "booted";
    },
    start() {
      calls.push(`${id}.start`);
      phase = "started";
    },
    stop() {
      calls.push(`${id}.stop`);
      phase = "stopped";
    },
    dispose() {
      calls.push(`${id}.dispose`);
      phase = "disposed";
    },
    capabilities() {
      return { renderer: true };
    },
    adapters() {
      return {
        renderer: {
          id: `${id}.renderer`,
          kind: "fake",
          async boot() {},
          destroy() {},
          getView() {
            return {} as HTMLElement;
          },
          resize() {},
          createObject() {
            return "object";
          },
          destroyObject() {},
          native() {
            return {};
          }
        }
      };
    },
    snapshot() {
      return {
        id,
        kind: "fake",
        phase,
        capabilities: this.capabilities(),
        adapters: ["renderer"]
      };
    }
  };
}

function createMemoryWorld(): GameWorld {
  return {
    spawn() {
      return "entity";
    },
    despawn() {
      return undefined;
    },
    has() {
      return false;
    },
    add() {
      return undefined;
    },
    get() {
      return undefined;
    },
    set() {
      return undefined;
    },
    remove() {
      return undefined;
    },
    query() {
      return [];
    },
    count() {
      return 0;
    }
  };
}

describe("host lifecycle failure boundaries", () => {
  it("keeps boot idempotent across concurrent requests and restart", async () => {
    const calls: string[] = [];
    const host = createAppHost({ id: "host", services: [createLifecycleBinding("a", calls)] });
    await Promise.all([host.boot(), host.boot()]);
    await host.start();
    await host.stop();
    await host.boot();
    await host.start();
    expect(calls.filter((call) => call === "a.boot")).toHaveLength(1);
  });

  it("queues disposal behind an in-flight boot and keeps disposed terminal", async () => {
    const gate = deferred();
    const entered = deferred();
    const calls: string[] = [];
    const binding = createLifecycleBinding("a", calls);
    binding.lifecycle.boot = async () => {
      entered.resolve();
      await gate.promise;
      calls.push("boot.done");
    };
    const host = createAppHost({ id: "host", services: [binding] });
    const boot = host.boot();
    await entered.promise;
    const disposal = host.dispose();
    gate.resolve();
    await Promise.all([boot, disposal]);
    expect(calls).toEqual(["boot.done", "a.dispose"]);
    expect(host.snapshot().phase).toBe("disposed");
    await expect(host.start()).rejects.toMatchObject({ code: "app_host.disposed" });
    await expect(host.boot()).rejects.toMatchObject({ code: "app_host.disposed" });
  });

  it("fails fast on boot but attempts all services during disposal", async () => {
    const calls: string[] = [];
    const a = createLifecycleBinding("a", calls);
    const b = createLifecycleBinding("b", calls, ["a"]);
    const c = createLifecycleBinding("c", calls, ["b"]);
    b.lifecycle.boot = () => {
      throw new Error("boot failure");
    };
    b.lifecycle.dispose = () => {
      calls.push("b.dispose");
      throw new Error("dispose failure");
    };
    const host = createAppHost({ id: "host", services: [a, b, c] });
    await expect(host.boot()).rejects.toThrow("boot failure");
    expect(host.snapshot().phase).toBe("failed");
    expect(calls).toEqual(["a.boot"]);
    await expect(host.start()).rejects.toMatchObject({ code: "app_host.failed" });
    await expect(host.dispose()).rejects.toThrow("dispose failure");
    expect(calls).toEqual(["a.boot", "c.dispose", "b.dispose", "a.dispose"]);
    expect(host.snapshot().phase).toBe("disposed");
  });

  it.each(["start", "stop", "dispose"] as const)(
    "awaits pending driver %s and surfaces its rejection",
    async (stage) => {
      const gate = deferred();
      const entered = deferred();
      const calls: string[] = [];
      const a = createFakeDriver("a", calls);
      const b = createFakeDriver("b", calls);
      b[stage] = async () => {
        entered.resolve();
        await gate.promise;
        throw new Error("driver failure");
      };
      const app = defineGameApp({ id: "app", services: [{ id: "drivers" }] });
      const profile = createStandardAppProfile({
        id: "profile",
        services: { drivers: { drivers: [a, b] } }
      });
      const host = createConfiguredAppHost({ app, profile, context: {} }).host;
      if (stage === "stop") await host.start();
      let settled = false;
      const pending = host[stage]();
      const checked = expect(pending).rejects.toThrow("driver failure");
      void pending.then(
        () => {
          settled = true;
        },
        () => {
          settled = true;
        }
      );
      await entered.promise;
      // Let all unblocked promise chains drain; only the explicit gate can finish this stage.
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(settled).toBe(false);
      gate.resolve();
      await checked;
      expect(calls).toContain(`a.${stage}`);
      expect(host.snapshot().phase).toBe(stage === "dispose" ? "disposed" : "failed");
    }
  );

  it("cancels held input when the standard service stops", async () => {
    const router = createInputRouter();
    router.registerAction({
      id: "move",
      name: "Move",
      defaultBindings: [{ device: "keyboard", code: "KeyW" }]
    });
    const phases: string[] = [];
    router.onAction((event) => phases.push(event.phase));
    const app = defineGameApp({ id: "app", services: [{ id: "input" }] });
    const profile = createStandardAppProfile({ id: "profile", services: { input: { router } } });
    const host = createConfiguredAppHost({ app, profile, context: {} }).host;
    await host.start();
    router.handle({ id: "down", device: "keyboard", code: "KeyW", phase: "pressed", timestamp: 0 });
    const stopped = host.stop();
    host.tick(16);
    await stopped;
    await host.start();
    host.tick(16);
    expect(phases).toEqual(["pressed", "cancelled"]);
  });
});

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

it("fails boot when a declared preload group cannot be loaded", async () => {
  const manager = createAssetManager({
    adapter: {
      id: "failing",
      supports: () => true,
      load: async () => {
        throw new Error("offline");
      }
    }
  });
  manager.register({
    id: "texture",
    type: "image",
    group: "required",
    source: { type: "url", url: "/texture.png" }
  });
  const configured = createConfiguredAppHost({
    app: defineGameApp({ id: "app", services: [{ id: "assets" }] }),
    profile: createStandardAppProfile({
      id: "profile",
      services: { assets: { manager, preloadGroups: () => ["required"] } }
    }),
    context: {}
  });
  await expect(configured.host.boot()).rejects.toThrow(/Asset preload failed/);
  expect(configured.host.snapshot().phase).toBe("failed");
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
