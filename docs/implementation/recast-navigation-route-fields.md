# Recast Navigation Route Fields

Status: Closed.

## Goal

在不向 Navigation Core 泄漏 NavMesh topology 的前提下，为 `@gamekits/navigation-recast` 实现真实共享 polygon route field，并让 Navigation Lab 的 Recast Rally Party 使用一个共享 route。

长期事实来源：

- `docs/modules/navigation.md`
- `docs/adr/0036-navigation-query-and-backend-lifecycle.md`
- `docs/adr/0039-recast-navmesh-backend-and-authored-graph-boundary.md`
- `docs/adr/0040-backend-owned-navigation-route-fields.md`

## Scope

- Recast-private directed polygon topology、reverse field、portal/off-mesh sampler。
- GameKits area cost/filter、dependency invalidation 和 generation-safe retain/release。
- 有界 field cache、snapshot diagnostics、Core conformance 和千请求共享回归。
- Sandbox Recast Rally Party、Route Overlay 和 backend behavior matrix。

## Verification

- `corepack pnpm --filter @gamekits/navigation-recast test`：通过，10 项测试覆盖 Core conformance、共享与 retain/release、单向 off-mesh、area cost、动态失效、field generation identity、有界 cache 和 1000 请求共享 1 个 field。
- `corepack pnpm --filter @gamekits/navigation-recast build`：通过。
- `corepack pnpm --filter @gamekits/navigation-recast lint`：通过，0 warning / 0 error。
- `corepack pnpm --filter sandbox test`：通过，49 项测试；Navigation Lab 14 项通过。
- `corepack pnpm --filter sandbox build`：通过，仅保留既有的 Three 动态/静态导入和 chunk size warning。
- `corepack pnpm --filter sandbox lint`：通过，0 warning / 0 error。
- `corepack pnpm test`、`corepack pnpm build`、`corepack pnpm lint`：整仓通过；整仓 lint 仅保留既有 `multiplayer-demo` unused `distance` warning。
- `corepack pnpm bench:navigation`：1000 agents 共享 1 个 retained field，120 samples/agent 时约 1.1705 μs/sample；1000 request burst 约 88.3895 ms。
- `corepack pnpm bench:world`：通过，10,000 entities / 5,000 moving entities。
- Browser 验证：Blackglass Basin + Recast NavMesh 的 Rally Party 由 18 个单位共享 1 个 field；Coolant Fields 更新后 revision 从 0 变为 1 并失效 1 个 field，再次 Rally 重建新 field；持续运行 stuck 回落为 0，控制台无 warning/error。
- `corepack pnpm format`：本次涉及文件通过定向格式化；整仓 check 仍只报告 6 个 `.claude/skills/gitnexus/*/SKILL.md`、`AGENTS.md` 和 `CLAUDE.md` 共 8 个既有无关文件。
