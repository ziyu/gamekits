# ADR 0036: Navigation Query and Backend Lifecycle

Status: Accepted on 2026-07-19.

Refines: ADR 0031 的 Navigation 公共协议与 backend 边界。

## Context

Navigation 第一版已经提供 `requestPath → poll → sampleRoute`、有界队列、缓存、revision 和 Graph backend，但它存在几处会阻碍真实游戏和后续 adapter 的协议问题：

- 调用方看见的是 request/poll 生命周期，Backend 实际只有同步 `findPath()`；Worker、异步 navmesh、远端 authoring runtime 和真正的 in-flight cancel 无法进入同一协议。
- Graph backend 内部共享 goal-keyed reverse route field，但 Core 仍为每个 agent 物化并保留完整 point array；“共享计算”没有形成“共享路线状态”。
- Backend 结果没有独立携带计算 revision。动态障碍在异步计算期间改变时，Core 无法判断结果是否已经陈旧。
- `NavigationLayoutDefinition` 只被校验，没有从 Data Registry 和 backend factory 创建 runtime 的标准组合路径。
- path、route field、backend request token 和 native graph node 的身份边界没有明确区分。

这些问题不能通过继续扩展同步 Graph 实现解决。公共协议必须先表达正确的生命周期，再让 Graph、Grid、Navmesh 或 Worker adapter 各自实现。

## Decision

### 应用侧继续使用有界 request/poll facade

游戏、AI、Editor 和内容验证只依赖 `NavigationHandle`：

```ts
export type NavigationQueries = {
  projectPoint(point: NavigationPoint, profileId: string): NavigationProjection | undefined;
  requestPath(request: NavigationPathRequest): NavigationRequestId;
  poll(requestId: NavigationRequestId): NavigationRequestResult;
  cancel(requestId: NavigationRequestId): void;
  sampleRoute(routeId: NavigationRouteId, point: NavigationPoint): NavigationRouteSample;
  releaseRoute(routeId: NavigationRouteId): void;
  revision(): number;
  snapshot(): NavigationSnapshot;
};
```

`requestPath()` 只接受请求并返回稳定 id；是否同 tick 完成属于 Backend 能力，不改变调用方协议。Core 明确区分 queued、submitted、pending 和 terminal 状态，并分别限制提交预算、轮询预算、总请求数和每 requester 请求数。

`cancel()` 必须同时覆盖尚未提交的请求和已经提交到 Backend 的请求。Core dispose 时取消或释放所有 Backend request 与 route reference，不能只清空自己的 Map。

### Backend 使用 submit/poll/cancel 生命周期

Adapter 作者通过 `@gamekits/navigation-core/backend` 实现：

```ts
export interface NavigationBackendAdapter {
  readonly id: string;
  revision(): number;
  projectPoint(
    point: NavigationPoint,
    profile: NavigationAgentProfileDefinition
  ): NavigationProjection | undefined;
  submitPath(request: NavigationBackendPathRequest): void;
  pollPath(requestId: NavigationBackendRequestId): NavigationBackendPathStatus;
  cancelPath(requestId: NavigationBackendRequestId): void;
  releasePath(requestId: NavigationBackendRequestId): void;
  update?(deltaMs: number, elapsedMs: number): void;
  sampleRoute?(
    routeKey: string,
    point: NavigationPoint,
    profile: NavigationAgentProfileDefinition
  ): NavigationBackendRouteSample;
  retainRoute?(routeKey: string): void;
  releaseRoute?(routeKey: string): void;
  updateObstacle?(update: NavigationObstacleUpdate): NavigationObstacleUpdateResult;
  snapshot(): NavigationBackendSnapshot;
  dispose(): void;
}
```

同步小图 Backend 可以在 `submitPath()` 内完成计算并让第一次 `pollPath()` 立即返回 terminal；异步 Backend 可以返回 pending，并在 `update()`、Worker message 或自己的受控 runtime 中推进。Backend request id、route key、node/poly/native handle 只存在于 Backend subpath 与 Core 私有 registry，不进入游戏侧结果。

每个 terminal Backend result 必须携带计算 revision。若完成 revision 已落后于当前 Backend revision，Core 不发布陈旧路径，而是在有限重试预算内重新提交；超过上限后返回显式 `stale-result` 失败。未知 dependency 的结果继续保守全量失效。

Field route 是 Backend-owned 共享资源。Core 在保留/释放公开 route 时对称调用 `retainRoute/releaseRoute`；Backend 的 LRU 只能淘汰未被 request 或公开 route 持有的 field。Core 不把 Backend field handle 放入正向 path cache；共享收益由 Backend 的 goal/profile field cache 提供。

### 独立 Path 与共享 Route Field 是两种结果

`NavigationPathRequest.routeKind` 明确选择：

- `path`：返回独立 point/corridor，适合少量角色、Editor 预览和一次性路径。
- `field`：返回共享 route-field reference，适合大量 agent 前往少量目标；结果不为每个 agent 复制完整 point array。

完成结果统一返回 `NavigationRoute` discriminated union。`sampleRoute()` 对 path 使用 Core 的 segment sampler，对 field 委托 Backend 的 field sampler。两种结果都使用 Core 分配的稳定 `routeId`，Backend route key 不泄漏。

离散 portal/off-mesh connection 的采样语义由 ADR 0041 细化：valid sample 可以携带 Backend-neutral entry/exit traversal；Core path sampler 不把离散连接的 endpoint chord 当作连续地面。

Route 有独立于 request result 的有界生命周期。调用方可以显式 `releaseRoute()`；Core 的 retained-route 上限仍作为兜底。被动态障碍影响的 route 返回 stale，调用方或 progress tracker 再发起请求，不静默沿用旧方向。

### Layout 通过 Backend Factory 组合

Core 定义 backend-neutral `NavigationBackendFactory`。`createNavigationRuntime()` 接受以下两种互斥来源之一：

- 直接注入已经创建的 Backend，适合测试或 app-owned runtime。
- 注入 layout/ref、Data Registry 和 backend factories，由 Core composition 解析 layout、选择 `layout.backend` 对应 factory 并创建 Backend。

`navigation-graph` 提供 graph factory；未来 grid/navmesh package 使用相同 factory contract。Core 不 import 具体 backend package，也不解释 graph node、navmesh polygon 或烘焙资产。

Layout portal 使用 backend-neutral point endpoint；具体 Backend 决定如何投影或编译成 off-mesh connection。无法表达稳定语义的 Backend 私有 authoring 数据继续留在 layout source，不上推 Core。

### 可通行性和动态变化必须显式

Agent profile 的 radius、height、maxSlope、allowedAreas 和 costOverrides 是真实查询输入，不只是 cache key。Backend 若不能实现某项约束，必须通过 capability/snapshot/diagnostic 暴露，不能默默忽略。

动态更新使用 edge、area、portal 或 custom target。Backend 返回受影响 dependency 或 `invalidateAllPaths`；Core 只晋升明确不相交的 cache/route。解除阻挡、降低 cost 或未知 dependency 可以保守全量失效。

## Consequences

Positive consequences:

- 同一个应用 API 可以承载同步 Graph、异步 Worker、Grid 和 Navmesh backend。
- 大群体可以共享 route field，而不是只共享一次搜索后继续复制完整路线。
- revision、request、route 和 native identity 的所有权清晰，动态障碍期间不会发布伪新鲜结果。
- Layout 有标准组合路径，App Host 不再声称“加载 backend/layout”却只能接收手工创建的 Backend。

Costs and constraints:

- 第一版 `NavigationBackendAdapter.findPath()` 和完成结果中的 `path` shape 被替换；Graph、Memory、测试和 benchmark 必须同步迁移。
- Backend 需要管理 request terminal state，并在 cancel/release/dispose 时正确清理。
- Route field 是可选 Backend capability；不支持 field 的 Backend 必须返回明确失败，不能退化为每 agent 隐式复制而不告知调用方。

## Rejected Alternatives

### Keep synchronous `findPath()` and wrap it with a Promise

Rejected because Promise 不能提供统一的 poll budget、in-flight cancel、Backend update 和 retained-state cleanup，也无法表达 Worker/native runtime 自己的 request token。

### Always return a full path and let Backend cache internally

Rejected because它只共享搜索成本，不共享 route state；1,000 agent 仍会物化、克隆和保留 1,000 份 point array。

### Let each app resolve layout source and construct Backend manually

Rejected because每个游戏会复制 backend selection、DataRef 解析、错误语义和生命周期装配，App Host 的 standard Navigation module 也无法形成可测试的统一路径。

## References

- Navigation module: `docs/modules/navigation.md`
- Package architecture: `docs/adr/0037-navigation-package-internal-architecture.md`
- Gameplay foundation decision: `docs/adr/0031-gameplay-foundation-packages-and-agent-ai.md`
