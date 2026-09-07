# GAS 模块设计

## 定位

GAS 是通用 Gameplay Ability System，负责 Actor、Attribute、Tag、Ability、Effect、Cue、Clue、Cooldown、Cost 和 trace。它不是只服务 RPG/ARPG 的战斗系统，而是面向多类型游戏的玩法状态与规则执行层。

相关包：

- `@gamekits/gas`

包归属：

- GAS 是 Game Module，不是 App Host Service。
- GAS 可以依赖 `@gamekits/world` facade，以便把高频运行时状态放进 ECS component。
- GAS 不依赖 Koota、Phaser、React、Tauri 或具体游戏 app。
- App Host 可以提供标准游戏模块入口，负责把 GAS module 注入 GameRuntime，但不把 GAS runtime 暴露成应用服务。

## 设计原则

```txt
Ability = activation + costs + cooldown + conditions + effects + cues
Effect = instant changes + duration + modifiers + periodic changes + tags
Cue = presentation intent, not gameplay result
Trace = explain ability/effect/state/cue chain
```

GAS 建立在 Data、World、TCA 之上：

- DataRegistry 管 Actor / Ability / Effect / Attribute / Tag / Cue 定义。
- World component 承载常见 actor 的运行时热数据。
- TCA 提供低频 trigger / condition / action 规则扩展。
- GAS Runtime 负责解释定义、操作 ECS-backed actor state、派发 cue 和记录 trace。

## Entity 与 Actor

常规游戏对象应优先使用 entity-backed actor：

```txt
World Entity
  ├─ GasActorComponent
  ├─ GasAttributesComponent
  ├─ GasTagsComponent
  ├─ GasAbilitiesComponent
  ├─ GasAbilityExecutionsComponent
  └─ GasEffectsComponent
```

这样移动、战斗、光环、Buff、查询等热路径能利用 ECS 查询和组件局部性。`@gamekits/gas` 只能依赖 `@gamekits/world` facade，不能依赖具体 ECS。

Actor 仍不等同于 Entity。长期模型必须同时支持：

- entity-backed actor：单位、怪物、建筑、投射物、区域触发器。
- detached actor：关卡导演、队伍、天气、全局剧情状态、经济系统、叙事线索。

推荐绑定结构：

```ts
export type GasActorComponentState = {
  actorId: string;
  definitionId: string;
  entityId?: EntityId;
};
```

`actorId` 可以等于 `entityId`，但不强制。业务模块负责在 entity despawn、save/load、场景切换时决定 actor 的移除、冻结或迁移策略。`GasRuntime.removeActor(...)` 显式解除 actor 与 entity-backed components；runtime tick 还会清理已经从 World despawn 或失去完整 GAS component set 的 stale mapping。GameRuntime dispose 时必须释放 handle、mapping 和 module-owned components。

需要由其他 GameModule 激活 ability、应用 effect 或查询 actor 时，组合层应创建 `GasHandle`，并同时传给标准 GAS module 与业务模块。Handle 不拥有 runtime，只允许一个 GAS module owner 绑定；未绑定、重复绑定或 dispose 后调用都产生稳定 `GameError`。GAS 不因此成为 App Host service。

## Data Definitions

GAS 数据定义保持游戏类型无关：

- `GasActorDefinition`
- `GasAttributeDefinition`
- `GasTagDefinition`
- `GasAbilityDefinition`
- `GasEffectDefinition`
- `GasCueDefinition`

Attribute 使用通用 key-value，不写死 hp/mp/stamina。Tag 是通用状态事实，不写死 buff/debuff。Ability 是可激活行为，不等同于技能按钮。Effect 是状态变化与持续行为的统一表达。

## Ability

Ability 激活流程：

```txt
activation request
→ actor/target resolution
→ tag requirement / blocked tag
→ cost check
→ cooldown check
→ execution requested / preparing
→ cost and cooldown commit
→ active / apply configured effects
→ recovering
→ completed or cancelled
→ emit phase/cue/events and trace
```

Ability 可以由输入、AI、TCA rule、剧情、回合开始、区域进入、碰撞、计时器或任意低频事件触发。高频逐帧逻辑不应通过 TCA 扫描规则完成。

Ability execution lifecycle 使用 `requested → preparing → committed → active → recovering → completed/cancelled`。Definition 可以声明各 phase 时长、cost/cooldown commit policy、interrupt tags 和 cancellation policy；instant ability 等价于零时长 phase，但仍经过同一 execution/trace contract。

`requestAbilityExecution(...)` 是新调用路径，返回可查询的稳定 execution id。同一 `requestId` 与同一 actor/ability/target 重试时只返回已有 execution，不重复扣费；同 id 却不同请求会稳定拒绝。`getAbilityExecution(...)`、`listAbilityExecutions(...)` 和 `cancelAbilityExecution(...)` 同时由 Runtime 与 module-bound Handle 提供。原有 `activateAbility(...)` 保留为即时兼容入口：零时长 ability 仍在同一次调用内同步完成，有时长的 ability 返回已接受后的当前 phase。未声明 `execution` 的旧即时 Ability 使用新的内部 state/result contract，但不新增 phase/completed EventBus facts 或 phase trace；只有显式 execution 才输出完整 phase event/cue/trace，避免兼容内容挤占有界玩法与诊断窗口。

Runtime 必须对每 Actor 的 active execution 数量和 recent terminal history 设硬上限。Ability 可用 `maxConcurrent` + `reject-newest/cancel-oldest` 定义自身并发 policy；Runtime 的 `maxActivePerActor` 是不可被内容绕过的保护上限。Active state 放在按需挂载的 `GasAbilityExecutions` component，空闲 Actor 不持有空 component；终态只保留有界诊断历史，dispose 后不得留下 execution、request dedupe 或 entity mapping。

GAS 只拥有 ability phase、cost、cooldown、tag、effect 和 cue。瞄准、目标候选、melee/hitscan/projectile/area delivery、阵营关系和命中去重属于 `@gamekits/combat` 或游戏注入 policy。Gameplay timing 不能等待 renderer animation marker；Animator Core 根据 execution phase 恢复表现相位。

## Effect

Effect 支持：

- instant effect
- duration effect
- periodic effect
- attribute modifier
- granted / removed tags
- stack policy
- expire cleanup

首层协议不绑定具体战斗类型。伤害、治疗、建筑增益、区域 aura、生产效率、剧情标记、天气影响都应能用同一套 Effect 模型表达。

有 lifecycle 的 Effect 默认使用有界单栈并在重复应用时刷新最早实例。需要多栈时通过 `stacking.limit` 显式声明上限，并选择 `reject-newest`、`refresh-oldest` 或 `replace-oldest`；还可以选择按 effect 或同 source 匹配。Runtime 追踪 tag grant source，某个 effect 过期或被替换时只能移除自己贡献的 tag，不能误删 actor、装备或其他 effect 仍在提供的同名 tag。

Periodic effect 的 `periodMs` 必须是严格正数，避免追赶循环无法推进。Effect system 仍会查询 entity-backed actor 以处理 stale mapping，但没有 active effect 或本 tick 没有 periodic/expire 变化的 actor 不写回 World；只有状态实际变化时才持久化相关 GAS components。

## TCA 集成

GAS 复用 TCA，不重新实现规则系统。GAS 自己提供 TCA definitions，例如：

- `gas.actor.has_tag`
- `gas.attribute.compare`
- `gas.execution.phase`
- `gas.activate_ability`
- `gas.cancel_ability_execution`
- `gas.apply_effect`
- `gas.modify_attribute`

这些 definitions 由 GAS package 提供，TCA core 不硬编码 GAS 业务。普通 app 通过 App Host 标准游戏模块或 `createGasModule(...)` + `createTcaModule(...)` 组合启动。

## Cue / Presentation

Cue 描述表现意图，不决定 gameplay 结果。

示例：

- floating text
- screen shake
- animation.play
- particles.emit
- sound.play
- ui.toast

GAS 不直接调用 Renderer、Camera、Audio 或 UI adapter。Cue 通过 EventBus、Renderer command bridge、UI action bridge 或后续 DevTools 被消费。

`@gamekits/fx` 不作为默认独立业务包。Cue/Presentation 由 GAS、Renderer、UI、Camera 共同消费。

Ability execution 与 Effect 是 Cue 的两个标准来源：

- `phaseCues` 表达 `preparing/committed/active/recovering/completed/cancelled` 阶段的表现意图，例如前摇、释放、后摇和取消反馈。
- Ability `cues` 在 active 阶段表达能力已经生效的通用表现。
- Effect `cues` 只在 effect 成功 apply、refresh 或 replace 后发出，表达伤害、治疗、状态附加和受击等结果表现；effect 被拒绝时不能误发成功 Cue。

GAS Cue 是通用 gameplay presentation intent 的唯一语义来源，Combat、Animator、Renderer、Audio、Camera 和 UI 不应再建立一套同义 Cue registry。Cue 不承载动态射线端点、命中点、法线、弹道、遮挡点或每帧 projectile transform；这些空间事实由 Combat/Physics/World 保持，并通过同一 `correlationId`、execution id、hit ticket 或 projectile id 在 presentation bridge 中与 Cue 关联。表现层可以在没有精确空间事实时退化到 source/target Actor 的 entity transform，但不能反向影响 effect 是否生效。

## Trace

GAS trace 需要能关联：

- ability activation / rejection
- cost / cooldown / tag condition
- applied effect
- periodic action
- cue dispatch
- attribute/tag state change
- 关联的 TCA rule trace

Trace 是 GAS 的核心能力之一，因为数据驱动玩法如果不可解释，后续编辑器和 DevTools 会很难维护。

Ability、Effect、Attribute、Tag 和 Cue 操作接受可选 correlation context。每个派生 trace 保留同一 `correlationId`，并把直接触发它的 GAS/TCA/network trace 记录为 `parentId`；派生 EventBus fact 使用相同 envelope metadata，不要求 gameplay payload 携带调试字段。

Trace store 可配置轻量 entry hook，由 App Host 组合层把已物化 trace 增量映射到统一 DevTools correlation source。Hook 和 error reporter 的异常会被 store 隔离，不能让 ability/effect/attribute 操作失败。GAS runtime 不直接依赖 DevTools，也不为 UI 每帧复制 actor 或完整 trace snapshot；通用 DevTools 映射默认不透传任意 `details`。

## Save 边界

`createGasSaveContributor({ handle })` 通过 module-bound `GasHandle` 捕获 elapsed、actor attributes/tags/abilities/cooldowns、active effects 和 non-terminal ability executions。Restore 使用 `SaveRestoreContext.entityMap` 重绑定 entity-backed actor，保留 detached actor，并同步 active effect/execution id sequence 与 request dedupe；Actor、Ability、target、phase、timestamp、并发上限和 request id 必须在替换 runtime state 之前完成预校验，无效 checkpoint 不得留下半恢复状态。旧 checkpoint 没有 `executions` 时按空列表兼容。Trace、terminal history 与 EventBus 历史不进入存档。World contributor 不应重复保存 GAS-owned components。

## 与 DataPack 的关系

Actor、Attribute、Tag、Ability、Effect、Cue、Clue 都通过明确的 DataType 注册和校验，例如 `gas.actor`、`gas.ability`、`gas.effect`。DataPack 可以混合这些内置类型和游戏自定义类型，例如 `game.hero` 或 `game.monster`。

GAS 不要求游戏必须按 GAS 类型组织内容文件。真实项目可以把某个 hero 的 `game.hero`、`gas.actor`、`gas.ability`、`render.object` 和 asset references 放在同一个业务文件里，也可以拆到不同 DataPack。引用关系必须在 DataPack load 阶段通过 DataRef / AssetRef 检查。

## 最佳实践

### 模块集成

- GAS module 集成负责从 DataRegistry 读取 definitions、创建 ECS-backed runtime、注册 effect tick system、合并 TCA definitions、写 trace，并在 GameRuntime dispose 时清理。多个业务模块需要 GAS 时共享同一个 module-bound `GasHandle`，不各自创建 runtime 或通过全局变量捕获内部实例。
- 修改 ability/execution/effect runner、stack policy、entity actor mapping 或 tick persistence 时运行 `corepack pnpm bench:gameplay:check`。基准分别覆盖 ability→effect→attribute→cue、bounded stacking、1,000 idle/active executions、trace disabled/enabled、idle/periodic entity actor update 和 stale entity cleanup；预算用于发现数量级退化，不替代目标平台 profiler。
- Actor 与 EntityId 的绑定、save/load entity mapping、spawn/despawn 策略由 game module 或 Save contributor 明确处理；业务 despawn 优先显式 `removeActor`，runtime 的 stale mapping cleanup 只是生命周期安全网。
- 修改 GAS checkpoint capture/restore、entity remap、active effect 或 ability execution continuation 时运行 `corepack pnpm bench:checkpoint:check`；GAS case 必须同时携带 1,000 actors、500 active effects 和 500 active executions，不得只测空 execution 存档。
- 修改 trace entry hook 或跨模块 correlation mapping 时运行 `corepack pnpm bench:diagnostics:check`；timeline、domain trace store 和 correlation summary 必须各自有界。
- 测试应覆盖 execution phase ordering/zero-duration/request dedupe/cancel/interrupt/concurrency、cost/cooldown/tag requirement、effect stack/expire/periodic、attribute modifier、cue dispatch、entity binding、save/restore 边界和 TCA integration。

### 模块使用

- periodMs 必须为有限正数，Data 校验和 Runtime 均执行检查。周期 tick 只发生在到期前（tickTime < expiresAt），大 delta 补 tick 不得越过到期边界。
- Ability 在支付成本、写入冷却、发送成功事件前解析全部 effect 目标和引用。准备中的 execution 在 commit 前再次检查目标和 effect 定义，失效时取消且不提交尚未支付的成本/冷却。显式 requested commit 已经支付的成本，以及业务回调在提交后的副作用，都不自动回滚。

- GAS 是通用 actor/ability/effect runtime，不写死 RPG、卡牌、塔防或动作游戏概念。Attribute、Tag、Ability、Effect 都使用游戏可定义 key。
- Actor 可以绑定 EntityId。热状态应尽量落在 World component 上，让系统查询和批量更新利用 ECS 性能；Data definitions 保留配置自由度。
- `actorId` 不必须等于 `entityId`。需要 save/load、spawn/despawn、场景迁移时，使用稳定 actor id 和 entity mapping 明确恢复关系。
- Ability 激活只做低频语义行为。持续移动、碰撞、寻路、渲染动画和 camera smoothing 不应被包装成每帧 ability。
- Effect 的持续 tick 可以由 system 推进，必要时复用 TCA action；不要在 GAS core 里复制一套规则引擎。Duration/periodic effect 必须使用有界 stacking policy，不能让 active effect collection 随重复应用无界增长。
- Cue/Presentation 只表达表现意图，不决定 gameplay 结果。GAS 不直接调用 Renderer、Audio、Camera、React 或 Phaser。
- Trace 必须和 DataType、actor、ability、effect、cue、TCA rule 关联起来。跨 Multiplayer、Physics、TCA、GAS 和 Cue 的操作传播 correlation/parent；数据驱动玩法不可解释时，编辑器和 DevTools 会失去维护能力。
