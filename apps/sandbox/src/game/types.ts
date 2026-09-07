import type { GameEvent } from "@gamekits/event-bus";
import type { GasActorRuntimeState, GasTraceEntry, GasTraceStore } from "@gamekits/gas";
import type { GameRuntime } from "@gamekits/game-runtime";
import type { TcaTraceEntry, TcaTraceStore } from "@gamekits/tca";
import type { EntityId } from "@gamekits/world";
import type {
  SandboxBuildingState,
  SandboxLinkState,
  SandboxObjectiveState,
  SandboxProductionState,
  SandboxResourceStorage,
  SandboxSceneObject,
  SandboxSceneRole,
  SandboxThreatState,
  SandboxWorkAssignment
} from "./components";

export type SandboxEntitySnapshot = {
  id: EntityId;
  objectId?: string | undefined;
  label?: string | undefined;
  role?: SandboxSceneRole | undefined;
  actorId?: string | undefined;
  renderObjectId?: string | undefined;
  x: number;
  y: number;
  vx: number;
  vy: number;
  resource?: number | undefined;
  materials?: number | undefined;
  capacity?: number | undefined;
  building?:
    | {
        buildingId: string;
        zone: string;
        priority: number;
        health: number;
        heat: number;
        throughput: number;
        mode: string;
      }
    | undefined;
  productionRate?: number | undefined;
  recipeId?: string | undefined;
  task?: string | undefined;
  taskStatus?: string | undefined;
  sourceObjectId?: string | undefined;
  targetObjectId?: string | undefined;
  cargo?: number | undefined;
  battery?: number | undefined;
  fatigue?: number | undefined;
  routeProgress?: number | undefined;
  threatIntensity?: number | undefined;
  objective?:
    | {
        objectiveId: string;
        phaseId: string;
        progressResources: number;
        targetResources: number;
        unlocked: string[];
      }
    | undefined;
  link?:
    | {
        fromObjectId: string;
        toObjectId: string;
        flow: number;
        status: string;
      }
    | undefined;
  selected?: boolean | undefined;
};

export type SandboxObjectiveSnapshot = {
  id: string;
  label: string;
  status: "waiting" | "running" | "complete";
  progress: number;
  detail: string;
};

export type SandboxTimelineEntry = {
  id: string;
  time: number;
  kind: "input" | "event" | "tca" | "gas" | "renderer" | "runtime";
  label: string;
  source: string;
  actorId?: string | undefined;
  entityId?: EntityId | undefined;
  status?: string | undefined;
};

export type SandboxModuleSummary = {
  id: string;
  label: string;
  status: string;
  detail: string;
};

export type SandboxContentSummary = {
  packs: number;
  types: number;
  documents: number;
  references: number;
  assetsLoaded: number;
  assetsFailed: number;
};

export type SandboxSnapshotOptions = {
  selectedActorId?: string | undefined;
  selectedEntityId?: EntityId | undefined;
  defaultSelection?: boolean | undefined;
};

export type SandboxSnapshot = {
  running: boolean;
  clock: ReturnType<GameRuntime["clock"]["snapshot"]>;
  entityCount: number;
  entities: SandboxEntitySnapshot[];
  selected?: { actorId?: string | undefined; entityId?: EntityId | undefined } | undefined;
  objective: SandboxObjectiveSnapshot;
  timeline: SandboxTimelineEntry[];
  moduleSummary: SandboxModuleSummary[];
  contentSummary: SandboxContentSummary;
  events: GameEvent[];
  tcaRuleCount: number;
  tcaTraces: TcaTraceEntry[];
  gasActors: GasActorRuntimeState[];
  gasTraces: GasTraceEntry[];
};

export type SandboxRuntime = {
  runtime: GameRuntime;
  events: GameEvent[];
  tcaTraceStore: TcaTraceStore;
  gasTraceStore: GasTraceStore;
  resolveEntityPosition(entityId: EntityId): { x: number; y: number } | undefined;
  captureSaveData(): SandboxSaveData;
  restoreSaveData(data: SandboxSaveData): void;
  snapshot(options?: SandboxSnapshotOptions): SandboxSnapshot;
};

export type SandboxSaveData = {
  version: "1.0.0";
  entities: SandboxSavedEntity[];
  gasActors: GasActorRuntimeState[];
};

export type SandboxSavedEntity = {
  objectId: string;
  sceneObject: SandboxSceneObject;
  position?: { x: number; y: number } | undefined;
  velocity?: { x: number; y: number } | undefined;
  storage?: SandboxResourceStorage | undefined;
  building?: SandboxBuildingState | undefined;
  production?: SandboxProductionState | undefined;
  work?: SandboxWorkAssignment | undefined;
  objective?: SandboxObjectiveState | undefined;
  threat?: SandboxThreatState | undefined;
  link?: SandboxLinkState | undefined;
};
