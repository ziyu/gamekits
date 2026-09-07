import { GameError } from "@gamekits/core";
import {
  checkCollision as checkSceneCollision,
  checkOverlap as checkSceneOverlap,
  overlapShape as overlapSceneShape,
  queryBounds as querySceneBounds,
  queryPoint as queryScenePoint,
  raycast as sceneRaycast,
  shapeCast as sceneShapeCast
} from "./query-helpers";
import type {
  PhysicsBounds,
  PhysicsColliderId,
  PhysicsHandle,
  PhysicsQueries,
  PhysicsQuery,
  PhysicsQueryOptions,
  PhysicsQueryResult,
  PhysicsRotation,
  PhysicsScene,
  PhysicsSceneSnapshot,
  PhysicsShapeDefinition,
  PhysicsVector
} from "./types";
import type { PhysicsCheckpointController } from "./checkpoint";

export type PhysicsHandleOptions = {
  id?: string;
};

type PhysicsHandleState = {
  id: string;
  scene: PhysicsScene | undefined;
  checkpoint: PhysicsCheckpointController | undefined;
  ownerId: string | undefined;
};

const handleStates = new WeakMap<PhysicsHandle, PhysicsHandleState>();

export function createPhysicsHandle(options: PhysicsHandleOptions = {}): PhysicsHandle {
  const state: PhysicsHandleState = {
    id: options.id ?? "physics.handle",
    scene: undefined,
    checkpoint: undefined,
    ownerId: undefined
  };

  const handle: PhysicsHandle = {
    query(query: PhysicsQuery): PhysicsQueryResult[] {
      return requireBoundScene(state, "query").query(query);
    },
    queryPoint(point: PhysicsVector, options?: PhysicsQueryOptions): PhysicsQueryResult[] {
      return queryScenePoint(requireBoundScene(state, "queryPoint"), point, options);
    },
    raycast(
      origin: PhysicsVector,
      direction: PhysicsVector,
      options: PhysicsQueryOptions & { maxDistance?: number; solid?: boolean } = {}
    ): PhysicsQueryResult[] {
      return sceneRaycast(requireBoundScene(state, "raycast"), origin, direction, options);
    },
    shapeCast(
      shape: PhysicsShapeDefinition,
      position: PhysicsVector,
      direction: PhysicsVector,
      options: PhysicsQueryOptions & {
        maxDistance?: number;
        rotation?: PhysicsRotation;
        stopAtPenetration?: boolean;
        targetDistance?: number;
      } = {}
    ): PhysicsQueryResult[] {
      return sceneShapeCast(
        requireBoundScene(state, "shapeCast"),
        shape,
        position,
        direction,
        options
      );
    },
    overlapShape(
      shape: PhysicsShapeDefinition,
      position: PhysicsVector,
      options: PhysicsQueryOptions & { rotation?: PhysicsRotation } = {}
    ): PhysicsQueryResult[] {
      return overlapSceneShape(requireBoundScene(state, "overlapShape"), shape, position, options);
    },
    checkOverlap(
      shape: PhysicsShapeDefinition,
      position: PhysicsVector,
      options: PhysicsQueryOptions & { rotation?: PhysicsRotation } = {}
    ): boolean {
      return checkSceneOverlap(requireBoundScene(state, "checkOverlap"), shape, position, options);
    },
    checkCollision(colliderId: PhysicsColliderId, options?: PhysicsQueryOptions): boolean {
      return checkSceneCollision(requireBoundScene(state, "checkCollision"), colliderId, options);
    },
    queryBounds(bounds: PhysicsBounds, options?: PhysicsQueryOptions): PhysicsQueryResult[] {
      return querySceneBounds(requireBoundScene(state, "queryBounds"), bounds, options);
    },
    snapshot(): PhysicsSceneSnapshot {
      return requireBoundScene(state, "snapshot").snapshot();
    },
    captureCheckpoint() {
      return requireCheckpointController(state, "captureCheckpoint").capture();
    },
    restoreCheckpoint(checkpoint, options) {
      requireCheckpointController(state, "restoreCheckpoint").restore(checkpoint, options);
    },
    isBound(): boolean {
      return state.scene !== undefined;
    }
  };

  handleStates.set(handle, state);
  return handle;
}

export function bindPhysicsHandle(
  handle: PhysicsHandle,
  scene: PhysicsScene,
  ownerId: string,
  checkpoint?: PhysicsCheckpointController
): void {
  const state = requireHandleState(handle);
  if (state.scene !== undefined) {
    throw new GameError("physics.handle_bound", "Physics handle is already bound", {
      handleId: state.id,
      ownerId: state.ownerId,
      nextOwnerId: ownerId,
      sceneId: state.scene.id
    });
  }

  state.scene = scene;
  state.checkpoint = checkpoint;
  state.ownerId = ownerId;
}

export function unbindPhysicsHandle(handle: PhysicsHandle, ownerId: string): void {
  const state = requireHandleState(handle);
  if (state.scene === undefined) {
    return;
  }
  if (state.ownerId !== ownerId) {
    throw new GameError("physics.handle_owner_mismatch", "Physics handle owner mismatch", {
      handleId: state.id,
      ownerId: state.ownerId,
      nextOwnerId: ownerId,
      sceneId: state.scene.id
    });
  }

  state.scene = undefined;
  state.checkpoint = undefined;
  state.ownerId = undefined;
}

function requireCheckpointController(
  state: PhysicsHandleState,
  operation: "captureCheckpoint" | "restoreCheckpoint"
): PhysicsCheckpointController {
  if (state.checkpoint === undefined) {
    throw new GameError(
      "physics.checkpoint_unavailable",
      "Physics checkpoint operations require a module-bound handle",
      { handleId: state.id, operation }
    );
  }
  return state.checkpoint;
}

function requireHandleState(handle: PhysicsHandle): PhysicsHandleState {
  const state = handleStates.get(handle);
  if (state === undefined) {
    throw new GameError(
      "physics.handle_invalid",
      "Physics handle must be created with createPhysicsHandle"
    );
  }

  return state;
}

function requireBoundScene(
  state: PhysicsHandleState,
  operation: keyof PhysicsQueries
): PhysicsScene {
  if (state.scene === undefined) {
    throw new GameError("physics.handle_unbound", "Physics handle is not bound to a scene", {
      handleId: state.id,
      operation
    });
  }

  return state.scene;
}
