import { worldToScreen, type CameraState2D } from "@gamekits/camera-core";
import { SANDBOX_RENDER_SIZE, type SandboxSnapshot } from "./game";

export type SandboxSceneClickTarget = { entityId: string | number; actorId?: string } | undefined;

export function resolveSandboxSceneClickTarget(
  snapshot: SandboxSnapshot,
  point: { x: number; y: number },
  camera: CameraState2D
): SandboxSceneClickTarget {
  const entity = findNearestClickableEntity(snapshot, point, camera);
  if (!entity) {
    return undefined;
  }

  return entity.actorId
    ? {
        entityId: entity.id,
        actorId: entity.actorId
      }
    : { entityId: entity.id };
}

function findNearestClickableEntity(
  snapshot: SandboxSnapshot,
  point: { x: number; y: number },
  camera: CameraState2D
): SandboxSnapshot["entities"][number] | undefined {
  let best: { entity: SandboxSnapshot["entities"][number]; distance: number } | undefined;
  for (const entity of snapshot.entities) {
    if (entity.role === "road") {
      continue;
    }

    const screen = worldToScreen(camera, {
      x: (entity.x / 100) * SANDBOX_RENDER_SIZE.width,
      y: (entity.y / 100) * SANDBOX_RENDER_SIZE.height
    });
    const distance = Math.hypot(point.x - screen.x, point.y - screen.y);
    const radius = clickableRadius(entity);
    if (distance <= radius && (!best || distance < best.distance)) {
      best = { entity, distance };
    }
  }
  return best?.entity;
}

function clickableRadius(entity: SandboxSnapshot["entities"][number]): number {
  return entity.role === "campfire" ? 42 : entity.role === "worker" ? 22 : 30;
}
