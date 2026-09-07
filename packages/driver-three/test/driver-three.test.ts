import { describe, expect, it } from "vitest";
import { defineRendererConformanceTests } from "@gamekits/test-utils";
import {
  createThreeDriver,
  createThreeDriverCameraAdapter,
  createThreeRenderer,
  type ThreeDriverRuntime
} from "../src";
import { cloneObjectMaterialInstances } from "../src/driver/model-materials";
import { disposeObjectTree } from "../src/driver/runtime";
import type { ThreeMaterialTarget, ThreeObjectTarget } from "../src/driver/structural-types";

type FakeThreeMaterial = Omit<ThreeMaterialTarget, "clone"> & {
  metalness?: number;
  roughness?: number;
  clearcoat?: number;
  clone?(): FakeThreeMaterial;
};

type FakeThreeObject = Omit<
  ThreeObjectTarget,
  "add" | "children" | "material" | "parent" | "remove"
> & {
  objectKind: "group" | "mesh" | "model" | "light" | "scene" | "camera";
  removed: boolean;
  children: FakeThreeObject[];
  parent?: FakeThreeObject | null;
  material?: FakeThreeMaterial | FakeThreeMaterial[];
  renderCount?: number;
  add(child: ThreeObjectTarget): void;
  remove(child: ThreeObjectTarget): void;
};

type FakeRuntime = {
  runtime: ThreeDriverRuntime;
  created: FakeThreeObject[];
  loadedAssets: string[];
  resizeCalls: Array<{ width: number; height: number }>;
  renderCalls: number;
  destroyed: boolean;
};

function createFakeThreeRuntime(): FakeRuntime {
  const created: FakeThreeObject[] = [];
  const resizeCalls: Array<{ width: number; height: number }> = [];
  const loadedAssets: string[] = [];
  const scene = createObject("scene");
  const camera = createObject("camera");
  const texture = { dispose() {} };
  const resourceSummaries: ReturnType<ThreeDriverRuntime["resources"]["summaries"]> = [];
  let renderCalls = 0;
  let destroyed = false;

  let fake: FakeRuntime;
  const runtime = {
    view: { remove() {} } as unknown as HTMLCanvasElement,
    scene,
    camera,
    resources: {
      has(id: string) {
        return resourceSummaries.some((summary) => summary.id === id);
      },
      getTexture(id: string) {
        return resourceSummaries.some((summary) => summary.id === id) ? texture : undefined;
      },
      createModelInstance(id: string) {
        if (!resourceSummaries.some((summary) => summary.id === id)) {
          return undefined;
        }
        const object = createObject("model");
        object.material = createMaterial();
        object.userData.assetId = id;
        object.userData.assetModel = true;
        object.userData.assetClipNames = ["Idle", "Dance"];
        object.userData.assetAnimations = [{ name: "Idle" }, { name: "Dance" }];
        return object;
      },
      clipNames(id: string) {
        return resourceSummaries.find((summary) => summary.id === id)?.clipNames ?? [];
      },
      summaries() {
        return [...resourceSummaries].sort((left, right) => left.id.localeCompare(right.id));
      },
      async loadTexture(id: string, url: string) {
        loadedAssets.push(id);
        const summary = { id, kind: "texture" as const, url, loadedAt: 1 };
        resourceSummaries.push(summary);
        return summary;
      },
      async loadModel(id: string, url: string) {
        loadedAssets.push(id);
        const summary = {
          id,
          kind: "model" as const,
          url,
          loadedAt: 1,
          clipNames: ["Idle", "Dance"]
        };
        resourceSummaries.push(summary);
        return summary;
      },
      unload(id: string) {
        const index = resourceSummaries.findIndex((summary) => summary.id === id);
        if (index >= 0) resourceSummaries.splice(index, 1);
      },
      dispose() {
        resourceSummaries.length = 0;
      }
    },
    factories: {
      createGroup() {
        const object = createObject("group");
        created.push(object);
        return object;
      },
      createMesh(options: Parameters<ThreeDriverRuntime["factories"]["createMesh"]>[0]) {
        const object = createObject("mesh");
        object.type = options.type;
        object.material = createMaterial();
        created.push(object);
        return object;
      },
      createLight() {
        const object = createObject("light");
        object.color = { set: (value: string | number) => (object.userData.color = value) };
        created.push(object);
        return object;
      },
      createModel(options: Parameters<ThreeDriverRuntime["factories"]["createModel"]>[0]) {
        const assetId =
          typeof options.props?.assetId === "string" ? options.props.assetId : undefined;
        const object = assetId
          ? ((fake.runtime.resources.createModelInstance(assetId) as FakeThreeObject | undefined) ??
            createObject("model"))
          : createObject("model");
        object.type = options.type;
        object.material = createMaterial();
        created.push(object);
        return object;
      }
    },
    resize(width: number, height: number) {
      resizeCalls.push({ width, height });
    },
    render() {
      renderCalls += 1;
    },
    destroy() {
      destroyed = true;
    }
  } as unknown as ThreeDriverRuntime;

  fake = {
    runtime,
    created,
    loadedAssets,
    resizeCalls,
    get renderCalls() {
      return renderCalls;
    },
    get destroyed() {
      return destroyed;
    }
  };

  return fake;
}

function createObject(kind: FakeThreeObject["objectKind"]): FakeThreeObject {
  const object: FakeThreeObject = {
    objectKind: kind,
    removed: false,
    visible: true,
    position: createVector(),
    rotation: createVector(),
    scale: createVector(1, 1, 1),
    userData: {},
    children: [],
    add(child) {
      const entry = child as FakeThreeObject;
      this.children.push(entry);
      entry.parent = this;
    },
    remove(child) {
      const entry = child as FakeThreeObject;
      this.children = this.children.filter((candidate) => candidate !== entry);
      entry.parent = null;
      entry.removed = true;
    },
    dispose() {
      this.removed = true;
    }
  };

  return object;
}

function createVector(x = 0, y = 0, z = 0) {
  return {
    x,
    y,
    z,
    set(nextX: number, nextY: number, nextZ = z) {
      this.x = nextX;
      this.y = nextY;
      this.z = nextZ;
    }
  };
}

function createMaterial(): FakeThreeMaterial {
  return {
    color: { set() {} },
    emissive: { set() {} },
    opacity: 1,
    transparent: false,
    wireframe: false,
    metalness: 0,
    roughness: 1,
    clearcoat: 0,
    dispose() {}
  };
}

function createTestContainer(): HTMLElement {
  return { append() {} } as unknown as HTMLElement;
}

defineRendererConformanceTests("Three", () =>
  createThreeRenderer({ runtime: createFakeThreeRuntime().runtime })
);

describe("createThreeRenderer", () => {
  it("creates Three object trees and applies native mesh, light, and command state", async () => {
    const three = createFakeThreeRuntime();
    const renderer = createThreeRenderer({ id: "test.three.renderer", runtime: three.runtime });

    await renderer.boot({ container: createTestContainer(), width: 320, height: 240 });
    await three.runtime.resources.loadTexture("asset.texture", "https://example.test/grid.jpg");
    await three.runtime.resources.loadModel("asset.model", "https://example.test/model.glb");
    const objectId = renderer.createObject({
      id: "root",
      type: "group",
      children: [
        {
          id: "body",
          type: "mesh",
          transform: { position: { x: 1, y: 2, z: 3 } },
          props: { color: "#7fd16b", opacity: 0.5, wireframe: true }
        },
        {
          id: "key",
          type: "light",
          props: { intensity: 2 }
        },
        {
          id: "ship",
          type: "model"
        },
        {
          id: "asset-ship",
          type: "model",
          props: {
            assetId: "asset.model",
            normalize: true
          }
        },
        {
          id: "native-effects",
          type: "group"
        }
      ]
    });

    const native = renderer.native();
    native.applyNodeState(objectId, "body", {
      transform: { scale: { x: 2, y: 3, z: 4 } },
      alpha: 0.25
    });
    native.applyNodeState(objectId, "key", { props: { intensity: 4 } });
    renderer.command?.(objectId, { type: "render.once" });

    const root = renderer.getObjectHandle?.(objectId)?.native as FakeThreeObject;
    const body = root.children?.[0] as FakeThreeObject;
    const key = root.children?.[1] as FakeThreeObject;
    const ship = root.children?.[2] as FakeThreeObject;
    const material = body.material as FakeThreeMaterial;
    material.wireframe = true;
    material.metalness = 0.7;
    material.roughness = 0.18;
    const assetMaterial = (native.node(objectId, "asset-ship") as FakeThreeObject)
      .material as FakeThreeMaterial;
    assetMaterial.map = three.runtime.resources.getTexture("asset.texture");
    assetMaterial.clearcoat = 0.5;
    const assetDiagnostics = native.inspectNode(objectId, "asset-ship");

    expect(root.objectKind).toBe("group");
    expect(body.objectKind).toBe("mesh");
    expect(ship.objectKind).toBe("model");
    expect(body.position).toMatchObject({ x: 1, y: 2, z: 3 });
    expect(body.scale).toMatchObject({ x: 2, y: 3, z: 4 });
    expect(material.opacity).toBe(0.25);
    expect(material.transparent).toBe(true);
    expect(material.wireframe).toBe(true);
    expect(material.metalness).toBe(0.7);
    expect(material.roughness).toBe(0.18);
    expect(assetMaterial.map).toBeDefined();
    expect(assetMaterial.clearcoat).toBe(0.5);
    expect(assetDiagnostics).toMatchObject({
      type: "model",
      assetId: "asset.model",
      assetBacked: true,
      nodeCount: 1
    });
    expect(assetDiagnostics.clipNames).toEqual(["Idle", "Dance"]);
    expect(root.userData?.renderRequested).toBe(true);
    try {
      renderer.command?.(objectId, {
        type: "shader.set_uniform",
        target: "asset-ship",
        args: { uniform: "u_time", value: 1 }
      });
      throw new Error("Expected shader command to fail");
    } catch (error) {
      expect(error).toMatchObject({ code: "renderer.unsupported_command" });
    }
    expect(key.intensity).toBe(4);
    expect(three.renderCalls).toBeGreaterThan(0);
  });

  it("fails clearly when the Three runtime is unavailable", async () => {
    const renderer = createThreeRenderer({ runtime: () => undefined });

    await expect(
      renderer.boot({ container: createTestContainer(), width: 320, height: 240 })
    ).rejects.toMatchObject({
      code: "renderer.three.runtime_unavailable"
    });
  });

  it("keeps asset-backed clone geometry and materials alive during render object disposal", () => {
    let geometryDisposeCount = 0;
    let materialDisposeCount = 0;
    const sceneRoot = createObject("group");
    const assetRoot = createObject("model");
    const mesh = createObject("mesh");
    assetRoot.userData.assetModel = true;
    mesh.geometry = {
      dispose() {
        geometryDisposeCount += 1;
      }
    };
    mesh.material = {
      dispose() {
        materialDisposeCount += 1;
      }
    };
    assetRoot.add?.(mesh);
    sceneRoot.add?.(assetRoot);

    disposeObjectTree(sceneRoot);

    expect(geometryDisposeCount).toBe(0);
    expect(materialDisposeCount).toBe(0);

    disposeObjectTree(assetRoot, { forceNativeResourceDispose: true });

    expect(geometryDisposeCount).toBe(1);
    expect(materialDisposeCount).toBe(1);
  });

  it("keeps patched asset instance materials isolated from the cached model source", () => {
    let sourceColor: string | number | undefined;
    let cloneColor: string | number | undefined;
    let cloneDisposeCount = 0;
    const sourceMaterial: FakeThreeMaterial = {
      color: { set: (value) => (sourceColor = value) },
      roughness: 0.77,
      clone() {
        return {
          color: { set: (value) => (cloneColor = value) },
          roughness: this.roughness,
          dispose() {
            cloneDisposeCount += 1;
          }
        };
      }
    };
    const model = createObject("model");
    model.userData.assetModel = true;
    const meshA = createObject("mesh");
    const meshB = createObject("mesh");
    meshA.material = sourceMaterial;
    meshB.material = [sourceMaterial];
    model.add?.(meshA);
    model.add?.(meshB);

    cloneObjectMaterialInstances(model);

    const meshAMaterial = meshA.material as FakeThreeMaterial;
    const meshBMaterial = (meshB.material as FakeThreeMaterial[])[0];
    meshAMaterial.color?.set?.("#ff6a3d");
    meshAMaterial.roughness = 0.18;
    expect(meshAMaterial).not.toBe(sourceMaterial);
    expect(meshBMaterial).toBe(meshAMaterial);
    expect(sourceMaterial.roughness).toBe(0.77);
    expect(sourceColor).toBeUndefined();
    expect(meshAMaterial.roughness).toBe(0.18);
    expect(cloneColor).toBe("#ff6a3d");

    disposeObjectTree(model);

    expect(cloneDisposeCount).toBe(1);
  });

  it("disposes cloned asset instance materials without disposing shared geometry", () => {
    let geometryDisposeCount = 0;
    let materialDisposeCount = 0;
    const assetRoot = createObject("model");
    const mesh = createObject("mesh");
    assetRoot.userData.assetModel = true;
    mesh.userData.assetInstanceMaterial = true;
    mesh.geometry = {
      dispose() {
        geometryDisposeCount += 1;
      }
    };
    mesh.material = {
      dispose() {
        materialDisposeCount += 1;
      }
    };
    assetRoot.add?.(mesh);

    disposeObjectTree(assetRoot);

    expect(geometryDisposeCount).toBe(0);
    expect(materialDisposeCount).toBe(1);
  });
});

describe("createThreeDriver", () => {
  it("exposes a cohesive Three adapter bundle", () => {
    const three = createFakeThreeRuntime();
    const driver = createThreeDriver({ id: "test.three", runtime: three.runtime });
    const adapters = driver.adapters();

    expect(driver.id).toBe("test.three");
    expect(driver.capabilities()).toMatchObject({
      renderer: true,
      assets: true,
      camera: true,
      scenes: true
    });
    expect(adapters.renderer.id).toBe("test.three.renderer");
    expect(adapters.assetLoader.id).toBe("test.three.asset-loader");
    expect(driver.snapshot()).toMatchObject({
      id: "test.three",
      kind: "three",
      adapters: ["renderer", "assetLoader", "camera"]
    });
  });

  it("loads model and texture assets into the shared Three runtime cache", async () => {
    const three = createFakeThreeRuntime();
    const driver = createThreeDriver({ id: "test.three", runtime: three.runtime });
    const loader = driver.adapters().assetLoader;

    expect(
      loader.supports({
        id: "asset.texture",
        type: "texture",
        source: { type: "url", url: "https://example.test/grid.jpg" }
      })
    ).toBe(true);
    expect(
      loader.supports({
        id: "asset.bad",
        type: "image",
        source: { type: "url", url: "https://example.test/image.png" }
      })
    ).toBe(false);

    await loader.load({
      id: "asset.texture",
      type: "texture",
      source: { type: "url", url: "https://example.test/grid.jpg" }
    });
    await loader.load({
      id: "asset.model",
      type: "model",
      source: { type: "url", url: "https://example.test/model.glb" }
    });

    expect(three.loadedAssets).toEqual(["asset.texture", "asset.model"]);
    expect(driver.snapshot().details?.resources).toEqual([
      {
        id: "asset.model",
        kind: "model",
        url: "https://example.test/model.glb",
        loadedAt: 1,
        clipNames: ["Idle", "Dance"]
      },
      {
        id: "asset.texture",
        kind: "texture",
        url: "https://example.test/grid.jpg",
        loadedAt: 1
      }
    ]);
  });

  it("boots injected runtime-backed renderer and leaves injected runtime disposal to caller", async () => {
    const three = createFakeThreeRuntime();
    const driver = createThreeDriver({ id: "test.three", runtime: three.runtime });

    await driver.boot({ container: createTestContainer(), width: 320, height: 240 });
    driver.resize({ width: 640, height: 480 });
    driver.dispose();

    expect(three.resizeCalls).toEqual([
      { width: 320, height: 240 },
      { width: 640, height: 480 }
    ]);
    expect(three.destroyed).toBe(false);
    expect(driver.snapshot()).toMatchObject({ phase: "disposed" });
  });
});

describe("createThreeDriverCameraAdapter", () => {
  it("maps 2D camera state to the Three camera transform", () => {
    const three = createFakeThreeRuntime();
    const camera = createThreeDriverCameraAdapter({ runtime: () => three.runtime });

    camera.applyCameraState({
      mode: "free",
      x: 200,
      y: 120,
      zoom: 2,
      rotation: 0.25,
      viewport: { width: 100, height: 80 },
      minZoom: 0.5,
      maxZoom: 4
    });

    expect(three.runtime.camera.position).toMatchObject({ x: 200, y: 120 });
    expect(three.runtime.camera.rotation).toMatchObject({ z: 0.25 });
    expect(three.runtime.camera.zoom).toBe(2);
    expect(camera.worldToScreen({ x: 200, y: 120 })).toEqual({ x: 50, y: 40 });
    expect(camera.screenToWorld({ x: 50, y: 40 })).toEqual({ x: 200, y: 120 });
  });
});
