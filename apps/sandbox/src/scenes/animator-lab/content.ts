import { createAssetDataType } from "@gamekits/asset";
import { createAnimatorDataTypes } from "@gamekits/animator-core";
import {
  createDataRegistry,
  type DataPack,
  type DataRegistry,
  type DataTypeDefinition
} from "@gamekits/data";

export const ANIMATOR_LAB_ASSET_GROUP = "sandbox.animator-lab";
export const ANIMATOR_LAB_TEXTURE_ID = "sandbox.animator-lab.signal-runner";
export const ANIMATOR_LAB_BINDING_ID = "sandbox.animator-lab.signal-runner.binding";
export const ANIMATOR_LAB_GRAPH_ID = "sandbox.animator-lab.signal-runner.graph";

const FRAME_SIZE = 64;

export function createAnimatorLabDataRegistry(): DataRegistry {
  const registry = createDataRegistry();
  registry.registerType(createAssetDataType() as DataTypeDefinition);
  for (const type of createAnimatorDataTypes()) {
    registry.registerType(type as DataTypeDefinition);
  }
  const validation = registry.registerPack(ANIMATOR_LAB_PACK);
  const errors = validation.diagnostics.filter((diagnostic) => diagnostic.severity === "error");
  if (errors.length > 0) {
    throw new Error(`Animator Lab content is invalid: ${JSON.stringify(errors)}`);
  }
  return registry;
}

export const ANIMATOR_LAB_PACK: DataPack = {
  id: "sandbox.animator-lab.content",
  version: "1.0.0",
  entries: [
    {
      type: "asset.definition",
      id: ANIMATOR_LAB_TEXTURE_ID,
      data: {
        id: ANIMATOR_LAB_TEXTURE_ID,
        type: "spritesheet",
        group: ANIMATOR_LAB_ASSET_GROUP,
        preload: true,
        source: { type: "url", url: createSignalRunnerSpritesheetUrl() },
        frame: { width: FRAME_SIZE, height: FRAME_SIZE },
        animations: [
          {
            id: "animator-lab.idle",
            frames: [0, 1],
            frameRate: 2,
            repeat: -1,
            yoyo: true
          },
          {
            id: "animator-lab.run",
            frames: { start: 2, end: 5 },
            frameRate: 9,
            repeat: -1
          },
          {
            id: "animator-lab.sprint",
            frames: { start: 2, end: 5 },
            frameRate: 15,
            repeat: -1
          },
          {
            id: "animator-lab.fire",
            frames: [6, 7],
            durationMs: 240,
            repeat: 0
          },
          {
            id: "animator-lab.hit",
            frames: [8],
            durationMs: 180,
            repeat: 0
          },
          {
            id: "animator-lab.calibrate",
            frames: { start: 9, end: 11 },
            durationMs: 1_200,
            repeat: 0
          },
          {
            id: "animator-lab.clear",
            frames: [12],
            frameRate: 1,
            repeat: -1
          }
        ]
      }
    },
    clip("idle", "animator-lab.idle", 1_200, true),
    clip("run", "animator-lab.run", 480, true, [
      { id: "foot-left", timeMs: 120, tags: ["footstep"] },
      { id: "foot-right", timeMs: 360, tags: ["footstep"] }
    ]),
    clip("sprint", "animator-lab.sprint", 320, true, [
      { id: "foot-left", timeMs: 80, tags: ["footstep", "sprint"] },
      { id: "foot-right", timeMs: 240, tags: ["footstep", "sprint"] }
    ]),
    clip("fire", "animator-lab.fire", 240, false, [
      { id: "pulse", timeMs: 120, tags: ["presentation", "weapon"] }
    ]),
    clip("hit", "animator-lab.hit", 180, false, [
      { id: "impact", timeMs: 60, tags: ["presentation", "reaction"] }
    ]),
    clip("calibrate", "animator-lab.calibrate", 1_200, false, [
      { id: "lock", timeMs: 300, tags: ["presentation", "phase"] },
      { id: "release", timeMs: 900, tags: ["presentation", "phase"] }
    ]),
    clip("clear", "animator-lab.clear", 1_000, true),
    {
      type: "animator.graph",
      id: ANIMATOR_LAB_GRAPH_ID,
      data: {
        id: ANIMATOR_LAB_GRAPH_ID,
        parameters: [{ id: "speed", type: "number", default: 0 }],
        layers: [
          {
            id: "locomotion",
            initialState: "idle",
            target: ["body"],
            states: [
              { id: "idle", clip: "idle", loop: true },
              { id: "run", clip: "run", loop: true, speedParameter: "speed" },
              { id: "sprint", clip: "sprint", loop: true, speedParameter: "speed" }
            ],
            transitions: [
              {
                from: "idle",
                to: "sprint",
                priority: 20,
                conditions: [{ parameter: "speed", operator: ">=", value: 0.75 }]
              },
              {
                from: "idle",
                to: "run",
                priority: 10,
                conditions: [{ parameter: "speed", operator: ">", value: 0.05 }]
              },
              {
                from: "run",
                to: "sprint",
                conditions: [{ parameter: "speed", operator: ">=", value: 0.75 }]
              },
              {
                from: "run",
                to: "idle",
                conditions: [{ parameter: "speed", operator: "<=", value: 0.05 }]
              },
              {
                from: "sprint",
                to: "idle",
                priority: 20,
                conditions: [{ parameter: "speed", operator: "<=", value: 0.05 }]
              },
              {
                from: "sprint",
                to: "run",
                priority: 10,
                conditions: [
                  { parameter: "speed", operator: ">", value: 0.05 },
                  { parameter: "speed", operator: "<", value: 0.75 }
                ]
              }
            ]
          },
          {
            id: "action",
            initialState: "clear",
            priority: 20,
            target: ["action"],
            states: [{ id: "clear", clip: "clear", loop: true }]
          }
        ],
        oneShots: [
          {
            id: "fire",
            layer: "action",
            clip: "fire",
            priority: 10,
            repeat: "queue-one",
            interrupt: "higher-priority",
            maxQueue: 1
          },
          {
            id: "hit",
            layer: "action",
            clip: "hit",
            priority: 30,
            repeat: "restart",
            interrupt: "always"
          }
        ]
      }
    },
    {
      type: "animator.binding",
      id: ANIMATOR_LAB_BINDING_ID,
      data: {
        id: ANIMATOR_LAB_BINDING_ID,
        graph: { type: "animator.graph", id: ANIMATOR_LAB_GRAPH_ID },
        clips: {
          idle: clipRef("idle"),
          run: clipRef("run"),
          sprint: clipRef("sprint"),
          fire: clipRef("fire"),
          hit: clipRef("hit"),
          calibrate: clipRef("calibrate"),
          clear: clipRef("clear")
        },
        fallbackClip: "idle",
        phaseMappings: [
          {
            abilityId: "ability.signal-calibration",
            phase: "active",
            layer: "action",
            clip: "calibrate"
          }
        ]
      }
    }
  ]
};

function clip(
  name: string,
  backendClip: string,
  durationMs: number,
  loop: boolean,
  markers: Array<{ id: string; timeMs: number; tags?: string[] }> = []
): DataPack["entries"][number] {
  return {
    type: "animation.clip",
    id: clipId(name),
    data: {
      id: clipId(name),
      asset: { assetId: ANIMATOR_LAB_TEXTURE_ID, type: "spritesheet" },
      backendClip,
      durationMs,
      loop,
      markers
    }
  };
}

function clipRef(name: string) {
  return { type: "animation.clip" as const, id: clipId(name) };
}

function clipId(name: string): string {
  return `sandbox.animator-lab.clip.${name}`;
}

function createSignalRunnerSpritesheetUrl(): string {
  const frameCount = 13;
  const frames = [
    bodyFrame(0, { bob: 1, arm: 0, leg: 0 }),
    bodyFrame(1, { bob: -1, arm: 1, leg: 0 }),
    bodyFrame(2, { bob: 0, arm: -4, leg: 4 }),
    bodyFrame(3, { bob: -2, arm: 2, leg: 1 }),
    bodyFrame(4, { bob: 0, arm: 4, leg: -4 }),
    bodyFrame(5, { bob: -2, arm: -2, leg: -1 }),
    fireFrame(6, false),
    fireFrame(7, true),
    hitFrame(8),
    calibrationFrame(9, 0),
    calibrationFrame(10, 1),
    calibrationFrame(11, 2),
    `<g transform="translate(${12 * FRAME_SIZE} 0)" />`
  ].join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${frameCount * FRAME_SIZE}" height="${FRAME_SIZE}" viewBox="0 0 ${frameCount * FRAME_SIZE} ${FRAME_SIZE}">${frames}</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function bodyFrame(frame: number, pose: { bob: number; arm: number; leg: number }): string {
  const x = frame * FRAME_SIZE;
  const y = pose.bob;
  return `<g transform="translate(${x} ${y})">
    <ellipse cx="32" cy="57" rx="15" ry="3" fill="#051014" opacity=".42"/>
    <path d="M22 45 L${22 + pose.leg} 57 M42 45 L${42 - pose.leg} 57" stroke="#d9f5e7" stroke-width="5" stroke-linecap="round"/>
    <path d="M22 25 L${15 + pose.arm} 39 M42 25 L${49 - pose.arm} 39" stroke="#6cf2d2" stroke-width="5" stroke-linecap="round"/>
    <rect x="20" y="19" width="24" height="29" rx="7" fill="#123540" stroke="#d9f5e7" stroke-width="2"/>
    <path d="M24 32 H40" stroke="#ffb51b" stroke-width="4" stroke-linecap="round"/>
    <rect x="23" y="7" width="18" height="16" rx="6" fill="#d9f5e7" stroke="#071318" stroke-width="2"/>
    <path d="M27 15 H37" stroke="#071318" stroke-width="3" stroke-linecap="round"/>
    <circle cx="40" cy="11" r="3" fill="#ff5b32"/>
  </g>`;
}

function fireFrame(frame: number, expanded: boolean): string {
  const x = frame * FRAME_SIZE;
  const radius = expanded ? 13 : 7;
  return `<g transform="translate(${x} 0)">
    <path d="M38 29 H51" stroke="#d9f5e7" stroke-width="5" stroke-linecap="round"/>
    <circle cx="54" cy="29" r="${radius}" fill="none" stroke="#ffb51b" stroke-width="3" opacity="${expanded ? 0.35 : 0.9}"/>
    <path d="M54 17 V8 M54 41 V50 M42 29 H34" stroke="#ff5b32" stroke-width="3" stroke-linecap="round"/>
  </g>`;
}

function hitFrame(frame: number): string {
  const x = frame * FRAME_SIZE;
  return `<g transform="translate(${x} 0)">
    <path d="M16 8 L24 23 L17 31 L31 55" fill="none" stroke="#ff5b32" stroke-width="6" stroke-linejoin="round"/>
    <path d="M48 10 L39 26 L47 35" fill="none" stroke="#ffb51b" stroke-width="3" stroke-linecap="round"/>
  </g>`;
}

function calibrationFrame(frame: number, step: number): string {
  const x = frame * FRAME_SIZE;
  const radius = 13 + step * 5;
  const opacity = 0.95 - step * 0.25;
  return `<g transform="translate(${x} 0)">
    <circle cx="32" cy="30" r="${radius}" fill="none" stroke="#6cf2d2" stroke-width="3" opacity="${opacity}" stroke-dasharray="5 4"/>
    <circle cx="32" cy="30" r="${Math.max(4, radius - 8)}" fill="none" stroke="#ffb51b" stroke-width="2" opacity="${opacity}"/>
    <path d="M32 4 V14 M32 46 V58 M6 30 H16 M48 30 H58" stroke="#d9f5e7" stroke-width="2" opacity="${opacity}"/>
  </g>`;
}
