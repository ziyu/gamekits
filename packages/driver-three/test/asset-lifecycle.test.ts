import { describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { createAssetManager } from "@gamekits/asset";
import { createThreeRuntimeResources } from "../src/driver/runtime";

function nativeResources(timeoutMs = 1000) {
  const pending: Array<(texture: THREE.Texture) => void> = [];
  class TextureLoader {
    loadAsync() {
      return new Promise<THREE.Texture>((resolve) => pending.push(resolve));
    }
  }
  const resources = createThreeRuntimeResources({ ...THREE, TextureLoader } as typeof THREE, {
    assetLoadTimeoutMs: timeoutMs,
    dracoDecoderPath: ""
  });
  return { resources, pending };
}
describe("Three native resource lifecycle", () => {
  it("disposes late native texture results after cancellation", async () => {
    const { resources, pending } = nativeResources();
    const controller = new AbortController();
    const load = resources.loadTexture("a", "a.png", controller.signal);
    const failed = expect(load).rejects.toMatchObject({ name: "AbortError" });
    controller.abort();
    await failed;
    const texture = new THREE.Texture(),
      dispose = vi.spyOn(texture, "dispose");
    pending[0]!(texture);
    await vi.waitFor(() => expect(dispose).toHaveBeenCalledOnce());
    expect(resources.has("a")).toBe(false);
    resources.dispose();
  });
  it("reclaims timed-out results and allows a later generation to load", async () => {
    const { resources, pending } = nativeResources(5);
    await expect(resources.loadTexture("a", "a.png")).rejects.toThrow("Timed out");
    const old = new THREE.Texture(),
      next = new THREE.Texture();
    const dispose = vi.spyOn(old, "dispose");
    const reload = resources.loadTexture("a", "a.png");
    pending[1]!(next);
    await reload;
    pending[0]!(old);
    await vi.waitFor(() => expect(dispose).toHaveBeenCalledOnce());
    expect(resources.getTexture("a")).toBe(next);
    resources.dispose();
  });
  it("does not release a shared native texture before its final scope closes", async () => {
    const { resources, pending } = nativeResources();
    const manager = createAssetManager({
      adapter: {
        id: "three",
        supports: () => true,
        load: async (asset, options) => {
          await resources.loadTexture(asset.id, "a.png", options?.signal);
        },
        unload: (asset) => resources.unload(asset.id)
      }
    });
    manager.register({ id: "a", type: "texture", source: { type: "url", url: "a.png" } });
    const a = manager.createScope("scene-a"),
      b = manager.createScope("scene-b");
    const loading = Promise.all([a.load("a"), b.load("a")]);
    await vi.waitFor(() => expect(pending).toHaveLength(1));
    const texture = new THREE.Texture(),
      dispose = vi.spyOn(texture, "dispose");
    pending[0]!(texture);
    await loading;
    await a.dispose();
    expect(dispose).not.toHaveBeenCalled();
    await b.dispose();
    expect(dispose).toHaveBeenCalledOnce();
    await manager.dispose();
    resources.dispose();
    expect(dispose).toHaveBeenCalledOnce();
  });
  it("prevents resource resurrection after driver disposal", async () => {
    const { resources, pending } = nativeResources();
    const load = resources.loadTexture("a", "a.png");
    const failed = expect(load).rejects.toMatchObject({ name: "AbortError" });
    resources.dispose();
    await failed;
    const texture = new THREE.Texture(),
      dispose = vi.spyOn(texture, "dispose");
    pending[0]!(texture);
    await vi.waitFor(() => expect(dispose).toHaveBeenCalledOnce());
    await expect(resources.loadTexture("b", "b.png")).rejects.toMatchObject({ name: "AbortError" });
    expect(resources.summaries()).toEqual([]);
  });
});
