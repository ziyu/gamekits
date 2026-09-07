import type {
  RenderNodeDefinition,
  RenderNodePath,
  RenderObjectDefinition,
  RenderObjectId,
  RendererAdapter,
  RenderTransform
} from "@gamekits/renderer-core";

const PHASER_TINT_MODES = {
  multiply: 0,
  fill: 1,
  add: 2,
  screen: 4,
  overlay: 5,
  hard_light: 6
} as const;

export type PhaserTintMode = number | keyof typeof PHASER_TINT_MODES;

export type PhaserRenderTargetProps = Record<string, unknown> & {
  width?: number;
  height?: number;
  depth?: number;
  tint?: number;
  tintMode?: PhaserTintMode;
};

export type PhaserRenderTargetState = {
  transform?: RenderTransform;
  visible?: boolean;
  alpha?: number;
  layer?: string;
  props?: PhaserRenderTargetProps;
};

type MutablePhaserRenderTarget = {
  x?: number;
  y?: number;
  z?: number;
  displayWidth?: number;
  displayHeight?: number;
  transform?: RenderTransform;
  props?: Record<string, unknown>;
  alpha?: number;
  visible?: boolean;
  layer?: string;
  setPosition?(x: number, y: number, z?: number): void;
  setRotation?(rotation: number): void;
  setScale?(scaleX: number, scaleY: number): void;
  setDisplaySize?(width: number, height: number): void;
  setAlpha?(alpha: number): void;
  setVisible?(visible: boolean): void;
  setDepth?(depth: number): void;
  setTint?(tint: number): void;
  setTintMode?(tintMode: number): void;
  setData?(key: string, value: unknown): void;
  getData?(key: string): unknown;
};

export function applyObjectDefinition(
  target: unknown,
  definition: RenderObjectDefinition | RenderNodeDefinition
): void {
  applyPhaserRenderTargetState(target, createStateFromDefinition(definition));
}

export function applyPhaserRenderObjectState(
  renderer: Pick<RendererAdapter, "getObjectHandle">,
  objectId: RenderObjectId,
  state: PhaserRenderTargetState
): void {
  const handle = renderer.getObjectHandle?.(objectId);
  if (!handle) {
    return;
  }
  applyPhaserRenderTargetState(handle.native, state);
}

export function applyPhaserRenderNodeState(
  renderer: Pick<RendererAdapter, "getNodeHandle">,
  objectId: RenderObjectId,
  nodePath: RenderNodePath,
  state: PhaserRenderTargetState
): void {
  const handle = renderer.getNodeHandle?.(objectId, nodePath);
  if (!handle) {
    return;
  }
  applyPhaserRenderTargetState(handle.native, state);
}

export function applyPhaserRenderTargetState(
  native: unknown,
  state: PhaserRenderTargetState
): void {
  const target = native as MutablePhaserRenderTarget;
  if (state.props) {
    applyNativeProps(target, state.props);
  }
  if (state.transform) {
    applyNativeTransform(target, state.transform);
  }
  if (state.alpha !== undefined) {
    target.setAlpha?.(state.alpha);
    if (!target.setAlpha) {
      target.alpha = state.alpha;
    }
  }
  if (state.visible !== undefined) {
    target.setVisible?.(state.visible);
    if (!target.setVisible) {
      target.visible = state.visible;
    }
  }
  if (state.layer !== undefined) {
    target.layer = state.layer;
  }
}

function createStateFromDefinition(
  definition: RenderObjectDefinition | RenderNodeDefinition
): PhaserRenderTargetState {
  const state: PhaserRenderTargetState = {};
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

function applyNativeProps(target: MutablePhaserRenderTarget, props: PhaserRenderTargetProps): void {
  const width = typeof props.width === "number" ? props.width : undefined;
  const height = typeof props.height === "number" ? props.height : undefined;
  if (width !== undefined || height !== undefined) {
    const nextWidth = width ?? target.displayWidth ?? 0;
    const nextHeight = height ?? target.displayHeight ?? 0;
    target.setData?.("gamekits.baseDisplayWidth", nextWidth);
    target.setData?.("gamekits.baseDisplayHeight", nextHeight);
    target.setDisplaySize?.(nextWidth, nextHeight);
  }

  if (typeof props.depth === "number") {
    target.setDepth?.(props.depth);
  }
  if (typeof props.tint === "number") {
    target.setTint?.(props.tint);
  }
  const tintMode = resolveNativeTintMode(props.tintMode);
  if (tintMode !== undefined) {
    target.setTintMode?.(tintMode);
  }

  if (!target.setData && !target.setDisplaySize && !target.setTint && !target.setDepth) {
    target.props = { ...target.props, ...props };
  }
}

function applyNativeTransform(target: MutablePhaserRenderTarget, transform: RenderTransform): void {
  if (!target.setPosition && !target.setRotation && !target.setScale) {
    target.transform = mergeTransform(target.transform, transform);
    return;
  }

  if (transform.position) {
    target.setPosition?.(
      transform.position.x ?? target.x ?? 0,
      transform.position.y ?? target.y ?? 0,
      transform.position.z ?? target.z
    );
  }
  if (transform.rotation) {
    target.setRotation?.(transform.rotation.z ?? transform.rotation.y ?? transform.rotation.x ?? 0);
  }
  if (transform.scale) {
    const scaleX = transform.scale.x ?? 1;
    const scaleY = transform.scale.y ?? scaleX;
    const baseWidth = target.getData?.("gamekits.baseDisplayWidth");
    const baseHeight = target.getData?.("gamekits.baseDisplayHeight");
    if (typeof baseWidth === "number" && typeof baseHeight === "number") {
      target.setDisplaySize?.(baseWidth * scaleX, baseHeight * scaleY);
    } else {
      target.setScale?.(scaleX, scaleY);
    }
  }
}

function mergeTransform(
  current: RenderTransform | undefined,
  state: RenderTransform
): RenderTransform {
  return {
    ...current,
    ...state,
    position: { ...current?.position, ...state.position },
    rotation: { ...current?.rotation, ...state.rotation },
    scale: { ...current?.scale, ...state.scale },
    origin: { ...current?.origin, ...state.origin }
  };
}

function resolveNativeTintMode(value: unknown): number | undefined {
  if (typeof value === "number") {
    return value;
  }
  if (typeof value !== "string") {
    return undefined;
  }
  return PHASER_TINT_MODES[value as keyof typeof PHASER_TINT_MODES];
}
