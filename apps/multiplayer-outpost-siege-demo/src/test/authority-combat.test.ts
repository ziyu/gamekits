import { createEventBus } from "@gamekits/event-bus";
import type { PhysicsBackendAdapter } from "@gamekits/physics-core";
import { initRapier2dPhysicsBackend } from "@gamekits/physics-rapier2d";
import { createKootaWorld } from "@gamekits/world-koota";
import { beforeAll, describe, expect, it } from "vitest";

import { createOutpostDataRegistry } from "../content";
import {
  createOutpostAuthorityGameplayRuntime,
  type OutpostAuthorityCombatCommand,
  type OutpostAuthorityPlayerActionCommand,
  type OutpostAuthorityPlayerState
} from "../gameplay";

const FIXED_DELTA_MS = 1000 / 60;

describe("Outpost authority combat", () => {
  let physicsBackend: PhysicsBackendAdapter;

  beforeAll(async () => {
    physicsBackend = await initRapier2dPhysicsBackend({
      id: "outpost.authority-combat.test.rapier2d",
      lengthUnit: 100
    });
  });

  it("resolves a correlated rifle kill through World, Physics, GAS, and TCA", () => {
    const world = createKootaWorld();
    const pendingCommands: OutpostAuthorityCombatCommand[] = [];
    const player = createPlayer();
    const authority = createOutpostAuthorityGameplayRuntime({
      dataRegistry: createOutpostDataRegistry(),
      world,
      physicsBackend,
      eventBus: createEventBus(),
      players: () => [player],
      combatCommands() {
        return pendingCommands.splice(0, pendingCommands.length);
      },
      initialEnemies: [
        { id: "enemy.test.raider", definitionId: "enemy.outpost.raider", x: 450, y: 300 }
      ]
    });
    authority.runtime.start();
    tick(authority, 2);

    for (let shot = 1; shot <= 4; shot += 1) {
      const beforeHits = authority.snapshot().combat.projectileHits;
      const enemy = authority
        .snapshot()
        .combat.actors.find((actor) => actor.id === "enemy.test.raider");
      expect(enemy).toBeDefined();
      pendingCommands.push({
        id: `combat-shot-${shot}`,
        playerId: player.playerId,
        ability: "rifle",
        aimX: enemy?.x ?? 450,
        aimY: enemy?.y ?? 300,
        correlationId: `outpost.test.rifle.${shot}`
      });
      tickUntil(authority, () => authority.snapshot().combat.projectileHits > beforeHits, 30);
      const hitX = shot === 1 ? combatActor(authority, "enemy.test.raider").x : undefined;
      tick(authority, 2);
      if (hitX !== undefined) {
        expect(combatActor(authority, "enemy.test.raider").x).toBeGreaterThan(hitX);
      }
    }
    tick(authority, 3);

    expect(authority.snapshot().combat).toMatchObject({
      acceptedCommands: 4,
      rejectedCommands: 0,
      projectileHits: 4,
      kills: 1,
      drops: 1,
      objectiveProgress: 1
    });
    expect(
      authority.snapshot().combat.actors.some((actor) => actor.id === "enemy.test.raider")
    ).toBe(false);
    expect(
      authority.combatTrace.list().some((trace) => trace.correlationId === "outpost.test.rifle.4")
    ).toBe(true);
    expect(
      authority.gasTrace.list().some((trace) => trace.correlationId === "outpost.test.rifle.4")
    ).toBe(true);
    expect(
      authority.tcaTrace.list().some((trace) => trace.correlationId === "outpost.test.rifle.4")
    ).toBe(true);
    const projectileRecords = authority.snapshot().combat.projectileRecords;
    expect(projectileRecords).toHaveLength(4);
    expect(projectileRecords.at(-1)).toMatchObject({
      correlationId: "outpost.test.rifle.4",
      generation: "outpost.authority",
      definitionId: "combat.outpost.projectile.rifle",
      definitionVersion: "outpost.rifle-projectile.v1",
      fixedDeltaMs: FIXED_DELTA_MS,
      finish: {
        reason: "impact",
        subject: { actorId: "enemy.test.raider.actor" }
      }
    });
    expect(projectileRecords.at(-1)?.finish?.tick).toBeGreaterThan(
      projectileRecords.at(-1)?.fireTick ?? 0
    );

    authority.runtime.dispose();
    expect(world.count()).toBe(0);
  });

  it("owns held-fire cadence, magazine depletion, and timed reload on authority", () => {
    const world = createKootaWorld();
    const player = createPlayer();
    const pendingPlayerActions: OutpostAuthorityPlayerActionCommand[] = [];
    const authority = createOutpostAuthorityGameplayRuntime({
      dataRegistry: createOutpostDataRegistry(),
      world,
      physicsBackend,
      eventBus: createEventBus(),
      players: () => [player],
      playerActions() {
        return pendingPlayerActions.splice(0, pendingPlayerActions.length);
      },
      initialEnemies: []
    });
    authority.runtime.start();
    tick(authority, 2);

    player.input.fireSequence = 1;
    tickUntil(
      authority,
      () => combatActor(authority, player.playerId).weapon?.shotSequence === 1,
      10
    );
    expect(combatActor(authority, player.playerId).weapon).toMatchObject({
      magazine: 23,
      shotSequence: 1,
      lastShotCorrelationId: `${player.playerId}.rifle.1`
    });

    player.input.fireHeld = true;
    tickUntil(
      authority,
      () => combatActor(authority, player.playerId).weapon?.phase === "reloading",
      240
    );
    const depleted = combatActor(authority, player.playerId).weapon;
    expect(depleted).toMatchObject({
      magazine: 0,
      magazineSize: 24,
      reserveAmmo: 144,
      phase: "reloading",
      shotSequence: 24
    });
    expect(authority.snapshot().combat).toMatchObject({
      acceptedCommands: 24,
      rejectedCommands: 0
    });

    player.input.fireHeld = false;
    tickUntil(
      authority,
      () => combatActor(authority, player.playerId).weapon?.phase === "ready",
      120
    );
    expect(combatActor(authority, player.playerId).weapon).toMatchObject({
      magazine: 24,
      reserveAmmo: 120,
      phase: "ready",
      shotSequence: 24
    });
    expect(
      authority.gas
        .listAbilityExecutions({
          actorId: player.playerId,
          abilityId: "ability.outpost.rifle_reload",
          includeRecent: true
        })
        .some((execution) => execution.phase === "completed")
    ).toBe(true);

    player.input.fireHeld = true;
    tickUntil(
      authority,
      () => (combatActor(authority, player.playerId).weapon?.shotSequence ?? 0) === 26,
      40
    );
    player.input.fireHeld = false;
    pendingPlayerActions.push({
      id: "player.test.manual-reload",
      playerId: player.playerId,
      action: "reload",
      aimX: 600,
      aimY: 300,
      correlationId: "outpost.test.manual-reload"
    });
    tick(authority, 1);
    expect(combatActor(authority, player.playerId).weapon).toMatchObject({
      magazine: 22,
      reserveAmmo: 120,
      phase: "reloading",
      shotSequence: 26,
      reloadRequestId: "player.test.manual-reload",
      reloadCorrelationId: "outpost.test.manual-reload"
    });

    player.input.fireSequence = 2;
    tickUntil(
      authority,
      () => combatActor(authority, player.playerId).weapon?.shotSequence === 27,
      10
    );
    expect(combatActor(authority, player.playerId).weapon).toMatchObject({
      magazine: 21,
      reserveAmmo: 120,
      phase: "ready",
      shotSequence: 27,
      lastFeedback: {
        kind: "cancelled",
        action: "reload",
        reason: "interrupted-by-rifle",
        correlationId: `${player.playerId}.rifle.27`
      }
    });
    expect(
      authority.gas
        .listAbilityExecutions({
          actorId: player.playerId,
          abilityId: "ability.outpost.rifle_reload",
          includeRecent: true
        })
        .some(
          (execution) =>
            execution.requestId === "player.test.manual-reload" &&
            execution.phase === "cancelled" &&
            execution.cancellationReason === "interrupted-by-rifle"
        )
    ).toBe(true);

    pendingPlayerActions.push({
      id: "player.test.committed-reload",
      playerId: player.playerId,
      action: "reload",
      aimX: 600,
      aimY: 300,
      correlationId: "outpost.test.committed-reload"
    });
    tick(authority, 1);
    tickUntil(
      authority,
      () =>
        combatActor(authority, player.playerId).weapon?.phase === "reloading" &&
        combatActor(authority, player.playerId).weapon?.magazine === 24,
      90
    );
    pendingPlayerActions.push({
      id: "player.test.dash-after-reload-commit",
      playerId: player.playerId,
      action: "dash",
      aimX: 700,
      aimY: 300,
      correlationId: "outpost.test.dash-after-reload-commit"
    });
    tick(authority, 1);
    expect(combatActor(authority, player.playerId)).toMatchObject({
      stamina: 75,
      weapon: {
        magazine: 24,
        reserveAmmo: 117,
        phase: "reloading",
        reloadRequestId: "player.test.committed-reload"
      }
    });
    expect(combatActor(authority, player.playerId).tags).toContain("state.dashing");

    tickUntil(
      authority,
      () => combatActor(authority, player.playerId).weapon?.phase === "ready",
      60
    );
    tick(authority, 60);
    player.input.fireSequence = 3;
    tickUntil(
      authority,
      () => combatActor(authority, player.playerId).weapon?.shotSequence === 28,
      10
    );
    pendingPlayerActions.push({
      id: "player.test.reload-before-conflict",
      playerId: player.playerId,
      action: "reload",
      aimX: 700,
      aimY: 300,
      correlationId: "outpost.test.reload-before-conflict"
    });
    tick(authority, 1);
    const rejectedBeforeConflict = authority.snapshot().combat.rejectedCommands;
    pendingPlayerActions.push({
      id: "player.test.shock-during-reload",
      playerId: player.playerId,
      action: "shock-field",
      aimX: 700,
      aimY: 300,
      correlationId: "outpost.test.shock-during-reload"
    });
    tick(authority, 1);
    expect(authority.snapshot().combat.rejectedCommands).toBe(rejectedBeforeConflict + 1);
    expect(combatActor(authority, player.playerId).weapon).toMatchObject({
      phase: "reloading",
      reloadRequestId: "player.test.reload-before-conflict"
    });
    expect(
      authority.gas
        .listAbilityExecutions({ actorId: player.playerId })
        .some((execution) => execution.abilityId === "ability.outpost.shock_field")
    ).toBe(false);

    pendingPlayerActions.push({
      id: "player.test.dash-cancels-reload",
      playerId: player.playerId,
      action: "dash",
      aimX: 700,
      aimY: 300,
      correlationId: "outpost.test.dash-cancels-reload"
    });
    tick(authority, 1);
    expect(combatActor(authority, player.playerId).weapon).toMatchObject({
      phase: "ready",
      lastFeedback: {
        kind: "cancelled",
        action: "reload",
        reason: "interrupted-by-dash",
        correlationId: "outpost.test.dash-cancels-reload"
      }
    });

    pendingPlayerActions.push({
      id: "player.test.reload-survives-rejected-dash",
      playerId: player.playerId,
      action: "reload",
      aimX: 700,
      aimY: 300,
      correlationId: "outpost.test.reload-survives-rejected-dash"
    });
    tick(authority, 1);
    const rejectedBeforeCooldownDash = authority.snapshot().combat.rejectedCommands;
    pendingPlayerActions.push({
      id: "player.test.rejected-dash-does-not-cancel",
      playerId: player.playerId,
      action: "dash",
      aimX: 700,
      aimY: 300,
      correlationId: "outpost.test.rejected-dash-does-not-cancel"
    });
    tick(authority, 1);
    expect(authority.snapshot().combat.rejectedCommands).toBe(rejectedBeforeCooldownDash + 1);
    expect(combatActor(authority, player.playerId).weapon).toMatchObject({
      phase: "reloading",
      reloadRequestId: "player.test.reload-survives-rejected-dash",
      reloadCorrelationId: "outpost.test.reload-survives-rejected-dash"
    });

    authority.runtime.dispose();
    expect(world.count()).toBe(0);
  });

  it("accepts a reliable rifle edge before fixed input and ignores its stale replay", () => {
    const world = createKootaWorld();
    const player = createPlayer();
    const pendingPlayerActions: OutpostAuthorityPlayerActionCommand[] = [];
    const authority = createOutpostAuthorityGameplayRuntime({
      dataRegistry: createOutpostDataRegistry(),
      world,
      physicsBackend,
      eventBus: createEventBus(),
      players: () => [player],
      playerActions() {
        return pendingPlayerActions.splice(0, pendingPlayerActions.length);
      },
      initialEnemies: []
    });
    authority.runtime.start();
    tick(authority, 2);

    pendingPlayerActions.push({
      id: "reliable-rifle-1",
      playerId: player.playerId,
      action: "rifle",
      aimX: 620,
      aimY: 300,
      fireSequence: 1,
      fireHeld: true
    });
    tick(authority, 1);
    expect(combatActor(authority, player.playerId).weapon).toMatchObject({
      magazine: 23,
      shotSequence: 1,
      lastShotCorrelationId: `${player.playerId}.rifle.1`
    });

    pendingPlayerActions.push({
      id: "reliable-rifle-1-release",
      playerId: player.playerId,
      action: "rifle",
      aimX: 620,
      aimY: 300,
      fireSequence: 1,
      fireHeld: false
    });
    player.input.fireSequence = 0;
    player.input.fireHeld = true;
    tick(authority, 10);
    expect(combatActor(authority, player.playerId).weapon).toMatchObject({
      magazine: 23,
      shotSequence: 1
    });

    pendingPlayerActions.push({
      id: "reliable-rifle-1-duplicate",
      playerId: player.playerId,
      action: "rifle",
      aimX: 620,
      aimY: 300,
      fireSequence: 1,
      fireHeld: false
    });
    tick(authority, 1);
    expect(combatActor(authority, player.playerId).weapon).toMatchObject({
      magazine: 23,
      shotSequence: 1
    });

    authority.runtime.dispose();
    expect(world.count()).toBe(0);
  });

  it("keeps projectile record identity unique when the same player rejoins", () => {
    const world = createKootaWorld();
    const player = createPlayer();
    const pendingPlayerActions: OutpostAuthorityPlayerActionCommand[] = [];
    let connected = true;
    const authority = createOutpostAuthorityGameplayRuntime({
      dataRegistry: createOutpostDataRegistry(),
      world,
      physicsBackend,
      eventBus: createEventBus(),
      players: () => (connected ? [player] : []),
      playerActions() {
        return pendingPlayerActions.splice(0, pendingPlayerActions.length);
      },
      initialEnemies: []
    });
    authority.runtime.start();
    tick(authority, 2);

    fireReliableRifle(pendingPlayerActions, player.playerId, "first-join");
    tickUntil(
      authority,
      () => authority.snapshot().combat.projectileRecords[0]?.finish !== undefined,
      100
    );
    const firstRecord = authority.snapshot().combat.projectileRecords[0]!;

    connected = false;
    tick(authority, 1);
    player.input.fireHeld = false;
    player.input.fireSequence = 0;
    connected = true;
    tick(authority, 2);
    expect(authority.snapshot().players[0]?.generation).toBe(1);

    fireReliableRifle(pendingPlayerActions, player.playerId, "second-join");
    tickUntil(
      authority,
      () =>
        authority
          .snapshot()
          .combat.projectileRecords.filter(
            (record) => record.correlationId === `${player.playerId}.rifle.1`
          ).length === 2,
      10
    );
    const records = authority
      .snapshot()
      .combat.projectileRecords.filter(
        (record) => record.correlationId === `${player.playerId}.rifle.1`
      );
    expect(new Set(records.map((record) => record.projectileId)).size).toBe(2);
    expect(firstRecord.projectileId).toContain("owner-generation:0");
    expect(records.at(-1)?.projectileId).toContain("owner-generation:1");

    authority.runtime.dispose();
    expect(world.count()).toBe(0);
  });

  it("projects bounded correlated combat cues from real authority outcomes", () => {
    const world = createKootaWorld();
    const pendingCommands: OutpostAuthorityCombatCommand[] = [];
    const player = createPlayer();
    const authority = createOutpostAuthorityGameplayRuntime({
      dataRegistry: createOutpostDataRegistry(),
      world,
      physicsBackend,
      eventBus: createEventBus(),
      players: () => [player],
      combatCommands() {
        return pendingCommands.splice(0, pendingCommands.length);
      },
      initialEnemies: [
        { id: "enemy.test.cue-target", definitionId: "enemy.outpost.raider", x: 450, y: 300 }
      ]
    });
    authority.runtime.start();
    tick(authority, 2);

    pendingCommands.push({
      id: "combat-cue-shot",
      playerId: player.playerId,
      ability: "rifle",
      aimX: 450,
      aimY: 300,
      correlationId: "outpost.test.cue-shot"
    });
    tickUntil(authority, () => authority.snapshot().combat.projectileHits > 0, 30);
    pendingCommands.push(
      command("combat-cue-rejection", player.playerId, "deploy-turret", 2_000, 300)
    );
    tick(authority, 1);

    const combat = authority.snapshot().combat;
    expect(combat.cues.length).toBeLessThanOrEqual(64);
    expect(combat.cues.map((cue) => cue.sequence)).toEqual(
      [...combat.cues].map((cue) => cue.sequence).sort((left, right) => left - right)
    );
    expect(combat.cueWatermark).toBe(combat.cues.at(-1)?.sequence);
    expect(combat.cues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "projectile-spawned",
          sourceObjectId: player.playerId,
          correlationId: "outpost.test.cue-shot"
        }),
        expect.objectContaining({
          kind: "health-hit",
          sourceObjectId: player.playerId,
          targetObjectId: "enemy.test.cue-target",
          correlationId: "outpost.test.cue-shot",
          direction: { x: 1, y: 0 },
          amount: 12
        }),
        expect.objectContaining({
          kind: "action-rejected",
          sourceObjectId: player.playerId,
          correlationId: "outpost.test.combat-cue-rejection",
          ability: "deploy-turret"
        })
      ])
    );

    authority.runtime.dispose();
    expect(world.count()).toBe(0);
  });

  it("validates placement, costs, cooldowns, status effects, dash, and enemy attacks", () => {
    const world = createKootaWorld();
    const pendingCommands: OutpostAuthorityCombatCommand[] = [];
    const player = createPlayer();
    const authority = createOutpostAuthorityGameplayRuntime({
      dataRegistry: createOutpostDataRegistry(),
      world,
      physicsBackend,
      eventBus: createEventBus(),
      players: () => [player],
      combatCommands() {
        return pendingCommands.splice(0, pendingCommands.length);
      },
      initialEnemies: [
        { id: "enemy.test.attacker", definitionId: "enemy.outpost.raider", x: 340, y: 300 }
      ]
    });
    authority.runtime.start();
    tickUntil(authority, () => authority.snapshot().combat.enemyAttacks > 0, 120);

    pendingCommands.push(
      command("invalid-placement", player.playerId, "deploy-turret", 2_000, 300)
    );
    tick(authority, 1);
    expect(authority.snapshot().combat).toMatchObject({ acceptedCommands: 0, rejectedCommands: 1 });
    expect(combatActor(authority, player.playerId).resource).toBe(100);

    pendingCommands.push(command("valid-placement", player.playerId, "deploy-turret", 300, 400));
    tick(authority, 1);
    expect(authority.snapshot().combat.actors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "turret.1", kind: "buildable", resource: 0 })
      ])
    );
    expect(combatActor(authority, player.playerId).resource).toBe(75);

    pendingCommands.push(command("shock", player.playerId, "shock-field", 340, 300));
    tick(authority, 1);
    expect(
      authority.gas
        .listAbilityExecutions({ actorId: player.playerId })
        .some((execution) => execution.phase === "preparing")
    ).toBe(true);
    tickUntil(
      authority,
      () => combatActor(authority, "enemy.test.attacker").tags.includes("status.shocked"),
      30
    );
    expect(combatActor(authority, "enemy.test.attacker").tags).toContain("status.shocked");

    pendingCommands.push(command("dash-1", player.playerId, "dash", 500, 300));
    tick(authority, 1);
    expect(combatActor(authority, player.playerId)).toMatchObject({ stamina: 75 });
    expect(combatActor(authority, player.playerId).tags).toContain("state.dashing");
    expect(authority.snapshot().players[0]).toMatchObject({
      dashSequence: 1,
      dashDirectionX: 1,
      dashDirectionY: 0
    });
    expect(authority.snapshot().players[0]!.velocityX).toBeGreaterThan(500);

    pendingCommands.push(command("dash-2", player.playerId, "dash", 500, 300));
    tick(authority, 1);
    expect(authority.snapshot().combat).toMatchObject({ acceptedCommands: 3, rejectedCommands: 2 });
    expect(combatActor(authority, player.playerId).stamina).toBe(75);

    authority.gas.modifyAttribute(
      player.playerId,
      { attribute: "shared-resource", operation: "set", value: 0 },
      "test"
    );
    tick(authority, 31);
    const buildablesBefore = authority
      .snapshot()
      .combat.actors.filter((actor) => actor.kind === "buildable").length;
    pendingCommands.push(command("no-resource", player.playerId, "deploy-turret", 400, 400));
    tick(authority, 1);
    expect(
      authority.snapshot().combat.actors.filter((actor) => actor.kind === "buildable")
    ).toHaveLength(buildablesBefore);
    expect(authority.snapshot().combat.rejectedCommands).toBe(3);

    authority.runtime.dispose();
    expect(world.count()).toBe(0);
  });

  it("replicates Dash stamina cost, rejection reason, and authority recovery", () => {
    const world = createKootaWorld();
    const pendingCommands: OutpostAuthorityCombatCommand[] = [];
    const player = createPlayer();
    const authority = createOutpostAuthorityGameplayRuntime({
      dataRegistry: createOutpostDataRegistry(),
      world,
      physicsBackend,
      eventBus: createEventBus(),
      players: () => [player],
      combatCommands() {
        return pendingCommands.splice(0, pendingCommands.length);
      }
    });
    authority.runtime.start();
    tick(authority, 2);

    pendingCommands.push(command("stamina-dash-1", player.playerId, "dash", 500, 300));
    tick(authority, 1);
    expect(combatActor(authority, player.playerId).stamina).toBe(75);

    authority.gas.modifyAttribute(
      player.playerId,
      { attribute: "stamina", operation: "set", value: 0 },
      "test.exhaust-stamina"
    );
    tick(authority, 95);
    expect(combatActor(authority, player.playerId).stamina).toBeGreaterThan(0);
    expect(combatActor(authority, player.playerId).stamina).toBeLessThan(25);

    pendingCommands.push(command("stamina-dash-denied", player.playerId, "dash", 500, 300));
    tick(authority, 1);
    expect(authority.snapshot().combat.cues.at(-1)).toMatchObject({
      kind: "action-rejected",
      ability: "dash",
      reason: "costs-unavailable",
      correlationId: "outpost.test.stamina-dash-denied"
    });

    tick(authority, 60);
    expect(combatActor(authority, player.playerId).stamina).toBeGreaterThanOrEqual(25);
    pendingCommands.push(command("stamina-dash-recovered", player.playerId, "dash", 500, 300));
    tick(authority, 1);
    expect(authority.snapshot().combat.cues.at(-1)).not.toMatchObject({
      correlationId: "outpost.test.stamina-dash-recovered",
      kind: "action-rejected"
    });

    authority.runtime.dispose();
    expect(world.count()).toBe(0);
  });

  it("confirms rejected Dash input and preserves the sequence across unrelated Rifle rejection", () => {
    const world = createKootaWorld();
    const pendingCommands: OutpostAuthorityCombatCommand[] = [];
    const player = createPlayer();
    const authority = createOutpostAuthorityGameplayRuntime({
      dataRegistry: createOutpostDataRegistry(),
      world,
      physicsBackend,
      eventBus: createEventBus(),
      players: () => [player],
      combatCommands() {
        return pendingCommands.splice(0, pendingCommands.length);
      },
      initialEnemies: []
    });
    authority.runtime.start();
    tick(authority, 2);

    pendingCommands.push({
      ...command("dash-sequence-1", player.playerId, "dash", 500, 300),
      dashSequence: 1
    });
    tick(authority, 1);
    expect(authority.snapshot().players[0]).toMatchObject({ dashSequence: 1 });

    pendingCommands.push({
      ...command("dash-sequence-2-rejected", player.playerId, "dash", 500, 300),
      dashSequence: 2
    });
    tick(authority, 1);
    expect(authority.snapshot().players[0]).toMatchObject({ dashSequence: 2 });
    expect(authority.snapshot().combat.rejectedCommands).toBe(1);

    tick(authority, 95);
    pendingCommands.push({
      ...command("dash-sequence-3", player.playerId, "dash", 500, 300),
      dashSequence: 3
    });
    tick(authority, 1);
    expect(authority.snapshot().players[0]).toMatchObject({ dashSequence: 3 });
    expect(authority.snapshot().players[0]!.velocityX).toBeGreaterThan(500);

    pendingCommands.push(command("rifle-active", player.playerId, "rifle", 500, 300));
    tick(authority, 1);
    const rejectedBeforeRifle = authority.snapshot().combat.rejectedCommands;
    pendingCommands.push(command("rifle-rejected", player.playerId, "rifle", 500, 300));
    tick(authority, 1);
    expect(authority.snapshot().combat.rejectedCommands).toBeGreaterThan(rejectedBeforeRifle);
    expect(authority.snapshot().players[0]).toMatchObject({ dashSequence: 3 });

    authority.runtime.dispose();
    expect(world.count()).toBe(0);
  });

  it("keeps configured opening enemies dormant before enabling physical pursuit", () => {
    const world = createKootaWorld();
    const player = createPlayer();
    const authority = createOutpostAuthorityGameplayRuntime({
      dataRegistry: createOutpostDataRegistry(),
      world,
      physicsBackend,
      eventBus: createEventBus(),
      players: () => [player],
      initialEnemies: [
        {
          id: "enemy.test.delayed",
          definitionId: "enemy.outpost.raider",
          x: 340,
          y: 300,
          activationDelayMs: 100
        }
      ]
    });
    authority.runtime.start();

    tick(authority, 5);
    expect(authority.snapshot().combat.enemyAttacks).toBe(0);
    expect(combatActor(authority, "enemy.test.delayed")).toMatchObject({
      x: 340,
      y: 300,
      velocityX: 0,
      velocityY: 0
    });

    tickUntil(authority, () => authority.snapshot().combat.enemyAttacks > 0, 120);
    expect(authority.snapshot().combat.enemyAttacks).toBeGreaterThan(0);

    authority.runtime.dispose();
    expect(world.count()).toBe(0);
  });

  it("runs periodic status, shield break, and boss phase reactions through TCA", () => {
    const world = createKootaWorld();
    const eventBus = createEventBus();
    const facts: string[] = [];
    eventBus.on("outpost.shield_broken", (event) => facts.push(event.type));
    eventBus.on("outpost.boss.phase_changed", (event) => facts.push(event.type));
    const pendingCommands: OutpostAuthorityCombatCommand[] = [];
    const player = createPlayer();
    const authority = createOutpostAuthorityGameplayRuntime({
      dataRegistry: createOutpostDataRegistry(),
      world,
      physicsBackend,
      eventBus,
      players: () => [player],
      combatCommands() {
        return pendingCommands.splice(0, pendingCommands.length);
      },
      initialEnemies: [
        {
          id: "enemy.test.overseer",
          definitionId: "enemy.outpost.overseer",
          x: 430,
          y: 300
        }
      ]
    });
    authority.runtime.start();
    tick(authority, 2);

    pendingCommands.push(command("boss-shock", player.playerId, "shock-field", 430, 300));
    tick(authority, 1);
    expect(
      authority.gas
        .listAbilityExecutions({ actorId: player.playerId })
        .some((execution) => execution.phase === "preparing")
    ).toBe(true);
    tickUntil(
      authority,
      () => combatActor(authority, "enemy.test.overseer").tags.includes("status.shocked"),
      30
    );
    expect(combatActor(authority, "enemy.test.overseer").tags).toContain("status.shocked");
    tick(authority, 61);
    expect(combatActor(authority, "enemy.test.overseer").health).toBeLessThan(600);

    authority.gas.modifyAttribute(
      player.playerId,
      { attribute: "shield", operation: "set", value: 0 },
      "test",
      { correlationId: "outpost.test.shield-break" }
    );
    authority.gas.modifyAttribute(
      "enemy.test.overseer.actor",
      { attribute: "health", operation: "set", value: 299 },
      player.playerId,
      { correlationId: "outpost.test.boss-phase" }
    );
    tick(authority, 1);

    expect(facts).toEqual(
      expect.arrayContaining(["outpost.shield_broken", "outpost.boss.phase_changed"])
    );
    expect(combatActor(authority, "enemy.test.overseer").tags).toContain("boss.phase.two");
    expect(
      authority.tcaTrace.list().some((trace) => trace.correlationId === "outpost.test.boss-phase")
    ).toBe(true);

    authority.runtime.dispose();
    expect(world.count()).toBe(0);
  });

  it("derives arena barricade blockers and makes dependent routes explicitly stale", () => {
    const world = createKootaWorld();
    const authority = createOutpostAuthorityGameplayRuntime({
      dataRegistry: createOutpostDataRegistry(),
      world,
      physicsBackend,
      eventBus: createEventBus(),
      players: () => [],
      initialEnemies: []
    });
    authority.runtime.start();
    tick(authority, 1);

    expect(authority.snapshot().navigationBlockers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "navigation.blocker.outpost.north-west",
          edgeId: "edge.outpost.north-west-inner",
          blocked: true,
          objectIds: ["barricade.north-west.horizontal", "barricade.north-west.vertical"]
        })
      ])
    );
    expect(authority.navigation.revision()).toBe(4);

    expect(
      authority.setNavigationArenaObjectBlocked("barricade.north-west.horizontal", false)
    ).toBe(true);
    expect(authority.setNavigationArenaObjectBlocked("barricade.north-west.vertical", false)).toBe(
      true
    );
    tick(authority, 1);
    const requestId = authority.navigation.requestPath({
      id: "outpost.test.barricade-route",
      requesterId: "outpost.test.navigation",
      profileId: "navigation.outpost.raider",
      start: { x: 740, y: 350 },
      goal: { x: 740, y: 500 },
      routeKind: "path"
    });
    tick(authority, 1);
    const result = authority.navigation.poll(requestId);
    expect(result.status).toBe("complete");
    if (result.status !== "complete") {
      throw new Error(`Expected a complete Outpost navigation route, received ${result.status}`);
    }
    expect(
      authority.navigation.sampleRoute(result.route.routeId, { x: 740, y: 350 })
    ).toMatchObject({ status: "valid" });

    authority.setNavigationArenaObjectBlocked("barricade.north-west.horizontal", true);
    tick(authority, 1);
    expect(authority.navigation.sampleRoute(result.route.routeId, { x: 740, y: 350 }).status).toBe(
      "stale"
    );
    expect(authority.navigation.traces()).toContainEqual(
      expect.objectContaining({
        label: "navigation.obstacle_changed",
        payload: expect.objectContaining({
          obstacleId: "navigation.blocker.outpost.north-west",
          staleRoutes: 1
        })
      })
    );

    authority.runtime.dispose();
    expect(world.count()).toBe(0);
  });
});

function createPlayer(): OutpostAuthorityPlayerState {
  return {
    playerId: "player.test.ranger",
    slot: 0,
    spawn: { x: 300, y: 300 },
    input: {
      sequence: 0,
      moveX: 0,
      moveY: 0,
      aimX: 450,
      aimY: 300,
      fireHeld: false,
      fireSequence: 0,
      dashSequence: 0
    }
  };
}

function fireReliableRifle(
  pending: OutpostAuthorityPlayerActionCommand[],
  playerId: string,
  id: string
): void {
  pending.push({
    id: `${id}-press`,
    playerId,
    action: "rifle",
    aimX: 620,
    aimY: 300,
    fireSequence: 1,
    fireHeld: true
  });
  pending.push({
    id: `${id}-release`,
    playerId,
    action: "rifle",
    aimX: 620,
    aimY: 300,
    fireSequence: 1,
    fireHeld: false
  });
}

function tick(
  authority: ReturnType<typeof createOutpostAuthorityGameplayRuntime>,
  count: number
): void {
  for (let index = 0; index < count; index += 1) {
    authority.runtime.tick(FIXED_DELTA_MS);
  }
}

function tickUntil(
  authority: ReturnType<typeof createOutpostAuthorityGameplayRuntime>,
  predicate: () => boolean,
  limit: number
): void {
  for (let index = 0; index < limit && !predicate(); index += 1) {
    authority.runtime.tick(FIXED_DELTA_MS);
  }
  if (!predicate()) {
    throw new Error(
      JSON.stringify({
        combat: authority.snapshot().combat,
        ai: authority.snapshot().ai,
        aiAgents: authority.ai.isBound() ? authority.ai.listAgents() : [],
        aiTraces: authority.ai.isBound() ? authority.ai.traces().slice(-24) : [],
        navigation: authority.navigation.isBound() ? authority.navigation.snapshot() : undefined,
        physics: authority.physics.snapshot(),
        traces: authority.physicsTrace.list().filter((trace) => trace.kind === "query")
      })
    );
  }
}

function command(
  id: string,
  playerId: string,
  ability: OutpostAuthorityCombatCommand["ability"],
  aimX: number,
  aimY: number
): OutpostAuthorityCombatCommand {
  return { id, playerId, ability, aimX, aimY, correlationId: `outpost.test.${id}` };
}

function combatActor(
  authority: ReturnType<typeof createOutpostAuthorityGameplayRuntime>,
  id: string
) {
  const actor = authority.snapshot().combat.actors.find((candidate) => candidate.id === id);
  expect(actor).toBeDefined();
  return actor!;
}
