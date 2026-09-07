import type { DataPackEntry } from "@gamekits/data";

export const sandboxResourceRenderEntries: DataPackEntry[] = [
  {
    type: "render.object",
    id: "render.sandbox.resource_node",
    data: {
      id: "render.sandbox.resource_node",
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
            width: 56,
            height: 44,
            tint: 0,
            depth: -2
          }
        },
        {
          id: "aura",
          type: "sprite",
          alpha: 0.22,
          props: {
            textureId: "asset.sandbox.status_ring",
            width: 68,
            height: 68,
            tint: 6603472,
            depth: -1
          }
        },
        {
          id: "outer",
          type: "sprite",
          props: {
            textureId: "asset.sandbox.status_ring",
            width: 54,
            height: 54,
            tint: 6603472,
            depth: 0
          }
        },
        {
          id: "inner",
          type: "sprite",
          props: {
            textureId: "asset.sandbox.status_ring",
            width: 38,
            height: 38,
            tint: 8376683,
            depth: 1
          }
        },
        {
          id: "body",
          type: "sprite",
          props: {
            textureId: "asset.sandbox.entity_square",
            width: 18,
            height: 38,
            tint: 2771784,
            depth: 2
          }
        },
        {
          id: "core",
          type: "sprite",
          props: {
            textureId: "asset.sandbox.entity_square",
            width: 10,
            height: 10,
            tint: 15986920,
            depth: 3
          }
        },
        {
          id: "charge",
          type: "container",
          transform: {
            position: {
              x: 0,
              y: 34
            }
          },
          children: [
            {
              id: "track",
              type: "sprite",
              alpha: 0.3,
              props: {
                textureId: "asset.sandbox.entity_square",
                width: 56,
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
                tint: 8376683,
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
                tint: 8376683,
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
              y: -31
            }
          },
          alpha: 0.78,
          props: {
            textureId: "asset.sandbox.entity_square",
            width: 16,
            height: 12,
            tint: 8376683,
            depth: 7
          }
        },
        {
          id: "cargo",
          type: "sprite",
          transform: {
            position: {
              x: 30,
              y: -14.666666666666666
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
              x: -30,
              y: 14.666666666666666
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
            width: 90,
            height: 90,
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
            width: 48,
            height: 48,
            tint: 14267231,
            depth: 4
          }
        }
      ],
      tags: ["sandbox", "tiny-camp", "resource-node"]
    }
  }
];
