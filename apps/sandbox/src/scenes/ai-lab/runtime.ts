import type {
  AiAgentCheckpoint,
  AiAgentSnapshot,
  AiGoalScore,
  AiHandle,
  AiIntent,
  AiRuntimeCheckpoint
} from "@gamekits/ai-core";
import type { NavigationHandle, NavigationQueries } from "@gamekits/navigation-core";
import {
  PhysicsBodyComponent,
  PhysicsColliderComponent,
  PhysicsTransformComponent,
  type PhysicsQueries
} from "@gamekits/physics-core";
import type { EntityId, GameWorld } from "@gamekits/world";
import { AI_LAB_NAVIGATION_PROFILE, type AiLabSharedFacts } from "./capabilities";
import { AI_LAB_AGENT_PREFIX, aiLabAgentDefinitionId } from "./content";
import {
  AI_LAB_ANIMAL_BLUEPRINTS,
  AI_LAB_OBSTACLE_BLUEPRINTS,
  AI_LAB_RESOURCE_BLUEPRINTS,
  AiLabCreature,
  AiLabObstacle,
  AiLabPosition,
  AiLabResource,
  type AiLabCreatureState,
  type AiLabObstacleState,
  type AiLabPositionState,
  type AiLabResourceState,
  creatureMetabolism,
  creatureSpeed
} from "./ecosystem";
import { createAiLabStressTest } from "./stress-test";
import { AI_LAB_AI_RUNTIME_LIMITS } from "./runtime-limits";
import { AI_LAB_TRACE_PRODUCTION } from "./trace-config";
import type {
  AiLabActivity,
  AiLabAnimalView,
  AiLabBehaviorLogExport,
  AiLabBehaviorPhase,
  AiLabBehaviorSample,
  AiLabEvent,
  AiLabGoalView,
  AiLabIntentRecord,
  AiLabRouteMode,
  AiLabRoutePoint,
  AiLabResourceView,
  AiLabSnapshot
} from "./types";

const TELEMETRY_INTERVAL_MS = 240;
const BEHAVIOR_LOG_WINDOW_MS = 10_000;
const BEHAVIOR_SAMPLE_INTERVAL_MS = 200;
const INTENT_LOG_INTERVAL_MS = 100;
const MAX_EVENTS = 18;
const DAY_DURATION_MS = 60_000;
const MAX_RENDERED_ANIMALS = 72;

type AiLabAiPort = Pick<
  AiHandle,
  | "bind"
  | "unbind"
  | "getAgent"
  | "listAgents"
  | "scoreGoals"
  | "snapshot"
  | "traces"
  | "captureCheckpoint"
  | "restoreCheckpoint"
  | "setBlackboard"
  | "setSchedulerClass"
>;

type AiLabNavigationPort = NavigationQueries & Pick<NavigationHandle, "updateObstacle">;

export type AiLabRuntimeState = {
  world: GameWorld;
  elapsed: number;
  pendingIntents: AiIntent[];
  animalEntityById: Map<string, EntityId>;
  animalEntityByAgentId: Map<string, EntityId>;
  resourceEntityById: Map<string, EntityId>;
  obstacleEntityById: Map<string, EntityId>;
  lastGoalByAgentId: Map<string, string>;
  lastInteractionEventAt: Map<string, number>;
  behaviorSamplesByAgentId: Map<string, AiLabBehaviorSample[]>;
  intentHistory: AiLabIntentRecord[];
  lastIntentLogAt: Map<string, number>;
  events: AiLabEvent[];
  eventSequence: number;
  retainIntent(intent: AiIntent): void;
};

export type AiLabFrameStep = {
  deltaMs: number;
  elapsedMs: number;
};

type AiLabSceneCheckpoint = {
  ai: AiRuntimeCheckpoint;
  alert: boolean;
  animals: Array<{
    id: string;
    creature: AiLabCreatureState;
    position: AiLabPositionState;
  }>;
  resources: Array<{
    id: string;
    resource: AiLabResourceState;
  }>;
  obstacles: Array<{
    id: string;
    obstacle: AiLabObstacleState;
  }>;
};

export type AiLabController = {
  start(): void;
  advance(deltaMs: number): AiLabFrameStep | undefined;
  afterTick(deltaMs: number): void;
  selectAnimal(animalId: string): void;
  scatterFood(): void;
  makeRain(): void;
  setTimeScale(value: number): void;
  togglePaused(): void;
  step(): void;
  exportSelectedBehaviorLog(): AiLabBehaviorLogExport | undefined;
  setSelectedSchedulerClass(schedulerClassId: "nimble" | "steady"): void;
  toggleForestAlert(): void;
  toggleProbeBarrier(obstacleId?: string): void;
  stressBudgets(): void;
  setStressMaxAnimals(value: number): void;
  startStressTest(): void;
  stopStressTest(): void;
  saveCheckpoint(): void;
  restoreCheckpoint(): void;
  snapshot(): AiLabSnapshot;
  dispose(): void;
};

export function createAiLabState(world: GameWorld): AiLabRuntimeState {
  const state: AiLabRuntimeState = {
    world,
    elapsed: 0,
    pendingIntents: [],
    animalEntityById: new Map(),
    animalEntityByAgentId: new Map(),
    resourceEntityById: new Map(),
    obstacleEntityById: new Map(),
    lastGoalByAgentId: new Map(),
    lastInteractionEventAt: new Map(),
    behaviorSamplesByAgentId: new Map(),
    intentHistory: [],
    lastIntentLogAt: new Map(),
    events: [],
    eventSequence: 0,
    retainIntent(intent) {
      const saved = cloneIntent(intent);
      state.pendingIntents.push(saved);
      if (isStressAgentId(intent.agentId)) {
        return;
      }
      const key = `${intent.agentId}:${intent.type}`;
      const lastAt = state.lastIntentLogAt.get(key) ?? Number.NEGATIVE_INFINITY;
      if (state.elapsed - lastAt >= INTENT_LOG_INTERVAL_MS) {
        state.intentHistory.push({ timestamp: state.elapsed, intent: cloneIntent(saved) });
        state.lastIntentLogAt.set(key, state.elapsed);
      }
    }
  };
  return state;
}

export function createAiLabController(options: {
  ai: AiLabAiPort;
  state: AiLabRuntimeState;
  navigation?: AiLabNavigationPort | undefined;
  physics?: PhysicsQueries | undefined;
  sharedFacts?: AiLabSharedFacts | undefined;
  setObstacleEnabled?(obstacleId: string, enabled: boolean): void;
}): AiLabController {
  let running = false;
  let paused = false;
  let pendingSteps = 0;
  let timeScale = 1;
  let selectedId = AI_LAB_ANIMAL_BLUEPRINTS[0]?.id ?? "";
  let notice = "林地正在苏醒。点一只小动物，看看它今天最想做什么。";
  let lastTelemetryAt = Number.NEGATIVE_INFINITY;
  let lastBehaviorSampleAt = Number.NEGATIVE_INFINITY;
  let goals: AiLabGoalView[] = [];
  let selectedCheckpoint: AiAgentCheckpoint | undefined;
  let savedCheckpoint: AiLabSceneCheckpoint | undefined;
  let routeSurgeUntil = Number.NEGATIVE_INFINITY;
  let rewindUntil = Number.NEGATIVE_INFINITY;
  let restoreCount = 0;
  let resolvedEntities = 0;
  let resolvedActors = 0;
  let resolvedTaskStates = 0;
  let pendingFrameStartedAt: number | undefined;
  let pendingFrameIntervalMs = 0;
  const stressAnimalIds: string[] = [];
  const stressTest = createAiLabStressTest({
    baseAnimals: AI_LAB_ANIMAL_BLUEPRINTS.length,
    resizePopulation,
    onStatus(message) {
      notice = message;
    }
  });

  const controller: AiLabController = {
    start() {
      if (running) {
        return;
      }
      running = true;
      seedWorld();
      bindAnimals();
      pushEvent("清晨到了，林地里的小动物开始寻找食物和水。", "calm");
      refreshTelemetry();
      recordBehaviorSamples();
    },
    advance(deltaMs) {
      if (!running) {
        return undefined;
      }
      if (paused && pendingSteps <= 0) {
        return undefined;
      }
      pendingFrameIntervalMs = Math.max(0, deltaMs);
      pendingFrameStartedAt = monotonicNow();
      const stepDelta =
        paused && pendingSteps > 0
          ? 250
          : Math.max(0, Math.min(deltaMs, 64)) * Math.max(0.5, timeScale);
      if (pendingSteps > 0) {
        pendingSteps -= 1;
      }
      options.state.elapsed += stepDelta;
      return { deltaMs: stepDelta, elapsedMs: options.state.elapsed };
    },
    afterTick(deltaMs) {
      simulateEcosystem(deltaMs);
      recordGoalChanges();
      recordBehaviorSamples();
      const stressRunning = stressTest.isRunning();
      if (!stressRunning && options.state.elapsed - lastTelemetryAt >= TELEMETRY_INTERVAL_MS) {
        refreshTelemetry();
      }
      if (stressRunning) {
        const simulationMs =
          pendingFrameStartedAt === undefined ? 0 : monotonicNow() - pendingFrameStartedAt;
        stressTest.sample({
          frameMs: pendingFrameIntervalMs,
          simulationMs,
          runtime: readStressRuntimeCounters,
          navigation: {
            pendingRequests: options.navigation?.snapshot().pendingRequests ?? 0
          }
        });
        if (!stressTest.isRunning()) {
          refreshTelemetry();
        }
      }
      pendingFrameStartedAt = undefined;
    },
    selectAnimal(animalId) {
      if (!options.state.animalEntityById.has(animalId)) {
        return;
      }
      const previousId = selectedId;
      selectedId = animalId;
      if (previousId !== selectedId) {
        options.ai.setSchedulerClass(agentIdFor(previousId), "steady");
      }
      options.ai.setSchedulerClass(agentIdFor(selectedId), "nimble");
      const creature = creatureById(animalId);
      notice = creature
        ? `现在跟着${creature.name}。被观察的个体会自动提升感知与决策频率。`
        : notice;
      refreshTelemetry();
    },
    scatterFood() {
      requireRunning();
      for (const entity of options.state.resourceEntityById.values()) {
        const resource = options.state.world.get(entity, AiLabResource);
        if (resource?.kind === "food") {
          options.state.world.set(entity, AiLabResource, {
            amount: Math.min(resource.capacity, resource.amount + 7)
          });
        }
      }
      notice = "你撒下了一篮浆果和种子，空掉的食物点重新丰盛起来。";
      pushEvent("林地里多了一篮新鲜食物。", "good");
    },
    makeRain() {
      requireRunning();
      for (const entity of options.state.resourceEntityById.values()) {
        const resource = options.state.world.get(entity, AiLabResource);
        if (!resource) {
          continue;
        }
        const bonus =
          resource.kind === "water" ? resource.capacity : resource.kind === "food" ? 3 : 0;
        options.state.world.set(entity, AiLabResource, {
          amount: Math.min(resource.capacity, resource.amount + bonus)
        });
      }
      notice = "一阵春雨补满了水塘，也让草叶和蘑菇长得更快。";
      pushEvent("春雨落下，水源恢复了。", "good");
    },
    setTimeScale(value) {
      timeScale = value >= 1.75 ? 2 : value >= 0.75 ? 1 : 0.5;
      notice = `观察速度调整为 ${timeScale.toFixed(1)}×。`;
    },
    togglePaused() {
      paused = !paused;
      pendingSteps = 0;
      notice = paused ? "林地时间暂停了，可以慢慢查看每只动物。" : "林地时间继续流动。";
    },
    step() {
      if (!paused) {
        paused = true;
      }
      pendingSteps += 1;
      notice = "向前推进了一个 250ms 的确定性步长。";
    },
    setSelectedSchedulerClass(schedulerClassId) {
      requireRunning();
      const animal = creatureById(selectedId);
      if (!animal) {
        return;
      }
      options.ai.setSchedulerClass(agentIdFor(selectedId), schedulerClassId);
      notice = `${animal.name}已切换到 ${schedulerClassId} 调度档位，剩余感知与决策到期时间会按比例缩放。`;
      pushEvent(`${animal.name}的 AI 调度档位切换为 ${schedulerClassId}。`, "calm", selectedId);
      refreshTelemetry();
    },
    toggleForestAlert() {
      requireRunning();
      if (!options.sharedFacts) {
        return;
      }
      const active = !options.sharedFacts.alert();
      options.sharedFacts.setAlert(active, options.state.elapsed);
      notice = active
        ? "警铃响起。共享事实会让小动物结束可中断的行动，分阶段赶往藏身处。"
        : "警铃停了。躲好的动物会先确认安全，再恢复原本的生存选择。";
      pushEvent(
        active ? "警铃响起，小动物开始寻找藏身处。" : "警戒解除，林地重新安静下来。",
        active ? "warning" : "good"
      );
    },
    toggleProbeBarrier(obstacleId = "west-fallen-log") {
      requireRunning();
      const entity = options.state.obstacleEntityById.get(obstacleId);
      if (entity === undefined) {
        return;
      }
      const obstacle = options.state.world.get(entity, AiLabObstacle);
      const collider = options.state.world.get(entity, PhysicsColliderComponent);
      if (!obstacle || !collider) {
        return;
      }
      const enabled = !obstacle.enabled;
      options.state.world.set(entity, AiLabObstacle, { enabled });
      options.state.world.set(entity, PhysicsColliderComponent, { enabled });
      options.setObstacleEnabled?.(obstacle.id, enabled);
      updateNavigationObstacle(obstacle.id, enabled);
      routeSurgeUntil = options.state.elapsed + 1_200;
      notice = enabled
        ? `${obstacle.label}重新挡住了路径；受影响的动物会从直行切换为绕路。`
        : `${obstacle.label}被移开；受影响的动物会放弃绕路，改走直线。`;
      pushEvent(
        enabled ? `${obstacle.label}重新挡住了小径。` : `${obstacle.label}被暂时移开。`,
        "calm"
      );
    },
    stressBudgets() {
      requireRunning();
      const agents = options.ai.listAgents();
      const requestsPerAgent = Math.ceil(
        (AI_LAB_AI_RUNTIME_LIMITS.maxPathRequestsPerTick +
          AI_LAB_TRACE_PRODUCTION.maxEntriesPerUpdate +
          1) /
          Math.max(1, agents.length)
      );
      for (const agent of agents) {
        options.ai.setBlackboard(agent.binding.agentId, "pathBudgetProbe", {
          requests: requestsPerAgent
        });
        options.ai.setBlackboard(agent.binding.agentId, "forceRouteRefresh", options.state.elapsed);
      }
      routeSurgeUntil = options.state.elapsed + 2_200;
      notice = "鸟群突然掠过树梢。所有动物会重新确认路线，预算不足的请求会延后到后续帧。";
      pushEvent("鸟群惊起，林地里的路线同时开始重算。", "warning");
    },
    setStressMaxAnimals(value) {
      stressTest.configureMaxAnimals(value);
    },
    startStressTest() {
      requireRunning();
      paused = false;
      pendingSteps = 0;
      timeScale = 1;
      savedCheckpoint = undefined;
      stressTest.start();
      pushEvent("AI 容量压力测试开始，真实动物数量将逐级增加。", "warning");
    },
    stopStressTest() {
      stressTest.stop();
      refreshTelemetry();
      pushEvent("AI 容量压力测试停止，额外动物已经离场。", "calm");
    },
    saveCheckpoint() {
      requireRunning();
      savedCheckpoint = captureSceneCheckpoint();
      notice = `叶印记住了 ${savedCheckpoint.animals.length} 只动物此刻的位置、需求和 AI 状态。`;
      pushEvent("一枚叶印记录了此刻的林地。", "good");
    },
    restoreCheckpoint() {
      requireRunning();
      if (savedCheckpoint === undefined) {
        notice = "还没有可恢复的 AI checkpoint。";
        return;
      }
      resolvedEntities = 0;
      resolvedActors = 0;
      resolvedTaskStates = 0;
      restoreSceneWorld(savedCheckpoint);
      options.ai.restoreCheckpoint(savedCheckpoint.ai, {
        resolveEntityId(savedEntityId) {
          if (!options.state.world.has(savedEntityId)) {
            return undefined;
          }
          resolvedEntities += 1;
          return savedEntityId;
        },
        resolveActorId(savedActorId) {
          if (!options.state.animalEntityById.has(savedActorId)) {
            return undefined;
          }
          resolvedActors += 1;
          return savedActorId;
        },
        resolveTaskState(savedState) {
          resolvedTaskStates += 1;
          const restored = { ...savedState };
          delete restored.requestId;
          delete restored.routeId;
          const phase = restored.phase;
          if (phase === "route" || phase === "travel" || phase === "explore") {
            restored.phase = "route";
            restored.phaseElapsedMs = 0;
          }
          return restored;
        }
      });
      restoreCount += 1;
      rewindUntil = options.state.elapsed + 1_400;
      routeSurgeUntil = options.state.elapsed + 900;
      notice = `林地回到了叶印时刻：${resolvedActors} 只动物恢复位置与需求，${resolvedTaskStates} 段行为继续接上。`;
      pushEvent("叶印展开，动物和资源回到了记录时的位置。", "good");
      refreshTelemetry();
    },
    exportSelectedBehaviorLog() {
      requireRunning();
      const animal = creatureById(selectedId);
      if (!animal) {
        return undefined;
      }
      const agentId = agentIdFor(selectedId);
      const windowEnd = options.state.elapsed;
      const windowStart = Math.max(0, windowEnd - BEHAVIOR_LOG_WINDOW_MS);
      const checkpoint = options.ai
        .captureCheckpoint()
        .agents.find((entry) => entry.binding.agentId === agentId);
      const samples = (options.state.behaviorSamplesByAgentId.get(agentId) ?? [])
        .filter((entry) => entry.timestamp >= windowStart)
        .map((entry) => ({ ...entry }));
      const intents = options.state.intentHistory
        .filter((entry) => entry.timestamp >= windowStart && entry.intent.agentId === agentId)
        .map((entry) => ({ timestamp: entry.timestamp, intent: cloneIntent(entry.intent) }));
      const traces = options.ai
        .traces()
        .filter((entry) => entry.agentId === agentId && entry.timestamp >= windowStart)
        .map((entry) => ({
          ...entry,
          ...(entry.payload === undefined ? {} : { payload: { ...entry.payload } })
        }));
      const events = options.state.events
        .filter(
          (entry) =>
            entry.timestamp >= windowStart &&
            (entry.animalId === undefined || entry.animalId === selectedId)
        )
        .map((entry) => ({ ...entry }));
      notice = `已整理${animal.name}最近 ${formatLogDuration(windowEnd - windowStart)}的行为日志。`;
      return {
        schema: "gamekits.sandbox.ai-lab.behavior-log",
        version: 1,
        sceneId: "ai-lab",
        exportedAt: windowEnd,
        window: {
          start: windowStart,
          end: windowEnd,
          durationMs: windowEnd - windowStart,
          sampleIntervalMs: BEHAVIOR_SAMPLE_INTERVAL_MS
        },
        animal: {
          id: animal.id,
          agentId,
          name: animal.name,
          species: animal.species
        },
        current: {
          agent: options.ai.getAgent(agentId),
          memory: checkpoint?.memory.map((fact) => ({ ...fact })) ?? [],
          blackboard: { ...checkpoint?.blackboard }
        },
        samples,
        intents,
        traces,
        events,
        resources: resourceViews(),
        runtime: options.ai.snapshot()
      };
    },
    snapshot() {
      const runtime = options.ai.snapshot();
      const agents = new Map(runtime.agents.map((agent) => [agent.binding.agentId, agent]));
      const resources = resourceViews();
      const obstacles = obstacleViews();
      const resourceById = new Map(resources.map((resource) => [resource.id, resource]));
      const animals = animalViews(agents, resourceById, MAX_RENDERED_ANIMALS);
      const selected = animals.find((animal) => animal.id === selectedId);
      const selectedAgent = selected ? agents.get(selected.agentId) : undefined;
      const wellbeing =
        animals.length === 0
          ? 0
          : animals.reduce(
              (total, animal) =>
                total +
                (animal.health + (1 - animal.hunger) + (1 - animal.thirst) + animal.energy) / 4,
              0
            ) / animals.length;
      const dayProgress = (options.state.elapsed % DAY_DURATION_MS) / DAY_DURATION_MS;
      const physicsSnapshot = options.physics?.snapshot();
      const navigationSnapshot = options.navigation?.snapshot();
      const routeFact = selectedCheckpoint?.memory.find(
        (fact) => fact.key === "physics.route-clear"
      );
      const selectedPathClear = typeof routeFact?.value === "boolean" ? routeFact.value : undefined;
      const blockerId = stringRecordValue(routeFact?.metadata, "blockerId");
      return {
        running,
        paused,
        timeScale,
        elapsed: options.state.elapsed,
        day: Math.floor(options.state.elapsed / DAY_DURATION_MS) + 1,
        dayProgress,
        periodLabel: periodLabel(dayProgress),
        notice,
        population: options.state.animalEntityById.size,
        animals,
        resources,
        obstacles,
        selectedId,
        selected,
        selectedAgent,
        goals: goals.map(cloneGoalView),
        memory: selectedCheckpoint?.memory.map((fact) => ({ ...fact })) ?? [],
        blackboard: { ...selectedCheckpoint?.blackboard },
        traces: options.ai
          .traces()
          .filter((trace) => trace.agentId === selected?.agentId)
          .slice(-10)
          .reverse(),
        events: options.state.events
          .slice(-8)
          .reverse()
          .map((event) => ({ ...event })),
        runtime,
        foodRemaining: resources
          .filter((resource) => resource.kind === "food")
          .reduce((total, resource) => total + resource.amount, 0),
        waterRemaining: resources
          .filter((resource) => resource.kind === "water")
          .reduce((total, resource) => total + resource.amount, 0),
        wellbeing,
        forestAlert: options.sharedFacts?.alert() ?? false,
        routeSurgeActive: options.state.elapsed < routeSurgeUntil,
        rewindActive: options.state.elapsed < rewindUntil,
        checkpointEchoes:
          savedCheckpoint?.animals.map((animal) => ({
            animalId: animal.id,
            x: animal.position.x,
            y: animal.position.y
          })) ?? [],
        stress: stressTest.snapshot(options.state.animalEntityById.size, animals.length),
        capabilities: {
          scheduler: {
            classId: selectedAgent?.schedulerClassId,
            delayedDecisions: selectedAgent?.delayedDecisions ?? 0
          },
          sharedFacts: {
            alert: options.sharedFacts?.alert() ?? false,
            factCount: options.sharedFacts?.facts().length ?? 0
          },
          physics: {
            available: options.physics !== undefined,
            colliderCount: physicsSnapshot?.colliderCount ?? 0,
            barrierEnabled:
              obstacles.find((obstacle) => obstacle.id === "west-fallen-log")?.enabled ?? false,
            selectedPathClear,
            selectedBlockerId: blockerId
          },
          navigation: {
            available: options.navigation !== undefined,
            revision: navigationSnapshot?.revision ?? 0,
            pendingRequests: navigationSnapshot?.pendingRequests ?? 0,
            retainedRoutes: navigationSnapshot?.retainedRoutes ?? 0,
            rejectedPathRequests: runtime.rejectedPathRequests
          },
          checkpoint: {
            capturedAt: savedCheckpoint?.ai.elapsed,
            restoreCount,
            resolvedEntities,
            resolvedActors,
            resolvedTaskStates
          },
          trace: {
            retainedEntries: runtime.traceEntries,
            droppedEntries: runtime.droppedTraceEntries
          }
        }
      };
    },
    dispose() {
      if (!running) {
        return;
      }
      stressTest.dispose();
      for (const animalId of options.state.animalEntityById.keys()) {
        options.ai.unbind(agentIdFor(animalId), "scene-disposed");
      }
      for (const entity of [
        ...options.state.animalEntityById.values(),
        ...options.state.resourceEntityById.values(),
        ...options.state.obstacleEntityById.values()
      ]) {
        if (options.state.world.has(entity)) {
          options.state.world.despawn(entity);
        }
      }
      options.state.animalEntityById.clear();
      options.state.animalEntityByAgentId.clear();
      options.state.resourceEntityById.clear();
      options.state.obstacleEntityById.clear();
      options.state.pendingIntents.length = 0;
      options.state.behaviorSamplesByAgentId.clear();
      options.state.intentHistory.length = 0;
      options.state.lastIntentLogAt.clear();
      running = false;
    }
  };

  return controller;

  function readStressRuntimeCounters() {
    const runtime = options.ai.snapshot();
    return {
      delayedDecisions: runtime.delayedDecisions,
      delayedSensorSamples: runtime.delayedSensorSamples,
      rejectedPathRequests: runtime.rejectedPathRequests
    };
  }

  function seedWorld(): void {
    for (const blueprint of AI_LAB_RESOURCE_BLUEPRINTS) {
      const entity = options.state.world.spawn();
      options.state.world.add(entity, AiLabPosition, {
        x: blueprint.x,
        y: blueprint.y
      });
      options.state.world.add(entity, AiLabResource, blueprint);
      options.state.resourceEntityById.set(blueprint.id, entity);
    }
    for (const blueprint of AI_LAB_OBSTACLE_BLUEPRINTS) {
      const entity = options.state.world.spawn();
      options.state.world.add(entity, AiLabPosition, { x: blueprint.x, y: blueprint.y });
      options.state.world.add(entity, AiLabObstacle, blueprint);
      options.state.world.add(entity, PhysicsTransformComponent, {
        position: { x: blueprint.x, y: blueprint.y }
      });
      options.state.world.add(entity, PhysicsBodyComponent, {
        definition: {
          id: `sandbox.ai-lab.body.${blueprint.id}`,
          kind: "static",
          userData: { obstacleId: blueprint.id }
        }
      });
      options.state.world.add(entity, PhysicsColliderComponent, {
        definition: {
          id: `sandbox.ai-lab.collider.${blueprint.id}`,
          shape: { type: "box", width: blueprint.width, height: blueprint.height },
          filter: { groups: ["terrain"], collidesWith: ["sensor"] },
          userData: { obstacleId: blueprint.id }
        },
        enabled: blueprint.enabled
      });
      options.state.obstacleEntityById.set(blueprint.id, entity);
    }
    for (const blueprint of AI_LAB_ANIMAL_BLUEPRINTS) {
      spawnAnimal(blueprint);
    }
  }

  function bindAnimals(): void {
    for (const [animalId, entityId] of options.state.animalEntityById) {
      bindAnimal(animalId, entityId);
    }
    options.ai.setSchedulerClass(agentIdFor(selectedId), "nimble");
  }

  function resizePopulation(totalAnimals: number): void {
    const targetStressAnimals = Math.max(0, totalAnimals - AI_LAB_ANIMAL_BLUEPRINTS.length);
    while (stressAnimalIds.length < targetStressAnimals) {
      const blueprint = createStressAnimalBlueprint(stressAnimalIds.length);
      const entity = spawnAnimal(blueprint);
      bindAnimal(blueprint.id, entity, "background");
      stressAnimalIds.push(blueprint.id);
    }
    while (stressAnimalIds.length > targetStressAnimals) {
      const animalId = stressAnimalIds.pop();
      if (animalId === undefined) {
        break;
      }
      const agentId = agentIdFor(animalId);
      options.ai.unbind(agentId, "stress-population-resized");
      const entity = options.state.animalEntityById.get(animalId);
      if (entity !== undefined && options.state.world.has(entity)) {
        options.state.world.despawn(entity);
      }
      options.state.animalEntityById.delete(animalId);
      options.state.animalEntityByAgentId.delete(agentId);
      options.state.lastGoalByAgentId.delete(agentId);
      options.state.lastInteractionEventAt.delete(agentId);
      options.state.behaviorSamplesByAgentId.delete(agentId);
      options.state.lastIntentLogAt.delete(`${agentId}:movement`);
      options.state.lastIntentLogAt.delete(`${agentId}:interaction`);
    }
  }

  function spawnAnimal(blueprint: (typeof AI_LAB_ANIMAL_BLUEPRINTS)[number]): EntityId {
    const entity = options.state.world.spawn();
    options.state.world.add(entity, AiLabPosition, {
      x: blueprint.x,
      y: blueprint.y
    });
    options.state.world.add(entity, AiLabCreature, blueprint);
    options.state.animalEntityById.set(blueprint.id, entity);
    options.state.animalEntityByAgentId.set(agentIdFor(blueprint.id), entity);
    return entity;
  }

  function bindAnimal(
    animalId: string,
    entityId: EntityId,
    schedulerClassId: "steady" | "background" = "steady"
  ): void {
    const creature = options.state.world.get(entityId, AiLabCreature);
    if (!creature) {
      return;
    }
    options.ai.bind({
      agentId: agentIdFor(animalId),
      actorId: animalId,
      entityId,
      definitionId: aiLabAgentDefinitionId(creature.species)
    });
    options.ai.setSchedulerClass(agentIdFor(animalId), schedulerClassId);
  }

  function createStressAnimalBlueprint(index: number) {
    const template = AI_LAB_ANIMAL_BLUEPRINTS[index % AI_LAB_ANIMAL_BLUEPRINTS.length]!;
    const position = stressSpawnPosition(index);
    return {
      ...template,
      id: `stress-${String(index + 1).padStart(4, "0")}`,
      name: `压测 ${index + 1}`,
      x: position.x,
      y: position.y,
      hunger: 0.18 + ((index * 7) % 64) / 100,
      thirst: 0.16 + ((index * 11) % 66) / 100,
      energy: 0.28 + ((index * 13) % 68) / 100,
      health: 0.82 + ((index * 3) % 18) / 100
    };
  }

  function stressSpawnPosition(index: number): { x: number; y: number } {
    let x = 6 + ((index * 37) % 89);
    let y = 8 + ((index * 53) % 83);
    for (const obstacle of AI_LAB_OBSTACLE_BLUEPRINTS) {
      const clearance = AI_LAB_NAVIGATION_PROFILE.radius + 1;
      if (
        Math.abs(x - obstacle.x) <= obstacle.width / 2 + clearance &&
        Math.abs(y - obstacle.y) <= obstacle.height / 2 + clearance
      ) {
        x = clamp(x + obstacle.width + clearance * 2, 4, 96);
        y = clamp(y + clearance * 2, 6, 94);
      }
    }
    return { x, y };
  }

  function captureSceneCheckpoint(): AiLabSceneCheckpoint {
    const animals = [...options.state.animalEntityById].flatMap(([id, entity]) => {
      const creature = options.state.world.get(entity, AiLabCreature);
      const position = options.state.world.get(entity, AiLabPosition);
      return creature && position
        ? [{ id, creature: { ...creature }, position: { ...position } }]
        : [];
    });
    const resources = [...options.state.resourceEntityById].flatMap(([id, entity]) => {
      const resource = options.state.world.get(entity, AiLabResource);
      return resource ? [{ id, resource: { ...resource } }] : [];
    });
    const obstacles = [...options.state.obstacleEntityById].flatMap(([id, entity]) => {
      const obstacle = options.state.world.get(entity, AiLabObstacle);
      return obstacle ? [{ id, obstacle: { ...obstacle } }] : [];
    });
    return {
      ai: options.ai.captureCheckpoint(),
      alert: options.sharedFacts?.alert() ?? false,
      animals,
      resources,
      obstacles
    };
  }

  function restoreSceneWorld(checkpoint: AiLabSceneCheckpoint): void {
    options.state.pendingIntents.length = 0;
    for (const animal of checkpoint.animals) {
      const entity = options.state.animalEntityById.get(animal.id);
      if (entity === undefined) continue;
      options.state.world.set(entity, AiLabCreature, { ...animal.creature });
      options.state.world.set(entity, AiLabPosition, { ...animal.position });
    }
    for (const saved of checkpoint.resources) {
      const entity = options.state.resourceEntityById.get(saved.id);
      if (entity !== undefined) {
        options.state.world.set(entity, AiLabResource, { ...saved.resource });
      }
    }
    for (const saved of checkpoint.obstacles) {
      const entity = options.state.obstacleEntityById.get(saved.id);
      if (entity === undefined) continue;
      options.state.world.set(entity, AiLabObstacle, { ...saved.obstacle });
      options.state.world.set(entity, PhysicsColliderComponent, {
        enabled: saved.obstacle.enabled
      });
      options.setObstacleEnabled?.(saved.id, saved.obstacle.enabled);
      updateNavigationObstacle(saved.id, saved.obstacle.enabled);
    }
    options.sharedFacts?.setAlert(checkpoint.alert, options.state.elapsed);
  }

  function updateNavigationObstacle(obstacleId: string, blocked: boolean): void {
    if (options.navigation === undefined) {
      return;
    }
    const result = options.navigation.updateObstacle({
      id: `sandbox.ai-lab.obstacle.${obstacleId}.${options.state.elapsed}`,
      target: { kind: "custom", id: obstacleId },
      blocked,
      source: "sandbox.ai-lab"
    });
    if (result.status === "unsupported") {
      throw new Error(`AI Lab navigation obstacle is not mapped: ${obstacleId}`);
    }
  }

  function simulateEcosystem(deltaMs: number): void {
    const deltaSeconds = Math.max(0, deltaMs) / 1_000;
    regenerateResources(deltaSeconds);
    const movementByAgent = new Map<string, Extract<AiIntent, { type: "movement" }>>();
    const interactions: Array<Extract<AiIntent, { type: "interaction" }>> = [];
    for (const intent of options.state.pendingIntents) {
      if (intent.type === "movement") {
        movementByAgent.set(intent.agentId, intent);
      } else if (intent.type === "interaction") {
        interactions.push(intent);
      }
    }
    options.state.pendingIntents.length = 0;

    for (const [agentId, entity] of options.state.animalEntityByAgentId) {
      const creature = options.state.world.get(entity, AiLabCreature);
      const position = options.state.world.get(entity, AiLabPosition);
      if (!creature || !position) {
        continue;
      }
      const movement = movementByAgent.get(agentId)?.desiredVelocity ?? { x: 0, y: 0 };
      const magnitude = Math.hypot(movement.x, movement.y);
      const directionX = magnitude > 0.001 ? movement.x / magnitude : 0;
      const directionY = magnitude > 0.001 ? movement.y / magnitude : 0;
      const speed = creatureSpeed(creature.species);
      const movementBlocked =
        magnitude > 0.001 &&
        physicsBlocksMovement(position, { x: directionX, y: directionY }, speed * deltaSeconds);
      const velocityX = movementBlocked ? 0 : directionX * speed;
      const velocityY = movementBlocked ? 0 : directionY * speed;
      const metabolism = creatureMetabolism(creature.species);
      const hunger = clamp01(creature.hunger + deltaSeconds * 0.013 * metabolism);
      const thirst = clamp01(creature.thirst + deltaSeconds * 0.017 * metabolism);
      const energy = clamp01(
        creature.energy - deltaSeconds * (0.004 + (magnitude > 0.05 ? 0.012 : 0.002)) * metabolism
      );
      const underPressure = hunger > 0.92 || thirst > 0.92;
      const health = clamp01(
        creature.health +
          deltaSeconds * (underPressure ? -0.045 : hunger < 0.6 && thirst < 0.6 ? 0.006 : 0)
      );
      options.state.world.set(entity, AiLabPosition, {
        x: clamp(position.x + velocityX * deltaSeconds, 4, 96),
        y: clamp(position.y + velocityY * deltaSeconds, 6, 94),
        velocityX,
        velocityY
      });
      options.state.world.set(entity, AiLabCreature, { hunger, thirst, energy, health });
    }

    for (const interaction of interactions) {
      applyInteraction(interaction, deltaSeconds);
    }
  }

  function physicsBlocksMovement(
    position: { x: number; y: number },
    direction: { x: number; y: number },
    distance: number
  ): boolean {
    if (options.physics === undefined || distance <= 0) {
      return false;
    }
    return (
      options.physics.shapeCast(
        { type: "circle", radius: AI_LAB_NAVIGATION_PROFILE.radius },
        { x: position.x, y: position.y },
        direction,
        { maxDistance: distance, mode: "closest", maxResults: 1, sort: "distance" }
      ).length > 0
    );
  }

  function regenerateResources(deltaSeconds: number): void {
    for (const entity of options.state.resourceEntityById.values()) {
      const resource = options.state.world.get(entity, AiLabResource);
      if (!resource || resource.kind === "shelter") {
        continue;
      }
      options.state.world.set(entity, AiLabResource, {
        amount: Math.min(
          resource.capacity,
          resource.amount + resource.regenerationPerSecond * deltaSeconds
        )
      });
    }
  }

  function applyInteraction(
    interaction: Extract<AiIntent, { type: "interaction" }>,
    deltaSeconds: number
  ): void {
    const animalEntity = options.state.animalEntityByAgentId.get(interaction.agentId);
    const targetEntity = interaction.targetId
      ? options.state.resourceEntityById.get(interaction.targetId)
      : undefined;
    if (animalEntity === undefined || targetEntity === undefined) {
      return;
    }
    const creature = options.state.world.get(animalEntity, AiLabCreature);
    const animalPosition = options.state.world.get(animalEntity, AiLabPosition);
    const resource = options.state.world.get(targetEntity, AiLabResource);
    const resourcePosition = options.state.world.get(targetEntity, AiLabPosition);
    if (!creature || !animalPosition || !resource || !resourcePosition) {
      return;
    }
    if (
      Math.hypot(animalPosition.x - resourcePosition.x, animalPosition.y - resourcePosition.y) > 5.2
    ) {
      return;
    }

    if (interaction.interactionId === "eat" && resource.kind === "food") {
      const consumed = Math.min(resource.amount, 3.8 * deltaSeconds);
      options.state.world.set(targetEntity, AiLabResource, { amount: resource.amount - consumed });
      options.state.world.set(animalEntity, AiLabCreature, {
        hunger: clamp01(creature.hunger - consumed * 0.07),
        health: clamp01(creature.health + consumed * 0.008)
      });
      recordInteractionEvent(interaction.agentId, `${creature.name}在安静地吃东西。`);
      return;
    }
    if (interaction.interactionId === "drink" && resource.kind === "water") {
      const consumed = Math.min(resource.amount, 4.5 * deltaSeconds);
      options.state.world.set(targetEntity, AiLabResource, { amount: resource.amount - consumed });
      options.state.world.set(animalEntity, AiLabCreature, {
        thirst: clamp01(creature.thirst - consumed * 0.082),
        health: clamp01(creature.health + consumed * 0.006)
      });
      recordInteractionEvent(interaction.agentId, `${creature.name}找到了清水。`);
      return;
    }
    if (interaction.interactionId === "rest" && resource.kind === "shelter") {
      options.state.world.set(animalEntity, AiLabCreature, {
        energy: clamp01(creature.energy + deltaSeconds * 0.23),
        health: clamp01(creature.health + deltaSeconds * 0.012)
      });
      recordInteractionEvent(interaction.agentId, `${creature.name}蜷在安全的角落休息。`);
      return;
    }
    if (interaction.interactionId === "hide" && resource.kind === "shelter") {
      recordInteractionEvent(interaction.agentId, `${creature.name}已经藏好，正安静等待警戒解除。`);
    }
  }

  function recordInteractionEvent(agentId: string, message: string): void {
    if (isStressAgentId(agentId)) {
      return;
    }
    const lastAt = options.state.lastInteractionEventAt.get(agentId) ?? Number.NEGATIVE_INFINITY;
    if (options.state.elapsed - lastAt < 1_800) {
      return;
    }
    options.state.lastInteractionEventAt.set(agentId, options.state.elapsed);
    pushEvent(message, "good", animalIdFromAgent(agentId));
  }

  function recordGoalChanges(): void {
    for (const blueprint of AI_LAB_ANIMAL_BLUEPRINTS) {
      const agent = options.ai.getAgent(agentIdFor(blueprint.id));
      if (agent === undefined) {
        continue;
      }
      const nextGoal = agent.goalId ?? "";
      const previousGoal = options.state.lastGoalByAgentId.get(agent.binding.agentId);
      if (nextGoal === previousGoal) {
        continue;
      }
      options.state.lastGoalByAgentId.set(agent.binding.agentId, nextGoal);
      if (!nextGoal) {
        continue;
      }
      const animalId = animalIdFromAgent(agent.binding.agentId);
      const creature = creatureById(animalId);
      if (creature) {
        pushEvent(`${creature.name}${activityStory(activityFromGoal(nextGoal))}`, "calm", animalId);
      }
    }
  }

  function recordBehaviorSamples(): void {
    if (options.state.elapsed - lastBehaviorSampleAt < BEHAVIOR_SAMPLE_INTERVAL_MS) {
      return;
    }
    lastBehaviorSampleAt = options.state.elapsed;
    const agents = new Map(
      AI_LAB_ANIMAL_BLUEPRINTS.flatMap((blueprint) => {
        const agent = options.ai.getAgent(agentIdFor(blueprint.id));
        return agent === undefined ? [] : [[agent.binding.agentId, agent] as const];
      })
    );
    const resources = resourceViews();
    const resourceById = new Map(resources.map((resource) => [resource.id, resource] as const));
    const cutoff = Math.max(0, options.state.elapsed - BEHAVIOR_LOG_WINDOW_MS);
    for (const animal of animalViews(agents, resourceById)) {
      const history = options.state.behaviorSamplesByAgentId.get(animal.agentId) ?? [];
      history.push({
        timestamp: options.state.elapsed,
        animalId: animal.id,
        agentId: animal.agentId,
        x: animal.x,
        y: animal.y,
        velocityX: animal.velocityX,
        velocityY: animal.velocityY,
        hunger: animal.hunger,
        thirst: animal.thirst,
        energy: animal.energy,
        health: animal.health,
        activity: animal.activity,
        behaviorPhase: animal.behaviorPhase,
        behaviorProgress: animal.behaviorProgress,
        ...(animal.goalId === undefined ? {} : { goalId: animal.goalId }),
        ...(animal.goalScore === undefined ? {} : { goalScore: animal.goalScore }),
        ...(animal.taskId === undefined ? {} : { taskId: animal.taskId }),
        ...(animal.taskStatus === undefined ? {} : { taskStatus: animal.taskStatus }),
        ...(animal.safeToInterrupt === undefined
          ? {}
          : { safeToInterrupt: animal.safeToInterrupt }),
        ...(animal.targetId === undefined ? {} : { targetId: animal.targetId })
      });
      const firstRetained = history.findIndex((entry) => entry.timestamp >= cutoff);
      if (firstRetained > 0) {
        history.splice(0, firstRetained);
      }
      options.state.behaviorSamplesByAgentId.set(animal.agentId, history);
    }
    const firstRetainedIntent = options.state.intentHistory.findIndex(
      (entry) => entry.timestamp >= cutoff
    );
    if (firstRetainedIntent < 0) {
      options.state.intentHistory.length = 0;
    } else if (firstRetainedIntent > 0) {
      options.state.intentHistory.splice(0, firstRetainedIntent);
    }
  }

  function refreshTelemetry(): void {
    lastTelemetryAt = options.state.elapsed;
    const agentId = agentIdFor(selectedId);
    goals = options.ai.scoreGoals(agentId).map(goalView);
    selectedCheckpoint = options.ai
      .captureCheckpoint()
      .agents.find((agent) => agent.binding.agentId === agentId);
  }

  function animalViews(
    agents: Map<string, AiAgentSnapshot>,
    resources: Map<string, AiLabResourceView>,
    limit = Number.POSITIVE_INFINITY
  ): AiLabAnimalView[] {
    const result: AiLabAnimalView[] = [];
    for (const [animalId, entity] of options.state.animalEntityById) {
      if (result.length >= limit) {
        break;
      }
      const creature = options.state.world.get(entity, AiLabCreature);
      const position = options.state.world.get(entity, AiLabPosition);
      const agentId = agentIdFor(animalId);
      const agent = agents.get(agentId);
      if (!creature || !position) {
        continue;
      }
      const targetId = stringRecordValue(agent?.task?.state, "targetId");
      const targetResource = targetId ? resources.get(targetId) : undefined;
      const behaviorPhase = behaviorPhaseFromRecord(agent?.task?.state);
      result.push({
        id: creature.id,
        agentId,
        name: creature.name,
        species: creature.species,
        x: position.x,
        y: position.y,
        velocityX: position.velocityX,
        velocityY: position.velocityY,
        hunger: creature.hunger,
        thirst: creature.thirst,
        energy: creature.energy,
        health: creature.health,
        activity: activityFromGoal(agent?.goalId),
        behaviorPhase,
        behaviorProgress: clamp01(numberRecordValue(agent?.task?.state, "progress") ?? 0),
        routeMode: routeModeFromRecord(agent?.task?.state),
        routePoints: routePointsFromRecord(agent?.task?.state),
        ...(agent?.schedulerClassId === undefined
          ? {}
          : { schedulerClassId: agent.schedulerClassId }),
        ...(agent?.task?.taskId === undefined ? {} : { taskId: agent.task.taskId }),
        ...(agent?.task?.status === undefined ? {} : { taskStatus: agent.task.status }),
        ...(agent?.task?.safeToInterrupt === undefined
          ? {}
          : { safeToInterrupt: agent.task.safeToInterrupt }),
        ...(targetId === undefined ? {} : { targetId }),
        ...(targetResource
          ? { targetX: targetResource.x, targetY: targetResource.y }
          : {
              targetX: numberRecordValue(agent?.task?.state, "targetX"),
              targetY: numberRecordValue(agent?.task?.state, "targetY")
            }),
        ...(agent?.goalId === undefined ? {} : { goalId: agent.goalId }),
        ...(agent?.goalScore === undefined ? {} : { goalScore: agent.goalScore })
      });
    }
    return result;
  }

  function resourceViews(): AiLabResourceView[] {
    const result: AiLabResourceView[] = [];
    for (const entity of options.state.resourceEntityById.values()) {
      const resource = options.state.world.get(entity, AiLabResource);
      const position = options.state.world.get(entity, AiLabPosition);
      if (resource && position) {
        result.push({
          id: resource.id,
          kind: resource.kind,
          variant: resource.variant,
          x: position.x,
          y: position.y,
          amount: resource.amount,
          capacity: resource.capacity
        });
      }
    }
    return result;
  }

  function obstacleViews() {
    return [...options.state.obstacleEntityById.values()].flatMap((entity) => {
      const obstacle = options.state.world.get(entity, AiLabObstacle);
      const position = options.state.world.get(entity, AiLabPosition);
      return obstacle && position
        ? [
            {
              id: obstacle.id,
              kind: obstacle.kind,
              label: obstacle.label,
              x: position.x,
              y: position.y,
              width: obstacle.width,
              height: obstacle.height,
              enabled: obstacle.enabled
            }
          ]
        : [];
    });
  }

  function creatureById(animalId: string) {
    const entity = options.state.animalEntityById.get(animalId);
    return entity === undefined ? undefined : options.state.world.get(entity, AiLabCreature);
  }

  function pushEvent(
    message: string,
    tone: AiLabEvent["tone"],
    animalId?: string | undefined
  ): void {
    options.state.eventSequence += 1;
    options.state.events.push({
      sequence: options.state.eventSequence,
      timestamp: options.state.elapsed,
      ...(animalId === undefined ? {} : { animalId }),
      tone,
      message
    });
    if (options.state.events.length > MAX_EVENTS) {
      options.state.events.splice(0, options.state.events.length - MAX_EVENTS);
    }
  }

  function requireRunning(): void {
    if (!running) {
      throw new Error("AI Lab controller is not running");
    }
  }
}

function goalView(score: AiGoalScore): AiLabGoalView {
  const role = activityFromGoal(score.goalId);
  return { ...score, role, label: activityLabel(role) };
}

function cloneGoalView(goal: AiLabGoalView): AiLabGoalView {
  return { ...goal, considerations: goal.considerations.map((item) => ({ ...item })) };
}

function activityFromGoal(goalId: string | undefined): AiLabActivity {
  if (goalId?.endsWith(".hide")) return "hide";
  if (goalId?.endsWith(".forage")) return "forage";
  if (goalId?.endsWith(".drink")) return "drink";
  if (goalId?.endsWith(".rest")) return "rest";
  if (goalId?.endsWith(".wander")) return "wander";
  return "waiting";
}

function activityLabel(activity: AiLabActivity): string {
  if (activity === "hide") return "赶快躲好";
  if (activity === "forage") return "找点吃的";
  if (activity === "drink") return "去喝水";
  if (activity === "rest") return "找地方休息";
  if (activity === "wander") return "四处逛逛";
  return "观察四周";
}

function activityStory(activity: AiLabActivity): string {
  if (activity === "hide") return "听见了警铃，正赶往最近的藏身处。";
  if (activity === "forage") return "肚子饿了，开始寻找食物。";
  if (activity === "drink") return "觉得口渴，朝最近的水源走去。";
  if (activity === "rest") return "有些疲惫，正在寻找安全的休息处。";
  if (activity === "wander") return "现在没有急迫需求，决定四处探索。";
  return "停下来观察四周。";
}

function agentIdFor(animalId: string): string {
  return `${AI_LAB_AGENT_PREFIX}${animalId}`;
}

function animalIdFromAgent(agentId: string): string {
  return agentId.startsWith(AI_LAB_AGENT_PREFIX)
    ? agentId.slice(AI_LAB_AGENT_PREFIX.length)
    : agentId;
}

function isStressAgentId(agentId: string): boolean {
  return agentId.startsWith(`${AI_LAB_AGENT_PREFIX}stress-`);
}

function periodLabel(progress: number): string {
  if (progress < 0.2) return "清晨";
  if (progress < 0.48) return "上午";
  if (progress < 0.72) return "午后";
  if (progress < 0.9) return "傍晚";
  return "入夜";
}

function stringRecordValue(record: Record<string, unknown> | undefined, key: string) {
  const value = record?.[key];
  return typeof value === "string" ? value : undefined;
}

function numberRecordValue(record: Record<string, unknown> | undefined, key: string) {
  const value = record?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function routeModeFromRecord(
  record: Record<string, unknown> | undefined
): AiLabRouteMode | undefined {
  const value = stringRecordValue(record, "routeMode");
  return value === "direct" || value === "detour" || value === "planning" ? value : undefined;
}

function routePointsFromRecord(record: Record<string, unknown> | undefined): AiLabRoutePoint[] {
  const value = record?.routePoints;
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((point) => {
    if (point === null || typeof point !== "object" || Array.isArray(point)) {
      return [];
    }
    const x = point.x;
    const y = point.y;
    return typeof x === "number" &&
      typeof y === "number" &&
      Number.isFinite(x) &&
      Number.isFinite(y)
      ? [{ x, y }]
      : [];
  });
}

function behaviorPhaseFromRecord(record: Record<string, unknown> | undefined): AiLabBehaviorPhase {
  const phase = stringRecordValue(record, "phase");
  if (
    phase === "orient" ||
    phase === "route" ||
    phase === "travel" ||
    phase === "prepare" ||
    phase === "interact" ||
    phase === "settle" ||
    phase === "explore" ||
    phase === "observe"
  ) {
    return phase;
  }
  return "waiting";
}

function formatLogDuration(durationMs: number): string {
  return durationMs >= BEHAVIOR_LOG_WINDOW_MS ? "10 秒" : `${(durationMs / 1_000).toFixed(1)} 秒`;
}

function cloneIntent(intent: AiIntent): AiIntent {
  if (intent.type === "movement") {
    return { ...intent, desiredVelocity: { ...intent.desiredVelocity } };
  }
  if (intent.type === "aim" && intent.direction !== undefined) {
    return { ...intent, direction: { ...intent.direction } };
  }
  if (intent.type === "action" && intent.position !== undefined) {
    return { ...intent, position: { ...intent.position } };
  }
  return { ...intent };
}

function clamp01(value: number): number {
  return clamp(value, 0, 1);
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, Number.isFinite(value) ? value : minimum));
}

function monotonicNow(): number {
  return typeof performance === "undefined" ? Date.now() : performance.now();
}
