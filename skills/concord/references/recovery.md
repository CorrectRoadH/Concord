# 恢复本地写入与观察状态

Concord 的工作区服务拥有单一服务锁、文档写互斥和外部观察任务槽位。文件是事实来源，HawDB 是可重建缓存；不要用删除缓存代替事务或进程恢复。

```sh
concord recover --json
```

服务启动自动处理未完成的 `journal.json`。目标仍等于前像或计划摘要时完成或回滚；外部编辑优先，清理陈旧 journal 并在 `warnings` 列出保留的路径。恢复不覆盖未知编辑，也不依赖配置文件仍然存在。

输出包含 `operation`、`status`、`changedPaths`、`journalStatus`、`warnings` 与 `observationSlot`。journal 状态为 `clean`、`completed`、`rolledBack` 或 `discarded`；外部观察为 `absent`、`running` 或 `blocked`。

测试收集与语言分析共享观察槽位；Concord 不管理 agent 独立执行的测试。清理未知只阻断新的外部观察，文档读写与 Issue 关闭仍可进行。恢复保留已经完成的 journal 处理结果，不把观察阻断解释成仓库不可写。

持有者已死不证明子进程已清理。先确认同一主机没有遗留收集或分析进程，再使用输出提供的当前 token：

```sh
concord recover --release-observation-slot <token>
```

存活持有者返回 `ObservationSlotActive`；token 或主机不符返回 `ObservationSlotMismatch`。成功释放登记的占用与观察产物，不创建或回收测试核验 worktree。不要手工删除锁、journal、运行状态或未知文件。

`--dry-run` 只属于允许预览的领域写入，`recover` 不接受它。路径、前像与写互斥保护不能用换入口绕过；恢复结果与实际未完成项必须如实报告。
