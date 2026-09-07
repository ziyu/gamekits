import type { AssetDefinition } from "@gamekits/asset";
import type { DataPack, DataPackEntry, DataRef } from "@gamekits/data";
import type {
  GasAbilityDefinition,
  GasActorDefinition,
  GasAttributeDefinition,
  GasEffectDefinition
} from "@gamekits/gas";
import type {
  PhysicsBodyData,
  PhysicsColliderData,
  PhysicsMaterialDefinition
} from "@gamekits/physics-core";
import type { TcaRule } from "@gamekits/tca";
import { outpostRuntimeImageAssets, type OutpostRuntimeImageAsset } from "./runtime-image-assets";
import {
  OUTPOST_FEEDBACK_ASSET_IDS,
  outpostFeedbackAssetDefinitions
} from "./runtime-feedback-assets";
import { OUTPOST_ARENA_SOLID_COLLIDER_ID, outpostArenaDefinition } from "./arena-scene";
import {
  outpostFoundationDataEntries,
  outpostGeneratedAudioAssets,
  outpostSpriteAnimations
} from "./foundation-definitions";
import {
  OUTPOST_ARENA_STATIC_BODY_ID,
  outpostArenaPhysicsLayout,
  outpostArenaPhysicsScene
} from "./arena-physics";
import {
  OUTPOST_ARENA_TYPE,
  OUTPOST_BUILDABLE_TYPE,
  OUTPOST_ENEMY_TYPE,
  OUTPOST_MOVEMENT_PROFILE_TYPE,
  OUTPOST_OBJECTIVE_TYPE,
  OUTPOST_PLAYER_TYPE,
  OUTPOST_RENDER_OBJECT_TYPE,
  OUTPOST_WAVE_TYPE,
  OUTPOST_WEAPON_TYPE,
  type OutpostBuildableDefinition,
  type OutpostArenaDefinition,
  type OutpostEnemyDefinition,
  type OutpostMovementProfileDefinition,
  type OutpostObjectiveDefinition,
  type OutpostPlayerDefinition,
  type OutpostRenderObjectDefinition,
  type OutpostWaveDefinition,
  type OutpostWeaponDefinition
} from "../domain";

export const OUTPOST_PLAYER_STAMINA_MAX = 100;
export const OUTPOST_DASH_STAMINA_COST = 25;

const assets: AssetDefinition[] = [
  ...outpostRuntimeImageAssets.map(imageAsset),
  ...outpostFeedbackAssetDefinitions,
  ...outpostGeneratedAudioAssets
];

const attributes: GasAttributeDefinition[] = [
  { id: "health", min: 0, max: 1000, defaultValue: 100 },
  { id: "shield", min: 0, max: 1000, defaultValue: 50 },
  {
    id: "stamina",
    min: 0,
    max: OUTPOST_PLAYER_STAMINA_MAX,
    defaultValue: OUTPOST_PLAYER_STAMINA_MAX
  },
  { id: "shared-resource", min: 0, max: 9999, defaultValue: 100 }
];

const effects: GasEffectDefinition[] = [
  {
    id: "effect.outpost.shocked",
    durationMs: 3000,
    periodMs: 1000,
    periodicModifiers: [{ attribute: "health", operation: "add", value: -3 }],
    grantedTags: ["status.shocked"],
    stacking: { limit: 1, overflow: "refresh-oldest" }
  },
  {
    id: "effect.outpost.combat_recovery",
    attributeModifiers: [{ attribute: "health", operation: "add", value: 4 }]
  },
  {
    id: "effect.outpost.combat_hit",
    cues: ["cue.outpost.combat.hit"]
  }
];

const abilities: GasAbilityDefinition[] = [
  {
    id: "ability.outpost.rifle_fire",
    execution: {
      preparingMs: 35,
      activeMs: 45,
      recoveringMs: 40,
      phaseCues: {
        preparing: ["cue.outpost.rifle.telegraph"],
        committed: ["cue.outpost.rifle.commit"]
      }
    }
  },
  {
    id: "ability.outpost.rifle_reload",
    execution: {
      preparingMs: 800,
      activeMs: 100,
      recoveringMs: 450,
      cancellation: {
        beforeCommit: "allow",
        afterCommit: "deny"
      }
    }
  },
  {
    id: "ability.outpost.dash",
    cooldownMs: 1500,
    costs: [{ attribute: "stamina", amount: OUTPOST_DASH_STAMINA_COST }]
  },
  {
    id: "ability.outpost.shock_field",
    cooldownMs: 6000,
    execution: {
      preparingMs: 260,
      activeMs: 160,
      recoveringMs: 260,
      phaseCues: {
        preparing: ["cue.outpost.shock.telegraph"],
        committed: ["cue.outpost.shock.commit"]
      }
    }
  },
  {
    id: "ability.outpost.deploy_turret",
    cooldownMs: 500,
    costs: [{ attribute: "shared-resource", amount: 25 }]
  },
  {
    id: "ability.outpost.enemy_attack",
    cooldownMs: 900,
    execution: {
      preparingMs: 450,
      activeMs: 120,
      recoveringMs: 330,
      phaseCues: {
        preparing: ["cue.outpost.enemy.telegraph"],
        committed: ["cue.outpost.enemy.commit"]
      }
    }
  }
];

const cues = [
  cue("cue.outpost.combat.hit", "outpost.combat.hit"),
  cue("cue.outpost.rifle.telegraph", "outpost.rifle.telegraph"),
  cue("cue.outpost.rifle.commit", "outpost.rifle.commit"),
  cue("cue.outpost.shock.telegraph", "outpost.shock.telegraph"),
  cue("cue.outpost.shock.commit", "outpost.shock.commit"),
  cue("cue.outpost.enemy.telegraph", "outpost.enemy.telegraph"),
  cue("cue.outpost.enemy.commit", "outpost.enemy.commit")
];

const actors: GasActorDefinition[] = [
  {
    id: "actor.outpost.player",
    attributes: {
      health: 100,
      shield: 50,
      stamina: OUTPOST_PLAYER_STAMINA_MAX,
      "shared-resource": 100
    },
    abilities: [
      "ability.outpost.rifle_fire",
      "ability.outpost.rifle_reload",
      "ability.outpost.dash",
      "ability.outpost.shock_field",
      "ability.outpost.deploy_turret"
    ],
    tags: ["team.players"]
  },
  {
    id: "actor.outpost.raider",
    attributes: { health: 45, shield: 0 },
    abilities: ["ability.outpost.enemy_attack"],
    tags: ["team.enemies", "enemy.melee"]
  },
  {
    id: "actor.outpost.overseer",
    attributes: { health: 600, shield: 200 },
    abilities: ["ability.outpost.enemy_attack", "ability.outpost.shock_field"],
    tags: ["team.enemies", "enemy.boss"]
  },
  {
    id: "actor.outpost.turret",
    attributes: { health: 120, shield: 0 },
    abilities: ["ability.outpost.rifle_fire"],
    tags: ["team.players", "buildable.turret"]
  }
];

const materials: PhysicsMaterialDefinition[] = [
  { id: "material.outpost.actor", friction: 0.1, restitution: 0 },
  { id: "material.outpost.projectile", friction: 0, restitution: 0 },
  { id: "material.outpost.arena", friction: 0.35, restitution: 0 }
];

const colliders: Array<{ id: string; data: PhysicsColliderData }> = [
  circleCollider("collider.outpost.player", 14, "material.outpost.actor", false, 0x0002, 0x0035),
  circleCollider("collider.outpost.raider", 13, "material.outpost.actor", false, 0x0004, 0x002b),
  circleCollider("collider.outpost.overseer", 32, "material.outpost.actor", false, 0x0004, 0x002b),
  circleCollider("collider.outpost.turret", 18, "material.outpost.actor", false, 0x0020, 0x0015),
  circleCollider(
    "collider.outpost.projectile",
    4,
    "material.outpost.projectile",
    true,
    0x0008,
    0x0005
  ),
  {
    id: OUTPOST_ARENA_SOLID_COLLIDER_ID,
    data: {
      id: OUTPOST_ARENA_SOLID_COLLIDER_ID,
      shape: { type: "box", width: 1, height: 1 },
      material: "material.outpost.arena",
      filter: { categoryBits: 0x0001, maskBits: 0xffff },
      tags: ["outpost", "arena", "solid"]
    }
  }
];

const bodies: Array<{ id: string; data: PhysicsBodyData }> = [
  dynamicBody("body.outpost.player", "collider.outpost.player"),
  dynamicBody("body.outpost.raider", "collider.outpost.raider"),
  dynamicBody("body.outpost.overseer", "collider.outpost.overseer"),
  staticBody("body.outpost.turret", "collider.outpost.turret"),
  dynamicBody("body.outpost.projectile", "collider.outpost.projectile", 0, 0),
  {
    id: OUTPOST_ARENA_STATIC_BODY_ID,
    data: {
      id: OUTPOST_ARENA_STATIC_BODY_ID,
      kind: "static",
      tags: ["outpost", "arena"]
    }
  }
];

const physicsScenes = [outpostArenaPhysicsScene];
const physicsLayouts = [outpostArenaPhysicsLayout];
const arenas: OutpostArenaDefinition[] = [outpostArenaDefinition];
const UP_AUTHORED_FACING_OFFSET_RADIANS = Math.PI / 2;

const renderObjects: OutpostRenderObjectDefinition[] = [
  renderObject("render.outpost.arena", "asset.outpost.arena", "arena"),
  renderObject("render.outpost.wall", "asset.outpost.wall", "architecture"),
  renderObject("render.outpost.barricade", "asset.outpost.barricade", "architecture"),
  renderObject("render.outpost.cover", "asset.outpost.cover", "architecture"),
  renderObject("render.outpost.pylon", "asset.outpost.pylon", "architecture"),
  renderObject(
    "render.outpost.player",
    "asset.outpost.player",
    "actors",
    UP_AUTHORED_FACING_OFFSET_RADIANS
  ),
  renderObject("render.outpost.raider", "asset.outpost.raider", "actors"),
  renderObject("render.outpost.overseer", "asset.outpost.overseer", "actors"),
  renderObject("render.outpost.turret", "asset.outpost.turret", "buildables"),
  renderObject(
    "render.outpost.projectile",
    "asset.outpost.projectile",
    "projectiles",
    UP_AUTHORED_FACING_OFFSET_RADIANS
  ),
  renderObject("render.outpost.feedback.crosshair", OUTPOST_FEEDBACK_ASSET_IDS.crosshair, "ui"),
  renderObject("render.outpost.feedback.tracer", OUTPOST_FEEDBACK_ASSET_IDS.tracer, "effects"),
  renderObject("render.outpost.feedback.impact", OUTPOST_FEEDBACK_ASSET_IDS.impact, "effects"),
  renderObject(
    "render.outpost.feedback.damage-direction",
    OUTPOST_FEEDBACK_ASSET_IDS.damageDirection,
    "ui"
  )
];

const weapons: OutpostWeaponDefinition[] = [
  {
    id: "weapon.outpost.rifle",
    ability: ref("gas.ability", "ability.outpost.rifle_fire"),
    reloadAbility: ref("gas.ability", "ability.outpost.rifle_reload"),
    projectileBody: ref("physics.body", "body.outpost.projectile"),
    projectileRenderObject: ref(OUTPOST_RENDER_OBJECT_TYPE, "render.outpost.projectile"),
    fireIntervalMs: 120,
    magazineSize: 24,
    reserveAmmo: 144,
    reloadDurationMs: 1350,
    damage: 12,
    projectileSpeed: 760,
    projectileLifetimeMs: 1200
  }
];

const movementProfiles: OutpostMovementProfileDefinition[] = [
  {
    id: "movement.outpost.ranger",
    maxSpeed: 220,
    acceleration: 2_100,
    deceleration: 2_800,
    staminaRecoveryPerSecond: 12,
    dashSpeed: 640,
    dashDurationMs: 180,
    dashCollisionVelocityRatio: 0.45,
    cameraLookaheadDistance: 48,
    cameraLookaheadResponse: 8,
    cameraDashImpulse: 22
  }
];

const players: OutpostPlayerDefinition[] = [
  {
    id: "player.outpost.ranger",
    actor: ref("gas.actor", "actor.outpost.player"),
    weapon: ref(OUTPOST_WEAPON_TYPE, "weapon.outpost.rifle"),
    physicsBody: ref("physics.body", "body.outpost.player"),
    renderObject: ref(OUTPOST_RENDER_OBJECT_TYPE, "render.outpost.player"),
    movementProfile: ref(OUTPOST_MOVEMENT_PROFILE_TYPE, "movement.outpost.ranger")
  }
];

const enemies: OutpostEnemyDefinition[] = [
  {
    id: "enemy.outpost.raider",
    role: "melee",
    actor: ref("gas.actor", "actor.outpost.raider"),
    attackAbility: ref("gas.ability", "ability.outpost.enemy_attack"),
    physicsBody: ref("physics.body", "body.outpost.raider"),
    renderObject: ref(OUTPOST_RENDER_OBJECT_TYPE, "render.outpost.raider"),
    aiAgent: ref("ai.agent", "ai.outpost.agent.raider"),
    moveSpeed: 105,
    attackRange: 38,
    attackDamage: 8
  },
  {
    id: "enemy.outpost.overseer",
    role: "boss",
    actor: ref("gas.actor", "actor.outpost.overseer"),
    attackAbility: ref("gas.ability", "ability.outpost.enemy_attack"),
    physicsBody: ref("physics.body", "body.outpost.overseer"),
    renderObject: ref(OUTPOST_RENDER_OBJECT_TYPE, "render.outpost.overseer"),
    aiAgent: ref("ai.agent", "ai.outpost.agent.overseer"),
    moveSpeed: 72,
    attackRange: 58,
    attackDamage: 18
  }
];

const buildables: OutpostBuildableDefinition[] = [
  {
    id: "buildable.outpost.turret",
    actor: ref("gas.actor", "actor.outpost.turret"),
    deployAbility: ref("gas.ability", "ability.outpost.deploy_turret"),
    physicsBody: ref("physics.body", "body.outpost.turret"),
    renderObject: ref(OUTPOST_RENDER_OBJECT_TYPE, "render.outpost.turret"),
    resourceCost: 25,
    placementRange: 240
  }
];

const objectives: OutpostObjectiveDefinition[] = [
  { id: "objective.outpost.defend", kind: "defend", durationMs: 60_000 },
  { id: "objective.outpost.extract", kind: "extract", durationMs: 30_000 }
];

const waves: OutpostWaveDefinition[] = [
  {
    id: "wave.outpost.opening",
    index: 0,
    objective: ref(OUTPOST_OBJECTIVE_TYPE, "objective.outpost.defend"),
    spawns: [{ enemy: ref(OUTPOST_ENEMY_TYPE, "enemy.outpost.raider"), count: 12 }]
  },
  {
    id: "wave.outpost.overseer",
    index: 1,
    objective: ref(OUTPOST_OBJECTIVE_TYPE, "objective.outpost.extract"),
    spawns: [{ enemy: ref(OUTPOST_ENEMY_TYPE, "enemy.outpost.raider"), count: 20 }],
    boss: ref(OUTPOST_ENEMY_TYPE, "enemy.outpost.overseer")
  }
];

const rules: TcaRule[] = [
  {
    id: "rule.outpost.shield_broken",
    trigger: { type: "event.type", args: { eventType: "gas.attribute_changed" } },
    conditions: [
      {
        type: "outpost.attribute.transition",
        args: { attribute: "shield", to: 0, previousAbove: 0 }
      }
    ],
    actions: [{ type: "outpost.combat.emit_fact", args: { eventType: "outpost.shield_broken" } }],
    tags: ["outpost", "combat"]
  },
  {
    id: "rule.outpost.actor_killed",
    trigger: { type: "event.type", args: { eventType: "gas.attribute_changed" } },
    conditions: [
      {
        type: "outpost.attribute.transition",
        args: { attribute: "health", to: 0, previousAbove: 0 }
      }
    ],
    actions: [{ type: "outpost.combat.emit_fact", args: { eventType: "outpost.actor_killed" } }],
    tags: ["outpost", "combat"]
  },
  {
    id: "rule.outpost.enemy_killed",
    trigger: { type: "event.type", args: { eventType: "outpost.actor_killed" } },
    conditions: [{ type: "outpost.actor.kind", args: { kind: "enemy" } }],
    actions: [
      { type: "outpost.combat.grant_kill_rewards", args: { resource: 10 } },
      { type: "outpost.combat.emit_fact", args: { eventType: "outpost.drop.created" } },
      {
        type: "outpost.combat.emit_fact",
        args: { eventType: "outpost.objective.progressed" }
      }
    ],
    tags: ["outpost", "objective"]
  },
  {
    id: "rule.outpost.overseer_phase_two",
    trigger: { type: "event.type", args: { eventType: "gas.attribute_changed" } },
    conditions: [
      {
        type: "outpost.actor.definition",
        args: { definitionId: "actor.outpost.overseer" }
      },
      {
        type: "outpost.attribute.threshold_crossed",
        args: { attribute: "health", belowOrEqual: 300 }
      }
    ],
    actions: [
      { type: "outpost.combat.add_tag", args: { tag: "boss.phase.two" } },
      { type: "outpost.combat.emit_fact", args: { eventType: "outpost.boss.phase_changed" } }
    ],
    tags: ["outpost", "combat", "boss"]
  }
];

export const outpostContentPack: DataPack = {
  id: "outpost-siege.core",
  version: "1.0.0",
  namespace: "outpost",
  metadata: { game: "outpost-siege", role: "core-content" },
  entries: [
    ...entries("asset.definition", assets),
    ...entries("gas.attribute", attributes),
    ...entries("gas.effect", effects),
    ...entries("gas.cue", cues),
    ...entries("gas.ability", abilities),
    ...entries("gas.actor", actors),
    ...entries("physics.material", materials),
    ...colliders.map(({ id, data }) => entry("physics.collider", id, data)),
    ...bodies.map(({ id, data }) => entry("physics.body", id, data)),
    ...entries("physics.scene", physicsScenes),
    ...entries("physics.layout", physicsLayouts),
    ...entries(OUTPOST_RENDER_OBJECT_TYPE, renderObjects),
    ...entries(OUTPOST_ARENA_TYPE, arenas),
    ...entries(OUTPOST_WEAPON_TYPE, weapons),
    ...entries(OUTPOST_MOVEMENT_PROFILE_TYPE, movementProfiles),
    ...entries(OUTPOST_PLAYER_TYPE, players),
    ...entries(OUTPOST_ENEMY_TYPE, enemies),
    ...entries(OUTPOST_BUILDABLE_TYPE, buildables),
    ...entries(OUTPOST_OBJECTIVE_TYPE, objectives),
    ...entries(OUTPOST_WAVE_TYPE, waves),
    ...entries("tca.rule", rules),
    ...outpostFoundationDataEntries
  ]
};

function entries<TData extends { id: string }>(type: string, values: TData[]): DataPackEntry[] {
  return values.map((data) => entry(type, data.id, data));
}

function entry<TData>(type: string, id: string, data: TData): DataPackEntry<TData> {
  return { type, id, data };
}

function ref<TType extends string>(type: TType, id: string): DataRef<TType> {
  return { type, id };
}

function imageAsset(asset: OutpostRuntimeImageAsset): AssetDefinition {
  const animations = outpostSpriteAnimations(asset.id);
  return {
    id: asset.id,
    type: animations.length === 0 ? "image" : "spritesheet",
    source: { type: "url", url: asset.runtimeUrl },
    group: asset.group,
    preload: asset.preload,
    lazy: asset.lazy ?? false,
    ...(animations.length === 0
      ? {}
      : {
          frame: { width: asset.width, height: asset.height },
          animations
        }),
    tags: ["outpost", asset.group],
    metadata: {
      authoringSource: asset.authoringSource,
      ...(asset.referenceSource === undefined ? {} : { referenceSource: asset.referenceSource }),
      runtimeFormat: asset.runtimeFormat,
      width: asset.width,
      height: asset.height,
      ...(asset.spriteSheet === undefined
        ? {}
        : {
            sourceColumns: asset.spriteSheet.sourceColumns,
            sourceRows: asset.spriteSheet.sourceRows,
            runtimeFrameCount: asset.spriteSheet.frames.length
          })
    }
  };
}

function cue(id: string, type: string) {
  return { id, type, tags: ["outpost", "presentation"] };
}

function circleCollider(
  id: string,
  radius: number,
  material: string,
  sensor = false,
  categoryBits?: number,
  maskBits?: number
): { id: string; data: PhysicsColliderData } {
  return {
    id,
    data: {
      id,
      shape: { type: "circle", radius },
      material,
      sensor,
      ...(categoryBits === undefined || maskBits === undefined
        ? {}
        : { filter: { categoryBits, maskBits } }),
      tags: ["outpost"]
    }
  };
}

function dynamicBody(
  id: string,
  colliderId: string,
  gravityScale = 0,
  linearDamping = 8
): { id: string; data: PhysicsBodyData } {
  return {
    id,
    data: {
      id,
      kind: "dynamic",
      gravityScale,
      damping: { linear: linearDamping },
      colliders: [ref("physics.collider", colliderId)],
      tags: ["outpost"]
    }
  };
}

function staticBody(id: string, colliderId: string): { id: string; data: PhysicsBodyData } {
  return {
    id,
    data: {
      id,
      kind: "static",
      colliders: [ref("physics.collider", colliderId)],
      tags: ["outpost"]
    }
  };
}

function renderObject(
  id: string,
  assetId: string,
  layer: string,
  facingOffsetRadians?: number
): OutpostRenderObjectDefinition {
  return {
    id,
    type: "sprite",
    assetRefs: { texture: { assetId, type: "image" } },
    ...(facingOffsetRadians === undefined ? {} : { facingOffsetRadians }),
    layer,
    tags: ["outpost"]
  };
}
