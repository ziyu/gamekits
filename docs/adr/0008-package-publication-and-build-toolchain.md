# ADR 0008：采用多包发布与 Rolldown 系工具链

## Status

Accepted

## Context

GameKits 的长期定位是可复用游戏框架，不是单一游戏仓库。当前仓库已经按 `@gamekits/*` 拆分出薄内核、facade、adapter、driver、App Host、UI、DevTools 和测试工具包。其他项目未来需要按自身运行环境和技术选型组合这些包，而不是复制本仓库源码或安装一个包含所有能力的巨型包。

当前发布前仍存在几个工程问题：

- 所有 workspace package 仍标记为 `private: true`。
- `pnpm pack --dry-run` 会把 `src`、`test`、`.turbo` 日志和 `tsconfig.tsbuildinfo` 打入 tarball。
- 直接使用 `tsc -b` 输出的 ESM 会保留无扩展名相对导入，例如 `export * from "./runtime"`；这对 Vite 等 bundler 友好，但对 Node 原生 ESM 不够稳。
- React UI 和 DevTools UI 这类包需要把 React 作为宿主 peer dependency，避免下游出现多份 React。
- CSS 入口需要从发布产物导出，而不是指向源码目录。

发布能力本身会影响包边界、依赖策略和下游使用方式，因此需要作为架构决策记录。

Rolldown 是 Rust 实现、Rollup 兼容取向的 bundler。官方仓库描述其目标是作为 Rollup 的快速替代，并面向未来支撑 Vite 底层打包能力。Rolldown 官方生态中的 `tsdown` 面向 TypeScript library 打包，基于 Rolldown，提供 library-oriented 默认配置和 declaration file 生成能力。GameKits 的包都是 TypeScript ESM library，且需要稳定控制 external、exports、d.ts、CSS asset 和 tarball 内容，因此 Rolldown 系工具链与本项目发布需求匹配。

参考：

- https://github.com/rolldown/rolldown
- https://tsdown.dev/guide/
- https://tsdown.dev/options/dts

## Decision

GameKits 采用多包发布，而不是单包发布。

包发布形态按架构职责分层：

- 基础薄内核：`@gamekits/core`、`@gamekits/event-bus`、`@gamekits/game-runtime`。
- Facade / toolkit：`@gamekits/world`、`@gamekits/renderer-core`、`@gamekits/input-core`、`@gamekits/camera-core`、`@gamekits/platform-core`、`@gamekits/driver-core`、`@gamekits/data`、`@gamekits/asset`、`@gamekits/save`、`@gamekits/ui-core`。
- Gameplay module：`@gamekits/tca`、`@gamekits/gas`。
- Adapter / driver：`@gamekits/world-koota`、`@gamekits/input-dom`、`@gamekits/platform-web`、`@gamekits/platform-tauri`、`@gamekits/renderer-phaser`、`@gamekits/driver-phaser`。
- 应用组合入口：`@gamekits/app-host`。
- 工具和 UI：`@gamekits/devtools`、`@gamekits/react-ui`、`@gamekits/devtools-ui`。
- 测试辅助：`@gamekits/test-utils`。

`apps/sandbox` 和 `apps/abyss-delve` 不作为 npm package 发布。它们是验证应用和示例源码，继续保持 private。

发布构建采用“TypeScript 项目检查 + library bundler 输出”的两段式：

1. `tsc -b` 继续负责项目引用、类型检查和 declaration 质量门禁。
2. 包级发布 build 只处理当前包：普通包用 `tsc -p --noEmit` 做类型检查，复杂包可用 `tsc -p --emitDeclarationOnly` 生成当前包 declaration tree。不要在包级发布 build 中递归 emit project references，避免后构建的聚合包覆盖前序包已经 bundler 处理过的 `dist`。
3. Library bundler 负责最终 `dist` 产物，必须生成可被 Node ESM 和主流 bundler 消费的 JS、类型声明和 CSS 产物；个别 declaration bundler 不稳定的包可以保留 tsc declaration tree，同时仍由 bundler 输出入口 JS。

首选候选工具为 Rolldown 系上层工具 `tsdown`，而不是直接手写 Rolldown 配置。原因：

- GameKits 需要的是 library package 发布，不是 app bundle。
- `tsdown` 已把 Rolldown、TypeScript declaration、external 和 library defaults 收敛为更贴近包发布的接口。
- 直接使用 Rolldown 会让每个包承担更多 d.ts、CSS copy、external 和 package exports 维护成本。

如果 `tsdown` 在实际试点中无法满足这些门禁，可以回退到直接 Rolldown 配置或其他成熟 library bundler；回退不改变“多包发布 + bundler 输出发布产物”的决策。

## Package Manifest Rules

每个可发布包必须显式声明发布边界：

```json
{
  "private": false,
  "type": "module",
  "files": ["dist", "README.md", "LICENSE"],
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  },
  "publishConfig": {
    "access": "public"
  }
}
```

有 CSS 入口的包必须从发布产物导出 CSS：

```json
{
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    },
    "./styles.css": "./dist/styles.css"
  },
  "sideEffects": ["./dist/styles.css"]
}
```

纯逻辑包可以声明 `sideEffects: false`。存在 CSS、全局注册或必要模块副作用的包不能盲目声明无副作用。

## Dependency Rules

`@gamekits/*` 包之间采用 workspace 依赖进行本地开发，发布产物必须落成明确版本号。初期采用 lockstep 版本策略，降低跨包兼容心智成本。

第三方依赖按所有权处理：

- Driver 或 adapter 明确拥有的底层 runtime 可以作为该包 dependency，例如 `@gamekits/driver-phaser` 依赖 `phaser`，`@gamekits/world-koota` 依赖 `koota`。
- 宿主应用必须共享的 UI runtime 使用 peer dependency，例如 `react`、`react-dom`。
- 平台插件按可选 peer dependency 管理，例如 Tauri plugin。
- 核心 facade、DataType、GameModule 公共 API 和 gameplay 包不得暴露 Phaser、Koota、React、Tauri 等第三方类型。

## Release Channels

首个外部发布使用 alpha tag，不直接进入 latest：

- `0.1.0-alpha.N`：验证包形态、外部安装、Node ESM、Vite、React peer 和 app dogfood。
- `0.1.x` latest：alpha 验证通过后发布，作为早期稳定 API 起点。

2026-06-13 补充：实际 npm scope 在首个 alpha 发布后已经存在 `latest` tag。如果 `latest`
仍指向旧 alpha，npm 默认包页和默认安装入口会误导下游使用旧包。因此曾允许在尚无稳定版本的
alpha-only bootstrap 阶段把 `latest` 同步到当前 alpha。

2026-06-30 修订：npm Trusted Publisher/OIDC 覆盖 publish / staged publish，不适合作为已发布
版本的后置 dist-tag 修改授权；后置同步 `latest` 需要传统 npm 写认证，容易让 package publish
成功后在 retag 阶段失败。发布自动化不再允许 prerelease 同步或附加 `latest`。稳定版进入默认安装
入口时，直接发布不带 prerelease 后缀的版本并使用 `dist-tag=latest`。

每次发布必须经过：

- lint / test / build / format。
- package dry-run 检查 tarball 内容。
- 外部项目 smoke test，从 tarball 或 registry 安装公开包，而不是依赖 workspace alias。
- 至少一个真实验证 app dogfood。

## Consequences

收益：

- 下游项目可以按需安装 facade、adapter、driver 和 App Host，避免默认引入 Phaser、React、Tauri 等不需要的能力。
- 包边界与架构文档保持一致，第三方库仍被限制在 adapter、driver 或 app UI 层。
- 发布产物比 `tsc` 原始输出更适合 Node ESM 和 npm 消费。
- `files` 白名单让 npm 包保持干净，避免测试、源码、缓存和本地构建信息进入 tarball。
- `tsdown` 让 Rolldown 的性能和 Rollup-compatible 生态以更低配置成本进入 library 发布流程。

代价：

- 需要统一 package manifest、CSS 输出、peer dependency 和 external 策略。
- 需要新增发布前 smoke test 和 tarball 内容检查。
- lockstep 版本初期会让一些未改动包也随发布升版本，但能换来更简单的兼容关系。
- 若 `tsdown` 或 Rolldown 在某些 package 场景中不成熟，需要保留回退路径。

后续实现记录放在 `docs/implementation/package-release-readiness.md`。长期通用实践沉淀到 `docs/best-practices.md`。
