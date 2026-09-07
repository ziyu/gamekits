# Multiplayer First Usable Version

Status: Closed on 2026-07-11

## Goal

把 Multiplayer 从“demo 能跑通”推进到第一个可被下游 app 认真 dogfood 的可用版本。这里的可用不是生产级在线服务，也不是完整账号、好友、匹配或公网部署；它指的是 GameKits multiplayer package 能稳定提供一条跨 backend 的 authority / replication baseline，并能通过 Colyseus 证明真实成熟 backend 没有被压成伪 transport。

长期设计事实以以下文档为准：

- `docs/modules/multiplayer.md`
- `docs/apps/multiplayer-demo.md`
- `docs/architecture.md`
- `docs/best-practices.md`
- `docs/adr/0010-multiplayer-core-and-backend-adapters.md`
- `docs/adr/0012-mature-multiplayer-backend-adapter.md`
- `docs/adr/0013-standard-authoritative-replication-boundary.md`

本文件只记录第一个可用版本的缺口、任务拆分和验收门禁，不作为长期协议来源。若执行过程中改变公共 API、包边界或长期实践，必须同步更新对应长期文档或新增 ADR。

## Definition Of Usable

第一个可用版本必须同时满足：

- `@gamekits/multiplayer-core` 提供可复用的 authority binding、host/local authority loop、client receiver/source gate、peer/player binding 和 diagnostics contract。
- `@gamekits/multiplayer-memory` 继续作为 deterministic conformance backend，验证 core baseline，而不是生产 backend。
- `@gamekits/multiplayer-colyseus` 通过真实本地 Colyseus server 验证 session mapping、message routing、host-authoritative lifecycle、provider diagnostics 和至少一条 provider-native capability bridge。
- `apps/multiplayer-demo` 证明双 client 共享同一份 authoritative game state；UI 不能只靠 peer count 或 joined 状态判断多人已跑通。
- Offline/local practice 复用同一套 action/input、tick、snapshot/apply 和 diagnostics contract，只把 delivery 换成本地 authority endpoint。
- 文档、测试和 release smoke 能让下游 app 按公开入口接入，而不是复制 demo 私有代码。

第一个可用版本不承诺：

- 生产账号、鉴权、邀请、好友、匹配队列、排行榜、商店、平台成就或公网部署。
- 完整 rollback、lockstep、MMO server、NAT traversal 或跨区域服务编排。
- 所有 provider native 能力的一次性统一抽象。

## Current Baseline

当前已经具备的基础：

- `@gamekits/multiplayer-core` 已有 runtime、session/peer/message envelope、GameModule bridge、authority binding store、host authority loop、local authority loop、client authority receiver 和基础 backend conformance。
- `@gamekits/multiplayer-memory` 已有 in-process backend，用于 create/join/leave/message/dispose conformance 和确定性测试。
- `@gamekits/multiplayer-colyseus` 已有 Colyseus root adapter、server-only helper、指定 GameKits session join、payload size gate、endpoint redaction、host-authoritative host leave close、native capability summary 和 native state bridge 雏形。
- `apps/multiplayer-demo` 已有独立 realtime game demo、lobby/countdown/running/results/rematch 流程、双 client authoritative snapshot 测试、player name 去重、host/client/local 状态权限和离开/host close 生命周期测试。

这些能力已经通过包级 conformance、统一 diagnostics、peer/player binding、最小 provider-native bridge、明确 reconnect support level、App Host 装配和发布消费验证，构成第一个可供下游 dogfood 的 multiplayer baseline。

## P0 Gates

### 1. Authority / Replication Conformance

Status: Implemented

目标：把“不是伪多人”变成 package-level 硬门禁，而不是 demo 私有测试。

必须覆盖：

- 双 client 加入同一 session 后，ready/start/input/snapshot 来自同一份 authority state。
- 非绑定 authority source 的 snapshot / patch / result 被拒绝，并进入 diagnostics。
- local authority 与 host/server authority 使用同一 input/action log 时得到等价稳定 snapshot。
- duplicate、stale 和 out-of-session input 被拒绝。
- client leave 后 peer/player mapping、input queue 和 snapshot receiver 不继续保留该玩家。
- host-authoritative room 的 host close 会关闭 authority binding，并让 late join 失败或进入明确的新 session。
- 不同 session 的 lifecycle、input、snapshot 和 result 完全隔离。

验收命令至少包含：

```bash
corepack pnpm --filter @gamekits/multiplayer-core test
corepack pnpm --filter @gamekits/multiplayer-memory test
corepack pnpm --filter @gamekits/multiplayer-colyseus test
corepack pnpm --filter multiplayer-demo test
```

2026-07-08 实现进度：

- `@gamekits/multiplayer-core` 新增可复用 authority conformance runner，覆盖 host-authoritative action/input/snapshot/patch/result、非 authority snapshot/patch/result source gate、duplicate input rejection、local authority 等价快照、session isolation 和 client leave cleanup。
- `@gamekits/multiplayer-memory` 和 `@gamekits/multiplayer-colyseus` 都已接入同一条 authority conformance runner。
- 已验证局部命令：

```bash
corepack pnpm --filter @gamekits/multiplayer-core test
corepack pnpm --filter @gamekits/multiplayer-memory test
corepack pnpm --filter @gamekits/multiplayer-colyseus test
corepack pnpm --filter multiplayer-demo test
```

关闭结论：baseline 对 session mismatch、authority source mismatch 和 disposed lifecycle 提供稳定拒绝语义；新增 backend 若有 provider-specific out-of-session 状态，继续由对应 adapter conformance 收口，不阻塞本工作流。

### 2. Unified Authority Diagnostics

Status: Implemented

目标：让 UI、DevTools 和测试都从同一份 provider-neutral snapshot 读取 authority 状态，避免各自拼 `peer count`、`phase` 或 app-local 字段。

必须进入统一 diagnostics 的信息：

- authority binding status、mode、authority endpoint、authority peer、local player。
- active authoritative path，例如 `local-loop`、`gamekits-envelope`、`colyseus-schema` 或 app-defined lane。
- last applied tick、snapshot/schema version、snapshot age、resync state。
- rejected source、rejected payload kind、rejected reason。
- input sequence / accepted / rejected counters。
- current session close / leave / reconnect reason 的脱敏 summary。

验收：

- demo UI 只基于 authority binding 和 authoritative snapshot 决定联网 gameplay state。
- DevTools source 可以展示同样的 authority summary。
- diagnostics 不包含 Room、Client、socket、token、secret、完整高频 payload 或 Colyseus Schema instance。

2026-07-08 实现进度：

- `@gamekits/multiplayer-core` 新增 `createMultiplayerAuthorityDiagnostics()`，把 authority binding、authoritative path、loop counters、receiver counters、last rejected、snapshot age 和 redacted connection summary 组合为 provider-neutral summary。
- diagnostics 覆盖 snapshot、patch 和 result receiver counters，不暴露 Room、Client、socket、token、secret 或完整 payload。
- core 单元测试覆盖 summary clone、resync、last rejected、connection summary 和 counters。

### 3. Peer / Player Binding Utility

Status: Implemented

目标：把 `peer.id`、`playerId`、slot、spectator、left/disconnected、late join 和 next-round participant 的映射工具收敛到 core baseline，避免每个 app 复制 demo 私有逻辑。

必须覆盖：

- peer 加入时分配或恢复 player binding。
- player display name 清洗和同 session 去重可以由 app policy 注入。
- client leave / disconnect 后可以按 policy 移除 actor、保留 slot、转 spectator 或等待 reconnect。
- host close / room reset 会关闭 binding，旧 input queue 和 snapshot buffer 不能跨 binding 复用。
- late join 行为可声明为 spectator、next round 或 rejected。

验收：

- demo 的 player name、leave cleanup 和 host close 行为 dogfood core utility 或 core conformance fixture。
- 测试不能只断言 peer count，必须断言 player actor / slot / snapshot 结果。

2026-07-08 实现进度：

- `@gamekits/multiplayer-core` 新增 `createMultiplayerPeerPlayerBindingStore()`、`normalizeMultiplayerDisplayName()` 和 `createUniqueMultiplayerDisplayName()`。
- store 支持 peer 到 player binding、display name 清洗和去重、slot/role/metadata、spectator、next-round、left/disconnected、remove 和 close。
- `createMultiplayerParticipantPolicy()` 统一 join/lateJoin/leave/disconnect/reconnect/boundary decision；支持静态规则或 app-context callback，core 不依赖具体游戏 phase。
- core 单元测试覆盖默认/重复名字、leave cleanup、恢复 player binding、spectator 和 close 后拒绝新 binding。

### 4. Colyseus Provider-Native Lane

Status: Implemented As Minimal Native Lane

目标：证明 Colyseus 没有被压成普通 message transport；至少一条 provider-native capability 通过受控 bridge 接入 GameKits authority diagnostics。

最小可用范围：

- `@gamekits/multiplayer-colyseus` 提供可测试的 Colyseus Schema 或 provider state sync authority bridge。
- bridge 输出 app-local view model 或 provider-neutral summary，UI 和 gameplay domain 不直接依赖 Colyseus Room、Client 或 Schema instance。
- authority path selection 明确声明当前 room 使用 `gamekits-envelope` 还是 `colyseus-schema`。
- 非当前 authority path 只能作为 diagnostics、summary 或 debug comparison，不能双写 authority state。
- provider-native state update 经过 session/source endpoint/tick/version/size gate 和 resync diagnostics。

验收：

- Colyseus package 测试覆盖 native state source gate、resync、room isolation、redaction 和 dispose cleanup。
- demo 或 fixture 至少能切到 native lane 并输出与 GameKits baseline lane 同形的 app-local view model。

2026-07-08 实现进度：

- `@gamekits/multiplayer-colyseus` 已提供 native capability summary 和 `createColyseusNativeStateBridge()`。
- Colyseus package 测试覆盖 native lane declaration、endpoint redaction、native state source/session gate、tick/version/size/age diagnostics 和 binding update。
- 当前最小 native lane 通过 package fixture 证明 provider-native state 可以映射成 app-local view model；Demo 级真实 Schema lane 已迁移到 `multiplayer-colyseus-native-lane.md`，不属于本 baseline 的关闭门禁。

### 5. Reconnect Semantics

Status: Implemented As Unsupported

目标：消除半暴露的 reconnect API 风险。第一个可用版本可以不实现完整生产 reconnect，但必须有明确语义和 diagnostics。

可接受路径二选一：

- 实现 Colyseus seat reservation / reconnect summary，支持在限定时间内恢复 peer/player binding，并清理旧 receiver/input buffer。
- 或明确标记 reconnect unsupported：core runtime、adapter capabilities、README 和 diagnostics 都一致说明不支持，调用时返回稳定错误码。

验收：

- `reconnect()` 不再处于 API 可见但语义不可用的含糊状态。
- reconnect 失败、过期、host close 后重连、同名 session recreate 都有测试或明确文档限制。

2026-07-08 实现进度：

- `createMultiplayerRuntime().reconnect()` 改为稳定抛出 `MULTIPLAYER_UNSUPPORTED_CAPABILITY`，details 包含 `backendId` 和 `capability: "reconnect"`。
- Colyseus capabilities 当前声明 `reconnect: false`。
- `@gamekits/multiplayer-core` 和 `@gamekits/multiplayer-colyseus` README 均说明第一个可用版本不实现 reconnect，host close / 同名 session recreate 必须按显式 lifecycle 处理。

## P1 Gates

### 6. App Host Standard Integration

Status: Implemented

目标：下游 app 不需要复制 demo 的手动装配方式，也能把 MultiplayerFacade 作为 App Service，把 Multiplayer bridge 作为 GameModule helper 安装。

必须提供：

- App Host profile/service recipe。
- 标准 GameModule bridge 配置入口。
- offline/local profile 的 authority endpoint 装配方式。
- dispose、stop、session leave 与 runtime cleanup 的顺序说明。

验收：

- App Host 测试覆盖 multiplayer service dispose、GameModule bridge subscription cleanup 和 DevTools source snapshot。
- README 中给出最小 host/client/offline 接入示例。

2026-07-08 实现进度：

- `@gamekits/app-host` 已有 optional standard multiplayer service，dispose 默认释放 `MultiplayerRuntime`。
- `profile.standard.game.standardModules.multiplayer` 已有标准 GameModule bridge 配置入口。
- App Host 测试已覆盖 optional multiplayer service、DevTools source snapshot 和 memory backend command bridge。
- `@gamekits/multiplayer-core` README 增加 App Host standard service / GameModule bridge 配方。

### 7. Public Documentation

Status: Implemented

目标：文档能指导下游消费 package，而不是只描述内部设计。

必须补齐：

- `@gamekits/multiplayer-core` README：action/input/snapshot/result contract、authority binding、local authority、host authority、receiver、conformance。
- `@gamekits/multiplayer-memory` README：用途是 conformance/test fixture，不是生产 backend。
- `@gamekits/multiplayer-colyseus` README：root/server subpath、session mapping、host-authoritative lifecycle、native lane、reconnect support level、redaction。
- demo README 或 app doc：如何启动、如何开两个窗口验证、如何判断 authority state 正确同步。

验收：

- 文档中明确禁止用 peer count / joined 状态证明 gameplay 已同步。
- 文档中明确 offline/local practice 也走同一 authority contract。

2026-07-08 实现进度：

- 新增 `packages/multiplayer-core/README.md`，覆盖 runtime、authority binding、host/local authority、receiver、peer/player binding、diagnostics、App Host integration 和 conformance。
- 新增 `packages/multiplayer-memory/README.md`，明确 memory backend 只用于 conformance/test fixture，不是生产 backend。
- 更新 `packages/multiplayer-colyseus/README.md`，补充 reconnect unsupported 支持等级。
- `docs/apps/multiplayer-demo.md` 继续作为 demo app 长期文档，说明不能以 peer count / joined 状态证明 gameplay 同步，offline/local practice 也走同一 authority contract。

### 8. Release Consumer Smoke

Status: Covered By Wave 1 Release Verify

目标：验证 multiplayer packages 离开 workspace alias 后能被真实 consumer 使用。

必须覆盖：

- 外部临时 consumer 安装 core、memory、colyseus tarball。
- Node ESM import root entry。
- Vite/browser import `@gamekits/multiplayer-colyseus` root entry。
- Node/server import `@gamekits/multiplayer-colyseus/server` subpath。
- 类型声明、exports、dependencies、sideEffects 和 files 白名单正确。

验收命令：

```bash
corepack pnpm verify:release:gamekits
```

若 release verify 暂不覆盖这些包，需要先补对应 package wave 或专用 smoke fixture。

2026-07-08 实现进度：

- `scripts/verify-gamekits-release.ts` 的 Wave 1 package set 已包含 `multiplayer-core`、`multiplayer-memory` 和 `multiplayer-colyseus`。
- Wave 1 smoke 已覆盖 Node ESM import `@gamekits/multiplayer-core`、`@gamekits/multiplayer-memory`、`@gamekits/multiplayer-colyseus` root entry，以及 `@gamekits/multiplayer-colyseus/server` subpath。
- 已验证 `corepack pnpm verify:release:gamekits`，wave 1 tarball consumer smoke 通过。

## Execution Order

实际按以下顺序完成：

1. P0.1 authority / replication conformance。
2. P0.2 unified authority diagnostics。
3. P0.3 peer / player binding utility。
4. P0.5 reconnect support level 定义。
5. P1.6 App Host standard integration recipe。
6. P0.4 Colyseus provider-native lane。
7. P1.7 public docs。
8. P1.8 release consumer smoke。

该顺序先锁住“不会再出现伪多人”的底层门禁，再补成熟 backend 能力和发布消费体验。

## Validation Policy

每个 P0 gate 完成时至少运行相关包局部测试、相关 demo 测试、`corepack pnpm format` 和 `git diff --check`。第一个可用版本关闭前必须运行：

```bash
corepack pnpm test
corepack pnpm build
corepack pnpm lint
corepack pnpm format
```

涉及 release smoke 时还需要运行：

```bash
corepack pnpm verify:release:gamekits
```

若实现 provider-native realtime state 或 world/adapter 高频同步，再补对应 benchmark 或 profiling 证据。

## Closure Record

关闭日期：2026-07-11。

最终提交：

- `c2b4371`：建立 multiplayer usable baseline。
- `cf78f3f`：完成 prediction、reconciliation 和 input pacing。
- `7d88257`：完成 participant lifecycle、late join、disconnect/rejoin 和 peer release。
- `d2d3825`：完成 action queue 底层保护、完整 snapshot decoder 和 hardening tests。

最终验证：

- `corepack pnpm test`：62/62 workspace tasks 全部通过，包括真实本地 Colyseus server 和 Demo integration tests。
- `corepack pnpm build`、`corepack pnpm lint`、`corepack pnpm format`、`git diff --check`：全部通过。
- `corepack pnpm verify:release:gamekits`：外部临时 consumer 安装 Wave 1 tarball，Node/Vite/server subpath 和 test-utils smoke 全部通过。
- `corepack pnpm bench:multiplayer:check`：10 个性能预算全部通过；32 clients、每端每 tick 2 个 action 的 bounded queue 为约 `0.05 ms/tick`。
- Browser smoke：真实 host/join、ready/start、countdown/running 和 HUD diagnostics 正常，约 `120fps` / `20tps`，无 console warning/error 或布局重叠。

稳定结论已迁移到 `docs/modules/multiplayer.md`、`docs/best-practices.md`、package README 和 ADR 0013/0014。真实 Colyseus Schema Demo lane、provider reconnect/seat reservation 和 renderer-core dogfood 已迁移到独立后续工作流。
