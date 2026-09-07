import { describe, expect, it } from "vitest";
import { defineRendererConformanceTests } from "@gamekits/test-utils";
import { createPhaserRenderer, type PhaserRendererRuntime } from "../src";

type FakeNativeObject = {
  id?: string;
  type: "container" | "sprite" | "particle";
  textureId?: string;
  x: number;
  y: number;
  z?: number;
  displayWidth: number;
  displayHeight: number;
  destroyed: boolean;
  children: FakeNativeObject[];
  data: Map<string, unknown>;
  playedAnimations: string[];
  stopped: boolean;
  emitting: boolean;
  bursts: Array<{ quantity: number; x?: number; y?: number }>;
  animationProgress: number;
  setData(key: string, value: unknown): void;
  getData(key: string): unknown;
  setPosition(x: number, y: number, z?: number): void;
  setRotation(rotation: number): void;
  setDisplaySize(width: number, height: number): void;
  setScale(scaleX: number, scaleY: number): void;
  setAlpha(alpha: number): void;
  setVisible(visible: boolean): void;
  setDepth(depth: number): void;
  setTint(tint: number): void;
  setTintMode(tintMode: number): void;
  add(child: FakeNativeObject): void;
  play(animationId: string, ignoreIfPlaying?: boolean): void;
  stop(): void;
  start(): void;
  explode(quantity: number, x?: number, y?: number): void;
  anims: { setProgress(progress: number): void };
  destroy(): void;
};

type FakePhaserRuntime = {
  runtime: PhaserRendererRuntime;
  created: FakeNativeObject[];
  textures: Set<string>;
  resizeCalls: Array<{ width: number; height: number }>;
};

function createFakePhaserRuntime(): FakePhaserRuntime {
  const textures = new Set<string>();
  const created: FakeNativeObject[] = [];
  const resizeCalls: Array<{ width: number; height: number }> = [];
  const scene = {
    textures: {
      exists(id: string) {
        return textures.has(id);
      }
    },
    make: {
      graphics() {
        return {
          fillStyle() {},
          fillRect() {},
          lineStyle() {},
          strokeRect() {},
          generateTexture(id: string) {
            textures.add(id);
          },
          destroy() {}
        };
      }
    },
    add: {
      container(x: number, y: number) {
        const object = createNativeObject("container", x, y);
        created.push(object);
        return object;
      },
      sprite(x: number, y: number, textureId: string) {
        const object = createNativeObject("sprite", x, y, textureId);
        created.push(object);
        return object;
      },
      particles(x: number, y: number, textureId: string, config: Record<string, unknown>) {
        const object = createNativeObject("particle", x, y, textureId);
        object.setData("config", config);
        created.push(object);
        return object;
      }
    }
  };

  return {
    runtime: {
      view: { remove() {} } as unknown as HTMLElement,
      scene,
      resize(width, height) {
        resizeCalls.push({ width, height });
      }
    },
    created,
    textures,
    resizeCalls
  };
}

function createNativeObject(
  type: FakeNativeObject["type"],
  x: number,
  y: number,
  textureId?: string
): FakeNativeObject {
  const object: FakeNativeObject = {
    type,
    textureId,
    x,
    y,
    displayWidth: 24,
    displayHeight: 24,
    destroyed: false,
    children: [],
    data: new Map(),
    playedAnimations: [],
    stopped: false,
    emitting: false,
    bursts: [],
    animationProgress: 0,
    setData(key, value) {
      this.data.set(key, value);
    },
    getData(key) {
      return this.data.get(key);
    },
    setPosition(nextX, nextY, nextZ) {
      this.x = nextX;
      this.y = nextY;
      this.z = nextZ;
    },
    setRotation(rotation) {
      this.setData("rotation", rotation);
    },
    setDisplaySize(width, height) {
      this.displayWidth = width;
      this.displayHeight = height;
    },
    setScale(scaleX, scaleY) {
      this.setData("scale", { x: scaleX, y: scaleY });
    },
    setAlpha(alpha) {
      this.setData("alpha", alpha);
    },
    setVisible(visible) {
      this.setData("visible", visible);
    },
    setDepth(depth) {
      this.setData("depth", depth);
    },
    setTint(tint) {
      this.setData("tint", tint);
    },
    setTintMode(tintMode) {
      this.setData("tintMode", tintMode);
    },
    add(child) {
      this.children.push(child);
    },
    play(animationId) {
      this.playedAnimations.push(animationId);
    },
    stop() {
      this.stopped = true;
      this.emitting = false;
    },
    start() {
      this.emitting = true;
    },
    explode(quantity, burstX, burstY) {
      this.bursts.push({
        quantity,
        ...(burstX === undefined ? {} : { x: burstX }),
        ...(burstY === undefined ? {} : { y: burstY })
      });
    },
    anims: {
      setProgress(progress) {
        object.animationProgress = progress;
      }
    },
    destroy() {
      this.destroyed = true;
    }
  };
  return object;
}

function createTestContainer(): HTMLElement {
  return { append() {} } as unknown as HTMLElement;
}

defineRendererConformanceTests("Phaser", () =>
  createPhaserRenderer({ runtime: createFakePhaserRuntime().runtime })
);

describe("createPhaserRenderer", () => {
  it("emits renderer lifecycle and object diagnostics", async () => {
    const phaser = createFakePhaserRuntime();
    const diagnostics: string[] = [];
    const renderer = createPhaserRenderer({ id: "test.phaser", runtime: phaser.runtime });

    await renderer.boot({
      container: createTestContainer(),
      width: 320,
      height: 240,
      onDiagnostic: (event) => diagnostics.push(event.type)
    });
    renderer.resize(640, 480);
    const objectId = renderer.createObject({
      type: "debug.square",
      transform: { position: { x: 10, y: 20 } }
    });
    renderer.destroyObject(objectId);
    renderer.destroy();

    expect(phaser.resizeCalls).toEqual([{ width: 640, height: 480 }]);
    expect(diagnostics).toEqual([
      "renderer.booted",
      "renderer.resized",
      "renderer.object_created",
      "renderer.object_destroyed",
      "renderer.destroyed"
    ]);
  });

  it("rejects unsupported render object types before reaching the scene", async () => {
    const phaser = createFakePhaserRuntime();
    const renderer = createPhaserRenderer({ runtime: phaser.runtime });

    await renderer.boot({ container: createTestContainer(), width: 320, height: 240 });

    expect(() =>
      renderer.createObject({
        type: "unknown.type",
        transform: { position: { x: 0, y: 0 } }
      })
    ).toThrow("Renderer does not support render object type");
    expect(phaser.created).toHaveLength(0);
  });

  it("creates render objects against an existing Phaser scene runtime", async () => {
    const phaser = createFakePhaserRuntime();
    const renderer = createPhaserRenderer({ runtime: () => phaser.runtime });

    await renderer.boot({ container: createTestContainer(), width: 320, height: 240 });
    const objectId = renderer.createObject({
      id: "root",
      type: "container",
      children: [{ id: "body", type: "debug.square" }]
    });
    renderer.native().applyNodeState(objectId, "body", {
      transform: { position: { x: 12, y: 18 } },
      props: { tint: 0xff0000, tintMode: "fill" }
    });
    renderer.command(objectId, {
      type: "animation.play",
      target: "body",
      args: { animationId: "pulse" }
    });

    const root = renderer.getObjectHandle(objectId).native as FakeNativeObject;
    const body = renderer.native().node(objectId, "body") as FakeNativeObject;
    expect(root.type).toBe("container");
    expect(body?.x).toBe(12);
    expect(body?.y).toBe(18);
    expect(body?.getData("tint")).toBe(0xff0000);
    expect(body?.getData("tintMode")).toBe(1);
    expect(body?.playedAnimations).toEqual(["pulse"]);
  });

  it("fails clearly when the scene runtime is unavailable", async () => {
    const renderer = createPhaserRenderer({ runtime: () => undefined });

    await expect(
      renderer.boot({ container: createTestContainer(), width: 320, height: 240 })
    ).rejects.toMatchObject({
      code: "renderer.phaser.runtime_unavailable"
    });
  });

  it("creates animated sprites and maps animation seek and stop commands", async () => {
    const phaser = createFakePhaserRuntime();
    phaser.textures.add("character");
    const renderer = createPhaserRenderer({ runtime: phaser.runtime });
    await renderer.boot({ container: createTestContainer(), width: 320, height: 240 });
    const objectId = renderer.createObject({
      type: "animated-sprite",
      props: { textureId: "character" }
    });
    renderer.command?.(objectId, {
      type: "animation.play",
      args: { animationId: "character.run", ignoreIfPlaying: true }
    });
    renderer.command?.(objectId, { type: "animation.seek", args: { progress: 0.5 } });
    renderer.command?.(objectId, { type: "animation.stop" });

    const object = renderer.getObjectHandle?.(objectId)?.native as FakeNativeObject;
    expect(object.type).toBe("sprite");
    expect(object.textureId).toBe("character");
    expect(object.playedAnimations).toEqual(["character.run"]);
    expect(object.animationProgress).toBe(0.5);
    expect(object.stopped).toBe(true);
  });

  it("creates particle emitters, handles bursts, and batches native state writes", async () => {
    const phaser = createFakePhaserRuntime();
    phaser.textures.add("spark");
    const renderer = createPhaserRenderer({ runtime: phaser.runtime });
    await renderer.boot({ container: createTestContainer(), width: 320, height: 240 });
    const objectId = renderer.createObject({
      type: "particle-emitter",
      props: { textureId: "spark", config: { lifespan: 200 } }
    });
    renderer.command?.(objectId, { type: "particle.start" });
    renderer.command?.(objectId, {
      type: "particle.emit",
      args: { quantity: 6, x: 12, y: 18 }
    });
    renderer.native().applyBatch([
      {
        objectId,
        state: {
          transform: { position: { x: 20, y: 30 } },
          alpha: 0.5
        }
      }
    ]);
    renderer.command?.(objectId, { type: "particle.stop" });

    const object = renderer.getObjectHandle?.(objectId)?.native as FakeNativeObject;
    expect(object.type).toBe("particle");
    expect(object.getData("config")).toEqual({ lifespan: 200 });
    expect(object.bursts).toEqual([{ quantity: 6, x: 12, y: 18 }]);
    expect(object.x).toBe(20);
    expect(object.y).toBe(30);
    expect(object.getData("alpha")).toBe(0.5);
    expect(object.emitting).toBe(false);
  });
});
