# App Host 模块设计

## 定位

App Host 是 GameKits 的应用组合层。它负责把 Platform、Driver、Data、Asset、Renderer、Audio、Input、Multiplayer、GameRuntime、UI、Save、DevTools 等应用服务装配成一个可启动、可停止、可观察、可扩展的游戏应用实例。

App Host 不是 gameplay runtime，也不是具体平台 adapter。它解决的是“上层如何无痛启动游戏应用，只关心具体游戏逻辑”的问题。

相关包：

- `@gamekits/app-host`

## 设计目标

App Host 提供统一能力管理：

- 统一服务注册和访问。
- 统一生命周期编排。
- 统一配置读取和覆盖。
- 统一平台差异处理入口。
- 统一诊断、debug snapshot 和 DevTools 接入。
- 统一装卸、热重载和测试夹具能力。

上层 game app 应能主要声明：

- 使用哪些 adapter。
- 注册哪些 DataPack。
- 安装哪些 GameModule。
- 启动在哪个 viewport / window / platform profile。
- 覆盖哪些配置。

而不是在入口文件里手写一长串初始化顺序。

## 与 GameRuntime 的边界

`@gamekits/game-runtime` 继续保持薄内核，只管理 gameplay lifecycle：

- world
- eventBus
- clock
- rng
- systems
- GameModule install
- start / stop / tick

App Host 管理应用级 lifecycle：

- Platform boot
- Driver boot / resize / dispose
- DataRegistry 创建、DataType 注册和已物化 DataPack 注册
- AssetManager 创建和 preload pipeline
- Renderer boot / resize / destroy
- GameAudio 的 update/unlock/suspend/resume/dispose；Driver 提供的共享 AudioBackend slice 仍由 Driver 独占 native runtime 销毁权
- Input adapter start / stop
- Multiplayer facade / backend lifecycle / diagnostics
- UI / DevTools mount
- GameRuntime 创建和挂载

GameRuntime 不直接拥有 driver、renderer、input、platform、asset、data、multiplayer connection。App Host 可以把这些能力作为 services 组合给 app、GameModule factory 或 bridge module 使用。

Camera、Physics、Combat、TCA、GAS、AI、Navigation、Animator、multiplayer command bridge、gameplay save capture 等能力更接近游戏会话模块：它们通常需要读写 world、监听 EventBus、注册 system、理解 actor/rule/rig/physics scene/command 等玩法上下文。App Host 可以提供 renderer/audio/input/data/save manager/multiplayer facade 等依赖，但不应该把这些 gameplay runtime 直接做成默认标准服务。

App Host 可以提供标准 GameModule helper 来减少装配代码，例如 Camera、Physics、Combat、TCA、GAS、AI、Navigation、Animator 和 Multiplayer command bridge 的标准启动方式。这些 helper 属于应用组合便利层：它们可以读取 profile 参数、接入 services、注册 GameRuntime module，并把 renderer/audio/input/data/multiplayer bridge 或 backend adapter 注入进去；但它们不把 gameplay 能力提升为 Host service。以 camera 为例，标准 helper 可以提供输入映射、平滑、renderer sync 和 follow target resolver，resolver 仍由 app/game context 提供，Host 不直接理解业务 entity 位置。

## Host Runtime

```ts
export type AppHost = {
  id: string;
  services: AppServiceRegistry;
  config: AppConfigRuntime;
  diagnostics: AppDiagnostics;

  boot(): Promise<void>;
  start(): Promise<void>;
  tick(delta: number, timestamp?: number): void;
  stop(): Promise<void>;
  dispose(): Promise<void>;
  snapshot(): AppHostSnapshot;
};
```

生命周期语义：

- `boot()`：创建和启动外部依赖、adapter、资源预加载、UI mount 等异步准备。
- `start()`：启动 gameplay runtime、input routing 或平台主循环。
- `tick(delta, timestamp?)`：推进一帧已启动的 service。标准 Input service 在这里产出稳定帧节奏的 `held` action，标准 Game service 在这里推进 `GameRuntime.tick(delta)`。上层应用只调用 Host tick，不直接调用 InputRouter 或 GameRuntime 的内部推进细节。
- `stop()`：暂停 gameplay runtime、input action、frame loop，但保留已 boot 的资源。
- `dispose()`：按反向依赖顺序释放 adapter、事件订阅、DOM、资源句柄和平台监听。

`boot()` 和 `dispose()` 可以是异步；`GameRuntime.start()` 仍保持同步。

## Service Registry

App Host 通过 `services.xxx` 提供标准能力访问，也支持未来扩展注册。

```ts
export type AppServiceKey<TService> = {
  id: string;
  optional?: boolean;
  description?: string;
};

export type AppServiceRegistry = {
  platform?: PlatformRuntime;
  drivers?: DriverRegistry;
  data?: DataRegistry;
  assets?: AssetManager;
  audio?: GameAudio;
  renderer?: RendererAdapter;
  input?: InputRouter;
  multiplayer?: MultiplayerFacade;
  game?: GameRuntime;
  ui?: UiRuntime;
  save?: SaveManager;
  devtools?: DevToolsRuntime;

  has<TService>(key: AppServiceKey<TService>): boolean;
  get<TService>(key: AppServiceKey<TService>): TService | undefined;
  require<TService>(key: AppServiceKey<TService>): TService;
  register<TService>(binding: AppServiceBinding<TService>): void;
  unregister<TService>(key: AppServiceKey<TService>): void;
  binding<TService>(key: AppServiceKey<TService>): AppServiceBinding<TService> | undefined;
  bindings(): AppServiceBinding[];
  descriptors(): AppServiceDescriptor[];
};
```

标准能力必须能通过 `services.data` 这类直观入口访问；扩展能力通过 key 注册，例如：

- `devtools.traceStore`
- `ui.windowRegistry`
- `save.manager`
- `editor.workspace`
- `mod.mountRegistry`
- `telemetry.client`
- `driver.phaser`
- `driver.three`

缺失 required service 必须抛稳定错误。optional service 必须让调用方显式降级。

## Service Lifecycle

App Host 管理的每个 service 都通过统一 Service Binding 进入 lifecycle。内置服务和扩展服务都使用同一套 binding，不允许 Host 对内置服务写一套特殊分支、对扩展服务再写另一套机制。

底层服务对象不需要为 Host 改造接口。例如 `DataRegistry` 不需要新增 `start()`，`RendererAdapter` 不需要实现 Host 私有协议，`InputRouter` 不需要感知 App Host。Host 通过 binding 描述服务实例如何进入生命周期。

```ts
export type AppServiceBinding<TService> = {
  key: AppServiceKey<TService>;
  service: TService;
  lifecycle: AppServiceLifecycle;
};
```

App Host 管理的每个 binding 可以实现统一 lifecycle port：

```ts
export type AppLifecyclePhase = "registered" | "booted" | "started" | "stopped" | "disposed";

export type AppServiceLifecycle = {
  id: string;
  dependencies?: string[];
  boot?(ctx: AppHostContext): Promise<void> | void;
  start?(ctx: AppHostContext): Promise<void> | void;
  stop?(ctx: AppHostContext): Promise<void> | void;
  tick?(ctx: AppHostContext, frame: AppFrame): void;
  dispose?(ctx: AppHostContext): Promise<void> | void;
  snapshot?(): unknown;
};
```

内置标准服务不暴露一组 `createXxxService` 公共 factory。App Host 内部维护模块级标准服务定义表，每个定义同时描述：

- 从 `AppProfile.standard` 读取哪些参数。
- 如何把底层对象或 adapter 包装成 `AppServiceBinding`。
- lifecycle 的 `boot/start/stop/dispose/snapshot` 行为。

标准服务定义表只初始化一次，不持有 app 运行时状态。每次 app composition 的共享状态由 `createConfiguredAppHost` 创建并传入，确保不同 Host 实例之间不会泄漏 services、adapter 句柄或 context。

应用侧通常只通过 `createStandardAppProfile` 提供参数；扩展服务则直接提供 `AppServiceBinding` 或 profile extension。标准服务和扩展服务最终都会进入同一个 Service Registry 和 lifecycle coordinator。

生命周期规则：

- `boot` 按 dependency 拓扑顺序执行。
- `dispose` 按反向顺序执行。
- `start` 不应隐式重新 boot。
- `stop` 不释放长期资源，只停止运行行为。
- 任一阶段失败时，Host 必须能报告失败 service、phase、error code 和已完成阶段。
- 每个内置服务也必须产生 service snapshot，哪怕该服务的 `start` 或 `stop` 是 no-op。

典型依赖：

```txt
platform
→ drivers
→ data
→ renderer
→ assets
→ input
→ game
→ ui
→ devtools
```

依赖顺序不是硬编码固定链条。Host 应允许 app profile 或 service descriptor 声明依赖。

## Driver 启动边界

Driver 是 App Host 管理的应用级服务，用于统一持有 Phaser、Three.js 等外部运行时。Driver 可以从同一个外部 runtime 暴露 renderer、asset loader、input source、camera sync、physics backend 等 GameKits adapter。

App Host profile 负责选择标准服务使用哪个 driver adapter：

```txt
driver.phaser
→ renderer service uses driver.phaser.adapters.renderer
→ assets service uses driver.phaser.adapters.assetLoader
→ audio service binds GameAudio to driver.phaser.adapters.audio (AudioBackend)
→ input service uses driver.phaser.adapters.inputSource
→ camera module uses driver.phaser.adapters.camera
→ animator module uses driver.phaser.adapters.animation
→ physics module uses driver.phaser.adapters.physics
```

约束：

- App Host 管理 Driver lifecycle，但不理解 Phaser / Three 原生类型。
- Renderer、Input、Asset、Camera 仍通过各自 core protocol 交互。
- Camera/Physics/TCA/GAS 等 gameplay 会话能力仍通过标准 GameModule helper 安装，不因为 Driver 暴露 camera 或 physics adapter 就变成 Host service。
- 多 Driver 同时存在时，profile 必须显式选择每个标准服务使用的 driver adapter。
- App Host 不理解 Phaser / Three 原生类型；具体 app presentation、Editor 后端专属面板或 DevTools renderer plugin 需要 native control path 时，应显式依赖对应 Driver / Adapter 包。

## 配置系统

App Host 负责统一处理全局配置、平台配置和游戏配置。

配置来源：

- 默认 framework config。
- game app config。
- platform profile config。
- user settings。
- command line / URL / launch args。
- test override。
- editor/devtools override。

配置合并必须可追踪：

```ts
export type AppConfigRuntime = {
  get<T>(path: string): T | undefined;
  require<T>(path: string): T;
  setOverride(path: string, value: unknown, source: string): void;
  snapshot(): AppConfigSnapshot;
};
```

配置原则：

- gameplay module 不读取浏览器 URL、Tauri env 或 localStorage。
- platform 差异通过 platform profile 和 services 表达。
- 配置覆盖来源要可 debug，能解释最终值来自哪里。
- 敏感配置不能进入普通 EventBus payload。

## 平台差异处理

App Host 不替代 Platform 模块。Platform 仍负责底层平台能力抽象。

App Host 负责选择和组合 platform profile：

- `web`
- `tauri`
- `editor`
- `test`
- `headless`
- `demo`

profile 决定：

- adapter 创建策略。
- 资源来源解析策略。
- 默认窗口和 viewport。
- 是否启用 DevTools。
- 是否启用本地文件能力。
- 是否启用输入 scope gate。
- 是否启用 crash/diagnostic reporter。

## Data / Asset 启动边界

App Host 负责把已经可用的 DataType、DataPack 和 AssetManager 按应用启动顺序组合起来，但不定义 DataPack source/loader/manifest 体系。内容从哪里来、如何解压、如何处理实际资源文件和脚本，属于 Content Package System、平台 adapter、编辑器导入器或 app/profile 层。

标准启动顺序：

```txt
resolve profile/app config
→ create DataRegistry
→ register framework/app/plugin DataTypeDefinition
→ receive materialized DataPack[] from app/profile/content package
→ register DataPack into DataRegistry
→ create AssetManager
→ register assets from DataRegistry
→ run asset preload plan
→ create GameRuntime with services and standard modules
```

App Host 在这个边界上的职责：

- 从 app definition / profile / test override 收集 DataTypeDefinition。
- 接收已经物化的 DataPack，并把它们注册到 DataRegistry。
- 记录 data pack、entry、reference 级 diagnostics。
- 将 DataRegistry snapshot 和 Asset preload state 暴露给 Host snapshot。
- 在 boot 失败时报告失败阶段和可定位错误。

App Host 不应做的事：

- 不解释 hero、monster、building、rule、ability 等业务数据结构。
- 不定义 DataPackSource / DataPackLoader / DataPackManifest。
- 不让 AssetManager 直接读取 DataPack。
- 不把资源加载失败写成 DataRegistry 校验错误。

这条边界让普通 app 可以通过配置启动已物化数据包和资源预加载，同时保留编辑器、测试、远程配置、mod 和平台 adapter 的扩展空间。

完整 Content Package System 是更高层能力。未来内容包可以同时包含 DataPack、实际资源文件、脚本、localization、地图、patch、mod metadata 和权限声明。App Host 可以编排内容包挂载生命周期，但不应在当前 Data/App Host 层提前实现一套会被内容包替换的 DataPack 加载系统；内容包应通过独立协议把不同 section 分发给 Data、Asset、Script、Localization 等模块。

## Diagnostics / Debug Snapshot

App Host 必须为统一 debug 提供低频诊断入口。

```ts
export type AppHostSnapshot = {
  id: string;
  phase: AppLifecyclePhase;
  services: AppServiceSnapshot[];
  config: AppConfigSnapshot;
  diagnostics: AppDiagnosticEvent[];
};
```

诊断原则：

- Host diagnostics 用于生命周期、服务状态、配置来源、adapter boot 和错误。
- EventBus 用于 gameplay/runtime 低频事实。
- 高频输入、render patch、world position update 不进入 Host diagnostics。
- DevTools 可以同时订阅 Host diagnostics、EventBus、Data trace、TCA trace 和 profiler。

## Lifecycle Profiling

App Host 是应用启动、停止和外部 runtime 生命周期的编排层，因此它也是 service lifecycle 性能归因的边界。Host profiler 不替代 DevTools；它只把可观察 span 暴露给 DevTools 或测试夹具。

Host lifecycle profiler 应覆盖：

- service `boot/start/stop/dispose` duration。
- service dependency waterfall。
- driver boot / resize / dispose。
- renderer boot / resize / destroy。
- asset preload plan / load group。
- input start / stop。
- UI / DevTools mount。
- GameRuntime start / stop / tick bridge。

Profiler 规则：

- Host service binding 不需要强制实现 profiler 接口；Host lifecycle coordinator 可以在调用 lifecycle hook 外层创建 span。
- profiler disabled 时，lifecycle coordinator 只执行原本逻辑，不额外构建 waterfall 数据。
- lifecycle span failure 必须同时保留原始 error，并在 Host diagnostics 中报告 service id、phase 和 error code。
- Host snapshot 可以展示 lifecycle profiling summary，但不保存完整长期历史。
- DevTools 可以展示 service waterfall 和 over-budget service；Host 本身不因为预算超时自动跳过、重试或重排服务。
- 扩展 service 与内置 service 使用同一套 lifecycle span，不为内置服务写特殊性能路径。

## Game App Definition

App Host 支持声明式 app definition。Definition 描述 app 需要什么，profile 描述当前运行环境如何提供这些能力。

```ts
export type GameAppDefinition = {
  id: string;
  configSources?: AppConfigSource[];
  services: GameAppServiceDefinition[];
  metadata?: Record<string, unknown>;
};

export type GameAppServiceDefinition<TConfig = unknown> = {
  id: string;
  config?: TConfig;
  dependencies?: string[];
  enabled?: boolean;
};
```

Game app 关注自己的玩法：

- DataPack。
- GameModule。
- UI windows。
- TCA/GAS definitions。
- 游戏配置。

Host 关注如何把这些东西在当前平台启动起来。

Definition 不能直接持有 DOM、Phaser scene、Tauri handle、browser window 等运行时句柄。此类外部对象进入 profile context。

## App Profile / Adapter Params

Profile 描述平台和运行环境差异，例如 `web`、`tauri`、`editor`、`headless`。同一个 `GameAppDefinition` 可以被不同 profile 启动。

Profile 不应该以 service factory registry 为核心。标准 service 怎么创建 binding 是 App Host 的职责；Profile 只提供 adapter、已有对象和少量创建参数。

```ts
export type AppProfile<TContext> = {
  id: string;
  configSources?: AppConfigSource[];
  adapters?: Record<string, unknown>;
  standard?: StandardAppProfileOptions<TContext>;
  extensions?: Record<string, AppExtensionFactory<TContext>>;
};

export type StandardAppProfileOptions<TContext> = {
  platform?: { adapter: PlatformRuntime | string };
  data?: { registry: DataRegistry | ((ctx) => DataRegistry) };
  renderer?: { adapter: RendererAdapter | string; boot?: (ctx) => RendererBootContext };
  assets?: { manager: AssetManager | ((ctx) => AssetManager) };
  input?: {
    router: InputRouter | ((ctx) => InputRouter);
    adapters?: (ctx, router) => InputSourceAdapter[];
  };
  game?: { runtime?: GameRuntime | ((ctx) => GameRuntime); createRuntime?: (ctx) => GameRuntime };
  ui?: {
    runtime?: UiRuntime | ((ctx) => UiRuntime);
    style?: unknown;
  };
};
```

这让普通 app 入口可以只调用：

```ts
const configured = createConfiguredAppHost({
  app: gameAppDefinition,
  profile: webProfile,
  context: { mount }
});
```

设计原则：

- Definition 尽量可数据化、可序列化、可测试。
- Profile 承载 adapter 选择、DOM/Tauri/headless 句柄、平台默认配置和 service 参数。
- Adapter 可以无差别放入 `profile.adapters`，标准 service builder 按需读取自己关心的 adapter。
- UI style/theme 属于 React UI / app 层；Host 可以把不透明的 `style` 参数交给 UI shell，但不定义主题协议、不解释 CSS 或组件实现。
- 标准 service binding 由 App Host 创建，不由每个 app profile 手写。
- App 入口只提供无法配置化的外部上下文，并调用 `boot/start`。
- 缺失 standard service 参数或 adapter 必须抛稳定错误，不能静默跳过。
- 复杂 app 可以继续使用底层 `createAppHost({ services })`，声明式装配是默认路径，不是唯一逃生口。

## Standard Profile Helpers

App Host 应提供标准装配 helper，避免每个 app profile 重新手写内置服务 lifecycle：

```ts
const profile = createStandardAppProfile({
  id: "web",
  adapters: { platform, renderer },
  services: {
    platform: { adapter: "platform" },
    data: { registry },
    drivers: { drivers: [phaserDriver], boot },
    renderer: { driver: "phaser" },
    assets: { driver: "phaser" },
    input: { router, configure, adapters },
    game: { createRuntime }
  }
});
```

标准 helper 负责：

- 让 `AppProfile.standard` 承载 adapter 和服务参数。
- 通过 App Host 内部标准服务定义创建统一 `AppServiceBinding`。
- 透传 service definition 的 dependencies 和 config。
- 在一次 app composition 中维护标准 service state，供后续 service builder 读取。
- 统一 `services.xxx` 快捷入口和 lifecycle snapshot。

Profile 仍负责：

- 选择具体 adapter，例如 Web Platform、Phaser Renderer、DOM Input。
- 提供 DOM/Tauri/headless 等运行时上下文。
- 连接少量 app-specific hook，例如 renderer diagnostics 桥接、game runtime factory。

这条边界保证 profile 是“环境配置、adapter 选择和参数包”，不是另一套手写 Host。

## 与 Game Module 的边界

App Host 不应该把所有高层能力都变成 standard service。能力归属按以下规则判断：

- 需要平台、窗口、DOM、资源句柄、adapter boot/dispose 的能力，属于 App Service。
- 需要 world、tick、actor、rule、camera rig、physics scene、ability、save snapshot 等玩法上下文的能力，属于 Game Module。
- 只做协议和 controller 的包是 facade/toolkit，可以被 App Service 或 Game Module 使用，但不能因此自动成为 App Host standard service。

典型 App Service：

- Platform
- DataRegistry
- AssetManager
- RendererAdapter
- Input source adapters / InputRouter
- SaveManager / SaveStore / SaveCodec
- UI shell / DevTools shell

典型 Game Module：

- Camera controller / camera rig / camera input action
- Physics scene / physics world sync / contact event bridge
- Combat delivery / projectile module
- TCA runtime
- GAS runtime
- AI runtime / Navigation binding
- Animator controller / animation playback bridge
- gameplay save contributor / restore bridge
- gameplay-specific UI bindings

App Host 可以帮助 Game Module 无痛启动：`profile.standard.game.standardModules` 描述要启用的标准游戏模块，App Host 在创建 `game` service 时把这些模块解析成 `GameModule[]`，再传给 `game.createRuntime(ctx, modules)`。这些模块不是 App Service，不进入 Host service registry；它们的订阅、system 和 cleanup 仍跟随 GameRuntime lifecycle。

Save 的边界是混合型：`services.save` 可以作为 App Host 标准服务管理 slot、store、codec、migration 和 diagnostics；World、Physics、TCA、GAS、Camera 和具体游戏状态的 capture / restore 通过 SaveContributor 或标准 GameModule bridge 注册到 SaveManager。GameRuntime 不直接依赖 PlatformStorage、PlatformFileSystem 或 SaveStore。

标准 Save service 不能把 Host 里的所有 service 无差别暴露给 contributor。App Host 应提供可配置 service context，默认只给 contributor 暴露 Data、Assets 和 GameRuntime，具体游戏可以显式 include/exclude 其他服务或追加 `campaignId`、`profileId` 这类轻量上下文。Renderer、Input、UI、Platform 等运行时对象只有在明确 opt-in 时才进入 contributor context，避免保存逻辑不小心依赖表现层或平台私有对象。

标准 Save service 还应支持 contributor policy：app 可以按 contributor id、tag、scope 配置默认保存范围，单次 save/load 可以进一步选择范围。这样 autosave、checkpoint、debug snapshot、settings-only save 和 cloud sync 可以复用同一个 SaveManager，而不是复制多条保存流水线。

标准游戏模块用于减少重复装配代码，但不能模糊边界：

简单组合可以使用 `standardModules` 默认顺序。需要把 app intent、AI、contact/combat、checkpoint、replication、commit 等 module 插入标准模块之间时，app 应在 `game.modules(ctx)` 中按顺序调用公开的 standard module helper 和 app factory。App Host 不引入全局 phase catalog；headless composition test 必须固定 module/system id 顺序和逆序 cleanup。

- `camera` 标准游戏模块负责把已经归一化的 input action fact 转成 CameraController 目标状态，可选平滑插值显示状态，并通过 app/profile 提供的 sync hook 同步 renderer camera adapter 或 UI。
- `physics` 标准游戏模块负责从 DataRegistry/World 物化 body 与 collider，用 fixed timestep 推进 backend scene，写回 World transform/velocity，桥接低频 contact event，并在 GameRuntime dispose 时释放 backend scene。Profile 可以注入 `PhysicsHandle` 和 transient `PhysicsInterpolationStore`；App Host 只透传这些 facade，不读取物理或表现状态。
- `tca` 标准游戏模块负责从 DataRegistry 读取 `tca.rule`、编译规则、桥接 EventBus、写入 trace，并在 GameRuntime dispose 时清理订阅。
- `gas` 标准游戏模块负责从 DataRegistry 读取 GAS 定义、创建 ECS-backed GAS runtime、注册 effect tick system、写入 trace，并在 GameRuntime dispose 时释放。Profile 可以提供 `GasHandle`，让同一 GameRuntime 内的业务模块通过稳定 facade 使用该 runtime；handle 仍跟随 GameModule 绑定/解绑，不进入 `services.xxx`。
- `combat` 标准游戏模块负责把 DataRegistry、World、PhysicsHandle、GasHandle 和 app-injected target/relationship policy 传给 Combat runtime；它不理解具体武器、敌人或伤害公式。
- `navigation` 标准游戏模块负责加载 backend/layout、绑定 NavigationHandle、推进 request budget 和 cleanup；`ai` 标准模块再消费该 handle、app definitions 与 intent sink，不在 Host 内实现 agent 行为。
- `animator` 标准游戏模块负责把 DataRegistry、Driver/Renderer 提供的 AnimationPlaybackAdapter 与 app presentation parameter reader 组合成 Animator controller runtime；GameAudio 仍作为 App Service facade，由 presentation module 分别调用 music、sfx 或 dialogue 控制面。
- `multiplayer` 标准游戏模块负责从 `services.multiplayer` 或显式 facade 订阅归一化消息，把 command 入站队列放到 tick 边界处理；如果 profile 声明 presentation binding，则在 GameRuntime tick 中自动推进 core snapshot playback，没收到新 authoritative snapshot 的帧也继续 advance 既有 buffer，并通过 reusable presentation projector 根据声明的 `Network*` tracks 产出 typed presented values，再交给游戏提供的 apply hook。GameRuntime dispose 时释放订阅并重置 playback/projector。
- 标准游戏模块只能依赖稳定 facade、App Host services 和 profile 注入的定义，不能直接依赖 Phaser、DOM、Tauri 或具体 app 入口。

`createGameplayDevToolsCorrelation(...)` 是 App Host 的可选跨模块诊断组合 helper。它创建有界 TCA/GAS/Physics/Combat trace store，并为 Navigation、AI、Animator trace 与 Audio diagnostic 提供旁路 observer，统一写入一个 domain-neutral DevTools correlation source，再通过单一 `dispose()` 注销和释放组合资源；它不拥有 gameplay runtime，也不把 DevTools 依赖下推到 domain package。Audio 摘要使用 category、sourceId、eventId/trackId/lineId、instanceId 和 emitterId，而不是把 native channel identity 当作公共事实。默认映射只保留稳定白名单摘要，不透传任意 details/payload。游戏需要补充字段时显式提供小型 summary mapper，并可用统一 redaction hook 清理敏感内容；mapper、redactor、diagnostic reporter 或 DevTools bridge 失败只报告 warning diagnostic，不能中断玩法 trace 写入。

## Test Host

测试环境应能使用 headless Host 验证标准组合路径，而不是依赖具体浏览器、窗口系统或应用入口。

测试环境应能使用 headless Host：

- memory renderer
- memory platform
- fake asset loader
- fake physics backend
- deterministic clock
- deterministic input
- no DOM UI

这让复杂游戏 app 可以在不启动浏览器或 Tauri 的情况下验证 Data、Asset、Runtime、Physics、TCA、GAS 和 Save 组合。

`createHeadlessRenderer()` 和 `createMemoryAssetAdapter()` 是 protocol-compatible 组合 fixture。它们可以被 `createHeadlessHost()` 使用，也可以被需要保留共享 `GameAppDefinition` 的 app-specific headless/deterministic profile 直接注入标准 Renderer/Asset service。二者不解释 gameplay、不加载真实视觉 payload，也不代表生产 server renderer 或内容分发 backend。

## 设计约束

- App Host 不能把第三方库类型泄漏给 gameplay。
- App Host 可以组合 adapter，但 adapter 细节必须停留在 app/profile/adapter 层。
- App Host 不替代 GameModule；GameModule 仍是 gameplay 功能安装单位。
- App Host 不替代 Platform；Platform 仍是底层平台能力抽象。
- App Host 不替代 DevTools；它只提供统一可观察入口。
- App Host 不把所有模块硬编码进核心；标准 services 有快捷入口，扩展 services 通过 registry 注册。

## 最佳实践

### 模块集成

- Lifecycle 请求串行执行，成功 boot 不重复装配，stop 后可 start；boot/start 失败后应 dispose 并重新创建 Host。dispose 终态不允许重新启动，等待中的启动操作不能在 dispose 完成后复活 Host。
- boot/start 对失败依赖立即中止；stop/dispose 反序尝试所有服务再报告错误。标准 Driver 服务等待每个异步 hook，清理中的单个 Driver 失败不能阻止其他 Driver 释放。Host dispose 完成尝试后保持 disposed，各失败服务仍通过 diagnostics 和 snapshot 标明失败。

- App 应优先通过 GameAppDefinition + AppProfile 启动。Definition 描述需要什么能力，Profile 描述当前运行环境提供哪些 adapter、driver 和少量参数。
- 标准 service binding 由 App Host 内部定义表创建，profile 不应手写一大坨 service factory。扩展 service 使用同一套 registry/lifecycle，不走特殊分支。
- `services.xxx` 只暴露 App Service，例如 platform、data、assets、drivers、renderer、audio、input、multiplayer、ui、save、devtools；Camera/Physics/Combat/TCA/GAS/AI/Navigation/Animator/Multiplayer command bridge 等玩法会话能力通过标准 GameModule helper 注入 GameRuntime。
- Driver 由 App Host 管 lifecycle，Renderer/Input/Asset/Camera adapter 通过 Driver capability 选择；多个 Driver 并存时 profile 必须显式选择。
- Save service context 默认保持最小，只给 contributor 暴露必要服务；renderer/input/ui/platform 等对象必须显式 opt-in。
- Headless Host 是标准组合路径的测试入口。新增标准 service 或标准 game module helper 时，必须能在不启动浏览器/Tauri 的情况下测试生命周期和依赖顺序。
- 多 profile app 应复用同一份 Definition/service graph，并用 headless/memory adapter 提供非视觉 service；正式 server 的 platform、physics、multiplayer 和 runtime owner 通过 profile 参数注入，不把 memory fixture 写死为生产 backend。
- Authority app 使用 `game.modules(ctx)` 显式交错 standard/app modules 时，测试必须同时断言 module install order、system registration order、runtime handle unbind 和 cleanup reverse order。
- 跨 Combat + Multiplayer 的 kinematic record presentation 使用 `createStandardCombatKinematicProjectilePresentationTransition(...)`；该 helper 只组合 Combat sampler/reconciliation 与 Multiplayer Core 的 time-aligned handoff，不创建第二个 Combat/Multiplayer runtime，也不拥有 renderer object。类似跨领域标准组合应留在 App Host，不能迫使两个 domain package 互相依赖。
- 高互动 Physics Arena 的离散 predicted entity 通过标准 descriptor 的 `registerPredictedMember(...)` 注册；App Host 同时托管 predicted identity、island command/history、authority correlation matching 与 hard correction。App 只从 typed snapshot 解析 correlation/definition，不在 session callback 创建第二个 pending-spawn 或 ghost-body cleanup runtime。

### 模块使用

- App Host diagnostics 记录 service phase、dependencies、driver capabilities、recent errors 和 snapshot summary，不记录大 payload、native object 或每帧状态。
- 游戏和工具通过 `services.xxx` 读取应用级能力，通过 GameRuntime/standard GameModule helper 消费玩法会话能力；不要在业务代码里重新组装 Host 内部 service binding。
- 业务代码不要把 Host 当全局上帝对象。能通过 Data、World、EventBus、RendererAdapter、Input action、SaveContributor 等局部 facade 完成的事，不扩大到 Host 依赖。

## 候选会话恢复组合

`createSaveSessionController({ initial, createCandidate, onCleanupError? })` 是可选应用组合 helper。Session 提供自己的 SaveManager、可选 activate 和 dispose；helper 不拥有 renderer/platform/asset 的实现，也不把会话恢复塞入 GameRuntime。

```ts
const sessions = createSaveSessionController({
  initial: activeSession,
  createCandidate: (envelope) => createIsolatedSession(envelope)
});
// Frame loop 和 UI 使用 sessions.current() 获取当前会话。
const result = await sessions.load("checkpoint");
// result.cleanupError 表示已经切换成功，但旧会话清理存在问题。
await sessions.dispose();
```

读取/迁移、候选构造、恢复、activate、切换指针、旧会话清理顺序固定。候选 restore/activate 失败时释放候选并保留旧会话；候选不得复用旧 session 或 SaveManager。工厂必须隔离可变状态，未返回前的局部清理由工厂负责。Activation 的外部副作用仍需应用设计 staging 边界，不具备通用回滚语义。

操作串行化，dispose 为终态。切换后旧会话 dispose 失败通过 result.cleanupError 和可选旁路 reporter 暴露，不撤销成功的切换。构造和恢复使用同一个已捕获 envelope，不能在新会话中重新读取可能已变化的槽位。

### 模块集成

- 将 createCandidate 绑定到同一 GameAppDefinition 的独立 context/profile 装配，按 envelope 初始化 runtime seed/clock；共享内容只能是不可变数据或受显式 scope 保护的应用资源。
- 同一应用的候选和当前 SaveManager 共享应用持有的 IndexedDB store，以延续已读取的 revision；不同窗口使用各自的 store。App 拥有 store 的关闭，候选失败只销毁候选拥有的对象；不要销毁仍被当前会话使用的 store/driver。

### 模块使用

- Tick、UI command 和 Save 操作都从 current() 获取会话，避免切换后继续操作旧 World。
- load 期间由应用暂停自动保存和手动保存入口，避免旧会话继续向共享 store 写入；helper 的串行队列只覆盖其 load/dispose，不拦截直接调用 SaveManager 的操作。
- load 返回成功后再显示恢复完成；cleanupError 单独进入诊断，不能提示“存档加载失败”并再次应用同一进度。
