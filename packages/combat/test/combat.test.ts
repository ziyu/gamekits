import { createDataRegistry, type DataPack, type DataRegistry } from "@gamekits/data";
import { createEventBus } from "@gamekits/event-bus";
import { createGame } from "@gamekits/game-runtime";
import {
  createGasDataTypes,
  createGasHandle,
  createGasModule,
  createGasRuntime
} from "@gamekits/gas";
import {
  createPhysicsDataTypes,
  createPhysicsHandle,
  createPhysicsModule,
  PhysicsBodyComponent,
  PhysicsColliderComponent,
  PhysicsContactsComponent,
  PhysicsTransformComponent,
  PhysicsVelocityComponent,
  type PhysicsQueries,
  type PhysicsQueryResult
} from "@gamekits/physics-core";
import { initRapier2dPhysicsBackend } from "@gamekits/physics-rapier2d";
import { createKootaWorld } from "@gamekits/world-koota";
import { beforeAll, describe, expect, it } from "vitest";
import {
  CombatProjectileComponent,
  createCombatDataTypes,
  createCombatDeliveryDataType,
  createCombatHandle,
  createCombatModule,
  createCombatRuntime,
  createCombatSaveContributor,
  createCombatTraceStore,
  runCombatRuntimeConformance,
  type CombatEventPolicy,
  type CombatProjectileDespawnFact,
  type CombatProjectileSpawnFact,
  type CombatRuntime
} from "../src";

let rapierBackend: Awaited<ReturnType<typeof initRapier2dPhysicsBackend>>;

beforeAll(async () => {
  rapierBackend = await initRapier2dPhysicsBackend();
});

describe("Combat data", () => {
  it("validates delivery payload ownership and exposes typed references", () => {
    const type = createCombatDeliveryDataType();
    const projectile = document({
      id: "delivery.projectile",
      delivery: {
        type: "projectile" as const,
        projectile: { type: "combat.projectile" as const, id: "projectile.bolt" }
      },
      payloads: [],
      relationshipPolicy: "policy.hostile"
    });
    const invalidHitscan = document({
      id: "delivery.invalid",
      delivery: { type: "hitscan" as const, range: 0 },
      payloads: [],
      relationshipPolicy: "policy.hostile"
    });

    expect(type.validate?.(projectile, dataContext(projectile))).toEqual([]);
    expect(type.references?.(projectile, dataContext(projectile))).toEqual([
      { type: "combat.projectile", id: "projectile.bolt", path: "delivery.projectile" },
      { type: "combat.relationship-policy", id: "policy.hostile", path: "relationshipPolicy" }
    ]);
    expect(type.validate?.(invalidHitscan, dataContext(invalidHitscan))).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "combat.delivery_invalid_range" }),
        expect.objectContaining({ code: "combat.delivery_missing_payloads" })
      ])
    );
  });
});

describe("Combat runtime", () => {
  it("applies direct payloads through GAS, rejects friendly targets, and is idempotent", () => {
    const harness = createRuntimeHarness();
    const request = {
      id: "delivery.direct.1",
      sourceActorId: "actor.source",
      delivery: { type: "direct" as const, targetActorId: "actor.enemy" },
      payloads: [{ effectId: "effect.damage", target: "hit-actor" as const }],
      relationshipPolicy: "policy.hostile"
    };

    expect(harness.runtime.deliver(request)).toMatchObject({
      status: "resolved",
      duplicate: false,
      hits: [{ status: "applied", targetActorId: "actor.enemy" }]
    });
    expect(harness.gas.getActor("actor.enemy").attributes.current.health).toBe(90);
    expect(harness.runtime.deliver(request)).toMatchObject({ status: "resolved", duplicate: true });
    expect(harness.gas.getActor("actor.enemy").attributes.current.health).toBe(90);
    expect(harness.runtime.deliver({ ...request, targetActorId: "actor.ally" })).toMatchObject({
      status: "rejected",
      reason: "duplicate-request-conflict"
    });
    expect(
      harness.runtime.deliver({
        ...request,
        id: "delivery.direct.friendly",
        delivery: { type: "direct", targetActorId: "actor.ally" }
      })
    ).toMatchObject({ status: "rejected", reason: "target-disallowed" });
    expect(harness.runtime.snapshot().resolvedTicketCount).toBe(1);
    harness.dispose();
  });

  it("uses stable candidate ordering, ignores friendlies, and stops at blockers", () => {
    const harness = createRuntimeHarness();
    const wall = harness.world.spawn();
    harness.setRayResults([
      candidate(harness.entities.enemy, "collider.enemy", 3),
      candidate(wall, "collider.wall", 2),
      candidate(harness.entities.ally, "collider.ally", 1)
    ]);

    const blocked = harness.runtime.deliver({
      id: "delivery.hitscan.blocked",
      sourceActorId: "actor.source",
      delivery: {
        type: "hitscan",
        range: 10,
        direction: { x: 1, y: 0 },
        selection: { mode: "all", maxTargets: 4 }
      },
      payloads: [{ effectId: "effect.damage", target: "hit-actor" }],
      relationshipPolicy: "policy.hostile"
    });

    expect(blocked).toMatchObject({
      status: "resolved",
      hits: [],
      ignoredCandidates: 1,
      blockedBy: { subject: { entityId: wall } }
    });
    expect(harness.gas.getActor("actor.enemy").attributes.current.health).toBe(100);

    harness.setRayResults([
      candidate(harness.entities.enemyTwo, "collider.z", 2),
      candidate(harness.entities.enemy, "collider.a", 2)
    ]);
    const ordered = harness.runtime.deliver({
      id: "delivery.hitscan.ordered",
      sourceActorId: "actor.source",
      delivery: {
        type: "hitscan",
        range: 10,
        direction: { x: 1, y: 0 },
        selection: { mode: "all", maxTargets: 2, stopOnBlocker: true }
      },
      payloads: [{ effectId: "effect.damage", target: "hit-actor" }],
      relationshipPolicy: "policy.hostile"
    });
    expect(
      ordered.status === "resolved" ? ordered.hits.map((hit) => hit.targetActorId) : []
    ).toEqual(["actor.enemy", "actor.enemy-two"]);
    harness.dispose();
  });

  it("supports a second area-heal fixture through a different relationship policy", () => {
    const harness = createRuntimeHarness();
    harness.gas.modifyAttribute("actor.ally", {
      attribute: "health",
      operation: "set",
      value: 50
    });
    harness.setOverlapResults([
      candidate(harness.entities.enemy, "collider.enemy", 1),
      candidate(harness.entities.ally, "collider.ally", 2)
    ]);
    const result = harness.runtime.deliver({
      id: "delivery.area.support",
      sourceActorId: "actor.source",
      delivery: {
        type: "area",
        shape: { type: "circle", radius: 5 },
        position: { x: 0, y: 0 },
        selection: { mode: "all", maxTargets: 8 }
      },
      payloads: [{ effectId: "effect.heal", target: "hit-actor" }],
      relationshipPolicy: "policy.support"
    });

    expect(result.status === "resolved" ? result.hits.map((hit) => hit.targetActorId) : []).toEqual(
      ["actor.ally"]
    );
    expect(harness.gas.getActor("actor.ally").attributes.current.health).toBe(60);
    expect(harness.gas.getActor("actor.enemy").attributes.current.health).toBe(100);
    harness.dispose();
  });

  it("resolves melee overlap through the same stable target pipeline", () => {
    const harness = createRuntimeHarness();
    harness.setOverlapResults([
      candidate(harness.entities.ally, "collider.ally", 0.5),
      candidate(harness.entities.enemy, "collider.enemy", 1)
    ]);
    const result = harness.runtime.deliver({
      id: "delivery.melee",
      sourceActorId: "actor.source",
      delivery: {
        type: "melee",
        shape: { type: "circle", radius: 2 },
        offset: { x: 1, y: 0 },
        selection: { mode: "closest" }
      },
      payloads: [{ effectId: "effect.damage", target: "hit-actor" }],
      relationshipPolicy: "policy.hostile"
    });

    expect(result).toMatchObject({
      status: "resolved",
      hits: [{ targetActorId: "actor.enemy", status: "applied" }],
      ignoredCandidates: 1
    });
    harness.dispose();
  });

  it("reports GAS effect rejection without replaying the hit ticket", () => {
    const harness = createRuntimeHarness();
    harness.gas.applyEffect({ effectId: "effect.stack", targetActorId: "actor.enemy" });
    const result = harness.runtime.deliver({
      id: "delivery.rejected-effect",
      sourceActorId: "actor.source",
      delivery: { type: "direct", targetActorId: "actor.enemy" },
      payloads: [{ effectId: "effect.stack", target: "hit-actor" }],
      relationshipPolicy: "policy.hostile"
    });

    expect(result).toMatchObject({
      status: "resolved",
      hits: [{ status: "effect-rejected", payloads: [{ status: "rejected" }] }]
    });
    expect(harness.runtime.deliver(resultRequest())).toMatchObject({
      status: "resolved",
      duplicate: true
    });
    harness.dispose();

    function resultRequest() {
      return {
        id: "delivery.rejected-effect",
        sourceActorId: "actor.source",
        delivery: { type: "direct" as const, targetActorId: "actor.enemy" },
        payloads: [{ effectId: "effect.stack", target: "hit-actor" as const }],
        relationshipPolicy: "policy.hostile"
      };
    }
  });

  it("owns entity-backed projectile sweep, dedupe, lifetime, and despawn races", () => {
    const harness = createRuntimeHarness();
    const spawned = harness.runtime.deliver(
      projectileRequest("projectile.stop", "projectile.stop")
    );
    expect(spawned).toMatchObject({
      status: "resolved",
      projectile: { collisionMode: "ray-sweep", entityId: expect.any(String) }
    });
    if (spawned.status !== "resolved" || spawned.projectile === undefined) {
      throw new Error("Expected projectile spawn");
    }
    const projectileEntity = spawned.projectile.entityId;
    expect(harness.world.get(projectileEntity, PhysicsBodyComponent)?.bodyId).toBeDefined();
    expect(harness.world.get(projectileEntity, CombatProjectileComponent)?.projectileId).toBe(
      "projectile.stop.projectile"
    );
    harness.world.set(projectileEntity, PhysicsTransformComponent, { position: { x: 3, y: 0 } });
    harness.setRayResults([
      candidate(harness.entities.enemy, "collider.enemy", 2),
      candidate(harness.entities.enemy, "collider.enemy.duplicate", 2)
    ]);
    harness.runtime.update(16, 16);
    expect(harness.gas.getActor("actor.enemy").attributes.current.health).toBe(90);
    expect(harness.world.has(projectileEntity)).toBe(false);
    expect(harness.runtime.listProjectiles()).toEqual([]);

    harness.setRayResults([]);
    const raced = harness.runtime.deliver(
      projectileRequest("projectile.race", "projectile.pierce")
    );
    if (raced.status !== "resolved" || raced.projectile === undefined) {
      throw new Error("Expected race projectile spawn");
    }
    harness.world.despawn(raced.projectile.entityId);
    expect(() => harness.runtime.update(16, 32)).not.toThrow();
    expect(harness.runtime.getProjectile(raced.projectile.projectileId)).toBeUndefined();

    const expiring = harness.runtime.deliver(
      projectileRequest("projectile.expires", "projectile.short")
    );
    if (expiring.status !== "resolved" || expiring.projectile === undefined) {
      throw new Error("Expected expiring projectile spawn");
    }
    harness.runtime.update(100, 200);
    expect(harness.world.has(expiring.projectile.entityId)).toBe(false);
    expect(harness.runtime.snapshot().traces.map((entry) => entry.type)).toContain(
      "projectile.expired"
    );
    harness.dispose();
  });

  it("emits bounded authoritative projectile despawn facts for impact, expiry, and cancel", () => {
    const harness = createRuntimeHarness();
    const facts: CombatProjectileDespawnFact[] = [];
    const spawnFacts: CombatProjectileSpawnFact[] = [];
    const unsubscribeDespawn = harness.eventBus.on<CombatProjectileDespawnFact>(
      "combat.projectile_despawned",
      (event) => facts.push(event.payload)
    );
    const unsubscribeSpawn = harness.eventBus.on<CombatProjectileSpawnFact>(
      "combat.projectile_spawned",
      (event) => spawnFacts.push(event.payload)
    );
    const impacted = harness.runtime.deliver(
      projectileRequest("projectile.fact-impact", "projectile.stop")
    );
    if (impacted.status !== "resolved" || impacted.projectile === undefined) {
      throw new Error("Expected impact fact projectile spawn");
    }
    expect(spawnFacts.at(-1)).toMatchObject({
      projectileId: "projectile.fact-impact.projectile",
      definitionId: "projectile.stop",
      sourceActorId: "actor.source",
      entityId: impacted.projectile.entityId,
      position: { x: 0, y: 0 },
      velocity: { x: 120, y: 0 },
      spawnedAt: 0,
      expiresAt: 1000,
      correlationId: "projectile.fact-impact"
    });
    expect(JSON.stringify(spawnFacts.at(-1))).not.toMatch(
      /tags|metadata|payloads|hitMemory|candidate|query|relationshipPolicy|sourceSubject/
    );
    harness.world.set(impacted.projectile.entityId, PhysicsTransformComponent, {
      position: { x: 3, y: 1 }
    });
    harness.setRayResults([
      {
        ...candidate(harness.entities.enemy, "collider.enemy", 2),
        point: { x: 2, y: 0.5 },
        normal: { x: -1, y: 0 },
        fraction: 0.5,
        inside: false,
        sensor: true
      }
    ]);
    harness.runtime.update(16, 16);

    const impactFact = facts.at(-1);
    expect(impactFact).toMatchObject({
      projectileId: "projectile.fact-impact.projectile",
      entityId: impacted.projectile.entityId,
      definitionId: "projectile.stop",
      sourceActorId: "actor.source",
      reason: "impact",
      finalPosition: { x: 3, y: 1 },
      finalVelocity: { x: 120, y: 0 },
      correlationId: "projectile.fact-impact",
      impact: {
        disposition: "target",
        point: { x: 2, y: 0.5 },
        normal: { x: -1, y: 0 },
        distance: 2,
        subject: {
          actorId: "actor.enemy",
          entityId: harness.entities.enemy,
          bodyId: "collider.enemy.body",
          colliderId: "collider.enemy"
        }
      }
    });
    expect(JSON.stringify(impactFact)).not.toMatch(
      /fraction|inside|sensor|tags|metadata|payloads|hitMemory|candidate|query/
    );

    const blockerEntity = harness.world.spawn();
    const blocked = harness.runtime.deliver(
      projectileRequest("projectile.fact-blocker", "projectile.stop")
    );
    if (blocked.status !== "resolved" || blocked.projectile === undefined) {
      throw new Error("Expected blocker fact projectile spawn");
    }
    harness.world.set(blocked.projectile.entityId, PhysicsTransformComponent, {
      position: { x: 2, y: -1 }
    });
    harness.setRayResults([
      {
        entityId: blockerEntity,
        colliderId: "collider.wall",
        bodyId: "body.wall",
        point: { x: 1.5, y: -0.5 },
        normal: { x: 0, y: 1 },
        distance: 1.5
      }
    ]);
    harness.runtime.update(16, 32);
    expect(facts.at(-1)).toMatchObject({
      projectileId: "projectile.fact-blocker.projectile",
      reason: "impact",
      impact: {
        disposition: "blocker",
        point: { x: 1.5, y: -0.5 },
        normal: { x: 0, y: 1 },
        distance: 1.5,
        subject: {
          entityId: blockerEntity,
          bodyId: "body.wall",
          colliderId: "collider.wall"
        }
      }
    });
    expect(facts.at(-1)?.impact?.subject.actorId).toBeUndefined();

    harness.setRayResults([]);
    const expiring = harness.runtime.deliver(
      projectileRequest("projectile.fact-expiry", "projectile.short")
    );
    if (expiring.status !== "resolved" || expiring.projectile === undefined) {
      throw new Error("Expected expiry fact projectile spawn");
    }
    harness.world.set(expiring.projectile.entityId, PhysicsTransformComponent, {
      position: { x: 4, y: 2 }
    });
    harness.runtime.update(100, 200);
    expect(facts.at(-1)).toMatchObject({
      projectileId: "projectile.fact-expiry.projectile",
      reason: "expired",
      finalPosition: { x: 4, y: 2 }
    });
    expect(facts.at(-1)?.impact).toBeUndefined();

    const cancelled = harness.runtime.deliver(
      projectileRequest("projectile.fact-cancel", "projectile.stop")
    );
    if (cancelled.status !== "resolved" || cancelled.projectile === undefined) {
      throw new Error("Expected cancellation fact projectile spawn");
    }
    harness.world.set(cancelled.projectile.entityId, PhysicsTransformComponent, {
      position: { x: 5, y: 3 }
    });
    expect(
      harness.runtime.cancelProjectile({
        projectileId: cancelled.projectile.projectileId,
        reason: "test-cancelled"
      })
    ).toEqual({ status: "cancelled", projectileId: cancelled.projectile.projectileId });
    expect(facts.at(-1)).toMatchObject({
      projectileId: "projectile.fact-cancel.projectile",
      reason: "test-cancelled",
      finalPosition: { x: 5, y: 3 }
    });
    expect(facts.at(-1)?.impact).toBeUndefined();

    unsubscribeDespawn();
    unsubscribeSpawn();
    const countAfterUnsubscribe = facts.length;
    const spawnCountAfterUnsubscribe = spawnFacts.length;
    const silent = harness.runtime.deliver(
      projectileRequest("projectile.fact-unsubscribed", "projectile.stop")
    );
    if (silent.status !== "resolved" || silent.projectile === undefined) {
      throw new Error("Expected unsubscribe probe projectile spawn");
    }
    harness.runtime.cancelProjectile({ projectileId: silent.projectile.projectileId });
    expect(facts).toHaveLength(countAfterUnsubscribe);
    expect(spawnFacts).toHaveLength(spawnCountAfterUnsubscribe);
    harness.dispose();

    const disabledHarness = createRuntimeHarness({ emitProjectiles: false });
    let disabledEventCount = 0;
    const unsubscribeDisabledSpawn = disabledHarness.eventBus.on(
      "combat.projectile_spawned",
      () => {
        disabledEventCount += 1;
      }
    );
    const unsubscribeDisabledDespawn = disabledHarness.eventBus.on(
      "combat.projectile_despawned",
      () => {
        disabledEventCount += 1;
      }
    );
    const disabled = disabledHarness.runtime.deliver(
      projectileRequest("projectile.fact-disabled", "projectile.stop")
    );
    if (disabled.status !== "resolved" || disabled.projectile === undefined) {
      throw new Error("Expected disabled event policy projectile spawn");
    }
    disabledHarness.runtime.cancelProjectile({ projectileId: disabled.projectile.projectileId });
    expect(disabledEventCount).toBe(0);
    unsubscribeDisabledSpawn();
    unsubscribeDisabledDespawn();
    disabledHarness.dispose();
  });

  it("enforces projectile pierce, bounce, contact, and bounded hit memory policies", () => {
    const harness = createRuntimeHarness();
    const pierced = harness.runtime.deliver(
      projectileRequest("projectile.piercing", "projectile.pierce")
    );
    if (pierced.status !== "resolved" || pierced.projectile === undefined) {
      throw new Error("Expected piercing projectile spawn");
    }
    harness.setRayResults([
      candidate(harness.entities.enemy, "collider.enemy", 1),
      candidate(harness.entities.enemy, "collider.enemy.duplicate", 1)
    ]);
    harness.world.set(pierced.projectile.entityId, PhysicsTransformComponent, {
      position: { x: 1, y: 0 }
    });
    harness.runtime.update(16, 16);
    expect(harness.runtime.getProjectile(pierced.projectile.projectileId)?.hitCount).toBe(1);
    expect(harness.gas.getActor("actor.enemy").attributes.current.health).toBe(90);

    harness.world.set(pierced.projectile.entityId, PhysicsTransformComponent, {
      position: { x: 2, y: 0 }
    });
    harness.runtime.update(16, 32);
    expect(harness.gas.getActor("actor.enemy").attributes.current.health).toBe(90);
    harness.setRayResults([candidate(harness.entities.enemyTwo, "collider.enemy-two", 1)]);
    harness.world.set(pierced.projectile.entityId, PhysicsTransformComponent, {
      position: { x: 3, y: 0 }
    });
    harness.runtime.update(16, 48);
    expect(harness.gas.getActor("actor.enemy-two").attributes.current.health).toBe(90);
    expect(harness.runtime.getProjectile(pierced.projectile.projectileId)).toBeUndefined();

    const wall = harness.world.spawn();
    const bounced = harness.runtime.deliver(
      projectileRequest("projectile.bouncing", "projectile.bounce")
    );
    if (bounced.status !== "resolved" || bounced.projectile === undefined) {
      throw new Error("Expected bouncing projectile spawn");
    }
    harness.setRayResults([
      {
        ...candidate(wall, "collider.wall", 1),
        normal: { x: -1, y: 0 }
      }
    ]);
    harness.world.set(bounced.projectile.entityId, PhysicsTransformComponent, {
      position: { x: 1, y: 0 }
    });
    harness.runtime.update(16, 64);
    expect(harness.runtime.getProjectile(bounced.projectile.projectileId)?.bounceCount).toBe(1);
    expect(harness.world.get(bounced.projectile.entityId, PhysicsVelocityComponent)?.linear.x).toBe(
      -120
    );
    harness.world.set(bounced.projectile.entityId, PhysicsTransformComponent, {
      position: { x: 2, y: 0 }
    });
    harness.runtime.update(16, 80);
    expect(harness.runtime.getProjectile(bounced.projectile.projectileId)).toBeUndefined();

    harness.setRayResults([]);
    const contacted = harness.runtime.deliver(
      projectileRequest("projectile.contacting", "projectile.contact")
    );
    if (contacted.status !== "resolved" || contacted.projectile === undefined) {
      throw new Error("Expected contact projectile spawn");
    }
    const projectileCollider = harness.world.get(
      contacted.projectile.entityId,
      PhysicsColliderComponent
    )?.colliderId;
    harness.world.add(contacted.projectile.entityId, PhysicsContactsComponent, {
      contacts: [
        {
          phase: "enter",
          kind: "trigger",
          colliderA: projectileCollider!,
          colliderB: "collider.enemy",
          entityA: contacted.projectile.entityId,
          entityB: harness.entities.enemy,
          sensor: true
        }
      ]
    });
    harness.runtime.update(16, 96);
    expect(harness.gas.getActor("actor.enemy").attributes.current.health).toBe(80);
    expect(harness.runtime.getProjectile(contacted.projectile.projectileId)).toBeUndefined();

    const shaped = harness.runtime.deliver(
      projectileRequest("projectile.shaped", "projectile.shape")
    );
    if (shaped.status !== "resolved" || shaped.projectile === undefined) {
      throw new Error("Expected shape-sweep projectile spawn");
    }
    harness.setRayResults([candidate(harness.entities.enemyTwo, "collider.enemy-two", 1)]);
    harness.world.set(shaped.projectile.entityId, PhysicsTransformComponent, {
      position: { x: 1, y: 0 }
    });
    harness.runtime.update(16, 112);
    expect(harness.gas.getActor("actor.enemy-two").attributes.current.health).toBe(80);
    expect(harness.runtime.getProjectile(shaped.projectile.projectileId)).toBeUndefined();
    harness.dispose();
  });

  it("captures only Combat ownership and restores entity-mapped projectile state", () => {
    const harness = createRuntimeHarness();
    const spawned = harness.runtime.deliver(
      projectileRequest("projectile.checkpoint", "projectile.pierce")
    );
    if (spawned.status !== "resolved" || spawned.projectile === undefined) {
      throw new Error("Expected checkpoint projectile spawn");
    }
    const checkpoint = harness.runtime.captureCheckpoint();
    expect(JSON.stringify(checkpoint)).not.toContain("linearVelocity");
    harness.world.set(spawned.projectile.entityId, CombatProjectileComponent, { hitCount: 9 });
    const mappedEntity = harness.world.spawn();
    harness.world.add(
      mappedEntity,
      PhysicsBodyComponent,
      harness.world.get(spawned.projectile.entityId, PhysicsBodyComponent)
    );
    harness.world.add(
      mappedEntity,
      PhysicsColliderComponent,
      harness.world.get(spawned.projectile.entityId, PhysicsColliderComponent)
    );
    harness.world.add(
      mappedEntity,
      PhysicsTransformComponent,
      harness.world.get(spawned.projectile.entityId, PhysicsTransformComponent)
    );
    harness.world.add(
      mappedEntity,
      PhysicsVelocityComponent,
      harness.world.get(spawned.projectile.entityId, PhysicsVelocityComponent)
    );
    harness.runtime.restoreCheckpoint(checkpoint, {
      resolveEntityId: () => mappedEntity
    });
    expect(harness.runtime.getProjectile(spawned.projectile.projectileId)).toMatchObject({
      entityId: mappedEntity,
      hitCount: 0
    });
    expect(harness.world.has(spawned.projectile.entityId)).toBe(false);

    const contributor = createCombatSaveContributor({ handle: runtimeAsHandle(harness.runtime) });
    const section = contributor.capture({ now: 1 });
    expect(section && contributor.validate?.(section, {})).toEqual({ issues: [] });
    expect(contributor.order).toBe(350);
    harness.dispose();
  });

  it("passes the reusable facade conformance contract", () => {
    const harness = createRuntimeHarness();
    const beforeAllowed = harness.gas.getActor("actor.enemy").attributes.current.health;
    const beforeBlocked = harness.gas.getActor("actor.ally").attributes.current.health;
    const report = runCombatRuntimeConformance(() => ({
      runtime: harness.runtime,
      sourceActorId: "actor.source",
      allowedTargetActorId: "actor.enemy",
      blockedTargetActorId: "actor.ally",
      effectId: "effect.damage",
      relationshipPolicy: "policy.hostile",
      readAllowedApplications: () =>
        (beforeAllowed - harness.gas.getActor("actor.enemy").attributes.current.health) / 10,
      readBlockedApplications: () =>
        (beforeBlocked - harness.gas.getActor("actor.ally").attributes.current.health) / 10,
      dispose: harness.dispose
    }));
    expect(report.checks).toHaveLength(6);
  });
});

describe("Combat module with real Rapier2D and GAS", () => {
  it("resolves real queries and projectile sweep in module order, then releases all ownership", () => {
    const registry = createRegistry();
    const world = createKootaWorld();
    const eventBus = createEventBus();
    const despawnFacts: CombatProjectileDespawnFact[] = [];
    const unsubscribeDespawn = eventBus.on<CombatProjectileDespawnFact>(
      "combat.projectile_despawned",
      (event) => despawnFacts.push(event.payload)
    );
    const gas = createGasHandle();
    const physics = createPhysicsHandle();
    const combat = createCombatHandle();
    const game = createGame({
      world,
      eventBus,
      seed: "combat-real",
      modules: [
        createGasModule({ dataRegistry: registry, handle: gas }),
        createPhysicsModule({
          backend: rapierBackend,
          handle: physics,
          fixedDeltaMs: 1000 / 60,
          scene: { gravity: { x: 0, y: 0 } }
        }),
        createCombatModule({
          dataRegistry: registry,
          gas,
          physics,
          handle: combat,
          relationshipResolver
        })
      ]
    });
    const source = spawnPhysicsActor(world, "source", { x: 0, y: 0 });
    const enemy = spawnPhysicsActor(world, "enemy", { x: 4, y: 0 });
    gas.createActor({ actorId: "actor.source", definitionId: "actor.red", entityId: source });
    gas.createActor({ actorId: "actor.enemy", definitionId: "actor.blue", entityId: enemy });
    game.start();
    game.tick(1000 / 60);
    const rawHits = physics.raycast(
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      {
        maxDistance: 10,
        triggerInteraction: "include",
        mode: "all",
        sort: "distance"
      }
    );
    expect(
      rawHits.length,
      JSON.stringify({ rawHits, snapshot: physics.snapshot() })
    ).toBeGreaterThan(0);

    const hitscan = combat.deliver({
      id: "real.hitscan",
      sourceActorId: "actor.source",
      delivery: {
        type: "hitscan",
        range: 10,
        direction: { x: 1, y: 0 },
        query: { triggerInteraction: "include" }
      },
      payloads: [{ effectId: "effect.damage", target: "hit-actor" }],
      relationshipPolicy: "policy.hostile"
    });
    expect(hitscan, JSON.stringify({ rawHits, hitscan })).toMatchObject({
      status: "resolved",
      hits: [{ targetActorId: "actor.enemy" }]
    });
    expect(gas.getActor("actor.enemy").attributes.current.health).toBe(90);

    const projectile = combat.deliver(projectileRequest("real.projectile", "projectile.stop"));
    expect(projectile).toMatchObject({ status: "resolved", deliveryType: "projectile" });
    for (let index = 0; index < 8 && combat.listProjectiles().length > 0; index += 1) {
      game.tick(1000 / 60);
    }
    expect(gas.getActor("actor.enemy").attributes.current.health).toBe(80);
    expect(combat.listProjectiles()).toEqual([]);
    expect(despawnFacts.at(-1)).toMatchObject({
      projectileId: "real.projectile.projectile",
      reason: "impact",
      impact: {
        disposition: "target",
        subject: {
          actorId: "actor.enemy",
          entityId: enemy
        },
        point: { x: expect.any(Number), y: expect.any(Number) },
        normal: { x: expect.any(Number), y: expect.any(Number) }
      }
    });
    unsubscribeDespawn();
    game.dispose();
    expect(combat.isBound()).toBe(false);
    expect(physics.isBound()).toBe(false);
    expect(gas.isBound()).toBe(false);
    expect(world.query([CombatProjectileComponent])).toEqual([]);
  });
});

function createRuntimeHarness(eventPolicy?: CombatEventPolicy) {
  const registry = createRegistry();
  const world = createKootaWorld();
  const eventBus = createEventBus();
  const gas = createGasRuntime({ world, dataRegistry: registry, eventBus });
  const entities = {
    source: spawnSubject(world, { x: 0, y: 0 }),
    ally: spawnSubject(world, { x: 1, y: 0 }),
    enemy: spawnSubject(world, { x: 3, y: 0 }),
    enemyTwo: spawnSubject(world, { x: 4, y: 0 })
  };
  gas.createActor({
    actorId: "actor.source",
    definitionId: "actor.red",
    entityId: entities.source
  });
  gas.createActor({ actorId: "actor.ally", definitionId: "actor.red", entityId: entities.ally });
  gas.createActor({ actorId: "actor.enemy", definitionId: "actor.blue", entityId: entities.enemy });
  gas.createActor({
    actorId: "actor.enemy-two",
    definitionId: "actor.blue",
    entityId: entities.enemyTwo
  });
  let rayResults: PhysicsQueryResult[] = [];
  let overlapResults: PhysicsQueryResult[] = [];
  const physics = scriptedPhysics(
    () => rayResults,
    () => overlapResults
  );
  const runtime = createCombatRuntime({
    world,
    gas,
    physics,
    dataRegistry: registry,
    eventBus,
    eventPolicy,
    relationshipResolver,
    traceStore: createCombatTraceStore({ limit: 128 }),
    limits: { maxActiveProjectiles: 32 }
  });
  return {
    registry,
    world,
    gas,
    physics,
    eventBus,
    runtime,
    entities,
    setRayResults(results: PhysicsQueryResult[]) {
      rayResults = results;
    },
    setOverlapResults(results: PhysicsQueryResult[]) {
      overlapResults = results;
    },
    dispose() {
      runtime.dispose();
      gas.dispose();
    }
  };
}

function createRegistry(): DataRegistry {
  const registry = createDataRegistry();
  for (const type of [
    ...createGasDataTypes(),
    ...createPhysicsDataTypes(),
    ...createCombatDataTypes()
  ]) {
    registry.registerType(type);
  }
  const validation = registry.registerPack(combatPack);
  if (validation.diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
    throw new Error(JSON.stringify(validation.diagnostics));
  }
  return registry;
}

const combatPack: DataPack = {
  id: "combat.test",
  version: "1.0.0",
  entries: [
    {
      type: "gas.attribute",
      id: "health",
      data: { id: "health", min: 0, max: 100, defaultValue: 100 }
    },
    { type: "gas.tag", id: "team.red", data: { id: "team.red" } },
    { type: "gas.tag", id: "team.blue", data: { id: "team.blue" } },
    {
      type: "gas.actor",
      id: "actor.red",
      data: { id: "actor.red", attributes: { health: 100 }, tags: ["team.red"] }
    },
    {
      type: "gas.actor",
      id: "actor.blue",
      data: { id: "actor.blue", attributes: { health: 100 }, tags: ["team.blue"] }
    },
    {
      type: "gas.effect",
      id: "effect.damage",
      data: {
        id: "effect.damage",
        attributeModifiers: [{ attribute: "health", operation: "add", value: -10 }]
      }
    },
    {
      type: "gas.effect",
      id: "effect.heal",
      data: {
        id: "effect.heal",
        attributeModifiers: [{ attribute: "health", operation: "add", value: 10 }]
      }
    },
    {
      type: "gas.effect",
      id: "effect.stack",
      data: {
        id: "effect.stack",
        durationMs: 1000,
        stacking: { limit: 1, overflow: "reject-newest" }
      }
    },
    {
      type: "physics.collider",
      id: "collider.projectile",
      data: { id: "collider.projectile", shape: { type: "circle", radius: 0.1 }, sensor: true }
    },
    {
      type: "physics.body",
      id: "body.projectile",
      data: {
        id: "body.projectile",
        kind: "dynamic",
        gravityScale: 0,
        lockedAxes: ["rotation"],
        colliders: [{ type: "physics.collider", id: "collider.projectile" }]
      }
    },
    {
      type: "combat.relationship-policy",
      id: "policy.hostile",
      data: { id: "policy.hostile" }
    },
    {
      type: "combat.relationship-policy",
      id: "policy.support",
      data: { id: "policy.support" }
    },
    projectileDefinition("projectile.stop", "stop", 1000),
    projectileDefinition("projectile.pierce", "pierce", 1000),
    projectileDefinition("projectile.bounce", "bounce", 1000),
    projectileDefinition("projectile.contact", "stop", 1000, "contact"),
    projectileDefinition("projectile.shape", "stop", 1000, "shape-sweep"),
    projectileDefinition("projectile.short", "stop", 50)
  ]
};

function projectileDefinition(
  id: string,
  hitPolicy: "stop" | "pierce" | "bounce",
  lifetimeMs: number,
  collisionMode: "contact" | "ray-sweep" | "shape-sweep" = "ray-sweep"
) {
  return {
    type: "combat.projectile",
    id,
    data: {
      id,
      body: { type: "physics.body", id: "body.projectile" },
      lifetimeMs,
      speed: 120,
      collisionMode,
      hitPolicy,
      maxHits: hitPolicy === "pierce" ? 2 : 1,
      maxBounces: hitPolicy === "bounce" ? 1 : 0,
      query: { triggerInteraction: "include" },
      payloads: [{ effectId: "effect.damage", target: "hit-actor" }]
    }
  } satisfies DataPack["entries"][number];
}

const relationshipResolver = {
  resolve(source: { tags?: string[] }, target: { tags?: string[] }) {
    const sourceTeam = source.tags?.find((tag) => tag.startsWith("team."));
    const targetTeam = target.tags?.find((tag) => tag.startsWith("team."));
    return sourceTeam !== undefined && sourceTeam === targetTeam ? "ally" : "hostile";
  },
  allows(policyId: string, relationship: string) {
    return policyId === "policy.support" ? relationship === "ally" : relationship === "hostile";
  }
};

function scriptedPhysics(
  rayResults: () => PhysicsQueryResult[],
  overlapResults: () => PhysicsQueryResult[]
): PhysicsQueries {
  const empty = () => [] as PhysicsQueryResult[];
  return {
    query: empty,
    queryPoint: empty,
    raycast: () => rayResults().map(cloneCandidate),
    shapeCast: () => rayResults().map(cloneCandidate),
    overlapShape: () => overlapResults().map(cloneCandidate),
    checkOverlap: () => false,
    checkCollision: () => false,
    queryBounds: empty,
    snapshot: () => ({
      id: "scripted",
      backend: "scripted",
      dimension: "2d",
      gravity: { x: 0, y: 0 },
      bodyCount: 0,
      colliderCount: 0,
      activeContactCount: 0,
      disposed: false
    })
  };
}

function spawnSubject(
  world: ReturnType<typeof createKootaWorld>,
  position: { x: number; y: number }
) {
  const entity = world.spawn();
  world.add(entity, PhysicsTransformComponent, { position });
  return entity;
}

function spawnPhysicsActor(
  world: ReturnType<typeof createKootaWorld>,
  id: string,
  position: { x: number; y: number }
) {
  const entity = world.spawn();
  world.add(entity, PhysicsBodyComponent, {
    definition: { id: `${id}.body`, kind: "static", position },
    bodyId: `${id}.body`
  });
  world.add(entity, PhysicsColliderComponent, {
    definition: {
      id: `${id}.collider`,
      bodyId: `${id}.body`,
      shape: { type: "circle", radius: 0.5 },
      sensor: true
    },
    colliderId: `${id}.collider`
  });
  world.add(entity, PhysicsTransformComponent, { position });
  return entity;
}

function candidate(
  entityId: string | number,
  colliderId: string,
  distance: number
): PhysicsQueryResult {
  return {
    entityId,
    colliderId,
    bodyId: `${colliderId}.body`,
    distance,
    point: { x: distance, y: 0 }
  };
}

function cloneCandidate(result: PhysicsQueryResult): PhysicsQueryResult {
  return {
    ...result,
    ...(result.point === undefined ? {} : { point: { ...result.point } }),
    ...(result.normal === undefined ? {} : { normal: { ...result.normal } })
  };
}

function projectileRequest(id: string, definitionId: string) {
  return {
    id,
    sourceActorId: "actor.source",
    delivery: {
      type: "projectile" as const,
      projectile: { type: "combat.projectile" as const, id: definitionId },
      position: { x: 0, y: 0 },
      direction: { x: 1, y: 0 }
    },
    payloads: [],
    relationshipPolicy: "policy.hostile"
  };
}

function runtimeAsHandle(runtime: CombatRuntime) {
  return {
    deliver: runtime.deliver,
    getProjectile: runtime.getProjectile,
    listProjectiles: runtime.listProjectiles,
    cancelProjectile: runtime.cancelProjectile,
    captureCheckpoint: runtime.captureCheckpoint,
    restoreCheckpoint: runtime.restoreCheckpoint,
    snapshot: runtime.snapshot,
    isBound: () => true
  };
}

function document(data: {
  id: string;
  delivery:
    | { type: "hitscan"; range: number }
    | { type: "projectile"; projectile: { type: "combat.projectile"; id: string } };
  payloads: Array<{ effectId: string; target: "hit-actor" | "source-actor" }>;
  relationshipPolicy: string;
}) {
  return {
    type: "combat.delivery",
    id: data.id,
    data,
    priority: 0,
    tags: []
  };
}

function dataContext(value: ReturnType<typeof document>) {
  return {
    type: value.type,
    path: "entries[0]",
    pack: { id: "test", version: "1", entries: [] }
  };
}
