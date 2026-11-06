---
relations:
  - role: spec
    target: docs/feature/web-workbench/use-case/handle-lifecycle-in-workbench.md
---

# 工作台缺少 Design 生命周期入口与 Issue 的 fixed 关闭

## 现象

`web/pages/documents.tsx:516` 只对 Roadmap、Memory、Issue 显示生命周期入口，Design 没有；Issue 只能按理由关闭，没有先执行修复核验的 fixed 关闭表单。由 docs-refactor-workbench 发现。

## 期望

Roadmap、Design、Memory 与 Issue 都显示生命周期入口；Issue 的 fixed 关闭先执行修复核验，结果与 `concord issue close --fixed` 相同（[在工作台处理生命周期](../feature/web-workbench/use-case/handle-lifecycle-in-workbench.md)）。
