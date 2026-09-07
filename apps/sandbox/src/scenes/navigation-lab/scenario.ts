import type { NavigationAgentProfileDefinition, NavigationPoint } from "@gamekits/navigation-core";

export type NavigationLabScenarioDefinition = {
  id: string;
  campaignLabel: string;
  title: string;
  mission: string;
  description: string;
  complexity: string;
  mapPrompt: string;
  objectiveTitle: string;
  objectiveDetail: string;
  startLocation: string;
  goalLocation: string;
  startMarker: string;
  goalMarker: string;
  goalKey: string;
  bounds: { minX: number; maxX: number; minY: number; maxY: number };
  start: NavigationPoint;
  goal: NavigationPoint;
  fieldAgentStarts: readonly NavigationPoint[];
  fieldSamplePoints: readonly NavigationPoint[];
  controls: {
    bridge: {
      label: string;
      detail: string;
      openState: string;
      blockedState: string;
    };
    marsh: {
      label: string;
      detail: string;
      normalState: string;
      costlyState: string;
      blockedState: string;
    };
    portal: {
      label: string;
      detail: string;
      disabledState: string;
      enabledState: string;
    };
    lockdown: {
      label: string;
      detail: string;
      hudLabel: string;
    };
    resetLabel: string;
  };
};

export const ASHEN_FORD_SCENARIO = {
  id: "ashen-ford",
  campaignLabel: "Navigation Playground · Campaign Map 04",
  title: "Ashen Ford",
  mission: "Escort the relief party from Ember Camp to Northwatch",
  description: "A compact three-crossing field used for fast route and invalidation checks.",
  complexity: "Foundation",
  mapPrompt: "Choose a route through the ford",
  objectiveTitle: "Reach Northwatch",
  objectiveDetail: "Keep at least one crossing open",
  startLocation: "Ember Camp",
  goalLocation: "Northwatch",
  startMarker: "DEPART",
  goalMarker: "RELIEF",
  goalKey: "northwatch-relief-yard",
  bounds: { minX: -9.2, maxX: 9.2, minY: -5.2, maxY: 5.2 },
  start: { x: -8, y: 0 },
  goal: { x: 8, y: 0 },
  fieldAgentStarts: [
    { x: -8, y: 0 },
    { x: -7.4, y: -0.8 },
    { x: -7.4, y: 0.8 },
    { x: -6.8, y: -1.6 },
    { x: -6.8, y: 1.6 },
    { x: -6.1, y: -2.4 },
    { x: -6.1, y: 2.4 },
    { x: -5.4, y: -1.1 },
    { x: -5.4, y: 1.1 },
    { x: -4.7, y: -2.2 },
    { x: -4.7, y: 2.2 },
    { x: -4.2, y: 0 }
  ],
  fieldSamplePoints: [
    { x: -8, y: 0 },
    { x: -6, y: 0 },
    { x: -3, y: -3 },
    { x: 3, y: -3 },
    { x: -2, y: 0 },
    { x: 2, y: 0 },
    { x: -3, y: 3 },
    { x: 0, y: 3.5 },
    { x: 3, y: 3 },
    { x: 6, y: 0 },
    { x: 8, y: 0 }
  ],
  controls: {
    bridge: {
      label: "Stone Bridge",
      detail: "Barricade or reopen the central road",
      openState: "Bridge open",
      blockedState: "Bridge barricaded"
    },
    marsh: {
      label: "Reed Marsh",
      detail: "Cycle passable, deep mud, and flooded",
      normalState: "Marsh passable",
      costlyState: "Marsh deep mud",
      blockedState: "Marsh flooded"
    },
    portal: {
      label: "Waystones",
      detail: "Awaken a magical shortcut across the map",
      disabledState: "Waystones dormant",
      enabledState: "Waystones awake"
    },
    lockdown: {
      label: "Lose All Crossings",
      detail: "Force a clear unreachable result",
      hudLabel: "ALL CROSSINGS LOST"
    },
    resetLabel: "Restore Ashen Ford"
  }
} as const satisfies NavigationLabScenarioDefinition;

export const NAVIGATION_LAB_SCENARIO = ASHEN_FORD_SCENARIO;

export const NAVIGATION_LAB_PROFILES = [
  {
    id: "profile.scout",
    radius: 0.35,
    height: 1.6,
    maxSlope: 0.65,
    allowedAreas: ["ground", "road", "ridge", "swamp", "blast-door", "gantry"],
    costOverrides: { ridge: 0.75, gantry: 0.75, swamp: 2.8 },
    tags: ["navigation-lab", "agile"]
  },
  {
    id: "profile.hauler",
    radius: 0.65,
    height: 2.1,
    maxSlope: 0.28,
    allowedAreas: ["ground", "road", "ridge", "swamp", "blast-door", "gantry"],
    costOverrides: { road: 0.85, "blast-door": 0.85, swamp: 1.8 },
    tags: ["navigation-lab", "cargo"]
  },
  {
    id: "profile.heavy",
    radius: 1,
    height: 2.6,
    maxSlope: 0.12,
    allowedAreas: ["ground", "road", "swamp", "blast-door"],
    costOverrides: { "blast-door": 0.95, swamp: 1.05 },
    tags: ["navigation-lab", "heavy"]
  }
] as const satisfies readonly NavigationAgentProfileDefinition[];

export type NavigationLabProfileId = (typeof NAVIGATION_LAB_PROFILES)[number]["id"];

export const NAVIGATION_LAB_UNITS = {
  "profile.scout": {
    label: "Pathfinder",
    shortLabel: "Scout",
    description: "Takes the steep hunter trail when it is faster.",
    marker: "S"
  },
  "profile.hauler": {
    label: "Supply Wagon",
    shortLabel: "Wagon",
    description: "Prefers the road and needs a wide, low-slope crossing.",
    marker: "W"
  },
  "profile.heavy": {
    label: "Iron Guard",
    shortLabel: "Guard",
    description: "Cannot use the ridge trail and tolerates the marsh.",
    marker: "G"
  }
} as const satisfies Record<
  NavigationLabProfileId,
  { label: string; shortLabel: string; description: string; marker: string }
>;
