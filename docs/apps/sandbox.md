# Sandbox 设计

本文档负责 `apps/sandbox` 的长期演示设计。Sandbox 不是模块设计文档，也不是阶段状态文档；它描述这个验证面应该如何呈现 GameKits 各模块的协作关系。

具体 Sandbox 工作流状态放在任务系统、PR 或 `../implementation/`。单个模块协议放在 `../modules/`。不要把本文档内容复制到模块文档或执行记录中。

## 定位

Sandbox 是 GameKits 的多场景框架验证面。每个场景围绕一组明确能力提供最小但真实的交互闭环，用来证明 App Host、Data、Asset、Renderer、Input、Camera、Physics、TCA、GAS、Combat、EventBus、World 和 GameRuntime 能在可观察、可交互的应用中协同工作。

Sandbox 不是长期玩法仓库，也不是 DevTools 的替代品。它可以像一个小 demo 游戏一样运行，但其目标是解释框架能力，而不是沉淀一套真实游戏内容生产线。

Sandbox 的演示设计必须优先易懂：基础概念应该像普通小型游戏一样直觉，机制可以足够复杂，用来承载框架模块协作。不要用架构隐喻替代游戏对象；玩家不应该先理解 GameKits 才能看懂场景。

## 多场景验证台

Sandbox 外壳只负责场景发现、选择、懒加载、启动状态和错误边界，不持有 gameplay world、模块 handle 或第三方 runtime。场景通过独立入口装配自己的 App Host、profile、DataRegistry、World、GameRuntime、UI 和 dispose 生命周期；切换场景等价于退出当前小型应用并启动另一个应用，不能复用上一场景的可变运行态。

这一结构用于隔离验证条件，避免为了测试一个模块而被另一个大型演示的业务状态干扰。它也约束后续扩展：

- 一个场景只验证一组相互依赖、能形成闭环的能力，不把所有 package 强行塞入同一运行时。
- 场景目录可以包含自己的 DataPack、组件、game module、表现和测试，但游戏特有概念不能上推到通用 package。
- 场景必须通过 package 公共协议和标准 GameModule/App Host 装配能力，不能复制底层 runtime 或绕开 core。
- 原始 trace、服务状态和性能细节进入 GameKits DevTools；场景 UI 只展示玩家或测试者完成操作所需的目标、状态和结果。
- 场景清单采用懒加载，未选择的场景不进入当前页面的启动与执行路径。
- 场景选择可由外壳导航和稳定的 `scene` URL 参数表达，便于自动化测试、问题复现和直接分享。

## 场景：Character Controller Lab

Character Controller Lab 是 `@gamekits/character-controller` 的可玩集成测试场，不承担通用 Physics 查询、掉落物或多人预测演示。
它使用 Sandbox 的独立惰性场景入口，通过 Three Driver 创建视觉 runtime，并以真实 Rapier3D PhysicsScene 驱动一个动态 capsule。
角色每个 fixed tick 都走公共 `compileCharacterMotorDefinition → observeCharacterEnvironment → stepCharacterMotor → PhysicsScene`
路径；场景不能直接设置 native Rapier velocity，也不能复制 coyote、jump buffer、dive、stagger 或 recovery 状态机。

测试空间是可自由探索的第三人称综合试验园区，不再用固定横向镜头把测试项排成一条赛道。中心广场连接 walkable/rejected slope、
三级 bounded step、coyote gap 与低顶区、平衡木、横移和升降平台、旋转扫杆、dive tunnel，以及带球体和箱体的动态推动区。底部五个
资格站同时是可点击的校准点，可将角色以干净 motor state 直接放到目标区域。

测试者聚焦 viewport 后使用 WASD、Space、Shift，并可用鼠标拖拽环绕、滚轮缩放第三人称镜头。键盘和鼠标必须先经过 Input Router
与 game scope；app composition 再用水平 camera basis 把局部 WASD 映射成 world-space semantic intent，Character Controller
本身不能读取 Camera 或 DOM。presentation frame 的 jump/dive edge 通过 Character Controller 公共 intent buffer 保留到下一个实际
fixed tick，不能被高刷新率下未推进 simulation 的 frame 提前清除。UI/按钮焦点不能继续产生 held gameplay input。

主视图使用独立 PerspectiveCamera 跟随角色，提供平滑 target、全周水平环绕、从低机位到近俯视的宽俯仰区间、近距离检查到全园区总览的
宽缩放范围、包含 floor 在内的场景遮挡收近与园区基准地面净空兜底，并展示可辨认的测试区域、角色 facing、
ground probe 和移动平台；诊断台只读展示 motor mode、support body、ground slope、query count、
coyote/buffer/dive/recovery/stagger timer、state signature 与有界 semantic trace。Stagger 与 Impact 按钮用于注入公开 observation/body
command，验证 external impulse 不会被下一 tick motor 立即清零；Pause/Step/Reset 用于固定 tick 检查。原始 provider handle 不进入 UI，
dispose 后只允许保留无 trace/contact 的终态快照。

该场景的自动化测试使用与页面相同的 proving-ground/runtime 和 Rapier3D adapter，至少锁定二维 camera-relative intent 旋转与归一化、
综合场地元素、公共 query、高刷新率 presentation 到 fixed tick 的离散输入保留、jump/dive sequence 去重、stagger/recovery、
external impulse 与 dispose 清理。Physics 3D Lab 仍保留通用
Physics facade 和 controller course fixture；两者互为补充，不能通过共享 app-local timer 或 native controller 形成第二套实现。

## 场景：Projectile Combat Field

Multiplayer Projectile 场景采用一个可玩的前线交火区，而不是把 Owner、Authority、Remote 画成三条抽象测试
轨道。测试者控制一个本地 Owner 单位，从武器装具中选择不同弹丸，瞄准战场中的敌方单位并观察生命、掩体、
命中和网络收敛结果。

长期演示要求：

- 战场包含可识别的射击单位、多个敌方目标、生命与护甲、静态掩体和明确的空间布局；不能用同质圆点代替
  游戏对象。
- 至少展示快速小半径步枪弹、慢速大体积能量弹、带爆炸范围的火箭、多弹丸散射武器，以及一类启用重力、
  CCD、材质反弹和动态目标冲量的 solver-owned 刚体弹。每类弹丸使用自己的 Combat/Physics definition、速度、
  寿命、伤害和表现，不只改变颜色。
- Owner、Authority 和 Remote 继续运行真实 Multiplayer runtime；Sandbox 交互场默认使用 Memory backend，验证
  runtime 组合与预测语义，不把它表述为生产 transport。主视图显示 Owner 的即时预测，Authority 与 Remote 以
  辅助 ghost 表达，不把同一场战斗拆成三份互不相关的地图。
- 目标伤害和击倒只由 Authority 命中事实结算；Owner 可以即时预测空间 impact，但不能提前提交伤害。
- 网络故障注入应改变一个明确的空间事实，例如 Authority 独有的旧掩体，并产生一次可解释的有界 correction，
  而不是随机移动无业务含义的测试墙。
- 场景 UI 优先表达装具、目标、冷却、生命、命中和战斗结果；队列、sweep 和 reconciliation 作为紧凑诊断保留，
  不能反客为主。

该场景同时验证 `kinematic-data-buffer` 与 `predicted-entity`：前四类弹丸复用同一 Physics sweep 与有界
fire/finish record；刚体弹则把弹丸和所有可推动目标放入同一 prediction island，在延迟 authority snapshot
到达时恢复完整 Rapier checkpoint 并重演。场景必须显示回滚 tick、checkpoint bytes 和刚体 contact 数，伤害仍
只由 Authority 接触事实结算。更复杂的制导或 constraint 不得以不完整的直线近似冒充。

## 场景：Tiny Camp

Sandbox 的主场景采用一个自动运行、可交互的放置式营地 demo：`Tiny Camp`。

核心一句话：一群工人在营地里自动采集资源、搬运物资、建造设施、维修建筑、防御怪物；玩家可以选择单位或建筑，调整优先级，触发技能，观察系统如何协同。

基础概念必须足够直接：

- `Campfire`：营地核心，代表主要目标和失败风险。
- `Worker`：工人，自动采集、搬运、维修、建造或支援战斗。
- `Lumber Camp` / `Quarry` / `Berry Patch`：资源点，产出 wood、stone、food。
- `Storage`：仓库，接收和分发资源。
- `Workshop`：工坊，消耗资源制造升级、工具或防御设施。
- `Tower`：防御塔，自动攻击靠近的怪物。
- `Monster`：敌人，从边缘波次进入营地并攻击建筑或工人。
- `Road` / `Task Path`：工人路线、资源流向和任务意图。

长期体验目标：

- 无输入时，营地也会自动推进：采集、搬运、建造、防御、受损、维修和升级持续发生。
- 有输入时，玩家可以选择对象、切换营地策略、调整优先级、触发能力或让镜头跟随某个单位。
- 关键模块能力必须在舞台上有结果，而不是只在日志里出现。
- 每类对象必须有独特职责、轮廓、状态层和反馈，不用同质移动点代表复杂系统。

## 场景结构

主舞台采用普通玩家能理解的营地布局：

- 中央：`Campfire` 和少量初始建筑，显示营地生命、当前目标和全局状态。
- 左侧：`Forest`，放置 Lumber Camp 和树木资源。
- 右侧：`Quarry`，放置石料资源和较慢的重型采集任务。
- 下方：`Berry Patch` / `Farm Plot`，提供食物和恢复相关资源。
- 上方：`Workshop` 和 `Storage`，承载制造、升级和资源汇聚。
- 边缘道路：`Monster Path`，怪物从边缘进入，沿道路接近营地。
- 防御线：`Tower`、障碍、工人维修路线和战斗范围必须可见。

Camera 默认能看见完整营地。玩家选择某个对象时，Camera 可以聚焦或跟随，但不应遮蔽全局状态。

## 自动放置循环

`Tiny Camp` 的核心循环由五层组成。

### 资源层

资源点周期性产出或提供可采集资源。Worker 根据任务把资源从资源点搬到 Storage 或 Workshop。

资源层至少包含这些状态：

- resource type / amount / replenish progress。
- worker cargo / capacity。
- storage amount / capacity。
- task reservation，避免所有工人挤到同一个资源点。
- route progress 和资源流向表现。

### 建造层

Workshop 和 Campfire 根据资源解锁建造或升级。建筑不是瞬间出现，而是有 construction progress、material delivered、worker assignment 和完成反馈。

建造层至少包含这些对象：

- building blueprint。
- construction site。
- material requirement。
- build progress。
- unlock requirement。

### 调度层

Worker 是自动工人，也是 GAS actor。Worker 根据营地策略、建筑优先级和当前威胁领取任务：

- `gather`：从资源点采集资源。
- `haul`：把资源送到 Storage、Workshop 或 construction site。
- `build`：建造新设施。
- `repair`：修复受损建筑或防御塔。
- `defend`：支援 Tower、引开或攻击 Monster。
- `rescue`：帮助低生命或被减速的工人。

Worker 至少要有 health、stamina、cargo、tool、current task、target、route progress。任务路径应在舞台上可见。

### 压力层

Monster wave 会周期性施加压力。压力不能只是扣血数字，它应改变生产、路径和表现：

- monster attack：攻击 Campfire、Tower、Storage 或 Worker。
- fire / poison / slow：通过 GAS effect 影响建筑或单位。
- blocked road：迫使 Worker 绕路，降低运输效率。
- damaged tower：防御范围下降，需要维修。
- panic：低生命 Worker 自动撤退或等待救援。

压力事件进入 EventBus，TCA 决定是否触发自动响应，GAS 执行 ability/effect，Renderer 展示预警和结果。

### 成长层

Sandbox 需要展示 Data 和 Asset 的价值，而不是只展示它们的注册数量。

长期成长反馈：

- Workshop 解锁新的 recipe、building blueprint、tool、worker role 或 tower upgrade。
- Campfire 目标阶段推进后解锁新的资源点、怪物波次或自动化规则。
- Asset 加载成功后改变建筑外观、工人工具、怪物外观、攻击特效或 UI 图标。
- Data entry 被解锁或引用时，Inspector 能说明它来自哪个 pack、被哪些对象使用。

成长层仍是 Sandbox 内部 demo 逻辑；不要把具体玩法概念上推到核心包。

## 主舞台表达原则

主舞台必须承担模块协作表达，不允许只把信息放进 Inspector 或 Timeline。

长期要求：

- 主要对象必须有明确角色、状态和行为，不使用一组同质小球代表全部实体。
- 每类对象必须使用不同的复合 RenderObject，包含多层节点、状态条、任务标记、范围、路线或特效。
- 关键状态变化必须有场景内表现，例如资源增长、搬运、建造进度、受击、维修、燃烧、冷却、升级完成。
- Input、Physics、TCA、GAS、Data、Asset、Renderer、World 的协作必须在舞台上能被感知，再由 Inspector 和 Timeline 补充解释。
- 舞台上必须有路线、流向、任务状态和威胁区域，避免对象只在原地闪烁或简单漂移。
- 复合 RenderObject 应表达“结构”和“状态”：基础形体、状态条、任务 glyph、资源携带层、受击层、cue 层分开更新。
- Sandbox game module 不直接依赖 Phaser、Koota 或 DOM；具体后端仍通过 Driver、Adapter 和 App Host 注入。

## 玩家操作语义

Sandbox 的操作应服务于验证模块协作，而不是追求复杂操作量。

长期输入语义：

- `scene.click` 由主舞台点击产生：命中对象时选中 worker / building / resource / monster 并刷新 Inspector，命中空白时取消选中。该语义应通过 game viewport scope 的 Input adapter 产生，并在 click/release 语义上结算。
- 用键盘切换选中对象时，Inspector 应立即围绕该对象刷新。
- `confirm` 对选中对象执行主操作，例如 boost worker、repair building、prioritize construction、focus tower fire。
- `mode.1` / `mode.2` / `mode.3` 切换营地策略：`gather`、`build`、`defend`。
- `priority.next` / `priority.previous` 调整选中建筑、资源点或 construction site 的工作优先级。
- Camera pan / zoom / focus / follow 只在 game viewport scope 下生效。缩放操作必须以归一化后的 renderer viewport 坐标作为 anchor，保证用户指向的位置在缩放前后保持稳定。
- 暂停或单步 tick 用于观察 timeline，但不改变模块边界。

输入必须先归一化为 action，再由 Sandbox game module、标准模块或 app UI bridge 消费。Renderer 不接收 raw input，主舞台点选也不直接绕过 Input 模块监听 canvas。

## 模块映射

### App Host

App Host 负责启动 Platform、Data、Asset、Driver、Renderer、Input、UI 和 GameRuntime 等应用服务。Sandbox 主舞台可以显示服务健康状态，但 gameplay 规则不应依赖 Host 内部实现。

### Data

场景布局、worker、building、resource、recipe、monster wave、ability、effect、render rig 和 asset reference 都应来自 DataPack。

Sandbox 内容文件应按 Tiny Camp 的真实业务概念组织，而不是按全局数据类型拆成 actors、rules、assets、renderObjects 等大表。每个业务文件可以混合多种 DataType，只要进入 DataRegistry 的条目有明确 `type` 和 `id`。

Sandbox DataPack 至少覆盖这些复杂数据：

- worker definition：role、base stats、cargo capacity、tool、ability loadout、render rig、asset references。
- building definition：category、health、storage、work slots、supported tasks、upgrade chain、render rig。
- resource node definition：resource type、yield、replenish cadence、harvest requirement。
- recipe definition：input/output、duration、required building、unlock condition。
- monster definition：stats、behavior、attack ability、drop table、render rig。
- wave definition：spawn cadence、composition、target selector、reward。
- objective phase：required buildings、required resources、survival time、reward。
- route/layout definition：position、road links、spawn edge、defense zone、visual style。

### Asset

Assets 负责资源声明和加载状态。资源成功加载后，相关 RenderObject 的纹理、颜色层、状态灯、技能图标或 cue effect 应在场景中生效。Asset 加载失败时，舞台应显示降级表现，而不是静默失败。

### World

Campfire、Worker、Resource Node、Storage、Workshop、Tower、Monster 和 Road/Task Path 都应对应 world entity 或可追踪的 world runtime state。

Sandbox 可定义本地组件，例如：

- `SceneObject`
- `Selectable`
- `ResourceStorage`
- `ProductionState`
- `ConstructionState`
- `WorkAssignment`
- `ThreatState`
- `CombatState`
- `RouteState`
- `RenderPresentation`

这些组件只服务 Sandbox 验证，不进入核心包。

### Renderer

Renderer 负责把 world state 和 presentation data 映射为复杂 RenderObject。

主舞台至少需要这些表现：

- Campfire：生命、目标阶段、营地范围、受击或升级状态。
- Worker：方向、任务图标、携带资源、体力、受伤或 buff/debuff。
- Resource Node：剩余资源、采集进度、再生状态。
- Storage / Workshop：库存、制造进度、缺料提示、升级状态。
- Tower：攻击范围、冷却、目标锁定、受损或维修状态。
- Monster：路径、生命、攻击预警、状态效果。
- Road / Task Path：移动路线、资源流向、阻塞或危险状态。

Renderer Core 仍只暴露通用 RenderObject / RenderNode / RenderCommand 协议；Sandbox 不应重新引入 sprite-first API。

### Input

Sandbox 输入必须受 scope 管理。Gameplay 和 Camera 输入只在 game viewport scope 下生效，Inspector、Timeline、文本输入或未来 DevTools 区域不应误触发游戏操作。

基础交互语义：

- 通过 `scene.click` 选择对象或点击空白取消选中。
- 切换选中对象。
- 对选中对象触发 confirm ability。
- 切换营地策略和调整任务优先级。
- Camera pan / zoom / follow。

### Camera

Camera 默认显示整个营地。玩家可以手动 pan / zoom，也可以让 camera 跟随选中 Worker、聚焦 Campfire 或查看怪物波次入口。

Camera 是 GameModule toolkit 能力，不作为 App Host 标准服务。Renderer camera adapter 只负责同步 camera state。

Inspector 可以向标准 camera module 发出 follow/free 请求，但 follow target 的位置解析来自 Sandbox snapshot / scene context，不进入 App Host service。这样 UI 可以方便操作镜头，同时保持 Camera Core、Renderer Adapter 和 Host service 的边界清晰。

### TCA

TCA 处理低频、可解释的规则触发，不负责高频移动或渲染动画。

典型规则：

- storage 接近满时触发建造或搬运调整。
- building 低生命时触发 repair task。
- monster wave 开始时切换防御提示或派 Worker 支援。
- tower 被攻击时触发 warning、repair 或 focus fire。
- 玩家 confirm 后根据选中对象触发 boost、repair、build priority 或 attack focus。
- recipe 完成后触发 unlock、asset cue 或 objective milestone。

每条规则必须能在 Timeline 中解释 trigger、condition 和 action。

### GAS

GAS 表达 actor 能力、属性、tag、effect 和 cue。Worker、Building、Tower、Monster 都可以是 GAS actor。

典型属性：

- `health`
- `stamina`
- `carry`
- `armor`
- `workSpeed`
- `attackPower`

典型能力：

- `chop_wood`
- `mine_stone`
- `quick_repair`
- `build_boost`
- `tower_shot`
- `monster_bite`
- `rally_worker`

典型 effect：

- haste
- tired
- burning
- poisoned
- fortified
- repairing
- stunned

GAS 热状态应尽量落在 world component 上，保留数据驱动配置优势，同时利用 ECS 查询性能。

### EventBus

EventBus 只承载低频事实，例如 input action、rule fired、ability activated、effect applied、asset loaded、renderer diagnostic、objective milestone、wave started、building damaged。

高频位置、动画和每帧表现不通过 EventBus。

### Save

Sandbox 需要以最小但正确的方式集成 Save，用来验证框架保存链路，而不是把 Tiny Camp 做成完整游戏存档系统。

Sandbox Save 集成原则：

- SaveManager 由 App Host `services.save` 提供，Sandbox 不直接创建 store、codec 或 migration pipeline。
- Sandbox 的 gameplay 状态通过 contributor 注册，不能让 SaveManager 直接理解 Tiny Camp 组件。
- Sandbox 只保存能证明确定性恢复的长期状态：runtime seed/clock、Tiny Camp objective progress、resource/building/worker/monster 的必要 world 状态、GAS actor 的长期运行态、TCA 低频规则状态、Camera 可选状态。
- 不保存当前选中对象、follow target、confirm 操作上下文、renderer native handle、Phaser object、DOM/UI panel open state、Input held state、Timeline 日志、缓存、pathfinding 临时结果或可由 Data/Asset 重建的内容。
- 玩家 confirm 产生的临时交互效果只作为当前会话反馈保存到 timeline / trace，不进入普通进度存档；如果未来某个 confirm 结果应成为长期事实，必须由 gameplay system 写入明确的长期组件或 GAS 状态。
- Contributor 必须声明 `scope` 和 `tags`，例如 `world`、`gameplay`、`gas`、`tca`、`camera`，Sandbox profile 通过 Save contributor policy 决定默认保存范围。
- Save/load UI 应作为 Workbench 的低频操作进入 Inspector 或 Host tab，展示 slot、section、version、compatibility 和最近 diagnostics；不要把 save 控件塞进主舞台高频 HUD。
- 当前交互入口放在 Inspector 的 Host tab：`Save Local` 写入 Web Platform storage，`Load Local` 从同一 slot 恢复当前 Tiny Camp 运行状态；浏览器刷新后仍可读取同一 localStorage slot。
- Load 必须同时恢复 SaveEnvelope 的 runtime clock。保存时如果 HUD tick 是 1587，刷新页面后加载同一 slot，HUD 应回到 1587，再从后续 tick 继续推进。
- Sandbox 长链路测试需要覆盖“固定 seed → tick → save → 重建 runtime → load → 继续 tick”的结果确定性。

Sandbox 默认保存范围应偏保守：保存 `world`、`gameplay`、`gas`、`tca` 和可选 `camera`，排除 `presentation`、`debug`、`cache`、`ui`。

## Workbench UI

Sandbox UI 由三块组成：

- 主舞台：承载 Tiny Camp 的运行、交互和主要视觉反馈。
- Inspector：展示选中对象的 world、render、data、asset、TCA/GAS 关联状态。
- Timeline：按时间合并 EventBus、TCA trace、GAS trace 和 renderer diagnostic，解释“输入 → 规则 → 能力 → 效果 → 表现”的链路。

UI 只消费 snapshot 和低频状态，不把 UI 选择态写入 GameRuntime 或 App Host service。

Inspector 应围绕“当前选中对象”组织，而不是围绕模块平铺：

- Object：当前 entity、role、任务、存储、生命、GAS 状态。
- Runtime：相关系统、tick、module summary、host service 状态。
- Content：引用到的 Data documents、assets、render rig、recipe。
- Rules：最近命中的 TCA rules、失败 condition、产生的 actions。
- Effects：GAS ability/effect/cue、持续时间和属性变化。

Timeline 应突出链路而不是普通日志堆积。一次玩家 confirm、一次 monster attack 或一次 recipe completed 应能串起 input、event、physics contact/query、TCA、GAS、world state、renderer cue。

## Snapshot 要求

Sandbox snapshot 应能支持 headless 测试和 UI 渲染。

长期快照信息包括：

- selected object / actor / entity。
- objective progress 和 status。
- scene entities、roles、position、task、storage、route。
- resource、construction、combat、threat 和 wave 状态。
- GAS actor state、attributes、tags、effects。
- Physics body/collider summary、contact fact 和 query summary。
- DataPack、DataType、document、reference summary。
- Asset registered / loaded / failed summary。
- module summary 和 host service summary。
- timeline entries。

## 长链路测试要求

Sandbox 必须有一套长期维护的长链路集成测试，用来证明 Tiny Camp 不是“页面上有东西”，而是 App Host、Data、Asset、GameRuntime、World、Physics、TCA、GAS、Renderer、Input、Camera、EventBus 和 Snapshot 真的在协同运行。

长链路测试不是替代模块单元测试，也不是像素级视觉回归测试。它的职责是验证 Sandbox 作为框架验证面的完整机制链路：

- 应用组合链路：App Host/profile 能装配 Data、Asset、Driver、Renderer、Input、UI、GameRuntime 和标准 GameModule。
- 内容链路：DataRegistry 能注册 Tiny Camp 内容，scene object 可以追踪到 render object、render rig、building、recipe、GAS actor、asset reference 和 source pack。
- 自动循环链路：固定 seed 下，资源产出、worker 调度、采集、搬运、维修、防御、objective progress 和 route flow 会持续推进且结果可复现。
- 输入链路：game viewport scope 下的 action 能影响 gameplay/camera，UI scope 或空白点击不会误触发 gameplay。
- 规则链路：低频事件能触发 TCA rule，rule 能解释 trigger、condition 和 action，必要时激活 GAS ability。
- GAS 链路：ability/effect/tag/attribute/cue 会改变 actor/world state，并能在 timeline 和 snapshot 中观察。
- 渲染链路：render sync 会为 renderable entity 创建稳定 RenderObject，并根据 world state 更新 object transform、node patch、状态条、任务标记和威胁表现。
- 交互链路：scene click 命中对象会更新 selection/Inspector/focus overlay，点击空白会取消 selection，camera follow/free 与选中对象状态一致。
- 诊断链路：EventBus、TCA trace、GAS trace、renderer diagnostic 和 module summary 能被合并成可解释 timeline。

长链路测试应默认使用 headless harness 和 memory renderer，避免依赖真实浏览器、真实 canvas 或真实 Phaser 实例。Browser smoke test 只验证第一屏、canvas、Inspector、Timeline、无 console error 和关键交互，不进入默认快速测试的核心路径。

推荐测试组织：

- `sandbox-long-chain.test.ts`：面向完整场景的长链路用例。
- `test/sandbox-harness.ts`：创建固定 seed runtime、memory renderer、fake asset summary、tick helper、input helper 和 snapshot helper。
- `test/snapshot-assertions.ts`：封装对象查找、timeline chain、content reference、renderer object 等断言。
- `test/long-chain-scenarios.ts`：沉淀 boot、idle automation、confirm、monster pressure、selection/camera 等场景步骤。

长期长链路场景至少包括：

1. Boot Chain：启动后 Campfire、Worker、Resource Node、Storage、Workshop、Tower、Monster、Road 都存在；renderer object、DataType、module summary 和 runtime event 正常。
2. Idle Automation Chain：无输入运行一段时间后，resource、worker task、route progress、battery/fatigue、campfire objective、road flow 和 deterministic snapshot 正常。
3. Input → TCA → GAS Chain：`confirm` 从 input action 进入 EventBus，触发 TCA rule，激活 GAS ability，改变 actor tag/effect/attribute，并进入 timeline。
4. Monster Pressure Chain：monster wave 或 attack 会改变 threat/building/world/GAS 状态，并促使 worker dispatcher 后续产生 defend/repair 行为。
5. Render Sync Chain：entity position 和 storage/building/work/threat/objective 状态变化会同步到 memory renderer 的 object patch 和 node patch。
6. Selection / Camera / Input Scope Chain：点击对象、点击空白、camera follow/free、game viewport scope 和 UI scope 都有明确行为。
7. Content Reference Chain：从选中对象能反查 Data document、asset、render rig、GAS actor、TCA/GAS 相关数据和 source pack，且不存在 missing reference diagnostic。

长链路测试应尽量使用行为断言，不断言脆弱的时间点和完整数组顺序。必要时使用区间、存在性、单调增长、稳定 id、固定 seed 快照片段等方式，避免测试因为表现层微调而频繁失效。

## 场景：Combat Proving Ground

`Combat Proving Ground` 是 Combat package 的独立参考场景。它不是另一套战斗实现，而是只通过公开协议组合 Data、GAS、Physics、Combat、World 和 App Host，用一间可重复重置的训练场验证完整交付链。

场景覆盖这些可观察行为：

- melee：用短距离物理 overlap 选择敌对目标并应用 GAS effect。
- hitscan：用即时物理 ray query 命中开放射线上的合法目标。
- projectile：生成真实 world entity、Physics body/collider 和 Combat projectile 状态，由 tick 驱动飞行、命中和回收。
- area：在同一区域放置多个敌方 actor 和一个友方 actor，用稳定候选选择一次命中多个合法目标，为每个目标应用 GAS Effect/Cue，同时证明 relationship policy 不误伤友军；场景表现必须同时显示范围、已锁定目标和逐目标命中反馈。
- cover：让静态 Physics collider 阻断射线，验证命中候选与 blocker 的解释结果。
- support：对友军 actor 定向应用恢复 effect，验证同一交付协议可承载非伤害效果。
- reset：恢复 actor 属性并清理在途 projectile，使每种测试可从相同初始条件重新执行。

训练场中的 actor、掩体和 projectile 都有可追踪的 world entity；属性和效果由 GAS 持有；delivery、projectile、physics body/collider、team policy 等引用来自场景 DataPack。玩家界面只呈现训练目标、操作入口、生命值、在途投射物和可理解的命中结果，完整 Combat/GAS/Physics trace 由 DevTools 提供。

Combat 的公共职责、协议与 adapter 边界以 [`../modules/combat.md`](../modules/combat.md) 为准。训练场只拥有场景布局、测试对象、按钮文案和视觉表现等应用内容；任何可被其他游戏复用的交付、关系判定、物理查询、projectile 生命周期或 trace 能力都必须留在对应 core/package。

## 场景：Audio Lab

`Audio Lab` 是 Game Audio 的独立听觉验证场景。它通过独立 App Host 组合 Phaser Driver、AssetManager 和 GameAudio，直接使用 `audio.music`、`audio.sfx`、`audio.dialogue`、`audio.mix` 与 `audio.spatial` 公共领域 API，不允许直接调用 Phaser Sound 或创建平行的 Web Audio 播放器。

场景必须让测试者能实际听见并观察以下差异：

- Music：至少四首节奏与编排差异明确的循环曲目、长期音乐状态、pause/resume/stop、adaptive stem intensity，以及短/标准/长三档 crossfade 任意切曲。
- SFX：sequence variation、layered event、UI Bus、scheduled start、并发抢占和有界 dedupe。
- Dialogue：speaker、priority queue、replace/skip、subtitle key、marker 和自动 music ducking。
- Mix：`master`、`music`、`sfx`、`dialogue` Bus 的 volume/mute，以及可切换的 Mix Snapshot。
- Spatial：保留恒定增益左右声像与正前方距离衰减两个独立校准，再提供可拖动 Listener/Emitter 的二维组合场；二维场必须同时显示坐标、欧氏距离、方位角、pan、线性 gain 和 dB，明确标出 min/max distance，并使用独立连续测试音验证稳定 identity、持续 loop handle 和实时 transform 更新。
- Lifecycle：浏览器用户手势 unlock、App Host tick、output suspend/resume、逻辑 playback instance、native playback count、事件与 diagnostics。

测试台使用场景本地、确定性生成的短 WAV fixture，经 AssetManager 和 Phaser asset loader 进入同一个 Driver runtime。fixture 只用于离线验证资源加载、分类控制器和 Backend 执行链，不进入通用 package，也不替代真实游戏的音频内容生产。页面必须明确标注合成的 radio line，避免把测试音误认为正式对白资产。

Audio Lab 的 UI 是低频测试控制台：每个按钮必须对应一个明确的公共 API 行为；当前 Music/Dialogue 状态、SFX 统计、Bus effective volume、Spatial pan/距离/衰减读数、逻辑/原生实例数和最近 lifecycle/diagnostic 必须同时可见。完整原始对象仍不得泄漏到 UI。

Audio 的公共职责、领域 API 与 Backend 边界以 [`../modules/audio.md`](../modules/audio.md)、ADR 0034 和 ADR 0035 为准。Audio Lab 只拥有测试内容、合成 fixture、控制台交互和场景级装配。

## 场景：Animator Lab

`Animator Lab` 是 Animator Core 与真实 Renderer Driver 的独立表现验证场景。它通过独立 App Host 组合 DataRegistry、Asset、Phaser Driver、Renderer、标准 Animator GameModule 和 DevTools；测试者只通过 Animator Handle 修改语义参数、提交 one-shot 或同步 Gameplay Phase，不能直接调用 Phaser Animation 或在 UI 中维护平行动画状态机。

场景使用一个含 `body` 与 `action` 两个 RenderNode 的复合 RenderObject，让不同 Animator layer 绑定到不同节点，并覆盖以下可观察行为：

- Graph transition：连续修改 `speed` 参数，验证 idle、run、sprint 状态切换与 backend clip 映射。
- Layer playback：locomotion 长期播放时，action one-shot 或 Gameplay Phase 在独立节点叠加，不覆盖基础移动层。
- One-shot policy：单次 fire、三连请求的 `queue-one` 有界排队，以及高优先级 hit reaction 对低优先级动作的打断。
- Marker：footstep、pulse、impact、phase lock/release 跨越播放时间点时进入场景 marker receiver，并由 Animator trace 保留可解释证据。
- Gameplay Phase：按指定进度恢复 authority phase，验证 phase mapping、normalized time、seek frame、取消以及 graph 重新接管。
- Reset/lifecycle：generation reset 清理 phase、one-shot queue、marker 视图与参数；场景退出时依次解绑 controller、销毁 RenderObject 并释放 Host/Driver runtime。

场景本地使用确定性生成的 spritesheet fixture，经 `asset.definition` 和 Phaser asset loader 进入 Driver 持有的同一个 runtime。fixture、Signal Runner 造型、自动检查序列和控制面板都属于 Sandbox 内容，不进入 Animator 或 Renderer 公共包。主面板只展示完成验证所需的当前 layer、clip、marker 和有界 trace 摘要；完整 Driver、Asset、Renderer、GameRuntime 与 Animator 状态仍由标准 DevTools 数据源提供。

Animator 的公共职责、层/one-shot/phase 协议与 Driver 边界以 [`../modules/animator.md`](../modules/animator.md) 为准。Animator Lab 的 headless 测试必须覆盖同一份 DataPack 的 graph、排队/打断、marker、phase seek 和 generation reset；浏览器 smoke test 另外证明真实 Phaser adapter 能把公共 playback frame 应用到两个 RenderNode。

## 场景：AI Lab

`AI Lab` 是 AI Core 的独立生态决策验证场景。它通过独立 App Host 组合 DataRegistry、World、GameRuntime、标准 AI GameModule、UI 和 DevTools，在一张微型生存地图里让多只小动物持续寻找食物、水源和休息处。测试者先看见普通游戏对象和行为结果，再按需展开选中个体的决策解释；页面不能要求用户先理解 Utility、Task 或 Scheduler 才能看懂场景。

常态生态中的每只可见动物都对应一个真实 AI agent 和 World entity，不使用只为制造诊断数字而存在的假 background agent。容量压力模式额外生成的动物也必须完整进入相同 World、AI、Navigation 和 Physics 链路；地图可以固定抽样表现，但 UI 必须同时显示真实总量与表现样本数，不能把样本数冒充实际负载。动物的位置、饥饿、口渴、体力和健康，以及食物、水源和休息处的位置与存量，都属于 Sandbox 本地 World 组件。场景覆盖以下可观察行为：

- 生存循环：动物持续代谢并根据需求在觅食、饮水、休息和探索之间选择；食物与水会被消耗并按各自速率再生，长期缺食或缺水会影响健康。
- Perception 与 Utility：Sensor 只通过 AI World read model 读取个体需求和最近资源，形成 bounded memory；hunger、thirst、fatigue、resource access 和 contentment 进入数据驱动 consideration。选中动物时用普通语言解释当前选择，具体 score 和 fact 放在次级详情。
- Task 与 Intent：寻路式移动、进食、饮水和休息全部由 task executor 输出标准 movement / interaction intent；executor 不直接改写位置、需求或资源。觅食、饮水和休息必须经过定向、移动、到达准备、持续执行和收尾，探索必须经过定向、移动和停留观察；成功路径不能在启动 tick 直接结束。Sandbox controller 在 authority tick 后统一结算 intent、代谢和资源再生。
- Scheduler：所有动物共享固定 decision/sensor/path/trace tick budget；当前被观察的动物自动切到 `nimble`，上一只自动回到 `steady`，让对象选择本身成为动态 LOD 策略。当前 class、决策延迟、path rejection 与 trace drop 只进入折叠详情或 DevTools，不在主界面堆成能力控制台。受控预算压力只能从真实 task context 发起请求，不能生成与地图无关的假 agent；触发时主舞台必须显示鸟群、全体“重算”气泡和当前路线。
- 容量压力：主场景提供可选测试上限，并从小规模开始自动倍增真实动物；压测动物使用明确的 background scheduler class，相同资源目标和有限 Wander 目标池共享 goal-keyed route field，不能为每个个体创建一次性目标和重复的全图搜索。AI 路径准入、Navigation 每 tick 处理量、pending/result/route/cache 容量统一在 app profile 配置；准入允许把可控突发先送入有界 Navigation 队列，后端仍按帧预算消费，queue-full 或结果丢失时 task 使用确定性退避而不是逐 tick 重试。
- 每档先等待导航启动积压收敛，再采集真实 animation frame interval、完整 authority simulation 耗时、AI 调度延后、Sensor 延后和 path rejection；少量持续在途请求视为稳态，不要求队列绝对归零，预热超时与冷启动耗时必须单独报告，不能混入稳态 p95。稳定上限按可交互的 30 FPS 帧预算判定，frame p95 允许 36ms 的浏览器抖动窗口，同时要求 authority simulation p95 不超过 28ms，并检查调度延后和路径拒绝 QoS；达到所选上限时结果表达为“至少达到该上限”，未通过时保留上一档稳定数量。
- 测试停止或完成后必须 unbind 压测 agent、despawn 对应 World entity 并恢复常态生态。压力状态机只在每档稳态采样的起止边界读取完整 runtime counters，观察册按低频 UI cadence 读取 presentation snapshot；不能在 authority frame 中复制 O(agent) 诊断状态并把复制成本混进真实帧率。行为日志和林地事件只记录常驻故事动物，trace retention 继续服从上层配置；地图最多投影固定数量的真实压测动物，动物节点保持稳定并只更新发生变化的表现属性，background 样本关闭纯装饰动画，避免 DOM reconciliation、layout 和 paint 遮蔽 AI/Navigation 容量。
- 空间与共享事实：所有资源移动和探索 task 都必须进入 Navigation 的 request、poll、sample、release route lifecycle，不能按 Physics raycast 结果绕过寻路。AI Lab 使用覆盖整个林地的细粒度 Grid backend；Grid cell 从倒木、岩石所用的同一份 Sandbox obstacle blueprint 生成，并按 agent radius 扩张 collider footprint。地图对象开关同时更新 Physics collider 与 `navigation.updateObstacle()` 的 custom target，使 Navigation revision、route field、retained route 和最终路径真实失效/重算。主舞台投影 backend 返回的 route points；authority movement 在应用位移前再用同半径 Physics shape cast 阻止穿模。林地警戒通过只读 `AiSharedFactQueries` 注入并形成高优先级安全 Goal；动物必须经过定向、寻路、移动、藏好、等待和解除后的收尾过程，不能只降低探索分数或只改变诊断数字。
- Checkpoint：测试者可以用“叶印”保存和恢复 AI checkpoint 与对应的 Sandbox World 状态，包括动物位置/需求、资源存量、障碍开关和共享警戒。AI 恢复必须经过 entity、actor 和 task state resolver；task state 中的 request/route handle 不能原样复用，而应清除 native/runtime identity 并从稳定目标重新申请路线。主舞台用位置残影和回溯波直接表达保存/恢复结果，resolver 数量只保留在诊断数据中。
- 地图表达：主视野直接显示动物、资源余量、当前动作、真实直行/绕行路线、昼夜时间、警戒波、鸟群重规划、叶印残影与回溯效果；每只动物头顶持续显示当前行为气泡，并根据 task phase 区分觅食/进食、找水/喝水、找窝/休息、躲藏/等待、探索/观察、重算和收尾。右侧观察册展示选中个体的生存状态、行为阶段、连续进度、五个候选选择和近期林地事件。原始 memory、blackboard、task id、scheduler 与预算指标默认折叠，完整 trace 仍由标准 DevTools 提供。
- 行为诊断：场景持续为每只动物保留最近 10 秒的有界行为历史，而不是从选中时才开始记录。选中动物后可以导出 JSON，内容至少包含定频位置/需求/goal/task/phase/progress/target 样本、标准 intent、AI trace、场景事件、当前 memory/blackboard、资源快照和 runtime summary；日志采样与 intent 保留必须限频并随时间窗口裁剪，不能形成无界开发期存储。
- 自然干预：测试者可以补充食物、触发降雨、直接点击并移动物理遮挡、敲响或解除警铃、惊起鸟群、留下或恢复叶印、暂停、确定性单步和调整观察速度。干预只改变 Sandbox world/resource/collider/shared-fact/checkpoint state，不能绕开标准 AI 决策直接指定动物 goal。
- Lifecycle：场景启动时创建 World entity 并绑定对应 agent；退出时先 unbind 全部动物、释放场景 entity，再由 App Host 释放 GameRuntime 和 AI module。

动物物种、名字、林地布局、食物点、水塘、地洞、倒木、岩石、昼夜节奏和自然观察册视觉都属于 Sandbox 内容，不进入 AI Core。Headless 测试使用 `@gamekits/ai-core/testing` memory fixture 消费同一 DataPack、Sensor、input resolver 和 task executor，并组合正式 Grid Navigation backend 与 Memory Physics backend，验证可见动物与 agent 一一对应、移动与生存交互、全部行为的阶段序列、自动动态 LOD、共享警戒驱动躲藏、动态 obstacle revision、route 线段不进入扩张 collider、清障后最短路缩短、逐 tick 圆形体积不穿模、path/trace budget、压力动物真实 bind/unbind 与 World 清理、容量探顶状态机、AI 与 World checkpoint 恢复、选中前历史仍可导出、资源干预、选中个体解释和确定性单步；浏览器 smoke test 另外验证地图第一屏、常驻行为气泡、警戒群体行为、全体重算、真实 route 折线、可点击障碍后的路径变化、容量压力选项与实时结果、叶印残影/回溯、日志导出、自然干预和 console error。

AI 的公共职责、Utility/Task/Scheduler/Trace 协议与应用边界以 [`../modules/ai.md`](../modules/ai.md)、ADR 0031 和 ADR 0044 为准。

## 场景：Navigation Lab

`Navigation Lab` 使用多张真实俯视游戏地形验证 Navigation Core 与不同 Backend。`Ashen Ford` 是紧凑的三通路基础场景，包含出发营地、守望城门、河流、石桥、狭窄山道、芦苇沼泽和可开关的传送石；`Blackglass Basin` 是 30 × 20 米的反应堆街区深入场景，由建筑占地、围墙、院落、狭窄室内通道、死路、中央防爆门、只适合轻型单位的高架通路、高成本冷却液区域和应急传送中继构成，起终点横跨街区对角线，路径必须围绕真实阻挡连续转向。玩家在两个场景中都选择斥候、补给车或重甲卫队，下达单体移动或队伍集结命令。技术 trace 和压力测试保留在次级 QA 区域，主画面首先表达“单位为什么选这条路、世界变化后路线发生了什么”。

应急传送中继是离散 portal traversal，不是跨越建筑的连续直线。Graph、Grid 和 Recast 在同一个 sample API 中提供各自投影后的 entry/exit；共享移动 system 让单位先抵达 entry，再执行 Sandbox 的原子 relay 表现并从 exit 继续采样。场景行为矩阵必须验证 Rally Party 能实际越过中继，不能只验证 route request 返回 complete。

每张地形的任务、出生点、目标点、交互地标、操作文案和表现布局只在自己的 scenario definition 中定义一次。该场景下的 Backend provider 负责提供 typed layout/source、`NavigationBackendFactory[]` 和场景语义障碍到 backend target 的映射，例如同一个“封锁主要通路”操作在 Graph 中可以映射到 edge，在 Grid/Navmesh 中可以映射到 area、tile set 或 custom target。共享 controller、移动 system、UI 和测试只消费 scenario definition 与公开 Navigation Handle，不 import Graph node、navmesh polygon、grid tile 或 native runtime。

场景和 Backend 是两个独立选择维度。切换任意一项都先释放当前 GameRuntime/Navigation runtime，再用同一 GameAppDefinition、同一场景 controller API 和同一 UI 重建 App Host 会话；两个维度都进入共同的 scenario × backend 行为测试矩阵。Graph、0.5 m Traversal Grid 和 Recast NavMesh 通过对应 provider/definition 接入，不复制 controller、UI 或会话 lifecycle；需要异步初始化的 Backend 在 provider preparation 边界完成 boot，不能侵入共享 gameplay API。

场景地图必须直接表达 Navigation 结果，而不是只展示表格：

- Path：显示出发地、目的地、完整移动路线、cost、cache hit/miss 和沿路线移动的单个游戏单位。
- Party Rally / Shared Route Field：队伍集结是 Backend-neutral 的玩法命令。Graph、Grid 和 Recast 都让多个队员共享一个 goal-keyed field，其中 Recast 使用保持 portal 方向和 area cost 的 polygon field；只支持 point path 的其他 Backend 为每个队员提交并保留独立路线，不能把多次 path query 伪装成共享 field。主画面显示队伍和实际路线，只有真实 field 才在 Route Overlay 中显示共享采样方向。
- Agent Profile：Pathfinder、Supply Wagon、Iron Guard 分别对应不同半径、高度、坡度、area 与 cost 约束；狭窄/高架通路、主要道路和高成本危险区域必须产生可见的选路差异。
- Dynamic topology：测试者通过封锁主要通路、改变危险区域 cost/blocked 状态、启用场景 shortcut 和触发全域 lockdown 改变游戏世界，同时观察 revision、dependency invalidation、旧 route stale 与重新规划结果。深入场景必须覆盖“主要通路关闭后改道、第二通路失效后 unreachable、shortcut 恢复可达、全域封锁再次 unreachable”的组合链路。
- Request lifecycle：提供 queue burst、cancel-before-submit、max-cost failure、unreachable lockdown、repeat/cache 和显式 route release 操作。
- Capacity：次级 QA 区域可以启动 100 到 20,000 个循环移动单位共享同一个 route field，并显示 field planning、agent spawn、每 tick sampling/steering 的 average、p95、peak 和 4 ms navigation slice 判定。Canvas 只抽样绘制固定数量的单位 marker，避免把渲染成本错误计入 Navigation 结果；可复现的 Graph/Grid/Recast headless sweep 由仓库 benchmark 负责。
- Projection / Sampling / Progress：地图点击可以设置 start、goal 或 projection probe；agent 移动只消费 `sampleRoute()`，暂停移动后由 progress tracker 显示 stuck，不能由场景复制另一套寻路算法。
- Backend Debug Draw：提供独立的 Topology、Area Cost 和 Constraints 图层选项。Graph provider 将最终语义节点、边和 portal 投影为通用点/折线，Grid provider 将实际可走 cell 和 portal 投影为通用多边形/折线，NavMesh provider 将最终 polygon boundary/portal 投影为通用多边形/折线；共享 canvas 只消费场景级调试几何，不 import graph node、grid cell、native poly ref 或 WASM 类型。候选 visibility、voxel、contour 等生成中间数据只能进入独立高级诊断层。Constraints 图层必须结合当前 Agent Profile、桥梁/山道/沼泽状态和 portal enabled 状态表现可用、受限与阻断数据。
- Observability：场景低频显示 pending/queued/submitted、retained result/route、cache、backend route field、revision 和最近 Navigation trace；完整诊断仍进入 DevTools。

Navigation Lab 的地形和玩法语义属于 Sandbox。对于需要比较相同自由空间的场景，Sandbox 维护唯一的 app-owned terrain/placement source：canvas 从它绘制墙体、建筑和可走地面；Graph provider 消费落在真实地形上的少量语义 waypoint/route 标注；Grid provider 把同一份 1 米可走 tile 细分为 0.5 米 cell；NavMesh provider 从同一 source 生成 Recast triangle input。Graph authored node/edge、Grid cell/region 和 NavMesh bake/native data 分别只存在于对应 provider/adapter；调试几何和行为测试必须能反向验证到同一 terrain source，禁止分别维护互不相关的展示背景和寻路 topology。任何 Backend-specific authoring 或 Recast native 数据都不能进入共享 controller、Navigation Core 或 UI 协议。Navigation 的长期职责和使用约束以 [`../modules/navigation.md`](../modules/navigation.md)、ADR 0036、ADR 0037、ADR 0038 和 ADR 0039 为准。

## 设计约束

- Sandbox 可以使用复杂本地数据和本地组件，但不能把演示专用概念上推到核心包。
- Sandbox 不能成为真实游戏逻辑仓库；当某个能力证明通用后，再提炼到对应模块。
- 舞台表达优先于面板堆叠；Inspector 和 Timeline 是解释层，不是主表达层。
- 基础概念必须容易理解，复杂性应来自系统组合和状态变化，而不是名词抽象。
- 任何新第三方库仍必须通过 Driver、adapter 或 app 层接入。
- 固定 seed 下的自动循环必须可测试、可复现。

## 最佳实践

### 模块集成

- Sandbox 首要任务是验证框架协作链路，不是沉淀可复用玩法。复杂 demo 逻辑只能服务于 App Host、Data、Asset、Renderer、Input、Camera、Physics、TCA、GAS、Save 和 UI 的端到端说明。
- Sandbox app shell 负责把 App Host、Driver、Renderer、Input、UI、Save 和标准 GameModule helper 组装起来；Sandbox game module 不直接 import Phaser、Koota、DOM 或 React internal。
- Sandbox 长链路测试应优先覆盖“模块是否协作”：内容引用、资源加载、自动循环、TCA/GAS 链路、选择/镜头、save/load、diagnostics/timeline。
- 浏览器手动验收关注第一屏信息层级、game viewport scope、camera 坐标转换、可点击对象、Save/Load 本地恢复和 console error；不要以视觉花活替代协议验证。
- Audio Lab 手动验收必须使用真实浏览器输出设备，依次检查 unlock、Music crossfade/intensity、SFX variation/layer/concurrency、Dialogue ducking/queue、Bus mute/volume、恒定增益 pan sweep、带数值读数的距离衰减，以及二维场中 Listener/Emitter 的拖动、四向 preset、左右声像和远近衰减联动；Memory Backend 测试不能替代该听觉验收。

### 模块使用

- Sandbox 内容按 Tiny Camp 真实业务概念组织，但不要把 Worker、Campfire、Monster、Recipe 等演示概念写入核心模块文档或公共 API。
- Sandbox UI 只消费 snapshot、diagnostics 和低频状态；当前 selection、follow target、inspector tab、timeline filter 和 save/load 按钮状态属于 workbench state，不写入 GameRuntime 或普通进度存档。
- 场景点击、confirm、camera action 都通过 Input action/scope 进入系统，不绕过 Input 直接改玩法状态。点击空白应明确清空 selection，而不是触发默认兜底选中。
- 交互 UI 使用 React 或 DOM builder + `textContent`，不要用 `innerHTML` 拼接按钮、Inspector、Modal、Tip 或场景对象卡片。
