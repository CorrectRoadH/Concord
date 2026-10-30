---
type: decision
status: current
relations:
  - role: amends
    target: docs/constitution.md
---

# 分离历史诊断与当前事实门禁，采用乐观读取及短期提交协调

宪法修订，日期 2026-09-28。

## 理由

分离历史诊断与当前事实门禁，采用乐观读取及短期提交协调

## 影响

诊断查询可异步刷新并返回明确标识的历史投影；当前事实与证据门禁保持严格；普通读取不再持共享租约

## 来源

- `docs/design/asynchronous-projections/README.md`
- `docs/feature/local-data-engine/use-case/query-asynchronous-projections.md`
