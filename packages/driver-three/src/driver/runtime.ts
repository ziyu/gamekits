import type { DriverBootContext } from "@gamekits/driver-core";
import type { Camera, Object3D, Scene, Texture, WebGLRenderer } from "three";
import { cloneObjectMaterialInstances } from "./model-materials";
import type {
  ThreeCameraSyncTarget,
  ThreeMaterialSlot,
  ThreeObjectTarget
} from "./structural-types";

export type ThreeResourceKind = "model" | "texture";

export type ThreeResourceSummary = {
  id: string;
  kind: ThreeResourceKind;
  url: string;
  loadedAt: number;
  clipNames?: string[] | undefined;
};

export type ThreeRuntimeResources = {
  has(id: string): boolean;
  getTexture(id: string): Texture | undefined;
  createModelInstance(id: string): Object3D | undefined;
  clipNames(id: string): string[];
  summaries(): ThreeResourceSummary[];
  loadTexture(id: string, url: string, signal?: AbortSignal): Promise<ThreeResourceSummary>;
  loadModel(id: string, url: string, signal?: AbortSignal): Promise<ThreeResourceSummary>;
  unload(id: string): void;
  dispose(): void;
};

export type ThreeMeshFactoryOptions = {
  type: string;
  props?: Record<string, unknown>;
};

export type ThreeLightFactoryOptions = {
  props?: Record<string, unknown>;
};

export type ThreeModelFactoryOptions = {
  type: string;
  props?: Record<string, unknown>;
};

export type ThreeRuntimeFactories = {
  createGroup(): Object3D;
  createMesh(options: ThreeMeshFactoryOptions): Object3D;
  createLight(options: ThreeLightFactoryOptions): Object3D;
  createModel(options: ThreeModelFactoryOptions): Object3D;
};

export type ThreeDriverRuntime = {
  view: HTMLCanvasElement;
  scene: Scene;
  camera: Camera;
  renderer?: WebGLRenderer;
  resources: ThreeRuntimeResources;
  factories: ThreeRuntimeFactories;
  resize(width: number, height: number): void;
  render(): void;
  destroy(): void;
};

export type ThreeDriverRuntimeOptions = {
  backgroundColor: string | number;
  clearAlpha: number;
  cameraZ: number;
  assetLoadTimeoutMs: number;
  dracoDecoderPath: string;
};

export async function createThreeDriverRuntime(
  ctx: DriverBootContext,
  options: ThreeDriverRuntimeOptions
): Promise<ThreeDriverRuntime> {
  const THREE = await import("three");
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: options.clearAlpha < 1 });
  renderer.setSize(ctx.width, ctx.height);
  renderer.setClearColor(options.backgroundColor, options.clearAlpha);
  renderer.shadowMap.enabled = true;

  const scene = new THREE.Scene();
  const camera = createOrthographicCamera(THREE, ctx.width, ctx.height, options.cameraZ);
  const resources = createThreeRuntimeResources(THREE, {
    assetLoadTimeoutMs: options.assetLoadTimeoutMs,
    dracoDecoderPath: options.dracoDecoderPath
  });
  scene.add(camera as any);

  if (ctx.container && isAppendable(ctx.container)) {
    ctx.container.append(renderer.domElement);
  }

  const runtime: ThreeDriverRuntime = {
    view: renderer.domElement,
    scene,
    camera,
    renderer,
    resources,
    factories: {
      createGroup() {
        return new THREE.Group();
      },
      createMesh(factoryOptions) {
        return createThreeMesh(THREE, resources, factoryOptions);
      },
      createLight(factoryOptions) {
        return createThreeLight(THREE, factoryOptions);
      },
      createModel(factoryOptions) {
        return createThreeModel(THREE, resources, factoryOptions);
      }
    },
    resize(width, height) {
      renderer.setSize(width, height);
      resizeOrthographicCamera(camera, width, height);
      runtime.render();
    },
    render() {
      renderer.render(scene, camera as any);
    },
    destroy() {
      disposeObjectTree(scene as unknown as ThreeObjectTarget);
      resources.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    }
  };

  runtime.render();
  return runtime;
}

function createOrthographicCamera(
  THREE: typeof import("three"),
  width: number,
  height: number,
  cameraZ: number
): import("three").OrthographicCamera {
  const camera = new THREE.OrthographicCamera(
    width / -2,
    width / 2,
    height / 2,
    height / -2,
    0.1,
    10000
  );
  camera.position.set(0, 0, cameraZ);
  camera.lookAt(0, 0, 0);
  return camera;
}

function resizeOrthographicCamera(camera: Camera, width: number, height: number): void {
  const orthographic = camera as ThreeCameraSyncTarget & {
    left?: number;
    right?: number;
    top?: number;
    bottom?: number;
  };
  orthographic.left = width / -2;
  orthographic.right = width / 2;
  orthographic.top = height / 2;
  orthographic.bottom = height / -2;
  orthographic.updateProjectionMatrix?.();
}

type ThreeModelResource = {
  id: string;
  url: string;
  scene: import("three").Object3D;
  scenes: import("three").Object3D[];
  animations: import("three").AnimationClip[];
  cloneModel(): import("three").Object3D;
  summary: ThreeResourceSummary;
};

type ThreeTextureResource = {
  id: string;
  url: string;
  texture: import("three").Texture;
  summary: ThreeResourceSummary;
};

export function createThreeRuntimeResources(
  THREE: typeof import("three"),
  options: { assetLoadTimeoutMs: number; dracoDecoderPath: string }
): ThreeRuntimeResources {
  const lifetime = new AbortController();
  const models = new Map<string, ThreeModelResource>();
  const textures = new Map<string, ThreeTextureResource>();
  let gltfLoader:
    | {
        loadAsync(url: string): Promise<{
          scene: import("three").Object3D;
          scenes?: import("three").Object3D[];
          animations: import("three").AnimationClip[];
        }>;
        setDRACOLoader?(loader: unknown): void;
        setMeshoptDecoder?(decoder: unknown): void;
      }
    | undefined;
  let dracoLoader: { dispose?(): void } | undefined;
  let loaderSetup: Promise<void> | undefined;

  return {
    has(id) {
      return models.has(id) || textures.has(id);
    },
    getTexture(id) {
      return textures.get(id)?.texture;
    },
    createModelInstance(id) {
      const resource = models.get(id);
      if (!resource) {
        return undefined;
      }

      const model = resource.cloneModel();
      prepareLoadedModel(model, resource.animations, id);
      return model;
    },
    clipNames(id) {
      return models.get(id)?.summary.clipNames ?? [];
    },
    summaries() {
      return [
        ...[...models.values()].map((resource) => resource.summary),
        ...[...textures.values()].map((resource) => resource.summary)
      ].sort((left, right) => left.id.localeCompare(right.id));
    },
    async loadTexture(id, url, callerSignal) {
      const signal = callerSignal
        ? AbortSignal.any([lifetime.signal, callerSignal])
        : lifetime.signal;
      signal.throwIfAborted();
      const loaded = textures.get(id);
      if (loaded) {
        return loaded.summary;
      }

      const loader = new THREE.TextureLoader();
      const texture = await withAssetLoadTimeout(loader.loadAsync(url), {
        id,
        kind: "texture",
        signal,
        onLate: (value) => value.dispose(),
        timeoutMs: options.assetLoadTimeoutMs,
        url
      });
      if (signal.aborted) {
        texture.dispose();
        signal.throwIfAborted();
      }
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.wrapS = THREE.RepeatWrapping;
      texture.wrapT = THREE.RepeatWrapping;
      texture.needsUpdate = true;
      const summary: ThreeResourceSummary = {
        id,
        kind: "texture",
        url,
        loadedAt: Date.now()
      };
      textures.set(id, { id, url, texture, summary });
      return summary;
    },
    async loadModel(id, url, callerSignal) {
      const signal = callerSignal
        ? AbortSignal.any([lifetime.signal, callerSignal])
        : lifetime.signal;
      signal.throwIfAborted();
      const loaded = models.get(id);
      if (loaded) {
        return loaded.summary;
      }

      if (!loaderSetup) {
        loaderSetup = (async () => {
          const module = await import("three/examples/jsm/loaders/GLTFLoader.js");
          gltfLoader = new module.GLTFLoader();
          const dracoModule = await import("three/examples/jsm/loaders/DRACOLoader.js");
          const loader = new dracoModule.DRACOLoader();
          loader.setDecoderPath(options.dracoDecoderPath);
          gltfLoader.setDRACOLoader?.(loader);
          dracoLoader = loader;
          const meshoptModule = await import("three/examples/jsm/libs/meshopt_decoder.module.js");
          gltfLoader.setMeshoptDecoder?.(meshoptModule.MeshoptDecoder);
          if (lifetime.signal.aborted) {
            dracoLoader?.dispose?.();
            lifetime.signal.throwIfAborted();
          }
        })().catch((error) => {
          dracoLoader?.dispose?.();
          dracoLoader = undefined;
          loaderSetup = undefined;
          gltfLoader = undefined;
          throw error;
        });
      }
      await loaderSetup;
      signal.throwIfAborted();
      const gltf = await withAssetLoadTimeout(gltfLoader!.loadAsync(url), {
        id,
        kind: "model",
        signal,
        onLate: (value) => disposeLoadedModel(value.scene, value.scenes),
        timeoutMs: options.assetLoadTimeoutMs,
        url
      });
      if (signal.aborted) {
        disposeLoadedModel(gltf.scene, gltf.scenes);
        signal.throwIfAborted();
      }
      const animations = [...gltf.animations];
      const summary: ThreeResourceSummary = {
        id,
        kind: "model",
        url,
        loadedAt: Date.now(),
        clipNames: animations.map((clip) => clip.name).filter((name) => name.length > 0)
      };
      const scene = gltf.scene;
      models.set(id, {
        id,
        url,
        scene,
        scenes: [...(gltf.scenes ?? [scene])],
        animations,
        cloneModel() {
          const instance = scene.clone(true);
          cloneObjectMaterialInstances(instance as unknown as ThreeObjectTarget);
          return instance;
        },
        summary
      });
      return summary;
    },
    unload(id) {
      const model = models.get(id);
      if (model) {
        disposeLoadedModel(model.scene, model.scenes);
        models.delete(id);
      }
      const texture = textures.get(id);
      if (texture) {
        texture.texture.dispose();
        textures.delete(id);
      }
    },
    dispose() {
      lifetime.abort();
      for (const id of [...models.keys(), ...textures.keys()]) this.unload(id);
      dracoLoader?.dispose?.();
    }
  };
}

function prepareLoadedModel(
  model: import("three").Object3D,
  animations: import("three").AnimationClip[],
  assetId: string
): void {
  model.userData.assetId = assetId;
  model.userData.assetModel = true;
  model.userData.assetAnimations = animations;
  model.userData.assetClipNames = animations.map((clip) => clip.name).filter((name) => name);
  model.traverse((child) => {
    child.castShadow = true;
    child.receiveShadow = true;
    if (isRenderableObject(child)) {
      child.frustumCulled = false;
    }
  });
}

function isRenderableObject(object: ThreeObjectTarget): boolean {
  const record = object as ThreeObjectTarget & { isMesh?: boolean; isSkinnedMesh?: boolean };
  return record.isMesh === true || record.isSkinnedMesh === true || object.geometry !== undefined;
}

function normalizeModelInstance(
  THREE: typeof import("three"),
  object: Object3D,
  options: { radius: number; centerY: number }
): void {
  const box = new THREE.Box3().setFromObject(object);
  if (box.isEmpty()) {
    return;
  }

  const size = new THREE.Vector3();
  const center = new THREE.Vector3();
  box.getSize(size);
  box.getCenter(center);
  const maxSize = Math.max(size.x, size.y, size.z);
  if (!Number.isFinite(maxSize) || maxSize <= 0) {
    return;
  }

  object.scale.multiplyScalar((options.radius * 2) / maxSize);
  const normalizedBox = new THREE.Box3().setFromObject(object);
  normalizedBox.getCenter(center);
  object.position.sub(center);
  object.position.y += options.centerY;
}

function createThreeMesh(
  THREE: typeof import("three"),
  resources: ThreeRuntimeResources,
  options: ThreeMeshFactoryOptions
): Object3D {
  const geometry = createGeometry(THREE, options.type, options.props);
  const material = createMaterial(THREE, resources, options.props);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = options.props?.castShadow === true;
  mesh.receiveShadow = options.props?.receiveShadow === true;
  return mesh;
}

function createGeometry(
  THREE: typeof import("three"),
  type: string,
  props: Record<string, unknown> | undefined
) {
  const width = resolveNumber(props?.width, 1);
  const height = resolveNumber(props?.height, width);
  const depth = resolveNumber(props?.depth, width);

  if (type === "debug.square" || props?.geometry === "plane") {
    return new THREE.PlaneGeometry(width, height);
  }
  if (props?.geometry === "sphere") {
    return new THREE.SphereGeometry(resolveNumber(props?.radius, width / 2), 32, 18);
  }
  if (props?.geometry === "cylinder") {
    const radius = resolveNumber(props?.radius, width / 2);
    return new THREE.CylinderGeometry(radius, radius, height, 32, 1);
  }
  if (props?.geometry === "cone") {
    return new THREE.ConeGeometry(resolveNumber(props?.radius, width / 2), height, 32, 1);
  }
  if (props?.geometry === "torus") {
    return new THREE.TorusGeometry(
      resolveNumber(props?.radius, width / 2),
      resolveNumber(props?.tube, width / 10),
      16,
      48
    );
  }
  if (props?.geometry === "icosahedron") {
    return new THREE.IcosahedronGeometry(resolveNumber(props?.radius, width / 2), 1);
  }

  return new THREE.BoxGeometry(width, height, depth);
}

function createMaterial(
  THREE: typeof import("three"),
  resources: ThreeRuntimeResources,
  props: Record<string, unknown> | undefined
) {
  const opacity = resolveNumber(props?.opacity, 1);
  const map = readMaterialTexture(resources, props?.mapAssetId);

  return new THREE.MeshStandardMaterial({
    color: resolveColor(props?.color, 0x7fd16b),
    opacity,
    transparent: opacity < 1,
    wireframe: props?.wireframe === true,
    metalness: 0.08,
    roughness: 0.46,
    ...(map ? { map } : {})
  });
}

function createThreeLight(
  THREE: typeof import("three"),
  options: ThreeLightFactoryOptions
): Object3D {
  const color = resolveColor(options.props?.color, 0xffffff);
  const intensity = resolveNumber(options.props?.intensity, 1);
  const lightKind = typeof options.props?.kind === "string" ? options.props.kind : "directional";

  if (lightKind === "ambient") {
    return new THREE.AmbientLight(color, intensity);
  }
  if (lightKind === "point") {
    return new THREE.PointLight(color, intensity, resolveNumber(options.props?.distance, 0));
  }

  return new THREE.DirectionalLight(color, intensity);
}

function createThreeModel(
  THREE: typeof import("three"),
  resources: ThreeRuntimeResources,
  options: ThreeModelFactoryOptions
): Object3D {
  const assetId = readOptionalString(options.props?.assetId);
  if (assetId) {
    const instance = resources.createModelInstance(assetId);
    if (instance) {
      instance.userData ??= {};
      instance.userData.assetId = assetId;
      instance.userData.assetModel = true;
      if (options.props?.normalize !== false) {
        normalizeModelInstance(THREE, instance, {
          radius: resolveNumber(options.props?.radius, 170),
          centerY: resolveNumber(options.props?.centerY, 0)
        });
      }
      return instance;
    }
  }

  return createPlaceholderModel(THREE, options.props);
}

function createPlaceholderModel(
  THREE: typeof import("three"),
  props: Record<string, unknown> | undefined
): Object3D {
  const group = new THREE.Group();
  group.name = "three-model-placeholder";
  const radius = resolveNumber(props?.radius, 90);
  const material = new THREE.MeshStandardMaterial({
    color: resolveColor(props?.color, 0x95d89c),
    metalness: 0.12,
    roughness: 0.62
  });
  const body = new THREE.Mesh(new THREE.IcosahedronGeometry(radius, 1), material);
  body.name = "placeholder-body";
  body.castShadow = true;
  body.receiveShadow = true;
  group.add(body);
  group.userData.assetPlaceholder = true;
  group.userData.assetId = readOptionalString(props?.assetId);
  return group;
}

export function disposeObjectTree(
  object: ThreeObjectTarget,
  options: { forceNativeResourceDispose?: boolean } = {}
): void {
  disposeObjectTreeNode(object, {
    allowAssetResourceSkip: options.forceNativeResourceDispose !== true,
    insideAssetModel: false,
    disposedMaterials: new Set()
  });
}

function disposeObjectTreeNode(
  object: ThreeObjectTarget,
  options: {
    allowAssetResourceSkip: boolean;
    insideAssetModel: boolean;
    disposedMaterials: Set<object>;
  }
): void {
  const insideAssetModel = options.insideAssetModel || object.userData?.assetModel === true;
  const skipSharedAssetResourceDispose = options.allowAssetResourceSkip && insideAssetModel;
  for (const child of object.children ?? []) {
    disposeObjectTreeNode(child, {
      allowAssetResourceSkip: options.allowAssetResourceSkip,
      insideAssetModel,
      disposedMaterials: options.disposedMaterials
    });
  }

  if (!skipSharedAssetResourceDispose) {
    object.geometry?.dispose?.();
  }
  if (!skipSharedAssetResourceDispose || object.userData?.assetInstanceMaterial === true) {
    disposeMaterial(object.material, options.disposedMaterials);
  }
  object.dispose?.();
}

function disposeMaterial(
  material: ThreeMaterialSlot | undefined,
  disposedMaterials: Set<object>
): void {
  if (Array.isArray(material)) {
    for (const entry of material) {
      disposeSingleMaterial(entry, disposedMaterials);
    }
    return;
  }
  disposeSingleMaterial(material, disposedMaterials);
}

function disposeSingleMaterial(
  material: ThreeMaterialSlot | undefined,
  disposedMaterials: Set<object>
): void {
  if (!material || Array.isArray(material) || typeof material !== "object") {
    return;
  }
  if (disposedMaterials.has(material)) {
    return;
  }
  disposedMaterials.add(material);
  material.dispose?.();
}

function readMaterialTexture(
  resources: ThreeRuntimeResources,
  value: unknown
): import("three").Texture | undefined {
  const assetId = readOptionalString(value);
  return assetId
    ? (resources.getTexture(assetId) as import("three").Texture | undefined)
    : undefined;
}

function resolveColor(value: unknown, fallback: number): string | number {
  return typeof value === "number" || typeof value === "string" ? value : fallback;
}

function resolveNumber(value: unknown, fallback: number): number {
  return typeof value === "number" ? value : fallback;
}

function readOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function withAssetLoadTimeout<TValue>(
  promise: Promise<TValue>,
  options: {
    id: string;
    kind: ThreeResourceKind;
    timeoutMs: number;
    url: string;
    signal: AbortSignal;
    onLate(value: TValue): void;
  }
): Promise<TValue> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const cleanup = () => {
      clearTimeout(timer);
      options.signal.removeEventListener("abort", abort);
    };
    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };
    const abort = () => fail(options.signal.reason);
    options.signal.addEventListener("abort", abort, { once: true });
    if (options.signal.aborted) abort();
    if (!settled && Number.isFinite(options.timeoutMs) && options.timeoutMs > 0) {
      timer = setTimeout(
        () => fail(new Error(`Timed out loading Three ${options.kind} asset ${options.id}`)),
        options.timeoutMs
      );
    }
    promise
      .then((value) => {
        if (settled) {
          options.onLate(value);
          return;
        }
        settled = true;
        cleanup();
        resolve(value);
      }, fail)
      .catch(() => {
        /* Native late cleanup cannot create an unhandled rejection. */
      });
  });
}

function disposeLoadedModel(
  scene: import("three").Object3D,
  scenes: import("three").Object3D[] = []
): void {
  const roots = new Set([scene, ...scenes]);
  const textures = new Set<import("three").Texture>();
  for (const root of roots)
    root.traverse((object) => {
      const mesh = object as import("three").Mesh;
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const material of materials) {
        if (!material) continue;
        for (const value of Object.values(material)) {
          if (value && typeof value === "object" && value.isTexture === true) textures.add(value);
        }
      }
    });
  for (const root of roots)
    disposeObjectTree(root as unknown as ThreeObjectTarget, { forceNativeResourceDispose: true });
  const images = new Set<unknown>();
  for (const texture of textures) {
    texture.dispose();
    if (texture.image && !images.has(texture.image)) {
      images.add(texture.image);
      const image = texture.image as { close?: () => void };
      image.close?.();
    }
  }
}

function isAppendable(value: unknown): value is { append(child: HTMLElement): void } {
  return typeof value === "object" && value !== null && "append" in value;
}
