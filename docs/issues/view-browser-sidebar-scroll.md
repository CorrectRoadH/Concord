---
relations:
  - role: spec
    target: docs/feature/web-workbench/ui.md
---

# 侧栏滚动位置在下一次读取时改变

## 现象

完整门禁 run-j4BlDg 中，`test/e2e/view-browser.e2e.ts:106` 把侧栏 `scrollTop` 设为 160，下一次读取得到 209（`/tmp/concord-closure/lead5-full-gate-final-snapshot.log:5024`；trace 在 `.test-results/run-j4BlDg/e2e/results/view-browser-browser-opens-and-refreshes-a-551bed6eb6933fed/trace.md`）。尚未确定是浏览器的滚动锚定、布局尚未完成，还是产品在刷新时改变了滚动位置。

## 期望

先确定原因。产品在刷新时改变了用户的滚动位置，则按[界面](../feature/web-workbench/ui.md)修复产品；测试在布局完成前读取，则等待真实的布局状态，不放宽断言、不加延时。
