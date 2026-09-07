# Abyss Delve 应用设计

## 定位

Abyss Delve 是 GameKits 的真实游戏验证应用。它不是 Sandbox，也不是框架功能展示页，而是一个按真实项目方式组织的小型游戏 app。

游戏品类选择为常见的俯视角肉鸽暗黑-like：玩家控制一个角色进入地下城房间，清理怪物，获得掉落和临时构筑奖励，推进到精英房和 boss。它不追求玩法创新，优先采用市场上成熟、容易理解、框架验证价值高的设计模式。

核心目标是验证 GameKits 能否支撑一个真实游戏项目的长期组织方式：

- App Host 负责应用启动和服务组合。
- GameRuntime 只承载游戏会话模块。
- DataPack 定义角色、怪物、技能、掉落、房间、词缀和表现。
- GAS 管理 actor、属性、技能、效果、tag、cue。
- TCA 管理低频规则、房间事件、掉落、奖励和随机事件。
- Renderer / Input / Camera / UI / Save / DevTools 以真实游戏方式协作。

## 非目标

- 不做玩法创新，不设计全新的 genre 机制。
- 不追求大体量内容、复杂剧情、联网、排行榜或商业化系统。
- 不把 Abyss Delve 的职业、怪物、掉落、地图、UI 术语上推为 GameKits 核心协议。
- 不为了 demo 方便绕过 DataRegistry、AssetManager、GameModule、RendererAdapter 或 App Host。
- 不让 gameplay module 直接依赖 Phaser、DOM、React、GSAP、Koota 或 App Host 内部实现。

## 游戏体验目标

Abyss Delve 应该像一个小而完整的常见 ARPG roguelite：

- 玩家第一眼能看懂自己、怪物、技能、血量、掉落和当前房间目标。
- 操作方式熟悉：WASD 移动，鼠标瞄准或自动朝向，左键普攻，数字键技能，空格闪避，E 交互。
- 战斗反馈清晰：伤害数字、血条、攻击前摇、范围预警、命中 cue、受击和死亡表现。
- 成长反馈明确：击杀掉落金币、装备、宝石或临时祝福；房间结束选择奖励；装备和词缀改变属性或技能。
- 游戏结构稳定：一局由多个房间组成，包含普通房、精英房、事件房、商店或 boss 房。
- UI 低频但完整：HUD、技能栏、背包/装备、奖励选择、房间地图、暂停、DevTools 入口和存档入口。

质量标准不是“内容很多”，而是“一个真实游戏项目会怎么组织”。即使只有少量职业、怪物和房间，也必须让模块协作、数据引用、状态恢复和调试链路足够真实。

## 核心循环

```txt
选择角色 / 加载存档
  -> 进入地下城 run
  -> 生成房间
  -> 战斗 / 走位 / 使用技能
  -> 怪物死亡
  -> 掉落 / 经验 / 金币 / 临时祝福
  -> 房间完成
  -> 选择奖励或进入事件
  -> 推进下一房间
  -> boss / 死亡 / 撤离
  -> run 结算和长期进度保存
```

Abyss Delve 的最小可玩规格包含：

- 1 个可控玩家角色。
- 3 类普通怪物。
- 1 个精英怪或小 boss。
- 1 个普攻和 2 个主动技能。
- 3 类掉落：金币、装备、临时祝福。
- 2 个房间类型：combat room、reward room。
- 1 条保存路径：角色长期进度和最近一次 run checkpoint。

## 场景结构

### Dungeon Room

房间是运行时主单位。每个房间由 DataPack 定义 room template，再由 runtime 按 seed 实例化。

房间数据包括：

- room id / type / tags。
- bounds、spawn points、exit gates、loot anchors。
- enemy wave profile。
- obstacle / interactable / shrine / chest。
- render theme 和 music / ambience 引用。
- completion condition。

`music / ambience` 在当前设计中只作为资源 metadata 和 Audio 模块的预留引用。若引入 Audio，需要补充模块设计或 ADR。

房间完成条件默认使用成熟设计：

- 杀死全部敌人。
- 击败精英。
- 开启宝箱。
- 存活指定时间。

### Actor

Actor 包括 player、monster、summon、projectile owner、destructible object。

Actor 运行时状态应落在 World component 上，以便移动、索敌、碰撞范围、伤害结算和显示更新保持高频性能。

Actor 长期定义来自 DataPack：

- `gas.actor`
- `gas.ability`
- `gas.effect`
- `render.object`
- `asset.definition`
- 游戏自定义 `abyss.actorArchetype`
- 游戏自定义 `abyss.enemyProfile`

### 战斗空间与碰撞

Abyss Delve 的实时战斗需要命中、投射物、碰撞范围、障碍、攻击预警和 projectile ownership。长期边界是：

- gameplay 不直接依赖 Phaser physics、Phaser Scene、DOM hit-test、Rapier、Matter.js 或 Koota 私有 API。
- 可复用碰撞体、触发器、空间查询和接触事件通过 `@gamekits/physics-core` 及其 backend adapter 接入；不用统一物理模块的轻量场景仍可以保留 app-local World component 和数学查询。
- hitbox、hurtbox、projectile owner、pierce、lifetime、team/faction、damage channel 都是 Abyss Delve app-local gameplay 数据，最多引用 physics body/collider，不进入 `@gamekits/world`、`@gamekits/renderer-core` 或 `@gamekits/physics-core` 公共玩法语义。
- Renderer 只表现 telegraph、projectile、impact 和 hit cue，不负责战斗命中判定。
- 如果引入 pathfinding、navmesh 或 AI avoidance，必须另行判断模块边界；这些能力不随 Physics package 自动进入核心。

### Loot

Loot 是验证 Data / GAS / TCA / Save 的核心压力点。

掉落定义分层：

- loot table：决定掉什么。
- item base：武器、护甲、饰品、消耗品。
- affix：词缀定义和 roll 范围。
- rarity：稀有度和词缀数量。
- reward choice：房间结束三选一或事件奖励。

装备系统不要求完整复杂背包，但必须支持：

- 装备生成来自 DataType 和 seed。
- 装备拥有稳定 id、base、rarity、affixes、rolled attributes。
- 装备能改变 GAS attributes、tags 或 ability modifiers。
- Save 能恢复装备和长期货币。
- DevTools 能追踪一次掉落来自哪个 loot table、哪些 roll、应用了哪些效果。

## 模块协作

### App Host

应用通过 `GameAppDefinition + AppProfile` 启动，不在 app 入口手写一堆 adapter。

标准服务：

- platform
- drivers
- data
- assets
- renderer
- input
- game
- ui
- save
- devtools

App 层只提供 profile 参数、DataPack、UI mount 和少量启动配置。

### Game Modules

Abyss Delve 玩法应拆成多个 GameModule，不堆到一个大模块中：

- `player-control-module`：读取 input action，更新玩家移动、aim、interact、dodge intent。
- `dungeon-room-module`：房间实例化、波次、出口、完成状态。
- `combat-module`：高频移动、攻击范围、projectile、hit、damage queue。
- `loot-module`：掉落表、item roll、拾取、奖励选择。
- `presentation-module`：render object sync、cue、floating text、telegraph。
- `ui-bridge-module`：低频 UI snapshot 和 command bridge。
- `save-contributor-module`：run checkpoint、meta progression、inventory contributor。

Camera、Physics、TCA、GAS 使用 App Host 标准 GameModule helper 注入，不作为 app service。

### Data

游戏应自由定义自己的 DataType，不被框架模板限制。

建议自定义 DataType：

- `abyss.heroClass`
- `abyss.actorArchetype`
- `abyss.enemyProfile`
- `abyss.roomTemplate`
- `abyss.waveProfile`
- `abyss.lootTable`
- `abyss.itemBase`
- `abyss.itemAffix`
- `abyss.rewardPool`
- `abyss.runMilestone`
- `abyss.presentationCue`

每个业务内容文件可以混合内置类型和自定义类型。例如一个 monster 文件可以同时定义 enemyProfile、gas.actor、gas.ability、gas.effect、render.object 和 asset references。

### GAS

GAS 承担战斗核心语义：

- health、resource、armor、moveSpeed、attackPower、critChance、cooldownReduction。
- actor tags：player、monster、elite、boss、stunned、burning、shielded、summoned。
- ability：basic attack、fireball、dash slash、monster bite、elite slam。
- effect：damage、heal、dot、slow、stun、shield、temporary buff。
- cue：hit spark、impact shake、floating damage、death burst、loot beam。

World component 保留热状态；DataPack 保留定义；GAS runtime 负责 ability/effect/tag 规则。

### TCA

TCA 只处理低频规则，不进入每帧战斗循环。

典型规则：

- room.entered -> spawn wave。
- actor.died -> roll loot、check room completion。
- loot.picked -> apply item or currency。
- room.completed -> open reward choices。
- reward.selected -> apply blessing。
- player.low_health -> emit warning cue。
- elite.spawned -> apply affix abilities。
- boss.defeated -> complete run。

每条规则都必须能在 DevTools 中看到 trigger、condition、action 和结果。

### Renderer

Renderer 以 RenderObject / RenderNode 表达复合对象，不暴露 sprite-first API。

Abyss Delve 的表现要求：

- player 复合对象：body、weapon、shadow、aim indicator、status ring。
- monster 复合对象：body、health bar、elite outline、attack telegraph。
- projectile：travel effect、impact cue。
- loot：beam、rarity color、pickup pulse。
- room：floor、walls、spawn markers、exit gate。

Renderer sync 只消费 World / presentation component，不读取 DataRegistry 全量内容。

### Input

默认输入：

- WASD：移动。
- Mouse move：aim / target。
- Left click：basic attack。
- Right click：secondary skill。
- 1 / 2 / 3 / 4：技能。
- Space：dodge。
- E：interact / pickup。
- Tab：map / inventory toggle。
- Esc：pause。

Input scope 必须保证 UI、DevTools、文本输入或 modal 聚焦时不会误触发 gameplay action。

### Camera

默认镜头是跟随玩家的俯视角 camera rig：

- follow player。
- lookahead toward aim / movement。
- soft bounds clamp。
- combat hit shake。
- boss intro / room completion 临时 camera command。

Camera Core 不直接知道 Abyss Delve 的 actor component；target resolver 由 app/game module 提供。

### UI

UI 应围绕真实游戏体验组织，而不是模块卡片：

- HUD：health/resource、skill bar、cooldown、current room objective。
- Loot pickup prompt。
- Reward choice modal。
- Inventory / equipment panel。
- Run map / room progress。
- Pause menu。
- Run summary。
- DevTools launcher / performance pin。

React UI 只消费低频 snapshot 和 command，不订阅每帧 ECS position。

### Save

保存分成两类：

- Meta progression：已解锁职业、永久货币、设置、历史统计。
- Run checkpoint：seed、当前房间、玩家属性、装备、背包、已选择祝福、房间进度。

不保存：

- renderer native handle。
- React component state。
- 输入按键瞬时状态。
- 粒子、floating text、短生命周期 cue。
- 当前打开的 DevTools tab 或 pin 状态。

### DevTools

Abyss Delve 必须把 DevTools 作为真实开发工具使用：

- Performance pin 默认开启。
- Event / TCA / GAS trace 能解释一次击杀到掉落再到拾取的链路。
- Actor inspector 能查看选中 actor 的 world state、GAS state、data refs、render object。
- Loot inspector 能查看 item roll、loot table、affix source。
- Save panel 能查看 run checkpoint contributor。
- Profiler 能看到 combat system、render sync、room system、loot system。

Actor inspector、Loot inspector、Room inspector 等都是 `apps/abyss-delve` 注册的 app-specific DevTools data source / panel。它们不进入 `@gamekits/devtools` 核心协议；DevTools Core 只提供通用 source、panel、trace、diagnostic、profiler 和 command 机制。

## 内容组织

建议目录：

```txt
apps/abyss-delve/src/
  main.tsx
  app-definition.ts
  app-profile.ts

  game/
    create-abyss-runtime.ts
    components/
    modules/
      player-control/
      dungeon-room/
      combat/
      loot/
      presentation/
      ui-bridge/
      save/
    content/
      heroes/
      enemies/
      rooms/
      loot/
      abilities/
      effects/
      visuals/
      rules/
      index.ts
    snapshot/
    test/

  ui/
    shell/
    hud/
    inventory/
    rewards/
    run-map/
    devtools/
```

内容文件按真实业务组织，不按 DataType 机械拆表。例如：

- `content/enemies/skeletons.ts` 可以同时定义 enemyProfile、gas.actor、gas.ability、render.object、asset.definition、tca.rule。
- `content/loot/swords.ts` 可以同时定义 itemBase、itemAffix、lootTable、render.object、asset.definition。

## 长期测试要求

Abyss Delve 应建立 headless-first 的测试夹具：

- fixed seed 创建 app host。
- memory renderer。
- fake asset loader。
- deterministic input helper。
- tick helper。
- snapshot helper。

长期测试链路：

- boot chain：App Host services、DataPack、Asset、GameRuntime、DevTools source 注册成功。
- combat chain：玩家攻击怪物，GAS damage effect 生效，怪物死亡。
- loot chain：actor.died -> TCA -> loot roll -> pickup -> inventory/equipment state。
- room chain：room entered -> wave spawn -> room completed -> reward opened。
- save chain：run checkpoint 保存、重新创建 runtime、加载后继续 tick 结果确定。
- devtools chain：trace 能串联 input/event/TCA/GAS/loot/save，Profiler 能看到核心 systems。

Browser smoke 只验证第一屏可见、canvas 正常、HUD 正常、基础输入、reward modal、DevTools performance pin 和无 console error；不替代 runtime 长链路测试。

## 质量边界

Abyss Delve 的最低质量标准：

- 玩家、敌人、投射物、掉落和房间目标必须有清晰可读的表现差异。
- 战斗反馈必须能看出攻击、命中、受击、死亡和掉落。
- UI 必须服务玩法，不堆模块卡片。
- 内容必须来自 DataPack，不硬编码到系统中。
- 每个核心机制必须能被测试和 DevTools 解释。
- 玩法专属代码留在 `apps/abyss-delve`，只有被证明通用的能力才能提炼到 packages。
