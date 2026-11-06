---
relations:
  - role: adopts
    target: docs/engineering/testing/README.md
---

# 反馈连接检测的浏览器测试未等检测回执

## 现象

CI run（f2841df）分片 1 中，`test/e2e/feedback-gh-ui.e2e.ts:109` 在 `feedback.check` 的实际回执到达前做 5 秒的页面断言而失败（`/tmp/concord-closure/lead5-ci-f2841df-shard1.log:1386`）。

## 期望

测试等待与当前连接匹配的 `feedback.check` 回执再断言页面；保留故意让被暂停的旧检查失效的场景，不延长超时、不删断言（[共享资源与同步](../engineering/testing/README.md#共享资源与同步)）。缺陷在测试自身，按[成本与稳定](../engineering/testing/README.md#成本与稳定)以 `--reason` 关闭。
