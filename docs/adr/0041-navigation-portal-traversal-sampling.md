# ADR 0041: Navigation Portal Traversal Sampling

Status: Accepted
Date: 2026-07-22

## Context

Navigation layout 已经把 portal 定义为两个离散 endpoint 之间的可控连接，Graph、Grid 和 Recast 也都能在搜索中使用它。但是原有 `NavigationRouteSample` 只返回普通 `nextPoint` 和 `direction`，调用方无法区分连续地面段与 portal/off-mesh traversal。

当两个 endpoint 不连续时，把出口直接当作普通 steering target 会让 agent 尝试穿过不可导航空间。Backend 中途重新投影后可能得到错误 node/cell/polygon，或者直接返回 missing。仅凭 endpoint 距离猜测 portal 也不可靠，因为长直路和短距离 jump/door 都可能被误判。

## Decision

`NavigationRouteSample` 的 valid 分支增加可选 `traversal`。当前稳定类型是 portal traversal：

```ts
type NavigationRouteTraversal = {
  kind: "portal";
  portalId: string;
  entryPoint: NavigationPoint;
  exitPoint: NavigationPoint;
};
```

规则如下：

- Backend 负责把 authored portal endpoint 投影到自己的真实 node、cell、polygon/off-mesh endpoint，并按当前行进方向返回 entry/exit。
- Field sampler 在下一步是 portal 时让 `nextPoint` 指向 entry，同时携带 traversal；不能把 exit 当作连续 steering target。
- Point path 可以在 `NavigationPathRoute.traversals` 中标记离散 segment。Core path sampler 不把该 segment 的 entry→exit chord 当作可投影地面；接近 entry 时返回同一 traversal。
- 调用方负责到达 entry 后执行 traversal policy，例如传送、跳跃、攀爬、开门动画或 authority command，再把观测位置更新到 exit。Navigation Core 不移动实体、不操作 Physics，也不决定表现。
- traversal 执行后 progress tracker 从新的观测位置继续采样；调用方可以重置该 agent 的 progress baseline，避免把原子位移误判成 stuck。
- portal id 是稳定 gameplay/content identity；Graph node、Grid cell、Recast poly ref、Detour flag 和 native handle 仍不进入公共 API。
- Recast 的 point path 与 field 都使用 layout 的 authored portal cost，而不是用两个 endpoint 的世界距离替代 traversal cost；polygon 到 endpoint 的局部接近成本仍由 Recast adapter 计算。
- Detour 原生 off-mesh query 不知道 GameKits authored portal cost。存在已启用且带显式 cost 的 portal 时，Recast adapter 先通过与 field 共享的私有有向 topology/cost 语义选择 native polygon corridor，再把完整 corridor 交给 Detour straight-path/funnel 生成路径点与 off-mesh flags。事后只改 route cost 不满足该约束，因为无法改变 native query 已经选定的走廊。

`traversal` 和 path `traversals` 都是可选字段，因此没有 portal 的现有 Backend 和调用方保持兼容。

## Consequences

- Graph、Grid、Recast 可以在相同 Navigation API 下表达同一离散连接。
- Rally Party 和单体 point path 都能区分“走到入口”与“执行连接”。
- 对同一 profile、portal 状态和目标，Recast point path 与 field 不会因为 native endpoint 物理距离而对“是否使用 portal”得出相反结论。
- Navigation 只提供可执行语义，不膨胀为 teleport/crowd/animation/physics runtime。
- 新 traversal kind 必须由真实跨 Backend 用例驱动，并通过新的 ADR 扩展，不能把 Backend-native link type 直接塞进公共 union。

## Rejected alternatives

### 由调用方按 `nextPoint` 距离猜测

无法区分长直线、传送、跳跃和投影误差，跨 Backend 结果不稳定。

### Navigation Core 自动把实体传送到出口

Core 不拥有 World/Physics/authority/animation，也无法决定 portal 的游戏语义。

### 每个 Backend 暴露自己的 off-mesh 类型

会把 node/cell/poly/native runtime 泄漏到 gameplay，并破坏相同场景 API 下切换 Backend 的目标。

## References

- `docs/modules/navigation.md`
- `docs/adr/0036-navigation-query-and-backend-lifecycle.md`
- `docs/adr/0040-backend-owned-navigation-route-fields.md`
