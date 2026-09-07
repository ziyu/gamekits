# ADR 0020: Explicit Authority Pipeline And Bounded Correlation Source

Status: Accepted on 2026-07-12.

## Context

Outpost Siege 需要在同一个 headless authority runtime 中组合 Multiplayer ingress、app intent/AI、Physics、combat、GAS、TCA、checkpoint、replication、provider commit 和 diagnostics。GameRuntime 已经保证 system registration order，App Host 也公开了各 standard GameModule helper；如果再在框架中加入全局 phase catalog，会把具体游戏的 pipeline 固化成所有游戏都必须接受的协议。

同时，TCA、GAS 和 Physics 各自已有有界 trace store，但 trace 仍停留在三个独立 buffer。DevTools 无法直接展示 Multiplayer command → Physics fact → GAS operation → TCA reaction 的显式因果链。让 domain package 直接依赖 DevTools 会反转 gameplay/tooling 边界；每帧轮询并合并三个完整 buffer 又会制造不必要的复制和排序成本。

## Decision

Authority pipeline 继续由 app 显式组合：

- GameRuntime 只保证 module install order、system registration order 和 module cleanup reverse order。
- 简单应用继续使用 `standardModules` 默认装配。
- 需要 interleave standard module 和 app module 的 authority app，通过 `game.modules(ctx)` 按顺序调用 App Host 已公开的 `createStandardMultiplayerModule`、`createStandardPhysicsModule`、`createStandardGasModule`、`createStandardTcaModule`、`createStandardCameraModule` 与 app-owned module factory。
- App 必须用 headless composition test 固定 module id、system id、tick order、handle lifecycle 和 reverse disposal；框架不增加全局 phase enum 或 dependency scheduler。

DevTools correlation 使用增量、显式、有界的 source：

- `@gamekits/devtools` 提供 domain-neutral `createDevToolsCorrelationSource(...)`。它把 trace 写入 DevToolsRuntime 的有界 timeline，同时只维护最近 correlation 的增量 summary。
- Correlation source 只把显式 `correlationId` 视为确定因果；`parentId` 保留直接父 trace。它不按时间窗口猜测 gameplay 关系。
- Runtime trace buffer、retained correlation 数量和每条 correlation 保留的 root id 数量分别有独立上限。
- TCA、GAS、Physics trace store factory 提供可选 `onEntry` hook。Observer 和 observer error reporter 的异常都必须被 trace store 隔离，不能改变 gameplay write、rule、ability 或 physics step 的结果。Domain package 仍不依赖 DevTools；未配置 hook 时不增加 observer 工作。
- `@gamekits/app-host` 提供 `createGameplayDevToolsCorrelation(...)` 组合 helper，创建三套 domain trace store、注册一个 DevTools source，并通过单一 `dispose()` 完成注销和清理。调用方只拥有 helper 返回的组合生命周期，不分别管理 DataSource registration 和 source。
- 通用映射默认只输出白名单摘要：TCA rule/event/count、GAS operation/time/effect/message、Physics kind/tick/cost/body/collider。GAS `details`、Physics `payload` 等任意业务对象不默认进入 DevTools；游戏需要额外字段时必须显式提供 summary mapper，并可通过统一 redaction hook 再处理。
- Multiplayer standard module 产生的 accepted/rejected/expired/overflow EventBus fact 继承 message `correlationId`，并以 message id 作为 `parentId`。
- Physics trace protocol允许 app semantic query/contact bridge附带 correlation，但 Physics core 不推断 damage、ability 或 network 语义。

Performance gate 使用 50,000 条跨 App Host、TCA、GAS、Physics 和 DevTools 的 trace、512 条 runtime trace 上限、64 条 correlation summary 上限和每个 domain 64 条 trace 上限，分别约束增量写入成本、snapshot 成本和 retained size。

## Consequences

Positive consequences：

- Authority system order 对具体 app 明确、可测试，又不污染所有 GameRuntime consumer。
- Headless server、local authority fixture 和正式 Room 可以复用同一组 module factories。
- Multiplayer、Physics、GAS 和 TCA 可以在一个 timeline 中按显式 id 连接，不依赖时间窗口猜测。
- Domain runtime 不依赖 DevTools；App Host 继续承担跨模块组合职责。
- Trace 和 correlation index 均有界，DevTools snapshot 不需要重新扫描全部 domain buffer。

Costs and constraints：

- 复杂 authority app 必须维护自己的 module pipeline test；调整顺序时需要显式更新证据。
- App-specific World lifecycle、replication、cue 和 Save trace 仍需由 app source 映射，不能由通用 helper猜测。
- `onEntry` hook 中的自定义逻辑必须保持小且不执行 gameplay mutation；失败只产生有界 diagnostic。
- 自定义 summary mapper 是敏感字段的显式 opt-in；调用方负责保持结果小、可序列化，并按应用策略脱敏。
- 完整 authority trace 默认只留在 server DevTools；复制到 client 前仍需 redaction 和独立预算。

## Rejected Alternatives

### Add a global GameRuntime phase catalog

Rejected because不同游戏的 AI、Physics、combat、replication 和 presentation 顺序并不相同；GameRuntime registration order 已足够表达当前需求。

### Make TCA, GAS, and Physics depend directly on DevTools

Rejected because DevTools 是可选 tooling，不应成为 gameplay runtime 的必需依赖。

### Poll and merge complete trace stores every frame

Rejected because它重复复制、排序已经有界的 buffer，并把成本绑定到 frame rate，而不是实际低频 trace 数量。

### Infer correlation only from timestamps or entity ids

Rejected because时间接近不代表直接因果；推断关系可以作为未来 UI 辅助，但不能替代显式 correlation/parent contract。
