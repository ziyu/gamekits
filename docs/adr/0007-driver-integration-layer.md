# ADR 0007：引入 Driver 作为外部运行时统一集成层

## Status

Accepted

Superseded in part by `docs/adr/0009-renderer-native-control-and-minimal-core.md`:
Driver 仍是外部 runtime owner；但 renderer/driver 不维护完整后端 capability catalog。
Profile 选择标准服务时以明确 adapter map 为准，后端专属 API 通过 typed native boundary 使用。

## Context

Phaser、Three.js 这类第三方库不是单一能力库。它们通常同时拥有 renderer、scene、loader、texture/cache、input、camera、animation、particle、plugin 等运行时对象。

如果 GameKits 按 `renderer-phaser`、`camera-phaser`、`input-phaser`、`asset-phaser` 这类单协议包分别集成同一个外部运行时，会出现几个长期问题：

- 多个包各自理解和管理同一个外部 runtime lifecycle。
- loader、texture manager、scene、camera、input plugin 之间缺少统一 ownership。
- camera 坐标、pointer 坐标、renderer viewport 和 UI overlay 容易出现不一致。
- App Host 无法清楚诊断“这个 Phaser app 当前到底由哪些 adapter 共享”。
- Three.js、Babylon.js、PixiJS 等未来后端会重复同样问题。

原有 Adapter 概念仍然有价值，但 Adapter 只能解释单个稳定协议，不能表达“同一个外部 runtime 横跨多个协议”的 ownership。

## Decision

引入 Driver 作为 GameKits 的外部运行时统一集成层。

定义：

- Core Protocol：GameKits 稳定协议，例如 RendererAdapter、InputSource、AssetLoaderAdapter、RendererCameraAdapter。
- Adapter：实现一个 Core Protocol 的薄映射。
- Driver：统一持有一个外部 runtime，并从中派生多个 Adapter。

长期方向：

- `@gamekits/driver-core` 定义 driver lifecycle、capability、adapter map、snapshot 和 diagnostics 协议。
- `@gamekits/driver-phaser` 成为 Phaser 默认集成入口，并统一暴露 renderer、asset loader、input source、camera sync adapter。
- `@gamekits/driver-three` 未来按同一模式集成 Three.js。
- GameRuntime 不直接拥有 Driver。
- App Host 管理 Driver lifecycle，并从 Driver capability 中选择标准 renderer/input/assets/camera adapter。
- Camera、TCA、GAS 等仍按 ADR 0005 归属 GameModule；Driver 只提供外部 runtime adapter，不承载 gameplay state。

Phaser/Three 的公共第三方类型不进入 core protocol，也不进入 gameplay module 公共 API。需要 native escape hatch 时，必须限定在 adapter、driver 或 tooling 层。

## Consequences

收益：

- 一个第三方 runtime 只有一个 lifecycle owner。
- renderer、asset、input、camera 坐标和资源 cache 可以共享同一底层上下文。
- App Host 可以统一观察 driver phase、capability、adapter snapshot 和 diagnostics。
- 未来 Three.js、Babylon.js、PixiJS、Bevy/WASM 等后端可以复用同一集成模型。
- 单协议 Adapter 仍保留为 Driver 暴露的端口，核心协议不会变厚。

代价：

- 需要新增 `driver-core` 概念和 App Host driver service 支持。
- 现有分散的 Phaser adapter package 需要迁移或收敛。
- 测试夹具需要区分 memory adapter 和 memory driver。
- Profile 需要显式选择标准服务使用哪个 driver capability，避免多 driver 场景下隐式冲突。

迁移影响：

- `input-phaser`、`asset-phaser`、`camera-phaser` 不应继续作为长期独立 package；这些能力收敛进 `driver-phaser` 的内部模块。
- `renderer-phaser` 可以作为 Phaser 渲染映射包存在，但只能绑定到 `driver-phaser` 提供的 Phaser Scene runtime；它不创建 `Phaser.Game`，不持有 input/camera/asset runtime。
- Sandbox / Abyss Delve / Editor 应优先通过 App Host profile 配置 driver，而不是手动组装多个 Phaser adapter。
