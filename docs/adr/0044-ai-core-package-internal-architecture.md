# ADR 0044: AI Core Package Internal Architecture

Status: Accepted on 2026-07-23.

## Context

`@gamekits/ai-core` 第一版把 agent definition、perception memory、blackboard、Utility
scoring、goal selection、task lifecycle、scheduler、intent、trace、checkpoint、Handle、
GameModule 和 conformance 聚合在 `src/data + src/runtime + runtime/types.ts` 中。
`createAiRuntime()` 同时编译内容、持有全部 agent state、推进感知/决策/任务、处理存档并
发布诊断，已经形成千行 composition root。

这种结构掩盖了状态所有权，也让公共协议无法执行既定边界：sensor、consideration 和 task
executor 都能从 `AiAgentReadContext` 获得完整可写 `GameWorld`；blackboard 使用无上限
`Map`；测试 conformance 从游戏默认入口导出；scheduler 的 priority 和分类预算也容易继续
堆在同一闭包里。

## Decision

### 使用 AI 领域职责结构

```txt
src/
  index.ts
  contracts/
  definition/
  memory/
  perception/
  decision/
  task/
  scheduler/
  observability/
  persistence/
  controller/
  composition/
  testing/
```

各目录职责：

- `contracts`：agent binding、只读 World/Physics/Navigation capability、intent envelope 和稳定错误。
- `definition`：agent/sensor/goal/task 定义、DataType、不可变 clone 与 bind-time compiler。
- `memory`：有界 perception memory、blackboard、值校验和过期策略。
- `perception`：sensor registry、采样上下文和预算内采样。
- `decision`：utility curve、score breakdown、deterministic selector 和切换原因。
- `task`：executor context、start/update/cancel/finish、interrupt policy 和 failure/backoff。
- `scheduler`：stable bucket、LOD class、priority/fairness 及分类预算。
- `observability`：snapshot projection、trace store、summary 和 observer isolation。
- `persistence`：checkpoint codec、版本校验、entity remap 和 Save contributor。
- `controller`：单 agent 状态协调与游戏侧 Handle contract。
- `composition`：runtime/module/options，连接上述组件但不重新实现领域算法。
- `testing`：memory fixture、runtime conformance 和测试支持。

内部依赖方向为：

```txt
contracts / definitions
          ↓
memory / perception / decision / task / scheduler
          ↓
controller / observability / persistence
          ↓
composition
```

### Executor 只获得窄能力

- `AiAgentReadContext.world` 使用 `AiWorldReadModel`，只提供 `has/get/query/count`；运行时
  不把 `spawn/despawn/add/set/remove` 暴露给 sensor、consideration 或 task。
- Navigation 依赖收窄为 `NavigationQueries`，不向 AI 暴露 obstacle mutation、runtime tick
  或 Backend lifecycle。
- Physics 依赖收窄为 `PhysicsQueries`，不向 AI 暴露 body/collider mutation、scene step、native
  backend 或 lifecycle。
- 共享 encounter/队伍/目标事实通过 `AiSharedFactQueries` 注入。它只提供 `facts/fact` 读取并返回
  隔离副本；Core 不拥有共享 fact cache，也不把共享事实隐式复制进每个 agent memory。
- Task 只能提交 `AiIntent`、维护自己的 task state 或写 AI-owned blackboard；Physics、GAS、
  Combat、Renderer 和 UI 结果继续由 app gameplay systems 决定。
- `createAiModule()` 负责把 `GameInstallContext.world` 投影为只读 read model；Core 不复制
  World 状态。

### Blackboard 必须有显式硬上限

- `AiAgentDefinition.blackboardLimit` 可覆盖 runtime 默认值；未声明时使用有界默认值。
- 超出 entry capacity 的新写入原子失败，不能静默淘汰 task 正在使用的 key。
- Blackboard value 只接受可保存的有限深度/节点 JSON-like value；循环引用、函数、
  `undefined`、非有限数字和 class/native object 被稳定错误拒绝。
- 读取、snapshot 和 checkpoint 返回隔离副本；restore 在替换现有状态前完整校验。

### 公共入口按消费者拆分

- `@gamekits/ai-core`：游戏/app 使用的 definition、intent、runtime、Handle、GameModule、
  observability 和 Save API。
- `@gamekits/ai-core/testing`：runtime conformance 与 memory fixture。

Root 不导出 conformance、测试替身、内部 agent state、registry、scheduler queue 或 trace store。
`AiPlanner` 不建立只有类型没有 runtime 语义的假入口；只有第二个真实游戏证明动态多步计划
需求后，才通过单独 ADR 增加 planner adapter subpath、硬预算和 conformance。

### Trace 留存使用上层可配置的分类硬上限

- Runtime 通过公开的 `traceRetention` 接受全局 `limit`、类别白名单 `kinds` 和类别上限
  `kindLimits`；App Host 不建立第二套 trace 策略，只透传 GameModule 配置。
- 全局 limit 始终是最终硬上限，类别上限只会进一步减少留存，不允许扩大总容量。
- 默认配置保持有界并兼容已有调用；需要长诊断窗口的 app 应减少逐 tick `intent` / `perception`
  留存，把容量优先留给 goal、task、failure 和 budget，而不是无限扩大数组。
- Trace store 继续是包内实现，不把 ring buffer、索引或淘汰结构暴露为 gameplay 公共 API。

### 高频能力使用独立预算并支持动态 LOD

- `maxSensorSamplesPerTick`、`maxDecisionsPerTick`、`maxPathRequestsPerTick` 和
  `traceProduction.maxEntriesPerUpdate` 是互相独立的硬预算；Navigation runtime 继续拥有更底层的
  queue/backend budget，AI 不复制其调度器。
- AI path request 超限时不进入 Navigation backend，返回可通过同一 query facade `poll()` 的
  稳定 `queue-full` rejection；不抛出异常，也不创建无界 deferred request state。
- App threat/visibility/distance policy 通过 `setSchedulerClass()` 动态调整已绑定 agent。切换缩放
  尚未到期的 sensor/decision due time，已经 overdue 的工作保持 overdue，避免通过 LOD 切换逃避
  fairness。
- Trace retention 与 production 分离。Live observer 不依赖 ring buffer 是否留存；单 update
  超限时聚合成一条 drop summary。Utility breakdown 默认不复制，按 profile 选择 winner/all。

### Restore 由上层重绑外部 identity

- Checkpoint 保存当前 scheduler class；旧 checkpoint 未包含该字段时回退到 definition class。
- Core 内建 entity/actor id resolver，并提供 task-state resolver 给 app 重绑 route/path 等稳定
  handle。Resolver 在替换 live agent 之前执行，失败保持 restore 原子性。
- Task-state resolver 明确返回 `undefined` 时，Core 丢弃无法继续的 active task、goal commitment，
  并把下一次 decision 安排到 checkpoint elapsed；不继续持有失效 native handle。

### 迁移保持游戏侧创建 API 稳定

`createAiRuntime`、`createAiModule`、`createAiHandle`、definition type id、intent envelope 和
checkpoint version 在此次内部重构中保持名称稳定。窄 read model 与 blackboard value 是 alpha
阶段有意收紧的公共协议；App Host、test-utils、benchmark 和测试在同一改动中迁移。

## Consequences

Positive consequences:

- AI task 的公共类型不再允许直接改写 World 或 Navigation runtime。
- memory、decision、task 和 scheduler 可以独立测试和优化，不再继续扩大 god runtime。
- Blackboard、trace、scheduler 和 checkpoint 都有可验证的容量语义。
- 高频 trace 不再必然挤掉低频 task/failure 证据，应用可以按诊断目标控制留存成本。
- 游戏消费者和测试消费者使用不同入口，默认 API 不泄漏 fixture。

Costs and constraints:

- 文件数量和显式组件连接增加，公共 alpha 类型需要同步迁移。
- 只读 World facade 是编译期和 capability-level 边界；应用仍需避免把可写 World 通过闭包
  私下捕获进 executor。
- Blackboard 不再接受任意 JavaScript object，业务需要把 native/runtime object 留在 adapter
  或 app-owned state。
- 后续拆分必须保持当前 benchmark 数量级，并持续覆盖 target/dynamic-LOD churn、bulk unbind 和
  overload fairness。

## Rejected Alternatives

### 只拆 `createAiRuntime()` 文件

Rejected because 完整 World 泄漏、无界 blackboard 和 root 测试出口仍然存在，移动函数不能
修正能力边界与状态所有权。

### 给 `GameWorld` 标记 TypeScript `Readonly`

Rejected because `Readonly<GameWorld>` 只禁止替换方法属性，不会移除 `spawn/set/remove` 等
可写方法。AI 需要实际只包含 read capability 的 facade。

### Blackboard 超限时淘汰最旧 key

Rejected because blackboard 是显式 task 协作状态，静默淘汰会让行为依赖写入顺序且难以解释。
Perception memory 可以使用确定性淘汰，blackboard capacity 则必须显式失败并进入 trace/error。

## References

- AI module: `docs/modules/ai.md`
- Package boundary: `docs/adr/0031-gameplay-foundation-packages-and-agent-ai.md`
- Architecture: `docs/architecture.md`
- Implementation principles: `docs/implementation-principles.md`
