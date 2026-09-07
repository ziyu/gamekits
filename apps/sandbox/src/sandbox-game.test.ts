import { describe, expect, it } from "vitest";
import { createEventBus } from "@gamekits/event-bus";
import { GasAttributes } from "@gamekits/gas";
import { createMemorySaveStore, createSaveManager } from "@gamekits/save";
import { createMemoryRenderer } from "@gamekits/test-utils";
import { createKootaWorld } from "@gamekits/world-koota";
import {
  createSandboxDataRegistry,
  createSandboxRuntime,
  createSandboxSaveContributor,
  ResourceStorage,
  Selectable,
  SANDBOX_SAVE_CONTRIBUTOR_ID,
  SANDBOX_SAVE_SLOT_ID
} from "./sandbox-game";
import type { SandboxSaveData } from "./sandbox-game";

type TestSandboxRuntimeOptions = Omit<
  Parameters<typeof createSandboxRuntime>[0],
  "world" | "eventBus" | "clock"
>;

function createTestSandboxRuntime(seedOrOptions: string | TestSandboxRuntimeOptions) {
  const options = typeof seedOrOptions === "string" ? { seed: seedOrOptions } : seedOrOptions;
  let timestamp = 0;
  return createSandboxRuntime({
    ...options,
    world: createKootaWorld(),
    eventBus: createEventBus({ clock: () => timestamp++ })
  });
}

describe("sandbox runtime", () => {
  it("moves entities deterministically for a fixed seed", () => {
    const a = createTestSandboxRuntime("fixed-seed");
    const b = createTestSandboxRuntime("fixed-seed");

    a.runtime.start();
    b.runtime.start();

    for (let i = 0; i < 5; i += 1) {
      a.runtime.tick(100);
      b.runtime.tick(100);
    }

    expect(a.snapshot().entities).toEqual(b.snapshot().entities);
  });

  it("records runtime and module events", () => {
    const sandbox = createTestSandboxRuntime("event-seed");
    sandbox.runtime.start();

    expect(sandbox.snapshot().events.map((event) => event.type)).toContain(
      "runtime.module_installed"
    );
    expect(sandbox.snapshot().events.map((event) => event.type)).toContain(
      "sandbox.entity_spawned"
    );
    expect(sandbox.snapshot().events.map((event) => event.type)).toContain("runtime.started");
  });

  it("runs sandbox TCA rules from data pack events", () => {
    const sandbox = createTestSandboxRuntime("tca-seed");

    sandbox.runtime.eventBus.emit(
      "input.action",
      { actionId: "game.confirm", contextId: "gameplay", phase: "pressed", value: 1 },
      "test"
    );

    const trace = sandbox
      .snapshot()
      .tcaTraces.find((entry) => entry.ruleId === "rule.sandbox.confirm_boost");

    expect(sandbox.snapshot().tcaRuleCount).toBe(8);
    expect(trace).toMatchObject({
      ruleId: "rule.sandbox.confirm_boost",
      status: "passed",
      actions: [
        { type: "sandbox.log", status: "executed" },
        { type: "event.emit", status: "executed" }
      ]
    });
    expect(sandbox.snapshot().events.map((event) => event.type)).toContain("sandbox.tca_log");
    expect(sandbox.snapshot().events.map((event) => event.type)).toContain("sandbox.tca_confirmed");
    expect(sandbox.snapshot().events.map((event) => event.type)).toContain("gas.ability_activated");
    expect(
      sandbox
        .snapshot()
        .gasActors.find((actor) => actor.actor.actorId === "gas.actor.sandbox.worker.0")?.tags
        .values
    ).toContain("state.overcharged");
    expect(sandbox.snapshot().timeline.map((entry) => entry.kind)).toEqual(
      expect.arrayContaining(["input", "event", "tca", "gas"])
    );
  });

  it("runs GAS ability and effect state through the sandbox TCA chain", () => {
    const sandbox = createTestSandboxRuntime("gas-seed");

    sandbox.runtime.start();
    for (let i = 0; i < 60; i += 1) {
      sandbox.runtime.tick(16);
    }

    const source = sandbox
      .snapshot()
      .gasActors.find((actor) => actor.actor.actorId === "gas.actor.sandbox.worker.0");
    const target = sandbox
      .snapshot()
      .gasActors.find((actor) => actor.actor.actorId === "gas.actor.sandbox.worker.1");

    expect(source?.attributes.current.energy).toBeLessThan(40);
    expect(target?.attributes.current.health).toBeLessThan(100);
    expect(sandbox.snapshot().gasTraces.map((trace) => trace.type)).toContain("ability.activated");
    expect(sandbox.snapshot().events.map((event) => event.type)).toContain("gas.cue");
  });

  it("exposes selected actor world, render, and GAS state in snapshots", async () => {
    const renderer = createMemoryRenderer();
    const sandbox = createTestSandboxRuntime({
      seed: "selected-seed",
      renderer,
      renderSize: { width: 100, height: 100 }
    });

    await renderer.boot({
      container: { append() {} } as unknown as HTMLElement,
      width: 100,
      height: 100
    });
    sandbox.runtime.start();
    sandbox.runtime.tick(16);

    const snapshot = sandbox.snapshot({ selectedActorId: "gas.actor.sandbox.worker.2" });
    const selectedEntity = snapshot.entities.find(
      (entity) => entity.actorId === snapshot.selected?.actorId
    );
    const selectedGasActor = snapshot.gasActors.find(
      (actor) => actor.actor.actorId === snapshot.selected?.actorId
    );

    expect(snapshot.selected).toMatchObject({
      actorId: "gas.actor.sandbox.worker.2",
      entityId: selectedEntity?.id
    });
    expect(selectedEntity?.renderObjectId).toBeDefined();
    expect(selectedGasActor?.attributes.current.health).toBe(100);
    expect(selectedGasActor?.tags.values).toContain("team.worker");
  });

  it("can create a snapshot without a default selected actor", () => {
    const sandbox = createTestSandboxRuntime("cleared-selection-seed");

    sandbox.runtime.start();
    sandbox.runtime.tick(16);

    expect(sandbox.snapshot().selected?.actorId).toBeDefined();
    expect(sandbox.snapshot({ defaultSelection: false }).selected).toBeUndefined();
  });

  it("updates objective and timeline when confirm and motion rules drive GAS", () => {
    const sandbox = createTestSandboxRuntime("objective-seed");

    sandbox.runtime.start();
    sandbox.runtime.eventBus.emit(
      "input.action",
      { actionId: "game.confirm", contextId: "gameplay", phase: "pressed", value: 1 },
      "test"
    );
    for (let i = 0; i < 60; i += 1) {
      sandbox.runtime.tick(16);
    }

    const snapshot = sandbox.snapshot({ selectedActorId: "gas.actor.sandbox.worker.0" });
    const source = snapshot.gasActors.find(
      (actor) => actor.actor.actorId === "gas.actor.sandbox.worker.0"
    );
    const target = snapshot.gasActors.find(
      (actor) => actor.actor.actorId === "gas.actor.sandbox.worker.1"
    );

    expect(snapshot.objective.id).toBe("tiny-camp");
    expect(snapshot.objective.progress).toBeGreaterThan(0);
    expect(source?.tags.values).toContain("state.overcharged");
    expect(target?.attributes.current.health).toBeLessThan(100);
    expect(snapshot.timeline.map((entry) => entry.kind)).toEqual(
      expect.arrayContaining(["input", "tca", "gas"])
    );
    expect(snapshot.timeline).toEqual(
      [...snapshot.timeline].sort(
        (left, right) => left.time - right.time || left.id.localeCompare(right.id)
      )
    );
  });

  it("runs worker dispatch with route, stamina, building, and objective state", () => {
    const sandbox = createTestSandboxRuntime("dispatcher-seed");

    sandbox.runtime.start();
    for (let i = 0; i < 24; i += 1) {
      sandbox.runtime.tick(100);
    }

    const snapshot = sandbox.snapshot();
    const workers = snapshot.entities.filter((entity) => entity.role === "worker");
    const campfire = snapshot.entities.find((entity) => entity.role === "campfire");

    expect(workers.some((worker) => worker.targetObjectId)).toBe(true);
    expect(workers.some((worker) => (worker.routeProgress ?? 0) > 0)).toBe(true);
    expect(workers.some((worker) => (worker.battery ?? 100) < 100)).toBe(true);
    expect(campfire?.building?.zone).toBe("camp");
    expect(campfire?.objective?.phaseId).toBe("objective.sandbox.phase.bootstrap");
    expect(snapshot.objective.progress).toBeGreaterThan(0);
  });

  it("saves and loads Tiny Camp gameplay state through the save contributor", async () => {
    const sandbox = createTestSandboxRuntime("sandbox-save-seed");
    const manager = createSaveManager({
      appId: "sandbox",
      gameId: "sandbox",
      gameVersion: "0.1.0",
      formatVersion: "1.0.0",
      store: createMemorySaveStore()
    });
    manager.registerContributor(createSandboxSaveContributor(sandbox));

    sandbox.runtime.start();
    for (let i = 0; i < 18; i += 1) {
      sandbox.runtime.tick(100);
    }
    const savedSnapshot = sandbox.snapshot();
    const savedCampfire = savedSnapshot.entities.find((entity) => entity.role === "campfire");
    const savedWorker = savedSnapshot.entities.find((entity) => entity.role === "worker");
    const savedWorkerGas = savedSnapshot.gasActors.find(
      (actor) => actor.actor.actorId === savedWorker?.actorId
    );
    expect(savedCampfire).toBeDefined();
    expect(savedWorker).toBeDefined();
    expect(savedWorkerGas).toBeDefined();
    sandbox.runtime.world.set(savedWorker!.id, Selectable, { order: 1, selected: true });

    const saved = await manager.save(SANDBOX_SAVE_SLOT_ID, {
      runtime: {
        seed: "sandbox-save-seed",
        clock: savedSnapshot.clock
      }
    });
    const section = saved.envelope.payload.sections[SANDBOX_SAVE_CONTRIBUTOR_ID];
    expect(section).toBeDefined();
    const savedData = section!.data as SandboxSaveData;
    expect(savedData.entities.some((entity) => "selectable" in entity)).toBe(false);

    sandbox.runtime.world.set(savedCampfire!.id, ResourceStorage, { resource: 999 });
    sandbox.runtime.world.set(savedWorker!.id, Selectable, { order: 1, selected: false });
    sandbox.runtime.world.set(savedWorker!.id, GasAttributes, {
      current: {
        ...savedWorkerGas!.attributes.current,
        health: 5
      }
    });
    expect(
      sandbox.snapshot().gasActors.find((actor) => actor.actor.actorId === savedWorker?.actorId)
        ?.attributes.current.health
    ).toBe(5);

    await manager.load(SANDBOX_SAVE_SLOT_ID);
    sandbox.runtime.clock.restore({
      elapsed: savedSnapshot.clock.elapsed,
      ticks: savedSnapshot.clock.ticks,
      running: sandbox.runtime.isRunning()
    });
    const loadedSnapshot = sandbox.snapshot();
    const loadedCampfire = loadedSnapshot.entities.find(
      (entity) => entity.objectId === savedCampfire?.objectId
    );
    const loadedWorker = loadedSnapshot.entities.find(
      (entity) => entity.objectId === savedWorker?.objectId
    );

    expect(loadedCampfire?.resource).toBe(savedCampfire?.resource);
    expect(loadedCampfire?.objective?.progressResources).toBe(
      savedCampfire?.objective?.progressResources
    );
    expect(loadedWorker?.task).toBe(savedWorker?.task);
    expect(sandbox.runtime.world.get(savedWorker!.id, Selectable)?.selected).toBe(false);
    expect(loadedSnapshot.gasActors).toEqual(savedSnapshot.gasActors);
    expect(loadedSnapshot.clock.ticks).toBe(savedSnapshot.clock.ticks);
    expect(loadedSnapshot.clock.elapsed).toBe(savedSnapshot.clock.elapsed);
    expect(loadedSnapshot.events.map((event) => event.type)).toContain("sandbox.save_restored");
  });

  it("does not save selected targets or confirm interaction transients", async () => {
    const sandbox = createTestSandboxRuntime("sandbox-save-transient-seed");
    const manager = createSaveManager({
      appId: "sandbox",
      gameId: "sandbox",
      gameVersion: "0.1.0",
      formatVersion: "1.0.0",
      store: createMemorySaveStore()
    });
    manager.registerContributor(createSandboxSaveContributor(sandbox));

    sandbox.runtime.start();
    sandbox.runtime.tick(16);
    const worker = sandbox.snapshot().entities.find((entity) => entity.role === "worker");
    expect(worker).toBeDefined();

    sandbox.runtime.world.set(worker!.id, Selectable, { order: 1, selected: true });
    sandbox.runtime.eventBus.emit(
      "input.action",
      { actionId: "game.confirm", contextId: "gameplay", phase: "pressed", value: 1 },
      "test"
    );
    expect(
      sandbox.snapshot().gasActors.some((actor) => actor.tags.values.includes("state.overcharged"))
    ).toBe(true);

    const saved = await manager.save(SANDBOX_SAVE_SLOT_ID, {
      runtime: {
        seed: "sandbox-save-transient-seed",
        clock: sandbox.snapshot().clock
      }
    });
    const section = saved.envelope.payload.sections[SANDBOX_SAVE_CONTRIBUTOR_ID];
    expect(section).toBeDefined();
    const savedData = section!.data as SandboxSaveData;

    expect(savedData.entities.some((entity) => "selectable" in entity)).toBe(false);
    expect(
      savedData.gasActors.some((actor) => actor.tags.values.includes("state.overcharged"))
    ).toBe(false);
    expect(
      savedData.gasActors.some((actor) =>
        actor.effects.active.some(
          (effect) =>
            effect.effectId === "gas.effect.sandbox.overcharge_regen" ||
            effect.effectId === "gas.effect.sandbox.campfire_boost" ||
            effect.grantedTags.includes("state.overcharged")
        )
      )
    ).toBe(false);
  });

  it("syncs renderable entities to the renderer", async () => {
    const renderer = createMemoryRenderer();
    const sandbox = createTestSandboxRuntime({
      seed: "render-seed",
      renderer,
      renderSize: { width: 100, height: 100 }
    });

    await renderer.boot({
      container: { append() {} } as unknown as HTMLElement,
      width: 100,
      height: 100,
      onDiagnostic: (event) => {
        sandbox.runtime.eventBus.emit(event.type, event.payload, event.source);
      }
    });
    sandbox.runtime.start();
    sandbox.runtime.tick(16);
    sandbox.runtime.tick(16);

    expect(renderer.objects()).toHaveLength(19);
    expect(new Set(renderer.objects().map((object) => object.id)).size).toBe(19);
    expect(renderer.objects().filter((object) => object.type === "container").length).toBe(13);
    expect(renderer.objects().filter((object) => object.type === "sprite").length).toBe(6);
    expect(renderer.objects()[0]?.nodes.has("charge/fill")).toBe(true);
    expect(renderer.objects()[0]?.nodes.get("outer")?.props?.tint).toBeDefined();
    expect(sandbox.snapshot().entities.map((entity) => entity.role)).toEqual(
      expect.arrayContaining([
        "campfire",
        "resource-node",
        "worker",
        "storage",
        "workshop",
        "tower",
        "monster",
        "road"
      ])
    );
    expect(sandbox.snapshot().events.map((event) => event.type)).toContain(
      "sandbox.render_object_linked"
    );
  });

  it("exposes sandbox data documents and asset references", () => {
    const registry = createSandboxDataRegistry();
    const snapshot = registry.snapshot();
    const asset = registry.getValue<{ source: { url?: string } }>(
      "asset.definition",
      "asset.sandbox.entity_square"
    );

    expect(snapshot.types).toContain("asset.definition");
    expect(snapshot.types).toContain("render.object");
    expect(snapshot.types).toContain("sandbox.renderRig");
    expect(snapshot.types).toContain("sandbox.actor");
    expect(snapshot.types).toContain("sandbox.ability");
    expect(snapshot.types).toContain("gas.actor");
    expect(snapshot.types).toContain("gas.ability");
    expect(snapshot.types).toContain("gas.effect");
    expect(snapshot.types).toContain("sandbox.biome");
    expect(snapshot.types).toContain("sandbox.spawnProfile");
    expect(snapshot.types).toContain("sandbox.sceneObject");
    expect(snapshot.types).toContain("sandbox.building");
    expect(snapshot.types).toContain("sandbox.recipe");
    expect(snapshot.types).toContain("sandbox.objectivePhase");
    expect(snapshot.types).toContain("sandbox.wave");
    expect(snapshot.types).toContain("sandbox.route");
    expect(snapshot.types).toContain("sandbox.sceneLayout");
    expect(snapshot.types).toContain("tca.rule");
    expect(snapshot.documents.length).toBeGreaterThanOrEqual(78);
    expect(snapshot.references).toContainEqual(
      expect.objectContaining({
        from: expect.objectContaining({ type: "render.object", id: "render.sandbox.entity" }),
        to: expect.objectContaining({
          type: "asset.definition",
          id: "asset.sandbox.entity_square"
        }),
        path: "children.body"
      })
    );
    expect(snapshot.references).toContainEqual(
      expect.objectContaining({
        from: expect.objectContaining({ type: "sandbox.actor", id: "actor.sandbox.camp_crew" }),
        to: expect.objectContaining({
          type: "sandbox.renderRig",
          id: "renderRig.sandbox.camp_crew"
        }),
        path: "renderRigId"
      })
    );
    expect(snapshot.references).toContainEqual(
      expect.objectContaining({
        from: expect.objectContaining({
          type: "sandbox.spawnProfile",
          id: "spawn.sandbox.camp_shift"
        }),
        to: expect.objectContaining({ type: "sandbox.biome", id: "biome.sandbox.forest_clearing" }),
        path: "biomeId"
      })
    );
    expect(snapshot.references).toContainEqual(
      expect.objectContaining({
        from: expect.objectContaining({
          type: "sandbox.sceneObject",
          id: "scene.sandbox.campfire"
        }),
        to: expect.objectContaining({ type: "render.object", id: "render.sandbox.campfire" }),
        path: "renderObjectId"
      })
    );
    expect(snapshot.references).toContainEqual(
      expect.objectContaining({
        from: expect.objectContaining({
          type: "sandbox.sceneLayout",
          id: "sceneLayout.sandbox.tiny_camp"
        }),
        to: expect.objectContaining({
          type: "sandbox.sceneObject",
          id: "scene.sandbox.quarry"
        }),
        path: "objectIds[2]"
      })
    );
    expect(snapshot.references).toContainEqual(
      expect.objectContaining({
        from: expect.objectContaining({
          type: "sandbox.sceneObject",
          id: "scene.sandbox.campfire"
        }),
        to: expect.objectContaining({
          type: "sandbox.building",
          id: "building.sandbox.campfire"
        }),
        path: "buildingDefinitionId"
      })
    );
    expect(snapshot.references).toContainEqual(
      expect.objectContaining({
        from: expect.objectContaining({
          type: "sandbox.sceneLayout",
          id: "sceneLayout.sandbox.tiny_camp"
        }),
        to: expect.objectContaining({ type: "sandbox.route", id: "route.quarry.storage" }),
        path: "links[1].routeId"
      })
    );
    expect(asset.source.url).toContain("fill='white'");
  });

  it("summarizes content and assets through the sandbox snapshot", () => {
    const registry = createSandboxDataRegistry();
    const sandbox = createTestSandboxRuntime({
      seed: "content-seed",
      dataRegistry: registry,
      assetSummary: () => ({
        assetsLoaded: 2,
        assetsFailed: 1
      })
    });
    const registrySnapshot = registry.snapshot();
    const snapshot = sandbox.snapshot();

    expect(snapshot.contentSummary).toEqual({
      packs: registrySnapshot.packs.length,
      types: registrySnapshot.types.length,
      documents: registrySnapshot.documents.length,
      references: registrySnapshot.references.length,
      assetsLoaded: 2,
      assetsFailed: 1
    });
    expect(snapshot.moduleSummary.map((entry) => entry.id)).toEqual([
      "runtime",
      "world",
      "renderer",
      "rules"
    ]);
  });
});
