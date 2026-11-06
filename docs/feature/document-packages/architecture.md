# 文档目录的实现

本页声明文档目录的归属与编辑期间合并检查的重试实现。可观察行为见 [README](README.md)与[编辑期间的合并检查](../documentation-quality/use-case/inspect-writing.md#编辑期间的合并检查)。

## 目录归属

Feature、Engineering 与 Roadmap 的 owner 是目录的 README，附页按最深的合法 owner 归属；嵌套 owner 截断祖先归属。顶层文档包只从物理目录派生，不建立注册表。Design 与 Issue 各是单个文件。

## 编辑期间的检查

目录观察记录路径、类型、大小与权限；扫描器可以按大小跳过文件，因此未读取文件的大小变化也参与观察。

公共 check 的每次尝试创建新的 LocalRepository，完整执行关系与写作检查后验证同一快照，并在下一次尝试前关闭缓存句柄与快照。只有来源观察产生的 `FileChangedSinceRead` 与 `SourceChanged` 属于可重试漂移，不按异常消息匹配。检查成功或产生 findings 后都验证快照，findings 中已确认的 `SourceChanged` 也触发重试；普通格式错误先验证已观察快照，确有漂移才重试，否则返回原错误。权限、`UnsafePath` 与 `RecoveryRequired` 不被漂移覆盖。

快照核验先比较读过的文件摘要与目录集合，再判断 journal；下一次尝试仍重新检查未完成 journal。新仓库遇到存活发布者的暂态现场时，只使用发布租约获取阶段的既有等待；无法证明有存活合作写者的 `RecoveryRequired` 立即失败。重试不用于写操作、runner、证据签发或 dry-run 写入。
