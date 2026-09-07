# ADR 0028: Managed Client Replication Runtime

Status: Accepted on 2026-07-15; immediate edge sampling amendment accepted on 2026-08-07.

## Context

`@gamekits/multiplayer-core` 已经提供 snapshot playback、declared presentation tracks 和 prediction buffer，但游戏仍需要自己在网络 callback 与 render loop 中调用 `present()`、`predict()` 和 `reconcile()`。这种“只提供零件”的 API 让每个游戏重复实现接收顺序、authority source gate、输入 sequence、固定频率采样、snapshot ack、binding reset 和 Renderer/Camera 同步；某个 app 忘记其中一步时，即使底层能力完整，低频权威快照仍会直接表现为阶梯移动。

这些调度语义跨游戏和 backend 稳定，属于 Multiplayer Core，而 snapshot shape、可插值字段、预测状态转移和最终表现写入仍然是游戏声明。

## Decision

Multiplayer Core 提供 managed client replication runtime，并由标准 Multiplayer GameModule 默认持有其 lifecycle：

- Runtime 自动订阅归一化 `game.snapshot`，根据显式 binding 或 core session/peer role 解析 authority endpoint，执行 session/source gate、单调 tick gate、最新完整快照 coalescing 和 binding-change reset。
- Provider-native adapter mapping 可以配置 provider-neutral `snapshotSource`，互斥替换默认 Runtime envelope subscription。Source 可通过 `current()` 暴露最新全量状态，Core 在 authority binding 就绪后自动补取，消除 provider initial callback 早于 facade session binding 的时序差。Source 将单调 provider state version 放入 message sequence，同一 gameplay tick 内的新 provider revision 可替换播放缓冲中的最新状态；普通 envelope 仍按 gameplay tick 去重，transport sequence 不作为 provider version。Binding/session reset 清空两类排序水位。
- Runtime 在 GameRuntime tick 内自动推进 snapshot playback 与 declared `Network*` track projector；游戏只配置 snapshot decoder、timeline、track declaration、snap/reset policy 和最终 `applyFrame` writer。
- 启用 local prediction 后，Runtime 按配置频率读取当前 input state、分配 sequence、发送 `game.input`、推进 bounded prediction buffer，并在权威 snapshot 携带 ack 时自动 reconcile、replay 和 correction smoothing。标准字段表现通过 ADR 0029 的声明式 predicted-state fields 配置，不要求游戏回调手写插值或 correction offset。
- Runtime 通过 `maxPredictionLeadInputs` 限制未确认 prediction input 数；达到上限时保留当前控制状态但暂停产生新的 simulation step/send，等 authority ack 释放窗口后再读取最新输入。该 backpressure 防止 client/authority timer 的微小漂移长期累积成 queue overflow、sequence gap 和周期性回拉，并通过 `throttledInputs` 暴露诊断。
- 稳定 `inputRateHz` 仍是连续控制的默认采样节奏；Rifle press、Dash 等延迟敏感边沿可以在更新 app-owned input state 后调用 replication view 的 `requestInputSample()`，请求下一次 replication update 立即采样一次。Core只合并请求并复用同一 sequence、prediction buffer、send、ack、lead backpressure和失败恢复链路，不创建第二套 app-local predictor或发送循环；同一 update前的重复请求合并为一次，领先窗口已满时仍必须节流。
- Local GameRuntime tick 只用于客户端 prediction frame，不默认写入 outgoing authority tick 字段。Transport send 失败时，Runtime 记录失败 sequence；下一份未确认该 sequence 的 authority snapshot 会自动从权威状态 reset prediction buffer，避免未真正发送的输入永久留在 replay history。Binding generation 会隔离旧 session 的异步失败回调。
- 同一 `applyFrame` 同时暴露 remote presented tracks 与 local predicted state。Renderer 和 follow camera 必须消费这一帧的同一 transient state；权威 World、Physics、Save 和 provider state 不读取或保存 presented/predicted 值。
- App Host standard multiplayer module 只透传 `clientReplication` 配置到 Multiplayer Core factory；App Host、backend adapter 和 app 不复制调度 runtime。
- Low-level playback/projector/prediction factories 继续作为测试、特殊 netcode 和工具 escape hatch，但普通游戏集成不在外部 render loop 中显式调用它们。

Core 只自动拥有稳定的调度和 lifecycle。游戏仍必须声明：

- 不可信 payload 如何解码为 app-owned snapshot。
- tick/server-time 如何映射到 presentation timeline。
- 哪些字段允许插值，以及 teleport/phase/generation/resync 何时 snap/reset。
- 本地输入如何推进一个 prediction step，以及如何从 snapshot 读取 local authoritative state 和 acknowledged sequence。
- presented values 如何批量写入 app-owned render target、Camera target 或 transient presentation cache。

## Consequences

Positive consequences:

- 新游戏只需启用标准模块并声明数据映射/策略，不再重复网络 callback 与逐帧 prediction/playback 调度。
- Authority gate、input sequence、snapshot ack、binding reset、bounded queue 和 diagnostics 在不同 app/backend 间保持一致。
- 漏接 interpolation 或 reconciliation 不再是 demo 默认路径；直接把低频 authority transform 写入 Renderer 需要显式绕过标准 runtime。
- Local prediction 和 remote playback 使用同一 GameRuntime frame，Camera 不会再跟随另一份离散时钟。
- 延迟敏感输入边沿不必等待完整 fixed input interval，同时仍保留统一的 prediction/reconciliation 诊断与有界队列。

Costs and constraints:

- Managed runtime 是 Multiplayer Core 的高频路径，必须保持有界、低分配，并同时建立小队与高 entity-count benchmark。
- 游戏仍要提供确定性的 prediction step；Core 不能猜测碰撞、移动规则、teleport 或可预测玩法字段。
- Provider-native Schema 可以替换 snapshot delivery，但不能在 adapter 中另建一套 prediction/presentation clock；它仍应进入 managed runtime 的 authority-shadow 输入边界。

## Rejected Alternatives

### Keep explicit app-level calls as the primary integration

Rejected because it让正确体验依赖每个游戏重复拼装同一调度，并且已经导致 Outpost 在拥有 Core 能力的情况下仍以 20 Hz 直接驱动 Renderer 和 Camera。

### Put interpolation and prediction into each backend adapter

Rejected because playback/prediction policy属于 GameKits multiplayer/presentation 语义，不属于 Colyseus、Nakama 或其他 provider；放入 adapter 会造成 backend 间行为漂移并泄漏游戏字段。

### Automatically reflect and interpolate the complete snapshot object

Rejected because boolean、phase、inventory、combat fact 和 teleport 不能安全地从字段类型猜测语义。Core 自动拥有调度，但 track 和 prediction transition 必须显式声明。

## References

- Multiplayer module: `docs/modules/multiplayer.md`
- Architecture: `docs/architecture.md`
- ADR 0013: `docs/adr/0013-standard-authoritative-replication-boundary.md`
- ADR 0014: `docs/adr/0014-multiplayer-presentation-temporal-buffer.md`
- ADR 0026: `docs/adr/0026-core-first-domain-semantic-ownership.md`
- ADR 0029: `docs/adr/0029-declarative-prediction-state-presentation.md`
