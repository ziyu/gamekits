# ADR 0022: Fixed-step Presentation Interpolation Store

Status: Accepted on 2026-07-13.

## Context

Physics GameModule 使用 fixed timestep 推进权威模拟，而 Browser 的 render tick 可能是 60 Hz、120 Hz 或更高。Renderer 和 follow camera 如果只读取 fixed step 后写回 World 的 `PhysicsTransformComponent`，在两个物理步之间会重复同一位置，然后一次跳到新位置。静态场景本身没有重建或移动，但相机随这种阶梯状 transform 移动时，透明纹理边缘和高频地面细节会呈现闪烁。

把 interpolation 写进具体游戏会复制 accumulator、body lifecycle、rotation 处理和 cleanup；直接修改 World transform 又会把表现状态混入 gameplay authority，并影响碰撞、Save、多人 snapshot 和 determinism。

## Decision

`@gamekits/physics-core` 提供 opt-in `createPhysicsInterpolationStore()`，由 `createPhysicsModule(...)` 通过 `interpolationStore` option 绑定和推进：

- store 对每个 physics-owned、会同步回 World 的 moving body 保留 previous/current fixed-step transform，并发布当前 accumulator alpha；不跟踪 static body 或 `syncFromWorld` body。
- `sample(bodyId, target?)` 返回 previous/current 之间的表现 transform。Position/vector 使用线性插值，2D number rotation 使用最短角插值，quaternion 使用归一化线性插值。
- 默认数学策略可以通过 store 的 `policy.interpolate` 替换；跨越 teleport、rollback correction 等不连续状态时，组合层通过 `policy.shouldResetHistory` 注入判定。Physics Core 不定义游戏单位、速度阈值或对象类别。
- World component、PhysicsScene 和 checkpoint 始终保存权威 fixed-step state；interpolation store 是 transient presentation state，不进入 Save、multiplayer snapshot、collision query 或 gameplay rule。
- Renderer、camera target resolver、audio spatialization 等表现消费者通过组合层显式接收同一个只读 store。Gameplay module 不从 store 读取权威位置。
- store 支持 caller-owned reusable target，热点同步不要求逐帧分配对象。未提供 store 时 Physics module 保持原有行为和成本。
- Physics module 拥有 bind/unbind、body removal、restore reset 和 dispose cleanup；应用不能另建平行 interpolation clock。
- App Host 的标准 Physics GameModule 配置透传同一个 interpolation store；普通应用不需要为了启用该能力复制自定义 Physics module 装配。

## Consequences

Positive consequences：

- render cadence 高于 physics cadence 时，动态物体和 follow camera 连续移动。
- multiplayer authority、Save 和 deterministic test 仍只观察 fixed-step World state。
- 所有游戏复用同一 body lifecycle、rotation 和 accumulator 语义。
- DevTools 可以独立展示 alpha、tracked body count 和 fixed delta。

Costs and constraints：

- 每个被跟踪的动态 body 保留两份轻量 transform；大量物体场景必须通过 benchmark 约束 sampling 和 retained state。
- checkpoint restore 由 Physics module 重置历史；teleport、rollback correction 等应用语义通过可注入 history-reset predicate 表达，避免核心包写死阈值。
- 远端 multiplayer snapshot interpolation 仍属于 multiplayer presentation buffer；它与本地 fixed-step interpolation 可以组合，但不能共享或混淆时钟。

## Rejected Alternatives

### Interpolate by mutating World transforms

Rejected because表现状态会污染权威物理、Save、query 和 gameplay rule。

### Let each renderer or game keep its own previous transform

Rejected because这会复制 fixed-step accumulator 语义、body cleanup 和 rotation edge cases，并容易让 camera 与 object presentation 采样不同时间点。

### Increase the physics step to the display refresh rate

Rejected because显示刷新率不是稳定 simulation contract，并会按设备刷新率放大 physics、network 和 gameplay system 成本。
