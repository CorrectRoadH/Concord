---
format: concord.document/v1
id: writing-management
title: 写作规则与 Web 术语管理
createdAt: 2026-09-23T01:55:53.396Z
kind: design
alternatives:
  - source-owned
  - unified-json
constitutionRefs:
  - docs/constitution.md#c-001
  - docs/constitution.md#c-003
  - docs/constitution.md#c-004
  - docs/constitution.md#c-005
  - docs/constitution.md#c-006
  - docs/constitution.md#c-007
  - docs/constitution.md#c-009
  - docs/constitution.md#c-010
decision:
  selected: source-owned
  reason: 采用各自真源的组合管理；Herdr Astra CONDITIONAL 的六项条件已写入契约并逐项核对，实现验收由 Sol worker 与父 agent 完成。
  at: 2026-09-23T02:01:24.482Z
  targets:
    - docs/feature/documentation-quality/use-case/manage-writing.md
---

# 写作规则与 Web 术语管理

> 此历史方案的固定路径和 Markdown 术语来源边界已由[目录作用域方案](../scoped-terminology/README.md)替代。原裁决及论证保留为历史，不再定义当前范围。

NiceEval 的词库混合写作禁语、概念同义词与产品检查，且 Resolve/resolve 按不区分大小写实际重复。Concord 将通用执行与消费者政策分开后，还需要明确 Web 编辑的真源与恢复权限。

比较保留各自真源的组合管理，与将全部概念迁移到单一 JSON 词库。目标为[文档写作](../../feature/documentation-quality/README.md)及[Web 管理](../../feature/documentation-quality/use-case/manage-writing.md)。

- [Goals](GOALS.md)
- [Limits](LIMITS.md)
- [Cases](CASES.md)
- [Decision](DECISION.md)
