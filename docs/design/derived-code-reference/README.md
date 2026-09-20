---
format: concord.document/v1
id: derived-code-reference
title: 实现声明自动派生查询引用
createdAt: 2026-09-20T08:38:16.851Z
kind: design
alternatives:
  - derived
  - explicit
constitutionRefs:
  - docs/constitution.md#c-001
  - docs/constitution.md#c-003
  - docs/constitution.md#c-004
  - docs/constitution.md#c-005
  - docs/constitution.md#c-006
  - docs/constitution.md#c-007
  - docs/constitution.md#c-009
decision:
  selected: derived
  reason: 用户要求保留 implements、删除手写声明 ID；独立 Herdr Astra 挑战三项问答后 PASS，采用有明确失效与复用边界的当前 AST 派生引用。
  at: 2026-09-20T08:42:30.587Z
  targets:
    - docs/feature/local-sdlc/use-case/trace-code-ownership.md
---

# 实现声明自动派生查询引用

维护者需要显式表达实现与契约的关系，但不需要为每段实现另取声明 ID。用户明确保留 `@concord-implements`，要求移除人工身份定义。

代码归属声明由源码拥有；内部引用是当前扫描派生的定位结果，不是持久历史身份或测试证据。本设计比较自动派生与显式 ID，明确当前语法与引用稳定边界，不提供旧命令兼容或迁移机制。

当前目标由 [源码归属 Use Case](../../feature/local-sdlc/use-case/trace-code-ownership.md) 拥有。Engineering 实现关联和已完成的响应式常显布局继续保留。

## Entry Points

- [Goals](GOALS.md): requirements and comparison criteria.
- [Limits](LIMITS.md): constraints shared by every candidate.
- [Cases](CASES.md): neutral scenarios for the comparison.
- [Decision](DECISION.md): explanatory evidence.
Each candidate in plans/ is a self-contained feature design package.
The decision is recorded only by `concord design decide`; writing prose does not select a candidate.
