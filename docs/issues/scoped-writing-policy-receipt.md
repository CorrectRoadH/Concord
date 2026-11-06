---
relations:
  - role: adopts
    target: docs/engineering/testing/README.md
---

# 切换写作范围后测试未等写作政策读取完成

## 现象

CI run 42192105889（f2841df）分片 2 中，`test/e2e/scoped-writing-browser.e2e.ts:113` 切换写作范围后，没有等待 `writing.show`（Beta）的回执就做 5 秒的页面断言（`/tmp/concord-closure/lead5-ci-f2841df-shard2.log:1555`）。之前 `scoped-writing-switch-sync` 的修复只等待了 `concepts.show`，写作政策的读取被遗漏。

## 期望

切换范围后，等待与目标路径匹配的每个读取回执（`writing.show` 与 `concepts.show`）；被暂停的请求放行后，确认迟到的响应已经到达，再保留原有的页面断言，不延长超时、不删断言（[共享资源与同步](../engineering/testing/README.md#共享资源与同步)）。缺陷在测试自身，按[成本与稳定](../engineering/testing/README.md#成本与稳定)以 `--reason` 关闭。
