import type { AssetDefinition } from "@gamekits/asset";
import { createAnimatorRuntime, type AnimatorGraphDefinition } from "@gamekits/animator-core";
import { createMemoryAnimationPlaybackAdapter } from "@gamekits/animator-core/testing";
import type {
  RenderObjectDefinition,
  RenderObjectId,
  RendererAdapter
} from "@gamekits/renderer-core";
import { describe, expect, it } from "vitest";
import {
  ANIMATOR_LAB_GRAPH_ID,
  ANIMATOR_LAB_TEXTURE_ID,
  createAnimatorLabDataRegistry
} from "./content";
import {
  createAnimatorLabController,
  createAnimatorLabPlaybackProbe,
  createAnimatorLabState
} from "./runtime";

describe("Animator Lab", () => {
  it("registers a complete layered animation data pack", () => {
    const registry = createAnimatorLabDataRegistry();
    const asset = registry.getValue<AssetDefinition>("asset.definition", ANIMATOR_LAB_TEXTURE_ID);
    const graph = registry.getValue<AnimatorGraphDefinition>(
      "animator.graph",
      ANIMATOR_LAB_GRAPH_ID
    );

    expect(asset.type).toBe("spritesheet");
    expect(asset.animations?.map((animation) => animation.id)).toEqual([
      "animator-lab.idle",
      "animator-lab.run",
      "animator-lab.sprint",
      "animator-lab.fire",
      "animator-lab.hit",
      "animator-lab.calibrate",
      "animator-lab.clear"
    ]);
    expect(graph.layers.map((layer) => [layer.id, layer.target])).toEqual([
      ["locomotion", ["body"]],
      ["action", ["action"]]
    ]);
    expect(graph.oneShots?.map((oneShot) => oneShot.id)).toEqual(["fire", "hit"]);
  });

  it("drives graph transitions, one-shot policy, markers, phase seek, and reset", () => {
    const state = createAnimatorLabState();
    const memory = createMemoryAnimationPlaybackAdapter();
    const playback = createAnimatorLabPlaybackProbe(memory);
    const runtime = createAnimatorRuntime({
      id: "animator-lab.test",
      dataRegistry: createAnimatorLabDataRegistry(),
      adapter: playback,
      onMarker(marker) {
        state.retainMarker(marker);
      }
    });
    const renderer = createRendererProbe();
    const scene = createAnimatorLabController({
      animator: runtime,
      renderer,
      playback,
      state
    });

    scene.start();
    runtime.update(0, 0);

    expect(renderer.created?.type).toBe("container");
    expect(renderer.created?.children?.map((node) => node.id)).toEqual(["body", "action"]);
    expect(scene.snapshot().frame?.layers.map((layer) => [layer.layerId, layer.stateId])).toEqual([
      ["locomotion", "idle"],
      ["action", "clear"]
    ]);

    scene.setSpeed(0.92);
    runtime.update(16, 16);
    expect(
      scene.snapshot().controller?.layers.find((layer) => layer.layerId === "locomotion")?.stateId
    ).toBe("sprint");
    expect(
      scene.snapshot().frame?.layers.find((layer) => layer.layerId === "locomotion")?.backendClip
    ).toBe("animator-lab.sprint");
    expect(
      scene.snapshot().frame?.layers.find((layer) => layer.layerId === "locomotion")?.speed
    ).toBeCloseTo(0.92);

    scene.setSpeed(0.93);
    runtime.update(16, 32);
    expect(
      scene.snapshot().frame?.layers.find((layer) => layer.layerId === "locomotion")
    ).toMatchObject({ speed: 0.93, seek: false });

    scene.triggerBurst();
    expect(scene.snapshot().runtime.activeOneShots).toBe(1);
    expect(scene.snapshot().runtime.queuedOneShots).toBe(1);
    runtime.update(120, 152);
    expect(state.markers.at(-1)?.markerId).toBe("pulse");
    expect(scene.snapshot().frame?.layers.find((layer) => layer.layerId === "action")?.kind).toBe(
      "one-shot"
    );

    scene.triggerHit();
    runtime.update(60, 212);
    expect(
      scene.snapshot().frame?.layers.find((layer) => layer.layerId === "action")?.backendClip
    ).toBe("animator-lab.hit");
    expect(state.markers.at(-1)?.markerId).toBe("impact");

    scene.seekGameplayPhase(0.65);
    runtime.update(0, 212);
    const phaseFrame = scene
      .snapshot()
      .frame?.layers.find((layer) => layer.kind === "gameplay-phase");
    expect(phaseFrame?.backendClip).toBe("animator-lab.calibrate");
    expect(phaseFrame?.normalizedTime).toBeCloseTo(0.65);
    expect(phaseFrame?.seek).toBe(true);

    scene.resetGeneration();
    runtime.update(0, 212);
    expect(scene.snapshot()).toMatchObject({
      generation: 1,
      speed: 0,
      phaseProgress: undefined,
      runtime: { activeGameplayPhases: 0, queuedOneShots: 0 }
    });

    scene.dispose();
    expect(renderer.destroyed).toEqual(["sandbox.animator-lab.signal-runner.render"]);
    runtime.dispose();
  });
});

function createRendererProbe(): RendererAdapter & {
  created?: RenderObjectDefinition | undefined;
  destroyed: RenderObjectId[];
} {
  const probe: RendererAdapter & {
    created?: RenderObjectDefinition | undefined;
    destroyed: RenderObjectId[];
  } = {
    id: "animator-lab.renderer-probe",
    kind: "memory",
    destroyed: [],
    async boot() {},
    destroy() {},
    getView() {
      return {} as HTMLElement;
    },
    resize() {},
    createObject(definition) {
      probe.created = definition;
      return definition.id ?? "animator-lab.renderer-probe.object";
    },
    destroyObject(id) {
      probe.destroyed.push(id);
    },
    native() {
      return undefined;
    }
  };
  return probe;
}
