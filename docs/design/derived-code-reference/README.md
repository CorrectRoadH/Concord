# 实现声明自动派生查询引用

维护者需要显式表达实现与 Spec 的关系，但不需要为每段实现另取声明 ID。用户明确保留 `@concord-implements`，要求移除人工身份定义。

代码归属声明由源码拥有；内部引用是当前扫描派生的定位结果，不是持久历史身份或测试证据。本设计比较自动派生与显式 ID，明确当前语法与引用稳定边界，不提供旧命令兼容或迁移机制。

当前目标由 [源码归属 Use Case](../../feature/local-sdlc/use-case/trace-code-ownership.md) 拥有。Engineering 实现关联和已完成的响应式常显布局继续保留。

## Entry Points

- [Goals](GOALS.md): requirements and comparison criteria.
- [Limits](LIMITS.md): constraints shared by every candidate.
- [Cases](CASES.md): neutral scenarios for the comparison.
- [Decision](DECISION.md): explanatory evidence.
Each candidate in plans/ is a self-contained feature design package.
The decision is recorded only by `concord design decide`; writing prose does not select a candidate.

## Constitution

- [C-001](../../constitution.md#c-001)
- [C-003](../../constitution.md#c-003)
- [C-004](../../constitution.md#c-004)
- [C-005](../../constitution.md#c-005)
- [C-006](../../constitution.md#c-006)
- [C-007](../../constitution.md#c-007)
- [C-009](../../constitution.md#c-009)
