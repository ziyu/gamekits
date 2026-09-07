# Multiplayer 模块设计

本文档只描述 Multiplayer 的长期模块设计，不记录当前实现状态、阶段计划或 TODO。具体工作流状态放在任务系统、PR 或 `../implementation/`。

## 定位

Multiplayer 负责把成熟多人 backend 接入 GameKits 的稳定组合边界：App Host 管连接服务，GameModule bridge 管 gameplay command、authority decision、低频事实和可观察 diagnostics。它让同一个游戏可以在 Colyseus、Nakama、PartyKit、平台联机 SDK 或测试替身之间切换，而不让 gameplay 代码直接绑定某个网络 SDK。

相关包：

- `@gamekits/multiplayer-core`
- `@gamekits/multiplayer-memory`
- `@gamekits/multiplayer-colyseus`

后端包按 `@gamekits/multiplayer-<backend>` 命名。Memory backend 是测试替身和本地 loopback fixture，不代表生产后端。Colyseus 是首个真实成熟 backend adapter。Nakama、PlayFab、Steam、Epic Online Services、PartyKit、Cloudflare Durable Objects 等托管或平台能力应作为各自 backend adapter 接入，而不是进入 core。

## 设计目标

- 提供 GameKits 侧最小多人 facade：connect / create-or-join / leave / send command / observe snapshot。
- 支持多 backend：Colyseus、Nakama、PartyKit、平台联机服务和测试替身。
- 区分应用级连接服务和游戏会话模块：连接、房间、presence 属于 App Service；命令入站、状态复制、authority gate 属于 GameModule bridge。
- 支持离线单机和本地测试复用同一条 authority / replication contract；local mode 不需要远程 backend，但不分叉玩法 action/input、tick、snapshot 和 diagnostics 路径。
- 支持多种权威模型：本地 host、权威 server、协作 peer、观战 client。
- 明确区分“已加入多人 session”和“gameplay state 已绑定到权威源”；连接成功不能自动代表游戏状态已同步。
- 提供标准 host/server authoritative action、input、snapshot、patch 和 result 组合边界，避免每个 app 手写多人同步骨架。
- 支持低频事实 trace 和可采样网络 diagnostics。
- 支持 headless server app，服务端可以复用 Data、World、TCA、GAS、Save 和 DevTools。
- 不自研通用 room server、matchmaker、reconnect engine、presence store、transport codec、state sync engine 或 production WebSocket server。
- 不让第三方网络 SDK、socket 对象或 provider-specific payload 泄漏进 core facade、DataType、Save payload 或可复用 gameplay module。

## 非目标

- 不实现完整通用 MMO server、账号系统、社交图谱、商店、排行榜或平台成就。
- 不把 matchmaking、lobby UI、好友列表或邀请 UI 固化为核心协议；core 只保留会话和 presence 的窄协议。
- 不假设所有游戏都需要 rollback netcode、lockstep 或完整 world diff。它们是可选同步策略，不是 core 默认行为。
- 不保存 socket、room handle、第三方 SDK object 或临时网络队列。
- 不把客户端命令视为可信事实。多人线上模式下，权威校验必须发生在 host/server 或明确的 authority policy 中。
- 不把 raw WebSocket adapter 当作首个生产方向；raw transport 只能作为成熟 backend 内部实现或实验。

## 包拆分

```txt
@gamekits/multiplayer-core
  - GameKits MultiplayerFacade / service shape
  - Game command envelope and result protocol
  - Authority policy types
  - Authority binding and replication helper protocols
  - Command bridge helpers
  - Trace / diagnostics snapshot
  - Adapter conformance helpers

@gamekits/multiplayer-memory
  - In-process test backend
  - Loopback fixture
  - Deterministic bridge/conformance harness

@gamekits/multiplayer-colyseus
  - Colyseus client adapter
  - Colyseus Room / state / message mapping, including deterministic GameKits session id to provider room id mapping
  - Local Colyseus server harness for tests and standalone demo apps
  - Typed native bridge for app-specific Colyseus server/runtime usage
  - Provider-native capability bridges, such as Schema state sync, reconnect, matchmaker and room metadata diagnostics
```

Backend adapter 可以依赖其拥有的第三方 SDK 或 server framework。`@gamekits/multiplayer-core` 不依赖 WebSocket、Colyseus、Nakama、Steam、EOS、Tauri、React、Phaser 或 Node-only socket 库。

## 分层

```txt
App Host service
  -> MultiplayerFacade
  -> MultiplayerBackendAdapter
  -> mature backend SDK / room / provider runtime

GameRuntime module
  -> Multiplayer GameModule bridge
  -> command ingress / egress
  -> authority policy
  -> world snapshot / replicated state contributors
  -> EventBus trace facts
```

MultiplayerFacade 是 App Service，因为它管理连接 facade、room lifecycle summary、backend handle、低频诊断和 provider snapshot。真实 reconnect、matchmaking、presence 和 state sync 由成熟 backend 拥有。Multiplayer GameModule bridge 是 GameModule，因为它需要参与 tick、读取 EventBus、调度命令、写入 World 或读取 gameplay context。

GameRuntime 不直接拥有 socket、room、backend client 或 server handle。App Host 负责创建 MultiplayerFacade，并把它作为 service 注入标准 GameModule helper。

## Multiplayer Facade

建议公共形态：

```ts
export type MultiplayerFacade = {
  id: string;
  backendId: string;
  phase: MultiplayerPhase;

  createOrJoinSession(request: MultiplayerSessionRequest): Promise<MultiplayerSession>;
  leaveSession(reason?: string): Promise<void>;
  reconnect?(request?: ReconnectSessionRequest): Promise<MultiplayerSession>;

  send(message: MultiplayerOutgoingMessage): Promise<void>;
  subscribe(listener: MultiplayerMessageListener): () => void;

  peers(): MultiplayerPeer[];
  localPeer(): MultiplayerPeer | undefined;
  session(): MultiplayerSession | undefined;
  snapshot(): MultiplayerSnapshot;
  dispose(): Promise<void> | void;
};
```

生命周期语义：

- `createOrJoinSession()` 由 app、lobby UI、测试夹具或 server host 调用，不由 gameplay system 隐式调用。
- `send()` 发送的是 GameKits multiplayer envelope，不发送 backend 私有对象。
- `subscribe()` 只接收归一化消息；backend adapter 内部负责把 Colyseus Room message、Nakama socket event 或其他 provider event 转成稳定协议。
- `snapshot()` 返回低频诊断摘要，不包含完整敏感 payload、认证 token 或 socket 私有句柄。
- `dispose()` 释放订阅、连接 facade 和 backend runtime handle；真实 provider cleanup 由 adapter 委托给对应 SDK。

## Backend Adapter

Backend Adapter 把具体成熟多人后端映射为 GameKits 稳定 facade。

```ts
export type MultiplayerBackendAdapter = {
  id: string;
  kind: string;
  capabilities: MultiplayerBackendCapabilities;

  connect(ctx: MultiplayerBackendConnectContext): Promise<MultiplayerBackendConnection>;
  native?(): unknown;
  snapshot(): MultiplayerBackendSnapshot;
};

export type MultiplayerBackendConnection = {
  createOrJoinSession(request: MultiplayerSessionRequest): Promise<MultiplayerSession>;
  leaveSession(reason?: string): Promise<void>;
  send(message: MultiplayerOutgoingMessage): Promise<void>;
  subscribe(listener: MultiplayerBackendListener): () => void;
  close(reason?: string): Promise<void> | void;
  snapshot(): MultiplayerConnectionSnapshot;
};
```

边界规则：

- Backend Adapter 拥有第三方 SDK、socket、room、server worker、matchmaker、state sync 或平台联机 runtime。
- Core 只理解 adapter capabilities、session summary、peer summary、semantic message、diagnostics 和 native boundary，不理解 provider-specific API。
- backend-specific package 可以导出 typed native bridge，供 app-specific lobby、平台工具或 server orchestration 使用；这些类型不能进入 core facade、DataType、Save payload 或可复用 gameplay module。
- Backend adapter 不应把成熟 provider 压扁成纯 GameKits message transport。Colyseus Schema、Nakama match state、平台 session/reconnect 等 provider-native 能力应通过 backend package 的 capability bridge 暴露为受控 opt-in 路径，并同时提供 provider-neutral diagnostics / authority binding summary。
- 同一个后端连接只由一个 MultiplayerFacade 拥有。GameModule 不直接保存 backend connection。

## Session / Peer

```ts
export type MultiplayerSession = {
  id: string;
  kind: "local" | "private" | "public" | "matchmade" | string;
  authority: MultiplayerAuthorityMode;
  status: "creating" | "open" | "starting" | "running" | "closed";
  peers: MultiplayerPeer[];
  metadata?: Record<string, unknown>;
};

export type MultiplayerPeer = {
  id: string;
  displayName?: string;
  role?: "host" | "server" | "client" | "spectator" | string;
  status: "joining" | "connected" | "ready" | "disconnected" | "left";
  playerId?: string;
  metadata?: Record<string, unknown>;
};
```

`peer.id` 是一次 multiplayer session 内的稳定网络参与者 id；`playerId` 可以映射到游戏自己的 profile、platform account 或 save identity。账号、好友、权限和社交关系不进入 multiplayer-core 顶层协议，由 app/platform/account service 或具体 backend native bridge 处理。

## Message Envelope

GameKits 侧语义消息必须可序列化、可追踪、可版本化。Provider 可以有自己的 message、state patch 或 binary frame；adapter 只把 GameKits bridge 需要的语义消息和 summary 暴露出来。

```ts
export type MultiplayerMessageEnvelope<TPayload = unknown> = {
  id: string;
  sessionId: string;
  channel: MultiplayerChannelId;
  kind: MultiplayerMessageKind;
  sourcePeerId: string;
  targetPeerIds?: string[];
  sequence?: number;
  tick?: number;
  schemaVersion?: string;
  correlationId?: string;
  timestamp: number;
  payload: TPayload;
};
```

常见 `kind`：

- `peer.presence`
- `session.control`
- `game.action`
- `game.input`
- `game.command`
- `game.command.result`
- `game.snapshot`
- `game.patch`
- `game.event`
- `debug.trace`

Channel 表达可靠性和顺序语义：

```ts
export type MultiplayerChannel = {
  id: string;
  reliability: "reliable" | "unreliable";
  ordering: "ordered" | "unordered";
  priority?: number;
  maxPayloadBytes?: number;
};
```

Adapter 应在 capabilities 中如实声明 provider 能力。调用方不能假设所有 backend 都支持低延迟不可靠 datagram、server-authoritative tick、state sync、matchmaking 或 reconnect。

Capabilities 应区分两类能力：

- Core baseline capability：GameKits envelope、session/peer summary、authority binding、command/action/input/snapshot/patch/result helper 和 provider-neutral diagnostics。这些能力支撑跨 backend 的最小可用体验。
- Provider-native capability：Colyseus Schema state sync、Nakama match state、provider reconnect token、matchmaker、room metadata、load test 或平台联机特性。这些能力由 backend package 拥有，通过 typed native bridge 或 provider-specific adapter mapping 提供给显式选择该 backend 的 app/server/tooling。

完整可用的生产级多人能力通常需要同时使用这两层。Core baseline 负责防止伪多人和保持可替换边界；provider-native bridge 负责发挥成熟 backend 已经提供的高价值能力。GameKits 不把 provider-native 类型上推到 core，但也不能在 adapter 中把它们丢失。

## Authority

Multiplayer core 只定义 GameKits 侧 authority decision，不把具体玩法校验或 provider-specific access control 写进核心。

```ts
export type MultiplayerAuthorityMode =
  | "local"
  | "host-authoritative"
  | "server-authoritative"
  | "peer-cooperative"
  | "spectator";

export type MultiplayerAuthorityDecision =
  | { allowed: true; reason?: string }
  | { allowed: false; code: string; reason: string };
```

原则：

- 客户端发送的是请求、输入或命令，不是最终事实。
- 权威 host/server 决定命令是否接受、何时执行、如何广播结果。
- 可复用 gameplay module 只依赖 authority decision 和 command result，不依赖 provider-specific room state。
- 单机、本地联机和测试可以使用宽松 policy；线上对抗或经济相关玩法必须使用 server-authoritative policy。
- 离线单机使用 `local` authority mode。它可以在同一进程内运行 authority loop，但仍应经过同一 action/input、validation、tick boundary 和 snapshot/apply contract。

## Authority Binding

Multiplayer 必须显式表达 gameplay state 的权威来源。`connected`、`joined` 或 peer count 只能说明连接和 presence 已建立，不能说明一局游戏的 state 已经共享。

长期公共语义：

```ts
export type MultiplayerAuthorityBindingStatus =
  | "unbound"
  | "binding"
  | "bound"
  | "resyncing"
  | "rejected"
  | "closed";

export type MultiplayerAuthorityBinding = {
  sessionId: string;
  mode: MultiplayerAuthorityMode;
  status: MultiplayerAuthorityBindingStatus;
  authorityPeerId?: string;
  localPlayerId?: string;
  tick?: number;
  snapshotVersion?: string;
  reason?: string;
};
```

绑定规则：

- App/lobby/server host 显式创建或加入 session；GameModule 不隐式创建 room。
- 权威端可以是 host peer、dedicated server peer 或 provider server runtime。客户端必须知道当前接受哪个 authority endpoint 的 snapshot、patch 和 result。
- 离线单机也建立 authority binding，通常是 `mode: "local"`、`status: "bound"`、本地 player id 和本地 authority endpoint。它不需要 provider room、socket 或 remote presence，但仍使用同一 gameplay state contract。
- 客户端在 `bound` 前不能把 local simulation 当作联网 gameplay state；只能显示等待同步、观战、离线练习或本地预测缓存。
- Snapshot、patch 和 command result 默认只接受绑定 authority endpoint 的消息；来自其他 peer 的 state 写入必须被拒绝并进入 diagnostics。
- `peer.id` 到 `playerId`、slot、team、spectator 或 next-round participant 的映射必须由 authority binding 或权威 snapshot 声明，不能由 UI 临时推断。
- Leave、disconnect、reconnect、late join 和 room reset 必须更新 authority binding；旧 snapshot buffer、input queue 和 prediction cache 不能跨 binding 复用。

## Room-owned Server Authority

Server-authoritative room 可以由成熟 backend 的 Room/runtime 自己持有 authority lifecycle，而不是把 browser creator 或第一个 peer 当作 server simulation owner。

长期边界：

- Provider Room 创建并持有 headless App Host、server GameRuntime、World、Physics、replication projection 和 diagnostics；Room close 或 server shutdown 统一释放这些资源。
- Browser creator/party leader 是 app-owned permission role，只能请求 start、rematch、leader transfer 或 close；它不能推进 authority clock、写 Schema authority state 或决定 server simulation 的存续。
- Backend package 可以提供 typed room-side server/runtime bridge，把 provider join/leave/message/send/snapshot lifecycle 实现为 `MultiplayerBackendAdapter/Connection`，再由 multiplayer-core 创建 MultiplayerRuntime。该 bridge 不手写平行 facade，也不拥有玩法规则、participant policy、World component 或 app Schema。
- Host-authoritative 与 Room-owned server-authoritative 模式共享 action/input、authority binding、source gate 和 diagnostics，但 host leave 的 room-close policy 只适用于 host-authoritative 模式。
- 每个 room 只有一个 fixed-step authority clock owner。Browser render loop、UI timer、provider patch callback 和 GameRuntime tick 不能分别推进同一 simulation。

Server GameRuntime 需要明确的 system 顺序：network ingress → gameplay intent/AI → Physics → combat/lifecycle → replication projection → provider commit。Authority helper 应允许把 ingress 与 commit 分为受约束的两个阶段，使 app systems 在中间运行；ack、snapshot version 和 provider commit 只能在完整 simulation tick 完成后推进。这个能力属于 Multiplayer authority toolkit，不要求 GameRuntime 预先固化一套全局 phase catalog。

### Colyseus Room runtime bridge

Colyseus backend 的 server subpath 提供 `createColyseusRoomRuntimeBridge(...)`，用于把 provider Room 已经拥有的 session 接到 GameKits server composition：

- App-specific Room 显式转发 `onCreate`、`onJoin`、`onLeave`、经过验证的 GameKits envelope 和 `onDispose`；bridge 不生成通用玩法 Room，也不注册接收任意 payload 的 wildcard handler。
- `createRuntime(context)` 由 app 注入，可以返回包装 headless App Host 的 runtime owner。Bridge 只调用 boot/start/tick/stop/dispose/snapshot，不理解 runtime 内部的 World、Physics、TCA/GAS、Save、Schema 或玩法状态。
- Bridge 使用 `createMultiplayerRuntime()` 暴露 server-side facade 给 App Host standard Multiplayer service。私有 Room-side backend connection 把 provider 已拥有的 Room 绑定为 core session；这次绑定不建立 server-to-self client connection。绑定完成后 app 不再调用 create/join/leave/reconnect，backend 对重复 session lifecycle 操作明确返回 core error。
- `MultiplayerSession.id` 是稳定 GameKits session id，Colyseus `roomId` 是 provider room id，Colyseus `Client.sessionId` 是单次 transport connection id。Adapter 可以维护三者映射，但不能互相替代；core session/peer snapshot 必须从 Room-side backend connection 进入同一个 MultiplayerRuntime。
- Room simulation interval 是 bridge 唯一的 tick source。Runtime boot/start 成功后才启动，stop/dispose 先清 timer；app 的 authority modules 仍负责 ingress、simulation、replication projection 和 provider commit 的内部顺序。
- Inbound envelope 在进入 listener 前验证 session/source/server target/size；app schema 和 gameplay authority validation 留在 app module。Outbound target 使用 active peer/client index，leave/dispose 必须删除索引和 listener。
- Snapshot 只保存 phase/counter/active peer/runtime summary 和脱敏错误，不暴露 Room、Client、完整 payload 或 secret。

这条 bridge 是 provider-specific server native boundary，因此可以在 `@gamekits/multiplayer-colyseus/server` 暴露 Colyseus 相关类型；它不得进入 multiplayer-core 或可复用 gameplay public API。决策背景见 ADR 0025。

## Standard Authoritative Replication

Multiplayer core 不定义具体游戏玩法类型，但应提供标准权威复制组合边界，让 app 只填入自己的 payload schema、simulation 和 presentation。

推荐流程：

```txt
client action / input
→ envelope helper with session, peer, player, sequence, tick
→ authority endpoint
→ decode / schema / size / source validation
→ fixed tick or command boundary
→ app-owned simulation
→ authoritative snapshot / patch / result
→ client receiver source gate
→ presentation, prediction or interpolation
```

标准 helper 的职责：

- 为 action/input/snapshot/patch/result 提供 provider-neutral envelope、schema version、sequence、tick、correlation id 和 redaction hook。
- 为 local authority 提供 in-process delivery，使 offline singleplayer、unit test 和 local preview 可以复用同一 reducer/simulation/snapshot receiver，而不是创建第二套单机入口。
- 在 host/server side 维护有界 input queue、last accepted sequence、rejected reason、每 source 每 tick 的消费上限、tick boundary 和 snapshot broadcaster 的通用骨架。Queue policy 必须同时匹配输入语义与 prediction/ack contract：不逐 input rollback 的移动、瞄准、驾驶等 continuous state 使用 latest-per-source coalescing，新状态覆盖尚未消费的旧采样；每个 input sequence 代表一个 fixed simulation step 的 predicted control 则使用 per-source bounded FIFO、每 authority tick 最多消费一个，并只在该 step 已进入 authoritative snapshot 后推进 ack，不能用 latest ack 跨过未模拟的 prediction frame。购买、交互、一次性技能继续使用独立 bounded action FIFO。Diagnostics 必须区分 queued、max queued、coalesced 和 rejected。Peer 离开或断线时，App Host/server presence 组合层必须通知标准 authority loop 释放该 peer 的待处理 action/input 和 sequence key；actor、slot、round stats 是否保留仍由玩法 policy 决定。
- 为模块化 server simulation 提供受约束的 authority tick 分段：ingress 消费输入并建立本 tick context，GameRuntime 在中间运行 AI/Physics/combat 等 app systems，commit 捕获并发布最终状态。不得在 commit 前推进离散 action ack，也不得允许重复 begin、跨 tick commit 或异常后复用半完成 frame。
- 在 client side 维护 authority source gate、snapshot age、last applied tick、resync state 和 rejected non-authority payload diagnostics。
- 提供 snapshot presentation timing + declared track toolkit：core 维护按 tick/server time 排序的短期 snapshot playback、render delay/jitter window、under-run clamp、presentation FPS、sample status、stale/drop diagnostics、类型化插值原语和 `Network*` presentation track 投影；游戏自己声明可表现字段、track key、snap/reset policy，以及如何把底层算好的 presented value 写入 render-only snapshot。
- 提供 managed client replication runtime：标准 Multiplayer GameModule 在启用配置后自动订阅权威 snapshot、推进 playback/projector、按固定频率采样并发送 local input、维护 prediction buffer，并根据 snapshot ack 自动 reconciliation/replay/correction smoothing。`maxPredictionLeadInputs` 为未确认 input 建立有界窗口，窗口满时暂停新 prediction/send 并记录 `throttledInputs`，authority ack 释放窗口后读取最新控制状态继续。延迟敏感的离散输入边缘可以通过 replication view 的 `requestInputSample()` 请求下一次 update 立即采样一次；重复请求会合并，稳定发送频率和有界领先窗口仍保持不变。游戏只声明 decoder、timeline、track、prediction transition 和最终 frame writer，不在网络 callback 或外部 render loop 中显式调用这些底层步骤。默认输入来自 Runtime envelope；显式 `snapshotSource` 用于 provider-native state，并互斥替换默认订阅，不能让两条 authority state lane 同时写入。Source 可用 `current()` 暴露最新全量状态，由 Core 在 binding 就绪后自动补取 initial sync。
- 提供 peer/player binding utilities 和可配置 participant lifecycle policy resolver，统一 active、spectator、next-round、leave、disconnect、reconnect 与 round boundary decision vocabulary，避免每个 app 重复发明状态映射。Policy 可以是静态决定或读取 app-owned context 的 callback；core 不认识具体游戏 phase，也不直接增删玩法 actor、slot、team 或 round stats。
- 提供 conformance tests，验证多 client 不会各自本地开局、非 authority snapshot 不会被应用、不同 session state 隔离、离开 peer 不继续阻塞 ready/start。

标准 helper 不拥有具体玩法：

- 游戏仍然定义 input frame、action type、simulation、collision、score、round lifecycle、snapshot shape 和 validation policy。
- Local authority 不等于绕过 multiplayer contract。它只是把 transport 替换为 in-process delivery，玩法 state 仍由 authority loop 推进，并通过 snapshot/patch/result 驱动 presentation。
- Provider-native state sync 仍可使用，例如 Colyseus Schema；但必须声明它是否是 authority source，并通过 typed native bridge 或 adapter mapping 暴露 provider-neutral diagnostics。
- 标准 authority loop 可以把已捕获的 authoritative snapshot 委托给 app 选择的 provider publisher；publisher 只能替换 snapshot delivery，不能绕过固定 tick、app-owned simulation、capture、authority diagnostics 或 error boundary。
- 标准 authority loop 通过 `snapshotIntervalTicks` 统一控制 snapshot capture/publish cadence，默认每 tick 发布。非到期 tick 仍完整
  推进 simulation、ack 和 diagnostics；显式 `broadcastSnapshot()` 始终立即 capture/publish，供 initial sync、late join 和 resync。
  App 不在 loop 外再写 modulo gate，也不为 diagnostics 重复 capture 同一 tick。
- Client prediction、reconciliation 和 interpolation 是表现层或可回滚缓存，不是 authority state。
- Backend adapter 不应 hard-code 具体游戏 interpolation。Colyseus、Nakama 等 provider 可以提供 state sync、server tick 和 snapshot/version source；GameKits core 提供 provider-neutral presentation timing、declared `Network*` track projection 与低成本 interpolation primitives；游戏或 demo 负责声明字段映射和 snap policy。

## Snapshot Presentation / Interpolation

Authoritative snapshot 通常以固定 tick 或 provider state update 到达，频率和 jitter 都不同于 renderer frame。Multiplayer 的 presentation 层必须把“权威状态”和“显示状态”分开：renderer 可以消费插值后的 render-only snapshot，但不能把 presented position、display rotation、预测缓存或平滑状态写回 authority state。

长期边界：

- Core 提供 temporal snapshot playback 和 declared track projection，而不是完整对象图插值器。Playback 接收带 `tick`、`serverTime` 或 provider version 的 authoritative snapshot，维护 render sampling clock、interpolation delay/jitter window、under-run clamp、presentation FPS，并采样出 `previous`、`next`、`alpha`、`status`、snapshot age、delay、dropped/stale count 等信息。固定 interpolation delay 是显式基线；标准 adaptive delay 根据新 snapshot arrival interval 相对 authority timeline 的偏差估计 jitter，在调用方声明的 min/max 内快速增加、缓慢恢复，并公开 current/target delay 与 estimated jitter。遵循标准架构的游戏默认应使用 core playback、`createSnapshotPresentationProjector()` 或 App Host standard multiplayer presentation binding，而不是在 app 里重新实现播放时钟或每帧临时插值容器。
- Core 提供少量类型化、可组合、低分配的 interpolation primitives 和 `Network*` presentation track，例如 scalar、angle、vector2、vector3、quaternion/slerp 和 step/snap value。相关公共数据形状使用 `Network*` 命名，表示网络 snapshot / presentation value 的结构约束，不作为 GameKits 全局数学类型。Core 根据游戏声明的 track key 和 selector 输出 typed presented value；core 不递归遍历任意 snapshot object，不猜测字段语义，也不自动插值 boolean、enum、inventory、score、phase 或事件。高频路径应优先使用 `selectInto(writer)` 声明 track，并用 `vector2Into`、`vector3Into`、`quaternionInto` 等 direct-write getter 写入 caller-owned render target。
- 本地 prediction state 通过 Core typed field builder 声明 scalar、angle、vector2、vector3、quaternion 或 step 语义；Core 自动执行相应逐帧插值，游戏不回调手写 primitive。朝向使用 shortest-path，位置/旋转等连续字段逐帧表现，未声明字段保留当前 predicted endpoint，离散字段需要过渡时显式声明 step/snap。Core 不递归反射 state，也不按 number 属性名猜语义。
- 游戏或 app presentation 层拥有声明和最终写入，而不是调度 lifecycle：声明哪些 entity/field 可以插值、使用什么 primitive、什么时候 snap、什么时候允许短暂 extrapolate、什么时候因为 teleport、phase change、authority binding change、snapshot version change 或 resync 直接 reset，以及如何把 managed runtime 产出的同一帧 presented value 写入 render-only snapshot、renderer object 和 follow camera。
- 本地玩家 prediction / server reconciliation 与远端 entity interpolation 在 Core 内使用独立 buffer，但由同一个 managed client replication frame 协调。Core 提供 bounded input log、ack 丢弃、prediction-lead backpressure、authoritative rewind、pending replay、fixed-step presentation clock、declared-field interpolation、correction smoothing lifecycle 和 diagnostics；游戏只声明输入如何计算下一个 predicted endpoint、哪些字段参与表现、一个 correction metric field 和需要平滑的字段。标准 transition 通过 factory 创建，使每个 authority binding 拥有独立 rollback runtime，并由 Core 在 binding reset/dispose 时释放；低层 `applyInput` 与 transition 不能同时配置。Transition 的可选只读 diagnostics 由 prediction diagnostics 透传，但业务不能依赖诊断值控制玩法。一个已经前进完整 fixed step 的 endpoint 不能再从终点向未来重复 extrapolate。Reconcile 必须立即校正 simulation state；Core 把 render-only correction offset 叠加在持续移动的新 target 上并按 duration 衰减，超过 max magnitude、teleport 和 hard reset 直接 snap。Managed runtime 没有显式 `predictionStepMs` 时从 `inputRateHz` 派生步长，并按真实采样边界记录 catch-up input timestamp；显式拆分 send rate 与 simulation step 时，调用方必须定义与 authority ack 一致的 interval 语义。Prediction 不进入 backend adapter，也不与通用 snapshot buffer 混成一份状态；物理 transition 由 Physics Core 提供，Multiplayer Core 只管理其生命周期。
- Local/offline authority 也走同一 presentation contract。它可以使用更小或为零的 render delay，但不能绕过 snapshot/apply/presentation 路径去直接读写另一份单机显示状态。
- Backend adapter 只提供 provider-neutral snapshot/version/tick summary、source gate 和 provider-native capability bridge。Colyseus Schema、Nakama match state 等 provider-native state sync 可以成为 authoritative source，但 presentation policy 仍由 GameKits presentation layer 和游戏 track projection 决定。

性能约束：

- 不提供 deep generic interpolation、schema reflection 或按 frame 遍历整棵 gameplay snapshot 的默认实现。
- Track 数量、字段类型和 allocation 行为必须由调用方通过 declaration 显式控制；高频路径优先复用 projector、buffer、scratch object 或 renderer-specific write target，并通过 `vector2Into` / `vector3Into` / `quaternionInto` 直接写入，不能为了方便在每个 render frame 深拷贝完整 gameplay snapshot。`presentSnapshotTracks()` 和完整 render-only snapshot materialization 只作为小工具、测试或低规模便利用法，大规模 runtime loop 使用 reusable projector。
- Diagnostics 采样低频摘要，默认不展开完整高频 payload。

## Selective Prediction Domains

Prediction 是按对象声明的同步策略，不是 renderer 的通用平滑开关，也不是所有联网对象默认进入的完整
world rollback。标准策略分为：

- `hitscan-lag-compensated`：本地只预演即时反馈，authority 在有界历史中回看目标状态并验证瞬时 query。
- `kinematic-data-buffer`：owner 用同一 fixed-step 定义和 sweep 预测；authority 发布有界 fire/finish record，
  remote proxy 按 authority timeline 重建。
- `predicted-entity`：client spawn 与 authority identity 匹配，涉及的动态对象组成 prediction island 并从同一 tick
  rollback/replay。
- `authority-only`：authority simulation，client 只插值公开状态或播放不承诺空间结果的 anticipation。

Multiplayer Core 负责 provider-neutral 的 prediction domain lifecycle：有界 tick/input/history、generation、
predicted-spawn identity/match、confirm/reject、rollback/replay/hard-reset、overflow 和 diagnostics。Core 不选择具体
武器策略，不执行 Physics query，不理解 Combat projectile definition。游戏或 Data 声明策略；Physics、Combat
等 domain transition 提供确定性 simulation 和空间 record。

`createMultiplayerPredictedSpawnRegistry(...)` 是 predicted spawn 的标准轻量 identity helper。它按 kind +
correlation + generation 匹配 local/authority id，返回 matched/unmatched/duplicate/stale/rejected 结果，并对
pending、resolved、age 与内部 order index 设置独立硬上限。Registry 不比较 gameplay payload，也不决定
correction；具体 domain 在 match 后解释 predicted/authority state。

`createMultiplayerAuthorityTimeline(...)` 是 authority record/presentation 的标准单调时钟 helper。它把收到的
provider-neutral authority time 锚定到本地 presentation time，允许向前校正，但拒绝 delayed snapshot 将已经
显示的时间线向后移动；重复 anchor 不反复重锚。离散 simulation 使用整数 `tick()`，逐帧 record reconstruction
使用 `sampleTick()`。它不估算 transport RTT，也不替代 Snapshot Playback 的 interpolation/jitter policy。

`createMultiplayerPredictedLifecycleDomain(...)` 是事件起点对象和 predicted entity 的标准托管入口。调用方声明
kind、初始 generation、authority time、local/authority spawn 和硬容量；Core 组合 predicted-spawn registry 与
authority timeline，统一推进 generation reset、identity index、match/reject/expire、authority binding/prune、
timeline rewind protection、cleanup hook 和 diagnostics。Combat/Physics/app runtime 通过 typed hook 释放自己的
speculative record、solver object 或 presentation entry，但不维护第二套 correlation map、binding map 或 expiry loop。
低层 registry/timeline 继续面向特殊 netcode、标准 domain 实现和测试开放。

`createStandardMultiplayerPhysicsPredictionDomain(...)` 是 predicted entity 与 Physics island 的标准跨模块组合。
它用同一个 owner lifecycle 先同步 correlation/authority member，再执行 island reconcile；出现 history overflow、
membership mismatch 或 generation mismatch 时，默认调用 `hardCorrect(...)` 安装完整权威 baseline。首次匹配对象的
member definition 直接从 managed predicted payload 复用，只有 authority 新增且客户端从未预测/创建过的 member 才由
app 映射 definition。App 仍负责对象属于哪个 island、权威 payload 到 member/correlation 的 typed mapping 和 gameplay
command，但不判断哪些 reconcile 状态需要 hard correction，也不平行维护 predicted identity。

标准 Arena adapter 在这条 domain 上额外提供 event-started `registerPredictedMember(...)`。Throw/projectile 等离散事件以稳定
correlation、prediction tick 和完整 member definition 注册一次，adapter 同时拥有 identity 与 island spawn command；duplicate
不会再次 spawn。应用从已验证 app snapshot 的 action/item projection 实现 `resolveAuthoritySpawn(...)`，从同一 snapshot 实现
`resolveMemberDefinition(...)`，不能依赖 authority projection 已明确剥离的 body `userData`。Reject、gap、generation reset 与
authority member 缺失统一走 reconcile/hard correction，不能在 session callback 手删 ghost body 或重建 history。

多人高互动 arena 使用 Multiplayer GameModule 的 client prediction-domain descriptor 连接 managed replication 与外部
domain runtime。Descriptor factory 以 authority binding 为生命周期边界，接收已经校验的 snapshot、已编号 input、fixed
tick 和 frame，并提供 reset、diagnostics、dispose 与只读 output；GameModule bridge 固定 authority → reconcile → input →
advance → frame writer 顺序。该 descriptor 是 provider-neutral 协议，不包含 Physics、Combat、Renderer 或 backend type，
也不改变低层 `createMultiplayerClientReplication(...)` 的单 state transition contract。

逐 step prediction 在可能丢包的 delivery 上使用 managed redundant input bundle。Core 每次发送当前 frame 与有限个仍未
ack 的旧 frame；authority fixed-step inbox 按 peer、binding generation 和 sequence 去重，只消费连续 step，并按显式
hold-last/neutral gap policy 处理超过等待预算的缺口。App 只编码单帧 gameplay input，不维护 resend window；snapshot ack
只能推进到已经实际模拟的最高连续 sequence。该 delivery policy 是 additive opt-in，未配置时保持单帧 input 行为。

`createMultiplayerNetworkConditionSimulator(...)` 是 provider-neutral 的确定性故障注入 wrapper。它可以包裹 Memory、
Colyseus 测试桥或其他 backend，用手动 `advance(...)` / `flush()`、固定 seed、direction/message predicate 和有界 pending
queue 模拟 latency、jitter、loss 与 duplicate，并输出 scheduled/delivered/drop/duplicate/capacity/error/connection
diagnostics；delivery 失败同时保留 `lastDeliveryError`，使 listener decode、底层 send 和 session 生命周期错误可定位而不只剩计数。
Session lifecycle 直接委托底层 backend；reliable ordered lane 中未丢弃的消息保持顺序。该 helper 只服务
测试、benchmark 和本地调试，不替代真实 provider 的 transport/reconnect 测试，也不拥有 authority 或 prediction clock。

App Host 的 `createStandardMultiplayerPhysicsArenaPrediction(...)` 把 descriptor 与 Physics island、standard Physics
prediction domain、membership revision、hard correction、可选 island-owned auxiliary contributor、rollback contributor 和
speculative effect journal 组成默认 arena adapter。应用声明 authority frame mapping、input command mapping、完整交互成员 policy、
definition resolver、可选 `createAuxiliaryContributors()` 和最终 writer；不手动调用 reconcile/replay 或维护 history/revision/
effect settlement。Contributor factory 必须为每个 binding baseline 返回新实例，不能跨 generation/membership revision 复用已释放状态。
对称的 authority projection helper 从显式 membership source 生成
`islandId + generation + tick + membershipRevision + definitionVersion + members + auxiliary?`；auxiliary envelope 按稳定 id 排序，
与 body members 一起计入 payload 预算，但 input ack、round/player state 和 provider wire serializer 仍由 app replication schema 拥有。

标准 arena 接入面固定为三段：authority loop 声明 `inputDelivery: { mode: "redundant-bundle" }` 并在 fixed tick 中消费
typed gameplay input；authority projection 把显式完整 membership 投影进 app snapshot；client 创建一次 Arena prediction
descriptor，并把它和 replication schema 一起交给 Multiplayer GameModule。新游戏仍需定义共享 body/collider/layout、
input-to-command mapping、round/score 规则和最终 presentation writer，但不实现 resend/de-dup、binding lifecycle、ack prune、
checkpoint/history、reconcile/replay、hard correction 或 dispose 调度。普通单主体游戏继续使用 managed state transition 或
Physics body transition；只有确实存在多人/机关/动态道具因果接触时才升级到完整 arena island。

同 tick Physics command 依赖角色 motor、cooldown 或其他少量确定性状态时，应用把 typed input 映射为 `auxiliary` command，并
注册 island contributor；island 先按稳定 contributor order 重放 auxiliary command，再推进同一个 solver step。Contributor 只捕获
生成 Physics command 所必需的窄状态，不能把整个 World、AI blackboard、match state 或 presentation 塞进 arena checkpoint；这些
跨域状态使用通用 rollback coordinator，或保持 authority-only。没有 contributor 的既有 consumer 保持原 body patch/body command
路径和 wire shape，不需要迁移。

Arena membership 是相互作用对象的完整因果闭包，不等同于 renderer interest set。Authority 必须发布完整 revision；
客户端不能根据距离静默猜测。成员或 definition 变化、history/byte/replay work 溢出时安装完整 baseline 或降级
authority-only。单个完整 arena island 是标准正确性基线；partition/merge/split 只能作为 authority-declared 可选 policy。
同一 solver state 只能由 arena island 或通用 Physics rollback contributor 之一拥有，不能重复捕获。

`defineMultiplayerReplicationSchema(...)` 是 managed client replication 的可选 typed schema compiler。App 声明一次
payload decoder、schema id/version、tick/time、local entity selector、ack reader 与 state mapping，`bindClient(...)`
生成 `readSnapshot`、buffer entry、authoritative state 和 acknowledged sequence binding。Entity presentation 通过
`defineMultiplayerReplicationEntityPresentation(...)` 声明 identity、generation 和 scalar/angle/vector/quaternion/step
fields，编译为稳定 key 与 snapshot tracks。Core 在 ingress 隔离 decoder exception、拒绝显式 version mismatch 和
非法 tick；key 对 schema/field/identity/generation 做 length framing，避免字符串拼接歧义。该层不生成 provider wire
serializer、不反射任意对象图，也不接管 app payload 校验；低层 callback 仍是合法 escape hatch。

`createMultiplayerSpeculativeEffectJournal(...)` 是 replay 副作用的标准有界入口。Simulation 使用稳定 effect id
调用 anticipate；同一 id 因 rollback/replay 再次出现时不会重复执行 hook。Authority 以 confirm、cancel 或 replace
结算一次，先于 prediction 到达的结果也进入有界 resolved index，阻止稍后的本地重复表现。Pending effect 在过期、
容量淘汰、generation reset 和 dispose 时统一 cancel；hook 异常被隔离并进入 diagnostics。该 journal 只管理可撤销
的 Renderer、Audio、Camera 或 UI feedback，不接管 damage、cost、inventory、GAS/TCA transition 或其他权威事实。

`createMultiplayerRollbackCoordinator(...)` 用于一个 prediction domain 需要在同一 generation/tick 恢复多个模块的
场景。World、Physics、RNG、GAS/TCA 或 app contributor 各自声明稳定 id/order、隔离 checkpoint、restore 前 validate、
deterministic restore、byte measurement 和 state hash；Core 只持有 opaque checkpoint，统一限制单 checkpoint bytes、
总 history bytes 和 history ticks，并组合 domain hash。Restore 在所有 contributor validate 通过后按稳定顺序执行，
成功后删除目标 tick 之后的旧 history。由于外部 runtime 的 restore 无法由 Core 通用事务化，任何 contributor restore
抛错都必须视为 partial restore 风险，并进入完整 hard correction/rebuild，不能继续 replay。Seeded RNG 通过
`createMultiplayerRngRollbackContributor(...)` 保存精确 stream position；具体 World/Physics adapter 留在 domain 或
App Host 组合层，Multiplayer Core 不反向依赖它们。标准组合使用
`createStandardMultiplayerWorldRollbackContributor(...)`、`createMultiplayerRngRollbackContributor(...)` 和
`createStandardMultiplayerPhysicsRollbackContributor(...)`，默认 order 分别为 100、150、200：World 先恢复稳定
entity identity 与 gameplay component，Physics 再恢复引用这些 entity 的 body/collider state。World checkpoint 由
`createWorldCheckpointController(...)` 的显式 component/entity scope 定义，不能把完整 ECS object graph 隐式塞入 Core。
标准 canonical encoder 对 object key 排序并拒绝非有限 number、循环引用和非 plain object，使 byte measurement 与 hash
不依赖 property insertion order。

普通 App Host 组合优先调用 `createStandardMultiplayerRollbackDomain(...)`，一次声明 World checkpoint scope、RNG、
Physics handle、额外 gameplay contributor 与 history/byte budgets。该工厂生成上述默认 contributor 和 coordinator；
只有自定义 domain ownership/order 时才逐个创建 contributor。

`createMultiplayerTimeAlignedPresentationTransition(...)` 是 predicted lifecycle 接管 authority lifecycle 的标准
有界 helper。Domain 只声明 stable key/version、predicted/authority deterministic sampler、事实 reconciliation、
可选 hold policy 和 declarative presentation fields；Core 统一管理 absolute 或 relative-origin 时间对齐、entry
capacity、residual correction smoothing、reset/remove/dispose 和 diagnostics。Relative-origin 模式先保持 predicted
lifecycle age，再采样 authority；start/commit tick 偏移只作为 origin diagnostic，不能产生 correction。只有时间
对齐后的 state divergence 才能进入平滑。它适用于 projectile fire record、移动平台/门的 start record、可重建的
技能轨迹等事件起点对象，不代替输入 replay、remote snapshot interpolation 或 Physics island resimulation。

App 组合 predicted projectile 时通过 managed predicted lifecycle domain 接入 generation、identity、authority
timeline 和 binding，再把 matched domain payload 交给 Combat/Physics sampler 或 transition。跨 Combat +
Multiplayer 的常规 kinematic projectile 使用 App Host 标准 helper，不由 app 重写 alignment、entry map 或
correction。App 可以拥有内容定义、静态 layout、actor proxy 和 renderer 写入，但不能平行实现 generation、
match、expiry、timeline rewind protection、binding index 或通用 correction lifecycle。

一个 domain 必须显式限制 history tick、对象数、spawn 数、内存和 replay work。Binding/session/generation 改变
时必须整体释放旧 domain；history overflow 或成员缺失时执行可观察的 hard correction/authority-only 降级，
不能继续在不完整历史上重放。相互作用的 predicted dynamic object 必须进入同一 prediction island；只回滚
本地主体、却让它与留在未来 tick 的 dynamic body 交互不是合法 resimulation。

现有 managed `clientReplication` 的单 state transition 是轻量 prediction domain，适合本地角色对静态 layout
的移动与 Dash。它不自动提供 predicted spawn matching、多 entity solver snapshot 或完整 physics island rollback。
这些能力需要显式的 domain/transition，不能由 app 在 render handoff 或 network callback 中补 collision 特判。

只有纯装饰对象可以使用 visual-only anticipation。会因 collision、bounce、hit、expire 或 spatial lifecycle 改变
轨迹的对象必须选择能预测或权威表达该结果的策略；稳定 correlation 继承显示位置只能作为 presentation
continuity，不能替代 simulation。

## Provider-Native Capability Bridge

成熟 backend 的强能力不进入 `multiplayer-core`，但 backend package 必须为完整可用场景保留受控接入口。典型能力包括：

- Provider-native state sync：Colyseus Schema、Nakama match state 或其他服务端状态同步。它可以作为 authority snapshot/patch 的来源，但必须通过 authority binding 标记 source、tick/version、resync 状态和 diagnostics。
- Reconnect / seat reservation：provider 可以持有 reconnect token、reservation、session resume hint。GameKits summary 只能暴露脱敏状态、过期时间和 slot/player binding 结果，不能保存 secret。
- Matchmaking / room listing / room metadata：provider 可以负责筛选、排队、分配区域和 room metadata。GameKits core 只消费最终 session summary，不定义完整 matchmaking UI 或社交模型。
- Provider diagnostics：load、transport、ping、drop、reconnect、room close reason 和 provider state size 可以通过 backend diagnostics 暴露。默认 diagnostics 必须脱敏，高频 payload 展开需要显式 opt-in。
- Native server/runtime bridge：app-specific server、工具或 DevTools plugin 可以显式导入 backend package 的 native bridge 使用 provider SDK 类型；可复用 gameplay module、DataType、Save 和 core facade 不能依赖这些类型。
- App-owned field-level state mapping：复杂游戏可以在 app provider boundary 定义字段级 Colyseus Schema 或其他 provider state model；backend package 只提供通用 subscription、update metadata、authority/source/version/size/resync gate 和 diagnostics，不拥有具体游戏 Schema。

接入规则：

- Provider-native state sync 与 GameKits envelope snapshot/patch 不能双写同一份 authority state。一个 app 必须声明当前 authoritative path，并把另一条路径降级为 diagnostics、summary 或迁移通道。
- Backend package 可以提供 provider-specific helper，例如 Colyseus Schema authority bridge；helper 输出应能连接到 GameKits authority binding、receiver diagnostics 和 conformance tests。
- App-owned Schema entity 应使用稳定 id 与 generation，并把 server world、replication projection、provider state、client authoritative shadow 和 presented state 保持为不同对象。Provider callback 先更新 authoritative shadow，再由 presentation frame 批量写 renderer。
- Provider-native receiver 应优先使用 provider 的单调 state/update version 排序，gameplay tick 只表示 simulation 时间。一个 gameplay tick 内允许发布多次合法状态；重复 provider callback 应在 adapter 边界去重，真正的 stale/duplicate update 仍由 authority bridge 拒绝并记录。
- Provider-native source 映射成 Core snapshot 时，把单调 provider version 放入 `sequence`，把 simulation 时间放入 `tick`。Core 仅在显式 source lane 使用该 sequence 排序；普通 envelope 的 transport sequence 不能冒充 provider state version。Authority binding/session 变化会清空 source 排序水位、playback 和 prediction state，使新 session 的 initial full state 可以从 version 1 重新开始。
- 自定义 provider decoder 必须提供或允许 adapter 测量完整映射状态的 byte size；adapter 和 native bridge 均执行非负安全整数与 `maxStateBytes` gate。高频 app mapping 可以提供低分配的保守估算，避免为大小检查重复序列化完整对象图。
- 如果一个 provider 支持核心 baseline 之外的能力，adapter capabilities 应明确声明支持等级和限制；调用方必须按 capability 检测启用，而不是假设所有 backend 等价。
- 完整 backend adapter 测试除 core conformance 外，还应覆盖 provider-native bridge 的 source gate、resync、reconnect cleanup、room isolation、redaction 和 dispose。

## GameModule Bridge

Multiplayer GameModule bridge 把 App Service 的连接事实接入 GameRuntime：

`@gamekits/multiplayer-core` 通过 `createMultiplayerModule(...)` 持有真正的 GameModule 实现。`@gamekits/app-host` 的 standard multiplayer helper 只从 `services.multiplayer` 或 profile 解析 runtime/presentation options，再调用这个 domain factory；它不在 App Host 内复制 command、authority 或 presentation runtime。旧的 `createMultiplayerBridgeModule(...)` 仅作为兼容别名保留。

```txt
backend message
→ MultiplayerFacade
→ GameModule bridge
→ decode game command / snapshot / patch
→ authority policy
→ command queue / system / EventBus
→ accepted result / replicated patch
→ MultiplayerFacade.send(...)
```

职责：

- 订阅 MultiplayerFacade 消息。
- 把 `game.command` 放入确定性队列，并在 tick 边界处理。
- 根据 authority policy 接受、拒绝或转发命令。
- 建立 authority binding，并把 action/input/snapshot/patch/result 交给标准权威复制 helper 或 app-provided replication strategy。
- 拒绝非绑定 authority source 的 snapshot/patch/result，并记录 diagnostics。
- 启用 `clientReplication` 时，自动持有 client snapshot receiver、playback/projector、continuous input sender 和 prediction/reconciliation lifecycle；App Host standard helper 只解析配置并调用 Core factory。
- 触发 EventBus 低频事实，例如 `multiplayer.command.accepted`、`multiplayer.peer.disconnected`。
- 调用可插拔 replication contributor 捕获 snapshot 或 patch。
- 在 GameRuntime dispose 时清理订阅、队列和 trace buffer。

GameModule bridge 不负责创建连接、不弹出 lobby UI、不读取浏览器 URL、不直接调用 backend SDK。

## Replication

Multiplayer 不强制单一同步模型。成熟 backend 可以拥有自己的 state sync，例如 Colyseus Schema；GameKits 只在需要把 World/TCA/GAS/Camera 等状态接入 GameKits diagnostics、Save 或 provider-neutral summary 时使用 contributor。无论使用哪种同步模型，都必须先明确 authority binding，否则客户端不能应用 gameplay state。

```ts
export type MultiplayerReplicationContributor<TSnapshot = unknown, TPatch = unknown> = {
  id: string;
  version: string;
  order?: number;
  captureSnapshot(ctx: MultiplayerSnapshotContext): TSnapshot | undefined;
  capturePatch?(ctx: MultiplayerPatchContext): TPatch | undefined;
  applySnapshot?(snapshot: TSnapshot, ctx: MultiplayerApplyContext): void;
  applyPatch?(patch: TPatch, ctx: MultiplayerApplyContext): void;
};
```

长期可支持的 GameKits 层策略：

- local authoritative loop：单机/offline 在同一进程内运行 authority loop，复用 action/input、validation、tick 和 snapshot/apply contract。
- command relay：只同步玩家命令，由权威端执行后广播结果。
- authoritative snapshot stream：权威端按固定 tick 或节流频率广播完整/分区 snapshot，客户端只应用绑定 authority source 的 snapshot。
- authoritative patch stream：权威端广播可版本化 patch，客户端按 tick/version 顺序应用并可请求 resync。
- state summary：低频发送稳定 summary，用于 DevTools、观战摘要或重连后的应用层校验。
- provider state mapping：把 Colyseus Schema、Nakama match state 或其他 provider state 映射成 GameKits summary。
- deterministic lockstep：只同步输入/命令和 tick，要求游戏自己保证确定性。
- selective prediction domain：core 提供有界 history、predicted-spawn identity、rollback/replay lifecycle 与
  diagnostics；具体 Physics/Combat transition 和 app policy 声明对象集合、simulation 与权威结果。

World、GAS、TCA、Camera 或游戏自定义模块可以各自提供 contributor。Multiplayer core 不直接理解 Koota object、Phaser object、React state、Colyseus Schema class 或具体游戏组件。

## 与 App Host 的关系

App Host 可以把 MultiplayerFacade 作为标准可选服务：

```txt
platform / config / auth
→ multiplayer backend adapter, such as Colyseus
→ multiplayer facade service
→ game service installs multiplayer GameModule bridge
→ devtools source observes multiplayer facade
```

标准组合中，`services.multiplayer` 暴露连接 facade；`profile.standard.game.standardModules.multiplayer` 安装 GameModule bridge，把入站 command 放到 GameRuntime tick 边界处理。二者必须保持分离：App Host service 管 provider connection lifecycle，GameModule bridge 管 gameplay command lifecycle。

Headless server profile 也遵守同一分工：Room-owned provider bridge 作为 Multiplayer service，server GameRuntime 安装 authority/gameplay modules，App Host 统一推进 start/stop/dispose。Room 本身仍由 backend package 或 app server 持有，不能进入 core facade。

典型依赖：

- Platform / config 提供 endpoint、room name、region、environment 和权限信息。
- App/account service 提供 player identity 或 access token；Multiplayer core 不长期保存 secret。
- Data 可以提供命令 schema、replication profile 或 game mode definition。
- Save 可以保存可恢复的长期玩家映射或 replay metadata，但不保存 live connection。
- DevTools 观察 session、peer、message summary、latency、provider reconnect 和 command result。
- Offline profile 可以用 local authority binding 启动同一套 GameModule bridge；不需要注册远程 backend service，但 diagnostics 仍应能说明当前是 local authority。

## 与 Input / TCA / GAS 的关系

推荐流程：

```txt
Input Action
→ local command
→ Multiplayer command bridge
→ authority policy / server validation
→ GameRuntime system or EventBus fact
→ TCA / GAS responds
→ replication result
```

Input 不直接发 socket frame；TCA/GAS 不直接读取 backend room；server validation 不写在 client-only UI 中。

## 与 Save 的关系

普通进度存档不保存 live multiplayer connection。可保存的内容应限制在长期事实：

- 本地 playerId 到游戏角色或 profile 的映射。
- session resumability metadata，例如 backend session id 或 reconnect hint，且不包含 secret token。
- replay / match record 的稳定 metadata。
- contributor snapshot 中明确声明可恢复的 gameplay 状态。

临时 presence、ping、未确认消息、socket handle、SDK room object 和认证 token 不进入 Save payload。

## Diagnostics

Multiplayer diagnostics 应回答：

- 当前 backend、session、phase 和 authority mode。
- 当前 authority binding 状态、authority peer/server、local player/slot、last applied tick 和 snapshot source。
- 本地 peer 与其他 peer 的 presence 状态。
- 最近连接、重连、断线、房间关闭原因。
- message 计数、action/input 当前与峰值队列长度、延迟摘要、丢弃/拒绝原因。
- command accept / reject / forward / apply 链路。
- snapshot / patch 的版本、大小、source gate、contributor、age 和应用结果。

默认 diagnostics 不记录完整 payload，不记录 secret，不把每帧网络包推入 React UI。深度 payload 展开必须由测试夹具或 DevTools 显式开启，并提供 redaction 策略。

## 安全边界

- 所有 remote payload 都按不可信输入处理，必须经过 schema/version/size 校验。
- 权威端必须重新验证 command 的玩家、tick、目标、资源消耗、冷却、位置和 DataRef。
- 客户端只能把绑定 authority endpoint 发来的 snapshot、patch 和 result 应用到联网 gameplay state。
- `connected`、`joined`、`peer count > 1` 或 presence message 不能作为 gameplay state 已同步的安全条件。
- `local` authority endpoint 是正式权威源；它可以没有网络连接，但仍必须经过同一 payload schema、tick boundary、snapshot/apply 和 diagnostics 路径。
- Runtime phase、session 和 peer 访问器必须反映 backend connection 的最新 snapshot；UI 权限不能依赖 stale `in-session` 缓存。
- backend adapter 不应把 access token、room secret、平台账号私有字段放入普通 snapshot、EventBus 或 Save。
- Client prediction 只能作为可丢弃的 speculative simulation/presentation state，不作为权威事实保存；会产生
  空间因果的对象不能降级成没有 collision 的 render-only anticipation。
- 本地 memory backend 不代表生产安全模型；Colyseus/Nakama 等成熟 backend 仍需要按具体游戏设计 server-side validation。

## 反模式

- Gameplay system 直接 import Colyseus/Nakama/Steam SDK。
- GameRuntime 保存 socket、room、connection 或 provider-specific client。
- GameKits core 重新实现 Colyseus 已经负责的 room、matchmaker、reconnect、presence 或 state sync。
- Renderer/Input/UI 直接发送网络包并修改 world。
- UI 用 peer count 或 joined 状态判断“多人已跑通”，但 gameplay state 仍由每个客户端本地 simulation 独立推进。
- 为离线单机写一套独立 gameplay runtime，和 host/server authoritative runtime 各自维护 action、input、tick、snapshot 或 UI state。
- 浏览器 client 在联网 session 中直接 start/ready/tick 本地 authoritative state，而没有通过 host/server authority binding。
- Client 接受任意 peer 广播的 `game.snapshot` 或 `game.patch` 并覆盖本地联网状态。
- 把 `peer.connected`、ping 或 pointer move 这类高频/临时状态当作长期玩法事实保存。
- Save payload 内保存 access token、room handle 或 provider SDK object。
- Client 直接广播 `world.patch` 并让其他 client 无校验应用到权威状态。
- Multiplayer core 维护一个无限扩展的 backend capability catalog，试图包装每个服务商的全部能力。
- 为了“统一”而把 Colyseus Schema、Nakama match state 或 provider account model 抽象成一套过大的 GameKits 自研多人模型。
- 把继承显示位置、保持速度或 correction lerp 当成 projectile prediction，却不在本地运行同一 collision/
  lifecycle simulation。
- 默认回滚完整 world，或反过来只回滚一个 body 却让它与未来 tick 的动态对象交互；prediction island 必须
  按真实交互边界声明并有硬预算。

## 最佳实践

### 模块集成

- App Host 负责 MultiplayerFacade lifecycle；GameRuntime 只通过 GameModule bridge 消费连接事实。
- Backend adapter 必须通过 core conformance tests，至少覆盖 connect、create-or-join/leave、peer summary、message routing、disconnect、dispose 和 snapshot。
- Room-side backend 也必须通过 core facade 验证 session、phase、peer presence、message normalization 和 dispose；不能向 App Host 注入手写的 `MultiplayerRuntime` 结构替身。
- 优先接入成熟多人 backend，再按需补 provider adapter。不要从 raw WebSocket 开始扩展 GameKits 自己的多人核心。
- 需要按 GameKits session id 加入指定 room 的 adapter，必须保证不同 backend 实例能解析到同一个 provider room；fallback 不能加入同 room type 下的任意可用房间。
- `host-authoritative` backend adapter 必须定义 authority host 离开后的 room lifecycle：默认关闭该 room 并断开剩余 client，除非明确实现 host migration 并更新 authority binding。
- `server-authoritative` Room-owned backend 必须把 party leader 与 authority endpoint 分离；leader 离开只触发 app permission transfer，不能套用 host-authoritative 的自动关房规则。
- Headless server app 应优先复用同一套 GameRuntime、Data、World、TCA/GAS、Save 和 DevTools 协议，只替换 renderer/input/UI 为空或测试实现。
- Room-owned server tick 应按 ingress → gameplay/Physics → replication commit 的顺序执行；输入消费、simulation 和 ack/Schema publish 不能由互不关联的 timer 分别推进。
- Core session/peer 是连接、权威来源和参与者身份的唯一基础语义；lobby、ready、countdown、round 和 results 等玩法阶段保留在 app-owned authority state。App 可以用 core participant policy 与 peer/player binding 应用这些规则，但不能在 provider Room 或 adapter 内再维护一套平行 session/participant 真相。
- 新增 provider backend 时，先实现 core session/message/diagnostic 协议；provider-specific matchmaking、好友、邀请、房间属性和原生控制通过 typed native bridge 或 app-specific service 扩展。
- 多人协议变更必须同时考虑 Data schema、Save compatibility、DevTools redaction 和 server/client 版本协商。
- 接入 realtime game demo 或真实游戏时，优先使用 multiplayer core 的 authority binding / replication helper；只有 provider-native state sync 或特殊 netcode 需求明确时，才通过 typed native bridge 替换默认复制策略。
- 第二个真实应用已经出现相同 snapshot/tick/local identity/ack/presentation mapping 时，优先定义 typed replication
  schema 并把生成 binding 交给 managed client replication；decoder 仍在 app provider boundary 做完整不可信输入验证。
  不为减少几行 accessor 引入 NetworkObject 基类、runtime decorator scan 或深对象反射。
- 离线单机、local preview 和 multiplayer room 应共享 gameplay orchestration；差异应收敛为 authority endpoint 和 transport/delivery adapter，而不是分叉玩法代码。
- 多客户端 headless test 不能只断言 peer count；必须断言同一 lifecycle、input 或 snapshot 来自同一个 authority state。
- Room-owned 物理游戏的多客户端测试应至少覆盖 bounded action、latest continuous state 或 fixed-step predicted input/ack（按实际 contract 选择）、完整 authority begin → GameRuntime/Physics → commit、实体出生/离开清理，以及 leader 离开后剩余 peer 继续读取同一 authority state。Fixed-step predicted input 测试必须证明 burst 到达后 ack 按每个已模拟 step 依次推进。
- 改动多人高频路径时运行并按需扩展 `bench:multiplayer`。模块级 benchmark 应覆盖 envelope normalization、authority receiver source gate、host/local authority loop、latest-input coalescing、prediction lead backpressure、prediction reconciliation/presentation、snapshot playback 和 presentation projection；定时或手动 performance workflow 使用宽松预算观察数量级回归，并用模拟长时序 + GC 后 retained heap 检查有界缓存，不作为常规 PR merge gate。provider-native backend 可在对应 adapter 包中补独立 benchmark。
- 逐 step input replay、prediction island 或 authority ack 改动必须用确定性 network-condition simulator 覆盖 baseline、
  latency+jitter、loss 和 duplicate。分别记录 authority consumed sequence 与 client observed ack；停止发送后推进有限
  recovery tick，再检查 ack lag、queue 上限和 delivery error。`flush()` 只排空网络 delivery，不能冒充 authority tick。
- 新增 selective prediction domain 时，conformance 必须覆盖 spawn confirm/reject/duplicate/late result、generation/
  binding reset、history overflow、hard correction 与 dispose；benchmark 分开测 history capture、restore、replay、
  predicted-spawn churn 和 retained bytes。只测 renderer object 数或关闭 prediction 的路径不能作为该能力预算。
- 会在 prediction/replay 中产生 Audio、Camera、Renderer 或 UI feedback 时，通过 speculative effect journal 使用稳定
  effect id 执行 anticipate/confirm/cancel/replace；不要在 deterministic transition 内直接提交副作用。测试必须覆盖
  replay duplicate、authority-before-prediction、容量/过期、generation reset、hook failure isolation 和 dispose cleanup。
- 跨模块 rollback contributor 必须返回与 live runtime 隔离的 checkpoint，并提供稳定 hash 和可解释 byte measurement。
  Validate 必须在任何 restore 之前完成；restore 失败后不假设其他 contributor 可逆，直接 hard correction/rebuild。
  RNG 必须恢复精确 stream position，不能只重建同 seed 后忽略已经消耗的随机数。World 与 Physics contributor
  不重复捕获相同 component；默认 World → RNG → Physics 顺序只有在自定义 domain 明确证明依赖关系后才覆盖。
- 修改跨模块 rollback checkpoint 时运行 `corepack pnpm bench:checkpoint:check`；标准用例约束 1,000 个 World/Physics
  entity 的 capture/hash、restore/rebuild、单 checkpoint bytes、总 history bytes 和 retained checkpoint count。
- 改动 Colyseus Room runtime bridge 的 tick、ingress、peer index 或 lifecycle cleanup 时运行 `corepack pnpm bench:multiplayer:room:check`；该基准必须同时检查 dispose 后 peer 与 timer 为零。
- 字段级 provider state model 优先保持 app-owned；只有第二个稳定应用出现相同 mapping、partition 或 interest-management 需求，并通过真实 benchmark 验证后，才评估下沉 backend package 或 core。

### 模块使用

- 游戏代码发送语义命令，不发送 backend frame。命令应小、可序列化、可验证，并能关联 tick、peer、player 和 correlation id。
- Standard Multiplayer module 派生 accepted/rejected/expired/overflow EventBus fact 时保留 message `correlationId`，并把 message id 作为 `parentId`；后续 Physics/GAS/TCA/app fact 应沿这条显式链继续传播。
- 线上权威玩法默认使用 host/server validation；客户端预测只影响本地表现，不直接写入长期权威状态。
- 不做逐 input rollback 的连续移动/瞄准按 latest state 复制，并由 authority 在新状态或超时前保持。若 local prediction 明确定义“一个 sequence = 一个 fixed simulation step”，则使用底层 per-source bounded FIFO、authority 每 tick 最多消费一个、snapshot ack 逐 step 推进，并用 client `maxPredictionLeadInputs` 限制领先量；不能让 latest coalescing 的 ack 跨过未模拟 step。必须逐条执行的交互、购买和一次性技能使用独立 action FIFO；不能在 app 中另建无界 command 数组。
- 普通游戏通过 standard Multiplayer module 的 `clientReplication` 配置连接 authoritative snapshot 和 renderer frame：声明 decoder、timeline、remote `Network*` tracks、deterministic prediction transition、local predicted-state fields 与统一 `applyFrame` writer 后，由底层自动接收、播放、预测、字段插值和校正。只有特殊 netcode、测试或工具才直接调用 low-level playback/projector/prediction factory 或 deprecated custom presentation callbacks。不要让 renderer 直接按低频网络 tick 跳变，不要在 app 层重复实现通用 playback clock/lerp/correction offset，也不要把 presented position 写回 authority state。
- 结构稳定的普通 snapshot 使用 replication schema binding 取代重复的 `readSnapshot + toBufferEntry +
readAuthoritativeState + readAcknowledgedSequence + tracks` 回调；app 仍提供 payload decoder、local identity 与最终 frame
  writer。Provider Schema/Protobuf/JSON wire format 和 GameKits typed binding 是两层边界，不能互相冒充。
- 本地预测优先只配置 `inputRateHz`，managed runtime 用同一周期推进 prediction step，并用 `maxPredictionLeadInputs`（默认 8，可按 RTT/authority queue 预算调整）阻止未确认序列无限领先；如果 authority tick/ack 使用另一周期，必须显式建立一致的 simulation interval，不能让两个独立数字静默漂移。Prediction field 声明 correction metric、smooth fields、duration 和 max magnitude；managed runtime 自动调用 predict/present/reconcile 并应用 moving-target offset。不要把 prediction buffer `state()` 的 raw endpoint 直接写入 renderer，也不要对 endpoint 再做一整步向前 extrapolate。大 correction、teleport、binding/session change、hard phase transition 和 resync 直接 snap/reset prediction presentation。
- Authority 使用 Physics backend 时，本地 prediction 不能长期使用 `position += velocity * step` 近似带 damping/碰撞的 solver。优先通过 `createPhysicsBodyPredictionTransition(...)` 复用同一 body/collider/layout definition、backend kind 与 fixed sub-step，并把 transition factory 交给 managed replication；transition 的有界 sequence checkpoint 会在权威基线匹配时复用 replay 结果，避免无意义 rewind 破坏 solver contact cache。游戏只声明 input-to-body patch 和 state binding，不手动推进 solver、调用 replay/interpolation 或释放 prediction scene。
- 多人拥挤或动态机关持续交互时，使用标准 Physics Arena prediction descriptor，并让 authority 发布完整
  `islandId/generation/tick/membershipRevision/definitionVersion/members`；若注册 auxiliary contributor，还要发布同 tick 完整
  `auxiliary` envelope。Client 只映射本地 input、创建 contributor 和 app presentation；
  不在 snapshot callback 中重建 island、按半径猜成员或在 render loop 中调用 reconcile。首个接入默认使用完整 arena
  island，只有带 authority revision、保守交互 horizon 和完整性测试的 policy 才允许拆分。
- Arena 中由离散 action 产生的 predicted entity 使用 descriptor 的 `registerPredictedMember(...)`；correlation 来自 action/
  execution id，authority matching 与 definition resolver 读取 typed app snapshot。不要把玩法 identity 塞进会被 authority
  projection 清洗的 Physics `userData`，也不要在 item/projectile session 代码里维护第二个 pending-spawn/ghost cleanup loop。
- 为网络对象选择最窄且语义完整的策略：瞬时攻击用 lag-compensated hitscan，可重放直线弹丸用有界
  kinematic fire/finish record，复杂动态交互才用 predicted entity + prediction island，非手感关键对象保持
  authority-only。Remote entity 默认 interpolation；只有输入/history 和交互集合都明确时才预测。
- UI 和 gameplay 代码应读取 authority binding / last authoritative snapshot 来决定是否显示联网游戏状态；未绑定时只能显示连接中、观战、离线练习或等待同步。
- 单机 UI 也应读取 local authoritative snapshot，而不是直接读写另一份 mutable gameplay state。
- 本地 simulation 在联网模式中只能作为 prediction/interpolation cache，必须能被 authority snapshot 校正或丢弃。
- 复制状态按 contributor 分区，避免把完整 world、renderer object tree、React state 或 adapter cache 作为默认同步单位。
- EventBus 只记录多人低频事实，不广播每个网络包或每帧状态 patch。
- DevTools 中查看 payload 时要默认脱敏，尤其是 token、账号标识、IP、邀请 code 和私有房间 metadata。
