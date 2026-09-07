import type { DataRegistry } from "@gamekits/data";
import type { EventBus, GameEvent } from "@gamekits/event-bus";
import type { GasRuntime, GasTraceStore } from "@gamekits/gas";
import type { CameraController } from "@gamekits/camera-core";
import type { RendererAdapter } from "@gamekits/renderer-core";
import type { TcaTraceStore } from "@gamekits/tca";
import type { EntityId, GameWorld } from "@gamekits/world";
import type {
  AbyssCameraAdapter,
  AbyssInputState,
  AbyssRewardChoice,
  AbyssRunState,
  AbyssTraceEntry
} from "./types";

export type AbyssRuntimeState = {
  seed: string;
  world: GameWorld;
  dataRegistry: DataRegistry;
  eventBus: EventBus;
  renderer?: RendererAdapter | undefined;
  camera?: CameraController | undefined;
  cameraAdapter?: AbyssCameraAdapter | undefined;
  input: AbyssInputState;
  run: AbyssRunState;
  events: GameEvent[];
  timeline: AbyssTraceEntry[];
  gasRuntime: () => GasRuntime | undefined;
  gasTraceStore: GasTraceStore;
  tcaTraceStore: TcaTraceStore;
  activeRoomId?: string | undefined;
  activeWaveId?: string | undefined;
  activeRewardPoolId?: string | undefined;
  lastElapsed: number;
  playerEntity?: EntityId | undefined;
  roomEntity?: EntityId | undefined;
  setGasRuntime(runtime: GasRuntime): void;
  trace(entry: Omit<AbyssTraceEntry, "id" | "time"> & { time?: number }): void;
};

export function createAbyssRunState(rewards: AbyssRewardChoice[]): AbyssRunState {
  return {
    runId: "run.bootstrap",
    checkpointVersion: 1,
    roomIndex: 0,
    completedRoomIds: [],
    selectedRewardIds: [],
    gold: 0,
    recentLoot: [],
    rewardChoices: rewards,
    rewardOpen: false,
    completed: false,
    paused: false,
    inventoryOpen: false
  };
}

export function consumeMomentaryInput(input: AbyssInputState): void {
  input.attackRequested = false;
  input.skillPrimaryRequested = false;
  input.skillSecondaryRequested = false;
  input.dodgeRequested = false;
  input.interactRequested = false;
  input.inventoryToggleRequested = false;
  input.pauseToggleRequested = false;
  input.rewardChoiceRequested = undefined;
  input.cameraZoomDelta = undefined;
  input.cameraZoomX = undefined;
  input.cameraZoomY = undefined;
}

export function addRecentLoot(run: AbyssRunState, label: string): void {
  run.recentLoot.unshift(label);
  if (run.recentLoot.length > 5) {
    run.recentLoot.pop();
  }
}
