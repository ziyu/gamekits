import {
  createCombatDataTypes,
  type CombatDeliveryDefinition,
  type CombatProjectileDefinition
} from "@gamekits/combat";
import { createDataRegistry, type DataPack, type DataRegistry } from "@gamekits/data";
import { createGasDataTypes } from "@gamekits/gas";
import { createPhysicsDataTypes } from "@gamekits/physics-core";

export const COMBAT_RANGE_IDS = {
  operatorActor: "range.actor.operator",
  allyActor: "range.actor.ally",
  targetActor: "range.actor.target",
  damageEffect: "range.effect.impact",
  healEffect: "range.effect.repair",
  impactCue: "range.cue.impact",
  repairCue: "range.cue.repair",
  meleeCue: "range.cue.melee",
  hitscanCue: "range.cue.hitscan",
  areaCue: "range.cue.area",
  projectileCue: "range.cue.projectile",
  coverCue: "range.cue.cover",
  healCue: "range.cue.heal",
  meleeAbility: "range.ability.melee",
  hitscanAbility: "range.ability.hitscan",
  areaAbility: "range.ability.area",
  projectileAbility: "range.ability.projectile",
  coverAbility: "range.ability.cover",
  healAbility: "range.ability.heal",
  hostilePolicy: "range.policy.hostile",
  supportPolicy: "range.policy.support",
  projectile: "range.projectile.arc-bolt",
  meleeDelivery: "range.delivery.melee",
  hitscanDelivery: "range.delivery.hitscan",
  areaDelivery: "range.delivery.area",
  projectileDelivery: "range.delivery.projectile",
  coverDelivery: "range.delivery.cover",
  healDelivery: "range.delivery.heal"
} as const;

const COMBAT_RANGE_ABILITIES = [
  COMBAT_RANGE_IDS.meleeAbility,
  COMBAT_RANGE_IDS.hitscanAbility,
  COMBAT_RANGE_IDS.areaAbility,
  COMBAT_RANGE_IDS.projectileAbility,
  COMBAT_RANGE_IDS.coverAbility,
  COMBAT_RANGE_IDS.healAbility
];

export const combatRangeDataPack: DataPack = {
  id: "sandbox.combat-range",
  version: "1.0.0",
  namespace: "sandbox.combat-range",
  entries: [
    {
      type: "gas.attribute",
      id: "health",
      data: { id: "health", name: "Integrity", min: 0, max: 100, defaultValue: 100 }
    },
    { type: "gas.tag", id: "team.cyan", data: { id: "team.cyan", name: "Cyan Team" } },
    { type: "gas.tag", id: "team.amber", data: { id: "team.amber", name: "Amber Team" } },
    {
      type: "gas.actor",
      id: COMBAT_RANGE_IDS.operatorActor,
      data: {
        id: COMBAT_RANGE_IDS.operatorActor,
        name: "Range Operator",
        attributes: { health: 100 },
        tags: ["team.cyan"],
        abilities: COMBAT_RANGE_ABILITIES
      }
    },
    {
      type: "gas.actor",
      id: COMBAT_RANGE_IDS.allyActor,
      data: {
        id: COMBAT_RANGE_IDS.allyActor,
        name: "Support Drone",
        attributes: { health: 100 },
        tags: ["team.cyan"]
      }
    },
    {
      type: "gas.actor",
      id: COMBAT_RANGE_IDS.targetActor,
      data: {
        id: COMBAT_RANGE_IDS.targetActor,
        name: "Target Drone",
        attributes: { health: 100 },
        tags: ["team.amber"]
      }
    },
    {
      type: "gas.effect",
      id: COMBAT_RANGE_IDS.damageEffect,
      data: {
        id: COMBAT_RANGE_IDS.damageEffect,
        name: "Kinetic Impact",
        attributeModifiers: [{ attribute: "health", operation: "add", value: -18 }],
        cues: [COMBAT_RANGE_IDS.impactCue]
      }
    },
    {
      type: "gas.effect",
      id: COMBAT_RANGE_IDS.healEffect,
      data: {
        id: COMBAT_RANGE_IDS.healEffect,
        name: "Field Repair",
        attributeModifiers: [{ attribute: "health", operation: "add", value: 16 }],
        cues: [COMBAT_RANGE_IDS.repairCue]
      }
    },
    cue(COMBAT_RANGE_IDS.impactCue, "combat.impact.damage"),
    cue(COMBAT_RANGE_IDS.repairCue, "combat.impact.repair"),
    cue(COMBAT_RANGE_IDS.meleeCue, "combat.attack.melee"),
    cue(COMBAT_RANGE_IDS.hitscanCue, "combat.attack.hitscan"),
    cue(COMBAT_RANGE_IDS.areaCue, "combat.attack.area"),
    cue(COMBAT_RANGE_IDS.projectileCue, "combat.attack.projectile"),
    cue(COMBAT_RANGE_IDS.coverCue, "combat.attack.cover"),
    cue(COMBAT_RANGE_IDS.healCue, "combat.attack.heal"),
    ability(COMBAT_RANGE_IDS.meleeAbility, "Melee Sweep", COMBAT_RANGE_IDS.meleeCue),
    ability(COMBAT_RANGE_IDS.hitscanAbility, "Pulse Shot", COMBAT_RANGE_IDS.hitscanCue),
    ability(COMBAT_RANGE_IDS.areaAbility, "Shock Ring", COMBAT_RANGE_IDS.areaCue),
    ability(COMBAT_RANGE_IDS.projectileAbility, "Arc Bolt", COMBAT_RANGE_IDS.projectileCue),
    ability(COMBAT_RANGE_IDS.coverAbility, "Cover Test", COMBAT_RANGE_IDS.coverCue),
    ability(COMBAT_RANGE_IDS.healAbility, "Field Repair", COMBAT_RANGE_IDS.healCue),
    {
      type: "physics.collider",
      id: "range.collider.projectile",
      data: {
        id: "range.collider.projectile",
        shape: { type: "circle", radius: 0.12 },
        sensor: true,
        filter: { groups: ["projectile"], collidesWith: ["actor", "cover"] }
      }
    },
    {
      type: "physics.body",
      id: "range.body.projectile",
      data: {
        id: "range.body.projectile",
        kind: "dynamic",
        gravityScale: 0,
        lockedAxes: ["rotation"],
        colliders: [{ type: "physics.collider", id: "range.collider.projectile" }]
      }
    },
    {
      type: "combat.relationship-policy",
      id: COMBAT_RANGE_IDS.hostilePolicy,
      data: { id: COMBAT_RANGE_IDS.hostilePolicy, tags: ["hostile-only"] }
    },
    {
      type: "combat.relationship-policy",
      id: COMBAT_RANGE_IDS.supportPolicy,
      data: { id: COMBAT_RANGE_IDS.supportPolicy, tags: ["ally-only"] }
    },
    delivery(COMBAT_RANGE_IDS.meleeDelivery, {
      type: "melee",
      shape: { type: "circle", radius: 1.2 },
      offset: { x: 1.05, y: 0 },
      selection: { mode: "closest", maxTargets: 1 }
    }),
    delivery(COMBAT_RANGE_IDS.hitscanDelivery, {
      type: "hitscan",
      range: 12,
      direction: { x: 1, y: 0 },
      selection: { mode: "closest", maxTargets: 1, stopOnBlocker: true }
    }),
    delivery(COMBAT_RANGE_IDS.areaDelivery, {
      type: "area",
      shape: { type: "circle", radius: 1.45 },
      position: { x: 1.2, y: 1.5 },
      selection: { mode: "all", maxTargets: 4 }
    }),
    {
      type: "combat.delivery",
      id: COMBAT_RANGE_IDS.projectileDelivery,
      data: {
        id: COMBAT_RANGE_IDS.projectileDelivery,
        delivery: {
          type: "projectile",
          projectile: { type: "combat.projectile", id: COMBAT_RANGE_IDS.projectile },
          position: { x: -5.2, y: 1.2 },
          direction: { x: 1, y: 0 }
        },
        payloads: [],
        relationshipPolicy: COMBAT_RANGE_IDS.hostilePolicy
      } satisfies CombatDeliveryDefinition
    },
    delivery(COMBAT_RANGE_IDS.coverDelivery, {
      type: "hitscan",
      range: 12,
      origin: { x: -5.2, y: -1.6 },
      direction: { x: 1, y: 0 },
      selection: { mode: "all", maxTargets: 4, stopOnBlocker: true }
    }),
    {
      type: "combat.delivery",
      id: COMBAT_RANGE_IDS.healDelivery,
      data: {
        id: COMBAT_RANGE_IDS.healDelivery,
        delivery: { type: "direct" },
        payloads: [{ effectId: COMBAT_RANGE_IDS.healEffect, target: "hit-actor" }],
        relationshipPolicy: COMBAT_RANGE_IDS.supportPolicy
      } satisfies CombatDeliveryDefinition
    },
    {
      type: "combat.projectile",
      id: COMBAT_RANGE_IDS.projectile,
      data: {
        id: COMBAT_RANGE_IDS.projectile,
        body: { type: "physics.body", id: "range.body.projectile" },
        lifetimeMs: 2400,
        speed: 7.5,
        collisionMode: "ray-sweep",
        hitPolicy: "stop",
        maxHits: 1,
        query: { triggerInteraction: "include" },
        payloads: [{ effectId: COMBAT_RANGE_IDS.damageEffect, target: "hit-actor" }]
      } satisfies CombatProjectileDefinition
    },
    abilityDelivery(
      "range.binding.melee",
      COMBAT_RANGE_IDS.meleeAbility,
      COMBAT_RANGE_IDS.meleeDelivery
    ),
    abilityDelivery(
      "range.binding.hitscan",
      COMBAT_RANGE_IDS.hitscanAbility,
      COMBAT_RANGE_IDS.hitscanDelivery
    ),
    abilityDelivery(
      "range.binding.area",
      COMBAT_RANGE_IDS.areaAbility,
      COMBAT_RANGE_IDS.areaDelivery
    ),
    abilityDelivery(
      "range.binding.projectile",
      COMBAT_RANGE_IDS.projectileAbility,
      COMBAT_RANGE_IDS.projectileDelivery
    ),
    abilityDelivery(
      "range.binding.cover",
      COMBAT_RANGE_IDS.coverAbility,
      COMBAT_RANGE_IDS.coverDelivery
    ),
    abilityDelivery(
      "range.binding.heal",
      COMBAT_RANGE_IDS.healAbility,
      COMBAT_RANGE_IDS.healDelivery
    )
  ]
};

export function createCombatRangeDataRegistry(): DataRegistry {
  const registry = createDataRegistry();
  for (const type of [
    ...createGasDataTypes(),
    ...createPhysicsDataTypes(),
    ...createCombatDataTypes()
  ]) {
    registry.registerType(type);
  }
  const result = registry.registerPack(combatRangeDataPack);
  const errors = result.diagnostics.filter((diagnostic) => diagnostic.severity === "error");
  if (errors.length > 0) {
    throw new Error(`Combat range data is invalid: ${JSON.stringify(errors)}`);
  }
  return registry;
}

function delivery(
  id: string,
  spec: Exclude<CombatDeliveryDefinition["delivery"], { type: "direct" | "projectile" }>
): DataPack["entries"][number] {
  return {
    type: "combat.delivery",
    id,
    data: {
      id,
      delivery: spec,
      payloads: [{ effectId: COMBAT_RANGE_IDS.damageEffect, target: "hit-actor" }],
      relationshipPolicy: COMBAT_RANGE_IDS.hostilePolicy
    } satisfies CombatDeliveryDefinition
  };
}

function cue(id: string, type: string): DataPack["entries"][number] {
  return {
    type: "gas.cue",
    id,
    data: { id, type }
  };
}

function ability(id: string, name: string, committedCue: string): DataPack["entries"][number] {
  return {
    type: "gas.ability",
    id,
    data: {
      id,
      name,
      execution: {
        preparingMs: 0,
        activeMs: 0,
        recoveringMs: 120,
        phaseCues: { committed: [committedCue] }
      }
    }
  };
}

function abilityDelivery(
  id: string,
  abilityId: string,
  deliveryId: string
): DataPack["entries"][number] {
  return {
    type: "combat.ability-delivery",
    id,
    data: {
      id,
      ability: { type: "gas.ability", id: abilityId },
      delivery: { type: "combat.delivery", id: deliveryId }
    }
  };
}
