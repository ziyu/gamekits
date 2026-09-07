import type {
  RenderNodeDefinition,
  RenderNodePath,
  RenderObjectDefinition,
  RenderObjectId,
  RendererAdapter,
  RenderTransform
} from "@gamekits/renderer-core";
import type { Object3D } from "three";
import type {
  ThreeMaterialSlot,
  ThreeMaterialTarget,
  ThreeObjectTarget,
  ThreeVectorTarget
} from "./structural-types";

export type ThreeRenderTargetProps = Record<string, unknown> & {
  name?: string;
  intensity?: number;
  distance?: number;
  castShadow?: boolean;
  receiveShadow?: boolean;
};

export type ThreeRenderTargetState = {
  transform?: RenderTransform;
  visible?: boolean;
  alpha?: number;
  layer?: string;
  props?: ThreeRenderTargetProps;
};

export function applyObjectDefinition(
  target: Object3D,
  definition: RenderObjectDefinition | RenderNodeDefinition
): void {
  applyThreeRenderTargetState(target, createStateFromDefinition(definition));
}

export function applyThreeRenderObjectState(
  renderer: Pick<RendererAdapter, "getObjectHandle">,
  objectId: RenderObjectId,
  state: ThreeRenderTargetState
): void {
  const handle = renderer.getObjectHandle?.(objectId);
  if (!handle) {
    return;
  }
  applyThreeRenderTargetState(handle.native as Object3D, state);
}

export function applyThreeRenderNodeState(
  renderer: Pick<RendererAdapter, "getNodeHandle">,
  objectId: RenderObjectId,
  nodePath: RenderNodePath,
  state: ThreeRenderTargetState
): void {
  const handle = renderer.getNodeHandle?.(objectId, nodePath);
  if (!handle) {
    return;
  }
  applyThreeRenderTargetState(handle.native as Object3D, state);
}

export function applyThreeRenderTargetState(native: Object3D, state: ThreeRenderTargetState): void {
  const target = native as unknown as ThreeObjectTarget;
  if (state.transform) {
    applyNativeTransform(target, state.transform);
  }
  if (state.visible !== undefined) {
    target.visible = state.visible;
  }
  if (state.alpha !== undefined) {
    setMaterialOpacity(target.material, state.alpha);
  }
  if (state.layer !== undefined) {
    target.userData ??= {};
    target.userData.layer = state.layer;
  }
  if (state.props) {
    applyNativeProps(target, state.props);
  }
}

function createStateFromDefinition(
  definition: RenderObjectDefinition | RenderNodeDefinition
): ThreeRenderTargetState {
  const state: ThreeRenderTargetState = {};
  if (definition.transform) {
    state.transform = definition.transform;
  }
  if (definition.visible !== undefined) {
    state.visible = definition.visible;
  }
  if (definition.alpha !== undefined) {
    state.alpha = definition.alpha;
  }
  if (definition.layer !== undefined) {
    state.layer = definition.layer;
  }
  if (definition.props) {
    state.props = definition.props;
  }
  return state;
}

function applyNativeProps(object: ThreeObjectTarget, props: ThreeRenderTargetProps): void {
  if (typeof props.name === "string") {
    object.name = props.name;
  }
  if (typeof props.intensity === "number") {
    object.intensity = props.intensity;
  }
  if (typeof props.distance === "number") {
    object.distance = props.distance;
  }
  if (typeof props.castShadow === "boolean") {
    object.castShadow = props.castShadow;
  }
  if (typeof props.receiveShadow === "boolean") {
    object.receiveShadow = props.receiveShadow;
  }
}

function applyNativeTransform(object: ThreeObjectTarget, transform: RenderTransform): void {
  if (transform.position) {
    setVector(
      object.position,
      transform.position.x ?? object.position?.x ?? 0,
      transform.position.y ?? object.position?.y ?? 0,
      transform.position.z ?? object.position?.z ?? 0
    );
  }
  if (transform.rotation) {
    setVector(
      object.rotation,
      transform.rotation.x ?? object.rotation?.x ?? 0,
      transform.rotation.y ?? object.rotation?.y ?? 0,
      transform.rotation.z ?? object.rotation?.z ?? 0
    );
  }
  if (transform.scale) {
    const scaleX = transform.scale.x ?? object.scale?.x ?? 1;
    setVector(
      object.scale,
      scaleX,
      transform.scale.y ?? object.scale?.y ?? scaleX,
      transform.scale.z ?? object.scale?.z ?? scaleX
    );
  }
}

function setVector(vector: ThreeVectorTarget | undefined, x: number, y: number, z: number): void {
  if (!vector) {
    return;
  }
  if (vector.set) {
    vector.set(x, y, z);
    return;
  }
  vector.x = x;
  vector.y = y;
  vector.z = z;
}

function setMaterialOpacity(material: ThreeMaterialSlot | undefined, opacity: number): void {
  forEachMaterial(material, (entry) => {
    entry.opacity = opacity;
    entry.transparent = opacity < 1;
    entry.needsUpdate = true;
  });
}

function forEachMaterial(
  material: ThreeMaterialSlot | undefined,
  visit: (entry: ThreeMaterialTarget) => void
): void {
  if (Array.isArray(material)) {
    for (const entry of material) {
      visit(entry);
    }
    return;
  }
  if (isMaterialTarget(material)) {
    visit(material);
  }
}

function isMaterialTarget(value: unknown): value is ThreeMaterialTarget {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
