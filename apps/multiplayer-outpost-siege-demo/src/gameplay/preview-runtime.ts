import type { CameraController, CameraState2D, PointLike } from "@gamekits/camera-core";
import { defineGameModule } from "@gamekits/core";
import type { DataRegistry } from "@gamekits/data";
import { createEventBus, type EventBus } from "@gamekits/event-bus";
import { createGame, type GameInstallContext, type GameRuntime } from "@gamekits/game-runtime";
import {
  createPhysicsHandle,
  createPhysicsInterpolationStore,
  createPhysicsLayoutModule,
  createPhysicsModule,
  createPhysicsTraceStore,
  PhysicsBodyComponent,
  PhysicsColliderComponent,
  PhysicsTransformComponent,
  PhysicsVelocityComponent,
  type PhysicsBackendAdapter,
  type PhysicsBodyData,
  type PhysicsColliderData,
  type PhysicsHandle,
  type PhysicsInterpolationStore,
  type PhysicsInterpolationTransform,
  type PhysicsTraceStore
} from "@gamekits/physics-core";
import type { RendererAdapter } from "@gamekits/renderer-core";
import type { EntityId, GameWorld } from "@gamekits/world";
import {
  OUTPOST_MOVEMENT_PROFILE_TYPE,
  OUTPOST_PLAYER_TYPE,
  type OutpostMovementProfileDefinition,
  type OutpostPlayerDefinition
} from "../domain";
import { createOutpostArenaPhysicsSceneConfig, OUTPOST_ARENA_PHYSICS_LAYOUT_ID } from "../content";
import {
  createOutpostIdentityRegistry,
  type OutpostIdentityRegistry
} from "../domain/identity-registry";
import { OutpostGameplayObject, OutpostPresentation } from "./components";
import { OUTPOST_ARENA, OUTPOST_PREVIEW_PLAYER_ID, OUTPOST_PREVIEW_SEED } from "./constants";
import {
  createOutpostPreviewPresentationModule,
  type OutpostRenderTargetWriter
} from "../presentation/preview-presentation-module";
import {
  clearOutpostTransientInput,
  createOutpostInputState,
  type OutpostInputState
} from "./input";
import {
  advanceOutpostMovement,
  createOutpostMovementState,
  type OutpostMovementState
} from "./player/movement-policy";

const PLAYER_DEFINITION_ID = "player.outpost.ranger";
export type OutpostCameraAdapter = {
  applyCameraState(state: CameraState2D): void;
};

export type OutpostPreviewEvent = {
  id: string;
  type: string;
  tick: number;
};

export type OutpostPreviewSnapshot = {
  mode: "local-authority-preview";
  running: boolean;
  tick: number;
  elapsed: number;
  entityCount: number;
  player: {
    entityId: EntityId;
    x: number;
    y: number;
    velocityX: number;
    velocityY: number;
  };
  physics: {
    bound: boolean;
    recentTraceCount: number;
  };
  events: OutpostPreviewEvent[];
};

export type OutpostPreviewRuntime = {
  runtime: GameRuntime;
  input: OutpostInputState;
  identity: OutpostIdentityRegistry;
  physics: PhysicsHandle;
  physicsInterpolation: PhysicsInterpolationStore;
  physicsTrace: PhysicsTraceStore;
  playerEntity: EntityId;
  screenToWorld(point: PointLike): PointLike;
  snapshot(): OutpostPreviewSnapshot;
};

export type CreateOutpostPreviewRuntimeOptions = {
  dataRegistry: DataRegistry;
  world: GameWorld;
  physicsBackend: PhysicsBackendAdapter;
  renderer?: RendererAdapter | undefined;
  applyRenderTargetState?: OutpostRenderTargetWriter | undefined;
  camera?: CameraController | undefined;
  cameraAdapter?: OutpostCameraAdapter | undefined;
  eventBus?: EventBus | undefined;
  seed?: string | undefined;
};

type PreviewState = {
  dataRegistry: DataRegistry;
  world: GameWorld;
  input: OutpostInputState;
  identity: OutpostIdentityRegistry;
  playerEntity?: EntityId;
  movement: OutpostMovementState;
  events: OutpostPreviewEvent[];
  eventSequence: number;
};

export function createOutpostPreviewRuntime(
  options: CreateOutpostPreviewRuntimeOptions
): OutpostPreviewRuntime {
  const eventBus = options.eventBus ?? createEventBus({ clock: () => Date.now() });
  const physics = createPhysicsHandle({ id: "outpost.preview.physics" });
  const physicsInterpolation = createPhysicsInterpolationStore({
    id: "outpost.preview.physics-interpolation"
  });
  const physicsTrace = createPhysicsTraceStore({ limit: 180 });
  const physicsScene = statePhysicsScene(options.dataRegistry);
  const state: PreviewState = {
    dataRegistry: options.dataRegistry,
    world: options.world,
    input: createOutpostInputState(),
    identity: createOutpostIdentityRegistry(),
    movement: createOutpostMovementState(),
    events: [],
    eventSequence: 0
  };

  const runtime = createGame({
    seed: options.seed ?? OUTPOST_PREVIEW_SEED,
    world: options.world,
    eventBus,
    modules: [
      createPreviewBootstrapModule(state),
      createPhysicsLayoutModule({
        id: "outpost.preview.arena-layout",
        dataRegistry: options.dataRegistry,
        layoutId: OUTPOST_ARENA_PHYSICS_LAYOUT_ID
      }),
      createPreviewMovementModule(state),
      createPhysicsModule({
        id: "outpost.preview.physics",
        backend: options.physicsBackend,
        fixedDeltaMs: 1000 / 60,
        maxSubSteps: 4,
        scene: physicsScene,
        traceStore: physicsTrace,
        handle: physics,
        interpolationStore: physicsInterpolation
      }),
      createPreviewCameraModule(state, options.camera, options.cameraAdapter, physicsInterpolation),
      ...(options.renderer
        ? [
            createOutpostPreviewPresentationModule({
              dataRegistry: state.dataRegistry,
              renderer: options.renderer,
              physicsInterpolation,
              applyRenderTargetState: options.applyRenderTargetState
            })
          ]
        : []),
      createPreviewEventModule(state),
      createPreviewInputResetModule(state)
    ]
  });
  const playerEntity = requirePlayerEntity(state);

  return {
    runtime,
    input: state.input,
    identity: state.identity,
    physics,
    physicsInterpolation,
    physicsTrace,
    playerEntity,
    screenToWorld(point) {
      return options.camera?.screenToWorld(point) ?? point;
    },
    snapshot() {
      const clock = runtime.clock.snapshot();
      const transform = requireComponent(
        state.world.get(playerEntity, PhysicsTransformComponent),
        "player physics transform"
      );
      const velocity = requireComponent(
        state.world.get(playerEntity, PhysicsVelocityComponent),
        "player physics velocity"
      );
      return {
        mode: "local-authority-preview",
        running: runtime.isRunning(),
        tick: clock.ticks,
        elapsed: clock.elapsed,
        entityCount: state.world.count(),
        player: {
          entityId: playerEntity,
          x: transform.position.x,
          y: transform.position.y,
          velocityX: velocity.linear.x,
          velocityY: velocity.linear.y
        },
        physics: {
          bound: physics.isBound(),
          recentTraceCount: physicsTrace.list().length
        },
        events: state.events.map((event) => ({ ...event }))
      };
    }
  };
}

function createPreviewBootstrapModule(state: PreviewState) {
  return defineGameModule<GameInstallContext>({
    id: "outpost.preview.bootstrap",
    install(ctx) {
      const player = state.dataRegistry.getValue<OutpostPlayerDefinition>(
        OUTPOST_PLAYER_TYPE,
        PLAYER_DEFINITION_ID
      );
      const entity = ctx.world.spawn();
      state.playerEntity = entity;
      const bodyData = state.dataRegistry.getValue<PhysicsBodyData>(
        "physics.body",
        player.physicsBody.id
      );
      const colliderRef = bodyData.colliders?.[0];
      if (!colliderRef) {
        throw new Error(`Outpost player body requires a collider: ${bodyData.id}`);
      }
      const colliderData = state.dataRegistry.getValue<PhysicsColliderData>(
        colliderRef.type,
        colliderRef.id
      );
      const bodyId = `${OUTPOST_PREVIEW_PLAYER_ID}.body`;
      const colliderId = `${OUTPOST_PREVIEW_PLAYER_ID}.collider`;

      ctx.world.add(entity, OutpostGameplayObject, {
        id: OUTPOST_PREVIEW_PLAYER_ID,
        kind: "player"
      });
      ctx.world.add(entity, PhysicsTransformComponent, {
        position: { x: OUTPOST_ARENA.width / 2, y: OUTPOST_ARENA.height / 2 }
      });
      ctx.world.add(entity, PhysicsVelocityComponent, { linear: { x: 0, y: 0 } });
      ctx.world.add(entity, PhysicsBodyComponent, {
        definition: toBodyDefinition(bodyData, bodyId),
        syncVelocityFromWorld: true
      });
      ctx.world.add(entity, PhysicsColliderComponent, {
        definition: toColliderDefinition(colliderData, colliderId)
      });
      ctx.world.add(entity, OutpostPresentation, {
        renderKey: player.renderObject.id,
        renderObjectId: OUTPOST_PREVIEW_PLAYER_ID
      });
      state.identity.register({
        gameplayObjectId: OUTPOST_PREVIEW_PLAYER_ID,
        entityId: entity,
        physicsBodyId: bodyId,
        physicsColliderIds: [colliderId],
        renderObjectId: OUTPOST_PREVIEW_PLAYER_ID
      });

      ctx.eventBus.emit(
        "outpost.preview.ready",
        { playerEntity: entity, entityCount: ctx.world.count() },
        "outpost.preview.bootstrap"
      );

      return () => {
        state.identity.clear();
        if (ctx.world.has(entity)) {
          ctx.world.despawn(entity);
        }
        delete state.playerEntity;
      };
    }
  });
}

function createPreviewMovementModule(state: PreviewState) {
  const definition = state.dataRegistry.getValue<OutpostPlayerDefinition>(
    OUTPOST_PLAYER_TYPE,
    PLAYER_DEFINITION_ID
  );
  const movementProfile = state.dataRegistry.getValue<OutpostMovementProfileDefinition>(
    OUTPOST_MOVEMENT_PROFILE_TYPE,
    definition.movementProfile.id
  );
  return defineGameModule<GameInstallContext>({
    id: "outpost.preview.movement",
    install(ctx) {
      ctx.systems.register({
        id: "outpost.preview.movement.apply",
        update({ delta }) {
          const playerEntity = requirePlayerEntity(state);
          const transform = ctx.world.get(playerEntity, PhysicsTransformComponent);
          const velocity = ctx.world.get(playerEntity, PhysicsVelocityComponent);
          if (!transform || !velocity) {
            return;
          }
          state.movement.velocityX = velocity.linear.x;
          state.movement.velocityY = velocity.linear.y;
          advanceOutpostMovement(state.movement, state.input, movementProfile, {
            deltaMs: delta,
            position: transform.position
          });
          ctx.world.set(playerEntity, PhysicsVelocityComponent, {
            linear: {
              x: state.movement.velocityX,
              y: state.movement.velocityY
            }
          });
          ctx.world.set(playerEntity, OutpostGameplayObject, { facing: state.movement.facing });
        }
      });
    }
  });
}

function createPreviewCameraModule(
  state: PreviewState,
  camera: CameraController | undefined,
  cameraAdapter: OutpostCameraAdapter | undefined,
  physicsInterpolation: PhysicsInterpolationStore
) {
  return defineGameModule<GameInstallContext>({
    id: "outpost.preview.camera",
    install(ctx) {
      if (!camera) {
        return;
      }
      camera.follow(requirePlayerEntity(state));
      const sampledTransform: PhysicsInterpolationTransform = { position: { x: 0, y: 0 } };
      ctx.systems.register({
        id: "outpost.preview.camera.follow",
        update({ delta }) {
          const transform = ctx.world.get(requirePlayerEntity(state), PhysicsTransformComponent);
          if (!transform) {
            return;
          }
          const body = ctx.world.get(requirePlayerEntity(state), PhysicsBodyComponent);
          const cameraTransform =
            body?.bodyId === undefined
              ? transform
              : (physicsInterpolation.sample(body.bodyId, sampledTransform) ?? transform);
          if (state.input.cameraZoomDelta !== 0) {
            const viewport = camera.getState().viewport;
            camera.zoom(state.input.cameraZoomDelta < 0 ? 1 : -1, {
              x: state.input.cameraZoomX ?? viewport.width / 2,
              y: state.input.cameraZoomY ?? viewport.height / 2
            });
          }
          camera.setState({
            mode: "follow",
            targetEntity: requirePlayerEntity(state),
            x: cameraTransform.position.x,
            y: cameraTransform.position.y,
            bounds: { x: 0, y: 0, width: OUTPOST_ARENA.width, height: OUTPOST_ARENA.height }
          });
          cameraAdapter?.applyCameraState(camera.update(delta));
        }
      });
    }
  });
}

function createPreviewEventModule(state: PreviewState) {
  return defineGameModule<GameInstallContext>({
    id: "outpost.preview.events",
    install(ctx) {
      return ctx.eventBus.onAny((event) => {
        state.eventSequence += 1;
        const tick =
          typeof event.payload === "object" &&
          event.payload !== null &&
          "tick" in event.payload &&
          typeof event.payload.tick === "number"
            ? event.payload.tick
            : 0;
        state.events.unshift({
          id: `outpost.preview.event.${state.eventSequence}`,
          type: event.type,
          tick
        });
        if (state.events.length > 8) {
          state.events.pop();
        }
      });
    }
  });
}

function createPreviewInputResetModule(state: PreviewState) {
  return defineGameModule<GameInstallContext>({
    id: "outpost.preview.input-reset",
    install(ctx) {
      ctx.systems.register({
        id: "outpost.preview.input-reset.clear",
        update({ tick }) {
          const requests = [
            ["rifle.fire", state.input.primaryRequested],
            ["dash", state.input.dashRequested],
            ["shock.field", state.input.shockFieldRequested],
            ["turret.deploy", state.input.deployTurretRequested]
          ] as const;
          for (const [action, requested] of requests) {
            if (requested) {
              ctx.eventBus.emit(
                "outpost.preview.action_requested",
                { action, previewOnly: true, tick },
                "outpost.preview.input"
              );
            }
          }
          clearOutpostTransientInput(state.input);
        }
      });
    }
  });
}

function toBodyDefinition(data: PhysicsBodyData, id: string) {
  const { colliders: _colliders, tags: _tags, ...definition } = data;
  return { ...definition, id };
}

function toColliderDefinition(data: PhysicsColliderData, id: string) {
  const { tags: _tags, ...definition } = data;
  return { ...definition, id };
}

function requirePlayerEntity(state: PreviewState): EntityId {
  if (state.playerEntity === undefined) {
    throw new Error("Outpost preview player has not been materialized");
  }
  return state.playerEntity;
}

function statePhysicsScene(dataRegistry: DataRegistry) {
  return createOutpostArenaPhysicsSceneConfig(dataRegistry);
}

function requireComponent<T>(value: T | undefined, label: string): T {
  if (value === undefined) {
    throw new Error(`Missing Outpost ${label}`);
  }
  return value;
}
