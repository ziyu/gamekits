# AI Core Architecture Refactor

Status: Active.

## Goal

把 `@gamekits/ai-core` 从 `data + runtime + types.ts` 和千行 composition factory 重构为按
definition、memory、perception、decision、task、scheduler、observability、persistence、
controller 与 composition 划分的领域结构，同时保持 Utility + interruptible task 模型、
确定性和现有性能数量级。

长期设计入口：

- `docs/modules/ai.md`
- `docs/architecture.md`
- `docs/adr/0031-gameplay-foundation-packages-and-agent-ai.md`
- `docs/adr/0044-ai-core-package-internal-architecture.md`

## Work Slices

1. 建立只读 World/Navigation context、有界可保存 blackboard、characterization tests 和
   `/testing` 入口。
2. 把 definition compiler、memory、utility selector、task controller 与 scheduler 从
   `createAiRuntime()` 抽离。
3. 收敛 snapshot/trace/checkpoint/composition，补完整切换原因与分类预算。
4. 增加 Sandbox AI Lab，再迁移 Outpost authority enemy loop 作为真实消费验证。

## Validation Evidence

开始前基线：

- `corepack pnpm --filter @gamekits/ai-core test`：14/14 tests passed。
- `corepack pnpm bench:ai:check`：8/8 budgets passed；250 uniform agent p95 约 0.61 ms，
  1,000 mixed-LOD agent p95 约 1.74 ms，dispose retained state 为 0。
- GitNexus `createAiRuntime` upstream impact：HIGH，4 个直接调用方、8 个上游节点，涉及
  AI Module、AI tests 和 benchmark，没有识别到 app 直接调用或 execution flow。

2026-07-23 core architecture slices 1–3：

- `createAiRuntime.ts` 从 1,092 行 composition/god runtime 收敛到 447 行；definition compiler、
  perception、goal selection、task lifecycle、scheduler、snapshot 和 checkpoint 已各自归属领域。
- `corepack pnpm --filter @gamekits/ai-core test`：28/28 tests passed，覆盖 read capability、
  blackboard capacity/value budget、interrupt policy、scheduler fairness、restore atomicity 和公共入口。
- `corepack pnpm test`：49 package/app tasks passed，301 tests passed；
  `corepack pnpm build`：49/49 tasks passed；`corepack pnpm lint`：91/91 tasks passed。
- `corepack pnpm bench:ai:check`：8/8 budgets passed；250 uniform agent p95 约 0.62 ms，
  1,000 mixed-LOD agent p95 约 2.11 ms，dispose retained state 为 0。
- 改动范围的 `oxfmt --check` 通过。仓库级 format 仍由本工作流外既有的 AGENTS、CLAUDE 和
  `.claude/skills/gitnexus/*` 共 8 个文档挡住。
- GitNexus 重新索引后包含 13,757 nodes、33,180 edges 和 300 flows；tracked-hunk
  `detect-changes --scope all` 风险为 low，没有识别到受影响 execution flow。

Core architecture 已可供后续真实消费验证；工作流保持 Active，直到第 4 个 work slice 完成。

2026-07-23 Sandbox AI Lab：

- 新增独立懒加载 `?scene=ai-lab`，通过 App Host 的标准 AI GameModule 组合真实
  DataRegistry、World、GameRuntime、AI Handle、UI 和 DevTools，没有在场景内创建平行决策
  runtime。
- 场景消费同一 DataPack 驱动 16 个可见动物 agent，在 Sandbox World 中持有位置、饥饿、口渴、
  体力、健康和 10 个食物/水源/休息资源点。Sensor 通过只读 World context 生成需求与最近资源
  fact，Utility 在觅食、饮水、休息和探索之间选择，Task 只输出 movement / interaction intent，
  controller 在 authority tick 后结算移动、消耗、代谢与资源再生。
- 移除了与游戏表现无关的 stimulus slider、doctrine 控制台和隐藏 background pressure agent；
  主 UI 改为微型生态地图和选中动物观察册，原始 memory、blackboard、task、scheduler 与 trace
  退到折叠详情和标准 DevTools。
- AI Lab 7/7 tests passed，覆盖每只可见动物对应真实 agent、移动与进食/饮水/休息交互、觅食/
  饮水/休息的定向到收尾阶段序列、探索的定向到观察阶段序列、固定 budget delay、资源干预、
  选中前 10 秒行为历史导出、选中个体解释和确定性 250 ms 单步；Sandbox build 与 lint 通过。
- 浏览器 smoke test 验证 16 只动物持续移动、点选个体刷新解释、补充食物、暂停和 250 ms 单步；
  900 ms 抽样的 4 只动物位置全部变化，console 无 error/warn。分阶段行为调整后，同一休息 task 在
  1.6 秒抽样窗口内保持 task id 稳定，移动进度由 31% 连续增长到 40% 和 52%。
- 行为诊断调整后，浏览器验证地图上 16 只动物都有常驻行为气泡；选择青苔后导出按钮保持唯一，
  点击可生成其最近 10 秒日志并更新场景反馈，导出时该动物的持续执行进度仍正常推进。

第 4 个 work slice 的 Sandbox 消费验证已完成；Outpost authority enemy loop 迁移仍待后续完成，
因此工作流继续保持 Active。

2026-07-23 configurable trace retention：

- `CreateAiRuntimeOptions.traceRetention` 支持全局硬上限 `limit`、类别白名单 `kinds` 和类别硬上限
  `kindLimits`；旧 `traceLimit` 保持兼容并标记 deprecated。默认配置不改变已有留存行为。
- AI Lab profile 将容量固定为 640，只保留 lifecycle / decision / goal / task / budget，并把 decision
  和 budget 分别限制为 160 / 64；逐 tick intent 和 perception 已由专用 10 秒行为历史承载，不再
  重复占用通用 trace ring。
- AI Lab 将低于 10% 的资源视为暂不可用；执行中的资源耗尽会写入 6 秒 agent-local 目标屏蔽，
  后续决策改选其他资源，避免重新绑定刚开始再生的同一资源。测试覆盖泉水立即补满后仍改去池塘。
- AI Core 29/29 tests、Sandbox 60/60 tests、仓库 91/91 test tasks、49/49 build tasks 和
  91/91 lint tasks 通过；AI benchmark 8/8 budgets 通过，250 agents + 256 条完整 trace 的 p95
  约 1.04 ms/tick。改动文件格式检查通过；仓库级 format 仍被本工作流外既有的 AGENTS、CLAUDE
  和 `.claude/skills/gitnexus/*` 共 8 个文档挡住。

2026-07-26 pre-Outpost capability completion：

- `AiAgentReadContext` 新增只读 `PhysicsQueries` 和 `AiSharedFactQueries`。前者与既有
  World/Navigation facade 一样不暴露 scene step、body/collider/obstacle mutation 或 backend
  lifecycle；后者读取 app-owned encounter/队伍/目标事实并返回隔离副本，不复制进 agent memory。
- `AiRuntime/AiHandle.setSchedulerClass()` 支持已绑定 agent 动态切换 LOD class；尚未到期的
  perception/decision due time 按 interval 比例缩放，overdue work 不被重置。当前 class 进入
  snapshot/checkpoint，并兼容未保存该字段的 version 1 checkpoint。
- 新增 `maxPathRequestsPerTick`。超限请求不进入 Navigation backend，返回可由同一 facade
  `poll()` 的稳定 `queue-full` rejection；runtime snapshot 和 budget trace 记录累计拒绝数。
- Trace production 与 retention 分离：`maxEntriesPerUpdate` 限制单 update 生产量，超限聚合为
  `ai.trace_dropped`；`goalScoreDetail` 可配置 summary/winner/all。Live observer 在 retention 为 0
  时仍可接收预算内 trace，嵌套 reasoning payload 通过深拷贝隔离。
- Restore 新增 actor id 和 task-state resolver。App 可以重绑 route/path handle；明确无法重绑时
  Core 清除 active task/goal commitment 并立即重新决策，整个 resolver 阶段仍发生在替换 live
  agents 之前。
- Reusable conformance 从 5 项扩展到 8 项，增加 deterministic scoring、invalid checkpoint atomic
  rejection 和 dispose retained-state 检查。AI benchmark 增加 1,000-agent target/dynamic-LOD
  churn 与 500-agent bulk unbind。
- AI Core 37/37 tests、Sandbox 60/60 tests、仓库 91/91 test tasks、49/49 build tasks 和
  91/91 lint tasks 通过；AI benchmark 12/12 budgets 通过。一次独占样本中 1,000-agent churn
  p95 约 2.03 ms/tick，500-agent bulk unbind 约 0.91 ms。改动范围格式检查通过；仓库级 format
  仍只被本工作流外既有的 AGENTS、CLAUDE 和 `.claude/skills/gitnexus/*` 共 8 个文档挡住。

这些能力作为 Outpost 集成前的 Core 完成项；Outpost authority enemy loop 本轮按约定不迁移，
工作流继续保持 Active。

2026-07-26 Sandbox capability verification completion：

- AI Lab profile 通过标准 GameModule 同时装配正式 Graph Navigation backend、Memory Physics
  backend、AI runtime 和 app-owned shared fact store。Seek/Wander task 使用 request → poll → sample →
  release route lifecycle，并在 backend 投影终点后切换为最终近距离 steering；倒木和岩石作为真实
  World Physics collider 进入 sensor raycast。
- 观察册新增能力实验区：选中 agent 可动态切换 `nimble` / `steady`；林地警戒通过只读 shared
  fact 参与 Utility；倒木开关改变 Physics query；受控 task-context 压测同时暴露 path rejection 与
  trace drop；checkpoint capture/restore 显示 entity、actor 和 task-state resolver 实际命中数量。
- Restore resolver 清除 task state 中的 request/route runtime identity，把移动阶段归一回 route
  request；task 的完成、失败、取消与场景 dispose 均释放 pending request/retained route，避免验证场
  引入 route retained-state 泄漏。
- AI Lab 12/12 tests passed，新增动态 LOD/shared fact scoring、Physics query/Navigation route、path +
  trace 双预算和 checkpoint 三类 resolver 覆盖；Sandbox 64/64 tests、仓库 91/91 test tasks、
  49/49 build tasks 和 91/91 lint tasks 通过。10,000 entity world benchmark 的 spawn/add 与
  query/update 分别约 21.49 ms / 13.73 ms。
- 浏览器实测五组控制均可交互：一次受控压测观察到 195 次 path rejection 与 101 条 trace drop；
  checkpoint restore 显示 16 个 entity、16 个 actor、16 份 task state 完成 resolver；页面 console
  无 error/warn。
- 本次文件的 `oxfmt --check` 通过；仓库级 format 仍仅被工作流外既有的 AGENTS、CLAUDE 和
  `.claude/skills/gitnexus/*` 共 8 个文档挡住。GitNexus `detect-changes --scope all` 对当前完整
  AI 工作流报告 low risk、0 个受影响 execution flow。

2026-07-26 Sandbox scene integration correction：

- 上述“观察册能力实验区”被场景化实现取代。底层能力和诊断数据仍保留，但主观察栏不再陈列
  scheduler、shared fact、Physics、Navigation budget 和 checkpoint 数字卡片；这些信息只在折叠详情
  与 DevTools 中按需查看。
- shared alert 新增正式 safety Goal 与 staged hide task。警铃响起后，动物会从可中断阶段转向最近
  shelter，经历定向、寻路、移动、准备、持续躲藏和解除警戒后的收尾；主地图同步显示警戒波、
  群体路线与头顶气泡。
- Physics raycast 进入 task steering 决策：无遮挡采用 direct route，遇到地图 collider 才申请
  Navigation detour；倒木与岩石成为地图内可点击对象，切换后会要求现有 task 重新判断路线。
- 选中动物自动升为 `nimble`、上一只回到 `steady`；鸟群干预让全部真实 agent 从 task context
  触发预算压力与 route refresh，并在预算窗口内持续显示 16 个“重算”气泡和路线。
- “叶印”同时保存 AI checkpoint 和 Sandbox World 的动物、资源、障碍与共享事实。恢复仍使用 AI
  resolver 清理 runtime route identity，同时在主地图恢复位置/需求并显示残影和回溯波。
- Headless AI Lab 12/12、Sandbox 64/64 通过；浏览器实测警戒后 14 只动物在 1.2 秒观察窗口内
  已切到 hide，稳定后 16 只都在 shelter 等待；鸟群窗口显示 16 条路线与 16 个“重算”气泡；
  叶印生成 16 个位置残影，1.1 秒后已有 12 只动物离开记录点，恢复时出现回溯波；console 无
  error/warn。

Outpost 集成前缺失的 Core 能力均已在 Sandbox 形成可操作验证闭环；工作流继续 Active，等待后续
Outpost authority enemy loop 迁移。

2026-07-26 AI Lab real navigation correction：

- 复核发现此前 AI Lab 虽调用真实 Graph request/poll/sample/release 和最短路算法，但 6×5 Graph
  topology 没有接入 Physics collider；raycast 只决定是否申请 Graph route，路径本身不知道倒木与
  岩石，测试也只断言 route points 数量，不能证明避障。
- AI Lab 改用覆盖林地边界的 2×2 单位 Grid，共 2115 个 walkable cell。Grid dynamic obstacle cell
  与 Physics collider 从同一份 obstacle blueprint 生成，并按 small-animal profile 的 1.2 半径扩张；
  所有 Seek/Wander task 始终取得 Grid route，不再以 raycast 绕过 Navigation。
- 地图障碍开关同时更新 collider 与 `navigation.updateObstacle(custom target)`；backend revision 会让
  旧 route field/retained route stale 并重新搜索。authority 位移使用相同 1.2 半径的 Physics circle
  shape cast 作为最后穿模保护。
- AI Lab 几何回归测试现在断言：障碍开启时整条 route 不与扩张 collider 相交，动物逐 tick 位置不
  进入 collider；移开倒木后 Navigation revision 从 0 变为 1，新 route 可以经过原 obstacle cells
  且总长度更短。Sandbox 64/64 tests passed，AI Lab 12 项测试约 2.2 秒。

2026-07-26 AI Lab capacity stress integration：

- 主场景新增 AI 容量压力测试，可选择 128 至 4096 只的探顶上限。测试从 32 只开始倍增，每档先
  预热再采集帧间隔与完整 authority simulation wall time，以 30 FPS、36ms frame p95 和 28ms
  simulation p95 联合判定稳定档位；达到用户所选上限与首次预算失败会分别给出明确结果。
- 压测动物不是计数器或假 background agent：每只都有 World entity、正式 AI binding、物种对应的
  Data definition、Scheduler class，并进入同一 Sensor、Utility、Task、Intent、Grid Navigation、Physics
  shape cast 与代谢结算链。测试停止或结束后全部 unbind/despawn，常态 16 只动物继续运行。
- 主地图固定投影最多 72 只真实动物并同时显示实际总量/表现样本数；压测个体不进入 10 秒行为日志和
  林地故事事件，AI trace 继续使用 app-profile 的有界 production/retention 配置，避免 debug 与 DOM
  成为容量测试的主要瓶颈。
- Headless 压力状态机与真实 agent bind/unbind 回归加入 Sandbox suite，Sandbox 67/67 tests passed；
  浏览器以 128 只为上限实跑时自动经过 32、64、128 三档，当前内嵌浏览器环境下 64 只通过，128 只
  因 frame p95 约 41.6ms 超过 36ms 预算而失败，结束后自动恢复 16 只且 console 无 error/warn。

2026-07-26 AI Lab capacity bottleneck correction：

- 复核确认“最高仅 32/64 只”不是 AI Core 的容量：独立 AI benchmark 的 1,000 mixed-LOD agents
  p95 约 2.27ms/tick。修正前的 AI Lab headless 分段采样中，32/64/128 只的 Navigation p95 约为
  17.13/15.74/15.22ms，AI p95 约为 1.83/2.60/3.56ms；主要耗时来自压测 Wander 为每只动物生成
  唯一 goal key，Grid 反复构建 2115-cell reverse field 并在 48-entry field 容量内抖动，而不是
  Utility、Task 或 Scheduler 本身。
- 压测动物统一切到 background scheduler class；资源目标与 8 个确定性 Wander 目标共享 field route，
  常驻 16 只故事动物仍保留 point path 和真实 route polyline。AI Lab 的 decision/sensor/path admission
  与 Navigation queue/poll/retention/cache 限制集中到 app-owned 配置；AI path admission 允许突发进入
  有界队列，Navigation backend 继续按更小的每 tick 预算处理。queue-full/missing/cancelled 使用按 agent
  稳定散列的退避，避免失败后每 tick 重提形成请求风暴。
- 压力状态机不再用固定 800ms 预热采集冷启动尖峰；它等待 pending backlog 降到随 population 缩放的
  小阈值并保持安静窗口，最多等待 5 秒，随后把 cold-start 与 steady-state 分开报告。稳态除 frame/
  simulation p95 和 FPS 外，还验证 decision/sensor 延后率与 path rejection。压力采样期间只生成并复用
  一份 AI runtime snapshot，暂停全量观察册 telemetry，DOM 仍最多投影 72 只真实动物。
- 内嵌浏览器最终自动探顶结果：512 只与 1,024 只均通过；1,024 档平均约 36 FPS、simulation p95
  约 12.0ms、冷启动约 1.83s、调度延后约 31/s，且没有稳态路径拒绝。2,048 档 simulation p95 仍约
  20.6ms，但 frame p95 约 41.7ms 超过 36ms 交互预算，因此当前环境的可信稳定上限为 1,024 只，
  而不是被测试策略人为卡住的 32/64 只。
- Sandbox 69/69 tests、仓库 91/91 test tasks、49/49 build tasks 和 91/91 lint tasks 通过；AI
  benchmark 12/12 budgets 通过，1,000 mixed-LOD agents p95 约 3.22ms/tick，1,000-agent churn p95
  约 2.02ms/tick。10,000 entity world benchmark 的 spawn/add 与 query/update 分别约 27.5ms / 8.4ms；
  1,000 agents 共享 32×32 Grid field 时建场约 29.24ms、单次 sample 约 3.21μs。改动文件格式检查通过；
  仓库级 format 仍只被工作流外既有的 AGENTS、CLAUDE 和 `.claude/skills/gitnexus/*` 共 8 个文档挡住。

2026-07-26 AI Lab end-to-end frame optimization：

- 保留原有真实 `requestAnimationFrame` frame interval、完整 authority simulation wall time、30 FPS、
  36ms frame p95、28ms simulation p95 与 QoS 门禁，没有拆分测试路径、降低门槛或跳过
  Navigation/Physics/AI 链路。
- 移除 stress run 中 `afterTick()` 每帧执行的完整 `ai.snapshot()`；压力状态机只在每档采样开始和
  结束时读取三项 runtime counter，常态/压测观察册仍按 24Hz UI cadence 获取完整 presentation
  snapshot。新增状态机回归断言每档只发生两次 counter read。
- AI Lab 的动物节点和 SVG glyph 改为稳定 memoized presentation node；坐标更新使用横向 compositor
  transform 与纵向绝对定位，background 样本关闭 bob/bubble 装饰动画和 shadow filter，同时保留最多
  72 只真实动物、行为气泡、选中交互和真实路线。
- 内嵌后台浏览器只能用于相对回归，不能替代用户前台机器的绝对容量结论。在同一自动测试入口中，
  128 只达到约 117 FPS / 3.2ms simulation p95，1,024 只达到约 45 FPS / 16.5ms simulation p95；
  2,048 档最终因 simulation p95 超过 28ms 而失败，稳定上限保留 1,024。页面布局检查确认动物纵横
  坐标分布正常，console 无 error/warn。
- Sandbox 70/70 tests、仓库 91/91 test tasks、49/49 build tasks 与 91/91 lint tasks 通过；AI
  benchmark 12/12 budgets 通过，1,000 mixed-LOD agents p95 约 1.77ms/tick；10,000 entity World 的
  spawn/add 与 query/update 约 11.12ms / 5.30ms，1,000 agents 共享 Grid field 的单次 sample 约
  0.82μs。改动文件格式检查通过；仓库级 format 仍只被工作流外既有的 AGENTS、CLAUDE 和
  `.claude/skills/gitnexus/*` 共 8 个文档挡住。
