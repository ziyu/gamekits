import type { DataPackEntry } from "@gamekits/data";

export const sandboxVisualRenderRigEntries: DataPackEntry[] = [
  {
    type: "sandbox.renderRig",
    id: "renderRig.sandbox.camp_crew",
    data: {
      id: "renderRig.sandbox.camp_crew",
      renderObjectId: "render.sandbox.entity",
      nodeAnimations: [
        {
          kind: "pulse",
          nodePath: "aura",
          scale: 0.16,
          speed: 2.4,
          alpha: {
            min: 0.18,
            max: 0.44
          }
        },
        {
          kind: "spin",
          nodePath: "body",
          speed: 1.3
        },
        {
          kind: "orbit",
          nodePath: "marker",
          radius: 3.5,
          speed: 2.1,
          phase: 0.5
        },
        {
          kind: "pulse",
          nodePath: "thruster/left",
          scale: 0.24,
          speed: 8,
          phase: 0.2,
          alpha: {
            min: 0.25,
            max: 0.9
          }
        },
        {
          kind: "pulse",
          nodePath: "thruster/right",
          scale: 0.24,
          speed: 8,
          phase: 1.1,
          alpha: {
            min: 0.25,
            max: 0.9
          }
        }
      ],
      tags: ["sandbox", "animated", "node-updates"]
    }
  },
  {
    type: "sandbox.renderRig",
    id: "renderRig.sandbox.campfire",
    data: {
      id: "renderRig.sandbox.campfire",
      renderObjectId: "render.sandbox.campfire",
      nodeAnimations: [
        {
          kind: "pulse",
          nodePath: "aura",
          scale: 0.08,
          speed: 2,
          alpha: {
            min: 0.2,
            max: 0.52
          }
        },
        {
          kind: "spin",
          nodePath: "outer",
          speed: 0.45
        },
        {
          kind: "spin",
          nodePath: "inner",
          speed: -0.8
        }
      ],
      tags: ["sandbox", "tiny-camp", "animated"]
    }
  },
  {
    type: "sandbox.renderRig",
    id: "renderRig.sandbox.resource_node",
    data: {
      id: "renderRig.sandbox.resource_node",
      renderObjectId: "render.sandbox.resource_node",
      nodeAnimations: [
        {
          kind: "pulse",
          nodePath: "charge/ring",
          scale: 0.12,
          speed: 3.2
        },
        {
          kind: "pulse",
          nodePath: "beacon",
          scale: 0.18,
          speed: 4.4,
          alpha: {
            min: 0.35,
            max: 0.9
          }
        }
      ],
      tags: ["sandbox", "tiny-camp", "animated"]
    }
  },
  {
    type: "sandbox.renderRig",
    id: "renderRig.sandbox.worker",
    data: {
      id: "renderRig.sandbox.worker",
      renderObjectId: "render.sandbox.worker",
      nodeAnimations: [
        {
          kind: "pulse",
          nodePath: "cargo",
          scale: 0.15,
          speed: 5.2,
          alpha: {
            min: 0.2,
            max: 0.82
          }
        },
        {
          kind: "pulse",
          nodePath: "task",
          scale: 0.1,
          speed: 4.5
        }
      ],
      tags: ["sandbox", "tiny-camp", "animated"]
    }
  },
  {
    type: "sandbox.renderRig",
    id: "renderRig.sandbox.storage",
    data: {
      id: "renderRig.sandbox.storage",
      renderObjectId: "render.sandbox.storage",
      nodeAnimations: [
        {
          kind: "pulse",
          nodePath: "core",
          scale: 0.08,
          speed: 2.8
        }
      ],
      tags: ["sandbox", "tiny-camp", "animated"]
    }
  },
  {
    type: "sandbox.renderRig",
    id: "renderRig.sandbox.workshop",
    data: {
      id: "renderRig.sandbox.workshop",
      renderObjectId: "render.sandbox.workshop",
      nodeAnimations: [
        {
          kind: "spin",
          nodePath: "gear",
          speed: 0.9
        }
      ],
      tags: ["sandbox", "tiny-camp", "animated"]
    }
  },
  {
    type: "sandbox.renderRig",
    id: "renderRig.sandbox.watchtower",
    data: {
      id: "renderRig.sandbox.watchtower",
      renderObjectId: "render.sandbox.watchtower",
      nodeAnimations: [
        {
          kind: "spin",
          nodePath: "gear",
          speed: 0.55
        },
        {
          kind: "pulse",
          nodePath: "field",
          scale: 0.16,
          speed: 2.1,
          alpha: {
            min: 0.1,
            max: 0.34
          }
        }
      ],
      tags: ["sandbox", "tiny-camp", "animated"]
    }
  },
  {
    type: "sandbox.renderRig",
    id: "renderRig.sandbox.monster",
    data: {
      id: "renderRig.sandbox.monster",
      renderObjectId: "render.sandbox.monster",
      nodeAnimations: [
        {
          kind: "pulse",
          nodePath: "field",
          scale: 0.18,
          speed: 2.4,
          alpha: {
            min: 0.15,
            max: 0.5
          }
        },
        {
          kind: "spin",
          nodePath: "core",
          speed: -1.1
        }
      ],
      tags: ["sandbox", "tiny-camp", "animated"]
    }
  }
];
