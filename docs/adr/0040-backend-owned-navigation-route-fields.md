# ADR 0040: Backend-owned Navigation Route Fields

Status: Accepted on 2026-07-22.

Refines ADR 0036 and ADR 0039.

## Context

Navigation Core 已经把 `routeKind: "field"` 定义为大量 agent 前往少量目标时共享的 goal-keyed route state。Graph 和 Grid 可以直接在自己的 node/cell topology 上计算反向场；Recast 则持有 polygon、portal、off-mesh connection、query filter 和 WASM/NavMesh 生命周期。

如果 Core 通过重复 point-path 请求模拟 field，搜索次数和路线状态仍随 agent 数量线性增长。如果 Core 自己计算 field，则必须要求所有 Backend 暴露统一 node/edge topology，并让 polygon ref、Grid corner rule、Graph semantic edge 或 native portal 穿过 Backend port。这两种方案都破坏 field 的共享收益或薄内核边界。

## Decision

### Core owns field semantics and public lifecycle

Navigation Core 继续拥有：

- `path | field` 公共协议、capability 和稳定 `routeId`。
- request scheduling、poll/cancel、revision/stale、trace 和 bounded public route retention。
- Core route 与 Backend field 的 `retainRoute/releaseRoute` 对称委托。

Core 不拥有具体 field topology、搜索树、portal target、native handle 或 Backend field cache。

### Backends own field construction, sampling, and native lifetime

支持 `routeFields` 的 Backend 必须真正保存一个可被多个 request/agent 复用的场，并实现 Backend route key、采样、引用计数、失效和有界淘汰。Backend 只能淘汰未被 Backend request 或 Core public route 持有的 field generation。

语义 cache key 与 route generation identity 分离。相同 goal/profile/cost/revision 可以命中同一 field；失效后重建的 field 必须取得新的 generation identity，使旧 route 的延迟 release 不会减少新 field 的引用计数。

### Recast uses a private directed polygon field

`@gamekits/navigation-recast` 从 native NavMesh 编译 adapter-private directed polygon topology：

- 普通 polygon portal 形成有向 traversal arc。
- off-mesh connection 折叠为 ground-to-ground arc，并保留单向或双向连接事实。
- cost 使用 GameKits 的 `(profile override ?? layout base) × dynamic multiplier`，不会复用方向相反、cost 归属不同的 Detour parent tree。
- 从目标 polygon 对反向 arc 运行确定性 Dijkstra，保存 cost-to-go 和 next arc。
- sampler 将世界位置投影到 polygon，并返回下一 portal 后方或 off-mesh exit 的局部 steering target；poly ref 和 field tree 不进入 Core。
- area/portal 更新根据 field tree dependency 失效；inactive cache 有界，活动 generation 可以暂时超过 inactive 上限。

`routeFields` 只有在共享、采样、单向 portal、area cost、revision、retain/release、bounded cache 和 dispose conformance 全部成立时才声明为 `true`。

### Reusable algorithms remain optional Backend tooling

Heap、reverse Dijkstra 或 bounded cache 若被多个纯 TypeScript Backend 证明可以稳定复用，可以进入独立 Backend-oriented toolkit。该 toolkit 不能成为 Navigation gameplay API，不能要求 Recast 把 native topology 转成 Core 公共图，也不能阻止具体 Backend 使用更高效的 native/Worker 实现。

## Consequences

Positive consequences:

- Core 保持第三方库和 topology 中立，同时提供所有 Backend 共用的 field API 与 lifecycle。
- Recast Rally Party 对同一目标只保留一个 field，不再按单位复制完整 path query 和 route state。
- 单向 off-mesh、area cost、动态失效和延迟 release 都由最了解 NavMesh revision 的 adapter 正确处理。
- 后续 native tiled/Worker field 可以替换当前 adapter 私有实现，不改变 gameplay API。

Costs and constraints:

- 每个支持 field 的 Backend 必须实现和测试自己的 topology projection 与 sampler。
- Polygon field 是离散的全局路线偏好，不替代局部 avoidance、Physics movement 或 DetourCrowd。
- 大型 tiled NavMesh 仍需要 sliced/Worker build、分区和性能基线；不能把一次同步全图搜索无限扩展到开放世界。

## Rejected Alternatives

### Build fields in Navigation Core from repeated paths

Rejected because it仍执行每 agent path search、复制 route state，不能在任意当前位置进行共享采样。

### Expose a universal topology graph to Core

Rejected because it把 Graph node、Grid cell、Recast polygon/portal 和 WASM boundary 压成最低共同抽象，扩大 Core、增加高频跨边界调用，并破坏 Backend 可替换性。

### Treat DetourCrowd as a route field

Rejected because DetourCrowd owns per-agent local steering/corridor state；它可以成为独立 crowd/steering adapter，但不是共享 goal field。
