---
format: concord.document/v1
id: test-journey-steps
title: 测试关联到 Use Case 步骤
createdAt: 2026-10-21T07:31:30.413Z
kind: design
alternatives:
  - step-anchor
  - step-heading
constitutionRefs:
  - docs/constitution.md#c-001
  - docs/constitution.md#c-004
  - docs/constitution.md#c-009
  - docs/constitution.md#c-010
  - docs/constitution.md#c-011
  - docs/constitution.md#c-012
  - docs/constitution.md#c-013
---

# 测试关联到 Use Case 步骤

## Problem

Use Case 的文件级关联不足以导航到具体动作。步骤关联视图需要稳定身份，并区分源码声明与执行观察。

## Core Mental Model

步骤、测试关联、代码关联、原生选择与观察结果遵守[共同身份](共同身份.md)。步骤是 Use Case 顶层有序列表中显式标注的项，不依赖章节名称。验收条目不进入步骤集合。

步骤视图从正文和源码标记派生；无测试关联表示未声明关联，不表示没有测试。相关性只使用共同契约的 `observed` 与带 gaps 的 `not-observed`，不输出行为无关结论。

## Scope and Tradeoffs

两个候选比较同一领域集合：显式列表步骤。列表项 anchor 直接呈现正文；步骤标题候选在同一列表步骤上增加标题导航，标题本身不产生步骤。纯标题替代列表不符合共同契约。

步骤解析、引用与未关联视图独立于 adapter 和 LSP。原生执行增强由 [test-adapters](../test-adapters/README.md) 拥有，显式分析由 [lsp-integration](../lsp-integration/README.md) 拥有。黑盒 CLI 测试可导航到步骤；依赖交集仍可能未被观察到。

## 验收边界

步骤导航和依赖观察分别验收。使用已知正确及错误声明的直接调用、子进程 CLI 样本，逐个公开观察结果和 gaps，不设未知结果比例目标，不维护人工断言映射。关联视图不证明执行或覆盖率。

## Entry Points

- [Goals](GOALS.md)
- [Limits](LIMITS.md)
- [Cases](CASES.md)
- [Decision](DECISION.md)
- [共同身份](共同身份.md)
- [列表项 anchor](plans/step-anchor/README.md)
- [步骤标题导航](plans/step-heading/README.md)
