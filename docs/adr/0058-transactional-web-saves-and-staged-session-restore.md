# ADR 0058：Web 事务存档与候选会话恢复

状态：Accepted

日期：2026-09-06

## 背景

PlatformStorage 的多 key 写入不具备跨窗口事务，进程内队列也无法阻止旧窗口覆盖新进度。Save 的全量预校验可以阻止非法输入，但 contributor restore 仍可能部分失败。ADR 0056 的文件原子替换和恢复边界继续有效。

## 决策

- 新增具体 adapter 包 @gamekits/save-indexeddb，依赖 Save/Core，使用原生 IndexedDB。浏览器 factory、连接和 transaction 不进入 Save core 或 Platform core。
- 每个 slot 使用一个记录保存当前数据、metadata、上一份有效备份和随机 revision。同一个原生 readwrite transaction 校验 revision 并替换记录；事务完成才报告成功，失败保留整个旧记录。
- 每个连接记住实际读到或成功写入的 revision。已有槽位在覆盖或删除前必须读取；list/exists 不代表接受当前进度。未读或过期写入返回 save.write_conflict，不静默采用 last-writer-wins。
- 数据和 metadata 一起计算 SHA-256 完整性摘要。主记录损坏时 read/list 选择有效备份并发出诊断；读取恢复不修改数据库。后续写入只把有效版本保留为备份。摘要用于损坏检测，不提供加密或对恶意客户端的认证。
- SaveStore 增加可选 readBackup；SaveManager.load 的 backup 选项支持明确选择上一版本。SaveManager.restore 复用同一预校验和 contributor 恢复链路，接收已经迁移的独立 envelope，不再次读取变化中的 store。
- App Host 提供 createSaveSessionController。工厂构造独立可变状态的候选会话，恢复及 activate 都成功后才替换 current。失败仅销毁候选；旧会话清理失败作为已提交结果的 cleanupError 返回，不能伪装成读取失败。
- IndexedDB 的事务、quota、corruption 和 revision 测试使用 fake-indexeddb 作为测试专用依赖，并用真实浏览器验证原生行为。生产代码不依赖该替身。

## 取舍与后果

不增加通用跨平台 transaction facade，也不承诺回滚任意 restore/activate 副作用。候选工厂必须隔离 World、Physics、GAS/TCA 等可变状态，构造失败前的局部资源由工厂清理。会话消费者读取 controller.current()；不能长期缓存旧会话指针。

备份固定保留一代，存储空间约为当前数据与上一版之和。maxSaveBytes 限制单份数据，原生 quota 失败必须提示并保留旧数据。数据库关闭和 versionchange 处理释放连接。IndexedDB 事务并不意味着浏览器永远不会驱逐 origin 数据；需要长期异地持久性时，由应用集成导出或云端 provider。

旧 PlatformStorage/File SaveStore 的格式和行为保持兼容，不自动搬迁或删除玩家旧存档。平台迁移应由应用在读取、校验和成功提交新存储后显式完成。
