import type { AssetManager } from "@gamekits/asset";
import type { AppHost } from "@gamekits/app-host";
import type { CameraState2D } from "@gamekits/camera-core";
import type { DataRegistry } from "@gamekits/data";
import type { UiRuntime } from "@gamekits/ui-core";
import type { Root as ReactRoot } from "react-dom/client";
import type { SandboxRuntime, SandboxSnapshot } from "../game";

export type SandboxInspectorTab = "actor" | "runtime" | "content" | "rules" | "host";

export type SandboxTimelineFilter =
  | "all"
  | "input"
  | "event"
  | "tca"
  | "gas"
  | "renderer"
  | "runtime";

export type SandboxWorkbenchState = {
  selectedActorId?: string | undefined;
  selectedEntityId?: string | number | undefined;
  selectionCleared?: boolean | undefined;
  followedEntityId?: string | number | undefined;
  saveStatus?: string | undefined;
  activeInspectorTab: SandboxInspectorTab;
  timelineFilter: SandboxTimelineFilter;
};

export type SandboxUiHandles = {
  root: HTMLElement;
  reactRoot: ReactRoot;
  devtoolsReactRoot?: ReactRoot | undefined;
  uiRuntime: UiRuntime;
  stage: HTMLElement;
  devtoolsRoot: HTMLElement;
  rendererRoot: HTMLDivElement;
  threePreviewRoot: HTMLDivElement;
  sceneOverlay: HTMLElement;
  status: HTMLDivElement;
  objectiveLabel: HTMLElement;
  objectiveStatus: HTMLElement;
  objectiveProgress: HTMLElement;
  objectiveProgressBar: HTMLElement;
  objectiveDetail: HTMLElement;
  entityCount: HTMLElement;
  tick: HTMLElement;
  modules: HTMLElement;
  systems: HTMLElement;
  inputAction: HTMLElement;
  inputContext: HTMLElement;
  cameraPosition: HTMLElement;
  cameraZoom: HTMLElement;
  cameraMode: HTMLElement;
  selectedActor: HTMLElement;
  inspectorTabs: HTMLButtonElement[];
  inspectorBody: HTMLElement;
  timelineFilters: HTMLButtonElement[];
  timelineList: HTMLElement;
  lastAnimatedTimelineEntryId?: string | undefined;
  latestHost?: AppHost | undefined;
  latestDataRegistry?: DataRegistry | undefined;
  latestAssetManager?: AssetManager | undefined;
  latestSandbox?: SandboxRuntime | undefined;
  latestSnapshot?: SandboxSnapshot | undefined;
  latestCameraStatus?: SandboxCameraStatus | undefined;
  latestWorkbenchState?: SandboxWorkbenchState | undefined;
  lastSnapshotAt?: number | undefined;
  lastWorkbenchRenderAt?: number | undefined;
};

export type SandboxCameraStatus = CameraState2D;

export type SandboxInputStatus = {
  action: string;
  context: string;
};

export type SandboxPlatformStatus = {
  id: string;
  storage: string;
  fs: string;
};
