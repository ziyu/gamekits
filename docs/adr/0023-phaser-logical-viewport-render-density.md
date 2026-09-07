# ADR 0023: Phaser Logical Viewport And Render Density

Status: Accepted on 2026-07-13.

## Context

Canvas 的 CSS viewport、backing-store pixels 和 Phaser camera viewport 可能具有不同尺寸。只按 CSS 尺寸创建 backing store 会在高密度屏幕上降低纹理清晰度；直接放大 Phaser runtime 而不归一化 input 和 camera，又会导致 picking、follow center、zoom 和 overlay 错位。

Phaser 的 `Camera.scrollX/scrollY` 不是 GameKits 的 camera center，也不能在 backing-store viewport 被放大后继续使用只基于逻辑 viewport 推导的 raw scroll。Phaser 提供的 center operation 才能在 native viewport、zoom 和 render density 下保持同一个 world center。

## Decision

`@gamekits/driver-phaser` 的 Driver-owned render configuration 增加 opt-in `render` options：pixel ratio、antialias、WebGL antialias、round pixels 和 mipmap filter。

- GameKits 的 viewport、CameraState、pointer/action 和 world coordinates 始终使用 logical CSS pixels / world units。
- Driver 可以按 `logicalSize * pixelRatio` 创建 canvas backing store，同时把 canvas CSS size 保持为 logical viewport。
- Driver input source 在进入 Input Core 前把 Phaser pointer coordinate 归一化回 logical viewport；pointer-lock movement 保留相对 movement 语义。
- Phaser native zoom 乘以 render pixel ratio，camera adapter 优先调用 runtime `centerOn(centerX, centerY)`；legacy runtime 才回退到 raw scroll mapping。
- RenderObject transform 和 display size 仍使用 world units，不因 pixel ratio 改写业务数据或 Renderer Core 协议。
- render quality 是 Driver/App profile 的组合选择，不进入 Renderer Core，不由具体游戏对象或 AssetManager 临时控制。默认 pixel ratio 为 1，现有应用不承担额外 fill-rate 成本。
- Driver factory 在创建时一次性解析、补全并校验 render configuration，boot、resize 和 snapshot 共用同一个 resolved value；snapshot 暴露完整稳定配置，而不是只暴露某个 demo 当前使用的字段。更深的 canvas/camera native summary 只用于 diagnostics，不暴露 Phaser object handle。

## Consequences

Positive consequences：

- 高密度 backing store 不改变 GameKits camera、input、picking 和 overlay 的逻辑坐标。
- App profile 可以按设备能力限制 pixel ratio，在清晰度和 fill-rate 之间显式取舍。
- round-pixel 和 texture filtering policy 在 Phaser Driver 统一配置，游戏不直接操作 Phaser runtime。

Costs and constraints：

- pixel ratio 1.5 会把像素填充量提高到约 2.25 倍；profile 必须设置上限并用真实浏览器 profiler 验证。
- runtime texture 应按预期最大 display size × pixel ratio 生成；过大纹理浪费传输和显存，过小纹理会放大模糊。
- 其他 Driver 必须按各自 backend 的 viewport/camera 语义独立映射，不能复制 Phaser raw scroll 公式。

## Rejected Alternatives

### Expose physical pixels to Camera Core and gameplay

Rejected because同一场景会随 DPR 改变 camera、input 和 gameplay coordinates，破坏跨平台 profile 等价性。

### Apply CSS scaling without normalizing input

Rejected because pointer、wheel anchor、picking 和 camera overlay 会与渲染内容错位。

### Put pixel-ratio handling in Renderer Core

Rejected because backing store、native camera 和 input plugin 都属于跨协议外部 runtime，必须由 Driver 统一持有。
