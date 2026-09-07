# ADR 0009：Renderer Core 保持最小协议，具体后端能力走原生控制路径

## Status

Accepted

## Context

Renderer Core 已经从 sprite-first API 调整为通用 RenderObject 协议。这个方向解决了
`createSprite/updateSprite/onInput` 过窄的问题，但运行时更新接口仍然容易滑向另一个问题：

- `RenderObjectPatch` 把创建定义、运行时状态、节点更新和 adapter-specific props 混在一起。
- 如果改成中央 `RenderUpdate` union，Phaser、Three.js、Pixi、Spine、shader、post-processing、
  material、pipeline、particle、light、shadow 等能力仍会把 core API 不断撑大。
- 如果让 `RendererCapabilities` 枚举 adapter 支持的更新字段、命令或 schema，GameKits 就会变成
  后端 API 目录维护者，而不是薄框架。
- Phaser 和 Three.js 本身持续演进，GameKits 不应追着包装它们的完整 API。

GameKits 的目标是提供稳定组合边界，而不是替成熟渲染库重做一层无限扩展的 facade。

## Decision

Renderer Core 只维护最小、长期稳定的 renderer facade：

- renderer lifecycle：boot、resize、destroy、view。
- RenderObject / RenderNode 的可重建定义和 GameKits object id 生命周期。
- object id / node path 到后端对象的可追踪映射。
- diagnostics、snapshot、测试夹具需要的低成本观察面。

Renderer Core 不维护以下内容：

- 不定义 `RendererCapabilities` 这类详尽能力枚举。
- 不用 core union 枚举 Phaser、Three.js 或其他 renderer 的专属更新。
- 不为常见后端 API 持续新增 `phaserRender.*`、`threeRender.*` 这类 wrapper helper。
- 不把 Phaser、Three.js 等第三方类型泄漏到 `@gamekits/renderer-core`。

复杂表现和后端专属能力走显式原生控制路径。Adapter 或 Driver 包可以导出带真实后端类型的
specialized renderer 类型，例如：

```ts
export type RendererAdapter<TNative = unknown, TObjectNative = unknown> = {
  id: string;
  kind?: string;

  boot(ctx: RendererBootContext): Promise<void>;
  destroy(): void;
  getView(): HTMLElement | HTMLCanvasElement;
  resize(width: number, height: number): void;

  createObject(definition: RenderObjectDefinition): RenderObjectId;
  destroyObject(id: RenderObjectId): void;

  native(): TNative;
  getObjectHandle?(id: RenderObjectId): RenderObjectHandle<TObjectNative>;
  getNodeHandle?(id: RenderObjectId, path: RenderNodePath): RenderObjectHandle<TObjectNative>;
};
```

`@gamekits/renderer-phaser` 可以把 generic 填成 Phaser runtime 和 Phaser GameObject 类型。
`@gamekits/driver-three` 可以导出 Three runtime、scene、object 或 mesh handle 类型。具体游戏、
app presentation 层、Editor 后端专属面板和 DevTools 后端专属工具可以依赖这些具体包，拿到
native handle 后直接调用 Phaser / Three API。

具体 Adapter / Driver 包也可以提供 renderer-specific state writer，例如 Phaser adapter 提供
`PhaserRenderTargetState` 和 `applyPhaserRenderTargetState`，让对象创建和运行时表现更新复用同一套
Phaser display object 写入规则。这类 writer 不进入 renderer-core，也不要求其他 renderer 实现同名
状态结构。

可复用 framework module、gameplay package、DataType、Save payload、TCA/GAS rule 和
renderer-core conformance test 不依赖这些原生类型。它们只依赖最小 core 协议。

## Consequences

收益：

- Renderer Core 保持薄内核，不追逐 Phaser / Three 的完整 API 面。
- 具体游戏可以充分使用所选 renderer 的真实能力，不需要等待 GameKits 增加 wrapper。
- Adapter 仍负责创建、销毁和映射对象，DevTools 仍能知道哪些对象进入了 native/direct path。
- Editor 和 Debug 的通用功能可以基于 object id、node path、snapshot、transform 和 view；后端专属面板直接依赖对应 adapter / driver 包。

代价：

- 进入 native path 后，代码不再 renderer-agnostic；这是显式 opt-in 的表现层或工具层选择。
- Direct native mutation 可能绕过 GameKits 的通用 diff/cache，需要调用方维护一致性。
- Adapter-specific state writer 可以减少 app presentation 重复实现后端 duck type，但会让调用方显式依赖具体 renderer 包。
- 测试需要区分 core conformance、adapter mapping 和 app-specific native presentation 行为。
- 数据驱动的 RenderObjectDefinition 只描述可重建初始结构；复杂运行时表现由 adapter native API、
  command 或 app presentation code 承担。

## Boundaries

- `@gamekits/renderer-core` 可以导出 generic handle 类型，但不能导出 Phaser、Three.js 类型。
- Adapter / Driver 包可以导出具体 native runtime 和 object handle 类型。
- App-specific presentation、Editor backend panel 和 DevTools renderer plugin 可以依赖具体 renderer 包。
- 可复用 gameplay module 不直接 import Phaser、Three.js，也不把 native handle 写入 World、Data 或 Save。
- Native control path 必须保持 GameKits object lifecycle 可追踪：对象仍由 RendererAdapter / Driver 创建和销毁。

## Relationship To ADR 0003

ADR 0003 继续保留“Renderer 使用通用 RenderObject，Input 独立成模块”的方向。
本 ADR 取代其中“通过 capability/schema 描述 adapter 支持的 patch 字段和可选能力”的扩展方向：
Renderer Core 不再追求列举后端能力，而是提供最小对象生命周期和显式 native control path。
