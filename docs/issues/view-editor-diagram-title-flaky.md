---
status: open
---

# 长文档编辑测试在负载下等不到图解标题

## 现象

`test/e2e/view-editor-browser.e2e.ts` 的「long documents remain reachable and code blocks follow theme without changing Markdown」在完整门禁中两次失败：在 5 秒内等不到名为 Architecture diagram 的图片带有 title「System architecture」。最近一次（1d91538，完整门禁 371 s，Node 并发 8、浏览器 4）失败时的 DOM 已含该图，trace 见 `.test-results/run-dYiSdX/e2e/results/view-editor-browser-long-documents-remain-reachable-3267aec1bb911a59/trace.md`；同一提交在空闲机器上单独复跑通过（10.6 s）。更早一次同一用例在 P2 阶段的门禁中失败，当时归因于失败后关闭服务造成的连接拒绝。

## 期望

测试等待图解渲染完成这一真实产品状态，而不是在固定的断言时限内等待属性出现（[共享资源与同步](../engineering/concord-self-hosting/testing.md#共享资源与同步)）。不以延长超时或重试消除失败。

## 修复

找出图解从挂载到写入 title 之间缺失的同步点，使测试以产品暴露的完成状态为条件；以负载或暂存渲染的方式先复现失败，再修复。
