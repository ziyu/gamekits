import { describe, expect, it } from "vitest";
import { createGameAudio } from "@gamekits/audio-core";
import { runAudioBackendConformance } from "@gamekits/audio-core/testing";
import {
  createPhaserDriver,
  createPhaserDriverAssetLoader,
  createPhaserAnimationPlaybackAdapter,
  createPhaserAudioBackend,
  type PhaserDriverAssetRuntime
} from "../src";
import type { PhaserDriverAudioRuntime } from "../src/driver/audio";
import { createPhaserDriverCameraAdapter } from "../src/driver/camera";
import { replacePhaserSoundVolumeTween, unlockPhaserSoundManager } from "../src/driver/runtime";

describe("createPhaserDriver", () => {
  it("exposes a cohesive adapter bundle", () => {
    const driver = createPhaserDriver({
      id: "test.phaser",
      render: {
        pixelRatio: 1.5,
        antialias: false,
        antialiasGL: false,
        roundPixels: true,
        mipmapFilter: "LINEAR"
      }
    });
    const adapters = driver.adapters();

    expect(driver.id).toBe("test.phaser");
    expect(driver.capabilities()).toMatchObject({
      renderer: true,
      assets: true,
      input: true,
      camera: true,
      animation: true,
      audio: true
    });
    expect(adapters.renderer.id).toBe("test.phaser.renderer");
    expect(adapters.assetLoader.id).toBe("test.phaser.asset-loader");
    expect(driver.snapshot()).toMatchObject({
      id: "test.phaser",
      kind: "phaser",
      adapters: ["renderer", "assetLoader", "camera", "animation", "audio", "inputSource"],
      details: {
        render: {
          pixelRatio: 1.5,
          antialias: false,
          antialiasGL: false,
          roundPixels: true,
          mipmapFilter: "LINEAR"
        }
      }
    });
  });

  it("validates render options before runtime boot", () => {
    expect(() => createPhaserDriver({ render: { pixelRatio: 0 } })).toThrow(
      "pixelRatio must be a finite positive number"
    );
  });

  it("fails clearly when a runtime-backed adapter is used before boot", async () => {
    const driver = createPhaserDriver({ id: "test.phaser" });

    await expect(
      driver.adapters().assetLoader.load({
        id: "asset.hero",
        type: "image",
        source: { type: "url", url: "/hero.png" }
      })
    ).rejects.toMatchObject({
      code: "driver.phaser.assets_unavailable"
    });
    driver.adapters().camera.applyCameraState({
      mode: "free",
      x: 0,
      y: 0,
      zoom: 1,
      rotation: 0,
      viewport: { width: 1, height: 1 },
      minZoom: 0.5,
      maxZoom: 2
    });
    expect(driver.adapters().camera.getState()).toMatchObject({ x: 0, y: 0, zoom: 1 });
  });
});

describe("createPhaserAudioBackend", () => {
  it("passes playback, spatial, control, unlock, and stop conformance", async () => {
    const native = createFakeAudioRuntime();
    const report = await runAudioBackendConformance({
      createBackend: () =>
        createPhaserAudioBackend({ id: "phaser.audio", runtime: () => native.runtime })
    });

    expect(report.checks).toHaveLength(10);
    expect(report.stoppedPlaybackInstances).toBe(1);
    expect(native.starts).toHaveLength(1);
    expect(native.starts[0]?.tracks).toHaveLength(1);
    expect(native.stops).toEqual([["playback.0"]]);
    expect(native.updates).toContainEqual(expect.objectContaining({ instanceId: "playback.0" }));
  });

  it("maps native unlock failure without throwing", async () => {
    const native = createFakeAudioRuntime(false);
    const backend = createPhaserAudioBackend({
      id: "phaser.audio",
      runtime: () => native.runtime
    });
    expect(await backend.unlock()).toBe(false);
    expect(backend.snapshot().unlocked).toBe(false);
  });

  it("maps layered events, spatial mix and instance controls to one native instance", () => {
    const native = createFakeAudioRuntime();
    const audio = createGameAudio({
      backend: createPhaserAudioBackend({ id: "phaser.audio", runtime: () => native.runtime }),
      sfx: [
        {
          id: "event.layered",
          spatial: { minDistance: 0, maxDistance: 10, rolloff: "linear" },
          layers: [
            {
              id: "body",
              clips: [{ id: "body", asset: { assetId: "audio.body", type: "audio" } }]
            },
            {
              id: "detail",
              clips: [
                {
                  id: "detail",
                  asset: { assetId: "audio.detail", type: "audio" },
                  volume: 0.5
                }
              ]
            }
          ]
        }
      ]
    });
    audio.spatial.setEmitter({ id: "enemy", transform: { position: { x: 5, y: 0 } } });
    const played = audio.sfx.play("event.layered", { emitterId: "enemy", fadeInMs: 50 });
    if (played.status !== "playing" || !("handle" in played)) {
      throw new Error("Expected layered playback");
    }
    played.handle.pause();
    played.handle.resume();
    played.handle.seek(500);
    played.handle.set({ volume: 0.8, pitch: 1.2, pan: 0.1 }, 25);

    expect(native.starts[0]).toMatchObject({
      instanceId: played.handle.id,
      volume: 0.5,
      pan: 0.5,
      fadeInMs: 50
    });
    expect(native.starts[0]?.tracks).toHaveLength(2);
    expect(native.pauses).toEqual([[played.handle.id]]);
    expect(native.resumes).toEqual([[played.handle.id]]);
    expect(native.seeks).toEqual([{ instanceId: played.handle.id, positionMs: 500 }]);
    expect(native.updates.at(-1)).toMatchObject({
      instanceId: played.handle.id,
      state: { volume: 0.4, rate: 1.2, pan: 0.6, transitionMs: 25 }
    });
  });

  it("mixes against an explicit listener instead of the implicit origin fallback", () => {
    const native = createFakeAudioRuntime();
    const audio = createGameAudio({
      backend: createPhaserAudioBackend({ id: "phaser.audio", runtime: () => native.runtime }),
      sfx: [
        {
          id: "event.spatial",
          spatial: { minDistance: 0, maxDistance: 10, rolloff: "linear" },
          layers: [
            {
              id: "main",
              clips: [{ id: "main", asset: { assetId: "audio.spatial", type: "audio" } }]
            }
          ]
        }
      ]
    });
    audio.spatial.setListener({
      id: "player.listener",
      transform: { position: { x: 900, y: 500 } }
    });
    audio.spatial.setEmitter({
      id: "enemy",
      transform: { position: { x: 900, y: 500 } }
    });

    expect(audio.sfx.play("event.spatial", { emitterId: "enemy" }).status).toBe("playing");
    expect(native.starts[0]).toMatchObject({ volume: 1, pan: 0 });

    audio.spatial.setListener({
      id: "player.listener",
      transform: { position: { x: 895, y: 500 } }
    });
    expect(native.updates.at(-1)).toMatchObject({
      state: { volume: 0.5, pan: 0.5 }
    });
  });
});

describe("Phaser audio runtime unlock", () => {
  it("waits for Phaser's asynchronous unlocked event", async () => {
    const listeners = new Set<() => void>();
    const soundManager = {
      locked: true,
      unlock() {
        setTimeout(() => {
          soundManager.locked = false;
          for (const listener of listeners) {
            listener();
          }
        }, 0);
      },
      once(_eventName: string, listener: () => void) {
        listeners.add(listener);
      },
      off(_eventName: string, listener: () => void) {
        listeners.delete(listener);
      }
    };

    await expect(unlockPhaserSoundManager(soundManager, 50)).resolves.toBe(true);
    expect(listeners.size).toBe(0);
  });

  it("reports failure when Phaser stays locked", async () => {
    await expect(
      unlockPhaserSoundManager(
        {
          locked: true,
          unlock() {},
          once() {},
          off() {}
        },
        0
      )
    ).resolves.toBe(false);
  });
});

describe("Phaser audio runtime fades", () => {
  it("kills an existing sound tween before installing its replacement", () => {
    const sound = { id: "music.sound" };
    const lifecycle: string[] = [];
    const configs: Record<string, unknown>[] = [];
    const tweenManager = {
      killTweensOf(target: unknown) {
        expect(target).toBe(sound);
        lifecycle.push("kill");
      },
      add(config: Record<string, unknown>) {
        configs.push(config);
        lifecycle.push("add");
      }
    };

    expect(
      replacePhaserSoundVolumeTween(tweenManager, sound, {
        targets: { id: "stale-target" },
        volume: 1,
        duration: 2_400
      })
    ).toBe(true);
    expect(
      replacePhaserSoundVolumeTween(tweenManager, sound, {
        volume: 0,
        duration: 250
      })
    ).toBe(true);

    expect(lifecycle).toEqual(["kill", "add", "kill", "add"]);
    expect(configs).toHaveLength(2);
    expect(configs.every((config) => config.targets === sound)).toBe(true);
  });
});

describe("createPhaserAnimationPlaybackAdapter", () => {
  it("binds Animator frames to existing renderer objects without owning a scene", () => {
    const played: Array<[string, boolean | undefined]> = [];
    let progress = 0;
    let timeScale = 0;
    let stopped = false;
    const target = {
      play(animationId: string, ignoreIfPlaying?: boolean) {
        played.push([animationId, ignoreIfPlaying]);
      },
      stop() {
        stopped = true;
      },
      anims: {
        get timeScale() {
          return timeScale;
        },
        set timeScale(value: number) {
          timeScale = value;
        },
        setProgress(value: number) {
          progress = value;
        }
      }
    };
    const adapter = createPhaserAnimationPlaybackAdapter({
      id: "phaser.animation",
      runtime: () =>
        ({
          gameObject: () => target,
          node: () => target
        }) as never
    });
    adapter.bind(
      "hero",
      {
        id: "binding.hero",
        graph: { type: "animator.graph", id: "graph.hero" },
        clips: { run: { type: "animation.clip", id: "clip.run" } }
      },
      "render.hero"
    );
    adapter.apply("hero", {
      controllerId: "hero",
      renderObjectId: "render.hero",
      generation: 0,
      timestamp: 100,
      layers: [
        {
          layerId: "base",
          clipId: "clip.run",
          backendClip: "hero.run",
          asset: { assetId: "hero.atlas", type: "atlas" },
          kind: "state",
          timeMs: 400,
          normalizedTime: 0.5,
          speed: 1.25,
          loop: true,
          weight: 1,
          mode: "replace",
          seek: true
        }
      ],
      markers: [],
      reasons: ["transition"]
    });

    expect(played).toEqual([["hero.run", true]]);
    expect(progress).toBe(0.5);
    expect(timeScale).toBe(1.25);

    adapter.apply("hero", {
      controllerId: "hero",
      renderObjectId: "render.hero",
      generation: 0,
      timestamp: 116,
      layers: [
        {
          layerId: "base",
          clipId: "clip.run",
          backendClip: "hero.run",
          asset: { assetId: "hero.atlas", type: "atlas" },
          kind: "state",
          timeMs: 412,
          normalizedTime: 0.515,
          speed: 0.75,
          loop: true,
          weight: 1,
          mode: "replace",
          seek: false
        }
      ],
      markers: [],
      reasons: ["parameter:speed"]
    });

    expect(played).toEqual([
      ["hero.run", true],
      ["hero.run", true]
    ]);
    expect(progress).toBe(0.5);
    expect(timeScale).toBe(0.75);
    adapter.unbind("hero");
    expect(stopped).toBe(true);
    expect(adapter.snapshot()).toMatchObject({ boundControllers: 0, appliedFrames: 2 });
  });

  it("rejects unsupported weighted or additive layers before native playback", () => {
    const played: string[] = [];
    const target = {
      play(animationId: string) {
        played.push(animationId);
      }
    };
    const adapter = createPhaserAnimationPlaybackAdapter({
      id: "phaser.animation",
      runtime: () =>
        ({
          gameObject: () => target,
          node: () => target
        }) as never
    });
    adapter.bind(
      "hero",
      {
        id: "binding.hero",
        graph: { type: "animator.graph", id: "graph.hero" },
        clips: { run: { type: "animation.clip", id: "clip.run" } }
      },
      "render.hero"
    );

    expect(() =>
      adapter.apply("hero", {
        controllerId: "hero",
        renderObjectId: "render.hero",
        generation: 0,
        timestamp: 100,
        layers: [
          {
            layerId: "base",
            clipId: "clip.run",
            asset: { assetId: "hero.atlas", type: "atlas" },
            kind: "state",
            timeMs: 0,
            normalizedTime: 0,
            speed: 1,
            loop: true,
            weight: 1,
            mode: "replace",
            seek: true
          },
          {
            layerId: "overlay",
            clipId: "clip.run",
            asset: { assetId: "hero.atlas", type: "atlas" },
            kind: "state",
            timeMs: 0,
            normalizedTime: 0,
            speed: 1,
            loop: true,
            weight: 0.5,
            mode: "replace",
            seek: true
          }
        ],
        markers: [],
        reasons: ["bind"]
      })
    ).toThrowError(/does not support weighted or additive layers/);
    expect(played).toEqual([]);

    expect(() =>
      adapter.apply("hero", {
        controllerId: "hero",
        renderObjectId: "render.hero",
        generation: 0,
        timestamp: 116,
        layers: [
          {
            layerId: "overlay",
            clipId: "clip.run",
            asset: { assetId: "hero.atlas", type: "atlas" },
            kind: "state",
            timeMs: 0,
            normalizedTime: 0,
            speed: 1,
            loop: true,
            weight: 1,
            mode: "additive",
            seek: true
          }
        ],
        markers: [],
        reasons: ["bind"]
      })
    ).toThrowError(/does not support weighted or additive layers/);
    expect(played).toEqual([]);
    expect(adapter.snapshot()).toMatchObject({ appliedFrames: 0, boundControllers: 1 });
    adapter.unbind("hero");
  });
});

describe("createPhaserDriverAssetLoader", () => {
  it("loads atlas and audio assets and registers animation manifests", async () => {
    const calls: string[] = [];
    const runtime: PhaserDriverAssetRuntime = {
      unloadAsset() {},
      hasTexture: () => false,
      async loadImage() {
        calls.push("image");
      },
      async loadSpritesheet() {
        calls.push("spritesheet");
      },
      async loadAtlas(assetId, textureUrl, dataUrl, format) {
        calls.push(`atlas:${assetId}:${textureUrl}:${dataUrl}:${format}`);
      },
      hasAudio: () => false,
      async loadAudio(assetId, urls) {
        calls.push(`audio:${assetId}:${urls.join(",")}`);
      },
      createAnimations(textureId, animations) {
        calls.push(
          `animations:${textureId}:${animations.map((animation) => animation.id).join(",")}`
        );
      }
    };
    const loader = createPhaserDriverAssetLoader({ id: "phaser.assets", runtime: () => runtime });
    const atlas = {
      id: "character",
      type: "atlas" as const,
      source: { type: "url" as const, url: "/character.png" },
      atlas: {
        dataSource: { type: "url" as const, url: "/character.json" },
        format: "json-hash" as const
      },
      animations: [
        {
          id: "character.run",
          frames: { start: 0, end: 5 },
          frameRate: 12,
          repeat: -1
        }
      ]
    };
    const audio = {
      id: "rifle",
      type: "audio" as const,
      source: { type: "url" as const, url: "/rifle.ogg" },
      audio: {
        sources: [
          { type: "url" as const, url: "/rifle.ogg" },
          { type: "url" as const, url: "/rifle.mp3" }
        ]
      }
    };

    expect(loader.supports(atlas)).toBe(true);
    expect(loader.supports(audio)).toBe(true);
    await loader.load(atlas);
    await loader.load(audio);

    expect(calls).toEqual([
      "atlas:character:/character.png:/character.json:json-hash",
      "animations:character:character.run",
      "audio:rifle:/rifle.ogg,/rifle.mp3"
    ]);
  });

  it("does not reload cached textures but still ensures native animations", async () => {
    const calls: string[] = [];
    const runtime: PhaserDriverAssetRuntime = {
      unloadAsset() {},
      hasTexture: () => true,
      async loadImage() {
        calls.push("image");
      },
      async loadSpritesheet() {
        calls.push("spritesheet");
      },
      async loadAtlas() {
        calls.push("atlas");
      },
      hasAudio: () => true,
      async loadAudio() {
        calls.push("audio");
      },
      createAnimations(_textureId, animations) {
        calls.push(...animations.map((animation) => animation.id));
      }
    };
    const loader = createPhaserDriverAssetLoader({ id: "phaser.assets", runtime: () => runtime });
    await loader.load({
      id: "cached",
      type: "spritesheet",
      source: { type: "url", url: "/cached.png" },
      frame: { width: 32, height: 32 },
      animations: [{ id: "cached.idle", frames: [0] }]
    });

    expect(calls).toEqual(["cached.idle"]);
  });
});

describe("createPhaserDriverCameraAdapter", () => {
  it("uses the native center operation when the runtime provides it", () => {
    const calls: Array<{ x: number; y: number }> = [];
    const camera = createPhaserDriverCameraAdapter({
      runtime: {
        setScroll() {},
        centerOn(x, y) {
          calls.push({ x, y });
        },
        setZoom() {},
        setRotation() {}
      }
    });

    camera.applyCameraState({
      mode: "free",
      x: 200,
      y: 120,
      zoom: 2,
      rotation: 0,
      viewport: { width: 100, height: 80 },
      minZoom: 0.5,
      maxZoom: 4
    });

    expect(calls.at(-1)).toEqual({ x: 200, y: 120 });
    expect(camera.worldToScreen({ x: 200, y: 120 })).toEqual({ x: 50, y: 40 });
    expect(camera.screenToWorld({ x: 50, y: 40 })).toEqual({ x: 200, y: 120 });
  });

  it("maps centered camera state to Phaser scroll for legacy runtimes", () => {
    const calls: Array<{ x: number; y: number }> = [];
    const camera = createPhaserDriverCameraAdapter({
      runtime: {
        setScroll(x, y) {
          calls.push({ x, y });
        },
        setZoom() {},
        setRotation() {}
      }
    });

    camera.applyCameraState({
      mode: "free",
      x: 200,
      y: 120,
      zoom: 2,
      rotation: 0,
      viewport: { width: 100, height: 80 },
      minZoom: 0.5,
      maxZoom: 4
    });

    expect(calls.at(-1)).toEqual({ x: 175, y: 100 });
    expect(camera.worldToScreen({ x: 200, y: 120 })).toEqual({ x: 50, y: 40 });
    expect(camera.screenToWorld({ x: 50, y: 40 })).toEqual({ x: 200, y: 120 });
  });
});

function createFakeAudioRuntime(unlockSucceeds = true) {
  const starts: Array<Parameters<PhaserDriverAudioRuntime["start"]>[0]> = [];
  const stops: string[][] = [];
  const pauses: string[][] = [];
  const resumes: string[][] = [];
  const seeks: Array<{ instanceId: string; positionMs: number }> = [];
  const updates: Array<{
    instanceId: string;
    state: Parameters<PhaserDriverAudioRuntime["updateInstance"]>[1];
  }> = [];
  let unlocked = false;
  let suspended = false;
  const active = new Map<string, number>();
  const runtime: PhaserDriverAudioRuntime = {
    start(input) {
      starts.push(input);
      active.set(input.instanceId, input.tracks.length);
      return true;
    },
    stop(instanceIds) {
      stops.push([...instanceIds]);
      for (const instanceId of instanceIds) {
        active.delete(instanceId);
      }
    },
    pause(instanceIds) {
      pauses.push([...instanceIds]);
    },
    resume(instanceIds) {
      resumes.push([...instanceIds]);
    },
    seek(instanceId, positionMs) {
      seeks.push({ instanceId, positionMs });
      return active.has(instanceId);
    },
    updateInstance(instanceId, state) {
      updates.push({ instanceId, state: { ...state } });
    },
    unlock() {
      unlocked = unlockSucceeds;
      return unlocked;
    },
    suspend() {
      suspended = true;
    },
    resumeOutput() {
      suspended = false;
    },
    snapshot() {
      return {
        activePlaybackInstances: active.size,
        nativePlaybackCount: [...active.values()].reduce((total, tracks) => total + tracks, 0),
        unlocked,
        suspended
      };
    },
    destroy() {
      active.clear();
    }
  };
  return { runtime, starts, stops, pauses, resumes, seeks, updates };
}
