import { defineComponent } from "@gamekits/world";
import type {
  AiLabObstacleKind,
  AiLabResourceKind,
  AiLabResourceVariant,
  AiLabSpecies
} from "./types";

export type AiLabCreatureState = {
  id: string;
  name: string;
  species: AiLabSpecies;
  hunger: number;
  thirst: number;
  energy: number;
  health: number;
};

export type AiLabPositionState = {
  x: number;
  y: number;
  velocityX: number;
  velocityY: number;
};

export type AiLabResourceState = {
  id: string;
  kind: AiLabResourceKind;
  variant: AiLabResourceVariant;
  amount: number;
  capacity: number;
  regenerationPerSecond: number;
};

export type AiLabObstacleState = {
  id: string;
  kind: AiLabObstacleKind;
  label: string;
  width: number;
  height: number;
  enabled: boolean;
};

export const AiLabCreature = defineComponent<AiLabCreatureState>({
  id: "sandbox.ai-lab.creature",
  create: (data = {}) => ({
    id: data.id ?? "creature",
    name: data.name ?? "无名小兽",
    species: data.species ?? "rabbit",
    hunger: data.hunger ?? 0,
    thirst: data.thirst ?? 0,
    energy: data.energy ?? 1,
    health: data.health ?? 1
  })
});

export const AiLabPosition = defineComponent<AiLabPositionState>({
  id: "sandbox.ai-lab.position",
  create: (data = {}) => ({
    x: data.x ?? 50,
    y: data.y ?? 50,
    velocityX: data.velocityX ?? 0,
    velocityY: data.velocityY ?? 0
  })
});

export const AiLabResource = defineComponent<AiLabResourceState>({
  id: "sandbox.ai-lab.resource",
  create: (data = {}) => ({
    id: data.id ?? "resource",
    kind: data.kind ?? "food",
    variant: data.variant ?? "berries",
    amount: data.amount ?? 1,
    capacity: data.capacity ?? 1,
    regenerationPerSecond: data.regenerationPerSecond ?? 0
  })
});

export const AiLabObstacle = defineComponent<AiLabObstacleState>({
  id: "sandbox.ai-lab.obstacle",
  create: (data = {}) => ({
    id: data.id ?? "obstacle",
    kind: data.kind ?? "fallen-log",
    label: data.label ?? "倒木",
    width: data.width ?? 6,
    height: data.height ?? 3,
    enabled: data.enabled ?? true
  })
});

export const AI_LAB_ANIMAL_BLUEPRINTS: ReadonlyArray<
  AiLabCreatureState & Pick<AiLabPositionState, "x" | "y">
> = [
  {
    id: "chestnut",
    name: "栗子",
    species: "rabbit",
    x: 21,
    y: 24,
    hunger: 0.72,
    thirst: 0.38,
    energy: 0.82,
    health: 1
  },
  {
    id: "dandelion",
    name: "蒲公英",
    species: "rabbit",
    x: 31,
    y: 31,
    hunger: 0.3,
    thirst: 0.76,
    energy: 0.7,
    health: 0.94
  },
  {
    id: "cloud",
    name: "小云",
    species: "rabbit",
    x: 17,
    y: 68,
    hunger: 0.54,
    thirst: 0.45,
    energy: 0.34,
    health: 0.9
  },
  {
    id: "sesame",
    name: "芝麻",
    species: "rabbit",
    x: 44,
    y: 76,
    hunger: 0.2,
    thirst: 0.28,
    energy: 0.88,
    health: 1
  },
  {
    id: "pinecone",
    name: "松果",
    species: "squirrel",
    x: 72,
    y: 19,
    hunger: 0.65,
    thirst: 0.32,
    energy: 0.76,
    health: 1
  },
  {
    id: "maple",
    name: "枫叶",
    species: "squirrel",
    x: 82,
    y: 28,
    hunger: 0.28,
    thirst: 0.68,
    energy: 0.66,
    health: 0.96
  },
  {
    id: "hazel",
    name: "榛子",
    species: "squirrel",
    x: 67,
    y: 72,
    hunger: 0.47,
    thirst: 0.37,
    energy: 0.42,
    health: 0.9
  },
  {
    id: "amber",
    name: "琥珀",
    species: "squirrel",
    x: 53,
    y: 18,
    hunger: 0.36,
    thirst: 0.3,
    energy: 0.91,
    health: 1
  },
  {
    id: "thistle",
    name: "蓟蓟",
    species: "hedgehog",
    x: 38,
    y: 48,
    hunger: 0.8,
    thirst: 0.44,
    energy: 0.67,
    health: 0.93
  },
  {
    id: "pepper",
    name: "胡椒",
    species: "hedgehog",
    x: 61,
    y: 57,
    hunger: 0.34,
    thirst: 0.71,
    energy: 0.73,
    health: 0.98
  },
  {
    id: "moss",
    name: "青苔",
    species: "hedgehog",
    x: 77,
    y: 83,
    hunger: 0.52,
    thirst: 0.35,
    energy: 0.29,
    health: 0.88
  },
  {
    id: "cocoa",
    name: "可可",
    species: "hedgehog",
    x: 27,
    y: 84,
    hunger: 0.24,
    thirst: 0.26,
    energy: 0.8,
    health: 1
  },
  {
    id: "millet",
    name: "小米",
    species: "mouse",
    x: 48,
    y: 35,
    hunger: 0.58,
    thirst: 0.49,
    energy: 0.74,
    health: 0.96
  },
  {
    id: "bean",
    name: "豆豆",
    species: "mouse",
    x: 58,
    y: 39,
    hunger: 0.33,
    thirst: 0.61,
    energy: 0.57,
    health: 0.92
  },
  {
    id: "rice",
    name: "米粒",
    species: "mouse",
    x: 36,
    y: 65,
    hunger: 0.69,
    thirst: 0.25,
    energy: 0.86,
    health: 1
  },
  {
    id: "dew",
    name: "露珠",
    species: "mouse",
    x: 88,
    y: 59,
    hunger: 0.22,
    thirst: 0.4,
    energy: 0.37,
    health: 0.89
  }
];

export const AI_LAB_RESOURCE_BLUEPRINTS: ReadonlyArray<
  AiLabResourceState & Pick<AiLabPositionState, "x" | "y">
> = [
  {
    id: "berry-west",
    kind: "food",
    variant: "berries",
    x: 15,
    y: 17,
    amount: 18,
    capacity: 20,
    regenerationPerSecond: 0.48
  },
  {
    id: "clover-north",
    kind: "food",
    variant: "clover",
    x: 47,
    y: 13,
    amount: 20,
    capacity: 24,
    regenerationPerSecond: 0.56
  },
  {
    id: "seed-east",
    kind: "food",
    variant: "seeds",
    x: 85,
    y: 22,
    amount: 16,
    capacity: 18,
    regenerationPerSecond: 0.42
  },
  {
    id: "berry-south",
    kind: "food",
    variant: "berries",
    x: 24,
    y: 77,
    amount: 14,
    capacity: 20,
    regenerationPerSecond: 0.52
  },
  {
    id: "mushroom-glen",
    kind: "food",
    variant: "mushrooms",
    x: 78,
    y: 73,
    amount: 13,
    capacity: 16,
    regenerationPerSecond: 0.36
  },
  {
    id: "seed-meadow",
    kind: "food",
    variant: "seeds",
    x: 53,
    y: 62,
    amount: 15,
    capacity: 18,
    regenerationPerSecond: 0.44
  },
  {
    id: "pond-west",
    kind: "water",
    variant: "pond",
    x: 22,
    y: 49,
    amount: 26,
    capacity: 28,
    regenerationPerSecond: 1.8
  },
  {
    id: "spring-east",
    kind: "water",
    variant: "spring",
    x: 74,
    y: 43,
    amount: 22,
    capacity: 24,
    regenerationPerSecond: 1.5
  },
  {
    id: "old-burrow",
    kind: "shelter",
    variant: "burrow",
    x: 42,
    y: 25,
    amount: 1,
    capacity: 1,
    regenerationPerSecond: 0
  },
  {
    id: "hollow-log",
    kind: "shelter",
    variant: "hollow-log",
    x: 61,
    y: 84,
    amount: 1,
    capacity: 1,
    regenerationPerSecond: 0
  }
];

export const AI_LAB_OBSTACLE_BLUEPRINTS: ReadonlyArray<
  AiLabObstacleState & Pick<AiLabPositionState, "x" | "y">
> = [
  {
    id: "west-fallen-log",
    kind: "fallen-log",
    label: "西侧倒木",
    x: 18,
    y: 20.5,
    width: 7,
    height: 3.2,
    enabled: true
  },
  {
    id: "central-rock",
    kind: "rock",
    label: "中央岩石",
    x: 52,
    y: 47,
    width: 5.5,
    height: 5.5,
    enabled: true
  }
];

export function creatureSpeed(species: AiLabSpecies): number {
  if (species === "squirrel") return 7.2;
  if (species === "mouse") return 6.6;
  if (species === "rabbit") return 6;
  return 4.7;
}

export function creatureMetabolism(species: AiLabSpecies): number {
  if (species === "mouse") return 1.18;
  if (species === "squirrel") return 1.08;
  if (species === "rabbit") return 1;
  return 0.86;
}
