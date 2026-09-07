import { createAssetDataType } from "@gamekits/asset";
import { createDataRegistry, type DataPack, type DataRegistry } from "@gamekits/data";
import { createAnimatorDataTypes, createAnimatorRuntime, type AnimatorTraceEntry } from "../../src";
import { createMemoryAnimationPlaybackAdapter } from "../../src/testing";

export function createAnimatorFixture(
  options: {
    onTrace?: (entry: AnimatorTraceEntry) => void;
    onTraceError?: (error: unknown, entry: AnimatorTraceEntry) => void;
  } = {}
) {
  const adapter = createMemoryAnimationPlaybackAdapter({ maxRetainedFrames: 32 });
  const runtime = createAnimatorRuntime({
    dataRegistry: createAnimatorTestRegistry(),
    adapter,
    traceLimit: 100,
    markerHistoryLimit: 16,
    ...(options.onTrace === undefined ? {} : { onTrace: options.onTrace }),
    ...(options.onTraceError === undefined ? {} : { onTraceError: options.onTraceError })
  });
  return { runtime, adapter, dispose: () => runtime.dispose() };
}

export function animatorController(controllerId: string) {
  return {
    controllerId,
    bindingId: "binding.character",
    renderObjectId: `render.${controllerId}`
  };
}

export function createAnimatorTestRegistry(withPack = true): DataRegistry {
  const registry = createDataRegistry();
  registry.registerType(createAssetDataType());
  for (const type of createAnimatorDataTypes()) {
    registry.registerType(type);
  }
  if (withPack) {
    const validation = registry.registerPack(ANIMATOR_TEST_PACK);
    if (validation.diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
      throw new Error(JSON.stringify(validation.diagnostics));
    }
  }
  return registry;
}

export const ANIMATOR_TEST_PACK: DataPack = {
  id: "animator.test",
  version: "1.0.0",
  entries: [
    animatorAssetEntry(),
    clipEntry("clip.idle", 1_000, true),
    clipEntry("clip.run", 800, true, [
      { id: "foot-left", timeMs: 200 },
      { id: "foot-right", timeMs: 600 }
    ]),
    clipEntry("clip.fire", 200, false, [{ id: "muzzle", timeMs: 100 }]),
    clipEntry("clip.hit", 150, false),
    clipEntry("clip.reload", 1_000, false, [{ id: "magazine", timeMs: 100 }]),
    {
      type: "animator.graph",
      id: "graph.character",
      data: {
        id: "graph.character",
        parameters: [
          { id: "moving", type: "boolean", default: false },
          { id: "blend", type: "number", default: 1 }
        ],
        layers: [
          {
            id: "base",
            initialState: "idle",
            states: [
              { id: "idle", clip: "idle", loop: true },
              { id: "run", clip: "run", loop: true, speedParameter: "blend" }
            ],
            transitions: [
              {
                from: "idle",
                to: "run",
                conditions: [{ parameter: "moving", operator: "truthy" }]
              },
              {
                from: "run",
                to: "idle",
                conditions: [{ parameter: "moving", operator: "falsy" }]
              }
            ]
          },
          {
            id: "action",
            initialState: "rest",
            priority: 10,
            states: [{ id: "rest", clip: "idle", loop: true }]
          }
        ],
        oneShots: [
          {
            id: "fire",
            layer: "action",
            clip: "fire",
            priority: 10,
            repeat: "queue-one",
            maxQueue: 1
          },
          {
            id: "hit",
            layer: "action",
            clip: "hit",
            priority: 20,
            interrupt: "always"
          }
        ]
      }
    },
    {
      type: "animator.graph",
      id: "graph.fallback",
      data: {
        id: "graph.fallback",
        parameters: [],
        layers: [
          {
            id: "base",
            initialState: "idle",
            states: [{ id: "idle", clip: "missing" }]
          }
        ]
      }
    },
    {
      type: "animator.binding",
      id: "binding.character",
      data: {
        id: "binding.character",
        graph: { type: "animator.graph", id: "graph.character" },
        clips: {
          idle: { type: "animation.clip", id: "clip.idle" },
          run: { type: "animation.clip", id: "clip.run" },
          fire: { type: "animation.clip", id: "clip.fire" },
          hit: { type: "animation.clip", id: "clip.hit" },
          reload: { type: "animation.clip", id: "clip.reload" }
        },
        fallbackClip: "idle",
        phaseMappings: [
          {
            abilityId: "ability.reload",
            phase: "active",
            layer: "action",
            clip: "reload"
          }
        ]
      }
    },
    {
      type: "animator.binding",
      id: "binding.fallback",
      data: {
        id: "binding.fallback",
        graph: { type: "animator.graph", id: "graph.fallback" },
        clips: { idle: { type: "animation.clip", id: "clip.idle" } },
        fallbackClip: "idle"
      }
    }
  ]
};

export function animatorAssetEntry(): DataPack["entries"][number] {
  return {
    type: "asset.definition",
    id: "asset.character",
    data: {
      id: "asset.character",
      type: "spritesheet",
      source: { type: "url", url: "/character.png" },
      frame: { width: 32, height: 32 }
    }
  };
}

function clipEntry(
  id: string,
  durationMs: number,
  loop: boolean,
  markers: Array<{ id: string; timeMs: number }> = []
): DataPack["entries"][number] {
  return {
    type: "animation.clip",
    id,
    data: {
      id,
      asset: { assetId: "asset.character", type: "spritesheet" },
      backendClip: id,
      durationMs,
      loop,
      markers
    }
  };
}
