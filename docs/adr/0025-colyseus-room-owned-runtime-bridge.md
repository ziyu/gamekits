# ADR 0025: Colyseus Room-owned Runtime Bridge

Status: Accepted on 2026-07-13; amended on 2026-07-13 after core-ownership review.

## Context

ADR 0016 已确定 server-authoritative Room 持有 headless App Host 和唯一 authority clock，ADR 0017 又要求 app-owned Schema 与玩法投影留在应用 provider boundary。现有 `GameKitsColyseusRoom` 主要承担 host-authoritative relay 与小型 native-state carrier；直接把 Outpost participant、World、Physics、TCA/GAS 或 Schema hook 加入该 Room，会混淆既有 relay 语义并让 backend package 拥有游戏业务。

Room 端仍需要一条可复用的组合边界：把 Colyseus Room 的 create/join/leave/message/dispose 生命周期接到 GameKits server-side MultiplayerRuntime 和 app 提供的 runtime owner；让 Room 的 simulation interval 成为唯一 tick 来源；并在任意 boot/start/stop/dispose 失败时释放已经创建的资源。该边界还必须能在不启动真实 socket 的契约测试和 benchmark 中使用。

## Decision

`@gamekits/multiplayer-colyseus/server` 提供独立的 `createColyseusRoomRuntimeBridge(...)`：

- Bridge 只依赖窄 `ColyseusRoomRuntimeHost` / `ColyseusRoomRuntimeClient` 协议，并通过 `createRuntime(context)` 接收 app-owned `ColyseusRoomOwnedRuntime`。Runtime 可以包装 App Host，也可以是专用 server runtime；backend package 不解释它内部的 World、Physics、TCA/GAS、Save、participant 或 Schema。
- Room 在 `onCreate` 调用 `bridge.create(...)`，在 `onJoin` / `onLeave` 转发已经由 app policy 解析的 peer，在经过 app/provider schema validation 的 message handler 中调用 `bridge.receive(...)`，并在 `onDispose` 调用 `bridge.dispose()`。Bridge 不生成 app Room class，也不注册任意 wildcard payload handler。
- Bridge 内部实现私有 Room-side `MultiplayerBackendAdapter/Connection`，把 provider Room、server peer、active peer/client index、presence 和 envelope delivery 映射到 `multiplayer-core` 协议。它不手写 `MultiplayerRuntime`、phase 或 public snapshot。
- Bridge 统一调用 `createMultiplayerRuntime()` 创建 server-side facade，并在 Room create 阶段通过 backend connection 把 provider 已拥有的 Room 绑定到同一个 GameKits session。该 core join 只建立 facade binding，不创建 server-to-self Colyseus client connection。绑定完成后，app 对 create/join/leave/reconnect 的重复调用由 backend/core error 拒绝。
- `MultiplayerSession.id`、provider `roomId` 和 Colyseus `Client.sessionId` 保持不同语义；后者只作为 transport connection 到 stable peer 的私有索引。Presence 使用独立 provider message type，并携带同一个 core session summary，使 browser 与 server 的 MultiplayerRuntime 观察相同 peer/session 状态。
- Inbound GameKits envelope 由 Room-side backend connection 验证 session、source peer、authority target、可序列化性和大小，再交给 core runtime listener。具体 input/action schema、participant permission、cost/cooldown 和 gameplay validation 仍由 app module 负责。
- Outbound app message 先经过 core runtime 的 envelope normalization，再由 backend connection 校验 session/source/size；无 target 时由 Room broadcast，有 target 时使用 active peer/client 索引直接发送。离开 peer 从 active index 删除，历史 connection/client 不长期保留。
- `setSimulationInterval` 只由 bridge 在 runtime 完成 boot/start 后设置一次。Callback 只推进 app runtime；Schema/provider commit 仍由 app authority pipeline 的最后阶段决定。Stop/dispose 首先清除 simulation interval，再 stop/dispose app runtime、关闭 Room-side backend session 并 dispose core MultiplayerRuntime。
- Lifecycle、message counter、active peer count 和最后一条脱敏 diagnostic 进入低频 snapshot；不记录 Client、Room、payload、token 或 runtime object。Diagnostic observer 异常不能改变 authority lifecycle。
- Bridge 的 hot path 建立独立 benchmark，覆盖 tick、envelope ingress、peer churn、lifecycle 和 dispose retained state；预算只防数量级退化，不代替真实 multi-room profiler/soak。

`GameKitsColyseusRoom` 保持现有 relay/native carrier 行为。Outpost 使用 app-owned `OutpostSiegeRoom` 消费新 bridge，并由该 Room 组合共享 headless profile；这不是 backend package 的默认玩法 Room。

## Consequences

Positive consequences:

- Room、App Host、GameRuntime、Physics 和 server Multiplayer service 有单一生命周期 owner，party leader leave 不再等同于 authority shutdown。
- Server App Host 可以消费正式的 Room-side MultiplayerRuntime，不需要用 memory backend 冒充生产 transport，也不需要 server 自连自己的 Room。
- Backend package 保留 provider lifecycle、envelope gate 和 peer/client 索引等通用职责，Outpost 的角色、Schema、玩法和 participant policy 继续 app-local。
- Browser 与 server 复用同一个 multiplayer-core runtime/session/envelope 语义；provider package 不再维护结构兼容但独立推进的第二套 facade。
- Lifecycle contract 可以用 structural fake Room 做快速契约测试，也可以用真实 Colyseus server/client 验证 Room ownership。

Costs and constraints:

- App-specific Room 仍需显式编写 onCreate/onJoin/onLeave/onDispose glue、peer policy、message schema 和 state projection；bridge 不试图隐藏 Colyseus Room。
- Server facade 由 bridge 在 create 阶段完成一次 core session binding；app 调用方必须理解 provider Room 是 native lifecycle owner，不能再次请求创建、替换或离开该 session。
- Join/leave presence 与 message listener 是同步低频边界；耗时认证、数据库 IO 或 payload decode 应在 Room/app 的明确异步阶段完成，不能阻塞 simulation tick。
- Bridge 只保证单 timer ownership 和 lifecycle cleanup，不替 app 定义 ingress → Physics/combat → replication commit 的 system order。

## Rejected Alternatives

### Extend GameKitsColyseusRoom with app runtime and participant callbacks

Rejected because it would couple the existing host-authoritative relay/native carrier to Room-owned authority semantics and accumulate optional app hooks in one Room base class.

### Create a Colyseus client connection inside the server App Host

Rejected because the provider Room is already the authority endpoint. A server self-connection adds a second connection lifecycle, duplicates message routing, and obscures clock ownership.

### Handwrite a server-side MultiplayerRuntime in the Room bridge

Rejected after the core-ownership review because it duplicates multiplayer-core phase/session/snapshot/envelope behavior and can drift from browser runtime semantics. The concrete Room integration must implement the existing backend adapter/connection protocol and let `createMultiplayerRuntime()` remain the only GameKits facade implementation.

### Put Outpost Room, Schema, or gameplay modules in the backend package

Rejected because field Schema, participant roles, actor spawning, Physics/TCA/GAS and replication projection are app-owned per ADR 0017 and ADR 0018.

## References

- ADR 0016: `docs/adr/0016-room-owned-server-authority-lifecycle.md`
- ADR 0017: `docs/adr/0017-app-owned-colyseus-field-schema-boundary.md`
- ADR 0018: `docs/adr/0018-server-authoritative-gameplay-module-execution.md`
- Multiplayer module: `docs/modules/multiplayer.md`
