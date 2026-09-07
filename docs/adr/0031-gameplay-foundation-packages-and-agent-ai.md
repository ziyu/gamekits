# ADR 0031: Gameplay Foundation Packages And Agent AI

Status: Accepted on 2026-07-17.

Audio 的初始 package 边界保留；event/instance、mix、parameter、emitter 和 adapter-authored event 公共模型由 ADR 0033 细化并取代本 ADR 中较早的 voice-command 描述。

## Context

Outpost Siege 已经证明 World、Physics、GAS、TCA、Multiplayer 和 Renderer 可以组成一条 server-authoritative 战斗链，但“存在一条链”还不足以支撑完整游戏。可靠的武器、投射物、技能阶段、动画、AI、导航和音频需要稳定生命周期、数据协议、trace、测试与性能预算。

这些能力若继续只写在 Outpost app 内，会出现几类问题：

- 每个游戏重新实现 projectile sweep、命中去重、伤害交付、技能前摇/生效/后摇和取消。
- 玩法时间依赖 Phaser 动画回调，headless authority 与客户端表现无法共享确定性规则。
- AI 同时持有目标选择、寻路、物理移动和技能执行，形成不可测试的大循环。
- 第三方 AI runtime 的 entity、vehicle 或 actor 成为 World / Physics / GameRuntime 之外的第二套事实源。
- 音频、动画和粒子继续以 app-specific native call 拼接，无法统一资源、生命周期、多人 cue 去重和 diagnostics。

现有架构曾把底层 Animation playback 与高层 Animator control 视为同一项不单独成包的能力。完整角色表现需要语义 Animator graph、分层 one-shot、marker、远端相位恢复和批量 controller，已经超出单个 Renderer command 的职责，因此需要明确拆分：Animator 成为可选 toolkit，Animation clip/mixer 继续归资源与后端播放边界。

Outpost 普通敌人数量高、行为目标有限且需要清晰预兆。逐 agent GOAP 会为每次决策构造世界状态和动作计划，带来不必要的运行时与调试复杂度；纯行为树又容易把目标优先级、攻击执行和导航混成大型树。XState 提供完整 statechart/actor runtime，Yuka 提供 entity、goal-driven agent、steering 与 navigation，但直接采用它们作为 authority AI owner 都会与 GameKits 的 World、Physics 和批量 system lifecycle 重叠。

## Decision

### 新增可选玩法基础包

GameKits 的长期包结构增加以下可选 package：

- `@gamekits/combat`：在 World + Physics + GAS 之上统一 effect delivery、target relationship、hit resolution、projectile/hitscan/area/melee executor、命中去重和 combat trace。它不定义具体武器、敌人、生命字段或数值公式。
- `@gamekits/animator-core`：定义语义 Animator parameter、graph、layer、transition、one-shot、marker、playback snapshot 和 controller lifecycle。具体 animation clip/mixer 仍由 Renderer Adapter 或 Driver runtime slice 执行。
- `@gamekits/ai-core`：定义 perception memory、blackboard、utility consideration、goal selection、task lifecycle、interrupt policy、预算调度和 AI trace。它不拥有 entity、physics body、pathfinding backend 或具体敌人行为。
- `@gamekits/navigation-core`：定义 navigation world、path/route query、agent profile、动态 obstacle/cost revision、请求预算、route cache 和 trace。具体 graph/grid/navmesh/search library 通过 adapter 接入。
- `@gamekits/audio-core`：定义 audio bus、listener、voice/source、playback command、并发/优先级、snapshot 和 diagnostics。Phaser 等完整 runtime 通过 Driver 暴露 AudioAdapter。

这些 package 都是可选组合能力，不进入 GameRuntime 内核，也不让无战斗、无 AI 或无音频的 app 安装额外 runtime。

### 扩展已有 Core，而不是建立平行实现

- GAS 增加通用 ability execution lifecycle：`requested → preparing → committed → active → recovering → completed/cancelled`，并定义 cost/cooldown commit policy、interrupt/cancel 与 phase fact。Target acquisition、projectile 和 damage 不进入 GAS。
- Asset 保持资源事实源，补全 atlas/audio/animation manifest 所需的稳定 metadata 与 adapter 委托。
- `driver-phaser` 补充 atlas/audio loader 与共享 audio runtime slice；`renderer-phaser` 补充 animated-sprite、clip binding 和 particle command。它们不得创建第二个 Phaser runtime。
- Multiplayer 继续复制 authority gameplay phase 与有界 cue fact，不复制 native animation frame、audio voice 或 particle object。
- App Host 只为 session-scoped package 提供薄的标准 GameModule 装配 helper；实际 runtime 和语义仍归各自 domain package。

### Agent AI 使用 Utility Selection + Task State Machine

Outpost agent AI 采用四层模型：

```txt
perception + shared spatial facts
  -> scored utility goals
  -> interruptible task state machine
  -> movement / aim / ability intents
  -> Navigation / Physics / GAS / Combat execution
```

- Utility scorer 选择 `attack-player`、`attack-core`、`disable-structure`、`reposition`、`retreat` 等目标，使用 hysteresis、最低承诺时间和 cooldown 防止频繁抖动。
- Task state machine 执行 `acquire → move → telegraph → commit → recover` 等确定性阶段，并负责中断和失败恢复。
- Navigation 只返回路径/方向事实；Physics 只执行移动和碰撞；Combat/GAS 只执行已经提交的合法能力。
- 感知、决策和路径请求按预算错峰，移动/避障保持高频 system；boss phase 和 encounter 仍由 app-local director + TCA 处理。

GOAP 不作为 Outpost 普通 agent 的默认规划器。`@gamekits/ai-core` 保留可选 `AiPlanner` 扩展点；只有第二个游戏证明需要动态组合多个前置条件动作时，才允许新增 GOAP/HTN adapter。

### 第三方 AI 库边界

第三方库只能处于 adapter 或受控算法实现边界：

- XState 可以用于低数量、非热点的 workflow 或 tooling，但不作为大量 ECS agent 的默认 runtime。
- Yuka 的 graph/search、steering 或 navmesh 算法可以作为 navigation/steering adapter 候选；Yuka `GameEntity`、`Vehicle`、goal runtime 和 world update 不能替代 GameKits World、Physics 或 AI Core。
- 任何候选 adapter 都必须先通过相同 conformance、确定性 fixture 和 250/1,000 agent benchmark，再进入正式组合。

### Package 提升门槛

Outpost 可以作为第一个真实消费场景，但 package 公共协议需要同时满足：

1. 类型与错误码中没有 Outpost、Ranger、Raider、turret、wave 等业务概念。
2. 至少一个第二场景 fixture 或 Abyss Delve 消费同一协议。
3. 提供 memory/fake backend、conformance、dispose/retained-state test、trace 和 benchmark。
4. App 不能保留与新 Core 同名的平行 runtime；迁移完成后删除 app-local substitute。
5. 第三方库类型只存在于 adapter/driver/native boundary。

## Consequences

Positive consequences:

- Outpost 的实现顺序会先补通用缺口，再构建具体武器、敌人和关卡，后续游戏可复用相同基础。
- AI 目标选择、动作执行、导航和物理各有单一事实源，能够独立测试和预算。
- Gameplay phase 驱动 authority 与表现，动画 marker 不会决定伤害或技能是否合法。
- 投射物、Animator controller、AI scheduler、path request 和 audio voice 都具备明确上限与 trace。
- Phaser 继续由 Driver 单一持有，不因新增动画/音频创建平行 runtime。

Costs and constraints:

- 需要新增五个可选 facade/toolkit package，并扩展 GAS、Asset、Renderer Phaser、Driver Phaser 和 App Host 的装配面。
- Package 不能只为 Outpost 当前行为设计；公共协议必须用第二场景 fixture 证明通用性。
- Utility + task 模型不会自动产生任意复杂计划；需要多步世界规划的未来游戏仍可能增加 GOAP/HTN adapter。
- 动画与音频的客户端结果不进入 authority snapshot，自动化测试需要同时覆盖语义 command 和真实 Phaser adapter smoke。

## Rejected Alternatives

### Keep all systems app-local

Rejected because ability phase、effect delivery、projectile lifecycle、Animator graph、AI scheduling、navigation query 和 audio playback 都会在其他游戏重复，并会迫使 app 复制底层 lifecycle。

### Use per-agent GOAP for every enemy

Rejected because Outpost 的普通敌人目标少、数量高、动作阶段固定。完整 planning 增加 CPU、allocation 和调试空间，却没有产生与成本相称的玩法收益。

### Use one behavior tree for decision and execution

Rejected because大型树容易把 utility priority、navigation、attack timing 和异常恢复混在一起。Goal scoring 与 task execution 分离后，两者可以独立 trace、调优和限频。

### Let animation events drive hit timing

Rejected because headless server 不运行 renderer，远端客户端也可能丢 cue 或晚加入。Authority ability phase 是玩法时间源，animation marker 只驱动脚步声、枪口闪光等表现事件。

### Adopt Yuka or XState as the complete AI owner

Rejected because完整第三方 entity/actor update lifecycle 会与 GameKits World、Physics、GameRuntime 和批量 ECS system 重叠。算法级 adapter 仍被允许。

## References

- Architecture: `docs/architecture.md`
- Core-first ownership: `docs/adr/0026-core-first-domain-semantic-ownership.md`
- Renderer module: `docs/modules/renderer.md`
- GAS module: `docs/modules/gas.md`
- Physics module: `docs/modules/physics.md`
- [Yuka official documentation](https://mugen87.github.io/yuka/)
- [XState official repository and documentation](https://github.com/statelyai/xstate)
