# ADR 0024: Shared App Definition With Non-visual Profile Fixtures

## Status

Accepted.

## Context

Outpost Siege 需要用同一应用合同覆盖 Browser Web、Tauri、headless server 和 deterministic test。Browser/Tauri 需要真实 Driver/Renderer/Input/Asset runtime；headless/test 不应加载视觉 payload，但如果为它们删除 Renderer、Asset、Input、UI 等 service，就会形成另一套 service graph，无法验证 App Host 的真实依赖顺序和 dispose 行为。

仓库已经有 App Host 内部使用的 headless renderer 和 memory asset loader，也有 Web adapter 的 memory fs/storage，但缺少 app profile 可直接复用的公共 fixture。另一方面，memory backend 不能被误当成生产 dedicated server platform、Physics 或 Multiplayer 实现。

## Decision

- 多运行环境 app 复用同一个 `GameAppDefinition` 和 service dependency graph。
- `@gamekits/app-host` 公开已有的 `createHeadlessRenderer()` 与 `createMemoryAssetAdapter()`，只作为 protocol-compatible non-visual composition fixture。
- `@gamekits/platform-web` 提供 `createMemoryPlatform()`，强制使用隔离 memory fs/storage，并允许 profile 设置 runtime id；它不修改 `createWebPlatform()` 的既有行为。
- App-specific headless/deterministic profile 可以使用这些 fixture，但 World、Physics backend、Multiplayer runtime、SaveStore 和 GameRuntime factory 保持显式可注入。
- 正式 server/Tauri composition 使用真实 adapter/backend；memory fixture 只承担确定性、生命周期、资源隔离和性能门禁。

## Alternatives Considered

### 为 headless app 删除视觉 service

会让 headless 与 Browser/Tauri 的 Host 拓扑分叉，无法验证同一 Definition，也容易让 server 入口绕过 Data/Asset/Save/DevTools lifecycle。

### 修改 `createWebPlatform()` 支持所有 profile

该函数被多个 app 和 Lab 的启动链直接依赖，影响面为 CRITICAL。为了新增 fixture 改写它的行为没有必要，新增 wrapper 可以保持零回归。

### 把 Outpost 专用 no-op adapter 写在 app 内

实现简单，但会复制已经存在的通用 headless 能力，并让后续游戏重复维护相同 Renderer/Asset fixture。

## Consequences

- App 可以在无 DOM/Tauri runtime 时启动完整标准 service graph，并验证 boot/start/tick/dispose。
- Headless 不加载视觉 payload，deterministic profile 可以完整验证 Asset group 与稳定 snapshot。
- 正式 server 仍必须注入生产 platform/backend；fixture runtime id 不代表生产实现能力。
- 新增两个小型公共 fixture API，需要 package 文档、Changeset、conformance/integration test 和 lifecycle benchmark 维护。
