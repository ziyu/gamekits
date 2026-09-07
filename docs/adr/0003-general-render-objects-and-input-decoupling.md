# ADR 0003：Renderer 使用通用 Render Object，Input 独立成模块

## Status

Accepted

Superseded in part by `docs/adr/0009-renderer-native-control-and-minimal-core.md`:
Renderer 继续使用通用 RenderObject，Input 继续独立；但 adapter patch 字段和能力不再通过
core capability/schema 目录扩展，后端专属表现能力走显式 typed native control path。

## Context

Phase 2 第一版实现把 renderer facade 做成了 `createSprite/updateSprite/onInput`。这能快速验证 Phaser adapter 和 sandbox canvas，但它把两个长期变化点写窄了：

- 渲染对象被绑定到 sprite。未来会有 mesh、tile layer、particle emitter、shader effect、UI projection、camera-attached effect、复合 actor 等对象，甚至不同 renderer adapter 会有完全不同的对象类型。
- 输入被放进 renderer。未来输入会包括 keyboard、pointer、touch、gamepad、快捷键、动作映射、输入上下文、UI focus、devtools 捕获和可追踪输入动作，不应该由 renderer adapter 定义 gameplay 语义。

如果继续沿当前接口扩展 Asset、TCA、GAS、UI，会让后续能力建立在错误边界上。

## Decision

Renderer core 改为通用 render object protocol：

- 公共 API 以 `createObject/updateObject/destroyObject` 或等价对象生命周期为中心，不以 `createSprite` 为中心。
- Render object 使用 stable envelope：
  - `id`
  - `type`
  - `transform`
  - `visible`
  - `alpha`
  - `layer/depth`
  - `children`
  - `props`
- `type` 是 adapter-defined 字符串。Core 不枚举所有类型，只定义通用 envelope 和最低限度的契约。
- 复合对象是一等能力。对象可以有子对象，子对象类型不由 core 限定。
- Adapter 通过 capability 或 schema 声明支持的 object type、patch 字段和可选能力。
- `sprite`、`mesh`、`particle_emitter`、`tile_layer`、`container`、`effect` 都只是某个 adapter 或数据层可以声明的类型，不是 renderer core 的根概念。

Input 从 renderer core 中解耦：

- `RendererInputEvent` 和 `onInput` 不作为 renderer-core 长期公共 API。
- Renderer 可以提供可选 view、coordinate conversion、picking/hit-test capability。
- Raw input capture、action mapping、input context、focus ownership 和 input trace 归后续 `@gamekits/input` 设计。
- EventBus 只记录低频输入事实或 gameplay action，不广播高频 raw input。

## Consequences

收益：

- Renderer facade 可以支持 Phaser、Three.js、Canvas2D 或未来自定义 renderer，而不被 sprite API 限制。
- Asset/Data 阶段可以把 presentation data 映射到通用 render object，而不是提前绑定某个引擎对象。
- 复杂 actor 表现、特效和复合对象可以通过对象树表达，避免 gameplay module 手动管理 adapter 私有对象。
- Input 可以独立处理设备、动作、焦点和上下文，不和 renderer 生命周期混在一起。

代价：

- Phase 2 已实现 API 需要一次协议修正。
- Renderer conformance tests 要从 sprite 契约改为通用对象契约。
- Phaser adapter 需要维护 type → Phaser implementation 的映射表。
- Sandbox 的 render metadata 需要从 `RenderSprite` 改为通用 presentation component。

## Follow-up Status

Phase 2.1 已执行：renderer-core 已改为通用 render object protocol，renderer-core input API 已移除。后续 Asset System + DataPack 基础阶段应基于该协议继续推进。
