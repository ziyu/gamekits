# ADR 0056：运行时失败边界与存档提交契约

状态：Accepted

日期：2026-09-06

## 背景

异步生命周期、同步事件重入、输入失效和存档失败都是框架公共行为的一部分。仅覆盖正常路径无法保证模块资源释放和游戏进度安全。

文件存档的数据与 metadata 分开写入会产生半提交；只有 read/write 的文件 facade 无法实现可靠替换。加载时逐项 validate/restore 会使后续校验失败留下部分状态变更。

## 决策

- PlatformFileSystem 增加可选 `replaceFile(source, target, options)` 和 `remove(path, options)`。replaceFile 只承诺同目录原子替换：失败保留 target，成功时移走 source。没有能力的 adapter 不暴露该方法，Save 在写入前拒绝不支持的组合。
- File SaveStore 将 opaque bytes 的 base64 与 slot summary 放入单个 `gamekits.slot.v1` 记录，先写唯一临时文件，再替换 `.slot`。读取兼容旧 `.save` / `.json`，新记录优先；删除先清理旧副本再清理新记录，避免旧进度复活。临时文件不参与列表。
- PlatformStorage 和文件 store 在共享同一个底层平台对象的包装实例之间串行执行修改。同进程串行化不代表跨窗口事务。PlatformStorage 保留既有格式和 API，不承诺多 key 的崩溃原子性。
- Save load 在任何 restore 前检查 envelope 结构、app/game 身份、迁移结果、全部选中必需 section、精确 section 版本及 contributor validate。版本差异必须由迁移明确处理。
- App Host 串行执行 lifecycle，boot 幂等，dispose 为终态；boot/start 失败立即停止依赖链，stop/dispose 尝试所有逆序清理并汇总错误。标准 Driver hook 的 Promise 必须被等待。
- GameRuntime 构造失败时释放已完成安装的模块；模块自己负责 install 返回前失败的局部资源。dispose 即使遇到事件监听器或 cleanup 异常，也尝试所有剩余释放。
- InputRouter 增加 `cancelAll()`。禁用/删除 context、注销/重绑 action、交互域外释放及主动取消都清理 held 状态并向原消费者发送 `cancelled`；App Host 停止 Input 服务时调用取消入口。

## 备选方案

原地覆盖或临时文件写完后复制回目标都无法防止目标写入中断。数据文件和 metadata 各自 rename 也无法保证它们一起提交。版本化日志能提供恢复能力，但对于当前本地单槽覆盖需求增加了索引、回收和恢复协议，因此采用单文件原子替换。

任意 contributor restore 都可能执行外部副作用，框架无法自动回滚。此次明确预校验边界，恢复期异常由 app 采用 staging、重新创建会话或自定义回滚策略；不把预校验称为整个 load 的事务。

## 后果

文件存档需要支持原子替换和删除的 adapter。旧存档可读，新写入采用单记录格式，base64 有体积开销。原子替换不等于 fsync，也不承诺断电持久性；跨进程写入仍需 app 的单写者或锁策略。

取消输入会产生新的 cancelled 通知，消费 held 状态的业务必须处理释放和取消。应用的文本框/DevTools 焦点仍由 app/UI 集成映射，核心协议不依赖 DOM。

稳定协议和集成实践分别维护在 Platform、Save、Input、App Host、Core Runtime 模块文档。
