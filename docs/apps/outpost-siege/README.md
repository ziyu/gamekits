# Outpost Siege 游戏设计文档

## 文档定位

本目录是 Outpost Siege 玩法与游戏级系统的长期事实源。它描述游戏为什么可玩、每个系统如何协作、哪些规则属于 Outpost，以及玩法对 GameKits 底层能力提出什么稳定要求。

综合验证应用的 authority、profile、资源、复制、存档、诊断和性能合同见 [`../multiplayer-outpost-siege-demo.md`](../multiplayer-outpost-siege-demo.md)。底层模块的最终公共协议见 [`../../modules/`](../../modules/README.md)。实现状态、阶段拆分和验证证据见 [`../../implementation/outpost-siege-gameplay-foundation.md`](../../implementation/outpost-siege-gameplay-foundation.md)。

## 文档索引

| 文档                                                                   | 唯一负责内容                                                   |
| ---------------------------------------------------------------------- | -------------------------------------------------------------- |
| [`game-flow.md`](./game-flow.md)                                       | 产品定位、体验支柱、完整单局状态机、胜负、局内强化与结算       |
| [`player-experience.md`](./player-experience.md)                       | 玩家域、控制意图、角色运行时、表现帧与端到端体验合同           |
| [`combat.md`](./combat.md)                                             | 武器、投射物、技能阶段、命中、伤害、状态、倒地、救援与战斗顺序 |
| [`animation-and-feedback.md`](./animation-and-feedback.md)             | 角色动画图、动作相位、VFX、音频、镜头、资源制作与多人恢复      |
| [`characters-and-ai.md`](./characters-and-ai.md)                       | 敌人阵容、Utility AI、Task 状态机、感知、导航、攻击槽与首领 AI |
| [`level-encounters-and-economy.md`](./level-encounters-and-economy.md) | 关卡空间、建造、资源、Wave Director、遭遇与首领阶段            |
| [`multiplayer.md`](./multiplayer.md)                                   | 小队、加入/离开/重连、多人 authority、复制、合作与防破坏       |
| [`ui-ux.md`](./ui-ux.md)                                               | 全部游戏页面、HUD、世界提示、输入、响应式与辅助功能            |
| [`content-and-quality.md`](./content-and-quality.md)                   | Data/Asset schema、存档、测试矩阵、benchmark 和持续质量标准    |

同一事实只在表中指定文档维护。其他文档只引用，不复制数值或状态机。

## 游戏概述

Outpost Siege 是支持 1–4 人的 2D 俯视角合作防守与撤离游戏。小队守住 Frontier 07 中继站，利用战斗间隙修复核心、部署防御并选择局内强化；击败攻城首领后还必须启动撤离信标并离开，才能完成一局。

目标单局时长为 10–15 分钟。正式合作体验面向 2–4 人，单人模式必须保留同一套完整玩法、authority 与内容规则。

## 体验支柱

### 响应可靠

移动、瞄准、射击、冲刺和交互必须立即给出本地反馈，authority 结果稳定收敛。任何网络、Physics、GAS 或动画复杂度都不能成为输入迟滞、移动颤抖和命中含糊的理由。

### 压力可读

敌人从明确路线进入，攻击具有预兆，核心与队友危险状态可定位。玩家可以因为判断错误而失败，不能因为屏外无提示伤害、AI 卡死或碰撞与画面不一致而失败。

### 合作有价值

救援、分路、标记、共享设施、状态连携和撤离加速让队友明显有用；合作不依赖固定职业，也不能被单个断线或拒绝投票的成员永久阻塞。

### 系统可组合

武器、技能、状态、敌人、设施和波次通过统一数据协议组合。每增加一个内容项，应复用已存在的机制，而不是增加 id switch、renderer 特判或 app-local 平行底层。

## 系统分层

```txt
Player Input / AI Decision
  -> semantic intent
  -> GAS ability execution phase
  -> Combat delivery and target validation
  -> Physics movement/query/contact
  -> GAS effect/attribute/tag result
  -> TCA low-frequency reaction/objective
  -> authority replication
  -> Animator / Renderer / Audio / Camera / UI presentation
```

长期所有权规则：

- Outpost 拥有 Ranger、Raider、Frontier 07、wave、Supply、核心和撤离等游戏概念。
- GAS 拥有 ability execution、cost、cooldown、effect、attribute 与 tag。
- Combat 拥有通用 delivery、projectile、target relationship、hit resolution 与 hit trace。
- AI Core 拥有 perception、utility、task 与调度；Navigation Core 拥有 path/route。
- Physics 拥有空间、运动、碰撞和 query，不拥有伤害或导航。
- Animator Core 拥有语义 Animator controller；Renderer/Driver 执行 native animation clip/particle。
- Audio Core 拥有 Music/SFX/Dialogue、Playback、Mix 和 Spatial 语义；Driver 的 AudioBackend 执行 native sound。
- Multiplayer Core 拥有 session/authority/复制/预测与表现调度，游戏不手写同类 runtime。

## 全局不变量

- Server authority 是伤害、资源、目标、AI、设施和胜负的唯一写入者。
- Headless authority 不依赖 renderer、animation、audio、React 或 DOM 才能完成完整一局。
- 正式 HUD 不显示 entity count、Physics body、网络包、trace 或 provider 状态；这些只进入 DevTools。
- 静态物体的视觉、Physics collider 和 Navigation blocker 从同一 arena instance 派生。
- Gameplay timing 不等待动画 marker；表现失败不改变玩法结果。
- 高频移动、AI steering、projectile 和 render sync 走 system/batch，不通过 EventBus、React 或 TCA 逐实体逐帧广播。
- 所有队列、历史、trace、projectile lifetime、AI memory、path request、animation one-shot、逻辑 PlaybackInstance 和 native playback 都有硬上限。
- 所有新底层能力先定位对应 Core owner；Core 缺口在底层补齐，不在 Outpost 长期复制 substitute。

## 内容规模

一个打磨完整的关卡包含：

- 一名共享基础角色骨架与可配置 loadout。
- 一把主武器、三种战术模块、三种防御设施。
- 四种普通/精英敌人和一个三阶段首领。
- 三个主波次、两次整备、一次强化投票和一次撤离。
- 完整大厅、战斗 HUD、整备、强化、暂停、重连和结算页面。

内容规模可以扩展，但不能在上述闭环尚不坚实时通过增加武器、敌人或地图掩盖基础问题。
