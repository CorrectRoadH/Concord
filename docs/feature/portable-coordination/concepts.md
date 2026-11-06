# 本地发布协调术语表

本页定义本地写入协调中的概念。[全局术语表](../../concepts.md)中的[租约](../../concepts.md#lease)、[持有者](../../concepts.md#holder)、[journal](../../concepts.md#journal)与[恢复](../../concepts.md#recovery)自动适用于本目录。

## 发布租约 {#publication-lease}

文档写入在提交阶段持有的[租约](../../concepts.md#lease)，由 Git-private 协调目录中的 `publication.lease` 目录实现。读取与准备计划不持有它；它只用 Node 文件 API 实现，不依赖外部锁程序。

旧写法：`写锁`、`写入占用`

## 发布 token {#publication-token}

一次申领发布租约时写进持有者文件的唯一 token。释放与回收只删除观察到的那个 token，之后到来的新持有者不受影响。

## 发布修订号 {#publication-revision}

持久化的计数，独占持有者进入和退出时都前进。读取前后的发布修订号不同时，当前结果以 `SourceChanged` 拒绝。

旧写法：`发布 revision`

## runner 状态 {#runner-state}

runner 租约与运行记录的协调状态：`absent`、`running` 或 `blocked`，`blocked` 带具名原因。状态不确定时报告 `blocked`，恢复保留现场。

## 来源快照 {#source-snapshot}

一次读取记下的文件前像、缺失路径、目录成员与发布修订号。返回前再核对一遍，期间有[漂移](../../concepts.md#drift)或发布就拒绝当前结果。

旧写法：`乐观快照`

来源快照不持有租约，所以读取可以与另一个写入同时进行。
