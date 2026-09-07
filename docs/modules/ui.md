# UI 模块设计

## 定位

UI 分为 UI Core 和 React UI。UI Core 描述窗口、面板、命令、焦点、布局状态和 UI snapshot；React UI 提供具体渲染实现、shell、组件 bridge、样式基础设施和状态订阅。

UI 是应用层能力，不是 GameRuntime 的一部分。它负责低频 HUD、Inspector、Timeline、窗口、弹窗、编辑器面板和玩家界面，不进入 world tick、renderer patch 或 ECS 高频数据路径。DevTools 可复用 UI runtime 和 React UI 基础设施，但 DevTools 专用 launcher、pin surface、shell 和面板属于 `@gamekits/devtools-ui`，不内置在 `@gamekits/react-ui`。

相关包：

- `@gamekits/ui-core`
- `@gamekits/react-ui`
- `@gamekits/devtools-ui`

核心原则：

- `@gamekits/ui-core` 不依赖 React、DOM、Renderer、World、Physics、TCA、GAS 或具体 app。
- `@gamekits/react-ui` 是 UI adapter / implementation，不能成为 gameplay 公共 API。
- React 不进入主循环，不订阅每帧 ECS position，不直接驱动 renderer object patch。
- UI 通过低频 snapshot、selector、command 和 EventBus fact 理解游戏状态。
- gameplay packages 不直接 import React、shadcn/ui、Base UI 或 app-specific UI component。
- UI focus 必须能影响 Input Context / Scope，避免文本输入、Inspector、DevTools 中误触发 gameplay input。
- `ui-core` 不定义 theme 或 style token；游戏主题、皮肤和组件库组织属于 React UI / app 层。
- 应用、demo、Editor 和 DevTools UI 应复用同一套 UI runtime / panel / window 协议。

## UI Core

UI Core 是 headless 协议层。它只定义 UI 状态、命令和运行时，不负责 DOM 渲染。

职责：

- register / unregister panel definition
- open / close / toggle window
- dispatch UI command
- manage focus state
- expose layout / window snapshot
- expose UI diagnostics for Host / DevTools
- provide test-friendly memory runtime

示意类型：

```ts
export type UiPanelDefinition<TProps = unknown> = {
  id: string;
  title: string;
  kind: "panel" | "window" | "modal" | "overlay" | "hud" | "devtools";
  tags?: string[];
  defaultProps?: TProps;
};

export type UiWindowDefinition<TProps = unknown> = UiPanelDefinition<TProps> & {
  defaultSize?: { width: number; height: number };
  defaultPosition?: { x: number; y: number };
  closable?: boolean;
  movable?: boolean;
  resizable?: boolean;
  minimizable?: boolean;
  singleton?: boolean;
  layer?: UiLayer;
};

export type UiCommand = {
  type: string;
  target?: string;
  payload?: unknown;
  source?: string;
};

export type UiRuntime = {
  registerPanel<TProps>(definition: UiPanelDefinition<TProps>): void;
  unregisterPanel(id: string): void;
  open(id: string, props?: unknown): void;
  close(id: string): void;
  toggle(id: string, props?: unknown): void;
  dispatch(command: UiCommand): void;
  focus(): UiFocusState;
  setFocus(focus: UiFocusState): void;
  snapshot(): UiSnapshot;
};
```

UI Core 可以提供常见 manager 概念，但不要先把 `WindowManager`、`ModalManager`、`ToastManager`、`ShortcutManager` 做成彼此割裂的全局单例。长期更重要的是统一 runtime、command、focus 和 snapshot 协议。

## React Style / Component Library

主题和样式不进入 `@gamekits/ui-core`。对大多数游戏来说，核心问题不是“框架抽象出一个统一 theme runtime”，而是如何清晰地定义自己的游戏视觉语言、交互密度和组件库，并且不让这些样式反向污染 gameplay、runtime 或 adapter 边界。

职责边界：

- `@gamekits/react-ui` 提供样式基础设施、shell/panel/window 的默认样式、可替换组件库组织方式、React-only theme provider 和 UI 动效基础。
- `@gamekits/devtools-ui` 提供 DevTools 专用 launcher、pin surface、shell、面板和调试视图；它可以复用 `@gamekits/react-ui` 的通用基础设施，但 DevTools 专用组件不回流进 `react-ui`。
- 游戏 app 定义自己的视觉主题、设计 token、组件 recipes、HUD/Inspector/Editor 组件和品牌皮肤。
- `@gamekits/ui-core` 只提供 panel/window/command/focus/snapshot，不知道 theme、CSS variables、className 或 ReactNode。
- App Host/Profile 可以把 React UI 所需的 style preset、CSS variables、className 或 provider props 作为 UI service 参数传入，但 Host 不解释它们。
- gameplay module 不感知 UI 样式；玩法数据只产生状态、标签、cue 或 snapshot，由 UI 映射成视觉表现。

### React UI 技术基础

`@gamekits/react-ui` 的默认实现以 Tailwind CSS 和 GSAP 为基础：

- Tailwind CSS 是默认样式基础，用于组织 shell、panel、window、layout primitive 和通用组件样式。
- GSAP 是默认 UI 动效基础，用于窗口、modal、toast、tooltip、timeline highlight、inspector transition 等低频 UI 动画。
- shadcn/ui 是推荐最佳实践：优先把 shadcn 风格的组件 recipe 复制、封装和维护在 GameKits 或具体游戏的 React UI 层，而不是让业务 app 到处直接依赖第三方 primitive。

这些技术选择只属于 React UI / app UI 层。`ui-core` 不依赖 Tailwind、GSAP、shadcn/ui、Radix、Base UI 或 DOM 类型。GameRuntime、World、Physics、TCA、GAS、Renderer sync 和 gameplay module 也不能依赖这些 UI 实现细节。

Tailwind 和 GSAP 应被当作实现基础，而不是业务协议：

- Tailwind class 不进入 `UiPanelDefinition`、`UiCommand`、DataType、TCA action 或 GAS cue 的公共协议。
- GSAP timeline / tween 不进入 `ui-core` snapshot，也不用于 gameplay 时间线或 renderer object 生命周期。
- 需要跨模块表达的“播放提示”“打开窗口”“突出显示 actor”等行为，应使用 UI command、EventBus fact 或 app UI adapter，再由 React UI 内部决定是否用 GSAP 表现。

### Game UI Theme

游戏可以在 React 层定义自己的 theme shape。GameKits 不强制统一字段，只建议遵守可维护的组织方式：

```ts
export type GameUiTheme = {
  id: string;
  label: string;
  mode?: "light" | "dark" | "high-contrast";
  tokens: {
    color: Record<string, string>;
    space: Record<string, string>;
    radius: Record<string, string>;
    typography: Record<string, string>;
    motion?: Record<string, string>;
    layer?: Record<string, number>;
  };
  components?: Record<string, unknown>;
};
```

这只是推荐形状，不是 `ui-core` 公共协议。真实游戏可以按自己的业务组织，例如：

- `gameplayTheme`
- `editorTheme`
- `devtoolsTheme`
- `highContrastTheme`

不同游戏的 token 可以完全不同，但应该避免把 CSS 值散落在每个组件里。游戏主题最好集中放在 app 或 game UI package 中，再由组件库消费。

### Style Organization

React UI 样式建议按以下层次组织：

1. React UI base：由 `@gamekits/react-ui` 通过 Tailwind CSS 提供 shell、panel、window、modal、focus ring、layout primitive 的最低可用样式。
2. Game theme：游戏自己的 token、CSS variables、字体、色彩、密度、动效策略。
3. Game component library：Button、IconButton、Tabs、HUDPanel、ActorCard、AbilityButton、ResourceMeter 等组件。
4. Feature UI：具体系统的 HUD、Inspector、Timeline、Inventory、QuestLog、BuildMenu。
5. One-off style：只允许用于局部 demo 或过渡，不作为长期模式。

如果一个游戏逐渐变大，推荐把 UI 拆成独立 app 内部目录或包：

```txt
src/ui/
  theme/
    tokens.ts
    variables.ts
    provider.tsx
  components/
    button.tsx
    panel.tsx
    tabs.tsx
    stat-bar.tsx
  features/
    actor-inspector/
    build-menu/
    timeline/
  shell/
    game-shell.tsx
```

或者在多 app 复用时拆成：

```txt
packages/<game>-ui/
  theme/
  components/
  features/
```

### React UI Defaults

`@gamekits/react-ui` 可以提供默认工具型样式，但它们只是启动点：

- 默认 CSS variables，例如 `--gk-surface-panel`、`--gk-text-primary`、`--gk-focus-ring`。
- `GameKitsStyleProvider` / `GameKitsThemeProvider`，只属于 React 层。
- shell、panel、window、modal、tip、toolbar、split view 的基础 class。
- `UiPanelHost`、`UiWindowHost`、`UiModalHost` 和轻量 `UiTip` primitive，用于验证 UI runtime 到 React 渲染层的默认路径。
- GSAP-backed animation helpers，用于低频 UI 进入、退出、强调和布局过渡。
- 常用组件的 semantic props，例如 `tone="danger"`、`density="compact"`、`variant="primary"`。

这些默认样式不定义游戏最终美术风格。真实游戏应该通过自己的 theme provider、CSS variables 或组件替换来表达独特风格。

### Component Library Principles

游戏组件库比抽象 theme runtime 更重要。长期建议：

- 先定义组件用途，再定义视觉 token。
- 把游戏语义组件化，例如 `AbilityButton`、`ResourceMeter`、`ActorPortrait`、`BuildSlot`，而不是在业务页面里重复拼样式。
- 通用组件接收语义 props，不接收 gameplay model。
- Feature 组件可以读取 snapshot / selector，但不直接订阅每帧 world state。
- 组件库默认使用 Tailwind CSS 组织样式，可以结合 CSS variables 表达游戏主题。
- shadcn/ui 是组件结构和可访问性实践的推荐来源；采用时应把 recipe 收敛到 `@gamekits/react-ui` 或游戏 UI 包，而不是把第三方 primitive 类型扩散到 gameplay。
- 可复用组件可以暴露 `className` 或 `slotProps` escape hatch，但基础样式不应要求调用方每次手写 class。

长期禁止：

- 在 gameplay module 中写 React style、CSS selector、className 或 CSS variable。
- 在 `ui-core` 中暴露 CSS className、HTMLElement、ReactNode、Tailwind class、shadcn/ui 类型。
- 在 `ui-core`、GameRuntime、World、TCA 或 GAS 中导入 Tailwind、GSAP、shadcn/ui、Radix 或 Base UI。
- 让 GameRuntime、World system、GAS/TCA runtime 依赖 UI 组件或样式。
- 在多个 feature 中复制同一组 panel/window/button 基础样式。
- 把某个游戏的视觉 token 上推成 GameKits 框架 token。

### Accessibility / Responsiveness

React UI 和游戏组件库必须保留可访问性和多终端能力：

- focus ring 是必须样式，不允许被主题静默移除。
- 对比度、字号和 hit target 由游戏主题负责，但 React UI 默认组件应提供合理下限。
- reduced motion 应由 React UI / app theme provider 支持。
- GSAP 动效必须尊重 reduced motion；不允许为了表现动画阻塞 UI 命令或 gameplay tick。
- 响应式布局由 React UI layout primitives 和 app shell 处理，不把 viewport 断点写入 gameplay。
- Editor、DevTools、game HUD 可以使用不同密度，但应共享同一套基础交互语义。

## Focus / Input 边界

UI focus、modal、text input 会影响 Input Context 和 Input Scope。

- Text input focused：阻断 gameplay hotkeys。
- Modal opened：modal context 优先。
- Window focused：Esc / Ctrl+W 等快捷键由 UI context 处理。
- Game viewport focused：gameplay/camera action 使用 `game` scope。
- UI panel focused：gameplay/camera action 不应响应，除非该 action 明确允许对应 scope。
- DevTools focused：debug shortcuts 归 DevTools/UI，不穿透到 gameplay。

UI Core 只描述 focus state；具体 DOM focus 监听、React event bridge、Phaser canvas focus gate 由 adapter/app 层实现。

## React UI

职责：

- GameShell
- PanelHost
- WindowHost
- ModalHost
- OverlayHost
- ToastHost
- TooltipHost
- ContextMenuHost
- StyleProvider / ThemeProvider
- RuntimeProvider
- FocusBridge
- snapshot / selector bridge
- common utility components for tools and game UI

底层 Tailwind、shadcn/ui、Base UI、Radix 等实现细节不应散落到业务 app。若引入这些库，应封装进 `@gamekits/react-ui`，并避免把第三方组件类型变成 GameKits 公共协议。

React UI 可以提供一组通用组件：

- Button / IconButton
- Panel / Window
- Tabs / SegmentedControl
- ScrollArea
- StatBar
- TagList
- Timeline
- InspectorTable
- JsonView
- ActorCard
- AbilityIcon
- EffectBadge

这些组件是 UI 实现便利层，不定义 gameplay 数据模型。具体游戏可以用自己的组件替换它们，只要仍通过 UI runtime / panel / command 协议接入。

组件样式应来自 React UI 默认样式或游戏自己的 theme/component library。组件可以接受 `variant="primary"`、`tone="danger"`、`density="compact"` 这类语义 props，但不应要求调用方传入底层 className 才能获得基础样式。允许提供 escape hatch，但它是 app 层定制能力，不是标准用法。

## 与 TCA 的关系

UI action 可以由 TCA 调用：

```json
{
  "type": "ui.open_window",
  "args": {
    "window": "actor-detail",
    "props": {
      "actorId": "$event.actorId"
    }
  }
}
```

TCA 只能触发低频 UI command，例如打开窗口、显示 toast、切换 inspector tab。TCA 不应驱动每帧 UI layout 或直接操作 React component state。

## 与 App Host 的关系

UI 可以作为可选 App Service 进入 App Host lifecycle：

- `boot`：创建 UI runtime、mount React shell、应用 React UI style provider、注册 panel。
- `start`：开始订阅低频 snapshot / diagnostics。
- `stop`：停止订阅和用户输入桥接，但保留 shell where appropriate。
- `dispose`：unmount React、清理订阅和 DOM 句柄。

App Host 可以在 snapshot 中展示 UI shell 状态、已注册 panel、打开窗口、focus scope 和 UI diagnostics。GameRuntime 不直接拥有 UI service。React UI 的 theme/style 状态可以由 app shell 或 DevTools 额外展示，但不属于 `ui-core` snapshot。

## 状态边界

Zustand 用于：

- Window state
- Editor state
- selected entity/tile
- DevTools panel state
- debug flags
- user settings

不用于：

- ECS world state
- 每帧 position
- 大规模 component 数据

UI 可以缓存为展示服务的派生状态，但 source of truth 应留在对应系统中：

- World / GAS / TCA / Data / Asset / Host 产生事实或 snapshot。
- UI 通过 selector 订阅低频 summary。
- 高频舞台表现仍由 Renderer / Camera / World system 处理。

## App / DevTools / Editor

应用、demo、DevTools 和 Editor 应复用同一套窗口、面板、focus 和 command 协议，而不是各自手写互不兼容的 UI runtime。具体应用如何在场景中使用 focus 框、对象摘要、modal、tip、Inspector 或 Timeline，属于 `docs/apps/` 下的应用设计文档，不在 UI 模块文档中维护。

DevTools 和 Editor 可以复用同一套窗口、面板、focus 和 command 协议，但它们的复杂业务状态应留在各自模块或 app 内，不上推到 UI Core。

## 最佳实践

### 模块集成

- UI Core 定义窗口、面板、modal、tip、focus、command 和 snapshot 协议；React UI 负责组件、主题、样式和动画实现。不要把 Tailwind、GSAP、shadcn、Radix 等概念放进 UI Core。
- UI service 集成应由 App Host/app shell 负责 mount/unmount、style provider、focus bridge、input scope bridge、panel registration 和 diagnostics。
- UI focus 必须反馈给 Input Scope。modal、text input、DevTools、Inspector 聚焦时，gameplay/camera action 不应穿透。
- 测试应覆盖 runtime store snapshot 稳定性、subscribe/unsubscribe、React `useSyncExternalStore` snapshot 缓存、focus bridge、modal/panel lifecycle 和 reduced motion。

### 模块使用

- 交互 UI 使用 React/组件系统或显式 DOM builder。不要用 `innerHTML`、HTML 字符串模板或 `insertAdjacentHTML` 实现游戏 UI、Editor UI 或 DevTools UI。
- UI 状态保存选择、展开、筛选、窗口位置和用户偏好；World/GAS/TCA/Data/Asset 的 source of truth 留在对应系统，通过 snapshot 或 selector 读取。
- GSAP 只用于低频 UI 动效，例如 modal、panel、toast、timeline 强调；不要用 UI 动画时钟驱动 gameplay tick 或 renderer object movement。
- 组件库优先提供语义组件和 props，例如 `AbilityButton`、`ResourceMeter`、`ActorPortrait`、`InspectorTable`，不要要求业务到处传底层 class string。
