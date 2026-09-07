# ADR 0045: Web Gamepad Input Source And Polling Ownership

Status: Accepted on 2026-07-27.

## Context

Input Core 已经把 `gamepad` 列为 `InputDevice`，但当前公共事件只能表达键盘、指针和滚轮常用值，
`InputSourceAdapter` 也只有 `start/stop/destroy`。标准 Input App Service 每帧只调用
`InputRouter.tick()`，没有推进需要主动采样的 source。

真实 Web 手柄输入依赖 `navigator.getGamepads()` 轮询。连接事件不能提供持续的 button/axis state，
Phaser 当前 Driver input source 也只桥接 keyboard、pointer 和 wheel。若 Outpost 直接在
`main.tsx`、React UI 或 gameplay module 中轮询，会产生第二套 held、dead zone、断连清理和 focus
gate，绕过 Input Scope、App Host lifecycle 与测试替身。

这个缺口同时触及 Input Core 公共协议、Web adapter 所有权和 App Host tick 顺序，因此不能作为
Outpost 局部实现落地。

## Decision

### Input Core 只增加后端无关的采样协议

`InputSourceAdapter` 增加可选的 `poll(frame: InputFrame): void`。事件型 source 可以继续只实现现有
lifecycle；Web Gamepad、未来原生控制器或其他主动采样 source 使用同一个可选入口。

`NormalizedInputEvent` 增加：

- `deviceId?: string`：一次连接生命周期内稳定、跨设备互不冲突的 source identity。
- `value?: number`：归一化 scalar control value；Gamepad 标准 control 使用 `[0, 1]`。

Input Core 不引入 DOM `Gamepad`、Phaser pad、Tauri plugin 或厂商 controller 类型。标准 button、
trigger 和 axis direction 通过 GameKits-owned control code constants 表达；axis 被拆成 positive /
negative 两个方向 control，Action 继续消费单一非负 scalar value，不要求 gameplay 解析原始数组
索引。

模拟量的路由语义为：

- control 从 neutral 越过 dead zone 时产生 `pressed`；
- active control 的有效值变化产生 `moved`，Router 用它刷新 active action 的最新 value；
- Router 在随后的标准 tick 中以最新 value 产生 `held`；
- control 回到 neutral、设备断开、scope/focus 失效或 source 停止时产生 `released` 或
  `cancelled`，并清除 held state。

因此 source 不按浏览器刷新率自行制造重复 `held`，Input Router 仍是 Action held cadence 的唯一
所有者。现有 digital binding 行为保持不变。

### App Host 拥有轮询时序

标准 Input App Service 的每帧顺序调整为：

```txt
source.poll(frame), in registration order
  -> router.handle(normalized changes)
  -> router.tick(frame)
  -> held actions with latest values
```

Source 不能创建自己的永久 `requestAnimationFrame` 或 timer。`poll()` 只在 source 已 start 时工作；
`stop()`、`destroy()` 与设备断连必须取消所有 active control。这样 headless test 可以显式传入 frame
和 snapshot provider，App Host stop 后也不会残留隐式循环。

### Web Gamepad 归属 `@gamekits/input-dom`

`@gamekits/input-dom` 增加独立的 `createWebGamepadInputAdapter()`：

- concrete adapter 独占 `navigator.getGamepads()` 与浏览器 `Gamepad` snapshot；
- provider、clock 和 scope resolver 可注入，测试不依赖真实浏览器设备；
- 默认只接受 W3C `standard` mapping；非标准 mapping 被忽略并产生有界、去重 diagnostic；
- dead zone、button press threshold、change epsilon 和最大设备数由上层显式配置，并具有有界默认值；
- 每个连接只保留固定大小的上一帧 control state，未变化的 control 不分配、不派发；
- `Gamepad` native object 不写入 `originalEvent`、trace、Save 或 gameplay state。

`@gamekits/driver-phaser` 不重复轮询 Web Gamepad，也不成为 Web controller identity 的事实源。
Phaser Web app 由 App Host 同时组合 Phaser pointer source、DOM keyboard source 和 Web Gamepad
source。未来某个 Driver 或平台 SDK 真正拥有原生控制器 runtime 时，它可以实现同一个
`InputSourceAdapter.poll()`，但必须产生相同的 Core 语义。

### Scope 切换采用 neutral re-arm

Gamepad 没有 DOM event target，scope 由 app shell 注入的 resolver 在 poll 时读取。scope、modal、
text input、DevTools 或 input block 状态变化时，adapter 先 `cancelled` 旧 scope 的 active control，
并要求物理 control 回到 neutral 后才能在新 scope 再次 `pressed`。这避免按住 trigger 打开/关闭
面板后 gameplay 自动恢复射击。

### 首个能力边界

首个实现包括：

- W3C standard mapping 的 buttons、triggers、D-pad、left/right sticks；
- 多设备隔离、连接 index 复用防护、disconnect/cancel、scope neutral re-arm；
- scalar action value、dead zone、change epsilon 和稳定 held；
- Input Core、Web adapter、App Host lifecycle/conformance 与 Outpost browser 集成测试。

首个实现不包括 controller remapping UI、震动、陀螺仪、厂商非标准 mapping 数据库、Steam Input、
本地多人 player-slot assignment 或 Tauri native controller plugin。这些能力需要真实消费者和独立
协议证据，不能提前塞进 Input Core。

## Consequences

Positive consequences:

- Outpost 和后续 Web 游戏共用同一套 Gamepad edge、held、dead zone、scope 与 cleanup 语义。
- Web API 留在 concrete adapter，Input Core、gameplay 和 Driver 公共协议不泄漏浏览器类型。
- Polling 服从 App Host 的统一 lifecycle/clock，deterministic test 不需要真实 RAF 或手柄。
- Phaser 不再与 Web adapter 争夺同一设备，键鼠与手柄仍通过同一个 Input Router 路由。

Costs and constraints:

- `InputSourceAdapter`、`NormalizedInputEvent` 和 Router active-state 语义发生公共 alpha API 扩展，
  必须补 Core conformance 并迁移 App Host 测试。
- Directional axis codes 适合当前 scalar Action contract，但不会替代未来经过真实需求验证的 vector
  action processor。
- Outpost 仍需在 app player-control 层把成对 scalar Action 合成为 move/aim vector；这个转换不是
  Web adapter 职责。
- Controller prompt、按键重映射、震动和本地多人设备分配不会随本 ADR 自动获得。

## Rejected Alternatives

### 在 Outpost 里直接轮询 `navigator.getGamepads()`

Rejected because 这会让 app 重写 lifecycle、held、dead zone、focus cancellation 和设备 identity，
并使其他游戏无法复用。

### 只在 Phaser Driver 增加 Gamepad

Rejected because Web Gamepad 是浏览器输入能力，不依赖 Phaser renderer/runtime。它会让 Three、
DOM-only 和其他 Web app 被迫依赖 Phaser，同时与独立 Web adapter 形成重复设备所有权。

### Adapter 自己启动 RAF

Rejected because hidden polling loop 不服从 App Host stop/tick、难以 deterministic test，也可能在
多个 app/profile 中重复采样同一设备。

### 每帧派发全部 axes/buttons

Rejected because未变化的 controller state 会制造稳定分配和 action/trace 噪音。Adapter 只派发
边沿和有效值变化，Router 统一产出 held。

## Documentation

稳定结论同步维护在：

- `docs/architecture.md` 的 Input/App Host/Driver 组合边界；
- `docs/modules/input.md` 的长期协议、Gamepad normalization 与最佳实践；
- `docs/best-practices.md` 的 polling source lifecycle 与性能门禁。

实施拆分和验收记录见
`docs/implementation/web-gamepad-input-source.md`。
