import type { CombatKinematicProjectileDefinition } from "@gamekits/combat";

export type MultiplayerProjectileWeaponId =
  | "pulse-carbine"
  | "plasma-caster"
  | "rocket-pod"
  | "scattergun"
  | "gravity-ricochet";

export type MultiplayerProjectileVisualKind =
  | "tracer"
  | "plasma"
  | "rocket"
  | "pellet"
  | "physical";

type MultiplayerProjectileWeaponBase = {
  id: MultiplayerProjectileWeaponId;
  name: string;
  designation: string;
  projectileName: string;
  description: string;
  visualKind: MultiplayerProjectileVisualKind;
  color: string;
  glow: string;
  damage: number;
  blastRadius: number;
  speed: number;
  cooldownTicks: number;
  projectilesPerShot: number;
  spreadDegrees: number;
  projectileRadius: number;
};

export type MultiplayerKinematicProjectileWeapon = MultiplayerProjectileWeaponBase & {
  simulation: "kinematic";
  networkStrategy: "kinematic-data-buffer";
  definition: CombatKinematicProjectileDefinition;
};

export type MultiplayerPhysicsProjectileWeapon = MultiplayerProjectileWeaponBase & {
  simulation: "physics-island";
  networkStrategy: "predicted-entity";
  physics: {
    gravity: number;
    restitution: number;
    density: number;
    lifetimeTicks: number;
  };
};

export type MultiplayerProjectileWeapon =
  | MultiplayerKinematicProjectileWeapon
  | MultiplayerPhysicsProjectileWeapon;

export const MULTIPLAYER_PROJECTILE_WEAPONS: readonly MultiplayerProjectileWeapon[] = [
  {
    id: "pulse-carbine",
    simulation: "kinematic",
    networkStrategy: "kinematic-data-buffer",
    name: "VX-9 Carbine",
    designation: "01 / KINETIC",
    projectileName: "cased pulse round",
    description: "Fast, precise rifle fire. A compact swept projectile for exposed targets.",
    visualKind: "tracer",
    color: "#ffd166",
    glow: "#ff9f43",
    damage: 26,
    blastRadius: 0,
    speed: 88,
    cooldownTicks: 10,
    projectilesPerShot: 1,
    spreadDegrees: 0,
    projectileRadius: 0.28,
    definition: {
      id: "sandbox.projectile.pulse-carbine",
      version: "v1",
      collisionMode: "shape-sweep",
      lifetimeTicks: 150,
      sweepShape: { type: "circle", radius: 0.28 },
      query: { mode: "closest", sort: "distance", triggerInteraction: "exclude" }
    }
  },
  {
    id: "plasma-caster",
    simulation: "kinematic",
    networkStrategy: "kinematic-data-buffer",
    name: "Helios Caster",
    designation: "02 / PLASMA",
    projectileName: "contained plasma orb",
    description: "A slow, readable energy projectile with a broad collision envelope.",
    visualKind: "plasma",
    color: "#82f6d3",
    glow: "#20d9c2",
    damage: 44,
    blastRadius: 3.5,
    speed: 42,
    cooldownTicks: 28,
    projectilesPerShot: 1,
    spreadDegrees: 0,
    projectileRadius: 1.05,
    definition: {
      id: "sandbox.projectile.plasma-caster",
      version: "v1",
      collisionMode: "shape-sweep",
      lifetimeTicks: 210,
      sweepShape: { type: "circle", radius: 1.05 },
      query: { mode: "closest", sort: "distance", triggerInteraction: "exclude" }
    }
  },
  {
    id: "rocket-pod",
    simulation: "kinematic",
    networkStrategy: "kinematic-data-buffer",
    name: "Mako Rocket Pod",
    designation: "03 / ORDNANCE",
    projectileName: "unguided micro-rocket",
    description: "Slow ordnance with an obvious smoke trail and an eight-unit blast radius.",
    visualKind: "rocket",
    color: "#ff745c",
    glow: "#ff3d2e",
    damage: 78,
    blastRadius: 8,
    speed: 31,
    cooldownTicks: 62,
    projectilesPerShot: 1,
    spreadDegrees: 0,
    projectileRadius: 0.82,
    definition: {
      id: "sandbox.projectile.rocket-pod",
      version: "v1",
      collisionMode: "shape-sweep",
      lifetimeTicks: 280,
      sweepShape: { type: "circle", radius: 0.82 },
      query: { mode: "closest", sort: "distance", triggerInteraction: "exclude" }
    }
  },
  {
    id: "scattergun",
    simulation: "kinematic",
    networkStrategy: "kinematic-data-buffer",
    name: "Breach Scattergun",
    designation: "04 / SPREAD",
    projectileName: "tungsten pellet cloud",
    description: "Six individually predicted pellets expose correlation and spread behavior.",
    visualKind: "pellet",
    color: "#f6ede0",
    glow: "#ffb35c",
    damage: 13,
    blastRadius: 0,
    speed: 116,
    cooldownTicks: 44,
    projectilesPerShot: 6,
    spreadDegrees: 11,
    projectileRadius: 0,
    definition: {
      id: "sandbox.projectile.scattergun",
      version: "v1",
      collisionMode: "ray-sweep",
      lifetimeTicks: 90,
      query: { mode: "closest", sort: "distance", triggerInteraction: "exclude" }
    }
  },
  {
    id: "gravity-ricochet",
    simulation: "physics-island",
    networkStrategy: "predicted-entity",
    name: "Rook Physics Round",
    designation: "05 / RIGID BODY",
    projectileName: "CCD tungsten ricochet",
    description:
      "A solver-owned round with gravity, restitution, target impulse, and island resimulation.",
    visualKind: "physical",
    color: "#86b9ff",
    glow: "#418dff",
    damage: 52,
    blastRadius: 0,
    speed: 58,
    cooldownTicks: 54,
    projectilesPerShot: 1,
    spreadDegrees: 0,
    projectileRadius: 0.62,
    physics: {
      gravity: 24,
      restitution: 0.62,
      density: 4,
      lifetimeTicks: 240
    }
  }
] as const;

export function getMultiplayerProjectileWeapon(
  id: MultiplayerProjectileWeaponId
): MultiplayerProjectileWeapon {
  const weapon = MULTIPLAYER_PROJECTILE_WEAPONS.find((candidate) => candidate.id === id);
  if (weapon === undefined) {
    throw new Error(`Unknown multiplayer projectile weapon: ${id}`);
  }
  return weapon;
}

export function findMultiplayerProjectileWeaponByDefinition(
  definitionId: string,
  definitionVersion: string
): MultiplayerKinematicProjectileWeapon | undefined {
  return MULTIPLAYER_PROJECTILE_WEAPONS.find(
    (weapon) =>
      weapon.simulation === "kinematic" &&
      weapon.definition.id === definitionId &&
      weapon.definition.version === definitionVersion
  ) as MultiplayerKinematicProjectileWeapon | undefined;
}
