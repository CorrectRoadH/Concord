---
relations:
  - role: spec
    target: docs/engineering/testing/README.md
---

# 写作规则替换建议的浏览器测试在 CI 中找不到输入框

## 现象

CI（dd85c04）分片 4 中，`test/e2e/writing-save-receipt-browser.e2e.ts:50` 的 `getByLabel(/^替换建议 \d+$/u).last()` 期望显示 `Saved after receipt`，5 秒内元素消失。同一分片源码测试、归档与静态检查全部通过，内存峰值 6.1 GB，未触及 7 GiB 上限；同一选择器在更早的 CI 中也失败过（`/tmp/concord-closure/lead6-ci-dd85c04-shard-4.log`）。本机完整门禁中这一项通过。

## 期望

先确定输入框为什么消失：保存回执之后列表重新渲染替换了元素，还是测试在列表稳定前取了最后一项。界面在保存后丢失用户正在看的输入框属于产品缺陷，按 `--fixed` 修复；否则让测试等待真实状态再断言，不延长超时、不重试、不改断言（[共享资源与同步](../engineering/testing/README.md#共享资源与同步)）。
