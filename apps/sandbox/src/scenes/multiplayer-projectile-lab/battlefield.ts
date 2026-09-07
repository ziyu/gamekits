import type { PhysicsBackendAdapter, PhysicsScene, PhysicsVector } from "@gamekits/physics-core";

export type MultiplayerProjectileTargetDefinition = {
  id: string;
  callsign: string;
  role: string;
  position: PhysicsVector;
  radius: number;
  maxHealth: number;
  armor: "light" | "medium" | "heavy";
};

export type MultiplayerProjectileObstacleDefinition = {
  id: string;
  label: string;
  position: PhysicsVector;
  width: number;
  height: number;
  kind: "container" | "barricade" | "relay";
};

export const MULTIPLAYER_PROJECTILE_WORLD = {
  width: 120,
  height: 72,
  shooter: {
    id: "unit.vanguard-7",
    callsign: "VANGUARD-7",
    role: "Expeditionary rifle unit",
    position: { x: 13, y: 36 }
  },
  muzzle: { x: 17.2, y: 36 },
  authorityDesyncCover: {
    id: "authority-desync-cover",
    label: "stale blast door",
    position: { x: 67, y: 36 },
    width: 4,
    height: 13
  }
} as const;

export const MULTIPLAYER_PROJECTILE_TARGETS: readonly MultiplayerProjectileTargetDefinition[] = [
  {
    id: "target.gunner",
    callsign: "RED GUNNER",
    role: "Line infantry",
    position: { x: 104, y: 36 },
    radius: 3.1,
    maxHealth: 210,
    armor: "medium"
  },
  {
    id: "target.overwatch",
    callsign: "OVERWATCH",
    role: "Marksman in cover",
    position: { x: 102, y: 17 },
    radius: 2.7,
    maxHealth: 125,
    armor: "light"
  },
  {
    id: "target.drone",
    callsign: "SKIMMER-4",
    role: "Recon drone",
    position: { x: 91, y: 54 },
    radius: 2.55,
    maxHealth: 145,
    armor: "light"
  },
  {
    id: "target.bulwark",
    callsign: "BULWARK",
    role: "Heavy assault unit",
    position: { x: 113, y: 57 },
    radius: 3.8,
    maxHealth: 340,
    armor: "heavy"
  }
] as const;

export const MULTIPLAYER_PROJECTILE_OBSTACLES: readonly MultiplayerProjectileObstacleDefinition[] =
  [
    {
      id: "north-containers",
      label: "freight stack",
      position: { x: 70, y: 13 },
      width: 17,
      height: 8,
      kind: "container"
    },
    {
      id: "forward-barricade",
      label: "forward barricade",
      position: { x: 82, y: 23 },
      width: 10,
      height: 4.5,
      kind: "barricade"
    },
    {
      id: "south-barricade",
      label: "south barricade",
      position: { x: 73, y: 61 },
      width: 18,
      height: 4,
      kind: "barricade"
    },
    {
      id: "relay-pylon",
      label: "relay pylon",
      position: { x: 48, y: 51 },
      width: 6,
      height: 8,
      kind: "relay"
    }
  ] as const;

export type MultiplayerProjectileBattlefieldScene = {
  scene: PhysicsScene;
  setAuthorityDesyncCover(enabled: boolean): void;
  setTargetEnabled(targetId: string, enabled: boolean): void;
  setTargetPosition(targetId: string, position: PhysicsVector): void;
  dispose(): void;
};

export function createMultiplayerProjectileBattlefieldScene(
  backend: PhysicsBackendAdapter,
  label: string,
  authorityDesyncCoverEnabled: boolean
): MultiplayerProjectileBattlefieldScene {
  const scene = backend.createScene({
    id: `sandbox.multiplayer-projectile-lab.${label}`,
    dimension: "2d",
    gravity: { x: 0, y: 0 },
    fixedDeltaMs: 1000 / 60
  });

  for (const obstacle of MULTIPLAYER_PROJECTILE_OBSTACLES) {
    const bodyId = `obstacle.${obstacle.id}.body`;
    scene.createBody({ id: bodyId, kind: "static", position: obstacle.position });
    scene.createCollider({
      id: `obstacle.${obstacle.id}.collider`,
      bodyId,
      shape: { type: "box", width: obstacle.width, height: obstacle.height }
    });
  }

  for (const target of MULTIPLAYER_PROJECTILE_TARGETS) {
    const bodyId = `${target.id}.body`;
    scene.createBody({ id: bodyId, kind: "static", position: target.position });
    scene.createCollider({
      id: `${target.id}.collider`,
      bodyId,
      shape: { type: "circle", radius: target.radius }
    });
  }

  const desyncCover = MULTIPLAYER_PROJECTILE_WORLD.authorityDesyncCover;
  const desyncBodyId = `obstacle.${desyncCover.id}.body`;
  const desyncColliderId = `obstacle.${desyncCover.id}.collider`;
  scene.createBody({ id: desyncBodyId, kind: "static", position: desyncCover.position });
  scene.createCollider({
    id: desyncColliderId,
    bodyId: desyncBodyId,
    shape: { type: "box", width: desyncCover.width, height: desyncCover.height }
  });
  scene.updateCollider(desyncColliderId, { enabled: authorityDesyncCoverEnabled });
  scene.step(1000 / 60);

  return {
    scene,
    setAuthorityDesyncCover(enabled) {
      scene.updateCollider(desyncColliderId, { enabled });
      scene.step(1000 / 60);
    },
    setTargetEnabled(targetId, enabled) {
      scene.updateCollider(`${targetId}.collider`, { enabled });
      scene.step(1000 / 60);
    },
    setTargetPosition(targetId, position) {
      scene.updateBody(`${targetId}.body`, { position, sleeping: false });
      scene.step(1000 / 60);
    },
    dispose() {
      scene.dispose();
    }
  };
}

export function getMultiplayerProjectileTarget(
  id: string
): MultiplayerProjectileTargetDefinition | undefined {
  return MULTIPLAYER_PROJECTILE_TARGETS.find((target) => target.id === id);
}
