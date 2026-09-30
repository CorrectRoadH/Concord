---
format: concord.document/v1
id: pr-change-preview
title: PR 变更的静态审阅
createdAt: 2026-09-30T02:22:00.081Z
kind: design
alternatives:
  - static
  - hosted-workbench
constitutionRefs:
  - docs/constitution.md#c-002
  - docs/constitution.md#c-003
  - docs/constitution.md#c-007
  - docs/constitution.md#c-014
decision:
  selected: static
  reason: 静态阅读隔离本地写入与执行能力；固定 Git 对象、严格共享格式及消费者 PR 身份核验满足比较与发布边界。
  at: 2026-09-30T04:24:44.526Z
  targets: []
---

# PR 变更的静态审阅

## Problem

PR 审阅者需要在 Preview 中阅读本次提交引入的变化，同时保持本地编辑与公开阅读的权限边界。方案比较差异计算、托管方式与资源所有权，不改变源码和契约的事实归属。

## Core Mental Model

目标分支的提交为 base，PR 来源提交为 head。两者唯一最佳共同祖先是审阅基线；其到 head 的差异表达本次 PR 引入的变更。工作树未提交内容只属于本地审阅。

## Scope and Tradeoffs

Concord 拥有 Git 比较与阅读产物。消费者取得并校验 PR 身份、准备 Git 历史、安装固定工具包和托管产物。方案不接管产品构建、PR 发布、运行凭据或测试证据。

## Entry Points

- [目标](GOALS.md)
- [约束](LIMITS.md)
- [场景](CASES.md)
- [候选比较](DECISION.md)
- [静态导出](plans/static/README.md)
- [托管工作台](plans/hosted-workbench/README.md)
- [本地审阅用例](../../feature/web-workbench/use-case/review-local-changes.md)
- [PR 审阅用例](../../feature/web-workbench/use-case/review-pull-request.md)
