# Multiplayer Package Planning

Status: Active

## Goal

规划并落地统一 Multiplayer package 体系，让 GameKits 可以通过成熟多人 backend 支持本地测试、Colyseus Room 和未来托管/平台 backend，同时保持 core facade、App Host service、GameModule bridge 和 backend adapter 的边界清晰。

长期设计事实以以下文档为准：

- `docs/modules/multiplayer.md`
- `docs/architecture.md`
- `docs/adr/0010-multiplayer-core-and-backend-adapters.md`
- `docs/adr/0012-mature-multiplayer-backend-adapter.md`
- `docs/adr/0013-standard-authoritative-replication-boundary.md`

## Scope

包含：

- 收窄 `@gamekits/multiplayer-core` 为 GameKits 侧 facade、adapter 接口、authority 类型、semantic command envelope、diagnostics 和 GameModule bridge helper。
- 新增 memory backend，用作 conformance test、headless 多 client 夹具和本地 loopback fixture。
- 新增 Colyseus backend adapter，作为首个成熟真实 multiplayer backend 和 demo gate。
- 为成熟 backend 补 provider-native capability bridge 规划，让 Colyseus Schema、reconnect、matchmaking、room metadata 和 provider diagnostics 能被显式使用，而不是被 GameKits envelope 抹平。
- 接入 App Host optional standard service 和标准 GameModule helper。
- 提供 DevTools source / diagnostics 的稳定事实。
- 设计多人命令、状态复制 contributor、Save 边界和 payload redaction。

不包含：

- 完整账号系统、好友、邀请 UI、排行榜、商店、平台成就或社交图谱。
- 生产级托管 backend adapter 的一次性全量实现。
- 通用 rollback netcode engine 或 MMO server。
- 把 Sandbox 玩法规则上推为 Multiplayer 协议。
- 自研通用 room server、matchmaker、reconnect engine、presence store、state sync engine 或 production WebSocket server。
- 在 `multiplayer-core` 中暴露 Colyseus、Nakama、Steam、EOS 或其他 provider SDK 类型。

## Current Implementation

2026-06-30 已落地首轮 headless 闭环：

- `packages/multiplayer-core`：session、peer、message envelope、backend adapter、runtime、错误码、snapshot、backend conformance runner 和轻量 GameModule bridge。
- `packages/multiplayer-memory`：in-process backend，覆盖 create / join / leave / targeted message / broadcast / dispose。
- release verify Wave 1 已纳入 `multiplayer-core` 和 `multiplayer-memory`，并增加最小 memory multiplayer smoke。

已验证：

```bash
corepack pnpm --filter @gamekits/multiplayer-core test
corepack pnpm --filter @gamekits/multiplayer-memory test
corepack pnpm --filter @gamekits/multiplayer-memory... build
corepack pnpm --filter @gamekits/multiplayer-core lint
corepack pnpm --filter @gamekits/multiplayer-memory lint
```

2026-07-01 已继续落地 App Host 组合层：

- `@gamekits/app-host` 增加 optional standard multiplayer service，暴露 `services.multiplayer`，Host dispose 默认释放 MultiplayerRuntime。
- `profile.standard.game.standardModules.multiplayer` 增加标准 GameModule helper，从 multiplayer service 或显式 runtime 安装 command bridge。
- DevTools standard preset 增加 `multiplayer` data source kind/source 和标准 Multiplayer panel metadata。
- headless/configured host 测试覆盖 optional multiplayer service、DevTools source snapshot、memory backend 双 runtime command bridge、stop 后不 tick、dispose 后订阅释放。

已验证：

```bash
corepack pnpm --filter @gamekits/app-host test
corepack pnpm --filter @gamekits/devtools test
corepack pnpm --filter @gamekits/devtools build
corepack pnpm --filter @gamekits/multiplayer-core build
corepack pnpm --filter @gamekits/app-host build
corepack pnpm --filter @gamekits/app-host lint
corepack pnpm --filter @gamekits/devtools lint
corepack pnpm --filter @gamekits/multiplayer-core lint
corepack pnpm test
corepack pnpm build
corepack pnpm lint
corepack pnpm format
git diff --check
```

2026-07-07 已补第一版标准 authority / replication helper，并让 `apps/multiplayer-demo` dogfood：

- `@gamekits/multiplayer-core` 增加 authority binding store、host authoritative loop、local authority loop、client receiver/source gate 和 action/input/snapshot 默认 kind。
- Demo remote room 使用 core host loop 消费 action/input 并广播 authoritative snapshot；Browser client 使用 core receiver 拒绝非 authority snapshot。
- Offline/local practice 使用 `local` authority loop 和 in-process delivery，复用同一 action/input、tick、snapshot contract。
- Headless Colyseus integration test 覆盖两个 client 同 room 的 ready/start/input/snapshot 同步，以及非 authority snapshot 不被应用。

下一步规划重点不是继续扩大 core，而是把“完整可用 multiplayer”拆成两层：

- Core baseline：跨 backend 的最小可用 contract，防止伪多人，保证 local/host/server authority、source gate、diagnostics 和 conformance。
- Provider-native capability bridge：在 `@gamekits/multiplayer-colyseus` 等 backend package 中显式接入 Schema state sync、reconnect、matchmaking、room metadata、provider diagnostics 和 typed native server/runtime path。

2026-07-07 已补 `@gamekits/multiplayer-colyseus` native capability bridge 第一片：

- Root adapter 创建函数返回 typed `ColyseusMultiplayerBackendAdapter`，`native()` 暴露 typed native bridge，同时仍可作为 core `MultiplayerBackendAdapter` 消费。
- `nativeCapabilities` 进入 backend capabilities/snapshot metadata 和 server room metadata summary，声明当前 authoritative path、可用 lanes、state sync、reconnect、matchmaking 和 room metadata。
- 新增 `createColyseusNativeStateBridge()`，用于把 provider-native state update 映射到 GameKits authority binding diagnostics，覆盖 session/source endpoint gate、tick/version、state size、resync 和 rejected update。
- Colyseus package 测试覆盖 native capability summary 不泄漏 Room/Client，以及 provider-native state update 的 source gate 和 diagnostics。

首个可用 multiplayer 版本的剩余 P0/P1 缺口、验收门禁和关闭要求记录在 `docs/implementation/multiplayer-first-usable-version.md`。本文件继续维护 package 体系规划，不重复维护同一份任务清单。

## Implementation Waves

2026-07-01 调整：可见 demo 的最终验收必须经过成熟真实 backend。`@gamekits/multiplayer-memory` 继续负责 conformance 和确定性夹具，下一步重点改为 `@gamekits/multiplayer-colyseus`。GameKits 不继续扩展自研 WebSocket backend 或通用 multiplayer runtime；只用 memory backend 的 demo 不算完整跑通 package 体系。

### Wave 1: Core Protocol And Tests

目标：建立不依赖任何外部网络 SDK 的 GameKits 侧窄 facade，并避免它继续膨胀成自研多人 runtime。

计划内容：

1. 新增 `packages/multiplayer-core`。
2. 定义 session summary、peer summary、semantic message envelope、channel capability、authority、backend adapter、facade、snapshot 和 error code。
3. 拆分文件：公共类型、runtime 创建函数、adapter conformance helper、diagnostics、GameModule bridge 类型。
4. 增加 core 单元测试，覆盖 envelope validation、authority decision、runtime phase、subscribe cleanup 和 diagnostics snapshot。
5. 在 `src/index.ts` 只 re-export 公共入口。

验收：

- `@gamekits/multiplayer-core` 不依赖具体 backend SDK、DOM/Node socket、Colyseus、Nakama 或 provider 类型。
- 公共 payload 类型可序列化，并能带 schema version、tick、peer 和 correlation id。
- core 不拥有 room server、matchmaker、reconnect engine、presence store 或 state sync engine。
- `corepack pnpm test --filter @gamekits/multiplayer-core` 通过。

### Wave 2: Memory Backend And Conformance

目标：用 in-process test backend 固定 GameKits facade/bridge 行为契约。

计划内容：

1. 新增 `packages/multiplayer-memory`。
2. 实现 create/join/leave、peer presence、message routing、disconnect、dispose 和 deterministic ordering。
3. 抽出 backend conformance helper，供 memory、Colyseus 和未来 provider backend 复用。
4. 增加多 client headless 测试，验证同一 session 内 command broadcast、targeted message 和 peer status。

验收：

- memory backend 通过 multiplayer backend conformance，但只作为测试替身。
- 测试能在同一进程创建多个 client runtime 并稳定复现消息顺序。
- dispose 后不保留 listener、session 或 pending message。

### Wave 3: App Host And GameModule Bridge

目标：把连接 lifecycle 和 gameplay lifecycle 分开接入。

计划内容：

1. 在 App Host profile 中增加 optional multiplayer standard service。
2. 增加标准 Multiplayer GameModule helper，接收 runtime、authority policy 和 command handler。
3. 让 bridge 在 tick 边界处理入站 command queue，并在 GameRuntime dispose 时清理订阅。
4. 为 headless host 增加两个 runtime 通过 memory backend 同步命令的集成测试。

验收：

- App Host 负责 boot/start/stop/dispose MultiplayerFacade。
- GameRuntime 不保存 backend connection。
- stop 后不处理新 tick command；dispose 后订阅释放。

### Wave 4: Colyseus Backend Adapter

目标：提供第一个成熟真实 multiplayer backend adapter，并作为 Sandbox demo gate。

计划内容：

1. 新增 `packages/multiplayer-colyseus`。
2. 实现 Colyseus client adapter，把 Room join/leave/send/onMessage/onStateChange/onLeave 映射到 GameKits facade。
3. 提供本地 Colyseus server harness，用于 tests、headless smoke 和 Sandbox dev。
4. 提供 Tiny Camp demo Room，负责 room/presence/message/state summary，不把 Sandbox gameplay 类型上推到 core。
5. 复用 backend conformance，增加断线、reconnect summary、invalid message、leave/dispose 和 server cleanup 测试。

验收：

- Colyseus adapter 通过核心 conformance 中可支持的能力集合。
- core 包不会因为安装 Colyseus adapter 而反向依赖 Colyseus、DOM、Node socket 或 server framework 类型。
- 本地 Colyseus server/client smoke 可以完成 create-or-join、send、leave 和 close。
- 至少一条 demo command 可以证明通过 Colyseus Room 送达 host/server authority 边界。

### Wave 5: Standard Authority Baseline And Provider-Native Bridges

目标：让完整可用能力既有跨 backend 的标准 contract，也能发挥 Colyseus 等成熟 backend 的原生能力。

计划内容：

1. 补齐 core baseline helper：patch/result receiver、resync 状态、snapshot version gate、payload size/redaction hook、peer/player binding utility 和更完整 conformance。
2. 明确 authority path selection：同一局中 GameKits envelope snapshot stream、provider-native Schema state sync、lockstep 或 rollback 只能有一个 authority state writer；其他路径只能作为 diagnostics、summary 或 migration bridge。
3. 在 `@gamekits/multiplayer-colyseus` 增加 provider-native bridge 规划和实现入口，例如 Colyseus Schema authority bridge、room metadata summary、provider reconnect/seat reservation summary 和 server-native runtime bridge。
4. 为 Colyseus native bridge 增加测试：Schema/state source gate、state resync、room isolation、leave/disconnect cleanup、reconnect summary、redaction 和 dispose。
5. 在 demo 中增加一条可切换同步 lane：继续保留 GameKits envelope snapshot stream，同时增加 Colyseus Schema 或 typed provider state sync dogfood，用同一玩法 contract 比较两条路径。
6. DevTools/diagnostics 标记当前 authoritative path：`local-loop`、`gamekits-envelope`、`colyseus-schema`、`provider-native` 或 app-defined strategy。

验收：

- `multiplayer-core` 仍不依赖 Colyseus/Nakama/provider SDK，但能表达 authority binding、tick/version、source gate、resync 和 diagnostics。
- `@gamekits/multiplayer-colyseus` 能显式暴露 provider-native 能力，而不是只作为 message transport 使用。
- Demo 或测试能证明 Colyseus native state sync 与 GameKits authority binding 不冲突：客户端只应用绑定 authority source，room reset/reconnect 后旧 buffer 不复用。
- Provider-native bridge 的 payload、Room/Client/Schema/native handle 不进入 Save、DataType、可复用 GameModule 或 core facade。

### Wave 6: Replication Contributors And Save Boundary

目标：建立可扩展的 GameKits 层 summary/contributor 策略，而不是把 provider state sync 或 world diff 固化进 core。

计划内容：

1. 实现 replication contributor registry。
2. 支持 summary snapshot 和可选 patch 的 capture/apply hooks。
3. 提供 world/entity mapping 的 helper 类型，但不依赖 Koota 私有结构。
4. 定义 Save 可恢复 metadata 与 live connection 的禁止边界。
5. 增加 redaction policy，供 diagnostics 和 DevTools 展示 payload summary。

验收：

- contributor 可以分区 capture/apply 或映射 provider state summary。
- Save 相关测试不保存 socket、room handle、secret token 或 SDK object。
- diagnostics 默认只展示 summary 和 redacted payload。

### Wave 7: DevTools And Example Integration

目标：让多人链路可解释，并用验证 app 证明边界可用。

计划内容：

1. 增加 Multiplayer DevTools source，展示 session、peers、phase、latency summary、message counts、command decisions 和 reconnect diagnostics。
2. 在 Sandbox 中验证 Colyseus backend 两客户端命令链路，并保留 memory backend headless 对照。
3. 为真实 app dogfood 选择一个窄场景，例如 co-op command relay 或观战 snapshot。
4. 补充 release smoke，确保新增 package 离开 workspace 后可被 Node ESM / Vite 消费。

验收：

- DevTools 不展示未脱敏 secret 或完整高频 payload。
- 验证 app 不直接 import backend SDK 到 gameplay module。
- `corepack pnpm test`、`corepack pnpm build`、`corepack pnpm lint`、`corepack pnpm format` 通过。

## Open Decisions

- Colyseus server harness 是否作为 `@gamekits/multiplayer-colyseus/server` 子入口，还是放在 app-specific server project。
- Command schema 校验优先使用 DataTypeDefinition、轻量自定义 validator，还是交给 app 注入第三方 schema adapter。
- Rollback 是否长期保留在 multiplayer-core 的最小 hook 内，还是单独形成 `@gamekits/multiplayer-rollback` toolkit。

## Validation Commands

提交相关实现前至少运行：

```bash
corepack pnpm test
corepack pnpm build
corepack pnpm lint
corepack pnpm format
```

涉及 world replication 或高频 patch 时，额外运行：

```bash
corepack pnpm bench:world
```
