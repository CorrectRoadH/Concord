---
relations:
  - role: adopts
    target: docs/feature/web-workbench/use-case/inspect-implementation-and-tests.md
---

# 工作台没有运行与取消测试的控件

## 现象

界面规格写明可以在工作台运行与取消测试（[界面](../feature/web-workbench/ui.md)、[查看实现与测试](../feature/web-workbench/use-case/inspect-implementation-and-tests.md)），但 `web/workspace.tsx` 的 `runCase` 与 `cancelJob` 没有组件调用，只有 `/api/jobs` 可用。由 docs-refactor-workbench 发现。

## 期望

Use Case 的测试列表提供运行与取消，运行结果与 CLI `test run` 相同，不持久化。
