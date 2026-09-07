import type {
  PhysicsLayoutColliderInstanceData,
  PhysicsLayoutData,
  PhysicsMaterialDefinition,
  PhysicsSceneConfig,
  PhysicsSceneData
} from "@gamekits/physics-core";
import type { DataRef, DataRegistry } from "@gamekits/data";
import { OUTPOST_ARENA, outpostArenaDefinition } from "./arena-scene";

export const OUTPOST_ARENA_PHYSICS_SCENE_ID = "scene.outpost.arena";
export const OUTPOST_ARENA_PHYSICS_LAYOUT_ID = "layout.outpost.arena";
export const OUTPOST_ARENA_STATIC_BODY_ID = "body.outpost.arena.static";

export const outpostArenaPhysicsScene = {
  id: OUTPOST_ARENA_PHYSICS_SCENE_ID,
  dimension: "2d",
  gravity: { x: 0, y: 0 },
  materials: [
    { type: "physics.material", id: "material.outpost.actor" },
    { type: "physics.material", id: "material.outpost.projectile" },
    { type: "physics.material", id: "material.outpost.arena" }
  ]
} satisfies PhysicsSceneData;

export function createOutpostArenaPhysicsSceneConfig(
  dataRegistry: DataRegistry
): PhysicsSceneConfig {
  const scene = dataRegistry.getValue<PhysicsSceneData>(
    "physics.scene",
    OUTPOST_ARENA_PHYSICS_SCENE_ID
  );
  const materialDefinitions = (scene.materials ?? []).map((material) =>
    dataRegistry.getValue<PhysicsMaterialDefinition>(material.type, material.id)
  );
  const { materials: _materials, ...config } = scene;
  return { ...config, materialDefinitions };
}

export const outpostArenaPhysicsLayout = {
  id: OUTPOST_ARENA_PHYSICS_LAYOUT_ID,
  scene: { type: "physics.scene", id: OUTPOST_ARENA_PHYSICS_SCENE_ID },
  bounds: {
    min: { x: 0, y: 0 },
    max: { x: OUTPOST_ARENA.width, y: OUTPOST_ARENA.height }
  },
  bodies: [
    {
      id: "architecture",
      body: { type: "physics.body", id: OUTPOST_ARENA_STATIC_BODY_ID },
      position: { x: 0, y: 0 },
      colliders: outpostArenaDefinition.staticObjects.map((object) =>
        box(
          object.id,
          object.collider,
          object.position.x,
          object.position.y,
          object.size.width,
          object.size.height,
          object.rotation
        )
      )
    }
  ],
  tags: ["outpost", "arena", "modular-static-objects"]
} satisfies PhysicsLayoutData;

function box(
  id: string,
  collider: DataRef<"physics.collider">,
  x: number,
  y: number,
  width: number,
  height: number,
  rotation?: number
): PhysicsLayoutColliderInstanceData {
  return {
    id,
    collider,
    overrides: {
      shape: { type: "box", width, height },
      offset: {
        position: { x, y },
        ...(rotation === undefined ? {} : { rotation })
      }
    }
  };
}
