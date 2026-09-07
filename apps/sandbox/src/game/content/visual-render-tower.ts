import type { DataPackEntry } from "@gamekits/data";

export const sandboxTowerRenderEntries: DataPackEntry[] = [
  {
    type: "render.object",
    id: "render.sandbox.watchtower",
    data: {
      id: "render.sandbox.watchtower",
      type: "container",
      children: [
        {
          id: "shadow",
          type: "sprite",
          transform: {
            position: {
              x: 5,
              y: 9
            },
            scale: {
              x: 1,
              y: 0.34
            }
          },
          alpha: 0.24,
          props: {
            textureId: "asset.sandbox.entity_square",
            width: 48,
            height: 54,
            tint: 0,
            depth: -2
          }
        },
        {
          id: "field",
          type: "sprite",
          alpha: 0.12,
          props: {
            textureId: "asset.sandbox.status_ring",
            width: 96,
            height: 96,
            tint: 14497319,
            depth: -3
          }
        },
        {
          id: "aura",
          type: "sprite",
          alpha: 0.24,
          props: {
            textureId: "asset.sandbox.status_ring",
            width: 72,
            height: 72,
            tint: 14497319,
            depth: -1
          }
        },
        {
          id: "outer",
          type: "sprite",
          props: {
            textureId: "asset.sandbox.status_ring",
            width: 44,
            height: 44,
            tint: 14497319,
            depth: 0
          }
        },
        {
          id: "inner",
          type: "sprite",
          props: {
            textureId: "asset.sandbox.status_ring",
            width: 28,
            height: 28,
            tint: 15986920,
            depth: 1
          }
        },
        {
          id: "body",
          type: "sprite",
          props: {
            textureId: "asset.sandbox.entity_square",
            width: 20,
            height: 42,
            tint: 2570805,
            depth: 2
          }
        },
        {
          id: "core",
          type: "sprite",
          transform: {
            position: {
              x: 0,
              y: -18
            }
          },
          props: {
            textureId: "asset.sandbox.entity_square",
            width: 14,
            height: 14,
            tint: 14497319,
            depth: 4
          }
        },
        {
          id: "beacon",
          type: "sprite",
          transform: {
            position: {
              x: 0,
              y: -34
            }
          },
          alpha: 0.86,
          props: {
            textureId: "asset.sandbox.status_ring",
            width: 24,
            height: 24,
            tint: 14497319,
            depth: 5
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
                width: 52,
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
                tint: 14497319,
                depth: 5
              }
            }
          ]
        },
        {
          id: "cargo",
          type: "sprite",
          alpha: 0,
          props: {
            textureId: "asset.sandbox.status_ring",
            width: 18,
            height: 18,
            tint: 14497319,
            depth: 6
          }
        },
        {
          id: "task",
          type: "sprite",
          transform: {
            position: {
              x: -24,
              y: 14
            }
          },
          alpha: 0,
          props: {
            textureId: "asset.sandbox.entity_square",
            width: 8,
            height: 8,
            tint: 6603472,
            depth: 7
          }
        },
        {
          id: "gear",
          type: "sprite",
          alpha: 0.55,
          props: {
            textureId: "asset.sandbox.status_ring",
            width: 54,
            height: 54,
            tint: 14497319,
            depth: 3
          }
        }
      ],
      tags: ["sandbox", "tiny-camp", "tower", "defense"]
    }
  }
];
