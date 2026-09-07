import { defineGameModule } from "@gamekits/core";
import {
  screenToWorld,
  type CameraController,
  type CameraState2D,
  type PointLike
} from "@gamekits/camera-core";
import type { GameInstallContext } from "@gamekits/game-runtime";
import type {
  StandardCameraActionBinding,
  StandardCameraFollowOptions,
  StandardCameraSmoothingOptions,
  StandardServiceBuildContext
} from "../types";

type CameraInputEvent = {
  payload: unknown;
};

export type CreateStandardCameraModuleOptions<TContext> = {
  id?: string | undefined;
  controller: CameraController;
  inputEventType?: string | undefined;
  actions: StandardCameraActionBinding[];
  smoothing?: StandardCameraSmoothingOptions | undefined;
  follow?: StandardCameraFollowOptions<TContext> | undefined;
  sync?:
    | ((
        ctx: StandardServiceBuildContext<TContext>,
        controller: CameraController,
        action: StandardCameraActionBinding | undefined,
        state: CameraState2D
      ) => void)
    | undefined;
  buildContext: StandardServiceBuildContext<TContext>;
};

export function createStandardCameraModule<TContext>(
  options: CreateStandardCameraModuleOptions<TContext>
) {
  const smoothing = normalizeSmoothing(options.smoothing);
  let displayState = options.controller.getState();
  let zoomAnchor: CameraZoomAnchor | undefined;

  return defineGameModule<GameInstallContext>({
    id: options.id ?? "gamekits.camera",
    install(ctx) {
      syncCamera(options, undefined, displayState);
      const cleanups: Array<() => void> = [];

      if (options.follow) {
        const follow = options.follow;
        cleanups.push(
          ctx.eventBus.on(follow.eventType ?? "camera.follow_entity", (event) => {
            const targetEntity = resolveFollowTarget(follow, event);
            if (targetEntity === undefined) {
              return;
            }
            options.controller.follow(targetEntity);
            ctx.eventBus.emit(
              "camera.follow_started",
              { targetEntity, state: options.controller.getState() },
              "gamekits.camera"
            );
          })
        );
        cleanups.push(
          ctx.eventBus.on(follow.stopEventType ?? "camera.stop_follow", () => {
            options.controller.stopFollow();
            displayState = options.controller.getState();
            syncCamera(options, undefined, displayState);
            ctx.eventBus.emit(
              "camera.follow_stopped",
              { state: options.controller.getState() },
              "gamekits.camera"
            );
          })
        );
        ctx.systems.register({
          id: `${options.id ?? "gamekits.camera"}.follow`,
          update() {
            if (applyCameraFollow(options)) {
              zoomAnchor = undefined;
              if (!smoothing.enabled) {
                displayState = options.controller.getState();
                syncCamera(options, undefined, displayState);
              }
            }
          }
        });
      }

      if (smoothing.enabled) {
        ctx.systems.register({
          id: `${options.id ?? "gamekits.camera"}.smoothing`,
          update({ delta }) {
            const targetState = options.controller.getState();
            displayState = smoothCameraState(
              displayState,
              targetState,
              delta,
              smoothing,
              zoomAnchor
            );
            syncCamera(options, undefined, displayState);
            if (
              zoomAnchor &&
              Math.abs(displayState.zoom - targetState.zoom) <= smoothing.zoomEpsilon
            ) {
              zoomAnchor = undefined;
            }
          }
        });
      }

      const unsubscribe = ctx.eventBus.on(options.inputEventType ?? "input.action", (event) => {
        for (const action of options.actions) {
          const displayBeforeAction = displayState;
          const result = applyCameraAction(
            options.controller,
            action,
            event,
            smoothing.enabled ? displayBeforeAction : undefined
          );
          if (result.changed) {
            zoomAnchor =
              smoothing.enabled && result.zoomAnchor
                ? {
                    screen: result.zoomAnchor,
                    world: screenToWorld(displayBeforeAction, result.zoomAnchor)
                  }
                : undefined;
            if (!smoothing.enabled) {
              displayState = options.controller.getState();
              syncCamera(options, action, displayState);
            }
            ctx.eventBus.emit(
              "camera.updated",
              {
                actionId: action.actionId,
                state: options.controller.getState()
              },
              "gamekits.camera"
            );
          }
        }
      });
      cleanups.push(unsubscribe);

      return () => {
        for (const cleanup of cleanups.reverse()) {
          cleanup();
        }
      };
    }
  });
}

function syncCamera<TContext>(
  options: CreateStandardCameraModuleOptions<TContext>,
  action: StandardCameraActionBinding | undefined,
  state: CameraState2D
): void {
  options.sync?.(options.buildContext, options.controller, action, state);
}

function applyCameraAction(
  controller: CameraController,
  action: StandardCameraActionBinding,
  event: CameraInputEvent,
  baseState?: CameraState2D | undefined
): CameraActionResult {
  const payload = isRecord(event.payload) ? event.payload : {};
  if (payload.actionId !== action.actionId) {
    return { changed: false };
  }

  const phase = typeof payload.phase === "string" ? payload.phase : undefined;
  if (action.phases && (!phase || !action.phases.includes(phase))) {
    return { changed: false };
  }

  if (baseState && action.zoom) {
    controller.setState(baseState);
  }

  if (action.pan) {
    controller.pan(action.pan.x ?? 0, action.pan.y ?? 0);
  }

  let zoomAnchor: PointLike | undefined;
  if (action.zoom) {
    zoomAnchor = resolveZoomAnchor(action.zoom, payload);
    controller.zoom(resolveZoomDelta(action.zoom, payload), zoomAnchor);
  }

  return {
    changed: action.pan !== undefined || action.zoom !== undefined,
    zoomAnchor
  };
}

function applyCameraFollow<TContext>(
  options: CreateStandardCameraModuleOptions<TContext>
): boolean {
  const follow = options.follow;
  if (!follow) {
    return false;
  }

  const state = options.controller.getState();
  if (state.mode !== "follow" || state.targetEntity === undefined) {
    return false;
  }

  const target = follow.resolveTarget(options.buildContext, state.targetEntity);
  if (!target) {
    return false;
  }

  options.controller.setState({
    mode: "follow",
    targetEntity: state.targetEntity,
    x: target.x,
    y: target.y
  });
  return true;
}

function resolveFollowTarget<TContext>(
  follow: StandardCameraFollowOptions<TContext>,
  event: CameraInputEvent
): string | number | undefined {
  if (follow.targetFromEvent) {
    return follow.targetFromEvent(event);
  }

  const payload = isRecord(event.payload) ? event.payload : {};
  const targetEntity = payload.targetEntity ?? payload.entityId;
  return typeof targetEntity === "string" || typeof targetEntity === "number"
    ? targetEntity
    : undefined;
}

function resolveZoomDelta(
  zoom: NonNullable<StandardCameraActionBinding["zoom"]>,
  payload: Record<string, unknown>
): number {
  if (!zoom.wheel) {
    return zoom.delta ?? 0;
  }

  const input = isRecord(payload.input) ? payload.input : payload;
  const wheelDelta = typeof input.wheelDelta === "number" ? input.wheelDelta : undefined;
  if (wheelDelta === undefined || wheelDelta === 0) {
    return zoom.delta ?? 0;
  }

  return wheelDelta < 0 ? Math.abs(zoom.delta ?? 1) : -Math.abs(zoom.delta ?? 1);
}

function resolveZoomAnchor(
  zoom: NonNullable<StandardCameraActionBinding["zoom"]>,
  payload: Record<string, unknown>
): PointLike | undefined {
  if (!zoom.anchorFromInput) {
    return undefined;
  }

  const input = isRecord(payload.input) ? payload.input : payload;
  return typeof input.x === "number" && typeof input.y === "number"
    ? { x: input.x, y: input.y }
    : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

type NormalizedCameraSmoothing = {
  enabled: boolean;
  stiffness: number;
  positionEpsilon: number;
  zoomEpsilon: number;
  rotationEpsilon: number;
};

type CameraActionResult = {
  changed: boolean;
  zoomAnchor?: PointLike | undefined;
};

type CameraZoomAnchor = {
  screen: PointLike;
  world: PointLike;
};

function normalizeSmoothing(
  smoothing: StandardCameraSmoothingOptions | undefined
): NormalizedCameraSmoothing {
  return {
    enabled: smoothing?.enabled ?? false,
    stiffness: smoothing?.stiffness ?? 14,
    positionEpsilon: smoothing?.positionEpsilon ?? 0.05,
    zoomEpsilon: smoothing?.zoomEpsilon ?? 0.001,
    rotationEpsilon: smoothing?.rotationEpsilon ?? 0.001
  };
}

function smoothCameraState(
  current: CameraState2D,
  target: CameraState2D,
  delta: number,
  smoothing: NormalizedCameraSmoothing,
  zoomAnchor?: CameraZoomAnchor | undefined
): CameraState2D {
  const alpha = 1 - Math.exp(-smoothing.stiffness * Math.max(0, delta) * 0.001);
  const zoom = smoothNumber(current.zoom, target.zoom, alpha, smoothing.zoomEpsilon);
  const rotation = smoothNumber(
    current.rotation,
    target.rotation,
    alpha,
    smoothing.rotationEpsilon
  );
  const anchoredCenter = zoomAnchor
    ? centerForAnchor({ ...target, rotation }, zoomAnchor.screen, zoomAnchor.world, zoom)
    : undefined;

  return {
    ...target,
    x: anchoredCenter?.x ?? smoothNumber(current.x, target.x, alpha, smoothing.positionEpsilon),
    y: anchoredCenter?.y ?? smoothNumber(current.y, target.y, alpha, smoothing.positionEpsilon),
    zoom,
    rotation
  };
}

function centerForAnchor(
  state: CameraState2D,
  screen: PointLike,
  world: PointLike,
  zoom: number
): PointLike {
  const dx = (screen.x - state.viewport.width / 2) / zoom;
  const dy = (screen.y - state.viewport.height / 2) / zoom;
  const cos = Math.cos(state.rotation);
  const sin = Math.sin(state.rotation);

  return {
    x: world.x - (dx * cos - dy * sin),
    y: world.y - (dx * sin + dy * cos)
  };
}

function smoothNumber(current: number, target: number, alpha: number, epsilon: number): number {
  const next = current + (target - current) * alpha;
  return Math.abs(next - target) <= epsilon ? target : next;
}
