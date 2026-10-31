---
status: closed
closure:
  kind: fixed
  reason: 迟到聚合响应按请求代次丢弃，保留更新的检查报告
  verification:
    defect: 16e8e3bb101b38ea30e03170421733c430073697
    fix: cbbd73948894f0aeb852b2e4d5dbcff3b07b2a18
    tests:
      - neref_0d9d4378ce70ab6874a5953e8e8b8ded
    runner: sha256:db83e0ff88b65dcaaf52a8f69c6262dbd1b596991eee44d5fcf69e1a65b4e8e0
    concord: dev
---

# 迟到的术语聚合响应清除较新的检查结果

## 现象

写作页 `web/pages/writing.tsx` 的 `loadAggregate` 收到 `inputDigest` 与当前不同的聚合响应时，增加报告代次并清空检查结果。先前目录切换发出的 `concepts.index` 响应如果晚于随后的检查结果到达，会把这份较新的结果清掉，页面显示「术语来源已变化」，尽管来源没有再变。

全量门禁中 `test/e2e/scoped-writing-browser.e2e.ts:133` 因此偶发找不到「某次快照的检查结果」。在真实 CLI、HTTP 与浏览器上，于 HTTP 边界暂存一个已成功的 `concepts.index` 响应，待检查结果出现后再放行，可以稳定复现。

## 期望

响应只在属于当前请求代次时改变报告状态，迟到的旧响应不清除较新的检查结果（[管理写作政策](../feature/documentation-quality/use-case/manage-writing.md)）。

## 修复

先提交带 `@issue` 标记、能稳定复现上述时序的回归测试，再提交修复。
