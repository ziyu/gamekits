# 最佳实践

本文档负责跨模块通用实践、已验证经验、反模式和性能/测试策略。单个模块的专属实践写在 `docs/modules/<module>.md` 的“最佳实践”段落；具体工作流状态、任务拆分和完成定义写在任务系统、PR 或 `docs/implementation/`。

模块最佳实践必须区分两类读者和场景：

- 模块集成：把模块接入 app、App Host、Driver、Adapter、GameRuntime、测试夹具或内容管线的装配规则。集成通常由框架维护者、app shell、profile 或基础设施代码完成，频率低但边界影响大。
- 模块使用：游戏模块、业务代码、工具 UI、DataPack、SaveContributor 等日常如何消费该模块。使用频率高，应强调稳定 facade、性能边界、状态归属和反模式。

不要把一次性集成细节写成日常使用要求，也不要把业务使用习惯塞进集成层。

## 模块最佳实践索引

模块专属实践入口：

- Core / EventBus / GameRuntime：`docs/modules/core-runtime.md`
- World / ECS Adapter：`docs/modules/world.md`
- Data：`docs/modules/data.md`
- Assets：`docs/modules/assets.md`
- Platform：`docs/modules/platform.md`
- Driver：`docs/modules/driver.md`
- Renderer：`docs/modules/renderer.md`
- Input：`docs/modules/input.md`
- Camera：`docs/modules/camera.md`
- Physics：`docs/modules/physics.md`
- Combat：`docs/modules/combat.md`
- AI：`docs/modules/ai.md`
- Navigation：`docs/modules/navigation.md`
- Animator：`docs/modules/animator.md`
- Audio：`docs/modules/audio.md`
- TCA：`docs/modules/tca.md`
- GAS：`docs/modules/gas.md`
- Multiplayer：`docs/modules/multiplayer.md`
- UI Core / React UI：`docs/modules/ui.md`
- App Host：`docs/modules/app-host.md`
- Save：`docs/modules/save.md`
- DevTools：`docs/modules/devtools.md`
- Sandbox：`docs/apps/sandbox.md`

## 跨模块边界

集成实践：

- 先判断能力归属：管理外部 runtime、平台能力、资源句柄、输入来源、UI shell、存储和诊断的能力通常是 App Service；需要 world、tick、actor、rule、ability、camera rig、physics scene 或 gameplay context 的能力通常是 GameModule。
- 第三方库进入 Driver、Adapter、app/profile 或 app-specific presentation/tooling 层，不进入核心 facade、DataType、可复用 GameModule 公共 API 或 gameplay 包。
- Driver 持有跨多个协议的外部 runtime，例如 Phaser Game 或 Three renderer/scene；Adapter 只把单个 GameKits 协议映射到 Driver 暴露的 runtime slice。
- Multiplayer backend adapter 应优先接入成熟多人方案，例如 Colyseus、Nakama、PartyKit 或平台联机 SDK，并持有网络 SDK、room、matchmaker、state sync 或平台联机 runtime；App Host 管理连接 lifecycle，GameModule bridge 只消费归一化 session/message/authority 事实。
- Adapter/Driver 集成已有 core 领域时，测试入口和生产组合都应经过 core facade/factory；不要用结构类型兼容的手写对象替代 core runtime。Provider 侧可以维护 native handle、连接索引和映射状态，但 core phase/session/snapshot/error 必须由对应 core 实现产出。
- 具体 app presentation、Editor 后端专属面板和 DevTools renderer plugin 可以通过 typed native handle 使用底层 renderer API；这些依赖不能进入 Data、Save、core facade 或可复用 gameplay module。
- GameRuntime 只负责模块安装、clock、system tick 和 lifecycle，不直接拥有 Platform、Driver、Renderer、Input、Camera、Physics backend provider、Data、Asset、UI、Save store 或 multiplayer connection。

使用实践：

- EventBus 只承载低频事实。高频 position、camera target、physics contact manifold、render patch、held input、UI hover 等状态留在对应 runtime state 或 system 内。
- Renderer、Input、Camera、Physics、UI、TCA、GAS、Save 和 Multiplayer 都需要 trace/diagnostic 入口，但诊断不能反向成为业务逻辑依赖。
- 跨模块 trace 优先在 entry 产生时增量映射，并传播显式 correlation/parent；不要每帧轮询、复制和按时间猜测多个完整 trace buffer。

## 生命周期

集成实践：

- App Host 统一推进 App Service lifecycle：boot、start、stop、dispose、snapshot。底层服务对象不需要为了 Host 继承私有基类，生命周期通过 binding 描述。
- GameModule 的订阅、system、trace store、controller runtime 和 cleanup 跟随 GameRuntime lifecycle；`stop()` 停 tick，`dispose()` 释放订阅和长期句柄。
- Driver 先 boot，再派生 renderer/asset/input/camera/physics adapter；adapter 不单独创建同一套外部 runtime。
- 主动采样的 Input source 由 App Host Input service 每帧调用可选 `poll(frame)`，并严格发生在 Router held tick 之前。Adapter 不创建私有 RAF/timer；事件型 source 继续只使用 start/stop/destroy。
- App Host 的 service factory 构造不等于 service boot；`game.createRuntime` 和 GameModule `install()` 可能在 Driver `boot()` 前执行。依赖 renderer/asset/input/camera native runtime 的 GameModule 不应在 `install()` 中立即创建 RenderObject 或读取 native handle，应在 Host start 后的首个 tick、显式 start hook 或可验证的 boot gate 中幂等物化，并在 GameRuntime dispose 时先于 Driver 释放。
- Save/load、asset preload、data registration 和 renderer boot 应由 App Host 或 app profile 编排顺序，不藏在 GameRuntime 内部。
- Multiplayer create/join/reconnect/leave 应由 App Host、lobby UI、server host 或测试夹具显式触发；GameModule 不隐式创建 socket、Colyseus Room、Nakama match 或 provider room。
- 普通实时多人客户端应通过 standard Multiplayer GameModule 的 managed replication 配置声明 snapshot、remote track、predicted-state field 和 prediction policy。网络 callback 不直接写 Renderer，app render loop 不显式调用 playback、predict 或 reconcile，prediction 配置也不回调手写 number/vector/angle 插值或 correction offset；Core 统一推进 authority gate、input sampling/send、prediction-lead backpressure、remote presentation 和 local correction，app 只提供 deterministic transition 与最终批量 frame write。`inputRateHz` 默认同时定义 prediction step；若显式拆分两个频率，必须证明它与 authority ack 的 interval 语义一致。Fixed-step prediction 必须让 authority 每 step 消费并 ack 一个 sequence，客户端用 `maxPredictionLeadInputs` 限制领先量。Authority 使用 Physics solver 时，prediction transition 必须复用同一 backend/definition/fixed-step 语义，并用有界 checkpoint 避免对一致 solver state 重复 rewind；不要用线性位移近似 damping 和 collision，再依赖 correction smoothing 掩盖持续误差。
- 严格逐 step input 经由可能丢包的 delivery 发送时，使用 managed bounded redundant bundle 和 authority fixed-step inbox；
  authority 按 peer/binding generation/sequence 去重，只 ack 已模拟的最高连续 step。应用不维护私有 resend window，也不
  让累计 ack 跨过未模拟 gap；超过等待预算时使用显式 hold-last/neutral policy，并把 gap/fill 进入 diagnostics。
- 以 `startTick`、`fireTick` 或其他事件起点重建的 predicted lifecycle，必须通过 managed predicted lifecycle domain 管理 generation、spawn identity、authority timeline、binding、expiry 和 cleanup，并通过 `createMultiplayerTimeAlignedPresentationTransition(...)` 声明 absolute 或 relative-origin alignment。Core 先把 predicted/authority 采样到同一 lifecycle age，再只平滑 residual state divergence；app/domain 不维护私有 correlation/binding/handoff entry map、offset lerp 或 expiry loop。Combat kinematic projectile 优先使用 App Host 标准组合 helper。输入驱动物体继续使用 managed replay，远端对象继续使用 snapshot interpolation，相互作用刚体继续使用 Physics prediction island；不能用 lifecycle handoff 替代它们。
- 多人拥挤、动态机关和可推动物体形成持续接触时，优先用标准 Physics Arena prediction adapter 管理完整交互集合。
  Authority 发布 island id、generation、tick、membership revision、definition version 和完整 member state；Client 不按
  render distance 猜成员，也不在 app callback 中维护第二套 replay/history/hard-correction。先用单个完整 arena island
  建立正确性与性能基线，再以 authority-declared revision 和保守交互 horizon 评估分区。Island 已拥有的 solver state
  不重复进入 World/Physics rollback contributor。
- Forward-only authority 不保留逐 tick rollback checkpoint；使用 Physics island 的 `initial-only` history 和 Multiplayer
  authority loop 的 snapshot cadence。Client 继续使用完整 rollback history。性能门禁同时报告主线程 CPU 与 wall-clock：CPU
  用于跨负载回归判断，wall 尖峰和真实浏览器帧时间不得删除或冒充 CPU 指标。
- Headless 测试应能用 memory platform、memory renderer、memory save store、deterministic clock、fake asset loader 和 fake physics backend 启动主要组合路径。
- Browser、Tauri、headless server 和 deterministic test 应优先复用同一个 GameAppDefinition。非视觉 profile 用协议兼容 fixture 满足完整 service graph，并把 production platform/backend/runtime factory 保留为显式注入点；不要为测试删掉 service 后维护第二套启动拓扑。

## 数据驱动

集成实践：

- DataTypeDefinition、AssetDefinition、TCA/GAS definitions、physics definitions 和 render object definitions 应由 app/profile/content package 在启动时注册或物化，业务系统日常只读取稳定 registry。
- Content Package、编辑器导入器或 profile 负责把用户文件转成 DataPack；DataRegistry 不直接理解资源 payload、脚本、权限或包挂载。

使用实践：

- DataType 设计应给游戏开发者自由度。框架只要求稳定 `type + id`、可校验、可引用、可诊断，不强迫所有项目套固定 hero/monster/building 模板。
- DataPack 是数据集合，不是内容包系统。真实 Content Package 未来可以包含 DataPack、资源 payload、脚本、localization、地图、patch 和权限声明。
- Runtime state 不写回 DataRegistry。Data 是定义和来源追踪，World/Physics/GAS/TCA/Save 承载运行时状态。
- 跨 GAS 与 Combat 的普通攻击链使用 `combat.ability-delivery` + Combat module bridge：GAS phase/effect Cue 表达表现语义，Combat fact/World state 提供空间上下文。不要让 app 为每个技能手写 committed 订阅，也不要在 Combat 再建一套同义 Cue registry；projectile lifecycle event只白名单投影稳定 identity、初始/最终 transform和可选 impact，不能广播完整 runtime/query state，且必须同时有吞吐、payload大小、unsubscribe和 retained-state预算。详细协议见 `docs/modules/gas.md`、`docs/modules/combat.md`、ADR 0032 和 ADR 0046。
- 引用关系通过 DataRef / AssetRef / 自定义 references 提取进入 reference graph，错误必须能定位 source pack、entry type、entry id、field path 和 target key。
- 游戏内容文件应优先按真实业务概念组织，同一个业务文件可以混合内置 DataType 和用户自定义 DataType。

## 保存边界

集成实践：

- SaveManager、SaveStore、SaveCodec、migration registry 和 contributor policy 由 App Host/app profile 组合；游戏模块通过 contributor bridge 注册 capture/restore。
- Save contributor context 默认只暴露必要服务，例如 Data、Assets、GameRuntime；Renderer、Input、UI、Platform 等运行时对象必须显式 opt-in。

使用实践：

- 普通继续游戏存档保存长期玩法事实和 runtime clock，不保存当前 selection、hover、focus target、confirm 弹窗上下文、held input、timeline 日志、renderer native handle、React state 或 adapter cache。
- SaveContributor 必须显式声明 capture/restore/validate、scope、tags 和版本；不要让 SaveManager 直接理解具体玩法组件。
- Save/load 流程不隐式 tick GameRuntime。app 决定 load 前是否 pause、load 后是否 resume。

## 测试策略

- 多客户端异步测试读取快照前，应分别等待每个被读取客户端的最新状态满足条件；一个客户端已收到消息不能代表其他客户端也已收到。使用有界条件等待，不以固定延时替代就绪条件。
- 在共享 CI runner 上同时约束 Turbo 包任务并发数和 Vitest worker 数，避免两层并行叠加造成 CPU 争用和用例超时；断言与业务等待预算保持独立。
- 异步生命周期等待测试使用可控 deferred gate 验证 Promise 尚未结束，不能只等待一个微任务后断言最终状态。清理测试在中间模块抛错并验证其余资源全部尝试释放。
- 持久化测试注入部分写入/原子替换失败，并新建 store 验证旧数据、metadata 与删除结果；并发测试覆盖共享底层 store 的不同包装实例。加载测试以所有 validate 完成前没有 restore 为契约。

- Facade 要有契约测试；Adapter 先跑 facade conformance，再补底层库专属行为测试。
- Adapter 集成测试应同时断言 core facade snapshot 与 provider 行为；只验证第三方对象或 adapter 私有 snapshot 会漏掉平行状态机、生命周期漂移和消息通道不一致。
- 数据驱动模块必须覆盖 duplicate、unknown type、missing reference、schema/path error、trace/diagnostic。
- GameRuntime、Camera、Input、Physics、TCA、GAS、Save 等有顺序语义的模块必须覆盖顺序、幂等、stop/dispose 和 cleanup。
- Multiplayer backend adapter 必须覆盖 provider facade 的 connect、create-or-join/leave、message routing、peer summary、disconnect、reconnect 降级、payload validation、dispose cleanup 和 diagnostics；provider 自己拥有的 room/matchmaker/state sync 逻辑不要在 GameKits core 中重写。
- Multiplayer app/demo 集成测试不能只断言 peer count 或 presence；必须至少断言一条 lifecycle、input、snapshot、patch 或 command result 来自同一个 authority state，并验证非 authority snapshot/patch 不会被 client 应用。
- Multiplayer 输入先区分 continuous state、fixed-step predicted control 和 discrete command：不逐 input rollback 的移动、瞄准、驾驶采用 latest-per-source coalescing、持有状态和明确 timeout；一个 sequence 对应一个 simulation step 的 predicted control 使用 per-source bounded FIFO、每 tick 消费一个、逐 step ack 和 client lead backpressure；交互、购买、一次性技能采用独立 bounded action FIFO。直接决定玩家手感的 press/release/cancel不能因为也影响 held state就只塞进 fixed-step FIFO：用有界 reliable action lane立即交付边沿，以单调 control sequence让 authority合并稍后到达的 continuous frame并忽略旧状态，同时在本地下一可绘制 frame做可撤销 anticipation。
- 即时表现不能冒充完整预测。只继承显示位置、保持原速度或 correction lerp 的 render-only handoff只解决 presentation continuity；如果对象会因 collision、bounce、hit、expire 或 spawn/despawn 改变轨迹，必须选择 lag-compensated hitscan、kinematic fire/finish record、predicted entity + prediction island 或 authority-only 中语义完整的一种。Client predicted spatial result可撤销，但 damage/cost/kill仍由authority提交。测试必须覆盖已知 blocker前不穿透、confirm/reject/correct、generation reset、history overflow、动态交互成员一致 rollback和dispose retained state；app不能在单个武器中另建无界队列、solver cache或半套collision预测。
- Prediction transition 和 rollback replay 内不直接播放 Audio、Camera shake、创建 Renderer/UI object 或提交 EventBus/GAS/TCA 事实。可撤销本地反馈通过 `createMultiplayerSpeculativeEffectJournal(...)` 绑定稳定 effect id；Core 去重 replay 并统一 confirm/cancel/replace、过期、容量、generation 和 dispose。Damage、消耗、掉落、任务进度等不可撤销结果仍只由 authority commit。
- 跨 World、Physics、RNG 或 gameplay runtime 回滚时使用同 tick rollback contributor 协调，不在 app 中按临时顺序逐个 restore。Contributor 必须声明 order、预校验、checkpoint bytes 和稳定 hash；所有 validate 先完成，再开始 restore。标准顺序为 World 100、RNG 150、Physics 200，让稳定 entity identity 先于 Physics 引用恢复。World checkpoint 只捕获显式 selector/component scope；由 Physics contributor 拥有的 component 不重复进入 World contributor。Seeded RNG 保存精确内部 stream state而不是只保存 seed；任何 contributor restore 抛错都按 partial restore 处理，转完整 hard correction/rebuild。修改该路径时运行 `corepack pnpm bench:checkpoint:check`，同时限制捕获/恢复耗时、单 checkpoint bytes、总 history bytes 和 retained checkpoint count。
- Kinematic projectile 的 owner/observer 最终必须消费同一 authority timeline、record identity 和 render definition；预测提前量只能作为 authority 到达前的 provisional lead，并在同一 visual object 上有界收敛。Observer 可以使用声明的 remote presentation delay 从 authority record 重建短命弹体，但不能以每条 record 的“首次收到时间”重新启动局部播放时钟；超过 delayed authority tick 的 completed record 不再重播。不能给 owner prediction 施加不同 tint/scale 后让 remote 使用另一套外观。真正漏帧的短生命周期由 tracer/impact cue 表达。
- Kinematic owner 的 authority adoption 必须区分 commit-time offset 与 spatial divergence。Shot-relative 匹配时用 owner 当前 shot age 采样 authority record，不能把较晚 authority `fireTick` 造成的沿轨迹距离差交给 correction lerp；测试必须直接断言接管前后单位时间位移保持 `speed × delta`，不能只断言对象没有倒退。只有起点、速度、方向或 finish 等真实空间事实分叉才允许 smoothing。
- 修改 kinematic 或 solver-owned projectile prediction 时运行 `corepack pnpm bench:projectile-prediction:check`。
  该基准必须真实运行 Physics query、fire/finish record churn、remote reconstruction、predicted-spawn matching，
  以及完整 prediction-island checkpoint capture/restore/resimulation/authority hard correction，并同时限制 blocker penetration、p95/max、
  payload/history bytes、history/order hard limit 和 dispose retained state。
- Multiplayer peer 离开或断线时，host/server presence 组合层必须调用 authority loop 的 peer release 入口，清掉该 peer 尚未消费的 action/input 和 sequence epoch。是否保留 actor、slot 或本局统计属于 gameplay policy，不能靠保留旧网络队列来实现。
- 离线单机和多人模式应共享同一套 gameplay orchestration。测试应能用同一 input/action log 在 local authority 和 host/server authority fixture 中得到等价稳定 snapshot，避免维护两套规则实现。
- Sandbox、demo 或 headless host 的集成测试应覆盖长链路：Data → Asset → App Host → GameRuntime → World → Physics → TCA/GAS → Renderer/Input/Camera → Snapshot/Timeline。
- 固定 seed 测试只比较稳定 snapshot，不比较 DOM、native handle、绝对时间或底层库对象。

## Monorepo

- 使用 pnpm workspace 管理 `apps/*` 和 `packages/*`。
- 使用 Turbo 编排 `build`、`test`、`dev`。
- 使用 oxlint 进行 lint，使用 oxfmt 进行格式检查和写入。
- 根目录命令应面向日常开发，包内命令应面向 Turbo 和局部验证。

## Package Release

当前发布操作流程、Version PR 合并顺序、手动触发方式和故障排查见
`docs/release.md`。本节只维护长期发布原则和反模式。

发布实践：

- GameKits 采用多包发布。下游项目按需安装 facade、adapter、driver、App Host、UI 和 DevTools 包，不通过一个巨型包默认引入所有能力。
- `apps/*` 是验证应用和示例源码，不作为 npm package 发布。
- 可发布包必须只通过公共入口导出稳定 API；`src/index.ts` 继续只做 re-export，不承载主要实现。
- 发布产物必须来自 library build 输出的 `dist`，不能把 `src`、`test`、`.turbo`、`tsconfig.tsbuildinfo`、缓存、日志或 app 构建产物打入 tarball。
- package manifest 必须用 `files` 白名单限定发布内容，并声明 `exports`、`types`、`main`、`repository` 和 `publishConfig.access`。
- CSS 入口只能从发布产物导出，例如 `./dist/styles.css`；有 CSS 或必要副作用的包不能盲目声明 `sideEffects: false`。
- React UI 类包应把 `react` 和 `react-dom` 声明为 peer dependency，并在本仓库保留 dev dependency 用于构建和测试；发布 smoke 必须确认 consumer 复用顶层 React。
- 纯 TypeScript 包、React TSX 包、adapter/driver 包都必须通过外部安装 smoke test，验证它们离开 workspace alias 后仍能被消费。
- 初期版本采用 lockstep 发布，先走 alpha tag 验证 tarball、Node ESM、Vite、peer dependency 和真实 app dogfood，再进入 latest。
- lockstep 期间，所有非私有 `packages/*` 必须位于同一个 Changesets fixed group，且 workspace manifest version 必须完全一致。新增 public package 的同一个 PR 必须同时补 fixed group，不能依赖后续人工记忆。
- workspace manifest 是发布版本事实来源；release staging 可以把 workspace dependency range 改写为 lockstep 版本号，但不能把版本漂移的 package 静默改写为 core 版本。registry check、tarball verify、publish 和 GitHub Release 创建前都应执行同一套 lockstep 校验。
- prerelease 只更新 `alpha`、`beta` 或 `rc`，不得同步或覆盖 `latest`。稳定版进入默认安装入口时，直接用不带 prerelease 后缀的版本和 `dist-tag=latest` 发布。
- Release workflow 应以通用 `release` 命名，`alpha`、`beta`、`rc`、`latest` 只是 dist-tag 参数；不要把当前阶段固化为 workflow 身份。
- Changesets 自动化应先创建 version PR，再由合并后的 main 发布。alpha 阶段使用 Changesets pre mode，正式发布前显式 `pre exit`。
- 普通开发者不手写 changeset；PR automation 根据可发布包的实际源码、README 或非 version-only manifest 改动生成 changeset。需要覆盖默认 bump 时使用 `changeset:major`、`changeset:minor` 或 `changeset:patch` label。
- Changesets pre mode 会在 `.changeset/pre.json` 记录已消费 changeset；判断是否存在待发布 changeset 时必须排除这些已消费 id，不能只看 `.changeset/*.md` 文件是否存在。
- 自动 publish 只在没有待消费 changeset 且当前包版本尚未发布到 registry 时运行；检测应基于 registry 中的实际发布状态，不依赖 merge commit 标题或单次 push 的文件列表。
- 自动 publish 还必须检测 npm dist-tag 是否指向当前版本；若版本已存在但 tag 仍停在旧版本，发布脚本应走幂等 retag 路径而不是重新上传 tarball。
- npm package 发布成功后必须创建 `v<version>` Git tag 和 GitHub Release；`alpha`、`beta`、`rc` 等预发布版本在 GitHub Release 中标记为 prerelease。tag/release 创建逻辑必须幂等，不能移动已经存在且指向不同 commit 的版本 tag。

依赖实践：

- `@gamekits/*` 包之间在 workspace 内使用 workspace dependency，发布产物必须落成明确版本号。
- Driver 或 adapter 明确拥有的底层 runtime 可以作为该包 dependency，例如 Phaser driver 依赖 Phaser、Koota adapter 依赖 Koota。
- 宿主应用必须共享的 runtime 使用 peer dependency，例如 React 和 ReactDOM。
- 测试工具包如果导出 Vitest conformance helper，应把 Vitest 作为 peer dependency，并在 Vitest 进程中做 smoke test；普通 Node ESM smoke 不应直接 import 这类测试入口。
- 可选平台插件使用 optional peer dependency，例如 Tauri 插件。
- 核心 facade、DataType、GameModule 公共 API 和 gameplay 包不得暴露第三方 runtime 类型。

构建实践：

- TypeScript project references 继续声明包依赖图；Turbo 负责按图构建 library package。App build 使用 `tsc -p tsconfig.json --noEmit` 只检查当前 app，不能递归 emit 引用包；需要输出自身产物的 private package 使用 `tsc -p tsconfig.json`。
- 发布用 library bundler 输出可被 Node ESM 和主流 bundler 消费的 JS、类型声明和 CSS 产物。
- Rolldown 系工具链优先通过 `tsdown` 试点和接入；若不能满足 package dry-run、d.ts、external、CSS 和 smoke test 门禁，再回退到直接 Rolldown 配置或其他成熟 library bundler。
- 所有内部 `@gamekits/*` 依赖和大型第三方 runtime 在 library build 中保持 external，不把相邻包或 Phaser、React、Tauri 等 runtime 打进 facade 包。
- package build helper 复制 CSS 或其他静态发布入口时，应在 bundler clean 和 JS/d.ts 输出完成后执行，避免 `dist` 被后续 clean 步骤清空。
- 单包发布构建和 app typecheck 都不能递归 emit project references，否则并发任务可能覆盖前序包已经 bundler 处理过的 `dist`，并让其他任务读到半写入的 declaration tree。包内 build helper 只检查或生成当前包产物，app 只读 Turbo 已完成的依赖产物。
- declaration bundler 遇到复杂类型递归时，可以为该包显式保留 tsc declaration tree，同时用 bundler 只输出入口 JS；这种例外要通过包级 build metadata 标记，并继续经过 tarball 和外部安装 smoke。
- composite project reference 指向多入口 package 时，不能让 declaration bundler 用内部 chunk 覆盖 `tsc` 期望的 declaration tree；这类 package 应设置 `gamekitsBuild.bundleDts: false`，保留与源码入口结构一致的 `.d.ts`，并用依赖 app 的只读 typecheck 和外部安装 smoke 验证跨包类型推断。
- 发布 staging 目录每轮必须先清理目标包目录，再复制当前 `dist`，并在 staging 侧再次清理 `.tsbuildinfo`，避免固定 release 目录带入旧文件。
- 发布验证中的 npm cache/logs 应隔离到 release 目录，避免用户级 `~/.npm` 权限或缓存状态影响 `npm pack`。
- scoped package 通过 token fallback 发布时必须显式传递 `--access public`；仅保留 manifest `publishConfig.access` 可能会被 registry 当作 private scoped package。
- 自动化发布脚本不得把 token 写入仓库、日志或命令错误栈。token fallback 应通过 npm CLI 和临时 userconfig 传递认证，并在结束后删除临时目录。
- 未发布前验证一组相互依赖的 tarball 时，临时消费者必须把内部包解析到本地 tarball，例如通过 pnpmfile hook 或 overrides；否则包内的明确版本号会让安装器去 registry 查找尚未发布的相邻包。
- registry 网络不稳定时可以重试安装步骤，但不能跳过 registry smoke；至少一次需要从 npm registry 安装已发布包并运行外部 consumer smoke。
- GitHub Actions 发布 job 必须绑定受保护 Environment，并优先通过 npm Trusted Publishing/OIDC 发布；`NPM_TOKEN` 只用于新包首发 bootstrap 和 fallback。发布脚本只能从环境变量或 stdin 读取 token，不能把 token 写入日志、仓库或命令参数。
- Trusted Publishing 会校验 npm provenance，发布产物的 `package.json.repository.url` 必须匹配 GitHub Actions 来源仓库。
- 具体发布步骤必须维护在 `docs/release.md`，不要把一次发布的临时状态、失败日志或人工补救命令写入长期最佳实践。

## TypeScript

- 包统一 ESM。
- 公共入口从 `src/index.ts` re-export。
- 公共类型要稳定，adapter 私有类型不导出。
- 避免用 `any` 穿过包边界；adapter 内部为适配第三方动态 API 可以局部使用。

## 测试

- 新增 facade 时，同时新增 conformance test helper。
- 新增 adapter 时，先跑通 facade 契约，再补 adapter 专属测试。
- 示例 app 的集成测试要验证确定性和事件链路。

## Runtime

- `start()` 只负责进入运行状态并发 runtime event。
- `tick(delta)` 顺序固定为 clock 更新后执行系统。
- `stop()` 后系统不得继续执行。
- 高频逻辑进入 system，低频事实进入 EventBus。

## 性能

性能设计从边界开始，而不是事后补救。

高频路径：

- 每帧 system 中避免创建临时对象、闭包和大量数组。
- 不在高频路径里做 JSON path 解析、动态字符串匹配、深拷贝或复杂 schema 校验。
- 高频状态留在 ECS/world 内，React/UI 只消费低频快照。
- EventBus 只用于低频事实，不用于每帧 position、render object patch、pointer move 广播。
- TCA/GAS 不用于每帧高频微逻辑；输入、镜头、物理、渲染同步等高频路径走 system 或专用 runtime state。

数据结构：

- 查询和规则执行需要索引，不能长期依赖全量扫描。
- adapter 可以为了第三方库兼容保留映射表，但映射关系必须由 adapter 私有维护。
- 大规模集合更新优先批处理，避免在循环里触发 UI 或外部副作用。
- renderer sync 只做状态镜像：创建/销毁 renderer object 时可以发低频事件，逐帧 transform/visibility/layer patch 不进入 EventBus。
- Phaser 等大型 adapter 依赖应隔离在 adapter 包中；app bundle 体积告警先记录，等 Asset/加载阶段再做 code splitting 或 chunk 策略。
- 海量 tile、particle、instanced mesh、复杂骨骼/挂点等热点路径应使用 adapter 提供的受控 native handle 或 batch API，不强迫每帧走通用 patch，也不要求 renderer-core 包装对应后端 API。

测量：

- 性能判断必须有数据，先用 benchmark 或 profiler 记录基线。
- 新增 adapter、renderer sync、TCA runner、asset loader 时应补最小 benchmark 或 profile 入口。
- Microbenchmark 的计时区间只包含被命名的目标路径；大规模 fixture创建、随机数据生成、磁盘读取和一次性装配放在 warmup或采样区间之外。需要变化输入时优先原地推进已构造 fixture，并为对象上限、drop和 dispose retained state单独设确定性预算，避免把测试夹具分配与 GC 抖动误判成目标模块回归。
- benchmark 的细微变化只作为趋势参考，不写死成易碎测试；已经稳定的热点模块可以在定时或手动 performance workflow 使用留有足够机器波动余量的粗粒度预算，观察数量级退化、无界队列和 retained heap 持续增长。常规 PR CI 只保留确定性的正确性门禁；性能检查不能代替 profiler，也不能因为共享 runner 噪声阻塞合并。
- DevTools Performance 面板只展示 GameKits 级 frame/system/service/adapter 归因，不替代浏览器 profiler；需要 CPU flamegraph、layout、paint、GPU 信息时仍使用浏览器或引擎原生工具。
- 默认只开启低成本 summary；深度 span、单帧详情、完整 payload 展开必须由用户显式开启或在测试夹具中启用。
- Trace ring、domain trace store、correlation summary 和每条 correlation 的 detail/root collection 必须分别有界，并用 benchmark 同时验证吞吐、snapshot 和 retained size。
- Trace observer、跨模块 mapper、redactor 和 diagnostic reporter 属于旁路诊断，任何一层失败都不能改变 gameplay 结果；默认 trace payload 使用白名单摘要，完整业务 payload 和敏感字段只有在显式 opt-in、脱敏且单独预算后才能进入工具链。
- 每个热点模块都应定义自己的预算语义，例如 runtime tick、render sync、asset load group、service boot、UI refresh；预算超限只产生诊断，不改变 gameplay。
- profiler disabled 时，高频路径不能留下明显对象分配、数组复制或 React state 更新。
- Fixed-step simulation 与高刷新率 presentation 之间使用模块提供的 opt-in transient interpolation store；Renderer 和 follow camera 复用同一采样时刻，权威 World/Save/multiplayer state 不读取或保存插值结果。游戏尺度、teleport 判定和表现曲线通过组合层 policy 注入，core 不写死阈值；热点 sampling API 应允许复用 caller-owned target，并建立 tracking、sampling 和 dispose retained-state 粗粒度预算。
- 高密度 canvas 的 logical viewport、backing store、camera 和 input 必须由同一个 Driver 成套归一化。App profile 对 pixel ratio 设置上限，并同时测 fill-rate、纹理尺寸和交互坐标；不能只提高 backing resolution 后用肉眼判断。
- Performance UI 刷新必须节流，不能跟随 gameplay tick 每帧重渲染。
- 发现慢点后先确认归因维度：system 慢、adapter 慢、asset IO 慢、UI 刷新慢、DevTools 自身慢，避免用错误层级修问题。
- 游戏 HUD 只承载玩家决策所需的状态、目标和操作反馈；service graph、adapter 状态、trace、entity count、资源诊断等框架证据统一进入 DevTools，不在游戏界面复制常驻监控面板。DevTools 展开或聚焦时必须通过 UI/Input Scope 阻断 gameplay 输入。

## Sandbox

Sandbox 是架构验证场，不是最终 demo。

允许：

- 展示 runtime 状态。
- 验证模块安装、系统 tick、事件链路。
- 作为后续 renderer/devtools 的接入点。

不允许：

- 在 sandbox 里沉淀长期玩法规则。
- 直接绕过 GameKits 公共接口访问 adapter 内部。

## UI / DOM

- 游戏 app、demo、sandbox、editor 的交互 UI 应通过 React/组件系统或显式 DOM builder 构建，不用 HTML 字符串拼接。
- 需要更新已有 DOM 时，优先更新 `textContent`、`style`、`classList`、`dataset` 或子节点；避免每帧或每次 snapshot 都重建可交互节点。
- 可点击、可输入、可选择文本的 UI 节点应保持稳定，避免刷新时打断焦点、hover、文本选择、按钮状态和动画。
- 游戏数据、内容包数据、用户输入和诊断文本都按不可信文本处理；写入 DOM 时使用 `textContent` 或组件文本子节点。

## React UI

- `@gamekits/react-ui` 使用 Tailwind CSS 作为默认样式基础，样式应通过组件、recipe、CSS variables 和语义 props 组织，而不是把 class 字符串散落在业务页面中。
- GSAP 只用于低频 UI 动效，例如 window/modal/toast/timeline/inspector 的进入、退出、强调和布局过渡；不要把 GSAP 用作 gameplay timing、renderer object patch 或 world tick 驱动。
- shadcn/ui 是推荐的组件 recipe 最佳实践。采用时应复制并封装到 `@gamekits/react-ui` 或具体游戏 UI 包，保持代码可拥有、可改造、可测试。
- 不要让业务 gameplay package、GameRuntime、World、Physics、TCA、GAS、DataType 或 renderer adapter 直接依赖 Tailwind、GSAP、shadcn/ui、Radix 或 Base UI。
- 游戏应优先沉淀自己的 UI 组件库，例如 `AbilityButton`、`ResourceMeter`、`ActorPortrait`、`BuildSlot`，再由这些组件消费 Tailwind、CSS variables 或 shadcn recipe。
- 所有 UI 动效必须尊重 reduced motion；动画失败不能阻塞 UI command 或 gameplay tick。
