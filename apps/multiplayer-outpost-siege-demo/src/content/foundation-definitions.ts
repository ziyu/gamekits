import type { AssetAnimationManifest, AssetDefinition } from "@gamekits/asset";
import type {
  AnimatorBindingDefinition,
  AnimatorGraphDefinition,
  AnimationClipDefinition
} from "@gamekits/animator-core";
import type {
  CombatAbilityDeliveryDefinition,
  CombatDeliveryDefinition,
  CombatProjectileDefinition,
  CombatRelationshipPolicyDefinition
} from "@gamekits/combat";
import type { DataPackEntry } from "@gamekits/data";
import type {
  NavigationAgentProfileDefinition,
  NavigationLayoutDefinition
} from "@gamekits/navigation-core";
import type { NavigationGraphDefinition } from "@gamekits/navigation-graph";
import { outpostArenaDefinition } from "./arena-scene";

export const OUTPOST_NAVIGATION_BACKEND_ID = "outpost.graph";
export const OUTPOST_NAVIGATION_GRAPH_ID = "navigation.outpost.frontier.graph";
export const OUTPOST_NAVIGATION_LAYOUT_ID = "navigation.outpost.frontier.layout";
export const OUTPOST_NAVIGATION_PROFILE_ID = "navigation.outpost.raider";

export type OutpostNavigationBarricadeBlocker = {
  id: string;
  objectIds: readonly string[];
  edgeId: string;
};

export const outpostNavigationBarricadeBlockers: readonly OutpostNavigationBarricadeBlocker[] = [
  barricadeBlocker("north-west", "edge.outpost.north-west-inner"),
  barricadeBlocker("north-east", "edge.outpost.north-east-inner"),
  barricadeBlocker("south-west", "edge.outpost.south-west-inner"),
  barricadeBlocker("south-east", "edge.outpost.south-east-inner")
];

export const OUTPOST_AUDIO_ASSET_IDS = {
  ambience: "asset.outpost.audio.ambience",
  rifle: [
    "asset.outpost.audio.rifle.01",
    "asset.outpost.audio.rifle.02",
    "asset.outpost.audio.rifle.03",
    "asset.outpost.audio.rifle.04",
    "asset.outpost.audio.rifle.05"
  ],
  enemyTelegraph: [
    "asset.outpost.audio.enemy-telegraph.01",
    "asset.outpost.audio.enemy-telegraph.02",
    "asset.outpost.audio.enemy-telegraph.03",
    "asset.outpost.audio.enemy-telegraph.04",
    "asset.outpost.audio.enemy-telegraph.05"
  ],
  hit: [
    "asset.outpost.audio.hit.01",
    "asset.outpost.audio.hit.02",
    "asset.outpost.audio.hit.03",
    "asset.outpost.audio.hit.04",
    "asset.outpost.audio.hit.05"
  ]
} as const;

const OUTPOST_DOWNLOADED_SFX = [
  downloadedSfxSource(
    OUTPOST_AUDIO_ASSET_IDS.rifle[0],
    "rifle-01.ogg",
    "laserLarge_000.ogg",
    "Sci-fi Sounds",
    "https://kenney.nl/assets/sci-fi-sounds",
    "a56d95794cd732d6c2d66ce488c14cf557fe526c282897c9a77675c2bd9b77e6"
  ),
  downloadedSfxSource(
    OUTPOST_AUDIO_ASSET_IDS.rifle[1],
    "rifle-02.ogg",
    "laserLarge_001.ogg",
    "Sci-fi Sounds",
    "https://kenney.nl/assets/sci-fi-sounds",
    "e678aca631495b7dfef4ac625f0349875ccac81a60f538d530e072241af3e4bd"
  ),
  downloadedSfxSource(
    OUTPOST_AUDIO_ASSET_IDS.rifle[2],
    "rifle-03.ogg",
    "laserLarge_002.ogg",
    "Sci-fi Sounds",
    "https://kenney.nl/assets/sci-fi-sounds",
    "e5e0b6ccc4d5720c8174a3e5b7cc6f9be3057352a89cbb2e99a00efc6fe5cc11"
  ),
  downloadedSfxSource(
    OUTPOST_AUDIO_ASSET_IDS.rifle[3],
    "rifle-04.ogg",
    "laserLarge_003.ogg",
    "Sci-fi Sounds",
    "https://kenney.nl/assets/sci-fi-sounds",
    "3c7b3c9d856ee31fa1b92d29322f6ee472446627381595baeaba2af35c07135f"
  ),
  downloadedSfxSource(
    OUTPOST_AUDIO_ASSET_IDS.rifle[4],
    "rifle-05.ogg",
    "laserLarge_004.ogg",
    "Sci-fi Sounds",
    "https://kenney.nl/assets/sci-fi-sounds",
    "86c749483b40e1bba9bfea6a04e884d479e5481e52efb6f113341141de516b3b"
  ),
  downloadedSfxSource(
    OUTPOST_AUDIO_ASSET_IDS.enemyTelegraph[0],
    "enemy-telegraph-01.ogg",
    "forceField_000.ogg",
    "Sci-fi Sounds",
    "https://kenney.nl/assets/sci-fi-sounds",
    "c2916f2a062c8ddd1aca2826d134fe90847037db31342726ffb0f9097afe339c"
  ),
  downloadedSfxSource(
    OUTPOST_AUDIO_ASSET_IDS.enemyTelegraph[1],
    "enemy-telegraph-02.ogg",
    "forceField_001.ogg",
    "Sci-fi Sounds",
    "https://kenney.nl/assets/sci-fi-sounds",
    "5574e69dd04e5f59322c5ddffde5978f077b09170ae5e29cec0bd9901828cd90"
  ),
  downloadedSfxSource(
    OUTPOST_AUDIO_ASSET_IDS.enemyTelegraph[2],
    "enemy-telegraph-03.ogg",
    "forceField_002.ogg",
    "Sci-fi Sounds",
    "https://kenney.nl/assets/sci-fi-sounds",
    "051b0eafc479695af4ca3607d41fd4be41bae7c21f4f9508d004722b09f1bd63"
  ),
  downloadedSfxSource(
    OUTPOST_AUDIO_ASSET_IDS.enemyTelegraph[3],
    "enemy-telegraph-04.ogg",
    "forceField_003.ogg",
    "Sci-fi Sounds",
    "https://kenney.nl/assets/sci-fi-sounds",
    "15e3fe971ffd3415e5ab641d3a4d043fb31f6712b0956315b524ba29c3889cda"
  ),
  downloadedSfxSource(
    OUTPOST_AUDIO_ASSET_IDS.enemyTelegraph[4],
    "enemy-telegraph-05.ogg",
    "forceField_004.ogg",
    "Sci-fi Sounds",
    "https://kenney.nl/assets/sci-fi-sounds",
    "05609bb296cbc287ae95ac8924c89809d69c89d7bb357cc6a117ec1b1ef65e09"
  ),
  downloadedSfxSource(
    OUTPOST_AUDIO_ASSET_IDS.hit[0],
    "hit-01.ogg",
    "impactMetal_heavy_000.ogg",
    "Impact Sounds",
    "https://kenney.nl/assets/impact-sounds",
    "e07045693e4a2b3d165c424e3dab4c781d9ff8880a386880ac89a51315d7f831"
  ),
  downloadedSfxSource(
    OUTPOST_AUDIO_ASSET_IDS.hit[1],
    "hit-02.ogg",
    "impactMetal_heavy_001.ogg",
    "Impact Sounds",
    "https://kenney.nl/assets/impact-sounds",
    "83554049f81f4db9209379e103c30bfa63f65c42189a03f300b045c2c82e23ae"
  ),
  downloadedSfxSource(
    OUTPOST_AUDIO_ASSET_IDS.hit[2],
    "hit-03.ogg",
    "impactMetal_heavy_002.ogg",
    "Impact Sounds",
    "https://kenney.nl/assets/impact-sounds",
    "b914c8f1eb7c0f34bb165d7c77f4be0351f6be0660c13c53e65424e262e2c093"
  ),
  downloadedSfxSource(
    OUTPOST_AUDIO_ASSET_IDS.hit[3],
    "hit-04.ogg",
    "impactMetal_heavy_003.ogg",
    "Impact Sounds",
    "https://kenney.nl/assets/impact-sounds",
    "b0f2ba4dabde9a87eb9c188a19d31e0c2300fd321adeba08d3b9b8aa011d7037"
  ),
  downloadedSfxSource(
    OUTPOST_AUDIO_ASSET_IDS.hit[4],
    "hit-05.ogg",
    "impactMetal_heavy_004.ogg",
    "Impact Sounds",
    "https://kenney.nl/assets/impact-sounds",
    "6d65b463c0555dd5be16b8db6d2cbe23a94e07a4637779b8ad17d0db3e500a87"
  )
] as const;

const OUTPOST_ANIMATED_ASSETS = {
  "asset.outpost.player": "player",
  "asset.outpost.raider": "raider",
  "asset.outpost.overseer": "overseer"
} as const;

const relationshipPolicy: CombatRelationshipPolicyDefinition = {
  id: "combat.outpost.relationship.hostile",
  tags: ["outpost", "hostile-only"]
};

const projectile: CombatProjectileDefinition = {
  id: "combat.outpost.projectile.rifle",
  body: { type: "physics.body", id: "body.outpost.projectile" },
  lifetimeMs: 1_200,
  speed: 760,
  collisionMode: "ray-sweep",
  hitPolicy: "stop",
  maxHits: 1,
  query: { triggerInteraction: "include" },
  payloads: [{ effectId: "effect.outpost.combat_hit", target: "hit-actor" }],
  tags: ["outpost", "rifle"]
};

const deliveries: CombatDeliveryDefinition[] = [
  {
    id: "combat.outpost.delivery.rifle",
    delivery: {
      type: "projectile",
      projectile: { type: "combat.projectile", id: projectile.id }
    },
    payloads: [],
    relationshipPolicy: relationshipPolicy.id,
    tags: ["outpost", "rifle"]
  },
  {
    id: "combat.outpost.delivery.enemy-melee",
    delivery: {
      type: "melee",
      shape: { type: "circle", radius: 48 },
      selection: { mode: "closest", maxTargets: 1 }
    },
    payloads: [{ effectId: "effect.outpost.combat_hit", target: "hit-actor" }],
    relationshipPolicy: relationshipPolicy.id,
    tags: ["outpost", "enemy", "melee"]
  },
  {
    id: "combat.outpost.delivery.shock-field",
    delivery: {
      type: "area",
      shape: { type: "circle", radius: 150 },
      selection: { mode: "all", maxTargets: 64 }
    },
    payloads: [{ effectId: "effect.outpost.shocked", target: "hit-actor" }],
    relationshipPolicy: relationshipPolicy.id,
    tags: ["outpost", "shock"]
  }
];

const abilityDeliveries: CombatAbilityDeliveryDefinition[] = [
  binding("combat.outpost.binding.rifle", "ability.outpost.rifle_fire", deliveries[0]!.id),
  binding("combat.outpost.binding.enemy-melee", "ability.outpost.enemy_attack", deliveries[1]!.id),
  binding("combat.outpost.binding.shock-field", "ability.outpost.shock_field", deliveries[2]!.id)
];

const navigationProfile: NavigationAgentProfileDefinition = {
  id: OUTPOST_NAVIGATION_PROFILE_ID,
  radius: 16,
  height: 32,
  allowedAreas: ["lane", "objective"],
  costOverrides: { lane: 1, objective: 1.15 },
  tags: ["outpost", "enemy"]
};

const navigationGraph: NavigationGraphDefinition = {
  id: OUTPOST_NAVIGATION_GRAPH_ID,
  nodes: [
    node("gate.north", 900, 170, "lane"),
    node("north.west", 740, 350, "lane"),
    node("north.center", 900, 350, "lane"),
    node("north.east", 1060, 350, "lane"),
    node("gate.west", 270, 500, "lane"),
    node("west.outer", 520, 500, "lane"),
    node("west.inner", 740, 500, "lane"),
    node("objective", 900, 500, "objective"),
    node("east.inner", 1060, 500, "lane"),
    node("east.outer", 1280, 500, "lane"),
    node("gate.east", 1530, 500, "lane"),
    node("south.west", 740, 650, "lane"),
    node("south.center", 900, 650, "lane"),
    node("south.east", 1060, 650, "lane"),
    node("gate.south", 900, 830, "lane")
  ],
  edges: [
    edge("north-gate-west", "gate.north", "north.west"),
    edge("north-gate-center", "gate.north", "north.center"),
    edge("north-gate-east", "gate.north", "north.east"),
    edge("north-west-inner", "north.west", "west.inner"),
    edge("north-center-objective", "north.center", "objective", "objective"),
    edge("north-east-inner", "north.east", "east.inner"),
    edge("west-gate-outer", "gate.west", "west.outer"),
    edge("west-outer-inner", "west.outer", "west.inner"),
    edge("west-inner-objective", "west.inner", "objective", "objective"),
    edge("east-inner-objective", "east.inner", "objective", "objective"),
    edge("east-outer-inner", "east.outer", "east.inner"),
    edge("east-gate-outer", "gate.east", "east.outer"),
    edge("south-west-inner", "south.west", "west.inner"),
    edge("south-center-objective", "south.center", "objective", "objective"),
    edge("south-east-inner", "south.east", "east.inner"),
    edge("south-gate-west", "gate.south", "south.west"),
    edge("south-gate-center", "gate.south", "south.center"),
    edge("south-gate-east", "gate.south", "south.east"),
    edge("north-west-center", "north.west", "north.center"),
    edge("north-center-east", "north.center", "north.east"),
    edge("south-west-center", "south.west", "south.center"),
    edge("south-center-east", "south.center", "south.east")
  ],
  tags: ["outpost", "frontier", "authored"]
};

const navigationLayout: NavigationLayoutDefinition = {
  id: OUTPOST_NAVIGATION_LAYOUT_ID,
  backend: OUTPOST_NAVIGATION_BACKEND_ID,
  source: { type: "navigation.graph", id: navigationGraph.id },
  areas: [
    { id: "lane", cost: 1 },
    { id: "objective", cost: 1.15 }
  ],
  tags: ["outpost", "frontier"]
};

const aiEntries: DataPackEntry[] = [
  entry("ai.sensor", "ai.outpost.sensor.threat", {
    id: "ai.outpost.sensor.threat",
    sampler: "outpost.nearest-player",
    intervalMs: 120,
    tags: ["outpost", "combat"]
  }),
  entry("ai.task", "ai.outpost.task.assault", {
    id: "ai.outpost.task.assault",
    executor: "outpost.assault-target",
    interruptPolicy: "safe-point",
    timeoutMs: 30_000,
    tags: ["outpost", "combat"]
  }),
  entry("ai.goal", "ai.outpost.goal.assault", {
    id: "ai.outpost.goal.assault",
    task: { type: "ai.task", id: "ai.outpost.task.assault" },
    considerations: [{ input: "outpost.target-available", curve: { type: "linear" } }],
    minScore: 0.1,
    commitmentMs: 700,
    switchThreshold: 0.12,
    cooldownMs: 180,
    tags: ["outpost", "combat"]
  }),
  entry("ai.agent", "ai.outpost.agent.raider", {
    id: "ai.outpost.agent.raider",
    sensors: [{ type: "ai.sensor", id: "ai.outpost.sensor.threat" }],
    goals: [{ type: "ai.goal", id: "ai.outpost.goal.assault" }],
    decisionIntervalMs: 160,
    memoryLimit: 8,
    blackboardLimit: 4,
    schedulerClass: "frontline",
    tags: ["outpost", "raider"]
  }),
  entry("ai.agent", "ai.outpost.agent.overseer", {
    id: "ai.outpost.agent.overseer",
    sensors: [{ type: "ai.sensor", id: "ai.outpost.sensor.threat" }],
    goals: [{ type: "ai.goal", id: "ai.outpost.goal.assault" }],
    decisionIntervalMs: 120,
    memoryLimit: 12,
    blackboardLimit: 4,
    schedulerClass: "boss",
    tags: ["outpost", "overseer"]
  })
];

const animatorEntries = createAnimatorEntries();

export const outpostGeneratedAudioAssets: AssetDefinition[] = [
  downloadedMusicAsset(OUTPOST_AUDIO_ASSET_IDS.ambience, "/assets/outpost/audio/magic-space.ogg"),
  ...OUTPOST_DOWNLOADED_SFX.map(downloadedSfxAsset)
];

export const outpostFoundationDataEntries: DataPackEntry[] = [
  entry("combat.relationship-policy", relationshipPolicy.id, relationshipPolicy),
  entry("combat.projectile", projectile.id, projectile),
  ...deliveries.map((definition) => entry("combat.delivery", definition.id, definition)),
  ...abilityDeliveries.map((definition) =>
    entry("combat.ability-delivery", definition.id, definition)
  ),
  entry("navigation.agent-profile", navigationProfile.id, navigationProfile),
  entry("navigation.graph", navigationGraph.id, navigationGraph),
  entry("navigation.layout", navigationLayout.id, navigationLayout),
  ...aiEntries,
  ...animatorEntries
];

export function outpostSpriteAnimations(assetId: string): AssetAnimationManifest[] {
  const role = OUTPOST_ANIMATED_ASSETS[assetId as keyof typeof OUTPOST_ANIMATED_ASSETS];
  if (role === undefined) {
    return [];
  }
  if (role === "player") {
    return [
      animation("outpost.player.idle", [0, 1], 2, -1),
      animation("outpost.player.run", [2, 3], 8, -1),
      animation("outpost.player.dash", [9, 10], 12, -1),
      animation("outpost.player.rifle-preparing", [4], 1, 0),
      animation("outpost.player.rifle-committed", [4, 5], 14, 0),
      animation("outpost.player.rifle-active", [5], 1, 0),
      animation("outpost.player.rifle-recovering", [5, 0], 18, 0),
      animation("outpost.player.reload-preparing", [6, 7], 3, 0),
      animation("outpost.player.reload-committed", [7], 1, 0),
      animation("outpost.player.reload-active", [7], 1, 0),
      animation("outpost.player.reload-recovering", [7, 8], 4, 0),
      animation("outpost.player.hit", [11], 1, 0),
      animation("outpost.player.dead", [12], 1, 0),
      animation("outpost.player.tactical-preparing", [0, 13], 6, 0),
      animation("outpost.player.tactical-committed", [13], 1, 0),
      animation("outpost.player.tactical-active", [13], 1, 0),
      animation("outpost.player.tactical-recovering", [13, 0], 6, 0)
    ];
  }
  return [
    animation(`outpost.${role}.idle`, [0], 1, -1),
    animation(`outpost.${role}.run`, [0], 1, -1),
    animation(`outpost.${role}.attack`, [0], 1, 0),
    animation(`outpost.${role}.hit`, [0], 1, 0),
    animation(`outpost.${role}.dead`, [0], 1, 0)
  ];
}

export function outpostAnimatorBindingIdForRenderKey(renderKey: string): string | undefined {
  switch (renderKey) {
    case "render.outpost.player":
      return "animator.outpost.binding.player";
    case "render.outpost.raider":
      return "animator.outpost.binding.raider";
    case "render.outpost.overseer":
      return "animator.outpost.binding.overseer";
    default:
      return undefined;
  }
}

function createAnimatorEntries(): DataPackEntry[] {
  const playerGraph = createAnimatorGraph("player", true);
  const enemyGraph = createAnimatorGraph("enemy", false);
  const entries: DataPackEntry[] = [
    entry("animator.graph", playerGraph.id, playerGraph),
    entry("animator.graph", enemyGraph.id, enemyGraph)
  ];
  for (const [assetId, role] of Object.entries(OUTPOST_ANIMATED_ASSETS)) {
    const player = role === "player";
    const clipDefinitions = player
      ? createPlayerClipDefinitions(assetId)
      : createEnemyClipDefinitions(role, assetId);
    entries.push(
      ...clipDefinitions.map((definition) => entry("animation.clip", definition.id, definition))
    );
    const bindingDefinition: AnimatorBindingDefinition = {
      id: `animator.outpost.binding.${role}`,
      graph: { type: "animator.graph", id: player ? playerGraph.id : enemyGraph.id },
      clips: Object.fromEntries(
        clipDefinitions.map((definition) => [
          definition.id.split(".").at(-1)!,
          { type: "animation.clip" as const, id: definition.id }
        ])
      ),
      fallbackClip: "idle",
      phaseMappings: player ? playerPhaseMappings() : enemyPhaseMappings()
    };
    entries.push(entry("animator.binding", bindingDefinition.id, bindingDefinition));
  }
  return entries;
}

function createAnimatorGraph(
  role: "player" | "enemy",
  supportsDash: boolean
): AnimatorGraphDefinition {
  const states = [
    { id: "idle", clip: "idle", loop: true },
    { id: "run", clip: "run", loop: true, speedParameter: "speed" },
    ...(supportsDash ? [{ id: "dash", clip: "dash", loop: true }] : []),
    { id: "dead", clip: "dead", loop: true }
  ];
  const locomotionStates = supportsDash ? ["idle", "run", "dash"] : ["idle", "run"];
  return {
    id: `animator.outpost.${role}.graph`,
    parameters: [
      { id: "speed", type: "number", default: 0 },
      { id: "dead", type: "boolean", default: false },
      ...(supportsDash ? [{ id: "dashing", type: "boolean" as const, default: false }] : [])
    ],
    layers: [
      {
        id: "base",
        initialState: "idle",
        states,
        transitions: [
          ...locomotionStates.map((from) => ({
            from,
            to: "dead",
            priority: 100,
            conditions: [{ parameter: "dead", operator: "==" as const, value: true }]
          })),
          ...(supportsDash
            ? [
                {
                  from: "idle",
                  to: "dash",
                  priority: 50,
                  conditions: [{ parameter: "dashing", operator: "==" as const, value: true }]
                },
                {
                  from: "run",
                  to: "dash",
                  priority: 50,
                  conditions: [{ parameter: "dashing", operator: "==" as const, value: true }]
                },
                {
                  from: "dash",
                  to: "run",
                  conditions: [
                    { parameter: "dashing", operator: "==" as const, value: false },
                    { parameter: "speed", operator: ">" as const, value: 0.05 }
                  ]
                },
                {
                  from: "dash",
                  to: "idle",
                  conditions: [
                    { parameter: "dashing", operator: "==" as const, value: false },
                    { parameter: "speed", operator: "<=" as const, value: 0.05 }
                  ]
                }
              ]
            : []),
          {
            from: "idle",
            to: "run",
            conditions: [{ parameter: "speed", operator: ">", value: 0.05 }]
          },
          {
            from: "run",
            to: "idle",
            conditions: [{ parameter: "speed", operator: "<=", value: 0.05 }]
          }
        ]
      }
    ]
  };
}

function createPlayerClipDefinitions(assetId: string): AnimationClipDefinition[] {
  return [
    clip("player", "idle", assetId, 1_000, true),
    clip("player", "run", assetId, 250, true),
    clip("player", "dash", assetId, 180, true),
    clip("player", "rifle-preparing", assetId, 35, false),
    clip("player", "rifle-committed", assetId, 35, false),
    clip("player", "rifle-active", assetId, 45, false),
    clip("player", "rifle-recovering", assetId, 40, false),
    clip("player", "reload-preparing", assetId, 800, false),
    clip("player", "reload-committed", assetId, 100, false),
    clip("player", "reload-active", assetId, 100, false),
    clip("player", "reload-recovering", assetId, 450, false),
    clip("player", "tactical-preparing", assetId, 260, false),
    clip("player", "tactical-committed", assetId, 1, false),
    clip("player", "tactical-active", assetId, 160, false),
    clip("player", "tactical-recovering", assetId, 260, false),
    clip("player", "hit", assetId, 180, false),
    clip("player", "dead", assetId, 1_000, true)
  ];
}

function createEnemyClipDefinitions(role: string, assetId: string): AnimationClipDefinition[] {
  return [
    clip(role, "idle", assetId, 1_000, true),
    clip(role, "run", assetId, 520, true),
    clip(role, "attack", assetId, 900, false),
    clip(role, "hit", assetId, 180, false),
    clip(role, "dead", assetId, 1_000, true)
  ];
}

function playerPhaseMappings(): NonNullable<AnimatorBindingDefinition["phaseMappings"]> {
  return [
    ...abilityPhaseMappings("ability.outpost.rifle_fire", "rifle"),
    ...abilityPhaseMappings("ability.outpost.rifle_reload", "reload"),
    ...abilityPhaseMappings("ability.outpost.shock_field", "tactical")
  ];
}

function enemyPhaseMappings(): NonNullable<AnimatorBindingDefinition["phaseMappings"]> {
  return ["preparing", "committed", "active", "recovering"].map((phase) => ({
    phase,
    layer: "base",
    clip: "attack"
  }));
}

function abilityPhaseMappings(
  abilityId: string,
  clipPrefix: string
): NonNullable<AnimatorBindingDefinition["phaseMappings"]> {
  return ["preparing", "committed", "active", "recovering"].map((phase) => ({
    abilityId,
    phase,
    layer: "base",
    clip: `${clipPrefix}-${phase}`
  }));
}

function clip(
  role: string,
  name: string,
  assetId: string,
  durationMs: number,
  loop: boolean
): AnimationClipDefinition {
  return {
    id: `animation.outpost.${role}.${name}`,
    asset: { assetId, type: "spritesheet" },
    backendClip: `outpost.${role}.${name}`,
    durationMs,
    loop
  };
}

function animation(
  id: string,
  frames: number[],
  frameRate: number,
  repeat: number
): AssetAnimationManifest {
  return { id, frames, frameRate, repeat };
}

function binding(
  id: string,
  abilityId: string,
  deliveryId: string
): CombatAbilityDeliveryDefinition {
  return {
    id,
    ability: { type: "gas.ability", id: abilityId },
    delivery: { type: "combat.delivery", id: deliveryId },
    phase: "committed",
    tags: ["outpost"]
  };
}

function node(id: string, x: number, y: number, area: string) {
  return { id, point: { x, y }, area, clearance: 52, heightClearance: 64 };
}

function edge(id: string, from: string, to: string, area = "lane") {
  return {
    id: `edge.outpost.${id}`,
    from,
    to,
    area,
    width: 72,
    heightClearance: 64,
    bidirectional: true
  };
}

function barricadeBlocker(group: string, edgeId: string): OutpostNavigationBarricadeBlocker {
  const objectIds = outpostArenaDefinition.staticObjects
    .filter((object) => object.id.startsWith(`barricade.${group}.`))
    .map((object) => object.id);
  if (objectIds.length === 0) {
    throw new Error(`Outpost navigation barricade group has no arena objects: ${group}`);
  }
  return {
    id: `navigation.blocker.outpost.${group}`,
    objectIds,
    edgeId
  };
}

function entry<TData>(type: string, id: string, data: TData): DataPackEntry<TData> {
  return { type, id, data };
}

function downloadedSfxSource(
  id: string,
  runtimeFile: string,
  sourceFile: string,
  pack: string,
  source: string,
  sha256: string
) {
  return { id, runtimeFile, sourceFile, pack, source, sha256 };
}

function downloadedSfxAsset(source: (typeof OUTPOST_DOWNLOADED_SFX)[number]): AssetDefinition {
  return {
    id: source.id,
    type: "audio",
    source: { type: "url", url: `/assets/outpost/audio/${source.runtimeFile}` },
    group: "combat",
    preload: true,
    tags: ["outpost", "audio", "combat", "cc0", "kenney"],
    audio: { stream: false, instances: 16 },
    metadata: {
      title: source.sourceFile,
      author: "Kenney",
      pack: source.pack,
      source: source.source,
      license: "CC0-1.0",
      sha256: source.sha256
    }
  };
}

function downloadedMusicAsset(id: string, runtimeUrl: string): AssetDefinition {
  return {
    id,
    type: "audio",
    source: { type: "url", url: runtimeUrl },
    group: "match",
    preload: true,
    tags: ["outpost", "audio", "match", "music", "cc0"],
    audio: { stream: false, instances: 2 },
    metadata: {
      title: "Magic Space",
      author: "CodeManu",
      source: "https://opengameart.org/content/magic-space",
      license: "CC0-1.0",
      sha256: "c87cf01d5ab620d7f4e1898bd125265006d92fe8d60a695f6b3cd21c2d6e1be9"
    }
  };
}
