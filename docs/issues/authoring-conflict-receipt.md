---
relations:
  - role: adopts
    target: docs/engineering/testing/README.md
---

# 冲突对话框测试未等保存冲突回执

## 现象

最终 CI run 42195468804 分片 3 中，`test/e2e/view-authoring.e2e.ts:115` 注入真实的外部改写后填入未保存的浏览器草稿，随即断言冲突对话框，5 秒内对话框没有出现（`/tmp/concord-closure/lead5-ci-final-shard3.log:1569-1593`）。测试没有等待 `document.set` 返回 409 的回执。

## 期望

测试等待与路径和正文匹配的 `document.set` 409 回执，再保留全部原有断言，不改超时（[共享资源与同步](../engineering/testing/README.md#共享资源与同步)）。缺陷在测试自身，按[成本与稳定](../engineering/testing/README.md#成本与稳定)以 `--reason` 关闭。
