# Physics 3D Lab 设计

## 定位

Physics 3D Lab 是 `@gamekits/physics-core` 与 `@gamekits/physics-rapier3d` 的独立能力实验台。它使用 Three Driver 只做 3D 可视化和相机承载，重点验证 3D 物理 scene、body/collider、shape、quaternion rotation、query、contact event、debug snapshot 和 native path 能通过 GameKits Physics facade 被稳定消费。

Physics 3D Lab 不是 Three Demo 的子模式，也不是长期玩法仓库。Three Demo 继续验证 Three Driver / Renderer / Asset / Camera 组合；Physics 3D Lab 验证 Physics package 与 3D renderer 的协作。

## 非目标

- 不做完整 3D 游戏、不引入复杂关卡、AI、装备或经济系统。
- 不把 Three.js 或 Rapier 类型泄漏到 `physics-core`、gameplay Data、Save payload 或可复用 GameModule。
- 不把 Three Driver 重新包装成 physics API；Three 只展示 PhysicsScene 的结果。
- 不验证 2D backend、Matter.js 或 Phaser Physics；Rapier 2D 属于 Physics 2D Lab，Phaser Physics 属于 Phaser Driver 相关验证面。

## 场景结构

主场景采用一个可重复的 3D 物理实验台：`Stack & Sensor Lab`。

核心对象：

- `Floor`：静态地面和边界，使用 box collider。
- `Drop Blocks`：一组动态 box / sphere / capsule，从固定高度掉落并堆叠。
- `Spinner`：kinematic body，使用 quaternion rotation 或 Euler vector 驱动，推动动态物体。
- `Trigger Volume`：透明 sensor box，检测进入/离开并产生 trigger events。
- `Query Probe`：可移动 overlap/point query 探针，显示当前命中的 collider。
- `Debug Ghosts`：从 Physics snapshot / query result 映射出的线框、颜色、标签和 contact pulse。

## 交互方式

交互只服务物理能力验证：

- 切换 shape：box、sphere、capsule。
- 切换 spawn preset：single drop、stack、rain、mixed。
- 切换 query mode：point、overlap box、overlap sphere。
- 暂停、单步、重置 seed。
- 切换 camera preset：overview、side、probe follow、free camera。
- Free camera 在 viewport 内支持左键拖拽绕实验台旋转、右键或 Shift+左键平移、滚轮缩放，用于从任意角度检查 collider、sensor 和 query probe。
- 打开 native diagnostics，用于显示 backend kind、dimension、body/collider count、active contacts 和 query hit count。

输入仍通过 App Host / Input scope 或 app-local UI command bridge 进入，不直接在 renderer click handler 中修改 PhysicsScene。

## 模块协作

Physics 3D Lab 的 app shell 负责组合：

- App Host service lifecycle。
- Three Driver / RendererAdapter / camera adapter。
- DataRegistry 注册 physics scene、body、collider 和 material definitions。
- GameRuntime 安装 `createPhysicsModule(...)`。
- `@gamekits/physics-rapier3d` 提供 backend factory。
- UI 只消费 snapshot、diagnostics、query result 和低频 command。

World component 只保存稳定 physics id、transform、velocity、scene role、presentation state 和 query probe state。Rapier native body/collider、query pipeline、broadphase cache 和 solver state 留在 adapter 内。

## 表现要求

3D 可视化必须让物理状态可读：

- body transform 同步到 Three object transform。
- collider shape 使用线框或半透明 mesh 表达。
- sensor volume 使用独立颜色，不与 solid collider 混淆。
- contact enter/exit 用短暂 pulse 或 label 表达。
- query hit 使用高亮 outline 和列表表达。
- quaternion rotation 通过 Spinner 或倾斜落体清楚展示。

## 测试要求

Physics 3D Lab 应优先建立 headless 测试，再补浏览器 smoke：

- fixed seed 创建 runtime。
- Rapier 3D backend 初始化后安装 Physics module。
- 动态 body 掉落、碰撞、进入 trigger volume。
- overlap query 命中预期 collider。
- quaternion rotation state 能通过 snapshot 观察。
- dispose 后 backend scene 与 app-local maps 清理。

浏览器 smoke 只验证 first paint、Three canvas 非空、3D object 可见、UI command 能改变 physics state、无 console error。

## 设计约束

- Physics 3D Lab 可以显式依赖 `@gamekits/driver-three`、`three` 和 `@gamekits/physics-rapier3d`，但这些依赖不得进入可复用 gameplay package 或 `physics-core`。
- Three Driver 继续是唯一创建和持有 renderer / scene / camera 的边界。
- Physics scene 跟随 GameRuntime lifecycle，不成为 App Host standard service。
- Data 和 snapshot 使用 GameKits 稳定类型；native path 只出现在 app-specific diagnostics 和 debug rendering 中。
