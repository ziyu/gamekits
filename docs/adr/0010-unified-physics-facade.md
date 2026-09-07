# ADR 0010：引入统一 Physics Facade 与多后端 Adapter

## Status

Accepted

## Context

GameKits 已经把 World、Renderer、Input、Camera、TCA、GAS、Save 和 Driver 拆成稳定 facade 与可替换 adapter。实时游戏还会反复需要碰撞检测、刚体运动、触发器、空间查询、投射物命中、地形边界和调试绘制。

在现有应用设计中，Abyss Delve 先把 hit detection、projectile collision 和 room bounds 作为 app-local World component + 数学查询处理。这能保持短期边界清晰，但随着多个游戏、Editor 和 DevTools 都需要相同能力，继续把物理留在 app-local 层会产生重复实现：

- 每个游戏都要重新实现 body/collider id、spatial query、contact enter/exit、debug snapshot 和 save/restore。
- 玩法代码容易直接依赖 Phaser Physics、Rapier、Matter.js 或 renderer hit-test。
- Renderer、Input、Camera 与 physics 坐标转换可能重复且不一致。
- DevTools 很难统一解释“哪个碰撞体触发了哪个 gameplay event”。
- Save 很难知道哪些 physics 状态可恢复，哪些只是 backend cache。

外部物理库也分两类：

- Rapier、Matter.js、Box2D 等更像单一能力库，可以作为 Physics backend adapter。
- Phaser Arcade / Matter Physics 绑定在 Phaser Scene runtime 中，生命周期应由 Phaser Driver 统一持有。

因此需要一个统一 Physics package 规划，但不能把 GameKits 变成自研物理引擎或把某个 backend API 暴露成公共协议。

参考：

- Rapier JavaScript 文档说明其 NPM 包分为 2D / 3D，并且 WASM 需要异步加载：<https://rapier.rs/docs/user_guides/javascript/getting_started_js/>
- Matter.js 官方文档定位为 Web 2D physics engine：<https://brm.io/matter-js/docs/>
- Phaser 官方文档说明 Phaser 内置 Arcade Physics 与 Matter JS，且两套系统绑定在 Phaser 配置 / Scene 使用方式中：<https://docs.phaser.io/phaser/concepts/physics>

## Decision

引入统一 Physics facade 与多后端 adapter。

长期 package：

- `@gamekits/physics-core`：定义 PhysicsBody、PhysicsCollider、PhysicsMaterial、PhysicsScene、PhysicsBackendAdapter、query、contact event、trace、DataType、Save contributor、GameModule helper 和 conformance helper。
- `@gamekits/physics-rapier2d`：把 Rapier 2D 映射到 Physics backend adapter。
- `@gamekits/physics-rapier3d`：把 Rapier 3D 映射到 Physics backend adapter。
- `@gamekits/physics-matter`：把 Matter.js 映射到 2D Physics backend adapter。
- `@gamekits/driver-phaser`：当使用 Phaser Arcade / Matter Physics 时，由 Phaser Driver 持有 Phaser runtime，并暴露绑定 Phaser Scene 的 Physics backend adapter。

Physics Core 的 `PhysicsRotation` 使用 backend-neutral envelope：2D 可使用 number 作为平面角度，3D 可使用 Euler vector 或 `{ x, y, z, w }` quaternion。Quaternion 是稳定数据结构，不是 Rapier 类型泄漏。

Physics Core 是 GameModule toolkit + facade，不是 App Host 默认标准服务。标准启动方式是：

```txt
App Host / profile
→ 提供 backend factory、driver physics adapter、DataRegistry、SaveManager、DevToolsRuntime
→ GameRuntime 安装 createPhysicsModule(...)
→ PhysicsModule 在 tick 中同步 World 与 PhysicsScene
```

Physics module 承担 session lifecycle：

- 创建和销毁 PhysicsScene。
- 从 World/Data 物化 body/collider。
- 在固定 timestep 中推进 backend step。
- 将 transform / velocity / contact summary 写回 World。
- 发低频 contact enter/exit EventBus fact。
- 注册 Save contributor 和 DevTools data source。

Physics Core 不承担 gameplay 语义：

- 不定义 damage、team/faction、hit/hurt rule、projectile owner、pierce 或 ability activation。
- 不接管 Renderer、Input、Camera 或 GAS/TCA。
- 不保存 backend native handle、broadphase cache、manifold 或 solver private state。

Backend ownership 规则：

- 独立物理库进入 `physics-*` adapter 包，第三方类型不能进入 `physics-core` 公共 API。
- 如果 physics backend 是完整外部 runtime 的一部分，例如 Phaser Scene 内的 Arcade / Matter Physics，则由对应 Driver 持有外部 runtime，再暴露 Physics adapter。
- Driver 只拥有外部 runtime，不读写 gameplay state；Physics module 仍通过 GameRuntime lifecycle 运行。

Physics Core 可以提供 `PhysicsHandle` / `PhysicsQueries` 作为依赖注入入口：

- 组合层为每个 live PhysicsScene 创建一个具名 handle，并把同一个 handle 传给 `createPhysicsModule(...)` 和需要查询的 gameplay module。
- `createPhysicsModule(...)` 是唯一绑定 live scene 的 owner；它在 install 时把 handle 绑定到自己创建的 scene，在 dispose 时解绑。
- Handle 只暴露 query、cast、overlap、check 和 snapshot 等窄接口，不 boot backend、不创建 fallback scene，也不持有 native handle。
- App Host/profile 可以持有 handle、backend factory、layer registry 和 DataRegistry 用于组合 GameModule，但不直接拥有 gameplay PhysicsScene。
- 业务模块通过 DI 接收 `PhysicsQueries`，测试中可以注入 fake queries；可复用 gameplay module 不直接依赖 Rapier、Matter、Phaser Physics 或具体 adapter。

## Consequences

收益：

- 多个游戏可以复用 body/collider/query/contact/save/devtools 边界。
- Gameplay 不直接绑定 Rapier、Matter、Phaser Physics 或 renderer hit-test。
- World 继续作为 runtime state 的稳定集成面，Physics backend 只负责模拟和空间查询。
- Targeting、AI、Combat 和 placement 等 gameplay module 可以通过窄 query facade 使用同一个 module-owned scene，而不复制 scene 或依赖 backend。
- Phaser 内置 physics 与 Phaser renderer/input/camera/asset 共享同一 Driver ownership，不会重复创建 Scene runtime。
- DevTools 可以统一观察 physics scene、contacts、queries 和 performance。
- Save 可以明确保存稳定 physics state，排除 backend cache。

代价：

- 需要新增 `physics-core` 和至少一个 backend adapter 的 conformance test。
- 需要设计 World sync 顺序，避免 movement、physics、renderer sync 互相争写 transform。
- Backend 能力不完全一致，core 只能定义最小稳定协议，复杂 joint、character controller 或 backend-specific query 要走 optional capability 或 native path。
- Fixed timestep 与 determinism 需要明确声明，不能把所有 backend 默认当作 rollback-safe。
- Phaser physics adapter 需要遵守 Driver ownership，不能为了 physics 单独创建 Phaser.Game 或 Scene。

## Boundaries

- `@gamekits/physics-core` 可以依赖 `@gamekits/world`、`@gamekits/game-runtime`、`@gamekits/event-bus` 和 `@gamekits/data`，但不能依赖 Rapier、Matter、Phaser、Three、Koota、React 或 Tauri。
- `@gamekits/physics-rapier2d` / `@gamekits/physics-rapier3d` / `@gamekits/physics-matter` 可以依赖对应第三方库，并导出显式 native path 给 app-specific integration、Editor backend panel 或 DevTools plugin。
- 可复用 gameplay module、DataType、Save payload、TCA/GAS rule 和 renderer-core 不依赖 backend native type。
- Contact enter/exit 可以是低频 EventBus fact；每帧 manifold、position patch 和 query result 不进入 EventBus。
- Renderer 只表现 physics 结果或 debug draw，不决定 gameplay collision。
- Input / Camera 只提供操作意图和坐标转换，不直接修改 backend body，除非通过明确 gameplay system 或 Physics module command。

## Relationship To Existing ADRs

ADR 0005 继续约束 App Service 与 Game Module 边界：Physics scene 需要 world/tick/gameplay context，因此属于 GameModule lifecycle。

ADR 0007 继续约束 Driver ownership：Phaser 这类跨 renderer/input/camera/asset/physics 的 runtime 由 Driver 持有，Physics adapter 只能绑定到 Driver 提供的 runtime slice。

ADR 0009 继续约束 Renderer native path：Physics debug draw 或 backend-specific visualization 可以通过 Renderer/Driver native path 实现，但不能把物理后端 API 推进 renderer-core。
