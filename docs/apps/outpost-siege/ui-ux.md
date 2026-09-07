# Outpost Siege UI / UX

## 目标

游戏 UI 只展示玩家做决策需要的信息。GameKits service graph、network packet、entity count、Physics binding、GAS/TCA trace 和 profiler 只存在于可收起 DevTools，不复制进正式 HUD。

UI 使用 React 组件与稳定 view model。React 不订阅每帧 World transform；世界空间提示由 Renderer 或专用 world UI presentation 处理，低频 HUD 通过 selector/signature 节流更新。

## 信息层级

| 层级      | 内容                                                            |
| --------- | --------------------------------------------------------------- |
| 世界表现  | 准星、投射物、危险区、命中、建造预览、交互/救援进度、目标/ping  |
| 核心 HUD  | 本地生命/护盾、弹药、能力、Supply、核心、波次、主目标           |
| 小队状态  | 成员生命/护盾、downed/disconnect、距离方向、模块                |
| 情境通知  | reload/ability 拒绝、设施受袭、节点失守、boss phase、撤离倒计时 |
| 页面/菜单 | 标题、Lobby、加载、整备、强化、设置、重连、结算                 |
| DevTools  | authority、网络、World、Physics、AI、GAS/TCA、性能与资源诊断    |

## 输入映射

| 行为       | 键鼠默认    | 手柄默认       |
| ---------- | ----------- | -------------- |
| 移动       | `WASD`      | 左摇杆         |
| 瞄准       | 鼠标        | 右摇杆         |
| 射击       | 鼠标左键    | 右扳机         |
| 换弹       | `R`         | `X / Square`   |
| 冲刺       | `Space`     | `A / Cross`    |
| 战术模块   | `Q`         | 左肩键         |
| 建造       | `E`         | 右肩键         |
| 交互/救援  | `F`         | `Y / Triangle` |
| 切换建造物 | 滚轮/数字键 | 方向键左右     |
| Ping       | 鼠标中键    | 方向键上       |
| 暂停/菜单  | `Esc`       | `Menu`         |

Input Scope：

- `game`：移动、aim、combat、ping。
- `ui`：Lobby、Results、普通面板导航。
- `modal`：确认、强化选择、阻塞错误。
- `text-input`：房间码、显示名、聊天/文本字段。
- `devtools`：诊断面板与快捷键。

Scope 同时约束 gameplay 与 camera。Modal、text input 或 DevTools 获得焦点时清理 transient held action，避免关闭面板后继续自动射击。

## 页面状态

### Title / Join

必须包含：

- 创建房间。
- 输入房间码加入。
- 恢复可重连 Session。
- 单人训练/本地 authority。
- 设置与辅助功能。

连接状态使用玩家语言：连接中、房间不存在、版本不兼容、房间已满、比赛进行中可观战、重试。内部 provider error 进入详情/DevTools，不作为主文案。

### Lobby

- 成员卡：编号、显示名、leader、连接/加载/ready。
- Tactical Module 与默认 Deployable 选择。
- 队伍能力摘要：输出、控制、保护、修复，不强制职业。
- 开始条件、倒计时和取消原因。
- 离开、复制房间码、设置。

本地选择立即反馈，但 Ready 必须基于 authority acknowledgement。成员列表变化保持焦点和 controller selection，不整页重建。

### Loading

- 总体 required content 进度。
- 当前 asset group 的可理解名称。
- 等待队友与自身加载分开。
- retry、退出和 compatibility 错误。

不显示 asset id 列表、URL、堆栈或 service lifecycle graph。

### Deployment Brief

- 一句主目标：“守住中继核心”。
- 核心、活动 gate、首个 Hardpoint 的世界指示。
- 动态输入提示；完成对应操作后淡出。
- 可跳过，但不跳过 authority countdown。

## Match HUD

### Top Center：Match Objective

- `WAVE 1 / 3`、`INTERMISSION`、`OVERSEER` 或 `EXTRACTION`。
- Authority deadline 的平滑倒计时。
- 单行主目标与可选支线。
- 核心耐久条；低于阈值时颜色、icon、pulse 与音频共同变化。

目标不堆叠技术说明。详细支线可展开，但默认保持一主一副。

### Squad Roster

每名玩家显示：

- 编号/颜色/icon、名称。
- health/shield compact bar。
- downed timer、incapacitated、disconnect grace、spectator/extracted。
- tactical module 状态。
- 屏外方向/距离（仅倒地、高优先级或显式 ping 时突出）。

Roster 不显示延迟、input sequence 或 provider connection id；网络问题使用一个可理解的连接 icon，详细数值进入 DevTools。

### Local Status

- Health 100、Shield 50 与 Stamina 100，数值/条形兼具。Stamina 低于 Dash cost 时使用独立危险色，并直接标记 `DASH LOCKED`。
- 当前 ammo `magazine / reserve`、reload phase。
- 受控状态 icon 与剩余时间，只展示影响当前操作的公开状态。
- 低生命、shield break、no ammo 使用不同反馈，不以持续全屏红色覆盖。

### Ability Bar

槽位：Rifle、Dash、Tactical、Deployable/Build。

每个槽显示 icon、输入提示、cooldown/charge、当前 execution phase 和拒绝状态。Cooldown 使用 authority end time，并把剩余秒数直接覆盖在 icon 上；本地可以平滑倒计时，但 snapshot 更新时不重新从满值跳变。

Ability 无法使用时展示最具体原因：downed、reloading conflict、cooldown、no stamina、no resource、invalid target。按钮灰度之外必须有 icon/文本或按键触发后的短提示。Dash 槽常驻显示 stamina cost；stamina 条和槽位已提供数值时，authority 拒绝提示只显示简短的 `LOW STAMINA`，不重复要求值、当前值和拒绝标题。

### Supply / Build

- Shared Supply 与设施容量。
- 当前 buildable、价格、兼容 socket。
- Build preview 在世界中显示，HUD 只补充选择与原因。
- 队友正在同 socket 建造时显示 reservation，避免双方都误以为成功。

## 世界空间 UI

### Crosshair

- 根据 aim source 使用鼠标世界点或手柄方向。
- 显示有效射程/目标状态但不自动锁定隐藏目标。
- Hit confirm 区分 shield、health、weak/critical 与 kill。
- UI/modal scope 时隐藏或禁用。

### Telegraph

- 危险区域使用形状 + 边缘 + 填充进度，不只使用颜色。
- 填充与 authority preparing phase 对齐。
- 被遮挡时仍通过轮廓或屏幕边缘指示重要威胁。
- 同时高威胁 telegraph 受 encounter budget 限制，UI 不负责隐藏玩法压力。

### Interaction

世界提示显示 action、目标、按键、进度和中断原因。多个候选按优先级：救援 > 主目标 > 修复 > 普通交互。玩家可以切换候选，系统不能在两个对象之间每帧抖动。

### Health Bar

- 普通敌人默认隐藏，受伤/被 aim/特殊状态时出现。
- Elite/Boss 保留更稳定的世界/顶部信息。
- 设施受损或被攻击时显示。
- 远处、遮挡或离开 viewport 后及时回收。

## Intermission UI

战场保持可见，HUD 切换为整备模式：

- 剩余时间与提前 ready。
- Supply 收支摘要。
- 修复目标与价格。
- Buildable 对比：价格、容量、作用、当前数量。
- 失能队友复归成本。

整备面板不占满战场。键鼠可以直接点选/世界放置，手柄使用 focus ring 与 socket cycling。

## Squad Protocol 投票

三张卡片并列显示：

- 名称、icon、1–2 行效果。
- 明确数值变化与适用对象。
- 队友投票标记、票数、剩余时间。
- 当前队伍为何适用的简短 context tag，例如“2 个 Shock 来源”。

卡片不能使用模糊文案“显著提高”。Focus、hover 和 selected 是不同视觉状态。超时自动决议前给出 3 秒提示。

## Pause / Settings

多人打开菜单不暂停 authority；单人 local authority 可以明确暂停。设置包含：

- Master/Music/SFX/Dialogue 以及 SFX/UI 音量与 mute。
- 屏幕震动强度、闪光、粒子量、reduced motion。
- UI/字幕/伤害方向提示缩放。
- 高对比准星、色觉方案、危险区样式。
- 键鼠/手柄重映射、aim dead zone/sensitivity。
- 退出/断开确认。

修改设置即时预览但不写 gameplay state。保存失败有非阻塞反馈。

## Reconnect Overlay

连接中断时保留最后可信画面并弱化，不伪造继续运动：

- 当前重试状态与 20 秒 grace。
- 自动重试次数、手动重试、退出。
- 重连成功后的 resync 进度。
- Grace 过期或 room closed 的明确结果。

Overlay 进入 modal scope，清 held input；恢复后等待新 input epoch，不把断线前按键恢复为 held。

## Results

优先顺序：

1. Victory/Defeat 与直接原因。
2. 撤离/失能成员和核心剩余。
3. 波次/节点/首领关键事件。
4. 伤害、控制、修复、救援、设施和资源贡献。
5. 重赛投票、返回 Lobby、离开。

Results 不用大型个人击杀排行榜鼓励抢资源。统计值带 authority summary 版本，迟到的 cue/UI local count 不修改结果。

## 响应式布局

### 横屏

- Top objective 居中。
- Squad roster 右上或顶部侧栏。
- Local status 左下，Ability bar 底部中央，Supply/build 右下。

### 窄屏 / 竖屏

- 使用实际 game viewport，不把整张横屏画布裁到左上角。
- Roster 折叠为顶部紧凑横行，可展开详情。
- Objective 保持顶部中央但限制宽度。
- Local/Ability 合并为底部 safe-area dock。
- Build/interaction 使用 context drawer，不永久占据右侧战场。
- Camera 以有效 viewport 中心跟随玩家，HUD 尺寸不偏移 world center。

所有布局验证 browser chrome、safe area、DevTools 收起/展开和不同 device pixel ratio。

## 辅助功能

- 关键信息同时使用颜色、形状、icon、文字与可选音频。
- 文字、HUD 与字幕可缩放，不能仅整体 transform 导致模糊。
- Reduced motion 降低 shake、parallax、screen flash、UI transition 和装饰 particle，不删除 telegraph。
- 音频事件字幕标明类型与方向，例如“东侧：Brute 冲撞”。
- Colorblind preset 保持队伍、敌人、危险、可交互的区分。
- 手柄全流程可完成 Title → Lobby → Match → Results，不依赖 hover。
- 输入重映射检测冲突并允许恢复默认。

## UI 性能与测试

- 高频 transform/aim/projectile 不进入 React state。
- Match view model 以 10 Hz 或 dirty selector 更新；倒计时/冷却可在 UI 内基于 authority time 平滑显示。
- List/card key 使用 stable player/entity/definition id，不用数组索引。
- Toast/notification 有并发、合并和过期上限。
- E2E 覆盖键鼠、手柄、focus/scope、横/竖屏、reduced motion、重连、late join、拒绝原因、投票与完整结算。
