import type { DataPackEntry } from "@gamekits/data";

export const sandboxCampfireRenderEntries: DataPackEntry[] = [
  {
    type: "render.object",
    id: "render.sandbox.campfire",
    data: {
      id: "render.sandbox.campfire",
      type: "container",
      children: [
        {
          id: "shadow",
          type: "sprite",
          transform: {
            position: {
              x: 5,
              y: 8
            },
            scale: {
              x: 1,
              y: 0.32
            }
          },
          alpha: 0.22,
          props: {
            textureId: "asset.sandbox.entity_square",
            width: 70,
            height: 58,
            tint: 0,
            depth: -2
          }
        },
        {
          id: "aura",
          type: "sprite",
          alpha: 0.28,
          props: {
            textureId: "asset.sandbox.status_ring",
            width: 82,
            height: 82,
            tint: 6603472,
            depth: -1
          }
        },
        {
          id: "outer",
          type: "sprite",
          props: {
            textureId: "asset.sandbox.status_ring",
            width: 68,
            height: 68,
            tint: 15986920,
            depth: 0
          }
        },
        {
          id: "inner",
          type: "sprite",
          props: {
            textureId: "asset.sandbox.status_ring",
            width: 52,
            height: 52,
            tint: 14267231,
            depth: 1
          }
        },
        {
          id: "body",
          type: "sprite",
          props: {
            textureId: "asset.sandbox.entity_square",
            width: 34,
            height: 34,
            tint: 2570805,
            depth: 2
          }
        },
        {
          id: "core",
          type: "sprite",
          props: {
            textureId: "asset.sandbox.entity_square",
            width: 14,
            height: 14,
            tint: 15777103,
            depth: 3
          }
        },
        {
          id: "charge",
          type: "container",
          transform: {
            position: {
              x: 0,
              y: 41
            }
          },
          children: [
            {
              id: "track",
              type: "sprite",
              alpha: 0.3,
              props: {
                textureId: "asset.sandbox.entity_square",
                width: 70,
                height: 4,
                tint: 15986920,
                depth: 4
              }
            },
            {
              id: "fill",
              type: "sprite",
              props: {
                textureId: "asset.sandbox.entity_square",
                width: 2,
                height: 4,
                tint: 14267231,
                depth: 5
              }
            },
            {
              id: "ring",
              type: "sprite",
              alpha: 0.7,
              props: {
                textureId: "asset.sandbox.status_ring",
                width: 11,
                height: 11,
                tint: 14267231,
                depth: 6
              }
            }
          ]
        },
        {
          id: "beacon",
          type: "sprite",
          transform: {
            position: {
              x: 0,
              y: -38
            }
          },
          alpha: 0.78,
          props: {
            textureId: "asset.sandbox.entity_square",
            width: 20,
            height: 8,
            tint: 14267231,
            depth: 7
          }
        },
        {
          id: "cargo",
          type: "sprite",
          transform: {
            position: {
              x: 37,
              y: -19.333333333333332
            }
          },
          alpha: 0,
          props: {
            textureId: "asset.sandbox.status_ring",
            width: 16,
            height: 16,
            tint: 14267231,
            depth: 8
          }
        },
        {
          id: "task",
          type: "sprite",
          transform: {
            position: {
              x: -37,
              y: 19.333333333333332
            }
          },
          alpha: 0,
          props: {
            textureId: "asset.sandbox.entity_square",
            width: 8,
            height: 8,
            tint: 6603472,
            depth: 9
          }
        },
        {
          id: "field",
          type: "sprite",
          alpha: 0,
          props: {
            textureId: "asset.sandbox.status_ring",
            width: 104,
            height: 104,
            tint: 14497319,
            depth: -3
          }
        },
        {
          id: "gear",
          type: "sprite",
          alpha: 0,
          props: {
            textureId: "asset.sandbox.status_ring",
            width: 62,
            height: 62,
            tint: 14267231,
            depth: 4
          }
        }
      ],
      tags: ["sandbox", "tiny-camp", "campfire"]
    }
  }
];
