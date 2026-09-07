# 架构设计

## 核心方向

GameKits 采用“薄内核 + 成熟库 + 自定义协议 + Driver / Adapter”的架构。

成熟库负责底层能力，GameKits 负责稳定协议、组合边界、数据驱动和可解释性。

当第三方库只实现单个协议时，用 Adapter 接入；当第三方库本身拥有跨 renderer、asset、input、camera 等多个能力的完整运行时，用 Driver 统一持有并派生多个 Adapter。

## Core-first 语义所有权

每个领域的 `*-core`、facade 或基础协议包是该领域 GameKits 语义的唯一来源。它定义的领域对象、生命周期、状态、错误、snapshot、diagnostics 和 conformance 不能在 adapter、driver、backend 或 app 中再实现一套结构相似但独立推进的平行 runtime。具体包只能把第三方对象映射到 core 协议、持有第三方 native runtime，或组合 core 已提供的创建函数与 helper。

接入第三方能力前必须先判断：

- Core 已有概念和行为时，具体包必须复用 core 实现并只补映射；不能因为第三方也有同名概念，就绕过 core 重建 session、world、physics、renderer、input、camera、platform、save 等 facade。
- Core 已有协议但缺少真实 backend 能力时，由 adapter/driver 调用第三方实现该协议；第三方对象不成为新的业务事实源。
- 只有 core 没有、且能力确实是 provider/platform/native 专属时，才留在具体包的 typed native boundary。若它后来成为跨 backend 的稳定 GameKits 概念，应先通过 ADR 和真实使用证据上移到对应 core，再由各 adapter 实现。
- App 可以拥有玩法、内容和 provider-specific projection，但不能复制框架 core 的通用状态机或 lifecycle。发现 core 缺口时应修正 core 或明确 native escape hatch，不能用 app-local 平行实现长期绕过。

Core-first 不表示把第三方底层能力重写进 core。Room、matchmaker、物理求解器、renderer、文件系统或平台 SDK 仍由成熟库负责；core 只保持 GameKits 稳定语义和组合边界。

决策背景与跨包执行规则见 `docs/adr/0026-core-first-domain-semantic-ownership.md`。

## 总体分层

```txt
Game App
  ↓
App Host / Service Lifecycle
  ↓
Drivers / App Services
  ↓
Game Modules / DataPack
  ↓
Gameplay Framework
  ↓
Core Runtime
  ↓
Drivers / Adapters / Libraries
```

## 包结构

长期包结构方向如下：

```txt
packages/
  app-host/

  core/
  event-bus/
  game-runtime/
  world/
  world-koota/

  renderer-core/
  renderer-phaser/

  input-core/
  input-dom/
  input-tauri/

  camera-core/

  physics-core/
  character-controller/
  physics-rapier2d/
  physics-rapier3d/
  physics-matter/

  combat/
  ai-core/
  navigation-core/
  navigation-graph/
  navigation-grid/
  navigation-navmesh/
  navigation-recast/
  animator-core/
  audio-core/

  platform-core/
  platform-web/
  platform-tauri/

  driver-core/
  driver-phaser/
  driver-three/

  data/
  asset/
  tca/
  gas/
  multiplayer-core/
  multiplayer-memory/
  multiplayer-colyseus/
  ui-core/
  react-ui/
  save/
  save-indexeddb/
  devtools/
  devtools-ui/
  test-utils/
```

说明：

- `@gamekits/fx` 不作为独立业务包规划；Effect 可作为 Asset/Data/Save/Platform/Editor 等基础设施包内部实现选择。
- `@gamekits/animator-core` 只负责语义 Animator graph、controller、layer、transition、marker 和 playback snapshot；clip/mixer、粒子和 native object 仍由 Renderer Adapter / Driver 执行。它不把后端完整动画 API 包装进 Core。
- Combat、AI、Navigation、Animator 和 Audio 都是可选玩法/表现基础包，不进入薄 GameRuntime 内核。新增边界见 `docs/adr/0031-gameplay-foundation-packages-and-agent-ai.md`。
- `driver-phaser` 是 Phaser 的长期默认集成边界；Phaser 的 asset/input/camera/physics 能力收敛为 driver 内部 adapter，不再以独立单协议 package 暴露。
- Multiplayer 后端包按 `multiplayer-<backend>` 增加；`multiplayer-core` 定义 GameKits 侧稳定 facade、App Host service shape、GameModule bridge、语义 command、local/remote authority binding、标准复制 helper、prediction transition lifecycle 和 diagnostics。离线单机使用 local authority endpoint 复用同一 gameplay contract；成熟多人 backend 负责 room、matchmaking、reconnect、presence、provider state sync 和 transport；首个真实 backend adapter 是 Colyseus。Backend package 还可以提供 typed room-side server/runtime bridge，让 provider Room 持有 headless App Host 和 authority endpoint，但 bridge 不拥有 app gameplay 或 app Schema。物理预测仍由 `physics-core` 使用 `PhysicsBackendAdapter` 实现可复用 transition，`multiplayer-core` 不反向依赖 Physics。
- 模块长期设计见 `docs/modules/`。

## 应用与验证面

`apps/sandbox` 是框架验证面，不是长期玩法仓库，也不是模块协议的来源。它可以实现一个有真实运行循环的小 demo，但 demo 专用的 entity role、production recipe、threat、objective 和 presentation 组件必须留在 Sandbox 内部。

Sandbox 的长期演示设计见 `docs/apps/sandbox.md`。具体工作流状态、任务拆分和验收证据放在任务系统、PR 或 `docs/implementation/`。

`apps/multiplayer-demo` 是 Multiplayer 的独立验证应用，用本地 Colyseus backend 跑通 host authority、client command、GameRuntime bridge 和可见 diagnostics。它不是 Sandbox 子面板，也不把 demo command 上推为 `multiplayer-core` 协议。

`apps/multiplayer-outpost-siege-demo` 是全框架综合验证应用。它在 Room-owned server authority 下组合 App Host、Data/Asset、World、Physics、Combat、TCA/GAS、AI/Navigation、Multiplayer、Animator、Phaser Driver、Input/Camera/Renderer/Audio、React UI、Save、Platform 和 DevTools，验证数据驱动、实体化、物理化多人战斗以及完整资源、存档、诊断和负载链路。它与 Multiplayer Demo 的最小回归职责分离，玩法、Schema 和 app-specific orchestration 保持 app-local；其他 renderer/physics/navigation backend 变体继续由专属 Lab 和 conformance test 验证。

真实游戏验证应用放在 `docs/apps/` 下维护长期设计。Abyss Delve 是当前计划的真实游戏验证应用，用常见肉鸽暗黑-like 设计验证完整框架组合，但它的职业、怪物、掉落、房间和 UI 概念不作为核心协议来源。

单项能力实验台也放在 `docs/apps/` 下维护长期设计，例如 Three Demo 验证 Three Driver，Physics 2D / 3D Lab 验证 Physics Core / Rapier adapter 与 renderer 的协作。能力实验台可以显式选择对应 adapter / driver，但不能把实验专属概念推入核心协议。

## 依赖方向

依赖只能从具体层指向抽象层：

```txt
apps/* → packages/*
app-host → core / event-bus / game-runtime / platform-core / data / asset / renderer-core / audio-core / input-core / camera-core / physics-core / combat / ai-core / navigation-core / animator-core / save / multiplayer-core
adapter packages → facade packages
driver packages → core protocol packages / external runtime
game-runtime → core / world / event-bus
world-koota → world / core / koota
input-dom/input-tauri → input-core
physics-core → core / event-bus / game-runtime / world / data / save
character-controller → core / data / physics-core
physics-rapier2d → physics-core / core / @dimforge/rapier2d-compat
physics-rapier3d → physics-core / core / @dimforge/rapier3d-compat
physics-matter → physics-core / core / matter-js
driver-phaser → driver-core / renderer-core / renderer-phaser / input-core / camera-core / physics-core / animator-core / audio-core / asset / core / phaser
driver-three → driver-core / renderer-core / input-core / camera-core / animator-core / audio-core / asset / core / three
platform-web/platform-tauri → platform-core
asset → data / core
tca → core / data / event-bus / game-runtime / save
gas → core / data / event-bus / game-runtime / tca / world / save
combat → core / data / event-bus / game-runtime / world / physics-core / gas
ai-core → core / data / event-bus / game-runtime / world / physics-core / navigation-core / save
navigation-core → core / data / game-runtime
navigation-graph/navigation-grid/navigation-navmesh → navigation-core/backend / data / backend-owned contracts
navigation-recast → navigation-core/backend / navigation-navmesh / recast-navigation
animator-core → core / data / event-bus / game-runtime / asset / renderer-core
audio-core → core / asset
multiplayer-core → core / event-bus / game-runtime
multiplayer backend packages → multiplayer-core / platform-core / backend-owned runtime
react-ui → ui-core
devtools-ui → devtools / ui-core / react-ui
save → core / platform-core
save-indexeddb → save / core / native IndexedDB
```

禁止方向：

- `@gamekits/world` 依赖 Koota、bitecs 或任意具体 ECS。
- `@gamekits/renderer-core` 依赖 Phaser、Three.js、DOM-heavy 实现或 ECS。
- `@gamekits/input-core` 依赖 DOM、Phaser、Tauri。
- `@gamekits/camera-core` 依赖 Phaser、Three.js。
- `@gamekits/physics-core` 依赖 Rapier、Matter.js、Phaser、Three.js、Koota 或任意具体物理/ECS/renderer 后端。
- `@gamekits/combat` 依赖具体游戏、renderer、AI backend 或 native physics 类型。
- `@gamekits/ai-core` 依赖 XState、Yuka、具体 navigation backend、Physics backend、renderer 或具体游戏。
- `@gamekits/navigation-core` 依赖 Yuka、Recast、具体 graph/grid/navmesh 库、Physics backend 或 renderer。
- `@gamekits/navigation-navmesh` 依赖 Recast、navcat 或其他具体生成/查询 runtime；GameKits-owned source contract 不能由某个 adapter 决定。
- `@gamekits/navigation-recast` 的 Recast/WASM/native poly 类型进入 Navigation Core、Data/Save payload 或 gameplay 公共 API。
- `@gamekits/animator-core` 依赖 Phaser、Three.js、native clip/mixer 或具体游戏。
- `@gamekits/audio-core` 依赖 Phaser、Web Audio、Howler 或平台音频 SDK。
- `@gamekits/driver-core` 依赖 Phaser、Three.js、DOM-heavy implementation 或具体 renderer/input/camera/asset adapter 实现。
- Phaser/Three 等外部 runtime 由对应 driver package 创建和持有；renderer/input/camera/physics/asset adapter package 不得各自创建同一 runtime。
- `@gamekits/platform-core` 依赖 Tauri 或浏览器私有 API。
- `@gamekits/multiplayer-core` 依赖 WebSocket、Colyseus、Nakama、Steam、EOS、Tauri 或任意具体网络 SDK，也不自研通用 room server、matchmaker、reconnect engine、presence store 或 state sync engine。
- Multiplayer backend adapter 的第三方 SDK 类型不得进入 `multiplayer-core`、DataType、Save payload 或可复用 GameModule 公共 API。
- 可复用 gameplay module、core facade、DataType、TCA/GAS rule、Save payload 不得直接导入 Koota、Phaser、Three.js、GSAP、Tauri、shadcn/ui 等第三方库。
- 具体 app presentation、Editor 后端专属面板或 DevTools renderer plugin 可以显式依赖对应 adapter / driver 包，并通过 typed native path 使用 Phaser、Three.js 等后端 API；这些依赖不得进入可复用 gameplay 或 core public API。
- Runtime 包直接依赖具体游戏 app。
- GameRuntime 直接拥有 driver、renderer、audio adapter、input、camera、platform、asset、data、multiplayer connection 等应用级服务。

## 应用服务与游戏模块

GameKits 必须区分 App Service 和 Game Module，避免 App Host 变成玩法容器，也避免 GameRuntime 直接承担平台和 adapter 生命周期。

判断一个能力更像 App Service：

- 生命周期跟应用、窗口、平台、资源或外部句柄绑定。
- 主要负责 adapter boot/dispose、配置来源、平台差异、资源加载、全局诊断。
- 不需要每帧读取 world，也不应该直接知道具体玩法上下文。
- 可以通过 `services.xxx` 被多个 game module 或 UI/DevTools 读取。

判断一个能力更像 Game Module：

- 生命周期跟一次游戏会话或 GameRuntime 绑定。
- 需要注册 system、监听 EventBus、读写 world、读取 gameplay DataType 或参与 tick。
- 需要知道具体游戏上下文、规则、actor、camera rig、ability、save slot 等。
- 应通过 `GameModule` 安装，并在 GameRuntime dispose 时清理订阅和 runtime 状态。

App Host 可以提供“标准游戏模块”装配入口，但标准游戏模块仍属于 GameRuntime lifecycle。它们不进入 `services.xxx`，而是在 `game` service 创建 runtime 时作为 `GameModule[]` 注入。模块的完整 runtime 实现和直接创建 factory 归属对应 domain package；App Host 只提供解析 service/profile 依赖并调用 domain factory 的薄 wrapper。Camera、TCA、GAS、Physics 和 Multiplayer gameplay bridge 都应遵守这个路径。

判断一个包更像 Adapter：

- 只把稳定 facade 映射到 Phaser、Three.js、DOM、Tauri、浏览器 API 等具体实现。
- 不承载玩法规则，不拥有跨模块生命周期。

判断一个包更像 Driver：

- 统一持有外部 runtime，例如 Phaser Game / Scene 或 Three renderer / scene。
- 同时为 renderer、asset、input、camera 等多个 core protocol 提供 adapter。
- 负责外部 runtime boot/resize/stop/dispose、共享资源 cache、输入来源和低频 diagnostics。
- 不承载 gameplay state，不读取 world，不注册 GameRuntime system。

判断一个包更像 Facade / Toolkit：

- 定义稳定协议、数据结构、controller、helper 或 conformance test。
- 可被 App Service 或 Game Module 使用，但自身不决定启动边界。

长期 package 归属：

| Package                                                                                  | 归属                                          | 说明                                                                                                                                                                                       |
| ---------------------------------------------------------------------------------------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `@gamekits/app-host`                                                                     | App Service / composition                     | 应用组合、service lifecycle、config、diagnostics。                                                                                                                                         |
| `@gamekits/platform-core`                                                                | App Service facade                            | 平台能力协议。                                                                                                                                                                             |
| `@gamekits/platform-web` / `@gamekits/platform-tauri`                                    | App Service adapter                           | Web/Tauri 平台能力实现。                                                                                                                                                                   |
| `@gamekits/driver-core`                                                                  | App Service facade                            | 外部 runtime 统一集成协议、adapter map、native boundary、snapshot。                                                                                                                        |
| `@gamekits/driver-phaser` / `@gamekits/driver-three`                                     | App Service driver                            | 统一持有 Phaser / Three runtime，并暴露 renderer、asset、input、camera、可选 physics adapter。                                                                                             |
| `@gamekits/data`                                                                         | App Service                                   | 全局内容数据注册、校验、来源追踪。                                                                                                                                                         |
| `@gamekits/asset`                                                                        | App Service                                   | 资源声明读取、加载状态、adapter 委托。                                                                                                                                                     |
| `@gamekits/renderer-core`                                                                | App Service facade                            | 渲染对象协议。                                                                                                                                                                             |
| `@gamekits/renderer-phaser`                                                              | App Service adapter                           | Phaser render object 映射；由 Phaser Driver 绑定共享 runtime，不独立创建 Phaser。                                                                                                          |
| `@gamekits/input-core`                                                                   | App Service facade + gameplay bridge toolkit  | raw input 归一化、action/context/scope；具体玩法绑定由 GameModule 使用。                                                                                                                   |
| `@gamekits/input-dom` / `@gamekits/input-tauri`                                          | App Service adapter                           | DOM/Web Gamepad/Tauri 输入来源接入；Phaser runtime input 来源由 Phaser Driver 暴露。                                                                                                       |
| `@gamekits/camera-core`                                                                  | Game Module toolkit                           | CameraController、CameraRig、camera system/action helper；不作为 App Host 标准服务。                                                                                                       |
| `@gamekits/physics-core`                                                                 | Game Module toolkit                           | 统一 Physics facade、body/collider/query/contact 协议、标准 physics module helper。                                                                                                        |
| `@gamekits/character-controller`                                                         | Game Module toolkit                           | 玩家/AI 共用的 backend-neutral locomotion intent、pure motor、Data 与 diagnostics；通过 Physics 协议输出 patch/command，不拥有输入、AI、表现或多人生命周期。                               |
| `@gamekits/physics-rapier2d` / `@gamekits/physics-rapier3d` / `@gamekits/physics-matter` | Game Module backend adapter                   | 独立物理库 adapter；Rapier 按 2D / 3D 分包，第三方类型不进入 physics-core 或 gameplay 公共 API。                                                                                           |
| `@gamekits/combat`                                                                       | Game Module toolkit                           | 通用 effect delivery、target relationship、hit resolution、projectile/hitscan/area executor，以及 kinematic projectile record/reconciliation/presentation transition；不定义具体游戏数值。 |
| `@gamekits/ai-core`                                                                      | Game Module toolkit                           | 感知记忆、Utility goal、Task lifecycle、预算调度和 trace；不拥有 World、Physics、Navigation backend 或游戏行为。                                                                           |
| `@gamekits/ai-core/testing`                                                              | Test support                                  | AI runtime conformance 与 framework-neutral memory fixture；不进入业务默认入口。                                                                                                           |
| `@gamekits/navigation-core`                                                              | Game Module toolkit / facade                  | Path/shared route-field query、layout factory、agent profile、dynamic blocker/cost、异步 request budget 和稳定 Handle。                                                                    |
| `@gamekits/navigation-core/backend`                                                      | Backend port                                  | submit/poll/cancel/release、revision、route-field sample 和 layout factory；只供 adapter/driver 实现者使用。                                                                               |
| `@gamekits/navigation-core/testing`                                                      | Test support                                  | Memory/Deferred Backend、conformance 和 framework-neutral fixture；不进入业务默认入口。                                                                                                    |
| `@gamekits/navigation-graph` / `@gamekits/navigation-grid`                               | Game Module backend adapter                   | 稀疏 authored route 与规则 raster；native node/cell/request token 不进入 Core root API。                                                                                                   |
| `@gamekits/navigation-navmesh`                                                           | Backend authoring contract                    | GameKits-owned triangle source、build profile、area metadata 和 DataType；不实现具体 baker/query runtime。                                                                                 |
| `@gamekits/navigation-recast`                                                            | Game Module backend adapter                   | 通过 `recast-navigation` 生成/查询 NavMesh，持有 WASM/native lifecycle；第三方类型不进入 Core 或 gameplay。                                                                                |
| `@gamekits/animator-core`                                                                | Game Module toolkit                           | 语义 Animator graph、controller、layer、transition、marker 和 playback snapshot；具体 clip/mixer 由 Renderer/Driver adapter 执行。                                                         |
| `@gamekits/animator-core/playback`                                                       | Playback adapter port                         | Driver/Adapter 实现者使用的 backend-neutral playback frame、batch、reset 和 snapshot 协议；不进入 gameplay 默认入口。                                                                      |
| `@gamekits/animator-core/testing`                                                        | Test support                                  | Memory Playback Adapter、runtime conformance 和测试类型；不进入业务默认入口。                                                                                                              |
| `@gamekits/audio-core`                                                                   | App Service facade + presentation bridge      | GameAudio 领域 facade；分别提供 Music、SFX、可选 Dialogue、Mix、Spatial 和共享 Playback 语义，具体 native channel/DSP/runtime 由 Adapter/Driver 持有。                                     |
| `@gamekits/tca`                                                                          | Game Module                                   | 数据驱动规则 runtime，通过标准 GameModule 无痛安装。                                                                                                                                       |
| `@gamekits/gas`                                                                          | Game Module                                   | 通用 Actor/Ability/Effect runtime；热状态落在 World component，复用 TCA。                                                                                                                  |
| `@gamekits/multiplayer-core`                                                             | 混合：App Service facade + Game Module bridge | GameKits 侧连接 facade、语义 command、local/remote authority binding、标准复制 helper、diagnostics 和 bridge；不拥有 provider room/matchmaker/reconnect/state-sync engine 或具体玩法逻辑。 |
| `@gamekits/multiplayer-memory`                                                           | Test backend adapter                          | 本地 loopback 和 deterministic conformance fixture；不代表生产多人 backend。                                                                                                               |
| `@gamekits/multiplayer-colyseus`                                                         | App Service backend adapter                   | 首个成熟多人 backend adapter；Colyseus 拥有 Room、matchmaking、state sync、reconnect 和 transport，并可提供不包含 app 玩法/Schema 的 typed room-side server/runtime bridge。               |
| `@gamekits/ui-core`                                                                      | App/UI toolkit                                | UI 状态、window、focus 协议；gameplay 不直接依赖 React。                                                                                                                                   |
| `@gamekits/react-ui`                                                                     | App/UI adapter                                | React UI 实现。                                                                                                                                                                            |
| `@gamekits/save`                                                                         | 混合：App Service + Game Module bridge        | 存储 adapter 和 profile 是应用服务；snapshot capture/restore 是游戏模块桥接。                                                                                                              |
| `@gamekits/devtools`                                                                     | App Service / tooling                         | 观察 Host、Data、Physics、TCA、GAS、Multiplayer、profiler，不进入 gameplay loop。                                                                                                          |
| `@gamekits/devtools-ui`                                                                  | App/tooling UI package                        | DevTools launcher、shell、标准面板；依赖 DevTools runtime，不进入 gameplay loop。                                                                                                          |
| `@gamekits/world`                                                                        | Runtime facade                                | ECS facade；基础 `GameWorld` 保持最小 CRUD/query，可选 `CheckpointGameWorld` 提供稳定 identity restore。                                                                                   |
| `@gamekits/world-koota`                                                                  | Runtime adapter                               | Koota adapter；实现基础 facade 与可选稳定 identity checkpoint capability。                                                                                                                 |
| `@gamekits/core` / `@gamekits/event-bus` / `@gamekits/game-runtime`                      | Core Runtime                                  | 薄内核、事件、GameModule lifecycle。                                                                                                                                                       |

## 模块设计索引

- Core / Runtime：`docs/modules/core-runtime.md`
- App Host：`docs/modules/app-host.md`
- Driver：`docs/modules/driver.md`
- World：`docs/modules/world.md`
- Renderer：`docs/modules/renderer.md`
- Input：`docs/modules/input.md`
- Camera：`docs/modules/camera.md`
- Physics：`docs/modules/physics.md`
- Character Controller：`docs/modules/character-controller.md`
- Combat：`docs/modules/combat.md`
- AI：`docs/modules/ai.md`
- Navigation：`docs/modules/navigation.md`
- Animator：`docs/modules/animator.md`
- Audio：`docs/modules/audio.md`
- Platform：`docs/modules/platform.md`
- Data：`docs/modules/data.md`
- Assets：`docs/modules/assets.md`
- TCA：`docs/modules/tca.md`
- GAS：`docs/modules/gas.md`
- Multiplayer：`docs/modules/multiplayer.md`
- UI：`docs/modules/ui.md`
- Save：`docs/modules/save.md`
- DevTools：`docs/modules/devtools.md`

## 关键边界

### App Host

App Host 是应用组合层，负责统一 service registry、lifecycle、config、platform profile 和 diagnostics。它可以组合 Platform、Driver、Data、Asset、Renderer、Input、GameRuntime、UI、DevTools 等应用服务，但不替代 gameplay module。

普通 app 应优先通过 `GameAppDefinition + AppProfile` 启动 Host。Definition 描述 app 需要哪些标准服务，Profile 提供统一 adapter/对象参数包和少量 service 参数；标准 service binding 由 App Host 内部创建。底层 `createAppHost({ services })` 保留给测试、工具和少数需要手动装配的高级场景。

同一个 app 的 Browser、Tauri、headless server 和 deterministic test profile 应尽量复用同一份 Definition/service graph。非视觉 profile 通过 protocol-compatible memory platform、headless renderer、memory asset loader 和可注入的 World/Physics/Multiplayer/runtime factory 提供服务，不通过删除 Renderer/Asset/UI 等 service 形成另一套应用。Memory/headless fixture 是组合与确定性验证边界；正式 dedicated server 仍应显式注入生产平台、物理和多人 backend。

GameRuntime 继续保持薄内核，不直接拥有应用级 adapter 和服务。详细设计见 `docs/modules/app-host.md`。

### Renderer

Renderer 公共协议以通用 render object lifecycle、object id 和可追踪 native handle 为中心，不以 Sprite API 为中心。Render type 由 adapter 解释，复合对象是一等能力。

Renderer Core 不维护 `RendererCapabilities` 这类后端能力目录，也不持续包装 Phaser / Three 的专属 API。复杂表现、后端专属材质/管线/粒子/mesh 控制和热点路径通过具体 adapter / driver 包暴露的 typed native path 完成；可复用 gameplay、Data、Save 和 core facade 不依赖这些原生类型。

详细设计见 `docs/modules/renderer.md`，决策背景见 `docs/adr/0003-general-render-objects-and-input-decoupling.md` 和 `docs/adr/0009-renderer-native-control-and-minimal-core.md`。

### Driver

Driver 是外部运行时的统一集成层。Phaser、Three.js 这类同时拥有 scene、renderer、loader、input、camera、physics plugin 和资源 cache 的库，应通过 Driver 统一持有，并从中暴露 RendererAdapter、InputSource、AssetLoaderAdapter、RendererCameraAdapter 和可选 PhysicsBackendAdapter。

Adapter 是单协议实现；Driver 是跨协议外部 runtime owner。App Host 管理 Driver lifecycle，GameRuntime 不直接拥有 Driver。Driver / Adapter 的具体包可以导出 typed native bridge 给显式选择该 renderer 的 app presentation 或 tooling 使用，但 App Host、driver-core 和 renderer-core 不理解 Phaser / Three 原生类型。

外部 runtime 的 render density 也是跨协议组合问题：Driver 统一持有 logical viewport、canvas/backing store、native camera 和 input source 的换算。Renderer Core、Camera Core、Input Core 和 gameplay 坐标不暴露设备物理像素；具体 App profile 只选择 Driver render policy。

详细设计见 `docs/modules/driver.md`，决策背景见 `docs/adr/0007-driver-integration-layer.md`。

### Input

Input 是独立系统，负责 raw input、action mapping、context、focus 和 command routing。Renderer 可以提供 view/picking/hit-test capability，但不拥有 gameplay input 语义。

Input 使用 scope 表达输入事件当前所属交互域，例如 `game`、`ui`、`editor`、`text-input` 或 `devtools`。Action 和 Context 都可以声明允许的 scope，避免 gameplay/camera 快捷键在非游戏窗口误触发。

Input source 同时支持事件型与 polling 型 adapter。Polling source 通过可选 `poll(frame)` 接受 App Host 的统一 frame/clock；标准 Input service 每帧先按注册顺序 poll source，再由 Input Router 产生 held Action。Source 不创建私有 RAF/timer，stop/disconnect/scope 变化必须取消 active control。Web Gamepad API 由 `@gamekits/input-dom` adapter 持有，不归 Phaser Driver；Phaser Web app 在组合层同时安装 Phaser pointer、DOM keyboard 和 Web Gamepad source。

详细设计见 `docs/modules/input.md`，Web Gamepad 所有权决策见 `docs/adr/0045-web-gamepad-input-source-and-polling.md`。

### Camera

Camera 是 gameplay/session 能力，不是 App Host 标准服务，也不是 Phaser 或 Three.js 私有对象。Input、TCA、Cue、Editor 通过 CameraController 或 CameraRig 控制镜头；renderer camera adapter 只负责把 camera state 同步到底层渲染器。

详细设计见 `docs/modules/camera.md`。

### Physics

Physics 是 gameplay/session 能力和多后端 facade，不是 Renderer、Input 或 App Host 默认标准服务。Physics Core 定义 body、collider、material、query、contact event、trace、Save contributor 和标准 GameModule helper；Rapier、Matter.js、Phaser Physics 等底层能力通过 backend adapter 或 Driver runtime slice 接入。

Kinematic transform 必须区分普通 simulation target 与已完成 tick 的 authority correction：前者让 backend solver 推导接触速度，
后者在 rollback reconcile/hard correction 中立即安装快照 pose。该选择通过 Physics Core 的稳定 update option 传给 adapter，
Multiplayer/App 不能在 Renderer 中另建 authority transform 旁路。具体语义见
`docs/adr/0055-kinematic-target-and-authority-correction.md`。

独立物理库使用 `@gamekits/physics-*` adapter。Phaser Arcade / Matter Physics 这类绑定在 Phaser Scene runtime 内的能力由 `@gamekits/driver-phaser` 持有外部 runtime，再暴露 physics backend adapter；adapter 不单独创建 Phaser.Game 或 Scene。Gameplay 通过 World component、Physics query 和低频 contact event 消费物理事实，不保存 backend native handle、broadphase cache 或 contact manifold。

Fixed-step Physics module 可以提供 opt-in transient interpolation store 给 Renderer sync 和 Camera follow target 共用。该 store 不改变 World authority、Save 或 multiplayer snapshot，也不成为 Renderer/Camera 对 Physics 的包级依赖；组合层负责显式注入，并通过可选 policy 提供游戏尺度相关的不连续判定或表现曲线，Physics Core 不写死玩法阈值。

Character Controller 是独立可选 gameplay toolkit。它消费 world-space semantic intent 与 Physics body/query 事实，维护可 checkpoint 的 grounded/coyote/jump-buffer/dive/recovery/stagger state，并输出 backend-neutral body patch/command。Pure motor 不依赖 Input、Camera、Renderer、AI、Multiplayer 或具体 Physics backend；玩家与 AI 必须通过同一 intent/transition，runtime strategy 只负责稳定 query 与 backend 映射。具体边界见 `docs/modules/character-controller.md` 与 `docs/adr/0052-reusable-character-controller-toolkit.md`。

详细设计见 `docs/modules/physics.md`，facade / adapter 决策背景见 `docs/adr/0010-unified-physics-facade.md`，query / cast / filter 公共协议见 `docs/adr/0011-physics-query-and-filter-api.md`。

### Combat

Combat 是可选的 effect delivery 与命中执行 toolkit。它通过 Physics 获取空间候选，通过 app-injected relationship/target policy 过滤，再通过 GAS effect 提交玩法结果。Projectile 是 entity-backed runtime object；Combat 不把 weapon、health、team、enemy 或 damage formula 写进 Core。Kinematic network projectile 的有界 record、absolute/shot-relative 空间事实 reconciliation 由 Combat 提供；Multiplayer Core 的通用 time-aligned presentation transition 负责 predicted→authority 接管、relative-origin 时间对齐、有界 correction lifecycle 和 diagnostics。App Host 提供两者的标准组合入口，使 shot-relative owner 接管按相同 shot age 采样 authority record，绝对 commit tick offset 不被当作空间 correction；app 只装配内容、Physics query 与最终 renderer writer。

GAS 是 ability/effect/cue 的语义事实源；Combat 不建立平行 Cue registry。Combat 提供数据驱动的 GAS committed → delivery bridge，以及 hit point、normal、block、projectile lifecycle 等动态空间 fact。Projectile spawn/despawn 通过有界 fact 暴露稳定 identity、初始或最终 transform与可选 impact，不把完整 runtime state、query或candidate传入 EventBus；连续 transform仍归 World。表现组合层通过 correlation/execution/ticket/projectile identity 把 GAS Cue 与 Combat fact/World state 关联后交给 Animator、Renderer、Audio、Camera 和 UI。具体边界见 `docs/adr/0032-gas-cue-and-combat-delivery-integration.md` 和 `docs/adr/0046-bounded-combat-projectile-lifecycle-facts.md`。

详细设计见 `docs/modules/combat.md`。

### AI 与 Navigation

AI Core 负责 perception memory、Utility goal selection、Task state machine、intent 与预算调度；Navigation Core 独立负责 path/shared route-field query、layout/backend lifecycle、动态 blocker/cost、cache 与 progress read model。AI 不直接推进 Physics、GAS 或 Combat，Navigation 也不决定目标与攻击。

Navigation 的游戏侧 root、Backend port 和 testing fixture 使用独立入口。Backend 使用 submit/poll/cancel/release 生命周期，使同步 Graph 与异步 Worker/Navmesh 共用同一 Handle；大群体通过共享 route field 采样方向，不为每个 agent 复制完整路径。Core 只拥有 field 协议、公共 route identity、调度、revision/stale、retain/release 委托、trace 和 Backend-neutral portal traversal sample；Graph node、Grid cell、NavMesh polygon、反向搜索、endpoint 投影和 field native state 由具体 Backend 持有。Portal sample 只报告稳定 id 与方向正确的 entry/exit，实际传送、跳跃、攀爬、Physics/authority 更新和动画属于调用方。可复用搜索算法只能进入不依赖 gameplay 的 Backend toolkit，不能要求所有 Backend 向 Core 暴露统一拓扑。具体公共协议、包内依赖、field 所有权和 portal traversal 分别见 ADR 0036、ADR 0037、ADR 0040、ADR 0041。

普通实时 agent 默认使用 Utility + interruptible task model，不强制 GOAP。GOAP、HTN、行为树、Yuka graph/search 或其他第三方实现只能通过 AI/Navigation adapter extension 接入，不能接管 World、Physics 或 GameRuntime lifecycle。

详细设计见 `docs/modules/ai.md`、`docs/modules/navigation.md` 和 `docs/adr/0031-gameplay-foundation-packages-and-agent-ai.md`。

### Animator 与 Audio

Animator Core 管理 semantic parameter、graph、layer、transition、one-shot、marker 与 playback state；Renderer/Driver 负责 native clip、mixer、sprite frame 和资源对象。Gameplay ability phase 是权威时间源，animation marker 只触发表现。Marker catch-up 必须有单次 update 上限，订阅者异常不能中断 backend flush；Renderer/Driver 若不能执行 playback frame 声明的 weighted/additive layer，必须在 native mutation 前明确拒绝，不能静默降级。

Audio Core 的首层 API 按游戏音频领域拆分：MusicPlayer 管理音乐状态和过渡，SoundEffects 管理离散音效、variation、空间 emitter 与并发，DialoguePlayer 管理可选的对白队列和打断，AudioMixer/SpatialAudio 提供共享混音与空间状态。Bus 只负责路由，不能用一个通用 Audio Event + `bus` 代替这些领域控制器。共享 PlaybackInstance 与 Backend native channel 必须分离；公共 API 使用 Dialogue 表示配音，不用含义歧义的 `voice` 表示逻辑实例或标准 Bus。AssetManager 负责音频资源状态，Driver/Adapter 负责 Web Audio、Phaser、成熟中间件或平台 SDK；第三方 handle 不进入 Core。音频失败、marker 和播放位置不能改变玩法结果。公共 API 决策见 `docs/adr/0034-game-audio-domain-facades.md`。

详细设计见 `docs/modules/animator.md` 和 `docs/modules/audio.md`。

### Platform

Platform 隔离 Web/Tauri/未来平台差异。文件、窗口、权限、路径、存储和系统能力都通过 platform-core。

`@gamekits/platform-web` 的 memory profile helper 只为 headless、SSR 和 deterministic composition 提供显式隔离的 memory fs/storage；它不读取 browser storage，也不替代未来生产 Node/server platform adapter。调用方可以覆盖 runtime id，并通过同一个 PlatformRuntime 协议注入 AppProfile。

详细设计见 `docs/modules/platform.md`。存档文件替换、加载预检和生命周期失败边界遵循 `docs/adr/0056-runtime-failure-and-save-commit-contracts.md`。

### UI

UI 分为 headless 的 `ui-core` 和具体 React 实现 `react-ui`。UI Core 只定义 panel、window、command、focus 和 snapshot 协议；React UI 负责 shell、host、组件、样式基础设施和 DOM focus bridge。

React 不进入 GameRuntime 主循环，不订阅每帧 ECS position，也不直接驱动 Renderer patch。Gameplay 包、GameModule 和 Sandbox game modules 不应直接 import React、shadcn/ui、Base UI 或 DOM panel implementation。

UI focus 必须能和 Input Scope / Context 协作，确保文本输入、Inspector、DevTools、modal 聚焦时不会误触发 gameplay/camera input。

UI style/theme 属于 React UI / app 层，不进入 `ui-core`。游戏应能定义自己的主题、CSS variables、组件库和视觉语言；`react-ui` 提供默认工具型样式和组织方式，但不把某个具体游戏皮肤上推成框架协议。

`@gamekits/react-ui` 的默认实现以 Tailwind CSS 作为样式基础、GSAP 作为低频 UI 动效基础，并推荐 shadcn/ui 作为组件 recipe 最佳实践。这些依赖不能泄漏到 `ui-core`、GameRuntime、gameplay module、DataType、TCA/GAS 协议或 renderer adapter。

详细设计见 `docs/modules/ui.md`。

### DevTools UI

DevTools 的运行时协议和可视化实现必须拆开。`@gamekits/devtools` 只负责 data source、trace、diagnostic、profiler、panel metadata 和 command；`@gamekits/devtools-ui` 负责 DevTools launcher、shell、标准面板、DevTools focus bridge 和 React 渲染实现。

`@gamekits/react-ui` 不承载 DevTools 专用面板。它只提供通用 panel/window/modal/style/focus 基础设施，供 `@gamekits/devtools-ui` 和普通游戏 UI 复用。App Host 可以在 `devtools: true` 时注册 DevTools runtime、标准 sources 和 UI panel metadata，但不直接 import 或渲染 `@gamekits/devtools-ui`。

普通 Web 游戏模板应默认安装并挂载 `@gamekits/devtools-ui`。因此在标准 Web bootstrap 中配置 `devtools: true` 后，应自动出现 DevTools 入口；headless app 或未安装 DevTools UI 的自定义 shell 只获得 DevToolsRuntime 和 sources。

详细设计见 `docs/modules/devtools.md`。

### Data

Data 是全局内容数据层。DataPack 是数据交付单元，不是完整 Content Package，也不是内容分类模型；每条数据通过 `type + id` 声明自己的 DataType，DataRegistry 负责按类型注册、校验、索引和追踪引用。DataType 可以由 GameKits 内置，也可以由游戏项目、插件、mod 或编辑器自定义。

GameKits 只要求进入 DataRegistry 的数据有 `type + id` 这类弱约束，不强制开发者采用框架预设的 hero、monster、building、quest 模板。游戏可以自由定义 `game.hero`、`game.monster`、`game.building` 等类型，并选择性引用 GAS、TCA、Renderer、Asset 等内置类型。

详细设计见 `docs/modules/data.md`。

### Assets

Assets 是资源加载运行时。AssetDefinition 作为 `asset.definition` DataType 进入 DataRegistry，也可以由编辑器、导入器或远程 manifest 提供。具体玩法数据通过 `AssetRef` 引用资源，资源定义不要求和引用它的数据位于同一个 DataPack。AssetManager 从 DataRegistry 或其他资源声明来源读取 AssetDefinition，并委托 adapter 加载。Asset adapter 不管理 gameplay definitions，DataRegistry 不管理加载状态。

详细设计见 `docs/modules/assets.md`。

### Save

Save 负责长期运行状态的 capture、store、load、restore 和 migration。Save 是混合能力：slot 管理、store、codec、migration registry 属于 App Service；World、Physics、TCA、GAS、Camera 和游戏自定义状态通过 GameModule / contributor bridge 提供 capture 与 restore。

`@gamekits/save` 只定义协议、manager、store、codec、migration 和 contributor registry，不直接依赖 GAS、TCA、Camera、Renderer、React、Koota、Phaser 或具体 app。GAS/TCA 等包可以各自提供 save contributor helper，App Host 通过 `services.save` 统一管理生命周期和 diagnostics。

Save 不复制 DataPack、Content Package 或 Asset binary。存档记录 runtime/gameplay 长期状态和 Data/Asset/Content 的 id/version/compatibility metadata；加载时由 App Host 先准备 Data、Asset 和未来 Content package 环境，再恢复 runtime 状态。

详细设计见 `docs/modules/save.md`。

### Multiplayer

Multiplayer 负责多人会话、连接、消息、玩家身份映射、authority、命令同步、状态复制和网络诊断。连接、room、presence、reconnect 和 backend handle 属于 App Host 管理的应用服务；命令入站、authority gate、authority binding、EventBus 低频事实和 replication contributor 属于 GameRuntime lifecycle 下的 GameModule bridge。离线单机通过 local authority binding 使用同一套 action/input、tick、snapshot/apply 和 diagnostics contract，不绕出另一套 gameplay runtime。

`@gamekits/multiplayer-core` 定义 GameKits 侧稳定 facade、App Host service shape、GameModule bridge、语义 command、authority decision、authority binding、标准复制 helper、diagnostics 和 adapter conformance helper，不依赖具体网络 SDK，也不自研通用 room server、matchmaker、reconnect、presence 或 provider state sync。Colyseus、Nakama、PartyKit、平台联机 SDK 或其他成熟后端通过 `@gamekits/multiplayer-<backend>` adapter 接入。线上 remote payload 默认是不可信输入，权威 host/server 必须重新验证 command/input 后再改写 gameplay 状态；client 只有绑定到明确 authority endpoint 后才能应用 authoritative snapshot/patch。单机/offline 绑定 local authority endpoint，省略网络 IO，但不省略 authority validation、tick boundary 或 snapshot presentation。

标准 Multiplayer GameModule 可以通过 `clientReplication` 配置启用 Core 托管的客户端复制 lifecycle。Core 自动订阅并验证 authority snapshot、推进 remote playback/declared track projection、按配置频率采样和发送 local input、用有界 prediction-lead window 施加 backpressure、维护 prediction buffer，并根据 snapshot ack 执行 reconciliation/replay/correction smoothing；app 只声明 snapshot decoder、timeline、remote track、deterministic prediction transition、local predicted-state field 和统一的 frame writer，不在网络 callback、外部 render loop 或字段回调中手写调度与标准插值数学。两个真实应用出现相同 decoder/tick/local identity/ack/presentation mapping 后，普通路径可用 `defineMultiplayerReplicationSchema(...)` 和 `defineMultiplayerReplicationEntityPresentation(...)` 把这些声明编译为一个 client binding；managed replication 直接消费 binding，统一拒绝 schema version mismatch、非法 tick 和 decoder failure，并生成 generation-aware presentation key/track。它是可选 typed schema compiler，不递归反射业务对象、不替代 provider serializer，也不要求 NetworkObject 基类；特殊 netcode 仍可传低层 callback。Provider-native state sync 可以通过 provider-neutral `snapshotSource` 替换默认 envelope subscription；该 source 是互斥 authority 输入，可选 `current()` 让 Core 在 binding 就绪后补取 initial full state，provider update sequence 负责同 gameplay tick 内排序，binding/session reset 同时清空其排序水位。Transition 可以提供只读 diagnostics；Physics transition 还可内部复用 sequence checkpoint，避免一致的 solver state 被每份 snapshot 无意义 rewind。权威 World/Physics/Save 与 transient presented/predicted state 始终分离。具体决策见 `docs/adr/0028-managed-client-replication-runtime.md`、`docs/adr/0029-declarative-prediction-state-presentation.md`、`docs/adr/0030-backend-driven-physics-prediction-transition.md` 和 `docs/adr/0048-managed-prediction-domains-and-rollback-contracts.md`。

Prediction 必须按对象和因果复杂度选择策略，而不是把 render anticipation、单主体移动 replay 和完整 physics rollback 当作同一能力。瞬时攻击使用服务端 lag compensation 的 hitscan；可确定重放的长寿命弹丸使用有界 fire/finish data；与动态对象复杂交互的对象才进入 predicted entity + prediction-island resimulation；无需即时空间结果的对象保持 authority-only。Multiplayer Core 通过 managed prediction domain 统一 generation、identity、authority timeline、confirm/reject/expire、binding、hard reset、容量和 diagnostics，并保留 `createMultiplayerPredictedSpawnRegistry(...)`、`createMultiplayerAuthorityTimeline(...)`、`createMultiplayerTimeAlignedPresentationTransition(...)` 等低层 escape hatch；Physics Core 拥有单主体 transition，以及要求 backend full-scene checkpoint capability、完整成员快照和有界 history/member/command 的 `createPhysicsPredictionIsland(...)`。Prediction island 在可重放历史内执行 reconcile/replay，历史或成员契约不完整时通过显式 `hardCorrect(...)` 安装权威 baseline 并清除不再安全的命令/history；App Host 的 `createStandardMultiplayerPhysicsPredictionDomain(...)` 把 managed identity lifecycle、island reconciliation 与该 hard-correction fallback 组成默认跨模块路径。跨 World、Physics、RNG 或其他模块的同 tick rewind 使用 `createMultiplayerRollbackCoordinator(...)` 组合显式 contributor；World 通过不扩张基础 `GameWorld` 的可选 `CheckpointGameWorld` 与显式 component/entity selector 捕获稳定 entity/component 集合，App Host 提供默认顺序为 World 100、RNG 150、Physics 200 的标准 contributor；普通应用通过 `createStandardMultiplayerRollbackDomain(...)` 一次声明 World scope、RNG、Physics handle、额外 gameplay contributor 和预算，不自行重建组合顺序。每个 contributor 必须提供稳定顺序、capture/validate/restore、byte measurement 和 state hash，Multiplayer Core 不反向依赖具体 domain；所有 contributor 在任何写入前完成 validation，World 先恢复稳定 entity identity，Physics 再重建对应 component/backend state。Seeded RNG 暴露精确 stream state capture/restore，避免 replay 消耗不同随机序列。Combat 拥有 projectile strategy、空间 record、shot-relative reconciliation 和 authority result 语义。App 只提供内容/场景 policy、typed payload mapping、缺失 authority member definition、确定性 transition 与最终 writer，不重建通用 generation、match、expiry、timeline、binding、跨模块 restore 顺序或 correction runtime。回滚 replay 中的可撤销表现通过 `createMultiplayerSpeculativeEffectJournal(...)` 以稳定 effect identity 去重，并由 authority confirm/cancel/replace；不可重复提交权威 damage、GAS/TCA/EventBus 事实，也不能在 replay 中直接触发 Audio、Camera、Renderer 或 UI side effect。只会继承显示位置的 handoff 不能用于会碰撞、停止、bounce 或销毁的对象。详细决策见 `docs/adr/0047-selective-network-prediction-and-projectile-strategies.md` 和 `docs/adr/0048-managed-prediction-domains-and-rollback-contracts.md`。

多人高互动刚体 arena 通过 Multiplayer GameModule 的 provider-neutral client prediction-domain bridge 接入，而不是
让 `createMultiplayerClientReplication(...)` 或 Multiplayer Core 理解 Physics。App Host 的标准 Physics Arena adapter
组合 client binding lifecycle、完整 authority arena frame、prediction island、membership revision、hard correction、
可选 island-owned auxiliary contributor、rollback contributor 与 speculative effect journal；authority projection 只生成
provider-neutral island state 与显式 auxiliary state envelope，provider wire serializer 继续留在 app/backend boundary。
严格逐 step prediction 使用可选的 bounded redundant input
bundle 和 authority fixed-step inbox，使有损 delivery 下的 duplicate/gap/ack 仍由统一协议管理；未配置时保持现有单帧
input 路径。真实交互集合由 authority 显式声明为完整因果闭包；缺失成员、
definition version 不一致或 history/byte/replay 预算溢出时必须安装完整 baseline 或降级 authority-only。首选正确性基线
是单个完整 arena island，自动 partition/merge/split 必须作为后续可选 policy，不能由客户端根据距离静默猜测。Arena
island 与通用 World/Physics rollback contributor 不得重复捕获同一 solver state；character motor 等决定同 tick Physics
command 的少量状态必须作为 island auxiliary contributor 一起 capture/restore/replay/reset，不能由 app 在 reconcile 前后
另跑一套历史。具体决策见 `docs/adr/0049-standard-multiplayer-physics-arena-prediction.md` 和
`docs/adr/0053-arena-auxiliary-replay-contributors.md`。

`@gamekits/multiplayer-core` 还提供可包裹任意 backend 的确定性 network-condition simulator，使用手动虚拟时钟、固定
seed、选择性 message predicate 和有界 delivery queue 注入 latency、jitter、loss 与 duplicate。它只改变消息 delivery，
不拥有第二套 session、authority 或 prediction clock；真实 provider 行为仍由 adapter integration/e2e 验证。具体决策见
`docs/adr/0050-deterministic-multiplayer-network-condition-simulator.md`。

Server-authoritative Room 可以持有 headless App Host、GameRuntime、World、Physics 和 replication lifecycle；browser creator 只拥有 app-defined party leader 权限，不成为 authority clock owner。复杂 provider-native state sync 的字段级 Schema 与 mapping 留在 app provider boundary，backend package 只提供通用 typed hook、source/version/resync gate 和 redacted diagnostics。Room-owned 与 host-authoritative 模式共享 authority contract，但不能共享 host-leave-close policy。

Room-side backend bridge 可以把已经由 provider Room 拥有的 session 映射成 `MultiplayerBackendAdapter/Connection`，再统一交给 `multiplayer-core` 的 `createMultiplayerRuntime()` 暴露 server-side facade；它不能手写第二套 MultiplayerRuntime/session 状态机。Bridge 还可以组合单一 simulation interval、peer/client active index、envelope ingress/egress 与 app-provided runtime lifecycle，但不能替 app 创建 gameplay Room、解析 participant 权限或持有字段级 Schema；server facade 也不能通过自连 Room 再创建第二条 provider connection/tick lifecycle。具体决策见 `docs/adr/0025-colyseus-room-owned-runtime-bridge.md`。

详细设计见 `docs/modules/multiplayer.md`，决策背景见 `docs/adr/0010-multiplayer-core-and-backend-adapters.md`、`docs/adr/0012-mature-multiplayer-backend-adapter.md`、`docs/adr/0013-standard-authoritative-replication-boundary.md`、`docs/adr/0016-room-owned-server-authority-lifecycle.md`、`docs/adr/0017-app-owned-colyseus-field-schema-boundary.md`、`docs/adr/0028-managed-client-replication-runtime.md`、`docs/adr/0047-selective-network-prediction-and-projectile-strategies.md`、`docs/adr/0049-standard-multiplayer-physics-arena-prediction.md` 和 `docs/adr/0050-deterministic-multiplayer-network-condition-simulator.md`。

## 包内架构约定

包内目录不是统一脚手架。`runtime/`、`adapter/`、`components/`、`modules/` 和 `types.ts` 只是可能出现的技术类别，不能被复制成每个 package 的默认结构。每个长期包必须先识别自己的领域职责、变化轴和内部依赖方向，再决定目录。

共同约束：

- `src/index.ts` 只作为 root public export map，不承载主要实现，也不自动导出全部内部文件。
- 优先按领域或 feature 拆分行为，例如 Audio 的 `music/`、`sfx/`、`dialogue/`、`mix/`、`spatial/`；不要把互不相同的领域状态机都塞进一个 `runtime/`。
- 稳定公共 contract、第三方执行 port、领域实现、composition root、observability 和 testing fixture 必须有可识别的边界；一个目录只在该边界真实存在时创建。
- Composition root 可以依赖并装配多个领域 slice，领域 slice 不能反向依赖 composition。Adapter/Backend port 不依赖 App Host、具体 driver 或高层领域 controller。
- 类型与拥有其语义的领域放在一起。禁止用包级 `types.ts`、`definitions.ts`、`helpers.ts` 或 `utils.ts` 聚合所有不相关概念。
- 公共 root、backend/adapter contract 和 testing helper 面向不同消费者时，使用明确 subpath export；不要为了 Driver 或测试方便扩大 root API。
- 测试目录按领域边界镜像实现，conformance 与具体 Backend/Adapter 行为分开验证。
- 内部 barrel 不能隐藏循环依赖。跨领域实现优先直接导入窄文件，由 lint/build 维护单向依赖。
- 小型单职责包可以保持扁平；是否拆目录由职责和依赖决定，不由文件数量或其他 package 的外观决定。

具体包必须在对应 `docs/modules/<module>.md` 维护长期包内架构。Animator、Audio 和 Navigation Core 的领域目录、subpath export 与依赖图分别见 `docs/modules/animator.md`、`docs/modules/audio.md`、`docs/modules/navigation.md` 以及 ADR 0042、ADR 0043、ADR 0035、ADR 0037。

## 资源与存档的生产生命周期边界

Asset scope、加载调度和驻留预算由 AssetManager 统一维护，Driver 只执行原生资源加载/释放；App Host 持有 preload scope 并管理释放顺序。Scope 不查询 World 或 Renderer 推断所有权，见 `docs/modules/assets.md` 和 ADR 0057。

`save-indexeddb` 是浏览器 SaveStore adapter，原生事务与修订冲突检查不进入 Save core。候选会话恢复由 App Host 组合 helper 持有，SaveManager 只提供同一 envelope 的预校验与恢复；框架不回滚任意业务副作用。见 `docs/modules/save.md`、`docs/modules/app-host.md` 和 ADR 0058。
