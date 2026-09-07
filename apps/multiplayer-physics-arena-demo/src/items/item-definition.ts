import type { PhysicsVector } from "@gamekits/physics-core";

import type { CompiledArenaStage } from "../content/registry";
import type {
  ArenaItemDefinition,
  ArenaItemKind,
  ArenaItemShapeDefinition
} from "../content/types";

export type ArenaCompiledItemDefinition = {
  id: string;
  kind: ArenaItemKind;
  shape: ArenaItemShapeDefinition;
  mass: number;
  friction: number;
  restitution: number;
  continuousCollisionDetection: boolean;
  maxLinearSpeed: number;
  lifetimeTicks: number;
  maxBounces: number;
  carrySocket: string;
  carrySpeedMultiplier: number;
  carryJumpMultiplier: number;
  dropPolicy: "drop" | "spend";
  actionMode: ArenaItemDefinition["action"]["mode"];
  windupTicks: number;
  maxChargeTicks: number;
  activeTicks: number;
  cooldownTicks: number;
  launchSpeed: number;
  baseImpulse: number;
  areaRadius: number;
  impulseMode: ArenaItemDefinition["effect"]["impulseMode"];
  instabilityDelta: number;
  staggerMultiplier: number;
  respawnMode: ArenaItemDefinition["respawn"]["mode"];
  respawnTicks: number;
  presentationId: string;
  activeState: "released" | "melee-active" | "triggered";
  networkStrategy: "predicted-entity" | "authority-only";
};

export type ArenaCompiledItemSpawn = {
  id: string;
  definitionId: string;
  position: PhysicsVector;
};

export type ArenaStageItemManifest = {
  stageId: string;
  definitions: ArenaCompiledItemDefinition[];
  spawns: ArenaCompiledItemSpawn[];
};

export type ArenaItemCatalog = {
  definitions: ArenaCompiledItemDefinition[];
  manifests: ArenaStageItemManifest[];
};

export function compileArenaItemCatalog(
  stages: readonly Readonly<CompiledArenaStage>[]
): ArenaItemCatalog {
  const manifests = stages.map((stage) => compileArenaStageItemManifest(stage));
  const definitionsById = new Map<string, ArenaCompiledItemDefinition>();
  for (const manifest of manifests) {
    for (const definition of manifest.definitions) {
      const existing = definitionsById.get(definition.id);
      if (
        existing !== undefined &&
        definitionSignature(existing) !== definitionSignature(definition)
      ) {
        throw new Error(`Arena item definition differs between stages: ${definition.id}`);
      }
      definitionsById.set(definition.id, structuredClone(definition));
    }
  }
  return {
    definitions: [...definitionsById.values()].sort((left, right) =>
      left.id.localeCompare(right.id)
    ),
    manifests: structuredClone(manifests)
  };
}

export function compileArenaItemDefinitions(
  definitions: readonly Readonly<ArenaItemDefinition>[],
  options: { maxDefinitions?: number | undefined } = {}
): ArenaCompiledItemDefinition[] {
  const maxDefinitions = positiveInteger(options.maxDefinitions ?? 32, "maxDefinitions");
  if (definitions.length > maxDefinitions) {
    throw new Error(
      `Arena item definitions exceed capacity: ${definitions.length}/${maxDefinitions}`
    );
  }
  if (new Set(definitions.map((definition) => definition.id)).size !== definitions.length) {
    throw new Error("Arena item definitions require unique ids");
  }
  return definitions.map((definition) => compileDefinition(definition));
}

export function compileArenaStageItemManifest(
  stage: Readonly<CompiledArenaStage>,
  options: {
    maxDefinitions?: number | undefined;
    maxSpawns?: number | undefined;
  } = {}
): ArenaStageItemManifest {
  const maxSpawns = positiveInteger(options.maxSpawns ?? 32, "maxSpawns");
  const definitions = compileArenaItemDefinitions(stage.items, options);
  const definitionIds = new Set(definitions.map((definition) => definition.id));
  const itemPoints = stage.spawnSet.points.filter((point) => point.kind === "item");
  if (itemPoints.length > maxSpawns) {
    throw new Error(`Arena item spawns exceed capacity: ${itemPoints.length}/${maxSpawns}`);
  }
  if (new Set(itemPoints.map((point) => point.id)).size !== itemPoints.length) {
    throw new Error(`Arena item spawns require unique ids: ${stage.spawnSet.id}`);
  }
  const spawns = itemPoints.map((point): ArenaCompiledItemSpawn => {
    const definitionId = point.definition?.id;
    if (
      point.definition?.type !== "arena.item" ||
      definitionId === undefined ||
      !definitionIds.has(definitionId) ||
      !validVector(point.position)
    ) {
      throw new Error(`Invalid Arena item spawn: ${stage.spawnSet.id}:${point.id}`);
    }
    return {
      id: point.id,
      definitionId,
      position: cloneVector(point.position)
    };
  });
  return {
    stageId: stage.definition.id,
    definitions,
    spawns
  };
}

function compileDefinition(definition: Readonly<ArenaItemDefinition>): ArenaCompiledItemDefinition {
  if (
    !validId(definition.id) ||
    !validKind(definition.kind) ||
    !validShape(definition.physics.shape) ||
    !positiveFinite(definition.physics.mass) ||
    !inclusiveRatio(definition.physics.friction) ||
    !inclusiveRatio(definition.physics.restitution) ||
    typeof definition.physics.continuousCollisionDetection !== "boolean" ||
    !positiveFinite(definition.physics.maxLinearSpeed) ||
    !positiveIntegerValue(definition.physics.lifetimeTicks) ||
    !nonNegativeInteger(definition.physics.maxBounces) ||
    !validId(definition.carry.socket) ||
    !ratio(definition.carry.speedMultiplier) ||
    !ratio(definition.carry.jumpMultiplier) ||
    (definition.carry.dropPolicy !== "drop" && definition.carry.dropPolicy !== "spend") ||
    !validAction(definition) ||
    !validEffect(definition) ||
    !validRespawn(definition) ||
    !validId(definition.presentationId) ||
    (definition.networkStrategy !== "predicted-entity" &&
      definition.networkStrategy !== "authority-only")
  ) {
    throw new Error(`Invalid Arena item definition: ${definition.id}`);
  }
  return {
    id: definition.id,
    kind: definition.kind,
    shape: structuredClone(definition.physics.shape),
    mass: definition.physics.mass,
    friction: definition.physics.friction,
    restitution: definition.physics.restitution,
    continuousCollisionDetection: definition.physics.continuousCollisionDetection,
    maxLinearSpeed: definition.physics.maxLinearSpeed,
    lifetimeTicks: definition.physics.lifetimeTicks,
    maxBounces: definition.physics.maxBounces,
    carrySocket: definition.carry.socket,
    carrySpeedMultiplier: definition.carry.speedMultiplier,
    carryJumpMultiplier: definition.carry.jumpMultiplier,
    dropPolicy: definition.carry.dropPolicy,
    actionMode: definition.action.mode,
    windupTicks: definition.action.windupTicks,
    maxChargeTicks: definition.action.maxChargeTicks,
    activeTicks: definition.action.activeTicks,
    cooldownTicks: definition.action.cooldownTicks,
    launchSpeed: definition.action.launchSpeed,
    baseImpulse: definition.action.baseImpulse,
    areaRadius: definition.action.areaRadius,
    impulseMode: definition.effect.impulseMode,
    instabilityDelta: definition.effect.instabilityDelta,
    staggerMultiplier: definition.effect.staggerMultiplier,
    respawnMode: definition.respawn.mode,
    respawnTicks: definition.respawn.ticks,
    presentationId: definition.presentationId,
    activeState:
      definition.action.mode === "melee"
        ? "melee-active"
        : definition.action.mode === "throw-area"
          ? "triggered"
          : "released",
    networkStrategy: definition.networkStrategy
  };
}

function definitionSignature(definition: ArenaCompiledItemDefinition): string {
  return JSON.stringify(definition);
}

function validShape(shape: ArenaItemShapeDefinition): boolean {
  return shape.type === "sphere"
    ? positiveFinite(shape.radius)
    : positiveFinite(shape.width) && positiveFinite(shape.height) && positiveFinite(shape.depth);
}

function validAction(definition: Readonly<ArenaItemDefinition>): boolean {
  const action = definition.action;
  const expectedMode =
    definition.kind === "melee"
      ? "melee"
      : definition.kind === "area"
        ? "throw-area"
        : "throw-contact";
  return (
    action.mode === expectedMode &&
    nonNegativeInteger(action.windupTicks) &&
    nonNegativeInteger(action.maxChargeTicks) &&
    positiveIntegerValue(action.activeTicks) &&
    nonNegativeInteger(action.cooldownTicks) &&
    Number.isFinite(action.launchSpeed) &&
    action.launchSpeed >= 0 &&
    positiveFinite(action.baseImpulse) &&
    Number.isFinite(action.areaRadius) &&
    action.areaRadius >= 0 &&
    (action.mode === "melee"
      ? action.launchSpeed === 0 && action.areaRadius > 0
      : action.launchSpeed > 0) &&
    (action.mode !== "throw-area" || action.areaRadius > 0)
  );
}

function validEffect(definition: Readonly<ArenaItemDefinition>): boolean {
  const effect = definition.effect;
  return (
    (effect.impulseMode === "directional" ||
      effect.impulseMode === "radial" ||
      effect.impulseMode === "pull" ||
      effect.impulseMode === "launch") &&
    inclusiveRatio(effect.instabilityDelta) &&
    positiveFinite(effect.staggerMultiplier) &&
    (effect.impulseMode === "radial" || effect.impulseMode === "pull"
      ? definition.action.mode === "throw-area"
      : true) &&
    (effect.impulseMode === "launch" ? definition.action.mode === "melee" : true)
  );
}

function validRespawn(definition: Readonly<ArenaItemDefinition>): boolean {
  return (
    nonNegativeInteger(definition.respawn.ticks) &&
    ((definition.respawn.mode === "none" && definition.respawn.ticks === 0) ||
      (definition.respawn.mode === "timed" && definition.respawn.ticks > 0))
  );
}

function validKind(value: string): value is ArenaItemKind {
  return value === "throwable" || value === "impact" || value === "area" || value === "melee";
}

function validVector(value: PhysicsVector): boolean {
  return [value.x, value.y, value.z ?? 0].every(
    (component) => typeof component === "number" && Number.isFinite(component)
  );
}

function cloneVector(value: PhysicsVector): PhysicsVector {
  return { x: value.x, y: value.y, ...(value.z === undefined ? {} : { z: value.z }) };
}

function validId(value: string): boolean {
  return value.length > 0 && value.length <= 128;
}

function positiveFinite(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

function ratio(value: number): boolean {
  return Number.isFinite(value) && value > 0 && value <= 1;
}

function inclusiveRatio(value: number): boolean {
  return Number.isFinite(value) && value >= 0 && value <= 1;
}

function nonNegativeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

function positiveIntegerValue(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

function positiveInteger(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`Arena item compiler ${field} must be a positive integer`);
  }
  return value;
}
