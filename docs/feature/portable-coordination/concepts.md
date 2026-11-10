# 本地写入协调术语表

本页定义本地写入协调中的概念。[全局术语表](../../concepts.md)中的[写互斥](../../concepts.md#write-exclusion)、[持有者](../../concepts.md#holder)、[journal](../../concepts.md#journal)与[恢复](../../concepts.md#recovery)自动适用于本目录。

## 发布修订号 {#publication-revision}

写入提交完成时递增的计数，用于标识工作区图的受管写入变化。

旧写法：`发布 revision`

## 测试任务槽位 {#test-slot}

工作区服务内同一项目目录唯一的测试执行位置。CLI、Web 与修复核验共用它；长时间执行不进入[写互斥](../../concepts.md#write-exclusion)。

旧写法：`runner 租约`、`runner 槽`

## 测试任务状态 {#test-slot-status}

[测试任务槽位](#test-slot)的状态：`absent`、`running` 或 `blocked`，`blocked` 带具名原因。外部测试子进程组清理不确定时报告 `blocked`。

旧写法：`runner 状态`

## 来源快照 {#source-snapshot}

一次读取访问的工作区文件视图与摘要记录。通过工作区服务的增量工作区图与 `(mtime, size, inode)` 快速核对一致性，不阻塞并发读取。

旧写法：`乐观快照`
