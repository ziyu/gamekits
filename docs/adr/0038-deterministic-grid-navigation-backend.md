# ADR 0038: Deterministic Grid Navigation Backend

Status: Accepted on 2026-07-20.

Related decisions: ADR 0036 defines the public query/backend lifecycle; ADR 0037 defines Navigation package ownership.

## Context

Navigation Core 和 Graph Backend 已经证明 request/poll、path/field、revision、dynamic obstacle、layout factory 和 route retention 协议可以工作，但单一 Graph 实现仍不能证明应用真正与 Backend 解耦。Graph 表达人工编写的稀疏路线；规则格网、tile 地形和自由空间 raster 需要不同的 authoring 数据、projection、邻接、clearance 与动态区域映射。

Sandbox Navigation Lab 也需要在同一张地形、同一套控制器和同一套操作下切换两个真实 Backend。仅注册另一个 Graph provider id 无法验证 `NavigationBackendFactory`、Data source、obstacle target 和 App Host session 是否具有真实替换能力。

## Decision

### 新增独立 `@gamekits/navigation-grid` Backend package

Grid package 依赖 `@gamekits/navigation-core/backend`，不进入 Core，也不让 grid cell 类型进入游戏侧 API。它公开：

- `NavigationGridDefinition`、walkable cell 和 dynamic obstacle authoring contract。
- `navigation.grid` DataType。
- direct Backend factory 与 layout-driven `NavigationBackendFactory`。

`NavigationGridDefinition.origin` 表示 `(column: 0, row: 0)` 的 cell center；省略的 cell 是不可通行空间。Cell 可以声明 area、clearance、height clearance、slope、cost multiplier 和一个或多个 dynamic obstacle id。Layout 继续拥有 backend-neutral area 与 point portal。

### 编译层建立不可变格网拓扑

编译层把 authored cells 转成稳定 cell id、world point 和 reverse adjacency。Backend 支持 4/8 connectivity；8 邻接的 diagonal traversal 必须同时验证两个相邻 cardinal cell，不能穿过不可通行拐角。

Portal endpoint 在编译时投影到 cell，并成为独立 portal traversal state。Area、portal 和 authored dynamic cell region 分别映射到 Core 的 `area`、`portal` 和 `custom` obstacle target。Grid 不伪造 Graph edge id。

### 搜索与 lifecycle 复用 Core 语义

Grid Backend 使用 deterministic goal-keyed reverse route field：

- path request 从 field 提取独立 cell-center point path。
- field request 保留 Backend route key，并通过 `sampleRoute()` 返回方向和剩余 cost。
- tie-break 使用稳定 cell id。
- profile 的 radius、height、maxSlope、allowed area 和 cost override 都参与 projection/traversal。
- request、field retain/release、revision、bounded LRU、snapshot 和 dispose 遵守 ADR 0036。

阻挡或提高 cost 时按 route-field dependency 部分失效；解除阻挡或降低 cost 时保守全量失效，因为原先所有 route 都可能出现更优路径。Backend snapshot 只公开尺寸、walkable cell 数、动态状态计数和 retained field 数，不展开完整 raster。

### Package 内部按变化轴拆分

```txt
packages/navigation-grid/src/
  index.ts
  contracts/
  data/
  compiler/
  search/
  runtime/
  composition/
```

contracts/data 负责 authored source；compiler 负责 topology/traversal state；search 负责 projection、heap、field 和 path extraction；runtime 负责 Backend request/route/dynamic lifecycle；composition 只提供 direct/layout factory。Root 只导出 app/adapter 需要的 authored contract、DataType 和创建函数，compiler/search/runtime 私有状态不导出。

### Navigation Lab 用 provider 切换真实 Backend

Ashen Ford 的地形、单位、任务、controller、UI 和测试保持一份。Graph provider 把世界操作映射到 edge/area/portal；Grid provider 用 0.5 m raster 表达河岸自由空间，并把同一操作映射到 custom cell region/area/portal。

切换 provider 时释放完整 App Host session，再以同一 GameAppDefinition 和 UiRuntime 创建新 session。Backend runtime state 不跨 provider 迁移；共享的是场景定义与公开操作语义。

## Consequences

Positive consequences:

- Navigation 的 Backend-neutral contract 由两种不同 authoring/search 模型共同验证。
- Tile/raster 游戏可以直接使用 Grid，不必把每个 tile 人工伪装成业务 Graph。
- Graph 和 Grid 的 dynamic target、snapshot 和路径形状不同，但游戏 controller、UI 和行为测试不分叉。
- Grid package 保持窄且可替换；未来接入成熟 grid/worker 实现时不改变 gameplay API。

Costs and constraints:

- Reverse field 构建仍与 reachable cell 数相关；大世界需要分块、hierarchical grid、Worker 或成熟专用 Backend，不能无限扩大单一 raster。
- Authored clearance/slope 是内容事实，不替代 Physics collision 或运行时 crowd avoidance。
- 当前 Grid 是 deterministic baseline，不是 navmesh baker、几何引擎、JPS/HPA\* 套件或 crowd solver。
- Sandbox provider 为验证而程序化生成 raster；生产内容应由地图导入/构建管线生成并运行 probe validation。

## Rejected Alternatives

### Register a second Graph instance under the `grid` label

Rejected because it only tests id switching and duplicates the same topology/search semantics. It cannot validate grid Data source, projection, clearance, dynamic cell region or different obstacle mapping.

### Put grid cells and search inside Navigation Core

Rejected because Grid is one Backend choice. Core would gain raster authoring and algorithm policy, violating the backend port and blocking independent Navmesh/Worker implementations.

### Add a generic third-party pathfinding wrapper immediately

Rejected for this baseline because the required contract includes retained reverse route fields, revision-aware dynamic invalidation, profile filtering and deterministic lifecycle semantics that a thin one-shot A\* wrapper would not provide. A mature library can replace the private compiler/search implementation or enter as another Backend when it satisfies the same conformance without leaking its types.

## References

- Navigation module: `docs/modules/navigation.md`
- Sandbox app: `docs/apps/sandbox.md`
- Public lifecycle: `docs/adr/0036-navigation-query-and-backend-lifecycle.md`
- Package ownership: `docs/adr/0037-navigation-package-internal-architecture.md`
