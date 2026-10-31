---
status: closed
closure:
  kind: fixed
  reason: 刷新前等待保存回执生效和未保存状态清除
  verification:
    defect: a93445c89d934886fc2e868d3d740f4f5af187ce
    fix: da3ef251d2d4b594d7f8b88bc7a26d9793952c54
    tests:
      - neref_d67bd02939899320d5a5c8a35b026433
    runner: sha256:db83e0ff88b65dcaaf52a8f69c6262dbd1b596991eee44d5fcf69e1a65b4e8e0
    concord: dev
---

# 写作页测试在保存回执前刷新页面

## 现象

`test/e2e/writing-browser.e2e.ts:109-111` 点击保存后，只轮询政策文件的磁盘字节变为新值就调用 `page.reload`。发布先替换文件，浏览器在收到 HTTP 回执后才更新基线、清除未保存标记。回执到达前页面仍有未保存改动，`beforeunload` 拦截导航，reload 等到 15 秒超时。在 HTTP 边界暂存回执可以稳定复现。

## 期望

测试等待真实的产品状态：保存回执生效、页面不再有未保存改动后再刷新（[测试执行](../engineering/concord-self-hosting/testing.md#共享资源与同步)）。不以延长超时或重试消除失败。

## 修复

把等待条件改为页面的保存完成状态，并以暂存回执的时序验证修复前失败、修复后通过。
