# Multiplayer Colyseus Native Lane

Status: Closed

## Goal

在不让 Colyseus SDK 类型进入 `multiplayer-core` 或玩法 domain 的前提下，让 `apps/multiplayer-demo` 真实使用 Colyseus Schema state sync 作为可选 authoritative path，并与现有 `gamekits-envelope` baseline 使用同一 app-local `RealtimeArenaSnapshotPayload` 和 presentation pipeline。

## Scope

1. 为 Demo session 声明唯一 authoritative path：`gamekits-envelope` 或 `colyseus-schema`，禁止双写 gameplay state。
2. 在 server-owned Colyseus Room state 中维护可版本化 Schema authority state，由 host simulation 作为唯一 writer。
3. 在 `@gamekits/multiplayer-colyseus` typed native bridge 中把 Schema update 映射为 app-local view model，不向 gameplay、DataType、Save 或 core API 暴露 Room/Schema instance。
4. Client receiver 对 session、source endpoint、tick/version、size、stale update 和 resync 执行与 baseline 等价的 gate。
5. Demo HUD 展示 authoritative path、schema version/state version、state size、update/patch count 和 resync reason。
6. Headless tests 覆盖双 client ready/start/input/result、非 authority update、room isolation、host close 和同名 session recreate buffer cleanup。
7. Browser smoke 对比两条 lane 的完整一局、远端 interpolation、本地 prediction 和 diagnostics。

## Non-Goals

- 本工作流不实现生产 reconnect/seat reservation、matchmaking、账号或公网部署。
- 不把 Relay Arena payload、Colyseus Schema class 或 provider room handle 上推到 `multiplayer-core`。
- 不允许 envelope 与 Schema 同时写入客户端 authority state。

## Validation

```bash
corepack pnpm --filter @gamekits/multiplayer-colyseus test
corepack pnpm --filter multiplayer-demo test
corepack pnpm --filter multiplayer-demo build
corepack pnpm bench:multiplayer:check
corepack pnpm test
corepack pnpm build
corepack pnpm lint
corepack pnpm format
```

需要分别对 `gamekits-envelope` 和 `colyseus-schema` 运行真实双窗口 browser smoke，并确认 console、HUD 和 authority diagnostics 能解释当前路径。

## Result

- Demo session 现在显式选择 `gamekits-envelope` 或 `colyseus-schema`，两条 lane 复用同一 app-local snapshot、prediction 和 presentation pipeline，不双写 authoritative gameplay state。
- `multiplayer-core` authority loop 支持可选 provider snapshot publisher，同时保留 tick/capture/diagnostics/error contract。
- `@gamekits/multiplayer-colyseus` 提供真实 Schema room state、host-only publisher、typed subscription/bridge、provider state version 排序、重复 callback 去重、source/session/size/stale gate 和 diagnostics。
- Demo dev server 可通过 `MULTIPLAYER_DEMO_AUTHORITY_PATH=colyseus-schema` 启动 native lane，并把 path 传给所有 hosted session 和 browser client；HUD 展示 lane、schema/state version、bytes、applied/rejected/resync。
- 真实 Colyseus server 双客户端测试覆盖 ready/start/input、同 view model、client 非法写入拒绝和 envelope snapshot 未双写。

## Verification Evidence

- `@gamekits/multiplayer-core`: 37 tests passed。
- `@gamekits/multiplayer-colyseus`: 9 tests passed，包含真实 Schema room、authority writer 和非法 writer/version 拒绝。
- `multiplayer-demo`: 59 tests passed，包含双客户端 Schema ready/start/input/view-model 等价链路。
- 全仓 test 62/62 tasks、build 34/34 tasks、lint 62/62 tasks、format check 全部通过。
- `bench:multiplayer:check` 10/10 budgets 通过；32 clients action queue 为约 `0.069ms/tick`，32 clients latest-input coalescing 为约 `0.098ms/tick`。
- 双浏览器 Schema smoke 进入同一 `running` round；两边 presentation 为 120fps，provider state version 持续推进，约 3.3KB/state，applied 持续增长，rejected/resync 均为 0，console 无错误。
