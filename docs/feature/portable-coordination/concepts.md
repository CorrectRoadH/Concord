# 本地发布协调术语表

本页定义本地写入协调中的概念。[全局术语表](../../concepts.md)中的[租约](../../concepts.md#lease)、[持有者](../../concepts.md#holder)、[journal](../../concepts.md#journal)与[恢复](../../concepts.md#recovery)自动适用于本目录。

## 发布租约 {#publication-lease}

文档与源码写入在提交阶段持有的短期写独占（工作区服务内为进程内写互斥，无服务单次模式下为 Git-private 协调目录锁）。读取与准备计划不持有它。

旧写法：`写锁`、`写入占用`

## 发布 token {#publication-token}

一次独占写入或实例持有的唯一标识 token，用于识别并回收已退出的持有者。

## 发布修订号 {#publication-revision}

写入提交完成时递增的计数，用于标识工作区图的受管写入变化。

旧写法：`发布 revision`

## runner 状态 {#runner-state}

单槽测试任务的运行状态：`absent`、`running` 或 `blocked`，`blocked` 带具名原因。外部测试子进程组清理不确定时报告 `blocked`。

## 来源快照 {#source-snapshot}

一次读取访问的工作区文件视图与摘要记录。通过工作区服务的增量工作区图与 `(mtime, size, inode)` 快速核对一致性，不阻塞并发读取。

旧写法：`乐观快照`
