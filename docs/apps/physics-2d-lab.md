# Physics 2D Lab 设计

## 定位

Physics 2D Lab 是 `@gamekits/physics-core` 与 `@gamekits/physics-rapier2d` 的独立能力实验台。它用一个小型 2D 场景验证 body、collider、material、sensor、contact event、point/overlap query、collision group、trace、snapshot 和 native diagnostics 能通过 GameKits Physics facade 稳定消费。

Physics 2D Lab 不挂在 Sandbox / Tiny Camp 内，也不作为 Abyss Delve 的玩法切片。它的目标是让 Physics package 的 2D 能力先独立跑通，再决定是否进入 Sandbox、Abyss Delve 或 Phaser Driver。

## 非目标

- 不做完整 2D 游戏、不引入资源生产、怪物波次、装备、掉落或长期进度。
- 不把 hitbox、hurtbox、team/faction、damage channel、projectile owner 等玩法语义写进 `physics-core`。
- 不直接依赖 Phaser Physics、Matter.js 或 renderer hit-test。
- 不验证 Rapier 3D；3D 物理属于 Physics 3D Lab。

## 场景结构

主场景采用一个可重复的 2D 物理实验台：`Collider & Query Arena`。

核心对象：

- `Arena Bounds`：静态 box / polyline 边界。
- `Mover`：dynamic circle / capsule body，验证 velocity、damping、contact 和 transform writeback。
- `Kinematic Paddle`：kinematic box body，验证 patch position / rotation 和动态体交互。
- `Trigger Zone`：sensor collider，检测 enter/exit 并产出 trigger events。
- `Obstacle Set`：static box / polygon colliders，验证 collision groups 和 queries。
- `Query Cursor`：point / overlap query 探针，显示当前命中的 collider。

## 交互方式

交互只服务 2D physics 能力验证：

- 切换 shape：circle、box、capsule、polygon/polyline。
- 切换 collision group preset：all、actor-only、sensor-only。
- 切换 query mode：point、overlap circle、overlap box。
- 暂停、单步、重置 seed。
- 施加 impulse/velocity patch，验证 body update path。
- 打开 diagnostics，显示 body/collider count、active contacts、last query 和 backend native summary。

输入通过 app-local UI command bridge 或 Input scope 进入，不直接在 renderer hit-test 中修改 PhysicsScene。

## 模块协作

Physics 2D Lab 的 app shell 负责组合：

- App Host service lifecycle。
- Renderer / Input / UI 的最小可视化和命令入口。
- DataRegistry 注册 physics scene、body、collider 和 material definitions。
- GameRuntime 安装 `createPhysicsModule(...)`。
- `@gamekits/physics-rapier2d` 提供 backend factory。
- UI 只消费 snapshot、trace、query result、contact fact 和低频 command。

World component 只保存稳定 physics id、transform、velocity、scene role、presentation state 和 query cursor state。Rapier native body/collider、broadphase cache、solver state 和 contact manifold 留在 adapter 内。

## 表现要求

2D 可视化必须让物理状态可读：

- body transform 同步到 2D render object。
- collider shape 使用线框或半透明 fill 表达。
- sensor zone 使用独立颜色，不与 solid collider 混淆。
- contact enter/exit 用短暂 pulse、label 或 timeline row 表达。
- query hit 高亮对象并展示 collider/body id。
- collision group preset 的过滤结果在 query 和 contact 中可观察。

## 测试要求

Physics 2D Lab 应优先建立 headless 测试，再补浏览器 smoke：

- fixed seed 创建 runtime。
- Rapier 2D backend 初始化后安装 Physics module。
- dynamic body 运动并与 static/kinematic collider 交互。
- sensor enter/exit 事件进入 EventBus。
- point/overlap query 命中预期 collider。
- collision group map 过滤符合预期。
- dispose 后 backend scene 与 app-local maps 清理。

浏览器 smoke 只验证 first paint、2D stage 可见、UI command 能改变 physics state、query/trigger diagnostics 可见、无 console error。

## 设计约束

- Physics 2D Lab 可以显式依赖 `@gamekits/physics-rapier2d` 和具体 renderer adapter，但这些依赖不得进入可复用 gameplay package 或 `physics-core`。
- Physics scene 跟随 GameRuntime lifecycle，不成为 App Host standard service。
- Data 和 snapshot 使用 GameKits 稳定类型；native path 只出现在 app-specific diagnostics 和 debug rendering 中。
- 该实验台跑通后，Sandbox / Abyss Delve 再按各自长期设计决定是否复用其中的装配方式。
