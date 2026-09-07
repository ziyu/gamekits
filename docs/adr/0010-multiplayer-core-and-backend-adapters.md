# ADR 0010：引入 Multiplayer Core 与 Backend Adapter 边界

## Status

Accepted, updated by ADR 0012 and ADR 0013

## Context

GameKits 的长期定位是可复用游戏框架。多人能力如果直接从某个项目需求出发，很容易把 WebSocket、Colyseus、Nakama、Steam、Epic Online Services、平台账号、lobby UI、房间状态和 gameplay state 混在一起。

这种做法短期能跑，但会带来几个长期问题：

- gameplay module 直接依赖具体网络 SDK，无法替换 backend。
- GameRuntime 持有 socket 或 room handle，违反薄内核和 App Service / GameModule 边界。
- 客户端输入、权威校验、状态复制、reconnect、save/load 和 DevTools trace 混成一条不可解释的路径。
- 不同游戏需要不同多人模型：本地联机、host-authoritative、server-authoritative、协作 peer、观战、lockstep 或 rollback。
- 托管 backend 的丰富能力不适合被 core facade 无限包装，但又需要一个稳定的最小交互协议。

Multiplayer 会影响包边界、App Host 组合、GameRuntime 模块、Data/Save/DevTools 协作和未来发布包形态，因此需要作为架构决策记录。

## Decision

引入 `@gamekits/multiplayer-core` 作为多人能力的稳定 facade / toolkit，并通过 backend adapter package 接入具体后端。

长期包形态：

- `@gamekits/multiplayer-core` 定义 MultiplayerRuntime、BackendAdapter、Session、Peer、Message Envelope、Channel、Authority Policy、Replication Contributor、diagnostics 和标准 GameModule bridge helper。
- `@gamekits/multiplayer-memory` 提供 in-process loopback backend，用于 conformance tests、本地多人验证和 headless server/client 夹具。
- `@gamekits/multiplayer-websocket` 提供通用 WebSocket backend adapter。
- 其他服务商或平台按 `@gamekits/multiplayer-<backend>` 增加独立 backend adapter。

生命周期归属：

- MultiplayerRuntime 是 App Service，由 App Host 管理连接、session、presence、backend handle、reconnect 和 diagnostics。
- Multiplayer GameModule bridge 跟随 GameRuntime lifecycle，负责命令入站、authority gate、EventBus 低频事实、replication contributor 和 cleanup。
- GameRuntime 不直接拥有 socket、room、backend client、server handle 或第三方 SDK。

依赖边界：

- `@gamekits/multiplayer-core` 不依赖具体 backend SDK、DOM WebSocket、Node socket、Tauri、React、Phaser、Three 或 provider-specific 类型。
- Backend adapter 可以依赖其拥有的第三方 SDK，并可以导出 typed native bridge；这些类型只能被显式选择该 backend 的 app、server orchestration 或 tooling 消费。
- 可复用 gameplay module、DataType、Save payload 和 core facade 不得导入 backend-specific 类型。

权威与同步：

- Core 只定义 authority mode、decision、command envelope、channel 和 replication contributor 协议。
- 具体游戏或 server host 负责命令校验、冲突处理、预测、回滚和 gameplay state 应用。
- `@gamekits/multiplayer-core` 不强制单一同步模型；command relay、snapshot、patch、lockstep 和 rollback 通过可插拔策略表达。

## Consequences

收益：

- 多人能力遵守 GameKits 既有薄内核、App Service、GameModule 和 adapter 边界。
- 多 backend 可以共享同一 session/message/authority/diagnostic 协议。
- Headless server、Web client、本地 loopback 和测试夹具可以复用同一套 runtime 和 GameModule helper。
- DevTools 可以解释输入、命令、authority decision、状态复制和 backend diagnostics 的链路。
- 具体 provider 的高级能力仍可通过 typed native bridge 使用，而不会污染 core API。

代价：

- 需要新增 backend conformance tests 和 memory backend，才能保证多个 backend 行为一致。
- App Host 需要支持 multiplayer standard service 和标准 GameModule helper 的装配接缝。
- 游戏需要显式设计 authority policy、command schema、replication contributor 和 payload redaction，不能依赖 core 自动解决所有网络一致性问题。
- WebSocket 之外的托管 backend 需要独立 adapter 包和真实服务端/平台验证。

约束：

- 多人线上玩法默认把 remote payload 当作不可信输入。
- Save 不保存 live connection、socket、room handle、provider SDK object 或 secret token。
- EventBus 只记录低频多人事实；高频网络包、每帧 state patch 和完整 payload 不作为默认事件广播。
- Multiplayer 不替代账号、好友、商店、排行榜、平台成就或完整 server orchestration 系统。
