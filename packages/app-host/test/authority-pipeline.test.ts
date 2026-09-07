import {
  createConfiguredAppHost,
  createGameplayDevToolsCorrelation,
  createStandardAppProfile,
  createStandardCameraModule,
  createStandardGasModule,
  createStandardMultiplayerModule,
  createStandardPhysicsModule,
  createStandardTcaModule,
  defineGameApp
} from "@gamekits/app-host";
import { createCameraController } from "@gamekits/camera-core";
import { defineGameModule } from "@gamekits/core";
import { createDataRegistry } from "@gamekits/data";
import { createDevToolsRuntime } from "@gamekits/devtools";
import { createEventBus } from "@gamekits/event-bus";
import { createGasDataTypes, createGasHandle } from "@gamekits/gas";
import { createGame, type GameInstallContext } from "@gamekits/game-runtime";
import { createMultiplayerRuntime } from "@gamekits/multiplayer-core";
import { createMemoryMultiplayerBackend } from "@gamekits/multiplayer-memory";
import { createMemoryPhysicsBackend, createPhysicsHandle } from "@gamekits/physics-core";
import { createTcaHandle, createTcaRuleDataType } from "@gamekits/tca";
import type { GameWorld } from "@gamekits/world";
import { describe, expect, it } from "vitest";

describe("headless authority module pipeline", () => {
  it("fixes app-owned system order, correlation, and reverse disposal", async () => {
    const registry = createDataRegistry();
    registry.registerType(createTcaRuleDataType());
    for (const type of createGasDataTypes()) {
      registry.registerType(type);
    }
    registry.registerPack({
      id: "authority-rules",
      version: "1.0.0",
      entries: [
        {
          type: "tca.rule",
          id: "rule.hit-objective",
          data: {
            id: "rule.hit-objective",
            trigger: { type: "event.type", args: { eventType: "combat.hit_confirmed" } },
            actions: [{ type: "event.emit", args: { eventType: "objective.updated" } }]
          }
        }
      ]
    });

    const backend = createMemoryMultiplayerBackend();
    const hostMultiplayer = createMultiplayerRuntime({ id: "authority-host", backend });
    const clientMultiplayer = createMultiplayerRuntime({ id: "authority-client", backend });
    await hostMultiplayer.createSession({
      id: "authority-room",
      localPeer: { id: "server", role: "server" }
    });
    await clientMultiplayer.joinSession({
      sessionId: "authority-room",
      localPeer: { id: "client", role: "client" }
    });

    let now = 0;
    const devtools = createDevToolsRuntime({ traceLimit: 32, clock: () => now++ });
    const correlation = createGameplayDevToolsCorrelation({
      devtools,
      correlationLimit: 8,
      tcaTraceLimit: 8,
      gasTraceLimit: 8,
      physicsTraceLimit: 8
    });
    expect(devtools.snapshot().dataSources.map((source) => source.id)).toContain(
      "gameplay-correlation"
    );
    const eventBus = createEventBus({ clock: () => now++ });
    const updates: string[] = [];
    const disposals: string[] = [];
    const gasHandle = createGasHandle({ id: "authority.gas" });
    const tcaHandle = createTcaHandle({ id: "authority.tca" });
    const physicsHandle = createPhysicsHandle({ id: "authority.physics" });
    const camera = createCameraController({ viewport: { width: 320, height: 180 } });
    let activeCorrelationId: string | undefined;
    let activeParentId: string | undefined;

    eventBus.on("multiplayer.command.accepted", (event) => {
      correlation.source.push({
        id: `event:${event.parentId ?? "unknown"}`,
        kind: "multiplayer",
        label: event.type,
        source: event.source ?? "multiplayer",
        ...(event.correlationId === undefined ? {} : { correlationId: event.correlationId }),
        ...(event.parentId === undefined ? {} : { parentId: event.parentId })
      });
    });

    const app = defineGameApp({
      id: "headless-authority-pipeline",
      services: [
        { id: "data" },
        { id: "multiplayer" },
        { id: "game", dependencies: ["data", "multiplayer"] }
      ]
    });
    const profile = createStandardAppProfile({
      id: "headless-authority",
      services: {
        data: { registry },
        multiplayer: { runtime: hostMultiplayer },
        game: {
          modules(ctx) {
            return [
              createStandardMultiplayerModule(ctx, {
                id: "authority.multiplayer",
                handleCommand({ message }) {
                  updates.push("ingress");
                  activeCorrelationId = message.correlationId;
                  activeParentId = message.id;
                }
              }),
              trackedSystemModule("authority.participants", "participants", updates, disposals),
              trackedSystemModule("authority.movement", "movement", updates, disposals),
              createStandardPhysicsModule(ctx, {
                id: "authority.physics",
                backend: createMemoryPhysicsBackend(),
                handle: physicsHandle,
                fixedDeltaMs: 16,
                scene: { gravity: { x: 0, y: 0 } },
                traceStore: correlation.physicsTraceStore
              }),
              createTraceCombatModule(correlation, eventBus, updates, disposals, () => ({
                correlationId: activeCorrelationId,
                parentId: activeParentId
              })),
              createStandardGasModule(ctx, {
                id: "authority.gas",
                traceStore: correlation.gasTraceStore,
                handle: gasHandle
              }),
              createStandardTcaModule(ctx, {
                id: "authority.tca",
                traceStore: correlation.tcaTraceStore,
                handle: tcaHandle
              }),
              trackedSystemModule("authority.checkpoint", "checkpoint", updates, disposals),
              trackedSystemModule("authority.replication", "replication", updates, disposals),
              createStandardCameraModule({
                id: "authority.camera",
                controller: camera,
                actions: [],
                smoothing: { enabled: true },
                buildContext: ctx
              })
            ];
          },
          createRuntime(_ctx, modules) {
            return createGame({
              modules,
              world: createMemoryWorld(),
              eventBus,
              seed: "authority-pipeline"
            });
          }
        }
      }
    });
    const configured = createConfiguredAppHost({ app, profile, context: {} });
    const game = configured.host.services.game;

    expect(game?.modules.map((module) => module.id)).toEqual([
      "authority.multiplayer",
      "authority.participants",
      "authority.movement",
      "authority.physics",
      "authority.combat",
      "authority.gas",
      "authority.tca",
      "authority.checkpoint",
      "authority.replication",
      "authority.camera"
    ]);
    expect(game?.systems.values().map((system) => system.id)).toEqual([
      "authority.multiplayer.commands",
      "authority.participants.system",
      "authority.movement.system",
      "authority.physics.step",
      "authority.combat.system",
      "authority.gas.effects",
      "authority.checkpoint.system",
      "authority.replication.system",
      "authority.camera.smoothing"
    ]);

    await configured.host.start();
    correlation.source.push({
      id: "command-fire-1",
      kind: "multiplayer",
      label: "multiplayer.command.received",
      source: "authority.multiplayer",
      correlationId: "combat-1"
    });
    await clientMultiplayer.send({
      id: "command-fire-1",
      channel: "reliable",
      kind: "game.command",
      correlationId: "combat-1",
      payload: { ability: "rifle" }
    });
    updates.push("authority.begin");
    configured.host.tick(16, 16);
    updates.push("authority.commit", "diagnostics");

    expect(updates).toEqual([
      "authority.begin",
      "ingress",
      "participants",
      "movement",
      "combat",
      "checkpoint",
      "replication",
      "authority.commit",
      "diagnostics"
    ]);
    const correlated = devtools
      .snapshot()
      .traces.filter((entry) => entry.correlationId === "combat-1");
    expect(correlated.map((entry) => entry.kind)).toEqual([
      "multiplayer",
      "multiplayer",
      "physics",
      "gas",
      "tca"
    ]);
    expect(correlated.map((entry) => entry.parentId)).toEqual([
      undefined,
      "command-fire-1",
      "command-fire-1",
      "physics-trace-2",
      "gas-trace-1"
    ]);
    expect(correlation.source.snapshot()).toMatchObject({
      retainedCorrelationCount: 1,
      correlations: [
        {
          correlationId: "combat-1",
          traceCount: 5,
          rootTraceIds: ["command-fire-1"],
          kinds: { multiplayer: 2, physics: 1, gas: 1, tca: 1 }
        }
      ]
    });

    await configured.host.dispose();
    expect(physicsHandle.isBound()).toBe(false);
    expect(gasHandle.isBound()).toBe(false);
    expect(tcaHandle.isBound()).toBe(false);
    expect(disposals).toEqual(["replication", "checkpoint", "combat", "movement", "participants"]);

    correlation.dispose();
    correlation.dispose();
    expect(devtools.snapshot().dataSources.map((source) => source.id)).not.toContain(
      "gameplay-correlation"
    );
    devtools.dispose();
    clientMultiplayer.dispose();
  });

  it("bounds default payloads, supports explicit redaction, and isolates bridge failures", () => {
    let now = 0;
    const devtools = createDevToolsRuntime({ clock: () => now++ });
    const defaults = createGameplayDevToolsCorrelation({ devtools, id: "defaults" });

    defaults.gasTraceStore.add({
      type: "ability.activated",
      timestamp: 1,
      actorId: "actor.one",
      details: { secret: "must-not-leak" }
    });
    defaults.physicsTraceStore.push({
      kind: "query",
      label: "query.safe",
      payload: { secret: "must-not-leak" }
    });
    defaults.combatTraceStore.add({
      type: "delivery.accepted",
      timestamp: 2,
      requestId: "delivery.safe",
      details: { secret: "must-not-leak" }
    });
    defaults.observeNavigationTrace({
      sequence: 0,
      kind: "result",
      label: "navigation.path_completed",
      timestamp: 3,
      revision: 4,
      requestId: "path.safe",
      payload: { cache: "miss", secret: "must-not-leak" }
    });
    defaults.observeAiTrace({
      sequence: 0,
      kind: "goal",
      label: "ai.goal_selected",
      timestamp: 4,
      agentId: "agent.safe",
      payload: { goalId: "goal.safe", secret: "must-not-leak" }
    });
    defaults.observeAnimatorTrace({
      sequence: 0,
      kind: "phase",
      label: "animator.phase_synced",
      timestamp: 5,
      controllerId: "controller.safe",
      payload: { executionId: "execution.safe", phase: "active", secret: "must-not-leak" }
    });
    defaults.observeAudioDiagnostic({
      sequence: 0,
      type: "audio.event_started",
      timestamp: 6,
      payload: {
        instanceId: "instance.safe",
        eventId: "event.safe",
        secret: "must-not-leak"
      }
    });

    expect(devtools.snapshot().traces.map((trace) => trace.payload)).toEqual([
      { type: "ability.activated", timestamp: 1 },
      { kind: "query" },
      { type: "delivery.accepted", timestamp: 2, requestId: "delivery.safe" },
      {
        kind: "result",
        timestamp: 3,
        revision: 4,
        requestId: "path.safe",
        cache: "miss"
      },
      { kind: "goal", timestamp: 4, agentId: "agent.safe", goalId: "goal.safe" },
      {
        kind: "phase",
        timestamp: 5,
        controllerId: "controller.safe",
        executionId: "execution.safe",
        phase: "active"
      },
      {
        type: "audio.event_started",
        timestamp: 6,
        instanceId: "instance.safe",
        eventId: "event.safe"
      }
    ]);
    defaults.dispose();

    const customized = createGameplayDevToolsCorrelation({
      devtools,
      id: "customized",
      summaries: {
        gas(entry) {
          return { actorId: entry.actorId, secret: entry.details?.secret };
        },
        physics() {
          throw new Error("custom summary failed");
        },
        ai() {
          throw new Error("custom AI summary failed");
        },
        redact(payload, context) {
          if (context.kind !== "gas") {
            return payload;
          }
          return { actorId: (payload as { actorId?: string }).actorId };
        }
      }
    });

    customized.gasTraceStore.add({
      type: "actor.created",
      timestamp: 2,
      actorId: "actor.two",
      details: { secret: "explicitly-redacted" }
    });
    expect(() =>
      customized.physicsTraceStore.push({ kind: "step", label: "physics.step" })
    ).not.toThrow();
    expect(() =>
      customized.observeAiTrace({
        sequence: 7,
        kind: "decision",
        label: "ai.goals_scored",
        timestamp: 7
      })
    ).not.toThrow();

    const snapshot = devtools.snapshot();
    expect(snapshot.traces.at(-1)?.payload).toEqual({ actorId: "actor.two" });
    expect(snapshot.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "devtools.gameplay_trace_bridge_failed",
          severity: "warning",
          relatedTraceId: "physics-trace-1",
          dataSourceId: "customized",
          payload: { kind: "physics" }
        }),
        expect.objectContaining({
          code: "devtools.gameplay_trace_bridge_failed",
          severity: "warning",
          relatedTraceId: "ai-trace-7",
          dataSourceId: "customized",
          payload: { kind: "ai" }
        })
      ])
    );
    customized.dispose();
    devtools.dispose();
  });
});

function trackedSystemModule(id: string, label: string, updates: string[], disposals: string[]) {
  return defineGameModule<GameInstallContext>({
    id,
    install(ctx) {
      ctx.systems.register({
        id: `${id}.system`,
        update() {
          updates.push(label);
        }
      });
      return () => disposals.push(label);
    }
  });
}

function createTraceCombatModule(
  correlation: ReturnType<typeof createGameplayDevToolsCorrelation>,
  eventBus: ReturnType<typeof createEventBus>,
  updates: string[],
  disposals: string[],
  context: () => { correlationId?: string; parentId?: string }
) {
  return defineGameModule<GameInstallContext>({
    id: "authority.combat",
    install(ctx) {
      ctx.systems.register({
        id: "authority.combat.system",
        update({ tick, elapsed }) {
          updates.push("combat");
          const operation = context();
          if (operation.correlationId === undefined) {
            return;
          }
          const physicsTrace = correlation.physicsTraceStore.push({
            kind: "query",
            tick,
            elapsed,
            label: "physics.query.hit",
            correlationId: operation.correlationId,
            ...(operation.parentId === undefined ? {} : { parentId: operation.parentId })
          });
          const gasTrace = correlation.gasTraceStore.add({
            type: "effect.applied",
            timestamp: elapsed,
            actorId: "enemy-1",
            effectId: "effect.damage",
            correlationId: operation.correlationId,
            parentId: physicsTrace.id
          });
          eventBus.emit("combat.hit_confirmed", { targetActorId: "enemy-1" }, "authority.combat", {
            correlationId: operation.correlationId,
            parentId: gasTrace.id
          });
        }
      });
      return () => disposals.push("combat");
    }
  });
}

function createMemoryWorld(): GameWorld {
  return {
    spawn: () => "entity",
    despawn() {},
    has: () => false,
    add() {},
    get: () => undefined,
    set() {},
    remove() {},
    query: () => [],
    count: () => 0
  };
}
