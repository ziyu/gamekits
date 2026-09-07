# ADR 0049：标准多人 Physics Arena Prediction 组合

## 背景

GameKits 已经具备 managed client replication、单主体 Physics prediction transition、predicted lifecycle domain、
Physics prediction island、跨模块 rollback contributor 和 speculative effect journal。普通角色移动已经可以只声明
typed snapshot、输入 transition 和最终 writer；复杂刚体对象也能在低层 island 中完成 checkpoint、restore、replay
和 hard correction。

缺口位于组合层：managed client replication 与 Physics prediction island 仍是两个独立 runtime。应用需要在
snapshot、input、fixed tick、binding reset 和 presentation 边界手动调用 island/domain，且 authority 端没有标准的
完整 island snapshot projection。这个缺口对投射物实验尚可接受，但在多人拥挤、动态机关和可推动物体持续接触的
arena 游戏中会扩散成每个游戏一套 orchestration。

直接修改 `createMultiplayerClientReplication(...)` 使其理解 Physics 会破坏包依赖方向，也会扩大已经被多个应用、
Multiplayer GameModule 和 benchmark 使用的高风险公共路径。只在 app 中提供示例 glue 又不能形成可复用协议。

## 决策

### Provider-neutral client prediction domain bridge

`@gamekits/multiplayer-core` 的 GameModule bridge 增加可选、provider-neutral 的 client prediction domain descriptor。
Descriptor 以 authority binding 为生命周期边界，由 factory 创建独立 runtime，并只接收通用上下文：

- binding / generation reset；
- 已通过 authority gate 和 schema 校验的 snapshot；
- managed client replication 已编号的本地 input；
- fixed simulation tick 与 presentation frame；
- hard reset、diagnostics 和 dispose。

标准执行顺序固定为：

1. 接收并验证 authority snapshot；
2. 处理 binding、generation 和 membership revision；
3. reconcile 或安装 hard-correction baseline；
4. 把本地 input 映射成当前 tick 的 domain command；
5. 推进 domain 到目标 prediction tick；
6. 在同一个 managed frame 中采样 remote presentation 与 predicted domain output；
7. 写最终 frame，并结算可撤销 effect；
8. binding reset 或 module dispose 时释放全部 domain state。

Bridge 通过包装 `createMultiplayerModule(...)` 已有 `clientReplication` callback 完成组合，不让低层
`createMultiplayerClientReplication(...)` 依赖 Physics，也不改变其现有单 state transition contract。已有应用无需迁移；
低层 callback 和 imperative island 继续作为特殊 netcode、测试与工具的 escape hatch。

### Fixed-step input delivery window

一个 input sequence 对应一个 simulation step 时，单次发送后只等待累计 ack 不能覆盖有损 delivery：任一缺失 sequence
都可能让 authority FIFO 和客户端 prediction lead 永久停住。Managed client replication 保留现有单帧 payload 默认路径，
并增加 provider-neutral、可选的 bounded redundant input bundle：每次发送当前 frame 和最近仍未 ack 的有限 frame，
authority inbox 按 peer + binding generation + sequence 去重、排序并每 tick 至多消费一个连续 step。

应用只编码单帧 gameplay input；Core 负责 bundle envelope、redundancy window、容量、重复帧和 diagnostics。Authority
通过标准 fixed-step inbox 选择显式 gap policy；超过等待预算时只能按声明的 hold-last/neutral input 模拟并推进 ack，
不能静默跨过未模拟 sequence。Snapshot ack 始终表示已经实际模拟完成的最高连续 sequence。

这是 managed replication 的通用、additive delivery policy，不属于 Physics Arena 专用 API。修改涉及高风险公共路径时
必须保持未配置 bundle 的行为完全兼容，并用 Multiplayer Demo、Outpost、authority loop 和 benchmark 回归覆盖。

### App Host Physics Arena adapter

`@gamekits/app-host` 提供 `createStandardMultiplayerPhysicsArenaPrediction(...)` 作为默认高层 adapter。它组合：

- `createPhysicsPredictionIsland(...)`；
- `createStandardMultiplayerPhysicsPredictionDomain(...)`；
- client prediction domain bridge；
- 可选的 `createStandardMultiplayerRollbackDomain(...)`；
- 可选的 `createMultiplayerSpeculativeEffectJournal(...)`；
- 完整的 reset、hard correction、diagnostics 和 dispose。

应用必须显式提供：

- authority payload 到 arena frame 的 typed mapping；
- 本地 identity 和 input 到 Physics command 的 mapping；
- static environment 与 dynamic member definition resolver；
- 哪些对象属于同一个真实交互集合；
- Physics state 到最终 presentation/world writer 的 mapping；
- 可撤销反馈和 authority-only gameplay fact 的边界。

应用不再自行维护 snapshot callback 中的 reconcile 顺序、input replay loop、membership revision fallback、generation
reset、history overflow fallback、effect replay 去重或 dispose 清理。

### Event-started predicted member

连续 input 之外的 throw、projectile、vehicle spawn 等事件也必须进入同一个 Arena prediction owner。标准 adapter 因此提供
`registerPredictedMember({ correlationId, tick, member })`：内部 predicted lifecycle 先按 kind + generation + correlation
注册 identity，再把 spawn 排入同一个 island command/history；重复注册返回 duplicate，冲突、过期 generation 或 command
rejection 明确失败，应用不能另建 correlation map 或第二个 scene。

Authority frame 仍只复制安全 body state，不用 `userData` 传玩法 identity。应用通过可选
`resolveAuthoritySpawn(member, frame, appSnapshot)` 从 typed app snapshot 的 item/action/projectile projection 解析 correlation，
并通过 `resolveMemberDefinition(member, frame, appSnapshot)` 重建 definition。两者在 baseline、reconcile 与 hard correction
使用同一份最新已验证 app snapshot。旧的少参数 resolver 与未调用 event registration 的 consumer 保持兼容。

Authority reject、snapshot gap 或 generation change 时，完整 frame reconcile/hard correction 删除未匹配 member 和未来
command；predicted lifecycle 负责 match/reject/expire/binding 容量，speculative effect journal 负责视觉、音频和 UI 的
confirm/cancel/replace。Gameplay item owner、hit、GAS effect 和 KO 不进入该 journal。

### Authority arena projection

App Host 提供与客户端 adapter 对称的 authority projection helper。它从 authority-owned Physics scene/handle 和显式
membership source 生成 provider-neutral arena frame，但不拥有 provider wire serializer：

```ts
export type MultiplayerPhysicsArenaFrame = {
  islandId: string;
  generation: string | number;
  tick: number;
  membershipRevision: number;
  definitionVersion: string;
  members: PhysicsPredictionIslandMemberState[];
};
```

Input ack、server time、round phase 和 player/peer binding 仍属于 app replication schema。Provider Schema、Protobuf、
JSON 或其他 wire model 继续由 app/backend boundary 拥有。

Authority projection 必须验证 member id 唯一、definition version 一致、body state 有限、成员数量和 payload bytes
不超预算。客户端只接受与当前 binding、generation、island id 和 definition version 一致的 frame。

### 完整交互集合优先于自动分区

Prediction island 的成员不是渲染 interest set，而是一个因果闭包：任何能在重演区间内直接或间接改变预测主体的
dynamic/kinematic body 都必须位于同一 tick 的完整集合中。静态 layout 可以通过共享 versioned definition 作为
environment 重建，不必每个 snapshot 重复发送。

标准协议不根据客户端半径静默猜测成员。Authority 必须声明 `membershipRevision` 和完整成员；成员变化安装新的完整
baseline，并清除旧 revision 的 command/history。缺失成员、未知 definition、revision 跳跃、history/byte/replay 预算
溢出都进入 hard correction 或 authority-only 降级，不能继续部分重放。

首个真实应用采用单个完整 arena island。自动 island partition/merge/split 与大规模 interest management 只有在完整
arena benchmark 证明有必要后，才作为独立 policy/adapter 设计；不能牺牲正确性提前引入启发式分区。

### 状态所有权

同一份 solver state 只能有一个 rollback owner：

- arena island 拥有其成员 body、collider、solver cache 和 prediction history；
- World/RNG/gameplay contributor 只捕获 island 之外、确实需要本地 replay 的状态；
- World contributor 不重复捕获由 island 拥有的 Physics component；
- authority-only checkpoint、淘汰、排名、奖励和伤害不进入客户端 speculative rollback；
- Audio、Camera、Renderer 和 UI 反馈通过 effect journal 去重并由 authority confirm/cancel/replace。

如果整个 live PhysicsModule scene 选择由 `createStandardMultiplayerRollbackDomain(...)` 捕获，就不能同时让另一个
prediction island 捕获同一批 body。组合层必须在 install 时拒绝重复 ownership。

### Physics 能力与预算

Physics arena adapter 只在 backend 声明 full-scene capture/restore 和 deterministic replay 时启用。它必须声明并验证：

- max members、commands 和 history ticks；
- max checkpoint bytes 和 total history bytes；
- max replay ticks/work per reconcile；
- snapshot payload bytes；
- correction/hard-correction policy；
- stable definition version 和 state checksum diagnostics。

Prediction island 当前公共成员模型是 body + colliders，不承诺 joint/constraint authoring。旋转杆、门和移动平台等首个
arena 使用确定性 kinematic body；joint、ragdoll 或 constraint graph 若成为跨应用需求，单独扩展 Physics 协议和 ADR，
不能把 backend native joint 偷渡进通用 arena payload。

## 备选方案

### 让 `createMultiplayerClientReplication(...)` 直接理解 Physics island

拒绝。它会令 Multiplayer Core 反向依赖 Physics，并使普通非物理 prediction 承担额外复杂度。该函数也是现有高风险
公共路径，复杂 arena 组合应在 bridge/App Host adapter 增量实现。

### 每个游戏在 snapshot callback 和 render loop 中直接调用 island

拒绝。这会重新产生手写 tick、reset、hard-correction、effect 和 cleanup 顺序，无法形成一致 conformance。

### 默认同步和回滚完整 World

拒绝。大量 authority-only entity、UI/presentation state 和无关 gameplay component 会放大 payload、checkpoint 与 replay
成本，并增加重复状态所有权。Arena 按真实交互集合声明，而不是按整棵对象图回滚。

### 客户端根据距离自动构造 island

拒绝作为默认语义。距离不是接触因果闭包，快速物体、移动平台、链式碰撞和动态 spawn 会让两个客户端得到不同成员。
可选分区必须由 authority 声明 revision，并通过 conservative horizon 和完整性验证。

## 后果

- 普通单主体移动、kinematic record 和已有 Demo 保持现有 API，不被迫迁移。
- 高互动游戏获得一个可直接挂到 standard Multiplayer GameModule 的 arena descriptor，不再重建通用 orchestration。
- App 仍拥有玩法输入、成员 policy、内容定义、payload mapping 和最终 writer；统一协议不意味着统一玩法算法。
- 第一个真实消费者是独立的 `multiplayer-physics-arena-demo`，它同时验证 Rapier 3D、Three Driver、Colyseus
  server-authority、完整 arena snapshot、prediction island、effect journal 和 diagnostics。
- 单完整 island 会增加 authority payload 和客户端 replay 成本；在基准和真实网络矩阵建立前接受该成本，以换取明确
  的正确性基线。
- 自动分区、生产级 interest management、joint/ragdoll、matchmaking 和公网部署不由本决策伪装为已完成能力。
