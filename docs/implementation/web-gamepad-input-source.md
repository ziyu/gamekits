# Web Gamepad Input Source

Status: Active. Implementation is complete; physical-controller browser acceptance remains open.

## Goal

补齐 Web/Phaser 应用缺失的真实 Gamepad 输入来源，同时保持 Input Core 设备无关、Web API 留在
concrete adapter、polling 服从 App Host lifecycle。长期决策提案见
[`../adr/0045-web-gamepad-input-source-and-polling.md`](../adr/0045-web-gamepad-input-source-and-polling.md)。

当前 Player Experience Rebuild 在此能力上设置 dependency gate：不在 Outpost 的 React、Phaser
presentation 或 gameplay 中增加临时 `navigator.getGamepads()` 轮询。

## Current Result

2026-07-27 已完成：

- Input Core 增加可选 `InputSourceAdapter.poll(frame)`、finite scalar `value` 和连接期
  `deviceId`；Router 用模拟量 `moved` 刷新后续 held value，并隔离多个设备的同名 control。
- `@gamekits/input-dom` 增加 W3C standard mapping、四设备上限、radial dead zone、button threshold、
  change epsilon、generation identity、断连取消、scope neutral re-arm 与有界 diagnostics。
- App Host Input service 使用 `source.poll → router.tick` 顺序，不创建 adapter-owned RAF/timer。
- Outpost visual profile 组合 Phaser pointer、DOM keyboard 和 Web Gamepad source；左/右摇杆、Trigger、
  face/shoulder buttons 已进入现有 semantic action、managed input 与 reliable player-action 链路。
- Outpost DevTools 增加有界 Gamepad diagnostic source；gameplay 不读取 native `Gamepad` object。

自动验证覆盖 standard control、dead zone、epsilon、analog change、index reuse、双设备隔离、断连、
scope/provider failure neutral re-arm、stop/destroy、四手柄 60 秒 neutral polling、App Host tick 顺序和
Outpost movement/aim/fire/action mapping。应用内 Chromium 已验证 Phaser 页面、多人会话、12 个 App
Host service 和 Outpost Input DevTools source 正常启动；当前环境没有物理手柄，因此本工作流在完成
真实设备移动/瞄准/射击验收前保持 Active。

## Confirmed Baseline

- `InputDevice` 已包含 `gamepad`，但 `NormalizedInputEvent` 没有通用 scalar value 或设备实例 identity。
- `InputSourceAdapter` 只有 `start/stop/destroy`，无法由 App Host tick 推进 polling source。
- `InputRouter` 只为 `pressed/held` 保存 active action；它不能用模拟量 `moved` 刷新后续 held value。
- `@gamekits/input-dom` 只有 keyboard/pointer/wheel event adapter。
- Phaser Driver input source 只有 keyboard/pointer/wheel；Outpost visual profile 已把它和独立 DOM
  keyboard adapter 组合到同一个 Input Router。

## Proposed Public Contract

以下是评审用 shape，不是已经实现的 API：

```ts
export type NormalizedInputEvent = {
  // existing fields
  deviceId?: string;
  value?: number;
};

export type InputSourceAdapter = {
  start(): void;
  stop(): void;
  poll?(frame: InputFrame): void;
  destroy(): void;
};
```

Web adapter 使用 GameKits-owned constants，而不是把 W3C 数组索引暴露给 app：

```ts
export const STANDARD_GAMEPAD_CONTROL = {
  buttonSouth: "Gamepad.Button.South",
  buttonEast: "Gamepad.Button.East",
  buttonWest: "Gamepad.Button.West",
  buttonNorth: "Gamepad.Button.North",
  leftTrigger: "Gamepad.Trigger.Left",
  rightTrigger: "Gamepad.Trigger.Right",
  dpadUp: "Gamepad.Dpad.Up",
  leftXNegative: "Gamepad.Axis.LeftX.Negative",
  leftXPositive: "Gamepad.Axis.LeftX.Positive",
  rightYNegative: "Gamepad.Axis.RightY.Negative"
  // complete standard mapping in implementation
} as const;

export type WebGamepadInputAdapterOptions = {
  onInput(event: NormalizedInputEvent): void;
  scope?: InputScopeId | (() => InputScopeId | undefined);
  source?: string;
  clock?: () => number;
  provider?: WebGamepadSnapshotProvider;
  deadZone?: number;
  buttonPressThreshold?: number;
  changeEpsilon?: number;
  maxGamepads?: number;
  onDiagnostic?: (event: WebGamepadInputDiagnostic) => void;
};
```

推荐默认值在实现前由测试固化：`deadZone = 0.18`、`buttonPressThreshold = 0.5`、
`changeEpsilon = 0.01`、`maxGamepads = 4`。这些值负责硬件噪音和容量边界；角色移动曲线、aim
sensitivity、反向 Y 轴与辅助瞄准仍归 app player-control policy。

## Work Breakdown

### 1. Input Core contract and conformance

- 增加可选 source polling、scalar value 与连接期 device identity。
- 明确 `inputValue()` 优先读取有限 `value`；Core 拒绝非有限值，Web adapter 把 standard Gamepad
  control clamp 到 `[0, 1]`，不对其他设备的 scalar value 擅自套用手柄范围。
- Router 在收到 active control 的 `moved` 时更新已保存的 input/value，不额外伪造 Action；同帧
  `router.tick()` 产出一个最新 value 的 held Action。
- active identity 纳入 `deviceId`，避免两个手柄同名 control 互相 release。
- 覆盖 start/stop/destroy 幂等、poll 顺序、axis change、sign change、disconnect cancel 和 retained
  state 清零。

### 2. Web adapter

- 在 `@gamekits/input-dom` 增加 Gamepad snapshot provider、standard mapping normalizer、polling source
  与 adapter-specific diagnostics。
- 使用固定 control layout 和上一帧数值缓存；只为边沿/超过 epsilon 的变化创建事件。
- 连接 index 被浏览器复用时创建新的 `deviceId` generation，并先取消旧 generation。
- 不保存 mutable native `Gamepad` object，不把它放入 `originalEvent` 或 trace。
- provider 缺失、权限/安全上下文不可用、非标准 mapping 和异常 snapshot 使用去重 diagnostic，
  不让 input tick 抛出并中断 GameRuntime。

### 3. App Host composition

- Input standard service 在每帧先按注册顺序调用所有 `adapter.poll?.(frame)`，再调用
  `router.tick(frame)`。
- stop/dispose 顺序继续由 App Host 统一持有；polling source 不创建 RAF/timer。
- fixture 同时覆盖纯事件 adapter、纯 polling adapter 和两者混合，不改变现有 DOM/Phaser source
  行为。

### 4. Outpost integration

- Visual profile 增加 `createWebGamepadInputAdapter()`，scope resolver 复用键盘的 UI/DevTools gate。
- 左摇杆四方向 Action 合成 move vector，右摇杆四方向 Action 合成 aim direction；鼠标继续提供
  cursor world aim，两种输入在 player-control 层统一为 authority control frame。
- Right Trigger = Rifle held fire，South = Dash，West = Reload，Left Shoulder = Shock Field，North =
  Deploy。映射属于 Outpost binding，可重绑，不进入 Core constants 语义。
- scope 切换、modal/DevTools 打开、断连、重连与 client runtime reset 都必须清空 fire/move/aim held
  state；返回 gameplay 前要求 controller neutral re-arm。
- HUD 可以根据最近一次有意义的 Input Action 切换提示，但不得读取 browser `Gamepad` object。

### 5. Documentation and closure

- 接受 ADR 0045，并把稳定结论迁移到 Architecture、Input module 和 Best Practices。
- 在 Player Experience Rebuild 中记录浏览器实机验收和提交号，关闭本 dependency gate。
- 本执行文档记录最终测试证据后标记 `Closed`。

## Acceptance Gates

- Core：两个 deviceId 的同一 control 互不覆盖；axis value 能在 held 中更新；release/cancel 后无 retained
  action。
- Adapter：标准 mapping 全 control 表、dead zone 边界、epsilon 去抖、sign flip、analog trigger、index
  reuse、disconnect、scope change、stop/destroy 均有 deterministic test。
- Lifecycle：一次 App Host frame 至多 poll 每个 source 一次，且 poll 严格发生在 router held tick 前；
  Host stop 后 provider 不再被读取。
- Performance：4 个 standard controllers、持续 60 秒 neutral polling 不产生 normalized event；steady
  poll 不保留逐帧数组或 native snapshot，benchmark 记录平均耗时与 allocation 证据。
- Outpost：真实 Chromium + Phaser 页面完成移动、瞄准、持续射击、Reload、Dash、Shock、Deploy；打开
  HUD/modal/DevTools 和拔出手柄后不会残留移动或射击。
- Regression：Input Core、input-dom、App Host、driver-phaser、Outpost 定向测试通过；全仓
  `test/build/lint/format` 通过。

## Non-goals

- 不在本工作流实现 vibration/haptics、gyro、controller remapping UI、厂商 mapping database、Steam
  Input、Tauri native plugin 或本地多人 player-slot assignment。
- 不把 aim assist、movement curve 或技能绑定规则放进 Input adapter。
- 不让 Driver、React UI、gameplay 或 Multiplayer authority 直接读取 `navigator.getGamepads()`。

## Remaining Acceptance

- 在带 W3C standard mapping 物理手柄的 Chromium 中验证移动、瞄准、持续射击、Reload、Dash、
  Shock、Deploy。
- 验证真实设备拔出、浏览器失焦和 DevTools/modal scope 切换不会残留移动或射击。
- 完成后记录设备/浏览器信息，把本文档标记为 `Closed`。

其余设计与自动门禁已经完成，不再以 Outpost-local 临时方案阻塞后续玩家切片。
