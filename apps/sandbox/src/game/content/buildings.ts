import type { DataPackEntry } from "@gamekits/data";

export const sandboxBuildingEntries: DataPackEntry[] = [
  {
    type: "sandbox.sceneObject",
    id: "scene.sandbox.campfire",
    data: {
      id: "scene.sandbox.campfire",
      label: "Campfire",
      role: "campfire",
      x: 50,
      y: 50,
      renderObjectId: "render.sandbox.campfire",
      renderRigId: "renderRig.sandbox.campfire",
      gasActorDefinitionId: "gas.actor.sandbox.building",
      buildingDefinitionId: "building.sandbox.campfire",
      capacity: 260,
      tags: ["sandbox", "building", "objective"]
    }
  },
  {
    type: "sandbox.sceneObject",
    id: "scene.sandbox.forest",
    data: {
      id: "scene.sandbox.forest",
      label: "Forest",
      role: "resource-node",
      x: 24,
      y: 34,
      renderObjectId: "render.sandbox.resource_node",
      renderRigId: "renderRig.sandbox.resource_node",
      buildingDefinitionId: "building.sandbox.forest",
      capacity: 90,
      productionRate: 7,
      recipeId: "recipe.sandbox.gather_wood",
      tags: ["sandbox", "resource", "wood"]
    }
  },
  {
    type: "sandbox.sceneObject",
    id: "scene.sandbox.quarry",
    data: {
      id: "scene.sandbox.quarry",
      label: "Quarry",
      role: "resource-node",
      x: 76,
      y: 36,
      renderObjectId: "render.sandbox.resource_node",
      renderRigId: "renderRig.sandbox.resource_node",
      buildingDefinitionId: "building.sandbox.quarry",
      capacity: 76,
      productionRate: 5.5,
      recipeId: "recipe.sandbox.gather_stone",
      tags: ["sandbox", "resource", "stone"]
    }
  },
  {
    type: "sandbox.sceneObject",
    id: "scene.sandbox.berry_patch",
    data: {
      id: "scene.sandbox.berry_patch",
      label: "Berry Patch",
      role: "resource-node",
      x: 22,
      y: 74,
      renderObjectId: "render.sandbox.resource_node",
      renderRigId: "renderRig.sandbox.resource_node",
      buildingDefinitionId: "building.sandbox.berry_patch",
      capacity: 62,
      productionRate: 6.5,
      recipeId: "recipe.sandbox.gather_food",
      tags: ["sandbox", "resource", "food"]
    }
  },
  {
    type: "sandbox.sceneObject",
    id: "scene.sandbox.storage",
    data: {
      id: "scene.sandbox.storage",
      label: "Storage",
      role: "storage",
      x: 38,
      y: 56,
      renderObjectId: "render.sandbox.storage",
      renderRigId: "renderRig.sandbox.storage",
      buildingDefinitionId: "building.sandbox.storage",
      capacity: 160,
      tags: ["sandbox", "building", "storage"]
    }
  },
  {
    type: "sandbox.sceneObject",
    id: "scene.sandbox.workshop",
    data: {
      id: "scene.sandbox.workshop",
      label: "Workshop",
      role: "workshop",
      x: 66,
      y: 56,
      renderObjectId: "render.sandbox.workshop",
      renderRigId: "renderRig.sandbox.workshop",
      buildingDefinitionId: "building.sandbox.workshop",
      capacity: 80,
      recipeId: "recipe.sandbox.build_watchtower",
      tags: ["sandbox", "building", "crafting"]
    }
  },
  {
    type: "sandbox.sceneObject",
    id: "scene.sandbox.watchtower",
    data: {
      id: "scene.sandbox.watchtower",
      label: "Watchtower",
      role: "tower",
      x: 72,
      y: 78,
      renderObjectId: "render.sandbox.watchtower",
      renderRigId: "renderRig.sandbox.watchtower",
      gasActorDefinitionId: "gas.actor.sandbox.building",
      buildingDefinitionId: "building.sandbox.watchtower",
      capacity: 40,
      tags: ["sandbox", "building", "defense"]
    }
  },
  {
    type: "sandbox.sceneObject",
    id: "scene.sandbox.monster_den",
    data: {
      id: "scene.sandbox.monster_den",
      label: "Monster Den",
      role: "monster",
      x: 86,
      y: 64,
      renderObjectId: "render.sandbox.monster",
      renderRigId: "renderRig.sandbox.monster",
      gasActorDefinitionId: "gas.actor.sandbox.monster",
      buildingDefinitionId: "building.sandbox.monster_den",
      capacity: 0,
      tags: ["sandbox", "threat", "monster"]
    }
  },
  {
    type: "sandbox.building",
    id: "building.sandbox.campfire",
    data: {
      id: "building.sandbox.campfire",
      label: "Campfire",
      zone: "camp",
      priority: 5,
      initialHealth: 96,
      baseHeat: 12,
      throughput: 1.2,
      supportedTasks: ["haul", "repair"],
      tags: ["sandbox", "building", "camp"]
    }
  },
  {
    type: "sandbox.building",
    id: "building.sandbox.forest",
    data: {
      id: "building.sandbox.forest",
      label: "Forest",
      zone: "forest",
      priority: 4,
      initialHealth: 100,
      baseHeat: 4,
      throughput: 1.15,
      supportedTasks: ["gather"],
      tags: ["sandbox", "resource", "forest"]
    }
  },
  {
    type: "sandbox.building",
    id: "building.sandbox.quarry",
    data: {
      id: "building.sandbox.quarry",
      label: "Quarry",
      zone: "quarry",
      priority: 4,
      initialHealth: 100,
      baseHeat: 6,
      throughput: 0.95,
      supportedTasks: ["gather"],
      tags: ["sandbox", "resource", "quarry"]
    }
  },
  {
    type: "sandbox.building",
    id: "building.sandbox.berry_patch",
    data: {
      id: "building.sandbox.berry_patch",
      label: "Berry Patch",
      zone: "food",
      priority: 3,
      initialHealth: 100,
      baseHeat: 3,
      throughput: 1.05,
      supportedTasks: ["gather"],
      tags: ["sandbox", "resource", "food"]
    }
  },
  {
    type: "sandbox.building",
    id: "building.sandbox.storage",
    data: {
      id: "building.sandbox.storage",
      label: "Storage",
      zone: "camp",
      priority: 4,
      initialHealth: 92,
      baseHeat: 8,
      throughput: 1,
      supportedTasks: ["haul", "repair"],
      tags: ["sandbox", "building", "storage"]
    }
  },
  {
    type: "sandbox.building",
    id: "building.sandbox.workshop",
    data: {
      id: "building.sandbox.workshop",
      label: "Workshop",
      zone: "workshop",
      priority: 3,
      initialHealth: 88,
      baseHeat: 10,
      throughput: 0.9,
      supportedTasks: ["haul", "build", "repair"],
      tags: ["sandbox", "building", "workshop"]
    }
  },
  {
    type: "sandbox.building",
    id: "building.sandbox.watchtower",
    data: {
      id: "building.sandbox.watchtower",
      label: "Watchtower",
      zone: "defense",
      priority: 5,
      initialHealth: 86,
      baseHeat: 8,
      throughput: 1,
      supportedTasks: ["defend", "repair"],
      tags: ["sandbox", "building", "defense"]
    }
  },
  {
    type: "sandbox.building",
    id: "building.sandbox.monster_den",
    data: {
      id: "building.sandbox.monster_den",
      label: "Monster Den",
      zone: "wilds",
      priority: 6,
      initialHealth: 100,
      baseHeat: 0,
      throughput: 1,
      supportedTasks: ["defend"],
      tags: ["sandbox", "monster", "wilds"]
    }
  },
  {
    type: "sandbox.recipe",
    id: "recipe.sandbox.gather_wood",
    data: {
      id: "recipe.sandbox.gather_wood",
      label: "Gather Wood",
      input: [],
      output: { resource: "resource", amount: 1 },
      durationMs: 1000,
      buildingRole: "resource-node",
      tags: ["sandbox", "production", "wood"]
    }
  },
  {
    type: "sandbox.recipe",
    id: "recipe.sandbox.gather_stone",
    data: {
      id: "recipe.sandbox.gather_stone",
      label: "Gather Stone",
      input: [],
      output: { resource: "resource", amount: 1 },
      durationMs: 1200,
      buildingRole: "resource-node",
      tags: ["sandbox", "production", "stone"]
    }
  },
  {
    type: "sandbox.recipe",
    id: "recipe.sandbox.gather_food",
    data: {
      id: "recipe.sandbox.gather_food",
      label: "Gather Food",
      input: [],
      output: { resource: "resource", amount: 1 },
      durationMs: 900,
      buildingRole: "resource-node",
      tags: ["sandbox", "production", "food"]
    }
  },
  {
    type: "sandbox.recipe",
    id: "recipe.sandbox.campfire_supply",
    data: {
      id: "recipe.sandbox.campfire_supply",
      label: "Campfire Supply",
      input: [{ resource: "resource", amount: 40 }],
      output: { resource: "objective", amount: 40 },
      durationMs: 1500,
      buildingRole: "campfire",
      tags: ["sandbox", "production", "objective"]
    }
  },
  {
    type: "sandbox.recipe",
    id: "recipe.sandbox.build_watchtower",
    data: {
      id: "recipe.sandbox.build_watchtower",
      label: "Build Watchtower",
      input: [{ resource: "resource", amount: 24 }],
      output: { resource: "materials", amount: 1 },
      durationMs: 2200,
      buildingRole: "workshop",
      tags: ["sandbox", "production", "construction"]
    }
  },
  {
    type: "sandbox.route",
    id: "route.forest.storage",
    data: {
      id: "route.forest.storage",
      fromObjectId: "scene.sandbox.forest",
      toObjectId: "scene.sandbox.storage",
      capacity: 42,
      visual: "resource",
      tags: ["sandbox", "route"]
    }
  },
  {
    type: "sandbox.route",
    id: "route.quarry.storage",
    data: {
      id: "route.quarry.storage",
      fromObjectId: "scene.sandbox.quarry",
      toObjectId: "scene.sandbox.storage",
      capacity: 36,
      visual: "resource",
      tags: ["sandbox", "route"]
    }
  },
  {
    type: "sandbox.route",
    id: "route.berry.storage",
    data: {
      id: "route.berry.storage",
      fromObjectId: "scene.sandbox.berry_patch",
      toObjectId: "scene.sandbox.storage",
      capacity: 32,
      visual: "resource",
      tags: ["sandbox", "route"]
    }
  },
  {
    type: "sandbox.route",
    id: "route.storage.campfire",
    data: {
      id: "route.storage.campfire",
      fromObjectId: "scene.sandbox.storage",
      toObjectId: "scene.sandbox.campfire",
      capacity: 52,
      visual: "resource",
      tags: ["sandbox", "route"]
    }
  },
  {
    type: "sandbox.route",
    id: "route.workshop.campfire",
    data: {
      id: "route.workshop.campfire",
      fromObjectId: "scene.sandbox.workshop",
      toObjectId: "scene.sandbox.campfire",
      capacity: 24,
      visual: "task",
      tags: ["sandbox", "route"]
    }
  },
  {
    type: "sandbox.route",
    id: "route.monster.campfire",
    data: {
      id: "route.monster.campfire",
      fromObjectId: "scene.sandbox.monster_den",
      toObjectId: "scene.sandbox.campfire",
      capacity: 20,
      visual: "threat",
      tags: ["sandbox", "route"]
    }
  }
];
