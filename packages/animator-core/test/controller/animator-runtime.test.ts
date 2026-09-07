import { describe, expect, it } from "vitest";
import { createEventBus } from "@gamekits/event-bus";
import { createAnimatorRuntime } from "../../src";
import { createMemoryAnimationPlaybackAdapter } from "../../src/testing";
import {
  animatorController,
  createAnimatorFixture,
  createAnimatorTestRegistry
} from "../fixtures/animator-fixture";

describe("Animator runtime", () => {
  it("transitions layers from dirty parameters and batches playback", () => {
    let observerErrors = 0;
    const fixture = createAnimatorFixture({
      onTrace() {
        throw new Error("observer failed");
      },
      onTraceError() {
        observerErrors += 1;
      }
    });
    fixture.runtime.bind(animatorController("hero"));
    fixture.runtime.update(16, 16);
    expect(fixture.adapter.frame("hero")?.layers[0]).toMatchObject({
      stateId: "idle",
      clipId: "clip.idle"
    });

    fixture.runtime.setParameter("hero", "moving", true);
    fixture.runtime.update(16, 32);

    expect(
      fixture.runtime.getController("hero")?.layers.find((layer) => layer.layerId === "base")
        ?.stateId
    ).toBe("run");
    expect(
      fixture.adapter.frame("hero")?.layers.find((layer) => layer.layerId === "base")
    ).toMatchObject({ stateId: "run", clipId: "clip.run" });
    expect(fixture.runtime.traces()).toContainEqual(
      expect.objectContaining({ label: "animator.state_transition" })
    );
    expect(observerErrors).toBeGreaterThan(0);
  });

  it("keeps stable idle controllers from producing redundant backend writes", () => {
    const fixture = createAnimatorFixture();
    fixture.runtime.bind(animatorController("idle"));
    fixture.runtime.update(16, 16);
    const applied = fixture.adapter.snapshot().appliedFrames;
    fixture.runtime.update(16, 32);
    fixture.runtime.update(16, 48);
    expect(fixture.adapter.snapshot().appliedFrames).toBe(applied);
  });

  it("seeks only layers whose playback identity changed", () => {
    const fixture = createAnimatorFixture();
    fixture.runtime.bind(animatorController("smooth"));
    fixture.runtime.update(16, 16);
    expect(fixture.adapter.frame("smooth")?.layers.every((layer) => layer.seek)).toBe(true);

    fixture.runtime.setParameter("smooth", "blend", 0.25);
    fixture.runtime.update(16, 32);
    expect(fixture.adapter.frame("smooth")?.layers.every((layer) => !layer.seek)).toBe(true);

    fixture.runtime.setParameter("smooth", "moving", true);
    fixture.runtime.update(16, 48);
    expect(
      fixture.adapter
        .frame("smooth")
        ?.layers.map((layer) => [layer.layerId, layer.stateId, layer.seek])
    ).toEqual([
      ["base", "run", true],
      ["action", "rest", false]
    ]);

    fixture.runtime.trigger("smooth", "fire");
    fixture.runtime.update(0, 48);
    expect(
      fixture.adapter.frame("smooth")?.layers.find((layer) => layer.layerId === "action")?.seek
    ).toBe(true);

    fixture.runtime.trigger("smooth", "fire");
    fixture.runtime.update(16, 64);
    expect(
      fixture.adapter.frame("smooth")?.layers.find((layer) => layer.layerId === "action")?.seek
    ).toBe(false);
  });

  it("updates state playback speed continuously without resetting its clock", () => {
    const fixture = createAnimatorFixture();
    fixture.runtime.bind(animatorController("variable-speed"));
    fixture.runtime.setParameters("variable-speed", { moving: true, blend: 0.4 });
    fixture.runtime.update(0, 0);

    expect(
      fixture.adapter.frame("variable-speed")?.layers.find((layer) => layer.layerId === "base")
    ).toMatchObject({ stateId: "run", speed: 0.4, timeMs: 0, seek: true });

    const appliedFrames = fixture.adapter.snapshot().appliedFrames;
    fixture.runtime.update(100, 100);
    expect(fixture.adapter.snapshot().appliedFrames).toBe(appliedFrames);

    fixture.runtime.setParameter("variable-speed", "blend", 0.8);
    fixture.runtime.update(100, 200);
    expect(
      fixture.adapter.frame("variable-speed")?.layers.find((layer) => layer.layerId === "base")
    ).toMatchObject({ stateId: "run", speed: 0.8, seek: false });
    expect(
      fixture.adapter.frame("variable-speed")?.layers.find((layer) => layer.layerId === "base")
        ?.timeMs
    ).toBeCloseTo(120);
  });

  it("runs bounded one-shots, queues one replay, and deduplicates markers", () => {
    const fixture = createAnimatorFixture();
    const markers: string[] = [];
    fixture.runtime.dispose();
    const runtime = createAnimatorRuntime({
      dataRegistry: createAnimatorTestRegistry(),
      adapter: fixture.adapter,
      onMarker: (marker) => markers.push(marker.markerId),
      markerHistoryLimit: 8
    });
    runtime.bind(animatorController("shot"));
    runtime.update(16, 16);
    runtime.trigger("shot", "fire");
    runtime.trigger("shot", "fire");
    expect(
      runtime.getController("shot")?.layers.find((layer) => layer.layerId === "action")
    ).toMatchObject({ activeOneShotId: "fire", queuedOneShots: 1 });

    runtime.update(100, 116);
    runtime.update(0, 116);
    expect(markers).toEqual(["muzzle"]);
    runtime.update(100, 216);
    expect(runtime.snapshot()).toMatchObject({ activeOneShots: 1, queuedOneShots: 0 });
    runtime.update(100, 316);
    expect(markers).toEqual(["muzzle", "muzzle"]);
  });

  it("bounds marker catch-up and keeps only the most recent presentation events", () => {
    const adapter = createMemoryAnimationPlaybackAdapter();
    const markers: string[] = [];
    const runtime = createAnimatorRuntime({
      dataRegistry: createAnimatorTestRegistry(),
      adapter,
      markerHistoryLimit: 8,
      maxMarkerEventsPerControllerUpdate: 3,
      onMarker: (marker) => markers.push(marker.markerId)
    });
    runtime.bind(animatorController("marker-catch-up"));
    runtime.setParameter("marker-catch-up", "moving", true);
    runtime.update(0, 0);

    runtime.update(3_600_000, 3_600_000);

    expect(markers).toEqual(["foot-right", "foot-left", "foot-right"]);
    expect(adapter.frame("marker-catch-up")?.markers).toHaveLength(3);
    expect(runtime.traces()).toContainEqual(
      expect.objectContaining({ label: "animator.marker_catch_up_truncated" })
    );
    runtime.update(0, 3_600_000);
    expect(markers).toHaveLength(3);
    runtime.dispose();
  });

  it("isolates throwing EventBus marker listeners from playback", () => {
    const adapter = createMemoryAnimationPlaybackAdapter();
    const eventBus = createEventBus();
    let markerErrors = 0;
    eventBus.on("animator.marker", () => {
      throw new Error("marker listener failed");
    });
    const runtime = createAnimatorRuntime({
      dataRegistry: createAnimatorTestRegistry(),
      adapter,
      eventBus,
      onMarkerError() {
        markerErrors += 1;
      }
    });
    runtime.bind(animatorController("event-bus-isolation"));
    runtime.trigger("event-bus-isolation", "fire");

    expect(() => runtime.update(100, 100)).not.toThrow();
    expect(adapter.frame("event-bus-isolation")?.markers[0]?.markerId).toBe("muzzle");
    expect(markerErrors).toBe(1);
    expect(runtime.traces()).toContainEqual(
      expect.objectContaining({ label: "animator.marker_event_bus_listener_failed" })
    );
    runtime.dispose();
  });

  it("isolates marker observers and rejects invalid gameplay clocks", () => {
    const adapter = createMemoryAnimationPlaybackAdapter();
    let markerErrors = 0;
    const runtime = createAnimatorRuntime({
      dataRegistry: createAnimatorTestRegistry(),
      adapter,
      onMarker(marker) {
        marker.markerId = "mutated";
        throw new Error("marker observer failed");
      },
      onMarkerError(_error, marker) {
        marker.markerId = "also-mutated";
        markerErrors += 1;
      }
    });
    runtime.bind(animatorController("marker-observer"));
    runtime.trigger("marker-observer", "fire");
    runtime.update(100, 100);
    expect(markerErrors).toBe(1);
    expect(adapter.frame("marker-observer")?.markers[0]?.markerId).toBe("muzzle");
    expect(() =>
      runtime.syncGameplayPhase("marker-observer", {
        executionId: "invalid",
        abilityId: "ability.reload",
        phase: "active",
        startedAt: Number.NaN,
        durationMs: -1
      })
    ).toThrowError(expect.objectContaining({ code: "animator.invalid_config" }));
    runtime.dispose();
  });

  it("interrupts a one-shot only with a higher-priority action", () => {
    const fixture = createAnimatorFixture();
    fixture.runtime.bind(animatorController("interrupt"));
    fixture.runtime.trigger("interrupt", "fire");
    fixture.runtime.trigger("interrupt", "hit");
    expect(
      fixture.runtime.getController("interrupt")?.layers.find((layer) => layer.layerId === "action")
    ).toMatchObject({ activeOneShotId: "hit", queuedOneShots: 0 });
  });

  it("rebuilds a late-joined gameplay phase at the current seek time without old markers", () => {
    const fixture = createAnimatorFixture();
    fixture.runtime.bind(animatorController("remote"));
    fixture.runtime.update(500, 500);
    fixture.runtime.syncGameplayPhase("remote", {
      executionId: "execution.remote",
      abilityId: "ability.reload",
      phase: "active",
      startedAt: 0,
      durationMs: 2_000
    });
    fixture.runtime.update(0, 500);

    const layer = fixture.adapter
      .frame("remote")
      ?.layers.find((candidate) => candidate.layerId === "action");
    expect(layer).toMatchObject({
      kind: "gameplay-phase",
      clipId: "clip.reload",
      timeMs: 250,
      normalizedTime: 0.25,
      speed: 0.5,
      seek: true
    });
    expect(fixture.adapter.frame("remote")?.markers).toEqual([]);
  });

  it("cancels anticipated phases and ignores stale generations", () => {
    const fixture = createAnimatorFixture();
    fixture.runtime.bind(animatorController("predicted"));
    fixture.runtime.reset("predicted", 3);
    fixture.runtime.syncGameplayPhase("predicted", {
      executionId: "stale",
      abilityId: "ability.reload",
      phase: "active",
      startedAt: 0,
      generation: 2
    });
    expect(fixture.runtime.snapshot().activeGameplayPhases).toBe(0);

    fixture.runtime.syncGameplayPhase("predicted", {
      executionId: "current",
      abilityId: "ability.reload",
      phase: "active",
      startedAt: 0,
      predicted: true,
      generation: 3
    });
    expect(fixture.runtime.snapshot().activeGameplayPhases).toBe(1);
    fixture.runtime.cancelGameplayPhase("predicted", "current");
    expect(fixture.runtime.snapshot().activeGameplayPhases).toBe(0);
  });

  it("uses the declared fallback when a graph clip alias is absent", () => {
    const fixture = createAnimatorFixture();
    fixture.runtime.bind({
      controllerId: "fallback",
      bindingId: "binding.fallback",
      renderObjectId: "render.fallback"
    });
    fixture.runtime.update(16, 16);
    expect(fixture.adapter.frame("fallback")?.layers[0]?.clipId).toBe("clip.idle");
  });

  it("cleans controller and adapter retained state on dispose", () => {
    const fixture = createAnimatorFixture();
    fixture.runtime.bind(animatorController("dispose"));
    fixture.runtime.update(16, 16);
    fixture.runtime.dispose();
    expect(fixture.runtime.snapshot()).toMatchObject({ disposed: true, controllers: [] });
    expect(fixture.adapter.snapshot()).toMatchObject({ boundControllers: 0, retainedFrames: 0 });
  });
});
