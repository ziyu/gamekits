import type { DataPack, DataRef } from "@gamekits/data";
import {
  ARENA_BOT_ARCHETYPE_TYPE,
  ARENA_BOT_PROFILE_TYPE,
  ARENA_COURSE_TYPE,
  ARENA_HAZARD_TYPE,
  ARENA_ITEM_TYPE,
  ARENA_MATCH_RULE_TYPE,
  ARENA_MOTOR_PROFILE_TYPE,
  ARENA_SPAWN_SET_TYPE,
  ARENA_STAGE_TYPE,
  type ArenaBotArchetypeDefinition,
  type ArenaBotSkillProfileDefinition,
  type ArenaCourseDefinition,
  type ArenaDynamicPropPlacementDefinition,
  type ArenaGameplayVolumeDefinition,
  type ArenaHazardDefinition,
  type ArenaHazardPlacementDefinition,
  type ArenaItemDefinition,
  type ArenaMatchRuleDefinition,
  type ArenaMotorProfileDefinition,
  type ArenaSpawnPointDefinition,
  type ArenaSpawnSetDefinition,
  type ArenaStaticPlacementDefinition,
  type ArenaStageDefinition
} from "./types";

export const ARENA_CONTENT_PACK_ID = "knockout-arena.base";
export const ARENA_CONTENT_VERSION = "1.3.0";
export const ARENA_DEFAULT_MATCH_RULE_ID = "match.knockout.standard";

const items: ArenaItemDefinition[] = [
  item("item.foam-ball", "throwable", {
    physics: physicsItem({ type: "sphere", radius: 0.48 }, 0.75, 0.5, 0.72, 22, 240, 4),
    carry: carryItem(1, 1, "drop"),
    action: actionItem("throw-contact", 8, 30, 240, 24, 12, 5, 0),
    effect: effectItem("directional", 0.1, 0.85),
    respawn: { mode: "timed", ticks: 240 },
    presentationId: "presentation.foam-ball",
    networkStrategy: "predicted-entity"
  }),
  item("item.energy-block", "impact", {
    physics: physicsItem(
      { type: "box", width: 0.85, height: 0.7, depth: 0.85 },
      4.5,
      0.7,
      0.22,
      14,
      300,
      2
    ),
    carry: carryItem(0.72, 0.86, "drop"),
    action: actionItem("throw-contact", 24, 60, 300, 45, 8, 11, 0),
    effect: effectItem("directional", 0.16, 1.05),
    respawn: { mode: "timed", ticks: 300 },
    presentationId: "presentation.energy-block",
    networkStrategy: "predicted-entity"
  }),
  item("item.blast-orb", "area", {
    physics: physicsItem({ type: "sphere", radius: 0.65 }, 1.6, 0.45, 0.35, 18, 180, 1),
    carry: carryItem(0.88, 0.95, "spend"),
    action: actionItem("throw-area", 18, 45, 90, 60, 10, 8, 3.8),
    effect: effectItem("radial", 0.13, 0.9),
    respawn: { mode: "timed", ticks: 360 },
    presentationId: "presentation.blast-orb",
    networkStrategy: "predicted-entity"
  }),
  item("item.foam-hammer", "melee", {
    physics: physicsItem(
      { type: "box", width: 0.55, height: 1.6, depth: 0.45 },
      2.2,
      0.65,
      0.18,
      10,
      300,
      0
    ),
    carry: carryItem(0.82, 0.92, "drop"),
    action: actionItem("melee", 14, 0, 12, 36, 0, 8, 1.8),
    effect: effectItem("directional", 0.14, 1.2),
    respawn: { mode: "timed", ticks: 300 },
    presentationId: "presentation.foam-hammer",
    networkStrategy: "authority-only"
  }),
  item("item.gravity-orb", "area", {
    physics: physicsItem({ type: "sphere", radius: 0.58 }, 1.35, 0.38, 0.28, 17, 180, 1),
    carry: carryItem(0.9, 0.96, "spend"),
    action: actionItem("throw-area", 20, 42, 84, 66, 9.5, 7, 4.6),
    effect: effectItem("pull", 0.11, 0.95),
    respawn: { mode: "timed", ticks: 330 },
    presentationId: "presentation.gravity-orb",
    networkStrategy: "predicted-entity"
  }),
  item("item.spring-glove", "melee", {
    physics: physicsItem(
      { type: "box", width: 0.7, height: 0.72, depth: 0.95 },
      1.5,
      0.62,
      0.36,
      11,
      300,
      0
    ),
    carry: carryItem(0.9, 0.98, "drop"),
    action: actionItem("melee", 10, 0, 10, 42, 0, 7.5, 1.65),
    effect: effectItem("launch", 0.08, 0.72),
    respawn: { mode: "timed", ticks: 300 },
    presentationId: "presentation.spring-glove",
    networkStrategy: "authority-only"
  }),
  item("item.stun-baton", "melee", {
    physics: physicsItem(
      { type: "box", width: 0.3, height: 1.25, depth: 0.3 },
      1.1,
      0.58,
      0.2,
      10,
      300,
      0
    ),
    carry: carryItem(0.94, 0.97, "drop"),
    action: actionItem("melee", 8, 0, 8, 54, 0, 3.4, 1.55),
    effect: effectItem("directional", 0.3, 2.35),
    respawn: { mode: "timed", ticks: 300 },
    presentationId: "presentation.stun-baton",
    networkStrategy: "authority-only"
  })
];

export const ARENA_STANDARD_MOTOR_PROFILE: ArenaMotorProfileDefinition = {
  id: "motor.standard",
  maxGroundSpeed: 6.4,
  groundAcceleration: 28,
  groundBraking: 34,
  airAcceleration: 9,
  jumpSpeed: 7.2,
  diveSpeed: 9.4,
  coyoteTicks: 6,
  jumpBufferTicks: 7
};

const motorProfiles: ArenaMotorProfileDefinition[] = [ARENA_STANDARD_MOTOR_PROFILE];

const botProfiles: ArenaBotSkillProfileDefinition[] = [
  botProfile("bot.profile.sprinter", 7, 6, 12, 90, 24, 18, 3, 3, 90, 0.12, 0.35, 0.68, 45, 24),
  botProfile("bot.profile.brawler", 10, 8, 16, 120, 32, 16, 4, 4, 72, 0.08, 0.88, 0.72, 60, 30),
  botProfile(
    "bot.profile.opportunist",
    13,
    10,
    18,
    150,
    36,
    20,
    4,
    5,
    108,
    0.18,
    0.62,
    0.42,
    42,
    36
  )
];

const botArchetypes: ArenaBotArchetypeDefinition[] = [
  bot("bot.sprinter", "sprinter", "bot.profile.sprinter", ["item.foam-ball", "item.spring-glove"], {
    advance: 1.35,
    survive: 1,
    acquireItem: 0.55,
    attack: 0.35,
    objective: 0.9
  }),
  bot(
    "bot.brawler",
    "brawler",
    "bot.profile.brawler",
    ["item.foam-hammer", "item.energy-block", "item.stun-baton"],
    {
      advance: 0.75,
      survive: 1.1,
      acquireItem: 1,
      attack: 1.45,
      objective: 1
    }
  ),
  bot(
    "bot.opportunist",
    "opportunist",
    "bot.profile.opportunist",
    ["item.blast-orb", "item.gravity-orb", "item.foam-ball"],
    {
      advance: 0.9,
      survive: 1.15,
      acquireItem: 1.4,
      attack: 1.05,
      objective: 1.2
    }
  )
];

const hazards: ArenaHazardDefinition[] = [
  hazard("hazard.circuit.sweeper", "rotating-sweeper", "kinematic", 240, 0, 240),
  hazard("hazard.circuit.sweeper-beta", "rotating-sweeper", "kinematic", 210, 75, 210),
  hazard("hazard.circuit.sweeper-cargo", "rotating-sweeper", "kinematic", 270, 135, 270),
  hazard("hazard.circuit.platform", "moving-platform", "kinematic", 300, 45, 300),
  hazard("hazard.circuit.platform-late", "moving-platform", "kinematic", 300, 195, 300),
  hazard("hazard.circuit.piston-a", "piston", "kinematic", 180, 0, 72),
  hazard("hazard.circuit.piston-b", "piston", "kinematic", 180, 60, 72),
  hazard("hazard.circuit.piston-c", "piston", "kinematic", 180, 120, 72),
  hazard("hazard.circuit.conveyor-left", "conveyor", "kinematic", 300, 0, 300),
  hazard("hazard.circuit.conveyor-right", "conveyor", "kinematic", 300, 150, 300),
  hazard("hazard.circuit.wind-left", "wind-zone", "sensor", 210, 35, 96),
  hazard("hazard.circuit.wind-right", "wind-zone", "sensor", 210, 140, 96),
  hazard("hazard.circuit.bounce-left", "bounce-pad", "sensor", 120, 0, 120),
  hazard("hazard.circuit.bounce-right", "bounce-pad", "sensor", 120, 60, 120),
  hazard("hazard.scrap.conveyor", "conveyor", "kinematic", 300, 0, 300),
  hazard("hazard.scrap.wind", "wind-zone", "sensor", 210, 35, 90),
  hazard("hazard.scrap.bounce", "bounce-pad", "sensor", 120, 0, 120),
  hazard("hazard.scrap.crusher-a", "crusher", "kinematic", 210, 0, 90),
  hazard("hazard.scrap.crusher-b", "crusher", "kinematic", 210, 105, 90),
  hazard("hazard.scrap.wall-west", "extending-wall", "kinematic", 270, 30, 120),
  hazard("hazard.scrap.wall-east", "extending-wall", "kinematic", 270, 165, 120),
  hazard("hazard.scrap.zone", "shrinking-zone", "sensor", 900, 0, 900, 0.55),
  hazard("hazard.crown.floor", "crumble-floor", "kinematic", 360, 60, 240, 0.3),
  hazard("hazard.crown.zone", "shrinking-zone", "sensor", 900, 0, 900, 0.25),
  hazard("hazard.crown.sweeper", "rotating-sweeper", "kinematic", 240, 45, 240),
  hazard("hazard.crown.bounce", "bounce-pad", "sensor", 150, 30, 150)
];

const spawnSets: ArenaSpawnSetDefinition[] = [
  spawnSet("spawn.circuit", [
    ...participantPoints(8, 9),
    {
      id: "item.0",
      kind: "item",
      position: { x: 0, y: 1.2, z: 1 },
      definition: ref(ARENA_ITEM_TYPE, "item.foam-ball")
    },
    {
      id: "item.1",
      kind: "item",
      position: { x: 5, y: 1.2, z: -124 },
      definition: ref(ARENA_ITEM_TYPE, "item.foam-ball")
    },
    {
      id: "item.2",
      kind: "item",
      position: { x: 0, y: 1.2, z: -184 },
      definition: ref(ARENA_ITEM_TYPE, "item.foam-ball")
    }
  ]),
  spawnSet("spawn.scrap", [
    ...participantPoints(6, 6, 36),
    ...itemPoints(
      [
        "item.foam-ball",
        "item.energy-block",
        "item.blast-orb",
        "item.foam-hammer",
        "item.gravity-orb",
        "item.spring-glove",
        "item.stun-baton"
      ],
      36,
      -4
    ),
    ...itemPoints(
      [
        "item.foam-ball",
        "item.energy-block",
        "item.gravity-orb",
        "item.spring-glove",
        "item.stun-baton"
      ],
      36,
      4,
      7
    )
  ]),
  spawnSet("spawn.crown", [
    ...participantPoints(3, 5, 72),
    ...itemPoints(
      ["item.foam-ball", "item.foam-hammer", "item.gravity-orb", "item.spring-glove"],
      72,
      -1
    )
  ])
];

const courses: ArenaCourseDefinition[] = [
  course(
    "course.circuit-forge",
    "spawn.circuit",
    {
      bounds: { min: { x: -20, y: -8, z: -216 }, max: { x: 20, y: 12, z: 14 } },
      staticLayout: [
        staticBox("circuit.floor-start", "floor", 0, -0.5, -66, 24, 1, 160, "course", "walkable"),
        staticBox("circuit.floor-finish", "floor", 0, -0.5, -187, 24, 1, 54, "course", "walkable"),
        staticBox("circuit.start-deck", "platform", 0, 0.1, 8, 22, 0.2, 10, "course", "walkable"),
        staticBox("circuit.ice-left", "platform", -5.5, 0.06, -198, 10, 0.12, 14, "ice", "slick"),
        staticBox("circuit.ice-right", "platform", 5.5, 0.06, -198, 10, 0.12, 14, "ice", "slick"),
        staticBox(
          "circuit.finish-deck",
          "finish-deck",
          0,
          0.2,
          -207,
          12,
          0.4,
          8,
          "course",
          "walkable"
        ),
        ...courseSideWalls("circuit", 12.35, -100, 228)
      ],
      hazards: [
        hazardPlacement(
          "circuit.conveyor-left",
          "hazard.circuit.conveyor-left",
          -5.5,
          0.13,
          -12,
          10.5,
          0.26,
          18,
          "z",
          0,
          4.5
        ),
        hazardPlacement(
          "circuit.conveyor-right",
          "hazard.circuit.conveyor-right",
          5.5,
          0.13,
          -12,
          10.5,
          0.26,
          18,
          "z",
          0,
          -5.5
        ),
        hazardPlacement(
          "circuit.sweeper-alpha",
          "hazard.circuit.sweeper",
          0,
          1,
          -40,
          18,
          0.55,
          0.55,
          "y",
          0,
          9
        ),
        hazardPlacement(
          "circuit.sweeper-beta",
          "hazard.circuit.sweeper-beta",
          0,
          1,
          -52,
          16,
          0.55,
          0.55,
          "y",
          0,
          9
        ),
        hazardPlacement(
          "circuit.piston-left",
          "hazard.circuit.piston-a",
          -9,
          1.35,
          -72,
          2.2,
          2.7,
          1.4,
          "x",
          8,
          12
        ),
        hazardPlacement(
          "circuit.piston-center",
          "hazard.circuit.piston-b",
          -4,
          1.35,
          -80,
          2.2,
          2.7,
          1.4,
          "x",
          8,
          12
        ),
        hazardPlacement(
          "circuit.piston-right",
          "hazard.circuit.piston-c",
          1,
          1.35,
          -88,
          2.2,
          2.7,
          1.4,
          "x",
          8,
          12
        ),
        hazardPlacement(
          "circuit.bounce-left",
          "hazard.circuit.bounce-left",
          -6,
          0.12,
          -108,
          8,
          0.24,
          10,
          "y",
          0,
          14
        ),
        hazardPlacement(
          "circuit.bounce-right",
          "hazard.circuit.bounce-right",
          6,
          0.12,
          -108,
          8,
          0.24,
          10,
          "y",
          0,
          14
        ),
        hazardPlacement(
          "circuit.wind-left",
          "hazard.circuit.wind-left",
          -6,
          1.8,
          -130,
          10,
          3.6,
          18,
          "x",
          0,
          9
        ),
        hazardPlacement(
          "circuit.wind-right",
          "hazard.circuit.wind-right",
          6,
          1.8,
          -130,
          10,
          3.6,
          18,
          "x",
          0,
          -9
        ),
        hazardPlacement(
          "circuit.moving-bridge-left",
          "hazard.circuit.platform",
          -5.5,
          0.2,
          -153,
          9,
          0.4,
          14,
          "x",
          2.5,
          0
        ),
        hazardPlacement(
          "circuit.moving-bridge-right",
          "hazard.circuit.platform-late",
          5.5,
          0.2,
          -153,
          9,
          0.4,
          14,
          "x",
          2.5,
          0
        ),
        hazardPlacement(
          "circuit.cargo-sweeper",
          "hazard.circuit.sweeper-cargo",
          0,
          1,
          -176,
          17,
          0.6,
          0.6,
          "y",
          0,
          10
        )
      ],
      props: [
        propSphere("circuit.prop.ball-left", -6, 1.2, -181, 1.1, 1.4, "presentation.prop-ball"),
        propSphere("circuit.prop.ball-center", 0, 1.2, -182, 1.1, 1.4, "presentation.prop-ball"),
        propSphere("circuit.prop.ball-right", 6, 1.2, -181, 1.1, 1.4, "presentation.prop-ball"),
        propBox(
          "circuit.prop.block-left",
          -4,
          1.15,
          -185,
          1.8,
          1.8,
          1.8,
          2.2,
          "presentation.prop-block"
        ),
        propBox(
          "circuit.prop.block-right",
          4,
          1.15,
          -185,
          1.8,
          1.8,
          1.8,
          2.2,
          "presentation.prop-block"
        )
      ],
      volumes: [
        volume("circuit.kill", "kill", 0, -5.5, -101, 34, 4, 240),
        volume("circuit.checkpoint.1", "checkpoint", 0, 1.4, -25, 23, 4, 2, 1),
        volume("circuit.checkpoint.2", "checkpoint", 0, 1.4, -61, 23, 4, 2, 2),
        volume("circuit.checkpoint.3", "checkpoint", 0, 1.4, -97, 23, 4, 2, 3),
        volume("circuit.checkpoint.4", "checkpoint", 0, 1.4, -118, 23, 4, 2, 4),
        volume("circuit.checkpoint.5", "checkpoint", 0, 1.4, -141, 23, 4, 2, 5),
        volume("circuit.checkpoint.6", "checkpoint", 0, 1.4, -164, 23, 4, 2, 6),
        volume("circuit.checkpoint.7", "checkpoint", 0, 1.4, -190, 23, 4, 2, 7),
        volume("circuit.finish", "finish", 0, 1.8, -207.5, 12, 4, 2, 8)
      ],
      navigation: navigationProfile(),
      presentation: { themeId: "circuit-forge", accent: "#44e6ff", skyline: "orbital-forge" }
    },
    2
  ),
  course("course.scrap-yard", "spawn.scrap", {
    bounds: { min: { x: 23, y: -6, z: -14 }, max: { x: 49, y: 9, z: 13 } },
    staticLayout: [
      staticBox("scrap.floor", "floor", 36, -0.5, 0, 23, 1, 23, "mud", "slow"),
      staticBox("scrap.ring-north", "platform", 36, 0.15, -7.8, 12, 0.3, 3.5, "course", "walkable"),
      staticBox("scrap.ring-south", "platform", 36, 0.15, 7.8, 12, 0.3, 3.5, "course", "walkable"),
      staticBox("scrap.ring-west", "platform", 28.2, 0.15, 0, 3.5, 0.3, 12, "course", "walkable"),
      staticBox("scrap.ring-east", "platform", 43.8, 0.15, 0, 3.5, 0.3, 12, "course", "walkable")
    ],
    hazards: [
      hazardPlacement(
        "scrap.outer-conveyor",
        "hazard.scrap.conveyor",
        36,
        0.15,
        8.4,
        15,
        0.3,
        2.8,
        "x",
        0,
        5.5
      ),
      hazardPlacement(
        "scrap.fan-tunnel",
        "hazard.scrap.wind",
        28.5,
        1.8,
        -1,
        4,
        3.6,
        8,
        "x",
        0,
        10
      ),
      hazardPlacement(
        "scrap.launch-pad",
        "hazard.scrap.bounce",
        42.5,
        0.2,
        -4.8,
        3.2,
        0.4,
        3.2,
        "y",
        0,
        13
      ),
      hazardPlacement(
        "scrap.crusher-west",
        "hazard.scrap.crusher-a",
        31.5,
        4.1,
        3.2,
        3.4,
        1,
        3.4,
        "y",
        -3,
        15
      ),
      hazardPlacement(
        "scrap.crusher-east",
        "hazard.scrap.crusher-b",
        40.5,
        4.1,
        -3.2,
        3.4,
        1,
        3.4,
        "y",
        -3,
        15
      ),
      hazardPlacement(
        "scrap.wall-west",
        "hazard.scrap.wall-west",
        25.7,
        1.5,
        3.5,
        1,
        3,
        5,
        "x",
        4.3,
        9
      ),
      hazardPlacement(
        "scrap.wall-east",
        "hazard.scrap.wall-east",
        46.3,
        1.5,
        -3.5,
        1,
        3,
        5,
        "x",
        -4.3,
        9
      ),
      hazardPlacement("scrap.shrinking-zone", "hazard.scrap.zone", 36, 1.4, 0, 20, 3, 20, "x", 0, 5)
    ],
    props: [
      propBox("scrap.prop.heavy-a", 33, 1.1, 1, 1.7, 1.7, 1.7, 4.5, "presentation.scrap-crate"),
      propBox("scrap.prop.heavy-b", 39, 1.1, 1, 1.7, 1.7, 1.7, 4.5, "presentation.scrap-crate"),
      propSphere("scrap.prop.roller-a", 31, 1, -5.5, 0.95, 2.4, "presentation.scrap-roller"),
      propSphere("scrap.prop.roller-b", 41, 1, 5.5, 0.95, 2.4, "presentation.scrap-roller")
    ],
    volumes: [
      volume("scrap.kill", "kill", 36, -4.5, 0, 32, 3, 32),
      volume("scrap.objective", "objective", 36, 1.4, 0, 8, 3, 8),
      volume("scrap.safe-zone", "safe-zone", 36, 1.4, 0, 20, 3, 20)
    ],
    navigation: navigationProfile(),
    presentation: { themeId: "scrap-yard", accent: "#ffcf4b", skyline: "salvage-bay" }
  }),
  course("course.crown-collapse", "spawn.crown", {
    bounds: { min: { x: 59, y: -7, z: -13 }, max: { x: 85, y: 9, z: 13 } },
    staticLayout: [
      staticBox("crown.north", "platform", 72, 0, -5.2, 18, 0.8, 5, "ice", "slick"),
      staticBox("crown.south", "platform", 72, 0, 5.2, 18, 0.8, 5, "ice", "slick"),
      staticBox("crown.apron-north", "platform", 72, 0, -2.15, 18, 0.8, 1.1, "course", "walkable"),
      staticBox("crown.apron-south", "platform", 72, 0, 2.15, 18, 0.8, 1.1, "course", "walkable")
    ],
    hazards: [
      hazardPlacement(
        "crown.collapse-band",
        "hazard.crown.floor",
        72,
        0.35,
        0,
        19,
        0.7,
        3.2,
        "z",
        6,
        0
      ),
      hazardPlacement(
        "crown.shrinking-zone",
        "hazard.crown.zone",
        72,
        1.4,
        0,
        21,
        3,
        21,
        "x",
        0,
        8
      ),
      hazardPlacement(
        "crown.sweeper",
        "hazard.crown.sweeper",
        72,
        1.05,
        0,
        17,
        0.55,
        0.55,
        "y",
        0,
        10
      ),
      hazardPlacement(
        "crown.launch-pad",
        "hazard.crown.bounce",
        72,
        0.55,
        -5.2,
        4,
        0.3,
        3,
        "y",
        0,
        13
      )
    ],
    props: [propSphere("crown.prop.core", 72, 1.1, 0, 1, 3.2, "presentation.crown-core")],
    volumes: [
      volume("crown.kill", "kill", 72, -5, 0, 32, 4, 32),
      volume("crown.safe-zone", "safe-zone", 72, 1.3, 0, 20, 3, 20)
    ],
    navigation: navigationProfile(),
    presentation: { themeId: "crown-collapse", accent: "#ff5b55", skyline: "champion-vault" }
  })
];

const stages: ArenaStageDefinition[] = [
  stage("stage.circuit-forge", "qualifier", "course.circuit-forge", 6, 5_400, ["item.foam-ball"]),
  stage(
    "stage.scrap-yard",
    "brawl",
    "course.scrap-yard",
    3,
    5_400,
    items.map(({ id }) => id)
  ),
  stage("stage.crown-collapse", "final", "course.crown-collapse", 1, 4_500, [
    "item.foam-ball",
    "item.foam-hammer",
    "item.gravity-orb",
    "item.spring-glove"
  ])
];

const matchRules: ArenaMatchRuleDefinition[] = [
  {
    id: ARENA_DEFAULT_MATCH_RULE_ID,
    participantCount: 8,
    stages: stages.map(({ id }) => ref(ARENA_STAGE_TYPE, id))
  }
];

export const arenaContentPack: DataPack = {
  id: ARENA_CONTENT_PACK_ID,
  version: ARENA_CONTENT_VERSION,
  namespace: "knockout-arena",
  entries: [
    ...motorProfiles.map((data) => entry(ARENA_MOTOR_PROFILE_TYPE, data)),
    ...botProfiles.map((data) => entry(ARENA_BOT_PROFILE_TYPE, data)),
    ...items.map((data) => entry(ARENA_ITEM_TYPE, data)),
    ...botArchetypes.map((data) => entry(ARENA_BOT_ARCHETYPE_TYPE, data)),
    ...hazards.map((data) => entry(ARENA_HAZARD_TYPE, data)),
    ...spawnSets.map((data) => entry(ARENA_SPAWN_SET_TYPE, data)),
    ...courses.map((data) => entry(ARENA_COURSE_TYPE, data)),
    ...stages.map((data) => entry(ARENA_STAGE_TYPE, data)),
    ...matchRules.map((data) => entry(ARENA_MATCH_RULE_TYPE, data))
  ]
};

function item(
  id: string,
  kind: ArenaItemDefinition["kind"],
  definition: Omit<ArenaItemDefinition, "id" | "kind">
): ArenaItemDefinition {
  return { id, kind, ...definition };
}

function physicsItem(
  shape: ArenaItemDefinition["physics"]["shape"],
  mass: number,
  friction: number,
  restitution: number,
  maxLinearSpeed: number,
  lifetimeTicks: number,
  maxBounces: number
): ArenaItemDefinition["physics"] {
  return {
    shape,
    mass,
    friction,
    restitution,
    continuousCollisionDetection: true,
    maxLinearSpeed,
    lifetimeTicks,
    maxBounces
  };
}

function carryItem(
  speedMultiplier: number,
  jumpMultiplier: number,
  dropPolicy: ArenaItemDefinition["carry"]["dropPolicy"]
): ArenaItemDefinition["carry"] {
  return { socket: "hand.primary", speedMultiplier, jumpMultiplier, dropPolicy };
}

function actionItem(
  mode: ArenaItemDefinition["action"]["mode"],
  windupTicks: number,
  maxChargeTicks: number,
  activeTicks: number,
  cooldownTicks: number,
  launchSpeed: number,
  baseImpulse: number,
  areaRadius: number
): ArenaItemDefinition["action"] {
  return {
    mode,
    windupTicks,
    maxChargeTicks,
    activeTicks,
    cooldownTicks,
    launchSpeed,
    baseImpulse,
    areaRadius
  };
}

function effectItem(
  impulseMode: ArenaItemDefinition["effect"]["impulseMode"],
  instabilityDelta: number,
  staggerMultiplier: number
): ArenaItemDefinition["effect"] {
  return { impulseMode, instabilityDelta, staggerMultiplier };
}

function bot(
  id: string,
  role: ArenaBotArchetypeDefinition["role"],
  profileId: string,
  preferredItems: string[],
  goalWeights: ArenaBotArchetypeDefinition["goalWeights"]
): ArenaBotArchetypeDefinition {
  return {
    id,
    role,
    profile: ref(ARENA_BOT_PROFILE_TYPE, profileId),
    motor: ref(ARENA_MOTOR_PROFILE_TYPE, "motor.standard"),
    preferredItems: preferredItems.map((itemId) => ref(ARENA_ITEM_TYPE, itemId)),
    goalWeights
  };
}

function botProfile(
  id: string,
  reactionTicks: number,
  perceptionIntervalTicks: number,
  decisionIntervalTicks: number,
  memoryTicks: number,
  memoryLimit: number,
  perceptionRadius: number,
  maxOpponents: number,
  maxItems: number,
  hazardLookaheadTicks: number,
  aimErrorRadians: number,
  aggression: number,
  riskTolerance: number,
  commitmentTicks: number,
  recoveryTicks: number
): ArenaBotSkillProfileDefinition {
  return {
    id,
    reactionTicks,
    perceptionIntervalTicks,
    decisionIntervalTicks,
    memoryTicks,
    memoryLimit,
    perceptionRadius,
    maxOpponents,
    maxItems,
    hazardLookaheadTicks,
    aimErrorRadians,
    aggression,
    riskTolerance,
    commitmentTicks,
    recoveryTicks
  };
}

function hazard(
  id: string,
  kind: ArenaHazardDefinition["kind"],
  bodyKind: ArenaHazardDefinition["bodyKind"],
  periodTicks: number,
  phaseTicks: number,
  activeTicks: number,
  activationProgress = 0
): ArenaHazardDefinition {
  return {
    id,
    kind,
    bodyKind,
    schedule: { periodTicks, phaseTicks, activeTicks, activationProgress }
  };
}

function spawnSet(id: string, points: ArenaSpawnPointDefinition[]): ArenaSpawnSetDefinition {
  return { id, points };
}

function participantPoints(count: number, z: number, centerX = 0): ArenaSpawnPointDefinition[] {
  const halfSpan = Math.min(4.8, ((count - 1) * 1.7) / 2);
  const orderedOffsets = Array.from(
    { length: count },
    (_, index) => -halfSpan + (index / Math.max(1, count - 1)) * halfSpan * 2
  );
  if (orderedOffsets.length >= 2) {
    const left = orderedOffsets.shift()!;
    const right = orderedOffsets.pop()!;
    orderedOffsets.unshift(left, right);
  }
  return orderedOffsets.map((offset, index) => ({
    id: `participant.${index}`,
    kind: "participant" as const,
    position: { x: centerX + offset, y: 1.75, z }
  }));
}

function itemPoints(
  ids: string[],
  centerX = 0,
  z = -1.5,
  idOffset = 0
): ArenaSpawnPointDefinition[] {
  return ids.map((id, index) => ({
    id: `item.${idOffset + index}`,
    kind: "item",
    position: { x: centerX + (index - (ids.length - 1) / 2) * 2.4, y: 1.2, z },
    definition: ref(ARENA_ITEM_TYPE, id)
  }));
}

function course(
  id: string,
  spawnSetId: string,
  definition: Omit<ArenaCourseDefinition, "id" | "definitionVersion" | "spawnSet">,
  version = 1
): ArenaCourseDefinition {
  return {
    id,
    definitionVersion: `${id}.v${version}`,
    spawnSet: ref(ARENA_SPAWN_SET_TYPE, spawnSetId),
    ...definition
  };
}

function courseSideWalls(
  prefix: string,
  x: number,
  centerZ: number,
  depth: number
): ArenaStaticPlacementDefinition[] {
  return [-1, 1].map((side) =>
    staticBox(
      `${prefix}.rail.${side < 0 ? "left" : "right"}`,
      "wall",
      side * x,
      1.35,
      centerZ,
      0.7,
      2.7,
      depth,
      "course"
    )
  );
}

function staticBox(
  id: string,
  role: ArenaStaticPlacementDefinition["role"],
  x: number,
  y: number,
  z: number,
  width: number,
  height: number,
  depth: number,
  material: ArenaStaticPlacementDefinition["material"],
  navigationArea?: ArenaStaticPlacementDefinition["navigationArea"]
): ArenaStaticPlacementDefinition {
  return {
    id,
    role,
    position: { x, y, z },
    size: { width, height, depth },
    material,
    ...(navigationArea === undefined ? {} : { navigationArea })
  };
}

function hazardPlacement(
  id: string,
  definitionId: string,
  x: number,
  y: number,
  z: number,
  width: number,
  height: number,
  depth: number,
  axis: ArenaHazardPlacementDefinition["axis"],
  travel: number,
  strength: number
): ArenaHazardPlacementDefinition {
  return {
    id,
    definition: ref(ARENA_HAZARD_TYPE, definitionId),
    position: { x, y, z },
    size: { width, height, depth },
    axis,
    travel,
    strength
  };
}

function propSphere(
  id: string,
  x: number,
  y: number,
  z: number,
  radius: number,
  mass: number,
  presentationId: string
): ArenaDynamicPropPlacementDefinition {
  return {
    id,
    shape: { type: "sphere", radius },
    position: { x, y, z },
    mass,
    material: "prop",
    presentationId
  };
}

function propBox(
  id: string,
  x: number,
  y: number,
  z: number,
  width: number,
  height: number,
  depth: number,
  mass: number,
  presentationId: string
): ArenaDynamicPropPlacementDefinition {
  return {
    id,
    shape: { type: "box", width, height, depth },
    position: { x, y, z },
    mass,
    material: "prop",
    presentationId
  };
}

function volume(
  id: string,
  kind: ArenaGameplayVolumeDefinition["kind"],
  x: number,
  y: number,
  z: number,
  width: number,
  height: number,
  depth: number,
  routeOrder?: number
): ArenaGameplayVolumeDefinition {
  return {
    id,
    kind,
    position: { x, y, z },
    size: { width, height, depth },
    ...(routeOrder === undefined ? {} : { routeOrder })
  };
}

function navigationProfile(): ArenaCourseDefinition["navigation"] {
  return { agentRadius: 0.52, agentHeight: 1.89, maxClimb: 0.45, maxSlopeDegrees: 46 };
}

function stage(
  id: string,
  kind: ArenaStageDefinition["kind"],
  courseId: string,
  qualificationCount: number,
  durationTicks: number,
  itemIds: string[]
): ArenaStageDefinition {
  return {
    id,
    kind,
    course: ref(ARENA_COURSE_TYPE, courseId),
    qualificationCount,
    durationTicks,
    itemPool: itemIds.map((itemId) => ref(ARENA_ITEM_TYPE, itemId)),
    botArchetypes: botArchetypes.map(({ id: botId }) => ref(ARENA_BOT_ARCHETYPE_TYPE, botId))
  };
}

function entry<T extends { id: string }>(type: string, data: T) {
  return { type, id: data.id, data };
}

function ref<TType extends string>(type: TType, id: string): DataRef<TType> {
  return { type, id };
}
