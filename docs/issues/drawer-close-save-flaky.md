---
relations:
  - role: related
    target: docs/issues/authoring-config-autosave-flaky.md
  - role: adopts
    target: docs/feature/web-workbench/ui.md
---

# 关闭 Use Case 抽屉在完整门禁中等不到保存完成

## 现象

`test/e2e/view-authoring.e2e.ts:155` 在完整门禁中失败：在 Use Case 详情抽屉的编辑器里填入新内容后点击 Close，5 秒内抽屉仍在，`toHaveCount(0)` 实际为 1；截图与 DOM 显示仍在保存中（`.test-results/run-fYopGW`）。门禁结束后在空闲机器上原样运行该文件通过（30.6 s，`.test-results/run-hByKiS`）。

## 期望

关闭抽屉前先完成待保存内容，只有自动保存失败时才要求处理草稿（[界面](../feature/web-workbench/ui.md)）。测试等待真实的产品状态，例如保存回执生效后抽屉关闭，而不是在固定时限内等待（[共享资源与同步](../engineering/testing/README.md#共享资源与同步)）。不以延长超时或重试消除失败。

先确认负载下保存为何超过 5 秒：是保存请求排在同一编辑器较早的自动保存之后、服务端写入慢，还是关闭流程在等待一个不会到来的状态。可能与 [项目配置源码编辑测试在负载下等不到自动保存](authoring-config-autosave-flaky.md) 同源。
