# ADR 0004：引入 App Host 作为应用组合层

## Status

Accepted

## Context

Sandbox 逐步接入 Platform、Renderer、Input、Camera、Data、Asset 和 GameRuntime 后，入口初始化开始承担过多职责：

- adapter 创建。
- DOM container 和 viewport 管理。
- DataRegistry 创建和 DataPack 注册。
- AssetManager 创建和 preload。
- Renderer diagnostics 桥接到 EventBus。
- Input scope gate。
- Camera controller 和 renderer adapter 同步。
- Runtime 创建、start、tick loop。
- UI 状态刷新。

这些职责不属于纯 gameplay runtime，但也不应该永远散落在每个 app 入口文件里。

如果把这些能力直接塞进 `@gamekits/game-runtime`，会让 GameRuntime 过早绑定 DOM、平台、资源加载、输入、镜头和 UI 生命周期，破坏薄内核边界。

如果继续完全 app-owned，短期灵活，但长期会带来重复启动代码、debug 入口分散、装卸困难、平台差异处理重复和测试夹具成本上升。

## Decision

引入 `@gamekits/app-host` 作为应用组合层。

App Host 负责：

- service registry。
- service binding。
- service lifecycle。
- app config runtime。
- platform profile。
- diagnostics / snapshot。
- adapter 和 service 的依赖顺序编排。
- game app definition 到可运行应用实例的组合。

`@gamekits/game-runtime` 继续保持薄内核：

- world
- eventBus
- clock
- rng
- systems
- GameModule
- start / stop / tick

GameRuntime 不直接拥有 renderer、input、platform、asset、data、UI 或 DevTools。Camera/TCA/GAS 等 gameplay 会话能力不进入 GameRuntime 顶层，后续通过 GameModule helper 安装。

内置服务和扩展服务都必须通过同一套 Service Binding 进入 Host lifecycle。底层模块不为了 Host 改造自身协议；`@gamekits/app-host` 内部维护标准服务定义，将 profile 参数转换成 Service Binding。应用侧不需要直接调用一组 `createXxxService` factory。

Renderer lifecycle 仍不是 GameRuntime-owned。ADR 0002 的结论保留，但“app-owned”从手写 app 入口提升为 App Host 组合层负责。

## Consequences

收益：

- app 入口更薄，上层更关注具体游戏逻辑。
- Platform、Data、Asset、Renderer、Input 等应用服务有统一 lifecycle。
- Camera、TCA、GAS 等游戏会话能力可以通过 GameModule helper 无痛启动，同时不膨胀 App Host 标准服务。
- DevTools 可以从 Host snapshot 统一观察服务状态、配置来源和生命周期错误。
- 测试可以使用 headless Host 组合 fake platform、memory renderer、fake asset loader 和 deterministic input。
- 平台差异可以通过 profile、adapter 参数和标准 service builder 统一处理。

代价：

- 增加一个新的组合层，需要清晰约束它不变成巨型上帝对象。
- service dependency、启动失败回滚、dispose 顺序需要测试覆盖。
- 标准 service 快捷入口和扩展 registry 之间需要保持一致。
- 每个内置 service 都需要一个 binding 实现，否则 Host 会退化成内置服务特殊分支加扩展服务 registry 的双系统。

约束：

- App Host 不替代 GameModule。
- App Host 不替代 Platform。
- App Host 不替代 DevTools。
- App Host 不泄漏第三方库类型给 gameplay。
- App Host 不硬编码所有未来模块；标准 service 有快捷入口，扩展 service 通过 registry。
