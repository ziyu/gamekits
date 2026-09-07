# ADR 0002：Phase 2 采用 App-Owned Renderer Lifecycle

## Status

Accepted

Extended by ADR 0007 for Phaser / Three style external runtime integration.

## Context

Renderer boot 需要 DOM container、尺寸和浏览器环境，而 `@gamekits/game-runtime` 当前保持同步 lifecycle：`start()`、`stop()`、`tick(delta)` 都不等待异步资源或 DOM 初始化。

如果 Phase 2 让 runtime 直接持有 renderer，会让 runtime 过早感知 DOM、async boot、canvas resize 和具体 app 挂载时机，削弱薄内核边界。

## Decision

Phase 2 采用 app-owned renderer lifecycle：

- app 创建 renderer adapter。
- app 提供 DOM container 并调用 `renderer.boot()`。
- app 创建 runtime，并把 renderer adapter 注入 sandbox render sync module。
- `GameRuntime.start()` 保持同步，不负责 renderer boot。

Renderer lifecycle 公共协议放在 `@gamekits/renderer-core`。gameplay、ECS 和 runtime module 不直接依赖 Phaser。后续 Phaser 这类跨多个协议的运行时由 Driver 统一持有，见 ADR 0007。

本 ADR 只决定 renderer lifecycle 归属，不决定 render object 协议和 input 协议。Render object 与 input 的边界由 ADR 0003 修正。

## Consequences

收益：

- runtime 继续保持 DOM-free、同步、可测试。
- renderer adapter 可以处理 DOM、Scene、Canvas、渲染对象映射和 resize 细节。
- 后续可在 app 层替换 renderer 或组合多个 renderer，不改 gameplay module。

代价：

- app 需要负责 boot 顺序：先挂载 renderer，再启动需要渲染同步的 runtime。
- render sync module 暂时通过闭包持有 adapter，未来如果引入 runtime-owned resource lifecycle，需要重新设计并写 ADR。
