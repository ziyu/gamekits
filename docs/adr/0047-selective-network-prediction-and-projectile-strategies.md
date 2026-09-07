# ADR 0047: Selective Network Prediction And Projectile Strategies

Status: Accepted on 2026-07-28.

## Context

Outpost Siege 的 Rifle 已经能够在本地输入后的下一次可绘制 frame 播放 muzzle、音频、recoil，并创建
移动弹体；服务端权威 projectile 到达后，表现层还会按 correlation 接管该对象。这解决了“等待服务端才看见
开火”和“接管瞬间倒退”两个局部问题，却没有预测 projectile 的空间因果。客户端弹体没有运行与 authority
相同的 sweep/collision，因此会先穿过墙，直到较晚到达的权威 despawn 才回到墙面爆炸。

这不是单个武器的 lerp 或 handoff 参数问题。只要对象的本地轨迹会被碰撞、动态交互或生命周期改变，纯
render anticipation 就无法给出正确结果；继续逐武器补视觉特判会形成第二套不完整 simulation。

成熟方案并不把所有对象塞进同一种预测模型：

- Unity Netcode for Entities 把 prediction 定义为 client/server 运行同一 simulation，并在 snapshot 到达时
  rollback/resimulate；predicted spawn 通过类型与 spawn tick 匹配权威 ghost。相互作用的 predicted ghost 必须
  进入一致的 rollback timeline，否则 partial snapshot 会持续产生错误预测。
- Photon Fusion 按 projectile 行为选择 network object、kinematic data、visual-only count 或 authority-only 等
  策略。它明确指出缺少权威 hit position 的简单 visual projectile 会穿墙，并推荐以有界 projectile data 保存
  fire/finish tick、初始运动和最终 hit position。
- Unreal Networked Physics 只对需要的对象启用 predictive interpolation 或 resimulation。Resimulation 需要保存
  至少一个 RTT 的 physics history，并承担显著 CPU/内存成本。
- Valve Source 对本地玩家和受本地输入直接影响的对象做 prediction，对远端对象做 interpolation；命中公平性
  由服务端 lag compensation 回看历史，而不是预测远端玩家未来。

Colyseus 提供 room、transport 和 state synchronization，但不提供完整 client prediction/rollback engine；它
不能替代 GameKits 的 simulation history、predicted spawn matching 或 resimulation lifecycle。Rapier 可以在严格
一致的初始状态、操作值和创建/删除顺序下提供跨平台确定性基础，但确定性 solver 本身也不等于完整 netcode。

## Decision

### 按对象选择策略，不启用默认全世界回滚

每个需要即时本地反馈的网络对象必须声明一种策略。策略由 gameplay/Data 定义选择，由标准组合边界映射到
Multiplayer、Physics、Combat 和 presentation；app 不能在单个武器 handler 中手写平行 netcode。

| 策略                      | 适用对象                                                 | 本地行为                                                                   | 权威与远端行为                                                         |
| ------------------------- | -------------------------------------------------------- | -------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `hitscan-lag-compensated` | 瞬时射线、短 beam、无需可见飞行时间的武器                | 下一 frame 播放 muzzle/tracer anticipation，不创建会移动的 gameplay 弹体   | authority 回看有界目标历史并验证 ray；结果驱动 impact/hit confirmation |
| `kinematic-data-buffer`   | 长寿命有限、轨迹可重放、主要由 sweep 决定的高速弹丸      | 按同一 fixed tick、定义和 sweep 预测轨迹与 provisional spatial impact      | authority 发布有界 fire/finish 数据；remote proxy 从该数据重建轨迹     |
| `predicted-entity`        | 弹跳、制导、多刚体或会与其他 predicted dynamic body 交互 | 创建可匹配的 predicted identity，并在 prediction island 内 rollback/replay | authority spawn 与 client spawn 匹配；snapshot 修正整个交互岛并重模拟  |
| `authority-only`          | 数量少、复杂、对输入延迟不敏感或无法安全预测的对象       | 只播放不承诺空间结果的 anticipation                                        | authority 拥有 simulation；客户端插值/重建公开状态                     |

`visual-only` 只适用于不承诺碰撞、命中位置或 gameplay lifecycle 的装饰。如果一个可见对象会因为墙、目标、bounce、
expire 或其他空间事实停止、改向或销毁，它不能用 render-only handoff 冒充 prediction。

### Kinematic projectile 使用有界 fire/finish record

`kinematic-data-buffer` 的标准权威 record 至少包含：

- 稳定 shot/correlation identity 与 generation；
- `fireTick`、`firePosition`、`fireVelocity` 和 projectile definition/version；
- 可选 `finishTick`、`hitPosition`、`hitNormal`、finish reason 和命中 subject 的公开 identity；
- 明确的 ring capacity、最大 lifetime 和过期规则。

Record 在 fire 时建立，在碰撞、expire 或 cancel 时完成；不能按 render frame 复制完整 projectile transform。
本地 owner 从 input/correlation 创建 provisional record，使用与 authority 相同的 projectile definition、fixed-step
interval、静态 layout 和 ray/shape sweep。预测到阻挡后必须立即停止本地弹体并播放可撤销的 spatial impact，
不能继续穿墙等待服务端。

Authority result 是最终空间与玩法事实。客户端收到 record/result 后按 identity 匹配：一致则确认且不重播已
预演反馈；不一致则从最近有效预测边界重建或撤销 provisional result。客户端不能提交 target validation、GAS
effect、ammo/cost、damage、kill 或 status。Remote proxy 不从“当前收到位置”向前猜，而是按 authority fire/
finish record 和 remote presentation timeline 重建。

Owner prediction 与 remote proxy 使用不同 presentation time domain。Authority record 可能因为 fixed authority
tick、ability commit 和 transport 晚于 owner anticipation 建立；identity 与 shot-relative trajectory 匹配后，
owner 必须以当前 predicted shot age 采样 authority record，而不是按 authority 的较晚绝对 `fireTick` 回到过去。
该绝对 tick offset 只用于 diagnostics，不产生 position correction。Remote proxy 继续使用 remote authority
presentation time。只有 fire position/velocity、definition、finish 等空间事实真正分叉时才执行有界 correction；
不能用 correction smoothing 吸收正常的网络/commit 时间差，因为这会直接表现为投射物减速。

这条规则不是 projectile 专用 lerp。Multiplayer Core 通过
`createMultiplayerTimeAlignedPresentationTransition(...)` 提供通用 stable key/version、absolute 或
relative-origin sampling、bounded entry、hold、residual correction 与 diagnostics lifecycle。门、移动平台、技能
轨迹或其他以 start record 确定重建的对象可以复用同一 primitive；domain 只提供 sampler、事实 reconciliation 和
declarative presentation fields。输入驱动预测仍走 authority state + unacknowledged input replay，远端对象仍走
snapshot interpolation，动态刚体交互仍走 prediction-island checkpoint/resimulation，不能用一个 handoff helper
冒充全部 netcode。

### Predicted entity 必须以 prediction island 为回滚单位

`predicted-entity` 不能只回滚一个 subject body，却让它与留在未来状态的动态 body 碰撞。Multiplayer Core 管理
有界 tick/input history、predicted-spawn identity/matching、rollback/replay lifecycle、hard reset 和 diagnostics；
Physics Core 为选中的 prediction island 保存/恢复 simulation checkpoint，并按稳定顺序重放其中所有会相互
影响的 body、constraint、spawn 和 despawn。

Prediction island 必须声明成员选择、history window、最大 body/spawn 数、缺失 snapshot policy 和 overflow
policy。超出预算时降级为 hard authority correction 或 `authority-only`，不能悄悄遗漏交互对象后仍声称预测
正确。没有动态交互时，不应为简单弹体或普通远端单位支付全场 physics resimulation 成本。

### 现有单主体 Physics transition 保持窄能力

`createPhysicsBodyPredictionTransition(...)` 继续作为轻量层：一个本地 subject body、共享静态 layout、相同
backend/fixed step/input mapping 和有界公开 body checkpoint。它适合本地角色移动、Dash 与静态场景碰撞。

该 transition 不是完整 solver snapshot，也不覆盖 predicted spawn、多个动态 body 的一致回滚或 projectile
lifecycle。任何需要这些能力的对象必须选择 `kinematic-data-buffer` 或 `predicted-entity`，不能在现有 helper
外继续添加 app-local collision 特判。

### 能力归属

- Multiplayer Core 定义 provider-neutral tick/input history、prediction domain lifecycle、predicted-spawn identity
  与 match result、time-aligned lifecycle presentation、bounded replay/reset/overflow diagnostics；不依赖 Physics
  或 Combat。
- Physics Core 保留单主体 transition，并为需要 resimulation 的 backend 提供显式 capability、scene checkpoint/
  restore 与 prediction-island transition；不依赖 Multiplayer。
- Combat 定义标准 projectile network strategy vocabulary、fire/finish spatial record、authority result 与 lifecycle
  correlation，以及 record sampler 和事实 reconciliation；它不让 client 执行 authority target/effect validation，
  也不拥有 Multiplayer handoff state machine。
- App Host 提供 Combat record + Multiplayer time-aligned transition 的标准组合；App/Data 为 projectile definition
  声明策略和预算，并提供玩法特有的 target/history policy，不拥有通用 rollback loop、solver cache、handoff
  entry map 或逐武器网络状态机。
- Backend adapter 只负责 transport/state mapping 或 Physics backend checkpoint；Colyseus/Rapier 类型不能进入
  gameplay 公共协议。

### 测试与 benchmark 是启用条件

每种策略必须有独立 conformance profile，不能用“第一帧出现了弹体”代替预测正确性：

- 输入到本地 muzzle/projectile 的延迟不超过下一次可绘制 frame；静态墙碰撞在本地预测 tick 立即停止，任何
  frame 都不能把弹体绘制到已知 blocker 后方。
- client/authority 使用相同 seed、definition、layout、fixed step 与 input log 时，fire/finish tick、hit position
  和 finish reason 收敛；故意制造分叉时只产生一次有界 correction/retraction。
- predicted spawn 覆盖 confirm、reject、duplicate、late result、generation reset、history overflow、binding reset
  和 dispose；旧 authority result 不能匹配新 generation。
- prediction island 覆盖两个以上相互作用 dynamic body、spawn/despawn replay 与 partial snapshot，证明所有
  成员回到同一 tick 后再模拟。
- benchmark 分开测 kinematic record churn/serialization、owner prediction sweep、remote reconstruction，以及
  predicted-entity history capture/restore/resimulation；同时限制 p95/max、每对象 bytes、历史硬上限和 dispose
  后 retained state。关闭 prediction 或只测 presentation 不能替代这些预算。
  Outpost Rifle 当前具有明确可见飞行时间和直线 sweep，选择 `kinematic-data-buffer`。如果产品设计改为瞬时
  命中，必须整体切换到 `hitscan-lag-compensated`，不能保留“视觉上慢速飞行、玩法上瞬时命中”的隐式混合。

### Physics prediction island 的稳定实现边界

Physics Core 通过 `createPhysicsPredictionIsland(...)` 实现上述 prediction-island transition。调用方必须提供
稳定 member/body/collider id、完整 authority member snapshot，以及 history tick、member 和 command 上限；Core
负责按 tick/sequence 应用 spawn/patch/despawn、保存有界 checkpoint、处理 late command restore/replay，并公开
membership mismatch、history overflow、correction、checkpoint bytes 和 resimulation diagnostics。

Backend 只有在 `PhysicsBackendCapabilities.checkpoints` 明确声明 full-scene capture/restore 与 deterministic replay
时才能启用该 helper。`PhysicsSceneCheckpoint.payload` 属于 adapter 私有数据；公共 envelope 只公开 backend、scene
id 和 byte length。Rapier 2D/3D adapter 使用 native world snapshot 恢复 solver state 和稳定 handle mapping，同时
把 scene-local material friction/restitution/density/combine 与 body CCD 映射到底层能力。该 checkpoint 只服务短时
预测回滚，不替代 Physics Module/Save 的长期稳定状态重建协议。

## Consequences

Positive consequences:

- 即时手感与空间因果进入同一设计，墙体碰撞、bounce 和 spawn 不再靠权威结果到达后的视觉补丁修复。
- 简单弹丸只复制两次有界数据，不承担每弹一套 network entity/transform stream；复杂对象仍能显式选择完整
  rollback/resimulation。
- 远端 interpolation、owner prediction、服务端 lag compensation 和 authority-only 不再混为一个概念。
- GameKits 保持 backend-neutral，Colyseus 与 Rapier 分别提供成熟 transport/state sync 和 solver，不被误当成
  完整 netcode 产品。

Costs and constraints:

- Multiplayer、Physics 与 Combat 都需要补充新的稳定协议、conformance 和 benchmark，Outpost 不能先以 app
  特判继续实现 Rifle 碰撞预测。
- Predicted entity/resimulation 会增加 CPU、内存和调试复杂度，必须按对象显式启用并限制 prediction island。
- Kinematic record 要求 client/server 共享版本化 projectile definition 和静态 layout；动态目标仍以 authority
  validation 为准，并可能产生少量可撤销修正。
- Lag compensation 需要服务端保存有界目标历史，并明确最大 rewind、作弊边界和延迟公平策略。

## Rejected Alternatives

### 继续修 render-only projectile handoff

Rejected because它只能隐藏 authority spawn 延迟，不能预测 collision、finish tick 或 hit position；已知墙体前的
弹体仍会穿墙。

### 默认启用完整 world rollback

Rejected because多数远端对象只需 interpolation，简单弹丸只需有界 fire/finish data。全场 resimulation 的
CPU、内存、partial snapshot 和 side-effect 管理成本不应成为所有游戏的默认税。

### 每个 projectile 默认复制 network entity transform

Rejected because高速短寿命弹丸数量大、状态简单；逐 tick 复制每个 transform 会放大带宽、entity churn 和
snapshot 成本。只有复杂长寿命交互对象才选择 predicted/network entity。

### 在 Outpost 的 Rifle handler 中补本地 raycast

Rejected because下一个武器、移动平台、敌人 projectile 和 bounce 会重复同一套 history、identity、reconcile
和 cleanup 问题。底层缺口必须先形成可复用能力。

### 把 Colyseus 当作 prediction/rollback engine

Rejected because Colyseus 的职责是 room、transport 与 state sync；其官方文档并不提供完整 client prediction。
GameKits 仍需定义 prediction domain 和 simulation lifecycle。

## Documentation

该提案同步影响：

- `docs/architecture.md` 的 Multiplayer/Physics/Combat 边界；
- `docs/modules/multiplayer.md` 的 selective prediction domain；
- `docs/modules/physics.md` 的单主体 transition 与 prediction island 层级；
- `docs/modules/combat.md` 的 projectile network strategy；
- `docs/best-practices.md` 的预测测试反模式；
- `docs/apps/outpost-siege/player-experience.md` 与对应 implementation workflow 的 Rifle 选择和能力门禁。

## References

- [Unity Netcode for Entities: Prediction](https://docs.unity.cn/Packages/com.unity.netcode%401.5/manual/intro-to-prediction.html)
- [Unity Netcode for Entities: Ghost spawning](https://docs.unity.cn/Packages/com.unity.netcode%401.0/manual/ghost-spawning.html)
- [Unity Netcode for Entities: Prediction details](https://docs.unity.cn/Packages/com.unity.netcode%401.5/manual/prediction-details.html)
- [Unity Netcode for Entities: Physics](https://docs.unity.cn/Packages/com.unity.netcode%401.0/manual/physics.html)
- [Photon Fusion: Projectiles Essentials](https://doc.photonengine.com/fusion/v2/technical-samples/projectiles-essentials)
- [Photon Fusion: Lag compensation](https://doc.photonengine.com/fusion/current/manual/advanced/lag-compensation)
- [Photon Fusion: Network simulation loop](https://doc.photonengine.com/fusion/current/concepts-and-patterns/network-simulation-loop)
- [Unreal Engine: Networked Physics overview](https://dev.epicgames.com/documentation/unreal-engine/networked-physics-overview)
- [Valve Developer Community: Source Multiplayer Networking](https://developer.valvesoftware.com/wiki/Source_Multiplayer_Networking)
- [Valve Developer Community: Lag compensation](https://developer.valvesoftware.com/wiki/Lag_compensation)
- [Colyseus FAQ: client-side prediction](https://docs.colyseus.io/faq)
- [Rapier JavaScript: Determinism](https://rapier.rs/docs/user_guides/javascript/determinism/)
- ADR 0028: `docs/adr/0028-managed-client-replication-runtime.md`
- ADR 0030: `docs/adr/0030-backend-driven-physics-prediction-transition.md`
- ADR 0046: `docs/adr/0046-bounded-combat-projectile-lifecycle-facts.md`
