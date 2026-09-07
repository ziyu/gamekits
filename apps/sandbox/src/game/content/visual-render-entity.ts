import type { DataPackEntry } from "@gamekits/data";

export const sandboxEntityRenderEntries: DataPackEntry[] = [
  {
    type: "render.object",
    id: "render.sandbox.entity",
    data: {
      id: "render.sandbox.entity",
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
              y: 0.36
            }
          },
          alpha: 0.2,
          props: {
            textureId: "asset.sandbox.entity_square",
            width: 30,
            height: 30,
            tint: 0,
            depth: -1
          }
        },
        {
          id: "aura",
          type: "sprite",
          alpha: 0.38,
          props: {
            textureId: "asset.sandbox.status_ring",
            width: 54,
            height: 54,
            tint: 6603472,
            depth: 0
          }
        },
        {
          id: "body",
          type: "sprite",
          props: {
            textureId: "asset.sandbox.entity_square",
            width: 24,
            height: 24,
            tint: 8376683,
            depth: 2
          }
        },
        {
          id: "core",
          type: "sprite",
          props: {
            textureId: "asset.sandbox.entity_square",
            width: 9,
            height: 9,
            tint: 15986920,
            depth: 3
          }
        },
        {
          id: "marker",
          type: "container",
          transform: {
            position: {
              x: 0,
              y: -26
            }
          },
          children: [
            {
              id: "ring",
              type: "sprite",
              alpha: 0.72,
              props: {
                textureId: "asset.sandbox.status_ring",
                width: 18,
                height: 18,
                tint: 15777103,
                depth: 4
              }
            },
            {
              id: "pip",
              type: "sprite",
              props: {
                textureId: "asset.sandbox.entity_square",
                width: 5,
                height: 5,
                tint: 15777103,
                depth: 5
              }
            }
          ]
        },
        {
          id: "thruster",
          type: "container",
          transform: {
            position: {
              x: -17,
              y: 11
            }
          },
          children: [
            {
              id: "left",
              type: "sprite",
              transform: {
                position: {
                  x: 0,
                  y: -4
                }
              },
              alpha: 0.55,
              props: {
                textureId: "asset.sandbox.entity_square",
                width: 8,
                height: 4,
                tint: 14497319,
                depth: 1
              }
            },
            {
              id: "right",
              type: "sprite",
              transform: {
                position: {
                  x: 0,
                  y: 4
                }
              },
              alpha: 0.55,
              props: {
                textureId: "asset.sandbox.entity_square",
                width: 8,
                height: 4,
                tint: 14497319,
                depth: 1
              }
            }
          ]
        }
      ],
      tags: ["sandbox", "complex", "object-tree"]
    }
  }
];
