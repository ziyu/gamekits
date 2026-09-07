import type { AssetDiagnosticEvent, AssetLoaderAdapter, AssetManager } from "@gamekits/asset";
import type { CreateGameAudioOptions, GameAudio } from "@gamekits/audio-core";
import type { AudioBackend } from "@gamekits/audio-core/backend";
import type { CameraController, CameraState2D, PointLike } from "@gamekits/camera-core";
import type { CreateCombatModuleConfig, CombatHandle } from "@gamekits/combat";
import type { GameModule } from "@gamekits/core";
import type { DataPack, DataRegistry, DataTypeDefinition } from "@gamekits/data";
import type {
  DevToolsCommandDefinition,
  DevToolsDataSource,
  DevToolsPanelDefinition,
  DevToolsRuntime,
  DevToolsRuntimeOptions,
  DevToolsUiOptions
} from "@gamekits/devtools";
import type { DriverBootContext, DriverRegistry, GameDriver } from "@gamekits/driver-core";
import type { GasHandle, GasRuntime, GasTraceStore } from "@gamekits/gas";
import type { GameInstallContext, GameRuntime } from "@gamekits/game-runtime";
import type { InputDevice, InputRouter, InputSourceAdapter } from "@gamekits/input-core";
import type { CreateAiModuleOptions, AiHandle } from "@gamekits/ai-core";
import type { CreateAnimatorModuleOptions, AnimatorHandle } from "@gamekits/animator-core";
import type {
  MultiplayerClientReplicationOptions,
  MultiplayerModuleOptions,
  MultiplayerPresentationBridgeOptions,
  MultiplayerRuntime
} from "@gamekits/multiplayer-core";
import type {
  PhysicsBackendAdapter,
  PhysicsEventPolicy,
  PhysicsHandle,
  PhysicsInterpolationStore,
  PhysicsSceneConfig,
  PhysicsTraceStore,
  PhysicsWorldBindings
} from "@gamekits/physics-core";
import type { PlatformRuntime } from "@gamekits/platform-core";
import type { CreateNavigationModuleOptions, NavigationHandle } from "@gamekits/navigation-core";
import type { RendererAdapter, RendererBootContext } from "@gamekits/renderer-core";
import type {
  SaveCodec,
  SaveCompatibilityMetadata,
  SaveContributor,
  SaveContributorPolicy,
  SaveManager,
  SaveMigrationRegistry,
  SaveStore,
  SaveVersion
} from "@gamekits/save";
import type { TcaDefinitionSet, TcaHandle, TcaTraceStore, TcaRuntime } from "@gamekits/tca";
import type { UiRuntime } from "@gamekits/ui-core";
import type {
  AppAdapterRegistry,
  AppServiceFactory,
  AppServiceFactoryContext
} from "../definition/types";
import type { AppConfigSource, AppStandardServiceId } from "../runtime/types";

export type StandardAppServiceState = {
  platform?: PlatformRuntime;
  drivers?: DriverRegistry;
  data?: DataRegistry;
  assets?: AssetManager;
  audio?: GameAudio;
  renderer?: RendererAdapter;
  input?: InputRouter;
  multiplayer?: MultiplayerRuntime;
  game?: GameRuntime;
  ui?: UiRuntime;
  save?: SaveManager;
  devtools?: DevToolsRuntime;
  combat?: CombatHandle;
  navigation?: NavigationHandle;
  ai?: AiHandle;
  animator?: AnimatorHandle;
};

export type StandardServiceBuildContext<TContext> = Omit<
  AppServiceFactoryContext<TContext>,
  "services"
> & {
  adapters: AppAdapterRegistry;
  serviceDefinitions: AppServiceFactoryContext<TContext>["services"];
  state: StandardAppServiceState;
};

export type CreateStandardAppProfileOptions<TContext> = {
  id: string;
  configSources?: AppConfigSource[] | undefined;
  adapters?: AppAdapterRegistry | undefined;
  services?: StandardAppProfileOptions<TContext> | undefined;
  extensions?: Record<string, AppServiceFactory<TContext>> | undefined;
  expose?(ctx: StandardServiceBuildContext<TContext>): void;
};

export type StandardAppProfileOptions<TContext> = {
  platform?: StandardPlatformOptions<TContext> | undefined;
  drivers?: StandardDriverOptions<TContext> | undefined;
  data?: StandardDataOptions<TContext> | undefined;
  renderer?: StandardRendererOptions<TContext> | undefined;
  assets?: StandardAssetOptions<TContext> | undefined;
  audio?: StandardAudioOptions<TContext> | undefined;
  input?: StandardInputOptions<TContext> | undefined;
  multiplayer?: StandardMultiplayerOptions<TContext> | undefined;
  game?: StandardGameOptions<TContext> | undefined;
  ui?: StandardUiOptions<TContext> | undefined;
  save?: StandardSaveOptions<TContext> | undefined;
  devtools?: StandardDevToolsProfileOptions<TContext> | undefined;
};

export type StandardValue<TValue, TContext> =
  | TValue
  | ((ctx: StandardServiceBuildContext<TContext>) => TValue);

export type StandardAdapterRef<TValue> = string | TValue;

export type StandardPlatformOptions<_TContext> = {
  adapter: StandardAdapterRef<PlatformRuntime>;
};

export type StandardDriverOptions<TContext> = {
  registry?: StandardValue<DriverRegistry, TContext> | undefined;
  drivers: StandardValue<GameDriver[], TContext>;
  boot?(ctx: StandardServiceBuildContext<TContext>, driver: GameDriver): DriverBootContext;
};

export type StandardDataOptions<TContext> = {
  registry: StandardValue<DataRegistry, TContext>;
  types?(ctx: StandardServiceBuildContext<TContext>): DataTypeDefinition[];
  dataPacks?(ctx: StandardServiceBuildContext<TContext>): DataPack[];
};

export type StandardRendererOptions<TContext> = {
  adapter?: StandardAdapterRef<RendererAdapter> | undefined;
  driver?: string | undefined;
  boot?(ctx: StandardServiceBuildContext<TContext>): RendererBootContext | undefined;
};

export type StandardAssetOptions<TContext> = {
  manager?: StandardValue<AssetManager, TContext> | undefined;
  maxConcurrentLoads?: number;
  maxResidentAssets?: number;
  maxResidentBytes?: number;
  dispose?: boolean;
  adapter?: StandardValue<AssetLoaderAdapter, TContext> | undefined;
  driver?: string | undefined;
  onDiagnostic?(event: AssetDiagnosticEvent): void;
  dataRegistry?(ctx: StandardServiceBuildContext<TContext>): DataRegistry | undefined;
  preloadGroups?(ctx: StandardServiceBuildContext<TContext>): string[] | undefined;
};

export type StandardAudioOptions<TContext> = {
  gameAudio?: StandardValue<GameAudio, TContext> | undefined;
  backend?: StandardValue<AudioBackend, TContext> | undefined;
  driver?: string | undefined;
  config?:
    | StandardValue<Omit<CreateGameAudioOptions, "backend" | "disposeBackend">, TContext>
    | undefined;
  disposeBackend?: boolean | undefined;
  dispose?: boolean | undefined;
};

export type StandardInputOptions<TContext> = {
  router: StandardValue<InputRouter, TContext>;
  configure?(ctx: StandardServiceBuildContext<TContext>, router: InputRouter): void;
  adapters?(ctx: StandardServiceBuildContext<TContext>, router: InputRouter): InputSourceAdapter[];
  driverSources?: StandardInputDriverSourceOptions[] | undefined;
};

export type StandardInputDriverSourceOptions = {
  driver?: string | undefined;
  source?: string | undefined;
  scope?: string | undefined;
  devices?: InputDevice[] | undefined;
};

export type StandardMultiplayerOptions<TContext> = {
  runtime: StandardValue<MultiplayerRuntime, TContext>;
  dispose?: boolean | undefined;
};

export type StandardUiOptions<TContext> = {
  runtime: StandardValue<UiRuntime, TContext>;
  style?: unknown;
  panels?(ctx: StandardServiceBuildContext<TContext>): Array<{
    id: string;
    title: string;
    kind: "panel" | "window" | "modal" | "overlay" | "hud" | "devtools";
    tags?: string[];
  }>;
  openPanels?(ctx: StandardServiceBuildContext<TContext>): string[] | undefined;
};

export type StandardSaveOptions<TContext> = {
  manager?: StandardValue<SaveManager, TContext> | undefined;
  store?: StandardValue<SaveStore, TContext> | undefined;
  codec?: StandardValue<SaveCodec, TContext> | undefined;
  migrations?: StandardValue<SaveMigrationRegistry, TContext> | undefined;
  serviceContext?: StandardValue<StandardSaveServiceContextOptions, TContext> | undefined;
  contributorPolicy?: StandardValue<SaveContributorPolicy, TContext> | undefined;
  contributors?(
    ctx: StandardServiceBuildContext<TContext>,
    manager: SaveManager
  ): SaveContributor[];
  appId?: StandardValue<string, TContext> | undefined;
  gameId?: StandardValue<string, TContext> | undefined;
  gameVersion?: StandardValue<string, TContext> | undefined;
  formatVersion: StandardValue<SaveVersion, TContext>;
  compatibility?: StandardValue<SaveCompatibilityMetadata, TContext> | undefined;
};

export type StandardSaveServiceContextKey = Exclude<AppStandardServiceId, "save">;

export type StandardSaveServiceContextOptions = {
  include?: StandardSaveServiceContextKey[] | undefined;
  exclude?: StandardSaveServiceContextKey[] | undefined;
  extra?: Record<string, unknown> | undefined;
};

export type StandardDevToolsOptions<TContext> = {
  enabled?: boolean | undefined;
  runtime?: StandardValue<DevToolsRuntime, TContext> | undefined;
  options?: StandardValue<DevToolsRuntimeOptions, TContext> | undefined;
  includeHostSource?: boolean | undefined;
  preset?: StandardDevToolsPreset | undefined;
  standardSources?: boolean | undefined;
  standardPanels?: boolean | undefined;
  includeSources?: StandardDevToolsSourceId[] | undefined;
  excludeSources?: StandardDevToolsSourceId[] | undefined;
  ui?: boolean | DevToolsUiOptions | undefined;
  dataSources?(ctx: StandardServiceBuildContext<TContext>): DevToolsDataSource[];
  panels?(ctx: StandardServiceBuildContext<TContext>): DevToolsPanelDefinition[];
  commands?(ctx: StandardServiceBuildContext<TContext>): DevToolsCommandDefinition[];
};

export type StandardDevToolsProfileOptions<TContext> = boolean | StandardDevToolsOptions<TContext>;

export type StandardDevToolsPreset = "minimal" | "standard";

export type StandardDevToolsSourceId =
  | "host"
  | "platform"
  | "drivers"
  | "data"
  | "assets"
  | "audio"
  | "renderer"
  | "input"
  | "multiplayer"
  | "game"
  | "combat"
  | "navigation"
  | "ai"
  | "animator"
  | "ui"
  | "save";

export type StandardGameOptions<TContext> = {
  runtime?: StandardValue<GameRuntime, TContext> | undefined;
  createRuntime?(
    ctx: StandardServiceBuildContext<TContext>,
    modules: Array<GameModule<GameInstallContext>>
  ): GameRuntime;
  modules?: StandardValue<Array<GameModule<GameInstallContext>>, TContext> | undefined;
  standardModules?: StandardGameModuleOptions<TContext> | undefined;
};

export type StandardGameModuleOptions<TContext> = {
  camera?: StandardCameraGameModuleOptions<TContext> | undefined;
  tca?: StandardTcaGameModuleOptions<TContext> | undefined;
  gas?: StandardGasGameModuleOptions<TContext> | undefined;
  multiplayer?: StandardMultiplayerGameModuleOptions<TContext> | undefined;
  physics?: StandardPhysicsGameModuleOptions<TContext> | undefined;
  combat?: StandardValue<CreateCombatModuleConfig, TContext> | undefined;
  navigation?: StandardValue<CreateNavigationModuleOptions, TContext> | undefined;
  ai?: StandardValue<CreateAiModuleOptions, TContext> | undefined;
  animator?: StandardValue<CreateAnimatorModuleOptions, TContext> | undefined;
};

export type StandardMultiplayerGameModuleOptions<TContext> = {
  id?: string | undefined;
  runtime?: StandardValue<MultiplayerRuntime, TContext> | undefined;
  commandKinds?: string[] | undefined;
  commandQueue?: MultiplayerModuleOptions<GameInstallContext>["commandQueue"] | undefined;
  authority?: MultiplayerModuleOptions<GameInstallContext>["authority"] | undefined;
  handleCommand?: MultiplayerModuleOptions<GameInstallContext>["handleCommand"];
  presentation?: StandardValue<MultiplayerPresentationBridgeOptions, TContext> | undefined;
  clientReplication?: StandardValue<
    MultiplayerClientReplicationOptions<any, any, any, GameInstallContext>,
    TContext
  >;
};

export type StandardPhysicsGameModuleOptions<TContext> = {
  id?: string | undefined;
  backend: StandardValue<PhysicsBackendAdapter, TContext>;
  scene?: StandardValue<PhysicsSceneConfig, TContext> | undefined;
  fixedDeltaMs?: number | undefined;
  maxSubSteps?: number | undefined;
  bindings?: StandardValue<PhysicsWorldBindings, TContext> | undefined;
  eventPolicy?: StandardValue<PhysicsEventPolicy, TContext> | undefined;
  traceStore?: StandardValue<PhysicsTraceStore, TContext> | undefined;
  handle?: StandardValue<PhysicsHandle, TContext> | undefined;
  interpolationStore?: StandardValue<PhysicsInterpolationStore, TContext> | undefined;
};

export type StandardCameraGameModuleOptions<TContext> = {
  id?: string | undefined;
  controller: StandardValue<CameraController, TContext>;
  inputEventType?: string | undefined;
  actions?: StandardValue<StandardCameraActionBinding[], TContext> | undefined;
  smoothing?: StandardValue<StandardCameraSmoothingOptions, TContext> | undefined;
  follow?: StandardValue<StandardCameraFollowOptions<TContext>, TContext> | undefined;
  sync?(
    ctx: StandardServiceBuildContext<TContext>,
    controller: CameraController,
    action: StandardCameraActionBinding | undefined,
    state: CameraState2D
  ): void;
  driver?: string | undefined;
  syncToDriver?: boolean | undefined;
};

export type StandardCameraFollowOptions<TContext> = {
  eventType?: string | undefined;
  stopEventType?: string | undefined;
  targetFromEvent?: ((event: { payload: unknown }) => string | number | undefined) | undefined;
  resolveTarget(
    ctx: StandardServiceBuildContext<TContext>,
    targetEntity: string | number
  ): PointLike | undefined;
};

export type StandardCameraActionBinding = {
  actionId: string;
  phases?: string[] | undefined;
  pan?: { x?: number | undefined; y?: number | undefined } | undefined;
  zoom?:
    | {
        delta?: number | undefined;
        wheel?: boolean | undefined;
        anchorFromInput?: boolean | undefined;
      }
    | undefined;
};

export type StandardCameraSmoothingOptions = {
  enabled?: boolean | undefined;
  stiffness?: number | undefined;
  positionEpsilon?: number | undefined;
  zoomEpsilon?: number | undefined;
  rotationEpsilon?: number | undefined;
};

export type StandardTcaGameModuleOptions<TContext> = {
  id?: string | undefined;
  dataRegistry?: ((ctx: StandardServiceBuildContext<TContext>) => DataRegistry) | undefined;
  ruleKind?: string | undefined;
  definitions?: StandardValue<TcaDefinitionSet, TContext> | undefined;
  traceStore?: StandardValue<TcaTraceStore, TContext> | undefined;
  handle?: StandardValue<TcaHandle, TContext> | undefined;
  onRuntime?(ctx: StandardServiceBuildContext<TContext>, runtime: TcaRuntime): void;
};

export type StandardGasGameModuleOptions<TContext> = {
  id?: string | undefined;
  dataRegistry?: ((ctx: StandardServiceBuildContext<TContext>) => DataRegistry) | undefined;
  traceStore?: StandardValue<GasTraceStore, TContext> | undefined;
  handle?: StandardValue<GasHandle, TContext> | undefined;
  onRuntime?(ctx: StandardServiceBuildContext<TContext>, runtime: GasRuntime): void;
};
