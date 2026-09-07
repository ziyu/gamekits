import { defineGameModule } from "@gamekits/core";
import type { DataRegistry } from "@gamekits/data";
import type { GameInstallContext } from "@gamekits/game-runtime";
import {
  PhysicsBodyComponent,
  PhysicsTransformComponent,
  type PhysicsInterpolationStore,
  type PhysicsInterpolationTransform
} from "@gamekits/physics-core";
import type { RenderObjectDefinition, RendererAdapter } from "@gamekits/renderer-core";
import { OUTPOST_ARENA_DEFINITION_ID } from "../content/arena-scene";
import {
  OUTPOST_ARENA_TYPE,
  OUTPOST_RENDER_OBJECT_TYPE,
  type OutpostArenaDefinition,
  type OutpostRenderObjectDefinition
} from "../domain";
import { OutpostGameplayObject, OutpostPresentation } from "../gameplay/components";
import { OUTPOST_PRESENTATION_SIZE } from "../gameplay/constants";
import { outpostFacingRotation, resolveOutpostFacingRotation } from "./render-rotation";

export type OutpostRenderTargetState = {
  visible?: boolean;
  alpha?: number;
  transform?: {
    position?: { x?: number; y?: number };
    rotation?: { z?: number };
    scale?: { x?: number; y?: number };
  };
  props?: Record<string, unknown>;
};

export type OutpostRenderTargetWriter = (native: unknown, state: OutpostRenderTargetState) => void;

export function createOutpostPreviewPresentationModule(options: {
  dataRegistry: DataRegistry;
  renderer: RendererAdapter;
  physicsInterpolation?: PhysicsInterpolationStore | undefined;
  applyRenderTargetState?: OutpostRenderTargetWriter | undefined;
}) {
  const arenaObjects = createOutpostArenaRenderObjectDefinitions(options.dataRegistry);
  return defineGameModule<GameInstallContext>({
    id: "outpost.preview.presentation",
    install(ctx) {
      const activeObjects = new Set<string>();
      const signatures = new Map<string, string>();
      const sampledTransform: PhysicsInterpolationTransform = { position: { x: 0, y: 0 } };
      let arenaCreated = false;

      ctx.systems.register({
        id: "outpost.preview.presentation.sync",
        update() {
          if (!arenaCreated) {
            for (const definition of arenaObjects) {
              const objectId = definition.id;
              if (!objectId) {
                throw new Error("Outpost arena RenderObject requires id");
              }
              options.renderer.createObject(definition);
              activeObjects.add(objectId);
            }
            arenaCreated = true;
          }
          for (const entity of ctx.world.query([
            OutpostPresentation,
            OutpostGameplayObject,
            PhysicsTransformComponent
          ])) {
            const presentation = ctx.world.get(entity, OutpostPresentation);
            const object = ctx.world.get(entity, OutpostGameplayObject);
            const transform = ctx.world.get(entity, PhysicsTransformComponent);
            if (!presentation || !object || !transform) {
              continue;
            }
            const body = ctx.world.get(entity, PhysicsBodyComponent);
            const renderTransform =
              body?.bodyId && options.physicsInterpolation
                ? (options.physicsInterpolation.sample(body.bodyId, sampledTransform) ?? transform)
                : transform;
            const objectId = presentation.renderObjectId ?? object.id;
            if (!activeObjects.has(objectId)) {
              options.renderer.createObject(
                createRenderObjectDefinition(
                  options.dataRegistry,
                  presentation.renderKey,
                  objectId,
                  renderTransform.position.x,
                  renderTransform.position.y,
                  object.facing
                )
              );
              activeObjects.add(objectId);
              ctx.world.set(entity, OutpostPresentation, { renderObjectId: objectId });
            }
            const signature = `${renderTransform.position.x.toFixed(3)}:${renderTransform.position.y.toFixed(3)}:${object.facing.toFixed(3)}`;
            if (signatures.get(objectId) === signature) {
              continue;
            }
            signatures.set(objectId, signature);
            const handle = options.renderer.getObjectHandle?.(objectId);
            if (handle && options.applyRenderTargetState) {
              options.applyRenderTargetState(handle.native, {
                transform: {
                  position: { x: renderTransform.position.x, y: renderTransform.position.y },
                  rotation: {
                    z: resolveOutpostFacingRotation(
                      options.dataRegistry,
                      presentation.renderKey,
                      object.facing
                    )
                  }
                }
              });
            }
          }
        }
      });

      return () => {
        for (const objectId of activeObjects) {
          options.renderer.destroyObject(objectId);
        }
        activeObjects.clear();
        signatures.clear();
        arenaCreated = false;
      };
    }
  });
}

export function createOutpostArenaRenderObjectDefinitions(
  dataRegistry: DataRegistry
): RenderObjectDefinition[] {
  const arena = dataRegistry.getValue<OutpostArenaDefinition>(
    OUTPOST_ARENA_TYPE,
    OUTPOST_ARENA_DEFINITION_ID
  );
  return [
    createRenderObjectDefinition(
      dataRegistry,
      arena.floor.id,
      "outpost.preview.arena.floor",
      arena.width / 2,
      arena.height / 2,
      0,
      { width: arena.width, height: arena.height, depth: 0 }
    ),
    ...arena.staticObjects.map((object) =>
      createRenderObjectDefinition(
        dataRegistry,
        object.renderObject.id,
        `outpost.preview.arena.${object.id}`,
        object.position.x,
        object.position.y,
        object.rotation ?? 0,
        { ...object.size, depth: object.depth ?? 8 }
      )
    )
  ];
}

function createRenderObjectDefinition(
  registry: DataRegistry,
  renderKey: string,
  id: string,
  x: number,
  y: number,
  rotation: number,
  explicitSize?: { width: number; height: number; depth: number }
): RenderObjectDefinition {
  const source = registry.getValue<OutpostRenderObjectDefinition>(
    OUTPOST_RENDER_OBJECT_TYPE,
    renderKey
  );
  const size =
    explicitSize ?? OUTPOST_PRESENTATION_SIZE[renderKey as keyof typeof OUTPOST_PRESENTATION_SIZE];
  if (!size) {
    throw new Error(`Outpost render object requires presentation size: ${renderKey}`);
  }
  const texture = source.assetRefs.texture;
  if (!texture) {
    throw new Error(`Outpost render object requires texture AssetRef: ${renderKey}`);
  }
  return {
    id,
    type: source.type,
    ...(source.layer === undefined ? {} : { layer: source.layer }),
    tags: [...(source.tags ?? [])],
    transform: {
      position: { x, y },
      rotation: { z: outpostFacingRotation(source, rotation) }
    },
    props: {
      textureId: texture.assetId,
      ...size
    }
  };
}
