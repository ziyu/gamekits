# Multiplayer Demo Validation

Status: Closed on 2026-07-11; backend gate and standalone Demo baseline were verified. The remaining App Host/DevTools integration pressure has moved to `multiplayer-outpost-siege-demo.md`.

## Goal

规划并验证一个独立 demo app，把 `multiplayer-core`、`multiplayer-colyseus`、GameModule bridge、host authority、client command、低频 diagnostics 和浏览器可见控制台通过真实成熟 backend 跑通。

长期设计事实以以下文档为准：

- `docs/modules/multiplayer.md`
- `docs/apps/multiplayer-demo.md`
- `docs/modules/app-host.md`
- `docs/modules/devtools.md`
- `docs/architecture.md`
- `docs/adr/0012-mature-multiplayer-backend-adapter.md`

本文件只记录 demo 工作流的执行计划、验收和验证命令，不作为长期协议来源。

## Current Baseline

`@gamekits/multiplayer-colyseus` 已经落地为 demo 的第一个成熟真实 backend gate。当前基线包含：

- root adapter `createColyseusMultiplayerBackend()`，供 app、测试夹具和 profile 创建 provider-neutral backend。
- server-only subpath `@gamekits/multiplayer-colyseus/server`，提供 `GameKitsColyseusRoom` 和 `createGameKitsColyseusServer()`。
- GameKits session id 与 Colyseus Room id 的映射，避免 app、DevTools 或 Save 依赖 Colyseus room id 格式。
- 独立 demo app 通过可输入 session id 显式创建或加入 room；`Connect Client` 只加入已由 `Host Room` 托管的 GameKits session。
- 基于真实本地 Colyseus Room 的 backend conformance，覆盖 create/join、broadcast、targeted message、leave、dispose、payload validation 和 cleanup。
- provider diagnostics redaction，避免 endpoint、token、Room/Client/socket handle 或完整 payload 进入 provider-neutral snapshot。

Demo 不再放进 `apps/sandbox`。执行游标从独立 `apps/multiplayer-demo` 开始：先用 headless harness 证明 host/client command relay，再用 Vite 控制台展示同一条真实 backend 链路。

## Demo Shape

Demo 名称：`GameKits Multiplayer Colyseus Loopback`

核心一句话：启动一个本地 Colyseus server，让 host runtime 和 browser/client facade 加入用户选中的 GameKits session；client 发送 app-local 语义 command，Colyseus Room 转发到 host authority 边界，host 在 GameRuntime tick 边界验证并应用，再把低频 result/state summary 通过 Colyseus 和 HTTP summary 暴露给 UI。

```txt
apps/multiplayer-demo
  -> local Colyseus server
  -> @gamekits/multiplayer-colyseus backend
  -> host MultiplayerRuntime
  -> GameRuntime + createMultiplayerModule()
  -> demo authority / command handler / EventBus
  -> Vite browser console + client MultiplayerRuntime
```

Memory backend 只作为 conformance、确定性测试和 fallback fixture，不作为 demo 最终跑通的唯一 backend。第一版可见 demo 必须经过 `@gamekits/multiplayer-colyseus`。

## Scope

包含：

- 独立 app：新增 `apps/multiplayer-demo`，不把 demo 接入 Sandbox。
- Colyseus backend package：消费已实现的 `@gamekits/multiplayer-colyseus` root adapter 和 `./server` helper。
- Headless 双端 harness：临时启动 local Colyseus server，host/client facade 通过 Colyseus Room 跑 create/join/send/dispose。
- Demo command relay：client command 经过 bridge 在 host tick 处理，改变 app-local demo state。
- Authority policy：host 接受合法 command，拒绝未知 kind、错误 peer、无效 payload、未知目标或越界优先级。
- Browser console：显示 backend/session/peers/message count、host state、authority timeline 和 client message log。
- Room control：输入 session id 后显式 Host/Connect/Disconnect/Reset，验证未托管 session 拒绝连接、多窗口加入同一 session 和不同 session 隔离。

不包含：

- 真实账号、邀请、好友、matchmaking、公网连接或 NAT traversal。
- 通用 rollback、lockstep 或完整 world diff。
- 把 demo command 类型上推到 `multiplayer-core`。
- 在 Renderer/Input/UI 中直接发送 backend frame。
- Colyseus backend 的生产级部署、鉴权、matchmaking 或完整 reconnect 恢复。

## Demo Contract

### Session Contract

- Host facade 先 `createSession()`，client facade 再用 GameKits session id `joinSession()`。
- Colyseus adapter 可以把 GameKits session id 映射到 provider Room id；demo 不能假设二者完全相同。
- UI 能显示 backend id、session id、phase、local peer、active peer count、sent/received count。
- UI Room 输入框控制 GameKits session id；dev server 以 `sessionId -> host runtime` 管理多个 demo room。
- `Host Room` 是唯一会创建 host runtime 的 UI action；`Connect Client` 必须先查询已托管 session，不能 fallback 成创建 room。
- Dispose 后 host runtime、room listener 和 pending command queue 不再处理新 command。

### Command Contract

Demo command 是 app-local payload，不进入 `multiplayer-core` 顶层类型：

```ts
type MultiplayerDemoCommand =
  | { type: "select"; objectId: string }
  | { type: "confirm"; objectId?: string }
  | { type: "set-strategy"; strategy: "gather" | "build" | "defend" }
  | { type: "set-priority"; objectId: string; priority: number };
```

Command envelope 使用 `kind: "game.command"`、`channel: "reliable"`，payload 中保留 `schemaVersion` 和 command body。Host command handler 只把合法 command 转换为 demo state change 和低频 EventBus fact，不直接读取 backend 私有连接。

### Authority Contract

第一版 authority policy：

- 只有 `client` role 可以发送 player command。
- Host peer 不通过 remote command 改写自身 state；本地 host control 仍走本地 app path。
- Unknown command type、schema mismatch、priority 越界、目标不存在都拒绝。
- 拒绝 command 必须进入 EventBus 和 demo timeline。

### Replication Contract

在 replication contributor registry 完整落地前，demo 只做低频 result broadcast 与 host summary：

- host command accepted 后发送 `game.command.result`，包含 command id、peer id、status 和摘要。
- browser UI 通过 client message log 展示 result，并通过 HTTP summary 读取 host state。
- client 不尝试本地完整模拟 host world。

## Implementation Waves

### Wave 0: Mature Backend Gate

Status: Completed.

已完成：

1. 新增 `packages/multiplayer-colyseus`。
2. 实现 Colyseus client adapter、Room mapping、connection snapshot 和 close/dispose cleanup。
3. 提供 server-only 本地 Colyseus server harness，用于 tests 和后续 demo integration。
4. 复用 multiplayer backend conformance 中 Colyseus 可支持的能力集合。
5. 覆盖 create/join、send、broadcast、targeted message、leave、dispose、invalid message、payload limit 和 redacted diagnostics。

已验证命令：

```bash
corepack pnpm --filter @gamekits/multiplayer-colyseus test
corepack pnpm --filter @gamekits/multiplayer-colyseus build
corepack pnpm --filter @gamekits/multiplayer-colyseus lint
corepack pnpm --filter @gamekits/multiplayer-core test
corepack pnpm --filter @gamekits/multiplayer-memory test
```

### Wave 1: Standalone Headless Harness

Status: Verified.

目标：在测试中跑通双 facade + Colyseus backend + host GameRuntime，不碰 Sandbox。

任务：

1. 新增 `apps/multiplayer-demo/src/server/create-local-demo-server.ts`。
2. 新增 `apps/multiplayer-demo/src/test/harness.ts`。
3. 启动 local Colyseus server，创建 host/client facade 并加入同一 Room。
4. 提供 `sendClientCommand()`、`tickHost()`、`snapshot()` 测试 helper。
5. 覆盖 create/join/send/accepted/rejected/dispose cleanup。

验收：

- command 发送后，host 未 tick 前不改变 demo state。
- host tick 后合法 command 进入 EventBus，并能改变可观察 state。
- 拒绝 command 不改变 state，但产生 `multiplayer.command.rejected` 事件。
- host dispose 后 client 再 send 不会触发 handler。

验证证据：

```bash
corepack pnpm --filter multiplayer-demo test
```

### Wave 2: Standalone Browser Console

Status: Verified.

目标：提供最小可见 demo，不做完整 lobby。

任务：

1. 新增 `apps/multiplayer-demo/src/server/dev-server.ts`，同时启动 Vite、Colyseus server 和 host runtime。
2. 新增 browser UI，显示 session、active peers、message count、host state、timeline 和 client messages。
3. UI button 只调用 app-local client facade，不 import backend adapter 私有类型。
4. 保持 DOM 更新通过显式 element/textContent/replaceChildren 构建。
5. Room 输入框通过 `/api/multiplayer-demo/session` 创建、查询和重置指定 GameKits session；`Connect Client` 使用查询路径，不能隐式调用创建路径。

验收：

- 页面上能看到 session 建立、client 加入、命令发送、host 应用和 result summary。
- 两个浏览器窗口输入同一个 room 后连接，active peers 应为 host + browser client 数；离线历史 peer 不计入 active peers。
- 不同 room 的 command 和 host state 彼此隔离。
- UI 不使用 HTML 字符串拼接。
- Browser client 经过 Colyseus backend 加入真实 Room，不走 memory/direct dispatch。

验证证据：

```bash
corepack pnpm --filter multiplayer-demo build
corepack pnpm --filter multiplayer-demo lint
corepack pnpm dev:multiplayer
```

浏览器冒烟：

- 初始页面显示 `Backend colyseus`、默认 Room `multiplayer-demo-session`、`Peers 0`。
- 输入未托管 Room 并点击 `Connect Client` 后显示未托管错误，active peer count 不增加。
- 点击 `Host Room` 后 session 建立，active peer count 变为 1。
- 点击 `Connect Client` 后 active peer count 变为 2，并收到 `peer.presence`。
- 第二个窗口输入同一个 Room 并点击 `Connect Client` 后 active peer count 变为 3。
- 输入不同 Room 并点击 `Host Room` 后创建隔离 session，新 room 的 active peer count 从 1 开始。
- 点击 `Confirm Target` 后 host state `Confirms` 变为 1，timeline 出现 accepted/result，client 收到 `game.command.result`。
- 点击 `P99` 后 `Rejected` 变为 1，Relay Alpha 仍保持 `P2`。

### Wave 3: App Host / DevTools Follow-up

Status: Migrated to `multiplayer-outpost-siege-demo.md`; not implemented in this workflow.

目标：在独立 demo app 中补 App Host standard multiplayer service 和 DevTools source dogfood。

任务：

1. 用 App Host service registry 托管 multiplayer facade lifecycle。
2. 将现有 host runtime helper 收敛为 app-local profile/service factory。
3. 让 DevTools standard source 展示 multiplayer summary。
4. 保留 headless Colyseus harness 作为回归测试。

## Package Coverage Matrix

| Package                          | Demo 覆盖点                                                                                           |
| -------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `@gamekits/multiplayer-core`     | facade phase、message envelope、subscribe cleanup、authority decision、GameModule bridge、snapshot    |
| `@gamekits/multiplayer-colyseus` | root adapter、server helper、Room mapping、broadcast/targeted routing、cleanup、diagnostics redaction |
| `@gamekits/game-runtime`         | tick boundary、stop/dispose 后不执行                                                                  |
| `@gamekits/event-bus`            | command accepted/rejected/result 低频事实                                                             |
| `apps/multiplayer-demo`          | app-local command、authority、handler、browser console 和 local Colyseus dev server                   |

## Test Plan

已完成 backend baseline：

```bash
corepack pnpm --filter @gamekits/multiplayer-colyseus test
corepack pnpm --filter @gamekits/multiplayer-colyseus build
corepack pnpm --filter @gamekits/multiplayer-colyseus lint
corepack pnpm --filter @gamekits/multiplayer-core test
corepack pnpm --filter @gamekits/multiplayer-memory test
```

Demo 局部测试：

```bash
corepack pnpm --filter multiplayer-demo test
corepack pnpm --filter multiplayer-demo build
corepack pnpm --filter multiplayer-demo lint
```

浏览器验证：

```bash
corepack pnpm dev:multiplayer
```

浏览器验收时至少检查：

- Vite 页面正常 boot。
- Colyseus local server 正常接受连接。
- Host Room 后创建指定 GameKits session。
- Connect Client 后 active peer count 增加，且消息计数来自 Colyseus backend。
- 多窗口连接同一个 room 与连接不同 room 的结果符合隔离预期。
- Confirm / Priority / Strategy command 后 timeline 和 host state 都能看到结果。
- Priority `99` 被拒绝，state 不被改写。

完整门禁：

```bash
corepack pnpm test
corepack pnpm build
corepack pnpm lint
corepack pnpm format
git diff --check
```

## Risks

- 单进程内同时有 host runtime、browser client 和 Colyseus server，cleanup 必须由 demo server 统一管理。
- 本地 Colyseus server 会引入端口、异步时序和 cleanup 问题；测试必须使用临时端口并强制 dispose。
- 为了 demo 快速可见而让 UI 直接调用 backend 会污染边界；UI 只能走 app-local client facade。
- Snapshot/DevTools 展示完整 payload 容易泄漏不可信数据；第一版只展示 summary。
- 过早做完整 world replication 会把 demo state 和 core 协议绑死；先做 command relay 和低频 summary。
