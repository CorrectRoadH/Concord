---
format: concord.document/v1
id: operation-boundaries
title: 按操作依赖划分读取、发布与恢复边界
createdAt: 2026-09-26T23:36:59.072Z
kind: design
alternatives:
  - scoped
  - global
constitutionRefs:
  - docs/constitution.md#c-001
  - docs/constitution.md#c-003
  - docs/constitution.md#c-004
  - docs/constitution.md#c-007
  - docs/constitution.md#c-012
  - docs/constitution.md#c-013
decision:
  selected: scoped
  reason: 按操作依赖划分边界；GPT-6 Astra 独立挑战后的精确架构已通过，保留完整性、证据及恢复门禁。
  at: 2026-09-27T00:03:15.879Z
  targets:
    - docs/feature/portable-coordination/README.md
    - docs/feature/local-sdlc/README.md
---

# 按操作依赖划分读取、发布与恢复边界

本设计定义局部操作的依赖、故障影响与恢复结果。适用宪法条款由 constitutionRefs 声明。

## Problem

读取工程知识和生成指定契约的注释不应依赖无关契约、测试或代码声明全部有效。仓库在开发过程中允许局部不完整；工具必须明确哪些输入缺陷影响当前操作。GitHub issue #1 的死发布锁阻断 Memory 与 annotate，暴露操作范围与协调范围混用；其 macOS 现场原因尚未由本设计认定。

## Core Mental Model

事实由原 owner 拥有。操作依赖由它要回答的问题或维护的不变量确定。读取需要一致输入，发布需要完整前像与互斥，证据裁决需要执行身份与证明，不能用一个全仓库有效的布尔值替代。

## Scope and Tradeoffs

保持文件 owner、journal、证据格式和路径安全。共享短快照防止读取合作发布的半套变更。局部依赖隔离不忽略目标损坏、身份歧义或未完成事务。未知 runner 子进程可能写任意路径，因此仍阻断发布；只读观察不要求 runner 健康。

## Entry Points

- [Goals](GOALS.md): requirements and comparison criteria.
- [Limits](LIMITS.md): constraints shared by every candidate.
- [Cases](CASES.md): neutral scenarios for the comparison.
- [Decision](DECISION.md): explanatory evidence.
候选的 [架构明细](plans/scoped/architecture.md) 定义操作矩阵、读取依赖和恢复结果。候选中的 satisfied 表示设计论证，运行时验收仍须独立完成；采用状态仅由工具裁决 metadata 表达。
