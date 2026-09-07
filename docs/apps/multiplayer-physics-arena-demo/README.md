# Knockout Arena 游戏设计文档

## 文档定位

本目录是 Multiplayer Physics Arena Demo（Knockout Arena）游戏级设计的长期事实源。它描述比赛为什么可玩、角色与
物理互动如何工作、内容如何组合，以及完整体验对 GameKits 底层能力提出哪些稳定要求。

跨模块实现阶段、任务状态与验证证据见
[`../../implementation/multiplayer-physics-arena-game.md`](../../implementation/multiplayer-physics-arena-game.md)。已关闭的
多人 Physics prediction 基础工作流见
[`../../implementation/multiplayer-physics-arena-prediction.md`](../../implementation/multiplayer-physics-arena-prediction.md)。
通用模块协议以 [`../../modules/`](../../modules/README.md) 和相关 ADR 为准。

## 文档索引

| 文档                                                               | 唯一负责内容                                                         |
| ------------------------------------------------------------------ | -------------------------------------------------------------------- |
| [`match-flow.md`](./match-flow.md)                                 | 参与者生命周期、多 stage 状态机、晋级、胜负、排名、观战与 rematch    |
| [`character-controller.md`](./character-controller.md)             | 玩家/AI 共享控制意图、角色 motor、移动状态、冲击恢复与 rollback 状态 |
| [`items-and-physical-combat.md`](./items-and-physical-combat.md)   | 拾取、携带、使用、投掷、道具攻击、instability、stagger 与 KO 归因    |
| [`stages-and-hazards.md`](./stages-and-hazards.md)                 | 三个 stage、机关、表面、动态道具、kill volume、Navigation 与内容校验 |
| [`ai-and-navigation.md`](./ai-and-navigation.md)                   | Bot 感知、Utility goal、Task、路线、局部 steering、公平性和诊断      |
| [`multiplayer-and-prediction.md`](./multiplayer-and-prediction.md) | Authority、输入、复制、完整 island、附加 replay、道具预测和故障恢复  |
| [`presentation-and-ux.md`](./presentation-and-ux.md)               | 视觉、动画、音频、镜头、HUD、观战、输入提示和辅助功能                |
| [`content-and-data.md`](./content-and-data.md)                     | App DataType、identity/version、编译投影、内容包、数值与资产边界     |
| [`quality-and-acceptance.md`](./quality-and-acceptance.md)         | 功能验收、测试矩阵、网络条件、性能预算、soak 与持续质量标准          |

同一事实只在表中指定文档维护。其他文档通过链接引用，不复制状态机、数值预算或 schema。

## 游戏概述

Knockout Arena 是一场 8 人参加的 3D 物理竞技电视秀。真人不足时由 authority bots 补位；一场 match 依次进行资格赛、
道具乱斗和坍塌决赛，最终产生唯一 winner。参与者通过移动、跳跃、dive、推挤、拾取、近战和投掷控制空间优势，淘汰
的直接条件是离开有效场地，而不是清空传统生命值。

游戏既是可完整游玩的派对竞技应用，也是 GameKits 高互动多人能力的真实消费者：所有能通过碰撞改变本地预测结果的
玩家、道具和机关必须在同一 Physics prediction island 中按固定 tick replay；胜负、晋级、道具归属和命中结果仍由
headless authority 唯一提交。

## 体验支柱

### 控制可信

移动、转向、跳跃、dive、拾取和投掷必须及时且可预期。网络校正、坡面、移动平台、拥挤接触和受击不能让输入方向、
角色朝向或落地状态随机改变。

### 物理有因果

玩家必须能理解“谁、用什么、从哪个方向、为什么把我击落”。碰撞、instability、stagger、机关 phase 和 kill volume
需要通过动作预兆、空间反馈与 results 因果链解释，而不是只出现一次位置跳变。

### 淘汰公平

当前 stage 淘汰后不重生、不保留隐藏碰撞体，也不重新进入本 stage。晋级、排名、平局处理、disconnect 和 late join
由稳定 authority 规则裁决，不能受客户端帧率、容器顺序或 backend 返回顺序影响。

### 内容可组合

Stage、机关、表面、道具、角色 motor profile 和 bot archetype 由 app DataPack 组合。增加内容时复用现有 authority、
Combat、AI、Physics、prediction 与 presentation 路径，不增加 id switch 或私有网络状态机。

## 系统分层

```txt
Player Input / Authority AI
  -> Arena semantic intent
  -> Character Controller / Interaction Runtime
  -> GAS execution / Combat delivery / Physics body command
  -> Authority Physics Arena Island
  -> Match / ranking / item lifecycle facts
  -> Arena authority projection + managed replication
  -> Client island reconcile + input replay + effect journal
  -> Animator / Three / Audio / Camera / UI presentation
```

长期所有权规则：

- Arena app 拥有 stage、晋级、排名、item definition、instability 数值、bot goal/task 和视觉主题。
- Multiplayer Core / App Host 拥有 authority binding、input/ack、replication、prediction domain、reset、effect settlement
  与 diagnostics 组合；Arena 不重建这些 runtime。
- Physics 拥有 body/collider、query/contact、impulse、solver checkpoint 和 replay；它不拥有道具规则或胜负。
- Character Controller 拥有 grounded/coyote/jump-buffer/dive/recovery 等可回滚 motor state；它不读取 DOM、Three 或 AI。
- GAS/Combat 拥有 action phase、target validation、hit dedupe 和 effect delivery；Arena policy 决定 instability/knockback 数值。
- AI Core 拥有 perception/utility/task/scheduler，Navigation 拥有 path/route；AI 只输出与玩家同构的 intent。
- Animator、Renderer、Audio、Camera 和 UI 只消费 presented/semantic state，不写回 authority 或 solver。

## 全局不变量

- Headless authority 不依赖 Renderer、Animator、Audio、Camera、React 或 DOM 才能完成整场 match。
- 淘汰、qualified、placement、winner、item owner、attack result、KO credit 与 respawn 是 authority-only 事实。
- 当前 stage 淘汰者从 prediction island despawn；下一 stage 只恢复晋级者，新 match 才恢复完整参赛阵容。
- Carried item 不保留隐藏可碰撞 body；pickup 后进入语义 carried state，throw/drop 时以新 generation 重返 island。
- 同一份 solver state 只有一个 rollback owner；character motor 等附加状态与 Physics 同 tick capture/restore，但不重复
  捕获 Physics body。
- 所有 history、command、member、trace、AI memory、path request、item、effect、audio instance 和 replay work 都有硬上限。
- Static layout 在 authority/client 从同一 versioned definition 重建，不进入每个 snapshot；动态因果成员不能仅插值。
- Gameplay timing 不等待动画 marker；远端/late join 从 authority phase 恢复语义状态，不重播过期 action。
- 游戏代码不 import Rapier native type；Three native object 只存在于 app presentation integration。

## 内容规模

一场完整比赛包含：

- 2 名真人 + 6 名 authority bots 的默认阵容，12 人 profile 用于压力验证。
- Circuit Forge 资格赛、Scrap Yard 道具乱斗和 Crown Collapse 决赛。
- 至少 10 类机关/表面、7 类可拾取道具、3 种 bot archetype；Scrap Yard 默认提供 12 个道具实例，避免参与者只能争抢少量样品。
- 完整大厅、stage intro、比赛 HUD、KO feed、观战、stage results、match results 和 rematch。
- 键鼠与标准 gamepad 操作，以及输入提示、震动开关、镜头强度和颜色/音量辅助设置。

内容规模可以继续扩展，但不能在控制、胜负、AI、道具因果、网络故障和性能预算尚不坚实时，用更多地图或道具掩盖
基础问题。

## 非目标

- 生产 matchmaking、账号、邀请、公网部署、反作弊和 host migration。
- 自动大世界 interest management 或客户端启发式 island partition。
- 未进入 Physics 公共协议的 joint、ragdoll、绳索或 backend-native constraint graph。
- 大规模商业内容管线、完整换装、赛季、长期经济和用户生成关卡。
- bit-identical 跨所有浏览器/CPU 的确定性承诺；checksum、reconcile 和 hard correction 仍是安全边界。
