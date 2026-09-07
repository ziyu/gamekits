# ADR 0011：Multiplayer Demo 首个真实 Backend 选择 WebSocket

## Status

Superseded by ADR 0012: Mature Multiplayer Backend Adapter

## Context

`@gamekits/multiplayer-memory` 可以固定 backend adapter 契约、消息顺序和 headless 测试夹具，但它不经过真实 transport，也不暴露 socket close、跨进程消息编码、服务端 relay、连接失败和重连降级这类问题。

Multiplayer demo 的目标不是只证明 core runtime 能在同一进程里调用，而是证明 GameKits 的多人 package 体系可以通过一个真实 backend 跑通：App Host 管连接服务，GameModule bridge 管 tick 边界和 authority，DevTools/diagnostics 能解释网络链路，gameplay 不依赖 backend 私有类型。

托管 room service、平台联机 SDK 或完整 headless authoritative server 都更接近生产形态，但作为首个真实 backend 会同时引入账号、部署、鉴权、云端运维或 provider-specific room model，容易把 demo 验证范围扩大到 GameKits 当前多人包边界之外。

## Decision

首个跑通 demo 的真实 backend 选择 `@gamekits/multiplayer-websocket`。

Demo 和本地测试使用 WebSocket local relay/server：

- WebSocket backend package 拥有 socket transport、frame codec、client connection lifecycle 和本地 relay/server glue。
- Browser/client 侧使用 WebSocket transport；Node/headless 侧的 server 实现停留在 backend package 或其 server 子入口内。
- Relay/server 负责 session room、presence、message routing、close reason 和基础 diagnostics，不承载 Tiny Camp gameplay 规则。
- Host-authoritative gameplay 仍发生在 host GameRuntime 的 Multiplayer GameModule bridge；未来可以把 host runtime 移到 headless server app，而不改变 command envelope 或 gameplay command schema。
- `@gamekits/multiplayer-core` 不依赖 DOM WebSocket、Node socket、server framework 或 backend-specific 类型。
- `@gamekits/multiplayer-memory` 保留为 conformance、确定性测试和本地 loopback 替身，但不能作为 demo 最终跑通的唯一 backend。

WebSocket backend 的首轮 capability 如实声明为可靠、有序传输，不假装支持 unreliable datagram、NAT traversal、matchmaking、账号、邀请或生产级重连恢复。

## Consequences

收益：

- Demo 会覆盖真实 socket lifecycle、跨进程/跨连接消息编码、presence、close 和 diagnostics。
- WebSocket 是通用、低门槛、可本地启动的真实 backend，不需要账号或云服务才能验证 GameKits 包边界。
- Memory backend 继续保证 deterministic conformance，WebSocket backend 负责真实 transport smoke，两者分工清晰。
- Gameplay command、authority policy、DevTools source 和 App Host service 可以验证“不依赖 backend 私有类型”的边界。

代价：

- 需要新增 `@gamekits/multiplayer-websocket` package、server-side 测试夹具和本地 demo 启动方式。
- 测试需要管理临时端口、server cleanup、close reason、消息大小和异步连接时序。
- WebSocket 只能代表可靠有序 transport，不能替代 UDP-like 低延迟、不可靠通道、平台联机或托管 room service 的后续验证。

约束：

- Demo 验收必须至少有一条 command 经 WebSocket backend 跨 socket 送达 host runtime，再经 tick 边界应用到 Sandbox/Tiny Camp。
- WebSocket server/relay 不保存到 Save，不进入 GameRuntime，不把 socket object 暴露给 gameplay、DataType、Save payload 或可复用 GameModule。
- DevTools 和 snapshot 默认展示 redacted summary，不展示 secret、完整高频 payload 或 backend native object。
