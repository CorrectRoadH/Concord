---
status: open
---

# 迟到的术语聚合响应清除较新的检查结果

## 现象

写作页 `web/pages/writing.tsx` 的 `loadAggregate` 收到 `inputDigest` 与当前不同的聚合响应时，增加报告代次并清空检查结果。先前目录切换发出的 `concepts.index` 响应如果晚于随后的检查结果到达，会把这份较新的结果清掉，页面显示「术语来源已变化」，尽管来源没有再变。

全量门禁中 `test/e2e/scoped-writing-browser.e2e.ts:133` 因此偶发找不到「某次快照的检查结果」。在真实 CLI、HTTP 与浏览器上，于 HTTP 边界暂存一个已成功的 `concepts.index` 响应，待检查结果出现后再放行，可以稳定复现。

## 期望

响应只在属于当前请求代次时改变报告状态，迟到的旧响应不清除较新的检查结果（[管理写作政策](../feature/documentation-quality/use-case/manage-writing.md)）。

## 修复

先提交带 `@issue` 标记、能稳定复现上述时序的回归测试，再提交修复。
