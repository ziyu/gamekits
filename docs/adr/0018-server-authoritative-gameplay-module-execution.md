# ADR 0018: Server-authoritative Gameplay Module Execution

Status: Accepted on 2026-07-12.

## Context

Outpost Siege 的目标从复杂 Multiplayer 验证扩展为 GameKits 全框架综合验证。它需要同时使用 World、Physics、TCA、GAS、Save、Renderer、UI 和 Multiplayer，并在四人合作战斗中保持明确的权威边界。

如果 server 与 browser 各自运行完整 combat、TCA 和 GAS 规则，再尝试通过网络合并结果，会出现多份事实源、Physics 分歧、Effect 重复应用、TCA rule 重复触发和 Save/replication 状态不一致。反过来，如果把 gameplay state 全部做成 Colyseus Schema 或 adapter 私有状态，又会绕过 GameRuntime、World、TCA/GAS、Physics 和 Save 的既有边界。

还需要保证离线 deterministic fixture、server integration test 和正式 Colyseus Room 不维护三套规则实现。

## Decision

Outpost Siege 的在线玩法采用单一 server-authoritative gameplay runtime：

- 每个 Colyseus Room 持有一个 headless App Host 和一个 authority GameRuntime。
- Authority GameRuntime 中的 World 是在线 gameplay state 的唯一事实源。
- Physics、TCA、GAS、AI、combat、objective、spawn/despawn、RNG 和 checkpoint capture 只在 authority runtime 决定正式结果。
- Browser 发送归一化 continuous input 和 discrete action，只维护 authority shadow、声明过的本地 movement prediction、远端 presentation tracks、render state 和低频 UI view model。
- Browser 不重新运行 TCA/GAS 来决定 damage、cost、cooldown、effect、drop、objective 或 death 是否成立。

Authority tick 使用受约束顺序：

```txt
multiplayer ingress
  -> input intent and AI
  -> physics sync / fixed step
  -> contact and query facts
  -> combat validation / GAS
  -> TCA reactions and lifecycle
  -> save dirty state / replication projection
  -> provider commit / ack
  -> diagnostics
```

GameRuntime 继续只保证 system registration order，不新增框架级全局 phase catalog。Outpost app 通过 GameModule 安装顺序和测试固定自己的 pipeline。Multiplayer authority helper 只约束 ingress 与 commit；Physics、GAS、TCA 和 app systems 仍由各自模块拥有。

同一组 app-owned gameplay modules、DataPack 和 deterministic simulation contract 同时用于：

- 正式 Room-owned server authority。
- in-process local authority fixture。
- headless deterministic、save/restore 和 benchmark test。

测试可以替换 Platform、Renderer、SaveStore、PhysicsQueries 或 Multiplayer transport，但不能替换成第二套 gameplay reducer。

复制边界保持为派生投影：

```txt
authority World / GAS / objective state
  -> app-owned replication projection
  -> provider state
  -> client authoritative shadow
  -> prediction / presentation
```

TCA compiled rules、GAS internal runtime、Physics backend handle、AI internal state、Save payload 和完整 server trace 不进入复制协议。客户端只接收用户体验需要的 entity state、attributes、公开 tags/effects/cooldowns、match facts、command results 和可去重 cue facts。

Save checkpoint 捕获 authority gameplay state，但不保存 provider Room、socket、peer handle、reconnect token、input/action queue、Schema collection 或 client presentation state。Restore 完成后由 server/session 层重新绑定 participant 和复制通道。

## Consequences

Positive consequences：

- World、Physics、TCA、GAS、Save 和 Multiplayer 拥有单一、可解释的事实链。
- 客户端数量不会导致 TCA rule、Effect 或 Physics result 重复执行。
- Headless fixture、正式 server 和 save/restore test 可以共享 gameplay modules。
- Prediction、Cue、Renderer 和 UI 明确属于表现，不会反向污染 authority state。
- DevTools 可以用 correlation id 连接 input、network、Physics、TCA/GAS、World、replication 和 presentation。

Costs and constraints：

- Client 必须实现 authority shadow、prediction/reconciliation 和 presentation projection，不能直接读取 server runtime。
- TCA/GAS/Physics/World 状态需要显式 replication view 和 Save contributor，不能序列化内部对象图。
- Server DevTools 与 client DevTools 拥有不同可见范围；完整 authority trace 默认不能直接传给所有客户端。
- 需要用 integration test 固定 GameModule/system 顺序，并验证 provider commit 发生在完整 gameplay tick 之后。

## Rejected Alternatives

### Browser lockstep or peer-authoritative combat

Rejected because current Multiplayer and Physics contracts do not promise rollback/lockstep determinism，且 party leader 生命周期不应拥有 authority simulation。

### Run full TCA/GAS combat independently on every client

Rejected because it creates multiple gameplay fact sources and makes effect、cooldown、drop、objective and save state diverge under latency or reconnect。

### Store gameplay directly in Colyseus Schema

Rejected because provider state is replication infrastructure，not the World、TCA/GAS、Physics or Save runtime。Schema remains an app-owned projection of authority state。

### Build a second simplified combat reducer for tests or offline mode

Rejected because it would stop the comprehensive Demo from validating the same module composition used by the real server。
