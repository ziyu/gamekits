# ADR 0014：Multiplayer Presentation 使用时间采样和类型化插值

## Status

Accepted

## Context

ADR 0013 已经把 Multiplayer 的标准同步边界收敛为 authority endpoint → authoritative snapshot/patch/result → client receiver → presentation / prediction / interpolation。接下来需要明确 presentation helper 的长期形态。

最直接的做法是提供一个 keyed `{ x, y }` smoothing helper。它能快速改善 demo 中低频 snapshot 导致的跳变，但长期限制很明显：实际游戏需要平滑的状态不止二维位置，还包括速度、朝向、3D transform、camera target、动画 blend、projectile trail、载具、载具乘客、携带物、UI indicator 等。同时，泛化成“递归遍历任意 snapshot 并自动插值所有 number”的方案也不合适，因为 snapshot 里包含 score、phase、cooldown、enum、boolean、inventory、事件和 authority metadata；这些字段不能按同一规则插值，深度遍历还会放大每帧成本和语义风险。

已有多人/网络同步实践通常把问题拆成两层：

- 网络层接收带 tick/time/version 的 authoritative snapshot，并在客户端维护一个短期 snapshot interpolation buffer。
- 游戏或 presentation 层显式声明哪些字段能插值、使用哪种 `Network*` presentation track、何时 snap/reset，以及本地 prediction 如何被 authority 校正；底层根据这些声明产出 typed presented values。

参考资料：

- [Gaffer On Games: Snapshot Interpolation](https://gafferongames.com/post/snapshot_interpolation/)
- [Unity Netcode NetworkTransform](https://mp-docs.dl.it.unity3d.com/netcode/current/components/networktransform/)
- [Colyseus Phaser Linear Interpolation Tutorial](https://docs.colyseus.io/learn/tutorial/phaser/linear-interpolation)

## Decision

Multiplayer presentation 的长期公共设计采用“temporal snapshot buffer + typed interpolation primitives + declared `Network*` track projection + app-owned final write”。

`@gamekits/multiplayer-core` 应提供 provider-neutral 的 presentation timing toolkit：

- 按 `tick`、`serverTime` 或 provider version 接收 authoritative snapshot。
- 维护短期 ordered buffer，处理过期、乱序、重复、resync、trim 和 reset。
- 按 render time 和 interpolation delay 采样，返回 `previous`、`next`、`alpha`、`status`、snapshot age、delay、buffer length、dropped/stale counters 等诊断。固定 delay 是可用基线；标准 playback 也允许根据新 snapshot 的到达间隔与 authority 时间间隔估计 jitter，在明确的 minimum/maximum delay 内快速增加缓冲、缓慢恢复，并公开 current delay、target delay 和 estimated jitter。
- 提供低成本 typed interpolation primitives，例如 number、angle、vector2、vector3、quaternion/slerp 和 step/snap value。
- 提供 declared `Network*` presentation tracks，由 game/app 声明 selector、track key 和 snap policy，core 根据 sampled `previous` / `next` / `alpha` 产出 typed presented values。Runtime 热路径使用 reusable projector、writer-style selector 和 direct-write getter，避免每帧创建 projection map、sample array 或临时 vector clone。

`@gamekits/multiplayer-core` 不提供 deep generic snapshot interpolator，也不把二维 vector smoothing helper 作为稳定抽象中心。

游戏或 app presentation 层负责 track declaration 和最终写入：

- 从具体 `ArenaSnapshot`、`PlayerSnapshot`、`CoreSnapshot` 或其他 gameplay snapshot 中挑选可表现字段。
- 为每个字段选择 `Network*` track、track key、snap distance、teleport/phase reset、短暂 extrapolate 或 step policy；高频字段优先用 `selectInto(writer)`，避免在 selector 中构造临时数组。
- 读取底层算好的 presented value，并写入 render-only snapshot、renderer native object、camera display state 或 UI view model。高频 runtime 优先使用 `vector2Into`、`vector3Into`、`quaternionInto` 等 direct-write getter 写入复用目标；完整 render-only snapshot clone 只适合测试、小工具和低规模便利路径。
- 确保 presented state 不写回 authority state、Save payload、DataType 或 provider-native state。

Prediction / reconciliation 与 remote interpolation 分开：

- 本地玩家可以基于 input 做 prediction，并在 authoritative snapshot 到达后校正。
- 固定 tick prediction 的 simulation endpoint 不直接作为 renderer state；core prediction buffer 维护 fixed-step presentation clock，并在 cloned state 上按游戏声明在本预测步的起点和终点之间采样。已经包含完整 fixed step 的 endpoint 不再从终点向未来重复 extrapolate。Reconcile 立即更新 simulation state，但小幅 correction 以“旧显示目标与新校正目标的误差”表示，并把该误差叠加到持续移动的新 target 上按 duration 衰减；不能从固定旧显示状态直接 lerp 到移动 target。大幅 correction、teleport 和 hard reset 直接 snap 并清空表现缓存。
- 远端 entity 默认通过 snapshot buffer 插值。
- 两者共享 authority receiver、snapshot age、tick drift、correction magnitude 和 resync diagnostics，但不混成一个 backend adapter 行为。

Backend adapter 职责保持不变：

- Colyseus、Nakama 等 provider 可以提供 state sync、server tick、room metadata、reconnect 和 native bridge。
- Adapter 不 hard-code 具体游戏字段的 interpolation。
- Provider-native state sync 可以成为 authoritative source，但必须通过 authority binding 标记 source、tick/version、resync 和 diagnostics。

## Consequences

收益：

- 同时支持 2D、3D、camera、UI indicator 和 renderer-native presentation，不被 `{ x, y }` helper 限死。
- 避免深度通用插值误处理 score、phase、enum、boolean、事件和 authority metadata。
- 高频路径的字段数量、类型和 allocation 可由调用方显式控制，性能模型更清晰。
- 稳定网络可以使用较小 interpolation delay，snapshot arrival jitter 增大时底层自动扩大有界缓冲，不要求每个游戏重复实现 jitter estimator。
- Offline/local、host-authoritative、server-authoritative 和 provider-native state sync 都能共享同一条 presentation contract。
- Backend adapter 继续保持 provider 接入层，不膨胀成游戏表现层。

代价：

- 游戏需要显式声明 track projection；core 不能自动知道哪些字段可插值，但遵循声明式 track contract 的场景不应在 app 层重复实现通用插值。
- Core API 会比单个 vector helper 多一层时间采样概念，需要测试 buffer delay、乱序、reset 和 sample status。
- Runtime 热路径需要复用 projector；一次性 `presentSnapshotTracks()` 仍可用于测试和小工具，但不作为大规模 entity presentation loop 的推荐入口。
- 自适应 delay 会在远端视觉延迟和 buffer under-run 风险之间动态取舍；游戏仍需按品类设置合理的 min/max，不能把无界 delay 当成隐藏网络问题的手段。
- Prediction/reconciliation 仍需要游戏侧规则参与，不能由 provider-neutral helper 自动完成。

约束：

- 不把插值后的 presented state 写回 authoritative simulation、Data save payload 或 provider-native room state。
- 固定步离散 command 的 authoritative ack 只能确认已经被对应 snapshot 的 simulation tick 消费；仅收包或排队不能推进 ack。连续 input state 采用 latest-per-source coalescing 时，ack 可以跨过被新状态 supersede 的旧采样，但 latest state 必须已经被 simulation tick 采用，不能让同频 FIFO backlog 变成隐藏输入延迟。
- Authority binding 变化、session reset、snapshot version change、phase hard transition、teleport 或 resync 必须 reset 相关 presentation buffer / prediction cache。
- Multiplayer demo 和 conformance tests 不能只断言移动“看起来更平滑”；还要断言 snapshot age、delay、stale/drop counters、reset cleanup 和 authority source gate。

## References

- ADR 0013：`docs/adr/0013-standard-authoritative-replication-boundary.md`
- Multiplayer 模块设计：`docs/modules/multiplayer.md`
