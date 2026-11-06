---
relations:
  - role: adopts
    target: docs/engineering/testing/README.md
---

# 切换写作范围后测试未等术语读取完成

## 现象

`test/e2e/scoped-writing-browser.e2e.ts` 在 CI 中两次失败。切换写作范围时源码编辑器被卸载，`concepts.show` 响应完成前对应 DOM 不存在，断言在 5 秒内找不到 “Second definition”（run 42177882630，job 127760473620:69）与 “Beta”（run 42178934764，job 127763765264:66）。证据 `/tmp/concord-closure/browser-ci-job127760473620.log`、`/tmp/concord-closure/browser-ci-job127763765264.log`。

## 期望

测试等待与目标路径匹配的 `concepts.show` 真实成功回执，再做原有的 DOM 断言（[共享资源与同步](../engineering/testing/README.md#共享资源与同步)）。不以延长超时或重试消除失败。根因在测试同步时按测试缺陷关闭（[成本与稳定](../engineering/testing/README.md#成本与稳定)）。
