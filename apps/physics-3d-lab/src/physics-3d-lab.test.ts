import { beforeAll, describe, expect, it } from "vitest";
import type { RenderNodePath, RenderObjectId } from "@gamekits/renderer-core";
import type { ThreeRendererNative, ThreeRenderTargetState } from "@gamekits/driver-three";
import { initRapier3dPhysicsBackend } from "@gamekits/physics-rapier3d";
import * as THREE from "three";
import {
  applyPhysics3dFreeCamera,
  createPhysics3dFreeCameraState,
  orbitPhysics3dFreeCamera,
  panPhysics3dFreeCamera,
  zoomPhysics3dFreeCamera
} from "./physics-3d-free-camera";
import { createPhysics3dCharacterIntent } from "./physics-3d-character-controller";
import {
  PHYSICS_3D_GROUPS,
  createPhysics3dLab,
  createPhysics3dModuleHarness,
  type Physics3dLab
} from "./physics-3d-lab";
import { createPhysics3dLabVisual, screenToPhysicsQueryPoint } from "./physics-3d-visual";

let backend: Awaited<ReturnType<typeof initRapier3dPhysicsBackend>>;

beforeAll(async () => {
  backend = await initRapier3dPhysicsBackend({
    id: "physics-3d-lab.test",
    groups: PHYSICS_3D_GROUPS
  });
});

describe("Physics 3D Lab runtime", () => {
  it("boots a Rapier 3D scene with drops, trigger, query, and native diagnostics", () => {
    const lab = createPhysics3dLab(backend);

    const snapshot = stepLab(lab, 10);

    expect(snapshot.scene).toMatchObject({
      backend: "physics-3d-lab.test",
      dimension: "3d",
      bodyCount: 7,
      colliderCount: 7
    });
    expect(snapshot.objects.map((object) => object.role)).toContain("drop");
    expect(snapshot.recentContacts.map((contact) => `${contact.kind}.${contact.phase}`)).toContain(
      "trigger.enter"
    );
    expect(snapshot.queryHits.map((hit) => hit.colliderId)).toContain("collider.trigger");
    expect(snapshot.spinnerQuaternion?.w).toBeTypeOf("number");
    expect(snapshot.nativeSummary).toMatchObject({
      backend: "rapier3d",
      bodyCount: 7,
      colliderCount: 7
    });
    expect(snapshot.cameraPreset).toBe("free");
    expect(lab.setCameraPreset("free").cameraPreset).toBe("free");

    lab.dispose();
  });

  it("spawns the selected shape and filters query results by collision group", () => {
    const lab = createPhysics3dLab(backend);

    const selected = lab.setShape("capsule");
    expect(selected.objects.find((object) => object.id === "drop-1")?.shape).toMatchObject({
      type: "capsule"
    });
    lab.spawnDrop();
    lab.setGroupPreset("sensor-only");
    lab.setQueryPoint({ x: 0, y: 2.1, z: 0 });
    const snapshot = lab.singleStep();

    expect(snapshot.objects.find((object) => object.id === "drop-4")?.shape).toMatchObject({
      type: "capsule"
    });
    expect(snapshot.queryHits.map((hit) => hit.colliderId)).toEqual(["collider.trigger"]);

    lab.dispose();
  });

  it("keeps queries live after paused shape rebuilds and spawns", () => {
    const lab = createPhysics3dLab(backend);

    lab.setPaused(true);
    lab.setShape("sphere");
    lab.spawnDrop();
    lab.setQueryPoint({ x: 0, y: 2.1, z: 0 });
    const snapshot = lab.snapshot();

    expect(snapshot.paused).toBe(true);
    expect(snapshot.stepCount).toBe(0);
    expect(snapshot.queryHits.map((hit) => hit.colliderId)).toContain("collider.trigger");
    expect(snapshot.objects.find((object) => object.id === "drop-4")?.shape).toMatchObject({
      type: "sphere"
    });

    lab.dispose();
  });

  it("keeps reset drop ids stable after repeated spawns", () => {
    const lab = createPhysics3dLab(backend);

    lab.spawnDrop();
    lab.spawnDrop();
    const snapshot = lab.reset();

    expect(snapshot.objects.map((object) => object.id)).toEqual([
      "floor",
      "character",
      "spinner",
      "trigger",
      "drop-1",
      "drop-2",
      "drop-3"
    ]);
    expect(lab.spawnDrop().objects.map((object) => object.id)).toContain("drop-4");

    lab.dispose();
  });

  it("drives the visible Rapier actor through the shared character motor", () => {
    const lab = createPhysics3dLab(backend);
    let snapshot = stepLab(lab, 90);
    const before = snapshot.objects.find((object) => object.role === "character")!;

    lab.setCharacterIntent(
      createPhysics3dCharacterIntent({
        sequence: 1,
        moveX: 1,
        moveZ: 0,
        jumpPressed: false,
        jumpHeld: false,
        divePressed: false
      })
    );
    snapshot = stepLab(lab, 18);
    const moved = snapshot.objects.find((object) => object.role === "character")!;

    expect(moved.position.x).toBeGreaterThan(before.position.x);
    expect(snapshot.character.diagnostics).toMatchObject({
      sequence: 1,
      queryCount: 2
    });

    lab.setCharacterIntent(
      createPhysics3dCharacterIntent({
        sequence: 2,
        moveX: 0,
        moveZ: 0,
        jumpPressed: true,
        jumpHeld: true,
        divePressed: false
      })
    );
    snapshot = lab.step(1000 / 60);
    const jumped = snapshot.objects.find((object) => object.role === "character")!;

    expect(snapshot.character.state.lastConsumedJumpSequence).toBe(2);
    expect(jumped.linearVelocity.y).toBeGreaterThan(0);

    lab.dispose();
  });

  it("runs through the standard Physics GameModule helper", () => {
    const harness = createPhysics3dModuleHarness(backend);
    expect(harness.physics.isBound()).toBe(true);

    harness.runtime.start();
    harness.runtime.tick(1000 / 60);

    expect(harness.contacts).toHaveLength(1);
    expect(harness.contacts[0]).toMatchObject({
      kind: "trigger",
      phase: "enter",
      entityA: harness.mover,
      entityB: harness.trigger
    });
    expect(harness.traceStore.list().map((entry) => entry.kind)).toContain("step");
    expect(harness.physics.snapshot()).toMatchObject({
      backend: "physics-3d-lab.test",
      dimension: "3d",
      bodyCount: 2,
      colliderCount: 2
    });
    expect(
      harness.physics
        .overlapShape(
          { type: "sphere", radius: 0.25 },
          { x: 0, y: 1.2, z: 0 },
          { triggerInteraction: "only" }
        )
        .map((hit) => hit.colliderId)
    ).toContain(harness.contacts[0]?.colliderB);

    harness.runtime.dispose();
    expect(harness.physics.isBound()).toBe(false);
  });

  it("frames the debug scene with the native Three camera", () => {
    const lab = createPhysics3dLab(backend);
    const native = createFakeThreeNative();
    const visual = createPhysics3dLabVisual(native);

    visual.update(lab.setCameraPreset("overview"));

    const camera = native.camera as THREE.OrthographicCamera;
    const root = native.scene.getObjectByName("physics-3d-lab.debug-root");
    const floor = native.scene.getObjectByName("physics-3d-lab.floor") as THREE.Mesh;
    const floorMaterial = floor.material as THREE.MeshStandardMaterial;

    expect(camera.position.y).toBeGreaterThan(300);
    expect(camera.position.z).toBeGreaterThan(700);
    expect(camera.zoom).toBeLessThan(1);
    expect(root?.rotation.x).toBe(0);
    expect(floorMaterial.opacity).toBeLessThan(0.5);
    expect(floorMaterial.depthWrite).toBe(false);

    visual.destroy();
    lab.dispose();
  });

  it("projects viewport pointer movement onto the query probe plane", () => {
    const lab = createPhysics3dLab(backend);
    const native = createFakeThreeNative();
    const visual = createPhysics3dLabVisual(native);

    visual.update(lab.setCameraPreset("overview"));

    const centered = screenToPhysicsQueryPoint(
      native,
      { left: 0, top: 0, width: 840, height: 720 },
      420,
      360
    );
    const upperRight = screenToPhysicsQueryPoint(
      native,
      { left: 0, top: 0, width: 840, height: 720 },
      840,
      0
    );

    expect(centered).toMatchObject({
      y: 2.1
    });
    expect(centered?.x).toBeGreaterThanOrEqual(-3.8);
    expect(centered?.x).toBeLessThanOrEqual(3.8);
    expect(centered?.z).toBeGreaterThanOrEqual(-2.8);
    expect(centered?.z).toBeLessThanOrEqual(2.8);
    expect(upperRight?.x).toBeLessThanOrEqual(3.8);
    expect(upperRight?.z).toBeLessThanOrEqual(2.8);
    expect(upperRight).not.toEqual(centered);

    visual.destroy();
    lab.dispose();
  });

  it("orbits, pans, and zooms the free camera without touching physics state", () => {
    const native = createFakeThreeNative();
    const state = createPhysics3dFreeCameraState();
    const before = {
      target: { ...state.target },
      yaw: state.yaw,
      pitch: state.pitch,
      zoom: state.zoom
    };

    orbitPhysics3dFreeCamera(state, 32, -18);
    panPhysics3dFreeCamera(state, 24, 16);
    zoomPhysics3dFreeCamera(state, -160);
    applyPhysics3dFreeCamera(native, state);

    const camera = native.camera as THREE.OrthographicCamera;
    expect(state.yaw).not.toBe(before.yaw);
    expect(state.pitch).not.toBe(before.pitch);
    expect(state.target).not.toEqual(before.target);
    expect(state.zoom).toBeGreaterThan(before.zoom);
    expect(camera.zoom).toBe(state.zoom);
    expect(
      camera.position.distanceTo(new THREE.Vector3(state.target.x, state.target.y, state.target.z))
    ).toBeCloseTo(state.distance);
  });
});

function stepLab(lab: Physics3dLab, frames: number) {
  let snapshot = lab.snapshot();
  for (let index = 0; index < frames; index += 1) {
    snapshot = lab.step(1000 / 60);
  }
  return snapshot;
}

function createFakeThreeNative(): ThreeRendererNative<THREE.Scene, THREE.Object3D> {
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-480, 480, 320, -320, 0.1, 10000);
  return {
    view: {} as HTMLCanvasElement,
    scene,
    camera,
    resources: {},
    factories: {},
    resize() {},
    render() {},
    destroy() {},
    object() {
      return new THREE.Object3D();
    },
    node(_objectId: RenderObjectId, _nodePath: RenderNodePath) {
      return new THREE.Object3D();
    },
    inspectObject() {
      return emptyDiagnostics();
    },
    inspectNode() {
      return emptyDiagnostics();
    },
    applyObjectState(_id: RenderObjectId, _state: ThreeRenderTargetState) {},
    applyNodeState(
      _objectId: RenderObjectId,
      _nodePath: RenderNodePath,
      _state: ThreeRenderTargetState
    ) {},
    applyTargetState(_target: THREE.Object3D, _state: ThreeRenderTargetState) {}
  } as unknown as ThreeRendererNative<THREE.Scene, THREE.Object3D>;
}

function emptyDiagnostics() {
  return {
    type: "group",
    visible: true,
    assetBacked: false,
    nodeCount: 0,
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
}
