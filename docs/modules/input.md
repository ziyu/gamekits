# Input 模块设计

## 定位

Input 是独立系统，不属于 Renderer。它负责把物理输入归一化、映射为语义动作，再路由为 command 或 UI action。

相关包：

- `@gamekits/input-core`
- `@gamekits/input-dom`
- `@gamekits/input-tauri`
- `@gamekits/driver-phaser`
- `@gamekits/driver-three`

## 为什么独立

Input 不能归 Phaser 独占，也不能散落在 React 组件中：

- 输入来源包括 Web、Tauri、Phaser Driver、Three Driver、移动端。
- 输入来源包括键盘、鼠标、触摸、手柄、UI、编辑器工具、快捷键。
- Gameplay 不应该知道 DOM event、Phaser input event 或 Tauri shortcut。
- UI focus、modal、text input、devtools 都会改变输入上下文。

## 分层

```txt
Raw Input
→ Normalized Input Event
→ Input Scope
→ Input Binding / Mapping
→ Input Action
→ Command / UI Action / Camera Action
```

## NormalizedInputEvent

```ts
export type InputDevice = "keyboard" | "mouse" | "touch" | "gamepad" | "pen" | "virtual" | "system";

export type InputPhase = "pressed" | "released" | "held" | "moved" | "scrolled" | "cancelled";

export type NormalizedInputEvent = {
  id: string;
  device: InputDevice;
  deviceId?: string;
  phase: InputPhase;
  code?: string;
  button?: string;
  value?: number;
  pointerId?: string;
  x?: number;
  y?: number;
  dx?: number;
  dy?: number;
  wheelDelta?: number;
  modifiers?: {
    shift?: boolean;
    ctrl?: boolean;
    alt?: boolean;
    meta?: boolean;
  };
  scope?: InputScopeId;
  timestamp: number;
  source?: string;
  originalEvent?: unknown;
};
```

`deviceId` 标识一次设备连接生命周期。它不等于永久玩家身份，也不能进入 Save；浏览器复用同一个 gamepad index 时必须产生新的 identity，避免旧设备的 release/cancel 清除新设备状态。

`value` 是有限 scalar control value。Gamepad standard control 使用 `[0, 1]`；其他 adapter 可以定义自己的有限 scalar 范围。Axis 在 Web adapter 中拆成 positive/negative 两个稳定 control code，使当前 Action contract 不需要读取原始 axis 数组或底层索引。

## Input Scope

Input scope 描述一个输入事件当前属于哪个交互区域或焦点域。它不是 UI 组件状态本身，而是 input-core 可以理解的稳定路由标签。

常见 scope：

- `global`：应用级快捷键。
- `game`：游戏 viewport、game canvas 或真实 gameplay 操作区域。
- `ui`：普通 UI 面板、HUD、窗口区域。
- `editor`：编辑器工具区域。
- `text-input`：文本输入焦点。
- `devtools`：调试工具区域。

scope 可以由 adapter 或 app shell 根据底层事件、焦点、active window、pointer capture、platform shortcut 状态解析。真实应用可以同时安装多个 source adapter，例如 window keyboard adapter 和 viewport pointer adapter；adapter 应允许在归一化前过滤底层事件，避免同一个 pointer / wheel event 被 window 与 viewport 两条输入源重复派发。

示例：

```ts
export type InputScopeId = string;

export type NormalizedInputEvent = {
  scope?: InputScopeId;
};
```

scope 是可选字段。没有声明 scope 约束的 action/context 可以继续接收未标记事件；声明了 scope 的 action/context 只能接收匹配 scope 的事件。

## Input Action

Input action 是语义层，不是物理按键。

```ts
export type InputActionDefinition = {
  id: string;
  name: string;
  category?: string;
  scopes?: InputScopeId[];
  defaultBindings: InputBinding[];
};

export type InputBinding = {
  device: InputDevice;
  code?: string;
  button?: string;
  modifiers?: string[];
  phase?: InputPhase;
};
```

示例 action：

- `camera.pan_up`
- `camera.zoom_in`
- `scene.click`
- `game.confirm`
- `tool.place_road`
- `ui.close_window`

Action 可以声明 `scopes`，用于限制“这个语义动作只能在哪些输入域里成立”。例如 `camera.pan_left` 通常只应该在 `game` scope 中成立，而 `debug.toggle_panel` 可以不限制或使用 `global` scope。

Action 级 scope 是防漏边界：即使某个高层 context 没有声明 scope，带 scope 限制的 action 也不会在错误输入域被触发。

## Input Context

同一个按键在不同上下文含义不同。

常见 context：

- global
- gameplay
- camera
- ui
- editor
- debug
- modal
- text-input

优先级示例：

```txt
modal > text-input > ui > editor > gameplay > camera > global
```

打开 modal 或文本输入框时，gameplay 输入应被阻断。

Context 可以声明 `scopes`，用于限制“这个上下文只参与哪些输入域的匹配”：

```ts
export type InputContext = {
  id: string;
  priority: number;
  actionIds?: string[];
  scopes?: InputScopeId[];
  capture?: boolean;
};
```

推荐组合：

- gameplay / camera context 通常绑定 `game` scope。
- modal / text-input context 通常绑定 `ui` 或 `text-input` scope，并以更高 priority 捕获输入。
- debug/global context 可以不绑定 scope，或明确绑定 `global`，由 app 决定。
- 同时使用 action scope 和 context scope，防止 action 从默认 global context 泄漏。

## Input Router

```txt
DOM / Driver / Touch / Gamepad Event
→ NormalizedInputEvent
→ InputManager
→ Scope Filter
→ Active InputContexts
→ InputAction
→ CommandBus / EventBus / CameraController / UI Runtime
```

输入最终不直接改 world，而是生成 command 或 action。

`held` 不应依赖浏览器或操作系统的 key repeat 节奏。Source adapter 负责发出 `pressed` / `released` / `cancelled` 等物理边沿；模拟量 source 还可以在有效值变化时发出 `moved`。Input Router 用 `moved` 更新对应 active action 的最新 input/value，但不把 raw change 当成重复 held；它在 Input service 的 frame tick 中以稳定帧节奏产出 `held` action。

Polling source 使用可选 lifecycle：

```ts
export type InputSourceAdapter = {
  start(): void;
  stop(): void;
  poll?(frame: InputFrame): void;
  destroy(): void;
};
```

标准 App Host Input service 的 frame 顺序固定为 `source.poll(frame) → router.handle(changes) → router.tick(frame)`。Source 不创建私有 RAF/timer；事件型 source 不实现 `poll`。应用入口不直接调用 Router held 刷新细节。这样 keyboard repeat、Web Gamepad polling 和未来 native controller source 都服从同一 clock、stop/dispose 与 deterministic test 边界。

## Web Gamepad Adapter

`@gamekits/input-dom` 的 `createWebGamepadInputAdapter()` 持有 `navigator.getGamepads()`，默认支持 W3C standard mapping、最多四个设备以及固定大小的上一帧 control state。

- Button、trigger、D-pad 与双摇杆通过 `STANDARD_GAMEPAD_CONTROL` 暴露稳定 code；gameplay 不读取 `buttons[]` / `axes[]` 索引。
- Stick 使用 radial dead zone，button/trigger 使用 press threshold；只有边沿或超过 change epsilon 的值变化才派发 normalized event。角色移动曲线、aim sensitivity、Y 轴反向和辅助瞄准仍归 app policy。
- 连接 generation 进入 `deviceId`；相同 index 被复用时先取消旧 generation。
- disconnect、stop、destroy 和 scope 变化取消 active control。Scope 变化后必须等待物理 control 回到 neutral，再允许它在新 scope 重新 pressed。
- Native `Gamepad` object 不进入 `originalEvent`、trace、Save 或 gameplay state。Provider、clock 与 scope resolver 可注入，测试不依赖真实硬件。
- 非 standard mapping 默认忽略并产生去重、有界 diagnostic；厂商 mapping database、震动、陀螺仪、Steam Input 和本地多人设备分配不属于首层 Core 协议。

Phaser Web app 仍由 Phaser Driver 提供 pointer/runtime input source，同时在 App Host profile 中组合 DOM keyboard 与 Web Gamepad adapter。Phaser Driver 不重复轮询同一个 Web Gamepad API。

## 与 TCA 的关系

推荐流程：

```txt
Input Action
→ Command
→ System 校验和修改状态
→ emit gameplay event
→ TCA 响应 gameplay event
```

Input 不直接执行复杂 TCA 逻辑。

## 与 Renderer 的关系

- Renderer 可提供 view、坐标转换或 picking/hit-test capability。
- Input adapter 可以消费 renderer capability。
- Renderer 不拥有 gameplay input event。

## 与 UI 的关系

UI focus、active window、active tool 可以由 UI 状态管理，但物理输入到语义 action 的映射归 input-core。

UI 不直接改 gameplay 状态。UI 应输出焦点/scope 信号，Input adapter 或 app shell 将其转成 `NormalizedInputEvent.scope`，再由 input-core 按 action/context 规则路由。

## 最佳实践

### 模块集成

- DOM 来源在 window blur、document 隐藏、target focusin 和 stop 时取消其已按下输入；keyup 即使落在过滤范围之外也必须完成原按键的取消。App Host 停止或释放 Input 服务时调用 `router.cancelAll()`。
- 同一物理输入只装配一个来源；例如 DOM 负责键盘，Phaser Driver 负责 viewport 指针，避免双重动作和坐标系混用。UI focus 切到文本框/DevTools 时取消 held，新的键盘事件按实际交互域路由。

- Source adapter 只负责把 DOM、Driver、Touch、Gamepad、Tauri menu 等 raw input 归一化，不直接改 World、Camera、Renderer 或 UI state。
- Input service 集成应由 App Host/app shell 统一推进 source polling、held tick、scope gate、source cleanup 和 EventBus bridge，业务代码不直接调用 router 内部刷新细节。
- Polling source 只能实现 `poll(frame)`，不能自己创建 RAF/timer。App Host 必须先 poll 所有 source，再推进 Router held tick，并在 stop/dispose 时清理 source。
- Web Gamepad 由浏览器 adapter 持有；选择 Phaser/Three Driver 的 app 在组合层安装它，不在 Driver 和 Web adapter 中重复读取同一设备。
- UI focus、modal、text input、game viewport 和 DevTools 应由 app shell 或 UI bridge 转成 scope/context 状态，再交给 input-core 路由。

### 模块使用

- Gameplay、Camera、Editor、DevTools、Modal、TextInput 都应通过 scope/context 隔离。默认不要让 `global` action 穿透到 gameplay。
- `held` action 应由 Input service 在稳定 tick 中产出，不依赖浏览器 key repeat。持续移动、拖拽和蓄力都不要用 repeated keydown 当主时钟。
- 持续 Action 必须绑定 `cancelled`，不能只处理 `released`。断连、scope/focus 切换和 source stop 都可能没有物理 release。
- 多个 physical control 可以映射到同一个 Action；业务控制状态按 `deviceId + control identity` 聚合，不能因为其中一个设备 release 就清除另一个仍 active 的输入。
- 点击场景也应走 input action，例如 `scene.click`，命中 entity 只是 action payload 或后续 hit-test 结果，不应绕过 Input 模块直接调用 gameplay。
- UI focus 变化、modal 打开、文本输入聚焦必须能切换或提升 input context，阻断 game viewport scope 下的 gameplay/camera action。
- Input action 是语义层，不是业务规则层。复杂校验应进入 system、TCA 或 game module，而不是写在 adapter 里。
- 测试应覆盖 binding resolution、scope/context priority、pressed/released/held/moved/cancelled、模拟量最新 value、跨设备 identity、dead zone/epsilon、neutral re-arm、poll-before-held 顺序、重复按键、source adapter cleanup 和 EventBus bridge。
