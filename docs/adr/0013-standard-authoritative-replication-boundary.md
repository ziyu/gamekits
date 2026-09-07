# ADR 0013：Multiplayer 提供标准权威复制边界

## Status

Accepted

## Context

ADR 0010 定义了 Multiplayer Core 与 backend adapter 的边界，ADR 0012 决定优先接入 Colyseus 等成熟 backend，而不是在 GameKits 内自研通用 room、transport、presence、reconnect 或 state sync engine。

这个方向仍然留下一个高风险缺口：如果 core 只提供 session、peer、message envelope 和 backend adapter，app 很容易写出“网络层已连接，但 gameplay state 仍然各端本地运行”的伪多人体验。UI 可以显示多个 peer 在同一个 room 中，但 ready、start、input、simulation、snapshot 仍各自独立。这不是单个 demo 的小问题，而是底层抽象没有提供足够强的标准同步路径。

GameKits 不应把玩法规则、碰撞、得分或具体 snapshot schema 上推到 `multiplayer-core`；但它必须提供一条清晰、可测试、可复用的权威复制边界，让 app 不需要手写多人同步骨架，也不能轻易把“connected session”误当作“authoritative gameplay state 已绑定”。

同一条边界还必须覆盖离线单机。单机/offline 不能走一套完全独立的 gameplay runtime；它应该绑定到 in-process local authority endpoint，复用相同的 action/input、tick、validation、snapshot/patch/result 和 diagnostics 语义，只是不经过远程 backend transport。

## Decision

Multiplayer 采用“成熟 backend 负责底层多人能力，GameKits core 提供标准权威复制组合边界”的分工。

`@gamekits/multiplayer-core` 应提供 provider-neutral 的 authority / replication toolkit，用来表达以下稳定流程。这条流程是跨 backend 的 baseline contract，不是对 Colyseus、Nakama 等成熟 backend 能力的替代。

```txt
client input/action
→ Multiplayer message envelope
→ authority endpoint, such as local, host or server
→ decode / validate / tick boundary
→ app-owned simulation or game module state
→ authoritative snapshot / patch / result
→ client-side authority receiver
→ presentation / prediction / interpolation
```

核心职责：

- 明确区分 `connected to session` 和 `bound to authoritative state`。前者只说明 room/presence/message 可用，后者才说明 gameplay state 由指定 authority endpoint 驱动。
- 提供标准 action/input/snapshot/patch/result 的 envelope helper、schema/version/size gate、source authority gate、target routing 和 diagnostics。
- 提供 host/server authoritative loop helper，使权威端在固定 tick 边界消费输入、应用 app-owned simulation，并广播 snapshot 或 patch。
- 提供 local authoritative loop helper，使离线单机和本地测试在同一进程中复用相同 action/input、validation、tick 和 snapshot/apply 路径。
- 提供 client receiver helper，使客户端默认只接受指定 authority peer/server 发来的 snapshot 或 patch，并把非 authority snapshot 记录为 rejected diagnostics。
- 提供 player/peer binding helper 和可配置 participant lifecycle policy resolver，明确 `peer.id`、`playerId`、slot、spectator、next-round、leave、disconnect、reconnect 和 round boundary 的映射边界。Core 只解析静态规则或 app-context callback；玩法 actor、队伍、统计和具体 phase transition 仍由 app/server composition 执行。
- 提供 conformance tests，覆盖双 client 同 session、start gate、非 authority snapshot 拒绝、重复 peer id、input sequence、disconnect cleanup 和 room isolation。

核心不负责：

- 不定义具体游戏的 `PlayerSnapshot`、`InputFrame`、地图、碰撞、得分、ready 条件或胜负规则。
- 不自研 backend 的 room server、matchmaker、reconnect engine、presence store、transport codec 或生产级 state sync engine。
- 不替代 Colyseus Schema、Nakama match state 或 provider-native state sync；它只提供 GameKits 侧的组合边界、authority gate、diagnostics 和测试契约。

Backend adapter 职责：

- `@gamekits/multiplayer-colyseus` 等 backend package 继续拥有具体 SDK、Room、message routing、provider room id 映射、reconnect、native bridge 和 provider diagnostics。
- Adapter 必须能承载 core 的 authority / replication helper 所需的 message routing、channel capability、presence summary 和 session identity。
- 若 provider 提供原生 state sync，例如 Colyseus Schema，adapter 可以通过 typed native bridge 或 provider mapping 接入；该类型不得泄漏进 `multiplayer-core`、Save payload、DataType 或可复用 gameplay module。
- 完整可用 backend adapter 不能只把 provider 当作普通 message transport。它应保留并测试 provider-native capability bridge，例如 Schema/match state、reconnect/seat reservation、matchmaking、room metadata、state size/update diagnostics 和 server/runtime native path。

App / game 职责：

- App 定义玩法 state、input/action payload、snapshot/patch payload、规则校验、simulation 和 presentation。
- App 为 participant policy 提供自己的 phase/capacity/mode context，并执行 core decision 对玩法 actor、slot、team 和 round stats 的影响；不能要求 core 认识 lobby/running 等游戏状态。
- App 可以选择使用 provider-native state sync、GameKits snapshot stream、lockstep 或 rollback；但必须通过 core 的 authority binding 明确谁是权威源。
- 离线单机选择 `local` authority binding；它可以使用 in-process delivery 或 memory backend，但不能绕过同一套玩法 action/input、authority validation 和 snapshot presentation contract。
- Browser/UI 不直接把 local simulation state 当成联网模式的权威状态。连接后本地预测只能作为表现层或可回滚缓存。

## Consequences

收益：

- GameKits 保持薄内核，不接管具体玩法，也不自研成熟 backend 已经提供的底层系统。
- App 不需要每次手写 ready/start/input/snapshot 的多人骨架，减少伪多人接线错误。
- 单机、host-authoritative 和 server-authoritative 可以共享同一套 gameplay orchestration，避免 local mode 和 multiplayer mode 长期分叉。
- `multiplayer-core` 的测试可以真正覆盖“两个 client 是否共享同一份 authoritative state”，而不只覆盖 room/presence/message 是否连通。
- DevTools 和 diagnostics 能解释 session 连接、authority binding、input accept/reject、snapshot source、snapshot age 和 player/peer 映射。
- Demo、真实游戏和测试夹具可以复用同一条 authority / replication skeleton，只替换具体玩法 state 和 backend adapter。

代价：

- `multiplayer-core` 的公共 API 会从纯 message facade 扩展到 authority / replication toolkit，需要更严格的类型边界和 conformance tests。
- App 仍需要设计 payload schema 和 gameplay validation；标准 helper 不能自动保证游戏规则正确。
- Backend adapter 需要补足更细的能力声明和测试，例如 authority routing、重复 peer id、provider room id 映射和 source gate。
- 若同时支持 GameKits snapshot stream 与 provider-native state sync，需要清楚标记哪条路径是 authority source，避免双写；backend package 还需要为 provider-native lane 提供额外测试和 diagnostics。
- Local authority 也需要进入 conformance tests；同一 input/action log 在 local authority 和 remote authority fixture 中应产生等价的稳定 gameplay snapshot。

约束：

- `multiplayer-core` 不得引入 Colyseus、Nakama、WebSocket、Steam、EOS 或 provider-specific 类型。
- `connected`、`joined`、`peer count > 1` 不能被当作 gameplay state 已同步的证明；必须有 authority binding / snapshot receiver 的状态。
- Client 发送的是 action/input/request，不是事实；authoritative snapshot / patch / result 只能来自被绑定的 authority endpoint。
- Offline singleplayer 必须使用 `local` authority endpoint 复用同一套 contract；可以省略网络 IO，但不能省略 authority validation、tick boundary、snapshot/apply 和 diagnostics。
- Core baseline 与 provider-native lane 必须共享 authority binding 语义。Colyseus Schema、Nakama match state 或其他 provider state 可以成为 authoritative path，但必须声明 source、tick/version、resync 和 diagnostics；不能绕过 source gate 直接写 UI/gameplay state。
- 任何 app-local realtime demo 都必须有至少一个双 client headless test，验证同 session 的 lifecycle、input 和 snapshot 由同一个 authority state 驱动。
- Save 不保存 authority binding 的 live connection、socket、room handle、input queue、snapshot buffer 或 provider token。

## References

- ADR 0010：`docs/adr/0010-multiplayer-core-and-backend-adapters.md`
- ADR 0012：`docs/adr/0012-mature-multiplayer-backend-adapter.md`
- Multiplayer 模块设计：`docs/modules/multiplayer.md`
