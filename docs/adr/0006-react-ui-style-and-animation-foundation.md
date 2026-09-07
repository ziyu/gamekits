# ADR 0006：React UI 样式与动效基础

## 状态

Accepted

## 背景

UI Core 已被明确为 headless 协议层，只负责 panel、window、command、focus 和 snapshot。主题、样式、组件库和动效不应进入 `@gamekits/ui-core`，否则会让大多数游戏被迫关心过度抽象的 theme runtime，也会让核心协议过早绑定 React、DOM 或 CSS 技术。

但 `@gamekits/react-ui` 需要有明确的默认实现基础，否则 Sandbox、DevTools、Editor 和未来游戏 demo 会继续各自手写样式和动画，导致 UI 体验、可访问性、组件结构和维护方式分裂。

## 决策

`@gamekits/react-ui` 的默认实现采用：

- Tailwind CSS 作为样式基础。
- GSAP 作为低频 UI 动效基础。
- shadcn/ui 作为推荐组件 recipe 最佳实践。

这些选择只属于 React UI / app UI 层。`@gamekits/ui-core` 不依赖 Tailwind、GSAP、shadcn/ui、Radix、Base UI、DOM 或 React 类型。

shadcn/ui 不作为不可替换的运行时依赖。它是推荐实践和组件 recipe 来源：GameKits 或具体游戏可以复制、封装、改造组件代码，并把它维护在 `@gamekits/react-ui` 或游戏自己的 UI 包中。

## 后果

- React UI 可以提供更一致的默认 shell、panel、window、modal、focus ring、toolbar 和工具型组件样式。
- React UI 可以提供 GSAP-backed 的 window/modal/toast/timeline/inspector 低频动效 helper。
- 游戏仍然可以定义自己的主题、CSS variables、组件库和视觉语言，不需要服从 `ui-core` 的抽象 theme 协议。
- Tailwind class、GSAP timeline、shadcn primitive 类型不得进入 `UiPanelDefinition`、`UiCommand`、DataType、TCA/GAS 协议、GameRuntime、World system 或 renderer adapter。
- UI 动效必须尊重 reduced motion，且不能阻塞 gameplay tick 或 renderer patch。

## 备选方案

### Theme runtime 放入 UI Core

拒绝。它会让 headless UI 协议过重，也会让不需要框架级主题系统的游戏承担额外概念。

### 完全不规定 React UI 技术基础

拒绝。这样会导致每个 app 重复选择样式和动效方案，难以沉淀可复用组件和最佳实践。

### shadcn/ui 作为强制公共依赖

拒绝。shadcn 的价值在于可拥有的组件 recipe，而不是把第三方 primitive 类型扩散成 GameKits 公共 API。
