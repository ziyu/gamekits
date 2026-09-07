import { createDataRegistry, type DataPack, type DataRegistry } from "@gamekits/data";
import { createEventBus } from "@gamekits/event-bus";
import { createGame } from "@gamekits/game-runtime";
import type { NavigationQueries } from "@gamekits/navigation-core";
import type { PhysicsQueries } from "@gamekits/physics-core";
import type { ComponentDef, EntityId, GameWorld } from "@gamekits/world";
import { describe, expect, it } from "vitest";
import {
  bindAiHandle,
  createAiDataTypes,
  createAiHandle,
  createAiModule,
  createAiNavigationQueries,
  createAiRuntime,
  createAiSaveContributor,
  createAiWorldReadModel,
  evaluateAiUtilityCurve,
  type AiBlackboardValue,
  type AiIntent,
  type AiPerceptionFact,
  type AiSchedulerClass,
  type AiSensorSampler,
  type AiSharedFactQueries,
  type AiTaskExecutor,
  type AiTraceEntry,
  type AiTraceProductionOptions,
  type AiTraceRetentionOptions
} from "../src";
import { createMemoryAiRuntimeFixture, runAiRuntimeConformance } from "../src/testing";

describe("AI data types", () => {
  it("validates schedules, references, and utility curves", () => {
    const registry = createRegistry(false);
    const validation = registry.validatePack({
      id: "ai.invalid",
      version: "1.0.0",
      entries: [
        {
          type: "ai.agent",
          id: "agent.invalid",
          data: {
            id: "agent.invalid",
            sensors: [],
            goals: [],
            decisionIntervalMs: 0,
            memoryLimit: 0,
            blackboardLimit: 0
          }
        },
        {
          type: "ai.goal",
          id: "goal.invalid",
          data: {
            id: "goal.invalid",
            task: { type: "ai.task", id: "task.missing" },
            considerations: [
              { input: "attack", curve: { type: "points", points: [{ x: 0, y: 0 }] } }
            ]
          }
        }
      ]
    });

    expect(validation.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "ai.agent_invalid_decision_interval" }),
        expect.objectContaining({ code: "ai.agent_invalid_memory_limit" }),
        expect.objectContaining({ code: "ai.agent_invalid_blackboard_limit" }),
        expect.objectContaining({ code: "ai.goal_invalid_curve_points" }),
        expect.objectContaining({ code: "data.missing_reference" })
      ])
    );
  });
});

describe("AI runtime", () => {
  it("evaluates supported utility curves deterministically", () => {
    expect(evaluateAiUtilityCurve({ type: "linear", min: 0, max: 10 }, 5)).toBe(0.5);
    expect(evaluateAiUtilityCurve({ type: "inverse", min: 0, max: 10 }, 2)).toBe(0.8);
    expect(evaluateAiUtilityCurve({ type: "step", threshold: 3 }, 3)).toBe(1);
    expect(evaluateAiUtilityCurve({ type: "power", exponent: 2 }, 0.5)).toBe(0.25);
    expect(
      evaluateAiUtilityCurve(
        {
          type: "points",
          points: [
            { x: 0, y: 0 },
            { x: 10, y: 1 }
          ]
        },
        2.5
      )
    ).toBe(0.25);
  });

  it("samples perception, scores goals, and emits intents from tasks", () => {
    let observerErrors = 0;
    const fixture = createFixture({
      onTrace() {
        throw new Error("observer failed");
      },
      onTraceError() {
        observerErrors += 1;
      }
    });
    fixture.runtime.bind({ agentId: "agent.one", definitionId: "agent.standard" });
    fixture.runtime.setBlackboard("agent.one", "attack", 0.9);
    fixture.runtime.setBlackboard("agent.one", "flee", 0.1);

    fixture.runtime.update(1_000, 1_000);

    expect(fixture.runtime.getAgent("agent.one")).toMatchObject({
      goalId: "goal.attack",
      memorySize: 1,
      task: { taskId: "task.attack", status: "running" }
    });
    expect(fixture.intents).toContainEqual(
      expect.objectContaining({
        type: "action",
        agentId: "agent.one",
        actionId: "attack",
        source: "ai:task.attack"
      })
    );
    expect(fixture.runtime.traces()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: "ai.sensor_sampled" }),
        expect.objectContaining({ label: "ai.goal_selected" }),
        expect.objectContaining({ label: "ai.intent_emitted" })
      ])
    );
    expect(observerErrors).toBeGreaterThan(0);
  });

  it("retains configured trace kinds within per-kind and global bounds", () => {
    const fixture = createFixture({
      traceRetention: {
        limit: 8,
        kinds: ["goal", "task", "intent"],
        kindLimits: { intent: 2 }
      },
      tasks: [
        {
          id: "task.attack",
          start(context) {
            context.emit({ type: "action", actionId: "attack" });
            return { status: "running", safeToInterrupt: true };
          },
          update(context) {
            context.emit({ type: "action", actionId: "attack" });
            return { status: "running", safeToInterrupt: true };
          }
        },
        fixtureTasks()[1]!
      ]
    });
    fixture.runtime.bind({ agentId: "agent.trace-retention", definitionId: "agent.standard" });
    fixture.runtime.setBlackboard("agent.trace-retention", "attack", 1);
    fixture.runtime.update(1_000, 1_000);
    for (let index = 1; index <= 10; index += 1) {
      fixture.runtime.update(16, 1_000 + index * 16);
    }

    const traces = fixture.runtime.traces();
    expect(traces.length).toBeLessThanOrEqual(8);
    expect(traces.filter((entry) => entry.kind === "intent")).toHaveLength(2);
    expect(traces).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "goal", label: "ai.goal_selected" }),
        expect.objectContaining({ kind: "task", label: "ai.task_started" })
      ])
    );
    expect(new Set(traces.map((entry) => entry.kind))).toEqual(new Set(["goal", "task", "intent"]));
    fixture.dispose();
  });

  it("bounds trace production separately from retention and reports dropped entries", () => {
    const fixture = createFixture({
      traceProduction: {
        maxEntriesPerUpdate: 2,
        goalScoreDetail: "all"
      }
    });
    fixture.runtime.bind({ agentId: "agent.trace-budget", definitionId: "agent.standard" });
    fixture.runtime.setBlackboard("agent.trace-budget", "attack", 1);

    fixture.runtime.update(1_000, 1_000);

    expect(fixture.runtime.snapshot().droppedTraceEntries).toBeGreaterThan(0);
    expect(fixture.runtime.traces()).toContainEqual(
      expect.objectContaining({
        kind: "budget",
        label: "ai.trace_dropped",
        payload: expect.objectContaining({ dropped: expect.any(Number) })
      })
    );
    fixture.dispose();
  });

  it("publishes live trace observers when retained trace is disabled", () => {
    const observed: AiTraceEntry[] = [];
    const fixture = createFixture({
      traceRetention: { limit: 0 },
      onTrace(entry) {
        observed.push(entry);
      }
    });
    fixture.runtime.bind({ agentId: "agent.live-trace", definitionId: "agent.standard" });
    fixture.runtime.setBlackboard("agent.live-trace", "attack", 1);
    fixture.runtime.update(1_000, 1_000);

    expect(fixture.runtime.traces()).toEqual([]);
    expect(observed).toContainEqual(expect.objectContaining({ label: "ai.goal_selected" }));
    fixture.dispose();
  });

  it("retains configurable utility reasoning without exposing mutable trace state", () => {
    const fixture = createFixture({ traceProduction: { goalScoreDetail: "all" } });
    fixture.runtime.bind({ agentId: "agent.reasoning", definitionId: "agent.standard" });
    fixture.runtime.setBlackboard("agent.reasoning", "attack", 0.8);
    fixture.runtime.setBlackboard("agent.reasoning", "flee", 0.2);
    fixture.runtime.update(1_000, 1_000);

    const trace = fixture.runtime.traces().find((entry) => entry.label === "ai.goals_scored")!;
    const scores = trace.payload?.scores as Array<{
      goalId: string;
      considerations: Array<{ raw: number }>;
    }>;
    expect(scores).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          goalId: "goal.attack",
          considerations: [expect.objectContaining({ raw: 0.8 })]
        })
      ])
    );
    scores[0]!.considerations[0]!.raw = -1;
    const isolated = fixture.runtime.traces().find((entry) => entry.label === "ai.goals_scored")
      ?.payload?.scores as Array<{
      considerations: Array<{ raw: number }>;
    }>;
    expect(isolated[0]!.considerations[0]!.raw).not.toBe(-1);
    fixture.dispose();
  });

  it("exposes only read-only World capabilities to sensors and task executors", () => {
    const mutableWorld = createMemoryWorld();
    let sensorReceivedMutationCapability = true;
    let taskReceivedMutationCapability = true;
    const runtime = createAiRuntime({
      dataRegistry: createRegistry(),
      world: mutableWorld,
      intentSink: { emit() {} },
      sensors: [
        {
          id: "sensor.fixture",
          sample(context) {
            sensorReceivedMutationCapability = "set" in context.world;
            return [];
          }
        }
      ],
      inputs: fixtureInputs(),
      tasks: [
        {
          id: "task.attack",
          start(context) {
            taskReceivedMutationCapability = "set" in context.world;
            return { status: "running", safeToInterrupt: true };
          },
          update() {
            return { status: "running", safeToInterrupt: true };
          }
        },
        fixtureTasks()[1]!
      ]
    });
    runtime.bind({ agentId: "agent.read-only", definitionId: "agent.standard" });
    runtime.setBlackboard("agent.read-only", "attack", 1);

    runtime.update(1_000, 1_000);

    expect(sensorReceivedMutationCapability).toBe(false);
    expect(taskReceivedMutationCapability).toBe(false);
    runtime.dispose();
  });

  it("projects navigation handles to the query capability", () => {
    const handle = {
      projectPoint() {
        return undefined;
      },
      requestPath() {
        return "request";
      },
      poll() {
        return { status: "missing", requestId: "request" };
      },
      cancel() {},
      sampleRoute() {
        return { status: "missing", routeId: "route", revision: 0 };
      },
      releaseRoute() {},
      revision() {
        return 0;
      },
      snapshot() {
        throw new Error("not used");
      },
      updateObstacle() {}
    } satisfies NavigationQueries & { updateObstacle(): void };
    const navigation = createAiNavigationQueries(handle);

    expect("requestPath" in navigation).toBe(true);
    expect("updateObstacle" in navigation).toBe(false);
  });

  it("projects PhysicsQueries without exposing scene mutation or stepping", () => {
    let sampledHits = 0;
    let receivedStep = true;
    const physics = {
      ...createPhysicsQueries(),
      step() {}
    } satisfies PhysicsQueries & { step(): void };
    const fixture = createFixture({
      physics,
      sensors: [
        {
          id: "sensor.fixture",
          sample(context) {
            receivedStep = "step" in (context.physics ?? {});
            sampledHits = context.physics?.raycast({ x: 0, y: 0 }, { x: 1, y: 0 }).length ?? 0;
            return [];
          }
        }
      ]
    });
    fixture.runtime.bind({ agentId: "agent.physics", definitionId: "agent.standard" });
    fixture.runtime.setBlackboard("agent.physics", "attack", 1);

    fixture.runtime.update(1_000, 1_000);

    expect(receivedStep).toBe(false);
    expect(sampledHits).toBe(1);
    fixture.dispose();
  });

  it("injects isolated shared gameplay facts without merging them into agent memory", () => {
    const source: AiPerceptionFact = {
      key: "encounter.directive",
      observedAt: 0,
      value: "focus-core",
      metadata: { phase: { id: "siege" } }
    };
    let sharedValue: string | number | boolean | undefined;
    const fixture = createFixture({
      sharedFacts: {
        facts() {
          return [source];
        },
        fact() {
          return source;
        }
      },
      sensors: [
        {
          id: "sensor.fixture",
          sample(context) {
            const shared = context.sharedFacts?.fact("encounter.directive");
            sharedValue = shared?.value;
            (shared?.metadata?.phase as { id: string }).id = "mutated";
            return [];
          }
        }
      ]
    });
    fixture.runtime.bind({ agentId: "agent.shared-facts", definitionId: "agent.standard" });
    fixture.runtime.setBlackboard("agent.shared-facts", "attack", 1);

    fixture.runtime.update(1_000, 1_000);

    expect(sharedValue).toBe("focus-core");
    expect((source.metadata?.phase as { id: string }).id).toBe("siege");
    expect(fixture.runtime.getAgent("agent.shared-facts")?.memorySize).toBe(0);
    fixture.dispose();
  });

  it("rejects path requests beyond the independent AI path budget", () => {
    let delegatedRequests = 0;
    const fixture = createFixture({
      navigation: createNavigationQueries(() => {
        delegatedRequests += 1;
      }),
      maxPathRequestsPerTick: 1,
      tasks: [
        {
          id: "task.attack",
          start(context) {
            const request = {
              requesterId: context.agent.agentId,
              profileId: "ground",
              start: { x: 0, y: 0 },
              goal: { x: 1, y: 0 }
            };
            const first = context.navigation!.requestPath(request);
            const second = context.navigation!.requestPath(request);
            return {
              status: "running",
              safeToInterrupt: true,
              state: { first, secondStatus: context.navigation!.poll(second).status }
            };
          },
          update() {
            return { status: "running", safeToInterrupt: true };
          }
        },
        fixtureTasks()[1]!
      ]
    });
    fixture.runtime.bind({ agentId: "agent.path-budget", definitionId: "agent.standard" });
    fixture.runtime.setBlackboard("agent.path-budget", "attack", 1);

    fixture.runtime.update(1_000, 1_000);

    expect(delegatedRequests).toBe(1);
    expect(fixture.runtime.getAgent("agent.path-budget")?.task?.state).toMatchObject({
      secondStatus: "rejected"
    });
    expect(fixture.runtime.snapshot().rejectedPathRequests).toBe(1);
    expect(fixture.runtime.traces()).toContainEqual(
      expect.objectContaining({ label: "ai.path_request_rejected" })
    );
    fixture.dispose();
  });

  it("bounds blackboard entries and isolates stored values", () => {
    const fixture = createFixture({ defaultBlackboardLimit: 2 });
    fixture.runtime.bind({ agentId: "agent.blackboard", definitionId: "agent.standard" });
    const source: AiBlackboardValue = { target: { id: "first" } };
    fixture.runtime.setBlackboard("agent.blackboard", "target", source);
    (source as { target: { id: string } }).target.id = "mutated";
    fixture.runtime.setBlackboard("agent.blackboard", "mode", "attack");
    fixture.runtime.setBlackboard("agent.blackboard", "mode", "retreat");

    expect(() => fixture.runtime.setBlackboard("agent.blackboard", "overflow", true)).toThrowError(
      expect.objectContaining({ code: "ai.blackboard_capacity" })
    );
    expect(fixture.runtime.getAgent("agent.blackboard")).toMatchObject({
      blackboardSize: 2,
      blackboardLimit: 2,
      blackboardKeys: ["mode", "target"]
    });
    const checkpoint = fixture.runtime.captureCheckpoint();
    expect(checkpoint.agents[0]?.blackboard.target).toEqual({ target: { id: "first" } });
    (checkpoint.agents[0]!.blackboard.target as { target: { id: string } }).target.id = "external";
    expect(fixture.runtime.captureCheckpoint().agents[0]?.blackboard.target).toEqual({
      target: { id: "first" }
    });
  });

  it("rejects blackboard values that are unsafe or exceed value budgets", () => {
    const fixture = createFixture({ maxBlackboardValueDepth: 1 });
    fixture.runtime.bind({ agentId: "agent.blackboard-value", definitionId: "agent.standard" });
    const cyclic: { self?: AiBlackboardValue } = {};
    cyclic.self = cyclic;

    expect(() =>
      fixture.runtime.setBlackboard("agent.blackboard-value", "number", Number.NaN)
    ).toThrowError(expect.objectContaining({ code: "ai.blackboard_invalid_value" }));
    expect(() =>
      fixture.runtime.setBlackboard("agent.blackboard-value", "cycle", cyclic)
    ).toThrowError(expect.objectContaining({ code: "ai.blackboard_invalid_value" }));
    expect(() =>
      fixture.runtime.setBlackboard("agent.blackboard-value", "deep", { first: { second: 1 } })
    ).toThrowError(expect.objectContaining({ code: "ai.blackboard_invalid_value" }));
    expect(fixture.runtime.getAgent("agent.blackboard-value")?.blackboardSize).toBe(0);
  });

  it("honors goal commitment before switching to a better goal", () => {
    const fixture = createFixture();
    fixture.runtime.bind({ agentId: "agent.commit", definitionId: "agent.standard" });
    fixture.runtime.setBlackboard("agent.commit", "attack", 0.8);
    fixture.runtime.setBlackboard("agent.commit", "flee", 0.2);
    fixture.runtime.update(1_000, 1_000);
    expect(fixture.runtime.getAgent("agent.commit")?.goalId).toBe("goal.attack");

    fixture.runtime.setBlackboard("agent.commit", "attack", 0.1);
    fixture.runtime.setBlackboard("agent.commit", "flee", 1);
    fixture.runtime.update(100, 1_100);
    expect(fixture.runtime.getAgent("agent.commit")?.goalId).toBe("goal.attack");

    fixture.runtime.update(500, 1_600);
    expect(fixture.runtime.getAgent("agent.commit")?.goalId).toBe("goal.flee");
  });

  it("waits for a safe point before switching tasks", () => {
    const fixture = createFixture({
      tasks: [
        {
          id: "task.attack",
          start() {
            return { status: "running", safeToInterrupt: false };
          },
          update() {
            return { status: "running", safeToInterrupt: true };
          }
        },
        fixtureTasks()[1]!
      ]
    });
    fixture.runtime.bind({ agentId: "agent.safe", definitionId: "agent.safe-point" });
    fixture.runtime.setBlackboard("agent.safe", "attack", 1);
    fixture.runtime.update(1_000, 1_000);

    fixture.runtime.setBlackboard("agent.safe", "attack", 0);
    fixture.runtime.setBlackboard("agent.safe", "flee", 1);
    fixture.runtime.update(100, 1_100);
    expect(fixture.runtime.getAgent("agent.safe")?.goalId).toBe("goal.safe-point");
    expect(fixture.runtime.traces()).toContainEqual(
      expect.objectContaining({
        label: "ai.goal_decided",
        agentId: "agent.safe",
        payload: expect.objectContaining({ reason: "interrupt-policy" })
      })
    );

    fixture.runtime.update(100, 1_200);
    expect(fixture.runtime.getAgent("agent.safe")?.goalId).toBe("goal.flee-strict");
  });

  it("does not interrupt a never-interrupt task when its goal becomes ineligible", () => {
    const fixture = createFixture();
    fixture.runtime.bind({ agentId: "agent.never", definitionId: "agent.never" });
    fixture.runtime.setBlackboard("agent.never", "attack", 1);
    fixture.runtime.update(1_000, 1_000);

    fixture.runtime.setBlackboard("agent.never", "attack", 0);
    fixture.runtime.setBlackboard("agent.never", "flee", 0);
    fixture.runtime.update(100, 1_100);

    expect(fixture.runtime.getAgent("agent.never")).toMatchObject({
      goalId: "goal.never",
      task: { taskId: "task.never", status: "running" }
    });
    expect(fixture.runtime.traces()).toContainEqual(
      expect.objectContaining({
        label: "ai.goal_decided",
        agentId: "agent.never",
        payload: expect.objectContaining({
          action: "keep",
          reason: "interrupt-policy",
          candidateGoalId: null
        })
      })
    );
  });

  it("bounds memory and expires stale facts", () => {
    const fixture = createFixture();
    fixture.runtime.bind({ agentId: "agent.memory", definitionId: "agent.tiny-memory" });
    fixture.runtime.observe("agent.memory", [
      fact("first", 1),
      fact("second", 2),
      fact("third", 3, 20)
    ]);
    expect(fixture.runtime.getAgent("agent.memory")?.memorySize).toBe(2);

    fixture.runtime.update(25, 25);
    expect(fixture.runtime.getAgent("agent.memory")?.memorySize).toBe(1);
  });

  it("delays decisions beyond the configured per-tick budget", () => {
    const fixture = createFixture({ maxDecisionsPerTick: 1, maxSensorSamplesPerTick: 1 });
    for (const agentId of ["agent.a", "agent.b", "agent.c"]) {
      fixture.runtime.bind({ agentId, definitionId: "agent.standard" });
      fixture.runtime.setBlackboard(agentId, "attack", 1);
    }

    fixture.runtime.update(1_000, 1_000);

    expect(fixture.runtime.snapshot()).toMatchObject({ delayedDecisions: 2, activeTasks: 1 });
    expect(
      fixture.runtime.listAgents().filter((agent) => agent.delayedDecisions === 1)
    ).toHaveLength(2);

    fixture.runtime.update(1_000, 2_000);
    fixture.runtime.update(1_000, 3_000);
    expect(
      new Set(
        fixture.runtime
          .traces()
          .filter((entry) => entry.label === "ai.goal_selected")
          .map((entry) => entry.agentId)
      )
    ).toEqual(new Set(["agent.a", "agent.b", "agent.c"]));
    expect(
      new Set(
        fixture.runtime
          .traces()
          .filter((entry) => entry.label === "ai.sensor_sampled")
          .map((entry) => entry.agentId)
      )
    ).toEqual(new Set(["agent.a", "agent.b", "agent.c"]));
  });

  it("uses scheduler priority to break equal due-time ties without bypassing older work", () => {
    const fixture = createFixture({
      maxDecisionsPerTick: 1,
      schedulerClasses: [
        { id: "low", priority: 1 },
        { id: "high", priority: 10 }
      ]
    });
    fixture.runtime.bind({ agentId: "agent.low", definitionId: "agent.low-priority" });
    fixture.runtime.bind({ agentId: "agent.high", definitionId: "agent.high-priority" });
    fixture.runtime.setBlackboard("agent.low", "attack", 1);
    fixture.runtime.setBlackboard("agent.high", "attack", 1);
    const checkpoint = fixture.runtime.captureCheckpoint();
    for (const agent of checkpoint.agents) {
      agent.nextDecisionAt = 1_000;
    }
    fixture.runtime.restoreCheckpoint(checkpoint);

    fixture.runtime.update(1_000, 1_000);
    expect(fixture.runtime.getAgent("agent.high")?.goalId).toBe("goal.attack");
    expect(fixture.runtime.getAgent("agent.low")?.goalId).toBeUndefined();

    const overdue = fixture.runtime.captureCheckpoint();
    const low = overdue.agents.find((agent) => agent.binding.agentId === "agent.low")!;
    const high = overdue.agents.find((agent) => agent.binding.agentId === "agent.high")!;
    low.nextDecisionAt = 1_100;
    high.nextDecisionAt = 1_200;
    fixture.runtime.restoreCheckpoint(overdue);
    fixture.runtime.update(200, 1_200);
    expect(fixture.runtime.getAgent("agent.low")?.goalId).toBe("goal.attack");
  });

  it("changes scheduler class at runtime without resetting due work and persists the class", () => {
    const fixture = createFixture({
      schedulerClasses: [
        {
          id: "far",
          decisionIntervalMultiplier: 5,
          sensorIntervalMultiplier: 5,
          priority: -1
        }
      ]
    });
    fixture.runtime.bind({ agentId: "agent.dynamic-lod", definitionId: "agent.standard" });
    const before = fixture.runtime.getAgent("agent.dynamic-lod")!;

    fixture.runtime.setSchedulerClass("agent.dynamic-lod", "far");

    const after = fixture.runtime.getAgent("agent.dynamic-lod")!;
    expect(after.schedulerClassId).toBe("far");
    expect(after.nextDecisionAt).toBeGreaterThanOrEqual(before.nextDecisionAt);
    const checkpoint = fixture.runtime.captureCheckpoint();
    expect(checkpoint.agents[0]?.schedulerClassId).toBe("far");

    fixture.runtime.restoreCheckpoint(checkpoint);
    expect(fixture.runtime.getAgent("agent.dynamic-lod")?.schedulerClassId).toBe("far");
    expect(
      fixture.runtime.traces().filter((entry) => entry.label === "ai.scheduler_class_changed")
    ).toHaveLength(1);
    fixture.dispose();
  });

  it("fails timed-out tasks and applies decision backoff", () => {
    const fixture = createFixture();
    fixture.runtime.bind({ agentId: "agent.timeout", definitionId: "agent.standard" });
    fixture.runtime.setBlackboard("agent.timeout", "attack", 1);
    fixture.runtime.update(1_000, 1_000);
    fixture.runtime.update(250, 1_250);

    expect(fixture.runtime.getAgent("agent.timeout")?.task).toBeUndefined();
    expect(fixture.runtime.getAgent("agent.timeout")?.nextDecisionAt).toBe(1_350);
    expect(fixture.runtime.traces()).toContainEqual(
      expect.objectContaining({
        label: "ai.task_failed",
        payload: expect.objectContaining({ reason: "timeout" })
      })
    );
  });

  it("preserves failure backoff when a task fails during start", () => {
    const fixture = createFixture({
      failureBackoffMs: 250,
      tasks: [
        {
          id: "task.attack",
          start() {
            return { status: "failed", reason: "ability-rejected" };
          },
          update() {
            return { status: "failed", reason: "unexpected-update" };
          }
        },
        fixtureTasks()[1]!
      ]
    });
    fixture.runtime.bind({ agentId: "agent.start-failure", definitionId: "agent.standard" });
    fixture.runtime.setBlackboard("agent.start-failure", "attack", 1);

    fixture.runtime.update(1_000, 1_000);

    expect(fixture.runtime.getAgent("agent.start-failure")?.nextDecisionAt).toBe(1_250);
  });

  it("preserves target, path, and ability failure reasons from task executors", () => {
    for (const reason of ["target-lost", "path-failed", "ability-rejected"]) {
      const fixture = createFixture({
        tasks: [
          {
            id: "task.attack",
            start() {
              return { status: "running", safeToInterrupt: true };
            },
            update() {
              return { status: "failed", reason };
            }
          },
          fixtureTasks()[1]!
        ]
      });
      const agentId = `agent.${reason}`;
      fixture.runtime.bind({ agentId, definitionId: "agent.standard" });
      fixture.runtime.setBlackboard(agentId, "attack", 1);
      fixture.runtime.update(1_000, 1_000);
      fixture.runtime.update(1, 1_001);
      expect(fixture.runtime.traces()).toContainEqual(
        expect.objectContaining({
          label: "ai.task_failed",
          agentId,
          payload: expect.objectContaining({ reason })
        })
      );
      fixture.dispose();
    }
  });

  it("captures and restores agents with entity, actor, and task-state remapping", () => {
    const fixture = createFixture();
    fixture.runtime.bind({
      agentId: "agent.saved",
      definitionId: "agent.standard",
      entityId: "entity.old",
      actorId: "actor.old"
    });
    fixture.runtime.setBlackboard("agent.saved", "attack", 1);
    fixture.runtime.observe("agent.saved", [fact("visible", 10)]);
    fixture.runtime.update(1_000, 1_000);
    const checkpoint = fixture.runtime.captureCheckpoint();
    checkpoint.agents[0]!.task!.state.routeId = "route.old";

    fixture.runtime.restoreCheckpoint(checkpoint, {
      resolveEntityId(entityId) {
        return entityId === "entity.old" ? "entity.new" : entityId;
      },
      resolveActorId(actorId) {
        return actorId === "actor.old" ? "actor.new" : actorId;
      },
      resolveTaskState(state) {
        return { ...state, routeId: "route.new" };
      }
    });

    expect(fixture.runtime.getAgent("agent.saved")).toMatchObject({
      binding: { entityId: "entity.new", actorId: "actor.new" },
      goalId: "goal.attack",
      task: { state: { updates: 0, routeId: "route.new" } },
      memorySize: 2,
      blackboardKeys: ["attack"]
    });
  });

  it("restarts decision safely when a saved task handle cannot be rebound", () => {
    const fixture = createFixture();
    fixture.runtime.bind({ agentId: "agent.rebind-missing", definitionId: "agent.standard" });
    fixture.runtime.setBlackboard("agent.rebind-missing", "attack", 1);
    fixture.runtime.update(1_000, 1_000);
    const checkpoint = fixture.runtime.captureCheckpoint();

    fixture.runtime.restoreCheckpoint(checkpoint, {
      resolveTaskState() {
        return undefined;
      }
    });

    expect(fixture.runtime.getAgent("agent.rebind-missing")).toMatchObject({
      nextDecisionAt: 1_000
    });
    expect(fixture.runtime.getAgent("agent.rebind-missing")?.goalId).toBeUndefined();
    expect(fixture.runtime.getAgent("agent.rebind-missing")?.task).toBeUndefined();
    fixture.dispose();
  });

  it("rejects malformed checkpoints before replacing live agents", () => {
    const fixture = createFixture();
    fixture.runtime.bind({ agentId: "agent.live", definitionId: "agent.standard" });
    fixture.runtime.setBlackboard("agent.live", "attack", 1);
    fixture.runtime.update(1_000, 1_000);
    const checkpoint = fixture.runtime.captureCheckpoint();
    checkpoint.agents.push(checkpoint.agents[0]!);

    expect(() => fixture.runtime.restoreCheckpoint(checkpoint)).toThrowError(
      expect.objectContaining({ code: "ai.invalid_config" })
    );
    expect(fixture.runtime.getAgent("agent.live")).toMatchObject({
      goalId: "goal.attack",
      task: { status: "running" }
    });
  });

  it("validates restored blackboards before cancelling live tasks", () => {
    let cancellations = 0;
    const fixture = createFixture({
      tasks: [
        {
          ...fixtureTasks()[0]!,
          cancel() {
            cancellations += 1;
          }
        },
        fixtureTasks()[1]!
      ]
    });
    fixture.runtime.bind({ agentId: "agent.atomic-restore", definitionId: "agent.standard" });
    fixture.runtime.setBlackboard("agent.atomic-restore", "attack", 1);
    fixture.runtime.update(1_000, 1_000);
    const checkpoint = fixture.runtime.captureCheckpoint();
    checkpoint.agents[0]!.blackboard.invalid = Number.NaN;

    expect(() => fixture.runtime.restoreCheckpoint(checkpoint)).toThrowError(
      expect.objectContaining({ code: "ai.blackboard_invalid_value" })
    );
    expect(cancellations).toBe(0);
    expect(fixture.runtime.getAgent("agent.atomic-restore")).toMatchObject({
      goalId: "goal.attack",
      task: { status: "running" }
    });
  });

  it("rejects bindings whose configured handlers are absent", () => {
    const runtime = createAiRuntime({
      dataRegistry: createRegistry(),
      world: createAiWorldReadModel(createMemoryWorld()),
      intentSink: { emit() {} },
      sensors: [],
      inputs: [],
      tasks: []
    });
    expect(() =>
      runtime.bind({ agentId: "agent.invalid", definitionId: "agent.standard" })
    ).toThrowError(expect.objectContaining({ code: "ai.definition_missing" }));
  });

  it("rejects definitions whose scheduler class is not registered", () => {
    const fixture = createFixture();

    expect(() =>
      fixture.runtime.bind({
        agentId: "agent.invalid-scheduler",
        definitionId: "agent.unknown-scheduler"
      })
    ).toThrowError(expect.objectContaining({ code: "ai.definition_missing" }));
  });

  it("compiles registry definitions once per agent definition outside the update path", () => {
    const registry = createRegistry();
    const originalGetValue = registry.getValue.bind(registry);
    let definitionReads = 0;
    registry.getValue = ((...args: Parameters<DataRegistry["getValue"]>) => {
      definitionReads += 1;
      return originalGetValue(...args);
    }) as DataRegistry["getValue"];
    const runtime = createAiRuntime({
      dataRegistry: registry,
      world: createAiWorldReadModel(createMemoryWorld()),
      intentSink: { emit() {} },
      sensors: fixtureSensors(),
      inputs: fixtureInputs(),
      tasks: fixtureTasks()
    });

    runtime.bind({ agentId: "agent.compiled.one", definitionId: "agent.standard" });
    const readsAfterFirstBind = definitionReads;
    runtime.bind({ agentId: "agent.compiled.two", definitionId: "agent.standard" });
    runtime.setBlackboard("agent.compiled.one", "attack", 1);
    runtime.setBlackboard("agent.compiled.two", "attack", 1);
    runtime.update(1_000, 1_000);
    runtime.update(100, 1_100);

    expect(readsAfterFirstBind).toBeGreaterThan(0);
    expect(definitionReads).toBe(readsAfterFirstBind);
    runtime.dispose();
    expect(runtime.snapshot()).toMatchObject({
      disposed: true,
      compiledDefinitions: 0,
      agents: []
    });
  });

  it("passes the reusable runtime conformance suite", () => {
    const report = runAiRuntimeConformance(() => {
      const fixture = createFixture();
      const binding = { agentId: "agent.conformance", definitionId: "agent.standard" };
      const originalBind = fixture.runtime.bind.bind(fixture.runtime);
      fixture.runtime.bind = (nextBinding) => {
        originalBind(nextBinding);
        fixture.runtime.setBlackboard(nextBinding.agentId, "attack", 1);
      };
      return { runtime: fixture.runtime, binding, dispose: fixture.dispose };
    });

    expect(report.checks).toHaveLength(8);
    expect(report.selectedGoalId).toBe("goal.attack");
  });

  it("provides an isolated memory runtime fixture from the testing entrypoint", () => {
    const fixture = createMemoryAiRuntimeFixture({
      dataRegistry: createRegistry(),
      sensors: fixtureSensors(),
      inputs: fixtureInputs(),
      tasks: fixtureTasks()
    });
    fixture.runtime.bind({ agentId: "agent.fixture", definitionId: "agent.standard" });
    fixture.runtime.setBlackboard("agent.fixture", "attack", 1);

    fixture.runtime.update(1_000, 1_000);

    expect(fixture.intents).toContainEqual(
      expect.objectContaining({ agentId: "agent.fixture", actionId: "attack" })
    );
    fixture.dispose();
  });
});

describe("AI module and save integration", () => {
  it("binds a handle, captures a save section, and invalidates on dispose", async () => {
    const handle = createAiHandle();
    const game = createGame({
      world: createMemoryWorld(),
      eventBus: createEventBus(),
      seed: "ai-module",
      modules: [
        createAiModule({
          dataRegistry: createRegistry(),
          handle,
          intentSink: { emit() {} },
          sensors: fixtureSensors(),
          inputs: fixtureInputs(),
          tasks: fixtureTasks()
        })
      ]
    });

    expect(handle.isBound()).toBe(true);
    handle.bind({
      agentId: "agent.handle",
      definitionId: "agent.standard",
      entityId: "entity.old"
    });
    const contributor = createAiSaveContributor({ handle });
    const section = await contributor.capture({ now: 0 });
    expect(section?.data.agents).toHaveLength(1);
    expect(contributor.validate?.(section!, {})).toEqual({ issues: [] });

    game.dispose();
    expect(handle.isBound()).toBe(false);
    expect(() => handle.hasAgent("agent.handle")).toThrowError(
      expect.objectContaining({ code: "ai.handle_unbound" })
    );
  });

  it("rejects save sections with duplicate agents", () => {
    const handle = createAiHandle();
    const fixture = createFixture();
    bindAiHandle(handle, fixture.runtime, "test");
    fixture.runtime.bind({ agentId: "duplicate", definitionId: "agent.standard" });
    const checkpoint = fixture.runtime.captureCheckpoint();
    checkpoint.agents.push(checkpoint.agents[0]!);
    const contributor = createAiSaveContributor({ handle });

    expect(contributor.validate?.({ id: "ai", version: "1", data: checkpoint }, {})).toEqual({
      issues: [expect.objectContaining({ code: "ai.save_invalid_agent_id" })]
    });
  });
});

function createFixture(
  options: {
    maxDecisionsPerTick?: number;
    maxSensorSamplesPerTick?: number;
    maxPathRequestsPerTick?: number;
    failureBackoffMs?: number;
    defaultBlackboardLimit?: number;
    maxBlackboardValueDepth?: number;
    onTrace?: (entry: AiTraceEntry) => void;
    onTraceError?: (error: unknown, entry: AiTraceEntry) => void;
    traceRetention?: AiTraceRetentionOptions;
    traceProduction?: AiTraceProductionOptions;
    navigation?: NavigationQueries;
    physics?: PhysicsQueries;
    sharedFacts?: AiSharedFactQueries;
    sensors?: AiSensorSampler[];
    tasks?: AiTaskExecutor[];
    schedulerClasses?: AiSchedulerClass[];
  } = {}
) {
  const intents: AiIntent[] = [];
  const runtime = createAiRuntime({
    dataRegistry: createRegistry(),
    world: createAiWorldReadModel(createMemoryWorld()),
    ...(options.navigation === undefined ? {} : { navigation: options.navigation }),
    ...(options.physics === undefined ? {} : { physics: options.physics }),
    ...(options.sharedFacts === undefined ? {} : { sharedFacts: options.sharedFacts }),
    intentSink: {
      emit(intent) {
        intents.push(intent);
      }
    },
    sensors: options.sensors ?? fixtureSensors(),
    inputs: fixtureInputs(),
    tasks: options.tasks ?? fixtureTasks(),
    ...(options.schedulerClasses === undefined
      ? {}
      : { schedulerClasses: options.schedulerClasses }),
    ...(options.maxDecisionsPerTick === undefined
      ? {}
      : { maxDecisionsPerTick: options.maxDecisionsPerTick }),
    ...(options.maxSensorSamplesPerTick === undefined
      ? {}
      : { maxSensorSamplesPerTick: options.maxSensorSamplesPerTick }),
    ...(options.maxPathRequestsPerTick === undefined
      ? {}
      : { maxPathRequestsPerTick: options.maxPathRequestsPerTick }),
    ...(options.defaultBlackboardLimit === undefined
      ? {}
      : { defaultBlackboardLimit: options.defaultBlackboardLimit }),
    ...(options.maxBlackboardValueDepth === undefined
      ? {}
      : { maxBlackboardValueDepth: options.maxBlackboardValueDepth }),
    ...(options.onTrace === undefined ? {} : { onTrace: options.onTrace }),
    ...(options.onTraceError === undefined ? {} : { onTraceError: options.onTraceError }),
    ...(options.traceRetention === undefined ? {} : { traceRetention: options.traceRetention }),
    ...(options.traceProduction === undefined ? {} : { traceProduction: options.traceProduction }),
    failureBackoffMs: options.failureBackoffMs ?? 100,
    traceLimit: 200
  });
  return { runtime, intents, dispose: () => runtime.dispose() };
}

function fixtureSensors() {
  return [
    {
      id: "sensor.fixture",
      sample(context: { elapsed: number }) {
        return [fact("sensor.sample", context.elapsed, context.elapsed + 500)];
      }
    }
  ];
}

function fixtureInputs() {
  return ["attack", "flee"].map((id) => ({
    id,
    read(context: { blackboard<T = unknown>(key: string): T | undefined }) {
      return context.blackboard<number>(id) ?? 0;
    }
  }));
}

function fixtureTasks(): AiTaskExecutor[] {
  return [
    {
      id: "task.attack",
      start(context) {
        context.emit({ type: "action", actionId: "attack" });
        return { status: "running", state: { updates: 0 }, safeToInterrupt: true };
      },
      update(context) {
        const updates = Number(context.state.updates ?? 0) + 1;
        return { status: "running", state: { updates }, safeToInterrupt: true };
      }
    },
    {
      id: "task.flee",
      start(context) {
        context.emit({ type: "movement", desiredVelocity: { x: -1, y: 0 } });
        return { status: "running", safeToInterrupt: true };
      },
      update() {
        return { status: "running", safeToInterrupt: true };
      }
    }
  ];
}

function createNavigationQueries(onRequest: () => void = () => {}): NavigationQueries {
  let sequence = 0;
  return {
    projectPoint() {
      return undefined;
    },
    requestPath() {
      onRequest();
      sequence += 1;
      return `request.${sequence}`;
    },
    poll(requestId) {
      return { status: "missing", requestId };
    },
    cancel() {},
    sampleRoute(routeId) {
      return { status: "missing", routeId, revision: 0 };
    },
    releaseRoute() {},
    revision() {
      return 0;
    },
    snapshot() {
      throw new Error("not used");
    }
  };
}

function createPhysicsQueries(): PhysicsQueries {
  const hit = { colliderId: "collider.fixture", point: { x: 1, y: 0 } };
  return {
    query() {
      return [hit];
    },
    queryPoint() {
      return [hit];
    },
    raycast() {
      return [hit];
    },
    shapeCast() {
      return [hit];
    },
    overlapShape() {
      return [hit];
    },
    checkOverlap() {
      return true;
    },
    checkCollision() {
      return true;
    },
    queryBounds() {
      return [hit];
    },
    snapshot() {
      throw new Error("not used");
    }
  };
}

function createRegistry(withPack = true): DataRegistry {
  const registry = createDataRegistry();
  for (const type of createAiDataTypes()) {
    registry.registerType(type);
  }
  if (withPack) {
    const validation = registry.registerPack(AI_PACK);
    if (validation.diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
      throw new Error(JSON.stringify(validation.diagnostics));
    }
  }
  return registry;
}

const AI_PACK: DataPack = {
  id: "ai.test",
  version: "1.0.0",
  entries: [
    {
      type: "ai.sensor",
      id: "sensor.visible",
      data: { id: "sensor.visible", sampler: "sensor.fixture", intervalMs: 100 }
    },
    {
      type: "ai.task",
      id: "task.attack",
      data: {
        id: "task.attack",
        executor: "task.attack",
        interruptPolicy: "always",
        timeoutMs: 200
      }
    },
    {
      type: "ai.task",
      id: "task.flee",
      data: { id: "task.flee", executor: "task.flee", interruptPolicy: "always" }
    },
    {
      type: "ai.task",
      id: "task.safe-point",
      data: { id: "task.safe-point", executor: "task.attack", interruptPolicy: "safe-point" }
    },
    {
      type: "ai.task",
      id: "task.never",
      data: { id: "task.never", executor: "task.attack", interruptPolicy: "never" }
    },
    {
      type: "ai.goal",
      id: "goal.attack",
      data: {
        id: "goal.attack",
        task: { type: "ai.task", id: "task.attack" },
        considerations: [{ input: "attack", curve: { type: "linear" } }],
        commitmentMs: 500,
        switchThreshold: 0.1
      }
    },
    {
      type: "ai.goal",
      id: "goal.flee",
      data: {
        id: "goal.flee",
        task: { type: "ai.task", id: "task.flee" },
        considerations: [{ input: "flee", curve: { type: "linear" } }]
      }
    },
    {
      type: "ai.goal",
      id: "goal.flee-strict",
      data: {
        id: "goal.flee-strict",
        task: { type: "ai.task", id: "task.flee" },
        considerations: [{ input: "flee", curve: { type: "linear" } }],
        minScore: 0.5
      }
    },
    {
      type: "ai.goal",
      id: "goal.safe-point",
      data: {
        id: "goal.safe-point",
        task: { type: "ai.task", id: "task.safe-point" },
        considerations: [{ input: "attack", curve: { type: "linear" } }],
        minScore: 0.5
      }
    },
    {
      type: "ai.goal",
      id: "goal.never",
      data: {
        id: "goal.never",
        task: { type: "ai.task", id: "task.never" },
        considerations: [{ input: "attack", curve: { type: "linear" } }],
        minScore: 0.5
      }
    },
    {
      type: "ai.agent",
      id: "agent.standard",
      data: {
        id: "agent.standard",
        sensors: [{ type: "ai.sensor", id: "sensor.visible" }],
        goals: [
          { type: "ai.goal", id: "goal.attack" },
          { type: "ai.goal", id: "goal.flee" }
        ],
        decisionIntervalMs: 100,
        memoryLimit: 8
      }
    },
    {
      type: "ai.agent",
      id: "agent.tiny-memory",
      data: {
        id: "agent.tiny-memory",
        sensors: [],
        goals: [{ type: "ai.goal", id: "goal.attack" }],
        decisionIntervalMs: 100,
        memoryLimit: 2
      }
    },
    {
      type: "ai.agent",
      id: "agent.safe-point",
      data: {
        id: "agent.safe-point",
        sensors: [],
        goals: [
          { type: "ai.goal", id: "goal.safe-point" },
          { type: "ai.goal", id: "goal.flee-strict" }
        ],
        decisionIntervalMs: 100,
        memoryLimit: 2
      }
    },
    {
      type: "ai.agent",
      id: "agent.never",
      data: {
        id: "agent.never",
        sensors: [],
        goals: [
          { type: "ai.goal", id: "goal.never" },
          { type: "ai.goal", id: "goal.flee-strict" }
        ],
        decisionIntervalMs: 100,
        memoryLimit: 2
      }
    },
    {
      type: "ai.agent",
      id: "agent.low-priority",
      data: {
        id: "agent.low-priority",
        sensors: [],
        goals: [{ type: "ai.goal", id: "goal.attack" }],
        decisionIntervalMs: 100,
        memoryLimit: 2,
        schedulerClass: "low"
      }
    },
    {
      type: "ai.agent",
      id: "agent.high-priority",
      data: {
        id: "agent.high-priority",
        sensors: [],
        goals: [{ type: "ai.goal", id: "goal.attack" }],
        decisionIntervalMs: 100,
        memoryLimit: 2,
        schedulerClass: "high"
      }
    },
    {
      type: "ai.agent",
      id: "agent.unknown-scheduler",
      data: {
        id: "agent.unknown-scheduler",
        sensors: [],
        goals: [],
        decisionIntervalMs: 100,
        memoryLimit: 2,
        schedulerClass: "missing"
      }
    }
  ]
};

function fact(key: string, observedAt: number, expiresAt?: number): AiPerceptionFact {
  return { key, observedAt, ...(expiresAt === undefined ? {} : { expiresAt }) };
}

function createMemoryWorld(): GameWorld {
  const componentData = new Map<EntityId, Map<string, unknown>>();
  let nextId = 0;
  const requireEntity = (entity: EntityId) => {
    const components = componentData.get(entity);
    if (components === undefined) {
      throw new Error(`Missing entity: ${String(entity)}`);
    }
    return components;
  };
  return {
    spawn() {
      const entity = `entity-${nextId}`;
      nextId += 1;
      componentData.set(entity, new Map());
      return entity;
    },
    despawn(entity) {
      componentData.delete(entity);
    },
    has(entity) {
      return componentData.has(entity);
    },
    add(entity, component, data) {
      requireEntity(entity).set(component.id, component.create(data));
    },
    get(entity, component) {
      return requireEntity(entity).get(component.id) as any;
    },
    set(entity, component, data) {
      const components = requireEntity(entity);
      const current = components.get(component.id) ?? component.create();
      components.set(component.id, { ...(current as object), ...data });
    },
    remove(entity, component) {
      requireEntity(entity).delete(component.id);
    },
    query(components: Array<ComponentDef<any>> = []) {
      return [...componentData.entries()]
        .filter(([, values]) => components.every((component) => values.has(component.id)))
        .map(([entity]) => entity);
    },
    count() {
      return componentData.size;
    }
  };
}
