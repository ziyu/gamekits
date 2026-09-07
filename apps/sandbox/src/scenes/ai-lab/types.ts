import type {
  AiAgentSnapshot,
  AiBlackboardValue,
  AiGoalScore,
  AiIntent,
  AiPerceptionFact,
  AiRuntimeSnapshot,
  AiTraceEntry
} from "@gamekits/ai-core";

export type AiLabSpecies = "rabbit" | "squirrel" | "hedgehog" | "mouse";

export type AiLabResourceKind = "food" | "water" | "shelter";

export type AiLabObstacleKind = "fallen-log" | "rock";

export type AiLabResourceVariant =
  | "berries"
  | "clover"
  | "seeds"
  | "mushrooms"
  | "pond"
  | "spring"
  | "burrow"
  | "hollow-log";

export type AiLabActivity = "forage" | "drink" | "rest" | "hide" | "wander" | "waiting";

export type AiLabRouteMode = "direct" | "detour" | "planning";

export type AiLabRoutePoint = {
  x: number;
  y: number;
};

export type AiLabStressStatus = "idle" | "warming" | "sampling" | "complete" | "stopped";

export type AiLabStressSnapshot = {
  status: AiLabStressStatus;
  configuredMaxAnimals: number;
  activeAnimals: number;
  testingAnimals: number;
  lastTestedAnimals: number;
  stableAnimals: number;
  renderedAnimals: number;
  coldStartMs: number;
  pendingNavigationRequests: number;
  backlogSettled: boolean;
  warmupTimedOut: boolean;
  phaseProgress: number;
  sampleFrames: number;
  averageFps: number;
  averageFrameMs: number;
  p95FrameMs: number;
  peakFrameMs: number;
  averageSimulationMs: number;
  p95SimulationMs: number;
  peakSimulationMs: number;
  delayedDecisionsPerSecond: number;
  delayedSensorSamplesPerSecond: number;
  rejectedPathRequests: number;
  withinBudget: boolean | undefined;
  reachedConfiguredLimit: boolean;
  failureReason: string | undefined;
};

export type AiLabBehaviorPhase =
  | "orient"
  | "route"
  | "travel"
  | "prepare"
  | "interact"
  | "settle"
  | "explore"
  | "observe"
  | "waiting";

export type AiLabAnimalView = {
  id: string;
  agentId: string;
  name: string;
  species: AiLabSpecies;
  x: number;
  y: number;
  velocityX: number;
  velocityY: number;
  hunger: number;
  thirst: number;
  energy: number;
  health: number;
  activity: AiLabActivity;
  behaviorPhase: AiLabBehaviorPhase;
  behaviorProgress: number;
  taskId?: string | undefined;
  taskStatus?: string | undefined;
  safeToInterrupt?: boolean | undefined;
  targetId?: string | undefined;
  targetX?: number | undefined;
  targetY?: number | undefined;
  routeMode?: AiLabRouteMode | undefined;
  routePoints: AiLabRoutePoint[];
  schedulerClassId?: string | undefined;
  goalId?: string | undefined;
  goalScore?: number | undefined;
};

export type AiLabResourceView = {
  id: string;
  kind: AiLabResourceKind;
  variant: AiLabResourceVariant;
  x: number;
  y: number;
  amount: number;
  capacity: number;
};

export type AiLabObstacleView = {
  id: string;
  kind: AiLabObstacleKind;
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
  enabled: boolean;
};

export type AiLabCapabilitySnapshot = {
  scheduler: {
    classId: string | undefined;
    delayedDecisions: number;
  };
  sharedFacts: {
    alert: boolean;
    factCount: number;
  };
  physics: {
    available: boolean;
    colliderCount: number;
    barrierEnabled: boolean;
    selectedPathClear: boolean | undefined;
    selectedBlockerId: string | undefined;
  };
  navigation: {
    available: boolean;
    revision: number;
    pendingRequests: number;
    retainedRoutes: number;
    rejectedPathRequests: number;
  };
  checkpoint: {
    capturedAt: number | undefined;
    restoreCount: number;
    resolvedEntities: number;
    resolvedActors: number;
    resolvedTaskStates: number;
  };
  trace: {
    retainedEntries: number;
    droppedEntries: number;
  };
};

export type AiLabEvent = {
  sequence: number;
  timestamp: number;
  animalId?: string | undefined;
  tone: "calm" | "good" | "warning";
  message: string;
};

export type AiLabGoalView = AiGoalScore & {
  role: AiLabActivity;
  label: string;
};

export type AiLabBehaviorSample = {
  timestamp: number;
  animalId: string;
  agentId: string;
  x: number;
  y: number;
  velocityX: number;
  velocityY: number;
  hunger: number;
  thirst: number;
  energy: number;
  health: number;
  activity: AiLabActivity;
  behaviorPhase: AiLabBehaviorPhase;
  behaviorProgress: number;
  goalId?: string | undefined;
  goalScore?: number | undefined;
  taskId?: string | undefined;
  taskStatus?: string | undefined;
  safeToInterrupt?: boolean | undefined;
  targetId?: string | undefined;
};

export type AiLabIntentRecord = {
  timestamp: number;
  intent: AiIntent;
};

export type AiLabBehaviorLogExport = {
  schema: "gamekits.sandbox.ai-lab.behavior-log";
  version: 1;
  sceneId: "ai-lab";
  exportedAt: number;
  window: {
    start: number;
    end: number;
    durationMs: number;
    sampleIntervalMs: number;
  };
  animal: {
    id: string;
    agentId: string;
    name: string;
    species: AiLabSpecies;
  };
  current: {
    agent: AiAgentSnapshot | undefined;
    memory: AiPerceptionFact[];
    blackboard: Record<string, AiBlackboardValue>;
  };
  samples: AiLabBehaviorSample[];
  intents: AiLabIntentRecord[];
  traces: AiTraceEntry[];
  events: AiLabEvent[];
  resources: AiLabResourceView[];
  runtime: AiRuntimeSnapshot;
};

export type AiLabSnapshot = {
  running: boolean;
  paused: boolean;
  timeScale: number;
  elapsed: number;
  day: number;
  dayProgress: number;
  periodLabel: string;
  notice: string;
  population: number;
  animals: AiLabAnimalView[];
  resources: AiLabResourceView[];
  obstacles: AiLabObstacleView[];
  selectedId: string;
  selected: AiLabAnimalView | undefined;
  selectedAgent: AiAgentSnapshot | undefined;
  goals: AiLabGoalView[];
  memory: AiPerceptionFact[];
  blackboard: Record<string, AiBlackboardValue>;
  traces: AiTraceEntry[];
  events: AiLabEvent[];
  runtime: AiRuntimeSnapshot;
  foodRemaining: number;
  waterRemaining: number;
  wellbeing: number;
  forestAlert: boolean;
  routeSurgeActive: boolean;
  rewindActive: boolean;
  checkpointEchoes: Array<{ animalId: string; x: number; y: number }>;
  stress: AiLabStressSnapshot;
  capabilities: AiLabCapabilitySnapshot;
};
