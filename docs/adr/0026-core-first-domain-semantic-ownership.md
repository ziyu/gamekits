# ADR 0026: Core-first Domain Semantic Ownership

Status: Accepted on 2026-07-13.

## Context

GameKits 通过 `renderer-core`、`input-core`、`camera-core`、`physics-core`、`platform-core`、`multiplayer-core`、`ui-core` 等包定义稳定领域协议，再由 driver、adapter、backend 和 app 组合成熟第三方能力。仅限制第三方类型不泄漏仍不够：具体包即使只使用 GameKits 类型，也可能手写一个结构兼容的 facade/runtime，自行推进 phase、session、snapshot、sequence 或 dispose，从而形成第二套领域语义。

Colyseus Room-owned runtime bridge 首个切片暴露了这个问题。它没有把 Colyseus 类型泄漏进 multiplayer-core，却在 provider package 内手写了 `MultiplayerRuntime` 与 session snapshot。Browser 使用 core runtime，server 使用平行 runtime，导致 presence channel、session status 和 lifecycle validation 可以发生漂移。

需要一条跨 package 的所有权规则，既保留薄 core 和成熟库边界，也防止 adapter、driver 或 app 复制 core 已经定义的概念。

## Decision

对应 core/facade 是该领域 GameKits 语义的唯一来源：

- Core 定义领域公共对象、生命周期、状态、错误、snapshot、diagnostics、创建函数和 conformance。已有 core runtime/factory/helper 必须被具体实现直接复用，不能用结构兼容的手写对象替代。
- Adapter/Backend 实现 core 的 adapter/connection/provider 协议，把第三方 lifecycle、native handle、id、event 和 state 映射到 core。它可以维护 provider 私有索引、缓存和连接状态，但不能暴露或推进第二套同名 GameKits facade。
- Driver 持有跨协议第三方 runtime，并派生 core adapter slice；它不能重新定义 renderer/input/camera/asset/physics 的公共语义。
- App 拥有玩法、内容、权限策略和 provider-specific projection；它不能复制通用 core state machine 或以 app-local runtime 长期绕过 core。
- Core 已有协议但缺少真实底层能力时，由 adapter/driver 使用成熟第三方库补齐。只有 core 没有且确实 provider/platform/native 专属的能力，才进入 typed native boundary。
- 当 native 能力在多个 backend 或游戏中形成稳定 GameKits 概念时，必须通过 ADR、公共协议和 conformance 上移到对应 core，然后由各 adapter 实现；不能让第一个 adapter 的第三方模型直接成为事实标准。

落地检查顺序：

1. 列出变更触及的领域概念及对应 core owner。
2. 查找并复用 core factory/runtime/helper/conformance。
3. 把第三方对象和 provider 映射限制在 adapter/driver/native boundary。
4. 从 core facade 编写集成断言，同时补 provider 专属行为测试。
5. 若必须绕过 core，先记录明确缺口、escape hatch 范围和退出条件；高影响公共决策需要 ADR。

Room-owned Colyseus bridge 因此改为私有 `MultiplayerBackendAdapter/Connection`，server facade 由 `createMultiplayerRuntime()` 创建。Colyseus Room 仍拥有 provider lifecycle 和 transport，但不拥有另一套 GameKits session runtime。

## Consequences

Positive consequences:

- Browser、server、headless fixture 和未来 backend 共享同一 core lifecycle、error、snapshot 和 diagnostics 语义。
- Adapter conformance 能发现真实集成偏差，而不只是验证两个同形对象字段相似。
- 第三方库继续负责底层能力，core 不需要吸收 Room、renderer、physics solver 或平台 SDK。
- Core 缺口与 provider-native 能力更容易区分，避免 app 或 adapter 的临时实现成为长期平行框架。

Costs and constraints:

- 具体包有时需要额外实现窄 adapter/connection 层，不能直接把第三方 runtime 或手写 facade 注入 App Host。
- 修改 core factory/runtime 属于高影响变更；应优先用现有 extension point，确有通用缺口时才扩展 core 并运行完整 conformance。
- 结构类型兼容不再视为充分复用证据；测试需要从 core facade 观察 lifecycle 和 snapshot。

## Rejected Alternatives

### Allow each adapter to expose a structurally compatible facade

Rejected because TypeScript shape compatibility does not share implementation, lifecycle invariants, error semantics or diagnostics. Parallel facades inevitably drift as core evolves.

### Move third-party runtime behavior into core

Rejected because core-first means GameKits semantic ownership, not self-building every engine/backend capability. Provider Room、matchmaker、renderer、physics solver、filesystem 和 platform SDK 仍由成熟库及其 adapter/driver 拥有。

### Let apps patch missing behavior locally

Rejected as a long-term path because multiple apps would accumulate incompatible substitutes. App-local experiments are acceptable only behind an explicit temporary boundary; stable cross-app behavior belongs in the corresponding core.

## References

- Architecture: `docs/architecture.md`
- Implementation principles: `docs/implementation-principles.md`
- ADR 0025: `docs/adr/0025-colyseus-room-owned-runtime-bridge.md`
