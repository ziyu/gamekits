import { createMemoryAnimationPlaybackAdapter } from "@gamekits/animator-core/testing";
import { createGameAudio } from "@gamekits/audio-core";
import { createMemoryAudioBackend } from "@gamekits/audio-core/testing";
import { createCameraController } from "@gamekits/camera-core";
import { createMultiplayerRuntime, type MultiplayerRuntime } from "@gamekits/multiplayer-core";
import { createMemoryMultiplayerBackend } from "@gamekits/multiplayer-memory";
import { createMemoryPhysicsBackend } from "@gamekits/physics-core";
import { createMemoryRenderer } from "@gamekits/test-utils";
import { createKootaWorld } from "@gamekits/world-koota";
import { describe, expect, it } from "vitest";

import { createOutpostDataRegistry } from "../content";
import { createOutpostClientShadowRuntime, type OutpostClientAuthoritySnapshot } from "../gameplay";
import { OUTPOST_AUDIO_CONFIG } from "../presentation";
import {
  loadOutpostBrowserServerConfig,
  normalizeOutpostDisplayName,
  normalizeOutpostSessionId
} from "../realtime";

describe("Outpost Browser multiplayer", () => {
  it("applies bounded authority snapshots to a disposable client World shadow", async () => {
    const backend = createMemoryMultiplayerBackend({ id: "outpost.client-shadow.test" });
    const server = createMultiplayerRuntime({ id: "server", backend });
    const multiplayer = createMultiplayerRuntime({ id: "client", backend });
    const attacker = createMultiplayerRuntime({ id: "attacker", backend });
    await server.createSession({
      id: "session-1",
      authority: "server-authoritative",
      localPeer: { id: "session.server", role: "server" }
    });
    await multiplayer.joinSession({
      sessionId: "session-1",
      localPeer: { id: "ranger-1", role: "client", playerId: "player.ranger-1" }
    });
    await attacker.joinSession({
      sessionId: "session-1",
      localPeer: { id: "other.server", role: "client" }
    });
    const world = createKootaWorld();
    const client = createOutpostClientShadowRuntime({
      dataRegistry: createOutpostDataRegistry(),
      world,
      multiplayer,
      physicsBackend: createMemoryPhysicsBackend(),
      localPlayerId: "player.ranger-1"
    });
    await client.runtime.start();

    await sendSnapshot(server, authoritySnapshot(1, 4));
    client.runtime.tick(16);
    expect(world.count()).toBe(4);
    expect(client.identity.snapshot()).toHaveLength(4);
    expect(client.snapshot()).toMatchObject({
      authorityPeerId: "session.server",
      receivedSnapshots: 1,
      rejectedSnapshots: 0,
      lastAppliedTick: 1,
      entityCount: 4
    });

    await sendSnapshot(server, authoritySnapshot(1, 4));
    client.runtime.tick(16);
    await sendSnapshot(attacker, authoritySnapshot(2, 4));
    await sendSnapshot(server, authoritySnapshot(3, 3));
    client.runtime.tick(16);
    expect(world.count()).toBe(3);
    expect(client.identity.snapshot()).toHaveLength(3);
    expect(client.snapshot().rejectedSnapshots).toBe(2);

    await client.runtime.dispose();
    await attacker.dispose();
    await multiplayer.dispose();
    await server.dispose();
    expect(world.count()).toBe(0);
    expect(client.identity.snapshot()).toHaveLength(0);
  });

  it("materializes and presents replicated enemies, projectiles, and status feedback", async () => {
    const backend = createMemoryMultiplayerBackend({ id: "outpost.client-combat.test" });
    const server = createMultiplayerRuntime({ id: "server", backend });
    const multiplayer = createMultiplayerRuntime({ id: "client", backend });
    await server.createSession({
      id: "session-1",
      authority: "server-authoritative",
      localPeer: { id: "session.server", role: "server" }
    });
    await multiplayer.joinSession({
      sessionId: "session-1",
      localPeer: { id: "ranger-1", role: "client", playerId: "player.ranger-1" }
    });
    const world = createKootaWorld();
    const renderer = createMemoryRenderer("outpost.client-combat.renderer");
    const animationAdapter = createMemoryAnimationPlaybackAdapter();
    const audioBackend = createMemoryAudioBackend({ unlocked: true });
    const audio = createGameAudio({ ...OUTPOST_AUDIO_CONFIG, backend: audioBackend });
    const targetStates = new Map<string, Record<string, unknown>>();
    const client = createOutpostClientShadowRuntime({
      dataRegistry: createOutpostDataRegistry(),
      world,
      multiplayer,
      physicsBackend: createMemoryPhysicsBackend(),
      localPlayerId: "player.ranger-1",
      renderer,
      animationAdapter,
      audio,
      applyRenderTargetState(native, state) {
        const object = native as { id: string };
        targetStates.set(object.id, state.props ?? {});
      }
    });
    await client.runtime.start();
    const snapshot = authoritySnapshot(1, 1);
    snapshot.combat.actors = [combatActor("enemy.opening.1", "enemy", "render.outpost.raider")];
    snapshot.combat.actors[0] = {
      ...snapshot.combat.actors[0]!,
      targetActorId: "player.ranger-1",
      aiGoalId: "ai.outpost.goal.assault",
      aiTaskPhase: "telegraph",
      abilityExecutionId: "enemy.opening.1:attack:1",
      abilityId: "ability.outpost.enemy_attack",
      abilityPhase: "preparing",
      abilityPhaseStartedAt: 0,
      abilityPhaseEndsAt: 400
    };
    snapshot.combat.projectiles = [combatProjectile("projectile.1")];
    snapshot.combat.projectileRecords = [
      {
        projectileId: "projectile.1.record",
        correlationId: "remote.rifle.1",
        generation: snapshot.combat.projectileGeneration,
        definitionId: "combat.outpost.projectile.rifle",
        definitionVersion: "outpost.rifle-projectile.v1",
        fireTick: 0,
        fixedDeltaMs: 1000 / 60,
        firePosition: { x: 682, y: 500 },
        fireVelocity: { x: 760, y: 0 },
        expiresTick: 72
      }
    ];
    await sendSnapshot(server, snapshot);
    client.runtime.tick(16);

    expect(world.count()).toBe(3);
    expect(audio.snapshot().spatial.listeners).toMatchObject([
      {
        id: "outpost.listener.player.ranger-1",
        transform: { position: { x: 800, y: 500 } }
      }
    ]);
    expect(client.identity.snapshot()).toHaveLength(3);
    expect(renderer.objects().map((object) => object.id)).toEqual(
      expect.arrayContaining([
        "outpost.client.player.0.0",
        "outpost.client.enemy.enemy.opening.1.0",
        projectileObjectId(snapshot.combat.projectileGeneration, "remote.rifle.1")
      ])
    );
    expect(client.animator.listControllers()).toHaveLength(2);
    const enemyAnimatorControllerId = "outpost.animator.outpost.client.enemy.enemy.opening.1.0";
    expect(client.animator.traces().map((trace) => trace.label)).toContain("animator.phase_synced");
    expect({
      runtime: client.animator.snapshot(),
      controller: client.animator.getController(enemyAnimatorControllerId),
      traces: client.animator.traces(),
      frame: animationAdapter.frame(enemyAnimatorControllerId)?.layers[0]
    }).toMatchObject({
      runtime: { activeGameplayPhases: 1 },
      frame: { kind: "gameplay-phase", clipId: "animation.outpost.raider.attack" }
    });
    expect(targetStates.get("outpost.client.enemy.enemy.opening.1.0")).toMatchObject({
      tint: 0xffa94d
    });
    expect(audio.sfx.snapshot().active).toBe(1);
    const playbackStarts = audioBackend.commands().filter((command) => command.type === "start");
    expect(playbackStarts).toHaveLength(2);
    client.runtime.tick(450);
    expect(audioBackend.commands().filter((command) => command.type === "start")).toHaveLength(2);

    snapshot.tick = 2;
    snapshot.elapsedMs = 100;
    snapshot.players[0]!.x = 920;
    snapshot.combat.actors[0]!.tags = ["status.shocked", "team.enemies"];
    snapshot.combat.projectiles = [];
    snapshot.combat.projectileRecords = [];
    await sendSnapshot(server, snapshot);
    client.runtime.tick(16);

    expect(world.count()).toBe(2);
    expect(client.identity.snapshot()).toHaveLength(2);
    expect(audio.snapshot().spatial.listeners).toMatchObject([
      {
        id: "outpost.listener.player.ranger-1",
        transform: { position: { x: 920, y: 500 } }
      }
    ]);
    expect(targetStates.get("outpost.client.enemy.enemy.opening.1.0")).toMatchObject({
      tint: 0x63fff2
    });

    await client.runtime.dispose();
    audio.dispose();
    await multiplayer.dispose();
    await server.dispose();
    expect(world.count()).toBe(0);
  });

  it("presents replicated Dash, reload, and Tactical through the shared player Animator controller", async () => {
    const backend = createMemoryMultiplayerBackend({ id: "outpost.client-animation.test" });
    const server = createMultiplayerRuntime({ id: "server", backend });
    const multiplayer = createMultiplayerRuntime({ id: "client", backend });
    await server.createSession({
      id: "session-1",
      authority: "server-authoritative",
      localPeer: { id: "session.server", role: "server" }
    });
    await multiplayer.joinSession({
      sessionId: "session-1",
      localPeer: { id: "ranger-1", role: "client", playerId: "player.ranger-1" }
    });
    const animationAdapter = createMemoryAnimationPlaybackAdapter();
    const client = createOutpostClientShadowRuntime({
      dataRegistry: createOutpostDataRegistry(),
      world: createKootaWorld(),
      multiplayer,
      physicsBackend: createMemoryPhysicsBackend(),
      localPlayerId: "player.ranger-1",
      renderer: createMemoryRenderer("outpost.client-animation.renderer"),
      animationAdapter
    });
    await client.runtime.start();
    const controllerId = "outpost.animator.outpost.client.player.0.0";
    const snapshot = authoritySnapshot(1, 1);
    snapshot.players[0] = {
      ...snapshot.players[0]!,
      velocityX: 640,
      dashSequence: 1,
      dashRemainingMs: 180,
      dashDirectionX: 1
    };
    snapshot.combat.actors = [playerCombatActor()];
    await sendSnapshot(server, snapshot);
    client.runtime.tick(16);

    expect(animationAdapter.frame(controllerId)?.layers[0]).toMatchObject({
      kind: "state",
      clipId: "animation.outpost.player.dash"
    });

    snapshot.tick = 2;
    snapshot.elapsedMs = 100;
    snapshot.players[0] = {
      ...snapshot.players[0]!,
      velocityX: 0,
      dashRemainingMs: 0
    };
    snapshot.combat.actors[0] = {
      ...snapshot.combat.actors[0]!,
      abilityExecutionId: "player.ranger-1:reload:1",
      abilityId: "ability.outpost.rifle_reload",
      abilityPhase: "preparing",
      abilityPhaseStartedAt: 50,
      abilityPhaseEndsAt: 850
    };
    await sendSnapshot(server, snapshot);
    client.runtime.tick(16);

    expect(animationAdapter.frame(controllerId)?.layers[0]).toMatchObject({
      kind: "gameplay-phase",
      clipId: "animation.outpost.player.reload-preparing"
    });

    snapshot.tick = 3;
    snapshot.elapsedMs = 900;
    snapshot.combat.actors[0] = {
      ...snapshot.combat.actors[0]!,
      abilityExecutionId: "player.ranger-1:tactical:1",
      abilityId: "ability.outpost.shock_field",
      abilityPhase: "active",
      abilityPhaseStartedAt: 860,
      abilityPhaseEndsAt: 1_020
    };
    await sendSnapshot(server, snapshot);
    client.runtime.tick(16);

    expect(animationAdapter.frame(controllerId)?.layers[0]).toMatchObject({
      kind: "gameplay-phase",
      clipId: "animation.outpost.player.tactical-active"
    });

    await client.runtime.dispose();
    await multiplayer.dispose();
    await server.dispose();
  });

  it("automatically samples, predicts, sends, and reconciles local input", async () => {
    const backend = createMemoryMultiplayerBackend({ id: "outpost.client-prediction.test" });
    const server = createMultiplayerRuntime({ id: "server", backend });
    const multiplayer = createMultiplayerRuntime({ id: "client", backend });
    await server.createSession({
      id: "session-1",
      authority: "server-authoritative",
      localPeer: { id: "session.server", role: "server" }
    });
    await multiplayer.joinSession({
      sessionId: "session-1",
      localPeer: { id: "ranger-1", role: "client", playerId: "player.ranger-1" }
    });
    const receivedInputs: unknown[] = [];
    const unsubscribe = server.subscribe((message) => {
      if (message.kind === "game.input") {
        receivedInputs.push(message.payload);
      }
    });
    const world = createKootaWorld();
    const client = createOutpostClientShadowRuntime({
      dataRegistry: createOutpostDataRegistry(),
      world,
      multiplayer,
      physicsBackend: createMemoryPhysicsBackend(),
      localPlayerId: "player.ranger-1"
    });
    client.input.moveX = 1;
    client.input.aimX = 900;
    client.input.aimY = 500;
    await client.runtime.start();
    await sendSnapshot(server, {
      ...authoritySnapshot(1, 1),
      inputAcksByPeerId: { "ranger-1": 0 }
    });

    client.runtime.tick(0);
    client.runtime.tick(25);
    client.runtime.tick(25);
    await waitFor(() => receivedInputs.length === 2);
    expect(receivedInputs).toEqual([
      {
        sequence: 1,
        moveX: 1,
        moveY: 0,
        aimX: 900,
        aimY: 500,
        dashSequence: 0,
        fireHeld: false,
        fireSequence: 0
      },
      {
        sequence: 2,
        moveX: 1,
        moveY: 0,
        aimX: 900,
        aimY: 500,
        dashSequence: 0,
        fireHeld: false,
        fireSequence: 0
      }
    ]);

    await sendSnapshot(server, {
      ...authoritySnapshot(2, 1),
      inputAcksByPeerId: { "ranger-1": 1 }
    });
    client.runtime.tick(16);
    expect(client.snapshot().replication?.prediction).toMatchObject({
      lastAcknowledgedSequence: 1,
      pendingInputs: 1
    });

    unsubscribe();
    await client.runtime.dispose();
    await multiplayer.dispose();
    await server.dispose();
  });

  it("bounds prediction lead and preserves a short rifle edge while authority catches up", async () => {
    const backend = createMemoryMultiplayerBackend({ id: "outpost.client-input-latency.test" });
    const server = createMultiplayerRuntime({ id: "server", backend });
    const multiplayer = createMultiplayerRuntime({ id: "client", backend });
    await server.createSession({
      id: "session-1",
      authority: "server-authoritative",
      localPeer: { id: "session.server", role: "server" }
    });
    await multiplayer.joinSession({
      sessionId: "session-1",
      localPeer: { id: "ranger-1", role: "client", playerId: "player.ranger-1" }
    });
    const receivedInputs: Array<{ fireHeld?: boolean; fireSequence?: number; sequence?: number }> =
      [];
    const unsubscribe = server.subscribe((message) => {
      if (message.kind === "game.input") {
        receivedInputs.push(
          message.payload as { fireHeld?: boolean; fireSequence?: number; sequence?: number }
        );
      }
    });
    const client = createOutpostClientShadowRuntime({
      dataRegistry: createOutpostDataRegistry(),
      world: createKootaWorld(),
      multiplayer,
      physicsBackend: createMemoryPhysicsBackend(),
      localPlayerId: "player.ranger-1"
    });
    client.input.aimX = 900;
    client.input.aimY = 500;
    await client.runtime.start();
    await sendSnapshot(server, {
      ...authoritySnapshot(1, 1),
      inputAcksByPeerId: { "ranger-1": 0 }
    });

    client.runtime.tick(0);
    client.runtime.tick(50);
    await waitFor(() => receivedInputs.length === 2);
    client.input.fireSequence = 1;
    client.runtime.tick(250);

    expect(receivedInputs).toHaveLength(2);
    expect(client.snapshot().replication).toMatchObject({
      throttledInputs: expect.any(Number),
      prediction: { pendingInputs: 2 }
    });
    expect(client.snapshot().replication?.throttledInputs).toBeGreaterThan(0);

    await sendSnapshot(server, {
      ...authoritySnapshot(2, 1),
      inputAcksByPeerId: { "ranger-1": 1 }
    });
    client.runtime.tick(16);
    await waitFor(() => receivedInputs.length === 3);
    expect(receivedInputs[2]).toMatchObject({
      sequence: 3,
      fireHeld: false,
      fireSequence: 1
    });
    expect(client.snapshot().replication?.prediction).toMatchObject({ pendingInputs: 2 });

    unsubscribe();
    await client.runtime.dispose();
    await multiplayer.dispose();
    await server.dispose();
  });

  it("presents each authority combat cue once and bounds transient effects", async () => {
    const backend = createMemoryMultiplayerBackend({ id: "outpost.client-combat-cues.test" });
    const server = createMultiplayerRuntime({ id: "server", backend });
    const multiplayer = createMultiplayerRuntime({ id: "client", backend });
    await server.createSession({
      id: "session-1",
      authority: "server-authoritative",
      localPeer: { id: "session.server", role: "server" }
    });
    await multiplayer.joinSession({
      sessionId: "session-1",
      localPeer: { id: "ranger-1", role: "client", playerId: "player.ranger-1" }
    });
    const renderer = createMemoryRenderer("outpost.client-combat-cues.renderer");
    const audioBackend = createMemoryAudioBackend({ unlocked: true });
    const audio = createGameAudio({ ...OUTPOST_AUDIO_CONFIG, backend: audioBackend });
    const client = createOutpostClientShadowRuntime({
      dataRegistry: createOutpostDataRegistry(),
      world: createKootaWorld(),
      multiplayer,
      physicsBackend: createMemoryPhysicsBackend(),
      localPlayerId: "player.ranger-1",
      renderer,
      audio
    });
    await client.runtime.start();
    await sendSnapshot(server, authoritySnapshot(1, 1));
    client.runtime.tick(0);

    const cueSnapshot = authoritySnapshot(2, 1);
    cueSnapshot.combat.cueWatermark = 50;
    cueSnapshot.combat.cues = Array.from({ length: 50 }, (_, index) => ({
      sequence: index + 1,
      kind: "health-hit" as const,
      at: 16,
      sourceObjectId: "enemy.opening.1",
      targetObjectId: "player.ranger-1",
      position: { x: 800 + index, y: 500 },
      amount: 1
    }));
    await sendSnapshot(server, cueSnapshot);
    client.runtime.tick(16);

    const combatEffectIds = () =>
      renderer
        .objects()
        .map((object) => object.id)
        .filter((objectId) => objectId.startsWith("outpost.combat-cue."));
    expect(combatEffectIds()).toHaveLength(48);
    expect(combatEffectIds()).not.toContain("outpost.combat-cue.1.impact");
    expect(combatEffectIds()).toContain("outpost.combat-cue.50.impact");
    expect(client.combatPresentation.snapshot()).toMatchObject({
      cueWatermark: 50,
      authorityCueWatermark: 50,
      consumedCues: 50,
      droppedCues: 0
    });
    const playbackStarts = audioBackend
      .commands()
      .filter((command) => command.type === "start").length;

    cueSnapshot.tick = 3;
    await sendSnapshot(server, cueSnapshot);
    client.runtime.tick(16);
    expect(audioBackend.commands().filter((command) => command.type === "start")).toHaveLength(
      playbackStarts
    );

    client.runtime.tick(300);
    expect(combatEffectIds()).toHaveLength(0);

    await client.runtime.dispose();
    audio.dispose();
    await multiplayer.dispose();
    await server.dispose();
  });

  it("presents rifle anticipation immediately and suppresses duplicate authority feedback", async () => {
    const backend = createMemoryMultiplayerBackend({ id: "outpost.client-rifle-cues.test" });
    const server = createMultiplayerRuntime({ id: "server", backend });
    const multiplayer = createMultiplayerRuntime({ id: "client", backend });
    await server.createSession({
      id: "session-1",
      authority: "server-authoritative",
      localPeer: { id: "session.server", role: "server" }
    });
    await multiplayer.joinSession({
      sessionId: "session-1",
      localPeer: { id: "ranger-1", role: "client", playerId: "player.ranger-1" }
    });
    const renderer = createMemoryRenderer("outpost.client-rifle-cues.renderer");
    const audioBackend = createMemoryAudioBackend({ unlocked: true });
    const audio = createGameAudio({ ...OUTPOST_AUDIO_CONFIG, backend: audioBackend });
    const camera = createCameraController({ viewport: { width: 1280, height: 720 } });
    const targetStates = new Map<string, Record<string, unknown>>();
    const client = createOutpostClientShadowRuntime({
      dataRegistry: createOutpostDataRegistry(),
      world: createKootaWorld(),
      multiplayer,
      physicsBackend: createMemoryPhysicsBackend(),
      localPlayerId: "player.ranger-1",
      renderer,
      audio,
      camera,
      applyRenderTargetState(native, state) {
        targetStates.set((native as { id: string }).id, state as Record<string, unknown>);
      }
    });
    const snapshot = authoritySnapshot(1, 1);
    snapshot.combat.actors = [playerCombatActor()];
    await client.runtime.start();
    await sendSnapshot(server, snapshot);
    client.input.aimX = 920;
    client.input.aimY = 500;
    client.runtime.tick(0);
    const playbackStartsBeforeFire = audioBackend
      .commands()
      .filter((command) => command.type === "start").length;

    client.input.fireHeld = true;
    client.input.fireSequence = 1;
    client.runtime.tick(16);

    const muzzleId = "outpost.player-presentation.player.ranger-1.muzzle";
    const crosshairId = "outpost.player-feedback.player.ranger-1.crosshair";
    const tracerId = "outpost.player-feedback.tracer.player.ranger-1.rifle.1";
    const predictedProjectileId = projectileObjectId(
      snapshot.combat.projectileGeneration,
      "player.ranger-1.rifle.1"
    );
    expect(client.playerPresentation.snapshot()).toMatchObject({
      cueWatermark: 1,
      pendingAnticipations: 1,
      anticipatedShots: 1
    });
    expect(renderer.objects().map((object) => object.id)).toEqual(
      expect.arrayContaining([crosshairId, tracerId, predictedProjectileId])
    );
    expect(renderer.objects().map((object) => object.id)).not.toContain(muzzleId);
    expect(targetStates.get(crosshairId)).toMatchObject({
      visible: true,
      transform: { position: { x: 920, y: 500 } }
    });
    expect(audioBackend.commands().filter((command) => command.type === "start")).toHaveLength(
      playbackStartsBeforeFire + 1
    );

    client.runtime.tick(32);
    expect(targetStates.get(predictedProjectileId)).toMatchObject({
      visible: true,
      alpha: 1,
      transform: { position: { x: expect.any(Number), y: 500 } }
    });
    expect(
      (
        targetStates.get(predictedProjectileId)?.transform as
          | { position?: { x?: number } }
          | undefined
      )?.position?.x
    ).toBeGreaterThan(834);
    const predictedPositionBeforeAuthority = (
      targetStates.get(predictedProjectileId)?.transform as
        | { position?: { x?: number } }
        | undefined
    )?.position?.x;

    snapshot.tick = 2;
    snapshot.elapsedMs = 48;
    snapshot.combat.actors[0] = {
      ...snapshot.combat.actors[0]!,
      weapon: {
        ...snapshot.combat.actors[0]!.weapon!,
        magazine: 23,
        shotSequence: 1,
        lastShotCorrelationId: "player.ranger-1.rifle.1"
      }
    };
    snapshot.combat.cueWatermark = 1;
    const authorityProjectileObjectId = "player.ranger-1.rifle.1.projectile";
    snapshot.combat.projectiles = [
      {
        ...combatProjectile(authorityProjectileObjectId),
        x: 850
      }
    ];
    snapshot.combat.projectileRecords = [
      {
        projectileId: authorityProjectileObjectId,
        correlationId: "player.ranger-1.rifle.1",
        generation: snapshot.combat.projectileGeneration,
        definitionId: "combat.outpost.projectile.rifle",
        definitionVersion: "outpost.rifle-projectile.v1",
        fireTick: 1,
        fixedDeltaMs: 1000 / 60,
        firePosition: { x: 834, y: 500 },
        fireVelocity: { x: 760, y: 0 },
        expiresTick: 73
      }
    ];
    snapshot.combat.cues = [
      {
        sequence: 1,
        kind: "projectile-spawned",
        at: 48,
        sourceObjectId: "player.ranger-1",
        projectileId: authorityProjectileObjectId,
        position: { x: 834, y: 500 },
        direction: { x: 1, y: 0 },
        correlationId: "player.ranger-1.rifle.1"
      }
    ];
    await sendSnapshot(server, snapshot);
    client.runtime.tick(16);

    expect(client.playerPresentation.snapshot()).toMatchObject({
      cueWatermark: 2,
      pendingAnticipations: 0,
      confirmedShots: 1
    });
    expect(renderer.objects().map((object) => object.id)).toContain(predictedProjectileId);
    expect(renderer.objects().filter((object) => object.id === predictedProjectileId)).toHaveLength(
      1
    );
    expect(targetStates.get(predictedProjectileId)).toMatchObject({
      transform: { position: { x: expect.any(Number), y: 500 } }
    });
    const reconciledPosition = (
      targetStates.get(predictedProjectileId)?.transform as
        | { position?: { x?: number } }
        | undefined
    )?.position?.x;
    expect(reconciledPosition).toBeGreaterThanOrEqual(predictedPositionBeforeAuthority ?? 0);

    client.runtime.tick(16);
    const reconstructedPosition = (
      targetStates.get(predictedProjectileId)?.transform as
        | { position?: { x?: number } }
        | undefined
    )?.position?.x;
    expect(reconstructedPosition).toBeGreaterThan(reconciledPosition ?? 0);

    snapshot.tick = 3;
    snapshot.elapsedMs = 64;
    snapshot.combat.cueWatermark = 2;
    snapshot.combat.cues = [
      {
        sequence: 2,
        kind: "health-hit",
        at: 64,
        sourceObjectId: "player.ranger-1",
        targetObjectId: "enemy.raider-1",
        projectileId: authorityProjectileObjectId,
        position: { x: 875, y: 500 },
        direction: { x: 1, y: 0 },
        amount: 12,
        correlationId: "player.ranger-1.rifle.1"
      }
    ];
    await sendSnapshot(server, snapshot);
    client.runtime.tick(16);

    expect(renderer.objects().map((object) => object.id)).not.toContain(predictedProjectileId);
    expect(renderer.objects().map((object) => object.id)).toContain("outpost.combat-cue.2.impact");
    expect(audioBackend.commands().filter((command) => command.type === "start")).toHaveLength(
      playbackStartsBeforeFire + 2
    );

    await client.runtime.dispose();
    audio.dispose();
    await multiplayer.dispose();
    await server.dispose();
  });

  it("presents local predicted facing continuously across the angle wrap boundary", async () => {
    const backend = createMemoryMultiplayerBackend({ id: "outpost.client-facing.test" });
    const server = createMultiplayerRuntime({ id: "server", backend });
    const multiplayer = createMultiplayerRuntime({ id: "client", backend });
    await server.createSession({
      id: "session-1",
      authority: "server-authoritative",
      localPeer: { id: "session.server", role: "server" }
    });
    await multiplayer.joinSession({
      sessionId: "session-1",
      localPeer: { id: "ranger-1", role: "client", playerId: "player.ranger-1" }
    });
    const rotations: number[] = [];
    const client = createOutpostClientShadowRuntime({
      dataRegistry: createOutpostDataRegistry(),
      world: createKootaWorld(),
      multiplayer,
      physicsBackend: createMemoryPhysicsBackend(),
      localPlayerId: "player.ranger-1",
      renderer: createMemoryRenderer("outpost.client-facing.renderer"),
      applyRenderTargetState(_native, state) {
        const rotation = state.transform?.rotation?.z;
        if (rotation !== undefined) {
          rotations.push(rotation);
        }
      }
    });
    const degrees = (value: number) => (value * Math.PI) / 180;
    const snapshot = authoritySnapshot(1, 1);
    snapshot.players[0]!.facing = degrees(170);
    client.input.aimX = snapshot.players[0]!.x + Math.cos(degrees(-170)) * 100;
    client.input.aimY = snapshot.players[0]!.y + Math.sin(degrees(-170)) * 100;
    await client.runtime.start();
    await sendSnapshot(server, snapshot);

    client.runtime.tick(0);
    expect(rotations.at(-1)).toBeCloseTo(degrees(260), 2);
    client.runtime.tick(25);
    expect(rotations.at(-1)).toBeCloseTo(Math.PI * 1.5, 2);

    await client.runtime.dispose();
    await multiplayer.dispose();
    await server.dispose();
  });

  it("keeps local movement continuous when 20 Hz authority snapshots acknowledge input", async () => {
    const backend = createMemoryMultiplayerBackend({ id: "outpost.client-movement.test" });
    const server = createMultiplayerRuntime({ id: "server", backend });
    const multiplayer = createMultiplayerRuntime({ id: "client", backend });
    await server.createSession({
      id: "session-1",
      authority: "server-authoritative",
      localPeer: { id: "session.server", role: "server" }
    });
    await multiplayer.joinSession({
      sessionId: "session-1",
      localPeer: { id: "ranger-1", role: "client", playerId: "player.ranger-1" }
    });
    const positions: number[] = [];
    const client = createOutpostClientShadowRuntime({
      dataRegistry: createOutpostDataRegistry(),
      world: createKootaWorld(),
      multiplayer,
      physicsBackend: createMemoryPhysicsBackend(),
      localPlayerId: "player.ranger-1",
      renderer: createMemoryRenderer("outpost.client-movement.renderer"),
      applyRenderTargetState(native, state) {
        if ((native as { id: string }).id !== "outpost.client.player.0.0") {
          return;
        }
        const x = state.transform?.position?.x;
        if (x !== undefined) {
          positions.push(x);
        }
      }
    });
    client.input.moveX = 1;
    client.input.aimX = 1_400;
    client.input.aimY = 500;
    await client.runtime.start();
    await sendSnapshot(server, authoritySnapshot(0, 1));
    client.runtime.tick(0);

    for (let frame = 1; frame <= 18; frame += 1) {
      if (frame % 3 === 0) {
        const authorityTick = frame / 3;
        const snapshot = authoritySnapshot(authorityTick, 1);
        snapshot.players[0]!.x += authorityTick * 11;
        snapshot.inputAcksByPeerId["ranger-1"] = authorityTick;
        await sendSnapshot(server, snapshot);
      }
      client.runtime.tick(1000 / 60);
    }

    const deltas = positions.slice(1).map((position, index) => position - positions[index]!);
    expect(positions).toHaveLength(19);
    expect(deltas.every((delta) => delta > 0)).toBe(true);
    expect(deltas.at(-1)).toBeGreaterThan(deltas[0]!);
    expect(Math.max(...deltas)).toBeLessThan(3.7);
    expect(client.snapshot().replication?.prediction).toMatchObject({
      lastAcknowledgedSequence: 6
    });

    await client.runtime.dispose();
    await multiplayer.dispose();
    await server.dispose();
  });

  it("scales pointer camera lookahead from the viewport center without moving the player", async () => {
    const backend = createMemoryMultiplayerBackend({ id: "outpost.client-pointer-camera.test" });
    const server = createMultiplayerRuntime({ id: "server", backend });
    const multiplayer = createMultiplayerRuntime({ id: "client", backend });
    await server.createSession({
      id: "session-1",
      authority: "server-authoritative",
      localPeer: { id: "session.server", role: "server" }
    });
    await multiplayer.joinSession({
      sessionId: "session-1",
      localPeer: { id: "ranger-1", role: "client", playerId: "player.ranger-1" }
    });
    const positions: number[] = [];
    const camera = createCameraController({ viewport: { width: 1280, height: 720 } });
    const client = createOutpostClientShadowRuntime({
      dataRegistry: createOutpostDataRegistry(),
      world: createKootaWorld(),
      multiplayer,
      physicsBackend: createMemoryPhysicsBackend(),
      localPlayerId: "player.ranger-1",
      renderer: createMemoryRenderer("outpost.client-pointer-camera.renderer"),
      camera,
      applyRenderTargetState(native, state) {
        if ((native as { id: string }).id === "outpost.client.player.0.0") {
          positions.push(state.transform?.position?.x ?? Number.NaN);
        }
      }
    });
    client.input.pointerViewportX = 641;
    client.input.pointerViewportY = 360;
    client.input.aimX = 801;
    client.input.aimY = 500;
    await client.runtime.start();
    await sendSnapshot(server, authoritySnapshot(0, 1));
    client.runtime.tick(16);

    expect(camera.getState().x - 800).toBeGreaterThan(0);
    expect(camera.getState().x - 800).toBeLessThan(0.1);
    expect(positions.at(-1)).toBeCloseTo(800, 5);

    client.input.pointerViewportX = 1_280;
    client.runtime.tick(16);
    expect(camera.getState().x - 800).toBeGreaterThan(5);
    expect(positions.at(-1)).toBeCloseTo(800, 5);

    await client.runtime.dispose();
    await multiplayer.dispose();
    await server.dispose();
  });

  it("does not predict a Dash that replicated GAS state already marks unavailable", async () => {
    const backend = createMemoryMultiplayerBackend({ id: "outpost.client-dash.test" });
    const server = createMultiplayerRuntime({ id: "server", backend });
    const multiplayer = createMultiplayerRuntime({ id: "client", backend });
    await server.createSession({
      id: "session-1",
      authority: "server-authoritative",
      localPeer: { id: "session.server", role: "server" }
    });
    await multiplayer.joinSession({
      sessionId: "session-1",
      localPeer: { id: "ranger-1", role: "client", playerId: "player.ranger-1" }
    });
    const receivedInputs: Array<Record<string, unknown>> = [];
    const unsubscribe = server.subscribe((message) => {
      if (message.kind === "game.input") {
        receivedInputs.push(message.payload as Record<string, unknown>);
      }
    });
    const playerPositions: number[] = [];
    const camera = createCameraController({ viewport: { width: 1280, height: 720 } });
    const client = createOutpostClientShadowRuntime({
      dataRegistry: createOutpostDataRegistry(),
      world: createKootaWorld(),
      multiplayer,
      physicsBackend: createMemoryPhysicsBackend(),
      localPlayerId: "player.ranger-1",
      renderer: createMemoryRenderer("outpost.client-dash.renderer"),
      camera,
      applyRenderTargetState(native, state) {
        if ((native as { id: string }).id !== "outpost.client.player.0.0") {
          return;
        }
        const x = state.transform?.position?.x;
        if (x !== undefined) {
          playerPositions.push(x);
        }
      }
    });
    client.input.aimX = 1_200;
    client.input.aimY = 500;
    await client.runtime.start();
    const initial = authoritySnapshot(0, 1);
    initial.combat.actors.push({
      objectId: "player.ranger-1",
      networkEntityId: "player.ranger-1",
      generation: 0,
      kind: "player",
      definitionId: "player.outpost.ranger",
      renderKey: "render.outpost.player",
      x: 800,
      y: 500,
      velocityX: 0,
      velocityY: 0,
      facing: 0,
      health: 100,
      shield: 50,
      stamina: 100,
      resource: 100,
      tags: [],
      cooldowns: { "ability.outpost.dash": 1_500 }
    });
    await sendSnapshot(server, initial);
    client.runtime.tick(0);
    await waitFor(() => receivedInputs.length === 1);

    const inputsBeforeDash = receivedInputs.length;
    client.input.dashSequence = 1;
    client.requestInputSample();
    client.runtime.tick(16);
    await waitFor(() => receivedInputs.length > inputsBeforeDash);
    expect(receivedInputs.at(-1)?.dashSequence).toBe(0);
    expect(camera.getState().x).toBeCloseTo(800, 5);
    client.runtime.tick(16);
    expect(playerPositions.at(-1)).toBeCloseTo(800, 5);

    const rejected = authoritySnapshot(1, 1);
    rejected.players[0]!.dashSequence = 1;
    rejected.inputAcksByPeerId["ranger-1"] = 2;
    await sendSnapshot(server, rejected);
    client.runtime.tick(50);
    client.runtime.tick(50);
    client.runtime.tick(50);

    expect(playerPositions.at(-1)).toBeCloseTo(800, 1);
    expect(client.snapshot().replication?.prediction).toMatchObject({
      lastAcknowledgedSequence: 2
    });
    await waitFor(() => receivedInputs.length >= 4);

    const ready = authoritySnapshot(2, 1);
    ready.players[0]!.dashSequence = 1;
    ready.inputAcksByPeerId["ranger-1"] = Number(receivedInputs.at(-1)?.sequence ?? 2);
    ready.combat.actors.push({
      ...initial.combat.actors[0]!,
      cooldowns: {}
    });
    await sendSnapshot(server, ready);
    await new Promise((resolve) => setTimeout(resolve, 0));
    client.runtime.tick(0);
    expect(client.snapshot().lastReceivedTick).toBe(2);

    client.input.dashSequence = 2;
    client.requestInputSample();
    client.runtime.tick(16);
    await waitFor(() => receivedInputs.some((input) => input.dashSequence === 2));
    client.runtime.tick(16);
    expect(playerPositions.at(-1)).toBeGreaterThan(800);

    const inputsBeforeRepeatedDash = receivedInputs.length;
    client.input.dashSequence = 3;
    client.requestInputSample();
    client.runtime.tick(16);
    await waitFor(() => receivedInputs.length > inputsBeforeRepeatedDash);
    expect(receivedInputs.at(-1)?.dashSequence).toBe(2);

    unsubscribe();
    await client.runtime.dispose();
    await multiplayer.dispose();
    await server.dispose();
  });

  it("validates server config, squad codes, and display names at the Browser boundary", async () => {
    const config = await loadOutpostBrowserServerConfig(
      async () =>
        new Response(JSON.stringify({ endpoint: "http://127.0.0.1:2567", roomName: "outpost" }))
    );
    expect(config).toEqual({ endpoint: "http://127.0.0.1:2567", roomName: "outpost" });
    expect(normalizeOutpostSessionId(" OS / Alpha 07 ")).toBe("os-alpha-07");
    expect(normalizeOutpostDisplayName("  Ranger   Two  ")).toBe("Ranger Two");
    expect(() => normalizeOutpostSessionId("x")).toThrow(/4–32/);
  });
});

function authoritySnapshot(tick: number, playerCount: number): OutpostClientAuthoritySnapshot {
  return {
    phase: "running",
    tick,
    elapsedMs: tick * 50,
    countdownMsRemaining: 0,
    participants: Array.from({ length: playerCount }, (_, slot) => ({
      peerId: `ranger-${slot + 1}`,
      playerId: `player.ranger-${slot + 1}`,
      displayName: `RANGER ${slot + 1}`,
      status: "active" as const,
      ready: true,
      slot
    })),
    players: Array.from({ length: playerCount }, (_, slot) => ({
      networkEntityId: `player.ranger-${slot + 1}`,
      generation: 0,
      archetypeId: "player.outpost.ranger",
      playerId: `player.ranger-${slot + 1}`,
      slot,
      x: 800 + slot * 40,
      y: 500,
      velocityX: slot,
      velocityY: 0,
      facing: 0,
      dashSequence: 0,
      dashRemainingMs: 0,
      dashDirectionX: 0,
      dashDirectionY: 0
    })),
    combat: {
      actors: [],
      projectiles: [],
      projectileGeneration: "browser-test",
      projectileRecords: [],
      cueWatermark: 0,
      cues: [],
      acceptedCommands: 0,
      rejectedCommands: 0,
      projectileHits: 0,
      enemyAttacks: 0,
      kills: 0,
      drops: 0,
      objectiveProgress: 0
    },
    inputAcksByPeerId: Object.fromEntries(
      Array.from({ length: playerCount }, (_, slot) => [`ranger-${slot + 1}`, tick])
    )
  };
}

function projectileObjectId(generation: string, correlationId: string): string {
  return `outpost.combat-projectile.${generation}.${correlationId}`;
}

function combatActor(
  objectId: string,
  kind: "enemy" | "buildable",
  renderKey: string
): OutpostClientAuthoritySnapshot["combat"]["actors"][number] {
  return {
    objectId,
    networkEntityId: objectId,
    generation: 0,
    kind,
    definitionId: kind === "enemy" ? "enemy.outpost.raider" : "buildable.outpost.turret",
    renderKey,
    x: 680,
    y: 500,
    velocityX: 105,
    velocityY: 0,
    facing: 0,
    health: 45,
    shield: 0,
    stamina: 0,
    resource: 0,
    tags: [kind === "enemy" ? "team.enemies" : "team.players"],
    cooldowns: {}
  };
}

function playerCombatActor(): OutpostClientAuthoritySnapshot["combat"]["actors"][number] {
  return {
    objectId: "player.ranger-1",
    networkEntityId: "player.ranger-1",
    generation: 0,
    kind: "player",
    definitionId: "player.outpost.ranger",
    renderKey: "render.outpost.player",
    x: 800,
    y: 500,
    velocityX: 0,
    velocityY: 0,
    facing: 0,
    health: 100,
    shield: 50,
    stamina: 100,
    resource: 0,
    tags: ["team.players"],
    cooldowns: {},
    weapon: {
      weaponId: "weapon.outpost.rifle",
      magazine: 24,
      magazineSize: 24,
      reserveAmmo: 144,
      phase: "ready",
      shotSequence: 0
    }
  };
}

function combatProjectile(
  objectId: string
): OutpostClientAuthoritySnapshot["combat"]["projectiles"][number] {
  return {
    objectId,
    networkEntityId: objectId,
    generation: 0,
    renderKey: "render.outpost.projectile",
    x: 720,
    y: 500,
    velocityX: 760,
    velocityY: 0,
    facing: 0
  };
}

async function sendSnapshot(
  runtime: MultiplayerRuntime,
  snapshot: OutpostClientAuthoritySnapshot
): Promise<void> {
  await runtime.send({
    channel: "reliable",
    kind: "game.snapshot",
    tick: snapshot.tick,
    payload: snapshot
  });
}

async function waitFor(predicate: () => boolean): Promise<void> {
  const startedAt = Date.now();
  while (!predicate()) {
    if (Date.now() - startedAt > 500) {
      throw new Error("Timed out waiting for Outpost multiplayer condition.");
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
