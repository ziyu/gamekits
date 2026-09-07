# ADR 0011：Physics Query、Cast 与 Collision Filter 公共协议

## Status

Accepted

## Context

ADR 0010 已决定引入统一 Physics facade 与多后端 adapter。下一步需要明确这层 facade 是否足够通用，能否承载接近常见游戏引擎的物理能力：raycast、shape cast、overlap、check collision、collision mask、trigger/sensor 查询、Editor 拾取、AI 视线检测和 placement preview。

如果只把当前后端的少量 query 能力直接暴露出来，会产生几个问题：

- Gameplay 会围绕某个 backend 的临时 API 写死，例如只支持 point / overlap，之后很难补 raycast 或 shape cast。
- 2D / 3D backend 对 shape、rotation、sensor、filter group 和 hit result 的表达不一致。
- Editor、DevTools、AI 和 gameplay 会各自重新定义 “first hit / all hits / closest hit / include trigger”。
- Collision layer/mask 容易和 team、damage channel、projectile owner 等玩法语义混在一起。
- Backend 不支持某种 query 时可能静默降级，导致命中结果和调试信息不可信。

GameKits 需要借鉴常见引擎的物理查询族，但不能复制某个引擎或某个物理库的 API。公共协议必须保持 backend-neutral、可测试、可保存、可诊断，并允许 adapter 在 native path 中暴露高级能力。

## Decision

Physics Core 使用一个统一 `PhysicsQuery` discriminated envelope 作为底层入口：

- `point`：点命中查询，用于鼠标拾取、Editor 选择和 placement preview。
- `raycast`：从起点沿方向查询到最大距离，覆盖 Raycast / Linecast 用例。
- `shape-cast`：把 shape 沿方向 sweep，覆盖 SphereCast、BoxCast、CapsuleCast 等用例。
- `overlap`：在给定 transform 放置 shape 并返回重叠 collider。
- `check`：只返回 boolean 的 overlap / pair test，允许 backend 走 no-allocation 快速路径。
- `bounds`：AABB / bounds 查询，用于候选集、框选和 DevTools。

`PhysicsScene.query(query)` 是唯一规范入口。Core 可以提供 `raycast(...)`、`shapeCast(...)`、`overlapShape(...)`、`checkOverlap(...)`、`checkCollision(...)`、`queryBounds(...)` 等便捷 helper，但这些 helper 必须薄包装 `PhysicsQuery`，不能形成第二套语义。

所有 query family 共享 `PhysicsQueryOptions`：

- `filter?: PhysicsCollisionFilter`
- `triggerInteraction?: "use-scene" | "include" | "exclude" | "only"`
- `mode?: "any" | "closest" | "all"`
- `sort?: "none" | "distance"`
- `maxResults?: number`
- `ignoreBodies?: PhysicsBodyId[]`
- `ignoreColliders?: PhysicsColliderId[]`
- `includeBodies?: PhysicsBodyId[]`
- `includeColliders?: PhysicsColliderId[]`

Query result 返回稳定 GameKits 字段：

- `colliderId`
- `bodyId`
- `entityId`
- `point`
- `normal`
- `distance`
- `fraction`
- `inside`
- `sensor`

Backend native hit、triangle id、feature id、manifold 和内部 collider handle 不进入 Core result。需要这些字段的 app-specific integration、Editor backend panel 或 DevTools backend plugin 必须显式依赖具体 adapter 的 native path。

Collision filter 使用统一 envelope：

```ts
export type PhysicsCollisionFilter = {
  groups?: string[];
  collidesWith?: string[];
  categoryBits?: number;
  maskBits?: number;
};
```

`groups` / `collidesWith` 面向 Data、Editor 和设计工具；`categoryBits` / `maskBits` 面向底层 backend 映射。同一 filter 同时存在语义名和 bit mask 时，bit mask 是低层最终表达，语义名仍可用于 trace 和 DevTools 显示。未注册 group 名必须产生 diagnostic。

Scene 或 profile 可以声明 layer registry 与 collision matrix，作为默认 collider filter 和 query filter 的来源。Sensor / trigger interaction 与 layer/mask 正交：layer/mask 决定候选是否匹配，triggerInteraction 决定 sensor 是否参与 query 或是否产生 solver contact。

Physics filter 不承载所有 gameplay target rule。team/faction、damage channel、projectile owner、pierce、ability target rule 等语义放在游戏 Data/component/GAS/TCA 中，通过 query/contact 返回的 stable id 关联解释。只有需要进入 broadphase/narrowphase 裁剪的规则才映射到 physics filter。

Backend capability 必须声明：

- 支持的 shape 类型和维度。
- 支持的 query family。
- 是否支持 shape rotation、shape cast、bounds query。
- 支持的 triggerInteraction 模式。
- 支持的 `any` / `closest` / `all` mode。
- 是否能保证 distance sorting。
- collision filter 映射方式和 bit 数限制。
- native path 是否可用。

公共 API 调用未支持能力时，adapter 必须返回明确 diagnostic 或抛出 GameKits error，不能用不等价行为静默降级。

## Consequences

收益：

- Physics facade 可以覆盖 gameplay、Editor、AI、DevTools 和 placement preview 的核心物理查询需求。
- 2D / 3D backend 有统一 conformance surface，Rapier、Matter、Phaser Physics 等 adapter 可以逐项声明能力。
- Collision layer/mask 与 gameplay target rule 分离，避免 Physics Core 变成战斗规则系统。
- Query/cast/filter 的行为可被 trace、DevTools 和测试解释。
- 后端专属高级信息仍有 native path，不污染公共 API。

代价：

- `physics-core` 需要更完整的类型、helper 和 conformance tests。
- Adapter 需要把 backend 各自的 query/filter 语义归一化，特别是 sensor、closest/all、rotation 和 result sorting。
- 并非所有 backend 都能支持完整 query family；应用必须根据 capability 选择功能或提供降级 UI。
- Editor 大规模查询、mesh triangle hit、character controller sweep 等高级能力可能仍需 adapter native path。

## Boundaries

- Query 是 pull/read API，不把每帧 query result 广播进 EventBus。
- Contact enter/exit 可以作为低频 EventBus fact；manifold、solver cache 和 backend hit object 不进入 EventBus。
- Renderer/Input/Camera 可以提供坐标转换、debug draw 和用户操作意图，但不拥有 physics query 语义。
- Save payload 保存稳定 body/collider/filter/sensor 状态，不保存 query cache 或 native broadphase state。
- Backend-specific native path 只能在显式依赖 adapter 包的代码中使用，不进入可复用 gameplay module。

## Relationship To Existing ADRs

ADR 0010 定义统一 Physics facade 与多后端 adapter；本 ADR 细化其中 query、cast、overlap、check 和 collision filter 的公共协议。

ADR 0005 继续约束 Physics 属于 GameModule lifecycle，因为 query/contact 需要 world、tick 和 gameplay context。

ADR 0007 继续约束 Driver ownership。Phaser 这类绑定完整 runtime 的 physics 能力由 Driver 暴露 adapter，仍必须遵守本 ADR 的 query/filter 协议。
