# Core / Runtime 模块设计

## 定位

Core / Runtime 是 GameKits 的薄内核。它只提供稳定协议、低层工具和生命周期组合，不承载具体玩法、渲染、资源加载、输入或 UI 实现。

相关包：

- `@gamekits/core`
- `@gamekits/event-bus`
- `@gamekits/game-runtime`

## `@gamekits/core`

职责：

- `Registry<T>`
- `GameModule` / `defineGameModule`
- `Clock`
- Seeded RNG
- `GameError`
- `Result`
- 通用 ID / logger 等基础工具

原则：

- 不依赖具体游戏 app。
- 不依赖 Koota、Phaser、React、Tauri 等第三方实现。
- 错误需要稳定 `code` 和上下文。
- Registry 默认重复注册和缺失读取都抛明确错误。

## `@gamekits/event-bus`

职责：低频 gameplay/runtime event。

事件结构：

```ts
export type GameEvent<TPayload = unknown> = {
  type: string;
  payload: TPayload;
  timestamp: number;
  source?: string;
  correlationId?: string;
  parentId?: string;
};
```

`correlationId` 连接同一次低频因果链，`parentId` 指向直接产生当前 fact 的 trace 或操作。Correlation metadata 属于事件 envelope，不要求每个 gameplay payload 重复定义调试字段；TCA、GAS、Multiplayer 和 DevTools 可以在派生 fact 中继续传播它。它只用于解释关系，不能改变事件顺序或玩法结果。

适合进入 EventBus：

- actor.created
- actor.died
- hero.enter_tile
- ability.activated
- effect.applied
- clue.revealed
- asset.loaded
- runtime.started

不适合进入 EventBus：

- 每帧 position 更新。
- 每帧 render object patch。
- 高频 pointer move。
- 大量 input raw event。

## `@gamekits/game-runtime`

职责：

- 安装 GameModule。
- 管理 world、eventBus、clock、rng。
- 注册和执行 systems。
- 提供 `start()`、`stop()`、`tick(delta)`。
- 释放 GameModule 安装时注册的订阅、桥接和内部 runtime。

长期方向：

```ts
export type GameRuntime = {
  world: GameWorld;
  eventBus: EventBus;
  clock: Clock;
  rng: Rng;

  start(): void;
  stop(): void;
  tick(delta: number): void;
  dispose(): void;
};
```

应用级能力：

- `input`
- `platform`
- `assets`
- `data`
- `ui`
- `devtools`

这些能力不进入 `game-runtime` 顶层，也不让 `game-runtime` 直接绑定具体实现。它们由 App Host 通过 service registry、lifecycle 和 bridge module 组合到应用中。长期设计见 `docs/modules/app-host.md`。

游戏会话能力：

- `camera`
- `tca`
- `gas`
- gameplay save capture / restore
- gameplay-specific UI binding

这些能力不进入 `game-runtime` 顶层，但应优先通过标准 GameModule helper 安装，而不是让每个 app 手写 EventBus 订阅、system 注册和 cleanup。

## GameModule

GameModule 是功能安装单位。

模块可以注册：

- Components
- Systems
- TCA triggers / conditions / actions
- GAS definitions
- Data loaders
- UI windows
- Asset loaders
- DevTools panels

长期安装协议：

```ts
export type GameModule<TInstallContext = unknown> = {
  id: string;
  install(ctx: TInstallContext): void | GameModuleCleanup | GameModuleDisposable;
};

export type GameModuleCleanup = () => void;

export type GameModuleDisposable = {
  dispose(): void;
};
```

`install()` 可以返回 cleanup。GameRuntime 在 `dispose()` 时按模块安装反序执行 cleanup。`stop()` 只停止 tick，不释放模块订阅；`dispose()` 释放 EventBus 订阅、adapter bridge、trace runtime、camera controller runtime 等长期句柄。

模块原则：

- 模块安装应可测试、可重复推理。
- 模块不得直接导入底层 adapter 私有类型。
- 模块注册顺序影响运行时行为时，必须通过文档或测试固定。
- 标准模块 helper 应隐藏重复装配，例如 TCA 的 EventBus 订阅和 trace store lifecycle、Camera 的 input action 绑定和 renderer adapter sync。

## Tick 边界

Tick 顺序：

```txt
update runtime clock
→ execute systems in registration order
→ emit low-frequency diagnostics if needed
```

要求：

- `stop()` 后 system 不执行。
- 高频逻辑放 system。
- 中低频事实通过 EventBus。
- React 不进入主循环。

## Runtime Profiling 边界

GameRuntime 不直接依赖 DevTools，但必须保留可被外部包装和观察的 system 执行边界。Runtime profiler 的职责是测量运行时结构，不改变运行时语义。

Runtime 层应暴露或保留这些可观察事实：

- tick id / runtime clock。
- system id。
- module id where available。
- system registration order。
- system duration。
- tick total duration。
- system error 与原始抛错路径。

Profiler 接入规则：

- profiler 可以由 App Host、test harness 或标准 runtime wrapper 注入。
- profiler disabled 时不应在每帧创建大量对象、闭包或数组。
- `stop()` 后 system 不执行，也不记录 system sample。
- system 抛错时，profiler 可以记录 diagnostic/span failure，但必须继续按原路径抛出错误。
- profiler 不改变 system 顺序，不合并 system，不吞掉 system，不修改 world/eventBus。
- 每帧完整 world snapshot、component dump 或 render object tree 不属于 Runtime profiler；这些只能通过 DevTools pause/detail 或模块专属 source 读取。

## 最佳实践

### 模块集成

- GameModule install 成功返回的 cleanup 在后续模块安装失败时反序执行；install 内部在返回 cleanup 前失败的局部资源由该模块自己释放。dispose 尝试全部 cleanup，即使 runtime.stopped listener 抛错也不跳过资源释放；错误在全部尝试后报告。

- GameRuntime 集成只负责模块安装、clock、system tick、start/stop/dispose 和低频 runtime event，不负责 boot App Service 或创建外部 runtime。
- 标准 GameModule helper 应隐藏重复装配，例如 TCA 的 EventBus 订阅和 trace store lifecycle、Camera 的 input action 绑定和 renderer adapter sync。
- GameRuntime 的 system 注册顺序是行为契约。新增标准模块 helper 时，如果顺序影响结果，必须用测试固定，并在模块设计中说明依赖。
- GameModule `install()` 应只做注册和订阅，不隐式启动外部 runtime；订阅、interval、adapter bridge 和 trace store cleanup 必须在 GameRuntime dispose 时释放。
- Runtime profiler wrapper 属于集成层；它可以测 system/tick，但不能把 DevToolsRuntime 变成 GameRuntime 的必需依赖。

### 模块使用

- `@gamekits/core` 只放低层通用工具，例如 Registry、Clock、Result、GameError、seeded rng 和 GameModule 类型；不要把 renderer、input、asset、platform、Physics、TCA、GAS 或具体游戏概念塞进 Core。
- Registry、Clock、GameError 等基础工具的错误消息要稳定、可测试、可定位，避免为了方便返回 `undefined` 后让调用方在更远处失败。
- EventBus 事件应表达已经发生的低频事实，事件 payload 保持小而可序列化；跨模块链路通过 envelope 的 `correlationId` / `parentId` 传播，不把调试关系塞进每种业务 payload。不要用 EventBus 广播每帧 transform、raw pointer move、held input 或 render patch。
- EventBus envelope 或 listener dispatch 发生变化时，应运行 `corepack pnpm bench:gameplay:check` 的 correlated fan-out 场景，观察突发低频事实的数量级退化；该预算不是允许把 EventBus 当成逐帧状态总线。
- `start()`、`stop()`、`tick()`、`dispose()` 的边界要清楚：`stop()` 不释放模块，`dispose()` 释放长期句柄，`tick()` 不应该悄悄 boot app service。
- 需要定位性能问题时，优先读取 Runtime profiler 的 system/tick summary，再决定是否开启更深的模块级 trace；不要把高频数据塞进 EventBus 或 React UI。
- 测试优先覆盖 lifecycle、重复安装、system 顺序、stop 后不执行、dispose cleanup、clock restore 和错误路径。
