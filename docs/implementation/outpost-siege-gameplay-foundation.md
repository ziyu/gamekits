# Outpost Siege Gameplay Foundation

Status: Active.

统一 app 集成的历史执行记录见
[`outpost-siege-foundation-integration.md`](./outpost-siege-foundation-integration.md)。玩家操作、角色、武器、
复制和表现的当前执行记录见
[`outpost-siege-player-experience-rebuild.md`](./outpost-siege-player-experience-rebuild.md)。本文只保留底层库建设与
review checkpoint，不继续追加 app 玩家体验状态。

## Goal

把 Outpost Siege 从“authority combat slice 已接线”推进为完整、坚实、可复用基础之上的可玩游戏。所有缺失的通用能力优先进入对应 Core/新 package，Outpost 只保留游戏内容、policy、encounter 和 presentation mapping。

长期玩法设计入口：`docs/apps/outpost-siege/README.md`。

重大边界决策：`docs/adr/0031-gameplay-foundation-packages-and-agent-ai.md`。

## Current Capability Audit

| 领域              | 已存在基础                                                                                  | 主要缺口                                                                          | 归属决策                                         |
| ----------------- | ------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------ |
| World / identity  | Entity-backed actor/projectile/buildable、identity registry                                 | 角色/武器/AI/animation component 尚不完整                                         | Outpost component + reusable module binding      |
| Physics           | Rapier 2D、layout、ray/shape/overlap query、fixed step、interpolation                       | Projectile 当前 app 手写 ray sweep；character/steering/attack shape 缺统一交付    | Physics 保持；交付进入 Combat                    |
| GAS               | Actor/attribute/tag/ability/effect/cooldown/cost/cue/trace；execution lifecycle 已实现      | 等待独立库评审通过后才能进入 Combat                                               | 扩展 `@gamekits/gas`                             |
| TCA               | Event index、condition/action、trace、once/save                                             | 无需新高频职责                                                                    | 继续只做低频反应/目标/phase                      |
| Combat            | `@gamekits/combat` 已具备通用 delivery、target policy、GAS hit 与 entity projectile runtime | Outpost 仍使用 app-local rifle/shock/turret/enemy attack，尚未迁移到通用 executor | 评审 Combat 后迁移 app                           |
| AI                | `nearestPlayer` + 直线 velocity + range overlap + GAS attack                                | 无感知、目标评分、task、telegraph、slot、预算、stuck recovery                     | 新增 `@gamekits/ai-core`                         |
| Navigation        | Physics obstacle，arena collider                                                            | 无 path/route、动态 blocker、cache、request budget；当前敌人会直线撞墙            | 新增 `@gamekits/navigation-core` + graph backend |
| Renderer          | RenderObject lifecycle、sprite/container、native state writer                               | Phaser 无 animated-sprite/clip registration/particle command；角色只是静态纹理    | 扩展 `renderer-phaser`                           |
| Animator          | Render definition 有 animation envelope、Phaser 有最小 `animation.play`                     | 无 graph/controller/layer/marker/phase/late-join restore/benchmark                | 新增 `@gamekits/animator-core`                   |
| Asset             | image/spritesheet type 与 AssetManager                                                      | Phaser loader 不支持 Core 已声明的 atlas/audio；缺 animation manifest workflow    | 扩展 Asset metadata + `driver-phaser`            |
| Audio             | Asset Core 有 `audio` type                                                                  | 无 Audio facade、loader/runtime、bus/voice/concurrency/cue mapping                | 新增 `@gamekits/audio-core` + Phaser slice       |
| Multiplayer       | Room authority、Schema、managed replication、prediction/playback                            | 未复制完整 ability phase、cue、match/AI/facility 状态                             | 扩展 app Schema；Core 只补通用 track/cue 缺口    |
| Match / encounter | 初始 3 enemy spawn 与 combat counters                                                       | 无完整 phase、director、boss、core、node、extraction、results                     | Outpost app-local                                |
| UI                | Lobby/HUD 基础与 DevTools shell                                                             | 无完整页面状态、world telegraph、build/protocol/revive/results                    | Outpost React/presentation，复用 UI Core         |

审计证据：

- `authority-combat.ts` 仍持有 Dash、Shock、Turret 常量与 ability switch，敌人使用 `nearestPlayer` 直线 steering。
- `renderer-phaser/object-factory.ts` 只声明 `debug.square`、`sprite`、`container`；command handler 只处理最小 `animation.play`。
- Phaser Driver asset loader 只支持 image/spritesheet，虽然 Asset Core 已声明 atlas/audio 类型。
- 本工作流启动时 Combat package 已完成，而 AI、Navigation、Animator 与 Audio package 尚未创建；对应缺口现已在后续 review checkpoint 中关闭。

## Required Package Work

### `@gamekits/gas` Ability Execution Extension

Deliverables:

- `GasAbilityExecutionDefinition/State/Result` 与稳定 execution id。
- `requested/preparing/committed/active/recovering/completed/cancelled` phase。
- Cost/cooldown commit policy、tag interrupt/cancel、phase event/cue/trace。
- Entity-backed hot state、handle query/cancel、save/restore。
- Instant ability 使用同一 contract 的兼容行为。
- Data validation、TCA definitions、DevTools summary。

Tests/bench:

- phase ordering、zero-duration、cancel before/after commit、cost/cooldown、duplicate request、actor removal、save restore。
- 扩展 `bench:gameplay` 覆盖 1,000 idle / active executions 与 trace disabled/enabled。

Gate:

- Outpost 不保留独立 ability timer；Abyss/fixture 使用同一 execution API 完成一个非战斗或不同战斗 ability。

Review checkpoint (2026-07-17):

- 已实现 execution definition/state/result、稳定 id/request dedupe、全 phase、commit/cancel/interrupt/concurrency policy、entity-backed active state、Handle/TCA/Save/trace 和旧即时 ability/checkpoint 兼容。
- 非战斗 fixture 使用 `ability.scan` 经过同一 execution contract 执行 progress effect；本 checkpoint 未修改 Outpost 或开始 Combat package。
- GAS 定向测试 30/30；全仓 `test` 73/73 tasks、`build` 40/40 tasks、`lint` 73/73 tasks 通过。全仓格式检查仅被本 checkpoint 开始前已存在的 `.claude/*`、`AGENTS.md`、`CLAUDE.md` 8 个范围外文件阻塞；GAS/基准/本文档相关文件格式检查通过。
- `bench:gameplay:check` 17/17 budgets 通过：1,000 idle actors 为 1.15 ms/tick，1,000 active executions 在 trace disabled/enabled 时分别为 4.14/3.97 ms/tick，recent execution 保留 256，dispose 后为 0。`bench:world` 同时通过：10,000 entities spawn/add 9.85 ms，5,000 moving entities query/update 5.66 ms。
- `bench:checkpoint:check` 7/7 budgets 通过：1,000 actors + 500 active effects + 500 active executions 捕获 0.97 ms/次、预校验并恢复 5.96 ms/次，恢复后仍保留 500 executions。
- 全仓首轮回归发现旧即时 Ability 的零时长 phase facts 会挤占 Abyss 有界 timeline；已收紧兼容语义为“内部使用统一 execution state/result，显式声明 execution 才对外发布完整 phase event/cue/trace”，Abyss 8 files / 17 tests 与最终全仓回归均通过。
- 评审门保持关闭：只有 GAS 包完整验证证据通过后，才开始下一个库。

### `@gamekits/combat`

Deliverables:

- Delivery request、relationship/target policy、stable candidate sorting。
- Direct/melee/hitscan/area/projectile executor。
- Entity-backed projectile、ray/shape sweep、hit ticket/memory、pierce/bounce/stop、lifetime/cleanup。
- GAS effect application、Physics/World identity mapping、trace/fact。
- GameModule/handle、DataTypes、memory/fake fixture、Save contributor。

Tests/bench:

- Friendly ignore、wall block、duplicate suppression、multi-hit、effect rejection、despawn race、stable ordering。
- 300/1,500 projectile 与 mass-hit/entity churn benchmark；dispose retained entity/map 为 0。

Gate:

- Outpost rifle、Shock、enemy melee、turret 都经同一 delivery executor；第二 fixture 使用 area/heal 或不同 relationship policy。

Review checkpoint (2026-07-17):

- 已实现 `@gamekits/combat`，公共协议不包含 Outpost、武器、角色、阵营或生命字段；effect 只通过 GAS 提交，空间候选只来自 Physics，projectile 是同一 World 中带标准 Physics component 的 entity。
- Direct、melee、hitscan、area、contact/ray-sweep/shape-sweep projectile 共用 relationship/candidate/hit pipeline；包含 stable sorting、body/collider → World entity fallback、hit ticket、bounded hit memory、stop/pierce/bounce、execution ownership、lifetime/bounds/despawn race cleanup。
- 已提供 DataTypes、trace/低频 fact、GameModule/Handle、Save contributor 和可复用 facade conformance；第二 fixture 使用 area heal + support relationship policy，未引入游戏专属枚举。
- Combat 定向测试 11/11 通过，覆盖 friendly ignore、wall block、stable ordering、direct/melee/area/hitscan、effect rejection、request/hit dedupe、pierce/bounce/contact/shape sweep、lifetime、despawn race、entity-mapped restore，以及真实 Koota + Rapier2D + GAS 模块组合。全仓 `test` 74/74 tasks、`build` 41/41 tasks、`lint` 74/74 tasks 通过；lint 仅回放两个范围外旧 warning。
- `bench:combat:check` 9/9 budgets 通过。300 moving projectiles 的 mean/p95/max 为 0.49/0.68/0.80 ms/tick；1,500 moving projectiles 为 3.17/3.96/4.95 ms/tick（2.11 µs/projectile-tick）；1,000 candidate mass hit 为 1.91 ms mean、3.35 ms p95；300 projectile spawn+cancel churn 为 4.78 ms mean、5.84 ms p95。所有 dispose retained entity/map 均为 0。
- `bench:world`、`bench:gameplay:check`、`bench:physics:check`、`bench:checkpoint:check` 同时通过。全仓格式检查仍只被本 checkpoint 开始前已有的 `.claude/*`、`AGENTS.md`、`CLAUDE.md` 8 个范围外文件阻塞；Combat、benchmark、模块设计和本文档的 scoped format 通过。
- 本 checkpoint 按单库评审门停止，不迁移 Outpost，也不开始 Navigation/AI/Animator/Audio。Outpost migration gate 仍保持关闭，待本库评审通过后进入下一步。

### `@gamekits/navigation-core` + Graph Backend

Deliverables:

- NavigationWorld/Handle、agent profile、project/path/route request、revision、cancel、snapshot/trace。
- Authored graph backend、goal-keyed reverse route field、dynamic edge blocker/cost、cache/negative cache。
- Request scheduler budget、stable result ordering、layout DataType/content validator。
- Physics/Renderer-independent memory conformance。

Third-party gate:

- 用 Outpost graph profile 对比窄自有 graph backend 与 Yuka graph/search adapter 的 build size、1,000 agent route sample、dynamic invalidation、allocation 与 deterministic result。
- 只有 Yuka 算法 slice 明显优于且不引入 `GameEntity/Vehicle/World` 语义时才建立 `navigation-yuka` adapter；不让 Yuka 成为 agent runtime owner。

Tests/bench:

- Required path、projection、unreachable、cancel、revision、partial invalidation、cache limit、burst fairness。
- 250/1,000 agent route sample、buildable blocker churn、dispose retained state。

Review checkpoint (2026-07-18):

- 已实现 `@gamekits/navigation-core` 与 `@gamekits/navigation-graph`。Core 提供 backend-neutral request、projection/path/route、revision、scheduler budget、cache、trace/snapshot、Handle/GameModule 与 conformance；Graph backend 提供 authored graph、goal-keyed reverse route field、stable tie-break、动态 blocker/cost 和按 revision 失效。
- Navigation 定向测试 14/14 通过，覆盖 required path、projection、unreachable、cancel、scheduler fairness、negative/cache limit、revision、局部 invalidation、动态 blocker/cost、稳定结果和 dispose retained state。
- `bench:navigation:check` 7/7 budgets 通过：250/1,000 agent route sample 分别为 2.94/1.97 µs/sample，1,000 request burst 为 61.51 ms，blocker churn 为 2.19 ms/cycle，dispose retained state 为 0。
- Yuka gate 使用 npm stable `0.7.8` 做窄 slice 对照。tree-shaken/minified 的 Graph + Dijkstra slice 为 57,215 bytes，本仓 graph backend 为 6,283 bytes；32×32 graph、1,000 shared-goal route 的 Yuka 重算约 212 ms，本仓 reverse route field 首次/重复约 41/35 ms。两者结果均 deterministic，但 Yuka 无 revision/partial invalidation protocol，移除 edge 后既有 path 会保持陈旧；其临时分配并未形成足以抵消体积、失效语义和性能差距的优势。因此不新增 `navigation-yuka`，也不让第三方 runtime 拥有 agent。

### `@gamekits/ai-core`

Deliverables:

- Agent binding、sensor/perception fact、bounded memory/blackboard。
- Utility consideration/curve、goal selector、hysteresis/commit/cooldown。
- Task executor lifecycle、interrupt/failure/timeout/backoff、intent sink。
- Deterministic budget scheduler、LOD class、trace/snapshot/save。
- DataTypes 与 definition registry；memory fixture/conformance。

Tests/bench:

- Score breakdown、tie-break、switch threshold、target invalid、task cancel、ability reject、path failure、agent removal。
- 250 normal / 1,000 mixed-LOD agent，记录 perception/decision/task/path span、最大单 tick spike 与 retained state。

Gate:

- Raider/Gunner/Saboteur/Brute 只注册 data/consideration/task，不各自复制 update loop。
- 不引入 per-agent GOAP、XState actor 或 Yuka GameEntity；未来 planner 只通过 `AiPlanner` adapter。

Review checkpoint (2026-07-18):

- 已实现 `@gamekits/ai-core`：agent binding、bounded perception/blackboard、Utility consideration/curve、goal hysteresis/commit/cooldown、Task lifecycle、deterministic budget + LOD scheduler、intent sink、trace/snapshot/save、DataTypes、Handle/GameModule 与 memory conformance 均保持 World/Physics/Navigation backend-neutral。
- AI 定向测试 12/12 通过，覆盖 score breakdown、stable tie-break、switch threshold、invalid target、task cancel/failure/timeout/backoff、ability/path rejection、agent removal、save/restore 和 bounded trace/state。
- `bench:ai:check` 8/8 budgets 通过：250 normal agents 的 p95 为 0.72 ms/tick，1,000 mixed-LOD agents 的 p95 为 2.22 ms/tick；dispose retained state 为 0。
- Core 未引入 GOAP、XState actor、Yuka GameEntity 或游戏专属 archetype；Raider/Gunner/Saboteur/Brute 仍属于后续 Outpost data/policy integration。

### `@gamekits/animator-core`

Deliverables:

- Clip/graph/binding DataTypes、parameter、state、layer、transition、one-shot、marker。
- Controller GameModule、dirty update/batch frame、trace/snapshot/reset。
- Gameplay execution phase mapping、late join/current phase rebuild、local anticipation/cancel。
- Backend-neutral AnimationPlaybackAdapter + memory conformance。

Phaser work:

- Driver loader 支持 atlas、spritesheet manifest。
- Renderer 支持 animated-sprite、native clip creation/binding、particle emitter/command。
- 同一 Phaser runtime/cache，不创建独立 Scene/Game。

Tests/bench:

- State/transition/layer/interrupt、marker dedupe、phase seek、generation reset、missing clip fallback。
- 500 active / 1,000 idle controller、backend batch write、dispose retained state。

Review checkpoint (2026-07-18):

- 已实现 `@gamekits/animator-core`：clip/graph/binding DataTypes、parameter/state/layer/transition、one-shot、marker dedupe、phase mapping、late join/seek、generation reset、dirty batch、trace/snapshot、Handle/GameModule，以及 backend-neutral playback adapter/conformance。
- Animator 定向测试 10/10 通过；`bench:animator:check` 8/8 budgets 通过：500 active phase controllers 的 p95 为 1.85 ms/tick，1,000 idle controllers 的 p95 为 0.80 ms/tick 且写出 0 frame，generation churn 的 p95 为 2.00 ms，1,000 late joins 为 2.49 ms，dispose retained state 为 0。
- Asset/Phaser 扩展已支持 atlas/audio/variant/animation metadata、animated-sprite、particle 与 animation command、native batch、clip registration/binding；animation adapter 只绑定 Driver 持有的共享 Phaser runtime/cache，没有创建第二个 Game/Scene。

### `@gamekits/audio-core`

Deliverables:

- AudioAdapter、bus、listener、voice/source、play/stop/set command。
- Priority/concurrency/voice stealing、spatial source、snapshot/diagnostics。
- Memory/null adapter 与 conformance。
- Phaser Driver audio loader/cache/sound manager slice、browser unlock mapping。

Tests/bench:

- Bus/mute、play/stop、loop ownership、concurrency、dedupe、unlock failure、entity despawn。
- Rifle/cue burst、spatial batch update、voice retained state。

Gate:

- Headless profile 可验证 semantic AudioCommand 而不需要浏览器；gameplay 不读取 playback success。

Review checkpoint (2026-07-18):

- 已实现 `@gamekits/audio-core`：bus、cue、listener、voice/source、priority/concurrency/stealing、dedupe、spatial source、ownership cleanup、unlock、diagnostics、memory/null adapter、Handle/App Service runtime 与 conformance。Core 只发布 semantic command/status，不把 playback success 变成 gameplay authority。
- Audio 定向测试 12/12 通过；`bench:audio:check` 8/8 budgets 通过：1,000 cue burst p95 为 16.34 ms，500 spatial voices p95 为 0.32 ms/tick，停止 1,000 voices 为 0.70 ms，dispose retained state 为 0。
- Phaser Driver 使用同一 Phaser runtime/cache 提供 audio asset、sound manager 与 unlock slice；App Host 标准 Audio service 负责 adapter resolve、tick、diagnostics 和 dispose，headless profile 可直接使用 memory/null adapter。

## Existing Package Extensions

| Package                | Required extension                                                                    | 禁止做法                                 |
| ---------------------- | ------------------------------------------------------------------------------------- | ---------------------------------------- |
| `@gamekits/asset`      | Atlas/audio/animation manifest metadata、variant/source validation                    | 加入 Phaser frame/native sound           |
| `driver-phaser`        | Atlas/audio loader、shared animation/audio runtime slice、diagnostics                 | 新建第二个 Phaser.Game/Scene/cache       |
| `renderer-phaser`      | Animated sprite、clip binding、particle command、batch state writer                   | 把 gameplay animation state写进 adapter  |
| `@gamekits/app-host`   | Combat/AI/Navigation/Animator 的薄 standard GameModule resolve；Audio service binding | 在 Host 内实现 domain runtime            |
| `multiplayer-core`     | 仅在现有 managed replication 无法表达 phase/cue generation reset 时补通用协议         | 添加 Outpost Schema/ability/enemy 字段   |
| `@gamekits/devtools`   | 新 domain source/correlation summary 与 profiler span registration                    | 让 trace observer 参与 gameplay decision |
| `@gamekits/test-utils` | 新 facade conformance helper所需 memory fixtures                                      | 测试工具依赖 Outpost app                 |

Library-first closure checkpoint (2026-07-18):

- App Host 已提供 Combat/Navigation/AI/Animator 的薄 standard GameModule resolver，以及 Audio standard service；Host 只组合 handle/service、lifecycle 与 driver slice，不拥有 domain runtime。标准模块顺序保持 TCA/GAS/Multiplayer/Physics → Combat/Navigation/AI/Animator/Camera。
- DevTools 已增加 Combat/Navigation/AI/Animator/Audio source kind、panel registration、standard source snapshot 和 bounded correlation summary；observer/redactor failure 不参与 gameplay decision。`@gamekits/test-utils` 已导出 AI/Animator/Audio/Navigation 的 framework-neutral conformance 与 memory helper，未引入 app dependency，也避免了 Combat → Physics fixture 的 workspace dependency cycle。
- Multiplayer Core 的 managed replication、prediction/playback、generation reset 与 cue/track 协议足以承载后续 Outpost Schema；本轮没有为了尚未出现的 app 字段扩张 Core。
- 相关库定向测试共 121/121 通过（Navigation 14、AI 12、Animator 10、Audio 12、Asset 10、DevTools 8、App Host 33、Renderer Phaser 10、Driver Phaser 12）；全仓 `test` 84/84 tasks、`build` 46/46 tasks、`lint` 84/84 tasks 通过，`bench:world` 通过。全仓 format 仍被本工作流开始前已存在的 `.claude/*`、`AGENTS.md`、`CLAUDE.md` 8 个范围外文件阻塞；本次改动 scoped format 通过。
- 用户要求“底层库全部完成后再统一集成”，因此本 checkpoint 没有修改 `apps/`，Outpost integration gate 继续保持关闭。下一阶段只能在底层库整体评审通过后进入统一集成。

Final foundation closure audit (2026-07-19):

- Navigation cache 现在记录真实 revision 和 path dependency：障碍物更新只淘汰相交 path/route，未受影响的结果安全提升到新 revision；依赖未知、边权改善或解除阻挡仍保守全量失效，外部 backend revision 漂移不能命中旧 cache。Graph backend 返回实际 edge dependency，Core/Graph 定向测试增至 16/16。
- AI definition 在 agent bind 时编译为复用的 sensor/goal/task/scheduler 索引，hot update 不再反复读取 Data Registry；scheduler 对同一 class 使用 oldest-due stable ordering，observer failure 与 gameplay decision 隔离。AI 定向测试增至 14/14。
- Animator 预编译 state/transition/phase 索引并按 gameplay phase 时钟恢复；DataType 与 runtime 对 priority、weight、speed、phase duration 做有限值和范围校验，marker payload 与 observer failure 均隔离。Audio 对 bus 祖先、voice ownership、stealing、source cleanup 和并发 unlock 做原子生命周期处理，不宣称未实现的 runtime ducking。Animator/Audio 定向测试分别增至 12/12、15/15。
- AssetManager 对公开 definition、adapter 输入和 diagnostics 做深拷贝隔离，同 asset 并发 load 合并为一个请求，批量注册的 duplicate 校验保持原子；缺失 source 返回稳定 validation diagnostic，而不是 validator exception。Asset 定向测试增至 12/12。Phaser Driver 明确发布 animation capability，Animator、Audio、Asset adapter 继续只绑定共享 Driver runtime slice。
- App Host 的 Navigation/AI/Animator/Audio observer 现在把运行时 trace 实时送入统一 correlation store，observer/redactor failure 不影响模块；50,000 条均匀覆盖 TCA/GAS/Physics/Combat/Navigation/AI/Animator/Audio 的 diagnostics benchmark 为 0.906 µs/trace、0.0108 ms/runtime snapshot，retained traces/correlations/domain traces 分别受限于 512/64/256，5/5 budgets 通过。
- 最终底层库定向测试共 132/132 通过（Navigation 16、AI 14、Animator 12、Audio 15、Asset 12、DevTools 8、App Host 33、Renderer Phaser 10、Driver Phaser 12）。Navigation/AI/Animator/Audio benchmark 合计 31/31 budgets 通过；`bench:world`、`bench:checkpoint:check` 与扩展 diagnostics benchmark 同时通过，所有新增 runtime 的 dispose retained state 为 0。
- 全仓 `test` 84/84 tasks、`build` 46/46 tasks、`lint` 84/84 tasks 通过。全仓 format 仍只被本工作流开始前已有的 `.claude/skills/gitnexus/*`、`AGENTS.md`、`CLAUDE.md` 8 个范围外文件阻塞；本次改动 scoped format 通过。
- GitNexus 本地 analyzer 因当前 Node 26 缺少兼容 native binding 无法刷新/查询，因此按降级流程使用 import/caller 搜索、TypeScript package references、定向与全仓回归和最终 diff scope 做影响审计；未发现 app dependency 泄漏或意外执行流变化。
- 本审计没有修改 `apps/`，也没有提前迁移 Outpost 内容。底层库整体 gate 至此关闭；后续工作可以单独开启统一 app integration gate，不再用 app-local substitute 补底层能力。

## Outpost App Refactor

Required module layout:

```txt
src/
  content/
    definitions/
    arena/
    manifests/
  domain/
    identity/
    match/
    replication/
  gameplay/
    match-flow/
    player/
    encounters/
    objectives/
    economy/
    construction/
    ai-definitions/
    combat-policies/
  presentation/
    animation/
    cues/
    world-ui/
    render-sync/
  realtime/
  ui/
  test/
```

Migration removes:

- `authority-combat.ts` 中 ability id switch、通用 projectile sweep、damage/shield、straight-line enemy loop。
- App presentation 中 animation timer/native clip 特判。
- 与 Multiplayer Core managed replication 重复的 interpolation/prediction/reconciliation call。
- HUD 内 framework diagnostics。

Outpost retains:

- Data definitions、relationship/damage policy。
- Match/encounter/objective/economy/construction rules。
- Enemy role consideration/task definitions、boss phase rules。
- App Schema/projection、cue mapping、UI view model 与 game UI。

## Delivery Order

### Slice 1: Ability + Combat Foundation

Depends on: existing GAS/Physics/World/Data.

Work:

1. GAS execution lifecycle + migration compatibility。
2. Combat package direct/melee/area/projectile。
3. Outpost rifle/reload/dash/shock/enemy attack/turret migrate。
4. Combat trace、replication phase/hit projection 与 benchmark。

Exit evidence:

- Headless rifle/reload/dash/skill/enemy combat 无 app-local 通用 delivery duplicate。
- Real two-client movement + full weapon/skill feedback。
- GAS/Combat conformance、build/lint、gameplay/authority benchmark。

### Slice 2: Animator + Asset + Audio

Depends on: Slice 1 stable execution phase.

Work:

1. Animator Core + memory adapter。
2. Phaser atlas/animated sprite/particle path。
3. Audio Core + Phaser adapter/unlock。
4. Ranger/Raider 完整 idle/run/fire/reload/dash/hit/death first content set。
5. Cue presentation mapping、late join/reconnect phase restore。

Exit evidence:

- Gameplay timing 不读取 marker。
- Real browser local/remote animation、audio、particle、reduced-motion smoke。
- 500 controller / cue burst benchmark 与 asset group failure/retry。

### Slice 3: Navigation + AI

Depends on: stable Combat ability intent and arena instance data.

Work:

1. Navigation Core/graph backend + Frontier route layout。
2. AI Core utility/task/scheduler。
3. Raider/Gunner/Saboteur/Brute data/tasks、attack slots、stuck recovery。
4. Boss phase task set。
5. AI/Navigation DevTools source 与 benchmark。

Exit evidence:

- 敌人可绕开静态物体、响应 Barricade、不会直线撞墙或集体占一个目标点。
- 250 normal / 1,000 stress agent budget 无无界 path/trace/memory。
- Fixed-seed AI snapshot、save restore 与 two-client telegraph/attack smoke。

### Slice 4: Match, Encounters, Economy

Depends on: Combat/AI/Navigation complete.

Work:

1. Match Flow state machine、core/node objective。
2. Three encounter waves、Director、boss phase、extraction。
3. Shared Supply、facility、repair、protocol vote、results summary。
4. Checkpoint contributor 与 deterministic continuation。

Exit evidence:

- 1/2/4 player headless full match 可胜/可败且不会卡 phase。
- Supply transaction/duplicate reward/path-preserving placement/boss fallback 测试。
- Checkpoint benchmark 与 equivalence。

### Slice 5: Complete Multiplayer UI

Depends on: stable full match projection.

Work:

1. Title/Join、Lobby/loadout、Loading/Deployment。
2. Match/world HUD、build、revive、protocol、reconnect、results。
3. Late join、grace/reconnect、leader transfer、rematch。
4. Responsive portrait/narrow landscape、controller flow、accessibility。

Exit evidence:

- Single/two/four browser full match E2E。
- Portrait viewport camera/HUD、scope/focus、reduced-motion、controller path。
- No framework diagnostics in HUD；DevTools retains correlated full chain。

### Slice 6: Quality And Soak Closure

Depends on: all previous slices.

Work:

1. Normal/stress benchmark baselines and budgets。
2. 60-minute soak、multi-room、reconnect/entity/cue churn。
3. Full asset failure/retry、dispose retained-state audit。
4. Manual playability matrix and UX defect closure。
5. Second-scenario package validation and public API review。

Exit evidence:

- `test/build/lint/format`、World/Physics/Gameplay/Multiplayer/Outpost benchmarks。
- Normal profile frame/tick budgets、bounded queues/history、zero retained session resources。
- Long-term docs align with final public protocol；execution record can close。

## Dependency DAG

```txt
GAS execution ─┬─> Combat ───────────┬─> Outpost combat content
               │                     ├─> AI task ability execution
               │                     └─> Match encounter results
               └─> Animator phase ──> Phaser animation/cue

Arena data ───────> Navigation ──────> AI ───────> Encounter Director

Asset/Driver ─────> Animator + Audio ───────────> Complete presentation

All gameplay state ─> App Schema/Managed Replication ─> UI/E2E/Soak
```

Slices cannot be inverted by adding app-local substitutes. For example, AI slice不能先写第二个 straight-line/animation timer 并承诺以后迁移；发现底层 protocol 缺口先修对应 package。

## Review Gates

Each slice review checks:

- Core-first：是否复用对应 core runtime/factory/helper，而非结构兼容替身。
- Genericity：公共类型是否包含 Outpost 业务名或假设。
- Lifecycle：install/start/stop/dispose/reset/reconnect/save 是否成套。
- Performance：热点是否 batch/index/cache，有无硬上限与 benchmark。
- Explainability：稳定 error/trace/correlation 是否覆盖拒绝和异常路径。
- Real validation：headless contract 之外是否有 Rapier/Colyseus/Phaser/Browser 真实验证。
- Documentation：长期模块/app 文档与 implementation evidence 职责是否清晰。
