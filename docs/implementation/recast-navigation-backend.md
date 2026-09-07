# Recast Navigation Backend

Status: Closed.

## Goal

用独立 Recast adapter 替代 Sandbox 中自研的复杂自由空间 visibility graph 生成，同时让 Graph 回归稀疏语义路线，并保持 Navigation Core、场景 controller 和 UI API 不绑定具体 Backend。

长期事实来源：

- `docs/modules/navigation.md`
- `docs/adr/0036-navigation-query-and-backend-lifecycle.md`
- `docs/adr/0037-navigation-package-internal-architecture.md`
- `docs/adr/0039-recast-navmesh-backend-and-authored-graph-boundary.md`

## Scope

- 新增 `@gamekits/navigation-navmesh` 的可序列化 build source、DataType 和 validation。
- 新增 `@gamekits/navigation-recast` 的初始化、generator、query runtime、factory、debug tooling 和测试。
- 第三方 Recast/WASM 类型只停留在 adapter package。
- Blackglass Graph 改为地图语义 waypoint/route，不再生成 visibility mesh。
- Blackglass 增加 Recast NavMesh provider，复用同一 terrain、场景操作和 App Host session lifecycle。
- 更新 package references、测试 alias、发布 metadata 和 Sandbox 依赖。

## Review gates

- Graph debug topology 能直接读出道路、门洞、通道和备用路线，不再出现开放区域交叉网。
- NavMesh source 与 terrain/placement 使用同一世界坐标和 area id。
- Recast path/project 只通过 Navigation Handle 观察；测试不依赖 native poly ref。
- Recast 初始化显式且幂等，未初始化、生成失败和 dispose 后调用都有稳定错误/状态。
- Backend snapshot 有界，不展开 native polygon 或完整 build intermediates。
- path、projection、area cost/filter、dynamic invalidation 和 portal/off-mesh connection 有覆盖；未实现的 route field 明确返回 unsupported。
- Graph/Grid/Recast provider 进入场景行为矩阵；UI 不按 backend id 分叉 gameplay command。
- Adapter package build/test/lint、Sandbox browser check、整仓 build/test/lint 与本工作流范围 format 通过。

## Work log

- 2026-07-22：接受 ADR 0039，开始建立 NavMesh source/Recast adapter 与 Sandbox 三 Backend 验证。
- 2026-07-22：新增 `@gamekits/navigation-navmesh`，提供与第三方实现无关、可序列化且可校验的 triangle build source。
- 2026-07-22：新增 `@gamekits/navigation-recast`，完成显式幂等初始化、area-aware solo bake、path/project query、area cost/block、portal flag、revision invalidation、依赖记录、debug mesh 和 native resource disposal。
- 2026-07-22：将 Blackglass Graph 收敛为 14 个语义锚点和 19 条显式路线；Grid 继续表达离散格点；Recast 从同一权威 terrain 生成 177 个 polygon，并在同一 UI 和场景命令下支持三 Backend 切换。
- 2026-07-22：浏览器验证 Graph/Recast debug 数据、路径查询、Blast Doors 阻断、Coolant 高代价和 Transit Relay 切换；控制台无 error/warning。
- 2026-07-22：统一 Recast 与 Graph/Grid 的 area cost 语义：profile override 替换 layout 基础值，运行时 multiplier 再乘在有效值上；增加双通道改道测试，并让 Recast debug artifact 保留逐三角形 area。Sandbox Area cost 图层改为按当前 profile 和动态状态绘制有效代价热力图及数值图例。
- 2026-07-22：修正 Detour 对小于 `1` 的 traversal multiplier 会破坏 A\* heuristic admissibility 的适配缺陷。Recast query filter 现在按可通行区域最小有效 cost 等比例归一化，公共路线成本仍保持 GameKits 原始语义；新增强折扣远路包级反例，并在 Blackglass Backend 矩阵中锁定 Pathfinder 的 Grid/Recast 北侧 Gantry 路线一致性。

## Verification

- `corepack pnpm test`：91/91 tasks passed；Navigation Lab 14 tests、NavMesh 2 tests、Recast 6 tests passed。
- `corepack pnpm build`：49/49 tasks passed；Sandbox 成功打包 Recast WASM compatibility asset。
- `corepack pnpm lint`：91/91 tasks passed；本工作流涉及的包均为 0 warning/0 error。整仓仍有两条既有非 Navigation warning。
- `corepack pnpm bench:world`、`corepack pnpm bench:navigation`、`corepack pnpm bench:navigation:grid`：通过，未发现资源保留回归。
- `git diff --check`：通过。
- `corepack pnpm format`：本工作流文件已格式化并通过定向检查；整仓检查仍被工作区已有的 `AGENTS.md`、`CLAUDE.md` 和 `.claude/skills/*` 格式差异阻断，本工作流未改写这些文件。
- Sandbox 浏览器：Blackglass/Recast 的 Area cost 图层显示真实 NavMesh area；Pathfinder 下 `swamp` 为 `×2.80`，切换 Coolant leaking 后更新为 `×9.80`。修复后 Pathfinder 路线明确经过北侧 Gantry，完成成本为 `29.61`；页面保持 ready 且无 warning/error。

## Deliberately deferred

以下能力不伪装为本次已完成，也不影响当前 solo NavMesh Backend 的能力声明：

- tiled NavMesh、TileCache、局部 tile rebuild 与 Worker bake。
- 编辑器/CI 离线 bake pipeline 和二进制 artifact 发布流程。
- 多 agent profile、多层/多高度场景以及 crowd/local avoidance adapter。
- Recast route field；当前 capability 明确为 `routeFields: false`，调用会稳定返回 unsupported。
