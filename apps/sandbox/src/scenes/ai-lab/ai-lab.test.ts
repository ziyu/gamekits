import type { AiAgentDefinition, AiTaskDefinition } from "@gamekits/ai-core";
import { createMemoryAiRuntimeFixture, createMemoryAiWorld } from "@gamekits/ai-core/testing";
import { createNavigationRuntime, type NavigationRuntime } from "@gamekits/navigation-core";
import {
  checkCollision,
  checkOverlap,
  createMemoryPhysicsBackend,
  overlapShape,
  queryBounds,
  queryPoint,
  raycast,
  shapeCast,
  type PhysicsQueries,
  type PhysicsScene
} from "@gamekits/physics-core";
import { describe, expect, it } from "vitest";
import {
  AI_LAB_SCHEDULER_CLASSES,
  createAiLabInputs,
  createAiLabSensors,
  createAiLabTasks
} from "./behaviors";
import {
  AI_LAB_NAVIGATION_PROFILE,
  createAiLabNavigationBackend,
  createAiLabSharedFacts
} from "./capabilities";
import {
  AI_LAB_AGENT_PREFIX,
  AI_LAB_GOAL_IDS,
  aiLabAgentDefinitionId,
  createAiLabDataRegistry
} from "./content";
import {
  AI_LAB_ANIMAL_BLUEPRINTS,
  AI_LAB_OBSTACLE_BLUEPRINTS,
  AiLabCreature,
  AiLabPosition,
  AiLabResource
} from "./ecosystem";
import { createAiLabController, createAiLabState, type AiLabController } from "./runtime";
import { AI_LAB_AI_RUNTIME_LIMITS, AI_LAB_NAVIGATION_RUNTIME_LIMITS } from "./runtime-limits";
import { AI_LAB_TRACE_PRODUCTION, AI_LAB_TRACE_RETENTION } from "./trace-config";

const navigationByRuntime = new WeakMap<
  ReturnType<typeof createMemoryAiRuntimeFixture>["runtime"],
  NavigationRuntime
>();

describe("AI Lab ecosystem", () => {
  it("registers one survival agent definition per species", () => {
    const registry = createAiLabDataRegistry();

    expect(registry.getValue<AiTaskDefinition>("ai.task", "ai-lab.task.rest").interruptPolicy).toBe(
      "safe-point"
    );
    expect(
      registry.getValue<AiAgentDefinition>("ai.agent", aiLabAgentDefinitionId("rabbit")).goals
    ).toHaveLength(Object.keys(AI_LAB_GOAL_IDS).length);
    expect(
      registry.getValue<AiAgentDefinition>("ai.agent", aiLabAgentDefinitionId("hedgehog"))
        .schedulerClass
    ).toBe("steady");
  });

  it("binds every visible animal as a real AI agent", () => {
    const lab = createFixture();
    lab.controller.start();
    tick(lab.controller, lab.fixture.runtime, 8);
    const snapshot = lab.controller.snapshot();

    expect(snapshot.animals).toHaveLength(AI_LAB_ANIMAL_BLUEPRINTS.length);
    expect(snapshot.resources).toHaveLength(10);
    expect(snapshot.runtime.agents).toHaveLength(AI_LAB_ANIMAL_BLUEPRINTS.length);
    expect(snapshot.animals.every((animal) => animal.goalId !== undefined)).toBe(true);
    expect(snapshot.animals.every((animal) => animal.agentId.endsWith(animal.id))).toBe(true);
    lab.dispose();
  });

  it("moves animals toward resources and resolves survival interactions", () => {
    const lab = createFixture();
    lab.controller.start();
    const initial = lab.controller.snapshot();
    tick(lab.controller, lab.fixture.runtime, 180);
    const settled = lab.controller.snapshot();

    const movedAnimals = settled.animals.filter((animal) => {
      const before = initial.animals.find((candidate) => candidate.id === animal.id);
      return before && Math.hypot(animal.x - before.x, animal.y - before.y) > 2;
    });
    const interactions = lab.fixture.intents.filter((intent) => intent.type === "interaction");

    expect(movedAnimals.length).toBeGreaterThan(8);
    expect(
      interactions.some((intent) => intent.type === "interaction" && intent.interactionId === "eat")
    ).toBe(true);
    expect(
      interactions.some(
        (intent) => intent.type === "interaction" && intent.interactionId === "drink"
      )
    ).toBe(true);
    expect(
      interactions.some(
        (intent) => intent.type === "interaction" && intent.interactionId === "rest"
      )
    ).toBe(true);
    expect(settled.events.some((event) => event.tone === "good")).toBe(true);
    expect(settled.runtime.delayedDecisions).toBe(0);
    lab.dispose();
  });

  it("temporarily avoids a depleted resource before retrying the same need", () => {
    const lab = createFixture();
    lab.controller.start();
    const pineconeEntity = lab.state.animalEntityById.get("pinecone")!;
    const springEntity = lab.state.resourceEntityById.get("spring-east")!;
    lab.state.world.set(pineconeEntity, AiLabCreature, {
      hunger: 0.05,
      thirst: 0.95,
      energy: 1
    });
    lab.state.world.set(pineconeEntity, AiLabPosition, { x: 75, y: 40 });
    lab.state.world.set(springEntity, AiLabResource, { amount: 4 });

    for (let index = 0; index < 30; index += 1) {
      tick(lab.controller, lab.fixture.runtime, 1);
      if (
        lab.fixture.runtime.getAgent(`${AI_LAB_AGENT_PREFIX}pinecone`)?.task?.state.targetId ===
        "spring-east"
      ) {
        break;
      }
    }
    expect(
      lab.fixture.runtime.getAgent(`${AI_LAB_AGENT_PREFIX}pinecone`)?.task?.state.targetId
    ).toBe("spring-east");

    lab.state.world.set(springEntity, AiLabResource, { amount: 0 });
    tick(lab.controller, lab.fixture.runtime, 6);
    const pineconeCheckpoint = lab.fixture.runtime
      .captureCheckpoint()
      .agents.find((agent) => agent.binding.agentId === `${AI_LAB_AGENT_PREFIX}pinecone`);
    expect(pineconeCheckpoint?.blackboard.resourceRetryBlock).toMatchObject({
      targetId: "spring-east"
    });

    lab.state.world.set(springEntity, AiLabResource, { amount: 24 });
    for (let index = 0; index < 30; index += 1) {
      tick(lab.controller, lab.fixture.runtime, 1);
      if (
        lab.fixture.runtime.getAgent(`${AI_LAB_AGENT_PREFIX}pinecone`)?.task?.state.targetId ===
        "pond-west"
      ) {
        break;
      }
    }
    expect(
      lab.fixture.runtime.getAgent(`${AI_LAB_AGENT_PREFIX}pinecone`)?.task?.state.targetId
    ).toBe("pond-west");
    lab.dispose();
  });

  it("keeps every behavior observable through staged execution", () => {
    const lab = createFixture();
    lab.controller.start();
    const phases = new Map<string, Set<string>>([
      ["chestnut", new Set()],
      ["dandelion", new Set()],
      ["moss", new Set()],
      ["sesame", new Set()]
    ]);

    for (let index = 0; index < 280; index += 1) {
      tick(lab.controller, lab.fixture.runtime, 1);
      for (const [animalId, seen] of phases) {
        const phase = lab.fixture.runtime.getAgent(`${AI_LAB_AGENT_PREFIX}${animalId}`)?.task?.state
          .phase;
        if (typeof phase === "string") {
          seen.add(phase);
        }
      }
    }

    expect(Object.fromEntries([...phases].map(([id, seen]) => [id, [...seen]]))).toEqual({
      chestnut: expect.arrayContaining(["orient", "travel", "prepare", "interact", "settle"]),
      dandelion: expect.arrayContaining(["orient", "travel", "prepare", "interact", "settle"]),
      moss: expect.arrayContaining(["orient", "travel", "prepare", "interact", "settle"]),
      sesame: expect.arrayContaining(["orient", "explore", "observe"])
    });
    lab.dispose();
  });

  it("exports the selected animal's bounded ten-second behavior history", () => {
    const lab = createFixture();
    lab.controller.start();
    tick(lab.controller, lab.fixture.runtime, 240);
    const selectedAt = lab.controller.snapshot().elapsed;

    lab.controller.selectAnimal("moss");
    const log = lab.controller.exportSelectedBehaviorLog();

    expect(log).toMatchObject({
      schema: "gamekits.sandbox.ai-lab.behavior-log",
      version: 1,
      sceneId: "ai-lab",
      exportedAt: selectedAt,
      window: { start: selectedAt - 10_000, end: selectedAt, durationMs: 10_000 },
      animal: { id: "moss", agentId: `${AI_LAB_AGENT_PREFIX}moss`, name: "青苔" }
    });
    expect(log?.samples.length).toBeGreaterThan(40);
    expect(log?.samples[0]?.timestamp).toBeLessThan(selectedAt - 9_000);
    expect(new Set(log?.samples.map((sample) => sample.behaviorPhase)).size).toBeGreaterThan(2);
    expect(log?.intents.length).toBeGreaterThan(20);
    expect(log?.intents.every((entry) => entry.intent.agentId.endsWith("moss"))).toBe(true);
    expect(log?.traces.every((entry) => entry.agentId?.endsWith("moss"))).toBe(true);
    expect(log?.traces.some((entry) => entry.kind === "task")).toBe(true);
    expect(log?.traces.every((entry) => entry.kind !== "intent")).toBe(true);
    expect(lab.fixture.runtime.traces().length).toBeLessThanOrEqual(AI_LAB_TRACE_RETENTION.limit);
    expect(
      lab.fixture.runtime.traces().some((entry) => entry.timestamp <= selectedAt - 8_000)
    ).toBe(true);
    expect(
      lab.fixture.runtime.traces().filter((entry) => entry.kind === "decision").length
    ).toBeLessThanOrEqual(AI_LAB_TRACE_RETENTION.kindLimits.decision);
    expect(log?.current.memory.length).toBeGreaterThan(3);
    expect(JSON.stringify(log).length).toBeLessThan(1_000_000);
    lab.dispose();
  });

  it("lets nature interventions replenish visible resources", () => {
    const lab = createFixture();
    lab.controller.start();
    tick(lab.controller, lab.fixture.runtime, 80);
    const depleted = lab.controller.snapshot();

    lab.controller.scatterFood();
    const fed = lab.controller.snapshot();
    lab.controller.makeRain();
    const rained = lab.controller.snapshot();

    expect(fed.foodRemaining).toBeGreaterThanOrEqual(depleted.foodRemaining);
    expect(rained.waterRemaining).toBeGreaterThanOrEqual(fed.waterRemaining);
    expect(rained.events[0]?.message).toContain("春雨");
    lab.dispose();
  });

  it("projects selected-animal reasoning and supports deterministic stepping", () => {
    const lab = createFixture();
    lab.controller.start();
    lab.controller.selectAnimal("thistle");
    tick(lab.controller, lab.fixture.runtime, 20);
    const selected = lab.controller.snapshot();

    expect(selected.selected).toMatchObject({ id: "thistle", name: "蓟蓟" });
    expect(selected.goals).toHaveLength(5);
    expect(selected.memory.length).toBeGreaterThan(3);

    lab.controller.togglePaused();
    const beforeStep = lab.controller.snapshot().elapsed;
    lab.controller.step();
    tick(lab.controller, lab.fixture.runtime, 1);
    expect(lab.controller.snapshot()).toMatchObject({ paused: true, elapsed: beforeStep + 250 });
    lab.dispose();
  });

  it("promotes the observed animal and turns a shared alert into visible hiding", () => {
    const lab = createFixture();
    lab.controller.start();
    lab.controller.selectAnimal("sesame");
    tick(lab.controller, lab.fixture.runtime, 20);

    const before = lab.controller.snapshot();
    const beforeWander = before.goals.find((goal) => goal.goalId === AI_LAB_GOAL_IDS.wander);
    const chestnut = before.animals.find((animal) => animal.id === "chestnut");
    expect(before.capabilities.scheduler.classId).toBe("nimble");
    expect(chestnut?.schedulerClassId).toBe("steady");
    expect(before.capabilities.sharedFacts).toMatchObject({ alert: false, factCount: 1 });

    lab.controller.toggleForestAlert();
    tick(lab.controller, lab.fixture.runtime, 32);
    const after = lab.controller.snapshot();
    const afterWander = after.goals.find((goal) => goal.goalId === AI_LAB_GOAL_IDS.wander);
    const hideGoal = after.goals.find((goal) => goal.goalId === AI_LAB_GOAL_IDS.hide);

    expect(after.capabilities.scheduler.classId).toBe("nimble");
    expect(after.capabilities.sharedFacts.alert).toBe(true);
    expect(after.forestAlert).toBe(true);
    expect(afterWander?.score).toBeLessThan(beforeWander?.score ?? 1);
    expect(hideGoal?.eligible).toBe(true);
    expect(after.animals.filter((animal) => animal.activity === "hide").length).toBeGreaterThan(8);
    expect(after.memory).toEqual(
      expect.arrayContaining([expect.objectContaining({ key: "shared.forest-alert", value: true })])
    );
    lab.dispose();
  });

  it("uses physics queries and navigation routes through AI task context", () => {
    const lab = createFixture();
    lab.controller.start();
    lab.controller.selectAnimal("chestnut");
    const chestnutEntity = lab.state.animalEntityById.get("chestnut")!;
    lab.state.world.set(chestnutEntity, AiLabCreature, { hunger: 0.98, thirst: 0.1, energy: 1 });
    lab.state.world.set(chestnutEntity, AiLabPosition, { x: 25, y: 24 });
    const westLog = AI_LAB_OBSTACLE_BLUEPRINTS.find(
      (obstacle) => obstacle.id === "west-fallen-log"
    )!;
    const blockedPositions: Array<{ x: number; y: number }> = [];
    for (let index = 0; index < 40; index += 1) {
      tick(lab.controller, lab.fixture.runtime, 1);
      const animal = lab.controller.snapshot().selected;
      if (animal) blockedPositions.push({ x: animal.x, y: animal.y });
      if (lab.controller.snapshot().selected?.routeMode === "detour") break;
    }

    const blocked = lab.controller.snapshot();
    expect(blocked.capabilities.physics).toMatchObject({
      available: true,
      colliderCount: AI_LAB_OBSTACLE_BLUEPRINTS.length,
      barrierEnabled: true,
      selectedPathClear: false,
      selectedBlockerId: "sandbox.ai-lab.collider.west-fallen-log"
    });
    expect(blocked.capabilities.navigation.available).toBe(true);
    expect(blocked.capabilities.navigation.revision).toBe(0);
    expect(blocked.selected).toMatchObject({ routeMode: "detour" });
    expect(blocked.selected?.routePoints.length).toBeGreaterThan(2);
    expect(routeIntersectsObstacle(blocked.selected?.routePoints ?? [], westLog, 1.2)).toBe(false);
    expect(blockedPositions.every((point) => !pointOverlapsObstacle(point, westLog, 1.2))).toBe(
      true
    );
    const blockedDistance = routeDistance(blocked.selected?.routePoints ?? []);

    lab.controller.toggleProbeBarrier();
    for (let index = 0; index < 12; index += 1) {
      tick(lab.controller, lab.fixture.runtime, 1);
      if (lab.controller.snapshot().selected?.routeMode === "direct") break;
    }
    const clear = lab.controller.snapshot();
    expect(clear.capabilities.physics).toMatchObject({
      barrierEnabled: false
    });
    expect(clear.capabilities.navigation.revision).toBe(1);
    expect(clear.selected).toMatchObject({ routeMode: "direct" });
    expect(clear.selected?.routePoints.length).toBeGreaterThan(2);
    expect(routeIntersectsObstacle(clear.selected?.routePoints ?? [], westLog, 1.2)).toBe(true);
    expect(routeDistance(clear.selected?.routePoints ?? [])).toBeLessThan(blockedDistance);
    lab.dispose();
  });

  it("surfaces AI path and trace production budgets under controlled pressure", () => {
    const lab = createFixture();
    lab.controller.start();
    tick(lab.controller, lab.fixture.runtime, 24);
    const before = lab.controller.snapshot().capabilities;

    lab.controller.stressBudgets();
    tick(lab.controller, lab.fixture.runtime, 1);
    const after = lab.controller.snapshot().capabilities;
    const visible = lab.controller.snapshot();

    expect(after.navigation.rejectedPathRequests).toBeGreaterThan(
      before.navigation.rejectedPathRequests
    );
    expect(after.trace.droppedEntries).toBeGreaterThan(before.trace.droppedEntries);
    expect(visible.routeSurgeActive).toBe(true);
    expect(visible.animals.some((animal) => animal.routeMode === "planning")).toBe(true);
    expect(lab.fixture.runtime.traces().some((entry) => entry.label === "ai.trace_dropped")).toBe(
      true
    );
    lab.dispose();
  });

  it("runs capacity probes with real agents and removes every stress animal on stop", () => {
    const lab = createFixture();
    lab.controller.start();
    lab.controller.setStressMaxAnimals(32);
    lab.controller.startStressTest();

    const running = lab.controller.snapshot();
    expect(running.stress).toMatchObject({
      status: "warming",
      configuredMaxAnimals: 32,
      activeAnimals: 32,
      testingAnimals: 32,
      stableAnimals: AI_LAB_ANIMAL_BLUEPRINTS.length
    });
    expect(running.population).toBe(32);
    expect(running.runtime.agents).toHaveLength(32);
    const stressAgents = running.runtime.agents.filter((agent) =>
      agent.binding.agentId.includes("stress-")
    );
    expect(stressAgents).toHaveLength(16);
    expect(stressAgents.every((agent) => agent.schedulerClassId === "background")).toBe(true);

    tick(lab.controller, lab.fixture.runtime, 20);
    const active = lab.controller.snapshot();
    const visibleStressAnimals = active.animals.filter((animal) => animal.id.startsWith("stress-"));
    expect(visibleStressAnimals.some((animal) => animal.goalId !== undefined)).toBe(true);
    expect(visibleStressAnimals.some((animal) => animal.routePoints.length === 2)).toBe(true);
    expect(active.capabilities.navigation.rejectedPathRequests).toBe(0);

    lab.controller.stopStressTest();
    const stopped = lab.controller.snapshot();
    expect(stopped.stress).toMatchObject({
      status: "stopped",
      activeAnimals: AI_LAB_ANIMAL_BLUEPRINTS.length
    });
    expect(stopped.population).toBe(AI_LAB_ANIMAL_BLUEPRINTS.length);
    expect(stopped.runtime.agents).toHaveLength(AI_LAB_ANIMAL_BLUEPRINTS.length);
    expect(stopped.runtime.agents.some((agent) => agent.binding.agentId.includes("stress-"))).toBe(
      false
    );
    lab.dispose();
  });

  it("restores checkpoints through entity, actor, and task-state resolvers", () => {
    const lab = createFixture();
    lab.controller.start();
    tick(lab.controller, lab.fixture.runtime, 32);
    lab.controller.saveCheckpoint();
    const captured = lab.controller.snapshot();
    expect(captured.capabilities.checkpoint.capturedAt).toBe(captured.elapsed);
    const capturedChestnut = captured.animals.find((animal) => animal.id === "chestnut")!;

    const chestnutEntity = lab.state.animalEntityById.get("chestnut")!;
    lab.state.world.set(chestnutEntity, AiLabPosition, { x: 91, y: 91 });

    lab.controller.setSelectedSchedulerClass("steady");
    expect(lab.controller.snapshot().capabilities.scheduler.classId).toBe("steady");
    lab.controller.restoreCheckpoint();
    const restored = lab.controller.snapshot();

    expect(restored.capabilities.scheduler.classId).toBe("nimble");
    expect(restored.animals.find((animal) => animal.id === "chestnut")).toMatchObject({
      x: capturedChestnut.x,
      y: capturedChestnut.y
    });
    expect(restored.checkpointEchoes).toHaveLength(AI_LAB_ANIMAL_BLUEPRINTS.length);
    expect(restored.rewindActive).toBe(true);
    expect(restored.capabilities.checkpoint).toMatchObject({
      restoreCount: 1,
      resolvedEntities: AI_LAB_ANIMAL_BLUEPRINTS.length,
      resolvedActors: AI_LAB_ANIMAL_BLUEPRINTS.length
    });
    expect(restored.capabilities.checkpoint.resolvedTaskStates).toBeGreaterThan(0);
    expect(
      lab.fixture.runtime.traces().some((entry) => entry.label === "ai.checkpoint_restored")
    ).toBe(true);
    lab.dispose();
  });
});

function createFixture() {
  const world = createMemoryAiWorld();
  const state = createAiLabState(world);
  const sharedFacts = createAiLabSharedFacts();
  const navigation = createNavigationRuntime({
    id: "sandbox.ai-lab.test.navigation",
    backend: createAiLabNavigationBackend(),
    profiles: [{ ...AI_LAB_NAVIGATION_PROFILE, tags: [...AI_LAB_NAVIGATION_PROFILE.tags] }],
    ...AI_LAB_NAVIGATION_RUNTIME_LIMITS,
    traceLimit: 180
  });
  const physicsScene = createAiLabPhysicsScene();
  const physics = physicsQueries(physicsScene);
  const fixture = createMemoryAiRuntimeFixture({
    id: "sandbox.ai-lab.test",
    world,
    dataRegistry: createAiLabDataRegistry(),
    sensors: createAiLabSensors(),
    inputs: createAiLabInputs(),
    tasks: createAiLabTasks(),
    schedulerClasses: AI_LAB_SCHEDULER_CLASSES,
    ...AI_LAB_AI_RUNTIME_LIMITS,
    navigation,
    physics,
    sharedFacts,
    traceProduction: AI_LAB_TRACE_PRODUCTION,
    traceRetention: AI_LAB_TRACE_RETENTION,
    onIntent(intent) {
      state.retainIntent(intent);
    }
  });
  navigationByRuntime.set(fixture.runtime, navigation);
  const controller = createAiLabController({
    ai: fixture.runtime,
    state,
    navigation,
    physics,
    sharedFacts,
    setObstacleEnabled(obstacleId, enabled) {
      physicsScene.updateCollider(`sandbox.ai-lab.collider.${obstacleId}`, { enabled });
    }
  });
  return {
    state,
    fixture,
    controller,
    dispose() {
      controller.dispose();
      fixture.dispose();
      navigation.dispose();
      physicsScene.dispose();
    }
  };
}

function createAiLabPhysicsScene(): PhysicsScene {
  const scene = createMemoryPhysicsBackend({ id: "sandbox.ai-lab.test.physics" }).createScene({
    id: "sandbox.ai-lab.test.physics-scene",
    dimension: "2d",
    gravity: { x: 0, y: 0 }
  });
  for (const obstacle of AI_LAB_OBSTACLE_BLUEPRINTS) {
    const bodyId = scene.createBody({
      id: `sandbox.ai-lab.body.${obstacle.id}`,
      kind: "static",
      position: { x: obstacle.x, y: obstacle.y },
      userData: { obstacleId: obstacle.id }
    });
    scene.createCollider({
      id: `sandbox.ai-lab.collider.${obstacle.id}`,
      bodyId,
      shape: { type: "box", width: obstacle.width, height: obstacle.height },
      filter: { groups: ["terrain"], collidesWith: ["sensor"] },
      userData: { obstacleId: obstacle.id }
    });
  }
  return scene;
}

function physicsQueries(scene: PhysicsScene): PhysicsQueries {
  return {
    query: (query) => scene.query(query),
    queryPoint: (point, options) => queryPoint(scene, point, options),
    raycast: (origin, direction, options) => raycast(scene, origin, direction, options),
    shapeCast: (shape, position, direction, options) =>
      shapeCast(scene, shape, position, direction, options),
    overlapShape: (shape, position, options) => overlapShape(scene, shape, position, options),
    checkOverlap: (shape, position, options) => checkOverlap(scene, shape, position, options),
    checkCollision: (colliderId, options) => checkCollision(scene, colliderId, options),
    queryBounds: (bounds, options) => queryBounds(scene, bounds, options),
    snapshot: () => scene.snapshot()
  };
}

function tick(
  controller: AiLabController,
  runtime: ReturnType<typeof createMemoryAiRuntimeFixture>["runtime"],
  steps: number
): void {
  for (let index = 0; index < steps; index += 1) {
    const step = controller.advance(50);
    if (step) {
      navigationByRuntime.get(runtime)?.update(step.deltaMs, step.elapsedMs);
      runtime.update(step.deltaMs, step.elapsedMs);
      controller.afterTick(step.deltaMs);
    }
  }
}

function routeDistance(points: ReadonlyArray<{ x: number; y: number }>): number {
  let total = 0;
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1]!;
    const point = points[index]!;
    total += Math.hypot(point.x - previous.x, point.y - previous.y);
  }
  return total;
}

function routeIntersectsObstacle(
  points: ReadonlyArray<{ x: number; y: number }>,
  obstacle: (typeof AI_LAB_OBSTACLE_BLUEPRINTS)[number],
  radius: number
): boolean {
  for (let index = 1; index < points.length; index += 1) {
    if (segmentIntersectsObstacle(points[index - 1]!, points[index]!, obstacle, radius)) {
      return true;
    }
  }
  return false;
}

function pointOverlapsObstacle(
  point: { x: number; y: number },
  obstacle: (typeof AI_LAB_OBSTACLE_BLUEPRINTS)[number],
  radius: number
): boolean {
  return (
    Math.abs(point.x - obstacle.x) <= obstacle.width / 2 + radius &&
    Math.abs(point.y - obstacle.y) <= obstacle.height / 2 + radius
  );
}

function segmentIntersectsObstacle(
  start: { x: number; y: number },
  end: { x: number; y: number },
  obstacle: (typeof AI_LAB_OBSTACLE_BLUEPRINTS)[number],
  radius: number
): boolean {
  const minimumX = obstacle.x - obstacle.width / 2 - radius;
  const maximumX = obstacle.x + obstacle.width / 2 + radius;
  const minimumY = obstacle.y - obstacle.height / 2 - radius;
  const maximumY = obstacle.y + obstacle.height / 2 + radius;
  const deltaX = end.x - start.x;
  const deltaY = end.y - start.y;
  let minimumTime = 0;
  let maximumTime = 1;
  for (const [direction, distance] of [
    [-deltaX, start.x - minimumX],
    [deltaX, maximumX - start.x],
    [-deltaY, start.y - minimumY],
    [deltaY, maximumY - start.y]
  ] as const) {
    if (direction === 0) {
      if (distance < 0) return false;
      continue;
    }
    const time = distance / direction;
    if (direction < 0) {
      minimumTime = Math.max(minimumTime, time);
    } else {
      maximumTime = Math.min(maximumTime, time);
    }
    if (minimumTime > maximumTime) return false;
  }
  return true;
}
