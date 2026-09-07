import type { ThreeRendererNative } from "@gamekits/driver-three";
import type { PhysicsVector } from "@gamekits/physics-core";
import * as THREE from "three";
import type {
  Physics3dLabObject,
  Physics3dLabQueryMode,
  Physics3dLabRole,
  Physics3dLabSnapshot
} from "./physics-3d-lab";

export type Physics3dLabVisual = {
  update(snapshot: Physics3dLabSnapshot): void;
  destroy(): void;
};

const UNIT = 74;
const QUERY_DISPLAY_Y = 2.1;
const QUERY_POINTER_PLANE_Y = 80 / UNIT;
const QUERY_BOUNDS = {
  minX: -3.8,
  maxX: 3.8,
  minZ: -2.8,
  maxZ: 2.8
};
const pointerRaycaster = new THREE.Raycaster();
const pointerNdc = new THREE.Vector2();
const queryPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -QUERY_POINTER_PLANE_Y * UNIT);
const queryIntersection = new THREE.Vector3();

export function createPhysics3dLabVisual(native: ThreeRendererNative): Physics3dLabVisual {
  const root = new THREE.Group();
  root.name = "physics-3d-lab.debug-root";
  const objectMeshes = new Map<string, THREE.Mesh>();
  const contactPulses = new Map<string, number>();
  const queryProbe = new THREE.Mesh(
    new THREE.SphereGeometry(UNIT, 32, 16),
    new THREE.MeshStandardMaterial({
      color: 0xe0c15f,
      emissive: 0x4f3900,
      opacity: 0.28,
      transparent: true,
      wireframe: true,
      depthTest: false,
      depthWrite: false
    })
  );
  queryProbe.name = "physics-3d-lab.query-probe";
  root.add(queryProbe);

  const ambient = new THREE.AmbientLight(0xdfe9db, 0.64);
  const key = new THREE.DirectionalLight(0xffffff, 1.5);
  key.position.set(240, 420, 520);
  const rim = new THREE.DirectionalLight(0x8fc7ff, 0.82);
  rim.position.set(-320, 210, -420);
  root.add(ambient, key, rim);
  native.scene.add(root);

  return {
    update(snapshot) {
      applyCameraPreset(native, root, snapshot);
      const hitColliders = new Set(snapshot.queryHits.map((hit) => hit.colliderId));
      for (const contact of snapshot.contacts) {
        contactPulses.set(contact.colliderA, 1);
        contactPulses.set(contact.colliderB, 1);
      }

      for (const object of snapshot.objects) {
        const mesh = ensureMesh(root, objectMeshes, object);
        syncMesh(
          mesh,
          object,
          hitColliders.has(object.colliderId),
          contactPulses.get(object.colliderId) ?? 0
        );
      }
      for (const [id, mesh] of objectMeshes.entries()) {
        if (!snapshot.objects.some((object) => object.id === id)) {
          mesh.removeFromParent();
          disposeMesh(mesh);
          objectMeshes.delete(id);
        }
      }
      for (const [colliderId, pulse] of contactPulses.entries()) {
        const nextPulse = Math.max(0, pulse - 0.08);
        if (nextPulse <= 0) {
          contactPulses.delete(colliderId);
        } else {
          contactPulses.set(colliderId, nextPulse);
        }
      }
      syncQueryProbe(queryProbe, snapshot.queryMode, snapshot.queryPoint);
      native.render();
    },
    destroy() {
      root.removeFromParent();
      root.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          disposeMesh(child);
        }
      });
    }
  };
}

export function screenToPhysicsQueryPoint(
  native: ThreeRendererNative,
  viewport: Pick<DOMRectReadOnly, "left" | "top" | "width" | "height">,
  clientX: number,
  clientY: number
): PhysicsVector | undefined {
  if (viewport.width <= 0 || viewport.height <= 0) {
    return undefined;
  }
  const camera = native.camera as THREE.Camera;
  camera.updateMatrixWorld();
  pointerNdc.set(
    ((clientX - viewport.left) / viewport.width) * 2 - 1,
    -(((clientY - viewport.top) / viewport.height) * 2 - 1)
  );
  pointerRaycaster.setFromCamera(pointerNdc, camera);
  const hit = pointerRaycaster.ray.intersectPlane(queryPlane, queryIntersection);
  if (!hit) {
    return undefined;
  }
  return {
    x: clamp(hit.x / UNIT, QUERY_BOUNDS.minX, QUERY_BOUNDS.maxX),
    y: QUERY_DISPLAY_Y,
    z: clamp(hit.z / UNIT, QUERY_BOUNDS.minZ, QUERY_BOUNDS.maxZ)
  };
}

function ensureMesh(
  root: THREE.Group,
  meshes: Map<string, THREE.Mesh>,
  object: Physics3dLabObject
): THREE.Mesh {
  const shapeKey = shapeSignature(object);
  const existing = meshes.get(object.id);
  if (existing?.userData.shapeKey === shapeKey) {
    return existing;
  }
  if (existing) {
    existing.removeFromParent();
    disposeMesh(existing);
  }

  const mesh = new THREE.Mesh(createGeometry(object), createMaterial(object.role, object.sensor));
  mesh.name = `physics-3d-lab.${object.id}`;
  mesh.castShadow = object.role !== "trigger";
  mesh.receiveShadow = object.role === "floor";
  mesh.renderOrder = renderOrderForRole(object.role);
  mesh.userData.shapeKey = shapeKey;
  root.add(mesh);
  meshes.set(object.id, mesh);
  return mesh;
}

function syncMesh(
  mesh: THREE.Mesh,
  object: Physics3dLabObject,
  highlighted: boolean,
  pulse: number
): void {
  mesh.position.set(
    object.position.x * UNIT,
    object.position.y * UNIT,
    (object.position.z ?? 0) * UNIT
  );
  if (object.rotation !== undefined) {
    if (typeof object.rotation === "number") {
      mesh.rotation.set(0, 0, object.rotation);
    } else if ("w" in object.rotation) {
      mesh.quaternion.set(
        object.rotation.x,
        object.rotation.y,
        object.rotation.z,
        object.rotation.w
      );
    } else {
      mesh.rotation.set(object.rotation.x, object.rotation.y, object.rotation.z ?? 0);
    }
  }
  const material = mesh.material;
  if (material instanceof THREE.MeshStandardMaterial) {
    material.emissive.set(highlighted ? 0x6e5300 : pulse > 0 ? 0x244e2a : 0x000000);
    material.opacity = opacityForObject(object, pulse, highlighted);
    material.transparent = object.sensor || material.opacity < 1;
    material.depthWrite = !object.sensor && object.role !== "floor";
  }
}

function syncQueryProbe(
  probe: THREE.Mesh,
  mode: Physics3dLabQueryMode,
  point: { x: number; y: number; z?: number }
): void {
  probe.position.set(point.x * UNIT, point.y * UNIT, (point.z ?? 0) * UNIT);
  const nextGeometry = createQueryGeometry(mode);
  const currentKey = probe.userData.queryMode;
  if (currentKey !== mode) {
    probe.geometry.dispose();
    probe.geometry = nextGeometry;
    probe.userData.queryMode = mode;
  } else {
    nextGeometry.dispose();
  }
}

function createGeometry(object: Physics3dLabObject): THREE.BufferGeometry {
  const shape = object.shape;
  if (shape.type === "sphere") {
    return new THREE.SphereGeometry(shape.radius * UNIT, 32, 18);
  }
  if (shape.type === "capsule") {
    return new THREE.CylinderGeometry(
      shape.radius * UNIT,
      shape.radius * UNIT,
      (shape.height + shape.radius * 2) * UNIT,
      24,
      1
    );
  }
  if (shape.type === "box") {
    return new THREE.BoxGeometry(
      shape.width * UNIT,
      shape.height * UNIT,
      (shape.depth ?? 0.2) * UNIT
    );
  }
  return new THREE.BoxGeometry(UNIT, UNIT, UNIT);
}

function createQueryGeometry(mode: Physics3dLabQueryMode): THREE.BufferGeometry {
  if (mode === "overlap-box") {
    return new THREE.BoxGeometry(1.4 * UNIT, 1.4 * UNIT, 1.4 * UNIT);
  }
  if (mode === "point") {
    return new THREE.SphereGeometry(0.12 * UNIT, 16, 8);
  }
  return new THREE.SphereGeometry(1.05 * UNIT, 32, 16);
}

function createMaterial(role: Physics3dLabRole, sensor: boolean): THREE.MeshStandardMaterial {
  const isFloor = role === "floor";
  return new THREE.MeshStandardMaterial({
    color: colorForRole(role),
    opacity: sensor ? 0.1 : isFloor ? 0.36 : 0.86,
    transparent: sensor || isFloor,
    wireframe: sensor,
    depthWrite: !sensor && !isFloor,
    metalness: 0.08,
    roughness: 0.52
  });
}

function colorForRole(role: Physics3dLabRole): number {
  if (role === "character") {
    return 0x66e2ff;
  }
  if (role === "drop") {
    return 0x91d887;
  }
  if (role === "spinner") {
    return 0x78b8ff;
  }
  if (role === "trigger") {
    return 0xe0c15f;
  }
  return 0x9daaa0;
}

function applyCameraPreset(
  native: ThreeRendererNative,
  root: THREE.Group,
  snapshot: Physics3dLabSnapshot
): void {
  root.rotation.set(0, 0, 0);
  root.position.set(0, 0, 0);
  const camera = native.camera as THREE.Camera & {
    zoom?: number | undefined;
    updateProjectionMatrix?: (() => void) | undefined;
  };
  const queryX = snapshot.queryPoint.x * UNIT;
  const queryY = snapshot.queryPoint.y * UNIT;
  const queryZ = (snapshot.queryPoint.z ?? 0) * UNIT;

  if (snapshot.cameraPreset === "free") {
    return;
  }
  if (snapshot.cameraPreset === "side") {
    setCamera(camera, {
      position: { x: 740, y: 220, z: 0 },
      target: { x: 0, y: 70, z: 0 },
      zoom: 0.74
    });
    return;
  }
  if (snapshot.cameraPreset === "probe") {
    setCamera(camera, {
      position: { x: queryX + 420, y: Math.max(250, queryY + 210), z: queryZ + 560 },
      target: { x: queryX, y: queryY - 40, z: queryZ },
      zoom: 0.88
    });
    return;
  }
  setCamera(camera, {
    position: { x: 560, y: 430, z: 760 },
    target: { x: 0, y: 80, z: 0 },
    zoom: 0.7
  });
}

function setCamera(
  camera: THREE.Camera & {
    zoom?: number | undefined;
    updateProjectionMatrix?: (() => void) | undefined;
  },
  state: {
    position: Required<Physics3dLabObject["position"]>;
    target: Required<Physics3dLabObject["position"]>;
    zoom: number;
  }
): void {
  camera.up.set(0, 1, 0);
  camera.position.set(state.position.x, state.position.y, state.position.z);
  camera.lookAt(state.target.x, state.target.y, state.target.z);
  if (typeof camera.zoom === "number") {
    camera.zoom = state.zoom;
    camera.updateProjectionMatrix?.();
  }
  camera.updateMatrixWorld();
}

function opacityForObject(object: Physics3dLabObject, pulse: number, highlighted: boolean): number {
  if (object.role === "floor") {
    return 0.34;
  }
  if (object.sensor) {
    return highlighted ? 0.3 : 0.14;
  }
  return Math.min(1, 0.86 + pulse * 0.14);
}

function renderOrderForRole(role: Physics3dLabRole): number {
  if (role === "floor") {
    return -2;
  }
  if (role === "trigger") {
    return 4;
  }
  return 0;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function shapeSignature(object: Physics3dLabObject): string {
  return `${object.shape.type}:${JSON.stringify(object.shape)}`;
}

function disposeMesh(mesh: THREE.Mesh): void {
  mesh.geometry.dispose();
  const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  for (const material of materials) {
    material.dispose();
  }
}
