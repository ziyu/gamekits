# ADR 0037: Navigation Package Internal Architecture

Status: Accepted on 2026-07-19.

Related decision: ADR 0036 defines the public query and Backend lifecycle.

## Context

Navigation Core 第一版沿用了通用 `data/ + runtime/ + types.ts` 目录，把 geometry、profile、layout、request/result、Backend port、scheduler、cache、route retention、obstacle invalidation、trace、Handle、GameModule 和测试 Backend 聚合到一个类型文件和一个千行 runtime factory 中。

这种结构掩盖了 Navigation 自身的状态所有权：request queue 和 Backend task 不是 route registry，route sampling 不是 obstacle invalidation，layout authoring 也不是 runtime lifecycle。继续在同一 factory 中增加异步 Backend、route field、layout factory 和 content validation 会形成不可测试的 god runtime。

Graph package 同样把 graph definition、编译、最短路、动态状态、request 生命周期和 DataType 放在单个 `graph/` 目录；它无法清晰表达 immutable topology、mutable traversal state 和 request/field retention 的区别。

## Decision

### Navigation Core 使用领域职责分层

```txt
packages/navigation-core/src/
  index.ts
  contracts/
  layout/
  requests/
  routes/
  backend/
  observability/
  composition/
  testing/
```

职责：

- `contracts`：游戏侧稳定 geometry、profile、route、request/result、obstacle 和 facade 类型。
- `layout`：layout/profile DataType、DataRef 解析、backend factory selection 和 backend-neutral 内容验证。
- `requests`：request registry、公平队列、提交/轮询预算、terminal retention 和 path cache。
- `routes`：path sampler、field delegation、route registry、revision/dependency invalidation 和 progress tracking。
- `backend`：Adapter 作者实现的 port、request/status DTO、factory 和 capability；不包含具体算法。
- `observability`：trace store、snapshot projection 和 observer isolation。
- `composition`：创建 runtime、Handle、GameModule，并连接上述窄组件；不重新持有搜索、缓存或采样算法。
- `testing`：Memory/Deferred Backend、conformance 和 fixture。

内部依赖方向：

```txt
contracts
  ↑
backend ports  layout definitions
  ↑                 ↑
requests  routes  observability
          ↑
      composition
```

`requests` 不 import Graph/Grid/Navmesh；`routes` 不拥有 request scheduling；`layout` 不推进 runtime tick；`observability` 只消费稳定事件和只读计数。composition 是唯一同时连接 Backend、request registry、route registry 和 GameModule lifecycle 的位置。

### Navigation Graph 按编译、搜索和 runtime 分层

```txt
packages/navigation-graph/src/
  index.ts
  contracts/
  data/
  compiler/
  search/
  runtime/
  composition/
```

- `contracts`：authored graph node/edge definition 和 Graph options。
- `data`：Graph DataType 与结构诊断。
- `compiler`：把 authored graph、layout areas 和 portals 编译为 immutable topology 与有界 mutable traversal state。
- `search`：deterministic reverse route field、heap 和 route extraction/sampling。
- `runtime`：实现 Navigation Backend request lifecycle、dynamic update、field retention 和 snapshot。
- `composition`：direct Backend factory 与 layout-driven `NavigationBackendFactory`。

Graph package 可以维护自己的窄确定性算法实现，但算法数据不能进入 Core API。若未来成熟库在体积、性能、确定性和失效语义上更合适，应新增独立 backend package，而不是把第三方类型塞进 `navigation-graph` 或 `navigation-core`。

### 公共入口按消费者拆分

`@gamekits/navigation-core` 提供：

- root：游戏/AI/Editor 使用的 contracts、DataType、facade、创建函数和 progress/content validation helper。
- `/backend`：Backend port、factory、capabilities 和 DTO。
- `/testing`：Memory/Deferred Backend、conformance 和 fixture。

Root 不导出 Backend request token、request registry、cache entry、route registry、trace store 或测试替身。

`@gamekits/navigation-graph` root 只导出 authored definition、DataType、direct factory 和 layout factory；compiler/search/runtime 私有类型不导出。

### 文件和测试跟随状态所有权

禁止重新建立包级 `types.ts`、`helpers.ts`、`utils.ts` 或通用 `runtime/index.ts` 来聚合无关语义。内部实现优先直接 import 所属文件；barrel 只服务三个明确 public subpath。

测试镜像 `layout`、`requests`、`routes`、`composition` 和 Graph backend；Backend conformance 同时覆盖 immediate 与 deferred completion、queued/in-flight cancel、revision drift、route field、partial invalidation 和 dispose retained state。

## Consequences

Positive consequences:

- 目录能直接解释 request、route、layout、Backend 和 lifecycle 的所有权。
- 异步协议、route field 和 layout factory 可以独立测试，不再继续扩大一个千行闭包。
- 游戏、adapter 和测试消费者只看到各自需要的导出面。
- Graph topology、search field 和动态 traversal state 可以分别优化与审计。

Costs and constraints:

- 需要移动现有文件、拆分公共类型、增加 package subpath，并同步迁移 Graph、App Host、test-utils、测试和 benchmark。
- 组件边界会增加少量显式 DTO 和 cleanup 调用，但这些调用正是异步 request 与 route ownership 所需的生命周期。
- 不能为了减少文件数量再次让 composition factory 直接操作所有 Map。

## Rejected Alternatives

### Keep `runtime/types.ts` and only extract helper functions

Rejected because类型所有权仍然错误，Backend、游戏 facade、layout 和 observability 会继续通过同一个文件形成隐式耦合。

### Put request scheduling inside every Backend

Rejected because公平队列、per-requester budget、terminal retention、trace 和 GameModule tick 是 Core 的稳定策略；Backend 只负责具体路径能力和自己的 native lifecycle。

### Merge Navigation Core and Graph

Rejected because Core 必须允许 Graph、Grid、Navmesh、Worker 或平台 Backend 替换；Graph authored schema 和算法不是所有游戏的必选依赖。

## References

- Public API decision: `docs/adr/0036-navigation-query-and-backend-lifecycle.md`
- Navigation module: `docs/modules/navigation.md`
- Architecture: `docs/architecture.md`
- Implementation principles: `docs/implementation-principles.md`
