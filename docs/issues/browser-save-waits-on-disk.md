---
relations:
  - role: adopts
    target: docs/engineering/testing/README.md
---

# 浏览器测试保存后只等磁盘就断言页面

## 现象

CI run 42190837213（b4b2f7e）分片 1 中，`test/e2e/feedback-browser.e2e.ts:125` 保存本地正文后文件已落盘，来源页的 “Original remote body” 在 5 秒内没有出现（`/tmp/concord-closure/lead5-ci-b4b2f7e-shard1.log:2194`）。编辑器的保存还要经过 `api.file` 读取与 `requestRefresh` 刷新，测试只等到磁盘写入就做页面断言。此前 `drawer-close-save-flaky`、`authoring-config-autosave-flaky` 与 `scoped-writing-switch-sync` 是同一类缺陷。

## 期望

测试等待这次保存的 `document.set` 回执，以及含新正文的工作区投影回执，再做原有的页面断言，不延长超时、不删断言（[共享资源与同步](../engineering/testing/README.md#共享资源与同步)）。同时检查其它浏览器测试中“只等磁盘就断言页面”的同一写法，一并改为等待回执。缺陷在测试自身，按[成本与稳定](../engineering/testing/README.md#成本与稳定)以 `--reason` 关闭。
