import { describe, expect, it } from "vitest";
import { createAssetManager, type AssetDefinition } from "@gamekits/asset";
import type { ThreeRendererNative, ThreeRenderTargetState } from "@gamekits/driver-three";
import type {
  RenderNodePath,
  RenderObjectDefinition,
  RenderObjectHandle,
  RenderObjectId,
  RendererAdapter,
  RendererBootContext
} from "@gamekits/renderer-core";
import * as THREE from "three";
import { createThreeDemoScene } from "./demo-scene";
import {
  THREE_DEMO_ASSET_IDS,
  THREE_DEMO_BOOT_ASSET_IDS,
  createThreeDemoDataRegistry,
  listThreeDemoAssetDefinitions
} from "./demo-assets";
import { threeDemoAppDefinition } from "./app-definition";

describe("three demo assets", () => {
  it("registers the remote Three assets through asset.definition data", () => {
    const registry = createThreeDemoDataRegistry();
    const ids = registry.list<AssetDefinition>("asset.definition").map((entry) => entry.id);

    expect(ids).toEqual([
      THREE_DEMO_ASSET_IDS.robot,
      THREE_DEMO_ASSET_IDS.tokyo,
      THREE_DEMO_ASSET_IDS.flamingo,
      THREE_DEMO_ASSET_IDS.uvTexture,
      THREE_DEMO_ASSET_IDS.brickTexture,
      THREE_DEMO_ASSET_IDS.woodTexture
    ]);
    expect(threeDemoAppDefinition.services.map((service) => service.id)).toEqual([
      "platform",
      "drivers",
      "data",
      "assets",
      "renderer"
    ]);
    expect(THREE_DEMO_BOOT_ASSET_IDS).not.toContain(THREE_DEMO_ASSET_IDS.tokyo);
    expect(
      listThreeDemoAssetDefinitions().find((asset) => asset.id === THREE_DEMO_ASSET_IDS.tokyo)
    ).toMatchObject({ lazy: true });
  });
});

describe("createThreeDemoScene", () => {
  it("creates an object tree and updates scene modes through Three native state", async () => {
    const renderer = new FakeRenderer();
    const assets = createAssetManager({
      adapter: {
        id: "test",
        supports: () => true,
        async load(asset) {
          if (asset.id === THREE_DEMO_ASSET_IDS.flamingo) throw new Error("model unavailable");
        },
        unload() {}
      }
    });
    assets.registerMany(listThreeDemoAssetDefinitions());
    await Promise.all(assets.assets().map((asset) => assets.load(asset.id)));
    const scene = createThreeDemoScene(renderer, { assets });

    scene.boot();

    expect(renderer.objects.get("three-demo.scene")?.children?.map((child) => child.id)).toContain(
      "asset-stage"
    );
    expect(scene.snapshot()).toMatchObject({
      mode: "assets",
      material: "original",
      model: "robot",
      texture: "uv",
      clip: "auto",
      wireframe: false,
      objectCount: 16
    });
    expect(scene.snapshot().assets).toHaveLength(6);
    const root = renderer.objects.get("three-demo.scene");
    const assetStage = root?.children?.find((child) => child.id === "asset-stage");
    const robotNode = assetStage?.children?.find((child) => child.id === "model-robot");
    expect(robotNode?.props).not.toHaveProperty("material");
    expect(
      renderer.nodeStates.some(
        (entry) => entry.path === "asset-stage/model-robot" && entry.state.props?.material
      )
    ).toBe(false);

    scene.setMode("animation");
    scene.setMaterial("chrome");
    scene.setModel("tokyo");
    scene.setTexture("brick");
    scene.setClip("Dance");
    scene.setCameraPreset("macro");
    scene.setLightingPreset("neon");
    scene.setAnimationSpeed(1.8);
    scene.setTimelineMs(1400);
    scene.setPlaying(false);
    scene.setWireframe(true);
    scene.update(32);

    expect(scene.snapshot()).toMatchObject({
      mode: "animation",
      material: "chrome",
      model: "tokyo",
      texture: "brick",
      clip: "Dance",
      cameraPreset: "macro",
      lightingPreset: "neon",
      wireframe: true,
      playing: false,
      animationSpeed: 1.8
    });
    expect(renderer.nodeStates.some((entry) => entry.state.props?.material !== undefined)).toBe(
      false
    );
    expect(renderer.nodeStates.some((entry) => entry.path === "asset-stage/model-tokyo")).toBe(
      true
    );
    expect(renderer.nativeNodeReads).toContain("asset-stage/model-tokyo");
    expect(renderer.textureReads).toContain(THREE_DEMO_ASSET_IDS.brickTexture);
    expect(renderer.nativeRenderCalls).toBeGreaterThan(0);
    expect(scene.snapshot().nativeMutationCount).toBeGreaterThan(0);

    scene.destroy();

    expect(renderer.destroyedObjects).toEqual(["three-demo.scene"]);
    expect(scene.snapshot().objectCount).toBe(0);
  });

  it("samples native Three animation clips from the timeline without double-applying speed", () => {
    const renderer = new FakeRenderer();
    const robot = new THREE.Group();
    robot.userData.assetAnimations = [
      new THREE.AnimationClip("Idle", 2, [
        new THREE.VectorKeyframeTrack(".position", [0, 2], [0, 0, 0, 10, 0, 0])
      ])
    ];
    renderer.nativeNodes.set("asset-stage/model-robot", robot);
    const scene = createThreeDemoScene(renderer);

    scene.boot();
    scene.setAnimationSpeed(2);
    scene.setTimelineMs(500);

    expect(robot.position.x).toBeCloseTo(2.5, 2);
  });
});

class FakeRenderer implements RendererAdapter {
  readonly id = "fake.renderer";
  readonly objects = new Map<RenderObjectId, RenderObjectDefinition>();
  readonly nodeStates: Array<{
    objectId: RenderObjectId;
    path: string;
    state: ThreeRenderTargetState;
  }> = [];
  readonly nativeNodeReads: string[] = [];
  readonly textureReads: string[] = [];
  readonly destroyedObjects: RenderObjectId[] = [];
  readonly nativeNodes = new Map<string, unknown>();
  nativeRenderCalls = 0;

  async boot(_ctx: RendererBootContext): Promise<void> {}

  destroy(): void {}

  getView(): HTMLElement {
    return {} as HTMLElement;
  }

  resize(_width: number, _height: number): void {}

  createObject(definition: RenderObjectDefinition): RenderObjectId {
    const id = definition.id ?? `fake-object-${this.objects.size}`;
    this.objects.set(id, definition);
    return id;
  }

  destroyObject(id: RenderObjectId): void {
    this.destroyedObjects.push(id);
    this.objects.delete(id);
  }

  native(): ThreeRendererNative {
    return createFakeThreeNative(this);
  }

  getObjectHandle(objectId: RenderObjectId): RenderObjectHandle {
    return {
      id: objectId,
      type: this.objects.get(objectId)?.type ?? "unknown",
      native: {}
    };
  }
}

function createFakeThreeNative(renderer: FakeRenderer): ThreeRendererNative {
  return {
    view: {} as HTMLCanvasElement,
    scene: {},
    camera: {},
    resources: {
      getTexture(id: string) {
        renderer.textureReads.push(id);
        return undefined;
      }
    },
    factories: {},
    resize() {},
    render() {
      renderer.nativeRenderCalls += 1;
    },
    destroy() {},
    object() {
      return {};
    },
    node(_objectId: RenderObjectId, nodePath: RenderNodePath) {
      const resolvedPath = Array.isArray(nodePath) ? nodePath.join("/") : nodePath;
      renderer.nativeNodeReads.push(resolvedPath);
      return renderer.nativeNodes.get(resolvedPath) ?? {};
    },
    inspectObject() {
      return {
        type: "group",
        visible: true,
        assetBacked: false,
        nodeCount: 1,
        meshCount: 0,
        skinnedMeshCount: 0,
        visibleMeshCount: 0,
        frustumCulledMeshCount: 0,
        materialCount: 0,
        invisibleMaterialCount: 0,
        transparentMaterialCount: 0,
        wireframeMaterialCount: 0,
        childCount: 0,
        clipNames: []
      };
    },
    inspectNode() {
      return {
        type: "model",
        visible: true,
        assetBacked: false,
        nodeCount: 1,
        meshCount: 0,
        skinnedMeshCount: 0,
        visibleMeshCount: 0,
        frustumCulledMeshCount: 0,
        materialCount: 0,
        invisibleMaterialCount: 0,
        transparentMaterialCount: 0,
        wireframeMaterialCount: 0,
        childCount: 0,
        clipNames: []
      };
    },
    applyObjectState(_id: RenderObjectId, _state: ThreeRenderTargetState) {},
    applyNodeState(
      objectId: RenderObjectId,
      nodePath: RenderNodePath,
      state: ThreeRenderTargetState
    ) {
      renderer.nodeStates.push({
        objectId,
        path: Array.isArray(nodePath) ? nodePath.join("/") : nodePath,
        state
      });
    },
    applyTargetState(_target: unknown, _state: ThreeRenderTargetState) {}
  } as unknown as ThreeRendererNative;
}
