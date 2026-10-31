---
status: open
---

# 写作政策修复保存的浏览器测试在负载下失败

## 现象

`test/e2e/writing-browser.e2e.ts` 的「real browser displays invalid policy bytes and requires an explicit repair save」在完整门禁中失败（`/tmp/p3-packed-prewarm.log`）。它在空闲机器上单独复跑通过（`/tmp/p3-lsp-writing-idle-recheck.log`）。

## 期望

测试等待真实的产品状态，例如保存回执生效，不在固定时限内等待界面变化（[共享资源与同步](../engineering/concord-self-hosting/testing.md#共享资源与同步)）。不以延长超时或重试消除失败。
