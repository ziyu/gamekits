# Unified Physics Package

Status: Active

## Goal

规划并落地 GameKits 的统一 Physics package，使多个游戏可以复用刚体、碰撞体、空间查询、低频接触事件、Save contributor、DevTools snapshot 和 backend adapter，同时保持薄内核和 Driver / Adapter 边界。

长期设计入口：

- `docs/modules/physics.md`
- `docs/adr/0010-unified-physics-facade.md`
- `docs/architecture.md`

## Scope

包含：

- `@gamekits/physics-core` facade、类型、标准 GameModule helper、DataType、Save contributor 和 conformance helper。
- 至少一个独立 backend adapter，优先候选为 `@gamekits/physics-rapier2d`；Rapier 3D 通过独立的 `@gamekits/physics-rapier3d` 接入。
- 可选 2D backend adapter，例如 `@gamekits/physics-matter`。
- Phaser Driver 暴露绑定 Phaser Scene 的 physics backend adapter 的边界设计。
- World sync、fixed timestep、contact EventBus bridge、DevTools data source 和 Save restore 流程。
- Headless 测试夹具和 backend conformance tests。

不包含：

- 自研物理 solver。
- Pathfinding、navmesh、steering 或 AI avoidance。
- 游戏专属 damage、team/faction、projectile owner、pierce、hit/hurt rule。
- 网络 rollback / lockstep 的完整确定性协议。
- Renderer debug draw 的完整 UI 面板实现。

## Task Breakdown

| Task                        | Status   | 目标                                                                                       | 验证                                                     |
| --------------------------- | -------- | ------------------------------------------------------------------------------------------ | -------------------------------------------------------- |
| 文档基础                    | Verified | 补齐模块设计、ADR、架构索引和跨模块边界                                                    | `corepack pnpm format`                                   |
| `physics-core` skeleton     | Verified | 新增 package、公共类型、`src/index.ts` re-export、基础 package manifest                    | `corepack pnpm build --filter @gamekits/physics-core`    |
| Physics conformance helper  | Planned  | 在 `test-utils` 或 `physics-core` 测试入口提供 backend 契约测试                            | unit tests                                               |
| Memory / fake backend       | Verified | 提供 headless deterministic fake backend，验证 module lifecycle 与 World sync              | `corepack pnpm --filter @gamekits/physics-core test`     |
| Physics GameModule helper   | Verified | 实现 fixed timestep、World binding、contact bridge、dispose cleanup                        | `corepack pnpm --filter @gamekits/physics-core test`     |
| DataType integration        | Verified | 注册 `physics.material`、`physics.body`、`physics.collider`、`physics.scene`               | `corepack pnpm --filter @gamekits/physics-core test`     |
| Save contributor            | Planned  | 捕获和恢复可恢复 physics state，排除 backend cache                                         | fixed seed save/load tests                               |
| DevTools source             | Planned  | 暴露 scene/body/collider/contact/query/performance summary                                 | devtools snapshot tests                                  |
| Rapier 2D backend           | Verified | 适配 Rapier 2D，处理 WASM async init、native path、contact、query 和 World module 集成     | `corepack pnpm --filter @gamekits/physics-rapier2d test` |
| Rapier 3D backend           | Verified | 通过独立 package 接入 Rapier 3D，保持 3D shape、rotation、query 和 WASM runtime 独立       | `corepack pnpm --filter @gamekits/physics-rapier3d test` |
| Matter backend              | Planned  | 适配 Matter.js 2D 常用 body/collider/query/contact 能力                                    | conformance + adapter tests                              |
| Phaser driver physics slice | Planned  | 从 `driver-phaser` 暴露 Phaser Arcade / Matter Physics adapter，不单独创建 Phaser runtime  | driver integration tests                                 |
| Physics 2D Lab demo         | Verified | 新增 2D 物理能力实验台，跑通 Rapier 2D、2D shape/query/contact、group 和 diagnostics       | headless 2D demo tests + browser smoke                   |
| Physics 3D Lab demo         | Verified | 新增 3D 物理能力实验台，跑通 Rapier 3D、quaternion、3D shape/query/contact 和 Three 可视化 | headless 3D demo tests + browser smoke                   |

## Dogfood Demo Plan

规划两个独立 demo 分别覆盖 2D adapter 链路和 3D adapter 链路。两个 demo 都不能把玩法专属语义写回 `physics-core`；它们只通过 `PhysicsBodyComponent`、`PhysicsColliderComponent`、`PhysicsTransformComponent`、DataType、GameModule helper、EventBus 和 snapshot 消费 Physics package。Sandbox / Abyss Delve 暂不集成 Physics package，等独立 demo 跑通后再决定如何 dogfood。

### Demo A：Physics 2D Lab

归属：新增 `apps/physics-2d-lab`，长期设计见 `docs/apps/physics-2d-lab.md`。

目标：建立独立 2D 物理能力实验台，验证 `@gamekits/physics-rapier2d` 的 2D shape、rotation、query、contact、collision group 和 native diagnostics。

覆盖能力：

- `@gamekits/physics-core`：标准 component、DataType、Physics module、trace store、EventBus contact bridge。
- `@gamekits/physics-rapier2d`：circle、box、capsule、polygon/polyline 中至少三类 shape，2D rotation、group map、sensor、point/overlap query、native diagnostics。
- World sync：body/collider id materialization、transform/velocity 写回、destroy cleanup。
- Renderer / UI integration：2D stage 展示 collider debug shape、query cursor、contact pulse 和 backend diagnostics。
- Snapshot/Timeline：body/collider summary、active contacts、last query、physics trace 与 TCA/GAS/EventBus 串联。

场景最小切片：

- Arena Bounds 是 static box / polyline collider。
- Mover 是 dynamic circle / capsule body，验证 velocity、contact 和 transform writeback。
- Kinematic Paddle 是 kinematic box body，验证 body patch 与动态体交互。
- Trigger Zone 是 sensor collider，进入/离开产生 `physics.trigger.*`。
- Query Cursor 提供 point/overlap query，并高亮命中对象。
- Actor / obstacle / sensor collision group 可配置。
- Headless fixed seed 下，contact 和 query 结果可复现。

验收：

- Headless 2D demo test：boot 后 colliders 存在，tick 后 trigger event 和 trace 存在，query 能命中预期对象，collision group 过滤符合预期。
- Browser smoke 验证第一屏可见、stage 可交互、trigger/query diagnostics 可见、无 console error。
- 运行 `corepack pnpm bench:world` 记录 world sync 没有明显退化。

### Demo B：Physics 3D Lab

归属：新增 `apps/physics-3d-lab`，长期设计见 `docs/apps/physics-3d-lab.md`。

目标：建立独立 3D 物理能力实验台，用 Three Driver 只做可视化，验证 `@gamekits/physics-rapier3d` 的 3D shape、quaternion rotation、query、contact 和 native diagnostics。

覆盖能力：

- `@gamekits/physics-core`：3D scene config、`PhysicsQuaternion` state、standard Physics module、snapshot。
- `@gamekits/physics-rapier3d`：sphere、box depth、capsule、convex polygon/polyline、quaternion/Euler rotation、3D linear/angular velocity、sensor、point/overlap query、native path。
- Renderer sync：Physics transform 同步到 Three mesh，collider debug ghost 与 query probe 可视化。
- App boundary：Three Driver 持有 renderer/scene/camera；Rapier native handle 只出现在 app-specific diagnostics/debug draw。

场景最小切片：

- Floor 是 static box collider。
- Drop Blocks 是 dynamic sphere/box/capsule，可从固定 seed 掉落和堆叠。
- Spinner 是 kinematic body，用 quaternion rotation 展示 3D rotation。
- Trigger Volume 是 sensor box，记录 enter/exit。
- Query Probe 提供 point/overlap query，并高亮命中对象。

验收：

- Headless 3D demo test：fixed seed 下 dynamic body 位移、trigger event、query hit、quaternion rotation snapshot、dispose cleanup 都通过。
- Browser smoke：canvas 非空，物体可见，UI command 能 spawn/reset/toggle query，diagnostics 显示 body/collider/contact/query 计数。
- 3D demo 不修改 Three Demo 的 driver-only 定位，不把 gameplay/world/save 要求塞进 `docs/apps/three-demo.md`。

### Coverage Matrix

| Physics 能力                | Physics 2D Lab     | Physics 3D Lab |
| --------------------------- | ------------------ | -------------- |
| `physics-core` facade       | 必须               | 必须           |
| standard Physics GameModule | 必须               | 必须           |
| DataType materialization    | 必须               | 必须           |
| Rapier 2D backend           | 必须               | 不使用         |
| Rapier 3D backend           | 不使用             | 必须           |
| body / collider lifecycle   | 必须               | 必须           |
| sensor/contact event        | 必须               | 必须           |
| point / overlap query       | 必须               | 必须           |
| collision group map         | 必须               | 应覆盖         |
| quaternion rotation         | 不使用             | 必须           |
| native diagnostics          | 应覆盖             | 必须           |
| trace / timeline            | 必须               | 应覆盖         |
| Save contributor            | package 实现后补齐 | 可选           |
| DevTools source             | package 实现后补齐 | 应覆盖         |

## Design Constraints

- Physics scene 跟随 GameRuntime lifecycle，不作为 App Host 默认 standard service。
- App Host/profile 只提供 backend factory、driver adapter、DataRegistry、SaveManager 和 DevToolsRuntime。
- 独立物理库在 `physics-*` adapter 包内持有；Phaser 内置 physics 由 `driver-phaser` 持有 runtime 并暴露 adapter。
- Gameplay、Data、Save、TCA/GAS 和 Renderer Core 不依赖 backend native type。
- EventBus 只接收 contact enter/exit、trigger enter/exit、sleep/wake 等低频事实。
- Save 不保存 broadphase、manifold、solver cache、native handle 或 query cache。
- Backend-specific 能力通过 optional capability 或 explicit native path 使用，不能撑大 `physics-core`。

## Implementation Order

推荐顺序：

1. 建立 `physics-core` 的类型和 package skeleton。
2. 增加 fake backend 与 conformance helper，先验证协议闭环。
3. 实现 `createPhysicsModule(...)` 的 World sync、fixed timestep 和 EventBus bridge。
4. 接入 DataType、Save contributor、DevTools source。
5. 实现 Rapier 2D backend。
6. 实现 Rapier 3D、Matter backend 或 Phaser driver physics slice。
7. 先用 Physics 2D / 3D Lab 独立 dogfood，跑通 package 能力；再决定是否接入 Sandbox / Abyss Delve。

每个任务都应独立 review、测试和提交。若实现中改变公共 API、package 边界或 backend ownership，需要同步更新 `docs/modules/physics.md`、`docs/architecture.md`，必要时追加新的 ADR。

## Verification Plan

常规验证：

```bash
corepack pnpm test
corepack pnpm build
corepack pnpm lint
corepack pnpm format
```

涉及 World sync、backend 性能或大量 entity/collider 时额外运行：

```bash
corepack pnpm bench:world
```

涉及本地前端 app dogfood 时运行：

```bash
corepack pnpm dev
```

## Verification Log

2026-07-01 Physics Lab demo dogfood：

- `corepack pnpm format`
- `corepack pnpm test`
- `corepack pnpm build`
- `corepack pnpm lint`
- `corepack pnpm bench:world`：`@gamekits/world-koota`，10,000 entities / 5,000 moving，spawn/add 11.25ms，query/update 9.42ms。
- `corepack pnpm test:physics2d`
- `corepack pnpm test:physics3d`
- `corepack pnpm build:physics2d`
- `corepack pnpm build:physics3d`
- `corepack pnpm --filter physics-2d-lab lint`
- `corepack pnpm --filter physics-3d-lab lint`
- Browser smoke：`apps/physics-2d-lab` 第一屏 canvas、backend diagnostics、query snapshot 可见，console 无 error。
- Browser smoke：`apps/physics-3d-lab` Three canvas、backend diagnostics、query snapshot 和 quaternion snapshot 可见，console 无 error。

## Close Criteria

关闭本工作流前必须确认：

- 稳定设计已沉淀到 `docs/modules/physics.md`、`docs/architecture.md` 和必要 ADR。
- `physics-core` 至少有一个通过 conformance 的 backend。
- Physics module 可以在 headless runtime 中完成 fixed timestep、World sync、contact event 和 cleanup。
- Save/load 能重建 physics scene，且不保存 backend cache。
- DevTools 能观察 physics summary、contact trace 和 performance summary。
- Physics 2D / 3D Lab 跑通独立 demo 验证；后续 Sandbox 或 Abyss Delve 可再作为真实应用 dogfood。
