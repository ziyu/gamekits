# Multiplayer Realtime Game Demo

Status: Closed on 2026-07-11; Waves 0-7 implemented for the GameKits envelope baseline. The real Colyseus Schema Demo lane continues in `multiplayer-colyseus-native-lane.md`.

## Goal

把现有 `apps/multiplayer-demo` 从低频 loopback console 演进为一个完整、可玩的实时游戏 demo，然后在这个完整游戏闭环上逐步补全多人能力。

顺序必须明确：

1. 先做完整游戏 demo：有进入局、准备/倒计时、游玩、胜负判定、结算、重开或返回房间的完整流程。
2. 再接入多人房间：host/join/ready/start/end/rematch 都围绕同一个游戏流程，而不是网络按钮的堆叠。
3. 最后补全实时多人能力：持续输入、server/host authority、snapshot sync、插值/预测、迟到加入、离开、断线、非法输入拒绝、多房间隔离和 diagnostics。

目标不是做商业级完整游戏，而是让 demo 本身先像一个真正的小游戏：没有第二个窗口时也能理解规则、开始一局、结束一局；打开多个窗口后，多人能力是在这个游戏基础上被验证。

长期设计事实仍以以下文档为准：

- `docs/modules/multiplayer.md`
- `docs/apps/multiplayer-demo.md`
- `docs/architecture.md`
- `docs/best-practices.md`
- `docs/adr/0012-mature-multiplayer-backend-adapter.md`
- `docs/adr/0014-multiplayer-presentation-temporal-buffer.md`

本文件只记录执行规划，不作为长期协议来源。实现时若改变 app 长期体验或 package 公共 API，需要同步更新对应长期文档或补 ADR。

## Package Boundary Follow-up

早期 demo 已用 app-local host authoritative snapshot stream 修复“同 room 但各端本地独立 simulation”的问题；本轮已把这条通用同步骨架收敛到 `@gamekits/multiplayer-core` 的 authority binding、host/local authority loop 和 client receiver helper。

设计结论已经沉淀到 `docs/adr/0013-standard-authoritative-replication-boundary.md` 和 `docs/modules/multiplayer.md`：

- `connected/joined/peer count` 只能证明 room/presence/message 链路，不证明 gameplay state 已同步。
- `multiplayer-core` 已提供标准 authority binding / replication helper，覆盖 action/input/snapshot/patch/result source gate、tick boundary、input sequence、bounded action/input queue、peer/player binding、participant policy 和 diagnostics。
- Demo 保留 app-local 玩法 payload、simulation、actor/slot 应用和 presentation，但不再手写 authority binding、host loop、snapshot receiver、snapshot source gate 或通用 participant decision vocabulary。
- 离线单机/本地练习继续成立，并已走 `local` authority binding 和 in-process delivery，复用同一 action/input、simulation、snapshot/apply 和 diagnostics contract；它不再是另一套单机 gameplay runtime。
- `@gamekits/multiplayer-core` 的单元测试和 demo 的 headless Colyseus integration test 已覆盖 host authoritative action/input/snapshot、local authority、非 authority snapshot 拒绝和双 client 同步。

Provider-native state sync、seat reservation/reconnect 和 renderer-core dogfood 已迁移到独立后续工作流；本工作流不继续维护增量 backlog。

完整可用能力需要同时保留两条验证路径：

- GameKits baseline lane：使用 `multiplayer-core` authority helper 和 GameKits envelope snapshot/patch，验证跨 backend 最小 contract、离线单机复用、source gate 和 conformance。
- Colyseus native lane：使用 `@gamekits/multiplayer-colyseus` 的 provider-native bridge，例如 Schema state sync、room metadata、reconnect/seat reservation 和 provider diagnostics，验证成熟 backend 的真实能力没有被 GameKits facade 压扁。

Demo 可以先以 GameKits baseline lane 作为默认路径，但规划上必须给 native lane 留出切换、测试和诊断位置。两条 lane 不能同时写同一份 authority state；当前 room 必须声明 authoritative path。

## Demo Concept

建议玩法：`Relay Arena`。

玩家进入一个小型俯视角 arena，每个玩家控制一个单位，在地图中争夺能量球并送回己方 relay node。地图包含墙体、能量球、危险区和短冷却冲刺。这个玩法足够小，但能覆盖完整游戏 loop 和多人实时游戏的关键问题：

- 完整流程：房间/练习入口、ready、倒计时、round timer、胜负判定、结算、rematch。
- 持续方向输入：移动、冲刺、交互。
- 权威碰撞：玩家不能穿墙、不能伪造拾取距离。
- 共享目标：多个玩家争夺同一个能量球。
- 低频事实：得分、拾取、交付、拒绝、round end。
- 高频状态：位置、速度、朝向、cooldown、carry state。
- 迟到加入：新窗口能拿到当前 arena snapshot，并按房间策略进入观战或下局。

第一版完整游戏可以先支持单人练习或本地 bot，让游戏流程独立成立。多人第一版推荐支持 2-4 个 browser clients，同一机器多窗口即可验证。Host 可以继续由 dev server 托管，不需要把 host 放进某个浏览器窗口。

## Game Loop Contract

实时 demo 的基础不是 transport，而是一局完整游戏。所有多人能力都必须服务这个状态机。

建议 round lifecycle：

```txt
boot
  -> title / room setup
  -> lobby
  -> ready check
  -> countdown
  -> running
  -> ending
  -> results
  -> rematch or lobby
```

### Required Screens / States

- `title / room setup`：选择本地练习、host room、join room，输入 room id。
- `lobby`：显示玩家 slot、ready 状态、host/start 权限、当前规则。
- `countdown`：锁定参赛名单，展示 3-2-1，清空上一局 transient state。
- `running`：核心游玩状态，有 timer、score、玩家/目标/危险区。
- `ending`：冻结输入或只允许低影响输入，播放结算过渡，广播最终事实。
- `results`：显示胜负、score、关键事件、rematch/return lobby。

### Game Completion Rules

第一版必须至少有一种确定结束条件：

- 计时赛：例如 90 秒后分高者胜。
- 得分赛：先到 5 分者胜。
- 平局处理：进入短 overtime 或按最近一次交付时间决胜。

结束流程不能只是停止 tick；它需要产生可观察事实：

- final score。
- winner / draw。
- round duration。
- per-player stats，例如 delivered、stolen、rejected input count。
- event feed summary。

## Architecture Direction

### Responsibility Split

```txt
Complete game loop
  -> local playable arena
  -> browser input sampler
  -> multiplayer room lifecycle
  -> Colyseus message / GameKits multiplayer facade
  -> server-hosted fixed tick simulation
  -> authoritative arena snapshot
  -> client interpolation / prediction
  -> canvas presentation + diagnostics
```

职责边界：

- `apps/multiplayer-demo` 先拥有完整 app-local game domain：round state、rules、input、score、result、presentation。
- `multiplayer-core` 继续只提供 session、message envelope、bridge、authority 和 diagnostics，不引入 Colyseus state schema 或游戏玩法类型。
- `multiplayer-colyseus` 继续持有 Colyseus client/server/runtime；如果需要高频 state sync，应通过 backend package 的 typed native bridge 或 app-local helper 使用，不能泄漏进 core。
- GameRuntime bridge 继续用于低频 `game.command`、authority facts、event trace 和 round-level state change；高频 transform 不进入 EventBus。
- 高频玩家输入和 snapshot 需要独立于 DOM UI render loop，UI 只消费节流后的 summary。

### State Sync Choice

推荐采用混合路径：

- 高频 arena state：优先使用 Colyseus 自身 state sync 或 app-local Colyseus message stream，由 app-specific typed native path 持有。
- 低频语义事实：继续使用 GameKits `MultiplayerMessageEnvelope`，例如 `game.event`、`game.command.result`、`debug.trace`。
- Diagnostics：GameKits snapshot 展示 backend、session、peers、sent/received、rtt、snapshot age、input queue、rejected inputs。

这样能真正考验成熟 backend 的实时能力，同时保持 GameKits core 薄内核。如果后续决定把 state sync helper 做成可复用 package API，需要单独 ADR。

完整能力规划：

- 当前默认 lane 使用 GameKits envelope authoritative snapshot stream，适合跨 backend baseline、local authority 和 conformance。
- Colyseus native lane 应使用 backend package 提供的 typed bridge，把 Schema/onStateChange 或 provider state summary 映射成 GameKits authority diagnostics，而不是让 UI 直接依赖 Colyseus Room。
- 同一局只能选择一个 authority writer：`gamekits-envelope` 或 `colyseus-schema`。另一条路径只能提供低频 summary、debug comparison 或迁移验证，避免双写。
- Diagnostics 必须展示当前 lane、authority source、snapshot/schema version、last applied tick、resync state、state size 和 rejected non-authority updates。

## Gameplay Contract

### Input

客户端以固定频率发送 compact input frame：

```ts
type RealtimeInputFrame = {
  sequence: number;
  clientTime: number;
  moveX: -1 | 0 | 1;
  moveY: -1 | 0 | 1;
  sprint: boolean;
};

type RealtimeArenaAction =
  | { type: "interact" }
  | { type: "ready"; ready: boolean }
  | { type: "start" }
  | { type: "rematch" };
```

规则：

- Browser 每帧采样键盘，但以 15-30Hz 合并发送 input frame。
- Input frame 只表示可合并的 continuous movement state，不是事实；`interact` 等一次性操作走独立离散 action。
- 非 running 状态下，移动输入和 gameplay action 必须被 authority 拒绝或忽略。
- 服务端按 peer id 维护最后输入序号，丢弃重复、倒序或超频输入。
- 不信任 client timestamp，只用于诊断和延迟估算。

### Simulation

服务端或 host runtime 使用固定 tick，例如 20Hz 或 30Hz：

- 根据 round state 判断是否推进 gameplay simulation。
- 读取每个 peer 最新输入。
- 更新 velocity、position、cooldown、carry state。
- 执行墙体碰撞、拾取距离、交付距离、危险区伤害。
- 更新 round timer、score、winner、ending/results state。
- 生成 authoritative snapshot。
- 低频事件写入 EventBus 并广播语义结果。

客户端可以做 local prediction，但最终以 authoritative snapshot 校正。

### Replication

第一版 snapshot 足够小，可以按 10-20Hz 广播：

```ts
type ArenaSnapshot = {
  tick: number;
  serverTime: number;
  round: "lobby" | "countdown" | "running" | "ending" | "results";
  roundTimeMs: number;
  players: PlayerSnapshot[];
  cores: CoreSnapshot[];
  score: Record<string, number>;
  result?: RoundResultSnapshot;
};
```

客户端处理：

- 本地玩家：预测位置，并用 server ack 进行轻量校正。
- 远端玩家：snapshot buffer + interpolation。
- 迟到加入：收到完整 authoritative snapshot 后按房间策略进入观战、候补或下局。
- results 状态必须完全由 authoritative snapshot 驱动，客户端不能自行判胜。
- snapshot age、interpolation delay 和 correction magnitude 必须可见。

## UX Shape

首屏应直接服务完整游戏流程，不是说明页，也不是纯网络控制台。

推荐布局：

- 主区域：全屏或大面积 canvas arena。
- 顶部或左上角：room、peer、team、score、round timer、round state。
- lobby/results overlay：ready、start、winner、scoreboard、rematch、return lobby。
- 右上角：network diagnostics，包含 rtt、snapshot age、input seq、correction、active peers。
- 底部：小型 event feed，显示 ready、start、pickup、deliver、reject、disconnect、round end。
- 房间控制：保留紧凑的 room input、Host & Join、Join、Leave、Reset，不占用玩法区域。Host & Join 必须在创建或确认 session 后立即让当前浏览器进入该远端 authority session，避免 UI 显示已开房但主舞台仍在本地练习。

交互：

- WASD / Arrow 移动。
- Space sprint。
- E interact / pickup / deliver。
- Ready / Start / Rematch 使用明确 UI action。
- UI 文本输入聚焦时 input scope 应阻止 gameplay input。

## Validation Targets

这个 demo 达标时，应能回答以下问题：

- 单窗口本地练习或 host 模式能完整开始一局、游玩、结束、展示结果并重开。
- 两个窗口加入同一房间后，能从 lobby ready/start 进入同一局，并看到同一个倒计时和同一个结束结果。
- 两个窗口同时移动时，双方都能看到彼此连续移动，而不是按钮式状态跳变。
- 一个客户端伪造过快移动或超远拾取时，host 拒绝，host state 不被污染。
- 玩家离开后，active peer count 下降，running/results/lobby 状态有明确策略。
- 第二个 room 的 lobby、running state、score、result 与第一个 room 完全隔离。
- 迟到加入能看到当前 round state；如果 running 中不允许加入本局，应明确进入 spectator/next-round 状态。
- 断开重连后可以恢复为同一个 player slot，或明确作为新 peer 加入；行为必须稳定可见。
- 高频 state 不进入 Save payload，不进入 EventBus 全量日志，不导致 DOM 每 tick 重建。
- Diagnostics 能显示 rtt、snapshot age、input send rate、server tick rate、rejected input count。

## Implementation Waves

### Wave 0: Complete Game Domain

Status: Implemented in the app-local realtime domain.

目标：先把 Relay Arena 做成完整游戏规则模型，不接浏览器 UI，不接多人 transport。

任务：

1. 已新增 `apps/multiplayer-demo/src/realtime/domain`，定义 arena state、round state、player state、input frame、snapshot、events、result。
2. 已实现 round lifecycle：lobby、ready、countdown、running、ending、results、rematch/reset。
3. 已实现 fixed tick simulation：movement、collision、pickup、deliver、cooldown、round timer、score-limit、time-limit/draw。
4. 已实现第一批 authority validation：input schema、sequence、round state gate、duplicate/stale rejection、pickup/deliver distance。
5. 已添加 deterministic tests，覆盖完整局流程、得分结束、非法输入、墙体/边界和共享 core 争夺。

验收：

- 不启动 Colyseus 也能用测试验证一局完整游戏。
- 同样 input log 每次产生同样 final result。
- 每个 round state 的允许输入和拒绝输入都有测试。

### Wave 1: Local Playable Game Demo

Status: First local practice pass implemented.

目标：先让单窗口就是一个完整、可玩的小游戏，再考虑多人。

任务：

1. 已新增 canvas arena presentation，渲染玩家、能量球、墙体、relay node 和局内 feedback。
2. 已增加本地 practice 模式，单窗口可用本地玩家完成一局。
3. 已添加 Relay Arena 首屏、lobby、countdown、running、ending、results overlay。
4. 已添加 input scope：room input 或按钮聚焦时 gameplay input 不触发，Start/Rematch 后焦点回到 canvas。
5. 已添加 local event feed、scoreboard、round HUD、input/tick diagnostics。
6. 已移除浏览器主界面里的旧 loopback console 控件，包括 select、confirm、strategy、priority 和 Host State 面板；Room 和 diagnostics 收敛为紧凑侧栏。

验收：

- 单窗口能完整走完 start -> running -> results -> rematch。
- 页面没有 HTML 字符串拼接；交互 UI 保持 DOM API + `textContent` / `replaceChildren`。
- Canvas 更新不触发 DOM 每帧重建。

### Wave 2: Multiplayer Room Flow

Status: First pass implemented.

目标：把完整游戏流程接入多人房间 lifecycle，但仍优先保证开始/结束流程正确。

任务：

1. 已用现有 Colyseus dev server 创建 per-session realtime arena host。
2. Browser client join 后由 host 按 peer 分配 player slot，并进入同一个 authoritative lobby。
3. 已实现 ready、start、countdown lock、running、results、rematch/reset 的 host-side action path。
4. 已通过 authoritative snapshot 同步 lobby slot、ready state、round state、scoreboard 和 result。
5. 已保留严格 join 语义：`Join` 只能加入已 host 的 room，不能隐式创建；`Host & Join` 是唯一允许创建 session 的浏览器入口，且创建后立即连接当前 client。

验收：

- 两个窗口同房间能一起 ready/start，并看到同一个 countdown；单个 client 不能绕过另一个未 ready client 独自开局。
- 一局结束时两个窗口看到同一个 final result。
- Rematch 后两端回到同一局新 countdown 或 lobby。
- 不同 room 的 lobby、round 和 result 完全隔离。

### Wave 3: Realtime Authority And State Sync

Status: First pass implemented.

目标：在完整多人流程中加入持续输入、权威 tick 和 authoritative snapshot。

任务：

1. 已让 Browser client 在 connected mode 以固定频率发送 `RealtimeInputFrame`；离线练习已通过 `local` authority binding / in-process delivery 复用同一 action/input、simulation 和 snapshot contract。
2. 已让 Host 通过 `@gamekits/multiplayer-core` authority loop 在固定 tick 消费 action/input，并通过 GameKits envelope 广播 authoritative arena snapshot。
3. Running 状态外的 gameplay input 由 domain authority gate 拒绝，不再让 browser client 本地推进比赛。
4. 已添加 headless integration test：启动一个 Colyseus server、一个 host、两个 clients，验证 ready/start gate、running snapshot 和输入后的双方位置一致。
5. 已覆盖 duplicate/stale/non-running/invalid input rejection、authority 距离判定、action/input queue overflow、人工延迟和断线场景。

验收：

- 两个窗口实时移动、抢球、交付，最终结果一致。
- forged input、重复 sequence、倒序 sequence、超频输入不会污染 host state。

### Wave 4: Colyseus Native Capability Boundary

Status: Minimal package bridge implemented; real Demo Schema lane migrated to `multiplayer-colyseus-native-lane.md`. Provider-native reconnect remains explicitly unsupported.

目标：在不污染 `multiplayer-core` 的前提下，验证 Colyseus 的成熟 backend 能力，而不是只把 Colyseus 当作普通 message transport。

任务：

1. 已在 `@gamekits/multiplayer-colyseus` 实现 app-facing typed native state bridge、capability summary 和 authority diagnostics mapping。
2. 已在 package tests 覆盖 session/source endpoint/tick/version/size gate、resync、redaction 和 dispose。
3. GameKits envelope 继续作为 Demo baseline；真实 Schema authority writer、Demo lane selector、双 client 测试和 HUD provider diagnostics 进入独立工作流。

验收：

- Demo 可以证明 Colyseus Schema/state sync 与 GameKits authority binding 可以共存，并且不会把 Colyseus 类型泄漏到 `multiplayer-core` 或玩法 domain。
- GameKits baseline lane 和 Colyseus native lane 用同一玩法 action/input/snapshot/view model 验证，避免 demo 维护两套游戏。
- Diagnostics 能解释当前 authoritative path，不再让用户误以为“只要 Colyseus 连上就等于 gameplay synced”。

### Wave 5: Prediction, Interpolation, Diagnostics

Status: Implemented; temporal snapshot interpolation buffer, local prediction/correction, artificial client input latency/jitter/loss and richer diagnostics are available in the demo.

目标：让 demo 能观察真实多人手感问题，而不是只看到最终状态。

任务：

1. 已为本地玩家添加 input prediction、server correction、fixed prediction step 起点/终点之间的 render-time sampling，以及小 correction 的 render-only offset decay；renderer 不再直接消费 20Hz 或 reconcile 后的 raw predicted endpoint，也不会对已经前进完整 tick 的 endpoint 重复 extrapolate。
2. 已为远端玩家和共享对象接入 temporal snapshot interpolation buffer，并移除二维向量专用平滑 helper 作为长期入口。
3. 已添加 artificial latency/jitter/loss 开关，只影响 demo client input path。
4. 已展示 rtt、snapshot age、input seq ack、correction magnitude、input lead/server tick drift 诊断。
5. 已增加 forged stale input debug control，用于验证 authority rejection。
6. 已将 realtime movement input 明确为 continuous state：core authority loop 使用 `latest` 模式按 peer 合并尚未消费的 burst，simulation 保持最后应用的移动状态直到更新或 `250ms` timeout，ack 在 latest state 被本次 tick 采用后推进；`interact` 已从 movement frame 拆到独立 action FIFO，在 authority tick 中逐次应用，不会被状态合并覆盖。旧的等速 FIFO 方案会把 jitter 永久转化为远端延迟，已移除。
7. 已将远端固定 `100ms` interpolation delay 改为以 `50ms` 为基线、`150ms` 为上限的 adaptive jitter delay，并在 HUD 展示 current delay 和 estimated jitter；稳定网络降低远端视角延迟，抖动增大时自动扩大缓冲。
8. 已将 demo 正式 Canvas 帧循环改为 reusable presentation frame + `vector2Into` direct-write，不再每帧 materialize 完整 cloned gameplay snapshot；同时加入覆盖全部 multiplayer benchmark suite 的定时/手动粗粒度预算和 30 分钟模拟 retained heap 稳定性检查，不作为常规 PR merge gate。

验收：

- 开启人工延迟后，远端玩家通过 snapshot buffer 平滑移动，本地玩家在 prediction tick 之间连续表现；按下、持续、松开、反向和掉帧追帧都不在 tick 边界产生整步跳变。Authority 立即校正 simulation，小幅显示误差随移动 target 渐进收敛，大幅误差直接 snap。
- 稳定 snapshot cadence 下远端 delay 保持最小值；arrival jitter 增大时 delay 在上限内上升，恢复稳定后逐步下降。正式 render loop 复用 direct-write frame，便利用 `present()` 仍只服务测试、小工具和低规模调用。
- 同一 peer 的多份 movement state 在一个 authority tick 前到达时只应用最新状态；持续按住无需每 tick 排队，neutral/release 在下一 authority tick 生效，断流超过 timeout 自动停止，HUD authority queue 正常长期为 `q0`。离散 `interact` action 不被 movement burst 合并或丢失。
- Diagnostics 能解释“为什么抖动、为什么被回滚、为什么输入被拒绝”。

验证记录（2026-07-10）：

- `corepack pnpm test`：62 个 workspace task 全部通过；multiplayer core 32 tests、demo 52 tests，覆盖 adaptive jitter delay、direct-write frame 复用、fixed-step sampling、无误差 reconcile 连续性、moving-target correction、latest-per-source burst coalescing、FIFO queue overflow、movement hold/release/timeout、独立 interact action、掉帧追帧和 120Hz 十分钟模拟。
- `corepack pnpm build`、`corepack pnpm lint`、`corepack pnpm format`、`git diff --check`：全部通过。
- `corepack pnpm bench:multiplayer:check`：9 个粗粒度 budget 全部通过；本机 32 clients authority host loop 为 `0.0146 ms/tick`；32 clients、每 tick 每端 burst 4 的 latest coalescing 共接收 640000 inputs、应用 160000、合并 480000、queue peak 32，为 `0.0360 ms/tick`；120Hz prediction presentation 为 `0.1155 us/frame`，5000 tracks direct-write projection 为 `1.5169 ms/frame`。
- `corepack pnpm bench:multiplayer:stability`：60Hz / 20 snapshot TPS / 32 tracks 的 30 分钟模拟共 108000 frames；GC 后 retained heap 增长 `0.076 MiB`、peak growth `0.0842 MiB`，snapshot buffer 保持 24，prediction pending 保持 2。
- `corepack pnpm bench:world`：10k entity 场景通过，spawn/add `11.06ms`、query/update `7.32ms`；本轮 multiplayer hot-path 改动未引入 world hot-path 回归。
- 自动化已覆盖 protocol、authority、prediction 和长时序稳定性；真实浏览器双窗口的视觉手感仍需作为 browser smoke 单独确认。

### Wave 6: Multiplayer Feature Completion

Status: Implemented for the GameKits envelope lane; provider-native reconnect remains explicitly unsupported.

目标：补齐作为多人 dogfood 必须具备的真实房间行为。

任务：

1. 已实现迟到加入策略：countdown/running/ending/results 中进入 `next-round`，没有当前局 player binding，gameplay action/input 被 authority 拒绝；rematch/reset 重建 lobby 时晋升。
2. 已实现 Leave/disconnect 策略：lobby 中立即移除 actor 并释放 slot；本局开始后保留 actor/slot/统计，清空输入和速度、释放携带物，并停止 simulation movement。
3. 已实现 app-level 恢复策略：相同稳定 peer id 在下一次 lobby 前重新 join 时恢复原 player/slot，并重置连接级 input sequence/ack，避免新 client 从 sequence 1 开始时被旧连接进度误判为 stale。该策略不调用也不宣称 provider reconnect；Colyseus runtime capability 仍为 unsupported。
4. 已复用 room registry、authority loop、peer binding store 与 client receiver dispose/reset 边界；host close 和同名 session recreate 继续创建全新的 runtime/buffer/binding 生命周期。
5. 已在 authority payload、host diagnostics 和 HUD 中区分 active/tracked/round/waiting/disconnected participant，并显示当前窗口 participant 状态。
6. 已将 lifecycle decision 收敛到 `multiplayer-core` 的 `createMultiplayerParticipantPolicy()`：Demo host 内部配置 join/lateJoin/leave/disconnect/reconnect/boundary，传入 app-owned phase context 并执行 decision，不再用 Demo metadata 模拟 next-round，也不对外暴露重复配置入口。

验收：

- late join、leave、disconnect、reconnect、reset 都有 headless 测试或 browser smoke。
- active peer count、slot count 和 round participant count 不混淆。

验证记录（2026-07-10）：

- `corepack pnpm --filter multiplayer-demo test`：53 tests 全部通过；覆盖 late join next-round、waiting input rejection、running disconnect state cleanup、同 peer 原 slot 与 input sequence epoch 恢复、再次断线、rematch 清理与 next-round 晋升。
- `corepack pnpm --filter @gamekits/multiplayer-core test`：34 tests 全部通过；覆盖 `releasePeer()` 清理待处理 action/input、queue depth 和旧 sequence key，并允许恢复后的 sequence 重新从 1 开始；同时覆盖由应用上下文驱动的 join、late join、leave、disconnect、reconnect 和 round-boundary 参与者策略。
- `corepack pnpm build`、`corepack pnpm lint`、`corepack pnpm format`、`git diff --check`：全部通过。全仓 `corepack pnpm test` 完成 60/62 tasks，剩余 Colyseus/demo Turbo task 因受限环境禁止监听 `127.0.0.1` 而失败；上述两个相关 package 的定向 86 tests 已在允许本地监听的执行路径全部通过。
- `corepack pnpm bench:multiplayer:check`：9 个性能预算全部通过；本机 32 clients host loop 为 `0.0187 ms/tick`，32 clients burst 4 latest coalescing 为 `0.0423 ms/tick`。`corepack pnpm bench:world` 的 10k entity 场景为 spawn/add `11.48ms`、query/update `7.31ms`。
- 本地浏览器 smoke：host join 后 HUD 展示 `p1/1`，页面无 console warning/error，新增 participant diagnostics 未破坏首屏布局。

真实浏览器复测（2026-07-11）：

- 三个独立 browser tab 通过真实 Colyseus server 完成 host/join、ready、countdown、running、late join、running disconnect、同 tab rejoin 和 reset-to-lobby，不依赖测试夹具直接调用 host API。
- 初次复测发现 browser client 每次 Join 都生成新 peer id，导致同一窗口无法命中 app-level player/slot 恢复；现已为每个 tab 在 `sessionStorage` 保持稳定 peer id。修复后 Bob 离开时 host HUD 从 `p2/2` 变为 `p1/2`，同 tab Join 后恢复为 `Bob / orange` 和 `p2/2`，事件顺序为 `Bob disconnected`、`Bob reconnected`，新连接 input ack 从 `15->14` 正常推进。
- 初次复测还发现 player name 在填写 Room 或 Leave 回到离线练习时会被 render loop 的旧 actor 名覆盖；现已增加未提交输入 dirty gate，并让离线 mirror 跟随最后一次权威名。修复后权威事件和画面稳定显示 Alice/Bob，重连不再改回默认 `Runner`。
- Charlie 在 running 中显示 `Charlie / next-round`、`p2/2`，Ready/Interact 禁用；host 执行 Reset Arena 后进入 lobby，Charlie 晋升为正式 player，三个窗口显示 `p3/3`。最终三端 console warning/error 均为空，host 画面保持约 `120fps`。

### Wave 7: Hardening And Documentation

Status: Implemented on 2026-07-11.

目标：把实时 demo 变成可长期维护的 multiplayer dogfood。

任务：

1. 已更新长期体验、multiplayer module、最佳实践和 package README，明确 app-local realtime type 不属于 core 协议。
2. 已补完整 authoritative snapshot decoder，拒绝畸形 nested state、非有限时间、非法 axis 和 unsafe sequence。
3. 已为 core action queue 增加默认 per-source `8/tick`、`32 queued` 保护、可配置上限、overflow error 和 diagnostics。
4. 已补同名 session + 同 peer id recreate、authority distance pickup、action flood、release cleanup 和 browser smoke。
5. Hardening 提交为 `d2d3825`。

验收：

- `corepack pnpm --filter multiplayer-demo test`
- `corepack pnpm --filter multiplayer-demo build`
- `corepack pnpm --filter multiplayer-demo lint`
- `corepack pnpm test`
- `corepack pnpm build`
- `corepack pnpm lint`
- `corepack pnpm format`
- Browser smoke：单窗口完整游戏、两个窗口同房间完整一局、不同房间隔离、迟到加入、离开、非法输入拒绝。

最终验证：

- `corepack pnpm test`：62/62 workspace tasks 全部通过；core 36 tests、Demo 58 tests。
- `corepack pnpm build`、`corepack pnpm lint`、`corepack pnpm format`、`git diff --check`：全部通过。
- `corepack pnpm verify:release:gamekits`：Wave 1 tarball consumer smoke 通过。
- `corepack pnpm bench:multiplayer:check`：10 个预算全部通过，新增 action queue suite 在 32 clients 下约 `0.05 ms/tick`。
- Browser smoke：host/join、ready/start、countdown/running 正常，约 `120fps` / `20tps`，console 无 warning/error。

## Test Matrix

| Area           | Required tests                                                                                                                                                       |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Game loop      | ready, countdown, running, ending, results, rematch, reset, win, draw/overtime                                                                                       |
| Simulation     | deterministic movement, collision, pickup, deliver, cooldown, tie resolution                                                                                         |
| Authority      | duplicate sequence, backwards sequence, out-of-bounds move, forged pickup, input rejected outside running state                                                      |
| Room flow      | host, strict join, ready, start permission, rematch, room reset, room isolation                                                                                      |
| Transport      | two clients input stream, snapshot delivery, active peer cleanup, room isolate                                                                                       |
| Client runtime | interpolation buffer, prediction input-edge continuity, moving-target correction decay, render-stall catch-up, ten-minute simulated cadence, stale snapshot handling |
| Browser smoke  | single-window full game, two windows same room full round, second room isolation, input scope, HUD metrics                                                           |

## Non-Goals

- 不实现公网部署、账号、邀请、matchmaking、排行榜或 NAT traversal。
- 不承诺 rollback netcode、lockstep 或完整 world diff。
- 不把 realtime arena 的玩家、能量球、score、input frame 上推到 `multiplayer-core`。
- 不让 Save 保存 socket、Room handle、input queue、snapshot buffer 或 transient actor prediction state。
- 不把多人能力做成没有开始/结束流程的网络控制台；游戏闭环必须先成立。
- 不把这个 demo 变成 Sandbox 玩法；它仍属于 `apps/multiplayer-demo`。

## Migrated Follow-Ups

- 真实 Colyseus Schema authority lane、lane selector 和 provider diagnostics：`multiplayer-colyseus-native-lane.md`。
- Provider reconnect / seat reservation：未来 backend-specific workflow；当前公开 support level 保持 unsupported。
- Renderer-core dogfood、bot/dummy opponent、AI disconnect takeover 和其他 Demo 体验增强：未来独立 app workflow。
- 当前 baseline 固定使用 20Hz authority tick、adaptive snapshot presentation、running late join next-round 和 app-level stable-peer recovery；改变这些产品策略时另开工作流，不回写本关闭记录。
