import { GameError } from "@gamekits/core";
import type {
  PhysicsBodyId,
  PhysicsInterpolationPolicy,
  PhysicsInterpolationStore,
  PhysicsInterpolationTransform,
  PhysicsQuaternion,
  PhysicsRotation,
  PhysicsVector,
  ReadonlyPhysicsInterpolationTransform,
  ReadonlyPhysicsRotation
} from "./types";

export type PhysicsInterpolationStoreOptions = {
  id?: string;
  policy?: PhysicsInterpolationPolicy;
};

type PhysicsInterpolationSample = {
  previous: PhysicsInterpolationTransform;
  current: PhysicsInterpolationTransform;
};

type PhysicsInterpolationStoreState = {
  id: string;
  ownerId: string | undefined;
  fixedDeltaMs: number;
  alpha: number;
  interpolate: NonNullable<PhysicsInterpolationPolicy["interpolate"]>;
  shouldResetHistory: PhysicsInterpolationPolicy["shouldResetHistory"];
  samples: Map<PhysicsBodyId, PhysicsInterpolationSample>;
};

const storeStates = new WeakMap<PhysicsInterpolationStore, PhysicsInterpolationStoreState>();

export function createPhysicsInterpolationStore(
  options: PhysicsInterpolationStoreOptions = {}
): PhysicsInterpolationStore {
  const state: PhysicsInterpolationStoreState = {
    id: options.id ?? "physics.interpolation",
    ownerId: undefined,
    fixedDeltaMs: 0,
    alpha: 0,
    interpolate: options.policy?.interpolate ?? interpolatePhysicsTransform,
    shouldResetHistory: options.policy?.shouldResetHistory,
    samples: new Map()
  };

  const store: PhysicsInterpolationStore = {
    sample(bodyId, target) {
      const sample = state.samples.get(bodyId);
      if (!sample) {
        return undefined;
      }
      return state.interpolate(sample.previous, sample.current, state.alpha, target);
    },
    snapshot() {
      return {
        alpha: state.alpha,
        fixedDeltaMs: state.fixedDeltaMs,
        trackedBodyCount: state.samples.size
      };
    },
    isBound() {
      return state.ownerId !== undefined;
    }
  };

  storeStates.set(store, state);
  return store;
}

export function bindPhysicsInterpolationStore(
  store: PhysicsInterpolationStore,
  ownerId: string,
  fixedDeltaMs: number
): void {
  const state = requireStoreState(store);
  if (state.ownerId !== undefined) {
    throw new GameError(
      "physics.interpolation_store_bound",
      "Physics interpolation store is already bound",
      { storeId: state.id, ownerId: state.ownerId, nextOwnerId: ownerId }
    );
  }
  state.ownerId = ownerId;
  state.fixedDeltaMs = fixedDeltaMs;
  state.alpha = 0;
  state.samples.clear();
}

export function unbindPhysicsInterpolationStore(
  store: PhysicsInterpolationStore,
  ownerId: string
): void {
  const state = requireStoreState(store);
  if (state.ownerId === undefined) {
    return;
  }
  if (state.ownerId !== ownerId) {
    throw new GameError(
      "physics.interpolation_store_owner_mismatch",
      "Physics interpolation store owner mismatch",
      { storeId: state.id, ownerId: state.ownerId, nextOwnerId: ownerId }
    );
  }
  state.ownerId = undefined;
  state.fixedDeltaMs = 0;
  state.alpha = 0;
  state.samples.clear();
}

export function resetPhysicsInterpolationBody(
  store: PhysicsInterpolationStore,
  bodyId: PhysicsBodyId,
  transform: PhysicsInterpolationTransform
): void {
  const state = requireStoreState(store);
  const sample = state.samples.get(bodyId);
  if (sample) {
    writeTransform(sample.previous, transform);
    writeTransform(sample.current, transform);
    return;
  }
  state.samples.set(bodyId, {
    previous: cloneTransform(transform),
    current: cloneTransform(transform)
  });
}

export function recordPhysicsInterpolationBody(
  store: PhysicsInterpolationStore,
  bodyId: PhysicsBodyId,
  transform: PhysicsInterpolationTransform
): void {
  const state = requireStoreState(store);
  const sample = state.samples.get(bodyId);
  if (!sample) {
    resetPhysicsInterpolationBody(store, bodyId, transform);
    return;
  }
  if (state.shouldResetHistory?.(bodyId, sample.current, transform)) {
    writeTransform(sample.previous, transform);
    writeTransform(sample.current, transform);
    return;
  }
  writeTransform(sample.previous, sample.current);
  writeTransform(sample.current, transform);
}

export function removePhysicsInterpolationBody(
  store: PhysicsInterpolationStore,
  bodyId: PhysicsBodyId
): void {
  requireStoreState(store).samples.delete(bodyId);
}

export function clearPhysicsInterpolationStore(store: PhysicsInterpolationStore): void {
  const state = requireStoreState(store);
  state.alpha = 0;
  state.samples.clear();
}

export function setPhysicsInterpolationAccumulator(
  store: PhysicsInterpolationStore,
  accumulator: number
): void {
  const state = requireStoreState(store);
  state.alpha =
    state.fixedDeltaMs <= 0 ? 0 : Math.max(0, Math.min(1, accumulator / state.fixedDeltaMs));
}

function requireStoreState(store: PhysicsInterpolationStore): PhysicsInterpolationStoreState {
  const state = storeStates.get(store);
  if (!state) {
    throw new GameError(
      "physics.interpolation_store_invalid",
      "Physics interpolation store must be created with createPhysicsInterpolationStore"
    );
  }
  return state;
}

function cloneTransform(transform: PhysicsInterpolationTransform): PhysicsInterpolationTransform {
  return {
    position: cloneVector(transform.position),
    ...(transform.rotation === undefined ? {} : { rotation: cloneRotation(transform.rotation) })
  };
}

function writeTransform(
  target: PhysicsInterpolationTransform,
  source: PhysicsInterpolationTransform
): void {
  writeVector(target.position, source.position);
  if (source.rotation === undefined) {
    delete target.rotation;
    return;
  }
  target.rotation = writeRotation(target.rotation, source.rotation);
}

export function interpolatePhysicsTransform(
  previous: ReadonlyPhysicsInterpolationTransform,
  current: ReadonlyPhysicsInterpolationTransform,
  alpha: number,
  target?: PhysicsInterpolationTransform
): PhysicsInterpolationTransform {
  const output = target ?? { position: { x: 0, y: 0 } };
  interpolateVector(output.position, previous.position, current.position, alpha);
  if (previous.rotation === undefined || current.rotation === undefined) {
    if (current.rotation === undefined) {
      delete output.rotation;
    } else {
      output.rotation = writeRotation(output.rotation, current.rotation);
    }
    return output;
  }
  output.rotation = interpolateRotation(
    output.rotation,
    previous.rotation,
    current.rotation,
    alpha
  );
  return output;
}

function cloneVector(vector: PhysicsVector): PhysicsVector {
  return {
    x: vector.x,
    y: vector.y,
    ...(vector.z === undefined ? {} : { z: vector.z })
  };
}

function writeVector(target: PhysicsVector, source: PhysicsVector): PhysicsVector {
  target.x = source.x;
  target.y = source.y;
  if (source.z === undefined) {
    delete target.z;
  } else {
    target.z = source.z;
  }
  return target;
}

function interpolateVector(
  target: PhysicsVector,
  previous: PhysicsVector,
  current: PhysicsVector,
  alpha: number
): PhysicsVector {
  target.x = lerp(previous.x, current.x, alpha);
  target.y = lerp(previous.y, current.y, alpha);
  if (previous.z === undefined || current.z === undefined) {
    if (current.z === undefined) {
      delete target.z;
    } else {
      target.z = current.z;
    }
  } else {
    target.z = lerp(previous.z, current.z, alpha);
  }
  return target;
}

function cloneRotation(rotation: ReadonlyPhysicsRotation): PhysicsRotation {
  return typeof rotation === "number" ? rotation : { ...rotation };
}

function writeRotation(
  target: PhysicsRotation | undefined,
  source: ReadonlyPhysicsRotation
): PhysicsRotation {
  if (typeof source === "number") {
    return source;
  }
  if (typeof target === "object") {
    return writeRotationObject(target, source);
  }
  return { ...source };
}

function interpolateRotation(
  target: PhysicsRotation | undefined,
  previous: ReadonlyPhysicsRotation,
  current: ReadonlyPhysicsRotation,
  alpha: number
): PhysicsRotation {
  if (typeof previous === "number" && typeof current === "number") {
    return interpolateAngle(previous, current, alpha);
  }
  if (isQuaternion(previous) && isQuaternion(current)) {
    const output = isQuaternion(target) ? target : { x: 0, y: 0, z: 0, w: 1 };
    return interpolateQuaternion(output, previous, current, alpha);
  }
  if (isVectorRotation(previous) && isVectorRotation(current)) {
    const output = isVectorRotation(target) ? target : { x: 0, y: 0 };
    return interpolateVector(output, previous, current, alpha);
  }
  return writeRotation(target, current);
}

function writeRotationObject(
  target: PhysicsVector | PhysicsQuaternion,
  source: Readonly<PhysicsVector> | Readonly<PhysicsQuaternion>
): PhysicsVector | PhysicsQuaternion {
  target.x = source.x;
  target.y = source.y;
  if (source.z === undefined) {
    delete target.z;
  } else {
    target.z = source.z;
  }
  if (isQuaternion(source)) {
    (target as PhysicsQuaternion).w = source.w;
  } else if ("w" in target) {
    delete (target as Partial<PhysicsQuaternion>).w;
  }
  return target;
}

function interpolateQuaternion(
  target: PhysicsQuaternion,
  previous: Readonly<PhysicsQuaternion>,
  current: Readonly<PhysicsQuaternion>,
  alpha: number
): PhysicsQuaternion {
  const dot =
    previous.x * current.x +
    previous.y * current.y +
    previous.z * current.z +
    previous.w * current.w;
  const direction = dot < 0 ? -1 : 1;
  target.x = lerp(previous.x, current.x * direction, alpha);
  target.y = lerp(previous.y, current.y * direction, alpha);
  target.z = lerp(previous.z, current.z * direction, alpha);
  target.w = lerp(previous.w, current.w * direction, alpha);
  const length = Math.hypot(target.x, target.y, target.z, target.w) || 1;
  target.x /= length;
  target.y /= length;
  target.z /= length;
  target.w /= length;
  return target;
}

function interpolateAngle(previous: number, current: number, alpha: number): number {
  const twoPi = Math.PI * 2;
  const delta = ((((current - previous + Math.PI) % twoPi) + twoPi) % twoPi) - Math.PI;
  return previous + delta * alpha;
}

function lerp(previous: number, current: number, alpha: number): number {
  return previous + (current - previous) * alpha;
}

function isQuaternion(
  value: ReadonlyPhysicsRotation | undefined
): value is Readonly<PhysicsQuaternion> {
  return typeof value === "object" && value !== null && "w" in value;
}

function isVectorRotation(
  value: ReadonlyPhysicsRotation | undefined
): value is Readonly<PhysicsVector> {
  return typeof value === "object" && value !== null && !("w" in value);
}
