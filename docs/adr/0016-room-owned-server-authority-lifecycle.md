# ADR 0016：Room-owned Server Authority 与 Browser Leader 生命周期分离

## Status

Accepted

## Context

现有 Relay Arena 使用 browser 创建并拥有一个 server-side host runtime。该模式适合验证 host-authoritative baseline，但 browser host 离开时 authority simulation 也随之关闭，不能表达 dedicated/server-authoritative room、seat reservation、leader transfer 和 server-owned reconnect grace。

Outpost Siege 需要 Colyseus Room 自己持有 headless authoritative runtime。Browser 中的 room creator 仍需要 start、rematch 和 close 等 party leader 权限，但 party leader 不应因此成为 gameplay state writer，也不应决定 server simulation 的存续。

同时，server GameRuntime 需要把 network ingress、AI、Physics、combat、replication 和 Schema commit 放在同一个 fixed authority tick 的明确顺序中。现有 authority loop 把输入消费、simulation callback 和 snapshot publish 合并为一次调用，不适合在中间插入多个 GameModule system。

## Decision

Server-authoritative multiplayer room 采用 Room-owned lifecycle：

- Provider Room 创建并持有一个 headless App Host，由 App Host 统一管理 server GameRuntime、World、Multiplayer service/module、Physics、DevTools/diagnostics 和 dispose。
- Room 是 authority endpoint 和 fixed-step scheduler 的所有者。Browser client、party leader、spectator 和 bot 都不能推进 authority clock。
- Party leader 是 app-owned permission role，只能提交 start、rematch、leader transfer 或 room close 请求；请求必须经过 server policy，不能获得 authority state write capability。
- Room close、idle timeout 或 server shutdown 统一 dispose App Host、GameRuntime、physics scene、listener、timer、queue、peer binding 和 replication state。Leader leave 不自动关闭仍有 participant 或保留 seat 的 server-authoritative room。
- `@gamekits/multiplayer-colyseus/server` 可以提供 typed room-side runtime bridge，把 Colyseus Room 的 join/leave/message/send/snapshot lifecycle 映射为 GameKits provider-neutral MultiplayerRuntime/authority ingress。该 bridge 不拥有 app gameplay、participant policy 或 app Schema。
- `@gamekits/multiplayer-core` 的 authority helper 允许把一个 authority tick 拆成 ingress 与 commit 两个受约束阶段：ingress 消费有界 action/latest input，app-owned GameRuntime systems 在中间运行，commit 在 simulation 完成后捕获并发布状态、推进 ack/version 和 diagnostics。原有单调用 loop 可以作为兼容便利入口保留。
- Server app 显式组合 system 顺序：network ingress → gameplay intent/AI → physics → contacts/combat/lifecycle → replication projection → provider commit → diagnostics。暂不为此向 GameRuntime 引入全局 phase catalog；只有第二个稳定场景需要相同调度协议时再评估下沉。
- Host-authoritative Relay Arena 继续保留。Host authority 离开时可以关闭 room；server-authoritative Room-owned 模式不得复用这条 host-close policy。

## Consequences

收益：

- Browser creator 关闭或 leader 转移不会中断仍有效的 server simulation。
- App Host、GameRuntime、Physics 和 diagnostics 的 server lifecycle 有单一 owner，room close 后可以统一验证 cleanup。
- Authority ack 和 Schema commit 只在完整 simulation tick 完成后推进，不会确认尚未进入 Physics/combat 的输入。
- Colyseus Room integration 保留在 backend package，gameplay domain 继续只依赖 GameKits authority contract。

代价：

- `@gamekits/multiplayer-colyseus/server` 需要新增 room-side bridge 和真实 Room lifecycle tests。
- Authority helper 需要向后兼容的阶段化接口、重入保护、异常边界和更细 diagnostics。
- Server app 必须显式定义模块顺序和 room close policy，不能依赖 browser host 或 UI 状态隐式决定。

约束：

- Room/Client/Schema/socket 类型不得进入 `multiplayer-core`、Data、Save 或可复用 gameplay module。
- 每个 room 只能有一个 authority clock owner。
- Explicit leave、transport disconnect、provider reconnect、leader transfer 和 room close 必须产生不同 lifecycle fact。
- 保留 seat 或 reconnect token 的有效期由 provider/app server policy 管理，secret 不进入普通 diagnostics 或 Save。

## References

- ADR 0013：`docs/adr/0013-standard-authoritative-replication-boundary.md`
- Multiplayer 模块：`docs/modules/multiplayer.md`
- Outpost Siege 应用：`docs/apps/multiplayer-outpost-siege-demo.md`
