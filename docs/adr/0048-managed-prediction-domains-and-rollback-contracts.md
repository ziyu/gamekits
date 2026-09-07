# ADR 0048：托管 Prediction Domain 与回滚协议

## 状态

Accepted

## 背景

GameKits 已经分别具备 managed client replication、输入预测 buffer、predicted-spawn registry、authority
timeline、time-aligned presentation、Physics 单主体 transition 和 prediction island。这些能力解决了预测与回滚
的底层正确性，但非输入驱动对象仍需要 app 手动组合 generation reset、spawn identity、authority binding、过期、
容量、时间线和 cleanup。多个 app 按相同顺序拼接这些 helper 会形成平行 lifecycle，也使“选择不同预测算法”和
“每种算法都重写通用调度”混为一谈。

成熟框架的关键不是让所有对象使用同一种预测算法，而是让不同算法遵守同一组对象身份、时钟、回滚、权威接管、
生命周期、预算和诊断约束。GameKits 仍需保持薄内核，不能通过绑定某个 ECS、Physics backend、network object
基类或反射系统获得这种一致性。

## 决策

### 统一托管层

Multiplayer Core 提供两类标准托管 runtime：

- `clientReplication` 管理输入驱动的单一 local predicted state，并协调 authority snapshot、ack、input replay、
  remote presentation 和最终 frame write。
- managed prediction domain 管理事件起点对象和 predicted entity 的 generation、单调 authority timeline、local /
  authority identity、confirm/reject/expire、authority binding、hard reset、容量与 diagnostics。

低层 prediction buffer、predicted-spawn registry、authority timeline 和 presentation transition 继续公开，供特殊
netcode、测试和标准 domain 实现使用；普通 app 不应再直接组合它们的 lifecycle。

### 策略与生命周期分离

统一协议不定义统一模拟算法。Domain descriptor 或 transition 只选择并实现以下窄策略之一：

- 输入驱动 state replay；
- lag-compensated hitscan；
- kinematic record reconstruction；
- predicted entity + Physics prediction island；
- authority-only presentation。

Multiplayer Core 不理解 Physics scene、Combat projectile、World component 或 Renderer object。Physics、Combat、
World 等模块提供确定性 transition、checkpoint contributor 或 record sampler；App Host 可以提供跨模块标准组合，
app 只保留内容定义、对象集合、输入映射、权威 payload 映射和最终表现写入。

### 回滚契约

任何可回滚 domain 都必须显式声明：

- 稳定 domain id、binding/session generation 和对象 identity；
- simulation tick、输入/命令 sequence 与 authority acknowledgement 语义；
- checkpoint capture、restore、deterministic advance 和 state hash 边界；
- 最大 history tick、member、spawn、checkpoint bytes 和每帧 replay work；
- history/membership/capability 不完整时的 hard correction 或 authority-only 降级；
- replay 期间的副作用策略。

回滚只恢复声明的 simulation state。EventBus、GAS commit、TCA transition、Combat damage、Audio、Camera shake、
Renderer object 和 UI 不能在 replay 中重复提交。需要预测的副作用进入有界 speculative effect journal，以稳定
effect id 执行 anticipate、confirm、cancel 或 replace；不可撤销玩法结果仍只由 authority commit。

跨模块回滚通过 opaque contributor 协调。Contributor 显式提供稳定 id/order、capture、restore 前 validation、byte
measurement 和 state hash；协调器在同一 generation/tick 捕获所有 contributor，限制单 checkpoint 与总 history
bytes，并在成功 restore 后删除未来 checkpoint。具体 World、Physics、RNG 或 gameplay adapter 不进入 Multiplayer
Core。外部 runtime restore 无法通用事务化，因此 restore exception 必须升级为 hard correction/rebuild。

### Schema 与代码生成边界

GameKits 可以在稳定的第二个真实应用证明字段模式后增加可选 schema/codegen，用于生成 snapshot decoder、entity
identity mapping、ack reader 和 typed presentation binding。Core 不递归反射任意对象图，也不要求业务对象继承
GameKits network object 基类；手写 typed mapping 始终是合法底层入口。

Multiplayer Demo 与 Outpost 已证明共同模式，因此采用 typed schema compiler：app-owned decoder 仍验证 provider
payload；schema 把 version/tick/time、local identity、ack、authority state 和 entity presentation 声明编译为 managed
client binding。这里的“生成”是类型安全 closure/track 编译，不生成或替换 Colyseus/Protobuf 等 wire serializer；如果
未来需要 build-time source generation，必须由独立 ADR 证明编译缓存、source map、版本迁移和调试收益。

### 与成熟框架的边界对照

- Unity Netcode for Entities 通过 Ghost authoring、`PredictedSimulationSystemGroup`、`Simulate` tag、history backup 和
  predicted spawn classification 把大部分 prediction plumbing 变成生成/框架代码；GameKits 已用 typed replication
  schema compiler 与 managed domain 收敛重复 binding，但仍不提供 Ghost 等价的 build-time wire serializer 和按 entity
  自动挂载系统。Unity 对 partial snapshot 与 predicted spawn interaction 也明确要求同一交互集合参与 rollback，和
  prediction island 的成员完整性约束一致。
- Unreal Network Prediction 把 fixed/independent tick、rollback、input、interpolation、smoothing 和 finalize 拆成已注册
  service；GameKits 采用相同的“策略与 lifecycle 分离”，但保持 TypeScript 薄协议，不绑定 Actor/UObject model。
- Photon Quantum 将整个 deterministic simulation、verified/predicted frame、rollback window、checksum、Physics/RNG 等
  作为一体化产品。GameKits 不把完整确定性引擎作为默认目标；selective prediction 只为声明的 domain 付费，因此必须
  显式提供 contributor、hash、budget 与 hard-correction 边界。
- Valve Source 将 local input prediction、remote interpolation 与 server-side lag compensation 明确分开。GameKits 的
  `clientReplication`、remote presentation 和 hitscan strategy 保持同样的职责分离，不用 projectile handoff 冒充
  lag compensation。

参考：

- [Unity Netcode prediction](https://docs.unity.cn/Packages/com.unity.netcode%401.4/manual/prediction.html)
- [Unity predicted ghost spawning](https://docs.unity.cn/Packages/com.unity.netcode%401.5/manual/ghost-spawning.html)
- [Unreal Network Prediction services](https://dev.epicgames.com/documentation/en-us/unreal-engine/API/Plugins/NetworkPrediction)
- [Photon Quantum frames](https://doc.photonengine.com/quantum/current/manual/frames)
- [Photon Quantum session config](https://doc.photonengine.com/quantum/current/manual/config-files)
- [Valve Source multiplayer networking](https://developer.valvesoftware.com/wiki/Source_Multiplayer_Networking)

## 备选方案

### 所有对象统一完整 World rollback

拒绝。它会把 World、Physics、GAS、TCA、AI、RNG 和表现副作用强耦合到 Multiplayer Core，也会让不需要预测的
对象承担高额 checkpoint/replay 成本。

### 保持所有 helper 独立，由 app 自行组合

拒绝作为默认路径。低层 helper 保留，但 generation、identity、expiry、binding 和 cleanup 的重复编排已经在真实
应用出现，应由 Core 成为唯一语义来源。

### 引入 NetworkObject 基类和运行时反射

暂不采用。它能减少声明代码，但会扩大核心对象模型、增加高频反射和第三方 ECS 绑定。优先使用 typed descriptor
与可选生成代码。

## 后果

- 普通输入预测继续通过 `clientReplication`；事件起点和 predicted entity 通过 managed prediction domain。
- App 仍声明预测什么、如何确定性推进、如何从权威 payload 读取状态，以及如何写表现；不再手动维护通用
  generation/timeline/spawn/binding/expiry lifecycle。
- Physics prediction island 不并入 Multiplayer Core，而通过 rollback transition/descriptor 接入托管 domain。
- 基础 `GameWorld` 不增加必选 restore API；需要跨模块 rewind 的 adapter 选择性实现 `CheckpointGameWorld`，并由
  显式 component/entity scope 的 controller 生成 World contributor。
- App Host 提供默认 World 100、RNG 150、Physics 200 的 contributor 组合边界；Multiplayer Core 仍只持有 opaque
  checkpoint。标准 canonical encoding 让 byte measurement/hash 与 object key 插入顺序无关。
- 普通 app 通过一个标准 rollback domain 工厂声明 World scope、RNG、Physics、额外 contributor 和预算；逐 contributor
  组合保留为高级入口。
- Typed replication schema 已由 Multiplayer Demo 与 Outpost 共同消费；低层 client replication callback 继续兼容。
- 新公共 API 必须有 generation、duplicate/stale、confirm/reject/expire、overflow、hard reset、dispose 和 retained
  state 测试，并由至少一个真实 app 使用。
- 全状态回滚与 speculative effect journal 是可选 toolkit，不成为所有多人游戏的默认成本；1,000 entity 跨域
  checkpoint 必须持续通过 capture/hash、restore/rebuild、history bytes 与 retained-state 性能预算。

这里的“成熟框架级”指 prediction/rollback 的身份、时钟、输入 ack、权威校正、checkpoint、重放、副作用、预算、
诊断和组合边界均有默认托管协议与真实应用验证，不等于复制一套 Quantum deterministic engine、Unity Ghost authoring
pipeline 或 provider reconnect/matchmaking。Wire serialization、seat-reservation reconnect、interest management 和完整
确定性引擎继续由成熟 backend/solver 或后续独立 adapter 提供；它们不能成为 app 重写 prediction lifecycle 的理由。
