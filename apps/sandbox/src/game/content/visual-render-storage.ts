import type { DataPackEntry } from "@gamekits/data";

export const sandboxStorageRenderEntries: DataPackEntry[] = [
  {
    type: "render.object",
    id: "render.sandbox.storage",
    data: {
      id: "render.sandbox.storage",
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
            width: 50,
            height: 38,
            tint: 0,
            depth: -2
          }
        },
        {
          id: "aura",
          type: "sprite",
          alpha: 0.18,
          props: {
            textureId: "asset.sandbox.status_ring",
            width: 62,
            height: 62,
            tint: 10324440,
            depth: -1
          }
        },
        {
          id: "outer",
          type: "sprite",
          props: {
            textureId: "asset.sandbox.status_ring",
            width: 48,
            height: 48,
            tint: 10324440,
            depth: 0
          }
        },
        {
          id: "inner",
          type: "sprite",
          props: {
            textureId: "asset.sandbox.status_ring",
            width: 32,
            height: 32,
            tint: 6603472,
            depth: 1
          }
        },
        {
          id: "body",
          type: "sprite",
          props: {
            textureId: "asset.sandbox.entity_square",
            width: 28,
            height: 22,
            tint: 3353930,
            depth: 2
          }
        },
        {
          id: "core",
          type: "sprite",
          props: {
            textureId: "asset.sandbox.entity_square",
            width: 8,
            height: 8,
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
              y: 31
            }
          },
          children: [
            {
              id: "track",
              type: "sprite",
              alpha: 0.3,
              props: {
                textureId: "asset.sandbox.entity_square",
                width: 50,
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
                tint: 10324440,
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
                tint: 10324440,
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
              y: -28
            }
          },
          alpha: 0.78,
          props: {
            textureId: "asset.sandbox.entity_square",
            width: 12,
            height: 8,
            tint: 10324440,
            depth: 7
          }
        },
        {
          id: "cargo",
          type: "sprite",
          transform: {
            position: {
              x: 27,
              y: -12.666666666666666
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
              x: -27,
              y: 12.666666666666666
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
            width: 84,
            height: 84,
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
            width: 42,
            height: 42,
            tint: 14267231,
            depth: 4
          }
        }
      ],
      tags: ["sandbox", "tiny-camp", "storage"]
    }
  }
];
