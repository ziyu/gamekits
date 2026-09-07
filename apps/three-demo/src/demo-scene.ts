import type { AssetLoadStatus, AssetManager } from "@gamekits/asset";
import type {
  ThreeDriverCameraAdapter,
  ThreeRendererNative,
  ThreeRenderTargetDiagnostics,
  ThreeRenderTargetState
} from "@gamekits/driver-three";
import type {
  RenderNodeDefinition,
  RenderObjectId,
  RendererAdapter
} from "@gamekits/renderer-core";
import * as THREE from "three";
import { THREE_DEMO_ASSET_IDS } from "./demo-assets";

export type ThreeDemoMode = "assets" | "materials" | "animation";
export type ThreeDemoMaterial = "original" | "studio" | "chrome" | "hologram" | "physical";
export type ThreeDemoModel = "robot" | "tokyo" | "flamingo" | "relay";
export type ThreeDemoTexture = "none" | "uv" | "brick" | "wood";
export type ThreeDemoClip = "auto" | "Idle" | "Walking" | "Running" | "Dance";
export type ThreeDemoCameraPreset = "studio" | "overhead" | "macro";
export type ThreeDemoLightingPreset = "neutral" | "neon" | "inspection";

export type ThreeDemoAssetSnapshot = {
  id: string;
  label: string;
  type: string;
  status: AssetLoadStatus;
  lazy: boolean;
  error?: string | undefined;
};

export type ThreeDemoSceneSnapshot = {
  objectId?: RenderObjectId | undefined;
  mode: ThreeDemoMode;
  material: ThreeDemoMaterial;
  model: ThreeDemoModel;
  texture: ThreeDemoTexture;
  clip: ThreeDemoClip;
  cameraPreset: ThreeDemoCameraPreset;
  lightingPreset: ThreeDemoLightingPreset;
  wireframe: boolean;
  playing: boolean;
  animationSpeed: number;
  timelineMs: number;
  elapsedMs: number;
  objectCount: number;
  nativeMutationCount: number;
  assets: ThreeDemoAssetSnapshot[];
  activeModel?: ThreeRenderTargetDiagnostics | undefined;
};

export type ThreeDemoSceneOptions = {
  camera?: ThreeDriverCameraAdapter | undefined;
  assets?: AssetManager | undefined;
  viewport?: { width: number; height: number } | undefined;
  onSnapshot?: ((snapshot: ThreeDemoSceneSnapshot) => void) | undefined;
};

export type ThreeDemoScene = {
  boot(): void;
  update(deltaMs: number): void;
  resize(width: number, height: number): void;
  setMode(mode: ThreeDemoMode): void;
  setMaterial(material: ThreeDemoMaterial): void;
  setModel(model: ThreeDemoModel): void;
  setTexture(texture: ThreeDemoTexture): void;
  setClip(clip: ThreeDemoClip): void;
  setCameraPreset(preset: ThreeDemoCameraPreset): void;
  setLightingPreset(preset: ThreeDemoLightingPreset): void;
  setAnimationSpeed(speed: number): void;
  setTimelineMs(timeMs: number): void;
  setPlaying(enabled: boolean): void;
  setWireframe(enabled: boolean): void;
  refreshAssets(): void;
  reset(): void;
  snapshot(): ThreeDemoSceneSnapshot;
  destroy(): void;
};

const ROOT_OBJECT_ID = "three-demo.scene";
const TIMELINE_DURATION_MS = 8000;
const SCENE_OBJECT_COUNT = 16;

const MODEL_NODE_PATHS: Record<ThreeDemoModel, string> = {
  robot: "asset-stage/model-robot",
  tokyo: "asset-stage/model-tokyo",
  flamingo: "asset-stage/model-flamingo",
  relay: "asset-stage/model-relay"
};

const TEXTURE_ASSET_BY_NAME: Record<Exclude<ThreeDemoTexture, "none">, string> = {
  uv: THREE_DEMO_ASSET_IDS.uvTexture,
  brick: THREE_DEMO_ASSET_IDS.brickTexture,
  wood: THREE_DEMO_ASSET_IDS.woodTexture
};

const ASSET_LABELS: Record<string, string> = {
  [THREE_DEMO_ASSET_IDS.robot]: "Robot Expressive",
  [THREE_DEMO_ASSET_IDS.tokyo]: "Littlest Tokyo",
  [THREE_DEMO_ASSET_IDS.flamingo]: "Flamingo",
  [THREE_DEMO_ASSET_IDS.uvTexture]: "UV Grid",
  [THREE_DEMO_ASSET_IDS.brickTexture]: "Brick Texture",
  [THREE_DEMO_ASSET_IDS.woodTexture]: "Wood Texture"
};

const MATERIAL_SAMPLE_NODE_PATHS: Record<Exclude<ThreeDemoMaterial, "original">, string> = {
  studio: "material-lab/material-studio",
  chrome: "material-lab/material-chrome",
  hologram: "material-lab/material-hologram",
  physical: "material-lab/material-physical"
};

const LIGHT_PRESETS: Record<
  ThreeDemoLightingPreset,
  {
    ambient: number;
    key: number;
    fill: number;
    rim: number;
    keyColor: string;
    rimColor: string;
  }
> = {
  neutral: {
    ambient: 0.7,
    key: 1.45,
    fill: 0.82,
    rim: 0.9,
    keyColor: "#ffffff",
    rimColor: "#9fb7ff"
  },
  neon: {
    ambient: 0.42,
    key: 1.1,
    fill: 0.65,
    rim: 1.8,
    keyColor: "#a7ffe1",
    rimColor: "#ff7ac8"
  },
  inspection: {
    ambient: 0.88,
    key: 1.8,
    fill: 0.9,
    rim: 0.42,
    keyColor: "#fff1c2",
    rimColor: "#8fb0ff"
  }
};

type OriginalMaterialEntry = {
  mesh: THREE.Mesh;
  material: THREE.Material | THREE.Material[];
};

type AnimationBinding = {
  mixer: THREE.AnimationMixer;
  activeClipName?: string | undefined;
  action?: THREE.AnimationAction | undefined;
};

const originalMaterials = new WeakMap<THREE.Object3D, OriginalMaterialEntry[]>();
const animationBindings = new WeakMap<THREE.Object3D, AnimationBinding>();

export function createThreeDemoScene(
  renderer: RendererAdapter,
  options: ThreeDemoSceneOptions = {}
): ThreeDemoScene {
  let objectId: RenderObjectId | undefined;
  let elapsedMs = 0;
  let timelineMs = 0;
  let mode: ThreeDemoMode = "assets";
  let material: ThreeDemoMaterial = "original";
  let model: ThreeDemoModel = "robot";
  let texture: ThreeDemoTexture = "uv";
  let clip: ThreeDemoClip = "auto";
  let cameraPreset: ThreeDemoCameraPreset = "studio";
  let lightingPreset: ThreeDemoLightingPreset = "neutral";
  let wireframe = false;
  let playing = true;
  let animationSpeed = 1;
  let nativeMutationCount = 0;
  let viewport = options.viewport ?? { width: 1120, height: 720 };

  const emitSnapshot = (): void => {
    options.onSnapshot?.(snapshot());
  };

  const bootSceneObject = (): void => {
    if (objectId) {
      return;
    }
    objectId = renderer.createObject({
      id: ROOT_OBJECT_ID,
      type: "group",
      children: createSceneNodes()
    });
    applyMode();
    applyModelVisibility();
    applyLighting();
    applyCamera();
    syncNativeScene();
    emitSnapshot();
  };

  const applyNodeState = (nodePath: string, state: ThreeRenderTargetState): void => {
    if (!objectId) {
      return;
    }
    readThreeNative(renderer.native())?.applyNodeState(objectId, nodePath, state);
  };

  const mutateNative = (visit: (native: ThreeRendererNative) => void): void => {
    if (!objectId) {
      return;
    }
    const native = readThreeNative(renderer.native());
    if (!native) {
      return;
    }
    visit(native);
    native.render();
    nativeMutationCount += 1;
  };

  const snapshot = (): ThreeDemoSceneSnapshot => ({
    objectId,
    mode,
    material,
    model,
    texture,
    clip,
    cameraPreset,
    lightingPreset,
    wireframe,
    playing,
    animationSpeed,
    timelineMs: Math.round(timelineMs),
    elapsedMs: Math.round(elapsedMs),
    objectCount: objectId ? SCENE_OBJECT_COUNT : 0,
    nativeMutationCount,
    assets: readAssetSnapshots(options.assets),
    activeModel: inspectActiveModel()
  });

  return {
    boot() {
      bootSceneObject();
    },
    update(deltaMs) {
      if (!objectId) {
        return;
      }
      const clampedDelta = Math.max(0, Math.min(deltaMs, 80));
      elapsedMs += clampedDelta;
      if (playing) {
        timelineMs = (timelineMs + clampedDelta * animationSpeed) % TIMELINE_DURATION_MS;
      }

      const phase = elapsedMs / 1000;
      applyNodeState("scan-ring", {
        transform: {
          rotation: { x: 1.22, y: phase * animationSpeed, z: phase * 0.35 }
        },
        alpha: mode === "animation" ? 0.84 : 0.44
      });
      applyNodeState("texture-lab/texture-turntable", {
        transform: {
          rotation: { x: 0.46, y: phase * 0.36, z: 0.12 }
        }
      });
      applyNodeState("key-light", {
        transform: {
          position: {
            x: 330 + Math.sin(phase * 0.7) * 90,
            y: 420,
            z: 460 + Math.cos(phase * 0.7) * 90
          }
        }
      });
      syncNativeFrame(phase);
      emitSnapshot();
    },
    resize(width, height) {
      viewport = { width, height };
      renderer.resize(width, height);
      applyCamera();
      emitSnapshot();
    },
    setMode(nextMode) {
      mode = nextMode;
      applyMode();
      applyCamera();
      syncNativeScene();
      emitSnapshot();
    },
    setMaterial(nextMaterial) {
      material = nextMaterial;
      syncNativeScene();
      emitSnapshot();
    },
    setModel(nextModel) {
      model = nextModel;
      applyModelVisibility();
      syncNativeScene();
      emitSnapshot();
    },
    setTexture(nextTexture) {
      texture = nextTexture;
      syncNativeScene();
      emitSnapshot();
    },
    setClip(nextClip) {
      clip = nextClip;
      syncNativeScene();
      emitSnapshot();
    },
    setCameraPreset(nextPreset) {
      cameraPreset = nextPreset;
      applyCamera();
      emitSnapshot();
    },
    setLightingPreset(nextPreset) {
      lightingPreset = nextPreset;
      applyLighting();
      syncNativeScene();
      emitSnapshot();
    },
    setAnimationSpeed(speed) {
      animationSpeed = Math.max(0.1, Math.min(speed, 3));
      syncNativeScene();
      emitSnapshot();
    },
    setTimelineMs(timeMs) {
      timelineMs = Math.max(0, Math.min(timeMs, TIMELINE_DURATION_MS));
      syncNativeScene();
      emitSnapshot();
    },
    setPlaying(enabled) {
      playing = enabled;
      emitSnapshot();
    },
    setWireframe(enabled) {
      wireframe = enabled;
      syncNativeScene();
      emitSnapshot();
    },
    refreshAssets() {
      if (!objectId) {
        emitSnapshot();
        return;
      }
      const previousObjectId = objectId;
      renderer.destroyObject(previousObjectId);
      objectId = undefined;
      bootSceneObject();
    },
    reset() {
      elapsedMs = 0;
      timelineMs = 0;
      mode = "assets";
      material = "original";
      model = "robot";
      texture = "uv";
      clip = "auto";
      cameraPreset = "studio";
      lightingPreset = "neutral";
      animationSpeed = 1;
      wireframe = false;
      playing = true;
      rebuildSceneObject();
    },
    snapshot,
    destroy() {
      if (!objectId) {
        return;
      }
      renderer.destroyObject(objectId);
      objectId = undefined;
      emitSnapshot();
    }
  };

  function rebuildSceneObject(): void {
    if (!objectId) {
      bootSceneObject();
      return;
    }
    const previousObjectId = objectId;
    renderer.destroyObject(previousObjectId);
    objectId = undefined;
    bootSceneObject();
  }

  function syncNativeScene(): void {
    mutateNative((native) => {
      ensureNativeDemoObjects(native);
      syncNativeMaterials(native);
      syncNativeLighting(native);
      syncNativeFrame(elapsedMs / 1000, native);
    });
  }

  function syncNativeFrame(phase: number, existingNative?: ThreeRendererNative): void {
    const visit = (native: ThreeRendererNative): void => {
      sampleActiveModel(native, phase);
      animateParticles(readNode(native, "particle-field"), phase);
    };
    if (existingNative) {
      visit(existingNative);
      return;
    }
    mutateNative(visit);
  }

  function applyMode(): void {
    applyNodeState("material-lab", { visible: mode !== "animation" });
    applyNodeState("texture-lab", { visible: mode !== "assets" });
    applyNodeState("particle-field", { visible: mode !== "materials" });
  }

  function applyCamera(): void {
    const preset = cameraPreset === "studio" && mode === "animation" ? "macro" : cameraPreset;
    const zoom = preset === "macro" ? 1.28 : preset === "overhead" ? 0.74 : 0.96;
    const rotation = preset === "overhead" ? -0.18 : 0;
    options.camera?.applyCameraState({
      mode: "free",
      x: preset === "macro" ? 34 : 0,
      y: preset === "overhead" ? 28 : 0,
      zoom,
      rotation,
      viewport,
      minZoom: 0.45,
      maxZoom: 2.6
    });
  }

  function applyLighting(): void {
    const preset = LIGHT_PRESETS[lightingPreset];
    applyNodeState("ambient-light", { props: { intensity: preset.ambient } });
    applyNodeState("key-light", { props: { intensity: preset.key } });
    applyNodeState("fill-light", { props: { intensity: preset.fill } });
    applyNodeState("rim-light", { props: { intensity: preset.rim } });
  }

  function applyModelVisibility(): void {
    for (const [modelId, nodePath] of Object.entries(MODEL_NODE_PATHS) as Array<
      [ThreeDemoModel, string]
    >) {
      applyNodeState(nodePath, {
        visible: modelId === model
      });
    }
  }

  function inspectActiveModel(): ThreeRenderTargetDiagnostics | undefined {
    if (!objectId) {
      return undefined;
    }
    try {
      return readThreeNative(renderer.native())?.inspectNode(objectId, MODEL_NODE_PATHS[model]);
    } catch {
      return undefined;
    }
  }

  function readNode(native: ThreeRendererNative, nodePath: string): THREE.Object3D | undefined {
    if (!objectId) {
      return undefined;
    }
    try {
      return native.node(objectId, nodePath) as THREE.Object3D;
    } catch {
      return undefined;
    }
  }

  function ensureNativeDemoObjects(native: ThreeRendererNative): void {
    ensureRelayModel(readNode(native, MODEL_NODE_PATHS.relay));
    ensureParticleField(readNode(native, "particle-field"));
  }

  function syncNativeMaterials(native: ThreeRendererNative): void {
    const textureMap = readSelectedTexture(native, texture);
    for (const [preset, nodePath] of Object.entries(MATERIAL_SAMPLE_NODE_PATHS) as Array<
      [Exclude<ThreeDemoMaterial, "original">, string]
    >) {
      setMeshMaterial(
        readNode(native, nodePath),
        createPresetMaterial(preset, undefined, wireframe)
      );
    }
    setMeshMaterial(
      readNode(native, "texture-lab/texture-turntable"),
      createTextureLabMaterial(textureMap, wireframe)
    );
    setMeshMaterial(
      readNode(native, "scan-ring"),
      new THREE.MeshBasicMaterial({
        color: "#8fb0ff",
        opacity: mode === "animation" ? 0.84 : 0.44,
        transparent: true,
        wireframe
      })
    );

    const active = readNode(native, MODEL_NODE_PATHS[model]);
    if (active) {
      applyModelMaterial(active, material, textureMap, wireframe);
    }
  }

  function syncNativeLighting(native: ThreeRendererNative): void {
    const preset = LIGHT_PRESETS[lightingPreset];
    setLightColor(readNode(native, "key-light"), preset.keyColor);
    setLightColor(readNode(native, "rim-light"), preset.rimColor);
  }

  function sampleActiveModel(native: ThreeRendererNative, phase: number): void {
    const root = readNode(native, MODEL_NODE_PATHS[model]);
    if (!root) {
      return;
    }
    if (sampleClipAnimation(root)) {
      return;
    }
    applyProceduralFloat(root, phase, animationSpeed);
  }

  function sampleClipAnimation(root: THREE.Object3D): boolean {
    const clips = readAnimationClips(root);
    const selected = clip === "auto" ? clips[0] : clips.find((entry) => entry.name === clip);
    if (!selected) {
      stopBoundAnimation(root);
      return false;
    }

    const binding = readAnimationBinding(root);
    if (binding.activeClipName !== selected.name) {
      binding.mixer.stopAllAction();
      const action = binding.mixer.clipAction(selected);
      action.reset();
      action.enabled = true;
      action.loop = THREE.LoopRepeat;
      action.timeScale = 1;
      action.play();
      binding.action = action;
      binding.activeClipName = selected.name;
    } else if (binding.action) {
      binding.action.timeScale = 1;
    }

    const durationMs = Math.max(1, selected.duration * 1000);
    binding.mixer.setTime((timelineMs % durationMs) / 1000);
    return true;
  }

  function readAnimationBinding(root: THREE.Object3D): AnimationBinding {
    const existing = animationBindings.get(root);
    if (existing) {
      return existing;
    }
    const binding = { mixer: new THREE.AnimationMixer(root) };
    animationBindings.set(root, binding);
    return binding;
  }
}

function createSceneNodes(): RenderNodeDefinition[] {
  return [
    {
      id: "floor",
      type: "debug.square",
      transform: {
        position: { x: 0, y: -156, z: -128 },
        rotation: { x: -1.18 },
        scale: { x: 1, y: 1, z: 1 }
      },
      props: {
        width: 1040,
        height: 640,
        color: "#1c241f",
        opacity: 0.98
      }
    },
    {
      id: "asset-stage",
      type: "group",
      transform: { position: { x: 18, y: 8, z: 0 } },
      children: [
        remoteModelNode("model-robot", THREE_DEMO_ASSET_IDS.robot, 172, -26),
        remoteModelNode("model-tokyo", THREE_DEMO_ASSET_IDS.tokyo, 210, -18),
        remoteModelNode("model-flamingo", THREE_DEMO_ASSET_IDS.flamingo, 170, -16),
        {
          id: "model-relay",
          type: "group",
          visible: false
        }
      ]
    },
    {
      id: "material-lab",
      type: "group",
      transform: { position: { x: -392, y: 20, z: 0 } },
      children: [
        materialSample("material-studio", "sphere", -54, 104),
        materialSample("material-chrome", "torus", 64, 52),
        materialSample("material-hologram", "icosahedron", -22, -76),
        materialSample("material-physical", "cylinder", 94, -110)
      ]
    },
    {
      id: "texture-lab",
      type: "group",
      transform: { position: { x: 366, y: -18, z: 36 } },
      children: [
        {
          id: "texture-turntable",
          type: "mesh",
          transform: {
            position: { x: 0, y: 0, z: 0 },
            rotation: { x: 0.46, y: 0.32, z: 0.12 }
          },
          props: {
            geometry: "box",
            width: 148,
            height: 148,
            depth: 34,
            color: "#f4f0df",
            mapAssetId: THREE_DEMO_ASSET_IDS.uvTexture
          }
        }
      ]
    },
    {
      id: "scan-ring",
      type: "mesh",
      transform: {
        position: { x: 0, y: 0, z: -44 },
        rotation: { x: 1.22, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 }
      },
      props: {
        geometry: "torus",
        radius: 245,
        tube: 4,
        color: "#8fb0ff",
        opacity: 0.48
      }
    },
    {
      id: "particle-field",
      type: "group",
      transform: { position: { x: 0, y: 8, z: -12 } }
    },
    lightNode("ambient-light", "ambient", "#c7d6c2", 0.7, 0, 0, 0),
    lightNode("key-light", "directional", "#ffffff", 1.45, 330, 420, 460),
    lightNode("fill-light", "point", "#9fd8ff", 0.82, -420, 190, 280),
    lightNode("rim-light", "point", "#9fb7ff", 0.9, 380, 40, -280)
  ];
}

function remoteModelNode(
  id: string,
  assetId: string,
  radius: number,
  centerY: number
): RenderNodeDefinition {
  return {
    id,
    type: "model",
    visible: id === "model-robot",
    props: {
      assetId,
      normalize: true,
      radius,
      centerY
    }
  };
}

function materialSample(id: string, geometry: string, x: number, y: number): RenderNodeDefinition {
  return {
    id,
    type: "mesh",
    transform: {
      position: { x, y, z: 12 },
      rotation: { x: 0.44, y: 0.72, z: 0.08 }
    },
    props: {
      geometry,
      width: 82,
      height: 112,
      depth: 82,
      radius: 46,
      tube: 11
    }
  };
}

function lightNode(
  id: string,
  kind: string,
  color: string,
  intensity: number,
  x: number,
  y: number,
  z: number
): RenderNodeDefinition {
  return {
    id,
    type: "light",
    transform: { position: { x, y, z } },
    props: {
      kind,
      color,
      intensity,
      distance: kind === "point" ? 900 : 0
    }
  };
}

function ensureRelayModel(root: THREE.Object3D | undefined): void {
  if (!root || typeof root.add !== "function") {
    return;
  }
  root.userData ??= {};
  if (root.userData.threeDemoRelayReady === true) {
    return;
  }
  root.userData.threeDemoRelayReady = true;
  root.name = "relay-native-model";
  root.add(
    meshPart("relay-core", new THREE.IcosahedronGeometry(58, 1), createPresetMaterial("physical")),
    meshPart(
      "relay-ring",
      new THREE.TorusGeometry(92, 7, 16, 48),
      new THREE.MeshStandardMaterial({
        color: "#e2c36a",
        metalness: 0.62,
        roughness: 0.22
      }),
      { z: -8, scale: 1.12, rotation: { x: 0.8, y: 0.15, z: 0 } }
    ),
    meshPart(
      "relay-spire",
      new THREE.CylinderGeometry(10, 10, 190, 32, 1),
      new THREE.MeshPhongMaterial({ color: "#d7ded4", shininess: 70 }),
      { x: -112, y: -8, z: -6, rotation: { x: 0, y: 0, z: -0.12 } }
    ),
    meshPart(
      "relay-dish",
      new THREE.ConeGeometry(48, 64, 32, 1),
      new THREE.MeshStandardMaterial({
        color: "#7da7ff",
        metalness: 0.18,
        roughness: 0.3
      }),
      { x: 122, y: 12, z: 18, rotation: { x: 0.28, y: 0, z: -1.55 } }
    )
  );
}

function ensureParticleField(root: THREE.Object3D | undefined): void {
  if (!root || typeof root.add !== "function") {
    return;
  }
  root.userData ??= {};
  if (root.userData.threeDemoParticlesReady === true) {
    return;
  }
  root.userData.threeDemoParticlesReady = true;
  root.name = "particle-field-native";
  const count = 36;
  const radius = 250;
  for (let index = 0; index < count; index += 1) {
    const angle = (index / count) * Math.PI * 2;
    const orbit = radius * (0.56 + (index % 5) * 0.08);
    const material = new THREE.MeshBasicMaterial({
      color: index % 3 === 0 ? "#87a7ff" : index % 3 === 1 ? "#95d89c" : "#e2c36a",
      opacity: 0.78,
      transparent: true
    });
    const particle = new THREE.Mesh(
      new THREE.SphereGeometry(5 + (index % 4) * 2, 16, 10),
      material
    );
    particle.userData.particleAngle = angle;
    particle.userData.particleOrbit = orbit;
    root.add(particle);
  }
}

function animateParticles(root: THREE.Object3D | undefined, phase: number): void {
  if (!root) {
    return;
  }
  for (const child of root.children ?? []) {
    const angle = readNumber(child.userData.particleAngle);
    if (angle === undefined) {
      continue;
    }
    const orbit = readNumber(child.userData.particleOrbit) ?? 120;
    child.position.set(
      Math.cos(angle + phase * 0.68) * orbit,
      Math.sin((angle + phase * 0.68) * 1.7) * 42,
      Math.sin(angle + phase * 0.68) * orbit
    );
  }
}

function meshPart(
  name: string,
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  options: {
    x?: number;
    y?: number;
    z?: number;
    scale?: number;
    rotation?: { x: number; y: number; z: number };
  } = {}
): THREE.Mesh {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = name;
  mesh.position.set(options.x ?? 0, options.y ?? 0, options.z ?? 0);
  mesh.scale.setScalar(options.scale ?? 1);
  if (options.rotation) {
    mesh.rotation.set(options.rotation.x, options.rotation.y, options.rotation.z);
  }
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function createPresetMaterial(
  preset: Exclude<ThreeDemoMaterial, "original">,
  texture?: THREE.Texture | undefined,
  wireframe = false
): THREE.Material {
  const common = {
    wireframe,
    ...(texture ? { map: texture } : {})
  };
  const material =
    preset === "studio"
      ? new THREE.MeshStandardMaterial({
          ...common,
          color: "#9cd6a6",
          roughness: 0.68,
          metalness: 0.08,
          emissive: "#08120a"
        })
      : preset === "chrome"
        ? new THREE.MeshStandardMaterial({
            ...common,
            color: "#e5ebe6",
            roughness: 0.12,
            metalness: 0.94,
            emissive: "#030405"
          })
        : preset === "hologram"
          ? new THREE.MeshPhongMaterial({
              ...common,
              color: "#8fb0ff",
              emissive: "#243b92",
              opacity: 0.74,
              transparent: true,
              shininess: 96
            })
          : new THREE.MeshPhysicalMaterial({
              ...common,
              color: "#dbc276",
              roughness: 0.2,
              metalness: 0.46,
              clearcoat: 0.82,
              emissive: "#171005"
            });
  material.userData.threeDemoGenerated = true;
  return material;
}

function createTextureLabMaterial(
  texture: THREE.Texture | undefined,
  wireframe: boolean
): THREE.Material {
  const material = new THREE.MeshPhysicalMaterial({
    color: "#f4f0df",
    roughness: 0.28,
    metalness: 0.12,
    clearcoat: 0.35,
    wireframe,
    ...(texture ? { map: texture } : {})
  });
  material.userData.threeDemoGenerated = true;
  return material;
}

function applyModelMaterial(
  root: THREE.Object3D,
  selectedMaterial: ThreeDemoMaterial,
  texture: THREE.Texture | undefined,
  wireframe: boolean
): void {
  root.userData ??= {};
  captureOriginalMaterials(root);
  root.userData.threeDemoMaterial = selectedMaterial;
  root.userData.threeDemoWireframe = wireframe;
  if (selectedMaterial === "original") {
    restoreOriginalMaterials(root);
    setWireframe(root, wireframe);
    return;
  }

  traverseMeshes(root, (mesh) => {
    disposeGeneratedMaterial(mesh.material);
    mesh.material = createPresetMaterial(selectedMaterial, texture, wireframe);
  });
}

function captureOriginalMaterials(root: THREE.Object3D): void {
  if (originalMaterials.has(root)) {
    return;
  }
  const entries: OriginalMaterialEntry[] = [];
  traverseMeshes(root, (mesh) => {
    entries.push({ mesh, material: mesh.material });
  });
  originalMaterials.set(root, entries);
}

function restoreOriginalMaterials(root: THREE.Object3D): void {
  for (const entry of originalMaterials.get(root) ?? []) {
    disposeGeneratedMaterial(entry.mesh.material);
    entry.mesh.material = entry.material;
  }
}

function setWireframe(root: THREE.Object3D, enabled: boolean): void {
  traverseMeshes(root, (mesh) => {
    forEachMaterial(mesh.material, (material) => {
      if ("wireframe" in material) {
        material.wireframe = enabled;
        material.needsUpdate = true;
      }
    });
  });
}

function setMeshMaterial(target: THREE.Object3D | undefined, material: THREE.Material): void {
  if (!target) {
    material.dispose();
    return;
  }
  const mesh = target as THREE.Mesh;
  if (!isMesh(mesh)) {
    material.dispose();
    return;
  }
  disposeGeneratedMaterial(mesh.material);
  mesh.material = material;
}

function setLightColor(target: THREE.Object3D | undefined, color: string): void {
  const light = target as THREE.Light | undefined;
  light?.color?.set(color);
}

function readSelectedTexture(
  native: ThreeRendererNative,
  selectedTexture: ThreeDemoTexture
): THREE.Texture | undefined {
  if (selectedTexture === "none") {
    return undefined;
  }
  const resources = native.resources as { getTexture?(id: string): unknown };
  return resources.getTexture?.(TEXTURE_ASSET_BY_NAME[selectedTexture]) as
    | THREE.Texture
    | undefined;
}

function readAnimationClips(root: THREE.Object3D): THREE.AnimationClip[] {
  const clips = root.userData?.assetAnimations;
  return Array.isArray(clips) ? (clips as THREE.AnimationClip[]) : [];
}

function stopBoundAnimation(root: THREE.Object3D): void {
  const binding = animationBindings.get(root);
  if (!binding) {
    return;
  }
  binding.mixer.stopAllAction();
  binding.activeClipName = undefined;
  binding.action = undefined;
}

function applyProceduralFloat(root: THREE.Object3D, phase: number, speed: number): void {
  if (!root.position || !root.rotation) {
    return;
  }
  const base = readBaseTransform(root);
  root.position.set(base.x, base.y + Math.sin(phase * speed * 1.8) * 24, base.z);
  root.rotation.set(
    base.rotationX + Math.sin(phase * speed * 0.8) * 0.12,
    phase * speed * 0.55,
    base.rotationZ + Math.sin(phase * speed * 0.9) * 0.12
  );
}

function readBaseTransform(root: THREE.Object3D): {
  x: number;
  y: number;
  z: number;
  rotationX: number;
  rotationZ: number;
} {
  root.userData ??= {};
  const existing = root.userData.threeDemoBaseTransform as
    | { x: number; y: number; z: number; rotationX: number; rotationZ: number }
    | undefined;
  if (existing) {
    return existing;
  }
  const value = {
    x: root.position.x,
    y: root.position.y,
    z: root.position.z,
    rotationX: root.rotation.x,
    rotationZ: root.rotation.z
  };
  root.userData.threeDemoBaseTransform = value;
  return value;
}

function traverseMeshes(root: THREE.Object3D, visit: (mesh: THREE.Mesh) => void): void {
  if (typeof root.traverse !== "function") {
    if (isMesh(root)) {
      visit(root);
    }
    return;
  }
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (isMesh(mesh)) {
      visit(mesh);
    }
  });
}

function isMesh(object: THREE.Object3D | undefined): object is THREE.Mesh {
  return object !== undefined && (object as THREE.Mesh).isMesh === true;
}

function forEachMaterial(
  material: THREE.Material | THREE.Material[],
  visit: (material: THREE.Material) => void
): void {
  if (Array.isArray(material)) {
    for (const entry of material) {
      visit(entry);
    }
    return;
  }
  visit(material);
}

function disposeGeneratedMaterial(material: THREE.Material | THREE.Material[]): void {
  forEachMaterial(material, (entry) => {
    if (entry.userData.threeDemoGenerated === true) {
      entry.dispose();
    }
  });
}

function readThreeNative(native: unknown): ThreeRendererNative | undefined {
  return isRecord(native) &&
    typeof native.node === "function" &&
    typeof native.render === "function"
    ? (native as ThreeRendererNative)
    : undefined;
}

function readAssetSnapshots(manager: AssetManager | undefined): ThreeDemoAssetSnapshot[] {
  if (!manager) {
    return [];
  }
  return manager.assets().map((asset) => {
    const state = manager.state(asset.id);
    return {
      id: asset.id,
      label: ASSET_LABELS[asset.id] ?? asset.id,
      type: asset.type,
      status: state.status,
      lazy: asset.lazy === true,
      error: state.error
    };
  });
}

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
