# Navigation 模块设计

## 定位

Navigation 是路径、共享路线场与可通行空间的 facade / Game Module toolkit。它向 AI、玩家辅助移动、Editor、建造验证和内容检查提供稳定查询，不属于 Physics、AI 或 Renderer。

相关包：

- `@gamekits/navigation-core`：游戏侧协议、请求/路线生命周期、layout 组合和 GameModule。
- `@gamekits/navigation-core/backend`：Graph/Grid/Navmesh/Worker adapter port。
- `@gamekits/navigation-core/testing`：conformance、Memory/Deferred Backend 和 fixture。
- `@gamekits/navigation-graph`：authored graph Backend 与 layout factory。
- `@gamekits/navigation-grid`：规则格网 Backend、`navigation.grid` DataType 与 layout factory。
- `@gamekits/navigation-navmesh`：Backend-neutral triangle/build source、area metadata 与 DataType。
- `@gamekits/navigation-recast`：Recast/Detour WebAssembly adapter、NavMesh generator/query runtime 与 tooling boundary。
- 可选 Backend：navcat、原生/远程 baker、Worker-backed adapter 等。

Core 不自研完整 navmesh 烘焙器、几何引擎、Physics collision 或 crowd solver。具体算法和 native runtime 只存在于 Backend package。

## 领域边界

Navigation 负责：

- layout/backend lifecycle 与 stable revision。
- point projection、path request、共享 route-field request 和 route sampling。
- agent profile、area cost、portal、dynamic blocker/cost 和 dependency invalidation。
- queued/submitted request budget、公平调度、cache、negative cache 和 terminal retention。
- route retention/release、stale detection、progress/stuck read model。
- trace、snapshot、content validation 和 Backend conformance。

Navigation 不负责：

- AI 目标选择、任务阶段、攻击槽、encounter 或 gameplay team。
- Physics body 推进、碰撞响应、RVO/crowd solver 或最终移动合法性。
- Renderer debug mesh；DevTools 消费稳定 snapshot/trace 自行表现。
- 从背景像素、Renderer object 或 native Physics handle 反推长期 layout。

## 公共入口与依赖方向

```txt
game / AI / Editor
       ↓
@gamekits/navigation-core
       ↓
NavigationHandle / NavigationQueries

Graph/Grid/Navmesh adapter
       ↓
@gamekits/navigation-core/backend
```

业务代码不 import Backend subpath。Adapter 不 import App Host、AI、Physics Backend、Renderer 或具体游戏。

## Layout 与 Agent Profile

```ts
export type NavigationAgentProfileDefinition = {
  id: string;
  radius: number;
  height?: number;
  maxSlope?: number;
  allowedAreas?: string[];
  costOverrides?: Record<string, number>;
};

export type NavigationLayoutDefinition = {
  id: string;
  backend: string;
  source: DataRef;
  areas?: NavigationAreaDefinition[];
  portals?: NavigationPortalDefinition[];
};
```

Portal 使用 point endpoint 和稳定 id；Backend 将 endpoint 投影为 graph connection、off-mesh link 或自己的等价语义。Layout source 只通过 `DataRef` 指向 Backend-owned authored data。

`createNavigationRuntime()` 接受直接 Backend，或接受 layout/ref、Data Registry 与 Backend factory。两条路径互斥，并由 composition 统一拥有 dispose。

Agent profile 是真实通行约束。Backend 必须应用它声明支持的 radius、height、maxSlope、area 和 cost；不支持的约束通过 capability/snapshot/diagnostic 明确暴露。

## Request 生命周期

```txt
accepted
  → queued in Core
  → submitted to Backend
  → pending
  → complete | failed | cancelled | rejected
```

Core 分别限制：

- 总 active request。
- 每 requester active request。
- 每 tick Backend submit 数。
- 每 tick Backend poll 数。
- terminal result、route 和 cache retention。

Backend 使用 `submitPath/pollPath/cancelPath/releasePath`。同步 Backend 可以在第一次 poll 完成；异步 Backend 可以在后续 tick 完成。Terminal Backend result 携带计算 revision；陈旧结果只能有限重试或显式失败，不能伪装为当前 revision。

重复 request id 只有在语义签名相同时才幂等。不同输入复用同一 id 返回独立 conflict rejection，不覆盖原请求。

## Path 与共享 Route Field

`NavigationPathRequest.routeKind` 选择结果：

- `path`：独立 point/corridor，适合少量 actor、一次性移动和工具预览。
- `field`：共享 goal-keyed route field，适合大量 agent 前往少量目标。

完成结果返回 `NavigationRoute` union。游戏只持有 Core `routeId`；Backend route key、node/poly、heap 或 native handle 不进入公共 API。

`sampleRoute(routeId, point)` 返回 route 上的投影点、next point、preferred direction、distance-to-route 和 remaining distance。Path 由 Core sampler 处理；field 由 Backend sampler 处理。调用方完成、换路或移除 agent 时显式 `releaseRoute()`。

离散 portal/off-mesh connection 不能伪装成连续地面 segment。下一步需要 traversal 时，valid sample 额外返回 `{ kind: "portal", portalId, entryPoint, exitPoint }`，并让 `nextPoint` 指向 entry。Point path 在 route 的 `traversals` 中标记对应 point index；Core sampler 不把 entry→exit 的 chord 当作可投影地面。Backend 负责返回自己真实投影后的方向正确 endpoint，调用方负责抵达 entry 后执行传送、跳跃、攀爬、开门或 authority policy，再从 exit 的新观测位置继续采样。具体决策见 ADR 0041。

Path sampler 在多个 segment 对当前位置等距时选择 route 顺序更靠后的 segment，保证共享 waypoint 等可消歧位置继续向 goal 前进。`direction` 是从 route projection 指向 `nextPoint` 的路线偏好，不是可以无界积分的最终位移；移动集成应把 `nextPoint` 作为局部 steering target，消除 cross-track 偏差，并将单步位移钳制到 target 距离或连续消费跨 waypoint 的剩余步长。

Field 是 Backend-owned 共享资源。Core route retention 与 Backend `retainRoute/releaseRoute` 对称；Backend 只能淘汰未被 request 或公开 route 持有的 field。Core 不缓存 field handle，Backend 以 goal/profile/cost/revision 语义复用实际计算场，并以独立 generation identity 防止旧 route 的延迟 release 误减新 field 引用。Backend 保留整棵 field tree 的失效依赖；每个完成请求只向 Core 投影该起点实际路线的依赖，不能为每个共享者复制完整 topology dependency tree。Core 不读取 node、cell、polygon、portal 或 native field state；具体边界见 ADR 0040。

## Revision、障碍与失效

动态更新 target 包括 edge、area、portal 和 custom：

```ts
export type NavigationObstacleUpdate = {
  id: string;
  target: NavigationObstacleTarget;
  blocked?: boolean;
  costMultiplier?: number;
  source?: string;
};
```

Backend 返回 dependency invalidation：

- dependency 相交的 cache/route 保持旧 revision，sample 返回 stale。
- 明确不相交的 cache/route 可以晋升到新 revision。
- dependency 未知、解除阻挡或降低 cost 时可以保守全量失效，因为新路线可能优于全部旧结果。
- 外部 Backend revision 漂移时，Core 不命中旧 cache，也不发布旧 in-flight result。

Progress tracker 把 stale/missing、remaining-distance 改善、arrival 和 stuck 形成稳定 read model；它不直接重新请求、不写 AI blackboard，也不推进 Physics。

## Steering 与 Physics

```txt
Navigation route sample
  → preferred direction / remaining distance
  → AI or player movement policy
  → separation / anticipation / gameplay constraints
  → Physics command
  → observed position/progress
  → Navigation progress tracker
```

Navigation 不接收 `PhysicsScene` 或 native body。最终可移动性、contact 和局部避障属于 Physics/steering；路径规划也不能替代最终碰撞验证。

Portal traversal 同样遵守此边界：Navigation 只报告稳定 portal identity 和 entry/exit，不直接修改 World/Physics position，也不拥有 traversal 动画。执行方完成原子或分阶段 traversal 后，应重置该 agent 的 progress baseline，再用新的观测位置继续采样。

## Authoring 与内容验证

Navigation 内容验证使用稳定 probe：

- spawn/goal 能按指定 profile 投影。
- required start→goal route 存在并满足 cost limit。
- profile radius/height/slope 与 Backend authored clearance 兼容。
- portal endpoint、area、cost 和 source reference 有效。
- 动态建造验证可以在 app/content tooling 中对候选 blocker 运行 required-route policy。
- Physics collider 与 Navigation blocker 使用同一个 app-owned placement instance/source id；两个 runtime 不直接互相读取。

昂贵几何分析发生在内容构建、Editor 或测试，不在每局启动时重复执行。Core validator 负责 backend-neutral probe；Backend package补自己的 topology/navmesh/grid 专属检查。

## Graph Backend

Graph Backend 把 authored nodes/edges、layout area 和 point portal 编译为 topology/traversal state，并提供：

- deterministic shortest path 和稳定 tie-break。
- goal-keyed reverse route field。
- area base cost、profile override、edge/area/portal blocker 和 cost multiplier。
- authored width、height clearance 和 slope 对 agent profile 的过滤。
- dependency-aware partial invalidation。
- 有界 request result、route field 和 snapshot。

Graph 是稀疏 authored route Backend，不是假装成 navmesh。自由空间、复杂几何、动态 tile 或 crowd 需求使用独立 Grid/Navmesh/Steering package。

Graph 节点只表达路口、门洞、通道转折、语义地标和显式 traversal endpoint；边表达可解释的道路或走廊连接。Raster 采样点、全方向 line-of-sight 候选和 visibility mesh 不能直接成为运行时 Graph。自动 authoring 工具可以生成候选，但必须经过 corridor/route simplification，并把中间数据限制在 tooling diagnostics。

## Grid Backend

Grid Backend 把 authored walkable cells、layout area 和 point portal 编译为规则 raster topology，并提供：

- 4/8 connectivity 和禁止 diagonal corner cutting 的确定性邻接。
- goal-keyed reverse route field、稳定 cell-id tie-break 与 cell-center path extraction。
- radius、height clearance、slope、allowed area 和 area cost override 过滤。
- area、portal 和 custom dynamic cell region blocker/cost。
- dependency-aware partial invalidation、有界 request/field retention 和 snapshot。

Grid origin 表示 `(0, 0)` cell center，未声明的 cell 是不可通行空间。Grid 适合 tile/raster 地形和中等规模自由空间；大世界分块、hierarchical search、navmesh baking、Worker offload 和 crowd steering 仍是独立 Backend/模块职责。具体取舍见 ADR 0038。

## NavMesh 与 Recast Backend

NavMesh source package 使用普通可序列化数据表达 triangle geometry、agent build profile、area 标注和 off-mesh connection authoring。它不导出 Recast poly ref、WASM handle、query filter 或 native tile。

Recast adapter 负责显式异步初始化、single/tiled NavMesh generation、projection、polygon corridor path、共享 polygon route field、area filter/cost、off-mesh connection、tiled rebuild 和 native dispose。静态关卡优先离线/Editor 烘焙；程序化地图和测试可以 runtime generation，浏览器中的昂贵 generation 应放入 Worker。没有显式 portal cost 时，point path 可以直接使用 Detour corridor query；存在已启用且带显式 cost 的 portal 时，adapter 必须先用 GameKits cost 语义选择准确的 native polygon corridor，再把该 corridor 交给 Detour straight-path/funnel 生成几何，不能让 Detour 以 endpoint 物理距离替代 authored traversal cost。

Navigation 的有效 area cost 语义是 `(profile override ?? layout base cost) × dynamic multiplier`，允许小于 `1` 的优惠区域。若具体寻路库的启发式要求原生 traversal multiplier 不小于 `1`，Adapter 必须在单次 query 内按所有可通行区域的最小有效 cost 做等比例归一化，保持路线排序不变；公共 result cost、cost limit、debug 和数据协议仍使用未归一化的 GameKits 有效 cost，不能泄漏第三方库的数值限制。

不同 agent radius/height/climb/slope 是 build-time 约束。需要显著不同尺寸的单位时，组合层选择不同 build profile/NavMesh layer，不能只在查询时修改 radius 并假设已侵蚀空间会重新出现。门/权限/危险区等不改变几何的状态优先使用 area/flag/filter；真实几何变化使用 tile rebuild/TileCache。

NavMesh Backend 只有在真正提供可复用 polygon/region field 与 sampler 时才声明 `routeFields`。对同一 goal 为每个 agent 重跑完整 path query 不算共享 field，必须通过 capability 返回 unsupported。

Recast field 在 adapter 内从 native NavMesh 编译私有有向 polygon topology，将 off-mesh connection 折叠为保持单向/双向语义的 traversal arc，再按 GameKits 有效 area cost 从目标执行反向搜索。Field sampler 对普通 polygon passage 返回局部 steering target，对 off-mesh arc 返回 entry/exit traversal；poly ref、反向树和 native portal handle 不进入 Core。动态 area/portal 更新按 field tree dependency 失效，field cache 有界且不能淘汰仍被 request/Core route 持有的 generation。

Recast 的 off-mesh arc 必须把 authored portal cost 用作离散连接成本，并分别保留 polygon→entry 与 exit→polygon 的局部成本；不能用 endpoint 世界距离覆盖显式 portal cost。该成本同时参与 point path corridor 与 shared field 的选择，两种 route kind 对同一 profile、状态和目标必须选择相同的 portal 语义。采样时返回 entry/exit traversal，不能让 agent 沿 endpoint chord 穿过不可导航空间。

## 可观测性

Trace 至少区分 lifecycle、request、backend、result、cache、route、obstacle 和 budget。Snapshot 只包含 id、revision、request/route/cache 数量、profile 和 Backend bounded summary，不展开完整 graph/navmesh/native state。

Graph node、Grid cell、Navmesh polygon 等大体量几何调试数据不进入 Core bounded snapshot。需要场景或工具绘制时，由显式选择该 Backend 的 provider/DevTools plugin 从 backend-owned source 或 typed tooling path 投影成调用方自己的通用调试几何；共享 gameplay/UI 不 import Backend authoring 类型，也不把绘制 primitive 上推为 Navigation gameplay 协议。

`onTrace` 是旁路 observer；observer/redactor 失败不能改变请求结果。App Host 可以把白名单摘要送入 DevTools correlation，但 Navigation Core 不依赖 DevTools。

## 包内架构

Core 使用 `contracts/layout/requests/routes/backend/observability/composition/testing`；Graph 和 Grid 各自在自己的 package 内使用 `contracts/data/compiler/search/runtime/composition`，不共享 native topology。详细依赖方向见 ADR 0037 与 ADR 0038。

Root、`/backend`、`/testing` 是有意图的公共入口。禁止重新建立包含所有语义的包级 `types.ts` 或千行 god runtime。

## 最佳实践

### 模块集成

- 组合层注册 Navigation DataTypes 和 Backend factories，通过 layout/ref 创建一个具名 Handle。
- Navigation module 必须排在消费它的 AI module 之前；AI 通过显式 DI 获得同一 Handle，App Host 不暗中创建第二个 runtime。
- Backend 先通过 immediate/deferred completion、cancel、revision、field、invalidation 和 dispose conformance，再进入真实 app。
- 多 Backend 游戏场景应把地形/玩法语义与 Backend authoring 数据分开：场景只定义稳定地标和操作，provider 映射 layout/source/factory 与 obstacle target；所有 provider 进入同一场景 API 和行为测试矩阵，不能为 Graph/Grid/Navmesh 分别复制 controller 或 UI。
- 多个 Backend 比较同一自由空间时，应由 app/editor/content tooling 维护唯一 terrain/placement source，并分别派生 Graph 语义 route 标注、Grid raster 或 NavMesh bake input；画面、碰撞与 Backend debug geometry 必须能验证到同一空间事实，禁止独立手写一张展示背景和一套无关寻路数据。这个派生过程属于集成/tooling，不进入 Navigation Core，也不把 Graph Backend 扩张为通用地形烘焙器。
- 多 Backend 调试绘制由 provider/tooling boundary 归一化 Backend 数据，图层开关和 canvas/renderer 保持共享；不要把完整 topology 塞入每帧 Navigation snapshot，也不要在共享 UI 中按 backend id 读取 node/cell/poly。
- App-owned arena placement 同时派生 Physics collider、Render placement 和 Navigation update，但三者仍由各自模块拥有。
- Graph Backend 在编译期建立 point spatial index；高频 `sampleRoute()` 不允许为每个 agent 线性扫描全部 node。
- Grid Backend 通过 coordinate lookup/邻域扩张完成 projection，8 邻接必须验证 cardinal corner；业务代码不能依赖 cell id、column 或 row。
- Recast 必须在 app/adapter boot 边界显式初始化，生成和 query 失败转换为带上下文的稳定 Navigation error；WASM object 在 Backend dispose 时对称释放。
- Recast/Detour query filter 必须把可通行区域的最小有效 cost 归一化为 `1`，避免小于 `1` 的 cost 破坏 A\* heuristic admissibility；归一化只存在于 native query boundary，不改变公共 cost 语义。
- Recast route field 必须遍历反向有向 polygon arc；不能直接把从 goal 正向运行的 Detour Dijkstra parent tree 当作反向场，否则单向 off-mesh connection 和按 source polygon 计费的 area cost 会反转。
- Recast point path 遇到已启用且有显式 authored cost 的 portal 时，必须先按与 field 相同的私有 topology/cost 语义选 corridor，再使用 Detour 生成平滑几何和 off-mesh point flags；不能先让 native query 按 endpoint 距离选路、再只在结果上改 cost，因为事后计费无法改变已选走廊。
- Graph/Grid/Recast 的 portal sampler 都必须返回 Backend 投影后的 entry/exit traversal；调用方只能在抵达 entry 后执行 traversal，不能把 exit 当作普通连续 steering target，也不能用两点距离猜测 portal。
- NavMesh 生成参数属于内容 profile。至少保存输入 source revision、agent build profile 和 baker version，避免运行时加载与内容验证使用不同拓扑。
- Backend route-field 上限只淘汰未被 request/Core route 持有的 field；活动 field 可以暂时超过 inactive cache 预算，最终由 Core route retention 上限约束。
- 容量测试必须分开测量独立 point-path burst 的排队/计算吞吐，以及共享 route field 的每单位每 tick 采样成本；Canvas、React、Renderer、Physics 和 crowd separation 需要单独归因，不能用展示层帧率反推 Navigation Backend 容量。

### 模块使用

- 少量一次性移动请求 `path`；大量单位共享目标请求 `field`。
- 每个 agent 使用稳定 requester id，完成或放弃路线时 release；无路径使用退避/重选目标，不能每 tick 无限重试。
- Path follower 必须朝当前 sample 的 `nextPoint` 收敛，并在单帧可能跨过 waypoint 时 clamp 或逐段消费剩余步长；不能直接把未受限 delta 乘 `direction`，否则密集 Grid path 会在拐点越界并失去前向 segment。
- sample 携带 portal traversal 时，先走到 `entryPoint`，再由 gameplay/authority policy 执行连接并把观测位置更新到 `exitPoint`；不要在中间不可导航空间继续调用普通地面 steering。
- AI 只消费 projection/result/sample/progress，不直接 import pathfinding library 或修改 Backend graph。
- 建造和门状态提交语义化 obstacle update；业务代码不操作 node、polygon、tile 或 native runtime。

## References

- Public API: `docs/adr/0036-navigation-query-and-backend-lifecycle.md`
- Package architecture: `docs/adr/0037-navigation-package-internal-architecture.md`
- Grid backend: `docs/adr/0038-deterministic-grid-navigation-backend.md`
- Recast/NavMesh boundary: `docs/adr/0039-recast-navmesh-backend-and-authored-graph-boundary.md`
- Portal traversal sampling: `docs/adr/0041-navigation-portal-traversal-sampling.md`
- Cross-module boundary: `docs/architecture.md`
- Gameplay foundation: `docs/adr/0031-gameplay-foundation-packages-and-agent-ai.md`
