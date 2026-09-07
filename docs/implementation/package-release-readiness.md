# Package Release Readiness

Status: Closed

当前发布操作流程已经迁移到 `docs/release.md`。本文档只作为发布准备工作的历史执行记录保留，
不要把这里的阶段计划或旧排障记录作为当前发布 runbook。

## Goal

把 GameKits 从“内部 pnpm workspace 可用”推进到“其他项目可以通过 npm/tarball 方便安装并稳定消费”的发布准备状态。

本工作流只记录发布工程落地任务、验证证据和关闭记录。长期包边界以 `docs/architecture.md` 和 `docs/adr/0008-package-publication-and-build-toolchain.md` 为准。

## Scope

包含：

- 可发布包 manifest 标准化。
- Rolldown 系 library build 试点与落地。
- tarball 内容收敛。
- React/Tauri/Phaser/Koota 等依赖归属校正。
- 外部安装 smoke test。
- 发布渠道和版本流程准备。

不包含：

- 改变 GameKits 的模块职责或 gameplay API。
- 发布 `apps/sandbox` 或 `apps/abyss-delve` 为 npm package。
- 引入新的 renderer、driver 或游戏内容系统。
- 发布 npm latest。

## Current Findings

已确认：

- `corepack pnpm build` 可通过，所有 workspace 包能生成 `dist`。
- 当前 package 都是 ESM，并已有 `main`、`types` 和 `exports` 雏形。
- `pnpm pack --dry-run` 当前会把 `src`、`test`、`.turbo` 日志和 `tsconfig.tsbuildinfo` 打入 tarball。
- `tsc -b` 直接输出的 ESM 在 Node 原生 import 下会因无扩展名目录导入失败。
- `workspace:*` 在 `pnpm pack` 中会落成具体版本号。
- `@gamekits/platform-tauri` 已使用 optional peer dependency 表达 Tauri 插件。
- React UI 相关包已校正 React peer dependency 和 CSS 发布入口。
- npm organization/scope 已创建为 `gamekits`。发布到该 scope 的实际包名必须使用 `@gamekits/*`；当前仓库内部长期包名仍是 `@gamekits/*`，Wave 1 前需要决定是整体迁移 scope，还是继续使用临时 publish metadata 映射。

## Toolchain Direction

优先试点 `tsdown`，因为它基于 Rolldown，并更贴近 TypeScript library 发布需求。试点必须证明：

- 可生成 ESM JS 和 `.d.ts`。
- 可保留 `@gamekits/*` 与第三方 runtime 为 external。
- 可解决 Node 原生 ESM import 问题。
- 可复制或输出 CSS 入口到 `dist/styles.css`。
- 可与 Turbo、pnpm workspace 和现有 `tsc -b` 项目引用共存。
- 可支持所有纯 TS 包、React TSX 包和 adapter/driver 包。

若试点失败，回退候选：

- 直接使用 Rolldown 配置。
- 使用其他成熟 library bundler，但仍遵守 ADR 0008 的发布产物和 manifest 规则。

## First Release Batch Plan

第一批发布目标不是一次性把所有未来能力产品化，而是让外部项目可以完成三条最小消费路径：

- Headless runtime / rules test：只安装核心 runtime、world、data、rules 和测试工具即可在外部项目跑逻辑测试。
- Web + Phaser app：安装 App Host、Web platform、Phaser driver 和相关 facade 即可启动一个真实游戏应用组合。
- React UI / DevTools：安装 UI runtime、React UI 和 DevTools UI 时不会引入多份 React，并能正确消费 CSS 入口。

第一批仍不正式发布 npm latest。所有包先以 tarball smoke test 和 alpha channel 为验收目标。

### Wave 0：Build And Manifest Foundation

目标：建立所有后续 package 共用的发布构建和 manifest 规则。

涉及范围：

- 根目录构建脚本。
- 可共享的 tsdown / Rolldown 系配置。
- package manifest 模板和校验脚本。
- package dry-run / smoke test 脚本。

实现步骤：

1. 增加 library build 试点配置，优先使用 `tsdown`。
2. 保留 `tsc -b` 作为类型检查门禁，把 bundler 输出作为发布产物来源。
3. 设计共享 external 规则：所有 `@gamekits/*`、React、Phaser、Koota、Tauri plugin、Vite/Vitest/test-only 依赖不被错误打进相邻包。
4. 统一 manifest 字段：`files`、`exports`、`main`、`types`、`publishConfig`、`sideEffects`。
5. 增加 tarball 内容检查，至少禁止 `src/`、`test/`、`.turbo/`、`*.tsbuildinfo`、app dist 和缓存进入包。
6. 增加 smoke test 脚本，在临时目录安装 tarball 并验证 Node ESM 和 Vite import。

验收：

- `@gamekits/core` 可通过 tsdown 试点构建。
- `@gamekits/core` tarball 只包含发布所需内容。
- Node 原生 ESM 可以 import `@gamekits/core` 的 tarball 安装结果。

### Wave 1：Headless Core Packages

目标：先发布最小 headless 能力，让其他项目能在没有 renderer、driver、React 或平台 adapter 的情况下消费 GameKits。

包清单：

| Package                  | 角色                   | 首批发布原因                                   |
| ------------------------ | ---------------------- | ---------------------------------------------- |
| `@gamekits/core`         | 薄内核工具             | 所有包的底层基础，最小 tsdown 试点包。         |
| `@gamekits/event-bus`    | 低频事件               | GameRuntime、TCA、GAS 的基础事件能力。         |
| `@gamekits/world`        | ECS facade             | gameplay 不直接绑定 Koota 的稳定边界。         |
| `@gamekits/world-koota`  | ECS adapter            | 提供当前默认 world 实现。                      |
| `@gamekits/game-runtime` | GameModule lifecycle   | headless 游戏会话最小运行时。                  |
| `@gamekits/data`         | 数据注册与诊断         | TCA/GAS/Asset 等数据驱动基础。                 |
| `@gamekits/tca`          | 数据驱动规则           | 低频规则系统，headless 测试价值高。            |
| `@gamekits/gas`          | Ability/effect runtime | 验证更复杂 gameplay module 依赖链。            |
| `@gamekits/test-utils`   | 契约测试工具           | 方便外部项目验证 adapter 和 headless runtime。 |

补充说明：`@gamekits/test-utils` 依赖 `@gamekits/platform-core` 和 `@gamekits/renderer-core` 的 conformance helper 类型，因此 Wave 1 的完整本地闭环需要把这两个薄协议包作为支撑包一起验证。它们仍不改变 Wave 2 的 Web/App Host/Phaser 目标，只是解除 `test-utils` 的发布依赖缺口。

主要改动：

- 为这些包移除 `private: true`，补齐 `files`、`publishConfig` 和 `sideEffects`。
- 将 `@gamekits/*` workspace 依赖保持为本地开发依赖，确认 pack 后落成明确版本号。
- 运行 package dry-run，确认 tarball 仅包含 `dist` 和必要 metadata。
- 增加 headless smoke test：外部项目安装这些 tarball 后创建 runtime、world、event bus，并执行一个最小 tick 或 TCA/GAS import 验证。

暂不纳入：

- `@gamekits/app-host`，因为它依赖更多 app service facade。
- Renderer、Input、Platform、Save、UI、DevTools，避免第一轮混入浏览器、CSS、React 和 driver 变量。

验收：

- 外部 Node ESM 项目可以 import 所有 Wave 1 包。
- Headless smoke test 不依赖 workspace path alias。
- `corepack pnpm test` 和 `corepack pnpm build` 通过。

### Wave 2：Web App Host And Phaser Path

目标：让外部项目能以 Web + Phaser 方式启动真实 GameKits app 组合。

包清单：

| Package                     | 角色                     | 首批发布原因                                             |
| --------------------------- | ------------------------ | -------------------------------------------------------- |
| `@gamekits/platform-core`   | 平台 facade              | App Host 标准服务基础。                                  |
| `@gamekits/platform-web`    | Web platform adapter     | Web app 的默认平台实现。                                 |
| `@gamekits/driver-core`     | Driver facade            | Phaser driver 的稳定协议。                               |
| `@gamekits/renderer-core`   | Renderer facade          | Driver/renderer adapter 依赖的核心协议。                 |
| `@gamekits/renderer-phaser` | Phaser renderer adapter  | Phaser driver 共享 scene runtime 的 render object 映射。 |
| `@gamekits/input-core`      | Input facade             | App Host 输入服务和 driver input source 的核心协议。     |
| `@gamekits/input-dom`       | DOM input adapter        | Web app 非 Phaser 输入来源。                             |
| `@gamekits/camera-core`     | Camera toolkit           | Phaser driver camera adapter 和标准 camera module 依赖。 |
| `@gamekits/asset`           | Asset manager            | App Host asset preload 与 Phaser asset loader 入口。     |
| `@gamekits/save`            | Save manager             | App Host 常见应用服务，依赖 platform-core。              |
| `@gamekits/devtools`        | Headless tooling runtime | App Host diagnostics 和后续 DevTools UI 基础。           |
| `@gamekits/ui-core`         | UI facade                | App Host UI service 和后续 React UI 基础。               |
| `@gamekits/driver-phaser`   | Phaser driver            | 当前默认真实 renderer/input/asset/camera driver。        |
| `@gamekits/app-host`        | 应用组合入口             | 下游项目最主要的启动入口。                               |

主要改动：

- 为 Wave 2 包应用同一套 build 和 manifest 规则。
- 确认 `@gamekits/driver-phaser` 将 Phaser 作为 driver-owned dependency，不把 Phaser 泄漏到 core facade。
- 确认 `@gamekits/renderer-phaser` 只依赖 core protocol 和 renderer facade，发布 API 不暴露 Phaser 原生类型。
- 增加 Web + Phaser smoke test：在临时 Vite app 中安装 tarball，import `@gamekits/app-host`、`@gamekits/platform-web`、`@gamekits/driver-phaser`，验证 app definition/profile 能被构造。
- 对 Phaser runtime boot 做轻量 smoke test 时允许只验证 import 和 factory 创建；真实 canvas boot 放到 sandbox / abyss dogfood，避免临时测试对浏览器环境过重。

暂不纳入：

- `@gamekits/platform-tauri`，因为它需要 Tauri plugin peer 和真实 Tauri app 验证，可作为 Wave 4。
- React UI 和 DevTools UI，放到 Wave 3 专门处理 peer/CSS。

验收：

- 外部 Vite app 可以 import Wave 2 组合包。
- `@gamekits/driver-phaser` 安装时带入 Phaser，但安装非 driver 包不会带入 Phaser。
- Sandbox 或 Abyss Delve 能继续通过 workspace 依赖构建，证明发布 build 不破坏本仓库开发路径。

### Wave 3：React UI And DevTools UI

目标：让 UI 包具备可发布形态，并解决 React peer dependency 与 CSS 导出。

包清单：

| Package                 | 角色                    | 首批发布原因                          |
| ----------------------- | ----------------------- | ------------------------------------- |
| `@gamekits/react-ui`    | React UI implementation | 游戏 UI 和工具 UI 的默认 React 实现。 |
| `@gamekits/devtools-ui` | DevTools React UI       | 外部 app 调试入口需要的 UI 包。       |

主要改动：

- 将 `react`、`react-dom` 从 dependency 调整为 peer dependency，并保留 dev dependency 用于本仓库构建和测试。
- 判断 `gsap`、`tailwindcss` 的归属：若 React UI 内部直接 import 并执行，保留 dependency；若只作为宿主构建样式能力，再改为 peer 或 optional peer。
- 将 `./styles.css` exports 指向 `./dist/styles.css`。
- 为 CSS 入口补复制或 bundler 输出步骤。
- 设置 `sideEffects`，至少包含 CSS 入口；不能把 UI 包整体误标为无副作用后导致 CSS 被 tree-shaking 丢弃。
- 增加 React smoke test：外部 Vite React app 安装 tarball 后 import React UI、DevTools UI 和 CSS，确认依赖树只有一份 React。

验收：

- 外部 React app 可 import `@gamekits/react-ui`、`@gamekits/devtools-ui` 和对应 CSS。
- `pnpm why react` 或等价检查显示宿主 React 被 peer 复用。
- React UI / DevTools UI tests 继续通过。

### Wave 4：Optional Platform Follow-up

目标：在第一批核心发布验证稳定后，再发布 Tauri adapter。

候选包：

- `@gamekits/platform-tauri`

原因：

- 该包已有 optional peer dependency 方向，但真正验收需要 Tauri app 环境和 plugin 权限配置。
- 它不是 Web + Phaser 首批消费路径的必要条件。

验收：

- 外部 Tauri app 安装 tarball 后可 import adapter。
- 未安装 Tauri plugin 的普通 Node/Vite 项目不会因 optional peer 产生硬失败。

## Tasks

| Task                               | Status   | Notes                                                                                                                                                 |
| ---------------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| 新增发布 ADR                       | Verified | 已创建 `docs/adr/0008-package-publication-and-build-toolchain.md`。                                                                                   |
| 补充长期发布最佳实践               | Verified | 发布实践写入 `docs/best-practices.md`。                                                                                                               |
| Wave 0：构建与 manifest 基础       | Verified | 已用 `@gamekits/core` 跑通 tsdown、manifest、dry-run 和外部 Node ESM smoke test。                                                                     |
| Wave 1：Headless core packages     | Verified | 已完成 core/event-bus/world/platform-core/renderer-core/world-koota/game-runtime/data/tca/gas/test-utils 的 npm alpha 发布、registry 安装和 smoke。   |
| Wave 2：Web App Host + Phaser path | Verified | 已完成 Web/App Host/Phaser 路径新增包的 npm alpha 发布、registry 安装和 smoke。                                                                       |
| Wave 3：React UI + DevTools UI     | Verified | 已完成 React UI/DevTools UI 的 npm alpha 发布、registry 安装、React peer 和 CSS export smoke。                                                        |
| Wave 4：Tauri optional platform    | Planned  | 第一批核心验证后再发布 platform-tauri。                                                                                                               |
| 接入 Changesets                    | Verified | 已接入 Changesets lockstep 固定包组、alpha pre mode、自动 changeset 生成和 GitHub Actions version PR/publish workflow。                               |
| GitHub Actions 发布流水线          | Verified | 已新增 CI、Auto Changeset、Release Verify、Release、Registry Smoke workflows；release workflow 用参数控制 dist-tag，不把 alpha 固化为 workflow 身份。 |
| 更新 README 安装示例               | Planned  | 面向 Web + Phaser、headless test、Tauri app 三类消费路径。                                                                                            |

## Acceptance Criteria

- 可发布包 tarball 不包含 `src`、`test`、`.turbo`、`tsconfig.tsbuildinfo`、app dist 或本地缓存。
- Node 原生 ESM 可以 import 至少一个纯核心包。
- Vite app 可以安装 tarball 并 import `@gamekits/app-host`、`@gamekits/platform-web`、`@gamekits/driver-phaser`。
- React UI 下游不会安装第二份 React。
- CSS 子路径从 `dist/styles.css` 导出。
- `corepack pnpm lint`、`corepack pnpm test`、`corepack pnpm build`、`corepack pnpm format` 通过。
- 发布流程可以生成并验证 alpha 版本；latest 发布和 changelog 自动化留到后续 release automation。

## Verification Log

- 2026-06-07：`corepack pnpm build` 通过。
- 2026-06-07：`corepack pnpm --filter @gamekits/core pack --dry-run` 显示 tarball 内容包含源码、测试、缓存日志和 tsbuildinfo，需要收敛。
- 2026-06-07：Node 原生 import `packages/core/dist/index.js` 失败，错误为 `ERR_UNSUPPORTED_DIR_IMPORT`，需要 bundler 输出或修正 ESM specifier。
- 2026-06-07：Wave 0 已跑通。`@gamekits/core` 使用 `tsdown` 输出 `dist/index.js`、`dist/index.d.ts` 和 sourcemap；`corepack pnpm --filter @gamekits/core pack --dry-run` tarball 只包含 `dist/index.*` 和 `package.json`；`corepack pnpm verify:release:core` 在临时外部项目安装 tarball 并完成 Node ESM import。
- 2026-06-07：Wave 0 验证命令通过：`corepack pnpm --filter @gamekits/core build`、`corepack pnpm --filter @gamekits/core test`、`corepack pnpm --filter @gamekits/core lint`、`corepack pnpm verify:release:core`、`corepack pnpm build`、`corepack pnpm lint`、`corepack pnpm test`、`corepack pnpm format`。
- 2026-06-07：准备了临时 npm 发布目录 `/private/tmp/gamekits-core-publish`，将 core 发布包 metadata 映射为 `@gamekits/core@0.1.0-alpha.0`。`npm --cache /private/tmp/npm-cache-gamekits pack --dry-run` 显示 tarball 只包含 `dist/index.*` 和 `package.json`，外部临时项目安装 tarball 后可通过 Node ESM import `@gamekits/core`。
- 2026-06-07：尝试执行 `corepack pnpm publish --access public --tag alpha --no-git-checks` 发布 `@gamekits/core@0.1.0-alpha.0`，npm registry 返回 `404 Not Found - PUT https://registry.npmjs.org/@gamekits%2fcore`；随后 `corepack pnpm whoami --registry https://registry.npmjs.org/` 返回 `401 Unauthorized`。原因是原 token 需要 OTP 或未正确授权。
- 2026-06-07：使用新的 automation token 后，registry `/-/whoami` 返回 `liziyu1209`。由于本地 Node/npm DNS 对 `registry.npmjs.org` 连续 `ENOTFOUND`，改用 registry HTTP API 发布；第一次 payload 缺少顶层 `access: "public"` 被 registry 当作 scoped private package 拒绝，补齐后 `PUT https://registry.npmjs.org/@gamekits%2fcore` 返回 `{"success":true}`。`@gamekits/core@0.1.0-alpha.0` 已以 alpha 语义发布成功。
- 2026-06-07：发布后使用 `registry.npmjs.com` host 完成安装验证。`corepack pnpm add @gamekits/core@alpha --registry https://registry.npmjs.com/` 安装到 `0.1.0-alpha.0`，Node ESM import `Clock`、`Registry`、`createSeededRng` smoke test 通过。
- 2026-06-07：Wave 1 本地闭环通过。`corepack pnpm verify:release:gamekits` 构建并生成 `@gamekits/core`、`@gamekits/event-bus`、`@gamekits/world`、`@gamekits/platform-core`、`@gamekits/renderer-core`、`@gamekits/world-koota`、`@gamekits/game-runtime`、`@gamekits/data`、`@gamekits/tca`、`@gamekits/gas`、`@gamekits/test-utils` 的临时发布目录和 tarball；发布 manifest 将内部依赖映射为 `@gamekits/*@0.1.0-alpha.0`，dist 产物不再引用 `@gamekits/*`。临时外部项目安装全部 tarball 后，Node ESM smoke 和 Vitest test-utils smoke 均通过。
- 2026-06-07：尝试从 `/private/tmp/gamekits-wave1-release/packages/*` 用 npm CLI 发布 Wave 1 除 core 外的包，连续遇到 `registry.npmjs.com` DNS `ENOTFOUND`；随后改用 registry HTTP API payload 和 curl 逐包发布。`@gamekits/event-bus`、`@gamekits/world`、`@gamekits/platform-core`、`@gamekits/renderer-core`、`@gamekits/data`、`@gamekits/game-runtime`、`@gamekits/tca`、`@gamekits/gas`、`@gamekits/world-koota`、`@gamekits/test-utils` 均返回 `{"success":true}`。
- 2026-06-07：Wave 1 registry smoke 通过。在 `/private/tmp/gamekits-wave1-registry-consumer` 中通过 `corepack pnpm add ... --registry https://registry.npmjs.org/ --ignore-scripts` 安装所有 Wave 1 包，Node ESM smoke 输出 `registry smoke ok`；随后安装 `@gamekits/test-utils@alpha` 和 `vitest@^3.1.3`，`corepack pnpm exec vitest run test-utils-smoke.test.mjs` 通过。
- 2026-06-07：Wave 2 本地 tarball 闭环通过。`GAMEKITS_RELEASE_WAVE=2 GAMEKITS_RELEASE_DIR=/private/tmp/gamekits-wave2-release corepack pnpm verify:release:gamekits` 构建并生成 Web/App Host/Phaser 路径发布包；Wave 2 闭包收敛为 core/event-bus/world/platform-core/renderer-core/game-runtime/data/tca/gas 加 platform-web/driver-core/renderer-phaser/input-core/input-dom/camera-core/asset/save/devtools/ui-core/driver-phaser/app-host，不再重复拉入 Wave 1 已单独验证的 world-koota/test-utils。
- 2026-06-07：Wave 2 发布构建修正。发布 helper 从递归 `tsc -b` 改为当前包 `tsc -p` 类型检查或 declaration-only 输出，避免构建 app-host 时通过 project references 覆盖前序包的 bundled dist；app-host 暂时使用 `gamekitsBuild.bundleDts=false`，保留 tsc declaration tree 并用 tsdown 输出入口 JS。发布 staging 会清理 `.tsbuildinfo`，并将 npm cache/logs 隔离到 release 目录。
- 2026-06-07：Wave 2 smoke 修正。Save smoke 按 `SaveStore` 协议写入 `Uint8Array` 和 slot summary；UI smoke 使用 `ui.open()` / `ui.openPanels()`；`@gamekits/test-utils` 将 Vitest peer 标为 optional，避免普通 consumer 自动安装测试运行时。
- 2026-06-07：Wave 2 npm alpha 发布成功。通过 `corepack pnpm publish:release:gamekits` 所用的 registry HTTP API 发布脚本，从 `/private/tmp/gamekits-wave2-release` 发布 `@gamekits/input-core`、`@gamekits/camera-core`、`@gamekits/driver-core`、`@gamekits/devtools`、`@gamekits/ui-core`、`@gamekits/asset`、`@gamekits/save`、`@gamekits/platform-web`、`@gamekits/input-dom`、`@gamekits/renderer-phaser`、`@gamekits/driver-phaser`、`@gamekits/app-host` 的 `0.1.0-alpha.0`。
- 2026-06-07：Wave 2 registry smoke 通过。在 `/private/tmp/gamekits-wave2-registry-consumer-gzqzGF` 中通过 `corepack pnpm add @gamekits/...@alpha --ignore-scripts --registry https://registry.npmjs.org/` 从 npm registry 安装 Wave 2 闭包，`node smoke.mjs` 输出 `gamekits wave 2 smoke ok`。安装期间 `@gamekits/ui-core` 一度出现 registry metadata 404/缺 `time` 字段警告，但最终安装和 smoke 均通过。
- 2026-06-07：Wave 3 本地 tarball 闭环通过。`GAMEKITS_RELEASE_WAVE=3 GAMEKITS_RELEASE_DIR=/private/tmp/gamekits-wave3-release corepack pnpm verify:release:gamekits` 构建并生成 `@gamekits/core`、`@gamekits/devtools`、`@gamekits/ui-core`、`@gamekits/react-ui`、`@gamekits/devtools-ui` 的临时发布目录和 tarball；临时外部项目显式安装 React/ReactDOM 后，SSR smoke、DevTools UI bridge smoke 和 `./styles.css` 子路径解析均通过。
- 2026-06-07：Wave 3 npm alpha 发布成功。通过 `corepack pnpm publish:release:gamekits` 所用的 registry HTTP API 发布脚本，从 `/private/tmp/gamekits-wave3-release` 发布 `@gamekits/react-ui` 和 `@gamekits/devtools-ui` 的 `0.1.0-alpha.0`。
- 2026-06-07：Wave 3 registry smoke 通过。在 `/private/tmp/gamekits-wave3-registry-consumer-B8xBGB` 中通过 `corepack pnpm add @gamekits/core@alpha @gamekits/devtools@alpha @gamekits/ui-core@alpha @gamekits/react-ui@alpha @gamekits/devtools-ui@alpha react@^18.3.1 react-dom@^18.3.1 --ignore-scripts --registry https://registry.npmjs.org/` 从 npm registry 安装 UI 闭包；`corepack pnpm list react react-dom --depth 10` 显示 UI 包复用 consumer 顶层 React peer；`node smoke.mjs` 输出 `gamekits wave 3 smoke ok`。
- 2026-06-07：Wave 3 收口验证通过。`corepack pnpm test`、`corepack pnpm build`、`corepack pnpm lint`、`corepack pnpm format` 均通过；首次 format check 发现本文档换行问题，已用 `corepack pnpm exec oxfmt .` 修复后复跑通过。
- 2026-06-07：GitHub Actions 和 Changesets 发布自动化接入。新增 `.github/workflows/ci.yml`、`release-verify.yml`、`release.yml`、`registry-smoke.yml`；`release.yml` 在 push main 时通过 Changesets Action 创建 version PR 或发布，在手动触发时通过 `dist-tag` 输入支持 `alpha`、`beta`、`rc`、`latest`。新增 `.changeset/config.json`，将当前可发布包纳入 fixed lockstep group，并进入 `alpha` pre mode；包版本同步为已发布的 `0.1.0-alpha.0`。
- 2026-06-08：自动 changeset 闭环接入。新增 `.github/workflows/auto-changeset.yml` 和 `scripts/create-auto-changeset.mjs`；同仓库 PR 会根据可发布包的源码、README 或非 version-only manifest 改动自动提交 changeset，main push release job 也会在缺失 changeset 时兜底生成。自动 publish 闸门收紧为只接受 `Version GameKits packages` 版本提交，避免普通 PR 合并后绕过 version PR 直接发布。

## Archived Follow-ups

后续仍有价值的工作应重新进入独立 issue、PR 或新的 implementation 工作流：

- 补 README 安装示例，覆盖 Web + Phaser、headless test、Tauri app 三类消费路径。
- 将 `@gamekits/platform-tauri` 作为单独发布验证工作流处理；Tauri 发布前需要真实 Tauri app import smoke，确认 optional peer 在普通 Node/Vite consumer 中不会变成硬依赖。

## Closure Notes

本工作流关闭时已经把稳定发布实践迁移到 `docs/best-practices.md`，把当前操作流程迁移到
`docs/release.md`。Rolldown 系工具链决策仍由 ADR 0008 维护；若未来发布工具链变化，应新增
ADR 或 supersede ADR 0008。
