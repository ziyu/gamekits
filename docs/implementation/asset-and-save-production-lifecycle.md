# 资源生命周期与存档保护

状态：Closed

关闭日期：2026-09-06

## 范围

- 资源 scope/shared ownership、并发与预算、取消/晚到结果、Driver 清理、Host preload ownership。
- IndexedDB 原子记录与备份、冲突/损坏/容量处理、Save snapshot restore、候选会话切换。
- 不包括公共 API 兼容性平台、完整浏览器 CI 或发布新版本。

## 设计

长期决策见 ADR 0057、0058；协议和集成示例见 Assets、Save、App Host 模块文档。

## 验证记录

- Node 24.15.0：`corepack pnpm test --concurrency=2 -- --maxWorkers=2` 通过，95 个 Turbo 任务成功，185 个文件 / 1047 个 Vitest 用例通过，另有 5 个根目录发布状态检查通过。
- 最后补充 GLTF 多 scene 清理、Phaser 音频实例释放和恢复期间 dispose 的回归后，相关模块 15 个文件 / 111 个用例全部通过。GLTF 用例先复现非默认 scene 未释放，再验证修复。
- `corepack pnpm build --concurrency=2`：52/52；`corepack pnpm lint --concurrency=2`：95/95；`corepack pnpm format`：通过。最终会话关闭保护另行通过 App Host 构建检查。
- `corepack pnpm bench:world`：10,000 entities，spawn/add 13.85 ms，query/update 9.19 ms；`corepack pnpm bench:checkpoint:check`：12 项预算检查通过。这些数字是本机观测，不代表所有设备的性能承诺。
- 真实 Chromium：原生连接拒绝旧修订覆盖、备份可读、恢复失败保留当前会话、损坏回退，共 4 项通过；使用独立临时数据库并删除。
- 真实 Phaser：20 轮共享加载/最终释放；真实 Three WebGL：20 轮纹理上传/释放，GPU texture 计数均回到基线。资源单元测试另覆盖 100 轮场景作用域清理。
- 现有 Three Capability Lab 启动成功，预加载与 Tokyo 延迟加载正常，6/6 资源就绪，实际画面已检查。临时浏览器空间与服务已关闭。
- `corepack pnpm verify:release:gamekits`：全部 43 个公开包的 tarball、内部 scope 重写、外部安装及 consumer smoke 通过，包括新增 `@gamekits/save-indexeddb` 的公开入口。该命令不发布 npm。
- GitNexus 独立索引 `gamekits-reliability` 已刷新；`detect-changes --scope all` 以及与 `origin/main` 的比较已审阅。资源/Driver 入口风险较高，影响集中在 Asset、Save、Host、Driver 和现有示例启动链。新增未跟踪文件另作源码与测试审阅；本地 `main` 滞后，未将其历史差异归入本轮改动。

## 验证中的环境问题

默认高并发运行曾导致 Audio Lab 的 5 秒用例超时；其独立运行通过，限制 worker 后全仓通过。Arena 长时对局用例在索引与图形页面同时运行时也曾超时；关闭这些负载后全仓通过。没有放宽断言、修改原测试超时或跳过用例。

## 交付状态

长期 API、所有权与应用集成边界已迁移到 Assets、Save、App Host、Driver 文档及 ADR 0057/0058。实现提交为 `10d2c07`，功能合并与 CI 记录见 [PR #38](https://github.com/ziyu/gamekits/pull/38)。版本由正常 Auto Changeset / Version PR 流程生成，发布结果以关联版本 PR 和 GitHub Release 为准。
