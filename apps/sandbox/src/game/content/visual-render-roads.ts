import type { DataPackEntry } from "@gamekits/data";

export const sandboxRoadRenderEntries: DataPackEntry[] = [
  {
    type: "render.object",
    id: "render.sandbox.road",
    data: {
      id: "render.sandbox.road",
      type: "sprite",
      alpha: 0.65,
      props: {
        textureId: "asset.sandbox.entity_square",
        width: 80,
        height: 4,
        tint: 6603472,
        depth: -10
      },
      tags: ["sandbox", "tiny-camp", "road"]
    }
  }
];
