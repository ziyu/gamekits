# Multiplayer Demo 应用设计

## 定位

Multiplayer Demo 是 `@gamekits/multiplayer-core` 与 `@gamekits/multiplayer-colyseus` 的独立实时游戏验证应用。它用本地 Colyseus server、host GameRuntime、client facade 和可玩的浏览器 arena 验证真实 backend 路径，不依赖 Sandbox 玩法，也不把 demo 玩法类型固化成核心协议。

它的目标是展示多人模块在完整游戏流程中的组合边界：App/server 层创建连接和可命名 GameKits session，游戏本体有 lobby、ready、countdown、running、results 和 rematch 的完整闭环，host authority 决定输入和命令是否接受，UI 只消费 authoritative snapshot、session、peer、message 和低频 diagnostics。

## 体验结构

- 主体验是可玩的俯视角实时 arena，而不是纯网络控制台；玩家能从 room/lobby 进入一局、游玩、结束、查看结果并 rematch。
- 游戏主舞台占据首屏主要面积；Room 控制、网络 diagnostics、event feed 和 client messages 只能作为紧凑侧栏或辅助区域存在，不能挤压或打断主舞台操作。
- Room 控制区允许输入 GameKits session id 和 player name，并显式执行 `Host & Join`、`Join`、`Leave` 和 `Reset`；`Host & Join` 只能创建当前窗口拥有的 server-side room，或取回同一窗口已经拥有的 host session，成功后必须立即把当前浏览器作为 client 加入，host/join lifecycle 不由 gameplay input 隐式触发。
- Browser UI 必须显式显示当前窗口身份：`local offline`、`host`、`client`、`host / not joined` 或 `not joined`。按钮权限必须从这个身份派生，不能只根据是否有 session id 或 peer count 判断。
- `host / not joined` 再次 Join 必须恢复当前窗口的 host 控制身份；不能因为它通过 browser client facade 重新连入，就把原 host 降级成普通 client。
- Browser 窗口必须在当前 tab 的 session lifecycle 内持有稳定 peer id；同一窗口 Leave 后再次 Join 复用该 id，使 authority 能恢复本局 player/slot 和新的 input sequence epoch。页面刷新可以继续复用该 tab id，但不能把一个窗口的 peer id 共享给其他窗口。
- Player name 是 lobby / arena authoritative state 的一部分；client 可以提交期望名字，但 host authority 必须清洗并去重最终显示名，默认名字也不能在同一 session 内重复。用户尚未提交的输入不能因为 render loop 或离线 actor 同步而在失焦时被覆盖；Leave 后短暂回到离线练习时，离线 mirror 必须沿用最后一次权威玩家名，不能污染下一次 Join。
- Lobby / results overlay 展示玩家名字、slot、ready 状态、start 权限、countdown、winner、scoreboard、rematch 和 return lobby。
- Running 视图展示玩家名字、目标物、relay node、危险区、score、round timer、本地/远端 player state、上下文玩法提示和显式 `Interact [E]` / `Deliver [E]` 快捷动作；按钮和 `E` 键都必须进入同一离散 action contract，不能绕过 host authority，也不能混入会合并的 movement state。
- Diagnostics 面板展示 Colyseus backend、GameKits session、active/tracked peer count、active/tracked/round/waiting/disconnected participant count、sent/received、rtt、snapshot age、input sequence、server tick、presentation FPS、adaptive interpolation delay、estimated snapshot jitter、accepted/rejected input 和 authority event feed。
- 旧 loopback console 的 select / confirm / strategy / priority 控件不属于长期 realtime game demo 体验；这些低频 command 验证只能保留在测试夹具或后台 bridge 验证中，不能成为浏览器主界面。
- 本地 dev server 同时启动 Vite UI、Colyseus server，并按 session id 管理 host GameRuntime / arena lifecycle；浏览器 client 通过 Colyseus 加入选中的 GameKits session。

## 本地验证方式

本地启动：

```bash
corepack pnpm --filter multiplayer-demo dev
```

用真实 Colyseus Schema state sync 运行同一个 Demo：

```bash
MULTIPLAYER_DEMO_AUTHORITY_PATH=colyseus-schema corepack pnpm --filter multiplayer-demo dev
```

dev server 在每个 session 创建时固定 authoritative path，并通过 session response 交给 browser client；浏览器不自行选择或双写同步路径。Backend 标签和 arena diagnostics 会显示当前 lane、Schema version、provider state version、状态大小、applied/rejected update 与 resync 次数。

基础多人验证：

- 打开两个浏览器窗口，输入同一个 GameKits session id。
- 第一个窗口执行 `Host & Join`，第二个窗口只执行 `Join`。
- 两边设置不同 player name，并确认 authoritative snapshot 中显示的最终名字已经由 host 去重。
- Host 执行 ready/start，client 只能执行 ready/input/interact，不能 Host、Reset Room、Start Round 或 Rematch。
- Running 阶段移动和交互后，两边 arena 必须渲染同一份 host authoritative snapshot；不能只以 peer count、joined 状态或按钮亮灭判断多人已同步。
- client 在 lobby 执行 Leave 后，host authoritative snapshot 必须立即移除该 player actor 并释放 slot；running/ending/results 中断线则保留本局 actor 和统计、清空输入并释放携带物，直到同稳定 peer 恢复或下一次 lobby 重建。host close 后，client 必须离开 session，late join 必须失败或进入明确的新 session lifecycle。

离线验证：

- 没有 hosted/active session 上下文时，浏览器可以进入 `local offline`。
- `local offline` 必须复用同一套 action/input、round lifecycle、simulation、snapshot rendering 和 diagnostics contract，只把 authority endpoint 换成 in-process local loop。

## 模块协作

- `apps/multiplayer-demo/src/server` 持有本地 Colyseus server，以及 `sessionId -> host runtime / arena room` lifecycle。
- Browser client 通过 `@gamekits/multiplayer-colyseus` root adapter 创建 `MultiplayerRuntime`，不 import server-only helper。
- Realtime gameplay domain 是 app-local 规则模型，负责 round lifecycle、input frame、simulation、score 和 result，不进入 `multiplayer-core`。
- 联网模式下由 server-side realtime host 持有唯一 authoritative arena state；browser client 只发送 action/input，并只渲染 host snapshot。离线练习模式也应使用同一玩法 domain 和同一 authority/replication contract，只是 authority endpoint 是 in-process local loop，而不是 Colyseus host。
- Browser UI 一旦拿到 hosted room 上下文但当前 client 尚未进入该 session，主舞台必须显示未加入状态并禁用 ready/start/rematch/reset arena 等玩法按钮；只有完全没有 hosted/active session 上下文时，才进入离线练习。
- `client` 身份只能执行 Join/Leave 和 ready/input 这类玩家动作，不能再点击 Host、Reset Room、Start Round、Rematch 或 Reset Arena。`host` 身份才能 start/rematch/reset round 和 reset room。`local offline` 只操作本地 authority，不触碰远端 room lifecycle。
- 普通 Browser client 执行 `Leave` 只关闭自己的 client connection；它不能 reset server-side room，也不能影响其他 client 或 host authority。
- Host 执行 `Close Host` / `Reset` 必须关闭 demo server registry 中对应的 server-side host runtime 和 host-authoritative Colyseus room；已连接 client 必须观察到 session 结束，late join 必须失败，之后同名 GameKits session 可以由新的 host runtime 重新创建。
- Browser client 在 lobby 离开房间时，server-side host 必须从 authoritative arena state 中移除对应 player actor；本局已经开始后离线时，host 保留 actor/slot/统计但标记为 disconnected，停止接受该玩家输入并释放携带物。相同稳定 peer id 在下一次 lobby 前重新加入时恢复原 player/slot；没有 player 的 late join participant 进入 next-round，不能向当前局提交 gameplay input。下一次 rematch/reset 重建 lobby 时移除仍断线的 actor，并把仍在线的 next-round participant 晋升为正式玩家。
- 上述恢复是 demo authority 根据稳定 peer id 执行的 app-level player binding 恢复，不等于 provider reconnect 或 seat reservation。只要 `@gamekits/multiplayer-colyseus` 仍声明 `reconnect: false`，runtime `reconnect()` 就必须继续返回 unsupported；不能用 demo 行为虚报 backend capability。
- Demo 可以拥有 app-local payload、规则、peer/player 映射和 presentation，但 authority binding、host/local authority loop、snapshot source gate 和通用 replication diagnostics 应 dogfood `multiplayer-core` 的标准 helper；demo 不应维护一套平行的多人同步框架。
- Host GameRuntime 安装 `createMultiplayerModule()`，在 tick 边界处理低频 command、authority fact 和 trace；高频位置、速度、snapshot buffer 不进入 EventBus。旧的 `createMultiplayerBridgeModule()` 只作为兼容别名保留。
- 远端玩家和共享对象的平滑表现遵循 `docs/adr/0014-multiplayer-presentation-temporal-buffer.md`：使用 temporal snapshot buffer、bounded adaptive jitter delay、类型化插值原语和 demo-owned track projection；正式 Canvas 帧循环通过 reusable presentation frame 和 direct-write getter 写入复用目标，不为每帧 materialize 完整 cloned gameplay snapshot。插值后的 presented state 不写回 authoritative arena state。
- 高频 arena state 可以通过 GameKits envelope snapshot stream 或 provider-native state sync lane 同步；无论选择哪条 lane，都必须使用 authority binding 约束 tick/version、source gate、resync 和 local authority。GameKits envelope 继续承载低频语义事实和 diagnostics。
- Movement input 是按 peer 复制的 continuous state：host 在 tick 前只保留最新状态并持续应用，直到 neutral/release 或默认 `250ms` timeout；`Interact [E]` 等一次性动作走独立 action FIFO，每份 action 只消费一次，不会被 movement coalescing 覆盖。HUD 展示 authority queued/peak/coalesced，网络 burst 只能增加 coalesced 计数，不能形成历史输入 backlog。
- 完整多人能力验证应保留两个同步 lane：`gamekits-envelope` 作为跨 backend baseline，`colyseus-schema` 或其他 provider-native lane 用来验证成熟 backend 原生 state sync、reconnect、room metadata 和 provider diagnostics。两条 lane 必须输出同一种 app-local view model，UI 和 gameplay domain 不直接依赖 Colyseus Room、Schema 或 Client。
- 每个 room 必须声明当前 authoritative path；GameKits envelope snapshot stream 与 Colyseus native state sync 不能同时写同一份 authority state。非当前 authority path 只能作为 diagnostics、summary 或 debug comparison。
- UI 通过 app-local client facade 发送 input / ready / start / rematch 等 action，并消费 authoritative snapshot；UI 不直接读取 Colyseus Room、Client 或 socket handle。

## 约束

- Demo 玩法类型、input frame、arena snapshot、score 和 result 保持 app-local 类型，不能进入 `multiplayer-core` 顶层 API。
- UI 中的 Room 是 GameKits session id，不是 Colyseus room type；Colyseus room id 映射仍由 adapter 负责。
- `Join Room` 不能隐式创建 session；用户输入不存在的 session id 时必须显示未托管错误，避免把 join 和 host lifecycle 混在一起。
- `Host & Join` 可以创建不存在的 session，但不能抢占其他窗口已经托管的同名 session；冲突时必须提示使用 `Join` 作为 client 进入。成功后当前浏览器必须进入同一个远端 authoritative session，不能停留在本地练习模式。
- Host close、client leave、同名 session recreate 是三条不同 lifecycle；demo e2e 必须分别覆盖，不能只用 peer count 或按钮状态间接证明。
- Colyseus server helper 只出现在 server/dev harness 和测试夹具中，不能进入 browser UI 的公共边界。
- Host authority 必须把 remote input / command payload 当作不可信输入，先 decode/schema check、round state gate 和 authority validation，再应用到 demo state。
- Host authority 负责 player name 的最终归一化和去重；Browser UI 只能把输入框里的名字当作期望值，不能绕过 snapshot 自行断定最终显示名。
- Browser UI 不能把 active peer count 当成 arena 已同步的证明；必须基于 authority binding 和 host snapshot 决定联网 gameplay state。
- UI 不能从 peer presence 猜测 player/slot。`participantsByPeerId` 和 `participantSummary` 由 authority snapshot 声明 active、next-round、disconnected 与 round participant 状态；active peer、tracked participant 和 round actor 是不同计数。
- Browser UI 不能根据 backend lane 分叉 gameplay 规则；无论使用 `gamekits-envelope` 还是 provider-native state sync，都必须经过同一 round lifecycle、input/action contract、authority diagnostics 和 snapshot/view-model rendering。
- Offline / local practice 不能成为另一套玩法实现；它必须和多人模式共享 action、input、simulation、round lifecycle、snapshot rendering 和 diagnostics，只把 delivery 从 remote backend 换成本地 in-process authority。
- 一局游戏必须有明确开始和结束流程；多人能力不能退化成没有游戏闭环的按钮式网络控制台。
- 高频 realtime state 不进入 Save payload，不进入 EventBus 全量日志，不驱动 DOM 每 tick 重建。
- Live connection、Room handle、message queue、input queue、snapshot buffer 和 peer presence 不作为可保存 gameplay state。
- Multiplayer Demo 可以验证 multiplayer package 的真实 backend 链路，但不承诺生产 matchmaking、账号、邀请、NAT traversal 或公网部署。
