import type { DataPackEntry } from "@gamekits/data";

export const sandboxObjectiveEntries: DataPackEntry[] = [
  {
    type: "sandbox.objectivePhase",
    id: "objective.sandbox.phase.bootstrap",
    data: {
      id: "objective.sandbox.phase.bootstrap",
      label: "Stock the Campfire",
      targetResources: 220,
      unlocks: ["mode.build"],
      reward: "Enable workshop build automation",
      tags: ["sandbox", "objective"]
    }
  },
  {
    type: "sandbox.objectivePhase",
    id: "objective.sandbox.phase.fabricate",
    data: {
      id: "objective.sandbox.phase.fabricate",
      label: "Raise the Watchtower",
      targetResources: 420,
      unlocks: ["recipe.sandbox.build_watchtower", "mode.defend"],
      reward: "Enable defend mode and visible tower layers",
      tags: ["sandbox", "objective", "asset"]
    }
  },
  {
    type: "sandbox.objectivePhase",
    id: "objective.sandbox.phase.decode",
    data: {
      id: "objective.sandbox.phase.decode",
      label: "Prepare for Nightfall",
      targetResources: 720,
      unlocks: ["recipe.sandbox.campfire_supply", "mode.gather"],
      reward: "Enable stronger worker automation",
      tags: ["sandbox", "objective", "data"]
    }
  }
];
