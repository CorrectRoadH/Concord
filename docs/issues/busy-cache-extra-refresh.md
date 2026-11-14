---
relations:
  - role: spec
    target: docs/feature/web-workbench/ui.md
---

# 缓存占用恢复后浏览器多发一次刷新请求

## 现象

CI run 42259131130（da57035）分片 2（job 128034140781）中，`test/e2e/view-browser.e2e.ts:161` 在持久缓存占用解除、工作区恢复后，观察到一次额外的 `POST` 刷新请求（期望 0 次，实际 1 次）。同一提交前的本地完整门禁 run-9HOu7W 中这一项通过。

## 期望

先确定这次刷新由谁发起：恢复后界面重复申请刷新是产品行为缺陷，按 [界面](../feature/web-workbench/ui.md) 的刷新规则修复并由 agent 用项目工具验证；测试在恢复前的请求尚未收束时就开始计数，则让测试等待真实状态，不改断言、不延长超时。
