---
status: closed
closure:
  kind: closed
  reason: 当前 master 定向复核旧记录五项均通过（5/5），未复现。命令：pnpm check test/e2e/operation-boundaries-browser.e2e.ts test/e2e/view-browser.e2e.ts test/e2e/workspace-watch-browser.e2e.ts test/process/asynchronous-projections-2.test.ts test/process/view-performance.test.ts；使用名称筛选逐项执行原记录场景。日志 /tmp/web-races-red.log；浏览器报告 .test-results/run-GzxFDr/e2e/summary.md。
---

# 两个工作台浏览器测试在 master 上稳定失败

在 master `3ab75f7`（干净 worktree，预编译原生产物）上，完整 `pnpm check` 与单独重跑都失败：

- `browser preserves blocked recovery and labels incomplete workspace relations`：严格模式下 `getByText('InvalidData', { exact: true })` 匹配到 2 个元素。
- `browser opens and refreshes a deep link without credentials and retries initial load failures`：`getByRole('alert')` 期望文本"工作区暂时不可用"，元素未出现。

完整 `pnpm check` 中另有三项失败，单独重跑通过，表现为并发或时序相关的不稳定：

- `packed C1 publishes cold projections…`
- `workbench compresses workspace data…`
- `ordinary pages suppress drift…`
