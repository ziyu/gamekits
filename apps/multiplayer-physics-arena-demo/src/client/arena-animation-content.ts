import type { AnimatorGraphDefinition } from "@gamekits/animator-core";
import type { DataPack } from "@gamekits/data";

export type ArenaPresentedBaseState =
  | "idle"
  | "run"
  | "jump"
  | "fall"
  | "dive"
  | "recovery"
  | "stagger"
  | "eliminated";

export const ARENA_ANIMATOR_BINDING_ID = "animator.knockout.runner";

const BASE_STATES: Array<{ id: ArenaPresentedBaseState; durationMs: number; loop: boolean }> = [
  { id: "idle", durationMs: 1_200, loop: true },
  { id: "run", durationMs: 620, loop: true },
  { id: "jump", durationMs: 420, loop: true },
  { id: "fall", durationMs: 480, loop: true },
  { id: "dive", durationMs: 380, loop: true },
  { id: "recovery", durationMs: 260, loop: true },
  { id: "stagger", durationMs: 360, loop: true },
  { id: "eliminated", durationMs: 900, loop: true }
];

const ARENA_GRAPH: AnimatorGraphDefinition = {
  id: "graph.knockout.runner",
  parameters: [
    { id: "moving", type: "boolean", default: false },
    { id: "speed", type: "number", default: 1 },
    { id: "airborne", type: "boolean", default: false },
    { id: "falling", type: "boolean", default: false },
    { id: "diving", type: "boolean", default: false },
    { id: "recovering", type: "boolean", default: false },
    { id: "staggered", type: "boolean", default: false },
    { id: "eliminated", type: "boolean", default: false },
    { id: "carrying", type: "boolean", default: false }
  ],
  layers: [
    {
      id: "base",
      initialState: "idle",
      states: BASE_STATES.map(({ id, loop }) => ({
        id,
        clip: id,
        loop,
        ...(id === "run" ? { speedParameter: "speed" } : {})
      })),
      transitions: [
        transition("eliminated", [{ parameter: "eliminated", operator: "truthy" }], 100),
        transition("stagger", [{ parameter: "staggered", operator: "truthy" }], 90),
        transition("dive", [{ parameter: "diving", operator: "truthy" }], 80),
        transition("recovery", [{ parameter: "recovering", operator: "truthy" }], 70),
        transition(
          "fall",
          [
            { parameter: "airborne", operator: "truthy" },
            { parameter: "falling", operator: "truthy" }
          ],
          60
        ),
        transition(
          "jump",
          [
            { parameter: "airborne", operator: "truthy" },
            { parameter: "falling", operator: "falsy" }
          ],
          50
        ),
        transition(
          "run",
          [
            { parameter: "moving", operator: "truthy" },
            { parameter: "airborne", operator: "falsy" },
            { parameter: "diving", operator: "falsy" },
            { parameter: "recovering", operator: "falsy" },
            { parameter: "staggered", operator: "falsy" },
            { parameter: "eliminated", operator: "falsy" }
          ],
          20
        ),
        transition(
          "idle",
          [
            { parameter: "moving", operator: "falsy" },
            { parameter: "airborne", operator: "falsy" },
            { parameter: "diving", operator: "falsy" },
            { parameter: "recovering", operator: "falsy" },
            { parameter: "staggered", operator: "falsy" },
            { parameter: "eliminated", operator: "falsy" }
          ],
          10
        )
      ]
    },
    {
      id: "action",
      initialState: "rest",
      priority: 20,
      states: [{ id: "rest", clip: "idle", loop: true }]
    },
    {
      id: "reaction",
      initialState: "rest",
      priority: 30,
      states: [{ id: "rest", clip: "idle", loop: true }]
    }
  ],
  oneShots: [
    {
      id: "jump-accent",
      layer: "action",
      clip: "jump-accent",
      priority: 10,
      repeat: "ignore"
    },
    {
      id: "item-action",
      layer: "action",
      clip: "item-action",
      priority: 20,
      repeat: "ignore"
    },
    {
      id: "impact",
      layer: "reaction",
      clip: "impact",
      priority: 100,
      interrupt: "always",
      repeat: "ignore"
    }
  ]
};

export const ARENA_ANIMATOR_PACK: DataPack = {
  id: "knockout.presentation",
  version: "1.0.0",
  entries: [
    {
      type: "asset.definition",
      id: "asset.knockout.procedural",
      data: {
        id: "asset.knockout.procedural",
        type: "custom",
        source: { type: "memory", data: new Uint8Array([1]) }
      }
    },
    ...BASE_STATES.map(({ id, durationMs, loop }) => clip(id, durationMs, loop)),
    clip("jump-accent", 180),
    clip("item-action", 320),
    clip("impact", 260),
    clip("windup", 480),
    { type: "animator.graph", id: ARENA_GRAPH.id, data: ARENA_GRAPH },
    {
      type: "animator.binding",
      id: ARENA_ANIMATOR_BINDING_ID,
      data: {
        id: ARENA_ANIMATOR_BINDING_ID,
        graph: { type: "animator.graph", id: ARENA_GRAPH.id },
        clips: Object.fromEntries(
          [
            ...BASE_STATES.map(({ id }) => id),
            "jump-accent",
            "item-action",
            "impact",
            "windup"
          ].map((id) => [id, { type: "animation.clip" as const, id: `clip.knockout.${id}` }])
        ),
        fallbackClip: "idle",
        phaseMappings: [
          {
            abilityId: "arena.item",
            phase: "windup",
            layer: "action",
            clip: "windup"
          }
        ]
      }
    }
  ]
};

function transition(
  to: ArenaPresentedBaseState,
  conditions: NonNullable<
    AnimatorGraphDefinition["layers"][number]["transitions"]
  >[number]["conditions"],
  priority: number
): NonNullable<AnimatorGraphDefinition["layers"][number]["transitions"]>[number] {
  return { from: "*", to, conditions, priority };
}

function clip(id: string, durationMs: number, loop = false): DataPack["entries"][number] {
  return {
    type: "animation.clip",
    id: `clip.knockout.${id}`,
    data: {
      id: `clip.knockout.${id}`,
      asset: { assetId: "asset.knockout.procedural", type: "custom" },
      backendClip: id,
      durationMs,
      loop
    }
  };
}
