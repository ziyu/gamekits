# ADR 0012：Multiplayer 采用成熟 Backend Adapter 优先

## Status

Accepted, complemented by ADR 0013

## Context

GameKits 的设计信条是“成熟库负责底层能力，GameKits 负责稳定协议和组合边界”。多人系统如果继续自研 room、transport、presence、reconnect、matchmaking、state sync、load testing 和 server orchestration，会迅速形成高维护成本的自研网络框架。

此前 ADR 0010 定义了 `multiplayer-core` / backend adapter 边界，ADR 0011 选择 WebSocket 作为首个真实 transport demo。重新评估后，单独维护 raw WebSocket backend 仍会把大量多人核心逻辑留在 GameKits 内部，不符合当前维护成本目标。

候选方案：

- Colyseus：Node.js / TypeScript 游戏多人框架，提供 Room、matchmaking、server-side state sync、message handling、reconnection、transport 选择和 load testing 工具。
- Nakama：完整游戏后端，提供 auth、account、storage、friends、groups、chat、matchmaker、realtime multiplayer 和 authoritative multiplayer，适合需要完整在线服务栈的游戏。
- PartyKit：面向实时协作和边缘部署的 JavaScript 平台，适合轻量 room / realtime app，但游戏权威模型和状态同步需要更多 app 侧设计。
- Socket.IO / raw WebSocket：成熟实时 transport，但不直接提供游戏房间、状态同步、matchmaker 或权威游戏服务器模型。

## Decision

Multiplayer 方向调整为成熟 backend adapter 优先。

首个真实 backend adapter 选择 `@gamekits/multiplayer-colyseus`，而不是自研 `@gamekits/multiplayer-websocket`。

长期边界：

- `@gamekits/multiplayer-core` 只保留 GameKits 侧稳定 facade、App Host service shape、GameModule bridge、语义 command envelope、diagnostic snapshot、redaction 和 adapter conformance helper。
- GameKits 不自研通用 room server、matchmaker、reconnect engine、presence store、transport codec、state sync engine 或 production WebSocket server。
- `@gamekits/multiplayer-colyseus` 拥有 Colyseus SDK、Room、client/server integration、state sync mapping、message routing、reconnection 和 provider diagnostics。
- 完整的 Colyseus adapter 不能只实现 GameKits envelope transport；它还应通过受控 native bridge / provider mapping 暴露 Colyseus Schema state sync、room metadata、reconnect / seat reservation、matchmaking 和 provider diagnostics，同时保持这些类型不进入 `multiplayer-core`。
- Colyseus Room 是首个真实多人会话 owner。GameKits 的 Sandbox / Tiny Camp demo 通过 Colyseus Room 证明 package 链路，而不是通过 memory 或 raw WebSocket。
- `@gamekits/multiplayer-memory` 只作为测试替身、bridge fixture 和 deterministic conformance target，不代表生产 backend。
- Nakama、PartyKit、Steam、EOS 或其他后端未来按 `@gamekits/multiplayer-<provider>` 增加 adapter。GameKits 不为所有 provider 设计超大公共能力目录，只抽取当前 bridge 和 diagnostics 需要的最小稳定事实。

Colyseus adapter 的 server-side 类型不得泄漏进 gameplay、DataType、Save payload、TCA/GAS rule 或可复用 GameModule 公共 API。需要使用 Colyseus 原生 Room、Client、Schema、matchmaker、monitoring 或 deployment 能力时，通过 adapter package 的 typed native bridge 或 app-specific server project 显式进入。

## Consequences

收益：

- 大幅降低 GameKits 自己维护多人核心逻辑的范围。
- Sandbox demo 能验证真实成熟 backend 的 room、message、state sync、reconnect 和 tooling，而不是只验证自研 transport。
- TypeScript/Node 生态和当前仓库工程栈匹配，便于本地 server、headless test、CI smoke 和 demo dogfood。
- GameKits 继续保持可替换边界：玩法代码依赖语义 command、GameModule bridge 和 diagnostics，不依赖 Colyseus 私有类型。

代价：

- 需要接受 Colyseus 的 Room / Schema / client SDK 模型，并在 adapter 内维护映射层。
- `multiplayer-core` 已有 runtime 实现需要收窄，避免继续演化成自研多人框架。
- 后续若接入 Nakama 等完整 BaaS，不能假设它和 Colyseus 的所有概念一一对应；GameKits facade 必须保持窄。

约束：

- Raw WebSocket 只能作为某个 backend 内部 transport 或实验，不作为首个公开 multiplayer backend package。
- Demo 验收必须至少有一条 Tiny Camp command 通过 Colyseus Room 往返，并在 host/server-authoritative 边界应用到 GameRuntime。
- Save 不保存 Colyseus Room、Client、reconnection token、socket、provider secret 或 transient presence。
- DevTools 默认展示 provider-neutral summary；Colyseus native detail 必须显式 opt-in 并 redaction。

## References

- Colyseus documentation: https://docs.colyseus.io/
- Nakama documentation: https://heroiclabs.com/docs/nakama/
- PartyKit documentation: https://docs.partykit.io/
- Socket.IO documentation: https://socket.io/docs/v4/
