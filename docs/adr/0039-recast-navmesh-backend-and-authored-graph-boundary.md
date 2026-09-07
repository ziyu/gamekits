# ADR 0039: Recast NavMesh Backend and Authored Graph Boundary

Route-field ownership and the concrete Recast polygon field are refined by ADR 0040.

Status: Accepted on 2026-07-22.

Related decisions: ADR 0036 defines the public query/backend lifecycle; ADR 0037 defines Navigation package ownership; ADR 0038 defines the deterministic Grid Backend.

## Context

Graph 和 Grid 已经验证同一 Navigation Handle 可以切换不同 Backend，但复杂自由空间暴露了错误的职责扩张：Sandbox 曾从 raster terrain 中选择大量采样点，再为每个点保留多方向 line-of-sight 边。它虽然能够避免明显穿墙，却生成了接近 visibility mesh 的高密度网络，无法表达道路、门洞、走廊和备用通路等稀疏语义；agent radius clearance、轮廓简化、region decomposition、portal corridor 和局部重建也会逐步迫使项目重写成熟 NavMesh 工具链。

GameKits 的设计信条要求成熟库负责底层能力。Graph Backend 已有明确定位：它适合人工或内容工具产出的道路、巡逻、交通和剧情移动网络，不应承担任意自由空间烘焙。复杂二维/三维地形需要独立 NavMesh Backend，并继续通过 Navigation Core 的 backend port、layout、profile、revision 和 diagnostics 组合。

## Decision

### Graph 回归稀疏 authored route network

`@gamekits/navigation-graph` 只消费明确 authored nodes/edges。App/editor tooling 可以从道路 spline、门洞、房间连接、地图语义或策划标注生成 Graph，但不能把任意自由空间中的所有可见关系当成最终 topology。

Graph authoring 必须满足：

- 节点代表路口、门洞、通道转折、语义地标或显式 traversal endpoint。
- 边代表可解释的道路/走廊连接，并携带真实 width、height clearance、slope 和 area。
- 自动工具生成的候选 visibility、采样点或中间几何只进入 tooling diagnostics，不直接成为运行时 Graph。
- 自由空间路径平滑不能靠预先塞入大量跨区捷径实现。

### 新增 GameKits-owned NavMesh source package

新增 `@gamekits/navigation-navmesh`，定义不依赖具体库的 NavMesh build source、area/triangle 标注、DataType 和 validation。它是 backend/tooling authoring contract，不进入 gameplay root API，也不拥有几何烘焙算法。

稳定 source 使用普通可序列化数据表达三角形地形、agent build 参数和 area metadata。Recast native objects、poly refs、query filters、WASM handles 和序列化 native tile 不进入该包公共协议。

### 通过独立 Recast adapter 接入成熟实现

新增 `@gamekits/navigation-recast`，依赖 `@gamekits/navigation-navmesh`、`@gamekits/navigation-core/backend` 和 `recast-navigation`。该包负责：

- 显式异步初始化 Recast WebAssembly runtime。
- 从 GameKits NavMesh source 生成 single/tiled NavMesh。
- 把 projection、path query、area filter/cost、off-mesh connection、revision 和 dispose 映射到 Navigation Backend port。
- 在 Detour query boundary 等比例归一化 area cost，使最小可通行有效 cost 为 `1`；GameKits 仍允许小于 `1` 的优惠区域，公共 result/debug/cost limit 使用未归一化 cost。
- 通过 typed tooling/native boundary 提供 backend-specific debug geometry；不把 Recast 类型泄漏到 Navigation Core、gameplay、Data 或 Save。
- 对 runtime generation、query 和 native resource 生命周期产生 bounded diagnostics。

静态内容优先在内容构建或 Editor 阶段烘焙；runtime generation 只用于程序化地图、局部 tile rebuild 和测试场景。浏览器 runtime generation 应允许在 Worker 中运行，避免阻塞主线程。Adapter 初始化失败必须返回带上下文的稳定 Navigation error，不能隐式回退到另一套算法。

### 能力通过 Backend capability 明确表达

NavMesh path、projection、area cost/filter 和 portal/off-mesh connection 是基础能力。共享 route field 只有在 Backend 真正实现 polygon/region field 和可复用 sampler 时才声明支持；不能把“每个 agent 重跑一次完整 path query”伪装成共享 field。

几何变化优先使用 tiled rebuild/TileCache；门、危险区和权限等不改变几何的状态优先使用 polygon area/flag/filter。Physics/Renderer placement 仍由 app-owned placement source 同时派生，Navigation adapter 不直接读取 Physics native handle 或 Renderer object。

### Sandbox 用三种 Backend 说明不同职责

Navigation Lab 保持一份场景 API：

- Graph 展示稀疏语义路线网络。
- Grid 展示 tile/raster 离散通行空间和共享 route field。
- Recast NavMesh 展示复杂连续自由空间、agent clearance 和平滑 corridor path。

相同 terrain/placement source 派生表现、Grid 和 NavMesh input；Graph 使用同一地图上的语义 waypoint/route 标注。Backend debug draw 分别显示最终 Graph、Grid cells 或 NavMesh polygons，候选/中间烘焙数据只能作为独立高级诊断图层。

## Consequences

Positive consequences:

- GameKits 不再维护自研自由空间拓扑生成器，产品级 clearance、region、contour 和 polygon generation 交给成熟库。
- Graph、Grid 和 NavMesh 的职责不再混淆，调试图层更可解释。
- Recast 被限制在具体 adapter，未来可替换为 navcat、原生服务或离线导入器而不改变 gameplay API。
- NavMesh runtime 可以复用 Core 的 request、cache、revision、route retention 和 trace，而不复制第二套游戏侧 facade。

Costs and constraints:

- WebAssembly 需要异步初始化、资源释放、bundler 配置和 Worker/离线烘焙策略。
- 不同 agent radius 通常需要不同 build profile 或明确的多层 NavMesh；仅靠 query filter 不能恢复烘焙时被侵蚀掉的空间。
- Recast 参数仍需要按游戏尺度校准，但这是有边界的内容配置，不再是自研算法调参。
- Detour A\* 的 heuristic 假设 traversal multiplier 不小于 `1`；Adapter 必须保留 query-time 归一化及低于 `1` 的折扣绕路回归测试，不能直接把 GameKits cost 原值写入 native filter。
- `recast-navigation` 是 adapter dependency；升级必须通过 package tests、Sandbox behavior matrix 和外部发布 smoke。

## Rejected Alternatives

### 继续调最近邻和 visibility sector 参数

Rejected because it only changes graph density. It does not solve obstacle erosion, true clearance, region decomposition, contour simplification, polygon corridor, funnel smoothing or tiled rebuild.

### 把 Recast 直接放进 Navigation Core

Rejected because Recast is one backend choice with native/WASM lifecycle. Core must remain library-independent and synchronous/asynchronous-backend neutral.

### 只采用 Yuka 或 three-pathfinding

Rejected because they can query existing navigation data but do not provide the required terrain-to-NavMesh generation pipeline.

### 采用纯 JavaScript NavMesh 作为第一默认实现

`navcat` remains a viable adapter candidate when serializable plain-JavaScript state and introspection matter more than WASM performance. Recast is selected first because of its longer industry track record and Detour runtime ecosystem.

## References

- Recast Navigation: https://github.com/recastnavigation/recastnavigation
- recast-navigation-js: https://github.com/isaac-mason/recast-navigation-js
- Navigation module: `docs/modules/navigation.md`
- Sandbox app: `docs/apps/sandbox.md`
