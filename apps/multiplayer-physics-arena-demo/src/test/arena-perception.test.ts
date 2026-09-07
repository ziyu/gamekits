import {
  createAiDataTypes,
  createAiRuntime,
  type AiAgentReadContext,
  type AiPerceptionFact
} from "@gamekits/ai-core";
import { createDataRegistry, type DataTypeDefinition } from "@gamekits/data";
import type { PhysicsQueries } from "@gamekits/physics-core";
import { describe, expect, it } from "vitest";

import {
  ARENA_HAZARD_FACT,
  ARENA_IMPACT_FACT,
  ARENA_ITEM_FACT,
  ARENA_OBJECTIVE_FACT,
  ARENA_OPPONENT_FACT,
  createArenaBotSensorSamplers,
  type ArenaBotPerceptionFrame,
  type ArenaBotPerceptionSource
} from "../ai/perception";
import { compileArenaContent, createArenaDataRegistry } from "../content/registry";

describe("Knockout Arena authority perception", () => {
  it("samples bounded opponents, items, hazards, objective and impacts from authority facts", () => {
    const source = fixtureSource();
    const samplers = new Map(
      createArenaBotSensorSamplers(source).map((sampler) => [sampler.id, sampler])
    );
    const context = readContext();

    const opponents = samplers.get("arena.opponents")!.sample(context, sensor("opponents"));
    expect(opponents.map(({ subjectId }) => subjectId)).toEqual([
      "participant.near",
      "participant.left"
    ]);
    expect(opponents.every(({ key }) => key === ARENA_OPPONENT_FACT)).toBe(true);
    expect(opponents[0]).toMatchObject({
      metadata: { lineOfSight: true, instability: 0.4 },
      expiresAt: expect.any(Number)
    });

    expect(samplers.get("arena.items")!.sample(context, sensor("items"))).toEqual([
      expect.objectContaining({
        key: ARENA_ITEM_FACT,
        subjectId: "item.world.1",
        metadata: {
          generation: 2,
          definitionId: "item.foam-ball",
          kind: "throwable",
          distance: 3,
          contestedBy: 1
        }
      })
    ]);
    expect(samplers.get("arena.hazards")!.sample(context, sensor("hazards"))).toEqual([
      expect.objectContaining({
        key: ARENA_HAZARD_FACT,
        subjectId: "hazard.sweeper",
        metadata: expect.objectContaining({ phase: "warning", nextTransitionTick: 130 })
      })
    ]);
    expect(samplers.get("arena.objective")!.sample(context, sensor("objective"))).toEqual([
      expect.objectContaining({
        key: ARENA_OBJECTIVE_FACT,
        subjectId: "checkpoint.2",
        metadata: expect.objectContaining({ stageKind: "qualifier", qualificationCount: 6 })
      })
    ]);
    expect(samplers.get("arena.impacts")!.sample(context, sensor("impacts"))).toEqual([
      expect.objectContaining({
        key: ARENA_IMPACT_FACT,
        subjectId: "bot.attacker",
        value: 0.75
      })
    ]);
  });

  it("uses AI Core bounded memory and expires stale authority observations", () => {
    const registry = createDataRegistry();
    for (const definition of createAiDataTypes()) {
      registry.registerType(definition as DataTypeDefinition<any>);
    }
    registry.registerPack({
      id: "arena.perception.memory",
      version: "1",
      entries: [
        {
          type: "ai.agent",
          id: "agent.perception",
          data: {
            id: "agent.perception",
            sensors: [],
            goals: [],
            decisionIntervalMs: 100,
            memoryLimit: 2
          }
        }
      ]
    });
    const runtime = createAiRuntime({
      dataRegistry: registry,
      world: emptyWorld(),
      intentSink: { emit() {} }
    });
    runtime.bind({ agentId: "bot.memory", definitionId: "agent.perception", actorId: "bot.0" });
    runtime.observe("bot.memory", [fact("a", 0, 50), fact("b", 1, 50), fact("c", 2, 50)]);

    expect(runtime.getAgent("bot.memory")).toMatchObject({ memorySize: 2 });
    expect(runtime.captureCheckpoint().agents[0]?.memory.map(({ subjectId }) => subjectId)).toEqual(
      ["b", "c"]
    );
    runtime.update(60, 60);
    expect(runtime.getAgent("bot.memory")).toMatchObject({ memorySize: 0 });

    runtime.dispose();
    expect(runtime.snapshot()).toMatchObject({ disposed: true, agents: [] });
  });
});

function fixtureSource(): ArenaBotPerceptionSource {
  const profile = {
    ...compileArenaContent(createArenaDataRegistry()).botProfiles.find(
      ({ id }) => id === "bot.profile.sprinter"
    )!,
    maxOpponents: 2,
    maxItems: 1
  };
  const frame: ArenaBotPerceptionFrame = {
    tick: 100,
    elapsedMs: 1_000,
    stageId: "stage.circuit-forge",
    stageKind: "qualifier",
    actors: [
      actor("participant.self", "bot.0", 0, 0),
      { ...actor("participant.near", "bot.near", 0, 2), instability: 0.4 },
      actor("participant.blocked", "bot.blocked", 4, 0),
      actor("participant.left", "bot.left", -3, 0),
      actor("participant.far", "bot.far", 40, 0)
    ],
    items: [
      {
        instanceId: "item.world.1",
        generation: 2,
        definitionId: "item.foam-ball",
        kind: "throwable",
        position: { x: 0, y: 1, z: 3 },
        value: 0.8,
        contestedBy: 1
      },
      {
        instanceId: "item.world.2",
        generation: 1,
        definitionId: "item.energy-block",
        kind: "impact",
        position: { x: -8, y: 1, z: 0 },
        value: 1,
        contestedBy: 0
      }
    ],
    hazards: [
      {
        id: "hazard.sweeper",
        kind: "rotating-sweeper",
        phase: "warning",
        active: false,
        position: { x: 0, y: 1, z: -2 },
        size: { width: 10, height: 1, depth: 1 },
        nextTransitionTick: 130
      },
      {
        id: "hazard.future",
        kind: "piston",
        phase: "idle",
        active: false,
        position: { x: 0, y: 1, z: -3 },
        size: { width: 2, height: 2, depth: 2 },
        nextTransitionTick: 1_000
      }
    ],
    impacts: [
      {
        targetMemberId: "bot.0",
        sourceMemberId: "bot.attacker",
        tick: 98,
        direction: { x: -1, y: 0, z: 0 },
        severity: 0.75
      }
    ],
    objective: {
      id: "checkpoint.2",
      position: { x: 0, y: 1, z: -7 },
      routeOrder: 2,
      checkpointCount: 3,
      qualificationCount: 6,
      activeParticipants: 8,
      completedParticipants: 1,
      stageProgress: 0.35
    }
  };
  return { frame: () => frame, profileFor: () => profile };
}

function readContext(): AiAgentReadContext {
  return {
    elapsed: 1_000,
    agent: { agentId: "agent.bot.0", definitionId: "bot.sprinter", actorId: "bot.0" },
    definition: {
      id: "bot.sprinter",
      sensors: [],
      goals: [],
      decisionIntervalMs: 100,
      memoryLimit: 24
    },
    world: emptyWorld(),
    physics: {
      raycast(_origin, direction) {
        return direction.x > 0.8 ? [{ colliderId: "wall", bodyId: "wall" }] : [];
      }
    } as PhysicsQueries,
    facts: () => [],
    fact: () => undefined,
    blackboard: () => undefined
  };
}

function emptyWorld() {
  return {
    has: () => false,
    get: () => undefined,
    query: () => [],
    count: () => 0
  };
}

function actor(participantId: string, memberId: string, x: number, z: number) {
  return {
    participantId,
    memberId,
    position: { x, y: 1, z },
    linearVelocity: { x: 0, y: 0, z: 0 },
    status: "active" as const,
    instability: 0
  };
}

function sensor(id: string) {
  return { id, sampler: `arena.${id}`, intervalMs: 100 };
}

function fact(subjectId: string, observedAt: number, expiresAt: number): AiPerceptionFact {
  return { key: ARENA_OPPONENT_FACT, subjectId, observedAt, expiresAt };
}
