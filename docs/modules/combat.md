# Combat 模块设计

## 定位

Combat 是可选的 Game Module toolkit，负责把一次语义化攻击交付为可验证的目标候选、命中结果和 GAS effect。它建立在 World、Physics 与 GAS 之上，不替代任何一个模块。

相关包：

- `@gamekits/combat`

Combat 不定义具体武器、职业、敌人、生命属性名、暴击公式或阵营枚举。游戏通过 DataType 和 policy 注入这些语义。

## 职责

- effect delivery：melee、hitscan、projectile、area、direct target。
- target relationship 与 target filter protocol。
- hit ticket、命中去重、pierce/bounce/stop policy。
- entity-backed projectile lifecycle。
- 命中、拒绝、交付、销毁 trace 和低频 fact。
- 与 GAS ability execution、Physics query/contact、World identity 的稳定关联。

非职责：

- Physics solver、碰撞 broadphase 或 pathfinding。
- GAS attribute/effect/tag/cooldown runtime。
- 武器输入、AI 决策、关卡规则、动画、音频或 UI。
- 固定的 hp/shield/team/faction/damage type 业务模型。

## 核心模型

```ts
export type CombatDeliveryRequest = {
  id: string;
  sourceActorId: string;
  sourceEntityId?: EntityId;
  executionId?: string;
  definition?: DataRef<"combat.delivery">;
  delivery?: CombatDeliverySpec;
  payloads?: CombatPayloadSpec[];
  relationshipPolicy?: string;
  targetActorId?: string;
  origin?: PhysicsVector;
  position?: PhysicsVector;
  direction?: PhysicsVector;
  correlationId?: string;
  parentId?: string;
};

export type CombatDeliverySpec =
  | { type: "direct"; targetActorId: string }
  | { type: "melee"; shape: PhysicsShapeDefinition; offset?: PhysicsVector }
  | { type: "hitscan"; range: number; radius?: number }
  | { type: "area"; shape: PhysicsShapeDefinition; position: PhysicsVector }
  | { type: "projectile"; projectile: DataRef<"combat.projectile"> };

export type CombatPayloadSpec = {
  effectId: string;
  target: "hit-actor" | "source-actor";
};
```

Combat 使用 effect id 交付玩法结果，不直接修改 `health`。伤害、治疗、控制、修复和环境交互都可以由同一 delivery path 触发不同 GAS effect。

## Target 与 Relationship

游戏注册窄 policy：

```ts
export type CombatRelationshipResolver = {
  resolve(source: CombatSubject, target: CombatSubject): string;
  allows(policyId: string, relationship: string, context: CombatHitContext): boolean;
};
```

Core 不内置 player/enemy/friendly。Physics layer 只负责 broadphase 裁剪；owner ignore、friendly fire、无敌、死亡、目标类型和 phase restriction 在 relationship/target policy 中解释。

候选排序必须稳定。`closest`、`all`、`maxTargets`、目标优先级和 tie-breaker 由 delivery definition 明确，不能依赖 backend 返回顺序。

`PhysicsQueryResult.entityId` 是可选加速信息，不是所有 backend 都会填充。Combat 必须以同一 World 中的 Physics body/collider component 为身份事实源，在一次 query 或 projectile batch 内建立有界索引，把 body/collider id 映射回 entity，再查询 GAS actor；不能要求 adapter 复制一套 entity registry，也不能为每个候选全量扫描 World。

## Projectile

Projectile 是 World entity，可以同时具有：

- stable gameplay id 与 network generation。
- `CombatProjectileComponent`。
- Physics body/collider/transform/velocity component。
- presentation definition reference。

Projectile definition 至少描述：

```ts
export type CombatProjectileDefinition = {
  id: string;
  body: DataRef<"physics.body">;
  lifetimeMs: number;
  speed?: number;
  collisionMode: "contact" | "ray-sweep" | "shape-sweep";
  hitPolicy: "stop" | "pierce" | "bounce";
  maxHits?: number;
  maxBounces?: number;
  repeatHitCooldownMs?: number;
  payloads: CombatPayloadSpec[];
};
```

高速小投射物默认使用 ray/shape sweep，避免固定步之间 tunneling。具有实际体积的弹体优先 shape cast；backend 原生 CCD 只能作为 adapter capability，不替代公共 hit policy。

每个投射物维护有界 hit memory。`maxHits`、`maxBounces`、lifetime 和 arena bounds 都是硬上限；任何配置都不能产生无界命中集合或永久 entity。

Projectile module 使用批量 query、复用临时结果与延迟 cleanup queue，避免在 entity 循环内创建大量 Set/Array。是否使用 entity pool 由 World adapter benchmark 决定，公共协议不暴露池化 identity。

## Projectile Network Strategies

Projectile definition 在多人 profile 中必须通过 Data/app composition 显式绑定一种标准 network strategy，
不能由 presentation 根据“是否先画出来”隐式推断：

- `hitscan-lag-compensated`：用于没有真实飞行时间的 ray/beam。Client 只预演 muzzle/tracer；authority 在有界
  目标历史中回看并执行 Combat/Physics query，发布最终 hit result。
- `kinematic-data-buffer`：用于轨迹可按 definition + fixed tick 重放、生命周期有限的弹丸。Owner client 运行与
  authority 相同的 ray/shape sweep并预测 provisional spatial result；authority 通过有界 fire/finish record
  提交最终空间结果，remote proxy 从 record 重建。
- `predicted-entity`：用于 bounce、homing、多 body 或其他动态交互。Client predicted spawn 必须和 authority
  identity/generation 匹配，相关 dynamic body 进入同一 Physics prediction island。
- `authority-only`：用于复杂、稀少或非手感关键对象。Client 只插值权威 state，anticipation 不生成虚假的
  collision/lifecycle。

Combat 定义 strategy vocabulary 和 projectile spatial record，不依赖 Multiplayer runtime。标准 record 至少
包含 shot/correlation/generation、definition/version、`fireTick`、fire position/velocity，以及完成后可选的
`finishTick`、hit point/normal、finish reason 和公开 subject identity。Record 使用固定容量 ring、最大 lifetime
和明确过期规则；fire 与 finish 各更新一次，不按 render frame 复制 transform。

标准实现由四个窄入口组成：`createCombatKinematicProjectileRecordBuffer(...)` 管有界 fire/finish history，
`createCombatKinematicProjectileRuntime(...)` 复用 Physics kinematic sweep 推进 owner/authority simulation，
`sampleCombatKinematicProjectileRecord(...)` 按任意 presentation tick 重建 remote transform。
`reconcileCombatKinematicProjectileRecords(...)` 只比较 fire/finish 空间事实并返回 pending/confirmed/corrected；
它可显式选择 absolute 或 shot-relative timeline，后者比较相对 fire age，而不把 owner anticipation 与 authority
commit 的绝对 tick 偏移误判为弹道分叉。Combat 不再拥有通用 entry、时间对齐或 correction 状态机；App Host 的
`createStandardCombatKinematicProjectilePresentationTransition(...)` 把上述 sampler/reconciliation 注入
Multiplayer Core 的 `createMultiplayerTimeAlignedPresentationTransition(...)`。Shot-relative 模式以 owner 当前
predicted shot age 采样匹配的 authority trajectory；authority commit 较晚产生的绝对 `fireTick` offset 只进入
diagnostics，不能产生位置 correction 或改变弹体速度。只有起点、速度、方向或 finish 等真实空间事实分叉时才
从当前 provisional sample 有界收敛，且在 authority finish 尚未到达时保留已经预测出的 provisional spatial
finish。Absolute 模式继续按 authority tick 采样。标准组合不拥有 predicted-spawn identity，也不应用 GAS effect
或修改 authority state。

Client 的 predicted spatial result 始终是 provisional：可以即时停止弹体、播放可撤销 world impact，却不能
提交 relationship/target validation、GAS effect、ammo/cost、damage、kill 或 status。Authority result 按稳定
identity confirm/reject/correct；确认不能重复播放已经预演的反馈，分叉只撤销或修正对应 prediction chain。

`visual-only` 只用于纯装饰。只继承预测显示位置、保持原速度或等待 authority despawn 的 handoff 不具备
collision 语义，不能用于会被墙、目标、bounce 或 expire 改变轨迹的 projectile。策略边界见
`docs/adr/0047-selective-network-prediction-and-projectile-strategies.md`。

## Ability Execution 协作

GAS 负责 ability phase、cost、cooldown、tag gate 和取消。Combat 只在 execution 进入 `committed` 或指定 active marker 时接收 delivery request：

```txt
input / AI intent
  -> GAS execution requested
  -> preparing
  -> committed
  -> Combat delivery spawn/query
  -> Physics candidate
  -> relationship + target validation
  -> GAS effect application
  -> hit result / cue / trace
  -> recovery / completed
```

Combat 不能自行推进 ability execution，也不能从动画 frame 推断 commit 时刻。Execution 被取消后，已经生成的 projectile 是否继续存在由 definition 的 ownership policy 决定。

可复用集成使用 `combat.ability-delivery` 数据定义把一个 GAS Ability 映射到一个或多个 Combat Delivery：

```ts
export type CombatAbilityDeliveryDefinition = {
  id: string;
  ability: DataRef<"gas.ability">;
  delivery: DataRef<"combat.delivery">;
  phase?: "committed";
  tags?: string[];
};
```

`createCombatModule(...)` 可选择启用 ability delivery bridge。Bridge 监听 GAS execution phase fact，在匹配的 authority execution 首次进入 `committed` 时自动构造幂等 delivery request，传播 actor、target、execution、correlation 和 parent，并调用同一个 module-bound Combat runtime。静态 origin/direction/position 可以来自 delivery definition；需要实时瞄准、蓄力或武器 socket 的游戏通过窄 `resolveRequest` policy 为 request 补充上下文，而不是重写订阅、幂等和 trace 流程。没有配置 bridge 时，保留显式 `combat.deliver(...)` 给环境伤害、脚本事件和测试工具使用。

Bridge 不属于 GAS：GAS 不能依赖 Combat data type，也不能知道 melee、hitscan、projectile 等 delivery 语义。Bridge 也不创建第二个 GAS/Combat runtime，不扫描 execution snapshot，不以每帧 polling 代替 phase event。

## Cue 与空间事实

Combat 不定义平行的通用 Cue 系统。一次成功命中通过 GAS `applyEffect(...)` 触发 Effect Cue；Ability 的前摇、释放和恢复仍由 GAS execution Cue 表达。

Combat 只补充表现需要、但 GAS Cue 不应承载的动态事实：

- delivery request、命中 ticket 和 execution 的稳定关联。
- hit point、normal、distance、blocker 与查询路径结果。
- projectile entity、transform、spawn/hit/bounce/expire/despawn lifecycle。
- miss、cover block、bounce 和 expire 等没有成功 Effect 的空间结果。

Projectile lifecycle 使用两个独立的有界 payload：

```ts
export type CombatProjectileSpawnFact = {
  runtimeId: string;
  projectileId: string;
  entityId: EntityId;
  definitionId: string;
  sourceActorId: string;
  sourceEntityId?: EntityId;
  executionId?: string;
  position: PhysicsVector;
  velocity: PhysicsVector;
  spawnedAt: number;
  expiresAt: number;
  correlationId?: string;
  parentId?: string;
};

export type CombatProjectileDespawnFact = {
  runtimeId: string;
  projectileId: string;
  entityId: EntityId;
  reason: string;
  definitionId?: string;
  sourceActorId?: string;
  sourceEntityId?: EntityId;
  executionId?: string;
  finalPosition?: PhysicsVector;
  finalVelocity?: PhysicsVector;
  impact?: {
    disposition: "target" | "blocker";
    subject: { actorId?: string; entityId?: EntityId; bodyId?: string; colliderId?: string };
    point?: PhysicsVector;
    normal?: PhysicsVector;
    distance?: number;
  };
  correlationId?: string;
  parentId?: string;
};
```

`combat.projectile_spawned` 与 `combat.projectile_despawned` 分别派发上述 fact。Despawn 在 World entity
销毁前复制 final state；collision cleanup 保留最后一个候选的有界 impact，非 collision cleanup 不伪造
impact。Fact 不包含完整 projectile state、query/candidate、payload、tags、metadata 或 hit memory；需要读取
当前完整状态的工具使用 `getProjectile/listProjectiles/snapshot`。连续 transform 仍只存在于 World。

表现组合层通过 EventBus envelope 的 `correlationId/parentId` 以及 execution、ticket、projectile id，把 GAS Cue 的“播放什么”与 Combat fact/World state 的“在哪里、沿什么方向播放”关联起来，再交给 Animator、Renderer、Audio、Camera 或 UI。Combat fact 不能伪装成 GAS Cue；连续 projectile transform 也不能进入低频 EventBus 流。

## 运行顺序

推荐系统顺序：

```txt
ability/task intents
  -> GAS execution phase advance
  -> combat spawn and pre-physics commands
  -> Physics fixed step
  -> projectile sweep/contact collection
  -> target validation and effect delivery
  -> GAS effect/attribute update
  -> death/down/status reactions
  -> replication projection and presentation cues
  -> lifecycle cleanup
```

命中结果在一个 authority tick 内只结算一次。Contact event、sweep result 和 explicit target 不能为同一个 hit ticket 重复应用 effect。

## Data、Save 与 Multiplayer

- `combat.projectile`、`combat.delivery` 和可选 `combat.relationship-policy` 通过 DataRegistry 校验引用。
- Save 只保存仍需跨 checkpoint 存活的 projectile state、hit count、lifetime 和 stable identity；不保存 query result、contact cache 或 presentation cue。
- Multiplayer 按 projectile strategy 复制有界 fire/finish record、predicted entity state 或 authority-only state，
  并公开 ability execution 与有界 hit/cue fact；客户端可以运行所选策略的 provisional spatial simulation，但不
  重新提交 authority target validation 或 GAS effect。
- Client-only cosmetic projectile 必须明确标记为 presentation，不能与 authority projectile 共用 gameplay
  identity，也不能承担 collision、finish reason 或 hit position。

## Trace

Combat trace 至少覆盖：

- request accepted/rejected。
- candidate query 与裁剪数量。
- relationship/target rejection reason。
- hit ticket、effect application 与 duplicate suppression。
- projectile spawn/hit/pierce/bounce/expire/despawn。
- execution、physics、GAS 和 network correlation。

Trace 默认只保存摘要和稳定 id，不保存完整 query payload 或每帧 projectile transform。

## 最佳实践

### 模块集成

- 组合层把同一个 World、PhysicsHandle、GasHandle、identity resolver 和 DataRegistry 注入 Combat module；Combat 不创建自己的 PhysicsScene 或 GAS runtime。
- 需要由 GAS Ability 驱动 delivery 时，优先注册 `combat.ability-delivery` 并启用 Combat module 内置 bridge；只把动态瞄准或 socket 解析留给注入 policy，不在每个武器 handler 中重复监听 phase fact。
- Combat 安装顺序必须位于 intent/GAS commit 之后、Physics query 与 GAS effect resolution 的正确边界，并由 system-order test 锁定。
- Physics query adapter 可以省略 entity id；集成测试必须至少使用一个只返回 body/collider id 的真实 backend，锁定 World identity fallback。
- 新 delivery executor 通过统一 conformance 覆盖 target filtering、stable ordering、duplicate suppression、cleanup、trace 和 error code。
- benchmark 至少覆盖大量 projectile sweep、area query、pierce hit memory、entity churn 和 dispose retained state。
- Lifecycle event benchmark 必须真实开启 `emitProjectiles`，同时约束 spawn/despawn数量、p95/max、fact序列化大小、unsubscribe后回调和 dispose retained state；关闭事件的 hot-path benchmark不能替代该预算。
- Projectile network strategy conformance 分别覆盖 hitscan rewind window、kinematic fire/finish confirm/correct、
  predicted-spawn identity/generation 与 authority-only interpolation。Kinematic benchmark 必须真实运行 owner sweep、
  record churn/serialization 和 remote reconstruction；predicted-entity benchmark 必须真实运行 history capture/
  restore/resimulation，并限制每对象 bytes、history 上限和 dispose retained state。

### 模块使用

- 普通 Ability 通过 `combat.ability-delivery` 映射到 delivery；环境伤害、脚本和工具可以显式构造 `CombatDeliveryRequest`。两条入口必须复用同一个 runtime，不在每个武器 handler 中复制 raycast、owner ignore、effect apply 和 trace。
- 具体伤害公式、队伍关系、核心/设施规则通过注入 policy 实现，不向 Combat Core 增加游戏枚举。
- 动画、音频和镜头以 GAS Cue 为表现语义源，并按需关联 Combat 空间 fact；它们不反向决定 hit result。
- 高频 projectile transform 和 candidate list 留在 World/Physics/Combat runtime，不进入 React、EventBus 或完整网络 fact stream。
- 表现优先使用 `despawn.impact.point`；只有 backend 未提供 collision point 时才回退 `finalPosition`。消费者不能在收到 despawn 后反查已销毁 entity。
- 为每个 projectile 声明最窄且语义完整的 network strategy。具有已知静态 blocker 的 owner prediction 必须在
  本地 sweep tick 停止，任何 frame 都不能把弹体画到 blocker 后方；远端默认从 authority record/state 重建，
  不预测其未知输入。
- Owner 与 observer 必须从同一 authority record、generation/correlation visual identity 和 render definition
  产生最终移动弹体。Owner 使用 local predicted shot age，observer 使用 remote authority presentation time；
  两端屏幕位置不要求逐帧相等，但 authority 接管不能把 owner 拉回过期弹龄。匹配 trajectory 的绝对 fire-tick
  offset 不进入 correction，真实空间分叉才通过 Combat presentation transition 有界收敛。Observer 可以在声明的
  固定/adaptive remote presentation delay 上重建短命 record，但不能按“首次收到时间”逐弹重新启动一条本地
  时钟。已经早于该 delayed authority tick 完成的 record 不得再次从 fire position 播放，漏帧反馈由 bounded
  tracer/impact cue 表达。
