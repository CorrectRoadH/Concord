# 文档目录的实现

本页声明文档目录的归属与编辑期间合并检查的重试实现。可观察行为见 [README](README.md)与[编辑期间的合并检查](../documentation-quality/use-case/inspect-writing.md#编辑期间的合并检查)。

## 目录归属

Feature、Engineering 与 Roadmap 的 owner 是目录的 README，附页按最深的合法 owner 归属；嵌套 owner 截断祖先归属。顶层文档包只从物理目录派生，不建立注册表。Design 与 Issue 各是单个文件。

## 编辑期间的检查

公共 `check` 直接基于工作区服务的内存增量工作区图执行关系与写作检查：未发生 `(mtime, size, inode)` 变化的文件直接复用已解析结果，仅对变更文件重读字节、校验摘要并增量重算 finding，不再每次重建 `LocalRepository` 或关闭持久缓存句柄。

检查期间若检测到正在进行的并发修改，等待增量合并完成后返回一致结论；陈旧或中断的 `journal.json` 在服务启动或恢复时自动清理，不以 `RecoveryRequired` 阻断只读检查。
