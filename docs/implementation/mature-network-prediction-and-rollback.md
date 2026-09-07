# Mature Network Prediction and Rollback

Status: Closed

## 目标与边界

把 ADR 0048 定义的托管 prediction domain 与回滚契约落到公共 API、真实应用和验证工具中，使普通游戏通过标准
descriptor/模块接入输入预测、事件生命周期预测和多实体回滚，不在 app 中重写 generation、timeline、spawn
matching、authority handoff、history 或副作用调度。

本工作流不自研网络 transport、room server、Physics solver 或完整 ECS，也不要求所有联网对象进入回滚。

## 任务

| 任务                                       | 状态     | 验收                                                                                                     |
| ------------------------------------------ | -------- | -------------------------------------------------------------------------------------------------------- |
| P1：托管 event/predicted lifecycle domain  | Verified | Core 公共 API 覆盖 generation、timeline、spawn、binding、expiry、reset、dispose；Outpost 弹丸迁移        |
| P2：旧 Multiplayer Demo 迁移               | Verified | 默认路径不再显式调用低层 `predict/reconcile/present`                                                     |
| P3：托管 predicted-entity + Physics island | Verified | 真实 app 通过标准 domain 连接 authority membership、spawn、checkpoint、restore/replay 和 hard correction |
| P4：Rollback contributor 与 effect journal | Verified | World/Physics/RNG contributor 和 speculative effect confirm/cancel/replace 具备契约测试                  |
| P5：Typed replication schema/codegen       | Verified | 两个真实应用共用 schema compiler 生成 decoder/identity/ack/presentation binding，不引入运行时深反射      |
| P6：成熟度验收                             | Verified | 网络故障矩阵、确定性 hash、history/heap/replay 预算、断线/重绑和真实双应用验证通过                       |

## P1 实现顺序

1. 在 Multiplayer Core 新增 managed predicted lifecycle domain，组合已有 registry 和 authority timeline，但保留低层
   helper 兼容入口。
2. 为 register/match/reject/expire、authority removal、generation reset、容量和 dispose 添加契约测试。
3. 迁移 Outpost kinematic projectile，删除 app-owned correlation/binding/expiry/timeline 编排。
4. 运行 Multiplayer Core、Outpost combat feedback、projectile benchmark、build、lint 和 format。

## Review 与验证记录

- GitNexus 初始影响分析：`createMultiplayerPredictedSpawnRegistry` 为 HIGH risk，5 个直接调用方、2 条受影响流程、
  4 个模块；因此 P1 新增兼容托管层，不修改低层 registry contract。
- P1 review：Outpost 删除 app-owned authority timeline、predicted correlation map、authority binding map、expiry 和
  prune loop；游戏继续拥有 Physics query scene、内容定义和最终 projectile sample。
- P1 验证：Multiplayer Core 66 tests、Outpost 76 tests、全仓 91/91 test tasks、49/49 build tasks、任务相关
  lint 0 warning/error、全仓 format 通过；`bench:projectile-prediction:check` 18 budgets passed，managed lifecycle
  100,000 次 register/sync/match 为 22.17 µs/op，binding/local identity 均保持硬上限 1。
- P2 review：旧 Multiplayer Demo 的默认客户端路径改由 `createMultiplayerClientReplication(...)` 托管 snapshot
  source、fixed-step input、prediction/reconciliation 和 presentation；人工 latency/jitter/loss 只保留为 input
  delivery adapter，不再驱动第二套 prediction loop。验证为 9 files / 60 tests 与 production build 通过。
- P3 review：Physics island 新增事务式 `hardCorrect(...)`；App Host 标准 domain 组合 predicted lifecycle、member
  matching、reconcile 与 history/membership/generation fallback，Projectile Lab 删除 app-owned spawn registry 和手写
  match loop。首次匹配的 member definition 从 managed prediction payload 复用，未知 authority member 仍通过 typed
  resolver 注入。
- P3 验证：Physics Core、App Host 与 Projectile Lab 关键用例 13/13 通过，全仓 49/49 build tasks 通过；
  `bench:projectile-prediction:check` 19 budgets passed，20 轮完整岛 authority hard correction 失败 0 次，rollback +
  hard correction 最新 p95 约 39.3 ms，dispose retained state 为 0。
- P4 review：Multiplayer Core 新增有界 speculative effect journal，覆盖 replay duplicate、confirm/cancel/replace、
  authority-before-prediction、capacity/expiry、generation reset、hook failure isolation 和 dispose；Outpost 本地步枪
  anticipation 已用该 journal 替换私有 pending/settlement 状态机。新增跨模块 rollback coordinator，统一同 tick
  contributor capture/validate/ordered restore、checkpoint/history bytes、combined state hash 和 future history drop；
  seeded RNG 已支持精确 stream state capture/restore 并提供标准 contributor。World 新增可选 `CheckpointGameWorld`
  capability 与显式 component/entity scope controller，Koota adapter 保留稳定 public entity id；App Host 提供 World
  100 / RNG 150 / Physics 200 标准 contributor。基础 `GameWorld` 不增加必选方法，避免影响既有 76 个上游符号。
- P4 验证：真实 integration 在同 tick 捕获 World + RNG + memory Physics，删除 player 并创建 transient entity 后恢复，
  再执行同一输入；重放 tick 2 的组合 hash、gameplay counter 和 physics position 与原执行一致，未来 history 被删除。
  World/Koota 5 tests、Multiplayer Core 72 tests、App Host 41 tests 与相关 package build 通过。
  `bench:checkpoint:check` 12 budgets passed；1,000 entity 跨域 checkpoint 为 442,626 bytes，21 个 retained checkpoint
  为 9,295,146 bytes，本机 capture/hash 约 17.89 ms，restore + rebuild tick 约 7.97 ms。
- P5 review：新增 typed replication schema compiler，把 app-owned payload decoder 与 schema version/tick/time、local
  identity、ack、authority state 和 generation-aware presentation field binding 组合成 managed client binding；不做
  runtime decorator scan、深对象反射或 provider serializer。Managed client replication 兼容低层 callback，并可直接
  消费 schema 生成的 decoder/buffer/state/ack/tracks。
- P5 验证：Multiplayer Demo 删除重复 snapshot buffer/local state/ack callback，Outpost 删除相同 callback 以及手写
  player/actor/projectile position/facing track 循环，两个应用共用 schema 协议。Schema 契约覆盖 version mismatch、非法
  tick、decoder exception、duplicate field、identity/generation key 和 presentation projection；Core 74 tests、Demo
  60 tests、Outpost 76 tests 与两个 production build 通过。
- P6 故障矩阵：真实 Multiplayer Demo client 覆盖非 authority snapshot、schema version mismatch、12 个 authority
  snapshot 丢失周期、8 input prediction lead 上限、ack 后恢复和迟到 stale snapshot；Core 既有契约同时覆盖 provider
  update duplicate/order、binding/session reset、peer disconnect queue release、participant reconnect policy、history
  overflow → Physics hard correction、generation reset 和 dispose cleanup。Provider seat-reservation reconnect 仍由
  Colyseus native capability 拥有，不伪装成 Core 自研 reconnect engine。
- P6 确定性与性能：World + RNG + Physics 同 tick 重放得到相同 64-bit combined hash、gameplay counter 与 transform。
  `bench:checkpoint:check` 12 budgets passed；1,000 entity checkpoint 442,626 bytes，21 个 retained checkpoint
  9,295,146 bytes，最新 capture/hash 约 18.68 ms、restore + rebuild tick 约 8.32 ms。
  `bench:projectile-prediction:check` 19 budgets passed，24-member/120-tick/30-tick rollback p95 约 40.13 ms，20 次
  hard correction 失败 0、dispose retained 0；`bench:multiplayer:check` 13 budgets 与 Room bridge 6 budgets passed。
  30 分钟模拟稳定性 retained heap 增长约 0.076 MiB、buffer 24、pending input 2，passed。
- P6 全仓门禁：49/49 test package tasks、49/49 build tasks、91/91 lint tasks、1,409 files format check 通过；
  仅保留未触碰的 Multiplayer bounded queue 1 条与 AI test 2 条既有 lint warning。World benchmark 10,000 entities
  spawn/add 14.37 ms，5,000 moving query/update 5.62 ms。
- P6 真实应用 smoke：Multiplayer Demo 成功 Host & Join，显示 input/ack、snapshot、presentation FPS 和 queue
  diagnostics；Outpost 成功创建 private fireteam，两个页面 console error 均为 0。既有 Rapier 初始化 deprecated
  warning 不属于本工作流。
- 最终 GitNexus 复核：增量索引后 38 个文件、155 个变更符号、24 条受影响流程，风险 critical。高风险来自
  Multiplayer Demo、Outpost、Projectile Lab 默认运行路径与 client replication 公共边界的真实迁移；基础
  `GameWorld` 未增加必选 API，Koota checkpoint 通过可选 capability 接入。上述全仓、真实应用、故障矩阵和性能验证
  覆盖受影响路径。

## 关闭记录

P1–P6 均已 Verified。本工作流形成的长期结论已迁移到 `project-design.md`、`architecture.md`、
`modules/world.md`、`modules/multiplayer.md`、`modules/physics.md`、`best-practices.md` 和 ADR 0048。GameKits 达成的
成熟度边界是“选择性预测 + 统一托管协议”：普通输入预测、事件起点对象、Physics predicted entity、多域 checkpoint
和 speculative effect 都有标准 owner；app 只声明内容、domain state scope、typed payload mapping、确定性策略和最终
writer。完整确定性引擎、provider wire serializer、seat-reservation reconnect 和 interest management 保持明确 adapter /
backend 边界，不作为本工作流遗留 TODO。

- 本轮总验证：全仓 91/91 test tasks、49/49 build tasks、91/91 lint tasks 与 format check 通过；聚焦预测/回滚
  11 files / 88 tests 通过，新增 rollback coordinator + RNG 7 tests 通过。全仓 lint 保留未触碰文件中的 3 个既有
  warning（Multiplayer bounded queue 1、AI test 2），本次变更文件为 0 warning/error。World benchmark 10,000 entities
  的 spawn/add 约 11.62 ms、5,000 moving query/update 约 5.29 ms；projectile benchmark 19 budgets passed。
- 最终 GitNexus 复核：23 个已跟踪代码文件、97 个变更符号、19 条受影响执行流程，风险为 critical；高风险来自
  Multiplayer Demo、Outpost 和 Projectile Lab 默认运行流程的真实迁移，已由上述全仓 test/build 和三条应用集成
  测试覆盖。未修改底层 registry/timeline 兼容 contract。
- 本地浏览器 smoke：Multiplayer Demo 成功 Host & Join 并显示 managed prediction diagnostics；Outpost 成功创建
  fireteam；Projectile Combat Field 实际发射 Rook Physics Round 后显示 `MATCHED`、`ISLAND CONFIRMED · 7T`、
  147 replay ticks、2 rigid contacts 和 `NO KNOWN-BLOCKER PENETRATION`。控制台无 error，仅有既有 Rapier 初始化
  deprecated-parameter warning。
