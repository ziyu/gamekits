import type { DriverBootContext } from "@gamekits/driver-core";
import type { PhaserRendererRuntime } from "@gamekits/renderer-phaser";
import type { PhaserDriverAssetRuntime } from "./assets";
import type { PhaserDriverAudioRuntime } from "./audio";
import type { PhaserDriverCameraRuntime } from "./camera";
import type { PhaserDriverInputRuntime } from "./input-source";
import type { ResolvedPhaserDriverRenderOptions } from "./render-options";

export type PhaserDriverRuntimeOptions = {
  backgroundColor: string;
  render: ResolvedPhaserDriverRenderOptions;
};

export type PhaserDriverRuntime = {
  view: HTMLCanvasElement;
  pixelRatio: number;
  renderer: PhaserRendererRuntime;
  assets: PhaserDriverAssetRuntime;
  audio: PhaserDriverAudioRuntime;
  camera: PhaserDriverCameraRuntime;
  input: PhaserDriverInputRuntime;
  diagnostics(): {
    pixelRatio: number;
    canvas: { width: number; height: number };
    camera: {
      width: number;
      height: number;
      zoom: number;
      scrollX: number;
      scrollY: number;
    };
    audio: {
      activePlaybackInstances: number;
      nativePlaybackCount: number;
      unlocked: boolean;
      suspended: boolean;
    };
  };
  resize(width: number, height: number): void;
  destroy(): void;
};

export async function createPhaserDriverRuntime(
  ctx: DriverBootContext,
  options: PhaserDriverRuntimeOptions
): Promise<PhaserDriverRuntime> {
  const Phaser = await import("phaser");
  const render = options.render;
  let sceneRef: any;
  let gameRef: any;

  const ready = new Promise<void>((resolve) => {
    const captureScene = (scene: unknown): void => {
      sceneRef = scene;
      resolve();
    };

    class GameKitsScene extends Phaser.Scene {
      constructor() {
        super("gamekits-driver");
      }

      create() {
        captureScene(this);
      }
    }

    const gameConfig: any = {
      type: Phaser.AUTO,
      width: internalSize(ctx.width, render.pixelRatio),
      height: internalSize(ctx.height, render.pixelRatio),
      backgroundColor: options.backgroundColor,
      scene: GameKitsScene,
      render: {
        antialias: render.antialias,
        antialiasGL: render.antialiasGL,
        roundPixels: render.roundPixels,
        mipmapFilter: render.mipmapFilter
      },
      audio: {
        noAudio: false
      },
      scale: {
        mode: Phaser.Scale.NONE
      }
    };
    if (ctx.container !== undefined) {
      gameConfig.parent = ctx.container;
    }

    gameRef = new Phaser.Game(gameConfig);
  });

  await ready;
  const view = gameRef.canvas as HTMLCanvasElement;
  applyLogicalCanvasSize(gameRef, view, ctx.width, ctx.height);
  const audioRuntime = createPhaserAudioRuntime(sceneRef);
  const ownedAnimations = new Map<string, Set<string>>();

  return {
    view,
    pixelRatio: render.pixelRatio,
    renderer: {
      view,
      scene: sceneRef,
      resize(width, height) {
        resizeGame(gameRef, view, width, height, render.pixelRatio);
      }
    },
    assets: {
      hasTexture(id) {
        return sceneRef.textures.exists(id);
      },
      loadImage(assetId, url) {
        return loadPhaserAsset(
          sceneRef,
          assetId,
          () => sceneRef.textures.exists(assetId),
          () => {
            sceneRef.load.image(assetId, url, { timeout: 30_000 });
          }
        );
      },
      loadSpritesheet(assetId, url, frame) {
        return loadPhaserAsset(
          sceneRef,
          assetId,
          () => sceneRef.textures.exists(assetId),
          () => {
            sceneRef.load.spritesheet(
              assetId,
              url,
              {
                frameWidth: frame.width,
                frameHeight: frame.height,
                margin: frame.margin ?? 0,
                spacing: frame.spacing ?? 0
              },
              { timeout: 30_000 }
            );
          }
        );
      },
      loadAtlas(assetId, textureUrl, dataUrl) {
        return loadPhaserAsset(
          sceneRef,
          assetId,
          () => sceneRef.textures.exists(assetId),
          () => {
            sceneRef.load.atlas(
              assetId,
              textureUrl,
              dataUrl,
              { timeout: 30_000 },
              { timeout: 30_000 }
            );
          }
        );
      },
      hasAudio(id) {
        return sceneRef.cache.audio.exists(id);
      },
      loadAudio(assetId, urls) {
        return loadPhaserAsset(
          sceneRef,
          assetId,
          () => sceneRef.cache.audio.exists(assetId),
          () => {
            sceneRef.load.audio(assetId, urls, undefined, { timeout: 30_000 });
          }
        );
      },
      createAnimations(textureId, animations) {
        for (const animation of animations) {
          if (sceneRef.anims.exists(animation.id)) {
            continue;
          }
          const keys = ownedAnimations.get(textureId) ?? new Set<string>();
          keys.add(animation.id);
          ownedAnimations.set(textureId, keys);
          const frames = animationFrames(sceneRef, textureId, animation.frames);
          sceneRef.anims.create({
            key: animation.id,
            frames,
            ...(animation.durationMs === undefined
              ? { frameRate: animation.frameRate ?? 12 }
              : { duration: animation.durationMs }),
            repeat: animation.repeat ?? 0,
            yoyo: animation.yoyo ?? false
          });
        }
      },
      unloadAsset(assetId, type) {
        if (type === "audio") audioRuntime.releaseAsset(assetId);
        releasePhaserAsset(sceneRef, ownedAnimations, assetId, type);
      }
    },
    audio: audioRuntime,
    camera: {
      setScroll(x, y) {
        sceneRef.cameras.main.setScroll(x, y);
      },
      centerOn(x, y) {
        sceneRef.cameras.main.centerOn(x, y);
      },
      setZoom(zoom) {
        sceneRef.cameras.main.setZoom(zoom * render.pixelRatio);
      },
      setRotation(rotation) {
        sceneRef.cameras.main.setRotation(rotation);
      }
    },
    input: {
      coordinateScale: render.pixelRatio,
      on(eventName, listener) {
        inputEmitter(sceneRef, eventName)?.on(eventName, listener);
      },
      off(eventName, listener) {
        inputEmitter(sceneRef, eventName)?.off(eventName, listener);
      }
    },
    diagnostics() {
      const camera = sceneRef.cameras.main;
      return {
        pixelRatio: render.pixelRatio,
        canvas: { width: view.width, height: view.height },
        camera: {
          width: camera.width,
          height: camera.height,
          zoom: camera.zoom,
          scrollX: camera.scrollX,
          scrollY: camera.scrollY
        },
        audio: audioRuntime.snapshot()
      };
    },
    resize(width, height) {
      resizeGame(gameRef, view, width, height, render.pixelRatio);
    },
    destroy() {
      audioRuntime.destroy();
      gameRef.destroy(true);
    }
  };
}

export function createPhaserAudioRuntime(scene: any): PhaserDriverAudioRuntime & {
  releaseAsset(assetId: string): void;
} {
  type NativeTrack = {
    assetId: string;
    sound: any;
    baseVolume: number;
    basePitch: number;
    complete: () => void;
  };
  type NativeInstance = {
    tracks: Map<string, NativeTrack>;
    onEnded(reason: "completed" | "stopped" | "failed"): void;
    paused: boolean;
    stopping: boolean;
  };
  const instances = new Map<string, NativeInstance>();
  let suspended = false;

  return {
    start(input) {
      if (
        instances.has(input.instanceId) ||
        input.tracks.length === 0 ||
        input.tracks.some((track) => !scene.cache.audio.exists(track.asset.assetId))
      ) {
        return false;
      }
      const instance: NativeInstance = {
        tracks: new Map(),
        onEnded: input.onEnded,
        paused: false,
        stopping: false
      };
      instances.set(input.instanceId, instance);
      for (const track of input.tracks) {
        const targetVolume = track.volume * input.volume;
        const sound = scene.sound.add(track.asset.assetId, {
          volume: input.fadeInMs > 0 ? 0 : targetVolume,
          rate: track.pitch * input.rate,
          loop: track.loop,
          pan: input.pan
        });
        const complete = () => {
          cancelPhaserSoundVolumeTweens(scene.tweens, sound);
          sound.destroy?.();
          instance.tracks.delete(track.id);
          if (!instance.stopping && instance.tracks.size === 0) {
            instances.delete(input.instanceId);
            instance.onEnded("completed");
          }
        };
        sound.once?.("complete", complete);
        const played =
          sound.play?.({
            delay: input.delayMs / 1_000,
            seek: track.startOffsetMs / 1_000
          }) !== false;
        if (!played) {
          sound.off?.("complete", complete);
          cancelPhaserSoundVolumeTweens(scene.tweens, sound);
          sound.stop?.();
          sound.destroy?.();
          destroyNativeInstance(input.instanceId, instance);
          return false;
        }
        instance.tracks.set(track.id, {
          assetId: track.asset.assetId,
          sound,
          baseVolume: track.volume,
          basePitch: track.pitch,
          complete
        });
        if (suspended) {
          sound.pause?.();
        }
        if (input.fadeInMs > 0 && scene.tweens?.add !== undefined) {
          replacePhaserSoundVolumeTween(scene.tweens, sound, {
            volume: targetVolume,
            delay: input.delayMs,
            duration: input.fadeInMs
          });
        }
      }
      return true;
    },
    releaseAsset(assetId) {
      this.stop(
        [...instances].flatMap(([id, instance]) =>
          [...instance.tracks.values()].some((track) => track.assetId === assetId) ? [id] : []
        ),
        0
      );
    },
    stop(instanceIds, fadeMs) {
      for (const instanceId of instanceIds) {
        const instance = instances.get(instanceId);
        if (instance === undefined) {
          continue;
        }
        instance.stopping = true;
        const tracks = [...instance.tracks.values()];
        if (fadeMs > 0 && scene.tweens?.add !== undefined && tracks.length > 0) {
          let remaining = tracks.length;
          for (const track of tracks) {
            track.sound.off?.("complete", track.complete);
            replacePhaserSoundVolumeTween(scene.tweens, track.sound, {
              volume: 0,
              duration: fadeMs,
              onComplete() {
                cancelPhaserSoundVolumeTweens(scene.tweens, track.sound);
                track.sound.stop?.();
                track.sound.destroy?.();
                remaining -= 1;
                if (remaining === 0) {
                  instances.delete(instanceId);
                  instance.tracks.clear();
                  instance.onEnded("stopped");
                }
              }
            });
          }
        } else {
          instances.delete(instanceId);
          for (const track of tracks) {
            track.sound.off?.("complete", track.complete);
            cancelPhaserSoundVolumeTweens(scene.tweens, track.sound);
            track.sound.stop?.();
            track.sound.destroy?.();
          }
          instance.tracks.clear();
          instance.onEnded("stopped");
        }
      }
    },
    pause(instanceIds) {
      for (const instanceId of instanceIds) {
        const instance = instances.get(instanceId);
        if (instance === undefined) {
          continue;
        }
        instance.paused = true;
        for (const track of instance.tracks.values()) {
          track.sound.pause?.();
        }
      }
    },
    resume(instanceIds) {
      for (const instanceId of instanceIds) {
        const instance = instances.get(instanceId);
        if (instance === undefined) {
          continue;
        }
        instance.paused = false;
        if (!suspended) {
          for (const track of instance.tracks.values()) {
            track.sound.resume?.();
          }
        }
      }
    },
    seek(instanceId, positionMs) {
      const instance = instances.get(instanceId);
      if (instance === undefined) {
        return false;
      }
      for (const track of instance.tracks.values()) {
        track.sound.setSeek?.(positionMs / 1_000);
      }
      return true;
    },
    updateInstance(instanceId, state) {
      const instance = instances.get(instanceId);
      if (instance === undefined) {
        return;
      }
      const tracks = new Map(state.tracks.map((track) => [track.id, track]));
      for (const [trackId, track] of instance.tracks) {
        const nextTrack = tracks.get(trackId);
        if (nextTrack !== undefined) {
          track.baseVolume = nextTrack.volume;
          track.basePitch = nextTrack.pitch;
        }
        const volume = track.baseVolume * state.volume;
        if (state.transitionMs > 0 && scene.tweens?.add !== undefined) {
          replacePhaserSoundVolumeTween(scene.tweens, track.sound, {
            volume,
            duration: state.transitionMs
          });
        } else {
          cancelPhaserSoundVolumeTweens(scene.tweens, track.sound);
          track.sound.setVolume?.(volume);
        }
        track.sound.setRate?.(track.basePitch * state.rate);
        track.sound.setPan?.(state.pan);
        track.sound.setLoop?.(state.loop);
      }
    },
    unlock() {
      return unlockPhaserSoundManager(scene.sound);
    },
    suspend() {
      if (suspended) {
        return;
      }
      suspended = true;
      for (const instance of instances.values()) {
        if (!instance.paused) {
          for (const track of instance.tracks.values()) {
            track.sound.pause?.();
          }
        }
      }
    },
    resumeOutput() {
      if (!suspended) {
        return;
      }
      suspended = false;
      for (const instance of instances.values()) {
        if (!instance.paused) {
          for (const track of instance.tracks.values()) {
            track.sound.resume?.();
          }
        }
      }
    },
    snapshot() {
      return {
        activePlaybackInstances: instances.size,
        nativePlaybackCount: [...instances.values()].reduce(
          (total, instance) => total + instance.tracks.size,
          0
        ),
        unlocked: !scene.sound.locked,
        suspended
      };
    },
    destroy() {
      for (const [instanceId, instance] of instances) {
        destroyNativeInstance(instanceId, instance);
      }
      instances.clear();
    }
  };

  function destroyNativeInstance(instanceId: string, instance: NativeInstance): void {
    instances.delete(instanceId);
    for (const track of instance.tracks.values()) {
      track.sound.off?.("complete", track.complete);
      cancelPhaserSoundVolumeTweens(scene.tweens, track.sound);
      track.sound.stop?.();
      track.sound.destroy?.();
    }
    instance.tracks.clear();
  }
}

type PhaserTweenManagerLike = {
  add?(config: Record<string, unknown>): unknown;
  killTweensOf?(target: unknown): unknown;
};

export function replacePhaserSoundVolumeTween(
  tweenManager: PhaserTweenManagerLike | undefined,
  sound: unknown,
  config: Record<string, unknown>
): boolean {
  if (tweenManager?.add === undefined) {
    return false;
  }
  cancelPhaserSoundVolumeTweens(tweenManager, sound);
  tweenManager.add({ ...config, targets: sound });
  return true;
}

function cancelPhaserSoundVolumeTweens(
  tweenManager: PhaserTweenManagerLike | undefined,
  sound: unknown
): void {
  tweenManager?.killTweensOf?.(sound);
}

type PhaserSoundManagerUnlockTarget = {
  locked: boolean;
  unlock?(): void;
  once?(eventName: string, listener: () => void): void;
  off?(eventName: string, listener: () => void): void;
};

export function unlockPhaserSoundManager(
  soundManager: PhaserSoundManagerUnlockTarget,
  timeoutMs = 1_000
): Promise<boolean> | boolean {
  if (!soundManager.locked) {
    return true;
  }
  if (soundManager.once === undefined) {
    soundManager.unlock?.();
    return !soundManager.locked;
  }

  return new Promise<boolean>((resolve) => {
    let settled = false;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const onUnlocked = (): void => finish(true);
    const finish = (unlocked: boolean): void => {
      if (settled) {
        return;
      }
      settled = true;
      if (timeout !== undefined) {
        clearTimeout(timeout);
      }
      soundManager.off?.("unlocked", onUnlocked);
      resolve(unlocked);
    };

    soundManager.once?.("unlocked", onUnlocked);
    try {
      soundManager.unlock?.();
    } catch {
      finish(false);
      return;
    }
    if (!soundManager.locked) {
      finish(true);
      return;
    }
    timeout = setTimeout(() => finish(!soundManager.locked), Math.max(0, timeoutMs));
  });
}

function internalSize(logicalSize: number, pixelRatio: number): number {
  return Math.max(1, Math.round(logicalSize * pixelRatio));
}

function applyLogicalCanvasSize(
  game: { scale: { refresh?(): void } },
  view: HTMLCanvasElement,
  width: number,
  height: number
): void {
  view.style.width = `${width}px`;
  view.style.height = `${height}px`;
  game.scale.refresh?.();
}

function resizeGame(
  game: { scale: { resize(width: number, height: number): void; refresh?(): void } },
  view: HTMLCanvasElement,
  width: number,
  height: number,
  pixelRatio: number
): void {
  game.scale.resize(internalSize(width, pixelRatio), internalSize(height, pixelRatio));
  applyLogicalCanvasSize(game, view, width, height);
}

function inputEmitter(
  scene: any,
  eventName: string
):
  | {
      on(eventName: string, listener: (...args: unknown[]) => void): void;
      off(eventName: string, listener: (...args: unknown[]) => void): void;
    }
  | undefined {
  if (eventName === "keydown" || eventName === "keyup") {
    return scene.input.keyboard;
  }

  return scene.input;
}

export function loadPhaserAsset(
  scene: any,
  assetId: string,
  exists: () => boolean,
  enqueue: () => void
): Promise<void> {
  if (exists()) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    const loader = scene.load;
    const onShutdown = () => {
      cleanup();
      reject(new Error(`Phaser scene shut down while loading ${assetId}`));
    };
    let failed = false;
    const cleanup = () => {
      loader.off("complete", onComplete);
      loader.off("loaderror", onError);
      scene.events?.off("shutdown", onShutdown);
    };
    const onComplete = () => {
      cleanup();
      if (failed || !exists()) reject(new Error(`Failed to load Phaser asset: ${assetId}`));
      else resolve();
    };
    const onError = (file: { key?: string }) => {
      if (file.key !== undefined && file.key !== assetId) {
        return;
      }
      failed = true;
    };

    scene.events?.once("shutdown", onShutdown);
    loader.once("complete", onComplete);
    loader.on("loaderror", onError);
    try {
      enqueue();
      loader.start();
    } catch (error) {
      cleanup();
      reject(error);
    }
  });
}

function animationFrames(
  scene: any,
  textureId: string,
  frames:
    | number[]
    | string[]
    | {
        start: number;
        end: number;
        prefix?: string | undefined;
        suffix?: string | undefined;
        zeroPad?: number | undefined;
      }
): unknown[] {
  if (Array.isArray(frames)) {
    return frames.map((frame) => ({ key: textureId, frame }));
  }
  if (frames.prefix !== undefined || frames.suffix !== undefined || frames.zeroPad !== undefined) {
    return scene.anims.generateFrameNames(textureId, {
      start: frames.start,
      end: frames.end,
      prefix: frames.prefix ?? "",
      suffix: frames.suffix ?? "",
      zeroPad: frames.zeroPad ?? 0
    });
  }
  return scene.anims.generateFrameNumbers(textureId, {
    start: frames.start,
    end: frames.end
  });
}

export function releasePhaserAsset(
  scene: any,
  ownedAnimations: Map<string, Set<string>>,
  assetId: string,
  type: string
): void {
  if (type === "audio") {
    for (const sound of scene.sound.getAll(assetId)) sound.destroy();
    scene.cache.audio.remove(assetId);
  } else {
    for (const id of ownedAnimations.get(assetId) ?? []) scene.anims.remove(id);
    ownedAnimations.delete(assetId);
    if (scene.textures.exists(assetId)) scene.textures.remove(assetId);
  }
}
