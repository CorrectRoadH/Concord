---
format: concord.document/v1
id: portable-publication
title: Portable publication coordination
createdAt: 2026-09-22T00:05:18.595Z
kind: design
alternatives:
  - single-lock
  - retain-flock
constitutionRefs:
  - docs/constitution.md#c-001
  - docs/constitution.md#c-002
  - docs/constitution.md#c-003
  - docs/constitution.md#c-007
decision:
  selected: single-lock
  reason: Use Node file leases and short snapshots; preserve cache-only SQLite, current journal recovery and persistent runner cleanup states. Independent Astra design challenge passed.
  at: 2026-09-22T00:22:46.603Z
  targets:
    - docs/feature/portable-coordination/README.md
---

# Portable publication coordination

本设计比较 Node 文件协调与外部 `flock`。共享读取的行为以 [功能验收](../../feature/portable-coordination/use-case/coordinate-local-publications.md) 和 [总架构](../../architecture.md) 为准；缓存边界见 HawDB 设计。

## Problem

本地文件发布需要跨进程互斥、完整前像核验和中断恢复，同时安装后的 CLI 不应依赖外部 flock 或平台磁盘探测工具。比较 Node 文件协调与保留外部 flock 两种实现，保持事实 owner 与证据来源不变。

## Core Mental Model

publication owner 保护短快照与文件事务；journal 保存已准备的完整变更集；runner owner 保护长执行及其进程清理。缓存可丢弃，不能授权发布、恢复或证据关闭。候选须同时满足互斥、安全回收、来源漂移检测与安装可移植性。

## Scope and Tradeoffs

保证范围为同主机、同 PID 命名空间的 Linux/macOS 本地 worktree。保守处理未知 owner 和 runner 清理状态，不按时间抢占，不承诺网络多机协调或混合版本互操作。当前操作依赖范围的重构候选另见 [operation-boundaries](../operation-boundaries/README.md)，其采用状态由对应 metadata 表达。

## Entry Points

- [Goals](GOALS.md): requirements and comparison criteria.
- [Limits](LIMITS.md): constraints shared by every candidate.
- [Cases](CASES.md): neutral scenarios for the comparison.
- [Decision](DECISION.md): explanatory evidence.
候选中的设计论证不替代构建、打包及真实进程验收。
