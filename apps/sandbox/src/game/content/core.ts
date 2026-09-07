import type { DataPackEntry } from "@gamekits/data";

export const sandboxCoreEntries: DataPackEntry[] = [
  {
    type: "sandbox.sceneLayout",
    id: "sceneLayout.sandbox.tiny_camp",
    data: {
      id: "sceneLayout.sandbox.tiny_camp",
      name: "Tiny Camp",
      objectIds: [
        "scene.sandbox.campfire",
        "scene.sandbox.forest",
        "scene.sandbox.quarry",
        "scene.sandbox.berry_patch",
        "scene.sandbox.storage",
        "scene.sandbox.workshop",
        "scene.sandbox.watchtower",
        "scene.sandbox.monster_den"
      ],
      links: [
        {
          id: "path.forest.storage",
          fromObjectId: "scene.sandbox.forest",
          toObjectId: "scene.sandbox.storage",
          routeId: "route.forest.storage"
        },
        {
          id: "path.quarry.storage",
          fromObjectId: "scene.sandbox.quarry",
          toObjectId: "scene.sandbox.storage",
          routeId: "route.quarry.storage"
        },
        {
          id: "path.berry.storage",
          fromObjectId: "scene.sandbox.berry_patch",
          toObjectId: "scene.sandbox.storage",
          routeId: "route.berry.storage"
        },
        {
          id: "path.storage.campfire",
          fromObjectId: "scene.sandbox.storage",
          toObjectId: "scene.sandbox.campfire",
          routeId: "route.storage.campfire"
        },
        {
          id: "path.workshop.campfire",
          fromObjectId: "scene.sandbox.workshop",
          toObjectId: "scene.sandbox.campfire",
          routeId: "route.workshop.campfire"
        },
        {
          id: "path.monster.campfire",
          fromObjectId: "scene.sandbox.monster_den",
          toObjectId: "scene.sandbox.campfire",
          routeId: "route.monster.campfire",
          corrupted: true
        }
      ],
      workerCount: 5,
      tags: ["sandbox", "layout", "tiny-camp"]
    }
  }
];
