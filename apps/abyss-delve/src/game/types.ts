import type { GameRuntime } from "@gamekits/game-runtime";
import type { EntityId } from "@gamekits/world";
import type { GasRuntime, GasTraceStore } from "@gamekits/gas";
import type { TcaTraceStore } from "@gamekits/tca";
import type { GameEvent } from "@gamekits/event-bus";
import type { CameraState2D, PointLike } from "@gamekits/camera-core";

export type AbyssInputState = {
  moveX: number;
  moveY: number;
  held: {
    up: boolean;
    down: boolean;
    left: boolean;
    right: boolean;
  };
  aimX: number;
  aimY: number;
  cameraZoomDelta?: number | undefined;
  cameraZoomX?: number | undefined;
  cameraZoomY?: number | undefined;
  attackRequested: boolean;
  skillPrimaryRequested: boolean;
  skillSecondaryRequested: boolean;
  dodgeRequested: boolean;
  interactRequested: boolean;
  inventoryToggleRequested: boolean;
  pauseToggleRequested: boolean;
  rewardChoiceRequested?: string | undefined;
  gameplayBlocked: boolean;
};

export type AbyssCameraAdapter = {
  applyCameraState(state: CameraState2D): void;
  worldToScreen?(point: PointLike): PointLike;
  screenToWorld?(point: PointLike): PointLike;
};

export type AbyssTraceEntry = {
  id: string;
  time: number;
  kind: "input" | "combat" | "gas" | "tca" | "loot" | "reward" | "runtime" | "save";
  label: string;
  actorId?: string | undefined;
  entityId?: EntityId | undefined;
  payload?: unknown;
};

export type AbyssRewardChoice = {
  id: string;
  label: string;
  detail: string;
  effect: "damage" | "health" | "energy";
  amount: number;
  selected: boolean;
};

export type AbyssRunState = {
  runId: string;
  checkpointVersion: number;
  roomIndex: number;
  completedRoomIds: string[];
  selectedRewardIds: string[];
  gold: number;
  recentLoot: string[];
  rewardChoices: AbyssRewardChoice[];
  rewardOpen: boolean;
  completed: boolean;
  paused: boolean;
  inventoryOpen: boolean;
  selectedReward?: string | undefined;
};

export type AbyssEntitySnapshot = {
  id: EntityId;
  actorId?: string | undefined;
  label: string;
  role: string;
  faction?: string | undefined;
  x: number;
  y: number;
  health?: number | undefined;
  maxHealth?: number | undefined;
  lootKind?: string | undefined;
  lootLabel?: string | undefined;
};

export type AbyssContentSummary = {
  types: number;
  documents: number;
  references: number;
  activeRoomId?: string | undefined;
  activeWaveId?: string | undefined;
  activeRewardPoolId?: string | undefined;
  documentsByType: Array<{
    type: string;
    count: number;
  }>;
};

export type AbyssActorInspectorSnapshot = {
  actorId: string;
  entityId?: EntityId | undefined;
  definitionId: string;
  attributes: Record<string, { current: number; base: number }>;
  tags: string[];
  activeEffects: Array<{
    id: string;
    effectId: string;
    expiresAt?: number | undefined;
    nextTickAt?: number | undefined;
  }>;
  abilities: Array<{
    id: string;
    cooldownUntil: number;
  }>;
};

export type AbyssSnapshot = {
  running: boolean;
  clock: ReturnType<GameRuntime["clock"]["snapshot"]>;
  objective: {
    label: string;
    remainingEnemies: number;
    completed: boolean;
    roomId?: string | undefined;
    roomIndex: number;
  };
  player: {
    health: number;
    maxHealth: number;
    energy: number;
    maxEnergy: number;
    gold: number;
    inventoryOpen: boolean;
    paused: boolean;
  };
  skills: Array<{
    id: string;
    key: string;
    label: string;
    cooldownRemainingMs: number;
    ready: boolean;
  }>;
  pickupPrompt?: {
    label: string;
    distance: number;
  };
  rewardOpen: boolean;
  rewardChoices: AbyssRewardChoice[];
  entities: AbyssEntitySnapshot[];
  recentLoot: string[];
  contentSummary: AbyssContentSummary;
  actorInspectors: AbyssActorInspectorSnapshot[];
  checkpoint: {
    runId: string;
    version: number;
    roomIndex: number;
    completedRooms: number;
    selectedRewards: number;
  };
  camera?: {
    x: number;
    y: number;
    zoom: number;
    displayX: number;
    displayY: number;
    mode: string;
  };
  timeline: AbyssTraceEntry[];
  events: GameEvent[];
  gasTraces: ReturnType<GasTraceStore["list"]>;
  tcaTraces: ReturnType<TcaTraceStore["list"]>;
};

export type AbyssRuntime = {
  runtime: GameRuntime;
  gasRuntime: () => GasRuntime | undefined;
  tcaTraceStore: TcaTraceStore;
  gasTraceStore: GasTraceStore;
  input: AbyssInputState;
  run: AbyssRunState;
  screenToWorld(point: { x: number; y: number }): { x: number; y: number };
  trace(entry: Omit<AbyssTraceEntry, "id" | "time"> & { time?: number }): void;
  captureCheckpoint(): import("./save/checkpoint-types").AbyssCheckpointData;
  restoreCheckpoint(checkpoint: import("./save/checkpoint-types").AbyssCheckpointData): void;
  snapshot(): AbyssSnapshot;
};
