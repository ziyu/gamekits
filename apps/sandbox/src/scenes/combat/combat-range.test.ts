import {
  CombatProjectileComponent,
  createCombatHandle,
  createCombatModule
} from "@gamekits/combat";
import { createEventBus } from "@gamekits/event-bus";
import { createGame } from "@gamekits/game-runtime";
import { createGasHandle, createGasModule } from "@gamekits/gas";
import { createPhysicsHandle, createPhysicsModule } from "@gamekits/physics-core";
import { initRapier2dPhysicsBackend } from "@gamekits/physics-rapier2d";
import { createKootaWorld } from "@gamekits/world-koota";
import { beforeAll, describe, expect, it } from "vitest";
import { createCombatRangeDataRegistry } from "./data";
import {
  combatRangeRelationshipResolver,
  createCombatRangeBootstrapModule,
  createCombatRangeController,
  createCombatRangePresentationModule,
  createCombatRangeState
} from "./runtime";

let backend: Awaited<ReturnType<typeof initRapier2dPhysicsBackend>>;

beforeAll(async () => {
  backend = await initRapier2dPhysicsBackend({
    id: "sandbox.combat-range.test",
    groups: { actor: 0b0001, cover: 0b0010, projectile: 0b0100 }
  });
});

describe("Combat range scene", () => {
  it("registers a complete Data → Physics/GAS → Combat reference chain", () => {
    const registry = createCombatRangeDataRegistry();

    expect(registry.list("combat.delivery")).toHaveLength(6);
    expect(registry.list("combat.ability-delivery")).toHaveLength(6);
    expect(registry.list("combat.projectile")).toHaveLength(1);
    expect(registry.list("physics.body")).toHaveLength(1);
    expect(registry.list("gas.effect")).toHaveLength(2);
    expect(registry.list("gas.ability")).toHaveLength(6);
    expect(registry.list("gas.cue")).toHaveLength(8);
  });

  it("exercises melee, area filtering, cover blocking, support, and physical projectiles", () => {
    const harness = createHarness();

    expect(harness.scene.perform("melee")).toMatchObject({
      status: "resolved",
      hits: [{ targetActorId: "actor.range.close-target" }]
    });
    expect(harness.gas.getActor("actor.range.close-target").attributes.current.health).toBe(82);
    expect(
      harness.gas.listAbilityExecutions({
        abilityId: "range.ability.melee",
        includeRecent: true
      })
    ).toEqual([
      expect.objectContaining({
        actorId: "actor.range.operator",
        phase: "recovering"
      })
    ]);
    expect(harness.scene.snapshot().cues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "combat.impact.damage" }),
        expect.objectContaining({ type: "combat.attack.melee" })
      ])
    );

    harness.scene.reset();
    const area = harness.scene.perform("area");
    expect(area).toMatchObject({ status: "resolved", deliveryType: "area" });
    if (area.status !== "resolved") {
      throw new Error("Shock Ring should resolve");
    }
    expect(new Set(area.hits.map((hit) => hit.targetActorId))).toEqual(
      new Set([
        "actor.range.area-target-left",
        "actor.range.area-target",
        "actor.range.area-target-right"
      ])
    );
    expect(area.hits).toHaveLength(3);
    expect(harness.gas.getActor("actor.range.area-target-left").attributes.current.health).toBe(82);
    expect(harness.gas.getActor("actor.range.area-target").attributes.current.health).toBe(82);
    expect(harness.gas.getActor("actor.range.area-target-right").attributes.current.health).toBe(
      82
    );
    expect(harness.gas.getActor("actor.range.support").attributes.current.health).toBe(64);
    const areaSnapshot = harness.scene.snapshot();
    expect(
      areaSnapshot.cues.find((cue) => cue.type === "combat.attack.area")?.selectedActorIds
    ).toEqual(expect.arrayContaining(area.hits.map((hit) => hit.targetActorId)));
    expect(
      areaSnapshot.cues
        .filter((cue) => cue.type === "combat.impact.damage")
        .map((cue) => cue.targetActorId)
    ).toEqual(expect.arrayContaining(area.hits.map((hit) => hit.targetActorId)));

    expect(harness.scene.perform("heal")).toMatchObject({
      status: "resolved",
      hits: [{ targetActorId: "actor.range.support" }]
    });
    expect(harness.gas.getActor("actor.range.support").attributes.current.health).toBe(80);

    const cover = harness.scene.perform("cover");
    expect(cover).toMatchObject({ status: "resolved", hits: [], blockedBy: expect.any(Object) });
    expect(harness.gas.getActor("actor.range.covered-target").attributes.current.health).toBe(100);

    harness.scene.reset();
    expect(harness.scene.perform("projectile")).toMatchObject({
      status: "resolved",
      deliveryType: "projectile",
      projectile: expect.any(Object)
    });
    for (let tick = 0; tick < 40 && harness.combat.listProjectiles().length > 0; tick += 1) {
      harness.game.tick(1000 / 60);
    }
    expect(harness.gas.getActor("actor.range.close-target").attributes.current.health).toBe(82);
    expect(harness.combat.listProjectiles()).toEqual([]);

    const snapshot = harness.scene.snapshot();
    expect(snapshot.objects).toHaveLength(8);
    expect(snapshot.targetCount).toBe(5);
    expect(snapshot.feedback.some((entry) => entry.tone === "impact")).toBe(true);
    harness.game.dispose();
    expect(harness.world.query([CombatProjectileComponent])).toEqual([]);
    expect(harness.combat.isBound()).toBe(false);
    expect(harness.physics.isBound()).toBe(false);
    expect(harness.gas.isBound()).toBe(false);
  });
});

function createHarness() {
  const registry = createCombatRangeDataRegistry();
  const world = createKootaWorld();
  const eventBus = createEventBus();
  const gas = createGasHandle({ id: "sandbox.combat-range.test.gas" });
  const physics = createPhysicsHandle({ id: "sandbox.combat-range.test.physics" });
  const combat = createCombatHandle({ id: "sandbox.combat-range.test.combat" });
  const state = createCombatRangeState();
  const game = createGame({
    world,
    eventBus,
    seed: "sandbox-combat-range-test",
    modules: [
      createGasModule({
        id: "sandbox.combat-range.test.gas",
        dataRegistry: registry,
        handle: gas
      }),
      createPhysicsModule({
        id: "sandbox.combat-range.test.physics",
        backend,
        handle: physics,
        fixedDeltaMs: 1000 / 60,
        scene: { gravity: { x: 0, y: 0 } }
      }),
      createCombatRangeBootstrapModule(state, gas),
      createCombatModule({
        id: "sandbox.combat-range.test.combat",
        dataRegistry: registry,
        gas,
        physics,
        handle: combat,
        relationshipResolver: combatRangeRelationshipResolver,
        projectileBounds: {
          min: { x: -7, y: -3.5 },
          max: { x: 7, y: 3.5 }
        },
        abilityDelivery: {
          onResult({ result }) {
            state.lastResult = result;
          }
        }
      }),
      createCombatRangePresentationModule(state)
    ]
  });
  const scene = createCombatRangeController({ runtime: game, world, gas, physics, combat, state });
  game.start();
  game.tick(1000 / 60);
  return { registry, world, gas, physics, combat, game, scene };
}
