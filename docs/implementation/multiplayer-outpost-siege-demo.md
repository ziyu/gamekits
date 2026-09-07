# Outpost Siege Comprehensive Demo

Status: Active. Wave 0 through Wave 5 are verified; scope was expanded and replanned on 2026-07-12.

## Goal

实现独立应用 `apps/multiplayer-outpost-siege-demo`，通过一个完整、物理化、数据驱动、server-authoritative 的多人合作游戏验证 GameKits 当前所有核心能力能否在同一条真实产品链路中协同工作。

长期玩法体验以 `docs/apps/outpost-siege/README.md` 及其子文档为准，综合验证合同和模块协作以 `docs/apps/multiplayer-outpost-siege-demo.md` 为准。新的玩法基础实施工作流见 `docs/implementation/outpost-siege-gameplay-foundation.md`；本文件只维护原综合 Demo 工作流的范围、基础缺口、波次、决策门和验证证据。

## Scope Revision

2026-07-12 将目标从“复杂 Multiplayer 专项验证”扩展为“全框架综合验证”。Multiplayer 仍是关键约束，但完整验收还必须覆盖：

- Core Runtime、EventBus、GameModule lifecycle 和固定 system order。
- App Host、Config、Browser/Headless/Tauri profiles 和 Driver lifecycle。
- DataPack、DataRegistry、AssetRef、AssetManager preload/lazy/retry 完整内容资源链。
- World entity、Physics、TCA、GAS 组成的权威战斗系统。
- Input、Camera、Renderer、React UI 和 Cue presentation。
- Save contributor、checkpoint、migration 和 deterministic continuation。
- DevTools correlation、inspector、profiler 和 bounded diagnostics。
- 真实 Colyseus Room-owned authority、字段级 Schema、participant lifecycle、负载与 soak。

此次范围扩展不废弃已经完成的 Wave 0/1。它们是新的综合 Demo 所需的 Multiplayer/Physics foundation，并已提交为 `0ab9c2a`。

## Long-term References

- `docs/project-design.md`
- `docs/architecture.md`
- `docs/apps/multiplayer-outpost-siege-demo.md`
- `docs/modules/app-host.md`
- `docs/modules/core-runtime.md`
- `docs/modules/data.md`
- `docs/modules/assets.md`
- `docs/modules/world.md`
- `docs/modules/input.md`
- `docs/modules/camera.md`
- `docs/modules/physics.md`
- `docs/modules/tca.md`
- `docs/modules/gas.md`
- `docs/modules/multiplayer.md`
- `docs/modules/renderer.md`
- `docs/modules/ui.md`
- `docs/modules/save.md`
- `docs/modules/platform.md`
- `docs/modules/devtools.md`
- `docs/adr/0016-room-owned-server-authority-lifecycle.md`
- `docs/adr/0017-app-owned-colyseus-field-schema-boundary.md`
- `docs/adr/0018-server-authoritative-gameplay-module-execution.md`
- `docs/adr/0019-domain-owned-gameplay-save-contributors.md`
- `docs/adr/0020-explicit-authority-pipeline-and-bounded-correlation-source.md`

## Verified Baseline

Wave 1 commit：`0ab9c2a Build multiplayer authority foundation`。

已验证基础：

- Multiplayer authority loop 支持受约束 `beginTick()` / `commitTick()`，并保留兼容 `tick()`。
- Authority action/input 与 standard Multiplayer GameModule command queue 使用有界 ring queue。
- Queue capacity、per-tick consumption、overflow、expired、coalesced 和 diagnostics 有测试。
- Physics GameModule 维护 body/collider → entity 反向索引，并清理 despawn/disabled stale handles。
- `@gamekits/multiplayer-core` 43 tests、`apps/multiplayer-demo` 59 tests、`@gamekits/physics-core` 8 tests 通过。
- Multiplayer benchmark 12/12 budgets 通过；Physics 3,000 entity profile 约 4.43 ms/tick。
- 全仓库 test、build、lint、format 和 world benchmark 通过。

Relay Arena 继续承担最小 Multiplayer regression。Outpost Siege 不修改其职责。

## Current Framework Gaps

代码核对后，综合 Demo 开始前需要先补齐以下真实缺口，不能在 app 内旁路实现：

### GAS Runtime

- 现有 GAS 已支持 entity-backed actor、attribute/tag、ability、cost、cooldown、effect、periodic update、cue 和 trace。
- 需要补 actor remove/despawn cleanup，防止 World entity 销毁后 runtime mapping 和 effect state 泄漏。
- 需要明确并实现可验证的 effect stacking/refresh/replace policy；不能让同类 duration effect 无限制增长。
- Ability/effect/attribute/cue trace 需要携带稳定 correlation context，连接 network action、Physics hit、TCA rule 和 presentation cue。
- Gameplay module 需要稳定、可注入的 GAS runtime access boundary；不能长期靠 app closure 捕获 standard module 的内部 runtime。
- 需要标准 GAS Save contributor，恢复 attributes、tags、cooldowns 和 active effects，并处理 entity remap。

### TCA Runtime

- TCA 已支持 rule compile、event index、condition/action、priority、once 和 trace。
- TCA trace 需要 correlation/parent context，连接触发 event 与派生 GAS/World/Cue fact。
- Once/runtime-local state 需要标准 Save contributor；restore 不能重新执行已经完成的 once rule。
- Outpost app definitions 必须通过稳定 handler context/bridge 使用 World、PhysicsQueries 和 GAS，不得 import app/server/backend private objects。

### Physics / World / Save

- 需要 app-owned、显式可保存 component definitions 和 stable gameplay id ↔ EntityId remap。
- Physics Save contributor 需要保存可恢复状态并在 World restore 后重建 scene；不能保存 Rapier handle/cache。
- Contact 到 semantic hit candidate 的转换属于 app combat module；Physics core 不加入 damage/team/projectile 语义。

### App Host / DevTools Composition

- 需要证明 standard camera、physics、TCA、GAS、multiplayer modules 与 app modules 能按权威 pipeline 顺序安装和释放。
- TCA/GAS/Physics/Multiplayer trace source 需要进入同一个 DevTools correlation timeline，并保持默认低开销、有界。
- Headless Room、Browser client 和 Tauri client profile 必须共享 app definition/content contract，但提供不同 adapter 和 service 参数。

### Colyseus Server Boundary

- `@gamekits/multiplayer-colyseus/server` 需要不包含 app gameplay/Schema 的 typed Room-side runtime bridge。
- App-owned Schema projection、participant policy、AI、combat、TCA/GAS 和 Save checkpoint 保持在 Outpost app。

## Architecture Decisions

### Authority

- 在线正式结果只由 Room-owned authority GameRuntime 决定。
- Server 运行 World、Physics、AI、TCA、GAS、objective、spawn/despawn 和 checkpoint capture。
- Client 不运行决定正式 damage/effect/objective 的 TCA/GAS，只维护 authority shadow、prediction、presentation 和 UI view model。
- Local authority/headless fixture 使用相同 gameplay modules，不维护第二套 reducer。

### System Order

```txt
authority begin / ingress
  -> participant and input intent
  -> movement and AI
  -> Physics sync / fixed step
  -> contact and query facts
  -> combat / GAS
  -> TCA / objective / lifecycle
  -> checkpoint dirty state
  -> replication projection
  -> authority commit / provider publish
  -> diagnostics
```

GameRuntime 继续使用注册顺序，不新增全局 phase catalog。Outpost composition tests 固定 app-specific order。

### Combat Boundary

- Entity 是战斗对象的 runtime 载体。
- Physics 负责空间与运动；World/app components 保存 intent、team、projectile、lifetime 和 identity。
- GAS 负责 ability/effect/attribute/tag/cost/cooldown/cue。
- TCA 负责状态反应、击杀链、波次、目标、掉落和 boss phase 等低频规则。
- EventBus 只发送 ability activated、hit confirmed、actor died、wave completed 等低频事实。
- Renderer/UI/Cue 只表现结果，不决定 gameplay。

### Data And Asset Boundary

- 所有 archetype、ability、effect、rule、physics、render 和 asset 定义进入 DataRegistry。
- App content 文件可以按 player/enemy/building/wave 业务概念组织，一个文件可混合多个 DataType entry。
- AssetManager 从 `asset.definition` 建立 boot/match/combat/boss load plan。
- Gameplay 和 RenderObject 只保存 AssetRef/asset id；不直接保存 URL 或 native texture。
- Headless server 注册相同定义和引用，但跳过纯视觉资源加载。

### Save Boundary

- 保存 authority gameplay checkpoint，不保存网络连接或 client presentation。
- Restore order：Data/Asset compatibility → World identity/entity → Physics → GAS/TCA → app gameplay → replication rebuild。
- Restore 后 participant/session 重新绑定；旧 input epoch、queue、Schema collection 和 prediction history 不恢复。

## Implementation Waves

### Wave 0: Workflow Baseline And Decisions

Status: Verified on 2026-07-11.

已完成：Relay Arena baseline、Room-owned authority ADR、app-owned field Schema ADR、authority system order、Physics profile 和性能 profile 规划。

### Wave 1: Multiplayer And Physics Foundation

Status: Verified on 2026-07-11; commit `0ab9c2a`.

已完成：staged authority tick、bounded queues、queue diagnostics、Physics reverse index/cleanup、tests 和 benchmark。

### Wave 2: Gameplay Framework Readiness

Status: Verified on 2026-07-12.

1. 为 GAS 增加 actor remove/cleanup、effect stack policy、correlation context 和稳定 runtime handle/bridge。
2. 为 TCA trace 增加 correlation/parent context，确保派生 event 继承因果信息。
3. 实现 GAS、TCA 和 Physics 的标准 Save contributor；World 可保存组件与 app entity mapping 使用既有 Save contributor 协议组合。
4. 用 App Host standard modules + app modules 固定 authority system order、runtime access 和 dispose order。
5. 为 TCA/GAS/Physics trace 与 DevTools source 增加 headless correlation fixture。
6. 更新对应模块长期文档、tests 和 microbenchmarks；公共 API 变化需要独立 ADR 或扩展 ADR 0018 后续决策。

完成标准：headless fixture 不依赖网络或 renderer，即可完成“ability request → Physics hit/query → GAS effect → TCA reaction → entity cleanup → save/restore continuation”的确定性链路，所有 runtime handle 和 trace buffer 可释放。

已验证切片：

- EventBus event envelope 支持 `correlationId` / `parentId`；TCA rule trace、内置派生 event 和 GAS TCA actions 继续传播因果链。
- GAS 支持显式 `removeActor`、entity despawn stale mapping cleanup、stable actor id rebind 和 module-bound `GasHandle`。
- Lifecycle effect 默认使用有界单栈刷新；显式 stacking 支持 limit、source match 和 reject/refresh/replace overflow policy。
- GAS tag 记录 grant source，effect expire/replace 不会移除其他来源仍提供的同名 tag。
- GAS ability/effect/attribute/tag/cue trace 与 EventBus fact 保留 correlation/parent；相关 runtime 已按 actor state、effect runtime、handle 和 operation context 拆分。
- 新增 gameplay framework microbenchmark 与 9 项粗粒度预算，覆盖 correlated EventBus fan-out、1,004-rule TCA indexed dispatch、GAS ability/effect chain、bounded stacking、500 entity actor idle/dormant/periodic tick 和 4,000 actor stale entity cleanup。
- GAS effect update 不再把 idle 或本 tick 未变化的 actor 写回 World；`periodMs` 必须严格大于零，避免 authority tick 进入不前进的 periodic loop。
- Physics、GAS 和 TCA 提供 domain-owned Save contributor 与 module-bound checkpoint handle；restore order 固定为 Physics `200`、GAS `300`、TCA `400`，并支持 entity remap、fixed-step accumulator、active effect/cooldown 与 once-rule continuation。
- App Host headless fixture 已通过真实 SaveManager JSON encode/store/load 验证 Physics + GAS + TCA + runtime clock continuation；restore 不保存 trace、native handle、contact cache 或 presentation state。
- 新增 checkpoint benchmark 与 6 项粗粒度预算；1,000 once-rules capture/restore 约 0.02/0.12 ms，1,000 GAS actors + 500 active effects 约 0.51/3.49 ms，1,000 Physics entities capture/restore+rebuild tick 约 4.07/7.22 ms。
- `@gamekits/event-bus` 4 tests、`@gamekits/tca` 10 tests、`@gamekits/gas` 15 tests、`@gamekits/physics-core` 9 tests、`@gamekits/app-host` 28 tests 和 Abyss Delve 17 tests 通过。
- 全仓库 `test`、`build`、`lint`、`format` 和 `bench:world` 通过；10,000 entities / 5,000 moving entities 的 Wave 2 最终隔离结果为 spawn/add 13.35 ms、query/update 7.97 ms。
- `bench:gameplay:check` 9/9 budgets 连续两次通过；本机代表结果为 TCA 1.56 µs/event、GAS combat chain 5.03 µs/activation、500 dormant effects 0.74 ms/tick、500 periodic effects 1.63 ms/tick、2,000 stale actor cleanup 5.25 ms。
- App Host headless authority fixture 通过公开 standard module helper 与 app modules 显式固定 10 个 module、9 个 system 的内部顺序，并验证外层 authority begin → ingress → movement → Physics → combat → GAS → checkpoint → replication → authority commit → diagnostics；Physics/GAS/TCA handle unbind 与 app cleanup reverse order也已覆盖。
- Multiplayer standard module 的 command fact 继承 message correlation，并以 message id 为 parent；同一 `combat-1` 的 Multiplayer → Physics → GAS → TCA 五段 trace 已进入统一 DevTools timeline。
- DevTools 提供 domain-neutral bounded correlation source；App Host 提供 TCA/GAS/Physics 增量映射 helper。Runtime trace、recent correlation 和 per-correlation roots 分别有界，domain package 不依赖 DevTools。
- `@gamekits/devtools` 8 tests、`@gamekits/app-host` 29 tests、`@gamekits/multiplayer-core` 43 tests、`@gamekits/tca` 10 tests 和 `@gamekits/gas` 15 tests 通过。
- 架构复查后收紧通用 correlation helper：TCA/GAS/Physics observer 与 error reporter 失败均不影响 gameplay；默认 GAS details / Physics payload 不进入 DevTools，自定义摘要经过显式 redaction；helper 自动注册 DataSource 并以单一 `dispose()` 关闭生命周期。
- Abyss Delve 作为第二个现有游戏注入同一套通用 GAS/TCA trace store，证明组合能力不依赖 Outpost 业务类型或玩法入口。
- `bench:diagnostics:check` 扩展为 5 项端到端预算；50,000 条 App Host → TCA/GAS/Physics → DevTools trace 的代表结果约 0.84 µs/条，runtime snapshot 约 0.0105 ms，保留 512 条 timeline、64 条 correlation summary 和 192 条 domain trace，全部有界并通过预算。
- 架构加固后的全仓库 70 个 test task、39 个 build task、lint、format 和 `bench:world` 均通过；`bench:gameplay:check` 9/9、`bench:diagnostics:check` 5/5 预算通过。

Wave 2 已关闭。下一步进入 Wave 3，创建 Outpost Siege app skeleton、app-owned DataType/content contract、资源分组和共享 profile definition。

### Wave 3: App Skeleton And Content Pipeline

Status: Completed on 2026-07-13.

1. 创建 `apps/multiplayer-outpost-siege-demo`，拆分 `domain`、`content`、`gameplay`、`server`、`realtime`、`presentation`、`ui`、`profiles` 和 `test`。
2. 定义 app-owned player/enemy/weapon/buildable/wave/objective DataType 和引用校验。
3. 注册 GAS、TCA、Physics、Renderer、Asset 内置 DataType，并建立第一批业务 DataPack。
4. 建立 boot/match/combat/boss Asset groups，使用 AssetRef、Phaser Driver loader、lazy/retry 和 diagnostics。
5. 建立 stable gameplay object id、EntityId、actorId、physics id、network identity、RenderObjectId 映射。
6. 创建共享 app definition，以及 Browser Web、headless server、deterministic test 和 Tauri smoke profiles。

完成标准：所有内容通过 Data/Asset pipeline 启动；缺失引用、重复定义、资源加载失败能定位 source/path；headless server 不加载视觉 payload；没有 gameplay 常量表或直接 URL 旁路。

当前已完成首个内容与身份切片：

- 创建独立 app package 及 `domain`、`content`、`gameplay`、`server`、`realtime`、`presentation`、`ui`、`profiles`、`test` 边界；共享 app definition 固定完整 service graph。
- App-owned player、enemy、weapon、buildable、wave、objective、render object 和 arena DataType 已接入同一 DataRegistry；当前 66 个 Asset/GAS/TCA/Physics/Render/Outpost document 形成 158 条显式引用，没有 gameplay URL 旁路。Arena document 的静态物体实例同时持有 render/collider DataRef，并且是 placement 与 `physics.layout` shape 的共同来源。
- boot、match、combat、boss group 与 Browser Web、headless server、deterministic test、Tauri smoke 的加载策略已定义；headless 不产生视觉加载，boss 保持 lazy。
- `@gamekits/asset` 增加通用有界 group retry 和 missing-group diagnostic；成功 member 不重复加载，Outpost 只负责选择 group。
- App-owned identity registry 已建立 gameplay object、EntityId、actor、physics body/collider、network generation 和 RenderObjectId 的双向索引，并拒绝产生半注册状态的 identity 冲突。
- `bench:outpost:content:check` 建立 8 项粗粒度预算；除 content boot、identity 注册/查询和 retained state 外，也限制 Browser runtime image 总字节与最大单文件。当前 11 张 imagegen WebP 合计约 284 KiB，最大 arena floor 约 202 KiB，低于 384 KiB / 320 KiB 预算。
- 包级测试覆盖引用 source/path、duplicate、headless 资源隔离、lazy retry/failure diagnostic、profile policy 和 identity cleanup。该首个切片尚未包含真实运行 profile；后续切片已完成并记录在下方。
- 当前切片的全仓库 72 个 test task、40 个 build task、lint、format 与 `bench:world` 均通过；Outpost 14 tests、Asset 8 tests 和内容/身份/运行时图片 8/8 performance budgets 通过。

当前已完成 Browser 可运行纵切片：

- Browser Web 已通过 configured App Host 真实组合 Platform Web、Phaser Driver、Data、Asset、Input、UI、GameRuntime、Save 和 DevTools service；GameRuntime 继续只持有 World、EventBus、system 和 GameModule。
- Phaser Driver 在 `host.boot()` 持有 renderer、asset cache、pointer input 和 camera runtime；Outpost presentation 只在首个 runtime tick 物化 RenderObject，未在 GameModule install 阶段越过 Driver lifecycle。
- 首个 data-driven ranger 从 `outpost.player`、`physics.body`、`physics.collider` 和 `render.object` materialize 为 Koota entity。Arena floor WebP 已移除全部凸起实体；32 个模块化外墙/路障/掩体/立柱实例复用 4 张透明纹理，每个实例的唯一 position/rotation/size 同时生成 RenderObject 与 collider，并批到一个 static architecture body。通用 `createPhysicsLayoutModule(...)` 负责 Physics World 物化；Rapier 2D 负责移动和真实场景碰撞，没有坐标 clamp、逐像素碰撞、人工维护的第二套坐标或 app-local physics 替身。
- Browser 使用 Input Router 的 game scope 消费 WASD、pointer、wheel 和 ability/build action；Camera Core follow/bounds/zoom 通过 Phaser Driver camera adapter 同步。游戏 HUD 不轮询 World 或诊断快照，physics/camera/render system 保持逐帧运行，静止 RenderObject 的 native patch 通过签名缓存跳过。
- Physics Core 的 opt-in interpolation store 由同一个 fixed-step Physics module 推进，Outpost RenderObject 与 follow camera 复用 transient sample；权威 World、碰撞、Save 和 multiplayer snapshot 不读取插值状态。Phaser Driver 按 Browser profile 把 pixel ratio 上限设为 1.5，并成套归一化 canvas backing store、native camera center 和 input coordinate；round-pixel render policy 与按 display footprint × pixel ratio 构建的模块纹理共同降低移动时的边缘闪烁。
- App Host、Data/Asset、World、Physics、Multiplayer、trace 和 profiler 证据统一由框架 DevTools launcher/shell 承载，不在游戏 HUD 常驻复制。DevTools、modal、text input 或其他 UI 持有焦点时，DOM keyboard adapter 会把输入切出 game scope。
- boot/match/combat 组的十个 imagegen WebP 运行时资源通过 AssetManager 和 Phaser Driver loader 进入共享 texture cache；boss WebP 保持已注册但未加载的 lazy asset。十一个高分辨率 generated art source 位于 `public` 之外，由 `assets:build:outpost` 统一透明清理、裁切、缩放和压缩为 manifest 声明尺寸；测试读取 WebP header 锁定 URL、格式和尺寸，Driver 没有 Outpost/imagegen 特判。页面明确标记当前 Multiplayer 为 memory local-authority preview，不把它冒充 Wave 4 的 Colyseus Room authority。
- Browser smoke 已验证页面进入 running，34 个 World entity、2 个 Physics body / 33 个 collider、33 个 arena RenderObject definition 和 10/11 loaded assets 与自动化一致。拉远镜头后可见纯地面、12 个模块化外围墙段、4 组 L 型路障、8 个掩体和 4 个立柱；背景没有重复实体，全部静态资源正常加载，页面无新增运行错误，仅保留 Rapier 初始化 API 的既有 deprecated warning。
- 新增 Outpost physical preview integration tests，覆盖 Data layout reference、纹理/layout bounds 对齐、单 static body 批量 collider materialization、固定步移动与 120 Hz 半步表现插值、Rapier 掩体/外墙阻挡、identity 反向索引、PhysicsHandle/interpolation unbind、World/entity cleanup、transient input reset、DevTools/UI keyboard scope 隔离和 runtime image 格式/尺寸；Outpost 当前 18 tests 通过。
- `bench:outpost:preview:check` 扩展为六项预算。代表性 34 entity / 2 body / 33 collider profile 中，runtime boot/dispose 约 0.26 ms/次，33-object arena render plan 约 24.2 µs/次，physical tick 约 63.4 µs/tick，reusable-target interpolation sample 约 0.186 µs/transform，Physics trace 固定保留 180 条，dispose 后 retained entity 为 0。
- 生产构建把 Rapier 初始化改为动态加载：React 启动壳先呈现，随后加载约 1.7 MB 的 physics chunk 和 Phaser chunk；主入口 gzip 约 123 KB。Phaser/Rapier backend chunk 仍是后续 browser load profiling 的明确观察项。

2026-07-13 完成一次框架通用性与耦合复审：

- GitNexus 影响分析确认 `createPhysicsModule` 是跨 App Host、2D/3D Lab、Outpost 和 benchmark 的高影响公共入口，`createPhaserDriver` 同时被 Abyss、Outpost 和 Sandbox 消费；因此没有把当前 demo 的对象类型、坐标、速度或资源约束写进 package。
- Physics layout 补齐 backend-neutral body instance override 和一致的 2D/3D bounds validation；Outpost 的 wall/barricade/cover/pylon 仍只是 app-owned arena data。Physics package、Phaser Driver 和 App Host standard helper 中不存在 Outpost/Siege gameplay concept。
- Fixed-step interpolation 把定制曲线与 teleport/rollback discontinuity 判定收敛为可注入 policy，history callback 输入为深只读 view；默认只提供通用数学和 lifecycle。App Host `standardModules.physics` 可直接透传 store，普通游戏不需要复制自定义装配。
- Phaser render option 的默认值、校验、boot 和 snapshot 共用一份 resolved configuration；diagnostics 暴露完整配置，不再只为 Outpost 当前使用的 pixel ratio / round-pixel 字段维护平行逻辑。
- 通用 Physics benchmark 增加 3,000 moving body tracking、300,000 reusable-target sample 和 dispose retained-state 门禁。本机复审结果为 4.704 ms/tick、0.0956 µs/sample、dispose 后 0 retained body；Outpost preview 六项预算复审为 0.1484 ms boot/dispose、15.0952 µs render plan、35.8287 µs physical tick、0.0673 µs interpolation sample，全部通过。
- 全仓库 72/72 test task、40/40 build task 和 72/72 lint task 通过，`bench:world`、`bench:physics:check`、`bench:outpost:content:check`、`bench:outpost:preview:check` 通过。任务相关文件全部通过 oxfmt；root `format` 仍只被工作区原有 `.claude/`、`AGENTS.md`、`CLAUDE.md` 八个非本工作流文件阻挡，未在本切片改写这些文件。

当前已完成多 profile 收口切片：

- Browser Web 与 Tauri smoke 复用 app-local visual profile composer；两者共享 Phaser Driver、Renderer/Input/Camera/Asset、Save、DevTools 和 preview GameRuntime 装配，平台 runtime 分别由 Web/Tauri adapter 注入。Tauri factory 可以延迟创建真实 Tauri platform，也可以在自动化中注入 protocol-compatible smoke fixture。
- Headless server 与 deterministic test 复用 app-local non-visual profile composer，并保持与 Browser 相同的 `outpostAppDefinition` service graph。Renderer、Asset、Platform、Save、Physics、Multiplayer、World 和 GameRuntime factory 都可以注入；默认 fixture 不包含 Outpost 特判，headless preload plan 为零，deterministic profile 完整加载四个资源组并使用固定 clock/seed。
- `@gamekits/app-host` 公开已有的通用 headless renderer/memory asset fixture；`@gamekits/platform-web` 新增隔离 memory fs/storage 的 `createMemoryPlatform()`。`createWebPlatform()` 的 CRITICAL 启动链没有被改写，设计与取舍记录在 ADR 0024。
- 新增 profile integration test，覆盖共享 Definition 的完整 boot/start/tick/dispose、headless 零视觉 load、deterministic 两次相同 input schedule 的稳定 snapshot、Tauri visual composition 和 dispose 后零 World entity。当前 Outpost 21 tests、Platform Web 9 tests 通过。
- `bench:outpost:profiles:check` 建立四项门禁；最终复跑的 100 次 owner-supplied reusable World lifecycle 下，headless 约 1.129 ms/次、deterministic 约 1.013 ms/次，headless visual load 为 0，dispose retained entity 为 0。
- 全仓库 73/73 test task、40/40 build task 和 73/73 lint task 通过，`bench:world` 与 profile budget 通过。当前切片 25 个任务相关文件全部通过 oxfmt；root `format` 仍只被工作区原有 `.claude/`、`AGENTS.md`、`CLAUDE.md` 八个非本工作流文件阻挡。

Wave 3 已关闭。正式 Colyseus Room-owned Browser/server authority lane 继续由 Wave 4 承担；memory multiplayer 与 preview runtime 不冒充生产多人实现。

### Wave 4: Room-owned Multiplayer Vertical Slice

Status: Completed on 2026-07-15.

1. 在 Multiplayer Colyseus backend 增加通用 typed Room-side runtime bridge。
2. Room 持有 headless App Host、authority GameRuntime、Physics、TCA/GAS runtime 和统一 dispose lifecycle。
3. Browser 使用 configured App Host、Phaser Driver、Input、Camera、Renderer、UI、Multiplayer 和 DevTools。
4. 实现 lobby、ready、countdown、player entity spawn、四人 movement/aim 和 room close。
5. 每个 movement/aim input sequence 对应一个 fixed prediction step，并使用 per-source bounded FIFO；ready/start 使用 bounded action FIFO。
6. 建立 app-owned field-level player Schema、authority shadow、entity generation、initial sync 和 resync。

完成标准：关闭 party leader 浏览器后 Room 仍继续 authority tick；四个客户端读取同一 player entity state；不同 room 隔离；所有 Host/GameModule/backend lifecycle 可释放。

当前已完成首个 Room-owned lifecycle 切片：

- `@gamekits/multiplayer-colyseus/server` 新增通用 `createColyseusRoomRuntimeBridge(...)`。它只拥有单一 Room simulation interval、Room-side backend connection、active peer/client index、GameKits envelope source/session/target/size gate、targeted send、低频 diagnostics 和 app-provided runtime lifecycle；server-side MultiplayerRuntime 统一由 multiplayer-core 创建，不拥有 Outpost gameplay、participant policy 或 Schema。
- 既有 `GameKitsColyseusRoom` relay/native carrier 未修改。公共 API 与 self-connection 取舍记录在 ADR 0025；package README 和 Multiplayer 长期模块文档已补充集成/使用边界。
- Outpost app-local `OutpostSiegeRoom` 通过 bridge 持有共享 headless profile 创建的 App Host、GameRuntime、World 和 Physics。正式默认 backend 为 Rapier 2D，测试可注入 protocol-compatible memory Physics；Browser creator 的 `host` role 在 app boundary 映射为 `party-leader`，不会触发 host-authoritative room close policy。
- 真实本地 Colyseus server integration test 已验证：两个 peer 进入同一 Room；leader 关闭后剩余 client 仍 `in-session`，authority tick 继续；两个并行 Room 各自持有独立 App Host、World、Rapier 2D scene、ingress counter 和 lifecycle，关闭其中一个不会停止另一个；Room dispose 后 Host phase 为 disposed、World entity 为 0、Physics handle unbound、active peer 为 0。
- Core-ownership 复审移除了 bridge 手写的 MultiplayerRuntime/phase/session/snapshot，改为私有 `MultiplayerBackendAdapter/Connection` + `createMultiplayerRuntime()`；presence 恢复独立 `gamekits.presence` 通道，并锁定 GameKits session id、provider room id、Client connection id 三者边界。
- Backend bridge 契约测试覆盖单 timer、boot/start/tick/stop/dispose 顺序、core server facade、browser/server peer session 对称、presence、targeted send、session/source/target/size rejection、重复 lifecycle rejection、partial boot failure cleanup 和幂等 dispose。真实 Outpost integration client 也通过 `createMultiplayerRuntime()` 驱动，不再只读取 backend 私有 connection snapshot。
- `bench:multiplayer:room:check` 建立 6 项粗粒度预算。Core-first 重构后的 500,000 tick、100,000 envelope、10,000 peer churn、1,000 lifecycle profile 约为 9.87 ns/tick bridge、0.97 µs/inbound envelope、2.37 µs/join+leave、0.0091 ms/lifecycle；dispose 后 retained peer 和 timer 都为 0。
- 本切片验证通过：Multiplayer Colyseus 12 tests、Outpost 23 tests、全仓库 test 73/73 tasks、build 40/40 tasks、lint 73/73 tasks、World benchmark、Multiplayer 12 项预算和 Outpost profile 4 项预算。全仓库 format check 仅被任务开始前已有的 `.claude/*`、`AGENTS.md`、`CLAUDE.md` 8 个非本切片文件阻塞；本切片文件已单独通过格式检查。

当前已完成第二个 authority gameplay 纵切：

- 新增 backend-neutral 的 Outpost match authority composer。它只消费 multiplayer-core 的 authority binding、peer/player binding、participant policy 和 authority host loop；GameKits session/peer 仍是唯一连接与身份真相，`lobby/countdown/running` 是 app-owned match state，不在 Colyseus Room/adapter 中建立平行 session。
- Ready 使用 core `game.action` 的 per-source bounded FIFO；movement/aim 的每个 input sequence 对应一个 50ms predicted simulation step，因此 authority 使用 core `game.input` 的 per-source bounded FIFO、每来源每 tick 最多消费一个，并在该 step 已进入 authoritative simulation 后逐 sequence ack。所有 payload 都先验证形状与有限数值，移动轴在 authority boundary clamp；非 participant、未开局 input 和开局后的 ready 变更会被 authority 拒绝。
- Room tick 现在按 `authority.beginTick()` → Outpost GameRuntime → Rapier Physics → `authority.commitTick()` 执行。倒计时结束前 World 只有 33 个 arena layout entity；开局后四个 participant 通过 data-driven player/physics definitions materialize 为 Koota entity，形成 37 entity、5 body、36 collider 的权威场景。移动速度写入 PhysicsVelocityComponent，位置、碰撞、facing 和 snapshot 都来自同一个 World/Physics runtime。
- Participant slot、ready、input ack 和物理 player snapshot 都由 authority state 捕获；leader 只是一名 app participant。其离开会释放 core action/input/sequence state 并 despawn 对应 entity，但 Room、authority clock、剩余三名玩家和 core session 继续运行。
- 真实本地 Colyseus integration test 使用四个独立 `createMultiplayerRuntime()` client 完成 join → ready → countdown → 4-player spawn → 三次 burst input 分别在连续 authority tick 消费并依次 ack 1/2/3 → Rapier position 前进 → leader dispose → 三人继续。测试同时断言 client 收到 server `game.snapshot`、不同 Room 仍隔离、dispose 后 World 清空。
- 新增 `bench:outpost:authority:check` 四项预算。最终复跑的代表性 6,000 tick / 1,000 churn 结果约为 39.8 µs/four-player physical tick、55.0 µs/player churn tick；Physics trace 固定保留 180 条，dispose 后 retained entity 为 0，两个热路径预算均为 250 µs。
- 当前切片通过 Outpost 24 tests、全仓库 test 73/73 tasks、build 40/40 tasks、lint 73/73 tasks、World benchmark、Multiplayer Core 12 项预算、Colyseus Room 6 项预算和 Outpost authority 4 项预算。Browser smoke 真实打开 1920×1080 backing canvas，确认场景资源、HUD、WASD 移动/镜头链路与可展开的 GameKits DevTools；页面无运行错误，日志仅有 `@dimforge/rapier2d-compat@0.19.3` 内部 WASM wrapper 的既有 deprecated-parameter warning。该包的公共 `init()` 类型没有新参数入口，本切片不在 app 或通用 adapter 中屏蔽上游警告。

当前已完成第三个 Browser multiplayer 纵切：

- Browser Web profile 不再使用 memory/local-authority preview；它由应用入口注入 `createColyseusMultiplayerBackend(...)` 支持的 Multiplayer Core runtime。建房、加房、peer/session、ready/action、input 和 snapshot 全部经过 Multiplayer Core，Colyseus 只保留 backend/Room/provider 职责。
- Browser client 使用独立的 authority-shadow GameRuntime，不创建本地 Rapier authority。`clientReplication` 由 Multiplayer Core 自动订阅和验证 `game.snapshot`，并在 client tick 内把权威值 materialize/update/despawn 到 World。当前最多接收 4 个 player 和 8 个 participant，断开和 dispose 后 entity/identity registry 回到零。
- Input Router 只维护当前 movement/aim state；Browser authority 与 client 复用 app-owned `OUTPOST_NETWORK_TIMING` 的 20 Hz / 50 ms 配置。Core managed runtime 自动采样、分配 sequence、发送到绑定的 server authority peer，并从 `inputRateHz` 派生 prediction step，再根据 snapshot input ack 自动 reconciliation/replay/correction smoothing。`maxPredictionLeadInputs=8` 限制未确认领先量，窗口满时 Core 自动暂停新 step/send，authority 侧保留 32 条有界突发余量。React lobby/roster 只消费最多 10 Hz 的低频 view，不订阅逐帧 World transform。
- 远端 player 使用 Core playback 与 declared vector/angle tracks；本地 player 只声明 typed predicted position/facing fields、position correction metric 和 duration/max magnitude，不调用 interpolation primitive 或实现 correction offset。Local prediction transition 由 Physics Core 持有 Rapier speculative scene，复用同一 player body/collider、arena layout 和 60Hz sub-step；有界 sequence checkpoint 在 authority 基线一致时直接复用 replay 结果，不 rewind 当前 solver contact cache。Core 在同一 managed frame 自动产出 predicted presentation，Renderer 与 follow Camera 消费同一份 transient presented map，不把预测/插值值写回 authority World。Transport failure 会在下一份未确认失败 sequence 的 snapshot 上自动 reset prediction history，app 不实现恢复调度。
- Vite 与 Colyseus 由同一 app-local dev server 启动并通过只读 config endpoint 发现连接地址。React lobby 支持 form/join、call sign、squad code、ready/countdown；创建后的 URL 携带 session code，分享页面会自动进入 Join 并预填。游戏 HUD 不复制 framework diagnostics，完整运行信息继续进入 GameKits DevTools。
- 真实双 Browser 纵切已验证建房、加房、roster、Ready/countdown、同一权威战场、远端 playback 和本地物理 prediction。旧的周期性 2.42px correction 来自 client 30 Hz / Room 20 Hz 相位错配；障碍附近 correction 另由线性客户端模型、重复 rewind Rapier contact cache 和无界 prediction lead 共同造成。最终 Browser 复验中本地玩家移动到静态障碍接触点 `(839.01, 463.67)`，prediction pending 保持 7/8，Core backpressure 触发 21 次，11,648 次 replay 中 11,622 次命中 physics checkpoint；`corrections=0`，最大原始差异 `0.000193`，低于 `0.001` correction threshold，两个客户端保持同一 Room authority。
- `bench:outpost:client:check` 覆盖真实 Rapier prediction scene 下 10,000 次四人 managed snapshot/playback/presentation apply 和 2,000 次 3↔4 人 churn。当前 7 项门禁结果约为 17.21 µs/four-player snapshot、18.02 µs/churn snapshot，低于 150/200 µs 预算；rejected snapshot、pending input 和 dispose 后 retained entity/physics scene 均为 0，checkpoint cache 保持 4/256。通用 `bench:multiplayer` 另覆盖 managed 4/128 entity frame。
- 修复 Web container 改成竖屏或嵌入式尺寸后仍沿用 1280×720 logical viewport 的 camera 偏移。`@gamekits/platform-web` 现在提供通用 element viewport measure/observe helper；Outpost app composition 在 boot 和后续低频 resize 时同步更新 Phaser Renderer 与 Camera Core，zoom fallback anchor 读取当前 camera viewport，不包含游戏特有方向或偏移常量。helper 对重复尺寸去重并显式释放 observer，未增加逐帧测量或 resize。
- Managed replication 增量验证通过 Multiplayer Core 44 tests、App Host 31 tests、Outpost 27 tests、Multiplayer 13 项性能预算和 Outpost client 4 项性能预算；双 Browser start/move/remote observe 也已完成。最终全仓库 test 73/73 tasks、build 40/40 tasks、lint 73/73 tasks 和 World benchmark 通过；root format 仍只被工作区原有 `.claude/*`、`AGENTS.md`、`CLAUDE.md` 8 个非本切片文件阻挡，本切片文件单独通过。展开 DevTools profiler 时两个页面会被既有 `ProfilerList` 的重复 React key (`runtime:undefined`) 告警刷屏；该告警不来自 managed replication，关闭 DevTools 时 gameplay diagnostics 正常，但后续 DevTools 工作流应单独修正，避免污染调试期性能数据。

当前已完成第四个字段级 Schema 收口切片：

- Outpost app 在 provider-specific boundary 定义 participant/player/input-ack 字段级 Colyseus Schema、authority snapshot projection 和 provider-neutral client view decoder；`@gamekits/multiplayer-colyseus` 只新增通用 `readRoomState` hook、initial-state 时序、provider metadata 和 state-size gate，不包含任何 Outpost entity 或玩法类型。
- Room authority commit 现在只更新 app-owned Schema；Browser 通过 Core `snapshotSource` 消费 provider update，原 `game.snapshot` 高频 envelope 已停止发布。真实四客户端测试断言 Schema lane active 且收到的 snapshot envelope 数为 0，避免双写两份 authority state。
- Player authority entity 使用稳定 `networkEntityId + generation + archetypeId`。Client authoritative shadow、presentation track 和 render identity 都包含 generation；despawn/re-materialize 会淘汰旧 generation，phase/generation 变化触发 managed playback reset。
- Core source lane 以 provider `stateVersion` 排序，允许同一 gameplay tick 内的新 revision；普通 envelope 仍按 tick 去重，transport sequence 不冒充 provider version。Binding/session reset 清空 provider ordering watermark，新的 initial full state 可从 version 1 重新同步。
- Colyseus custom decoder 可提供低分配 `stateBytes` 估算，adapter 和 native bridge 统一执行大小上限。`bench:outpost:client:check` 现在包含 9 项门禁：10,000 次四玩家 Schema projection+decode 约 9.73 µs/次，估算完整状态约 2.0 KiB；managed snapshot、3↔4 人 churn、prediction cache 和 dispose retained-state 预算同时通过。
- 定向验证通过 Multiplayer Core 50 tests、Multiplayer Colyseus 9 tests、Outpost Schema/Browser 7 tests，以及真实回环 Colyseus Room 3 tests。Wave 4 至此关闭，下一执行阶段为 Wave 5 的 authority-only physical TCA/GAS combat。

### Wave 5: Physical TCA/GAS Combat

Status: Completed on 2026-07-15.

1. 实现 player/enemy/projectile/buildable 的 entity archetype materializer。
2. 实现 movement intent、AI steering、Rapier 2D sync、hitbox/hurtbox、projectile、overlap/raycast 和 placement validation。
3. 实现 rifle、dash、shock field、turret deployment 和 enemy attack GAS abilities。
4. 实现 health/shield/stamina/resource attributes，damage/heal/knockback/status duration/periodic effects，以及 stack/refresh/expire。
5. 实现状态反应、kill/drop、shield break、boss phase 和 objective TCA rules。
6. 建立完整 correlation：network command → GAS → Physics → GAS effect → TCA → World lifecycle → cue。
7. 测试非法 source、cost/cooldown/tag/target/placement rejection 不改变 authority state。

完成标准：战斗结果只来自 authority runtime；所有战斗对象基于 World entity 和 Physics；TCA/GAS 定义来自 DataRegistry；客户端不能通过伪造 Schema、cue 或 UI command 改变 damage/effect。

完成证据：

- Browser 只发送 `rifle`、`dash`、`shock-field` 和 `deploy-turret` 语义 action；Room 继续通过 Multiplayer Core authority host loop 消费有界队列，并从 peer/player binding 推导 source。payload 中伪造的 `playerId` 不参与权威身份解析。
- Authority GameRuntime 按 player intent → combat command/AI → Rapier Physics → projectile sweep/damage/lifecycle → GAS update → TCA reaction 排序。Player、raider、overseer、projectile 和 turret 都是 World entity，持有 data-driven Physics body/collider；Rapier query 缺少 entity metadata 时通过 app identity registry 的 collider/body index 回到同一实体，不建立平行战斗对象真相。
- DataPack 已声明 health、shield、stamina、shared resource、ability cost/cooldown、periodic shocked/recovery effect、敌人攻击参数、投射物参数、placement range 和 collision filter。步枪命中、冲刺、Shock Field overlap、炮塔物理放置/自动射击及敌人近战都由 app combat module 组合 Physics 和 GAS，Core package 未加入 weapon、damage、team 或 Outpost 语义。
- TCA 已覆盖 shield break、actor/enemy kill、drop、objective progress 和 overseer phase transition。Network command 的 correlation/parent 会延续到 GAS activation、Physics sweep、attribute change、TCA trace 和 World despawn fact。
- Rapier 定向测试覆盖四发物理投射物击杀、periodic status、shield break、boss phase、掉落/目标推进、非法 placement、资源不足、cooldown、Dash 状态和敌人攻击；真实四客户端 Colyseus Room 测试覆盖伪造 source 无效、实际发送者扣费和第二次 Dash 被 cooldown 拒绝。
- `bench:outpost:authority:check` 现在有 7 项预算。代表复跑结果约为 47.7 µs/four-player physical tick、72.1 µs/player churn tick 和 91.3 µs/combat tick；持续步枪压力下最大 6 个并发投射物，Physics/GAS/TCA trace 分别固定保留 180/240/180，dispose 后 retained entity 为 0。
- 战斗实现保持 app-owned，并拆分为公共命令/快照协议、运行态与实体身份、TCA definitions 和仿真编排；没有修改 Multiplayer、Physics、GAS、TCA 或 World Core 的玩法语义。下一阶段只扩展 app-owned Schema/presentation，不回写或复制权威规则。

### Wave 6: Replication, Prediction And Presentation

Status: In progress; first playable combat replication slice verified on 2026-07-16.

1. 扩展 app-owned Schema collections，覆盖 entity lifecycle、transform、actor public state、combat facts、wave/objective 和 shared resource。
2. 实现 stable `entityId + generation`、provider version、source/schema gate、spawn/despawn 和 resync。
3. 本地 movement/aim 使用 prediction/reconciliation；dash 只做有限 presentation prediction。
4. 远端 player/enemy/projectile 使用 core playback 和 declared `Network*` tracks。
5. Combat cue 使用有界、可去重 fact stream；teleport/respawn/generation/binding change reset history。
6. Renderer 批量消费 presented values；不在 Schema callback 中逐对象写 Phaser。

完成标准：Demo 上层没有平行 interpolation clock 或 deep snapshot clone；damage/effect/objective 不预测；本地响应及时，远端连续，reset 后不残留旧 track/cue。

当前已验证首个可玩复制切片：

- 修复了“服务器战斗存在、浏览器只能移动”的实际断层：app-owned Colyseus Schema 现在复制敌人、炮塔、投射物、公开 GAS 属性/标签/冷却、计数器和 authority elapsed time；provider-neutral decoder 将其交给 Multiplayer Core snapshot source，不恢复高频 `game.snapshot` 双通道。
- Client shadow GameRuntime 根据稳定 `networkEntityId + generation` 物化/更新/销毁 enemy、buildable 和 projectile World entity；远端动态对象声明 Core playback vector/angle track，presentation 统一读取 presented value，游戏代码没有自建插值时钟或调用底层插值函数。
- Phaser presentation 根据 DataRegistry 中的 `renderKey` 创建数据驱动 RenderObject；Shock 状态、炮塔和投射物均来自 authority state。React HUD 只按 10 Hz view signature 更新真实 health、shield、resource、hostile/kill 和 GAS cooldown，不展示框架诊断。
- 初始敌人仍使用能绕开当前无寻路 AI 限制的内圈物理出生点，但每个 app-owned spawn 可配置 `activationDelayMs`。Opening wave 配置 4 秒待机；测试用自定义出生点默认立即激活。该数据只影响 Outpost AI，不进入 Physics、GAS、TCA、Multiplayer 或 World Core。
- 真实双 Browser 验证完成建房、加房、Ready/countdown、同一权威战场、3 个敌人、步枪、Dash、Shock Field、炮塔与远端同步。触发后本地显示 Dash `1.4s`、Shock `5.9s`、炮塔 `0.4s` 冷却，shared resource `100 → 75`；第二客户端同步看到炮塔和 shocked tint，同时保留自己的 100 resource。
- `bench:outpost:client:check` 扩展到 13 项门禁。200 enemies + 256 projectiles + 4 players（460 client entities）的 500 次 combat profile 最终复跑约为 `1.44 ms/snapshot`，Schema projection+decode 约 `0.420 ms/snapshot`，估算状态约 `190.5 KiB`；对应预算为 `4 ms`、`2 ms`、`256 KiB`，dispose 后 entity/Physics scene 均为 0。
- 定向测试当前为 Outpost 36 tests 全部通过，其中新增用例锁定 combat Schema projection/cleanup、client actor/projectile materialization/interpolation/status tint/despawn，以及配置化敌人激活延迟。Wave 6 的 bounded cue fact stream、generation/binding reset 全矩阵和更完整 presentation 仍待后续切片。

### Wave 7: Camera, UI And Complete Session

Status: Planned.

1. Camera follow/lookahead/bounds/zoom anchor/shake 与 Phaser Driver camera adapter 接通。
2. Input scope 覆盖 game、ui、modal、text-input、devtools；键鼠、手柄和 UI action 走同一语义层。
3. React UI 完成 lobby、loadout、HUD、ability/effect、build menu、objective、reconnect、results 和 rematch。
4. 完成普通 wave、intermission、elite/boss、extraction、胜负和统计。
5. 完成 cue → renderer/camera/UI presentation，失败不阻塞 authority tick。
6. 覆盖 desktop 和 mobile-sized spectator/diagnostics layout、focus、reduced motion。

完成标准：四人可以从 lobby 完成一局；UI 不订阅每帧 World state；DevTools/modal/text input 不误触 gameplay；所有 camera 坐标转换使用 Camera Core。

### Wave 8: Save, Platform And Participant Lifecycle

Status: Planned.

1. Intermission 创建 authority checkpoint，覆盖 runtime、World、Physics、GAS、TCA、wave/objective/resource sections。
2. 固定 seed 验证 save → new runtime → restore → continue tick 与 uninterrupted runtime 等价。
3. 验证 format migration、missing content compatibility、corrupted payload 和 contributor failure diagnostics。
4. Web 使用 Platform storage；Tauri smoke 使用 Platform file store、语义路径、权限错误和原子写入；headless test 使用 memory store。
5. 完成 spectator/next-round、explicit leave、disconnect grace、provider reconnect、timeout、leader transfer、room recreate。
6. Restore 或 reconnect 不复用旧 queue、input epoch、Schema collection、prediction buffer 或 RenderObject。

完成标准：checkpoint 可恢复权威 gameplay 而不保存网络/native state；Web/Tauri/headless 使用相同 Save contract；完整 participant lifecycle matrix 通过真实 Colyseus integration。

### Wave 9: DevTools, Load And Soak

Status: Planned.

1. 标准和 app-specific sources 覆盖 Host、Data、Asset、World、Input、Camera、Physics、TCA、GAS、Multiplayer、Renderer、UI 和 Save。
2. Timeline 展示完整 combat correlation；Inspector 可从 entity 反查 actor、physics、data、asset、network 和 render identity。
3. Profiler 分离 ingress、AI、Physics、combat、TCA/GAS、lifecycle、replication、Schema、render、UI、asset 和 save 成本。
4. 建立 functional、single-room stress、multi-room throughput、browser frame、Tauri smoke 和 60-minute soak harness。
5. 运行 reconnect、spawn/despawn、save/restore、wave reset 和 room recreate churn；验证 heap、listener、timer、track、queue、registry 回到基线。
6. 只有字段级全量同步数据证明预算不足时，才实现 app-specific AOI/interest management。

完成标准：所有核心模块在同一应用有 inspectable evidence；所有 buffer/queue/history/registry 有界；性能退化能定位到具体阶段；soak 后 retained heap 进入平台期。

### Wave 10: Framework Extraction And Closure

Status: Planned.

1. 审查 Demo 中形成第二个稳定场景的 runtime handle、Save contributor、correlation、Schema mapping 或 diagnostics primitive。
2. 只下沉经过真实使用和压力验证的通用能力，app gameplay 与 Schema 保持本地。
3. 更新长期模块文档、最佳实践、ADR、package README、benchmark budget 和 release changeset。
4. 完成全仓库 test/build/lint/format、browser E2E、Tauri smoke、benchmarks 和 soak 证据。
5. 标记本工作流 Closed，记录最终提交/PR，并迁移仍有价值的结论。

完成标准：Outpost Siege 不维护平行 GameKits；核心 API 有测试、文档和真实 app 消费；所有完成门禁有可重复证据。

## Test Matrix

### Domain / Deterministic

- 同一 input/action log 在 local authority 和 Room authority fixture 得到等价稳定 snapshot。
- Ability cost/cooldown/tag、effect stack/expire/periodic、TCA condition/action/once 和 entity cleanup。
- Physics contact/query → semantic hit → GAS/TCA chain 不依赖 renderer、socket 或 wall clock。
- Save/load/tick continuation 和 entity remap。

### Content / Resource

- Duplicate、unknown type、missing DataRef/AssetRef、schema/path、override priority。
- Preload group、lazy load、retry、unsupported source 和 driver cache lifecycle。
- Headless profile 不加载纯视觉资源，但仍验证引用与 compatibility。

### Real Colyseus

- 1/2/4 clients 完成 session；late join、spectator、leave、disconnect、reconnect、room recreate。
- 非 authority client 不能写 gameplay/Schema state。
- 不同 room state、World、GAS/TCA、Physics 和 Save checkpoint 完全隔离。
- Provider commit/ack 只发生在完整 authority tick 后。

### Browser / Tauri

- App Host/Driver/Input/Camera/Renderer/UI/DevTools 生命周期。
- Prediction/presentation、focus scope、responsive/reduced motion。
- Web asset/save path 和 Tauri file/permission smoke。

### Performance / Soak

- Core microbenchmarks：World、Physics、Multiplayer、TCA/GAS hot paths、Save capture/restore。
- Functional：4 browser clients，250 enemies，300 projectiles，64 buildables，128 pickups。
- Stress：4 active headless clients + 12 spectators，1,000 enemies，1,500 projectiles，256 buildables，512 pickups。
- Multi-room：8 rooms × 4 bot clients，记录 tick fairness、event-loop lag、bandwidth 和 heap。
- Soak：60 minutes，重复 participant、entity、checkpoint 和 room churn。

## Completion Gate

只有同时满足以下条件，才能称为综合验证完成：

- 应用设计验证合同中的每个核心能力都有真实承载点和自动化证据。
- 四人可以完成完整 session，Room authority 不依赖任何 browser 存活。
- 战斗完全基于 World entity + Physics + GAS + TCA，且结果只由 authority runtime 决定。
- 内容、资源、物理、渲染、能力、效果和规则定义全部经过 Data/Asset workflow，没有 app-local 平行 registry 或直接 URL。
- Browser 正式走 App Host + Phaser Driver + standard services/GameModules；headless 与 Tauri profile 复用同一 app contract。
- 高频状态使用 app-owned field-level Schema，client prediction/presentation 不回写 authority state。
- Authority checkpoint 能恢复 World/Physics/GAS/TCA/gameplay 并继续确定性 tick，不保存 connection/native/presentation state。
- DevTools 能关联 input → network → Physics → GAS/TCA → World → replication → presentation → save。
- 所有 queue、buffer、trace、track、listener、timer、entity/actor/physics/render registry 有界且可释放。
- Functional、integration、browser、Tauri、benchmark 和 soak 证据可重复。
- 可复用结论已迁移到长期文档，工作流状态 Closed。

## Decision Gates

- AOI：只有全量 field-level Schema 实测超出 budget 才实现，先保持 app-specific。
- Projectile replication：先逐实体复制；只有 bytes/patch/presentation 数据不足时再评估事件化或分层。
- GAS/TCA extraction：只有通用 runtime 缺口进入 package；weapon、damage formula、status reaction 和 wave rule 保持 app-local。
- Save persistence：本 Demo 验证 checkpoint contract，不扩展账号、云同步或生产数据库。
- Backend breadth：Outpost 使用 Phaser + Rapier 2D + Colyseus + Web/Tauri；其他 driver/backend 继续通过 Lab/conformance，不在此复制覆盖。
