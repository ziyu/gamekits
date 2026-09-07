import type { ThreeRendererNative } from "@gamekits/driver-three";
import type { PhysicsRotation } from "@gamekits/physics-core";
import * as THREE from "three";
import type { CharacterControllerLabThirdPersonCamera } from "./camera";
import type { CharacterControllerLabCourseObjectRole } from "./course";
import type { CharacterControllerLabSnapshot } from "./runtime";

const UNIT = 42;
const COLOR = {
  asphalt: 0x26342e,
  concrete: 0x65776d,
  mint: 0x62dcae,
  amber: 0xf3c95b,
  coral: 0xff755f,
  blue: 0x4ca8ff,
  violet: 0xa987ff,
  lime: 0xb7ed62,
  sky: 0xa9d7d0,
  dark: 0x101713,
  white: 0xf4f0e2
} as const;

export type CharacterControllerLabVisual = {
  update(snapshot: CharacterControllerLabSnapshot, deltaMs?: number): void;
  destroy(): void;
};

export function createCharacterControllerLabVisual(
  native: ThreeRendererNative,
  camera: CharacterControllerLabThirdPersonCamera
): CharacterControllerLabVisual {
  const root = new THREE.Group();
  root.name = "character-controller-lab.proving-park";
  const courseMeshes = new Map<string, THREE.Mesh>();
  const labelSprites = new Map<string, THREE.Sprite>();
  const avatar = createAvatar();
  const groundProbe = createGroundProbe();
  const obstacles: THREE.Object3D[] = [];
  const previousPosition = new THREE.Vector3();
  let initialized = false;

  setupEnvironment(native, root);
  createParkPresentation(root);
  root.add(avatar, groundProbe);
  native.scene.add(root);
  configureRenderer(native.renderer);

  return {
    update(snapshot, deltaMs = 1000 / 60) {
      for (const object of snapshot.course) {
        const existing = courseMeshes.get(object.id);
        const mesh = existing ?? ensureCourseMesh(root, courseMeshes, object);
        if (!existing) obstacles.push(mesh);
        syncTransform(mesh, object.position, object.rotation);
        if (object.showLabel) {
          const label = ensureLabel(root, labelSprites, object.id, object.label, object.role);
          label.position.set(
            object.position.x * UNIT,
            object.position.y * UNIT + labelOffset(object.role),
            (object.position.z ?? 0) * UNIT
          );
          label.visible =
            Math.hypot(
              object.position.x - snapshot.body.position.x,
              (object.position.z ?? 0) - (snapshot.body.position.z ?? 0)
            ) > 7.2;
        }
      }

      const body = snapshot.body;
      const nextPosition = new THREE.Vector3(
        body.position.x * UNIT,
        body.position.y * UNIT,
        (body.position.z ?? 0) * UNIT
      );
      if (!initialized || previousPosition.distanceToSquared(nextPosition) > (8 * UNIT) ** 2) {
        avatar.position.copy(nextPosition);
        initialized = true;
      } else {
        avatar.position.lerp(nextPosition, 1 - Math.exp(-Math.min(80, deltaMs) / 45));
      }
      previousPosition.copy(nextPosition);
      avatar.rotation.y = snapshot.motor.facingYaw;
      updateAvatar(avatar, snapshot, deltaMs);
      groundProbe.position.set(
        avatar.position.x,
        avatar.position.y - 0.82 * UNIT,
        avatar.position.z
      );
      groundProbe.visible = snapshot.motor.grounded;
      groundProbe.scale.setScalar(
        snapshot.motor.grounded ? 1 + Math.sin(snapshot.elapsedMs / 100) * 0.08 : 1
      );

      camera.update(body.position, deltaMs, obstacles);
      render(native, camera.camera);
    },
    destroy() {
      root.removeFromParent();
      disposeObject(root);
      courseMeshes.clear();
      labelSprites.clear();
      obstacles.length = 0;
    }
  };
}

function createAvatar(): THREE.Group {
  const root = new THREE.Group();
  root.name = "character-controller-lab.runner";
  const bodyMaterial = new THREE.MeshStandardMaterial({
    color: COLOR.amber,
    emissive: 0x382700,
    metalness: 0.08,
    roughness: 0.54
  });
  const darkMaterial = new THREE.MeshStandardMaterial({
    color: 0x1d2924,
    roughness: 0.72
  });
  const accentMaterial = new THREE.MeshStandardMaterial({
    color: COLOR.coral,
    emissive: 0x3a0b05,
    roughness: 0.42
  });
  const torso = mesh(
    new THREE.CapsuleGeometry(0.34 * UNIT, 0.62 * UNIT, 6, 14),
    bodyMaterial,
    "runner.torso"
  );
  torso.position.y = 0.02 * UNIT;
  const head = mesh(new THREE.SphereGeometry(0.29 * UNIT, 18, 12), bodyMaterial, "runner.head");
  head.position.y = 0.7 * UNIT;
  const visor = mesh(
    new THREE.BoxGeometry(0.31 * UNIT, 0.12 * UNIT, 0.08 * UNIT),
    new THREE.MeshStandardMaterial({
      color: 0x152833,
      emissive: 0x16455c,
      emissiveIntensity: 0.65,
      metalness: 0.65,
      roughness: 0.2
    }),
    "runner.visor"
  );
  visor.position.set(0, 0.72 * UNIT, 0.25 * UNIT);
  const backpack = mesh(
    new THREE.BoxGeometry(0.42 * UNIT, 0.48 * UNIT, 0.2 * UNIT),
    darkMaterial,
    "runner.pack"
  );
  backpack.position.set(0, 0.2 * UNIT, -0.32 * UNIT);
  const directionPlate = mesh(
    new THREE.ConeGeometry(0.12 * UNIT, 0.34 * UNIT, 8),
    accentMaterial,
    "runner.direction"
  );
  directionPlate.rotation.x = Math.PI / 2;
  directionPlate.position.set(0, 0.18 * UNIT, 0.58 * UNIT);
  const leftFoot = createFoot(darkMaterial, -0.2 * UNIT);
  const rightFoot = createFoot(darkMaterial, 0.2 * UNIT);
  root.add(torso, head, visor, backpack, directionPlate, leftFoot, rightFoot);
  root.userData.bodyMaterial = bodyMaterial;
  root.userData.leftFoot = leftFoot;
  root.userData.rightFoot = rightFoot;
  return root;
}

function createFoot(material: THREE.Material, x: number): THREE.Mesh {
  const foot = mesh(
    new THREE.BoxGeometry(0.24 * UNIT, 0.22 * UNIT, 0.38 * UNIT),
    material,
    "runner.foot"
  );
  foot.position.set(x, -0.68 * UNIT, -0.06 * UNIT);
  return foot;
}

function updateAvatar(
  avatar: THREE.Group,
  snapshot: CharacterControllerLabSnapshot,
  deltaMs: number
): void {
  const material = avatar.userData.bodyMaterial as THREE.MeshStandardMaterial;
  material.color.setHex(modeColor(snapshot.motor.mode));
  material.emissive.setHex(modeEmissive(snapshot.motor.mode));
  const speed = Math.hypot(snapshot.body.linearVelocity.x, snapshot.body.linearVelocity.z ?? 0);
  const stride = Math.sin(snapshot.elapsedMs * 0.018 * Math.max(0.4, speed));
  const amplitude = snapshot.motor.grounded ? Math.min(0.7, speed / 8) : 0.1;
  (avatar.userData.leftFoot as THREE.Mesh).rotation.x = stride * amplitude;
  (avatar.userData.rightFoot as THREE.Mesh).rotation.x = -stride * amplitude;
  const targetTilt =
    snapshot.motor.mode === "diving" ? -0.92 : snapshot.motor.mode === "staggered" ? 0.32 : 0;
  avatar.rotation.x = THREE.MathUtils.lerp(
    avatar.rotation.x,
    targetTilt,
    1 - Math.exp(-Math.min(80, deltaMs) / 90)
  );
}

function createGroundProbe(): THREE.Mesh {
  const material = new THREE.MeshBasicMaterial({
    color: COLOR.mint,
    opacity: 0.48,
    transparent: true,
    depthWrite: false
  });
  const ring = mesh(new THREE.RingGeometry(0.34 * UNIT, 0.47 * UNIT, 30), material, "ground-probe");
  ring.rotation.x = -Math.PI / 2;
  ring.renderOrder = 8;
  return ring;
}

function ensureCourseMesh(
  root: THREE.Group,
  meshes: Map<string, THREE.Mesh>,
  object: CharacterControllerLabSnapshot["course"][number]
): THREE.Mesh {
  const shape = object.shape;
  const geometry =
    shape.type === "sphere"
      ? new THREE.SphereGeometry(shape.radius * UNIT, 24, 16)
      : new THREE.BoxGeometry(shape.width * UNIT, shape.height * UNIT, (shape.depth ?? 1) * UNIT);
  const material = new THREE.MeshStandardMaterial({
    color: roleColor(object.role),
    metalness: object.role === "platform" || object.role === "hazard" ? 0.42 : 0.08,
    roughness: object.role === "floor" ? 0.92 : 0.58,
    emissive: roleEmissive(object.role),
    emissiveIntensity: object.role === "hazard" ? 0.52 : 0.2
  });
  const courseMesh = mesh(geometry, material, `course.${object.id}`);
  courseMesh.receiveShadow = true;
  courseMesh.castShadow = object.role !== "floor";
  root.add(courseMesh);
  meshes.set(object.id, courseMesh);
  return courseMesh;
}

function ensureLabel(
  root: THREE.Group,
  labels: Map<string, THREE.Sprite>,
  id: string,
  text: string,
  role: CharacterControllerLabCourseObjectRole
): THREE.Sprite {
  const existing = labels.get(id);
  if (existing) return existing;
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 88;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Character Controller Lab label canvas is unavailable");
  context.fillStyle = "rgba(9, 15, 12, 0.88)";
  context.fillRect(1, 1, canvas.width - 2, canvas.height - 2);
  context.strokeStyle = `#${roleColor(role).toString(16).padStart(6, "0")}`;
  context.lineWidth = 4;
  context.strokeRect(2, 2, canvas.width - 4, canvas.height - 4);
  context.fillStyle = "#f4f0e2";
  context.font = "700 28px Avenir Next, sans-serif";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(text.toUpperCase(), canvas.width / 2, canvas.height / 2 + 1);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: true })
  );
  sprite.scale.set(3.7 * UNIT, 0.64 * UNIT, 1);
  sprite.renderOrder = 12;
  root.add(sprite);
  labels.set(id, sprite);
  return sprite;
}

function setupEnvironment(native: ThreeRendererNative, root: THREE.Group): void {
  native.scene.background = new THREE.Color(COLOR.sky);
  native.scene.fog = new THREE.Fog(0x91bdb5, 24 * UNIT, 75 * UNIT);
  const hemisphere = new THREE.HemisphereLight(0xf0fff7, 0x25372d, 2.3);
  const sun = new THREE.DirectionalLight(0xfff0c7, 3.2);
  sun.position.set(-14 * UNIT, 22 * UNIT, 11 * UNIT);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const shadowCamera = sun.shadow.camera;
  shadowCamera.left = -22 * UNIT;
  shadowCamera.right = 22 * UNIT;
  shadowCamera.top = 22 * UNIT;
  shadowCamera.bottom = -22 * UNIT;
  shadowCamera.near = 1;
  shadowCamera.far = 60 * UNIT;
  const rim = new THREE.DirectionalLight(0x5ae5c1, 1.1);
  rim.position.set(15 * UNIT, 7 * UNIT, -14 * UNIT);
  root.add(hemisphere, sun, rim);
}

function createParkPresentation(root: THREE.Group): void {
  const grid = new THREE.GridHelper(34 * UNIT, 34, 0x49665a, 0x33483f);
  grid.position.y = 0.012 * UNIT;
  const outerRing = mesh(
    new THREE.RingGeometry(15.4 * UNIT, 15.62 * UNIT, 96),
    new THREE.MeshBasicMaterial({ color: COLOR.mint, opacity: 0.28, transparent: true }),
    "park.boundary-ring"
  );
  outerRing.rotation.x = -Math.PI / 2;
  outerRing.position.y = 0.018 * UNIT;
  root.add(grid, outerRing);

  const zoneColors = [COLOR.mint, COLOR.amber, COLOR.coral, COLOR.blue, COLOR.violet] as const;
  const zonePositions = [
    [-10.5, -2.5],
    [-4.3, -9],
    [7.5, -10.2],
    [11.2, 5.8],
    [-2, 12]
  ] as const;
  zonePositions.forEach(([x, z], index) => {
    const marker = mesh(
      new THREE.RingGeometry(1.05 * UNIT, 1.18 * UNIT, 36),
      new THREE.MeshBasicMaterial({
        color: zoneColors[index] ?? COLOR.mint,
        opacity: 0.55,
        transparent: true,
        depthWrite: false
      }),
      `park.zone.${index + 1}`
    );
    marker.rotation.x = -Math.PI / 2;
    marker.position.set(x * UNIT, 0.03 * UNIT, z * UNIT);
    root.add(marker);
  });

  for (const [x, z, color] of [
    [-15.5, -15.5, COLOR.mint],
    [15.5, -15.5, COLOR.amber],
    [-15.5, 15.5, COLOR.blue],
    [15.5, 15.5, COLOR.coral]
  ] as const) {
    root.add(createBeacon(x * UNIT, z * UNIT, color));
  }
}

function createBeacon(x: number, z: number, color: number): THREE.Group {
  const beacon = new THREE.Group();
  beacon.position.set(x, 0, z);
  const pole = mesh(
    new THREE.CylinderGeometry(0.05 * UNIT, 0.08 * UNIT, 3.2 * UNIT, 10),
    new THREE.MeshStandardMaterial({ color: 0x283831, metalness: 0.5, roughness: 0.4 }),
    "park.beacon.pole"
  );
  pole.position.y = 1.6 * UNIT;
  const light = mesh(
    new THREE.SphereGeometry(0.15 * UNIT, 14, 10),
    new THREE.MeshBasicMaterial({ color }),
    "park.beacon.light"
  );
  light.position.y = 3.1 * UNIT;
  beacon.add(pole, light);
  return beacon;
}

function configureRenderer(renderer: THREE.WebGLRenderer | undefined): void {
  if (!renderer) return;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
}

function render(native: ThreeRendererNative, camera: THREE.PerspectiveCamera): void {
  if (native.renderer) native.renderer.render(native.scene, camera);
  else native.render();
}

function syncTransform(
  object: THREE.Object3D,
  position: CharacterControllerLabSnapshot["body"]["position"],
  rotation: PhysicsRotation | undefined
): void {
  object.position.set(position.x * UNIT, position.y * UNIT, (position.z ?? 0) * UNIT);
  if (rotation === undefined) return;
  if (typeof rotation === "number") object.rotation.set(0, 0, rotation);
  else if ("w" in rotation) object.quaternion.set(rotation.x, rotation.y, rotation.z, rotation.w);
  else object.rotation.set(rotation.x, rotation.y, rotation.z ?? 0);
}

function roleColor(role: CharacterControllerLabCourseObjectRole): number {
  if (role === "slope") return COLOR.mint;
  if (role === "step") return COLOR.amber;
  if (role === "ledge") return COLOR.coral;
  if (role === "platform") return COLOR.blue;
  if (role === "bumper") return COLOR.lime;
  if (role === "ceiling") return COLOR.violet;
  if (role === "beam") return 0xf1e2a2;
  if (role === "crate") return 0xc9874b;
  if (role === "hazard") return 0xff564a;
  if (role === "wall") return COLOR.concrete;
  return COLOR.asphalt;
}

function roleEmissive(role: CharacterControllerLabCourseObjectRole): number {
  if (role === "platform") return 0x09294b;
  if (role === "hazard") return 0x48110b;
  if (role === "ledge") return 0x351207;
  if (role === "step") return 0x302300;
  return 0x06100c;
}

function modeColor(mode: CharacterControllerLabSnapshot["motor"]["mode"]): number {
  if (mode === "diving") return COLOR.coral;
  if (mode === "staggered") return 0xff4f66;
  if (mode === "recovering") return COLOR.violet;
  return COLOR.amber;
}

function modeEmissive(mode: CharacterControllerLabSnapshot["motor"]["mode"]): number {
  if (mode === "staggered") return 0x5b0715;
  if (mode === "diving") return 0x512000;
  if (mode === "recovering") return 0x21184f;
  return 0x382700;
}

function labelOffset(role: CharacterControllerLabCourseObjectRole): number {
  if (role === "ceiling") return 1.35 * UNIT;
  if (role === "platform" || role === "bumper" || role === "hazard") return 1.9 * UNIT;
  return 1.45 * UNIT;
}

function mesh<TGeometry extends THREE.BufferGeometry, TMaterial extends THREE.Material>(
  geometry: TGeometry,
  material: TMaterial,
  name: string
): THREE.Mesh<TGeometry, TMaterial> {
  const result = new THREE.Mesh(geometry, material);
  result.name = name;
  result.castShadow = true;
  result.receiveShadow = true;
  return result;
}

function disposeObject(object: THREE.Object3D): void {
  object.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      child.geometry.dispose();
      disposeMaterial(child.material);
    }
    if (child instanceof THREE.Sprite) {
      child.material.map?.dispose();
      child.material.dispose();
    }
  });
}

function disposeMaterial(material: THREE.Material | THREE.Material[]): void {
  for (const entry of Array.isArray(material) ? material : [material]) entry.dispose();
}
