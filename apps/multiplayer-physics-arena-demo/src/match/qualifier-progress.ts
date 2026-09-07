import type { PhysicsVector } from "@gamekits/physics-core";

import type { ArenaGameplayVolumeDefinition } from "../content/types";

export type ArenaQualifierProgress = {
  checkpointCount: number;
  checkpointTotal: number;
  finished: boolean;
  normalizedProgress: number;
};

/** Advances ordered race progress from authority-owned body and volume facts. */
export function advanceArenaQualifierProgress(input: {
  previous?: Readonly<ArenaQualifierProgress> | undefined;
  position: Readonly<PhysicsVector>;
  startZ: number;
  checkpoints: readonly ArenaGameplayVolumeDefinition[];
  finish?: Readonly<ArenaGameplayVolumeDefinition> | undefined;
}): ArenaQualifierProgress {
  const checkpoints = [...input.checkpoints].sort(
    (left, right) => (left.routeOrder ?? 0) - (right.routeOrder ?? 0)
  );
  let checkpointCount = Math.min(
    checkpoints.length,
    Math.max(0, input.previous?.checkpointCount ?? 0)
  );
  const nextCheckpoint = checkpoints[checkpointCount];
  if (nextCheckpoint !== undefined && pointInside(input.position, nextCheckpoint)) {
    checkpointCount += 1;
  }
  const finished =
    (input.previous?.finished ?? false) ||
    (input.finish !== undefined &&
      checkpointCount >= checkpoints.length &&
      pointInside(input.position, input.finish));
  const finishZ = input.finish?.position.z ?? input.startZ;
  const positionZ = input.position.z ?? 0;
  const routeProgress =
    Math.abs(input.startZ - finishZ) <= 0.001
      ? 0
      : (input.startZ - positionZ) / (input.startZ - finishZ);

  return {
    checkpointCount,
    checkpointTotal: checkpoints.length,
    finished,
    normalizedProgress: finished ? 1 : clamp(routeProgress, 0, 1)
  };
}

function pointInside(
  point: Readonly<PhysicsVector>,
  volume: Readonly<ArenaGameplayVolumeDefinition>
): boolean {
  const halfWidth = volume.size.width / 2;
  const halfHeight = volume.size.height / 2;
  const halfDepth = volume.size.depth / 2;
  return (
    Math.abs(point.x - volume.position.x) <= halfWidth &&
    Math.abs(point.y - volume.position.y) <= halfHeight &&
    Math.abs((point.z ?? 0) - (volume.position.z ?? 0)) <= halfDepth
  );
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
