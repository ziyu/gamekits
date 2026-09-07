# Release Runbook

本文档是 GameKits 当前发布流程的操作入口。长期发布原则写在
`docs/best-practices.md` 的 Package Release 段落；发布构建工具链决策写在
`docs/adr/0008-package-publication-and-build-toolchain.md`；历史落地记录写在
`docs/implementation/package-release-readiness.md`。

## 发布模型

GameKits 使用多包 lockstep 发布。workspace 和 npm 包统一使用 `@gamekits/*` scope。

当前自动发布链路是：

1. 普通 PR 修改可发布包。
2. Auto Changeset workflow 在 PR 分支生成 `.changeset/auto-pr-<number>.md`。
3. PR 合并到 `main`。
4. Release workflow 发现待消费 changeset，创建 `Version GameKits packages` PR。
5. 合并 Version PR。
6. Release workflow 发现没有待消费 changeset，检查 npm registry 中当前版本和 dist-tag。
7. 若当前版本缺失或 dist-tag 过期，workflow 运行 `corepack pnpm release:publish`。
8. npm 发布或幂等 retag 成功后，workflow 创建 `v<version>` Git tag 和 GitHub Release。

普通开发者不手写 changeset。只有自动生成结果明显不符合预期，或要覆盖默认 bump
级别时，才通过 PR label 控制。

## 正常开发如何触发发布

1. 在普通功能或修复 PR 中修改可发布包：
   - `packages/<slug>/src/**`
   - `packages/<slug>/README.md`
   - `packages/<slug>/package.json` 中除 `version` 外的发布相关字段
2. 需要覆盖 bump 级别时给 PR 加一个 label：
   - `changeset:major`、`semver-major` 或 `release:major`
   - `changeset:minor`、`semver-minor` 或 `release:minor`
   - `changeset:patch`、`semver-patch` 或 `release:patch`
3. 等 Auto Changeset workflow 把自动 changeset commit 回 PR 分支。
4. 合并普通 PR。
5. 等 Release workflow 创建 `Version GameKits packages` PR。
6. 检查 Version PR 只包含版本、changelog、lockfile 和 consumed changeset 状态变化。
7. 合并 Version PR。
8. 检查 Release workflow 的 `Publish` job、npm package 页面、GitHub Release 和 `v<version>` tag。

只改 docs、apps、root scripts、workflow 或 release automation 本身时，不会自动生成包版本
changeset。这样的 PR 合并后 Release workflow 仍会运行 registry 状态检查；如果没有缺失版本
或过期 dist-tag，它会跳过 npm 发布。自动流程也会跳过已经存在的 GitHub Release；仅在 Release
缺失时调用创建脚本，保留 npm 已发布后的补建能力。已发布 tag 始终保留在原始发布 commit，
不会随普通主线提交移动。

## Version PR 合并前检查

Version PR 是唯一应该把 package version 推进到下一版的 PR。合并前确认：

- PR 标题是 `Version GameKits packages`。
- 改动来自 Changesets action 或 `corepack pnpm release:version`。
- `corepack pnpm test:release-state` 通过：所有非私有 `packages/*` 都在同一个 Changesets fixed
  group 中，且 manifest version 与 `packages/core` 完全一致。
- `.changeset/pre.json` 仍能被 `corepack pnpm format` 接受。
- lockfile 只体现版本和 workspace 依赖更新。
- CI 和 `Release Verify` 都在 Version PR 的当前 commit 上成功；`action_required`、skipped 或只在
  前一个功能 PR 上成功都不能替代 Version PR 验证。
- 没有混入功能代码、release script 修复或文档治理改动。

如果 Version PR 里混入无关改动，先修 Release workflow 或重新创建 Version PR，不要把
发布状态修复和功能代码混在同一个 Version PR 里。

## 手动触发

正常发布不使用手动 workflow。只有以下情况才使用 `Release` workflow 的
`workflow_dispatch`：

- npm 某个版本已经存在，但 dist-tag 没有指向该版本，需要 retag。
- 发布 job 在 npm 发布成功后、GitHub Release 创建前失败，需要补 Git tag / GitHub Release。
- registry 或 token 故障恢复后，需要重新跑幂等发布。
- 需要对明确版本和明确包集合做受控 backfill。

手动触发参数：

- `version`：默认读取 `packages/core/package.json` 的版本。backfill 时显式填写。
- `dist-tag`：`alpha`、`beta`、`rc` 或 `latest`。
- `packages`：可选的逗号分隔 slug，例如 `core,event-bus`。空值表示当前可发布包集合。

手动触发后仍必须检查 npm registry、GitHub Release 和 workflow 日志。不要用手动 workflow
绕过 Version PR 来做日常版本推进。backfill 必须从与目标版本对应的 commit/tag 运行；发布入口会
拒绝把当前 workspace 的其他版本静默改写成输入版本。

## Release Verify

`Release Verify` workflow 只构建 tarball 并运行外部 consumer smoke，不写 npm registry。

修改可发布包源码、包 manifest、lockfile、发布构建脚本或 Release Verify workflow 的 PR 会自动运行
`Release Verify`，默认验证 `GAMEKITS_RELEASE_WAVE=all`。这条检查用于在合并前发现 workspace
测试发现不了的发布产物问题，例如 scope 重写、tarball 内容、外部安装、peer dependency 和公共 API
消费路径不一致。

发布前排障、受控 backfill 或只验证指定 wave/package 时，也可以手动运行 `Release Verify`
workflow。

本地等价命令：

```bash
corepack pnpm verify:release:gamekits
```

可选环境变量：

- `GAMEKITS_RELEASE_VERSION`：覆盖 release version。
- `GAMEKITS_RELEASE_WAVE`：`all`、`1`、`2` 或 `3`。
- `GAMEKITS_RELEASE_PACKAGES`：逗号分隔 package slug；验证脚本会自动补齐这些包的内部 workspace
  依赖并按依赖优先顺序构建。
- `GAMEKITS_RELEASE_DIR`：指定临时 release staging 目录。

`GAMEKITS_RELEASE_WAVE=all` 会自动发现 `packages/` 下所有非私有包，不依赖手工维护的发布包总表。
Wave 1/2/3 仍负责选择各自的 smoke 入口，但每个 wave 的 tarball 集合都会包含完整内部依赖闭包，避免
干净环境把尚未发布的相邻包错误解析到 npm registry。验证开始前会先检查 public package 集合、
Changesets fixed group 和 workspace version；任何漏配或版本漂移都会在构建 tarball 前失败。

提交发布相关改动前仍要跑仓库根目录验证：

```bash
corepack pnpm test
corepack pnpm test:release-state
corepack pnpm build
corepack pnpm lint
corepack pnpm format
```

## 环境要求

GitHub repository 设置：

- Actions 必须允许 workflow 创建 pull request，否则 Changesets action 无法创建 Version PR。
- `Release` workflow 使用受保护 Environment：`npm-release`。
- `Release` workflow 需要 `id-token: write`，用于 npm Trusted Publishing/OIDC。
- 每个要发布的 `@gamekits/*` 包都应在 npm package settings 中配置 Trusted Publisher：
  `ziyu/gamekits` + `release.yml`。
- `npm-release` 环境必须配置 `NPM_TOKEN` secret 作为新包首发 bootstrap 和 fallback；没有
  Trusted Publisher、OIDC 授权失败或 package 尚未存在于 npm registry 时才使用 token。

npm token fallback 要求：

- 对 `@gamekits` scope 有创建 package 和 publish 权限。
- 可以发布 public scoped package。
- 如果 npm 账号启用了 2FA，token 必须能 bypass 2FA；否则 CI 会报 OTP 相关错误。

当前发布脚本会在发布前检查 npm registry。尚不存在的 `@gamekits/*` 新包会排在已有包之前，
通过 `NPM_TOKEN` 和 npm CLI 首发；如果发现新包但没有 token，workflow 会在发布任何包之前失败。
已有包优先通过 npm CLI 使用 Trusted Publishing/OIDC 发布；若 OIDC 环境不存在、包没有对应
Trusted Publisher 或 npm CLI 返回认证失败，并且存在 `NPM_TOKEN`，才回退到 token publish /
dist-tag。token 只写入发布 job 的临时 npm userconfig，不能写入仓库、日志、命令参数、PR 描述或
issue。

新包首发通常不会带 Trusted Publishing provenance；首发后仍建议在 npm package settings 中补
Trusted Publisher。未补 Trusted Publisher 的包后续版本仍会依赖 `NPM_TOKEN` fallback 发布。

Trusted Publishing 会校验 npm provenance。发布 staging 生成的 package manifest 必须包含
`repository.url: "https://github.com/ziyu/gamekits"`；否则 npm 会因为 provenance 中的仓库来源和
package metadata 不匹配拒绝发布。

## dist-tag 策略

默认 dist-tag 由版本号推断：

- `0.1.0-alpha.N` -> `alpha`
- `0.1.0-beta.N` -> `beta`
- `0.1.0-rc.N` -> `rc`
- 无 prerelease 后缀 -> `latest`

`alpha`、`beta`、`rc` 发布只更新对应 prerelease tag，不覆盖 `latest`。发布脚本会拒绝把
prerelease 版本标记为 `latest`，也会拒绝通过 additional dist-tag 把 `latest` 附加到
prerelease。稳定版进入默认安装入口时，发布不带 prerelease 后缀的版本，并直接使用
`dist-tag=latest`。

Release workflow 会把“版本已存在但 dist-tag 过期”视为需要发布，并走幂等 retag 路径。重复
发布同一版本时，npm 可能返回 `409 cannot modify pre-existing version` 或
`403 You cannot publish over the previously published versions`；这两种情况都应继续同步
dist-tag，而不是失败退出。

## 故障排查

Version PR 没创建：

- 检查普通 PR 是否修改了可发布包的 release-relevant 文件。
- 检查 Auto Changeset workflow 是否因为 fork PR、权限或 labels 没有写回分支。
- 检查 repository Actions 设置是否允许 workflow 创建 pull request。

合并普通 PR 后直接跳过发布：

- 这是正常的第一阶段。应先出现 `Version GameKits packages` PR。
- 只有合并 Version PR 后才应该发布 npm package。

Version PR 合并后没有 npm 发布：

- 看 Release workflow 的 `Check Changesets`，确认没有待消费 changeset。
- 看 `Check Release Needed`，确认当前版本在 registry 中缺失，或 dist-tag 指向旧版本。
- 如果版本和 dist-tag 都已经正确，跳过发布是预期行为。

npm 页面显示旧版本：

- npm 页面默认看 `latest` dist-tag。
- 检查 `https://registry.npmjs.org/-/package/%40gamekits%2Fcore/dist-tags`。
- 若 `alpha` 已更新但 `latest` 仍旧，这是 prerelease 策略；不要为 prerelease 补同步
  `latest`。需要更新默认安装入口时，发布稳定版本并使用 `dist-tag=latest`。

Publish job 报 OTP、401、403 或 404：

- 先确认失败日志是否出现 `Trusted Publisher ... falling back to NPM_TOKEN`。
- 如果失败包是新包，确认 `npm-release` 的 `NPM_TOKEN` 能在 `@gamekits` scope 下创建 public
  scoped package；Trusted Publisher 不能替代新包首发 bootstrap。
- 若期望走 Trusted Publishing，确认失败包也配置了 Trusted Publisher，且 workflow filename 是
  `release.yml`。
- 若期望走 token fallback，更新 GitHub Environment `npm-release` 的 `NPM_TOKEN`，确认 token
  有 publish 权限，并能 bypass 2FA。
- npm 对 scoped package 的未授权 publish 可能返回 `404 {"error":"Not found"}`；这通常仍是认证或
  package access 问题，不代表 tarball 构建失败。

Publish job 报 E422 provenance / repository mismatch：

- 这是 Trusted Publishing 的 provenance 校验失败，不是 npm token 或 Trusted Publisher 授权缺失。
- 检查 release staging 生成的 package manifest，确认 `repository.url` 是
  `https://github.com/ziyu/gamekits`。
- 修复 `scripts/verify-gamekits-release.ts` 的 publish manifest 生成逻辑后重新运行 Release
  workflow；不要把这类错误降级为 token fallback。

Publish job 报版本已经发布：

- 若日志继续出现 `already exists` 和 `tagged ... as ...`，这是幂等 retag 路径，属于正常恢复。
- 若脚本在 retag 前退出，先修发布脚本，再重新运行失败 job。

GitHub Release 没创建：

- 先确认 npm publish / retag step 是否成功。
- `create-github-release.mjs` 是幂等的；同一 tag 已存在且指向同一 commit 会跳过。
- 如果 tag 指向不同 commit，不要移动 tag，先调查错误版本来源。

registry smoke 失败：

- 不要跳过 registry smoke。
- 允许重试网络不稳定导致的安装失败。
- 至少一次必须从 npm registry 安装公开包并完成外部 consumer smoke。
