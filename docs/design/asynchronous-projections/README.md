# 无阻塞查询与异步投影

## Problem

诊断扫描不得占用文档写入所需的协调资源。CLI 的一次查询可以返回明确标识的历史投影，当前事实门禁必须另行核验。

## Core Mental Model

来源文件拥有事实，HawDB 拥有可丢弃的查询投影。读取使用乐观一致性核验，普通写入只在提交阶段串行化。runner 与数据库维持各自的资源所有权。

## Scope and Tradeoffs

历史投影只服务诊断展示，不授权写入、恢复或证据裁决。查询声明是否要求当前来源；异步刷新有资源预算、进程终结和失败状态。单文件 rename 不构成多文件事务或原子比较交换。

## Entry Points

- [目标](GOALS.md)
- [约束](LIMITS.md)
- [场景](CASES.md)
- [裁决](DECISION.md)
- [异步投影架构](plans/snapshots/architecture.md)

## Constitution

- [C-001](../../constitution.md#c-001)
- [C-003](../../constitution.md#c-003)
- [C-004](../../constitution.md#c-004)
- [C-005](../../constitution.md#c-005)
- [C-013](../../constitution.md#c-013)
- [C-014](../../constitution.md#c-014)
