# 本地写入协调术语表

本页定义本地写入协调中的概念。[全局术语表](../../concepts.md)中的[写互斥](../../concepts.md#write-exclusion)、[持有者](../../concepts.md#holder)、[journal](../../concepts.md#journal)与[恢复](../../concepts.md#recovery)自动适用于本目录。

## 发布修订号 {#publication-revision}

写入提交完成时递增的计数，用于标识工作区图的受管写入变化。

旧写法：`发布 revision`

## 外部观察任务槽位 {#observation-slot}

工作区服务内同一项目目录唯一的受管外部观察位置。测试收集与语言分析共用它；长时间观察不进入[写互斥](../../concepts.md#write-exclusion)，不管理 agent 独立运行的测试。

## 外部观察任务状态 {#observation-slot-status}

[外部观察任务槽位](#observation-slot)的状态：`absent`、`running` 或 `blocked`，`blocked` 带具名原因。自有外部进程组清理不确定时报告 `blocked`，只阻断新的外部观察。

## 来源快照 {#source-snapshot}

一次读取访问的工作区文件视图与摘要记录。通过工作区服务的增量工作区图与 `(mtime, size, inode)` 快速核对一致性，不阻塞并发读取。

旧写法：`乐观快照`
